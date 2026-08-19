/**
 * swap.test.ts — the frozen-context swap (T-007, Invariant 4).
 *
 * Pinned against hand-computed literal values, never read back from the
 * engine. The two core claims under test:
 *
 * 1. Each of the NINE swap reasons moves the ranking the way its name
 *    promises — eligibility is strict relative to the outgoing meal (a
 *    "faster" alternative IS strictly faster than it) and the reason-fit
 *    term orders the eligible candidates in the promised direction.
 * 2. The two untouched meals are provably unchanged (same object identity
 *    AND deep-equal to a pre-swap snapshot), the ranking context is the
 *    frozen pair only (the outgoing meal's ingredients count for
 *    nothing), and `swap.ts` never touches `planset` — asserted
 *    structurally against the module source.
 *
 * Plus: at most three alternatives, typed zero-alternative outcomes with
 * honest counts, determinism under identical and shuffled input, and
 * facts renderable by reasons.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type {
  AttributeVector,
  InventoryEntry,
  PreferenceSignal,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
  ScoreBreakdown,
  ScoreComponent,
  SwapReason,
} from '../domain/src/recipe.ts';
import type { Rational } from '../domain/src/qty.ts';
import { ONE, ZERO, add, compare, eq, mul, rational } from '../domain/src/qty.ts';
import type { PlanningContext } from '../domain/src/filters.ts';
import {
  SWAP_CONFIG,
  SWAP_RANK_TERM_NAMES,
  containsPasta,
  familiarityOf,
  ownedIngredientFraction,
  swapMeal,
} from '../domain/src/swap.ts';
import type { SwapMealInput, SwapRequest, SwapResult } from '../domain/src/swap.ts';
import { renderMealReasons } from '../domain/src/reasons.ts';

// ---------------------------------------------------------------------------
// Fixtures (same conventions as score.test.ts / planset.test.ts)
// ---------------------------------------------------------------------------

function makeLine(ingredientId: string, optional = false): RecipeIngredientLine {
  return {
    id: `l-${ingredientId}`,
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
    total_time_seconds: 1800,
    active_time_seconds: 1200,
    ingredients: [makeLine('chicken_thigh'), makeLine('rice')],
    steps: [makeStep(0)],
    ...over,
  };
}

/** A structurally complete breakdown; swap consumes only `total`. */
function makeScore(recipeId: string, total: Rational): ScoreBreakdown {
  const zero: ScoreComponent = { weight: ZERO, raw: ZERO, weighted: ZERO };
  return {
    recipe_id: recipeId,
    components: {
      preference: zero,
      context_interruption: zero,
      inventory_use: zero,
      cost: zero,
      novelty: zero,
      leftover_usefulness: zero,
    },
    penalties: {
      recent_repeat: ZERO,
      repeated_cuisine: ZERO,
      repeated_format: ZERO,
      excessive_active_time: ZERO,
      dish_count: ZERO,
      likely_waste: ZERO,
    },
    total,
  };
}

function makeMeal(id: string, over: Partial<Recipe> = {}, total: Rational = rational(1, 2)): SwapMealInput {
  return { recipe: makeRecipe({ id, slug: id, name: id, ...over }), score: makeScore(id, total) };
}

