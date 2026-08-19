/**
 * inventory.test.ts — proves confidence-gated inventory subtraction
 * (wave 1A, SPEC "Domain rules").
 *
 * Acceptance contract: purchase_requirement = max(0, aggregated_requirement
 * − usable_inventory), where usable inventory subtracts ONLY entries whose
 * confidence is `confirmed` or `assumed_staple`. An `inferred` entry is
 * NEVER silently subtracted at any quantity — it becomes a confirmation
 * question, and only when confirming it could actually reduce a purchase
 * (questions are few and high-value, never a pantry review). Ranges are
 * purchased against their max; "to taste" never becomes a number;
 * cross-dimension inventory subtracts only through curated values and is
 * otherwise reported with the exact refusal, never guessed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleFactor, scaleQuantity } from '../domain/src/scale.ts';
import type { ScaledRequirementLine } from '../domain/src/scale.ts';
import { aggregateRequirements } from '../domain/src/aggregate.ts';
import type { AggregatedLine } from '../domain/src/aggregate.ts';
import { subtractInventory } from '../domain/src/inventoryMath.ts';
import type { NetRequirementLine } from '../domain/src/inventoryMath.ts';
import type { IngredientRegistry, IngredientRegistryEntry } from '../domain/src/catalog.ts';
import { FACTOR_TO_CANONICAL } from '../domain/src/units.ts';
import { ZERO, eq, isZero, mul, rational, sign, sub } from '../domain/src/qty.ts';
import type { Rational } from '../domain/src/qty.ts';
import type {
  IngredientQuantity,
  InventoryConfidence,
  InventoryEntry,
  InventorySource,
  Unit,
} from '../domain/src/recipe.ts';

// ---------------------------------------------------------------------------
// Fixture helpers (house style: synthetic registries with explicit curated
// values, provenance ids derived from a recipe letter)
// ---------------------------------------------------------------------------

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

function registryOf(...entries: readonly IngredientRegistryEntry[]): IngredientRegistry {
  return new Map(entries.map((e) => [e.id, e]));
}

function req(
  recipe: string,
  lineId: string,
  ingredientId: string,
  quantity: IngredientQuantity,
): ScaledRequirementLine {
  return {
    recipe_id: `recipe-${recipe}`,
    plan_meal_id: `meal-${recipe}`,
    recipe_ingredient_line_id: lineId,
    ingredient_id: ingredientId,
    display_name: ingredientId,
    quantity,
    preparation: null,
    optional: false,
  };
}

function exact(amount: Rational, unit: Unit): IngredientQuantity {
  return { kind: 'exact', amount, unit };
}

function inv(
  id: string,
  ingredientId: string,
  quantity: Rational,
  unit: Unit,
  confidence: InventoryConfidence,
  source: InventorySource = 'manual',
): InventoryEntry {
  return {
    id,
    household_id: 'hh-1',
    ingredient_id: ingredientId,
    quantity,
    unit,
    confidence,
    source,
    best_by_utc: null,
    updated_at_utc: '2026-08-19T00:00:00.000Z',
  };
}

function amountLines(lines: readonly (AggregatedLine | NetRequirementLine)[]): readonly NetRequirementLine[] {
  return lines.flatMap((l) => (l.kind === 'amount' && 'purchase_requirement' in l ? [l] : []));
}

/** The formula, asserted on every net line in this file:
 * purchase = max(0, required − usable), deducted = min(required, usable). */
function assertSubtractionIdentity(lines: readonly (AggregatedLine | NetRequirementLine)[]): void {
  for (const line of amountLines(lines)) {
    assert.ok(sign(line.purchase_requirement) >= 0, 'purchase requirement is never negative');
    assert.ok(sign(line.inventory_deducted) >= 0, 'deduction is never negative');
    assert.ok(
      eq(sub(line.required_quantity, line.inventory_deducted), line.purchase_requirement),
      'required − deducted = purchase, exactly',
    );
    const uncovered = sub(line.required_quantity, line.usable_inventory);
    const expected = sign(uncovered) === 1 ? uncovered : ZERO;
    assert.ok(
      eq(line.purchase_requirement, expected),
      'purchase = max(0, required − usable), exactly',
    );
  }
}

