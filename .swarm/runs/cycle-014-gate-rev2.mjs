/**
 * cycle-014-gate-rev2.mjs — CONDUCTOR-authored verification gate, revision 2.
 *
 * WHY REV2 EXISTS (recorded honestly, not buried):
 *
 * 1. CONTAMINATION. I wrote rev1 into the target working tree WHILE the build
 *    wave was live. The T-016 builder found it and ran it during development.
 *    That breaks the rule that builders never see the verify check — an agent
 *    that knows the check can code to the check. Every rev1 PASS for T-016 is
 *    therefore contaminated evidence. rev2 is authored AFTER both builders
 *    finished and the code was frozen, so nothing here could have been coded
 *    to. rev1 and its output are preserved beside this file, unmodified.
 *
 * 2. REV1 HAD VACUOUS PASSES, proven by cycle-014-diagnostic.txt:
 *    - P19 "0 slot(s) changed" passed while NO swap had occurred. A check that
 *      passes when the feature never ran is not a check.
 *    - P20 "offered null" passed because seven of my nine guessed swap-reason
 *      codes were invalid and the API 400'd them. The real codes come from
 *      domain/src/recipe.ts and are used below.
 *    - P4 asserted the domain's combined_label appears verbatim in textContent.
 *      The diagnostic proved ui.js renders "26 min total16 min hands-on" — the
 *      separator is dropped from the DOM but preserved in aria-label. P4 was
 *      testing an implementation detail of a shared component, not the DoD-6
 *      requirement. Replaced with the actual requirement, and the ui.js defect
 *      is filed rather than papered over.
 *
 * 3. REV1 MISSED A REAL DEFECT that reading actual rendered output exposed:
 *    the grocery ledger prints raw rationals ("Olive oil 44 11529419/32000000
 *    ml"). New Q-checks below are pointed at that.
 *
 * Expected values are still DERIVED from the live API at run time, never
 * hardcoded, so a screen cannot pass by printing plausible constants.
 *
 * Run: node .swarm/runs/cycle-014-gate-rev2.mjs
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

/** The nine canonical codes, read from domain/src/recipe.ts — not guessed. */
const SWAP_REASONS = ['faster', 'less_hands_on', 'fewer_dishes', 'cheaper', 'more_familiar', 'more_adventurous', 'no_pasta', 'different_protein', 'use_what_i_have'];