function makeSignal(over: Partial<PreferenceSignal> = {}): PreferenceSignal {
  return {
    id: 'signal-1',
    household_id: 'household-1',
    member_id: null,
    attribute: 'protein',
    attribute_value: 'chicken',
    value: ONE,
    confidence: ONE,
    durability: 'durable',
    source: 'feedback',
    updated_at_utc: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

function makeInventoryEntry(ingredientId: string, over: Partial<InventoryEntry> = {}): InventoryEntry {
  return {
    id: `inv-${ingredientId}`,
    household_id: 'household-1',
    ingredient_id: ingredientId,
    quantity: rational(500),
    unit: 'g',
    confidence: 'confirmed',
    source: 'purchase_confirmed',
    best_by_utc: null,
    updated_at_utc: '2026-08-10T00:00:00.000Z',
    ...over,
  };
}

const emptyContext: PlanningContext = { recent_meals: [] };

// The current plan. Slot 0 is the default swap target: chicken, italian,
// 2400 s total / 1800 s active, 4 dishes, medium cost, score 1/2.
const meal0 = makeMeal('plan-0', {
  name: 'Herbed chicken skillet',
  total_time_seconds: 2400,
  active_time_seconds: 1800,
  dish_count: 4,
  cost_band: 'medium',
  ingredients: [makeLine('chicken_thigh'), makeLine('breadcrumbs')],
});
const meal1 = makeMeal('plan-1', {
  name: 'Beef tacos',
  attributes: { ...baseAttributes, protein: 'beef', cuisine: 'mexican' },
  ingredients: [makeLine('beef'), makeLine('onion'), makeLine('garlic')],
});
const meal2 = makeMeal('plan-2', {
  name: 'Thai fish curry',
  attributes: { ...baseAttributes, protein: 'fish', cuisine: 'thai' },
  ingredients: [makeLine('fish'), makeLine('coconut_milk'), makeLine('garlic')],
});

function makeRequest(over: Partial<SwapRequest> = {}): SwapRequest {
  return {
    meals: [meal0, meal1, meal2],
    swap_slot: 0,
    reason: 'faster',
    candidates: [],
    signals: [],
    inventory: [],
    context: emptyContext,
    ...over,
  };
}

/** A candidate with a unique ingredient, so frozen-context overlap is 0
 * unless a test deliberately shares ingredients. */
function makeCandidate(id: string, over: Partial<Recipe> = {}, total: Rational = rational(1, 2)): SwapMealInput {
  return makeMeal(id, { ingredients: [makeLine(`ing-${id}`)], ...over }, total);
}

function expectAlternatives(result: SwapResult): Extract<SwapResult, { kind: 'alternatives' }> {
  assert.equal(result.kind, 'alternatives');
  if (result.kind !== 'alternatives') throw new Error('unreachable');
  return result;
}

function expectNone(result: SwapResult): Extract<SwapResult, { kind: 'no_alternatives' }> {
  assert.equal(result.kind, 'no_alternatives');
  if (result.kind !== 'no_alternatives') throw new Error('unreachable');
  return result;
}

function altIds(result: SwapResult): readonly string[] {
  return expectAlternatives(result).alternatives.map((a) => a.recipe.id);
}

// ---------------------------------------------------------------------------
// 0. Structural Invariant 4: swap.ts does not even import planset
// ---------------------------------------------------------------------------

test('swap.ts never imports planset — re-running the set pass is structurally impossible', () => {
  const source = readFileSync(new URL('../domain/src/swap.ts', import.meta.url), 'utf8');
  // Every module specifier swap.ts imports from, static or dynamic.
  const specifiers = [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(
    (m) => m[1] as string,
  );
  assert.ok(specifiers.length > 0, 'expected to find import specifiers in swap.ts');
  for (const spec of specifiers) {
    assert.ok(!spec.includes('planset'), `swap.ts must not import planset (found ${spec})`);
    assert.ok(!spec.includes('score'), `swap.ts must not import score.ts (found ${spec})`);
  }
});

// ---------------------------------------------------------------------------
// 1. Config sanity
// ---------------------------------------------------------------------------

test('the five rank weights sum to exactly one, and reason_fit strictly dominates', () => {
  let total = ZERO;
  for (const name of SWAP_RANK_TERM_NAMES) total = add(total, SWAP_CONFIG.rank_weights[name]);
  assert.ok(eq(total, ONE), `weights sum to ${total.num.toString()}/${total.den.toString()}, not 1`);
  for (const name of SWAP_RANK_TERM_NAMES) {
    if (name === 'reason_fit') continue;
    assert.equal(
      compare(SWAP_CONFIG.rank_weights.reason_fit, SWAP_CONFIG.rank_weights[name]),
      1,
      `reason_fit must outweigh ${name} so the reason measurably reorders candidates`,
    );
  }
  assert.equal(SWAP_CONFIG.max_alternatives, 3);
});

// ---------------------------------------------------------------------------
// 2. The nine reasons — each moves the ranking as its name promises
// ---------------------------------------------------------------------------

test('faster: only strictly-faster candidates, ordered quickest first, at most three', () => {
  const result = swapMeal(
    makeRequest({
      reason: 'faster',
      candidates: [
        makeCandidate('cand-f-a', { total_time_seconds: 1800, active_time_seconds: 600 }),
        makeCandidate('cand-f-b', { total_time_seconds: 900, active_time_seconds: 600 }),
        makeCandidate('cand-f-c', { total_time_seconds: 1200, active_time_seconds: 600 }),
        makeCandidate('cand-f-d', { total_time_seconds: 3000, active_time_seconds: 600 }), // slower — out
        makeCandidate('cand-f-e', { total_time_seconds: 1500, active_time_seconds: 600 }),
      ],
    }),
  );
  // Four candidates are strictly faster than the outgoing 2400 s; ranked
  // by total time ascending; only three returned.
  assert.deepEqual(altIds(result), ['cand-f-b', 'cand-f-c', 'cand-f-e']);
  const r = expectAlternatives(result);
  assert.deepEqual(r.counts, {
    pool_size: 5,
    already_in_plan: 0,
    ineligible_for_reason: 1,
    eligible: 4,
  });
  for (const alt of r.alternatives) {
    assert.ok(alt.recipe.total_time_seconds < meal0.recipe.total_time_seconds, 'a "faster" alternative must BE faster');
  }
  // Hand-computed rank for the best (900 s total, score 1/2, no shared
  // ingredients, protein+cuisine both new to the frozen pair):
  //   60%·(1 − 900/5400) + 20%·(1/2) + 10%·0 + 5%·1 + 5%·1
  //   = 1/2 + 1/10 + 1/20 + 1/20 = 7/10.
  assert.ok(eq(r.alternatives[0].rank.total, rational(7, 10)));
  assert.deepEqual(r.alternatives[0].facts[0], {
    code: 'quick_total_time',
    total_seconds: 900,
    active_seconds: 600,
  });
});

test('less_hands_on: only strictly less active time, ordered least hands-on first', () => {
  const result = swapMeal(
    makeRequest({
      reason: 'less_hands_on',
      candidates: [
        makeCandidate('cand-lh-a', { total_time_seconds: 1800, active_time_seconds: 300 }),
        makeCandidate('cand-lh-b', { total_time_seconds: 1800, active_time_seconds: 600 }),
        makeCandidate('cand-lh-c', { total_time_seconds: 1800, active_time_seconds: 900 }),
        makeCandidate('cand-lh-d', { total_time_seconds: 2400, active_time_seconds: 1800 }), // equal — out
        makeCandidate('cand-lh-e', { total_time_seconds: 2700, active_time_seconds: 2400 }), // more — out
      ],
    }),
  );
  assert.deepEqual(altIds(result), ['cand-lh-a', 'cand-lh-b', 'cand-lh-c']);
  const r = expectAlternatives(result);
  for (const alt of r.alternatives) {
    assert.ok(alt.recipe.active_time_seconds < meal0.recipe.active_time_seconds);
  }
  assert.deepEqual(r.alternatives[0].facts[0], {
    code: 'low_active_time',
    total_seconds: 1800,
    active_seconds: 300,
  });
});

test('fewer_dishes: only strictly fewer dishes, ordered fewest first', () => {
  const result = swapMeal(
    makeRequest({
      reason: 'fewer_dishes',
      candidates: [
        makeCandidate('cand-fd-a', { dish_count: 3 }),
        makeCandidate('cand-fd-b', { dish_count: 1 }),
        makeCandidate('cand-fd-c', { dish_count: 2 }),
        makeCandidate('cand-fd-d', { dish_count: 4 }), // equal — out
        makeCandidate('cand-fd-e', { dish_count: 6 }), // more — out
      ],
    }),
  );
  assert.deepEqual(altIds(result), ['cand-fd-b', 'cand-fd-c', 'cand-fd-a']);
  const r = expectAlternatives(result);
  for (const alt of r.alternatives) assert.ok(alt.recipe.dish_count < meal0.recipe.dish_count);
  assert.deepEqual(r.alternatives[0].facts[0], { code: 'few_dishes', dish_count: 1 });
});

test('cheaper: only a strictly cheaper cost band qualifies', () => {
  const result = swapMeal(
    makeRequest({
      reason: 'cheaper',
      candidates: [
        makeCandidate('cand-chp-weak', { cost_band: 'low' }, rational(1, 4)),
        makeCandidate('cand-chp-strong', { cost_band: 'low' }, rational(3, 4)),
        makeCandidate('cand-chp-med', { cost_band: 'medium' }), // same band — out
        makeCandidate('cand-chp-high', { cost_band: 'high' }), // pricier — out
      ],
    }),
  );
  // Both lows share reason fit 1; the individual score breaks the order.
  assert.deepEqual(altIds(result), ['cand-chp-strong', 'cand-chp-weak']);
  const r = expectAlternatives(result);
  for (const alt of r.alternatives) assert.equal(alt.recipe.cost_band, 'low');
  assert.equal(r.counts.ineligible_for_reason, 2);
  assert.deepEqual(r.alternatives[0].facts[0], {
    code: 'budget_friendly',
    cost_band: 'low',
    ingredient_count: 1,
  });
});

test('more_familiar: only strictly more familiar candidates, most familiar first', () => {
  const signals = [
    makeSignal({ id: 'sg-1', attribute: 'protein', attribute_value: 'chicken' }),
    makeSignal({ id: 'sg-2', attribute: 'cuisine', attribute_value: 'italian' }),
    makeSignal({ id: 'sg-3', attribute: 'flavour', attribute_value: 'spicy' }),
    makeSignal({ id: 'sg-4', attribute: 'texture', attribute_value: 'crispy' }),
  ];
  // Outgoing meal anchors protein + cuisine → familiarity 2/8.
  assert.ok(eq(familiarityOf(meal0.recipe.attributes, signals, emptyContext), rational(2, 8)));
  const result = swapMeal(
    makeRequest({
      reason: 'more_familiar',
      signals,
      candidates: [
        makeCandidate('cand-mf-a', { attributes: { ...baseAttributes, flavour: ['spicy'] } }), // 3/8
        makeCandidate('cand-mf-d', { attributes: { ...baseAttributes, flavour: ['spicy'], texture: ['crispy'] } }), // 4/8
        makeCandidate('cand-mf-b', { attributes: { ...baseAttributes, cuisine: 'korean', flavour: ['spicy'] } }), // 2/8 = current — out
        makeCandidate('cand-mf-c', { attributes: { ...baseAttributes, protein: 'tofu', cuisine: 'vietnamese', flavour: ['mild'] } }), // 0 — out
      ],
    }),
  );
  assert.deepEqual(altIds(result), ['cand-mf-d', 'cand-mf-a']);
  const r = expectAlternatives(result);
  for (const alt of r.alternatives) {
    assert.equal(
      compare(
        familiarityOf(alt.recipe.attributes, signals, emptyContext),
        familiarityOf(meal0.recipe.attributes, signals, emptyContext),
      ),
      1,
      'a "more familiar" alternative must BE more familiar than the outgoing meal',
    );
  }
  // Four positive signals apply to cand-mf-d (all confidence 1); the
  // deterministic pick is the alphabetically-first attribute: cuisine.
  assert.deepEqual(r.alternatives[0].facts[0], {
    code: 'matches_taste',
    attribute: 'cuisine',
    attribute_value: 'italian',
    signal_count: 4,
  });
});

test('more_adventurous: only strictly less familiar candidates, least familiar first', () => {
  const signals = [
    makeSignal({ id: 'sg-1', attribute: 'protein', attribute_value: 'chicken' }),
    makeSignal({ id: 'sg-2', attribute: 'cuisine', attribute_value: 'italian' }),
  ];
  const result = swapMeal(
    makeRequest({
      reason: 'more_adventurous',
      signals,
      candidates: [
        makeCandidate('cand-ma-a', { attributes: { ...baseAttributes, protein: 'tofu', cuisine: 'vietnamese' } }), // 0/8
        makeCandidate('cand-ma-b', { attributes: { ...baseAttributes, cuisine: 'vietnamese' } }), // 1/8
        makeCandidate('cand-ma-c', {}), // chicken italian, 2/8 = current — out
      ],
    }),
  );
  assert.deepEqual(altIds(result), ['cand-ma-a', 'cand-ma-b']);
  const r = expectAlternatives(result);
  for (const alt of r.alternatives) {
    assert.equal(
      compare(
        familiarityOf(alt.recipe.attributes, signals, emptyContext),
        familiarityOf(meal0.recipe.attributes, signals, emptyContext),
      ),
      -1,
    );
  }
  // cand-ma-b keeps the chicken anchor and tries vietnamese — the
  // adjacent-novelty fact says exactly that.
  assert.deepEqual(r.alternatives[1].facts[0], {
    code: 'adjacent_novelty',
    familiar_attribute: 'protein',
    familiar_value: 'chicken',
    new_attribute: 'cuisine',
    new_value: 'vietnamese',
  });
});

test('no_pasta: pasta by ingredient id, ingredient display name or recipe name is excluded', () => {
  const withPenne = makeCandidate('cand-np-a', { ingredients: [makeLine('penne')] });
  const withNoodles = makeCandidate('cand-np-b', {
    ingredients: [
      {
        id: 'l-sheets',
        ingredient_id: 'fresh_sheets',
        display_name: 'egg noodles',
        quantity: { kind: 'exact', amount: rational(100), unit: 'g' },
        preparation: null,
        optional: false,
      },
    ],
  });
  const namedPasta = makeCandidate('cand-np-c', { name: 'Pasta night bake', ingredients: [makeLine('rice')] });
  const pastaFree = makeCandidate('cand-np-d', { name: 'Rice and beans', ingredients: [makeLine('rice'), makeLine('black_beans')] });
  assert.equal(containsPasta(withPenne.recipe), true);
  assert.equal(containsPasta(withNoodles.recipe), true);
  assert.equal(containsPasta(namedPasta.recipe), true);
  assert.equal(containsPasta(pastaFree.recipe), false);

  const result = swapMeal(
    makeRequest({ reason: 'no_pasta', candidates: [withPenne, withNoodles, namedPasta, pastaFree] }),
  );
  assert.deepEqual(altIds(result), ['cand-np-d']);
  assert.equal(expectAlternatives(result).counts.ineligible_for_reason, 3);
});

test('different_protein: same-protein candidates are excluded, and the frozen pair pulls the ranking', () => {
  const result = swapMeal(
    makeRequest({
      reason: 'different_protein',
      candidates: [
        makeCandidate('cand-dp-a', {}), // chicken, same as outgoing — out
        makeCandidate('cand-dp-b', { attributes: { ...baseAttributes, protein: 'beef' } }),
        makeCandidate('cand-dp-c', { attributes: { ...baseAttributes, protein: 'tofu' } }),
      ],
    }),
  );
  // Both differ from the outgoing chicken, but the frozen pair already
  // has beef (Beef tacos): tofu wins the protein-diversity term.
  assert.deepEqual(altIds(result), ['cand-dp-c', 'cand-dp-b']);
  const r = expectAlternatives(result);
  for (const alt of r.alternatives) {
    assert.notEqual(alt.recipe.attributes.protein, meal0.recipe.attributes.protein);
  }
});

test('use_what_i_have: only strictly better inventory use; inferred inventory is never trusted', () => {
  const inventory = [
    makeInventoryEntry('garlic'),
    makeInventoryEntry('rice', { confidence: 'assumed_staple' }),
    makeInventoryEntry('onion', { confidence: 'inferred' }), // never usable
  ];
  // The outgoing meal owns none of its ingredients.
  assert.ok(eq(ownedIngredientFraction(meal0.recipe, inventory), ZERO));
  const onlyInferred = makeCandidate('cand-uw-c', { ingredients: [makeLine('onion')] });
  assert.ok(eq(ownedIngredientFraction(onlyInferred.recipe, inventory), ZERO));

  const result = swapMeal(
    makeRequest({
      reason: 'use_what_i_have',
      inventory,
      candidates: [
        makeCandidate('cand-uw-b', { ingredients: [makeLine('garlic'), makeLine('carrot')] }), // 1/2
        makeCandidate('cand-uw-a', { ingredients: [makeLine('garlic'), makeLine('rice')] }), // 1
        onlyInferred, // 0 — out
        makeCandidate('cand-uw-d', { ingredients: [makeLine('garlic', true), makeLine('carrot')] }), // optional ignored → 0 — out
      ],
    }),
  );
  assert.deepEqual(altIds(result), ['cand-uw-a', 'cand-uw-b']);
  const r = expectAlternatives(result);
  assert.deepEqual(r.alternatives[0].facts[0], {
    code: 'uses_owned_ingredients',
    owned_count: 2,
    total_count: 2,
  });
});

// ---------------------------------------------------------------------------
// 3. The frozen-context proof — Invariant 4
// ---------------------------------------------------------------------------

test('the two untouched meals come back as the same objects, deep-equal to their pre-swap snapshots', () => {
  const request = makeRequest({
    swap_slot: 1,
    reason: 'different_protein',
    candidates: [makeCandidate('cand-x', { attributes: { ...baseAttributes, protein: 'tofu' } })],
  });
  const snapshot0 = structuredClone(request.meals[0]);
  const snapshot2 = structuredClone(request.meals[2]);
  const result = swapMeal(request);
  // Same object identity — the swap never rebuilt or re-scored them...
  assert.ok(Object.is(result.unchanged[0], request.meals[0]));
  assert.ok(Object.is(result.unchanged[1], request.meals[2]));
  // ...and byte-identical to the values captured before the swap ran.
  assert.deepEqual(result.unchanged[0], snapshot0);
  assert.deepEqual(result.unchanged[1], snapshot2);
});

test('alternatives are ranked against the frozen pair — the outgoing meal contributes nothing', () => {
  const tofu = (id: string, ingredients: readonly RecipeIngredientLine[]): SwapMealInput =>
    makeCandidate(id, {
      attributes: { ...baseAttributes, protein: 'tofu', cuisine: 'japanese' },
      ingredients: [...ingredients],
    });
  const result = swapMeal(
    makeRequest({
      reason: 'different_protein',
      candidates: [
        // Shares onion + garlic with the frozen Beef tacos → overlap 2/3.
        tofu('cand-ov-a', [makeLine('onion'), makeLine('garlic'), makeLine('ov_x')]),
        // Disjoint from everything → overlap 0.
        tofu('cand-ov-b', [makeLine('ov_y'), makeLine('ov_z')]),
        // Shares ONLY with the outgoing meal — must rank exactly like a
        // disjoint candidate, losing to it on the id tie-break alone.
        tofu('cand-ov-c', [makeLine('chicken_thigh'), makeLine('breadcrumbs'), makeLine('ov_w')]),
      ],
    }),
  );
  assert.deepEqual(altIds(result), ['cand-ov-a', 'cand-ov-b', 'cand-ov-c']);
  const r = expectAlternatives(result);
  // Hand-computed rank for cand-ov-a:
  //   60%·1 + 20%·(1/2) + 10%·(2/3) + 5%·1 + 5%·1
  //   = 3/5 + 1/10 + 1/15 + 1/20 + 1/20 = 13/15.
  assert.ok(eq(r.alternatives[0].rank.total, rational(13, 15)));
  // The outgoing meal's ingredients count for nothing.
  assert.ok(eq(r.alternatives[2].rank.terms.ingredient_overlap.raw, ZERO));
  // The shares-ingredients fact names the frozen meal, with the count.
  assert.deepEqual(r.alternatives[0].facts, [
    { code: 'shares_ingredients', shared_count: 2, other_meal_name: 'Beef tacos' },
    { code: 'quick_total_time', total_seconds: 1800, active_seconds: 1200 },
  ]);
});

test('every rank breakdown carries all five terms and total = Σ weighted, from the config weights', () => {
  const result = swapMeal(
    makeRequest({
      reason: 'faster',
      candidates: [makeCandidate('cand-f-b', { total_time_seconds: 900, active_time_seconds: 600 })],
    }),
  );
  const alt = expectAlternatives(result).alternatives[0];
  assert.deepEqual(Object.keys(alt.rank.terms).sort(), [...SWAP_RANK_TERM_NAMES].sort());
  let total = ZERO;
  for (const name of SWAP_RANK_TERM_NAMES) {
    const t = alt.rank.terms[name];
    assert.ok(eq(t.weight, SWAP_CONFIG.rank_weights[name]), `${name}: weight not from config`);
    assert.ok(eq(t.weighted, mul(SWAP_CONFIG.rank_weights[name], t.raw)), `${name}: weighted ≠ weight × raw`);
    assert.ok(compare(t.raw, ZERO) >= 0 && compare(t.raw, ONE) <= 0, `${name}: raw outside [0,1]`);
    total = add(total, t.weighted);
  }
  assert.ok(eq(total, alt.rank.total));
});

// ---------------------------------------------------------------------------
// 4. Zero alternatives — typed, honest, never a throw
// ---------------------------------------------------------------------------

test('no candidate satisfies the reason: typed outcome with honest counts, frozen pair still returned', () => {
  // The outgoing meal is already low-band: nothing can be strictly cheaper.
  const lowMeal0 = makeMeal('plan-0', {
    name: 'Herbed chicken skillet',
    cost_band: 'low',
    ingredients: [makeLine('chicken_thigh'), makeLine('breadcrumbs')],
  });
  const request = makeRequest({
    meals: [lowMeal0, meal1, meal2],
    reason: 'cheaper',
    candidates: [makeCandidate('cand-z-a', { cost_band: 'medium' }), makeCandidate('cand-z-b', { cost_band: 'low' })],
  });
  const result = expectNone(swapMeal(request));
  assert.equal(result.explanation, 'no_candidate_satisfies_reason');
  assert.deepEqual(result.counts, {
    pool_size: 2,
    already_in_plan: 0,
    ineligible_for_reason: 2,
    eligible: 0,
  });
  assert.ok(Object.is(result.unchanged[0], meal1));
  assert.ok(Object.is(result.unchanged[1], meal2));
});

test('an empty pool and an all-in-plan pool each get their own typed explanation', () => {
  const empty = expectNone(swapMeal(makeRequest({ reason: 'faster', candidates: [] })));
  assert.equal(empty.explanation, 'no_candidates_in_pool');

  const inPlan = expectNone(
    swapMeal(makeRequest({ reason: 'faster', candidates: [meal0, meal1, meal2] })),
  );
  assert.equal(inPlan.explanation, 'all_candidates_already_in_plan');
  assert.deepEqual(inPlan.counts, {
    pool_size: 3,
    already_in_plan: 3,
    ineligible_for_reason: 0,
    eligible: 0,
  });
});

test('a candidate already in the plan is never offered as its own alternative', () => {
  const result = swapMeal(
    makeRequest({
      reason: 'faster',
      candidates: [meal1, makeCandidate('cand-f-b', { total_time_seconds: 900, active_time_seconds: 600 })],
    }),
  );
  assert.deepEqual(altIds(result), ['cand-f-b']);
  assert.equal(expectAlternatives(result).counts.already_in_plan, 1);
});

// ---------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------

test('identical requests give byte-identical results; shuffled candidates change nothing', () => {
  const candidates = [
    makeCandidate('cand-f-a', { total_time_seconds: 1800, active_time_seconds: 600 }),
    makeCandidate('cand-f-b', { total_time_seconds: 900, active_time_seconds: 600 }),
    makeCandidate('cand-f-c', { total_time_seconds: 1200, active_time_seconds: 600 }),
    makeCandidate('cand-f-e', { total_time_seconds: 1500, active_time_seconds: 600 }),
  ];
  const forward = swapMeal(makeRequest({ reason: 'faster', candidates }));
  const again = swapMeal(makeRequest({ reason: 'faster', candidates }));
  const shuffled = swapMeal(makeRequest({ reason: 'faster', candidates: [...candidates].reverse() }));
  assert.deepEqual(forward, again);
  assert.deepEqual(forward, shuffled);
});

// ---------------------------------------------------------------------------
// 6. Facts are renderable and capped for every reason
// ---------------------------------------------------------------------------

test('for every reason with alternatives, facts are ≤ 3 and reasons.ts renders them all', () => {
  const inventory = [makeInventoryEntry('garlic')];
  // Protein chicken anchors BOTH the outgoing meal and the familiar
  // variant (1/8 each); cuisine french anchors only the variant (2/8), so
  // it is strictly more familiar while the versatile candidate (0/8) is
  // strictly more adventurous.
  const signals = [
    makeSignal(),
    makeSignal({ id: 'sg-2', attribute: 'cuisine', attribute_value: 'french' }),
  ];
  const reasons: readonly SwapReason[] = [
    'faster',
    'less_hands_on',
    'fewer_dishes',
    'cheaper',
    'more_familiar',
    'more_adventurous',
    'no_pasta',
    'different_protein',
    'use_what_i_have',
  ];
  // One candidate that is better than the outgoing meal on EVERY axis:
  // faster, less hands-on, fewer dishes, cheaper, shares garlic with a
  // frozen meal and the inventory, tofu instead of chicken, familiar
  // chicken swapped for anchored... (protein signal anchors chicken; the
  // candidate keeps 0 anchors → adventurous; the familiar variant below
  // covers more_familiar).
  const versatile = makeCandidate('cand-all', {
    attributes: { ...baseAttributes, protein: 'tofu', cuisine: 'japanese' },
    total_time_seconds: 900,
    active_time_seconds: 300,
    dish_count: 1,
    cost_band: 'low',
    ingredients: [makeLine('garlic')],
  });
  const familiarVariant = makeCandidate('cand-fam', {
    attributes: { ...baseAttributes, cuisine: 'french' },
    total_time_seconds: 900,
    active_time_seconds: 300,
    ingredients: [makeLine('garlic')],
  });
  for (const reason of reasons) {
    const result = swapMeal(
      makeRequest({
        reason,
        signals,
        inventory,
        candidates: reason === 'more_familiar' ? [familiarVariant] : [versatile],
      }),
    );
    const r = expectAlternatives(result);
    assert.equal(r.alternatives.length, 1, `${reason}: expected the single candidate to qualify`);
    for (const alt of r.alternatives) {
      assert.ok(alt.facts.length >= 1 && alt.facts.length <= 3, `${reason}: fact count out of range`);
      const rendered = renderMealReasons(alt.facts); // throws on a malformed fact
      for (const line of rendered) assert.ok(line.text.length > 0);
    }
  }
});
