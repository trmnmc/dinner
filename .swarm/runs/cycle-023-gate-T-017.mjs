/**
 * cycle-023-gate-T-017.mjs — CONDUCTOR-authored verification gate, cycle 23.
 *
 * Item under test: T-017 — "Build grocery list screen as a ledger with
 * provenance drawers and protected user edits".
 *
 * WHY THIS GATE EXISTS. T-017 has sat `todo` with `attempts: 1` since cycle 14,
 * whose gate passed 11 of 12 checks; the single failure (R21) was that
 * quantities rendered as raw rationals because `grocery.js` called
 * `formatQuantity(q)` without `{ maxFracDigits }`. `web/js/grocery.js` now
 * passes `maxFracDigits` at both call sites, and KI-10 was marked resolved at
 * cycle 15 on T-052's evidence — but nobody ever re-ran T-017's acceptance
 * end to end. This gate decides the item on its OWN full acceptance text, not
 * on the one line R21 covered:
 *
 *   "grouped by store section with tabular numerals, every line expands to
 *    answer 'why am I buying this?' by naming each contributing recipe and
 *    amount, inventory deducted and expected surplus, estimated packages are
 *    labelled estimated, inventory confirmation questions surface inline, and
 *    a user-edited quantity visibly survives list regeneration."
 *
 * Every check below was written this cycle against that sentence. NONE was
 * copied from cycle-014's or cycle-015's gate, and no builder has ever seen
 * this file. Expected values are DERIVED FROM THE LIVE WIRE at run time — the
 * gate reads the real API response and asserts the screen shows what it says,
 * so it cannot pass by matching a string I hardcoded.
 *
 * The household shape (size 5, fractional olive-oil staple) differs from
 * cycle 14 rev1 (size 4), cycle 14 rev2 (size 5, integer staples) and cycle 15
 * (size 3), so nothing tuned to an earlier fixture survives by luck.
 *
 * Run: node .swarm/runs/cycle-023-gate-T-017.mjs
 */

import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const failures = [];

function check(id, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd());
  } else {
    fail += 1;
    failures.push(`${id}: ${detail ?? ''}`);
    console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd());
  }
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const ratNum = (r) => Number(r.n) / Number(r.d);
const isZero = (r) => Number(r.n) === 0;

