/**
 * aggregate.test.ts — proves serving scaling + cross-recipe aggregation
 * with full line-level traceability (wave 1A, DoD 4 and 5).
 *
 * Acceptance contract: requirements from multiple recipes scaled to target
 * servings merge into a single line ONLY when canonical ingredient id AND
 * base-unit dimension match; every aggregated number links back to each
 * contributing recipe line and amount (total = exact sum of contributions);
 * and the four garlic alias fixture forms — "garlic cloves", "cloves of
 * garlic", "fresh garlic", "3 cloves garlic, minced" — produce EXACTLY ONE
 * aggregated line. Cross-dimension merging happens only through curated
 * registry values and is otherwise refused explicitly in the data.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaleFactor, scaleQuantity, scaleRecipeRequirements } from '../domain/src/scale.ts';
import type { ScaledRequirementLine } from '../domain/src/scale.ts';
import { aggregateRequirements, UnknownIngredientError } from '../domain/src/aggregate.ts';
import type { AggregatedAmountLine, AggregatedLine } from '../domain/src/aggregate.ts';
import { matchIngredient } from '../domain/src/normalize.ts';
import { parseIngredientRegistry } from '../domain/src/catalog.ts';
import type { IngredientRegistry, IngredientRegistryEntry } from '../domain/src/catalog.ts';
import { ZERO, add, eq, fromInt, rational } from '../domain/src/qty.ts';
import type { Rational } from '../domain/src/qty.ts';
import type { IngredientQuantity, Recipe, RecipeIngredientLine, Unit } from '../domain/src/recipe.ts';

const here = dirname(fileURLToPath(import.meta.url));
const registryRaw: unknown = JSON.parse(
  readFileSync(join(here, '..', 'data', 'ingredients.json'), 'utf8'),
);
const registry = parseIngredientRegistry(registryRaw);

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Synthetic registry entry with explicit curated conversion values. */
function entry(
  id: string,
  density: Rational | null,
  perItemWeight: Rational | null,
): IngredientRegistryEntry {
  return {
    id,
    display_name: id,
    aliases: [],
    allergen_classes: [],
    store_section: 'other',
    density_g_per_ml: density,
    per_item_weight_g: perItemWeight,
    package_options: [],
  };
}

function registryOf(...entries: readonly IngredientRegistryEntry[]): IngredientRegistry {
  return new Map(entries.map((e) => [e.id, e]));
}

/** A scaled requirement line with full provenance ids derived from `recipe`. */
function req(
  recipe: string,
  lineId: string,
  ingredientId: string,
  quantity: IngredientQuantity,
  preparation: string | null = null,
): ScaledRequirementLine {
  return {
    recipe_id: `recipe-${recipe}`,
    plan_meal_id: `meal-${recipe}`,
    recipe_ingredient_line_id: lineId,
    ingredient_id: ingredientId,
    display_name: ingredientId,
    quantity,
    preparation,
    optional: false,
  };
}

function exact(amount: Rational, unit: Unit): IngredientQuantity {
  return { kind: 'exact', amount, unit };
}

function amountLines(lines: readonly AggregatedLine[]): readonly AggregatedAmountLine[] {
  return lines.flatMap((l) => (l.kind === 'amount' ? [l] : []));
}

/** The ledger property: every aggregated total is the EXACT sum of its
 * contribution amounts — asserted on every aggregation in this file. */
function assertTotalsEqualContributions(lines: readonly AggregatedLine[]): void {
  for (const line of amountLines(lines)) {
    assert.ok(line.contributions.length > 0, 'every amount line has at least one contribution');
    let sum = ZERO;
    for (const c of line.contributions) sum = add(sum, c.amount);
    assert.ok(
      eq(line.required_quantity, sum),
      `total of '${line.ingredient_id}' (${line.dimension}) must equal the sum of its contributions`,
    );
  }
}

// ---------------------------------------------------------------------------
// The four-garlic alias fixture — the headline acceptance criterion (DoD 4)
// ---------------------------------------------------------------------------

const GARLIC_FORMS = [
  'garlic cloves',
  'cloves of garlic',
  'fresh garlic',
  '3 cloves garlic, minced',
] as const;

test('the four garlic alias forms all resolve to the single canonical id "garlic"', () => {
  for (const form of GARLIC_FORMS) {
    const r = matchIngredient(form, registry);
    assert.equal(r.kind, 'matched', `${JSON.stringify(form)} must resolve`);
    if (r.kind === 'matched') assert.equal(r.ingredient_id, 'garlic');
  }
});

/** The four forms arriving from four different recipes, resolved through
 * matchIngredient (never hand-assigned ids), one already scaled 4→6
 * servings: 2 cloves × 3/2 = 3 cloves. */
