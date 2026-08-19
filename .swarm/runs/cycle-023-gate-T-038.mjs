/**
 * cycle-023-gate-T-038.mjs — CONDUCTOR-authored verification gate, cycle 23.
 *
 * Item under test: T-038 — "Copy for the three swap no-alternatives outcomes",
 * `attempts: 1`, failed cycle 21's gate 13/14 on one ungrammatical sentence.
 *
 * The builder never saw this file. Every expected string below was derived
 * this cycle from the ITEM'S ACCEPTANCE plus `validateSwapNoAlternativesCounts`,
 * not from the builder's report — the builder's claimed sentences are treated
 * as claims and are re-derived here independently.
 *
 * What this gate adds over the unit tests the builder wrote (which it does not
 * trust on their own, since a builder can write a test that pins whatever its
 * code happens to do):
 *
 *   - MUTATION KILLS. Each of the two fixes is individually reverted in a
 *     scratch copy of reasons.ts and the suite is re-run. A test suite that
 *     still passes against the reverted defect is a vacuous suite, and the item
 *     would fail this gate even with green tests.
 *   - WIRE REACHABILITY. routes.ts:980 is the only path by which this copy
 *     reaches a user. The gate boots the real server and proves the sentence
 *     the domain renders is the sentence the HTTP response carries — the
 *     builder was forbidden to touch routes.ts and could not have checked this.
 *
 * Run: node .swarm/runs/cycle-023-gate-T-038.mjs
 */

import { boot, makeHousehold, makePlan, currentPlan, api } from './cycle-014-fixture.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';

let pass = 0, fail = 0;
const failures = [];
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; failures.push(`${id}: ${detail ?? ''}`); console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};

const REASONS = new URL('../../domain/src/reasons.ts', import.meta.url).pathname;
const ROOT = new URL('../../', import.meta.url).pathname;
const counts = (o) => ({ pool_size: 0, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0, ...o });

const { renderSwapNoAlternatives } = await import('../../domain/src/reasons.ts');

console.log('=== T-038: the copy itself ===');

// --- Defect 1: the n === 1 sentence, the sole reason cycle 21 failed. -----
const one = renderSwapNoAlternatives('all_candidates_already_in_plan', counts({ pool_size: 1, already_in_plan: 1 })).text;
console.log(`  n=1  → "${one}"`);
check('G1', !/\bAll 1\b/.test(one), `the ungrammatical "All 1 …" construction is gone`);
check('G2', !/\b1 recipe\b[^.]*\bis\b/.test(one), `the ungrammatical "1 recipe … is" construction is gone`);
check('G3', /\.$/.test(one) && /already in this plan/i.test(one) && one.split(' ').length >= 8,
  `n=1 still says the thing it exists to say, as a full sentence`);
// Grammar, judged mechanically: subject and verb must agree. Any surviving
// numeral-plus-singular-noun-plus-plural-verb pattern (or its inverse) fails.
check('G4', !/\b\d+ recipe\b[^.]*\bare\b/.test(one) && !/\brecipes\b[^.]*\bis\b/.test(one),
  `subject/verb agreement holds in the n=1 sentence`);

// --- Defect 2: the empty-pool arm. ---------------------------------------
const empty = renderSwapNoAlternatives('no_candidates_in_pool', counts({})).text;
console.log(`  pool=0 → "${empty}"`);
check('G5', empty.includes("that's a catalog gap, not something about your preferences."),
  `the catalog-gap clause survives VERBATIM (mutant M2 from cycle 21 pinned this)`);
check('G6', !/\d/.test(empty), `the dead "0" count is gone — the validator proves pool_size can only be 0 here`);
check('G7', /^There are no other recipes/i.test(empty), `the arm now opens in plain English`);

// --- Regression: the plural arm must be untouched. ------------------------
const plurals = [2, 3, 7].map((n) => [n, renderSwapNoAlternatives('all_candidates_already_in_plan', counts({ pool_size: n, already_in_plan: n })).text]);
plurals.forEach(([n, t]) => console.log(`  n=${n}  → "${t}"`));
check('G8', plurals.every(([n, t]) => t === `All ${n} recipes that could fill this slot are already in this plan.`),
  `the n>1 string is byte-identical to the cycle-21 committed copy at n=2,3,7`);

// --- The third arm must not have regressed either. ------------------------
const r1 = renderSwapNoAlternatives('no_candidate_satisfies_reason', counts({ pool_size: 1, ineligible_for_reason: 1 })).text;
const r3 = renderSwapNoAlternatives('no_candidate_satisfies_reason', counts({ pool_size: 3, ineligible_for_reason: 3 })).text;
check('G9', /^1 recipe was available/.test(r1) && /^3 recipes were available/.test(r3) && /\d/.test(r1) && /\d/.test(r3),
  `the untouched third arm still counts and still agrees (n=1 "${r1.slice(0, 34)}…", n=3 "${r3.slice(0, 34)}…")`);

// =========================================================================
// MUTATION KILLS — are the tests that guard this actually load-bearing?
// =========================================================================
console.log('\n=== T-038: mutation kills (is the suite vacuous?) ===');

const original = readFileSync(REASONS, 'utf8');
const backup = REASONS + '.gate-backup';
copyFileSync(REASONS, backup);

