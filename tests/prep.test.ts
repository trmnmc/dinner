/**
 * prep.test.ts — regression tests for prep-plan derivation (T-013).
 *
 * Every expected value below is computed BY HAND from the fixture's
 * authored metadata (or, for `first_safe_stopping_point`, from reading
 * `cooking.ts#nextSafeStop`'s documented stepping rule directly) — never
 * by calling `derivePrepPlan` and asserting it equals its own output. The
 * goal is to catch drift in the derivation, not to prove the code agrees
 * with itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Recipe, RecipeIngredientLine, RecipeStep } from '../domain/src/recipe.ts';
import { rational } from '../domain/src/qty.ts';
import { derivePrepPlan } from '../domain/src/prep.ts';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function line(id: string, overrides: Partial<RecipeIngredientLine> = {}): RecipeIngredientLine {
  return {
    id,
    ingredient_id: `ing-${id}`,
    display_name: `Ingredient ${id}`,
    quantity: { kind: 'exact', amount: rational(1), unit: 'count' },
    preparation: null,
    optional: false,
    ...overrides,
  };
}

function step(index: number, overrides: Partial<RecipeStep> = {}): RecipeStep {
  return {
    id: `s${String(index)}`,
    index,
    instruction: `Step ${String(index)}`,
    equipment: [],
    active_duration_seconds: 0,
    unattended_duration_seconds: 0,
    requires_continuous_attention: false,
    safe_to_pause_before: true,
    safe_to_pause_during: true,
    safe_to_pause_after: true,
    maximum_pause: { kind: 'unlimited' },
    natural_stopping_point: false,
    interruption_risk: 'low',
    recovery_instruction: { kind: 'instruction', text: `Recover step ${String(index)}.` },
    timer_duration_seconds: null,
    ...overrides,
  };
}

function baseRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-prep-1',
    slug: 'prep-fixture',
    name: 'Prep fixture',
    description: 'Fixture recipe for prep-plan derivation.',
    servings_default: 4,
    attributes: {
      protein: 'chicken',
      cuisine: 'american',
      flavour: ['savoury'],
      texture: ['tender'],
      spice: 'none',
      richness: 'medium',
      method: 'stovetop',
      effort: 'low',
    },
    dietary_tags: [],
    allergens: [],
    equipment: [],
    cost_band: 'low',
    dish_count: 2,
    total_time_seconds: 0,
    active_time_seconds: 0,
    ingredients: [],
    steps: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The four-step fixture mirrors cooking.test.ts's chop/sear/simmer/plate
// shape, so its `nextSafeStop` behaviour is independently known-correct.
// ---------------------------------------------------------------------------

const CHOP = step(0, {
  equipment: ['cutting board'],
  active_duration_seconds: 120,
  maximum_pause: { kind: 'unlimited' },
});
const SEAR = step(1, {
  equipment: ['skillet', 'tongs'],
  requires_continuous_attention: true,
  safe_to_pause_during: false,
  safe_to_pause_after: false,
  maximum_pause: { kind: 'bounded', seconds: 120 },
  interruption_risk: 'high',
  active_duration_seconds: 300,
  unattended_duration_seconds: 60,
});
const SIMMER = step(2, {
  equipment: ['skillet'],
  safe_to_pause_before: false,
  natural_stopping_point: true,
  timer_duration_seconds: 1200,
  active_duration_seconds: 30,
  unattended_duration_seconds: 1200,
  maximum_pause: { kind: 'bounded', seconds: 600 },
  recovery_instruction: { kind: 'none_available' },
});
const PLATE = step(3, {
  requires_continuous_attention: true,
  safe_to_pause_before: false,
  safe_to_pause_during: false,
  safe_to_pause_after: false,
  maximum_pause: { kind: 'bounded', seconds: 300 },
  active_duration_seconds: 240,
});

const FOUR_STEPS: readonly RecipeStep[] = [CHOP, SEAR, SIMMER, PLATE];

test('derivePrepPlan: recipe_id passes through unchanged', () => {
  const plan = derivePrepPlan(baseRecipe({ id: 'xyz-123', steps: FOUR_STEPS }));
  assert.equal(plan.recipe_id, 'xyz-123');
});

test('derivePrepPlan: ingredients split required/optional by the authored flag, order preserved', () => {
  const required1 = line('a', { optional: false, preparation: 'minced' });
  const required2 = line('b', { optional: false, preparation: null });
  const optional1 = line('c', { optional: true, preparation: 'washed' });
  const plan = derivePrepPlan(
    baseRecipe({ steps: FOUR_STEPS, ingredients: [required1, required2, optional1] }),
  );
  assert.deepEqual(plan.required_ingredients, [required1, required2]);
  assert.deepEqual(plan.optional_ingredients, [optional1]);
});

test('derivePrepPlan: do-ahead tasks are exactly the lines with a non-null preparation, in authored order', () => {
  const a = line('a', { optional: false, preparation: 'minced' });
  const b = line('b', { optional: false, preparation: null });
  const c = line('c', { optional: true, preparation: 'washed' });
  const plan = derivePrepPlan(baseRecipe({ steps: FOUR_STEPS, ingredients: [a, b, c] }));
  assert.deepEqual(plan.do_ahead_tasks, [
    { ingredient_line_id: 'a', ingredient_id: 'ing-a', display_name: 'Ingredient a', preparation: 'minced' },
    { ingredient_line_id: 'c', ingredient_id: 'ing-c', display_name: 'Ingredient c', preparation: 'washed' },
  ]);
});

test('derivePrepPlan: no ingredient carries a preparation → empty do-ahead list, not omitted', () => {
  const a = line('a', { preparation: null });
  const plan = derivePrepPlan(baseRecipe({ steps: FOUR_STEPS, ingredients: [a] }));
  assert.deepEqual(plan.do_ahead_tasks, []);
});

test('derivePrepPlan: equipment is recipe-level then per-step, deduplicated, first-seen order', () => {
  const plan = derivePrepPlan(
    baseRecipe({ steps: FOUR_STEPS, equipment: ['skillet', 'oven'] }),
  );
  // recipe-level: skillet, oven; step0: cutting board; step1: skillet(dup), tongs; step2: skillet(dup)
  assert.deepEqual(plan.equipment, ['skillet', 'oven', 'cutting board', 'tongs']);
});

test('derivePrepPlan: first non-interruptible step is the FIRST step with requires_continuous_attention', () => {
  const plan = derivePrepPlan(baseRecipe({ steps: FOUR_STEPS }));
  assert.equal(plan.first_non_interruptible_step, SEAR);
  assert.equal((plan.first_non_interruptible_step as RecipeStep).id, 's1');
});

test('derivePrepPlan: no step requires continuous attention → explicit null, never a guess', () => {
  const calm: readonly RecipeStep[] = [step(0), step(1), step(2)];
  const plan = derivePrepPlan(baseRecipe({ steps: calm }));
  assert.equal(plan.first_non_interruptible_step, null);
});

test('derivePrepPlan: first safe stopping point agrees with cooking.ts nextSafeStop at step 0 ("now": chop is safe to pause during)', () => {
  const plan = derivePrepPlan(baseRecipe({ steps: FOUR_STEPS }));
  assert.deepEqual(plan.first_safe_stopping_point, {
    kind: 'now',
    step_index: 0,
    maximum_pause: { kind: 'unlimited' },
    natural_stopping_point: false,
  });
});

test('derivePrepPlan: expected active-time blocks merge every consecutive active step (all four steps here)', () => {
  const plan = derivePrepPlan(baseRecipe({ steps: FOUR_STEPS }));
  assert.deepEqual(plan.active_time_blocks, [{ start_step_index: 0, end_step_index: 3, active_seconds: 690 }]);
  // 120 + 300 + 30 + 240 = 690, matching the fixture's active_time_seconds convention.
  assert.equal(
    plan.active_time_blocks.reduce((sum, b) => sum + b.active_seconds, 0),
    690,
  );
});

test('derivePrepPlan: an unattended step in the middle splits the recipe into two active-time blocks', () => {
  const steps: readonly RecipeStep[] = [
    step(0, { active_duration_seconds: 60 }),
    step(1, { active_duration_seconds: 0, unattended_duration_seconds: 900 }), // pure wait, no block
    step(2, { active_duration_seconds: 90 }),
    step(3, { active_duration_seconds: 45 }),
  ];
  const plan = derivePrepPlan(baseRecipe({ steps }));
  assert.deepEqual(plan.active_time_blocks, [
    { start_step_index: 0, end_step_index: 0, active_seconds: 60 },
    { start_step_index: 2, end_step_index: 3, active_seconds: 135 },
  ]);
});

// ---------------------------------------------------------------------------
// Degenerate cases — required by the acceptance contract.
// ---------------------------------------------------------------------------

test('degenerate: a recipe with zero safe stopping points anywhere → end_of_recipe, not a fabricated stop', () => {
  const unsafe = { safe_to_pause_before: false, safe_to_pause_during: false, safe_to_pause_after: false } as const;
  const steps: readonly RecipeStep[] = [step(0, unsafe), step(1, unsafe)];
  const plan = derivePrepPlan(baseRecipe({ steps }));
  assert.deepEqual(plan.first_safe_stopping_point, { kind: 'end_of_recipe' });
});

test('degenerate: a recipe that is entirely one unattended step', () => {
  const oneStep: readonly RecipeStep[] = [
    step(0, {
      active_duration_seconds: 0,
      unattended_duration_seconds: 1200,
      requires_continuous_attention: false,
      safe_to_pause_before: true,
      safe_to_pause_during: true,
      safe_to_pause_after: true,
      natural_stopping_point: true,
      maximum_pause: { kind: 'unlimited' },
      timer_duration_seconds: 1200,
      recovery_instruction: { kind: 'none_available' },
    }),
  ];
  const plan = derivePrepPlan(baseRecipe({ steps: oneStep }));
  assert.equal(plan.first_non_interruptible_step, null);
  assert.deepEqual(plan.active_time_blocks, []); // zero active time, nothing to merge
  // Safe-to-pause-during wins as "now" — but cooking.ts's "now"/"during_step"
  // branch always reports natural_stopping_point: false, regardless of the
  // step's own field (verified against cooking.ts, not assumed).
  assert.deepEqual(plan.first_safe_stopping_point, {
    kind: 'now',
    step_index: 0,
    maximum_pause: { kind: 'unlimited' },
    natural_stopping_point: false,
  });
});

test('degenerate: a zero-active-time recipe (every step is pure wait) → no active-time blocks', () => {
  const steps: readonly RecipeStep[] = [
    step(0, { active_duration_seconds: 0, unattended_duration_seconds: 300 }),
    step(1, { active_duration_seconds: 0, unattended_duration_seconds: 600 }),
    step(2, { active_duration_seconds: 0, unattended_duration_seconds: 120 }),
  ];
  const plan = derivePrepPlan(baseRecipe({ steps }));
  assert.deepEqual(plan.active_time_blocks, []);
});

test('degenerate: a recipe with zero steps at all — every derived field is the explicit "none"', () => {
  const plan = derivePrepPlan(baseRecipe({ steps: [], ingredients: [] }));
  assert.equal(plan.first_non_interruptible_step, null);
  assert.deepEqual(plan.first_safe_stopping_point, { kind: 'end_of_recipe' });
  assert.deepEqual(plan.active_time_blocks, []);
  assert.deepEqual(plan.required_ingredients, []);
  assert.deepEqual(plan.optional_ingredients, []);
  assert.deepEqual(plan.do_ahead_tasks, []);
});
