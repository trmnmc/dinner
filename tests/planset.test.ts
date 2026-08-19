/**
 * planset.test.ts — the greedy set-scoring pass (T-007).
 *
 * Pinned against hand-computed literal Rationals, never against values
 * read back out of the engine. The core claim under test: the SET pass
 * chooses meals that are good TOGETHER — on a fixture built so the greedy
 * set differs from the naive top-3-individual pick, the chosen set's
 * set-level score is provably higher (7/10 vs 113/200, both computed by
 * hand in the comments below).
 *
 * Also covered: each of the five set-level terms in isolation, the D-2
 * seed rule, honest (possibly negative) marginal contributions that
 * telescope to the set total, determinism under identical and shuffled
 * input, short plans for fewer than three survivors as a typed outcome,
 * misaligned scores as a typed error, and renderable reason facts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AttributeVector,
  Household,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
  ScoreBreakdown,
  ScoreComponent,
} from '../domain/src/recipe.ts';
import type { Rational } from '../domain/src/qty.ts';
import { ONE, ZERO, add, compare, eq, rational } from '../domain/src/qty.ts';
import type { HardFilterResult } from '../domain/src/filters.ts';
import {
  PLANSET_CONFIG,
  PlanSetError,
  SET_TERM_NAMES,
  buildPlanSet,
  evaluateSet,
} from '../domain/src/planset.ts';
import type { PlanCandidate, PlanSetResult } from '../domain/src/planset.ts';
import { renderMealReasons } from '../domain/src/reasons.ts';

// ---------------------------------------------------------------------------
// Fixtures (same conventions as score.test.ts)
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

/** A structurally complete breakdown with a chosen total — planset only
 * consumes `recipe_id` and `total`; components/penalties are inert here
 * (their integrity is score.test.ts's job). */
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

// ---------------------------------------------------------------------------
// THE fixture: greedy set ≠ naive top-3. Individual totals rank A > B > C
// > D, but D shares ingredients with A and adds protein+cuisine diversity
// where C repeats A's protein, cuisine and (high) cost. All hand math for
// the set scores is in the comments of the main test below.
// ---------------------------------------------------------------------------

const recipeA = makeRecipe({
  id: 'r-a',
  slug: 'r-a',
  name: 'Lemon chicken and rice',
  ingredients: [makeLine('garlic'), makeLine('rice'), makeLine('chicken_thigh')],
});
const recipeB = makeRecipe({
  id: 'r-b',
  slug: 'r-b',
  name: 'Beef tacos',
  attributes: { ...baseAttributes, protein: 'beef', cuisine: 'mexican' },
  ingredients: [makeLine('garlic'), makeLine('onion'), makeLine('beef')],
});
const recipeC = makeRecipe({
  id: 'r-c',
  slug: 'r-c',
  name: 'Creamy mushroom penne',
  cost_band: 'high',
  total_time_seconds: 3600,
  active_time_seconds: 2400,
  ingredients: [makeLine('penne'), makeLine('cream'), makeLine('mushroom')],
});
const recipeD = makeRecipe({
  id: 'r-d',
  slug: 'r-d',
  name: 'Tofu fried rice',
  attributes: { ...baseAttributes, protein: 'tofu', cuisine: 'thai' },
  ingredients: [makeLine('garlic'), makeLine('rice'), makeLine('tofu')],
});

const scoreA = makeScore('r-a', rational(90, 100));
const scoreB = makeScore('r-b', rational(85, 100));
const scoreC = makeScore('r-c', rational(80, 100));
const scoreD = makeScore('r-d', rational(60, 100));

const candidateA: PlanCandidate = { recipe: recipeA, score: scoreA };
const candidateB: PlanCandidate = { recipe: recipeB, score: scoreB };
const candidateC: PlanCandidate = { recipe: recipeC, score: scoreC };
const candidateD: PlanCandidate = { recipe: recipeD, score: scoreD };

function filteredOf(recipes: readonly Recipe[]): HardFilterResult {
  return { survivors: recipes, exclusions: [] };
}

function buildMain(): PlanSetResult {
  return buildPlanSet(
    filteredOf([recipeA, recipeB, recipeC, recipeD]),
    [scoreA, scoreB, scoreC, scoreD],
    makeHousehold(),
  );
}

// ---------------------------------------------------------------------------
// 1. Config sanity — SET-level weights, one config object
// ---------------------------------------------------------------------------

test('the six set-term weights sum to exactly one', () => {
  let total = ZERO;
  for (const name of SET_TERM_NAMES) total = add(total, PLANSET_CONFIG.weights[name]);
  assert.ok(eq(total, ONE), `weights sum to ${total.num.toString()}/${total.den.toString()}, not 1`);
});