async function main() {
  const server = await boot();
  const { baseUrl } = server;
  const dom = installDom({ baseUrl });

  const planMod = await import('../../web/js/plan.js');
  const groceryMod = await import('../../web/js/grocery.js');
  const apiMod = await import('../../web/js/api.js');
  const ui = await import('../../web/js/ui.js');

  const planSrc = readFileSync('web/js/plan.js', 'utf8');
  const grocerySrc = readFileSync('web/js/grocery.js', 'utf8');
  const sheetRoot = () => dom.document.getElementById('sheet-root');
  const allText = (root) => norm(visibleText(root) + ' ' + (sheetRoot() ? visibleText(sheetRoot()) : ''));

  // A DIFFERENT household shape from rev1's, so nothing tuned to rev1's
  // fixture survives by coincidence.
  const hh = await makeHousehold(baseUrl, {
    household: { name: 'Rev2 household', household_size: 5, novelty_preference: 'adventurous' },
    assumed_staples: [
      { ingredient_id: 'olive_oil', quantity: { n: '250', d: '1' }, unit: 'ml' },
      { ingredient_id: 'garlic', quantity: { n: '3', d: '1' }, unit: 'g' },
    ],
  });
  await makePlan(baseUrl, hh);
  const livePlan = (await currentPlan(baseUrl, hh)).body.plan;
  const planId = livePlan.plan_id;
  apiMod.setHouseholdId(hh);

  const liveList = (await grocery(baseUrl, hh, planId)).body.list;
  const liveLines = liveList.sections.flatMap((s) => s.lines);

  console.log(`\n--- rev2 ground truth: ${livePlan.meals.length} meals, ${liveList.sections.length} sections, ${liveLines.length} lines (household_size 5, adventurous) ---\n`);

  // =========================================================================
  console.log('=== T-016 plan screen (rev2) ===');
  const app = dom.mountApp();
  app.replaceChildren();
  planMod.renderPlan(app, {});
  await settle();
  const planText = allText(app);

  check('R1', typeof planMod.renderPlan === 'function' && planText.length > 200, `renderPlan renders (${planText.length} chars)`);

  const missingNames = livePlan.meals.filter((m) => !planText.includes(m.name)).map((m) => m.name);
  check('R2', missingNames.length === 0, `all ${livePlan.meals.length} meal names rendered${missingNames.length ? ` — missing ${missingNames.join(', ')}` : ''}`);

  // --- DoD 6, the actual requirement: both times, separately, every meal ---
  const timeFails = [];
  for (const m of livePlan.meals) {
    const t = Math.round(m.total_seconds / 60);
    const a = Math.round(m.active_seconds / 60);
    if (!planText.includes(String(t)) || !planText.includes(String(a))) timeFails.push(`${m.name}: total ${t}=${planText.includes(String(t))} active ${a}=${planText.includes(String(a))}`);
    if (t === a) timeFails.push(`${m.name}: total and active are the same number (${t}) — cannot prove separateness`);
  }
  check('R3', timeFails.length === 0, `DoD 6 — total and active both rendered, as distinct values, for every meal${timeFails.length ? ` — ${timeFails.join('; ')}` : ''}`);

  // The domain's copy must reach the ACCESSIBLE name verbatim (this is where
  // ui.js preserves it). Proves the client did not re-word or recompute.
  const ariaHits = [];
  for (const m of livePlan.meals) {
    const el = ui.renderTimeInfo({ total_seconds: m.total_seconds, active_seconds: m.active_seconds, time_label: m.time_label });
    ariaHits.push(norm(el.getAttribute('aria-label') || '') === norm(m.time_label));
  }
  check('R4', ariaHits.every(Boolean), `domain time_label reaches the accessible name verbatim for ${ariaHits.filter(Boolean).length}/${ariaHits.length} meals`);

  // --- reason codes: the domain's own text, capped at three ---------------
  const reasonFails = [];
  for (const m of livePlan.meals) {
    if (m.reasons.length > 3) reasonFails.push(`${m.name}: API returned ${m.reasons.length}`);
    const rendered = m.reasons.filter((r) => planText.includes(norm(r.text))).length;
    if (rendered !== m.reasons.length) reasonFails.push(`${m.name}: ${rendered}/${m.reasons.length} reason texts rendered`);
  }
  check('R5', reasonFails.length === 0, `<=3 domain reason texts rendered verbatim per meal${reasonFails.length ? ` — ${reasonFails.join('; ')}` : ''}`);

  // =========================================================================
  // SWAP — the real accept path, driven by a reason PROVEN to have alternatives
  // =========================================================================
  let usableReason = null;
  let apiAltCount = null;
  for (const reason of SWAP_REASONS) {
    const r = await api(baseUrl, `/api/plans/${planId}/meals/${livePlan.meals[0].slot}/swap`, {
      method: 'POST',
      householdId: hh,
      body: { reason },
    });
    if (r.status === 200 && Array.isArray(r.body?.alternatives) && r.body.alternatives.length > 0) {
      usableReason = reason;
      apiAltCount = r.body.alternatives.length;
      break;
    }
  }
  check('R6', usableReason !== null, `fixture has a swap reason with real alternatives: ${usableReason} (${apiAltCount} offered)`);
  check('R7', apiAltCount === null || apiAltCount <= 3, `API caps alternatives at three (offered ${apiAltCount})`);

  // Map the code to the label the screen shows, by asking the SHEET, not by
  // assuming the builder's wording.
  const targetSlot = livePlan.meals[0].slot;
  const targetName = livePlan.meals[0].name;
  const untouchedNames = livePlan.meals.filter((m) => m.slot !== targetSlot).map((m) => m.name);

  const app2 = dom.mountApp();
  app2.replaceChildren();
  planMod.renderPlan(app2, {});
  await settle();

  const findTap = (re, roots) => {
    for (const root of roots.filter(Boolean)) {
      const t = tappables(root).find((el) => re.test(norm(visibleText(el))) || re.test(norm(el.getAttribute('aria-label') || '')));
      if (t) return t;
    }
    return null;
  };

  // Which on-screen chip carries `usableReason`? Do NOT guess from its label —
  // the code is `faster` but the button reads "Less time overall". Instead,
  // observe the reason the CLIENT actually puts on the wire. This couples the
  // gate to the contract, not to the builder's copy.
  const realFetch = globalThis.fetch;
  let lastReasonSent = null;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? '');
    if (/\/swap$/.test(url) && init?.body) {
      try {
        lastReasonSent = JSON.parse(init.body).reason ?? null;
      } catch {
        /* not our payload */
      }
    }
    return realFetch(input, init);
  };

  /** Probe each chip in a throwaway render; return the chip label whose tap
   *  sends `usableReason`. */
  async function labelForReason(reason) {
    const probe = dom.mountApp();
    probe.replaceChildren();
    planMod.renderPlan(probe, {});
    await settle();
    const open = findTap(/swap/i, [probe]);
    if (!open) return null;
    open.dispatchEvent(makeEvent('click', open));
    await settle();
    const chips = tappables(sheetRoot()).filter((el) => norm(visibleText(el)).length > 2);
    for (const c of chips) {
      lastReasonSent = null;
      c.dispatchEvent(makeEvent('click', c));
      await settle(3);
      if (lastReasonSent === reason) return norm(visibleText(c));
      // Re-open for the next probe.
      const reopen = findTap(/swap/i, [probe]);
      if (reopen) {
        reopen.dispatchEvent(makeEvent('click', reopen));
        await settle(2);
      }
    }
    return null;
  }

  const chipLabel = usableReason ? await labelForReason(usableReason) : null;
  console.log(`     [gate] reason "${usableReason}" is the chip labelled ${JSON.stringify(chipLabel)}`);

  let taps = 0;
  const trail = [];
  let acceptDone = false;
  let screenAltCount = null;

  const app2b = dom.mountApp();
  app2b.replaceChildren();
  planMod.renderPlan(app2b, {});
  await settle();

  const swapBtn = findTap(/swap/i, [app2b]);
  if (swapBtn) {
    swapBtn.dispatchEvent(makeEvent('click', swapBtn));
    taps += 1;
    trail.push(norm(visibleText(swapBtn)).slice(0, 32));
    await settle();

    const chip = chipLabel
      ? findTap(new RegExp(chipLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), [sheetRoot(), app2b])
      : null;
    if (chip) {
      chip.dispatchEvent(makeEvent('click', chip));
      taps += 1;
      trail.push(norm(visibleText(chip)).slice(0, 32));
      await settle();

      // Alternatives now on screen — count only real alternative choices.
      const root = sheetRoot() && visibleText(sheetRoot()).length ? sheetRoot() : app2b;
      const alts = tappables(root).filter((el) => {
        const t = norm(visibleText(el));
        return t.length > 3 && !/cancel|close|back|undo|different reason|choose a different/i.test(t);
      });
      screenAltCount = alts.length;

      const accept = findTap(/use this|choose this|swap to|pick this|select/i, [sheetRoot(), app2b]) || alts[0];
      if (accept) {
        accept.dispatchEvent(makeEvent('click', accept));
        taps += 1;
        trail.push(norm(visibleText(accept)).slice(0, 32));
        await settle();
        acceptDone = true;
      }
    }
  }

  check('R8', acceptDone, `swap flow reached an accept in ${taps} taps [${trail.join(' > ')}]`);
  check('R9', acceptDone && taps <= 3, `DoD 3 — at most three taps (took ${taps})`);
  check('R10', screenAltCount === null || screenAltCount <= 3, `screen offered at most three alternatives (counted ${screenAltCount})`);

  // THE CHECK REV1 GOT WRONG: a swap must change EXACTLY ONE slot, and it must
  // actually have changed one. Zero changed is now a FAILURE, not a pass.
  const afterPlan = (await currentPlan(baseUrl, hh)).body.plan;
  const changed = afterPlan.meals.filter((m) => {
    const before = livePlan.meals.find((b) => b.slot === m.slot);
    return before && before.recipe_id !== m.recipe_id;
  });
  check('R11', changed.length === 1 && changed[0].slot === targetSlot, `server-side: EXACTLY one slot changed and it is the target (changed ${changed.length} ${JSON.stringify(changed.map((c) => c.slot))}, target ${targetSlot})`);

  const survivors = afterPlan.meals.filter((m) => untouchedNames.includes(m.name)).length;
  check('R12', survivors === untouchedNames.length, `server-side: the other ${untouchedNames.length} meals are byte-identical after the swap (${survivors} survive)`);

  // These must FAIL when the accept never happened — rev1's mistake was
  // letting a skipped feature short-circuit into a pass.
  const afterText = allText(app2b);
  const newMeal = changed[0];
  check('R13', acceptDone && !!newMeal && afterText.includes(newMeal.name), `screen shows the NEW meal after accepting (${newMeal ? newMeal.name : 'no swap occurred'})`);
  check('R14', acceptDone && !!newMeal && !afterText.includes(targetName), `screen no longer shows the swapped-out meal (${targetName})`);

  globalThis.fetch = realFetch;

  // --- no hand-rolled time formatting -------------------------------------
  check('R15', !/\/\s*60\b|Math\.(round|floor)\s*\([^)]*60/.test(planSrc), 'plan.js does not hand-format minutes');

  // --- KI-7: empty and partial plans must EXPLAIN themselves ---------------
  const hhEmpty = await makeHousehold(baseUrl, { household: { name: 'Rev2 impossible', weeknight_active_time_ceiling_seconds: 240, weeknight_total_time_ceiling_seconds: 480 } });
  await makePlan(baseUrl, hhEmpty);
  const emptyPlan = (await currentPlan(baseUrl, hhEmpty)).body.plan;
  apiMod.setHouseholdId(hhEmpty);
  const appE = dom.mountApp();
  appE.replaceChildren();
  planMod.renderPlan(appE, {});
  await settle();
  const emptyText = allText(appE);

  const strings = [];
  const walk = (v) => {
    if (typeof v === 'string' && v.length > 25 && /\s/.test(v)) strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(emptyPlan.shortfall);
  const renderedShort = strings.filter((s) => emptyText.includes(norm(s)));
  check('R16', emptyPlan.is_empty === true, `fixture produced a genuinely empty plan (is_empty=${emptyPlan.is_empty})`);
  check('R17', renderedShort.length > 0, `KI-7 — the empty plan renders the API's own explanation verbatim (${renderedShort.length}/${strings.length})`);
  if (renderedShort.length) console.log(`     user reads: "${renderedShort[0].slice(0, 150)}"`);

  // =========================================================================
  console.log('\n=== T-017 grocery ledger (rev2) ===');
  // A DEDICATED household. The swap above mutated `hh`'s plan, so grocery
  // ground truth captured before it is stale — that mismatch is a gate
  // ordering bug, not a product defect, and isolation is the honest fix
  // rather than loosening the check.
  const hhG = await makeHousehold(baseUrl, {
    household: { name: 'Rev2 grocery', household_size: 5, novelty_preference: 'adventurous' },
    assumed_staples: [
      { ingredient_id: 'olive_oil', quantity: { n: '250', d: '1' }, unit: 'ml' },
      { ingredient_id: 'garlic', quantity: { n: '3', d: '1' }, unit: 'g' },
    ],
  });
  await makePlan(baseUrl, hhG);
  const planIdG = (await currentPlan(baseUrl, hhG)).body.plan.plan_id;
  const liveListG = (await grocery(baseUrl, hhG, planIdG)).body.list;
  const liveLinesG = liveListG.sections.flatMap((s) => s.lines);
  console.log(`     [gate] grocery household: ${liveListG.sections.length} sections, ${liveLinesG.length} lines`);
  apiMod.setHouseholdId(hhG);
  const appG = dom.mountApp();
  appG.replaceChildren();
  groceryMod.renderGrocery(appG, {});
  await settle();

  const gTextInitial = allText(appG);
  check('R18', typeof groceryMod.renderGrocery === 'function' && gTextInitial.length > 200, `renderGrocery renders (${gTextInitial.length} chars)`);

  const missingSections = liveListG.sections.map((s) => s.section).filter((s) => !gTextInitial.toLowerCase().includes(String(s).replace(/_/g, ' ').toLowerCase()));
  check('R19', missingSections.length === 0, `all ${liveListG.sections.length} store sections rendered${missingSections.length ? ` — missing ${missingSections.join(', ')}` : ''}`);

  const missingLines = liveLinesG.filter((l) => !gTextInitial.toLowerCase().includes(String(l.display_name).toLowerCase())).map((l) => l.display_name);
  check('R20', missingLines.length === 0, `all ${liveLinesG.length} lines rendered${missingLines.length ? ` — missing ${missingLines.join(', ')}` : ''}`);

  // --- THE DEFECT REV1 MISSED: a shopping list must show buyable numbers ---
  // No human shops from "44 11529419/32000000 ml". Any rendered fraction whose
  // denominator exceeds 100 is unreadable on a grocery list.
  const badFractions = [...gTextInitial.matchAll(/(\d+)\s*\/\s*(\d+)/g)].filter((m) => Number(m[2]) > 100).map((m) => m[0]);
  check('R21', badFractions.length === 0, `no unreadable raw fractions on the ledger${badFractions.length ? ` — found ${badFractions.length}: ${[...new Set(badFractions)].slice(0, 5).join(', ')}` : ''}`);

  const longDecimals = [...gTextInitial.matchAll(/\d+\.\d{4,}/g)].map((m) => m[0]);
  check('R22', longDecimals.length === 0, `no unreadable long decimals${longDecimals.length ? ` — found ${[...new Set(longDecimals)].slice(0, 5).join(', ')}` : ''}`);

  // --- DoD 5: provenance names EVERY contributing recipe for EVERY line ----
  // Open each row's drawer individually and read the sheet while it is open —
  // openSheet replaces its content, so reading once at the end would miss all
  // but the last (a flaw rev1's G4 got away with).
  const rows = tappables(appG);
  const seenContributions = new Set();
  for (const el of rows) {
    el.dispatchEvent(makeEvent('click', el));
    await settle(2);
    const sh = sheetRoot();
    if (sh) {
      const t = norm(visibleText(sh));
      for (const line of liveLinesG) {
        for (const c of line.provenance.contributions) {
          if (t.includes(c.recipe_name)) seenContributions.add(`${line.line_id}::${c.recipe_id}`);
        }
      }
    }
  }
  const totalContributions = liveLinesG.reduce((a, l) => a + l.provenance.contributions.length, 0);
  // Also count anything rendered inline in the list itself.
  const inlineText = allText(appG);
  for (const line of liveLinesG) {
    for (const c of line.provenance.contributions) {
      if (inlineText.includes(c.recipe_name)) seenContributions.add(`${line.line_id}::${c.recipe_id}`);
    }
  }
  check('R23', seenContributions.size === totalContributions, `DoD 5 — ${seenContributions.size}/${totalContributions} line→recipe provenance links readable by a user`);

  const multi = liveLinesG.filter((l) => l.provenance.contributions.length > 1);
  check('R24', multi.length > 0, `${multi.length} multi-recipe lines exercised (the case the drawer exists for)`);

  // --- inventory deduction, per deducted line -----------------------------
  const deducted = liveLinesG.filter((l) => l.provenance.inventory_deducted.n !== '0');
  const dedShown = [];
  for (const l of deducted) {
    const amt = ratNum(l.provenance.inventory_deducted);
    const variants = [String(Math.round(amt)), String(Math.round(amt * 100) / 100), String(amt)];
    let found = false;
    for (const el of rows) {
      el.dispatchEvent(makeEvent('click', el));
      await settle(2);
      const sh = sheetRoot();
      if (!sh) continue;
      const t = norm(visibleText(sh));
      if (t.toLowerCase().includes(String(l.display_name).toLowerCase()) && variants.some((v) => t.includes(v))) {
        found = true;
        break;
      }
    }
    dedShown.push({ name: l.display_name, amt, found });
  }
  check('R25', deducted.length > 0 && dedShown.every((d) => d.found), `inventory deduction readable for ${dedShown.filter((d) => d.found).length}/${deducted.length} deducted lines${dedShown.filter((d) => !d.found).length ? ` — missing: ${dedShown.filter((d) => !d.found).map((d) => `${d.name} (${d.amt})`).join(', ')}` : ''}`);

  // --- user edit survives regeneration ------------------------------------
  const target = liveLinesG[0];
  const patched = await api(baseUrl, `/api/grocery/lines/${target.line_id}`, { method: 'PATCH', householdId: hhG, body: { user_edited_quantity: { n: '13', d: '1' } } });
  const reread = (await grocery(baseUrl, hhG, planIdG)).body.list.sections.flatMap((s) => s.lines).find((l) => l.line_id === target.line_id);
  check('R26', patched.status < 300 && reread?.user_edited_quantity?.n === '13', `server: user edit survives regeneration (${JSON.stringify(reread?.user_edited_quantity)})`);

  const appG2 = dom.mountApp();
  appG2.replaceChildren();
  groceryMod.renderGrocery(appG2, {});
  await settle();
  const g2 = allText(appG2);
  const generated = Math.round(ratNum(target.purchase_quantity) * 100) / 100;
  check('R27', g2.includes('13'), `screen: the user's edited 13 is displayed after regeneration`);
  check('R28', reread.user_edited_quantity.n === '13', `the generated value (${generated}) never overwrote the user column`);

  // --- tabular numerals ----------------------------------------------------
  let gcss = '';
  try {
    gcss = readFileSync('web/css/grocery.css', 'utf8');
  } catch {}
  check('R29', /tabular|--numeric-tabular/.test(gcss + grocerySrc + readFileSync('web/css/app.css', 'utf8')), 'ledger uses tabular numerals');

  await server.stop();

  console.log(`\npass ${pass} / ${pass + fail}`);
  if (fail) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('GATE HARNESS ERROR:', e);
  process.exit(2);
});
