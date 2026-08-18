/**
 * filters.ts — absolute hard filters (wave 1B, T-006).
 *
 * Phase 1 of the deterministic recommendation engine. Hard constraints run
 * to completion BEFORE any scoring touches a recipe — this module returns
 * the survivor set, and `score.ts` accepts ONLY a `HardFilterResult`, so a
 * hard-excluded recipe is structurally unreachable by scoring (never merely
 * ranked last).
 *
 * Hard-constraint precedence, absolute and never averaged (SPEC):
 *   allergy > household hard restriction > member hard restriction >
 *   strong dislike > soft preference > optimisation.
 * Every constraint here is ABSOLUTE — precedence orders the reported
 * reasons, it never trades one constraint off against another. A strong
 * dislike can never be outweighed by inventory use or lower cost, because
 * inventory and cost are not even inputs to this phase.
 *
 * Invariant 5 binds: allergy and dietary exclusion resolve each recipe's
 * ingredient ids to allergen classes THROUGH the ingredient registry —
 * never by trusting the recipe's own dietary tags or declared allergens
 * alone. A recipe whose tag claims "gluten_free" while an ingredient
 * carries the gluten class via the registry is excluded; the tag is data
 * and data can lie.
 *
 * Every exclusion returns typed, structured reasons naming the constraint
 * and the offending ingredient/attribute — never a bare boolean.
 *
 * Determinism: pure functions of their inputs. No clock (recency arrives
 * as caller-supplied `days_ago`), no randomness, no LLM.
 */

import type {
  Allergen,
  AttributeVector,
  DietaryTag,
  Household,
  HouseholdMember,
  IngredientId,
  PreferenceAttribute,
  PreferenceSignal,
  Recipe,
  Uuid,
} from './recipe.ts';
import type { IngredientRegistry } from './catalog.ts';
import { FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG } from './catalog.ts';
import type { Rational } from './qty.ts';
import { compare, fromInt, rational } from './qty.ts';

// ---------------------------------------------------------------------------
// Context shared with scoring (phase 2 imports these types from here)
// ---------------------------------------------------------------------------

/** A recently cooked meal, as the caller recorded it. `days_ago` is a
 * caller-supplied whole-day count (0 = today) — this module never reads a
 * clock, so identical inputs always give identical results. */
export interface RecentMeal {
  readonly recipe_id: Uuid;
  readonly attributes: AttributeVector;
  /** Whole days since this meal was cooked; non-negative integer. */
  readonly days_ago: number;
}

/** Everything time-and-history shaped the engine may consult. */
export interface PlanningContext {
  readonly recent_meals: readonly RecentMeal[];
}

// ---------------------------------------------------------------------------
// Configuration — thresholds in one object, never inline literals
// ---------------------------------------------------------------------------

export interface HardFilterConfig {
  /** A preference signal with value ≤ this is a STRONG dislike (default
   * −4/5). Calibration "never_recommend" writes value −1, so it always
   * qualifies. Strong dislikes are hard exclusions, never scoring inputs. */
  readonly strong_dislike_value_max: Rational;
  /** ...and confidence ≥ this (default 1/2). */
  readonly strong_dislike_confidence_min: Rational;
  /** A recipe cooked strictly fewer than this many days ago is absolutely
   * excluded (default 4). Older repeats survive filtering and draw the
   * `recent_repeat` scoring penalty instead. */
  readonly recent_repeat_min_days: number;
}

export const HARD_FILTER_CONFIG: HardFilterConfig = {
  strong_dislike_value_max: rational(-4, 5),
  strong_dislike_confidence_min: rational(1, 2),
  recent_repeat_min_days: 4,
};

// ---------------------------------------------------------------------------
// Structured exclusion reasons — typed, never a bare boolean
// ---------------------------------------------------------------------------

export type HardExclusionReason =
  | {
      /** Member allergy matched an allergen class resolved THROUGH the
       * registry (`ingredient_id` names the carrier) or declared on the
       * recipe itself (`ingredient_id` null). */
      readonly kind: 'allergy';
      readonly member_id: Uuid;
      readonly allergen: Allergen;
      readonly ingredient_id: IngredientId | null;
    }
  | {
      /** An ingredient id that does not resolve in the registry while the
       * household carries allergies/restrictions: safety cannot be proven,
       * so the recipe is out. */
      readonly kind: 'unverifiable_ingredient';
      readonly ingredient_id: IngredientId;
    }
  | {
      /** A required dietary tag is missing from the recipe, or an
       * ingredient carries a forbidden allergen class for the tag (the
       * registry overrides the tag — Invariant 5). */
      readonly kind: 'dietary_restriction';
      readonly tag: DietaryTag;
      /** True when every household member requires this tag. */
      readonly household_wide: boolean;
      readonly member_ids: readonly Uuid[];
      /** The carrying ingredient when a forbidden class was found; null
       * when the exclusion is the missing tag itself. */
      readonly ingredient_id: IngredientId | null;
      readonly allergen: Allergen | null;
    }
  | {
      /** The member's explicit never-recommend set names this ingredient. */
      readonly kind: 'explicit_exclusion';
      readonly member_id: Uuid;
      readonly ingredient_id: IngredientId;
    }
  | {
      /** A strong-dislike preference signal applies to this recipe. */
      readonly kind: 'strong_dislike';
      readonly member_id: Uuid | null;
      readonly attribute: PreferenceAttribute;
      readonly attribute_value: string;
    }
  | {
      /** The recipe exceeds a hard weeknight time ceiling. */
      readonly kind: 'time_ceiling';
      readonly which: 'active' | 'total';
      readonly ceiling_seconds: number;
      readonly recipe_seconds: number;
    }
  | {
      /** Cooked too recently (inside the hard repeat window). */
      readonly kind: 'recent_repeat';
      readonly days_ago: number;
      readonly window_days: number;
    };

