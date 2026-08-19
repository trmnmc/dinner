/**
 * cycle-023-gate-T-038-rev2.mjs — G14 only, re-attempted.
 *
 * rev1's G14 (`cycle-023-verify-T-038.txt`) failed as NOT EXERCISED: 12 repeated
 * swap POSTs never produced a no-alternatives outcome. Reading
 * `handleSwap` (routes.ts:955-960) explains why, and it was my error, not the
 * product's: `candidates` is already filtered to survivors NOT in the plan, and
 * a swap that is never ACCEPTED does not change the plan — so repeating the
 * same request just re-asks the same question and gets the same three
 * candidates. Repetition can never empty that pool.
 *
 * The reachable route is to make survivors == planned. The catalog has exactly
 * three vegetarian/vegan recipes (r04 Moroccan chickpea, r05 sesame tofu, r06
 * soy-butter fried rice), so a vegetarian household has exactly three
 * survivors, all three land in the plan, and `candidates` is empty —
 * `no_candidates_in_pool`, the arm T-038's defect 2 rewrote.
 *
 * This is the check the builder could not run: agent sandboxes deny ad-hoc
 * POST, which the T-057 builder independently hit and reported this cycle.
 */

import { boot, makeHousehold, makePlan, currentPlan, api } from './cycle-014-fixture.mjs';

const { renderSwapNoAlternatives } = await import('../../domain/src/reasons.ts');
const counts = (o) => ({ pool_size: 0, already_in_plan: 0, ineligible_for_reason: 0, eligible: 0, ...o });

let pass = 0, fail = 0;
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};

const server = await boot();
const { baseUrl } = server;
try {
  const hh = await makeHousehold(baseUrl, {
    household: { name: 'C23 T-038 rev2', household_size: 4 },
    member: { display_name: 'Veg parent', dietary_restrictions: ['vegetarian'], allergies: [], never_recommend_ingredients: [] },
  });
  await makePlan(baseUrl, hh);
  const plan = (await currentPlan(baseUrl, hh)).body.plan;
  console.log(`plan meals: ${plan.meals.map((m) => `${m.slot}:${(m.name || m.recipe_id).slice(0, 34)}`).join(' | ')}`);

  const slot = plan.meals[0].slot;
  const res = await api(baseUrl, `/api/plans/${plan.plan_id}/meals/${slot}/swap`, {
    method: 'POST', body: { reason: 'faster' }, householdId: hh,
  });
  console.log(`swap → ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);

  const msg = String(res.body?.message ?? '');
  check('G14a', res.status === 200 && Array.isArray(res.body?.alternatives) && res.body.alternatives.length === 0,
    `a vegetarian household exhausts the pool: ${res.body?.alternatives?.length ?? '?'} alternatives, none_reason=${res.body?.none_reason}`);

  const domainText = renderSwapNoAlternatives(res.body?.none_reason ?? 'no_candidates_in_pool', counts({})).text;
  check('G14b', msg.length > 0 && msg === domainText,
    `the sentence ON THE WIRE is byte-identical to what reasons.ts renders — routes.ts delegates, it does not carry its own copy`);
  console.log(`   wire: "${msg}"`);

  check('G14c', !/\bAll 1\b/.test(msg) && !/has 0 other recipe/.test(msg) && !/\d/.test(msg),
    `neither defect's text reaches a user, and the dead "0" is gone from the live response`);

  check('G14d', msg.includes("that's a catalog gap, not something about your preferences."),
    `the reassurance clause reaches the user intact`);
} finally {
  await server.stop();
}

console.log(`\n=== T-038 G14 rev2: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