/** Apply a mutation, run the suite, restore. Returns true if the suite FAILED
 *  (i.e. the mutant was killed — which is the passing outcome for us). */
function mutantKilled(label, from, to) {
  const mutated = original.replace(from, to);
  if (mutated === original) { console.log(`  (mutation "${label}" did not apply — pattern not found)`); return null; }
  writeFileSync(REASONS, mutated);
  let killed = false, out = '';
  try {
    execFileSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 });
  } catch (e) {
    killed = true;
    out = String(e.stdout || '') + String(e.stderr || '');
  } finally {
    writeFileSync(REASONS, original);
  }
  const failing = (out.match(/^# fail (\d+)$/m) || out.match(/ℹ fail (\d+)/) || [])[1];
  console.log(`  mutant "${label}": ${killed ? `KILLED (${failing ?? '?'} failing test(s))` : 'SURVIVED'}`);
  return killed;
}

const m1 = mutantKilled(
  'M1 — restore the ungrammatical "All 1 recipe … is"',
  "      if (n === 1) {\n        return 'The one recipe that could fill this slot is already in this plan.';\n      }\n      return `All ${String(n)} recipe${pluralS(n)} that could fill this slot are already in this plan.`;",
  "      return `All ${String(n)} recipe${pluralS(n)} that could fill this slot ${n === 1 ? 'is' : 'are'} already in this plan.`;",
);
check('G10', m1 === true, `reverting defect 1 breaks the suite — the n=1 fix is genuinely test-guarded, not decorative`);

const m2 = mutantKilled(
  'M2 — restore the dead "0" count on the empty-pool arm',
  "      return `There are no other recipes in the catalog to offer for this slot right now — that's a catalog gap, not something about your preferences.`;",
  "      return `The catalog has ${String(counts.pool_size)} other recipes to offer for this slot right now — that's a catalog gap, not something about your preferences.`;",
);
check('G11', m2 === true, `reverting defect 2 breaks the suite`);

const m3 = mutantKilled(
  'M3 — drop the catalog-gap reassurance clause',
  " — that's a catalog gap, not something about your preferences.`;",
  ".`;",
);
check('G12', m3 === true, `deleting the catalog-gap clause breaks the suite (the clause is pinned, not incidental)`);

// Restore-integrity check: the gate must leave the file exactly as it found it.
check('G13', readFileSync(REASONS, 'utf8') === original, `reasons.ts is byte-identical after mutation testing`);
rmSync(backup, { force: true });

// =========================================================================
// WIRE REACHABILITY — routes.ts:980 is the only path to a real user.
// =========================================================================
console.log('\n=== T-038: does this copy reach a user? ===');

const server = await boot();
const { baseUrl } = server;
try {
  const hh = await makeHousehold(baseUrl, { household: { name: 'C23 T-038', household_size: 4 } });
  await makePlan(baseUrl, hh);
  const plan = (await currentPlan(baseUrl, hh)).body.plan;
  const slot = plan.meals[0].slot ?? plan.meals[0].slot_index ?? 1;

  // Exhaust the pool: keep asking for a swap on the same slot until the server
  // says it has nothing left. A 6-recipe catalog makes this terminate fast.
  let sawNoAlternatives = null;
  for (let i = 0; i < 12 && !sawNoAlternatives; i += 1) {
    const res = await api(baseUrl, `/api/plans/${plan.plan_id}/meals/${slot}/swap`, {
      method: 'POST', body: { reason: 'faster' }, householdId: hh,
    });
    const body = JSON.stringify(res.body ?? {});
    if (/no_alternatives|catalog gap|already in this plan|was available for this slot|were available for this slot/i.test(body)) {
      sawNoAlternatives = { status: res.status, body: res.body };
    }
  }

  if (!sawNoAlternatives) {
    check('G14', false, 'NOT EXERCISED — could not drive the live API into a no-alternatives outcome in 12 swap attempts');
  } else {
    const msg = JSON.stringify(sawNoAlternatives.body);
    console.log(`  live response (${sawNoAlternatives.status}): ${msg.slice(0, 260)}`);
    // The wire sentence must be one the domain module actually renders — that
    // is what proves routes.ts delegates rather than carrying its own copy.
    const domainSentences = [
      empty, one,
      ...plurals.map(([, t]) => t),
      r1, r3,
      ...[2, 4, 5].map((n) => renderSwapNoAlternatives('no_candidate_satisfies_reason', counts({ pool_size: n, ineligible_for_reason: n })).text),
    ];
    const matched = domainSentences.find((s) => msg.includes(s));
    check('G14', Boolean(matched), matched
      ? `the wire carries a sentence rendered by reasons.ts, so routes.ts delegates: "${matched}"`
      : `the wire message is NOT any sentence reasons.ts renders — routes.ts is carrying its own copy again`);
    check('G15', !/\bAll 1\b/.test(msg) && !/has 0 other recipe/.test(msg),
      `neither defect's text can appear on the wire`);
  }
} finally {
  await server.stop();
}

console.log(`\n=== T-038 GATE: ${pass} passed, ${fail} failed ===`);
if (fail) { console.log('failures:'); failures.forEach((f) => console.log('  - ' + f)); }
process.exit(fail === 0 ? 0 : 1);
