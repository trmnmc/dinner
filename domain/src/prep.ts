/**
 * prep.ts — prep-plan derivation (wave 1D, T-013).
 *
 * `derivePrepPlan` is a pure fold over a single `Recipe`'s authored data —
 * ingredient lines, top-level and per-step equipment, and the nine
 * required per-step interruption-metadata fields (recipe.ts) — into the
 * structured facts a "before you start cooking" screen needs:
 *
 * - ingredients to retrieve (split required / optional, straight from the
 *   authored `optional` flag — never re-guessed), quantities SCALED to the
 *   caller's explicit `targetServings` via `scale.ts`'s `scaleFactor` /
 *   `scaleQuantity` — the SAME functions `scaleRecipeRequirements` uses to
 *   build the grocery list (T-043: prep must agree with grocery for the
 *   same plan meal, not report `servings_default` quantities regardless of
 *   household size). The factor is computed once and applied to required
 *   and optional lines alike; `do_ahead_tasks` carries no quantity so it is
 *   unaffected. This module does not re-derive the factor independently —
 *   it reuses scale.ts, never a second scaling path.
 * - equipment needed (recipe-level + every step's equipment, deduplicated)
 * - do-ahead tasks (ingredient lines that carry a non-null `preparation` —
 *   the only per-ingredient field describing work performable ahead of the
 *   cook proper, e.g. "minced", "diced")
 * - the FIRST step demanding continuous attention
 * - the FIRST safe stopping point, reusing `cooking.ts`'s `nextSafeStop`
 *   AT THE RECIPE'S START (current_step_index 0) rather than inventing a
 *   parallel notion of "safe to stop" — the cooking session state machine
 *   and the prep plan must agree on what "safe" means, by construction
 *   (see cooking.ts's `nextSafeStop` docs for the exact stepping rule)
 * - expected active-time blocks: maximal runs of consecutive steps whose
 *   `active_duration_seconds` is > 0
 *
 * Every field above is either passed through unchanged from required
 * step/ingredient metadata or reuses `cooking.ts`'s existing derivation —
 * this module invents no new interpretation of "safe" or "recovery".
 * Where the recipe has no answer to a question (no continuous-attention
 * step, no safe stopping point anywhere, no active time at all), the
 * result is the type's own explicit "none" — `null`, `{ kind:
 * 'end_of_recipe' }`, or an empty array — never a fabricated default.
 *
 * PURE: no I/O, no clock, no randomness. This module derives structured
 * DATA only; turning any of it into a user-facing STRING (e.g. rendering
 * `first_non_interruptible_step.recovery_instruction` or an active-time
 * block's duration) goes through `reasons.ts`, the one copy module — never
 * a bespoke template here.
 */

import type { IngredientId, Recipe, RecipeIngredientLine, RecipeStep, Uuid } from './recipe.ts';
import type { NextSafeStop } from './cooking.ts';
import { nextSafeStop } from './cooking.ts';
import { scaleFactor, scaleQuantity } from './scale.ts';

// ---------------------------------------------------------------------------
// Derived shapes
// ---------------------------------------------------------------------------

/** One ingredient line that can be prepared ahead of active cooking,
 * derived directly from its authored (non-null) `preparation`. */
export interface DoAheadTask {
  readonly ingredient_line_id: string;
  readonly ingredient_id: IngredientId;
  readonly display_name: string;
  /** Non-null by construction — this is the field that made it a task. */
  readonly preparation: string;
}

/** A maximal run of index-contiguous steps each with
 * `active_duration_seconds > 0`. `active_seconds` is the exact sum of
 * those steps' `active_duration_seconds` — integer, no rounding. */
export interface ActiveTimeBlock {
  readonly start_step_index: number;
  readonly end_step_index: number;
  readonly active_seconds: number;
}

