/**
 * normalize.test.ts — proves ingredient text normalisation (wave 1A).
 *
 * Acceptance contract: text variants — including the garlic alias family
 * 'garlic cloves', 'cloves of garlic', 'fresh garlic', '3 cloves garlic,
 * minced' — normalise to ONE canonical ingredient id with a graded exact
 * Rational confidence (exact id > exact alias > normalised form). An
 * unresolved input returns an explicit unmatched result carrying the
 * normalised form; ambiguity between two entries is unmatched_ambiguous —
 * never a best guess, never a coin flip.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIDENCE_EXACT_ALIAS,
  CONFIDENCE_EXACT_ID,
  CONFIDENCE_NORMALIZED_FORM,
  matchIngredient,
  normalizeIngredientText,
} from '../domain/src/normalize.ts';
import { parseIngredientRegistry } from '../domain/src/catalog.ts';
import { compare } from '../domain/src/qty.ts';

const here = dirname(fileURLToPath(import.meta.url));
const registryRaw: unknown = JSON.parse(
  readFileSync(join(here, '..', 'data', 'ingredients.json'), 'utf8'),
);
const registry = parseIngredientRegistry(registryRaw);

// ---------------------------------------------------------------------------
// The garlic alias family — the acceptance criterion verbatim
// ---------------------------------------------------------------------------

const GARLIC_FORMS = [
  'garlic cloves',
  'cloves of garlic',
  'fresh garlic',
  '3 cloves garlic, minced',
] as const;

test('all four garlic text variants resolve to the SAME canonical id with a confidence', () => {
  for (const form of GARLIC_FORMS) {
    const r = matchIngredient(form, registry);
    assert.ok(r.kind === 'matched', `${JSON.stringify(form)} must match, got kind ${r.kind}`);
    assert.equal(r.ingredient_id, 'garlic', `${JSON.stringify(form)} must resolve to 'garlic'`);
    assert.equal(typeof r.confidence.num, 'bigint');
    assert.equal(typeof r.confidence.den, 'bigint');
    assert.equal(compare(r.confidence, { num: 0n, den: 1n }), 1, 'confidence must be positive');
  }
});

test('the garlic variants carry the right GRADE of confidence', () => {
  // 'garlic cloves' is a curated alias — exact alias hit at exactly 19/20.
  const alias = matchIngredient('garlic cloves', registry);
  assert.ok(alias.kind === 'matched');
  assert.equal(alias.grade, 'exact_alias');
  assert.deepEqual(alias.confidence, { num: 19n, den: 20n });

  // The other three only resolve through the normalisation pipeline — 4/5.
  for (const form of ['cloves of garlic', 'fresh garlic', '3 cloves garlic, minced']) {
    const r = matchIngredient(form, registry);
    assert.ok(r.kind === 'matched', form);
    assert.equal(r.grade, 'normalized_form', form);
    assert.deepEqual(r.confidence, { num: 4n, den: 5n }, form);
    assert.equal(r.normalized_form, 'garlic', form);
  }

  // The id itself is the top grade at exactly 1.
  const exact = matchIngredient('garlic', registry);
  assert.ok(exact.kind === 'matched');
  assert.equal(exact.grade, 'exact_id');
  assert.deepEqual(exact.confidence, { num: 1n, den: 1n });
});

test('confidence is strictly graded: exact id > exact alias > normalised-form hit', () => {
  assert.equal(compare(CONFIDENCE_EXACT_ID, CONFIDENCE_EXACT_ALIAS), 1);
  assert.equal(compare(CONFIDENCE_EXACT_ALIAS, CONFIDENCE_NORMALIZED_FORM), 1);
});

// ---------------------------------------------------------------------------
// Matching against ids and aliases
// ---------------------------------------------------------------------------

test('a spaced id form is an exact id hit ("olive oil" → olive_oil at 1)', () => {
  const r = matchIngredient('Olive Oil', registry);
  assert.ok(r.kind === 'matched');
  assert.equal(r.ingredient_id, 'olive_oil');
  assert.equal(r.grade, 'exact_id');
  assert.deepEqual(r.confidence, { num: 1n, den: 1n });
});

test('a curated alias hits exactly regardless of case and spacing', () => {
  const r = matchIngredient('  Extra   Virgin Olive Oil ', registry);
  assert.ok(r.kind === 'matched');
  assert.equal(r.ingredient_id, 'olive_oil');
  assert.equal(r.grade, 'exact_alias');
});

test('quantity, measure word and modifier stripping resolve real grocery-style lines', () => {
  const cases: readonly (readonly [string, string])[] = [
    ['2 medium carrots', 'carrot'],
    ['2-3 stalks celery', 'celery'],
    ['1 1/2 cups all purpose flour', 'all_purpose_flour'],
    ['a bunch of scallions', 'scallion'],
  ];
  for (const [text, expected] of cases) {
    const r = matchIngredient(text, registry);
    assert.ok(r.kind === 'matched', `${JSON.stringify(text)} → kind ${r.kind}`);
    assert.equal(r.ingredient_id, expected, JSON.stringify(text));
  }
});

// ---------------------------------------------------------------------------
// The text pipeline itself, step by step
// ---------------------------------------------------------------------------

test('normalisation strips quantities, units, trailing prep, and modifier words', () => {
  assert.equal(normalizeIngredientText('3 cloves garlic, minced'), 'garlic');
  assert.equal(normalizeIngredientText('Cloves of Garlic'), 'garlic');
  assert.equal(normalizeIngredientText('FRESH garlic'), 'garlic');
  assert.equal(normalizeIngredientText('a pinch of salt'), 'salt');
  assert.equal(normalizeIngredientText('½ cup milk'), 'milk');
  assert.equal(normalizeIngredientText('2 large ripe tomatoes, roughly chopped'), 'tomato');
  assert.equal(normalizeIngredientText('1 1/2 lb. boneless chicken thighs'), 'boneless chicken thigh');
});

test('singularisation is careful with words a naive rule would mangle', () => {
  assert.equal(normalizeIngredientText('couscous'), 'couscous');
  assert.equal(normalizeIngredientText('hummus'), 'hummus');
  assert.equal(normalizeIngredientText('radishes'), 'radish');
  assert.equal(normalizeIngredientText('berries'), 'berry');
});

// ---------------------------------------------------------------------------
// Failure paths: unmatched carries the WHY; ambiguity is never a coin flip
// ---------------------------------------------------------------------------

test('an unresolved input is an explicit unmatched result carrying the normalised form', () => {
  const r = matchIngredient('unicorn meat, finely minced', registry);
  assert.deepEqual(r, { kind: 'unmatched', normalized_form: 'unicorn meat' });
});

test('text that is nothing but quantity and unit is unmatched with an empty normalised form', () => {
  const r = matchIngredient('2 cups', registry);
  assert.deepEqual(r, { kind: 'unmatched', normalized_form: '' });
});

test('unmatched never carries an ingredient id or a confidence — no best guess to lean on', () => {
  const r = matchIngredient('flux capacitor fluid', registry);
  assert.equal(r.kind, 'unmatched');
  assert.equal('ingredient_id' in r, false);
  assert.equal('confidence' in r, false);
});

// A registry where two DIFFERENT entries normalise to the same form.
const ambiguousRegistry = parseIngredientRegistry({
  ingredients: [
    {
      id: 'salted_butter',
      display_name: 'salted butter',
      aliases: ['butter sticks'],
      allergen_classes: ['dairy'],
      store_section: 'dairy_eggs',
      density_g_per_ml: null,
      per_item_weight_g: null,
      package_options: [],
    },
    {
      id: 'unsalted_butter',
      display_name: 'unsalted butter',
      aliases: ['butter stick'],
      allergen_classes: ['dairy'],
      store_section: 'dairy_eggs',
      density_g_per_ml: null,
      per_item_weight_g: null,
      package_options: [],
    },
  ],
});

test('a normalised form claimed by two entries is unmatched_ambiguous naming every candidate — never a coin flip', () => {
  // 'large butter sticks' normalises to 'butter stick', which both entries
  // claim ('butter sticks' → singularised; 'butter stick' as authored).
  const r = matchIngredient('large butter sticks', ambiguousRegistry);
  assert.deepEqual(r, {
    kind: 'unmatched_ambiguous',
    normalized_form: 'butter stick',
    candidates: ['salted_butter', 'unsalted_butter'],
  });
});

test('an exact alias hit still wins over the ambiguity of its normalised form', () => {
  // As written, 'butter sticks' IS a curated alias of salted_butter — the
  // exact grade resolves before the ambiguous normalised form is consulted.
  const r = matchIngredient('butter sticks', ambiguousRegistry);
  assert.ok(r.kind === 'matched');
  assert.equal(r.ingredient_id, 'salted_butter');
  assert.equal(r.grade, 'exact_alias');
});

test('ambiguous candidates are deterministically ordered', () => {
  const a = matchIngredient('large butter sticks', ambiguousRegistry);
  const b = matchIngredient('large butter sticks', ambiguousRegistry);
  assert.deepEqual(a, b);
  assert.ok(a.kind === 'unmatched_ambiguous');
  assert.deepEqual([...a.candidates].sort(), a.candidates);
});
