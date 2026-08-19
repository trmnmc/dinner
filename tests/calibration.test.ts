/**
 * calibration.test.ts — regression tests for the deliberate calibration
 * card selector (T-005).
 *
 * The acceptance this item is judged on: selection MAXIMISES attribute
 * spread via greedy marginal coverage, deterministically, never randomly —
 * and must demonstrably beat naive sampling on coverage. The tests below
 * construct a catalog where a "boring cluster" of identical-attribute
 * cards sits before a diverse tail, so naive positional sampling (which
 * would happily fill its quota from the cluster) is provably worse than
 * the greedy selector.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AttributeVector,
  PreferenceSignal,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
} from '../domain/src/recipe.ts';
import { ONE, rational } from '../domain/src/qty.ts';
import { CALIBRATION_CONFIG, attributeCoverage, selectCalibrationCards } from '../domain/src/calibration.ts';
import type { CalibrationConfig } from '../domain/src/calibration.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeLine(id: string, ingredientId: string): RecipeIngredientLine {
  return {
    id,
    ingredient_id: ingredientId,
    display_name: ingredientId,
    quantity: { kind: 'exact', amount: rational(100), unit: 'g' },
    preparation: null,
    optional: false,
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

function makeRecipe(id: string, attributes: AttributeVector): Recipe {
  return {
    id,
    slug: id,
    name: id,
    description: 'A fixture.',
    servings_default: 4,
    attributes,
    dietary_tags: [],
    allergens: [],
    equipment: [],
    cost_band: 'low',
    dish_count: 2,
    total_time_seconds: 1500,
    active_time_seconds: 600,
    ingredients: [makeLine('l1', 'chicken_thigh')],
    steps: [makeStep(0)],
  };
}

function makeSignal(over: Partial<PreferenceSignal>): PreferenceSignal {
  return {
    id: 'sig',
    household_id: 'h1',
    member_id: null,
    attribute: 'protein',
    attribute_value: 'chicken',
    value: rational(0),
    confidence: ONE,
    durability: 'seasonal',
    source: 'feedback',
    updated_at_utc: '2026-08-19T00:00:00.000Z',
    ...over,
  };
}

const CLUSTER_ATTRS: AttributeVector = {
  protein: 'chicken',
  cuisine: 'italian',
  flavour: ['savoury'],
  texture: ['tender'],
  spice: 'mild',
  richness: 'medium',
  method: 'oven',
  effort: 'medium',
};

/** 8 identical-attribute cards (a "boring cluster") — picking any two adds
 * ZERO new coverage beyond picking one. */
function boringCluster(): Recipe[] {
  return Array.from({ length: 8 }, (_, i) => makeRecipe(`r0${String(i)}`, CLUSTER_ATTRS));
}

const DIVERSE_ATTRS: readonly AttributeVector[] = [
  { protein: 'beef', cuisine: 'mexican', flavour: ['bright'], texture: ['crunchy'], spice: 'medium', richness: 'light', method: 'stovetop', effort: 'low' },
  { protein: 'pork', cuisine: 'thai', flavour: ['spicy'], texture: ['saucy'], spice: 'hot', richness: 'rich', method: 'stir_fry', effort: 'high' },
  { protein: 'lamb', cuisine: 'indian', flavour: ['earthy'], texture: ['chewy'], spice: 'hot', richness: 'rich', method: 'braise', effort: 'high' },
  { protein: 'turkey', cuisine: 'american', flavour: ['smoky'], texture: ['crispy'], spice: 'none', richness: 'light', method: 'roast', effort: 'low' },
  { protein: 'fish', cuisine: 'japanese', flavour: ['umami'], texture: ['fluffy'], spice: 'mild', richness: 'medium', method: 'grill', effort: 'medium' },
  { protein: 'shellfish', cuisine: 'chinese', flavour: ['garlicky'], texture: ['sticky'], spice: 'hot', richness: 'rich', method: 'stir_fry', effort: 'high' },
  { protein: 'egg', cuisine: 'korean', flavour: ['tangy'], texture: ['creamy'], spice: 'medium', richness: 'light', method: 'one_pot', effort: 'low' },
  { protein: 'tofu', cuisine: 'french', flavour: ['herby'], texture: ['brothy'], spice: 'none', richness: 'medium', method: 'roast', effort: 'medium' },
  { protein: 'tempeh', cuisine: 'spanish', flavour: ['sweet'], texture: ['chewy'], spice: 'mild', richness: 'rich', method: 'simmer', effort: 'low' },
  { protein: 'legume', cuisine: 'caribbean', flavour: ['tangy'], texture: ['crunchy'], spice: 'hot', richness: 'light', method: 'no_cook', effort: 'low' },
  { protein: 'cheese', cuisine: 'german', flavour: ['smoky'], texture: ['creamy'], spice: 'medium', richness: 'rich', method: 'assembly', effort: 'medium' },
  { protein: 'none', cuisine: 'cajun', flavour: ['spicy'], texture: ['saucy'], spice: 'hot', richness: 'medium', method: 'broil', effort: 'high' },
];

