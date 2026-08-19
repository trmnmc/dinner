/**
 * score.test.ts — regression tests for the weighted scoring engine
 * (T-029). `score.ts` shipped with zero committed coverage; this file
 * pins the SPEC contract so weight drift or an arithmetic regression
 * fails loudly in `npm test` instead of shipping silently.
 *
 * Asserted from the SPEC (Domain rules), not from the implementation:
 * - The six weights, exactly, as Rationals: 0.32 preference, 0.20
 *   context/interruption, 0.16 inventory use, 0.12 cost, 0.10 novelty,
 *   0.10 leftover usefulness. They sum to exactly one.
 * - total = Σ (weight_i × raw_i) − Σ penalties, recomputed independently
 *   here with qty.ts arithmetic — never read back from the engine.
 * - Every persisted value is a Rational (Invariant 1) — checked
 *   structurally on EVERY component field, every penalty and the total.
 * - Weights and penalty amounts come from the injected config — a config
 *   with six pairwise-distinct replacement weights (none equal to any
 *   SPEC weight) moves every component's contribution, so no literal can
 *   be inlined anywhere in the engine.
 * - Penalties subtract, never add; scoring sees ONLY hard-filter
 *   survivors; identical inputs give identical breakdowns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AttributeVector,
  Household,
  HouseholdMember,
  InventoryEntry,
  PreferenceSignal,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
  ScoreBreakdown,
  ScoreComponentName,
  ScoreWeights,
} from '../domain/src/recipe.ts';
import type { IngredientRegistry, IngredientRegistryEntry } from '../domain/src/catalog.ts';
import type { Rational } from '../domain/src/qty.ts';
import { ONE, ZERO, add, compare, eq, mul, rational, sign, sub } from '../domain/src/qty.ts';
import { applyHardFilters } from '../domain/src/filters.ts';
import type { PlanningContext } from '../domain/src/filters.ts';
import {
  SCORE_COMPONENT_NAMES,
  SCORE_CONFIG,
  SCORE_PENALTY_NAMES,
  scoreSurvivors,
} from '../domain/src/score.ts';
import type { ScoreConfig } from '../domain/src/score.ts';

// ---------------------------------------------------------------------------
// The SPEC weights — literal values from SPEC.md "Domain rules", written
// here independently of the engine's config so drift in EITHER is caught.
// ---------------------------------------------------------------------------

const SPEC_WEIGHTS: Readonly<Record<ScoreComponentName, Rational>> = {
  preference: rational(32, 100),
  context_interruption: rational(20, 100),
  inventory_use: rational(16, 100),
  cost: rational(12, 100),
  novelty: rational(10, 100),
  leftover_usefulness: rational(10, 100),
};

const SPEC_WEIGHT_LABELS: readonly (readonly [ScoreComponentName, string])[] = [
  ['preference', '32/100'],
  ['context_interruption', '20/100'],
  ['inventory_use', '16/100'],
  ['cost', '12/100'],
  ['novelty', '10/100'],
  ['leftover_usefulness', '10/100'],
];

// ---------------------------------------------------------------------------
// Fixtures (same conventions as filters.test.ts)
// ---------------------------------------------------------------------------

function entry(id: string, allergens: IngredientRegistryEntry['allergen_classes']): IngredientRegistryEntry {
  return {
    id,
    display_name: id,
    aliases: [],
    allergen_classes: allergens,
    store_section: 'other',
    density_g_per_ml: null,
    per_item_weight_g: null,
    package_options: [],
  };
}

const registry: IngredientRegistry = new Map([
  ['chicken_thigh', entry('chicken_thigh', [])],
  ['rice', entry('rice', [])],
  ['peanut_butter', entry('peanut_butter', ['peanut'])],
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
    value: rational(1, 2),
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

interface ScoreArgs {
  household?: Household;
  signals?: readonly PreferenceSignal[];
  inventory?: readonly InventoryEntry[];
  context?: PlanningContext;
  config?: ScoreConfig;
}

/** Filter through the real hard filters (scoring accepts ONLY that result)
 * and score. Asserts every fixture recipe actually survives filtering, so a
 * fixture accidentally hard-excluded cannot silently weaken a test. */