function garlicFixtureLines(): readonly ScaledRequirementLine[] {
  const ids = GARLIC_FORMS.map((form) => {
    const r = matchIngredient(form, registry);
    assert.equal(r.kind, 'matched');
    return r.kind === 'matched' ? r.ingredient_id : '';
  });
  const scaled = scaleQuantity(exact(rational(2n), 'count'), scaleFactor(4, 6)); // 2 × 3/2 = 3
  return [
    req('a', 'a-garlic', ids[0] ?? '', exact(rational(3n), 'count')),
    req('b', 'b-garlic', ids[1] ?? '', exact(rational(2n), 'count')),
    req('c', 'c-garlic', ids[2] ?? '', exact(rational(1n), 'count'), 'whole'),
    req('d', 'd-garlic', ids[3] ?? '', scaled, 'minced'),
  ];
}

test('four garlic alias forms from four recipes produce EXACTLY ONE aggregated line with all four contributions', () => {
  const lines = aggregateRequirements(garlicFixtureLines(), registry);
  assert.equal(lines.length, 1, 'exactly one aggregated line');
  const [garlic] = amountLines(lines);
  assert.ok(garlic !== undefined);
  assert.equal(garlic.kind, 'amount');
  assert.equal(garlic.ingredient_id, 'garlic');
  assert.equal(garlic.dimension, 'count');
  assert.equal(garlic.unit, 'count');
  // 3 + 2 + 1 + 3 = 9 cloves, exactly.
  assert.deepEqual(garlic.required_quantity, { num: 9n, den: 1n });

  // Full provenance: all four recipes attached, each with its own line id
  // and amount — "why am I buying this?" answerable from the value alone.
  assert.equal(garlic.contributions.length, 4);
  assert.deepEqual(garlic.contributions, [
    { recipe_id: 'recipe-a', plan_meal_id: 'meal-a', recipe_ingredient_line_id: 'a-garlic', amount: { num: 3n, den: 1n } },
    { recipe_id: 'recipe-b', plan_meal_id: 'meal-b', recipe_ingredient_line_id: 'b-garlic', amount: { num: 2n, den: 1n } },
    { recipe_id: 'recipe-c', plan_meal_id: 'meal-c', recipe_ingredient_line_id: 'c-garlic', amount: { num: 1n, den: 1n } },
    { recipe_id: 'recipe-d', plan_meal_id: 'meal-d', recipe_ingredient_line_id: 'd-garlic', amount: { num: 3n, den: 1n } },
  ]);
  // Differing preparation states are preserved, never a merge blocker.
  assert.deepEqual(garlic.preparations, ['minced', 'whole']);
  assert.deepEqual(garlic.merge_refusals, []);
  assertTotalsEqualContributions(lines);
});

// ---------------------------------------------------------------------------
// Dimension rule: merge needs id AND dimension; bridges only via curated data
// ---------------------------------------------------------------------------

test('same id, different dimension, NO curated bridge ⇒ two lines with the refusal explicit in the data', () => {
  const neither = entry('test_neither', null, null);
  const reg = registryOf(neither);
  const input = [
    req('a', 'a-1', 'test_neither', exact(rational(200n), 'g')),
    req('b', 'b-1', 'test_neither', exact(rational(2n), 'count')),
  ];
  const lines = aggregateRequirements(input, reg);
  assert.equal(lines.length, 2, 'stays two lines — never a guessed conversion');
  const [mass, count] = amountLines(lines);
  assert.ok(mass !== undefined && count !== undefined);
  // Deterministic ordering: mass before count for the same ingredient.
  assert.equal(mass.dimension, 'mass');
  assert.equal(count.dimension, 'count');
  assert.deepEqual(mass.required_quantity, { num: 200n, den: 1n });
  assert.deepEqual(count.required_quantity, { num: 2n, den: 1n });
  // The refusal is explicit: which conversion failed and which curated
  // field is missing — carried on BOTH sides of the split.
  for (const line of [mass, count]) {
    assert.deepEqual(line.merge_refusals, [
      {
        kind: 'not_convertible',
        ingredient_id: 'test_neither',
        from_dimension: 'count',
        to_dimension: 'mass',
        missing: ['per_item_weight_g'],
      },
    ]);
  }
  assertTotalsEqualContributions(lines);
});