/**
 * Precedence rank of a reason — LOWER is more binding. Used only to ORDER
 * reported reasons; every reason is absolute on its own.
 *   0 allergy / unverifiable ingredient (safety)
 *   1 household-wide hard restriction
 *   2 member hard restriction
 *   3 explicit exclusion (never_recommend)
 *   4 strong dislike
 *   5 hard time ceiling
 *   6 recent repeat
 */
export function exclusionPrecedenceRank(reason: HardExclusionReason): number {
  switch (reason.kind) {
    case 'allergy':
      return 0;
    case 'unverifiable_ingredient':
      return 0;
    case 'dietary_restriction':
      return reason.household_wide ? 1 : 2;
    case 'explicit_exclusion':
      return 3;
    case 'strong_dislike':
      return 4;
    case 'time_ceiling':
      return 5;
    case 'recent_repeat':
      return 6;
  }
}

export interface RecipeExclusion {
  readonly recipe_id: Uuid;
  /** Non-empty; ordered by `exclusionPrecedenceRank`, most binding first. */
  readonly reasons: readonly HardExclusionReason[];
}

export interface HardFilterResult {
  /** Recipes that violated NO hard constraint, in input order. Scoring
   * (`score.ts`) accepts only this result — exclusion is unreachability. */
  readonly survivors: readonly Recipe[];
  /** One entry per excluded recipe, in input order. */
  readonly exclusions: readonly RecipeExclusion[];
}

// ---------------------------------------------------------------------------
// Attribute matching (shared with scoring)
// ---------------------------------------------------------------------------

/** True when a preference signal is ABOUT this recipe: the signal's
 * attribute value matches the recipe's value on that axis (membership for
 * the list axes flavour/texture). */
export function signalAppliesToRecipe(
  signal: PreferenceSignal,
  attributes: AttributeVector,
): boolean {
  const v = signal.attribute_value;
  switch (signal.attribute) {
    case 'protein':
      return attributes.protein === v;
    case 'cuisine':
      return attributes.cuisine === v;
    case 'flavour':
      return attributes.flavour.some((f) => f === v);
    case 'texture':
      return attributes.texture.some((t) => t === v);
    case 'spice':
      return attributes.spice === v;
    case 'richness':
      return attributes.richness === v;
    case 'method':
      return attributes.method === v;
    case 'effort':
      return attributes.effort === v;
  }
}

// ---------------------------------------------------------------------------
// The filter itself
// ---------------------------------------------------------------------------

/**
 * Apply every absolute hard constraint. Returns survivors and structured
 * per-recipe exclusions; the two partition the input, preserving order.
 * Pure and deterministic — identical inputs give identical results.
 */
export function applyHardFilters(
  recipes: readonly Recipe[],
  household: Household,
  members: readonly HouseholdMember[],
  signals: readonly PreferenceSignal[],
  registry: IngredientRegistry,
  context: PlanningContext,
  config: HardFilterConfig = HARD_FILTER_CONFIG,
): HardFilterResult {
  const survivors: Recipe[] = [];
  const exclusions: RecipeExclusion[] = [];
  for (const recipe of recipes) {
    const reasons = collectReasons(recipe, household, members, signals, registry, context, config);
    if (reasons.length === 0) survivors.push(recipe);
    else exclusions.push({ recipe_id: recipe.id, reasons });
  }
  return { survivors, exclusions };
}