function scoreAll(recipes: readonly Recipe[], o: ScoreArgs = {}): readonly ScoreBreakdown[] {
  const household = o.household ?? makeHousehold();
  const signals = o.signals ?? [];
  const context = o.context ?? emptyContext;
  const filtered = applyHardFilters(recipes, household, [makeMember()], signals, registry, context);
  assert.equal(
    filtered.survivors.length,
    recipes.length,
    `fixture recipes must survive hard filtering, excluded: ${JSON.stringify(filtered.exclusions)}`,
  );
  return scoreSurvivors(filtered, household, signals, o.inventory ?? [], context, o.config);
}

function scoreOnly(recipe: Recipe, o: ScoreArgs = {}): ScoreBreakdown {
  const [breakdown] = scoreAll([recipe], o);
  assert.ok(breakdown !== undefined);
  return breakdown;
}

/** A deliberately varied fixture set: neutral recipe, penalty-laden recipe
 * (extra dishes, long active time, high cost, likely waste) and a recent
 * repeat, with live signals, inventory and history. */
function diverseArgs(): { recipes: readonly Recipe[]; args: ScoreArgs } {
  const recipes = [
    makeRecipe(),
    makeRecipe({
      id: 'penalty-laden',
      slug: 'penalty-laden',
      dish_count: 5,
      active_time_seconds: 3000,
      cost_band: 'high',
      servings_default: 10,
    }),
    makeRecipe({ id: 'recipe-repeat', slug: 'recipe-repeat' }),
  ];
  const args: ScoreArgs = {
    signals: [
      makeSignal(),
      makeSignal({
        id: 'signal-2',
        attribute: 'flavour',
        attribute_value: 'savoury',
        value: rational(-1, 4),
        confidence: rational(1, 2),
      }),
    ],
    inventory: [makeInventoryEntry('chicken_thigh')],
    context: {
      recent_meals: [{ recipe_id: 'recipe-repeat', attributes: baseAttributes, days_ago: 5 }],
    },
  };
  return { recipes, args };
}

function assertRational(v: unknown, path: string): asserts v is Rational {
  assert.ok(typeof v === 'object' && v !== null, `${path} is not an object — a float leaked?`);
  const r = v as { num?: unknown; den?: unknown };
  assert.equal(typeof r.num, 'bigint', `${path}.num is not a bigint`);
  assert.equal(typeof r.den, 'bigint', `${path}.den is not a bigint`);
  assert.ok((r.den as bigint) > 0n, `${path}.den is not strictly positive`);
}

// ---------------------------------------------------------------------------
// 1. The six SPEC weights, exactly — one named test per weight
// ---------------------------------------------------------------------------

for (const [name, label] of SPEC_WEIGHT_LABELS) {
  test(`SPEC weight: ${name} is exactly ${label}`, () => {
    assert.ok(
      eq(SCORE_CONFIG.weights[name], SPEC_WEIGHTS[name]),
      `expected ${label}, config has ${SCORE_CONFIG.weights[name].num.toString()}/${SCORE_CONFIG.weights[name].den.toString()}`,
    );
  });
}

test('the weights record carries exactly the six SPEC components, no more, no fewer', () => {
  assert.deepEqual(
    Object.keys(SCORE_CONFIG.weights).sort(),
    Object.keys(SPEC_WEIGHTS).sort(),
  );
  assert.equal(SCORE_COMPONENT_NAMES.length, 6);
  assert.equal(new Set(SCORE_COMPONENT_NAMES).size, 6);
  assert.deepEqual(
    [...SCORE_COMPONENT_NAMES].sort(),
    Object.keys(SPEC_WEIGHTS).sort(),
  );
});

// ---------------------------------------------------------------------------
// 2. Weights sum to exactly one — exact Rational arithmetic, no epsilon
// ---------------------------------------------------------------------------