test('same id, different dimension, WITH curated per-item weight ⇒ ONE line, converted exactly (real garlic: 5 g/clove)', () => {
  // data/ingredients.json curates garlic per_item_weight_g = 5.
  const input = [
    req('a', 'a-1', 'garlic', exact(rational(100n), 'g')),
    req('b', 'b-1', 'garlic', exact(rational(4n), 'count')),
  ];
  const lines = aggregateRequirements(input, registry);
  assert.equal(lines.length, 1);
  const [garlic] = amountLines(lines);
  assert.ok(garlic !== undefined);
  assert.equal(garlic.dimension, 'mass');
  assert.equal(garlic.unit, 'g');
  // 100 g + 4 × 5 g = 120 g, exactly.
  assert.deepEqual(garlic.required_quantity, { num: 120n, den: 1n });
  assert.deepEqual(garlic.merge_refusals, []);
  const b = garlic.contributions.find((c) => c.recipe_id === 'recipe-b');
  assert.deepEqual(b?.amount, { num: 20n, den: 1n });
  assertTotalsEqualContributions(lines);
});

test('same id, different dimension, WITH curated density ⇒ ONE mass line, converted exactly', () => {
  const oil = entry('test_oil', rational(91n, 100n), null); // 0.91 g/ml exactly
  const reg = registryOf(oil);
  const input = [
    req('a', 'a-1', 'test_oil', exact(rational(100n), 'ml')),
    req('b', 'b-1', 'test_oil', exact(rational(50n), 'g')),
  ];
  const lines = aggregateRequirements(input, reg);
  assert.equal(lines.length, 1);
  const [line] = amountLines(lines);
  assert.ok(line !== undefined);
  assert.equal(line.unit, 'g');
  // 100 ml × 91/100 g/ml + 50 g = 91 + 50 = 141 g, exactly.
  assert.deepEqual(line.required_quantity, { num: 141n, den: 1n });
  assertTotalsEqualContributions(lines);
});

// ---------------------------------------------------------------------------
// Scaling
// ---------------------------------------------------------------------------

test('a range scales min and max independently — never a midpoint', () => {
  const scaled = scaleQuantity(
    { kind: 'range', min: rational(1n), max: rational(2n), unit: 'cup' },
    scaleFactor(2, 3), // 3/2
  );
  assert.deepEqual(scaled, {
    kind: 'range',
    min: { num: 3n, den: 2n },
    max: { num: 3n, den: 1n },
    unit: 'cup',
  });
});

test('a "to taste" line survives scaling untouched — never folded into a number', () => {
  const toTaste: IngredientQuantity = { kind: 'to_taste' };
  const scaled = scaleQuantity(toTaste, scaleFactor(4, 12));
  assert.equal(scaled, toTaste); // the very same value, not a rebuilt one
  assert.deepEqual(scaled, { kind: 'to_taste' });
});

test('fractional scale factor stays exact: 3 servings from a 4-serving recipe, no float drift', () => {
  const factor = scaleFactor(4, 3);
  assert.deepEqual(factor, { num: 3n, den: 4n });
  // 1/3 cup × 3/4 = 1/4 cup — exact bigints an IEEE double cannot fake.
  const scaled = scaleQuantity(exact(rational(1n, 3n), 'cup'), factor);
  assert.deepEqual(scaled, { kind: 'exact', amount: { num: 1n, den: 4n }, unit: 'cup' });
});

test('scaleRecipeRequirements computes the factor once and carries full provenance ids', () => {
  const ingredients: readonly RecipeIngredientLine[] = [
    { id: 'l1', ingredient_id: 'garlic', display_name: 'garlic cloves', quantity: exact(rational(2n), 'count'), preparation: 'minced', optional: false },
    { id: 'l2', ingredient_id: 'salt', display_name: 'salt', quantity: { kind: 'to_taste' }, preparation: null, optional: false },
  ];
  const recipe: Recipe = {
    id: 'r-1',
    slug: 'r-1',
    name: 'r-1',
    description: '',
    servings_default: 4,
    attributes: {
      protein: 'none', cuisine: 'other', flavour: [], texture: [],
      spice: 'none', richness: 'light', method: 'no_cook', effort: 'low',
    },
    dietary_tags: [],
    allergens: [],
    equipment: [],
    cost_band: 'low',
    dish_count: 0,
    total_time_seconds: 0,
    active_time_seconds: 0,
    ingredients,
    steps: [],
  };
  const lines = scaleRecipeRequirements(recipe, 'meal-1', 6); // factor 3/2
  assert.deepEqual(lines, [
    {
      recipe_id: 'r-1', plan_meal_id: 'meal-1', recipe_ingredient_line_id: 'l1',
      ingredient_id: 'garlic', display_name: 'garlic cloves',
      quantity: { kind: 'exact', amount: { num: 3n, den: 1n }, unit: 'count' },
      preparation: 'minced', optional: false,
    },
    {
      recipe_id: 'r-1', plan_meal_id: 'meal-1', recipe_ingredient_line_id: 'l2',
      ingredient_id: 'salt', display_name: 'salt',
      quantity: { kind: 'to_taste' },
      preparation: null, optional: false,
    },
  ]);
});