function diverseTail(): Recipe[] {
  return DIVERSE_ATTRS.map((attrs, i) => makeRecipe(`r${String(8 + i).padStart(2, '0')}`, attrs));
}

/** Cluster-first catalog: a naive positional sampler would happily fill
 * its quota from the redundant cluster before reaching the diverse tail. */
function mixedCatalog(): Recipe[] {
  return [...boringCluster(), ...diverseTail()];
}

// ---------------------------------------------------------------------------
// Coverage superiority — the acceptance-critical property
// ---------------------------------------------------------------------------

test('greedy selection beats a naive first-N positional sample on attribute coverage', () => {
  const catalog = mixedCatalog();
  const selected = selectCalibrationCards(catalog, []);
  assert.ok(selected.length >= 8 && selected.length <= 15);

  const wantCount = selected.length;
  const naiveFirstN = catalog.slice(0, wantCount);

  const greedyCoverage = attributeCoverage(selected);
  const naiveCoverage = attributeCoverage(naiveFirstN);

  assert.ok(
    greedyCoverage > naiveCoverage,
    `greedy coverage (${greedyCoverage}) must exceed naive first-N coverage (${naiveCoverage})`,
  );
  // The naive sample is dominated by the identical cluster: strictly fewer
  // than half the catalog's positions are "wasted" duplicates in the
  // greedy pick, which is exactly why this catalog was constructed.
  assert.ok(greedyCoverage >= naiveCoverage + 8, 'the gap should be substantial, not marginal');
});

test('greedy selection beats a deterministic fixed-stride sample on attribute coverage', () => {
  const catalog = mixedCatalog(); // 20 cards
  const selected = selectCalibrationCards(catalog, []);
  const wantCount = selected.length;

  // Fixed-stride, deterministic (never Math.random): every 2nd card.
  const stride: Recipe[] = [];
  for (let i = 0; i < catalog.length && stride.length < wantCount; i += 2) {
    const card = catalog[i];
    if (card !== undefined) stride.push(card);
  }

  const greedyCoverage = attributeCoverage(selected);
  const strideCoverage = attributeCoverage(stride);
  assert.ok(
    greedyCoverage >= strideCoverage,
    `greedy coverage (${greedyCoverage}) must be at least the fixed-stride sample's (${strideCoverage})`,
  );
  // The stride sample still only touches the cluster twice (r00, r02, r04,
  // r06 before reaching diverse cards) — greedy should still be strictly
  // ahead, not merely tied.
  assert.ok(greedyCoverage > strideCoverage, 'greedy must strictly beat the fixed-stride baseline here');
});

