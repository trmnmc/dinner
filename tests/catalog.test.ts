/**
 * catalog.test.ts — proves the catalog validation gate (DESIGN.md
 * Invariant 5) and the ingredient-id / allergen-class cross-check.
 *
 * Acceptance contract: a recipe is INELIGIBLE for recommendation unless
 * quantities are complete, steps ordered, servings known, dietary tags
 * verified, all nine per-step interruption-metadata fields present in the
 * DATA (frozen D-7 shapes), every ingredient id resolves in the registry,
 * and its allergen classes are consistent with the recipe's dietary tags —
 * an allergen can never hide behind an unverified tag. The gate EXCLUDES
 * with structured reasons; it never throws on bad recipe data.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CatalogDataError,
  FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG,
  gateCatalog,
  parseIngredientRegistry,
  validateRecipe,
} from '../domain/src/catalog.ts';
import type { RecipeValidationReport } from '../domain/src/catalog.ts';
import { sign } from '../domain/src/qty.ts';

const here = dirname(fileURLToPath(import.meta.url));
const registryRaw: unknown = JSON.parse(
  readFileSync(join(here, '..', 'data', 'ingredients.json'), 'utf8'),
);
const registry = parseIngredientRegistry(registryRaw);

// ---------------------------------------------------------------------------
// Fixture: a recipe that satisfies every gate criterion against the REAL
// registry. Tests mutate fresh copies to break exactly one criterion at a
// time.
// ---------------------------------------------------------------------------

interface Draft {
  [k: string]: unknown;
}
interface RecipeDraft extends Draft {
  steps: Draft[];
  ingredients: Draft[];
  dietary_tags: string[];
  allergens: string[];
}

function validRecipe(): RecipeDraft {
  return {
    id: 'e6c3f9a2-1b7d-4e5f-9a2b-3c4d5e6f7a8b',
    slug: 'sheet-pan-lemon-chicken',
    name: 'Sheet-Pan Lemon Chicken',
    description: 'Chicken thighs roasted with lemon and garlic on one pan.',
    servings_default: 4,
    attributes: {
      protein: 'chicken',
      cuisine: 'mediterranean',
      flavour: ['bright', 'garlicky'],
      texture: ['crispy', 'tender'],
      spice: 'none',
      richness: 'medium',
      method: 'sheet_pan',
      effort: 'low',
    },
    dietary_tags: ['gluten_free', 'dairy_free', 'nut_free'],
    allergens: [],
    equipment: ['sheet pan', 'oven'],
    cost_band: 'low',
    dish_count: 2,
    total_time_seconds: 2100,
    active_time_seconds: 600,
    ingredients: [
      {
        id: 'chicken',
        ingredient_id: 'chicken_thigh_boneless',
        display_name: 'boneless skinless chicken thighs',
        quantity: { kind: 'exact', amount: { num: '750', den: '1' }, unit: 'g' },
        preparation: null,
        optional: false,
      },
      {
        id: 'garlic',
        ingredient_id: 'garlic',
        display_name: 'garlic cloves',
        quantity: { kind: 'exact', amount: '3', unit: 'count' },
        preparation: 'minced',
        optional: false,
      },
      {
        id: 'oil',
        ingredient_id: 'olive_oil',
        display_name: 'olive oil',
        quantity: { kind: 'range', min: '1 1/2', max: '2', unit: 'tbsp' },
        preparation: null,
        optional: false,
      },
      {
        id: 'lemon',
        ingredient_id: 'lemon',
        display_name: 'lemon',
        quantity: { kind: 'exact', amount: '1', unit: 'count' },
        preparation: 'cut into wedges',
        optional: false,
      },
      {
        id: 'salt',
        ingredient_id: 'kosher_salt',
        display_name: 'kosher salt',
        quantity: { kind: 'to_taste' },
        preparation: null,
        optional: false,
      },
    ],
    steps: [
      {
        id: 's1',
        index: 0,
        instruction: 'Heat the oven to 220C. Toss chicken with oil, garlic and salt.',
        equipment: ['sheet pan'],
        active_duration_seconds: 300,
        unattended_duration_seconds: 0,
        requires_continuous_attention: false,
        safe_to_pause_before: true,
        safe_to_pause_during: true,
        safe_to_pause_after: true,
        maximum_pause: { kind: 'unlimited' },
        natural_stopping_point: true,
        interruption_risk: 'low',
        recovery_instruction: { kind: 'instruction', text: 'Re-toss the chicken so the seasoning coats evenly, then continue.' },
        timer_duration_seconds: null,
      },
      {
        id: 's2',
        index: 1,
        instruction: 'Roast 25 minutes until the thighs reach 74C.',
        equipment: ['oven'],
        active_duration_seconds: 120,
        unattended_duration_seconds: 1500,
        requires_continuous_attention: false,
        safe_to_pause_before: true,
        safe_to_pause_during: false,
        safe_to_pause_after: true,
        maximum_pause: { kind: 'bounded', seconds: 600 },
        natural_stopping_point: false,
        interruption_risk: 'medium',
        recovery_instruction: { kind: 'instruction', text: 'If the oven was opened, add 3-5 minutes and re-check the temperature.' },
        timer_duration_seconds: 1500,
      },
      {
        id: 's3',
        index: 2,
        instruction: 'Rest 3 minutes, squeeze lemon over, and serve.',
        equipment: [],
        active_duration_seconds: 180,
        unattended_duration_seconds: 0,
        requires_continuous_attention: false,
        safe_to_pause_before: true,
        safe_to_pause_during: true,
        safe_to_pause_after: true,
        maximum_pause: { kind: 'unlimited' },
        natural_stopping_point: true,
        interruption_risk: 'low',
        recovery_instruction: { kind: 'none_available' },
        timer_duration_seconds: 180,
      },
    ],
  };
}

function step(r: RecipeDraft, i: number): Draft {
  const s = r.steps[i];
  assert.ok(s !== undefined);
  return s;
}

function codes(report: RecipeValidationReport): readonly string[] {
  return report.issues.map((i) => i.code);
}

function check(data: unknown): RecipeValidationReport {
  return validateRecipe(data, registry);
}

// ---------------------------------------------------------------------------
// The registry itself
// ---------------------------------------------------------------------------

test('the committed registry parses: unique ids/aliases, valid classes and sections', () => {
  assert.ok(registry.size >= 60, `expected a substantial registry, got ${String(registry.size)}`);
  const soy = registry.get('soy_sauce');
  assert.ok(soy !== undefined);
  assert.deepEqual([...soy.allergen_classes].sort(), ['gluten', 'soy', 'wheat']);
  assert.equal(soy.store_section, 'condiments');
});

test('curated conversion values: densities/per-item weights are exact positive rationals or an honest null', () => {
  let withDensity = 0;
  let withoutDensity = 0;
  for (const entry of registry.values()) {
    if (entry.density_g_per_ml === null) withoutDensity += 1;
    else {
      withDensity += 1;
      assert.equal(sign(entry.density_g_per_ml), 1);
    }
    if (entry.per_item_weight_g !== null) assert.equal(sign(entry.per_item_weight_g), 1);
  }
  // Both states must actually occur: null is a legitimate, representable
  // absent state (never a guessed density), and curated values exist where
  // a conversion layer needs them.
  assert.ok(withDensity >= 5, 'expected some curated densities');
  assert.ok(withoutDensity >= 5, 'expected some honestly-absent densities');
  const garlic = registry.get('garlic');
  assert.ok(garlic !== undefined);
  assert.deepEqual(garlic.per_item_weight_g, { num: 5n, den: 1n });
  // kosher salt density is brand-dependent — it must be null, not a guess.
  const salt = registry.get('kosher_salt');
  assert.ok(salt !== undefined);
  assert.equal(salt.density_g_per_ml, null);
});

test('registry parsing rejects malformed entries with CatalogDataError', () => {
  const base = {
    id: 'x',
    display_name: 'x',
    aliases: [],
    allergen_classes: [],
    store_section: 'dry_goods',
    density_g_per_ml: null,
    per_item_weight_g: null,
    package_options: [],
  };
  // zero density (must be positive)
  assert.throws(
    () => parseIngredientRegistry({ ingredients: [{ ...base, density_g_per_ml: '0' }] }),
    CatalogDataError,
  );
  // float density is rejected, never coerced
  assert.throws(
    () => parseIngredientRegistry({ ingredients: [{ ...base, density_g_per_ml: 0.91 }] }),
    CatalogDataError,
  );
  // omitted curated key: null must be explicit
  const { per_item_weight_g: _omitted, ...missingKey } = base;
  assert.throws(() => parseIngredientRegistry({ ingredients: [missingKey] }), CatalogDataError);
  // invalid allergen class
  assert.throws(
    () => parseIngredientRegistry({ ingredients: [{ ...base, allergen_classes: ['nuts'] }] }),
    CatalogDataError,
  );
  // alias colliding with another entry's id
  assert.throws(
    () =>
      parseIngredientRegistry({
        ingredients: [base, { ...base, id: 'y', aliases: ['X'] }],
      }),
    CatalogDataError,
  );
  // duplicate id
  assert.throws(() => parseIngredientRegistry({ ingredients: [base, base] }), CatalogDataError);
});

// ---------------------------------------------------------------------------
// T-069: package_options is registry-owned curated data, parsed with the
// same accumulate-then-throw idiom as every other curated field — loud on
// any defect, never a silent drop.
// ---------------------------------------------------------------------------

test('T-069: package_options must be present, and every option is validated in full', () => {
  const base = {
    id: 'x',
    display_name: 'x',
    aliases: [],
    allergen_classes: [],
    store_section: 'dry_goods',
    density_g_per_ml: null,
    per_item_weight_g: null,
    package_options: [],
  };
  const validOption = {
    id: 'x-1',
    label_singular: 'bag',
    label_plural: 'bags',
    yield_amount: '3',
    yield_unit: 'lb',
    is_estimate: false,
  };

  // key omitted entirely: an authoring error, same as an omitted density key.
  const { package_options: _omitted, ...missingKey } = base;
  assert.throws(() => parseIngredientRegistry({ ingredients: [missingKey] }), CatalogDataError);

  // [] is legal — an ingredient can be curated as "sold loose".
  assert.doesNotThrow(() => parseIngredientRegistry({ ingredients: [base] }));

  // a well-formed option is legal, and survives onto the parsed entry.
  const withOption = parseIngredientRegistry({
    ingredients: [{ ...base, package_options: [validOption] }],
  });
  const parsedEntry = withOption.get('x');
  assert.ok(parsedEntry !== undefined);
  assert.equal(parsedEntry.package_options.length, 1);
  assert.deepEqual(parsedEntry.package_options[0], {
    id: 'x-1',
    label_singular: 'bag',
    label_plural: 'bags',
    yield_amount: { num: 3n, den: 1n },
    yield_unit: 'lb',
    is_estimate: false,
  });

  // duplicate option id within the same ingredient's list.
  assert.throws(
    () =>
      parseIngredientRegistry({
        ingredients: [{ ...base, package_options: [validOption, { ...validOption, label_singular: 'other' }] }],
      }),
    CatalogDataError,
  );
  // non-positive yield_amount.
  assert.throws(
    () =>
      parseIngredientRegistry({
        ingredients: [{ ...base, package_options: [{ ...validOption, yield_amount: '0' }] }],
      }),
    CatalogDataError,
  );
  // a bare float yield_amount is rejected, never coerced (Invariant 1).
  assert.throws(
    () =>
      parseIngredientRegistry({
        ingredients: [{ ...base, package_options: [{ ...validOption, yield_amount: 3 }] }],
      }),
    CatalogDataError,
  );
  // invalid yield_unit.
  assert.throws(
    () =>
      parseIngredientRegistry({
        ingredients: [{ ...base, package_options: [{ ...validOption, yield_unit: 'gallon' }] }],
      }),
    CatalogDataError,
  );
  // is_estimate not a real boolean.
  assert.throws(
    () =>
      parseIngredientRegistry({
        ingredients: [{ ...base, package_options: [{ ...validOption, is_estimate: 'false' }] }],
      }),
    CatalogDataError,
  );
  // empty label.
  assert.throws(
    () =>
      parseIngredientRegistry({
        ingredients: [{ ...base, package_options: [{ ...validOption, label_singular: '  ' }] }],
      }),
    CatalogDataError,
  );
  // package_options not an array at all.
  assert.throws(
    () => parseIngredientRegistry({ ingredients: [{ ...base, package_options: 'nope' }] }),
    CatalogDataError,
  );
});

test('T-069: the committed registry carries the curated package options — 104 options across 97 ingredients, and selectPackages can use them directly', () => {
  let total = 0;
  for (const entry of registry.values()) total += entry.package_options.length;
  assert.equal(registry.size, 97);
  assert.equal(total, 104);

  const onion = registry.get('yellow_onion');
  assert.ok(onion !== undefined);
  assert.deepEqual(
    onion.package_options.map((o) => o.id),
    ['yellow_onion-1', 'yellow_onion-2'],
  );
  const bagOption = onion.package_options[1];
  assert.ok(bagOption !== undefined);
  assert.deepEqual(bagOption.yield_amount, { num: 3n, den: 1n });
  assert.equal(bagOption.yield_unit, 'lb');
  assert.equal(bagOption.is_estimate, false);
});

// ---------------------------------------------------------------------------
// A fully valid recipe passes and comes out as a typed Recipe
// ---------------------------------------------------------------------------

test('a complete recipe is eligible with zero issues and exact Rational amounts', () => {
  const report = check(validRecipe());
  assert.deepEqual(report.issues, []);
  assert.equal(report.eligible, true);
  assert.ok(report.recipe !== null);
  const first = report.recipe.ingredients[0];
  assert.ok(first !== undefined);
  assert.ok(first.quantity.kind === 'exact');
  assert.deepEqual(first.quantity.amount, { num: 750n, den: 1n });
  const oil = report.recipe.ingredients[2];
  assert.ok(oil !== undefined);
  assert.ok(oil.quantity.kind === 'range');
  assert.deepEqual(oil.quantity.min, { num: 3n, den: 2n }); // "1 1/2" parsed exactly
  assert.equal(report.recipe.steps.length, 3);
});

// ---------------------------------------------------------------------------
// Quantities complete
// ---------------------------------------------------------------------------

test('a missing quantity makes the recipe ineligible', () => {
  const r = validRecipe();
  const line = r.ingredients[0];
  assert.ok(line !== undefined);
  delete line['quantity'];
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('quantity_incomplete'));
});

test('a float amount is rejected, never coerced', () => {
  const r = validRecipe();
  const line = r.ingredients[0];
  assert.ok(line !== undefined);
  line['quantity'] = { kind: 'exact', amount: 0.75, unit: 'g' };
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('quantity_incomplete'));
});

test('zero and negative amounts are incomplete quantities', () => {
  for (const amount of ['0', '-1']) {
    const r = validRecipe();
    const line = r.ingredients[0];
    assert.ok(line !== undefined);
    line['quantity'] = { kind: 'exact', amount, unit: 'g' };
    assert.ok(codes(check(r)).includes('quantity_incomplete'), `amount ${amount}`);
  }
});

test('an unknown unit is an incomplete quantity', () => {
  const r = validRecipe();
  const line = r.ingredients[0];
  assert.ok(line !== undefined);
  line['quantity'] = { kind: 'exact', amount: '750', unit: 'grams' };
  assert.ok(codes(check(r)).includes('quantity_incomplete'));
});

test('a range with min > max is an incomplete quantity', () => {
  const r = validRecipe();
  const line = r.ingredients[2];
  assert.ok(line !== undefined);
  line['quantity'] = { kind: 'range', min: '3', max: '2', unit: 'tbsp' };
  assert.ok(codes(check(r)).includes('quantity_incomplete'));
});

test('to_taste is a complete, explicit non-numeric state', () => {
  const report = check(validRecipe());
  assert.equal(report.eligible, true);
  assert.ok(report.recipe !== null);
  const salt = report.recipe.ingredients[4];
  assert.ok(salt !== undefined);
  assert.deepEqual(salt.quantity, { kind: 'to_taste' });
});

// ---------------------------------------------------------------------------
// Steps ordered
// ---------------------------------------------------------------------------

test('an empty steps array is ineligible', () => {
  const r = validRecipe();
  r.steps = [];
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('steps_missing'));
});

test('non-contiguous step indexes are unordered', () => {
  const r = validRecipe();
  step(r, 2)['index'] = 5;
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('steps_unordered'));
});

test('swapped step indexes are unordered', () => {
  const r = validRecipe();
  step(r, 0)['index'] = 1;
  step(r, 1)['index'] = 0;
  assert.ok(codes(check(r)).includes('steps_unordered'));
});

test('duplicate step ids are rejected', () => {
  const r = validRecipe();
  step(r, 1)['id'] = 's1';
  assert.ok(codes(check(r)).includes('duplicate_id'));
});

// ---------------------------------------------------------------------------
// Servings known
// ---------------------------------------------------------------------------

test('missing, zero, and fractional servings are all servings_unknown', () => {
  for (const bad of [undefined, 0, -2, 2.5, '4']) {
    const r = validRecipe();
    if (bad === undefined) delete r['servings_default'];
    else r['servings_default'] = bad;
    const report = check(r);
    assert.equal(report.eligible, false, `servings ${JSON.stringify(bad)}`);
    assert.ok(codes(report).includes('servings_unknown'), `servings ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------------------
// The nine per-step interruption-metadata fields (Invariant 6, decision D-7)
// ---------------------------------------------------------------------------

const NINE_FIELD_MEMBERS = [
  'active_duration_seconds',
  'unattended_duration_seconds',
  'requires_continuous_attention',
  'safe_to_pause_before',
  'safe_to_pause_during',
  'safe_to_pause_after',
  'maximum_pause',
  'natural_stopping_point',
  'interruption_risk',
  'recovery_instruction',
  'timer_duration_seconds',
] as const;

for (const field of NINE_FIELD_MEMBERS) {
  test(`deleting '${field}' from one step excludes the recipe with a field-naming reason`, () => {
    const r = validRecipe();
    delete step(r, 1)[field];
    const report = check(r);
    assert.equal(report.eligible, false);
    const hit = report.issues.find(
      (i) => i.code === 'interruption_metadata_incomplete' && i.path === `steps[1].${field}`,
    );
    assert.ok(hit !== undefined, `expected an issue at steps[1].${field}, got ${JSON.stringify(report.issues)}`);
  });
}

test('D-7 drift: SPEC field names maximum_pause_seconds / timer_duration / bare-string recovery are rejected', () => {
  // maximum_pause_seconds instead of the MaximumPause union
  const a = validRecipe();
  delete step(a, 1)['maximum_pause'];
  step(a, 1)['maximum_pause_seconds'] = 600;
  const ra = check(a);
  assert.equal(ra.eligible, false);
  assert.ok(ra.issues.some((i) => i.path === 'steps[1].maximum_pause'));

  // recovery_instruction as a bare string instead of the RecoveryGuidance union
  const b = validRecipe();
  step(b, 1)['recovery_instruction'] = 'just keep roasting';
  const rb = check(b);
  assert.equal(rb.eligible, false);
  assert.ok(rb.issues.some((i) => i.path === 'steps[1].recovery_instruction'));

  // timer_duration instead of timer_duration_seconds
  const c = validRecipe();
  delete step(c, 1)['timer_duration_seconds'];
  step(c, 1)['timer_duration'] = 1500;
  const rc = check(c);
  assert.equal(rc.eligible, false);
  assert.ok(rc.issues.some((i) => i.path === 'steps[1].timer_duration_seconds'));
});

test('metadata shape edges: bounded pause without seconds, empty recovery text, zero-second timer', () => {
  const a = validRecipe();
  step(a, 1)['maximum_pause'] = { kind: 'bounded' };
  assert.ok(codes(check(a)).includes('interruption_metadata_incomplete'));

  const b = validRecipe();
  step(b, 1)['recovery_instruction'] = { kind: 'instruction', text: '   ' };
  assert.ok(codes(check(b)).includes('interruption_metadata_incomplete'));

  const c = validRecipe();
  step(c, 1)['timer_duration_seconds'] = 0;
  assert.ok(codes(check(c)).includes('interruption_metadata_incomplete'));
});

// ---------------------------------------------------------------------------
// Declared totals must equal per-step sums
// ---------------------------------------------------------------------------

test('declared total/active times must equal the per-step sums', () => {
  const a = validRecipe();
  a['total_time_seconds'] = 1234;
  const ra = check(a);
  assert.equal(ra.eligible, false);
  assert.ok(ra.issues.some((i) => i.code === 'time_totals_inconsistent' && i.path === 'total_time_seconds'));

  const b = validRecipe();
  b['active_time_seconds'] = 599;
  const rb = check(b);
  assert.equal(rb.eligible, false);
  assert.ok(rb.issues.some((i) => i.code === 'time_totals_inconsistent' && i.path === 'active_time_seconds'));
});

// ---------------------------------------------------------------------------
// Dietary tags verified + registry / allergen-class cross-check
// ---------------------------------------------------------------------------

test('an unverifiable dietary tag value is rejected', () => {
  const r = validRecipe();
  r.dietary_tags.push('keto');
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('invalid_dietary_tag'));
});

test('an ingredient id that does not resolve in the registry excludes the recipe', () => {
  const r = validRecipe();
  const line = r.ingredients[1];
  assert.ok(line !== undefined);
  line['ingredient_id'] = 'unicorn_meat';
  const report = check(r);
  assert.equal(report.eligible, false);
  const hit = report.issues.find((i) => i.code === 'unresolved_ingredient_id');
  assert.ok(hit !== undefined);
  assert.ok(hit.message.includes('unicorn_meat'));
});

function pushLine(r: RecipeDraft, ingredientId: string, optional: boolean): void {
  r.ingredients.push({
    id: `extra_${ingredientId}`,
    ingredient_id: ingredientId,
    display_name: ingredientId,
    quantity: { kind: 'exact', amount: '2', unit: 'tbsp' },
    preparation: null,
    optional,
  });
}

test('an allergen cannot hide: a carried class missing from declared allergens excludes the recipe', () => {
  const r = validRecipe();
  r.dietary_tags = []; // no tag in play — the declaration check alone must catch it
  pushLine(r, 'unsalted_butter', false);
  const report = check(r);
  assert.equal(report.eligible, false);
  const hit = report.issues.find((i) => i.code === 'undeclared_allergen');
  assert.ok(hit !== undefined);
  assert.ok(hit.message.includes('dairy'));
});

test('declaring the carried class resolves the declaration check', () => {
  const r = validRecipe();
  r.dietary_tags = ['gluten_free', 'nut_free'];
  pushLine(r, 'unsalted_butter', false);
  r.allergens = ['dairy'];
  const report = check(r);
  assert.deepEqual(report.issues, []);
  assert.equal(report.eligible, true);
});

test('a dietary tag contradicted by an ingredient allergen class excludes the recipe', () => {
  // nut_free + peanut butter: the tag is unverified and the gate must say why
  const r = validRecipe();
  pushLine(r, 'peanut_butter', false);
  r.allergens = ['peanut']; // even declared honestly, the TAG is still a lie
  const report = check(r);
  assert.equal(report.eligible, false);
  const hit = report.issues.find((i) => i.code === 'dietary_tag_contradicted');
  assert.ok(hit !== undefined);
  assert.ok(hit.message.includes('nut_free'));
  assert.ok(hit.message.includes('peanut'));
});

test('gluten_free is contradicted by soy sauce via the registry, not by authored belief', () => {
  const r = validRecipe();
  pushLine(r, 'soy_sauce', false);
  r.allergens = ['soy', 'wheat', 'gluten'];
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('dietary_tag_contradicted'));
});

test('vegan is contradicted by dairy/egg/fish/shellfish classes', () => {
  const r = validRecipe();
  r.dietary_tags = ['vegan'];
  pushLine(r, 'mayonnaise', false);
  r.allergens = ['egg'];
  const report = check(r);
  assert.equal(report.eligible, false);
  const hit = report.issues.find((i) => i.code === 'dietary_tag_contradicted');
  assert.ok(hit !== undefined);
  assert.ok(hit.message.includes('vegan'));
});

test('an OPTIONAL garnish still cannot hide an allergen', () => {
  const r = validRecipe();
  pushLine(r, 'almonds', true); // optional garnish
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('undeclared_allergen'));
  assert.ok(codes(report).includes('dietary_tag_contradicted')); // nut_free tag
});

test('a tag contradicted by the recipe\'s own declared allergens is caught without registry help', () => {
  const r = validRecipe();
  r.dietary_tags = ['dairy_free'];
  r.allergens = ['dairy'];
  const report = check(r);
  assert.equal(report.eligible, false);
  assert.ok(codes(report).includes('dietary_tag_contradicted'));
});

test('the forbidden-class table covers every dietary tag', () => {
  assert.equal(Object.keys(FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG).length, 10);
  assert.deepEqual(FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG.nut_free, ['peanut', 'tree_nut']);
  assert.deepEqual(FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG.gluten_free, ['gluten', 'wheat']);
});

// ---------------------------------------------------------------------------
// Gate semantics: exclusion with reasons, never a crash, never a boolean
// ---------------------------------------------------------------------------

test('gateCatalog excludes broken entries with structured reasons and never throws', () => {
  const broken = validRecipe();
  delete step(broken, 1)['maximum_pause'];
  const result = gateCatalog([validRecipe(), broken, null, 42, 'nonsense'], registry);
  assert.equal(result.reports.length, 5);
  assert.equal(result.eligible.length, 1);
  const eligible = result.eligible[0];
  assert.ok(eligible !== undefined);
  assert.equal(eligible.slug, 'sheet-pan-lemon-chicken');
  for (const report of result.reports.slice(1)) {
    assert.equal(report.eligible, false);
    assert.ok(report.issues.length >= 1, 'every exclusion carries at least one structured reason');
    for (const issue of report.issues) {
      assert.equal(typeof issue.code, 'string');
      assert.equal(typeof issue.path, 'string');
      assert.equal(typeof issue.message, 'string');
    }
  }
});

test('a duplicate recipe id or slug in the catalog excludes the later entry', () => {
  const first = validRecipe();
  const dup = validRecipe(); // same id and slug
  const result = gateCatalog([first, dup], registry);
  assert.equal(result.eligible.length, 1);
  const second = result.reports[1];
  assert.ok(second !== undefined);
  assert.equal(second.eligible, false);
  assert.ok(codes(second).includes('duplicate_id'));
});

test('reports align with input order and carry best-effort ids', () => {
  const r = validRecipe();
  r['servings_default'] = 0;
  const result = gateCatalog([r], registry);
  const report = result.reports[0];
  assert.ok(report !== undefined);
  assert.equal(report.recipe_id, 'e6c3f9a2-1b7d-4e5f-9a2b-3c4d5e6f7a8b');
  assert.equal(report.slug, 'sheet-pan-lemon-chicken');
  assert.equal(report.recipe, null);
});