test('the six weights sum to exactly ONE via exact Rational arithmetic', () => {
  let total = ZERO;
  for (const name of SCORE_COMPONENT_NAMES) {
    total = add(total, SCORE_CONFIG.weights[name]);
  }
  assert.ok(eq(total, ONE), `weights sum to ${total.num.toString()}/${total.den.toString()}, not 1`);
});

// ---------------------------------------------------------------------------
// 3. Total arithmetic — recomputed independently in the test
// ---------------------------------------------------------------------------

test('total = Σ(SPEC weight × raw) − Σ penalties, recomputed independently for a varied fixture set', () => {
  const { recipes, args } = diverseArgs();
  const breakdowns = scoreAll(recipes, args);
  assert.equal(breakdowns.length, 3);

  // Precondition: the set actually exercises subtraction — at least one
  // breakdown carries a strictly positive penalty sum.
  const anyPenalty = breakdowns.some((b) =>
    SCORE_PENALTY_NAMES.some((p) => sign(b.penalties[p]) === 1),
  );
  assert.ok(anyPenalty, 'fixture set must include at least one applied penalty');

  for (const b of breakdowns) {
    let expected = ZERO;
    for (const name of SCORE_COMPONENT_NAMES) {
      const c = b.components[name];
      // The persisted weight is the SPEC weight, and weighted is exactly
      // SPEC weight × raw — computed here, not read back from the engine.
      assert.ok(eq(c.weight, SPEC_WEIGHTS[name]), `${b.recipe_id}: ${name} weight drifted from SPEC`);
      assert.ok(
        eq(c.weighted, mul(SPEC_WEIGHTS[name], c.raw)),
        `${b.recipe_id}: ${name} weighted ≠ SPEC weight × raw`,
      );
      expected = add(expected, mul(SPEC_WEIGHTS[name], c.raw));
    }
    for (const name of SCORE_PENALTY_NAMES) {
      expected = sub(expected, b.penalties[name]);
    }
    assert.ok(
      eq(b.total, expected),
      `${b.recipe_id}: total ${b.total.num.toString()}/${b.total.den.toString()} ≠ recomputed ${expected.num.toString()}/${expected.den.toString()}`,
    );
  }
});

test('a fully hand-computed fixture scores exactly 29/50', () => {
  // Base fixture, no signals, no inventory, no history, household of 2:
  //   preference  neutral 1/2        → 32/100 × 1/2 = 16/100
  //   context     1 fully-pausable low-risk step, raw 1 → 20/100
  //   inventory   0 of 2 lines owned, raw 0             → 0
  //   cost        low band, raw 1                       → 12/100
  //   novelty     zero familiar anchors, raw 0          → 0
  //   leftover    4 servings / 2 people − 1 = 1         → 10/100
  //   penalties   none apply                            → 0
  //   total       58/100 = 29/50
  const b = scoreOnly(makeRecipe());
  assert.ok(eq(b.components.preference.weighted, rational(16, 100)), 'preference weighted ≠ 16/100');
  assert.ok(eq(b.components.context_interruption.weighted, rational(20, 100)), 'context weighted ≠ 20/100');
  assert.ok(eq(b.components.inventory_use.weighted, ZERO), 'inventory weighted ≠ 0');
  assert.ok(eq(b.components.cost.weighted, rational(12, 100)), 'cost weighted ≠ 12/100');
  assert.ok(eq(b.components.novelty.weighted, ZERO), 'novelty weighted ≠ 0');
  assert.ok(eq(b.components.leftover_usefulness.weighted, rational(10, 100)), 'leftover weighted ≠ 10/100');
  for (const name of SCORE_PENALTY_NAMES) {
    assert.ok(eq(b.penalties[name], ZERO), `penalty ${name} applied unexpectedly`);
  }
  assert.ok(
    eq(b.total, rational(29, 50)),
    `expected 29/50, got ${b.total.num.toString()}/${b.total.den.toString()}`,
  );
});

// ---------------------------------------------------------------------------
// 4. Every persisted value is a Rational — structural, exhaustive
// ---------------------------------------------------------------------------

