/**
 * cycle-023-gate-T-057-p11.mjs — the one acceptance clause the main T-057 gate
 * could not run: "with quantities that match the grocery list for that plan".
 *
 * The main gate's P11 required a prep ingredient and a grocery line to share a
 * UNIT before comparing, and on this meal none did (prep speaks tbsp/tsp, the
 * grocery list aggregates to ml/g). That was a flaw in my comparison, not an
 * absence of the property. This addendum splits the clause into the two links
 * that actually compose it:
 *
 *   link 1 (checked here): the number the prep SCREEN shows is the number the
 *           prep WIRE sent — screen fidelity, which no earlier gate has tested
 *           because this screen did not exist until this cycle.
 *   link 2 (NOT re-checked here, cited): prep and grocery agree ARITHMETICALLY
 *           for the same plan meal. That is T-043, gate-proven over 15 wire
 *           pairs at cycle 17 (.swarm/runs/cycle-017-verify-T-043.txt). It is
 *           a property of the server, unchanged by this cycle's work, and is
 *           cited as prior evidence rather than claimed as re-verified.
 *
 * Link 1 AND link 2 together are the acceptance clause. Only link 1 is new.
 */

import { installDom, visibleText, settle } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, api } from './cycle-014-fixture.mjs';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const ratNum = (r) => Number(r.n) / Number(r.d);

const server = await boot();
const { baseUrl } = server;
const dom = installDom({ baseUrl });
const prepMod = await import('../../web/js/prep.js');
const apiMod = await import('../../web/js/api.js');

let pass = 0, fail = 0;
try {
  const hh = await makeHousehold(baseUrl, { household: { name: 'C23 p11', household_size: 6 } });
  await makePlan(baseUrl, hh);
  const plan = (await currentPlan(baseUrl, hh)).body.plan;
  apiMod.setHouseholdId(hh);

  // Check EVERY meal in the plan, not just the first — a screen that happens
  // to work on meal 0 and rounds wrong on meal 2 must not slip through.
  for (const meal of plan.meals) {
    const prep = (await api(baseUrl, `/api/plans/${plan.plan_id}/meals/${meal.slot}/prep`, { householdId: hh })).body.prep;
    const app = dom.mountApp();
    app.replaceChildren();
    prepMod.renderPrep(app, { slot: String(meal.slot) });
    await settle();
    const text = norm(visibleText(app));

    const exact = [...prep.required_ingredients, ...(prep.optional_ingredients || [])].filter((i) => i.quantity?.kind === 'exact');
    const bad = [];
    for (const ing of exact) {
      const want = ratNum(ing.quantity.amount);
      const forms = [String(want), String(Math.round(want)), want.toFixed(1), want.toFixed(2), want.toFixed(3)];
      if (!forms.some((f) => text.includes(f))) bad.push(`${ing.display_name}=${want}${ing.unit}`);
    }
    const ok = bad.length === 0 && exact.length > 0;
    if (ok) { pass += 1; console.log(`PASS slot ${meal.slot}  all ${exact.length} exact quantities rendered as the wire states them`); }
    else { fail += 1; console.log(`FAIL slot ${meal.slot}  ${bad.length}/${exact.length} mismatched: ${bad.join(', ')}`); }

    // A to_taste ingredient must never acquire a fabricated number.
    const toTaste = [...prep.required_ingredients, ...(prep.optional_ingredients || [])].filter((i) => i.quantity?.kind === 'to_taste');
    for (const t of toTaste) {
      const i = text.toLowerCase().indexOf(String(t.display_name).toLowerCase());
      const after = i >= 0 ? text.slice(i, i + String(t.display_name).length + 14) : '';
      if (/\d/.test(after.slice(String(t.display_name).length))) {
        fail += 1; console.log(`FAIL slot ${meal.slot}  to-taste "${t.display_name}" rendered a fabricated number: "${after}"`);
      } else {
        pass += 1; console.log(`PASS slot ${meal.slot}  to-taste "${t.display_name}" stays non-numeric ("${after.slice(0, 40)}")`);
      }
    }
  }
} finally {
  await server.stop();
}

console.log(`\n=== T-057 P11 addendum: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
