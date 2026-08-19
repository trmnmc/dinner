/**
 * reasons.test.ts — regression tests for the single copy module (T-013).
 *
 * Expected strings below are typed as LITERALS, independently of the
 * module's own templates — comparing rendered output to a second call
 * into the same templates would pass even if the copy silently drifted
 * (the exact hole this test file is required to avoid). Every literal was
 * hand-computed from the fixture inputs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReasonCode } from '../domain/src/recipe.ts';
import {
  MAX_REASON_CODES_PER_MEAL,
  NO_RECOVERY_GUIDANCE_TEXT,
  ReasonsError,
  renderActiveTimeLabel,
  renderMealReasons,
  renderReason,
  renderRecoveryGuidance,
  renderSwapNoAlternatives,
  renderTotalActiveTime,
  renderTotalActiveTimeFor,
} from '../domain/src/reasons.ts';
import type { ReasonFact, SwapNoAlternativesCounts } from '../domain/src/reasons.ts';

// ---------------------------------------------------------------------------
// The shared total-vs-active time renderer — DoD 6.
// ---------------------------------------------------------------------------

test('renderTotalActiveTime: exact minutes, matching DESIGN.md\'s own example verbatim', () => {
  const t = renderTotalActiveTime(1320, 420); // 22 min, 7 min
  assert.equal(t.total_minutes, 22);
  assert.equal(t.active_minutes, 7);
  assert.equal(t.total_label, '22 min total');
  assert.equal(t.active_label, '7 min hands-on');
  assert.equal(t.combined_label, '22 min total, 7 min hands-on');
  assert.equal(t.total_seconds, 1320);
  assert.equal(t.active_seconds, 420);
});

test('renderTotalActiveTime: every field is present on every result — total and active are structurally inseparable', () => {
  const t = renderTotalActiveTime(600, 300);
  const keys = Object.keys(t).sort();
  assert.deepEqual(keys, [
    'active_label',
    'active_minutes',
    'active_seconds',
    'combined_label',
    'total_label',
    'total_minutes',
    'total_seconds',
  ]);
});

test('renderTotalActiveTime: exact half-minute rounds away from zero (30s -> 1 min, 1350s -> 23 min)', () => {
  assert.equal(renderTotalActiveTime(30, 0).total_label, '1 min total');
  assert.equal(renderTotalActiveTime(1350, 0).total_label, '23 min total');
});

test('renderTotalActiveTime: under 30s rounds down to zero minutes, rendered honestly as "under 1 min", never "0 min"', () => {
  const t = renderTotalActiveTime(29, 0);
  assert.equal(t.total_minutes, 0);
  assert.equal(t.total_label, 'under 1 min total');
  assert.equal(t.active_label, 'under 1 min hands-on');
});

test('renderTotalActiveTime: rejects active_seconds greater than total_seconds', () => {
  assert.throws(
    () => renderTotalActiveTime(60, 120),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});

test('renderTotalActiveTime: rejects negative or non-integer seconds', () => {
  assert.throws(() => renderTotalActiveTime(-1, 0), (e: unknown) => e instanceof ReasonsError);
  assert.throws(() => renderTotalActiveTime(60, -1), (e: unknown) => e instanceof ReasonsError);
  assert.throws(() => renderTotalActiveTime(60.5, 0), (e: unknown) => e instanceof ReasonsError);
});

test('renderTotalActiveTimeFor: same renderer, applied to a recipe-shaped carrier', () => {
  const t = renderTotalActiveTimeFor({ total_time_seconds: 1320, active_time_seconds: 420 });
  assert.equal(t.combined_label, '22 min total, 7 min hands-on');
});

// ---------------------------------------------------------------------------
// renderActiveTimeLabel — T-040: the bare active-only label for
// `prep.ts`'s `ActiveTimeBlock`, which carries no `total_seconds` to pair
// with `renderTotalActiveTime`. Must never drift from that renderer's own
// `active_label` for the same duration (that IS the point of the item).
// ---------------------------------------------------------------------------

test('renderActiveTimeLabel: sub-minute boundary — 0 seconds and a value that rounds to 0 both render "under 1 min hands-on"', () => {
  assert.equal(renderActiveTimeLabel(0), 'under 1 min hands-on');
  assert.equal(renderActiveTimeLabel(29), 'under 1 min hands-on');
});

test('renderActiveTimeLabel: exactly 60s renders "1 min hands-on"', () => {
  assert.equal(renderActiveTimeLabel(60), '1 min hands-on');
});

test('renderActiveTimeLabel: exact half-minute rounds away from zero (750s = 12.5 min -> 13 min hands-on)', () => {
  assert.equal(renderActiveTimeLabel(750), '13 min hands-on');
});

test('renderActiveTimeLabel: rejects negative or non-integer seconds', () => {
  assert.throws(() => renderActiveTimeLabel(-1), (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input');
  assert.throws(() => renderActiveTimeLabel(60.5), (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input');
});

test('renderActiveTimeLabel: IDENTICAL to renderTotalActiveTime\'s active_label for the same active duration — the anti-drift assertion', () => {
  for (const seconds of [0, 1, 29, 30, 45, 59, 60, 61, 90, 420, 421, 750, 1000, 3599, 3600]) {
    const fromHelper = renderActiveTimeLabel(seconds);
    // total_seconds must be >= active_seconds for renderTotalActiveTime to
    // accept it; passing the same value for both isolates the active side.
    const fromPairedRenderer = renderTotalActiveTime(seconds, seconds).active_label;
    assert.equal(fromHelper, fromPairedRenderer, `drifted at ${String(seconds)}s`);
  }
});

// ---------------------------------------------------------------------------
// Recovery / panic copy — Invariant 6, never fabricated.
// ---------------------------------------------------------------------------

test('renderRecoveryGuidance: instruction metadata renders VERBATIM, no wrapping text added', () => {
  assert.equal(
    renderRecoveryGuidance({ kind: 'instruction', text: 'Slide the pan off the heat.' }),
    'Slide the pan off the heat.',
  );
});

test('renderRecoveryGuidance: none_available renders the one fixed, honest sentence', () => {
  assert.equal(renderRecoveryGuidance({ kind: 'none_available' }), 'No recovery guidance for this step.');
  assert.equal(NO_RECOVERY_GUIDANCE_TEXT, 'No recovery guidance for this step.');
});

test('renderRecoveryGuidance: the only two reachable outputs are the metadata text or the fixed sentence', () => {
  const cases: Array<{ readonly kind: 'instruction'; readonly text: string } | { readonly kind: 'none_available' }> = [
    { kind: 'instruction', text: 'Cool the pan and re-cover.' },
    { kind: 'none_available' },
    { kind: 'instruction', text: 'Turn off the timer and taste for doneness.' },
  ];
  for (const guidance of cases) {
    const out = renderRecoveryGuidance(guidance);
    if (guidance.kind === 'instruction') {
      assert.equal(out, guidance.text);
    } else {
      assert.equal(out, NO_RECOVERY_GUIDANCE_TEXT);
    }
  }
});

// ---------------------------------------------------------------------------
// Reason-code copy — pinned literals per code, hand-computed.
// ---------------------------------------------------------------------------

test('matches_taste', () => {
  assert.equal(
    renderReason({ code: 'matches_taste', attribute: 'flavour', attribute_value: 'spicy', signal_count: 3 }).text,
    'Matches your rated taste for spicy flavour (3 ratings).',
  );
  assert.equal(
    renderReason({ code: 'matches_taste', attribute: 'protein', attribute_value: 'chicken', signal_count: 1 }).text,
    'Matches your rated taste for chicken protein (1 rating).',
  );
});

test('quick_total_time', () => {
  assert.equal(
    renderReason({ code: 'quick_total_time', total_seconds: 1320, active_seconds: 420 }).text,
    '22 min total, 7 min hands-on.',
  );
});

test('low_active_time', () => {
  assert.equal(
    renderReason({ code: 'low_active_time', total_seconds: 1320, active_seconds: 420 }).text,
    '7 min hands-on out of 22 min total.',
  );
});

test('quick_total_time and low_active_time render different text for the same numbers (one label per intent)', () => {
  const a = renderReason({ code: 'quick_total_time', total_seconds: 1320, active_seconds: 420 }).text;
  const b = renderReason({ code: 'low_active_time', total_seconds: 1320, active_seconds: 420 }).text;
  assert.notEqual(a, b);
});

test('interruption_friendly', () => {
  assert.equal(
    renderReason({ code: 'interruption_friendly', pausable_step_count: 5, total_step_count: 7 }).text,
    '5 of 7 steps are safe to pause.',
  );
});

test('uses_owned_ingredients', () => {
  assert.equal(
    renderReason({ code: 'uses_owned_ingredients', owned_count: 4, total_count: 6 }).text,
    'Uses 4 of 6 ingredients already on hand.',
  );
});

test('shares_ingredients', () => {
  assert.equal(
    renderReason({ code: 'shares_ingredients', shared_count: 4, other_meal_name: "Tuesday's stir-fry" }).text,
    "Shares 4 ingredients with Tuesday's stir-fry.",
  );
  assert.equal(
    renderReason({ code: 'shares_ingredients', shared_count: 1, other_meal_name: 'Wednesday' }).text,
    'Shares 1 ingredient with Wednesday.',
  );
});

test('budget_friendly', () => {
  assert.equal(
    renderReason({ code: 'budget_friendly', cost_band: 'low', ingredient_count: 9 }).text,
    'Low-cost ingredient list: 9 items.',
  );
  assert.equal(
    renderReason({ code: 'budget_friendly', cost_band: 'medium', ingredient_count: 1 }).text,
    'Mid-cost ingredient list: 1 item.',
  );
  assert.equal(
    renderReason({ code: 'budget_friendly', cost_band: 'high', ingredient_count: 12 }).text,
    'Higher-cost ingredient list: 12 items.',
  );
});

test('few_dishes', () => {
  assert.equal(renderReason({ code: 'few_dishes', dish_count: 2 }).text, '2 dishes to wash.');
  assert.equal(renderReason({ code: 'few_dishes', dish_count: 1 }).text, '1 dish to wash.');
});

test('familiar_favourite', () => {
  assert.equal(renderReason({ code: 'familiar_favourite', times_cooked: 5 }).text, 'Cooked 5 times before.');
  assert.equal(renderReason({ code: 'familiar_favourite', times_cooked: 1 }).text, 'Cooked 1 time before.');
});

test('adjacent_novelty', () => {
  assert.equal(
    renderReason({
      code: 'adjacent_novelty',
      familiar_attribute: 'protein',
      familiar_value: 'chicken',
      new_attribute: 'cuisine',
      new_value: 'korean',
    }).text,
    'Keeps the chicken protein you know, tries korean cuisine.',
  );
});

test('leftover_friendly', () => {
  assert.equal(renderReason({ code: 'leftover_friendly', extra_servings: 2 }).text, 'Makes 2 extra servings for later.');
  assert.equal(renderReason({ code: 'leftover_friendly', extra_servings: 1 }).text, 'Makes 1 extra serving for later.');
});

// ---------------------------------------------------------------------------
// Exhaustiveness — all eleven ReasonCodes render, none is a placeholder.
// ---------------------------------------------------------------------------

const ALL_ELEVEN_CODES: readonly ReasonCode[] = [
  'matches_taste',
  'quick_total_time',
  'low_active_time',
  'interruption_friendly',
  'uses_owned_ingredients',
  'shares_ingredients',
  'budget_friendly',
  'few_dishes',
  'familiar_favourite',
  'adjacent_novelty',
  'leftover_friendly',
];

const ONE_FACT_PER_CODE: readonly ReasonFact[] = [
  { code: 'matches_taste', attribute: 'spice', attribute_value: 'hot', signal_count: 2 },
  { code: 'quick_total_time', total_seconds: 900, active_seconds: 300 },
  { code: 'low_active_time', total_seconds: 900, active_seconds: 300 },
  { code: 'interruption_friendly', pausable_step_count: 3, total_step_count: 4 },
  { code: 'uses_owned_ingredients', owned_count: 3, total_count: 5 },
  { code: 'shares_ingredients', shared_count: 2, other_meal_name: 'Monday' },
  { code: 'budget_friendly', cost_band: 'low', ingredient_count: 8 },
  { code: 'few_dishes', dish_count: 3 },
  { code: 'familiar_favourite', times_cooked: 2 },
  { code: 'adjacent_novelty', familiar_attribute: 'method', familiar_value: 'stovetop', new_attribute: 'flavour', new_value: 'smoky' },
  { code: 'leftover_friendly', extra_servings: 3 },
];

test('exhaustiveness: the test fixture itself covers exactly the eleven frozen ReasonCodes', () => {
  assert.equal(ALL_ELEVEN_CODES.length, 11);
  assert.deepEqual(
    ONE_FACT_PER_CODE.map((f) => f.code).sort(),
    [...ALL_ELEVEN_CODES].sort(),
  );
});

test('exhaustiveness: every ReasonCode renders non-empty, non-placeholder text', () => {
  for (const fact of ONE_FACT_PER_CODE) {
    const rendered = renderReason(fact);
    assert.equal(rendered.code, fact.code);
    assert.ok(rendered.text.length > 0, `${fact.code} rendered empty text`);
    assert.notEqual(rendered.text.trim(), '', `${fact.code} rendered whitespace-only text`);
    assert.doesNotMatch(rendered.text, /undefined|\[object Object\]|NaN/, `${fact.code} leaked a raw value`);
    assert.ok(rendered.text.endsWith('.'), `${fact.code} did not render a full sentence`);
  }
});

// ---------------------------------------------------------------------------
// The three-reason cap.
// ---------------------------------------------------------------------------

test('renderMealReasons: exactly three facts renders three reasons', () => {
  assert.equal(MAX_REASON_CODES_PER_MEAL, 3);
  const rendered = renderMealReasons(ONE_FACT_PER_CODE.slice(0, 3));
  assert.equal(rendered.length, 3);
});

test('renderMealReasons: zero facts renders zero reasons (a meal need not carry any)', () => {
  assert.deepEqual(renderMealReasons([]), []);
});

test('renderMealReasons: four facts is rejected, not silently truncated to three', () => {
  assert.throws(
    () => renderMealReasons(ONE_FACT_PER_CODE.slice(0, 4)),
    (e: unknown) => e instanceof ReasonsError && e.code === 'too_many_reasons',
  );
});

// ---------------------------------------------------------------------------
// Voice: guilt-free, no false marketing, no invented precision. A
// banned-phrase sweep over the FULL rendered corpus (all eleven reason
// codes + the DESIGN.md time example + recovery guidance).
// ---------------------------------------------------------------------------

const BANNED_PHRASES = [
  'waste',
  'you should',
  "should've",
  'should have',
  'convenient',
  'guilt',
  'lazy',
  'quick', // DESIGN.md's own anti-example is "quick and convenient" — banned outright
  'engagement',
  'streak',
  "don't miss",
  'limited time',
];

test('voice: no banned guilt/marketing phrase appears anywhere in the rendered corpus', () => {
  const corpus: string[] = [
    ...ONE_FACT_PER_CODE.map((f) => renderReason(f).text),
    renderTotalActiveTime(1320, 420).combined_label,
    renderRecoveryGuidance({ kind: 'none_available' }),
    renderRecoveryGuidance({ kind: 'instruction', text: 'Turn off the heat and let it rest.' }),
  ];
  const lowerCorpus = corpus.join(' \n ').toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    assert.ok(!lowerCorpus.includes(phrase.toLowerCase()), `banned phrase "${phrase}" found in rendered copy`);
  }
});

test('voice: every rendered reason carries at least one digit (concrete and countable, not vague)', () => {
  for (const fact of ONE_FACT_PER_CODE) {
    // adjacent_novelty and matches_taste name concrete attribute VALUES
    // rather than a count in the main clause; every other code is purely
    // numeric. Both still originate from caller-supplied real data, never
    // free text — assert the numeric ones actually contain a digit.
    const text = renderReason(fact).text;
    if (fact.code === 'adjacent_novelty') continue;
    assert.match(text, /\d/, `${fact.code} rendered no digit: "${text}"`);
  }
});

// ---------------------------------------------------------------------------
// Fabrication guard: recovery text can only ever be metadata-verbatim or
// the fixed absence sentence — never assembled from a reason code or any
// other source.
// ---------------------------------------------------------------------------

test('fabrication guard: renderRecoveryGuidance never produces text absent from the input', () => {
  const instructionText = 'Whisk vigorously off the heat until it comes back together.';
  const out = renderRecoveryGuidance({ kind: 'instruction', text: instructionText });
  assert.equal(out, instructionText);
  assert.notEqual(out, NO_RECOVERY_GUIDANCE_TEXT);

  const absent = renderRecoveryGuidance({ kind: 'none_available' });
  assert.equal(absent, NO_RECOVERY_GUIDANCE_TEXT);
  assert.notEqual(absent, instructionText);
});

// ---------------------------------------------------------------------------
// renderSwapNoAlternatives — T-038: WHY a swap slot has nothing to offer,
// from the same honest counts swap.ts's `swapMeal` computes. Expected
// strings below are literals, hand-computed from the fixture counts, same
// discipline as the ReasonCode literals above.
// ---------------------------------------------------------------------------

test('renderSwapNoAlternatives: no_candidates_in_pool — empty pool, honest catalog-gap framing', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 0, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0 };
  const out = renderSwapNoAlternatives('no_candidates_in_pool', counts);
  assert.equal(out.code, 'no_candidates_in_pool');
  assert.equal(
    out.text,
    "There are no other recipes in the catalog to offer for this slot right now — that's a catalog gap, not something about your preferences.",
  );
});

test('renderSwapNoAlternatives: no_candidates_in_pool — catalog-gap clause survives verbatim', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 0, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0 };
  const out = renderSwapNoAlternatives('no_candidates_in_pool', counts);
  assert.ok(
    out.text.includes("that's a catalog gap, not something about your preferences."),
    `catalog-gap clause missing or reworded: "${out.text}"`,
  );
});

test('renderSwapNoAlternatives: all_candidates_already_in_plan — plural count (n=3, regression pin)', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 3, already_in_plan: 3, ineligible_for_reason: 0, eligible: 0 };
  const out = renderSwapNoAlternatives('all_candidates_already_in_plan', counts);
  assert.equal(out.code, 'all_candidates_already_in_plan');
  assert.equal(out.text, 'All 3 recipes that could fill this slot are already in this plan.');
});

test('renderSwapNoAlternatives: all_candidates_already_in_plan — plural count (n=2, regression pin)', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 2, already_in_plan: 2, ineligible_for_reason: 0, eligible: 0 };
  const out = renderSwapNoAlternatives('all_candidates_already_in_plan', counts);
  assert.equal(out.text, 'All 2 recipes that could fill this slot are already in this plan.');
});

test('renderSwapNoAlternatives: all_candidates_already_in_plan — plural count (n=7, regression pin, n > 2)', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 7, already_in_plan: 7, ineligible_for_reason: 0, eligible: 0 };
  const out = renderSwapNoAlternatives('all_candidates_already_in_plan', counts);
  assert.equal(out.text, 'All 7 recipes that could fill this slot are already in this plan.');
});

test('renderSwapNoAlternatives: all_candidates_already_in_plan — n===1 renders grammatical singular copy (T-038 defect 1 fix)', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 1, already_in_plan: 1, ineligible_for_reason: 0, eligible: 0 };
  const out = renderSwapNoAlternatives('all_candidates_already_in_plan', counts);
  assert.equal(out.text, 'The one recipe that could fill this slot is already in this plan.');
  assert.ok(!out.text.includes('All 1 '), `ungrammatical "All 1 " construction leaked back in: "${out.text}"`);
  assert.ok(!/\b1 recipe\b.*\bis\b/.test(out.text), `ungrammatical "1 recipe ... is" construction leaked back in: "${out.text}"`);
});

test('renderSwapNoAlternatives: no_candidate_satisfies_reason — says how many were looked at and ruled out', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 6, already_in_plan: 2, ineligible_for_reason: 4, eligible: 0 };
  const out = renderSwapNoAlternatives('no_candidate_satisfies_reason', counts);
  assert.equal(out.code, 'no_candidate_satisfies_reason');
  assert.equal(out.text, '4 recipes were available for this slot, and none of them deliver that reason.');
});

test('renderSwapNoAlternatives: no_candidate_satisfies_reason — singular count gets singular grammar', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 1, already_in_plan: 0, ineligible_for_reason: 1, eligible: 0 };
  const out = renderSwapNoAlternatives('no_candidate_satisfies_reason', counts);
  assert.equal(out.text, "1 recipe was available for this slot, and it doesn't deliver that reason.");
});

test('renderSwapNoAlternatives: every rendered sentence is a complete sentence (voice: concrete and countable)', () => {
  const fixtures: readonly [import('../domain/src/reasons.ts').SwapNoAlternativesCode, SwapNoAlternativesCounts][] = [
    ['no_candidates_in_pool', { pool_size: 0, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0 }],
    ['all_candidates_already_in_plan', { pool_size: 2, already_in_plan: 2, ineligible_for_reason: 0, eligible: 0 }],
    ['no_candidate_satisfies_reason', { pool_size: 2, already_in_plan: 0, ineligible_for_reason: 2, eligible: 0 }],
  ];
  for (const [code, counts] of fixtures) {
    const text = renderSwapNoAlternatives(code, counts).text;
    assert.ok(text.endsWith('.'), `${code} did not render a full sentence`);
    // no_candidates_in_pool is the sole exception: validateSwapNoAlternativesCounts
    // forces pool_size === 0 on this arm, so a digit there would be decorative
    // rather than countable (T-038 defect 2) — every other arm still counts.
    if (code === 'no_candidates_in_pool') {
      assert.ok(!/\d/.test(text), `no_candidates_in_pool rendered a dead-count digit: "${text}"`);
    } else {
      assert.match(text, /\d/, `${code} rendered no digit: "${text}"`);
    }
  }
});

test('renderSwapNoAlternatives: no banned guilt/marketing phrase in the rendered corpus', () => {
  const corpus = [
    renderSwapNoAlternatives('no_candidates_in_pool', { pool_size: 0, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0 }).text,
    renderSwapNoAlternatives('all_candidates_already_in_plan', { pool_size: 2, already_in_plan: 2, ineligible_for_reason: 0, eligible: 0 })
      .text,
    renderSwapNoAlternatives('no_candidate_satisfies_reason', { pool_size: 2, already_in_plan: 0, ineligible_for_reason: 2, eligible: 0 })
      .text,
  ]
    .join(' \n ')
    .toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    assert.ok(!corpus.includes(phrase.toLowerCase()), `banned phrase "${phrase}" found in swap no-alternatives copy`);
  }
});

test('renderSwapNoAlternatives: rejects a positive eligible count on a no-alternatives outcome', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 1, already_in_plan: 0, ineligible_for_reason: 0, eligible: 1 };
  assert.throws(
    () => renderSwapNoAlternatives('no_candidates_in_pool', counts),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});

test('renderSwapNoAlternatives: rejects counts that do not sum back to pool_size', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 5, already_in_plan: 1, ineligible_for_reason: 1, eligible: 0 };
  assert.throws(
    () => renderSwapNoAlternatives('no_candidate_satisfies_reason', counts),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});

test('renderSwapNoAlternatives: rejects no_candidates_in_pool paired with a non-empty pool', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 2, already_in_plan: 2, ineligible_for_reason: 0, eligible: 0 };
  assert.throws(
    () => renderSwapNoAlternatives('no_candidates_in_pool', counts),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});

test('renderSwapNoAlternatives: rejects all_candidates_already_in_plan when some candidates were ineligible instead', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 3, already_in_plan: 2, ineligible_for_reason: 1, eligible: 0 };
  assert.throws(
    () => renderSwapNoAlternatives('all_candidates_already_in_plan', counts),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});

test('renderSwapNoAlternatives: rejects all_candidates_already_in_plan against an empty pool (that combination is no_candidates_in_pool)', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 0, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0 };
  assert.throws(
    () => renderSwapNoAlternatives('all_candidates_already_in_plan', counts),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});

test('renderSwapNoAlternatives: rejects no_candidate_satisfies_reason when nothing was actually ineligible', () => {
  const counts: SwapNoAlternativesCounts = { pool_size: 2, already_in_plan: 2, ineligible_for_reason: 0, eligible: 0 };
  assert.throws(
    () => renderSwapNoAlternatives('no_candidate_satisfies_reason', counts),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});

test('renderSwapNoAlternatives: rejects negative or non-integer counts', () => {
  assert.throws(
    () => renderSwapNoAlternatives('no_candidates_in_pool', { pool_size: -1, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0 }),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
  assert.throws(
    () =>
      renderSwapNoAlternatives('all_candidates_already_in_plan', {
        pool_size: 1.5,
        already_in_plan: 1.5,
        ineligible_for_reason: 0,
        eligible: 0,
      }),
    (e: unknown) => e instanceof ReasonsError && e.code === 'malformed_input',
  );
});
