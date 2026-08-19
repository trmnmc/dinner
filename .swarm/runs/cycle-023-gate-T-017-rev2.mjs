/**
 * cycle-023-gate-T-017-rev2.mjs — CONDUCTOR-authored gate, revision 2.
 *
 * rev1 (`cycle-023-gate-T-017.mjs`) returned 13 pass / 5 fail. `cycle-023-diag.mjs`
 * proved that THREE of those five were faults in MY HARNESS and two were
 * clauses of the acceptance that NO USER-REACHABLE INPUT CAN PRODUCE in the
 * shipped build. rev1 and its output are preserved beside this file unmodified.
 * Each correction below is a diagnostic finding, not a relaxation:
 *
 *  - rev1 R5 (tabular numerals) looked for a `tabular-nums` rule whose selector
 *    named a rendered class, and my selector regex swallowed the comment block
 *    ahead of `:root` in tokens.css. The real rule is `.num, .tabular` in
 *    app.css:74-77, and the screen renders `class="… num"` on the quantity
 *    element. The product was always right; the check was looking in the wrong
 *    file. rev2 asserts the rule AND the class on the actual quantity node.
 *
 *  - rev1 R17 (edited amount visible) asserted `/\b1234\b/` against shim text.
 *    The shim concatenates adjacent text nodes without whitespace, so the row
 *    reads `Honeyedited1234 ml` — there is no word boundary before the `1`.
 *    The edit WAS rendered. rev2 matches without the leading boundary and, to
 *    keep the check strict, also requires the edit marker and the ABSENCE of
 *    the generated value on that row.
 *
 *  - rev1 R12 (expected surplus) probed a line whose surplus is 0. The census
 *    in the diagnostic found ZERO lines with non-zero surplus in the entire
 *    list — see UNREACHABLE below.
 *
 * UNREACHABLE-BY-DESIGN (reported as NOT RUN, never as passed — cycle.md step 6.5):
 *
 *  - Confirmation questions (rev1 R7). `inventoryMath.ts` raises a question
 *    only for an `inferred` inventory entry against a line with a positive
 *    purchase. The ONLY HTTP write path into inventory is `assumed_staples`,
 *    which routes.ts stores at confidence `assumed_staple` — a confidence that
 *    SUBTRACTS and never asks. D-2 deliberately cut the inference layer
 *    ("confirmed-only inventory"), so no user-reachable input can produce an
 *    `inferred` entry. The domain logic is implemented and unit-tested; the UI
 *    clause is untestable because no data can reach it.
 *
 *  - Estimated-package labelling (rev1 R6) and expected surplus (rev1 R12).
 *    Both are computed by `packaging.ts` from an ingredient's package options.
 *    `data/ingredients.json` carries 97 ingredients and ZERO package options
 *    (keys are: id, display_name, aliases, allergen_classes, store_section,
 *    density_g_per_ml, per_item_weight_g), so `package_label` is null and
 *    `is_estimate` false on every line, and surplus is always 0. This is a
 *    real product gap, filed as a backlog item this cycle — it is NOT a
 *    defect in the T-017 screen, which has no data to render.
 *
 * AMENDMENT LOG (rev2 run 2). rev2's FIRST run is preserved verbatim at
 * `cycle-023-verify-T-017-rev2-run1.txt` — 13 pass / 2 fail / 3 not run. Both
 * failures were again faults in this harness, each proven by reading the
 * product source rather than assumed:
 *
 *  - R5 walked to the FIRST node whose class matched /qty/ and landed on a
 *    TO-TASTE line (`grocery-line__qty text-muted`), which renders the words
 *    "To taste" and carries no digits, so it correctly has no `num` class.
 *    grocery.js:334 renders measured lines as
 *    `class="grocery-line__qty num"`, and `num` is in app.css's tabular rule.
 *    Amended to pick a quantity node that actually contains a digit.
 *
 *  - R11 required the literal `Math.floor(12.5)` = "12" in the drawer.
 *    grocery.js:381-383 renders `Already had on hand: <span class="num">
 *    {formatInfoQty(deducted)} ml</span> — deducted from what you need to
 *    buy.`, and formatInfoQty rounds for display, so 12.5 renders as "13".
 *    The deduction IS stated in words and numbers; my expected string was
 *    wrong. Amended to accept any rendering consistent with the wire value
 *    (floor, round, or exact), while still REQUIRING both the sentence and a
 *    number — it is not weakened to a words-only check.
 *
 * No builder has seen any revision of this file.
 *
 * Run: node .swarm/runs/cycle-023-gate-T-017-rev2.mjs
 */

