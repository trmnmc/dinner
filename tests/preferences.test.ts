/**
 * preferences.test.ts — regression tests for the attribute-level
 * preference model (T-005).
 *
 * Every expected numeric value below is a LITERAL Rational written
 * independently of `preferences.ts`, hand-derived from
 * `PREFERENCE_ASYMMETRY_CONFIG`'s documented amounts (pinned as literals in
 * this file too — never read back from the module and compared to itself).
 * If either the config or the engine's arithmetic drifts, these fail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AttributeVector,
  FeedbackReason,
  Household,
  HouseholdMember,
  PreferenceSignal,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
} from '../domain/src/recipe.ts';
import type { IngredientRegistry } from '../domain/src/catalog.ts';
import type { Rational } from '../domain/src/qty.ts';
import { ONE, ZERO, compare, eq, rational } from '../domain/src/qty.ts';
import {
  HARD_FILTER_CONFIG,
  applyHardFilters,
} from '../domain/src/filters.ts';
import type { PlanningContext } from '../domain/src/filters.ts';
import {
  PREFERENCE_ASYMMETRY_CONFIG,
  applyCalibrationReaction,
  applyFeedbackEvent,
  attributeValuePairs,
  mergeSignal,
} from '../domain/src/preferences.ts';
import type { PreferenceSignalUpdate } from '../domain/src/preferences.ts';

// ---------------------------------------------------------------------------
// Fixtures (same conventions as filters.test.ts / score.test.ts)
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

const richAttributes: AttributeVector = {
  protein: 'chicken',
  cuisine: 'italian',
  flavour: ['savoury', 'herby'],
  texture: ['tender', 'crispy'],
  spice: 'mild',
  richness: 'medium',
  method: 'oven',
  effort: 'medium',
};

function makeRecipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-base',
    slug: 'recipe-base',
    name: 'Base recipe',
    description: 'A fixture.',
    servings_default: 4,
    attributes: richAttributes,
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
    confidence: rational(1, 2),
    durability: 'seasonal',
    source: 'feedback',
    updated_at_utc: '2026-08-02T00:00:00.000Z',
    ...over,
  };
}

const emptyRegistry: IngredientRegistry = new Map();
const emptyContext: PlanningContext = { recent_meals: [] };

function find(
  updates: readonly PreferenceSignalUpdate[],
  attribute: string,
  attribute_value: string,
): PreferenceSignalUpdate {
  const hit = updates.find((u) => u.attribute === attribute && u.attribute_value === attribute_value);
  const available = updates.map((u) => `${u.attribute}:${u.attribute_value}`).join(', ');
  assert.ok(hit !== undefined, `no update for ${attribute}:${attribute_value} among [${available}]`);
  return hit;
}

function assertRational(v: unknown, path: string): asserts v is Rational {
  assert.ok(typeof v === 'object' && v !== null, `${path} is not an object — a float leaked?`);
  const r = v as { num?: unknown; den?: unknown };
  assert.equal(typeof r.num, 'bigint', `${path}.num is not a bigint`);
  assert.equal(typeof r.den, 'bigint', `${path}.den is not a bigint`);
  assert.ok((r.den as bigint) > 0n, `${path}.den is not strictly positive`);
}

// ---------------------------------------------------------------------------
// 1. Pin the asymmetry config amounts as LITERALS — independent of the
//    module's own values. This is the anti-drift pin the item calls for.
// ---------------------------------------------------------------------------

test('PREFERENCE_ASYMMETRY_CONFIG carries exactly the documented literal amounts', () => {
  const expected: Record<string, Rational> = {
    positive_value_multiplier: rational(1),
    negative_value_multiplier: rational(3, 2),
    positive_confidence_gain: rational(1, 5),
    negative_confidence_gain: rational(2, 5),
    looks_good_raw_value: rational(2, 5),
    not_for_me_raw_value: rational(2, 5),
    never_recommend_value: rational(-1),
    never_recommend_confidence: rational(1),
    never_recommend_generic_raw_value: rational(3, 5),
    too_much_work_raw_value: rational(3, 5),
    make_again_raw_value: rational(3, 5),
    it_was_fine_raw_value: rational(1, 10),
    not_again_raw_value: rational(3, 5),
    reason_boost_raw_value: rational(1, 5),
    durable_raw_threshold: rational(3, 5),
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actual = (PREFERENCE_ASYMMETRY_CONFIG as unknown as Record<string, Rational>)[key];
    assert.ok(actual !== undefined, `config missing key ${key}`);
    assert.ok(
      eq(actual, expectedValue),
      `config.${key} = ${actual.num.toString()}/${actual.den.toString()}, expected ${expectedValue.num.toString()}/${expectedValue.den.toString()}`,
    );
  }
  // Asymmetry preconditions, pinned independently: negative strictly
  // outweighs positive on both axes that matter.
  assert.equal(compare(rational(3, 2), rational(1)), 1, 'negative value multiplier must exceed positive');
  assert.equal(compare(rational(2, 5), rational(1, 5)), 1, 'negative confidence gain must exceed positive');
  // never_recommend's absolute lock is scoped to exactly the DISTINCTIVE
  // axes — pinned as literals so a drift toward "lock everything" (the
  // measured over-exclusion interaction defect with filters.ts) or toward
  // "lock nothing" (a toothless never_recommend) both fail here. Flavour
  // is deliberately NOT in the lock set (KI-5, second half): `FlavourTag`
  // carries catalog-wide generic members ('savoury', 'mild', 'fresh'), so
  // a flavour lock let one tap on a savoury card veto most of a realistic
  // catalog. Flavour takes the strong durable generic negative instead.
  assert.deepEqual(
    [...PREFERENCE_ASYMMETRY_CONFIG.never_recommend_lock_attributes],
    ['protein', 'cuisine'],
  );
});

// ---------------------------------------------------------------------------
// 2. Breadth — every event touches every attribute-value pair on the card
// ---------------------------------------------------------------------------

test('a calibration reaction updates every (attribute, attribute_value) pair on the card — never one opaque score', () => {
  const recipe = makeRecipe();
  const updates = applyCalibrationReaction({ recipe, member_id: 'member-1', reaction: 'looks_good' });
  // 6 single-valued axes + 2 flavour tags + 2 texture tags = 10.
  assert.equal(updates.length, 10);
  const axes = new Set(updates.map((u) => u.attribute));
  assert.deepEqual(
    [...axes].sort(),
    ['cuisine', 'effort', 'flavour', 'method', 'protein', 'richness', 'spice', 'texture'].sort(),
  );
  // Matches attributeValuePairs exactly (shared derivation).
  assert.deepEqual(
    updates.map((u) => ({ attribute: u.attribute, attribute_value: u.attribute_value })),
    attributeValuePairs(recipe.attributes),
  );
  for (const u of updates) {
    assertRational(u.value, `${u.attribute}.value`);
    assertRational(u.confidence, `${u.attribute}.confidence`);
    assert.ok(compare(u.value, rational(-1)) >= 0 && compare(u.value, ONE) <= 0);
    assert.ok(compare(u.confidence, ZERO) >= 0 && compare(u.confidence, ONE) <= 0);
  }
});

test('a feedback event also updates every attribute-value pair on the card', () => {
  const recipe = makeRecipe();
  const updates = applyFeedbackEvent({ recipe, member_id: null, verdict: 'make_again', reason: null });
  assert.equal(updates.length, 10);
});

// ---------------------------------------------------------------------------
// 3. Asymmetry, proved directly with EQUAL raw magnitudes (calibration)
// ---------------------------------------------------------------------------

test('looks_good vs not_for_me: equal raw magnitude (2/5), but not_for_me moves value further AND reaches higher confidence faster', () => {
  const recipe = makeRecipe();
  // Precondition: the two reactions share the SAME raw magnitude in the
  // config — any observed difference below comes from the asymmetry
  // multipliers, not from different base amounts.
  assert.ok(eq(PREFERENCE_ASYMMETRY_CONFIG.looks_good_raw_value, PREFERENCE_ASYMMETRY_CONFIG.not_for_me_raw_value));

  const good = find(
    applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'looks_good' }),
    'protein',
    'chicken',
  );
  const bad = find(
    applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'not_for_me' }),
    'protein',
    'chicken',
  );

  // Hand-computed, independent of the engine: looks_good = +2/5 * 1 = 2/5;
  // not_for_me = -(2/5 * 3/2) = -3/5.
  assert.ok(eq(good.value, rational(2, 5)), `looks_good value = ${good.value.num}/${good.value.den}`);
  assert.ok(eq(bad.value, rational(-3, 5)), `not_for_me value = ${bad.value.num}/${bad.value.den}`);
  assert.ok(eq(good.confidence, rational(1, 5)));
  assert.ok(eq(bad.confidence, rational(2, 5)));

  // Direct, stated-direction proof: magnitude and confidence both larger
  // for the negative reaction despite the identical raw input.
  assert.equal(compare(rational(3, 5), rational(2, 5)), 1, '|not_for_me| must exceed |looks_good|');
  assert.equal(compare(bad.confidence, good.confidence), 1, 'not_for_me confidence must exceed looks_good');
});

test('make_again vs not_again: equal raw magnitude (3/5), but not_again moves value further AND reaches higher confidence faster', () => {
  const recipe = makeRecipe();
  assert.ok(eq(PREFERENCE_ASYMMETRY_CONFIG.make_again_raw_value, PREFERENCE_ASYMMETRY_CONFIG.not_again_raw_value));

  const good = find(
    applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'make_again', reason: null }),
    'protein',
    'chicken',
  );
  const bad = find(
    applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'not_again', reason: null }),
    'protein',
    'chicken',
  );

  // make_again = +3/5 * 1 = 3/5; not_again = -(3/5 * 3/2) = -9/10.
  assert.ok(eq(good.value, rational(3, 5)));
  assert.ok(eq(bad.value, rational(-9, 10)));
  assert.ok(eq(good.confidence, rational(1, 5)));
  assert.ok(eq(bad.confidence, rational(2, 5)));
  assert.equal(compare(rational(9, 10), rational(3, 5)), 1, '|not_again| must exceed |make_again|');
  assert.equal(compare(bad.confidence, good.confidence), 1);
});

test('it_was_fine is a weak positive: smaller value magnitude than make_again, still asymmetric vs not_again', () => {
  const recipe = makeRecipe();
  const fine = find(
    applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'it_was_fine', reason: null }),
    'protein',
    'chicken',
  );
  assert.ok(eq(fine.value, rational(1, 10)));
  assert.ok(eq(fine.confidence, rational(1, 5)));
  assert.equal(fine.durability, 'transient');
});

// ---------------------------------------------------------------------------
// 4. Durability asymmetry: negative signals decay slower (never below
//    'seasonal'); weak positives are 'transient'.
// ---------------------------------------------------------------------------

test('durability: weak positive is transient, weak-to-moderate negative is never less than seasonal', () => {
  const recipe = makeRecipe();
  const good = find(applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'looks_good' }), 'protein', 'chicken');
  const bad = find(applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'not_for_me' }), 'protein', 'chicken');
  assert.equal(good.durability, 'transient');
  assert.equal(bad.durability, 'seasonal');
});

test('durability: a strong negative (raw ≥ threshold) is durable; a strong positive is only seasonal', () => {
  const recipe = makeRecipe();
  const strongNeg = find(
    applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'not_again', reason: null }),
    'protein',
    'chicken',
  );
  const strongPos = find(
    applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'make_again', reason: null }),
    'protein',
    'chicken',
  );
  assert.equal(strongNeg.durability, 'durable');
  assert.equal(strongPos.durability, 'seasonal');
});

// ---------------------------------------------------------------------------
// 5. never_recommend — the exact lock, and it feeds filters.ts's hard
//    exclusion (this is the acceptance-critical integration).
// ---------------------------------------------------------------------------

test('never_recommend locks value −1 / confidence 1 on the DISTINCTIVE axes only; generic axes (flavour included) get a strong durable negative below the hard-filter confidence gate', () => {
  const recipe = makeRecipe();
  const updates = applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'never_recommend' });
  assert.equal(updates.length, 10);

  // Distinctive axes (protein, cuisine): the absolute lock.
  const lockAxes = new Set(['protein', 'cuisine']);
  for (const u of updates) {
    if (!lockAxes.has(u.attribute)) continue;
    assert.ok(eq(u.value, rational(-1)), `${u.attribute}:${u.attribute_value} value not -1`);
    assert.ok(eq(u.confidence, ONE), `${u.attribute}:${u.attribute_value} confidence not 1`);
    assert.equal(u.durability, 'durable');
  }
  // Exactly protein + cuisine on the fixture card — flavour is NOT locked.
  assert.equal(updates.filter((u) => lockAxes.has(u.attribute)).length, 2);

  // Generic axes (flavour tags, texture tags, spice, richness, method,
  // effort): hand-computed via the ordinary raw/multiplier path,
  // independent of the engine — value = -(3/5 * 3/2) = -9/10,
  // confidence = 2/5, durable (raw 3/5 ≥ durable threshold 3/5).
  for (const u of updates) {
    if (lockAxes.has(u.attribute)) continue;
    assert.ok(eq(u.value, rational(-9, 10)), `${u.attribute}:${u.attribute_value} value = ${u.value.num}/${u.value.den}, expected -9/10`);
    assert.ok(eq(u.confidence, rational(2, 5)), `${u.attribute}:${u.attribute_value} confidence = ${u.confidence.num}/${u.confidence.den}, expected 2/5`);
    assert.equal(u.durability, 'durable');
  }

  // The locked signals are structurally guaranteed to cross filters.ts's
  // strong-dislike threshold the moment they are merged in...
  assert.ok(compare(rational(-1), HARD_FILTER_CONFIG.strong_dislike_value_max) <= 0);
  assert.ok(compare(ONE, HARD_FILTER_CONFIG.strong_dislike_confidence_min) >= 0);
  // ...while a SINGLE tap's generic-axis signal is structurally guaranteed
  // NOT to: its confidence (2/5) sits below the hard filter's confidence
  // gate (1/2), so flavour/richness/method/spice/effort/texture values
  // shared with unrelated recipes do not each become an independent
  // absolute veto.
  // (Its value magnitude does cross the value threshold — corroborating
  // negative evidence can still escalate a generic axis to a hard
  // exclusion later, exactly like repeated not_again feedback.)
  assert.equal(
    compare(rational(2, 5), HARD_FILTER_CONFIG.strong_dislike_confidence_min),
    -1,
    'a single never_recommend generic-axis signal must sit below the hard-filter confidence gate',
  );
});

test('never_recommend is strictly stronger AND more durable than not_for_me on every single pair', () => {
  const recipe = makeRecipe();
  const never = applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'never_recommend' });
  const notForMe = applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'not_for_me' });
  assert.equal(never.length, notForMe.length);
  const durabilityRank = { transient: 0, seasonal: 1, durable: 2 } as const;
  for (let i = 0; i < never.length; i += 1) {
    const n = never[i];
    const f = notForMe[i];
    assert.equal(n.attribute, f.attribute);
    assert.equal(n.attribute_value, f.attribute_value);
    // More negative value (not_for_me = -3/5; never_recommend ≤ -9/10).
    assert.equal(
      compare(n.value, f.value),
      -1,
      `${n.attribute}:${n.attribute_value}: never_recommend (${n.value.num}/${n.value.den}) must be more negative than not_for_me (${f.value.num}/${f.value.den})`,
    );
    // At-least-equal confidence, and strictly higher durability
    // (not_for_me is seasonal; never_recommend is durable everywhere).
    assert.ok(compare(n.confidence, f.confidence) >= 0);
    assert.ok(
      durabilityRank[n.durability] > durabilityRank[f.durability],
      `${n.attribute}:${n.attribute_value}: never_recommend must be more durable than not_for_me`,
    );
  }
});

test('REGRESSION (measured interaction defect): one never_recommend tap does not hard-exclude recipes sharing only generic axes (a flavour tag included) — but the reacted dish and its protein/cuisine kin stay excluded', () => {
  // The reacted card: chicken / thai, flavour [umami, garlicky] — with
  // generic axes (spice hot, richness rich, method stir_fry, effort high,
  // texture [tender, saucy]) deliberately shared with unrelated recipes.
  const reactedAttributes: AttributeVector = {
    protein: 'chicken',
    cuisine: 'thai',
    flavour: ['umami', 'garlicky'],
    texture: ['tender', 'saucy'],
    spice: 'hot',
    richness: 'rich',
    method: 'stir_fry',
    effort: 'high',
  };
  const reacted = makeRecipe({ id: 'thai-chicken', slug: 'thai-chicken', attributes: reactedAttributes });
  // Distinctive kin — MUST still be excluded:
  const sameProtein = makeRecipe({
    id: 'chicken-milanese',
    slug: 'chicken-milanese',
    attributes: { ...reactedAttributes, protein: 'chicken', cuisine: 'italian', flavour: ['herby'], spice: 'mild', richness: 'medium', method: 'stovetop', effort: 'medium' },
  });
  const sameCuisine = makeRecipe({
    id: 'thai-tofu',
    slug: 'thai-tofu',
    attributes: { ...reactedAttributes, protein: 'tofu', cuisine: 'thai', flavour: ['bright'], spice: 'medium', richness: 'light', method: 'oven', effort: 'low' },
  });
  // Shares only a flavour tag — flavour is a GENERIC axis (KI-5, second
  // half): one tap must NOT hard-exclude it. Its flavour signal is a
  // strong durable negative that corroborating evidence can escalate
  // later, but a single tap sits below the hard-filter confidence gate.
  const sameFlavour = makeRecipe({
    id: 'garlicky-beef',
    slug: 'garlicky-beef',
    attributes: { ...reactedAttributes, protein: 'beef', cuisine: 'american', flavour: ['garlicky'], spice: 'mild', richness: 'medium', method: 'oven', effort: 'low' },
  });
  // Unrelated recipes sharing ONLY generic axes — the ones the measured
  // probe saw wrongly die (richness+effort, method, spice, texture):
  const richAndHighEffort = makeRecipe({
    id: 'beef-bourguignon',
    slug: 'beef-bourguignon',
    attributes: { protein: 'beef', cuisine: 'french', flavour: ['earthy'], texture: ['tender', 'saucy'], spice: 'none', richness: 'rich', method: 'braise', effort: 'high' },
  });
  const sameMethod = makeRecipe({
    id: 'veg-stir-fry',
    slug: 'veg-stir-fry',
    attributes: { protein: 'tofu', cuisine: 'chinese', flavour: ['fresh'], texture: ['crispy'], spice: 'mild', richness: 'light', method: 'stir_fry', effort: 'low' },
  });
  const sameSpice = makeRecipe({
    id: 'hot-lentil-curry',
    slug: 'hot-lentil-curry',
    attributes: { protein: 'legume', cuisine: 'indian', flavour: ['earthy'], texture: ['creamy'], spice: 'hot', richness: 'medium', method: 'simmer', effort: 'low' },
  });

  const household = makeHousehold();
  const member = makeMember();
  // Merge EVERY update from the single tap into fresh persisted signals —
  // the full composition the defect lived in, not a cherry-picked axis.
  const updates = applyCalibrationReaction({ recipe: reacted, member_id: member.id, reaction: 'never_recommend' });
  const signals = updates.map((update, i) =>
    mergeSignal({
      existing: null,
      update,
      household_id: household.id,
      id: `sig-nr-${String(i)}`,
      now: '2026-08-19T00:00:00.000Z',
    }),
  );

  const catalog = [reacted, sameProtein, sameCuisine, sameFlavour, richAndHighEffort, sameMethod, sameSpice];
  const result = applyHardFilters(catalog, household, [member], signals, emptyRegistry, emptyContext);

  // The catalog can still produce a full 3-meal plan: every recipe sharing
  // only generic axes with the reacted card SURVIVES — the shared-flavour
  // dish included...
  assert.deepEqual(
    result.survivors.map((r) => r.id),
    ['garlicky-beef', 'beef-bourguignon', 'veg-stir-fry', 'hot-lentil-curry'],
    `survivors were [${result.survivors.map((r) => r.id).join(', ')}]`,
  );
  // ...while the reacted dish and everything sharing its distinctive
  // character (protein or cuisine) remain hard-excluded, each with a
  // strong_dislike reason. never_recommend is not toothless.
  assert.deepEqual(
    result.exclusions.map((e) => e.recipe_id),
    ['thai-chicken', 'chicken-milanese', 'thai-tofu'],
  );
  for (const exclusion of result.exclusions) {
    assert.ok(
      exclusion.reasons.some((r) => r.kind === 'strong_dislike'),
      `${exclusion.recipe_id} lacks a strong_dislike reason`,
    );
  }
});

test('KI-5 REGRESSION (broad generic flavour tag): one never_recommend tap on a savoury card leaves the savoury majority of a realistic catalog standing; only the reacted dish and its protein/cuisine kin fall', () => {
  // A realistic 12-recipe catalog: 'savoury' — a generic FlavourTag member
  // sitting on most real dinners — appears on 8 of 12. Every recipe other
  // than r-11 (shares protein) and r-12 (shares cuisine) differs from the
  // reacted card on BOTH distinctive axes.
  const attrs = (
    protein: AttributeVector['protein'],
    cuisine: AttributeVector['cuisine'],
    flavour: AttributeVector['flavour'],
  ): AttributeVector => ({
    protein,
    cuisine,
    flavour,
    texture: ['tender'],
    spice: 'mild',
    richness: 'medium',
    method: 'stovetop',
    effort: 'medium',
  });
  const dish = (id: string, attributes: AttributeVector): Recipe =>
    makeRecipe({ id, slug: id, attributes });

  const reacted = dish('r-01-thai-chicken', attrs('chicken', 'thai', ['savoury', 'garlicky']));
  const catalog: readonly Recipe[] = [
    reacted,
    // Seven more savoury dinners — the majority the old flavour lock
    // wrongly wiped out with a single tap:
    dish('r-02-beef-tacos', attrs('beef', 'mexican', ['savoury'])),
    dish('r-03-pork-bibimbap', attrs('pork', 'korean', ['savoury', 'umami'])),
    dish('r-04-miso-salmon', attrs('fish', 'japanese', ['savoury'])),
    dish('r-05-dal', attrs('legume', 'indian', ['savoury', 'earthy'])),
    dish('r-06-mapo-tofu', attrs('tofu', 'chinese', ['savoury'])),
    dish('r-07-shakshuka', attrs('egg', 'middle_eastern', ['savoury'])),
    dish('r-08-lasagna', attrs('cheese', 'italian', ['savoury'])),
    // Two non-savoury, fully unrelated dinners:
    dish('r-09-lamb-souvlaki', attrs('lamb', 'greek', ['herby', 'bright'])),
    dish('r-10-paella', attrs('shellfish', 'spanish', ['smoky'])),
    // Distinctive kin — these MUST still fall:
    dish('r-11-chicken-parm', attrs('chicken', 'american', ['fresh'])),
    dish('r-12-thai-tempeh', attrs('tempeh', 'thai', ['bright'])),
  ];
  assert.equal(
    catalog.filter((r) => r.attributes.flavour.includes('savoury')).length,
    8,
    'fixture precondition: savoury must sit on 8 of 12',
  );

  const household = makeHousehold();
  const member = makeMember();
  // ONE tap, fully merged into persisted signals — the composition with
  // filters.ts is exactly where the defect lived.
  const updates = applyCalibrationReaction({
    recipe: reacted,
    member_id: member.id,
    reaction: 'never_recommend',
  });
  const signals = updates.map((update, i) =>
    mergeSignal({
      existing: null,
      update,
      household_id: household.id,
      id: `sig-ki5-${String(i)}`,
      now: '2026-08-19T00:00:00.000Z',
    }),
  );

  const result = applyHardFilters(catalog, household, [member], signals, emptyRegistry, emptyContext);

  // The savoury MAJORITY survives: 9 of 12 stand, including all seven
  // other savoury dinners. Under the old flavour lock this catalog kept
  // only the two non-savoury unrelated dishes.
  assert.deepEqual(
    result.survivors.map((r) => r.id),
    [
      'r-02-beef-tacos',
      'r-03-pork-bibimbap',
      'r-04-miso-salmon',
      'r-05-dal',
      'r-06-mapo-tofu',
      'r-07-shakshuka',
      'r-08-lasagna',
      'r-09-lamb-souvlaki',
      'r-10-paella',
    ],
    `survivors were [${result.survivors.map((r) => r.id).join(', ')}]`,
  );
  assert.equal(
    result.survivors.filter((r) => r.attributes.flavour.includes('savoury')).length,
    7,
    'every non-reacted savoury dinner must survive one tap',
  );

  // Still binding: the reacted dish, the shared-protein dish and the
  // shared-cuisine dish are all hard-excluded, each via strong_dislike.
  assert.deepEqual(
    result.exclusions.map((e) => e.recipe_id),
    ['r-01-thai-chicken', 'r-11-chicken-parm', 'r-12-thai-tempeh'],
  );
  const strongDislikeAxes = (recipeId: string): readonly string[] => {
    const exclusion = result.exclusions.find((e) => e.recipe_id === recipeId);
    assert.ok(exclusion !== undefined, `${recipeId} was not excluded`);
    return exclusion.reasons
      .filter((r) => r.kind === 'strong_dislike')
      .map((r) => (r.kind === 'strong_dislike' ? r.attribute : ''));
  };
  assert.ok(strongDislikeAxes('r-01-thai-chicken').includes('protein'));
  assert.ok(strongDislikeAxes('r-01-thai-chicken').includes('cuisine'));
  assert.ok(strongDislikeAxes('r-11-chicken-parm').includes('protein'));
  assert.ok(strongDislikeAxes('r-12-thai-tempeh').includes('cuisine'));
});

test('CONTROL: a single not_for_me tap hard-excludes nothing — not even the reacted dish', () => {
  const reacted = makeRecipe({ id: 'reacted', slug: 'reacted' });
  const twin = makeRecipe({ id: 'twin', slug: 'twin' }); // identical vector
  const unrelated = makeRecipe({
    id: 'unrelated',
    slug: 'unrelated',
    attributes: {
      protein: 'legume',
      cuisine: 'indian',
      flavour: ['earthy'],
      texture: ['creamy'],
      spice: 'hot',
      richness: 'light',
      method: 'simmer',
      effort: 'low',
    },
  });
  const household = makeHousehold();
  const member = makeMember();

  const updates = applyCalibrationReaction({
    recipe: reacted,
    member_id: member.id,
    reaction: 'not_for_me',
  });
  const signals = updates.map((update, i) =>
    mergeSignal({
      existing: null,
      update,
      household_id: household.id,
      id: `sig-nfm-${String(i)}`,
      now: '2026-08-19T00:00:00.000Z',
    }),
  );

  const result = applyHardFilters(
    [reacted, twin, unrelated],
    household,
    [member],
    signals,
    emptyRegistry,
    emptyContext,
  );
  // not_for_me is a soft (if strong-ish) negative: value -3/5 sits above
  // the hard filter's value threshold (-4/5), so NOTHING is hard-excluded.
  // Only never_recommend locks; not_for_me merely re-ranks via score.ts.
  assert.deepEqual(result.survivors.map((r) => r.id), ['reacted', 'twin', 'unrelated']);
  assert.deepEqual(result.exclusions, []);
});

test('never_recommend, once merged, hard-excludes the recipe via filters.ts (real integration, not a mock)', () => {
  const recipe = makeRecipe({ id: 'peanut-noodles', slug: 'peanut-noodles' });
  const otherProtein = makeRecipe({
    id: 'beef-stew',
    slug: 'beef-stew',
    attributes: { ...richAttributes, protein: 'beef' },
  });
  const household = makeHousehold();
  const member = makeMember();

  const updates = applyCalibrationReaction({ recipe, member_id: member.id, reaction: 'never_recommend' });
  const proteinUpdate = find(updates, 'protein', 'chicken');
  const signal = mergeSignal({
    existing: null,
    update: proteinUpdate,
    household_id: household.id,
    id: 'signal-never-recommend-1',
    now: '2026-08-19T00:00:00.000Z',
  });

  const result = applyHardFilters(
    [recipe, otherProtein],
    household,
    [member],
    [signal],
    emptyRegistry,
    emptyContext,
  );
  assert.deepEqual(result.survivors.map((r) => r.id), ['beef-stew']);
  assert.equal(result.exclusions.length, 1);
  assert.equal(result.exclusions[0].recipe_id, 'peanut-noodles');
  const reason = result.exclusions[0].reasons.find((r) => r.kind === 'strong_dislike');
  assert.ok(reason !== undefined, `expected a strong_dislike reason, got ${JSON.stringify(result.exclusions[0].reasons)}`);
  assert.ok(reason.kind === 'strong_dislike');
  assert.equal(reason.attribute, 'protein');
  assert.equal(reason.attribute_value, 'chicken');
});

// ---------------------------------------------------------------------------
// 6. Targeted boosts: too_much_work (calibration) and matched feedback
//    reasons sharpen ONE attribute without flipping polarity elsewhere.
// ---------------------------------------------------------------------------

test('too_much_work (calibration) boosts effort specifically, clamped at -1; other attributes stay at the base magnitude', () => {
  const recipe = makeRecipe();
  const updates = applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'too_much_work' });
  const effort = find(updates, 'effort', 'medium');
  const protein = find(updates, 'protein', 'chicken');

  // base = -(3/5 * 3/2) = -9/10; boost = -(1/5 * 3/2) = -3/10;
  // effort = clamp(-9/10 + -3/10) = clamp(-12/10) = -1 (clamped).
  assert.ok(eq(protein.value, rational(-9, 10)), `protein value = ${protein.value.num}/${protein.value.den}`);
  assert.ok(eq(effort.value, rational(-1)), `effort value = ${effort.value.num}/${effort.value.den}`);
  assert.equal(protein.durability, 'durable');
  assert.equal(effort.durability, 'durable');
  // Every OTHER pair besides effort must sit exactly at the unboosted base.
  for (const u of updates) {
    if (u.attribute === 'effort') continue;
    assert.ok(eq(u.value, rational(-9, 10)), `${u.attribute}:${u.attribute_value} unexpectedly boosted`);
  }
});

test('feedback reason "too_spicy" boosts spice specifically on top of not_again, clamped at -1', () => {
  const recipe = makeRecipe();
  const updates = applyFeedbackEvent({
    recipe,
    member_id: 'm',
    verdict: 'not_again',
    reason: 'too_spicy',
  });
  const spice = find(updates, 'spice', 'mild');
  const protein = find(updates, 'protein', 'chicken');
  assert.ok(eq(protein.value, rational(-9, 10)));
  assert.ok(eq(spice.value, rational(-1)), `spice value = ${spice.value.num}/${spice.value.den}`);
});

test('feedback reason "not_filling" targets richness only; "too_much_work"/"took_longer_than_expected" target effort only', () => {
  const recipe = makeRecipe();
  const cases: readonly [FeedbackReason, string, string][] = [
    ['not_filling', 'richness', 'medium'],
    ['too_much_work', 'effort', 'medium'],
    ['took_longer_than_expected', 'effort', 'medium'],
    ['too_bland', 'spice', 'mild'],
  ];
  for (const [reason, attribute, value] of cases) {
    const updates = applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'not_again', reason });
    const boosted = find(updates, attribute, value);
    const other = find(updates, 'method', 'oven');
    assert.ok(
      compare(rational(-9, 10), boosted.value) >= 0 || eq(boosted.value, rational(-1)),
      `${reason} did not strengthen ${attribute}`,
    );
    assert.ok(
      compare(boosted.value, other.value) < 0,
      `${reason}: boosted ${attribute} (${boosted.value.num}/${boosted.value.den}) should be more negative than unboosted method (${other.value.num}/${other.value.den})`,
    );
  }
});

test('feedback reason "easy_with_interruptions" has no attribute-axis mapping — every pair stays at the unboosted base', () => {
  const recipe = makeRecipe();
  const updates = applyFeedbackEvent({
    recipe,
    member_id: 'm',
    verdict: 'not_again',
    reason: 'easy_with_interruptions',
  });
  for (const u of updates) {
    assert.ok(eq(u.value, rational(-9, 10)), `${u.attribute}:${u.attribute_value} unexpectedly boosted`);
    assert.ok(eq(u.confidence, rational(2, 5)));
  }
});

// ---------------------------------------------------------------------------
// 7. mergeSignal — clamping, saturating confidence, durability monotonicity
// ---------------------------------------------------------------------------

test('mergeSignal creates a fresh signal from an update when none exists, clamped exactly at the boundaries', () => {
  const overValue: PreferenceSignalUpdate = {
    member_id: 'm',
    attribute: 'protein',
    attribute_value: 'shellfish',
    value: rational(3, 2), // out of [-1,1]
    confidence: rational(7, 4), // out of [0,1]
    durability: 'seasonal',
    source: 'calibration',
  };
  const signal = mergeSignal({
    existing: null,
    update: overValue,
    household_id: 'h1',
    id: 'sig-x',
    now: '2026-08-19T00:00:00.000Z',
  });
  assert.ok(eq(signal.value, ONE), `expected clamp to 1, got ${signal.value.num}/${signal.value.den}`);
  assert.ok(eq(signal.confidence, ONE), `expected clamp to 1, got ${signal.confidence.num}/${signal.confidence.den}`);
  assert.equal(signal.id, 'sig-x');
  assert.equal(signal.updated_at_utc, '2026-08-19T00:00:00.000Z');

  const underValue: PreferenceSignalUpdate = {
    ...overValue,
    value: rational(-5, 2),
    confidence: rational(-1, 3),
  };
  const signal2 = mergeSignal({
    existing: null,
    update: underValue,
    household_id: 'h1',
    id: 'sig-y',
    now: '2026-08-19T00:00:00.000Z',
  });
  assert.ok(eq(signal2.value, rational(-1)), `expected clamp to -1, got ${signal2.value.num}/${signal2.value.den}`);
  assert.ok(eq(signal2.confidence, ZERO), `expected clamp to 0, got ${signal2.confidence.num}/${signal2.confidence.den}`);
});

test('mergeSignal combines confidence via the saturating rule c\' = 1 - (1-c0)(1-c1), hand-computed', () => {
  const existing: PreferenceSignal = {
    id: 'sig-1',
    household_id: 'h1',
    member_id: 'm',
    attribute: 'cuisine',
    attribute_value: 'thai',
    value: rational(1, 2),
    confidence: rational(1, 2),
    durability: 'seasonal',
    source: 'feedback',
    updated_at_utc: '2026-08-01T00:00:00.000Z',
  };
  const update: PreferenceSignalUpdate = {
    member_id: 'm',
    attribute: 'cuisine',
    attribute_value: 'thai',
    value: rational(-1, 2),
    confidence: rational(1, 2),
    durability: 'transient',
    source: 'calibration',
  };
  const merged = mergeSignal({ existing, update, household_id: 'h1', id: 'unused', now: '2026-08-19T00:00:00.000Z' });
  // c' = 1 - (1 - 1/2)(1 - 1/2) = 1 - 1/4 = 3/4.
  assert.ok(eq(merged.confidence, rational(3, 4)), `confidence = ${merged.confidence.num}/${merged.confidence.den}`);
  // value = (1/2 * 1/2 + (-1/2) * 1/2) / (1/2 + 1/2) = 0 / 1 = 0.
  assert.ok(eq(merged.value, ZERO), `value = ${merged.value.num}/${merged.value.den}`);
  // Existing id is preserved on merge, never the caller-supplied fallback id.
  assert.equal(merged.id, 'sig-1');
  // Durability moves up: seasonal (existing) vs transient (update) -> seasonal.
  assert.equal(merged.durability, 'seasonal');
});

test('mergeSignal: once confidence reaches 1 it is locked at 1 through every future merge', () => {
  const locked: PreferenceSignal = {
    id: 'sig-lock',
    household_id: 'h1',
    member_id: 'm',
    attribute: 'protein',
    attribute_value: 'chicken',
    value: rational(-1),
    confidence: ONE,
    durability: 'durable',
    source: 'calibration',
    updated_at_utc: '2026-08-01T00:00:00.000Z',
  };
  let current = locked;
  const weakPositive: PreferenceSignalUpdate = {
    member_id: 'm',
    attribute: 'protein',
    attribute_value: 'chicken',
    value: rational(2, 5),
    confidence: rational(1, 5),
    durability: 'transient',
    source: 'calibration',
  };
  for (let i = 0; i < 5; i += 1) {
    current = mergeSignal({
      existing: current,
      update: weakPositive,
      household_id: 'h1',
      id: 'unused',
      now: '2026-08-19T00:00:00.000Z',
    });
    assert.ok(eq(current.confidence, ONE), `confidence drifted from 1 after merge #${i + 1}`);
    assert.equal(current.durability, 'durable', `durability downgraded after merge #${i + 1}`);
  }
  // Value is NOT literally frozen — it may drift toward the repeated
  // countervailing evidence — but stays strongly negative after only 5
  // weak-positive merges (deliberate design: durable ≠ permanently immovable).
  assert.equal(compare(current.value, ZERO), -1, 'value drifted non-negative after only 5 weak positives');
});

test('mergeSignal: durability never downgrades — durable existing + transient update stays durable', () => {
  const existing: PreferenceSignal = {
    id: 'sig-1',
    household_id: 'h1',
    member_id: null,
    attribute: 'method',
    attribute_value: 'stir_fry',
    value: rational(-1),
    confidence: rational(9, 10),
    durability: 'durable',
    source: 'feedback',
    updated_at_utc: '2026-08-01T00:00:00.000Z',
  };
  const update: PreferenceSignalUpdate = {
    member_id: null,
    attribute: 'method',
    attribute_value: 'stir_fry',
    value: rational(1, 10),
    confidence: rational(1, 10),
    durability: 'transient',
    source: 'calibration',
  };
  const merged = mergeSignal({ existing, update, household_id: 'h1', id: 'unused', now: '2026-08-19T00:00:00.000Z' });
  assert.equal(merged.durability, 'durable');
});

test('mergeSignal throws when the update does not identify the same (member, attribute, attribute_value) as existing', () => {
  const existing = makeSignal({ attribute: 'protein', attribute_value: 'chicken', member_id: 'm1' });
  const mismatchedAttribute: PreferenceSignalUpdate = {
    member_id: 'm1',
    attribute: 'cuisine',
    attribute_value: 'chicken',
    value: ZERO,
    confidence: ZERO,
    durability: 'transient',
    source: 'calibration',
  };
  assert.throws(() =>
    mergeSignal({ existing, update: mismatchedAttribute, household_id: 'h1', id: 'x', now: '2026-08-19T00:00:00.000Z' }),
  );

  const mismatchedMember: PreferenceSignalUpdate = {
    member_id: 'someone-else',
    attribute: 'protein',
    attribute_value: 'chicken',
    value: ZERO,
    confidence: ZERO,
    durability: 'transient',
    source: 'calibration',
  };
  assert.throws(() =>
    mergeSignal({ existing, update: mismatchedMember, household_id: 'h1', id: 'x', now: '2026-08-19T00:00:00.000Z' }),
  );
});

test('mergeSignal accepts an attribute_value outside any currently-authored recipe (a free-text string) without special validation', () => {
  const update: PreferenceSignalUpdate = {
    member_id: 'm',
    attribute: 'cuisine',
    attribute_value: 'atlantean',
    value: rational(1, 5),
    confidence: rational(1, 5),
    durability: 'transient',
    source: 'calibration',
  };
  const signal = mergeSignal({ existing: null, update, household_id: 'h1', id: 'sig-exotic', now: '2026-08-19T00:00:00.000Z' });
  assert.equal(signal.attribute_value, 'atlantean');
  assert.ok(eq(signal.value, rational(1, 5)));
});

// ---------------------------------------------------------------------------
// 8. Determinism
// ---------------------------------------------------------------------------

test('applyCalibrationReaction and applyFeedbackEvent are deterministic: identical inputs give identical outputs', () => {
  const recipe = makeRecipe();
  const a = applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'too_much_work' });
  const b = applyCalibrationReaction({ recipe, member_id: 'm', reaction: 'too_much_work' });
  assert.deepEqual(a, b);

  const c = applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'not_again', reason: 'too_spicy' });
  const d = applyFeedbackEvent({ recipe, member_id: 'm', verdict: 'not_again', reason: 'too_spicy' });
  assert.deepEqual(c, d);
});
