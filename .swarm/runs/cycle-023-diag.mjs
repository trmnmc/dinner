/**
 * cycle-023-diag.mjs — diagnostic for the three cycle-23 T-017 gate failures
 * I could not attribute from the gate output alone (R5, R12, R17).
 * Determines HARNESS FAULT vs PRODUCT DEFECT before anything is filed.
 */
import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const ratNum = (r) => Number(r.n) / Number(r.d);

const server = await boot();
const { baseUrl } = server;
const dom = installDom({ baseUrl });
const groceryMod = await import('../../web/js/grocery.js');
const apiMod = await import('../../web/js/api.js');

const hh = await makeHousehold(baseUrl, {
  household: { name: 'C23 diag', household_size: 5, novelty_preference: 'mostly_familiar' },
  assumed_staples: [
    { ingredient_id: 'olive_oil', quantity: { n: '115', d: '2' }, unit: 'ml' },
    { ingredient_id: 'salt', quantity: { n: '27', d: '2' }, unit: 'g' },
  ],
});
await makePlan(baseUrl, hh);
const planId = (await currentPlan(baseUrl, hh)).body.plan.plan_id;
apiMod.setHouseholdId(hh);
const list = (await grocery(baseUrl, hh, planId)).body.list;
const lines = list.sections.flatMap((s) => s.lines);

// ---- R12: which lines actually have a non-zero surplus / deduction? -------
console.log('--- surplus / deduction census ---');
for (const l of lines) {
  const d = ratNum(l.provenance.inventory_deducted);
  const s = ratNum(l.provenance.expected_surplus);
  if (d !== 0 || s !== 0) console.log(`  ${l.display_name}: deducted=${d} surplus=${s} unit=${l.unit} estimate=${l.is_estimate}`);
}
console.log(`  (${lines.filter((l) => ratNum(l.provenance.expected_surplus) !== 0).length} lines with non-zero surplus,`,
  `${lines.filter((l) => ratNum(l.provenance.inventory_deducted) !== 0).length} with non-zero deduction,`,
  `${lines.filter((l) => l.is_estimate).length} estimated)`);

// ---- R5: does the screen put the .tabular class on quantities? -----------
const app = dom.mountApp();
app.replaceChildren();
groceryMod.renderGrocery(app, {});
await settle();
const classes = new Set();
(function walk(n) {
  const c = n?.getAttribute?.('class');
  if (c) String(c).split(/\s+/).forEach((x) => x && classes.add(x));
  (n?.childNodes || []).forEach(walk);
})(app);
console.log('\n--- R5: rendered classes containing "tabular" or "qty"/"amount" ---');
console.log('  ', [...classes].filter((c) => /tabular|qty|quant|amount|num/i.test(c)).join(', ') || '(none)');

// ---- R12 on a line that actually HAS surplus ------------------------------
const surplusLine = lines.find((l) => ratNum(l.provenance.expected_surplus) !== 0)
  || lines.find((l) => ratNum(l.provenance.inventory_deducted) !== 0);
if (surplusLine) {
  const opener = tappables(app).find((el) =>
    new RegExp(`why am i buying.*${String(surplusLine.display_name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
      .test(String(el.getAttribute('aria-label') || '')));
  if (opener) {
    opener.dispatchEvent(makeEvent('click', opener));
    await settle();
    const sheet = norm(visibleText(dom.document.getElementById('sheet-root')));
    console.log(`\n--- R12: drawer for ${surplusLine.display_name} (surplus ${ratNum(surplusLine.provenance.expected_surplus)}, deducted ${ratNum(surplusLine.provenance.inventory_deducted)}) ---`);
    console.log('  ', sheet.slice(0, 700));
  } else {
    console.log('\n--- R12: no opener found for', surplusLine.display_name);
  }
} else {
  console.log('\n--- R12: NO line in this fixture has a non-zero surplus or deduction ---');
}

// ---- R17: why is the edit not visible? -----------------------------------
const target = lines.find((l) => Number(l.purchase_quantity.n) !== 0);
await api(baseUrl, `/api/grocery/lines/${target.line_id}`, {
  method: 'PATCH', body: { user_edited_quantity: { n: '1234', d: '1' } }, householdId: hh,
});
const after = (await grocery(baseUrl, hh, planId)).body.list;
const afterLine = after.sections.flatMap((s) => s.lines).find((l) => l.line_id === target.line_id);
console.log(`\n--- R17: edited line = ${target.display_name} (${target.unit}) ---`);
console.log('   wire after patch: user_edited=', afterLine.user_edited_quantity, ' purchase=', ratNum(afterLine.purchase_quantity),
  ' package_label=', JSON.stringify(afterLine.package_label), ' is_estimate=', afterLine.is_estimate);

app.replaceChildren();
groceryMod.renderGrocery(app, {});
await settle();
const txt = norm(visibleText(app));
console.log('   re-render length:', txt.length);
const idx = txt.toLowerCase().indexOf(String(target.display_name).toLowerCase());
console.log('   rendered row text:', idx >= 0 ? txt.slice(Math.max(0, idx - 90), idx + 130) : '(display_name NOT FOUND)');
console.log('   contains "1234"? ', /\b1234\b/.test(txt), '   contains "edited"? ', /edited/i.test(txt));

await server.stop();