test('every persisted value in every breakdown is structurally a Rational (bigint num/den, den > 0)', () => {
  const { recipes, args } = diverseArgs();
  for (const b of scoreAll(recipes, args)) {
    for (const name of SCORE_COMPONENT_NAMES) {
      const c = b.components[name];
      assertRational(c.weight, `${b.recipe_id}.components.${name}.weight`);
      assertRational(c.raw, `${b.recipe_id}.components.${name}.raw`);
      assertRational(c.weighted, `${b.recipe_id}.components.${name}.weighted`);
      // Raw fits stay in [0, 1] — exact comparisons, no epsilon.
      assert.ok(compare(c.raw, ZERO) >= 0, `${b.recipe_id}.${name}.raw below 0`);
      assert.ok(compare(c.raw, ONE) <= 0, `${b.recipe_id}.${name}.raw above 1`);
    }
    for (const name of SCORE_PENALTY_NAMES) {
      assertRational(b.penalties[name], `${b.recipe_id}.penalties.${name}`);
    }
    assertRational(b.total, `${b.recipe_id}.total`);
  }
});

// ---------------------------------------------------------------------------
// 5. Injected config is honoured by EVERY component — no inlined literals
// ---------------------------------------------------------------------------

test('an injected config with six pairwise-distinct weights moves every component and the total', () => {
  // Six weights, pairwise distinct, disjoint from every SPEC weight, and
  // still summing to one — a partially-inlined or key-swapped engine
  // cannot match all six by accident.
  const injectedWeights: ScoreWeights = {
    preference: rational(1, 2),
    context_interruption: rational(1, 4),
    inventory_use: rational(1, 8),
    cost: rational(1, 16),
    novelty: rational(1, 24),
    leftover_usefulness: rational(1, 48),
  };
  // Preconditions: injected weights sum to one and no injected weight
  // equals ANY spec weight (so key swaps are also caught).
  let injectedSum = ZERO;
  for (const name of SCORE_COMPONENT_NAMES) injectedSum = add(injectedSum, injectedWeights[name]);
  assert.ok(eq(injectedSum, ONE), 'injected weights must still sum to one');
  for (const a of SCORE_COMPONENT_NAMES) {
    for (const p of SCORE_COMPONENT_NAMES) {
      assert.ok(!eq(injectedWeights[a], SPEC_WEIGHTS[p]), `injected ${a} collides with SPEC ${p}`);
    }
  }
  const injectedPenalties = {
    recent_repeat: rational(1, 3),
    repeated_cuisine: rational(1, 7),
    repeated_format: rational(1, 9),
    excessive_active_time: rational(1, 11),
    dish_count: rational(1, 13),
    likely_waste: rational(1, 17),
  } as const;
  const injected: ScoreConfig = {
    ...SCORE_CONFIG,
    weights: injectedWeights,
    penalty_amounts: injectedPenalties,
  };

  // A fixture in which EVERY raw fit is strictly positive, so a weight
  // change must move every contribution: an applying positive signal,
  // partial inventory, low cost, a familiar recent meal, surplus servings.
  const recipe = makeRecipe();
  const args: ScoreArgs = {
    signals: [makeSignal()],
    inventory: [makeInventoryEntry('chicken_thigh')],
    context: {
      recent_meals: [{ recipe_id: 'earlier-meal', attributes: baseAttributes, days_ago: 5 }],
    },
  };
  const withSpec = scoreOnly(recipe, args);
  const withInjected = scoreOnly(recipe, { ...args, config: injected });

  let expectedTotal = ZERO;
  for (const name of SCORE_COMPONENT_NAMES) {
    const before = withSpec.components[name];
    const after = withInjected.components[name];
    assert.equal(sign(before.raw), 1, `fixture must give ${name} a strictly positive raw fit`);
    // Raw fit is weight-independent; only the weighting changes.
    assert.ok(eq(after.raw, before.raw), `${name}: raw fit changed with the config weights`);
    assert.ok(eq(after.weight, injectedWeights[name]), `${name}: injected weight not persisted`);
    assert.ok(
      eq(after.weighted, mul(injectedWeights[name], before.raw)),
      `${name}: weighted ≠ injected weight × raw`,
    );
    assert.ok(
      !eq(after.weighted, before.weighted),
      `${name}: contribution did not move — weight literal inlined?`,
    );
    expectedTotal = add(expectedTotal, after.weighted);
  }

  // Penalty amounts are config-driven too: the familiar recent meal draws
  // repeated-cuisine and repeated-format at the INJECTED amounts.
  assert.ok(eq(withInjected.penalties.repeated_cuisine, injectedPenalties.repeated_cuisine));
  assert.ok(eq(withInjected.penalties.repeated_format, injectedPenalties.repeated_format));
  for (const name of SCORE_PENALTY_NAMES) {
    expectedTotal = sub(expectedTotal, withInjected.penalties[name]);
  }
  assert.ok(eq(withInjected.total, expectedTotal), 'injected-config total ≠ recomputed total');
  assert.ok(!eq(withInjected.total, withSpec.total), 'total did not move under injected weights');
});

