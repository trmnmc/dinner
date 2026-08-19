/**
 * cycle-014-diag.mjs — READ-ONLY diagnostic, conductor-authored.
 * Run BEFORE editing a single gate check, so any correction is proven rather
 * than guessed (the cycle-13 discipline). Writes nothing, asserts nothing.
 */

import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const ratNum = (r) => Number(r.n) / Number(r.d);

const server = await boot();
const { baseUrl } = server;
const dom = installDom({ baseUrl });
const planMod = await import('../../web/js/plan.js');
const groceryMod = await import('../../web/js/grocery.js');
const apiMod = await import('../../web/js/api.js');
const ui = await import('../../web/js/ui.js');

const hh = await makeHousehold(baseUrl, {
  assumed_staples: [
    { ingredient_id: 'honey', quantity: { n: '10', d: '1' }, unit: 'ml' },
    { ingredient_id: 'soy_sauce', quantity: { n: '20', d: '1' }, unit: 'ml' },
  ],
});
await makePlan(baseUrl, hh);
const livePlan = (await currentPlan(baseUrl, hh)).body.plan;
const planId = livePlan.plan_id;
apiMod.setHouseholdId(hh);

// ===========================================================================
console.log('=== DIAG 1: renderTimeInfo — is the combined_label separator lost? ===');
for (const m of livePlan.meals) {
  const el = ui.renderTimeInfo({ total_seconds: m.total_seconds, active_seconds: m.active_seconds, time_label: m.time_label });
  console.log(`  meal "${m.name}"`);
  console.log(`    API combined_label : ${JSON.stringify(m.time_label)}`);
  console.log(`    rendered textContent: ${JSON.stringify(norm(visibleText(el)))}`);
  console.log(`    aria-label          : ${JSON.stringify(el.getAttribute('aria-label'))}`);
  console.log(`    verbatim match      : ${norm(visibleText(el)).includes(norm(m.time_label))}`);
}

// ===========================================================================
console.log('\n=== DIAG 2: what the plan screen actually shows per meal ===');
const app = dom.mountApp();
app.replaceChildren();
planMod.renderPlan(app, {});
await settle();
const planText = norm(visibleText(app));
console.log(`  full text (${planText.length} chars):`);
console.log(`  ${planText.slice(0, 900)}`);
for (const m of livePlan.meals) {
  const totalMin = Math.round(m.total_seconds / 60);
  const activeMin = Math.round(m.active_seconds / 60);
  console.log(`  ${m.name}: total ${totalMin} present=${planText.includes(String(totalMin))}, active ${activeMin} present=${planText.includes(String(activeMin))}`);
}

// ===========================================================================
console.log('\n=== DIAG 3: swap — which reasons actually have alternatives? ===');
const SWAP_REASONS = ['too_long', 'too_much_active_time', 'dont_fancy_it', 'too_expensive', 'too_many_dishes', 'had_recently', 'missing_ingredients', 'different_protein', 'different_cuisine'];
const targetSlot = livePlan.meals[0].slot;
for (const reason of SWAP_REASONS) {
  const r = await api(baseUrl, `/api/plans/${planId}/meals/${targetSlot}/swap`, {
    method: 'POST',
    householdId: hh,
    body: { reason },
  });
  const alts = r.body?.alternatives;
  console.log(`  ${reason.padEnd(22)} status ${r.status}  alternatives=${Array.isArray(alts) ? alts.length : JSON.stringify(r.body).slice(0, 90)}`);
}

// ===========================================================================
console.log('\n=== DIAG 4: swap sheet — what does the screen render after tap 1? ===');
const findTap = (re, roots) => {
  for (const root of roots.filter(Boolean)) {
    const t = tappables(root).find((el) => re.test(norm(visibleText(el))) || re.test(norm(el.getAttribute('aria-label') || '')));
    if (t) return t;
  }
  return null;
};
const sheetRoot = () => dom.document.getElementById('sheet-root');
const swapBtn = findTap(/swap|change|different/i, [app]);
console.log(`  tap1 target: ${swapBtn ? JSON.stringify(norm(visibleText(swapBtn))) : 'NOT FOUND'}`);
if (swapBtn) {
  swapBtn.dispatchEvent(makeEvent('click', swapBtn));
  await settle();
  const sh = sheetRoot();
  console.log(`  sheet text: ${norm(visibleText(sh)).slice(0, 400)}`);
  console.log(`  sheet tappables: ${tappables(sh).map((e) => JSON.stringify(norm(visibleText(e)).slice(0, 30))).join(', ')}`);
}

// ===========================================================================
console.log('\n=== DIAG 5: grocery — which deducted line is not surfacing? ===');
const liveList = (await grocery(baseUrl, hh, planId)).body.list;
const liveLines = liveList.sections.flatMap((s) => s.lines);
const appG = dom.mountApp();
appG.replaceChildren();
groceryMod.renderGrocery(appG, {});
await settle();
for (const el of tappables(appG)) {
  const label = norm(visibleText(el));
  if (/why|detail|provenance|breakdown|show|expand/i.test(label) || el.getAttribute('aria-expanded') !== null) {
    el.dispatchEvent(makeEvent('click', el));
  }
}
await settle();
const gText = norm(visibleText(appG) + ' ' + (sheetRoot() ? visibleText(sheetRoot()) : ''));

const deducted = liveLines.filter((l) => l.provenance.inventory_deducted.n !== '0');
console.log(`  ${deducted.length} deducted lines:`);
for (const l of deducted) {
  const amt = ratNum(l.provenance.inventory_deducted);
  console.log(`    ${l.display_name}: deducted=${amt} (${JSON.stringify(l.provenance.inventory_deducted)}) unit=${l.unit}`);
  console.log(`      rounded2=${Math.round(amt * 100) / 100} present=${gText.includes(String(Math.round(amt * 100) / 100))}`);
  console.log(`      rounded0=${Math.round(amt)} present=${gText.includes(String(Math.round(amt)))}`);
  const idx = gText.toLowerCase().indexOf(String(l.display_name).toLowerCase());
  console.log(`      context: ${idx >= 0 ? JSON.stringify(gText.slice(Math.max(0, idx - 60), idx + 160)) : 'NAME NOT FOUND'}`);
}
console.log(`  phrase probe: already-have=${/already have|on hand|deduct|in your kitchen|owned/i.test(gText)}`);

await server.stop();