// ---------------------------------------------------------------------------
// The formula
// ---------------------------------------------------------------------------

test('confirmed inventory subtracts exactly: 500 g needed, 200 g confirmed ⇒ buy 300 g', () => {
  const reg = registryOf(entry('flour', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'flour', exact(rational(500n), 'g'))], reg);
  const result = subtractInventory(lines, [inv('i-1', 'flour', rational(200n), 'g', 'confirmed')], reg);
  const [flour] = amountLines(result.lines);
  assert.ok(flour !== undefined);
  assert.deepEqual(flour.usable_inventory, { num: 200n, den: 1n });
  assert.deepEqual(flour.inventory_deducted, { num: 200n, den: 1n });
  assert.deepEqual(flour.purchase_requirement, { num: 300n, den: 1n });
  // Traceability survives subtraction untouched (DoD 5).
  assert.deepEqual(flour.contributions, [
    { recipe_id: 'recipe-a', plan_meal_id: 'meal-a', recipe_ingredient_line_id: 'a-1', amount: { num: 500n, den: 1n } },
  ]);
  assert.deepEqual(result.confirmation_questions, []);
  assertSubtractionIdentity(result.lines);
});

test('inventory exceeding the requirement clamps at zero — deducted = required, purchase = 0, never negative', () => {
  const reg = registryOf(entry('flour', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'flour', exact(rational(300n), 'g'))], reg);
  const result = subtractInventory(lines, [inv('i-1', 'flour', rational(500n), 'g', 'assumed_staple')], reg);
  const [flour] = amountLines(result.lines);
  assert.ok(flour !== undefined);
  assert.deepEqual(flour.usable_inventory, { num: 500n, den: 1n }, 'usable is reported uncapped');
  assert.deepEqual(flour.inventory_deducted, { num: 300n, den: 1n }, 'deduction is capped at the requirement');
  assert.ok(isZero(flour.purchase_requirement));
  assertSubtractionIdentity(result.lines);
});

test('subtraction arithmetic is exact: 1/3 cup needed minus 1/4 cup on hand = exactly 1/12 cup in ml', () => {
  const reg = registryOf(entry('cream', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'cream', exact(rational(1n, 3n), 'cup'))], reg);
  const result = subtractInventory(lines, [inv('i-1', 'cream', rational(1n, 4n), 'cup', 'confirmed')], reg);
  const [cream] = amountLines(result.lines);
  assert.ok(cream !== undefined);
  assert.equal(cream.unit, 'ml');
  // (1/3 − 1/4) cup = 1/12 cup, through the exact tsp-derived cup factor —
  // bigint rationals an IEEE double cannot fake.
  assert.deepEqual(cream.purchase_requirement, mul(rational(1n, 12n), FACTOR_TO_CANONICAL.cup));
  assertSubtractionIdentity(result.lines);
});

// ---------------------------------------------------------------------------
// The confidence gate — the property, not just an example
// ---------------------------------------------------------------------------