function collectReasons(
  recipe: Recipe,
  household: Household,
  members: readonly HouseholdMember[],
  signals: readonly PreferenceSignal[],
  registry: IngredientRegistry,
  context: PlanningContext,
  config: HardFilterConfig,
): readonly HardExclusionReason[] {
  const raw: HardExclusionReason[] = [];

  // --- 1. Allergies (Invariant 5: resolve THROUGH the registry) -----------
  for (const member of members) {
    for (const allergen of member.allergies) {
      // Declared on the recipe itself (defence in depth — data, not a tag).
      if (recipe.allergens.includes(allergen)) {
        raw.push({ kind: 'allergy', member_id: member.id, allergen, ingredient_id: null });
      }
      // Every ingredient line, optional garnishes included — an optional
      // line can never hide an allergen.
      for (const line of recipe.ingredients) {
        const entry = registry.get(line.ingredient_id);
        if (entry !== undefined && entry.allergen_classes.includes(allergen)) {
          raw.push({
            kind: 'allergy',
            member_id: member.id,
            allergen,
            ingredient_id: line.ingredient_id,
          });
        }
      }
    }
  }

  // --- Unresolvable ingredients while safety constraints exist ------------
  const hasSafetyConstraints = members.some(
    (m) => m.allergies.length > 0 || m.dietary_restrictions.length > 0,
  );
  if (hasSafetyConstraints) {
    for (const line of recipe.ingredients) {
      if (!registry.has(line.ingredient_id)) {
        raw.push({ kind: 'unverifiable_ingredient', ingredient_id: line.ingredient_id });
      }
    }
  }

  // --- 2. Dietary restrictions (household-wide ranks above member) --------
  const tagRequirers = new Map<DietaryTag, Uuid[]>();
  for (const member of members) {
    for (const tag of member.dietary_restrictions) {
      const ids = tagRequirers.get(tag) ?? [];
      ids.push(member.id);
      tagRequirers.set(tag, ids);
    }
  }
  for (const [tag, memberIds] of tagRequirers) {
    const householdWide = members.length > 0 && memberIds.length === members.length;
    // Conservative: the recipe must POSITIVELY carry the required tag.
    if (!recipe.dietary_tags.includes(tag)) {
      raw.push({
        kind: 'dietary_restriction',
        tag,
        household_wide: householdWide,
        member_ids: memberIds,
        ingredient_id: null,
        allergen: null,
      });
    }
    // ...and even a present tag is overridden by the registry: any
    // ingredient carrying a class forbidden for the tag excludes the
    // recipe. This is the data-failure case Invariant 5 exists for.
    for (const cls of FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG[tag]) {
      if (recipe.allergens.includes(cls)) {
        raw.push({
          kind: 'dietary_restriction',
          tag,
          household_wide: householdWide,
          member_ids: memberIds,
          ingredient_id: null,
          allergen: cls,
        });
      }
      for (const line of recipe.ingredients) {
        const entry = registry.get(line.ingredient_id);
        if (entry !== undefined && entry.allergen_classes.includes(cls)) {
          raw.push({
            kind: 'dietary_restriction',
            tag,
            household_wide: householdWide,
            member_ids: memberIds,
            ingredient_id: line.ingredient_id,
            allergen: cls,
          });
        }
      }
    }
  }

  // --- 3. Explicit exclusions (never_recommend ingredient set) ------------
  for (const member of members) {
    for (const line of recipe.ingredients) {
      if (member.never_recommend_ingredients.includes(line.ingredient_id)) {
        raw.push({
          kind: 'explicit_exclusion',
          member_id: member.id,
          ingredient_id: line.ingredient_id,
        });
      }
    }
  }

  // --- 4. Strong dislikes (absolute — never outweighed by anything) -------
  for (const signal of signals) {
    if (
      compare(signal.value, config.strong_dislike_value_max) <= 0 &&
      compare(signal.confidence, config.strong_dislike_confidence_min) >= 0 &&
      signalAppliesToRecipe(signal, recipe.attributes)
    ) {
      raw.push({
        kind: 'strong_dislike',
        member_id: signal.member_id,
        attribute: signal.attribute,
        attribute_value: signal.attribute_value,
      });
    }
  }

  // --- 5. Hard time ceilings (active AND total, strictly greater) ---------
  const activeCeiling = household.weeknight_active_time_ceiling_seconds;
  if (
    activeCeiling !== null &&
    compare(fromInt(recipe.active_time_seconds), fromInt(activeCeiling)) === 1
  ) {
    raw.push({
      kind: 'time_ceiling',
      which: 'active',
      ceiling_seconds: activeCeiling,
      recipe_seconds: recipe.active_time_seconds,
    });
  }
  const totalCeiling = household.weeknight_total_time_ceiling_seconds;
  if (
    totalCeiling !== null &&
    compare(fromInt(recipe.total_time_seconds), fromInt(totalCeiling)) === 1
  ) {
    raw.push({
      kind: 'time_ceiling',
      which: 'total',
      ceiling_seconds: totalCeiling,
      recipe_seconds: recipe.total_time_seconds,
    });
  }

  // --- 6. Recent repeat (hard window) --------------------------------------
  for (const meal of context.recent_meals) {
    if (meal.recipe_id === recipe.id && meal.days_ago < config.recent_repeat_min_days) {
      raw.push({
        kind: 'recent_repeat',
        days_ago: meal.days_ago,
        window_days: config.recent_repeat_min_days,
      });
    }
  }

  // Deduplicate identical reasons, then order by precedence (stable sort
  // preserves collection order within a rank).
  const seen = new Set<string>();
  const reasons: HardExclusionReason[] = [];
  for (const reason of raw) {
    const key = JSON.stringify(reason);
    if (!seen.has(key)) {
      seen.add(key);
      reasons.push(reason);
    }
  }
  reasons.sort((a, b) => exclusionPrecedenceRank(a) - exclusionPrecedenceRank(b));
  return reasons;
}