// ---------------------------------------------------------------------------
// 6. Penalties subtract, never add
// ---------------------------------------------------------------------------

test('every penalty is ≥ 0 in every breakdown — a penalty can never add score', () => {
  const { recipes, args } = diverseArgs();
  for (const b of scoreAll(recipes, args)) {
    for (const name of SCORE_PENALTY_NAMES) {
      assert.ok(sign(b.penalties[name]) >= 0, `${b.recipe_id}: penalty ${name} is negative`);
    }
  }
});

test('a dish-count penalty lowers the total by exactly the config amount, strictly below the clean twin', () => {
  const clean = makeRecipe({ id: 'few-dishes', slug: 'few-dishes', dish_count: 3 });
  const dirty = makeRecipe({ id: 'many-dishes', slug: 'many-dishes', dish_count: 5 });
  const [a, b] = scoreAll([clean, dirty]);
  assert.ok(a !== undefined && b !== undefined);
  assert.ok(eq(a.penalties.dish_count, ZERO));
  const expectedPenalty = mul(rational(2), SCORE_CONFIG.penalty_amounts.dish_count); // 2 extra dishes
  assert.ok(eq(b.penalties.dish_count, expectedPenalty));
  assert.equal(compare(b.total, a.total), -1, 'penalised recipe must score strictly lower');
  assert.ok(eq(sub(a.total, b.total), expectedPenalty), 'totals must differ by exactly the penalty');
});

test('the per-dish penalty is capped at the config ceiling', () => {
  const sinkFiller = makeRecipe({ id: 'sink-filler', slug: 'sink-filler', dish_count: 20 });
  const b = scoreOnly(sinkFiller);
  assert.ok(eq(b.penalties.dish_count, SCORE_CONFIG.dish_count_penalty_cap));
});

test('excessive active time draws its penalty strictly above the threshold, not at it', () => {
  const at = makeRecipe({ id: 'at-threshold', slug: 'at-threshold', active_time_seconds: SCORE_CONFIG.excessive_active_time_threshold_seconds });
  const over = makeRecipe({ id: 'over-threshold', slug: 'over-threshold', active_time_seconds: SCORE_CONFIG.excessive_active_time_threshold_seconds + 1 });
  const [a, b] = scoreAll([at, over]);
  assert.ok(a !== undefined && b !== undefined);
  assert.ok(eq(a.penalties.excessive_active_time, ZERO));
  assert.ok(eq(b.penalties.excessive_active_time, SCORE_CONFIG.penalty_amounts.excessive_active_time));
  assert.equal(compare(b.total, a.total), -1);
  assert.ok(eq(sub(a.total, b.total), SCORE_CONFIG.penalty_amounts.excessive_active_time));
});

