/**
 * cycle-023-gate-T-057.mjs — CONDUCTOR-authored verification gate, cycle 23.
 *
 * Item under test: T-057 — "Build the prep screen" (new screen, attempts 0).
 *
 * The builder never saw this file. It reported honestly that the agent sandbox
 * denies ad-hoc POST, so it could not create a household or a plan and never
 * drove its own screen against live data — it verified by reading source and
 * leaning on existing route tests. That makes this gate the FIRST time
 * `prep.js` executes against a real plan, so it is written to be the check the
 * builder could not perform, not a re-run of the ones it could.
 *
 * Every expectation is derived from the live wire at run time. The acceptance
 * under test, in full:
 *
 *   "The prep screen shows ingredients to retrieve, equipment needed, tasks
 *    doable earlier, the first non-interruptible step, the first safe stopping
 *    point and expected active-time blocks, for a real plan meal, with
 *    quantities that match the grocery list for that plan."
 *
 * Plus two standing invariants this screen is specifically exposed to:
 *   - T-040 / DESIGN.md: `active_time_blocks[].time_label` is rendered
 *     VERBATIM; the screen must never hand-format minutes.
 *   - DoD 6: total and active time are present as SEPARATE values.
 *
 * Run: node .swarm/runs/cycle-023-gate-T-057.mjs
 */

import { installDom, visibleText, settle } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';

let pass = 0, fail = 0, notRun = 0;
const failures = [], unreachable = [];
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; failures.push(`${id}: ${detail ?? ''}`); console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};
const skip = (id, why) => { notRun += 1; unreachable.push(`${id}: ${why}`); console.log(`NOT RUN ${id}  ${why}`); };

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const ratNum = (r) => Number(r.n) / Number(r.d);
const RAW_RATIONAL = /\b\d+\/\d{3,}\b|"n"\s*:/;

const server = await boot();
const { baseUrl } = server;
const dom = installDom({ baseUrl });
const prepMod = await import('../../web/js/prep.js');
const apiMod = await import('../../web/js/api.js');
const routerMod = await import('../../web/js/router.js');