test('the gate: only confirmed and assumed_staple subtract; inferred subtracts NOTHING at any quantity', () => {
  const reg = registryOf(entry('flour', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'flour', exact(rational(500n), 'g'))], reg);
  const allConfidences: readonly InventoryConfidence[] = ['confirmed', 'assumed_staple', 'inferred'];
  for (const confidence of allConfidences) {
    // An enormous claimed quantity, to catch any quantity-conditional leak.
    const result = subtractInventory(lines, [inv('i-1', 'flour', rational(1000000n), 'g', confidence)], reg);
    const [flour] = amountLines(result.lines);
    assert.ok(flour !== undefined);
    const usable = confidence === 'confirmed' || confidence === 'assumed_staple';
    if (usable) {
      assert.deepEqual(flour.inventory_deducted, { num: 500n, den: 1n }, `${confidence} subtracts`);
      assert.equal(result.confirmation_questions.length, 0);
    } else {
      assert.ok(isZero(flour.inventory_deducted), `${confidence} must never be silently subtracted`);
      assert.deepEqual(flour.purchase_requirement, { num: 500n, den: 1n });
      assert.equal(result.confirmation_questions.length, 1, `${confidence} becomes a question instead`);
    }
    assertSubtractionIdentity(result.lines);
  }
});

test('mixed confidences on one line: confirmed subtracts, inferred rides along only as a question', () => {
  const reg = registryOf(entry('flour', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'flour', exact(rational(500n), 'g'))], reg);
  const result = subtractInventory(
    lines,
    [
      inv('i-1', 'flour', rational(100n), 'g', 'confirmed'),
      inv('i-2', 'flour', rational(10000n), 'g', 'inferred'),
    ],
    reg,
  );
  const [flour] = amountLines(result.lines);
  assert.ok(flour !== undefined);
  assert.deepEqual(flour.inventory_deducted, { num: 100n, den: 1n }, 'only the confirmed 100 g subtracts');
  assert.deepEqual(flour.purchase_requirement, { num: 400n, den: 1n });
  assert.equal(result.confirmation_questions.length, 1);
  assert.equal(result.confirmation_questions[0]?.inventory_entry_id, 'i-2');
  assertSubtractionIdentity(result.lines);
});

// ---------------------------------------------------------------------------
// Confirmation questions — the SPEC's lemons, and the fewness properties
// ---------------------------------------------------------------------------

test('the SPEC example: plan needs 4 lemons, we think you have 2 — the question carries the exact numbers', () => {
  const reg = registryOf(entry('lemon', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'lemon', exact(rational(4n), 'count'))], reg);
  const result = subtractInventory(lines, [inv('i-1', 'lemon', rational(2n), 'count', 'inferred', 'surplus')], reg);
  assert.deepEqual(result.confirmation_questions, [
    {
      inventory_entry_id: 'i-1',
      ingredient_id: 'lemon',
      display_name: 'lemon',
      dimension: 'count',
      unit: 'count',
      claimed_quantity: { num: 2n, den: 1n },
      required_quantity: { num: 4n, den: 1n },
      purchase_without_confirmation: { num: 4n, den: 1n },
      purchase_if_confirmed: { num: 2n, den: 1n },
    },
  ]);
  // Unanswered, nothing was subtracted.
  const [lemon] = amountLines(result.lines);
  assert.ok(lemon !== undefined && isZero(lemon.inventory_deducted));
  assertSubtractionIdentity(result.lines);
});

test('no question when the purchase is already zero — asking could not change what is bought', () => {
  const reg = registryOf(entry('lemon', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'lemon', exact(rational(4n), 'count'))], reg);
  const result = subtractInventory(
    lines,
    [
      inv('i-1', 'lemon', rational(6n), 'count', 'confirmed'),
      inv('i-2', 'lemon', rational(2n), 'count', 'inferred'),
    ],
    reg,
  );
  assert.deepEqual(result.confirmation_questions, [], 'a covered line never asks');
  assertSubtractionIdentity(result.lines);
});