// ---------------------------------------------------------------------------
// Ranges and to-taste through aggregation
// ---------------------------------------------------------------------------

test('range contributions aggregate conservatively at max, bounds converted independently first', () => {
  const input = [
    req('a', 'a-1', 'garlic', { kind: 'range', min: rational(2n), max: rational(4n), unit: 'count' }),
    req('b', 'b-1', 'garlic', exact(rational(1n), 'count')),
  ];
  const lines = aggregateRequirements(input, registry);
  const [garlic] = amountLines(lines);
  assert.ok(garlic !== undefined);
  // 4 (range max, conservative — GroceryLine contract) + 1 = 5.
  assert.deepEqual(garlic.required_quantity, { num: 5n, den: 1n });
  assert.deepEqual(garlic.contributions.map((c) => c.amount), [
    { num: 4n, den: 1n },
    { num: 1n, den: 1n },
  ]);
  assertTotalsEqualContributions(lines);
});

test('"to taste" aggregates as a distinct presence line — never zero, never a number, full provenance', () => {
  const salt = entry('test_salt', null, null);
  const reg = registryOf(salt);
  const input = [
    req('a', 'a-1', 'test_salt', exact(rational(1n), 'tsp')),
    req('b', 'b-1', 'test_salt', { kind: 'to_taste' }),
    req('c', 'c-1', 'test_salt', { kind: 'to_taste' }),
  ];
  const lines = aggregateRequirements(input, reg);
  assert.equal(lines.length, 2);
  const [amount, toTaste] = lines;
  assert.ok(amount !== undefined && toTaste !== undefined);
  // Amount line first, the to-taste presence line last (deterministic order).
  assert.equal(amount.kind, 'amount');
  assert.equal(toTaste.kind, 'to_taste');
  if (toTaste.kind === 'to_taste') {
    assert.deepEqual(toTaste.contributions, [
      { recipe_id: 'recipe-b', plan_meal_id: 'meal-b', recipe_ingredient_line_id: 'b-1' },
      { recipe_id: 'recipe-c', plan_meal_id: 'meal-c', recipe_ingredient_line_id: 'c-1' },
    ]);
    assert.ok(!('required_quantity' in toTaste), 'a to-taste presence carries no number at all');
  }
  if (amount.kind === 'amount') {
    // The numeric tsp line is untouched by the to-taste presences.
    assert.equal(amount.contributions.length, 1);
  }
  assertTotalsEqualContributions(lines);
});

// ---------------------------------------------------------------------------
// Determinism + error path
// ---------------------------------------------------------------------------

test('aggregating a shuffled input yields a byte-identical result', () => {
  const salt = entry('test_salt', null, null);
  const neither = entry('test_neither', null, null);
  const garlicEntry = registry.get('garlic');
  assert.ok(garlicEntry !== undefined);
  const reg = registryOf(salt, neither, garlicEntry);
  const input = [
    ...garlicFixtureLines(),
    req('a', 'a-salt', 'test_salt', { kind: 'to_taste' }),
    req('b', 'b-salt', 'test_salt', exact(rational(1n, 2n), 'tsp')),
    req('c', 'c-n', 'test_neither', exact(rational(200n), 'g')),
    req('d', 'd-n', 'test_neither', exact(rational(2n), 'count')),
  ];
  // Two fixed permutations: reversed, and odd-indexed before even-indexed.
  const reversed = [...input].reverse();
  const interleaved = [
    ...input.filter((_, i) => i % 2 === 1),
    ...input.filter((_, i) => i % 2 === 0),
  ];
  const base = aggregateRequirements(input, reg);
  assert.deepEqual(aggregateRequirements(reversed, reg), base);
  assert.deepEqual(aggregateRequirements(interleaved, reg), base);
  // Ordering key visible in the output: ingredient id ascending.
  assert.deepEqual(
    base.map((l) => l.ingredient_id),
    ['garlic', 'test_neither', 'test_neither', 'test_salt', 'test_salt'],
  );
  assertTotalsEqualContributions(base);
});

test('an ingredient id absent from the registry fails loudly, never a silent skip', () => {
  assert.throws(
    () => aggregateRequirements([req('a', 'a-1', 'no_such_ingredient', exact(fromInt(1), 'g'))], registry),
    (err: unknown) => err instanceof UnknownIngredientError && err.ingredient_id === 'no_such_ingredient',
  );
});