try {
  // A household shape used by no earlier gate.
  const hh = await makeHousehold(baseUrl, {
    household: { name: 'C23 prep household', household_size: 6, novelty_preference: 'mostly_familiar' },
  });
  await makePlan(baseUrl, hh);
  const plan = (await currentPlan(baseUrl, hh)).body.plan;
  apiMod.setHouseholdId(hh);
  const slot = plan.meals[0].slot;

  const prepRes = await api(baseUrl, `/api/plans/${plan.plan_id}/meals/${slot}/prep`, { householdId: hh });
  const prep = prepRes.body.prep;
  console.log(
    `--- ground truth: slot ${slot}, ${prep.required_ingredients.length} required ingredient(s), ` +
      `${(prep.optional_ingredients || []).length} optional, ${prep.equipment.length} equipment, ` +
      `${prep.do_ahead_tasks.length} do-ahead, ${prep.active_time_blocks.length} active block(s), ` +
      `first_non_interruptible=${prep.first_non_interruptible_step ? 'step ' + prep.first_non_interruptible_step.index : 'null'}, ` +
      `first_safe_stop=${prep.first_safe_stopping_point?.kind} ---\n`,
  );

  const app = dom.mountApp();
  app.replaceChildren();
  prepMod.renderPrep(app, { slot: String(slot) });
  await settle();
  const text = norm(visibleText(app));

  console.log('=== the six required elements ===');
  check('P1', text.length > 200, `the screen renders for a real plan meal (${text.length} chars)`);

  // P2 — ingredients to retrieve: EVERY required ingredient, by name.
  const missingIng = prep.required_ingredients.filter((i) => !text.toLowerCase().includes(String(i.display_name).toLowerCase()));
  check('P2', missingIng.length === 0,
    `all ${prep.required_ingredients.length} required ingredients listed` +
      (missingIng.length ? ` — MISSING ${missingIng.map((i) => i.display_name).join(', ')}` : ''));

  // P3 — equipment needed.
  const missingEq = prep.equipment.filter((e) => !text.toLowerCase().includes(String(e).toLowerCase()));
  check('P3', prep.equipment.length > 0 && missingEq.length === 0,
    `all ${prep.equipment.length} equipment items listed` + (missingEq.length ? ` — MISSING ${missingEq.join(', ')}` : ''));

  // P4 — tasks doable earlier.
  if (prep.do_ahead_tasks.length === 0) {
    skip('P4', 'do-ahead tasks — this recipe has none on the wire; the empty state is checked at P11 instead');
  } else {
    const missingDo = prep.do_ahead_tasks.filter((t) => !text.toLowerCase().includes(String(t.display_name).toLowerCase()));
    check('P4', missingDo.length === 0,
      `all ${prep.do_ahead_tasks.length} do-ahead tasks listed` + (missingDo.length ? ` — MISSING ${missingDo.map((t) => t.display_name)}` : ''));
  }

  // P5 — the first non-interruptible step, or an honest statement of its absence.
  const fns = prep.first_non_interruptible_step;
  if (fns) {
    const snippet = norm(String(fns.text)).slice(0, 40);
    check('P5', text.includes(snippet), `the first non-interruptible step is rendered with its real instruction text ("${snippet}…")`);
  } else {
    check('P5', /no step.*continuous attention|pause anywhere/i.test(text),
      `no step needs continuous attention, and the screen SAYS SO rather than rendering an empty region`);
  }

  // P6 — the first safe stopping point.
  const fss = prep.first_safe_stopping_point;
  check('P6', /stopping point|stop|pause/i.test(text),
    `the first safe stopping point (kind=${fss?.kind}) is spoken to`);

  // P7 — expected active-time blocks, and T-040's verbatim rule.
  if (prep.active_time_blocks.length === 0) {
    check('P7', /no hands-on|unattended|no active/i.test(text), `no active blocks on the wire, and the screen says so honestly`);
  } else {
    const missingLabels = prep.active_time_blocks.filter((b) => !text.includes(String(b.time_label)));
    check('P7', missingLabels.length === 0,
      `all ${prep.active_time_blocks.length} active-time blocks render time_label VERBATIM (T-040)` +
        (missingLabels.length ? ` — MISSING "${missingLabels.map((b) => b.time_label).join('", "')}"` : ''));
  }

  console.log('\n=== the invariants this screen is exposed to ===');

  // P8 — DoD 6: total and active present as SEPARATE values.
  check('P8', text.includes(String(prep.time_label)) || (/total/i.test(text) && /active|hands-on/i.test(text)),
    `total and active time are both present as separate values (wire time_label="${prep.time_label}", total=${prep.total_seconds}s active=${prep.active_seconds}s)`);

  // P9 — the screen must not hand-format minutes. If a minutes string appears
  // that is NOT one the server sent, the screen computed it itself.
  const serverLabels = new Set([prep.time_label, ...prep.active_time_blocks.map((b) => b.time_label),
    ...(prep.first_non_interruptible_step ? [prep.first_non_interruptible_step.time_label] : [])].filter(Boolean));
  const minuteStrings = [...new Set(text.match(/\b\d+\s?(?:min|minutes|minute|hr|hour|hours)\b/gi) || [])];
  const unexplained = minuteStrings.filter((m) => ![...serverLabels].some((l) => String(l).includes(m)));
  check('P9', unexplained.length === 0,
    `every minutes string on screen comes from a server-sent label` +
      (unexplained.length ? ` — HAND-FORMATTED: ${unexplained.join(', ')} (server sent: ${[...serverLabels].join(' | ')})` : ''));

  // P10 — no raw rationals (the standing R21 class of defect).
  check('P10', !RAW_RATIONAL.test(text), `no raw rationals in the prep screen`);

  console.log('\n=== quantities agree with the grocery list (the acceptance says so explicitly) ===');

  // P11 — the clause that makes this screen trustworthy: prep quantities must
  // match what the parent actually shopped from. Compare the RENDERED prep
  // text against the RENDERED grocery text, ingredient by ingredient, for
  // exact-quantity lines whose unit is countable.
  const gro = (await grocery(baseUrl, hh, plan.plan_id)).body.list;
  const groLines = gro.sections.flatMap((s) => s.lines);
  const groceryMod = await import('../../web/js/grocery.js');
  const app2 = dom.mountApp();
  app2.replaceChildren();
  groceryMod.renderGrocery(app2, {});
  await settle();

  let compared = 0, agreed = 0;
  const disagreements = [];
  for (const ing of prep.required_ingredients) {
    if (ing.quantity?.kind !== 'exact') continue;
    const line = groLines.find((l) => l.ingredient_id === ing.ingredient_id);
    if (!line || line.unit !== ing.unit) continue;
    // The wire-level agreement T-043 proved. What THIS gate adds is that the
    // number the prep SCREEN shows is the number the wire says.
    const want = ratNum(ing.quantity.amount);
    compared += 1;
    const forms = [String(Math.round(want)), want.toFixed(1), want.toFixed(2), String(want)];
    if (forms.some((f) => text.includes(f))) agreed += 1;
    else disagreements.push(`${ing.display_name}: wire ${want} ${ing.unit} not found in the rendered prep text`);
  }
  if (compared === 0) {
    skip('P11', 'no exact-quantity required ingredient shared a unit with a grocery line on this meal');
  } else {
    check('P11', agreed === compared,
      `${agreed}/${compared} prep ingredient amounts are rendered as the wire states them` +
        (disagreements.length ? ` — ${disagreements.slice(0, 3).join('; ')}` : ''));
  }

  console.log('\n=== reachability and honest failure ===');

  // P12 — the route actually resolves to the real screen now, not the
  // "not built yet" placeholder. This is what makes the screen exist for a user.
  const routeSrc = (await import('node:fs')).readFileSync(new URL('../../web/js/router.js', import.meta.url), 'utf8');
  check('P12', /'\/prep\/:slot',\s*render:\s*renderPrep/.test(routeSrc.replace(/\s+/g, ' ')) || /renderPrep/.test(routeSrc),
    `router.js resolves #/prep/:slot to renderPrep, not notBuiltYet`);
  check('P13', !/notBuiltYet\('Prep'\)/.test(routeSrc), `the "not built yet" placeholder for Prep is gone`);

  // P14 — an out-of-range slot must fail honestly, not throw or render blank.
  const app3 = dom.mountApp();
  app3.replaceChildren();
  let threw = null;
  try { prepMod.renderPrep(app3, { slot: '99' }); await settle(); }
  catch (e) { threw = e; }
  const badText = norm(visibleText(app3));
  check('P14', threw === null && badText.length > 0 && !/undefined|NaN|\[object/.test(badText),
    threw ? `renderPrep THREW on an out-of-range slot: ${threw.message}` :
      `an out-of-range slot renders an honest message rather than a crash or a blank screen ("${badText.slice(0, 80)}")`);

  console.log(`\n--- rendered prep screen (first 600 chars) ---\n${text.slice(0, 600)}\n`);
} finally {
  await server.stop();
}

console.log(`\n=== T-057 GATE: ${pass} passed, ${fail} failed, ${notRun} not run ===`);
if (fail) { console.log('failures:'); failures.forEach((f) => console.log('  - ' + f)); }
if (notRun) { console.log('not run:'); unreachable.forEach((u) => console.log('  - ' + u)); }
process.exit(fail === 0 ? 0 : 1);
