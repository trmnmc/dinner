/** cycle-015-diag.mjs — conductor diagnostic: what does the DOM/data actually look like? */
import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';
import { readdirSync, readFileSync } from 'node:fs';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

const server = await boot();
const { baseUrl } = server;
const dom = installDom({ baseUrl });
dom.window.setInterval = (fn, ms) => setInterval(fn, ms);
dom.window.clearInterval = (id) => clearInterval(id);

const groceryMod = await import('../../web/js/grocery.js');
const cookMod = await import('../../web/js/cook.js');
const apiMod = await import('../../web/js/api.js');

const hh = await makeHousehold(baseUrl, {
  household: { name: 'C15 household', household_size: 3, novelty_preference: 'mostly_familiar' },
  assumed_staples: [
    { ingredient_id: 'olive_oil', quantity: { n: '120', d: '1' }, unit: 'ml' },
    { ingredient_id: 'salt', quantity: { n: '40', d: '1' }, unit: 'g' },
  ],
});
await makePlan(baseUrl, hh);
const livePlan = (await currentPlan(baseUrl, hh)).body.plan;
apiMod.setHouseholdId(hh);
const liveList = (await grocery(baseUrl, hh, livePlan.plan_id)).body.list;
const lines = liveList.sections.flatMap((s) => s.lines);

const app = dom.mountApp();
groceryMod.renderGrocery(app, {});
await settle();

console.log('=== GROCERY DOM: first 3 line rows ===');
const rows = app.descendants().filter((el) => {
  const c = String(el.getAttribute('class') || '');
  return /grocery-line|grocery-row|line-row/.test(c);
});
console.log('matched row-ish nodes:', rows.length, rows.slice(0, 6).map((r) => r.getAttribute('class')));
console.log('--- all distinct classes under app ---');
const classes = new Set();
for (const el of app.descendants()) {
  const c = String(el.getAttribute('class') || '');
  if (c) for (const part of c.split(/\s+/)) classes.add(part);
}
console.log([...classes].sort().join(' '));
console.log('--- full text ---');
console.log(norm(visibleText(app)).slice(0, 1400));
console.log('--- tappables ---');
for (const t of tappables(app).slice(0, 14)) console.log(' *', t.tagName, JSON.stringify(norm(visibleText(t)).slice(0, 60)), 'class=', t.getAttribute('class'));
console.log('--- line data sample ---');
console.log(JSON.stringify(lines[0], null, 1).slice(0, 700));

console.log('\n=== after clicking first tappable line-ish control ===');
const first = tappables(app).find((t) => String(t.getAttribute('class') || '').includes('grocery'));
if (first) {
  first.dispatchEvent(makeEvent('click', first));
  await settle();
  const sheet = dom.document.getElementById('sheet-root');
  console.log('sheet text:', sheet ? norm(visibleText(sheet)).slice(0, 900) : '(none)');
  const inputs = (sheet ? sheet.descendants() : []).filter((e) => e.tagName === 'INPUT');
  console.log('inputs in sheet:', inputs.map((i) => ({ aria: i.getAttribute('aria-label'), value: i.value })));
  console.log('sheet tappables:', (sheet ? tappables(sheet) : []).map((t) => norm(visibleText(t)).slice(0, 50)));
}

console.log('\n=== RECIPES with a continuous-attention step ===');
const dir = 'data/recipes';
for (const f of readdirSync(dir)) {
  const r = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const steps = r.steps || [];
  const ca = steps.filter((s) => s.requires_continuous_attention);
  if (ca.length) console.log(` ${r.id}  steps=${steps.length}  continuous-attention at idx ${ca.map((s) => s.index).join(',')}`);
}

console.log('\n=== timer_started probe on a FRESH session ===');
const meal0 = livePlan.meals[0];
const cr = await api(baseUrl, '/api/cooking/sessions', {
  method: 'POST', householdId: hh,
  body: { plan_meal_id: meal0.plan_meal_id, recipe_id: meal0.recipe_id, target_servings: 3 },
});
const sid = cr.body.session.session_id;
const tr = await api(baseUrl, `/api/cooking/sessions/${sid}/events`, {
  method: 'POST', householdId: hh,
  body: { payload: { kind: 'timer_started', timer: {
    id: '11111111-1111-4111-8111-111111111111', step_index: 0, label: 'Diag timer',
    started_at_utc: new Date().toISOString(), ends_at_utc: new Date(Date.now() + 300000).toISOString(),
    duration_seconds: 300 } } },
});
console.log('timer_started status', tr.status, JSON.stringify(tr.body).slice(0, 400));

await server.stop();
process.exit(0);