test('inventory for ingredients the plan does not need is ignored entirely — never a 47-item pantry review', () => {
  const reg = registryOf(entry('flour', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'flour', exact(rational(500n), 'g'))], reg);
  const pantry = [
    inv('p-1', 'capers', rational(1n), 'count', 'inferred'),
    inv('p-2', 'anchovies', rational(2n), 'count', 'inferred'),
    inv('p-3', 'saffron', rational(1n), 'g', 'inferred'),
    inv('p-4', 'flour', rational(100n), 'g', 'confirmed'),
  ];
  const result = subtractInventory(lines, pantry, reg);
  assert.deepEqual(result.confirmation_questions, [], 'off-plan inferred entries ask nothing');
  assert.deepEqual(result.unusable_inventory, [], 'off-plan entries are not reported either');
  const [flour] = amountLines(result.lines);
  assert.deepEqual(flour?.inventory_deducted, { num: 100n, den: 1n }, 'the on-plan entry still subtracts');
  assertSubtractionIdentity(result.lines);
});

// ---------------------------------------------------------------------------
// Cross-dimension inventory — curated bridge or explicit refusal
// ---------------------------------------------------------------------------

test('cross-dimension inventory subtracts ONLY through a curated per-item weight (4 heads on hand × 5 g against a gram line)', () => {
  const reg = registryOf(entry('garlic', null, rational(5n)));
  const lines = aggregateRequirements([req('a', 'a-1', 'garlic', exact(rational(120n), 'g'))], reg);
  const result = subtractInventory(lines, [inv('i-1', 'garlic', rational(4n), 'count', 'confirmed')], reg);
  const [garlic] = amountLines(result.lines);
  assert.ok(garlic !== undefined);
  assert.deepEqual(garlic.inventory_deducted, { num: 20n, den: 1n }, '4 count × 5 g = 20 g, exactly');
  assert.deepEqual(garlic.purchase_requirement, { num: 100n, den: 1n });
  assert.deepEqual(result.unusable_inventory, []);
  assertSubtractionIdentity(result.lines);
});

test('cross-dimension inventory WITHOUT a curated value is reported with the exact refusal, never guessed', () => {
  const reg = registryOf(entry('ginger', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'ginger', exact(rational(120n), 'g'))], reg);
  const result = subtractInventory(lines, [inv('i-1', 'ginger', rational(4n), 'count', 'confirmed')], reg);
  const [ginger] = amountLines(result.lines);
  assert.ok(ginger !== undefined);
  assert.ok(isZero(ginger.inventory_deducted), 'nothing was invented to make the subtraction work');
  assert.deepEqual(ginger.purchase_requirement, { num: 120n, den: 1n });
  assert.deepEqual(result.unusable_inventory, [
    {
      inventory_entry_id: 'i-1',
      ingredient_id: 'ginger',
      confidence: 'confirmed',
      refusal: {
        kind: 'not_convertible',
        ingredient_id: 'ginger',
        from_dimension: 'count',
        to_dimension: 'mass',
        missing: ['per_item_weight_g'],
      },
    },
  ]);
  assert.deepEqual(result.confirmation_questions, []);
  assertSubtractionIdentity(result.lines);
});

test('one entry never subtracts twice across a split (mass + count) ingredient', () => {
  // No curated bridge ⇒ aggregation keeps a mass line AND a count line.
  const reg = registryOf(entry('thing', null, null));
  const lines = aggregateRequirements(
    [
      req('a', 'a-1', 'thing', exact(rational(200n), 'g')),
      req('b', 'b-1', 'thing', exact(rational(3n), 'count')),
    ],
    reg,
  );
  const result = subtractInventory(
    lines,
    [
      inv('i-1', 'thing', rational(1n), 'count', 'confirmed'),
      inv('i-2', 'thing', rational(50n), 'g', 'confirmed'),
      inv('i-3', 'thing', ZERO, 'g', 'confirmed'), // nothing on hand: ignored
    ],
    reg,
  );
  const [mass, count] = amountLines(result.lines);
  assert.ok(mass !== undefined && count !== undefined);
  assert.equal(mass.dimension, 'mass');
  assert.equal(count.dimension, 'count');
  assert.deepEqual(mass.inventory_deducted, { num: 50n, den: 1n }, 'the gram entry hit the mass line only');
  assert.deepEqual(count.inventory_deducted, { num: 1n, den: 1n }, 'the count entry hit the count line only');
  assert.deepEqual(mass.purchase_requirement, { num: 150n, den: 1n });
  assert.deepEqual(count.purchase_requirement, { num: 2n, den: 1n });
  assertSubtractionIdentity(result.lines);
});

