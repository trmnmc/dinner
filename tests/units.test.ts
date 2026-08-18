/**
 * units.test.ts — proves exact unit conversion (wave 1A).
 *
 * Acceptance contract: same-dimension conversions land in grams /
 * millilitres / count through EXACT Rational factors (assertions are on
 * num/den bigints — a float-derived factor cannot sneak past); cross-
 * dimension conversion happens ONLY via a curated density or per-item
 * weight and is otherwise reported as an explicit typed `not_convertible`
 * result naming the ingredient and both dimensions — never a guess.
 * "To taste" survives as itself; ranges convert min/max independently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_UNIT_BY_DIMENSION,
  FACTOR_TO_CANONICAL,
  UNIT_DIMENSIONS,
  canonicalizeQuantity,
  convertAmount,
  convertQuantity,
  toCanonical,
  unitDimension,
} from '../domain/src/units.ts';
import { parseIngredientRegistry } from '../domain/src/catalog.ts';
import type { IngredientRegistryEntry } from '../domain/src/catalog.ts';
import { ONE, eq, mul, rational, sign } from '../domain/src/qty.ts';
import type { Rational } from '../domain/src/qty.ts';
import type { Unit } from '../domain/src/recipe.ts';

const here = dirname(fileURLToPath(import.meta.url));
const registryRaw: unknown = JSON.parse(
  readFileSync(join(here, '..', 'data', 'ingredients.json'), 'utf8'),
);
const registry = parseIngredientRegistry(registryRaw);

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
  };
}

const OIL = entry('test_oil', rational(91n, 100n), null); // density only
const EGGISH = entry('test_egg', null, rational(50n)); // per-item weight only
const BOTH = entry('test_both', rational(1n), rational(10n)); // both curated
const NEITHER = entry('test_neither', null, null); // honest nulls

// ---------------------------------------------------------------------------
// Same-dimension conversion: total and exact
// ---------------------------------------------------------------------------

test('1 tsp is EXACTLY 4.92892159375 ml as a fraction — 157725491/32000000, never a float', () => {
  const c = toCanonical(ONE, 'tsp');
  assert.equal(c.unit, 'ml');
  assert.equal(c.dimension, 'volume');
  // Lowest terms of 492892159375/100000000000. A factor built from the IEEE
  // double 4.92892159375 could not reproduce these exact bigints.
  assert.deepEqual(c.amount, { num: 157725491n, den: 32000000n });
  assert.ok(eq(c.amount, rational(492892159375n, 100000000000n)));
});

test('tbsp / fl_oz / cup are exact tsp multiples (3, 6, 48)', () => {
  assert.deepEqual(FACTOR_TO_CANONICAL.tbsp, { num: 473176473n, den: 32000000n });
  assert.deepEqual(FACTOR_TO_CANONICAL.fl_oz, { num: 473176473n, den: 16000000n });
  assert.deepEqual(FACTOR_TO_CANONICAL.cup, { num: 473176473n, den: 2000000n });
  assert.ok(eq(FACTOR_TO_CANONICAL.tbsp, mul(rational(3n), FACTOR_TO_CANONICAL.tsp)));
  assert.ok(eq(FACTOR_TO_CANONICAL.fl_oz, mul(rational(6n), FACTOR_TO_CANONICAL.tsp)));
  assert.ok(eq(FACTOR_TO_CANONICAL.cup, mul(rational(48n), FACTOR_TO_CANONICAL.tsp)));
});

test('1 lb is EXACTLY 453.59237 g and 1 oz is exactly 1/16 of it', () => {
  assert.deepEqual(FACTOR_TO_CANONICAL.lb, { num: 45359237n, den: 100000n });
  assert.deepEqual(FACTOR_TO_CANONICAL.oz, { num: 45359237n, den: 1600000n });
  assert.ok(eq(mul(rational(16n), FACTOR_TO_CANONICAL.oz), FACTOR_TO_CANONICAL.lb));
});

test('kg and l scale by exactly 1000; g/ml/count are identity', () => {
  assert.deepEqual(toCanonical(rational(2n), 'kg').amount, { num: 2000n, den: 1n });
  assert.deepEqual(toCanonical(rational(3n, 2n), 'l').amount, { num: 1500n, den: 1n });
  assert.deepEqual(toCanonical(rational(7n), 'g').amount, { num: 7n, den: 1n });
  assert.deepEqual(toCanonical(rational(7n), 'ml').amount, { num: 7n, den: 1n });
  assert.deepEqual(toCanonical(rational(7n), 'count').amount, { num: 7n, den: 1n });
});

test('same-dimension conversion is TOTAL: every unit lands in its dimension base with a positive exact factor', () => {
  const allUnits = Object.keys(UNIT_DIMENSIONS) as Unit[];
  assert.equal(allUnits.length, 11); // the full frozen Unit union
  for (const u of allUnits) {
    const c = toCanonical(ONE, u);
    assert.equal(c.dimension, unitDimension(u));
    assert.equal(c.unit, CANONICAL_UNIT_BY_DIMENSION[c.dimension]);
    assert.equal(sign(c.amount), 1, `factor for ${u} must be positive`);
    assert.equal(typeof c.amount.num, 'bigint');
    assert.equal(typeof c.amount.den, 'bigint');
  }
});

test('same-dimension conversion never consults the ingredient — nulls in the registry cannot block it', () => {
  const r = convertAmount(rational(1n), 'kg', 'mass', NEITHER);
  assert.equal(r.kind, 'converted');
  assert.ok(r.kind === 'converted');
  assert.deepEqual(r.amount, { num: 1000n, den: 1n });
  assert.equal(r.unit, 'g');
});

// ---------------------------------------------------------------------------
// Cross-dimension: only via curated values, exact both ways
// ---------------------------------------------------------------------------

test('volume→mass multiplies by the curated density exactly', () => {
  const r = convertAmount(rational(100n), 'ml', 'mass', OIL);
  assert.ok(r.kind === 'converted');
  assert.deepEqual(r.amount, { num: 91n, den: 1n }); // 100 ml × 91/100 g/ml
  assert.equal(r.unit, 'g');
  assert.equal(r.dimension, 'mass');
});

test('mass→volume divides by the curated density exactly', () => {
  const r = convertAmount(rational(91n), 'g', 'volume', OIL);
  assert.ok(r.kind === 'converted');
  assert.deepEqual(r.amount, { num: 100n, den: 1n });
  assert.equal(r.unit, 'ml');
});

test('count→mass multiplies by the curated per-item weight exactly', () => {
  const r = convertAmount(rational(3n), 'count', 'mass', EGGISH);
  assert.ok(r.kind === 'converted');
  assert.deepEqual(r.amount, { num: 150n, den: 1n }); // 3 × 50 g
  assert.equal(r.unit, 'g');
});

test('mass→count divides exactly and keeps the fraction — never rounded here', () => {
  const r = convertAmount(rational(125n), 'g', 'count', EGGISH);
  assert.ok(r.kind === 'converted');
  assert.deepEqual(r.amount, { num: 5n, den: 2n }); // 125/50 stays 5/2
  assert.equal(r.unit, 'count');
});

test('volume↔count chains through BOTH curated values', () => {
  // 30 ml × 1 g/ml ÷ 10 g/item = 3 items
  const vc = convertAmount(rational(30n), 'ml', 'count', BOTH);
  assert.ok(vc.kind === 'converted');
  assert.deepEqual(vc.amount, { num: 3n, den: 1n });
  // 3 items × 10 g/item ÷ 1 g/ml = 30 ml
  const cv = convertAmount(rational(3n), 'count', 'volume', BOTH);
  assert.ok(cv.kind === 'converted');
  assert.deepEqual(cv.amount, { num: 30n, den: 1n });
});

test('the real registry drives real conversions: 3 garlic cloves = 15 g via curated per-item weight', () => {
  const garlic = registry.get('garlic');
  assert.ok(garlic !== undefined);
  const r = convertAmount(rational(3n), 'count', 'mass', garlic);
  assert.ok(r.kind === 'converted');
  assert.deepEqual(r.amount, { num: 15n, den: 1n });
});

// ---------------------------------------------------------------------------
// The not-convertible union: never a guess, never a silent fallback
// ---------------------------------------------------------------------------

test('volume→mass without a curated density is an explicit typed refusal naming ingredient and dimensions', () => {
  const salt = registry.get('kosher_salt');
  assert.ok(salt !== undefined);
  assert.equal(salt.density_g_per_ml, null); // brand-dependent — honestly null
  const r = convertAmount(rational(1n), 'tsp', 'mass', salt);
  assert.deepEqual(r, {
    kind: 'not_convertible',
    ingredient_id: 'kosher_salt',
    from_dimension: 'volume',
    to_dimension: 'mass',
    missing: ['density_g_per_ml'],
  });
});

test('mass→volume without density and count↔mass without per-item weight refuse with the exact missing field', () => {
  const mv = convertAmount(rational(10n), 'g', 'volume', EGGISH);
  assert.deepEqual(mv, {
    kind: 'not_convertible',
    ingredient_id: 'test_egg',
    from_dimension: 'mass',
    to_dimension: 'volume',
    missing: ['density_g_per_ml'],
  });
  const cm = convertAmount(rational(2n), 'count', 'mass', OIL);
  assert.deepEqual(cm, {
    kind: 'not_convertible',
    ingredient_id: 'test_oil',
    from_dimension: 'count',
    to_dimension: 'mass',
    missing: ['per_item_weight_g'],
  });
});

test('volume↔count lists EVERY missing curated field', () => {
  const neither = convertAmount(rational(1n), 'cup', 'count', NEITHER);
  assert.deepEqual(neither, {
    kind: 'not_convertible',
    ingredient_id: 'test_neither',
    from_dimension: 'volume',
    to_dimension: 'count',
    missing: ['density_g_per_ml', 'per_item_weight_g'],
  });
  const onlyDensity = convertAmount(rational(1n), 'count', 'volume', OIL);
  assert.deepEqual(onlyDensity, {
    kind: 'not_convertible',
    ingredient_id: 'test_oil',
    from_dimension: 'count',
    to_dimension: 'volume',
    missing: ['per_item_weight_g'],
  });
});

// ---------------------------------------------------------------------------
// Quantity-level: to_taste survives, ranges keep independent bounds
// ---------------------------------------------------------------------------

test("'to taste' is a distinct non-numeric state — conversion never folds it into a number", () => {
  assert.deepEqual(canonicalizeQuantity({ kind: 'to_taste' }), { kind: 'to_taste' });
  // Even a cross-dimension request against an entry with no curated data
  // must return to_taste itself — not a default amount, not a refusal.
  assert.deepEqual(convertQuantity({ kind: 'to_taste' }, 'mass', NEITHER), { kind: 'to_taste' });
  assert.deepEqual(convertQuantity({ kind: 'to_taste' }, 'count', BOTH), { kind: 'to_taste' });
});

test('an exact quantity canonicalizes exactly', () => {
  const q = canonicalizeQuantity({ kind: 'exact', amount: rational(3n, 2n), unit: 'tbsp' });
  assert.ok(q.kind === 'exact');
  // 3/2 × 473176473/32000000 = 1419529419/64000000 (already lowest terms)
  assert.deepEqual(q.amount, { num: 1419529419n, den: 64000000n });
  assert.equal(q.unit, 'ml');
});

test('a range canonicalizes min and max INDEPENDENTLY — never collapsed to a midpoint', () => {
  const q = canonicalizeQuantity({ kind: 'range', min: rational(3n, 2n), max: rational(2n), unit: 'tbsp' });
  assert.ok(q.kind === 'range'); // still a range, not an exact midpoint
  assert.deepEqual(q.min, { num: 1419529419n, den: 64000000n });
  assert.deepEqual(q.max, { num: 473176473n, den: 16000000n });
  assert.equal(eq(q.min, q.max), false);
  assert.equal(q.unit, 'ml');
});

test('a range converts across dimensions bound-by-bound via the curated value', () => {
  const q = convertQuantity({ kind: 'range', min: rational(1n), max: rational(2n), unit: 'count' }, 'mass', EGGISH);
  assert.ok(q.kind === 'range');
  assert.deepEqual(q.min, { num: 50n, den: 1n });
  assert.deepEqual(q.max, { num: 100n, den: 1n });
  assert.equal(q.unit, 'g');
});

test('a range that cannot cross dimensions is the same explicit refusal — the line is never thrown away', () => {
  const q = convertQuantity({ kind: 'range', min: rational(1n), max: rational(2n), unit: 'tbsp' }, 'mass', NEITHER);
  assert.deepEqual(q, {
    kind: 'not_convertible',
    ingredient_id: 'test_neither',
    from_dimension: 'volume',
    to_dimension: 'mass',
    missing: ['density_g_per_ml'],
  });
});

test('an exact quantity that cannot cross dimensions refuses too', () => {
  const q = convertQuantity({ kind: 'exact', amount: rational(1n), unit: 'cup' }, 'count', OIL);
  assert.ok(q.kind === 'not_convertible');
  assert.equal(q.ingredient_id, 'test_oil');
  assert.deepEqual(q.missing, ['per_item_weight_g']);
});