import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
let notRun = 0;
const failures = [];
const unreachable = [];

const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; failures.push(`${id}: ${detail ?? ''}`); console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};
const skip = (id, why) => { notRun += 1; unreachable.push(`${id}: ${why}`); console.log(`NOT RUN ${id}  ${why}`); };

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const ratNum = (r) => Number(r.n) / Number(r.d);
const isZero = (r) => Number(r.n) === 0;
const RAW_RATIONAL = /\b\d+\/\d{3,}\b|"n"\s*:|\bn:\s*'/;

async function main() {
  const server = await boot();
  const { baseUrl } = server;
  const dom = installDom({ baseUrl });
  const groceryMod = await import('../../web/js/grocery.js');
  const apiMod = await import('../../web/js/api.js');

  const sheetRoot = () => dom.document.getElementById('sheet-root');
  const sheetText = () => (sheetRoot() ? norm(visibleText(sheetRoot())) : '');
  const allText = (root) => norm(visibleText(root) + ' ' + sheetText());

  // A PARTIAL staple: small enough that olive oil still has a positive
  // purchase after deduction, so the deduction check exercises the
  // interesting arithmetic rather than the "already have enough" shortcut.
  const hh = await makeHousehold(baseUrl, {
    household: { name: 'C23 rev2 household', household_size: 5, novelty_preference: 'mostly_familiar' },
    assumed_staples: [
      { ingredient_id: 'olive_oil', quantity: { n: '25', d: '2' }, unit: 'ml' },
      { ingredient_id: 'salt', quantity: { n: '27', d: '2' }, unit: 'g' },
    ],
  });
  await makePlan(baseUrl, hh);
  const planId = (await currentPlan(baseUrl, hh)).body.plan.plan_id;
  apiMod.setHouseholdId(hh);

  const liveList = (await grocery(baseUrl, hh, planId)).body.list;
  const liveLines = liveList.sections.flatMap((s) => s.lines);
  const measured = liveLines.filter((l) => !isZero(l.purchase_quantity));

  console.log(
    `\n--- c23 rev2 ground truth: ${liveList.sections.length} sections, ${liveLines.length} lines ` +
      `(${measured.length} measured), ${liveList.confirmation_questions.length} confirmation questions, ` +
      `${liveLines.filter((l) => l.is_estimate).length} estimated, ` +
      `${liveLines.filter((l) => !isZero(l.provenance.expected_surplus)).length} with surplus ---\n`,
  );

  const app = dom.mountApp();
  app.replaceChildren();
  groceryMod.renderGrocery(app, {});
  await settle();
  const listText = allText(app);

  console.log('=== the list as a ledger ===');
  check('R1', listText.length > 200, `screen renders (${listText.length} chars)`);

  const missingSections = liveList.sections.map((s) => s.section)
    .filter((n) => !new RegExp(String(n).replace(/[_-]/g, '[ _-]?'), 'i').test(listText));
  check('R2', missingSections.length === 0,
    `all ${liveList.sections.length} wire sections appear as headings${missingSections.length ? ` — MISSING ${missingSections}` : ''}`);

  const missingLines = measured.filter((l) => !listText.toLowerCase().includes(String(l.display_name).toLowerCase()));
  check('R3', missingLines.length === 0,
    `all ${measured.length} measured lines rendered${missingLines.length ? ` — MISSING ${missingLines.map((l) => l.display_name)}` : ''}`);

  const raw = listText.match(/\b\d+\/\d{3,}\b/g) || [];
  check('R4', !RAW_RATIONAL.test(listText), `no raw rationals (the cycle-14 R21 regression)${raw.length ? ` — found ${raw.slice(0, 5)}` : ''}`);

  // R5 rev2 — the rule, then the class, on the node that actually holds a number.
  const appCss = readFileSync(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  const ruleMatch = appCss.match(/((?:^|\n)\s*\.[^{}]*?)\{[^}]*font-variant-numeric[^}]*tabular[^}]*\}/);
  const tabularSelectors = ruleMatch ? norm(ruleMatch[1]).split(',').map((s) => s.trim().replace(/^\./, '')) : [];
  let qtyNodeClasses = null;
  (function walk(n) {
    if (qtyNodeClasses) return;
    const cls = String(n?.getAttribute?.('class') || '');
    // Must be a quantity node that actually holds a NUMBER — a to-taste line's
    // qty node renders the words "To taste" and rightly needs no tabular rule.
    if (/qty|quant/i.test(cls) && /\d/.test(norm(visibleText(n)))) { qtyNodeClasses = cls.split(/\s+/); return; }
    (n?.childNodes || []).forEach(walk);
  })(app);
  check('R5',
    tabularSelectors.length > 0 && Boolean(qtyNodeClasses) && qtyNodeClasses.some((c) => tabularSelectors.includes(c)),
    `tabular figures: app.css declares font-variant-numeric on {${tabularSelectors.join(', ')}} and the quantity node carries class="${(qtyNodeClasses || []).join(' ')}"`);

  if (liveLines.filter((l) => l.is_estimate).length === 0) {
    skip('R6', 'estimated-package labelling — data/ingredients.json ships ZERO package options for all 97 ingredients, so no line can ever be an estimate. Product gap filed separately; not a T-017 screen defect.');
  } else {
    check('R6', /estimat/i.test(listText), 'estimated lines are labelled');
  }

  if (liveList.confirmation_questions.length === 0) {
    skip('R7', 'inline confirmation questions — questions require an `inferred` inventory entry, and the only HTTP write path (assumed_staples) stores `assumed_staple`, which subtracts and never asks. Unreachable by D-2 (confirmed-only inventory). Domain logic is unit-tested; the UI clause is not user-reachable.');
  } else {
    const listOnly = norm(visibleText(app));
    const shown = liveList.confirmation_questions.filter((q) => listOnly.toLowerCase().includes(String(q.display_name).toLowerCase()));
    check('R7', shown.length === liveList.confirmation_questions.length, `${shown.length}/${liveList.confirmation_questions.length} questions inline`);
  }

  console.log('\n=== the provenance drawer ===');
  // Probe the hardest line: most contributions, preferring a real deduction.
  const probe = [...measured].sort((a, b) => {
    const byDeduct = (isZero(b.provenance.inventory_deducted) ? 0 : 1) - (isZero(a.provenance.inventory_deducted) ? 0 : 1);
    if (byDeduct !== 0) return byDeduct;
    return b.provenance.contributions.length - a.provenance.contributions.length;
  })[0];
  console.log(`probe: ${probe.display_name} — ${probe.provenance.contributions.length} contribution(s), deducted ${ratNum(probe.provenance.inventory_deducted)} ${probe.unit}, purchase ${ratNum(probe.purchase_quantity)} ${probe.unit}`);

  const opener = tappables(app).find((el) =>
    new RegExp(`why am i buying.*${String(probe.display_name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
      .test(String(el.getAttribute('aria-label') || '')));
  check('R8', Boolean(opener), `the "why am I buying …?" affordance exists on the ${probe.display_name} line`);

  opener.dispatchEvent(makeEvent('click', opener));
  await settle();
  const drawer = sheetText();

  const named = probe.provenance.contributions.filter((c) => drawer.toLowerCase().includes(String(c.recipe_name).toLowerCase()));
  check('R9', named.length === probe.provenance.contributions.length,
    `${named.length}/${probe.provenance.contributions.length} contributing recipes named by name`);

  const shownAmts = probe.provenance.contributions.filter((c) => {
    const v = ratNum(c.amount); const w = Math.floor(v);
    return new RegExp(`${w}(\\b|[.,])`).test(drawer) || drawer.includes(v.toFixed(1)) || drawer.includes(v.toFixed(2));
  });
  check('R10', shownAmts.length === probe.provenance.contributions.length,
    `${shownAmts.length}/${probe.provenance.contributions.length} contributing amounts rendered (wire: ${probe.provenance.contributions.map((c) => `${c.recipe_name.slice(0, 24)}=${ratNum(c.amount)}`).join(', ')})`);

  const ded = ratNum(probe.provenance.inventory_deducted);
  // Any faithful rendering of the wire value counts (floor, round, or exact);
  // a MISSING number does not. The sentence is still required alongside it.
  const dedForms = [String(Math.floor(ded)), String(Math.round(ded)), String(ded), ded.toFixed(1)];
  check('R11', !isZero(probe.provenance.inventory_deducted)
    && /already ha|on hand|deduct/i.test(drawer)
    && dedForms.some((f) => drawer.includes(f)),
    `the ${ded} ${probe.unit} inventory deduction is stated in words AND numbers (accepted forms ${dedForms.join('/')})`);

  if (liveLines.every((l) => isZero(l.provenance.expected_surplus))) {
    skip('R12', 'expected surplus — surplus is produced by package selection, and with zero package options in the catalog it is 0 on every line. Same root cause as R6.');
  } else {
    check('R12', /surplus|left over|leftover|spare|extra/i.test(drawer), 'expected surplus is spoken to');
  }

  check('R13', !RAW_RATIONAL.test(drawer), 'no raw rationals in the drawer');

  const editor = tappables(sheetRoot() || app)
    .concat(sheetRoot()?.querySelectorAll ? [...sheetRoot().querySelectorAll('input')] : [])
    .find((el) => /amount of .* to buy/i.test(String(el.getAttribute?.('aria-label') || '')));
  check('R14', Boolean(editor), 'the quantity editor is reachable from the drawer');

  console.log('\n=== protected user edits ===');
  const target = measured[0];
  const patched = await api(baseUrl, `/api/grocery/lines/${target.line_id}`, {
    method: 'PATCH', body: { user_edited_quantity: { n: '1234', d: '1' } }, householdId: hh,
  });
  check('R15', patched.status === 200, `PATCH user_edited_quantity on "${target.display_name}" → ${patched.status}`);

  const after = (await grocery(baseUrl, hh, planId)).body.list;
  const afterLine = after.sections.flatMap((s) => s.lines).find((l) => l.line_id === target.line_id);
  const generated = ratNum(afterLine.purchase_quantity);
  check('R16', afterLine?.user_edited_quantity && Number(afterLine.user_edited_quantity.n) === 1234 && generated !== 1234,
    `the edit and the generated value are SEPARATE columns after regeneration (edited=1234, generated=${generated})`);

  app.replaceChildren();
  groceryMod.renderGrocery(app, {});
  await settle();
  const afterText = allText(app);
  // Isolate the edited row so "1234 appears somewhere" cannot pass this.
  const i = afterText.toLowerCase().indexOf(String(target.display_name).toLowerCase());
  const row = i >= 0 ? afterText.slice(i, i + 90) : '';
  check('R17', /1234/.test(row) && /edited/i.test(row) && !row.includes(generated.toFixed(2)),
    `the edited amount is VISIBLE on the ${target.display_name} row after a full re-render, marked as edited, and the generated ${generated.toFixed(2)} is NOT shown as the buy amount — row reads "${row.slice(0, 60)}"`);

  check('R18', !RAW_RATIONAL.test(afterText), 'still no raw rationals after the edit round-trip');

  await server.stop();
  console.log(`\n=== T-017 GATE rev2: ${pass} passed, ${fail} failed, ${notRun} not run (unreachable) ===`);
  if (fail) { console.log('failures:'); failures.forEach((f) => console.log('  - ' + f)); }
  if (notRun) { console.log('not run:'); unreachable.forEach((u) => console.log('  - ' + u)); }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('GATE CRASHED:', e); process.exit(2); });