// ---------------------------------------------------------------------------
// Ranges, "to taste", determinism
// ---------------------------------------------------------------------------

test('ranges are purchased against their MAX through the whole pipeline — never the midpoint, never the min', () => {
  const reg = registryOf(entry('chili', null, null));
  // 2–4 count scaled 4→6 servings ⇒ range 3–6; the requirement is 6 (max).
  const scaled = scaleQuantity(
    { kind: 'range', min: rational(2n), max: rational(4n), unit: 'count' },
    scaleFactor(4, 6),
  );
  const lines = aggregateRequirements([req('a', 'a-1', 'chili', scaled)], reg);
  const [before] = lines;
  assert.ok(before !== undefined && before.kind === 'amount');
  assert.deepEqual(before.required_quantity, { num: 6n, den: 1n }, 'aggregated at max: 4 × 3/2 = 6, not 4.5 (midpoint) or 3 (min)');
  const result = subtractInventory(lines, [inv('i-1', 'chili', rational(2n), 'count', 'confirmed')], reg);
  const [chili] = amountLines(result.lines);
  assert.deepEqual(chili?.purchase_requirement, { num: 4n, den: 1n }, 'max 6 − confirmed 2 = 4');
  assertSubtractionIdentity(result.lines);
});

test('a "to taste" line passes through as itself — never a number, never a subtraction target', () => {
  const reg = registryOf(entry('salt', null, null));
  const lines = aggregateRequirements([req('a', 'a-1', 'salt', { kind: 'to_taste' })], reg);
  const result = subtractInventory(lines, [inv('i-1', 'salt', rational(500n), 'g', 'confirmed')], reg);
  assert.equal(result.lines.length, 1);
  const [salt] = result.lines;
  assert.ok(salt !== undefined);
  assert.equal(salt.kind, 'to_taste');
  assert.equal(salt, lines[0], 'the very same value, not a rebuilt one');
  assert.ok(!('purchase_requirement' in salt), 'a to-taste line carries no purchase number at all');
  assert.deepEqual(result.confirmation_questions, []);
});

test('deterministic: shuffled inventory order yields a byte-identical result', () => {
  const reg = registryOf(entry('flour', null, null), entry('lemon', null, null), entry('garlic', null, rational(5n)));
  const lines = aggregateRequirements(
    [
      req('a', 'a-1', 'flour', exact(rational(500n), 'g')),
      req('a', 'a-2', 'lemon', exact(rational(4n), 'count')),
      req('b', 'b-1', 'garlic', exact(rational(120n), 'g')),
    ],
    reg,
  );
  const pantry = [
    inv('i-1', 'flour', rational(100n), 'g', 'confirmed'),
    inv('i-2', 'flour', rational(50n), 'g', 'assumed_staple'),
    inv('i-3', 'lemon', rational(2n), 'count', 'inferred'),
    inv('i-4', 'garlic', rational(4n), 'count', 'confirmed'),
    inv('i-5', 'lemon', rational(1n), 'count', 'inferred'),
  ];
  const base = subtractInventory(lines, pantry, reg);
  assert.deepEqual(subtractInventory(lines, [...pantry].reverse(), reg), base);
  assert.deepEqual(
    subtractInventory(lines, [...pantry.filter((_, i) => i % 2 === 1), ...pantry.filter((_, i) => i % 2 === 0)], reg),
    base,
  );
  // Question ordering key visible in the output.
  assert.deepEqual(
    base.confirmation_questions.map((q) => q.inventory_entry_id),
    ['i-3', 'i-5'],
  );
  assertSubtractionIdentity(base.lines);
});