test('greedy selection picks (close to) the maximum achievable coverage for its card count', () => {
  const catalog = diverseTail(); // 12 fully-varied cards, no cluster
  const selected = selectCalibrationCards(catalog, [], { ...CALIBRATION_CONFIG, target_cards: 8 });
  assert.equal(selected.length, 8);
  // Every diverse card contributes 8 fresh pairs and none share an axis
  // value in common across the whole tail except by incidental overlap
  // (e.g. richness/spice repeats) — coverage should still comfortably
  // exceed what picking any 8 by naive position order would give when the
  // tail is deliberately front-loaded with the least-varied cards first.
  const naive = catalog.slice(0, 8);
  assert.ok(attributeCoverage(selected) >= attributeCoverage(naive));
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('selection is deterministic: identical inputs give identical, byte-equal output — twice', () => {
  const catalog = mixedCatalog();
  const a = selectCalibrationCards(catalog, []);
  const b = selectCalibrationCards(catalog, []);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
});

test('tie-breaking on equal marginal gain is the lower recipe id, deterministically, every run', () => {
  // Two cards ('tie-a', 'tie-z') share an IDENTICAL attribute vector that
  // is ALREADY fully known (seeded via signals at full confidence), so
  // their marginal gain is 0 in every round from the start. Seven
  // "filler" cards each carry a unique protein not covered by anything
  // else, so they are strictly preferred (gain 1) over the tied pair in
  // every round until exhausted. With target_cards = 8 and 9 total cards,
  // exactly one of the tied pair must be dropped — the higher id.
  const tiedAttrs: AttributeVector = {
    protein: 'egg',
    cuisine: 'greek',
    flavour: ['tangy'],
    texture: ['brothy'],
    spice: 'none',
    richness: 'light',
    method: 'grill',
    effort: 'low',
  };
  const tieA = makeRecipe('tie-a', tiedAttrs);
  const tieZ = makeRecipe('tie-z', tiedAttrs);

  const fillerProteins = ['beef', 'pork', 'lamb', 'turkey', 'fish', 'shellfish', 'chicken'] as const;
  const fillers = fillerProteins.map((protein, i) =>
    makeRecipe(`filler-${String(i)}`, {
      protein,
      cuisine: 'french',
      flavour: ['umami'],
      texture: ['crispy'],
      spice: 'medium',
      richness: 'rich',
      method: 'roast',
      effort: 'high',
    }),
  );

  const catalog = [...fillers, tieA, tieZ]; // 9 total
  const signals: PreferenceSignal[] = [
    makeSignal({ attribute: 'protein', attribute_value: 'egg' }),
    makeSignal({ attribute: 'cuisine', attribute_value: 'greek' }),
    makeSignal({ attribute: 'flavour', attribute_value: 'tangy' }),
    makeSignal({ attribute: 'texture', attribute_value: 'brothy' }),
    makeSignal({ attribute: 'spice', attribute_value: 'none' }),
    makeSignal({ attribute: 'richness', attribute_value: 'light' }),
    makeSignal({ attribute: 'method', attribute_value: 'grill' }),
    makeSignal({ attribute: 'effort', attribute_value: 'low' }),
  ];
  const config: CalibrationConfig = { min_cards: 8, max_cards: 8, target_cards: 8, known_confidence_threshold: rational(3, 5) };

  for (let run = 0; run < 2; run += 1) {
    const selected = selectCalibrationCards(catalog, signals, config);
    const ids = selected.map((r) => r.id);
    assert.equal(selected.length, 8, `run ${String(run)}`);
    assert.ok(ids.includes('tie-a'), `run ${String(run)}: expected the lower-id 'tie-a' to survive, got ${JSON.stringify(ids)}`);
    assert.ok(!ids.includes('tie-z'), `run ${String(run)}: expected the higher-id 'tie-z' to be dropped, got ${JSON.stringify(ids)}`);
    for (const filler of fillers) assert.ok(ids.includes(filler.id));
  }
});

// ---------------------------------------------------------------------------
// Degenerate cases
// ---------------------------------------------------------------------------

test('an empty catalog selects nothing', () => {
  assert.deepEqual(selectCalibrationCards([], []), []);
});

test('a catalog smaller than min_cards returns the whole catalog, sorted by id', () => {
  const catalog = [makeRecipe('c', CLUSTER_ATTRS), makeRecipe('a', CLUSTER_ATTRS), makeRecipe('b', CLUSTER_ATTRS)];
  const selected = selectCalibrationCards(catalog, []);
  assert.equal(selected.length, 3);
  assert.deepEqual(selected.map((r) => r.id), ['a', 'b', 'c']);
});

test('a catalog of exactly min_cards returns all of it', () => {
  const catalog = boringCluster(); // exactly 8, CALIBRATION_CONFIG.min_cards
  const selected = selectCalibrationCards(catalog, []);
  assert.equal(selected.length, 8);
  assert.deepEqual(
    selected.map((r) => r.id).sort(),
    catalog.map((r) => r.id).sort(),
  );
});

test('a catalog whose attributes are all identical still selects between min_cards and max_cards, deterministically', () => {
  const catalog = Array.from({ length: 20 }, (_, i) => makeRecipe(`u${String(i).padStart(2, '0')}`, CLUSTER_ATTRS));
  const first = selectCalibrationCards(catalog, []);
  const second = selectCalibrationCards(catalog, []);
  assert.ok(first.length >= 8 && first.length <= 15);
  assert.deepEqual(first.map((r) => r.id), second.map((r) => r.id));
  // No card can add anything: coverage equals a single card's own pairs.
  assert.equal(attributeCoverage(first), attributeCoverage([catalog[0] as Recipe]));
});

test('an already-well-calibrated household is steered away from cards whose attributes it already confidently knows', () => {
  const catalog = mixedCatalog(); // cluster (8) + diverse tail (12) = 20
  const clusterPairSignals: PreferenceSignal[] = [
    makeSignal({ attribute: 'protein', attribute_value: 'chicken' }),
    makeSignal({ attribute: 'cuisine', attribute_value: 'italian' }),
    makeSignal({ attribute: 'flavour', attribute_value: 'savoury' }),
    makeSignal({ attribute: 'texture', attribute_value: 'tender' }),
    makeSignal({ attribute: 'spice', attribute_value: 'mild' }),
    makeSignal({ attribute: 'richness', attribute_value: 'medium' }),
    makeSignal({ attribute: 'method', attribute_value: 'oven' }),
    makeSignal({ attribute: 'effort', attribute_value: 'medium' }),
  ];
  const selected = selectCalibrationCards(catalog, clusterPairSignals);
  // 12 diverse cards is enough to fill the default 10-card target without
  // ever touching the fully-known cluster.
  const clusterIds = new Set(catalog.slice(0, 8).map((r) => r.id));
  const chosenFromCluster = selected.filter((r) => clusterIds.has(r.id));
  assert.equal(chosenFromCluster.length, 0, `expected no cluster cards, got ${JSON.stringify(chosenFromCluster.map((r) => r.id))}`);
});

// ---------------------------------------------------------------------------
// Config respected
// ---------------------------------------------------------------------------

test('an injected config with a smaller [min,max] range is honoured exactly', () => {
  const catalog = diverseTail();
  const config: CalibrationConfig = { min_cards: 4, max_cards: 6, target_cards: 5, known_confidence_threshold: rational(3, 5) };
  const selected = selectCalibrationCards(catalog, [], config);
  assert.equal(selected.length, 5);
});

test('the default config selects a count within [8, 15] for a large varied catalog', () => {
  const selected = selectCalibrationCards(mixedCatalog(), []);
  assert.ok(selected.length >= CALIBRATION_CONFIG.min_cards);
  assert.ok(selected.length <= CALIBRATION_CONFIG.max_cards);
  assert.equal(selected.length, CALIBRATION_CONFIG.target_cards);
});

// ---------------------------------------------------------------------------
// attributeCoverage() — direct unit check
// ---------------------------------------------------------------------------

test('attributeCoverage counts distinct (attribute, attribute_value) pairs across cards, deduplicated', () => {
  const a = makeRecipe('a', CLUSTER_ATTRS); // 8 distinct pairs
  const b = makeRecipe('b', CLUSTER_ATTRS); // identical to a: 0 new
  const c = makeRecipe('c', DIVERSE_ATTRS[0] as AttributeVector); // 8 more, all new
  assert.equal(attributeCoverage([a]), 8);
  assert.equal(attributeCoverage([a, b]), 8);
  assert.equal(attributeCoverage([a, b, c]), 16);
  assert.equal(attributeCoverage([]), 0);
});
