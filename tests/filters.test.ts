/**
 * filters.test.ts — proves the absolute hard filters (T-006, phase 1).
 *
 * Acceptance contract: allergies, dietary restrictions, explicit
 * exclusions, hard time ceilings and recent-repeat constraints eliminate
 * recipes ABSOLUTELY before any scoring. The tests that matter most:
 * an allergen present in an ingredient whose recipe tags/declared
 * allergens do NOT admit it is still excluded (the data-failure case —
 * Invariant 5: resolve through the registry, never trust tags), and a
 * strong dislike is excluded no matter what would have scored well.
 * Every exclusion carries typed, structured reasons in precedence order.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Allergen,
  AttributeVector,
  Household,
  HouseholdMember,
  PreferenceSignal,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
} from '../domain/src/recipe.ts';
import type { IngredientRegistry, IngredientRegistryEntry } from '../domain/src/catalog.ts';
import { ONE, rational } from '../domain/src/qty.ts';
import {
  HARD_FILTER_CONFIG,
  applyHardFilters,
  exclusionPrecedenceRank,
} from '../domain/src/filters.ts';
import type { HardExclusionReason, PlanningContext } from '../domain/src/filters.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function entry(id: string, allergens: readonly Allergen[]): IngredientRegistryEntry {
  return {
    id,
    display_name: id,
    aliases: [],
    allergen_classes: allergens,
    store_section: 'other',
    density_g_per_ml: null,
    per_item_weight_g: null,
  };
}

/** Small purpose-built registry. `soy_sauce` carrying gluten/soy/wheat is
 * the data-failure vehicle: a recipe tag can claim gluten_free while the
 * REGISTRY proves the gluten is there. */
const registry: IngredientRegistry = new Map([
  ['chicken_thigh', entry('chicken_thigh', [])],
  ['rice', entry('rice', [])],
  ['soy_sauce', entry('soy_sauce', ['gluten', 'soy', 'wheat'])],
  ['peanut_butter', entry('peanut_butter', ['peanut'])],
  ['butter', entry('butter', ['dairy'])],
  ['almond', entry('almond', ['tree_nut'])],
  ['mushroom', entry('mushroom', [])],
]);

function makeLine(id: string, ingredientId: string, optional = false): RecipeIngredientLine {
  return {
    id,
    ingredient_id: ingredientId,
    display_name: ingredientId,
    quantity: { kind: 'exact', amount: rational(100), unit: 'g' },
    preparation: null,
    optional,
  };
}

function makeStep(index: number): RecipeStep {
  return {
    id: `s${String(index + 1)}`,
    index,
    instruction: 'Cook the thing.',
    equipment: [],
    active_duration_seconds: 600,
    unattended_duration_seconds: 900,
    requires_continuous_attention: false,
    safe_to_pause_before: true,
    safe_to_pause_during: true,
    safe_to_pause_after: true,
    maximum_pause: { kind: 'unlimited' },
    natural_stopping_point: true,
    interruption_risk: 'low',
    recovery_instruction: { kind: 'none_available' },
    timer_duration_seconds: null,
  };
}

const baseAttributes: AttributeVector = {
  protein: 'chicken',
  cuisine: 'italian',
  flavour: ['savoury'],
  texture: ['tender'],
  spice: 'none',
  richness: 'medium',
  method: 'one_pot',
  effort: 'low',
};

function makeRecipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-base',
    slug: 'recipe-base',
    name: 'Base recipe',
    description: 'A fixture.',
    servings_default: 4,
    attributes: baseAttributes,
    dietary_tags: [],
    allergens: [],
    equipment: [],
    cost_band: 'low',
    dish_count: 2,
    total_time_seconds: 1500,
    active_time_seconds: 600,
    ingredients: [makeLine('l1', 'chicken_thigh'), makeLine('l2', 'rice')],
    steps: [makeStep(0)],
    ...over,
  };
}