test('the weights record carries exactly the declared term names', () => {
  assert.deepEqual(Object.keys(PLANSET_CONFIG.weights).sort(), [...SET_TERM_NAMES].sort());
  assert.equal(SET_TERM_NAMES.length, 6);
  assert.equal(new Set(SET_TERM_NAMES).size, 6);
});

// ---------------------------------------------------------------------------
// 2. THE claim: the set pass beats the naive top-3-individual pick
// ---------------------------------------------------------------------------

test('greedy set pass beats the naive top-3-individual pick on a fixture built so they differ', () => {
  // Naive top-3 by individual totals (90 > 85 > 80 > 60): A, B, C.
  const naiveIds = ['r-a', 'r-b', 'r-c'];

  const result = buildMain();
  assert.equal(result.kind, 'full');
  // Greedy: seed A (best individual). Then D beats B and C on marginal
  // set score (overlap {garlic, rice} with A + full protein/cuisine
  // diversity), then B beats C. Hand math for the two closing sets:
  //   eval({A,D,B}) = 40%·(47/60) + 20%·(1/3) + 12%·1 + 8%·1
  //                 + 12%·(1/3) + 8%·1 = 7/10
  //   eval({A,B,C}) = 40%·(17/20) + 20%·(1/8) + 12%·(2/3) + 8%·(2/3)
  //                 + 12%·(1/9) + 8%·(2/3) = 113/200
  assert.deepEqual(
    result.meals.map((m) => m.recipe.id),
    ['r-a', 'r-d', 'r-b'],
  );
  assert.notDeepEqual(
    [...result.meals.map((m) => m.recipe.id)].sort(),
    [...naiveIds].sort(),
    'fixture must actually separate greedy from naive',
  );

  const household = makeHousehold();
  const chosenEval = evaluateSet([candidateA, candidateD, candidateB], household);
  const naiveEval = evaluateSet([candidateA, candidateB, candidateC], household);
  assert.ok(
    eq(chosenEval.total, rational(7, 10)),
    `chosen set total ${chosenEval.total.num.toString()}/${chosenEval.total.den.toString()} ≠ hand-computed 7/10`,
  );
  assert.ok(
    eq(naiveEval.total, rational(113, 200)),
    `naive set total ${naiveEval.total.num.toString()}/${naiveEval.total.den.toString()} ≠ hand-computed 113/200`,
  );
  assert.equal(compare(chosenEval.total, naiveEval.total), 1, 'greedy set must beat naive set');
  // The result carries the same set evaluation.
  assert.deepEqual(result.set, chosenEval);
});

test('the seed is the best individual score (D-2), and its contribution is the singleton set score', () => {
  const result = buildMain();
  assert.equal(result.meals[0].recipe.id, 'r-a');
  assert.equal(result.meals[0].slot, 0);
  // eval({A}) = 40%·(9/10) + 20%·0 + 12%·1 + 8%·1 + 12%·(7/9) + 8%·1
  //           = 9/25 + 3/25 + 2/25 + 7/75 + 2/25 = 11/15.
  assert.ok(eq(result.meals[0].set_contribution.total, rational(11, 15)));
});

test('marginal contributions are honest (can be negative) and telescope to the set total', () => {
  const result = buildMain();
  assert.equal(result.kind, 'full');
  // eval({A,D}) = 30% + 10% + 12% + 8% + 1/15 + 8% = 56/75.
  //   D's marginal: 56/75 − 11/15 = 1/75.
  assert.ok(eq(result.meals[1].set_contribution.total, rational(1, 75)));
  // eval({A,D,B}) = 7/10. B's marginal: 7/10 − 56/75 = −7/150 — adding a
  // third meal cost time-fit and mean-individual more than diversity
  // gained. Recorded honestly, not clamped.
  assert.ok(eq(result.meals[2].set_contribution.total, rational(-7, 150)));
  // Telescoping: Σ marginals = final set total, exactly.
  let sum = ZERO;
  for (const meal of result.meals) sum = add(sum, meal.set_contribution.total);
  assert.ok(eq(sum, result.set.total));
  // Each contribution carries every term key.
  for (const meal of result.meals) {
    assert.deepEqual(Object.keys(meal.set_contribution.terms).sort(), [...SET_TERM_NAMES].sort());
    let termSum = ZERO;
    for (const name of SET_TERM_NAMES) termSum = add(termSum, meal.set_contribution.terms[name]);
    assert.ok(eq(termSum, meal.set_contribution.total), 'term deltas must sum to the total delta');
  }
});

// ---------------------------------------------------------------------------
// 3. The five set-level terms, isolated — hand-computed raw values
// ---------------------------------------------------------------------------