/** A raw rational leaking into the UI looks like `12376473/25600000` or a
 *  JSON-ish `{"n":"…","d":"…"}`. Both are the R21 defect. A short fraction
 *  like `1/2` is legitimate cooking notation and is NOT matched. */
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

  // ---- ground truth from the live server -------------------------------
  const hh = await makeHousehold(baseUrl, {
    household: {
      name: 'C23 household',
      household_size: 5,
      novelty_preference: 'mostly_familiar',
    },
    // Fractional on purpose: 115/2 ml is exactly the kind of quantity whose
    // subtraction produces the long rationals R21 was about, and a staple is
    // the ONLY HTTP write path into inventory, so it is also what makes
    // inventory_deducted, expected_surplus and confirmation_questions
    // non-empty at all.
    assumed_staples: [
      { ingredient_id: 'olive_oil', quantity: { n: '115', d: '2' }, unit: 'ml' },
      { ingredient_id: 'salt', quantity: { n: '27', d: '2' }, unit: 'g' },
    ],
  });
  await makePlan(baseUrl, hh);
  const livePlan = (await currentPlan(baseUrl, hh)).body.plan;
  const planId = livePlan.plan_id;
  apiMod.setHouseholdId(hh);

  const liveList = (await grocery(baseUrl, hh, planId)).body.list;
  const liveLines = liveList.sections.flatMap((s) => s.lines);
  const measured = liveLines.filter((l) => !isZero(l.purchase_quantity));

  console.log(
    `\n--- c23 ground truth: household_size 5, ${livePlan.meals.length} meals, ` +
      `${liveList.sections.length} sections, ${liveLines.length} lines ` +
      `(${measured.length} measured), ${liveList.confirmation_questions.length} confirmation questions, ` +
      `${(liveList.to_taste ?? []).length} to-taste ---\n`,
  );

  const app = dom.mountApp();
  app.replaceChildren();
  groceryMod.renderGrocery(app, {});
  await settle();
  const listText = allText(app);

  // =====================================================================
  // The list as a ledger
  // =====================================================================
  console.log('=== T-017 grocery ledger ===');

  check('R1', listText.length > 200, `screen renders (${listText.length} chars of visible text)`);

  // R2 — grouped by store section. Every section the wire returned must be a
  // visible heading, or the grouping is not what the user sees.
  const missingSections = liveList.sections
    .map((s) => s.section)
    .filter((name) => !new RegExp(String(name).replace(/[_-]/g, '[ _-]?'), 'i').test(listText));
  check(
    'R2',
    missingSections.length === 0,
    `all ${liveList.sections.length} wire sections appear as text` +
      (missingSections.length ? ` — MISSING: ${missingSections.join(', ')}` : ''),
  );

  // R3 — every measured line is on the list. A ledger that silently drops a
  // line is worse than no ledger.
  const missingLines = measured.filter((l) => !listText.toLowerCase().includes(String(l.display_name).toLowerCase()));
  check(
    'R3',
    missingLines.length === 0,
    `all ${measured.length} measured lines rendered` +
      (missingLines.length ? ` — MISSING: ${missingLines.map((l) => l.display_name).join(', ')}` : ''),
  );

  // R4 — THE R21 REGRESSION. This is the check that failed at cycle 14.
  const raw = listText.match(/\b\d+\/\d{3,}\b/g) || [];
  check('R4', !RAW_RATIONAL.test(listText), `no raw rationals in the list${raw.length ? ` — found ${raw.slice(0, 5).join(', ')}` : ''}`);

  // R5 — tabular numerals. Headless, glyph width is unmeasurable; what IS
  // checkable is that the stylesheet actually declares it and that the class
  // it targets is one the screen renders. Reported as a STRUCTURAL check.
  const groceryCss = readFileSync(new URL('../../web/css/grocery.css', import.meta.url), 'utf8');
  const appCss = readFileSync(new URL('../../web/css/app.css', import.meta.url), 'utf8');
  const tokensCss = readFileSync(new URL('../../web/css/tokens.css', import.meta.url), 'utf8');
  const cssAll = groceryCss + '\n' + appCss + '\n' + tokensCss;
  const tabularRules = [...cssAll.matchAll(/([^{}]+)\{[^}]*tabular-nums[^}]*\}/g)].map((m) => norm(m[1]));
  const renderedClasses = new Set();
  (function walk(node) {
    if (node?.getAttribute) {
      const c = node.getAttribute('class');
      if (c) String(c).split(/\s+/).forEach((x) => x && renderedClasses.add(x));
    }
    (node?.childNodes || []).forEach(walk);
  })(app);
  const tabularHitsRendered = tabularRules.some((sel) =>
    [...renderedClasses].some((cls) => sel.includes('.' + cls)),
  );
  check(
    'R5',
    tabularRules.length > 0 && tabularHitsRendered,
    `tabular-nums declared (${tabularRules.length} rule(s)) and targets a class the screen actually renders` +
      (tabularRules.length ? ` — selectors: ${tabularRules.slice(0, 3).join(' | ')}` : ''),
  );

  // R6 — estimated packages are labelled estimated.
  const estimated = liveLines.filter((l) => l.is_estimate);
  if (estimated.length === 0) {
    check('R6', false, 'NOT EXERCISED — this fixture produced no is_estimate line; cannot judge the label');
  } else {
    check(
      'R6',
      /estimat/i.test(listText),
      `${estimated.length} estimated line(s) on the wire (e.g. ${estimated[0].display_name}) and the word "estimat…" appears`,
    );
  }

  // R7 — inventory confirmation questions surface INLINE on the list, not
  // buried behind a tap. The acceptance says inline.
  const qs = liveList.confirmation_questions;
  if (qs.length === 0) {
    check('R7', false, 'NOT EXERCISED — no confirmation questions on the wire despite assumed staples; cannot judge inline surfacing');
  } else {
    const listOnly = norm(visibleText(app));
    const shown = qs.filter((q) => listOnly.toLowerCase().includes(String(q.display_name).toLowerCase()) && /still right|\?/.test(listOnly));
    check(
      'R7',
      shown.length === qs.length,
      `${shown.length}/${qs.length} confirmation questions visible in the list body itself (e.g. "${qs[0].question.slice(0, 60)}…")`,
    );
  }

  // =====================================================================
  // The provenance drawer — "why am I buying this?"
  // =====================================================================
  console.log('\n=== T-017 provenance drawer ===');

  // Pick the line the acceptance is hardest on: most contributing recipes,
  // tie-broken by having a non-zero inventory deduction.
  const probe = [...measured].sort((a, b) => {
    const d = b.provenance.contributions.length - a.provenance.contributions.length;
    if (d !== 0) return d;
    return (isZero(a.provenance.inventory_deducted) ? 0 : 1) < (isZero(b.provenance.inventory_deducted) ? 0 : 1) ? 1 : -1;
  })[0];

  if (!probe) {
    check('R8', false, 'NOT EXERCISED — no measured line to probe');
  } else {
    console.log(
      `probe line: ${probe.display_name} — ${probe.provenance.contributions.length} contribution(s), ` +
        `deducted ${ratNum(probe.provenance.inventory_deducted)} ${probe.unit}, ` +
        `surplus ${ratNum(probe.provenance.expected_surplus)} ${probe.unit}, ` +
        `estimate=${probe.is_estimate}`,
    );

    const opener = tappables(app).find((el) =>
      new RegExp(`why am i buying.*${String(probe.display_name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(
        String(el.getAttribute('aria-label') || ''),
      ),
    );
    check('R8', Boolean(opener), `the "why am I buying …?" affordance exists on the ${probe.display_name} line and is tappable`);

    if (opener) {
      opener.dispatchEvent(makeEvent('click', opener));
      await settle();
      const drawer = sheetText();

      // R9 — names EACH contributing recipe. Not "a recipe"; each one.
      const namedRecipes = probe.provenance.contributions.filter((c) =>
        drawer.toLowerCase().includes(String(c.recipe_name).toLowerCase()),
      );
      check(
        'R9',
        namedRecipes.length === probe.provenance.contributions.length,
        `${namedRecipes.length}/${probe.provenance.contributions.length} contributing recipes named in the drawer`,
      );

      // R10 — and EACH contributing AMOUNT, rendered as a number a human can
      // read. Derived from the wire, matched loosely on the leading digits so
      // a legitimate rounding (44.05 for 44.0483…) still passes but a missing
      // number does not.
      const shownAmounts = probe.provenance.contributions.filter((c) => {
        const v = ratNum(c.amount);
        if (!Number.isFinite(v)) return false;
        const whole = Math.floor(v);
        return new RegExp(`\\b${whole}(\\b|[.,])`).test(drawer) || drawer.includes(v.toFixed(1)) || drawer.includes(v.toFixed(2));
      });
      check(
        'R10',
        shownAmounts.length === probe.provenance.contributions.length,
        `${shownAmounts.length}/${probe.provenance.contributions.length} contributing amounts rendered ` +
          `(wire: ${probe.provenance.contributions.map((c) => `${c.recipe_name}=${ratNum(c.amount)}`).join(', ')})`,
      );

      // R11 — inventory deducted is stated.
      const ded = ratNum(probe.provenance.inventory_deducted);
      check(
        'R11',
        isZero(probe.provenance.inventory_deducted)
          ? /already have|on hand|in your kitchen|deduct|inventory/i.test(drawer)
          : /already have|on hand|deduct|inventory/i.test(drawer) && new RegExp(`\\b${Math.floor(ded)}\\b`).test(drawer),
        isZero(probe.provenance.inventory_deducted)
          ? `deduction is 0 on this line; the drawer still speaks to inventory`
          : `inventory deduction of ${ded} ${probe.unit} is stated in the drawer`,
      );

      // R12 — expected surplus is stated.
      const sur = ratNum(probe.provenance.expected_surplus);
      check(
        'R12',
        /surplus|left over|leftover|spare|extra/i.test(drawer),
        `expected surplus (${sur} ${probe.unit}) is spoken to in the drawer`,
      );

      // R13 — the drawer itself must not leak rationals either.
      check('R13', !RAW_RATIONAL.test(drawer), `no raw rationals in the drawer`);

      // R14 — the protected-edit affordance exists where the user is.
      const editor = tappables(sheetRoot() || app)
        .concat(sheetRoot()?.querySelectorAll ? [...sheetRoot().querySelectorAll('input')] : [])
        .find((el) => /amount of .* to buy/i.test(String(el.getAttribute?.('aria-label') || '')));
      check('R14', Boolean(editor), `the quantity editor is reachable from the drawer (aria-label "Amount of … to buy, in …")`);
    }
  }

  // =====================================================================
  // Protected user edits survive regeneration
  // =====================================================================
  console.log('\n=== T-017 protected user edits ===');

  const target = measured[0];
  if (!target) {
    check('R15', false, 'NOT EXERCISED — no measured line to edit');
  } else {
    // A value that cannot collide with anything the generator would produce.
    const EDIT = { n: '1234', d: '1' };
    const patched = await api(baseUrl, `/api/grocery/lines/${target.line_id}`, {
      method: 'PATCH',
      body: { user_edited_quantity: EDIT },
      householdId: hh,
    });
    check('R15', patched.status === 200, `PATCH user_edited_quantity → ${patched.status}`);

    // Regenerate the list from scratch — a NEW GET plus a full re-render, the
    // same path a user gets by leaving the screen and coming back. This is
    // where a screen that writes generated values over the user's edit fails.
    const after = (await grocery(baseUrl, hh, planId)).body.list;
    const afterLine = after.sections.flatMap((s) => s.lines).find((l) => l.line_id === target.line_id);
    check(
      'R16',
      afterLine && afterLine.user_edited_quantity && Number(afterLine.user_edited_quantity.n) === 1234,
      `the edit survives regeneration ON THE WIRE (user_edited_quantity=${
        afterLine?.user_edited_quantity ? ratNum(afterLine.user_edited_quantity) : 'null'
      }, generated purchase_quantity=${afterLine ? ratNum(afterLine.purchase_quantity) : '?'} — the two must be different columns)`,
    );

    app.replaceChildren();
    groceryMod.renderGrocery(app, {});
    await settle();
    const afterText = allText(app);
    check(
      'R17',
      /\b1234\b/.test(afterText),
      `the edited amount is VISIBLE after a full re-render (acceptance: "a user-edited quantity visibly survives list regeneration")`,
    );
    check('R18', !RAW_RATIONAL.test(afterText), `still no raw rationals after the edit round-trip`);
  }

  await server.stop();

  console.log(`\n=== T-017 GATE: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) {
    console.log('failures:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('GATE CRASHED:', e);
  process.exit(2);
});