function makeHousehold(over: Partial<Household> = {}): Household {
  return {
    id: 'household-1',
    name: 'Test household',
    household_size: 2,
    novelty_preference: 'mostly_familiar',
    weeknight_active_time_ceiling_seconds: null,
    weeknight_total_time_ceiling_seconds: null,
    created_at_utc: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function makeMember(over: Partial<HouseholdMember> = {}): HouseholdMember {
  return {
    id: 'member-1',
    household_id: 'household-1',
    display_name: 'Alex',
    is_primary: true,
    dietary_restrictions: [],
    allergies: [],
    never_recommend_ingredients: [],
    created_at_utc: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function makeSignal(over: Partial<PreferenceSignal> = {}): PreferenceSignal {
  return {
    id: 'signal-1',
    household_id: 'household-1',
    member_id: null,
    attribute: 'protein',
    attribute_value: 'chicken',
    value: rational(-1),
    confidence: ONE,
    durability: 'durable',
    source: 'calibration',
    updated_at_utc: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

const emptyContext: PlanningContext = { recent_meals: [] };

function run(
  recipes: readonly Recipe[],
  over: {
    household?: Household;
    members?: readonly HouseholdMember[];
    signals?: readonly PreferenceSignal[];
    context?: PlanningContext;
  } = {},
) {
  return applyHardFilters(
    recipes,
    over.household ?? makeHousehold(),
    over.members ?? [makeMember()],
    over.signals ?? [],
    registry,
    over.context ?? emptyContext,
  );
}

function kinds(reasons: readonly HardExclusionReason[]): readonly string[] {
  return reasons.map((r) => r.kind);
}

// ---------------------------------------------------------------------------
// No constraints → nothing excluded
// ---------------------------------------------------------------------------

test('an unconstrained household excludes nothing', () => {
  const result = run([makeRecipe(), makeRecipe({ id: 'recipe-2', slug: 'recipe-2' })]);
  assert.equal(result.survivors.length, 2);
  assert.deepEqual(result.exclusions, []);
});

// ---------------------------------------------------------------------------
// Allergies — resolved through the REGISTRY, never trusted from tags
// ---------------------------------------------------------------------------

test('THE data-failure case: an allergen carried via the registry is excluded even when the tag denies it', () => {
  // The recipe's own data LIES: it claims gluten_free and declares no
  // allergens — but soy_sauce carries gluten in the registry. A filter
  // that reads tags would pass this recipe to a gluten-allergic member.
  const lying = makeRecipe({
    dietary_tags: ['gluten_free'],
    allergens: [],
    ingredients: [makeLine('l1', 'chicken_thigh'), makeLine('l2', 'soy_sauce')],
  });
  // Preconditions that make the test meaningful: the tag claims safety.
  assert.ok(lying.dietary_tags.includes('gluten_free'));
  assert.deepEqual(lying.allergens, []);

  const member = makeMember({ allergies: ['gluten'] });
  const result = run([lying], { members: [member] });
  assert.deepEqual(result.survivors, []);
  assert.equal(result.exclusions.length, 1);
  const exclusion = result.exclusions[0];
  const hit = exclusion.reasons.find((r) => r.kind === 'allergy');
  assert.ok(hit !== undefined, `expected an allergy reason, got ${JSON.stringify(exclusion.reasons)}`);
  assert.equal(hit.allergen, 'gluten');
  assert.equal(hit.ingredient_id, 'soy_sauce');
  assert.equal(hit.member_id, 'member-1');
});

test('an allergen declared on the recipe excludes even without a carrying ingredient', () => {
  const recipe = makeRecipe({ allergens: ['sesame'] });
  const result = run([recipe], { members: [makeMember({ allergies: ['sesame'] })] });
  assert.equal(result.survivors.length, 0);
  const hit = result.exclusions[0].reasons.find((r) => r.kind === 'allergy');
  assert.ok(hit !== undefined);
  assert.equal(hit.allergen, 'sesame');
  assert.equal(hit.ingredient_id, null);
});

test('an OPTIONAL garnish cannot hide an allergen', () => {
  const recipe = makeRecipe({
    ingredients: [makeLine('l1', 'rice'), makeLine('l2', 'almond', true)],
  });
  const result = run([recipe], { members: [makeMember({ allergies: ['tree_nut'] })] });
  assert.equal(result.survivors.length, 0);
  const hit = result.exclusions[0].reasons.find((r) => r.kind === 'allergy');
  assert.ok(hit !== undefined);
  assert.equal(hit.ingredient_id, 'almond');
});

test('an unresolvable ingredient is excluded when safety constraints exist, tolerated when none do', () => {
  const recipe = makeRecipe({ ingredients: [makeLine('l1', 'mystery_goo')] });
  const constrained = run([recipe], { members: [makeMember({ allergies: ['peanut'] })] });
  assert.equal(constrained.survivors.length, 0);
  const hit = constrained.exclusions[0].reasons.find((r) => r.kind === 'unverifiable_ingredient');
  assert.ok(hit !== undefined);
  assert.equal(hit.ingredient_id, 'mystery_goo');

  const unconstrained = run([recipe]);
  assert.equal(unconstrained.survivors.length, 1);
});

// ---------------------------------------------------------------------------
// Dietary restrictions
// ---------------------------------------------------------------------------

test('a required dietary tag missing from the recipe excludes it', () => {
  const result = run([makeRecipe()], {
    members: [makeMember({ dietary_restrictions: ['vegetarian'] })],
  });
  assert.equal(result.survivors.length, 0);
  const hit = result.exclusions[0].reasons.find((r) => r.kind === 'dietary_restriction');
  assert.ok(hit !== undefined);
  assert.equal(hit.tag, 'vegetarian');
  assert.equal(hit.ingredient_id, null);
  assert.deepEqual(hit.member_ids, ['member-1']);
});

test('dietary data-failure: a present tag is overridden by a forbidden class in the registry', () => {
  const lying = makeRecipe({
    dietary_tags: ['gluten_free'],
    allergens: [],
    ingredients: [makeLine('l1', 'rice'), makeLine('l2', 'soy_sauce')],
  });
  const result = run([lying], {
    members: [makeMember({ dietary_restrictions: ['gluten_free'] })],
  });
  assert.equal(result.survivors.length, 0);
  const hit = result.exclusions[0].reasons.find(
    (r) => r.kind === 'dietary_restriction' && r.ingredient_id === 'soy_sauce',
  );
  assert.ok(hit !== undefined, `expected soy_sauce named, got ${JSON.stringify(result.exclusions[0].reasons)}`);
  assert.ok(hit.kind === 'dietary_restriction');
  assert.equal(hit.tag, 'gluten_free');
  assert.equal(hit.allergen, 'gluten');
});

test('a restriction shared by every member is household-wide and ranks above a member-only one', () => {
  const a = makeMember({ id: 'member-a', dietary_restrictions: ['vegetarian'] });
  const b = makeMember({ id: 'member-b', dietary_restrictions: ['vegetarian', 'dairy_free'] });
  const result = run([makeRecipe()], { members: [a, b] });
  assert.equal(result.survivors.length, 0);
  const reasons = result.exclusions[0].reasons;
  const vege = reasons.find((r) => r.kind === 'dietary_restriction' && r.tag === 'vegetarian');
  const dairy = reasons.find((r) => r.kind === 'dietary_restriction' && r.tag === 'dairy_free');
  assert.ok(vege !== undefined && vege.kind === 'dietary_restriction');
  assert.ok(dairy !== undefined && dairy.kind === 'dietary_restriction');
  assert.equal(vege.household_wide, true);
  assert.equal(dairy.household_wide, false);
  assert.ok(exclusionPrecedenceRank(vege) < exclusionPrecedenceRank(dairy));
  // Precedence-ordered output: household-wide comes first.
  assert.ok(reasons.indexOf(vege) < reasons.indexOf(dairy));
});

// ---------------------------------------------------------------------------
// Explicit exclusions (calibration "never_recommend" ingredient set)
// ---------------------------------------------------------------------------

test('a never-recommend ingredient excludes the recipe and names the ingredient', () => {
  const recipe = makeRecipe({ ingredients: [makeLine('l1', 'rice'), makeLine('l2', 'mushroom')] });
  const result = run([recipe], {
    members: [makeMember({ never_recommend_ingredients: ['mushroom'] })],
  });
  assert.equal(result.survivors.length, 0);
  const hit = result.exclusions[0].reasons.find((r) => r.kind === 'explicit_exclusion');
  assert.ok(hit !== undefined);
  assert.equal(hit.ingredient_id, 'mushroom');
  assert.equal(hit.member_id, 'member-1');
});

// ---------------------------------------------------------------------------
// Strong dislikes — absolute, structurally prior to any optimisation
// ---------------------------------------------------------------------------

test('a strong dislike excludes absolutely and names the attribute', () => {
  const result = run([makeRecipe()], {
    signals: [makeSignal({ value: rational(-1), confidence: ONE })],
  });
  assert.equal(result.survivors.length, 0);
  const hit = result.exclusions[0].reasons.find((r) => r.kind === 'strong_dislike');
  assert.ok(hit !== undefined);
  assert.equal(hit.attribute, 'protein');
  assert.equal(hit.attribute_value, 'chicken');
});

test('weak or low-confidence dislikes are NOT hard exclusions (they are scoring inputs)', () => {
  // Value above the strong-dislike threshold (−4/5): survives.
  const weak = run([makeRecipe()], {
    signals: [makeSignal({ value: rational(-1, 2), confidence: ONE })],
  });
  assert.equal(weak.survivors.length, 1);
  // Strong value but below the confidence floor (1/2): survives.
  const unsure = run([makeRecipe()], {
    signals: [makeSignal({ value: rational(-1), confidence: rational(1, 4) })],
  });
  assert.equal(unsure.survivors.length, 1);
  // Exactly at both thresholds: excluded (≤ value, ≥ confidence).
  const atThreshold = run([makeRecipe()], {
    signals: [makeSignal({ value: HARD_FILTER_CONFIG.strong_dislike_value_max, confidence: HARD_FILTER_CONFIG.strong_dislike_confidence_min })],
  });
  assert.equal(atThreshold.survivors.length, 0);
});

test('a strong dislike on a non-matching attribute value does not exclude', () => {
  const result = run([makeRecipe()], {
    signals: [makeSignal({ attribute: 'protein', attribute_value: 'shellfish' })],
  });
  assert.equal(result.survivors.length, 1);
});

// ---------------------------------------------------------------------------
// Hard time ceilings — active AND total, strictly greater excludes
// ---------------------------------------------------------------------------

test('active-time ceiling: strictly over is excluded, exactly at survives', () => {
  const over = run([makeRecipe()], {
    household: makeHousehold({ weeknight_active_time_ceiling_seconds: 599 }),
  });
  assert.equal(over.survivors.length, 0);
  const hit = over.exclusions[0].reasons.find((r) => r.kind === 'time_ceiling');
  assert.ok(hit !== undefined);
  assert.equal(hit.which, 'active');
  assert.equal(hit.ceiling_seconds, 599);
  assert.equal(hit.recipe_seconds, 600);

  const at = run([makeRecipe()], {
    household: makeHousehold({ weeknight_active_time_ceiling_seconds: 600 }),
  });
  assert.equal(at.survivors.length, 1);
});

test('total-time ceiling: strictly over is excluded, exactly at survives', () => {
  const over = run([makeRecipe()], {
    household: makeHousehold({ weeknight_total_time_ceiling_seconds: 1499 }),
  });
  assert.equal(over.survivors.length, 0);
  const hit = over.exclusions[0].reasons.find((r) => r.kind === 'time_ceiling');
  assert.ok(hit !== undefined);
  assert.equal(hit.which, 'total');

  const at = run([makeRecipe()], {
    household: makeHousehold({ weeknight_total_time_ceiling_seconds: 1500 }),
  });
  assert.equal(at.survivors.length, 1);
});

// ---------------------------------------------------------------------------
// Recent repeats — hard window
// ---------------------------------------------------------------------------

test('a recipe cooked inside the hard repeat window is excluded; at the boundary it survives', () => {
  const recipe = makeRecipe();
  const inside = run([recipe], {
    context: { recent_meals: [{ recipe_id: recipe.id, attributes: baseAttributes, days_ago: 3 }] },
  });
  assert.equal(inside.survivors.length, 0);
  const hit = inside.exclusions[0].reasons.find((r) => r.kind === 'recent_repeat');
  assert.ok(hit !== undefined);
  assert.equal(hit.days_ago, 3);
  assert.equal(hit.window_days, HARD_FILTER_CONFIG.recent_repeat_min_days);

  const boundary = run([recipe], {
    context: {
      recent_meals: [
        {
          recipe_id: recipe.id,
          attributes: baseAttributes,
          days_ago: HARD_FILTER_CONFIG.recent_repeat_min_days,
        },
      ],
    },
  });
  assert.equal(boundary.survivors.length, 1);
});

test('a DIFFERENT recently cooked recipe does not hard-exclude', () => {
  const result = run([makeRecipe()], {
    context: { recent_meals: [{ recipe_id: 'other-recipe', attributes: baseAttributes, days_ago: 0 }] },
  });
  assert.equal(result.survivors.length, 1);
});

// ---------------------------------------------------------------------------
// Precedence ordering + structure of reasons
// ---------------------------------------------------------------------------

test('reasons are precedence-ordered: allergy first, then exclusion, dislike, ceiling, repeat', () => {
  const recipe = makeRecipe({
    ingredients: [makeLine('l1', 'peanut_butter')],
    active_time_seconds: 600,
  });
  const result = run([recipe], {
    household: makeHousehold({ weeknight_active_time_ceiling_seconds: 300 }),
    members: [
      makeMember({ allergies: ['peanut'], never_recommend_ingredients: ['peanut_butter'] }),
    ],
    signals: [makeSignal()],
    context: { recent_meals: [{ recipe_id: recipe.id, attributes: baseAttributes, days_ago: 1 }] },
  });
  assert.equal(result.survivors.length, 0);
  const reasons = result.exclusions[0].reasons;
  assert.equal(reasons[0].kind, 'allergy');
  const seen = kinds(reasons);
  for (const expected of ['allergy', 'explicit_exclusion', 'strong_dislike', 'time_ceiling', 'recent_repeat']) {
    assert.ok(seen.includes(expected), `missing reason kind ${expected}`);
  }
  // Non-decreasing precedence ranks throughout.
  for (let i = 1; i < reasons.length; i += 1) {
    assert.ok(exclusionPrecedenceRank(reasons[i - 1]) <= exclusionPrecedenceRank(reasons[i]));
  }
});

test('every exclusion is typed and structured — never a bare boolean', () => {
  const result = run([makeRecipe()], { members: [makeMember({ allergies: ['gluten'] })], signals: [makeSignal()] });
  // gluten allergy does not match this recipe — only the dislike bites.
  assert.equal(result.exclusions.length, 1);
  for (const exclusion of result.exclusions) {
    assert.ok(exclusion.reasons.length >= 1);
    for (const reason of exclusion.reasons) {
      assert.equal(typeof reason.kind, 'string');
      assert.ok(reason.kind.length > 0);
    }
  }
});

// ---------------------------------------------------------------------------
// Partition + determinism
// ---------------------------------------------------------------------------

test('survivors and exclusions partition the input in order', () => {
  const good = makeRecipe({ id: 'good', slug: 'good' });
  const bad = makeRecipe({
    id: 'bad',
    slug: 'bad',
    ingredients: [makeLine('l1', 'butter')],
  });
  const good2 = makeRecipe({ id: 'good-2', slug: 'good-2' });
  const result = run([good, bad, good2], { members: [makeMember({ allergies: ['dairy'] })] });
  assert.deepEqual(result.survivors.map((r) => r.id), ['good', 'good-2']);
  assert.deepEqual(result.exclusions.map((e) => e.recipe_id), ['bad']);
});

test('filtering is deterministic: identical inputs, identical structured output', () => {
  const recipes = [
    makeRecipe(),
    makeRecipe({ id: 'r2', slug: 'r2', ingredients: [makeLine('l1', 'soy_sauce')] }),
  ];
  const args = {
    members: [makeMember({ allergies: ['soy'], dietary_restrictions: ['nut_free'] })],
    signals: [makeSignal({ value: rational(-9, 10) })],
    context: {
      recent_meals: [{ recipe_id: 'recipe-base', attributes: baseAttributes, days_ago: 2 }],
    },
  };
  assert.deepEqual(run(recipes, args), run(recipes, args));
});