test('ingredient overlap: fraction of distinct required ingredients used by ≥2 meals', () => {
  const household = makeHousehold();
  // A{garlic,rice,chicken_thigh} ∪ D{garlic,rice,tofu}: 4 distinct, 2
  // shared → 1/2.
  const shared = evaluateSet([candidateA, candidateD], household);
  assert.ok(eq(shared.terms.ingredient_overlap.raw, rational(1, 2)));
  assert.ok(
    eq(
      shared.terms.ingredient_overlap.weighted,
      rational(1, 10), // 20/100 × 1/2
    ),
  );
  // A and C are fully disjoint → 0.
  const disjoint = evaluateSet([candidateA, candidateC], household);
  assert.ok(eq(disjoint.terms.ingredient_overlap.raw, ZERO));
  // A single meal has nothing to share with → 0.
  const singleton = evaluateSet([candidateA], household);
  assert.ok(eq(singleton.terms.ingredient_overlap.raw, ZERO));
});

test('protein diversity: distinct proteins ÷ set size', () => {
  const household = makeHousehold();
  // A chicken + C chicken → 1/2; A chicken + B beef → 1.
  assert.ok(eq(evaluateSet([candidateA, candidateC], household).terms.protein_diversity.raw, rational(1, 2)));
  assert.ok(eq(evaluateSet([candidateA, candidateB], household).terms.protein_diversity.raw, ONE));
  // A, B, C → chicken, beef, chicken → 2/3.
  assert.ok(
    eq(evaluateSet([candidateA, candidateB, candidateC], household).terms.protein_diversity.raw, rational(2, 3)),
  );
});

test('cuisine diversity: distinct cuisines ÷ set size', () => {
  const household = makeHousehold();
  // A italian + C italian → 1/2; A italian + B mexican → 1.
  assert.ok(eq(evaluateSet([candidateA, candidateC], household).terms.cuisine_diversity.raw, rational(1, 2)));
  assert.ok(eq(evaluateSet([candidateA, candidateB], household).terms.cuisine_diversity.raw, ONE));
});

test('weekly active time: remaining fraction of the weekly hands-on budget', () => {
  // No ceiling → the config default budget of 5400 s. A alone uses 1200 s
  // → (5400 − 1200) / 5400 = 7/9.
  const noCeiling = evaluateSet([candidateA], makeHousehold());
  assert.ok(eq(noCeiling.terms.weekly_active_time.raw, rational(7, 9)));
  // A household ceiling of 1000 s/night → weekly budget 3 × 1000 = 3000 s
  // → (3000 − 1200) / 3000 = 3/5. The set respects the household's stated
  // time reality, not the default.
  const withCeiling = evaluateSet(
    [candidateA],
    makeHousehold({ weeknight_active_time_ceiling_seconds: 1000 }),
  );
  assert.ok(eq(withCeiling.terms.weekly_active_time.raw, rational(3, 5)));
  // A budget fully consumed clamps to 0, never negative: ceiling 400 →
  // budget 1200 = A's active time exactly.
  const exhausted = evaluateSet(
    [candidateA],
    makeHousehold({ weeknight_active_time_ceiling_seconds: 400 }),
  );
  assert.ok(eq(exhausted.terms.weekly_active_time.raw, ZERO));
});

test('total cost: 1 − mean cost-band value', () => {
  const household = makeHousehold();
  assert.ok(eq(evaluateSet([candidateA], household).terms.total_cost.raw, ONE)); // low
  assert.ok(eq(evaluateSet([candidateC], household).terms.total_cost.raw, ZERO)); // high
  assert.ok(eq(evaluateSet([candidateA, candidateC], household).terms.total_cost.raw, rational(1, 2)));
});

test('individual fit: mean of the members individual totals', () => {
  // (90/100 + 85/100) / 2 = 7/8.
  const pair = evaluateSet([candidateA, candidateB], makeHousehold());
  assert.ok(eq(pair.terms.individual_fit.raw, rational(7, 8)));
  assert.ok(eq(pair.terms.individual_fit.weighted, rational(7, 20))); // 40/100 × 7/8
});

test('every set term carries weight, raw in [0,1] and weighted = weight × raw from the config', () => {
  const evaluation = evaluateSet([candidateA, candidateB, candidateC], makeHousehold());
  let total = ZERO;
  for (const name of SET_TERM_NAMES) {
    const t = evaluation.terms[name];
    assert.ok(eq(t.weight, PLANSET_CONFIG.weights[name]), `${name}: weight not from config`);
    assert.ok(compare(t.raw, ZERO) >= 0 && compare(t.raw, ONE) <= 0, `${name}: raw outside [0,1]`);
    total = add(total, t.weighted);
  }
  assert.ok(eq(total, evaluation.total), 'total ≠ Σ weighted terms');
});