export interface PrepPlan {
  readonly recipe_id: Uuid;
  /** Non-optional ingredient lines, in authored order. */
  readonly required_ingredients: readonly RecipeIngredientLine[];
  /** Optional (garnish/serving-suggestion) lines, in authored order. */
  readonly optional_ingredients: readonly RecipeIngredientLine[];
  /** Recipe-level equipment followed by every step's equipment, each
   * named item appearing once, in first-seen order. */
  readonly equipment: readonly string[];
  /** In authored ingredient order. Empty when nothing can be prepped
   * ahead — an explicit empty array, not an omitted field. */
  readonly do_ahead_tasks: readonly DoAheadTask[];
  /** null when no step in the recipe requires continuous attention. */
  readonly first_non_interruptible_step: RecipeStep | null;
  /** From `cooking.ts#nextSafeStop(steps, 0)` — `{ kind: 'end_of_recipe' }`
   * is the explicit "no safe stopping point anywhere" case. */
  readonly first_safe_stopping_point: NextSafeStop;
  /** Empty when the recipe has zero active time (e.g. entirely one
   * unattended step) — an explicit empty array, never a fabricated block. */
  readonly active_time_blocks: readonly ActiveTimeBlock[];
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Every ingredient line, quantity scaled to `targetServings` via `scale.ts`
 * (the same factor and function the grocery path uses) — authored order
 * preserved, nothing else on the line touched.
 */
function scaleIngredientLines(recipe: Recipe, targetServings: number): readonly RecipeIngredientLine[] {
  const factor = scaleFactor(recipe.servings_default, targetServings);
  return recipe.ingredients.map((line) => ({ ...line, quantity: scaleQuantity(line.quantity, factor) }));
}

function deriveIngredients(scaledIngredients: readonly RecipeIngredientLine[]): {
  required: readonly RecipeIngredientLine[];
  optional: readonly RecipeIngredientLine[];
  do_ahead_tasks: readonly DoAheadTask[];
} {
  const required: RecipeIngredientLine[] = [];
  const optional: RecipeIngredientLine[] = [];
  const do_ahead_tasks: DoAheadTask[] = [];
  for (const line of scaledIngredients) {
    if (line.optional) optional.push(line);
    else required.push(line);
    if (line.preparation !== null) {
      do_ahead_tasks.push({
        ingredient_line_id: line.id,
        ingredient_id: line.ingredient_id,
        display_name: line.display_name,
        preparation: line.preparation,
      });
    }
  }
  return { required, optional, do_ahead_tasks };
}

function deriveEquipment(recipe: Recipe): readonly string[] {
  const seen = new Set<string>();
  const equipment: string[] = [];
  for (const item of recipe.equipment) {
    if (!seen.has(item)) {
      seen.add(item);
      equipment.push(item);
    }
  }
  for (const step of recipe.steps) {
    for (const item of step.equipment) {
      if (!seen.has(item)) {
        seen.add(item);
        equipment.push(item);
      }
    }
  }
  return equipment;
}

function firstNonInterruptibleStep(recipe: Recipe): RecipeStep | null {
  for (const step of recipe.steps) {
    if (step.requires_continuous_attention) return step;
  }
  return null;
}

/** Maximal runs of index-contiguous steps with `active_duration_seconds >
 * 0`, in step order. Relies on `RecipeStep.index` being strictly ordered,
 * 0-based and contiguous, per recipe.ts's frozen contract. */
function deriveActiveTimeBlocks(recipe: Recipe): readonly ActiveTimeBlock[] {
  const blocks: ActiveTimeBlock[] = [];
  let open: { start: number; end: number; seconds: number } | null = null;
  for (const step of recipe.steps) {
    if (step.active_duration_seconds > 0) {
      if (open === null) {
        open = { start: step.index, end: step.index, seconds: step.active_duration_seconds };
      } else {
        open = { start: open.start, end: step.index, seconds: open.seconds + step.active_duration_seconds };
      }
    } else if (open !== null) {
      blocks.push({ start_step_index: open.start, end_step_index: open.end, active_seconds: open.seconds });
      open = null;
    }
  }
  if (open !== null) {
    blocks.push({ start_step_index: open.start, end_step_index: open.end, active_seconds: open.seconds });
  }
  return blocks;
}

/**
 * Derive the full prep plan for any valid `Recipe`, scaled to
 * `targetServings` — the plan meal's `target_servings`, NOT the recipe's
 * own `servings_default`. Explicit and required (T-043): a caller cannot
 * accidentally get `servings_default` quantities by omission, which is
 * exactly the bug this parameter exists to make unrepresentable. Total
 * function over the frozen `Recipe` shape — including the degenerate cases
 * of an empty step list, zero optional ingredients, zero active time, or a
 * recipe with no safe stopping point anywhere.
 */
export function derivePrepPlan(recipe: Recipe, targetServings: number): PrepPlan {
  const scaledIngredients = scaleIngredientLines(recipe, targetServings);
  const { required, optional, do_ahead_tasks } = deriveIngredients(scaledIngredients);
  return {
    recipe_id: recipe.id,
    required_ingredients: required,
    optional_ingredients: optional,
    equipment: deriveEquipment(recipe),
    do_ahead_tasks,
    first_non_interruptible_step: firstNonInterruptibleStep(recipe),
    first_safe_stopping_point: nextSafeStop(recipe.steps, 0),
    active_time_blocks: deriveActiveTimeBlocks(recipe),
  };
}