test('a repeat outside the hard window but inside the penalty window scores strictly below a fresh twin', () => {
  const again = makeRecipe({ id: 'r-again', slug: 'r-again' });
  const fresh = makeRecipe({ id: 'r-fresh', slug: 'r-fresh' });
  const context: PlanningContext = {
    recent_meals: [{ recipe_id: 'r-again', attributes: baseAttributes, days_ago: 5 }],
  };
  const [a, b] = scoreAll([again, fresh], { context });
  assert.ok(a !== undefined && b !== undefined);
  assert.ok(eq(a.penalties.recent_repeat, SCORE_CONFIG.penalty_amounts.recent_repeat));
  assert.ok(eq(b.penalties.recent_repeat, ZERO));
  // Both share cuisine/format with the recent meal, so those penalties
  // cancel in the difference: only recent_repeat separates the twins.
  assert.equal(compare(a.total, b.total), -1, 'the repeat must score strictly lower');
  assert.ok(eq(sub(b.total, a.total), SCORE_CONFIG.penalty_amounts.recent_repeat));
});

test('a likely-waste batch scores strictly below a right-sized twin by exactly the penalty', () => {
  // Household of 2, ceiling 2×2 = 4 servings. 4 servings: no penalty and
  // leftover raw already clamps to 1; 5 servings: penalty, leftover raw
  // still clamps to 1 — so ONLY the penalty separates the twins.
  const sized = makeRecipe({ id: 'right-sized', slug: 'right-sized', servings_default: 4 });
  const waste = makeRecipe({ id: 'oversized', slug: 'oversized', servings_default: 5 });
  const [a, b] = scoreAll([sized, waste]);
  assert.ok(a !== undefined && b !== undefined);
  assert.ok(eq(a.penalties.likely_waste, ZERO));
  assert.ok(eq(b.penalties.likely_waste, SCORE_CONFIG.penalty_amounts.likely_waste));
  assert.equal(compare(b.total, a.total), -1);
  assert.ok(eq(sub(a.total, b.total), SCORE_CONFIG.penalty_amounts.likely_waste));
});

// ---------------------------------------------------------------------------
// 7. Determinism
// ---------------------------------------------------------------------------

test('scoring is deterministic: identical inputs give identical breakdowns', () => {
  const { recipes, args } = diverseArgs();
  assert.deepEqual(scoreAll(recipes, args), scoreAll(recipes, args));
});

// ---------------------------------------------------------------------------
// 8. Breakdown completeness — every component and penalty key present
// ---------------------------------------------------------------------------

test('every breakdown carries exactly the declared component and penalty keys — none missing, none extra', () => {
  const { recipes, args } = diverseArgs();
  for (const b of scoreAll(recipes, args)) {
    assert.deepEqual(
      Object.keys(b.components).sort(),
      [...SCORE_COMPONENT_NAMES].sort(),
      `${b.recipe_id}: component keys drifted`,
    );
    assert.deepEqual(
      Object.keys(b.penalties).sort(),
      [...SCORE_PENALTY_NAMES].sort(),
      `${b.recipe_id}: penalty keys drifted`,
    );
  }
});

// ---------------------------------------------------------------------------
// 9. Structural phase separation — scoring cannot see an excluded recipe
// ---------------------------------------------------------------------------

test('scoring accepts only the hard-filter result: an excluded recipe cannot receive a score', () => {
  const safe = makeRecipe();
  const dangerous = makeRecipe({
    id: 'peanut-dish',
    slug: 'peanut-dish',
    ingredients: [makeLine('l1', 'peanut_butter')],
  });
  const household = makeHousehold();
  const members = [makeMember({ allergies: ['peanut'] })];
  const filtered = applyHardFilters([safe, dangerous], household, members, [], registry, emptyContext);
  assert.deepEqual(filtered.exclusions.map((e) => e.recipe_id), ['peanut-dish']);

  const breakdowns = scoreSurvivors(filtered, household, [], [], emptyContext);
  assert.deepEqual(breakdowns.map((b) => b.recipe_id), ['recipe-base']);
});

test('breakdowns align one-to-one, in order, with the survivor list', () => {
  const recipes = [
    makeRecipe({ id: 'r1', slug: 'r1' }),
    makeRecipe({ id: 'r2', slug: 'r2' }),
    makeRecipe({ id: 'r3', slug: 'r3' }),
  ];
  const breakdowns = scoreAll(recipes);
  assert.deepEqual(breakdowns.map((b) => b.recipe_id), ['r1', 'r2', 'r3']);
});