// ---------------------------------------------------------------------------
// 4. Determinism — identical and shuffled inputs
// ---------------------------------------------------------------------------

test('identical inputs give byte-identical results', () => {
  assert.deepEqual(buildMain(), buildMain());
});

test('a shuffled candidate array gives the identical result — ties and order carry no signal', () => {
  const household = makeHousehold();
  const forward = buildPlanSet(
    filteredOf([recipeA, recipeB, recipeC, recipeD]),
    [scoreA, scoreB, scoreC, scoreD],
    household,
  );
  const shuffled = buildPlanSet(
    filteredOf([recipeD, recipeC, recipeB, recipeA]),
    [scoreD, scoreC, scoreB, scoreA],
    household,
  );
  assert.deepEqual(forward, shuffled);
});

// ---------------------------------------------------------------------------
// 5. Fewer than three survivors — a typed outcome, never a throw
// ---------------------------------------------------------------------------

test('two survivors give a typed short plan: two real meals, one missing, no padding', () => {
  const result = buildPlanSet(filteredOf([recipeA, recipeB]), [scoreA, scoreB], makeHousehold());
  assert.equal(result.kind, 'short');
  if (result.kind !== 'short') return;
  assert.equal(result.survivor_count, 2);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.meals.map((m) => m.recipe.id), ['r-a', 'r-b']);
});

test('one survivor gives a one-meal short plan', () => {
  const result = buildPlanSet(filteredOf([recipeD]), [scoreD], makeHousehold());
  assert.equal(result.kind, 'short');
  if (result.kind !== 'short') return;
  assert.equal(result.survivor_count, 1);
  assert.equal(result.missing, 2);
  assert.deepEqual(result.meals.map((m) => m.recipe.id), ['r-d']);
  assert.equal(result.meals[0]?.slot, 0);
});

test('zero survivors give an empty short plan with a zero set score — never a fabricated meal', () => {
  const result = buildPlanSet(filteredOf([]), [], makeHousehold());
  assert.equal(result.kind, 'short');
  if (result.kind !== 'short') return;
  assert.equal(result.survivor_count, 0);
  assert.equal(result.missing, 3);
  assert.deepEqual(result.meals, []);
  assert.ok(eq(result.set.total, ZERO));
});

// ---------------------------------------------------------------------------
// 6. Misaligned scores — a typed caller error, loudly
// ---------------------------------------------------------------------------

test('a scores array that does not align with survivors throws a typed PlanSetError', () => {
  assert.throws(
    () => buildPlanSet(filteredOf([recipeA, recipeB]), [scoreA], makeHousehold()),
    (e: unknown) => e instanceof PlanSetError && e.code === 'misaligned_scores',
  );
  assert.throws(
    () => buildPlanSet(filteredOf([recipeA, recipeB]), [scoreB, scoreA], makeHousehold()),
    (e: unknown) => e instanceof PlanSetError && e.code === 'misaligned_scores',
  );
});

// ---------------------------------------------------------------------------
// 7. Reason facts — emitted as facts, renderable by reasons.ts, ≤ 3
// ---------------------------------------------------------------------------

test('each chosen meal carries at most three facts, and reasons.ts renders every one', () => {
  const result = buildMain();
  for (const meal of result.meals) {
    assert.ok(meal.facts.length <= 3, `${meal.recipe.id}: more than three facts`);
    const rendered = renderMealReasons(meal.facts); // throws on a bad fact
    for (const r of rendered) assert.ok(r.text.length > 0);
  }
});

test('the seed meal names its strongest ingredient-sharing partner and its time facts, exactly', () => {
  const result = buildMain();
  // A shares {garlic, rice} = 2 with D but only {garlic} = 1 with B, so
  // the fact names Tofu fried rice. A is 1800 s total / 1200 s active,
  // within both time-fact thresholds (≤ 1800 / ≤ 1200).
  assert.deepEqual(result.meals[0].facts, [
    { code: 'shares_ingredients', shared_count: 2, other_meal_name: 'Tofu fried rice' },
    { code: 'low_active_time', total_seconds: 1800, active_seconds: 1200 },
    { code: 'quick_total_time', total_seconds: 1800, active_seconds: 1200 },
  ]);
});

// ---------------------------------------------------------------------------
// 8. Pass-through integrity — the individual breakdown is not recomputed
// ---------------------------------------------------------------------------

test('each chosen meal carries the exact recipe and breakdown objects it was given', () => {
  const result = buildMain();
  assert.equal(result.meals[0].recipe, recipeA);
  assert.equal(result.meals[0].score, scoreA);
  assert.equal(result.meals[1].recipe, recipeD);
  assert.equal(result.meals[1].score, scoreD);
});
