/**
 * cycle-015-gate-rev2.mjs — CONDUCTOR-authored verification gate, revision 2.
 *
 * Items under test: T-019 (interruption-aware cooking mode) and T-052
 * (grocery purchase-quantity formatting).
 *
 * WHY REV2 EXISTS — every rev1 failure was a fault in MY harness, not in the
 * product, and cycle-015-diagnostic.txt proves each one. Recorded rather than
 * quietly overwritten:
 *
 *  1. rev1's G2/G6/G7 looked for the wrong DOM. `display_name` is lowercase
 *     ("honey") while the row renders it capitalised, and the provenance
 *     drawer + quantity editor live in the bottom SHEET reached by tapping a
 *     line, not behind an in-page toggle. rev1 also happened to tap a
 *     "to taste" line, which correctly has neither an amount nor an editor.
 *  2. rev1's C11 probe drove the session through EVERY step looking for an
 *     attention warning, which completed it — so the timer and resume checks
 *     that followed (C12-C15) ran against a finished session and failed for
 *     that reason alone. The diagnostic posted the identical timer payload to
 *     a FRESH session and got 200. rev2 gives each concern its own session.
 *  3. The recipe the plan happens to pick first has no continuous-attention
 *     step at all, so C11 could never have been exercised on it. rev2 opens a
 *     session directly on a catalog recipe that HAS one (read from
 *     data/recipes, not guessed).
 *
 * rev1 and its output are preserved beside this file, unmodified.
 *
 * Authored AFTER the code was frozen and salvage-committed (5622810). Neither
 * builder saw any revision of this file. Expected values are DERIVED from the
 * live API and the shipped recipe data at run time.
 *
 * Run: node .swarm/runs/cycle-015-gate-rev2.mjs
 */

import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * HARNESS GUARD, not a gate relaxation. The C13 reload test is the only check
 * here that idles for seconds with keep-alive sockets open, and Node 24.19's
 * bundled undici throws `Cannot read properties of undefined (reading 'deref')`
 * from its own `onParserTimeout` when that happens (node:internal/deps/undici
 * 7709 — internal to the HTTP client, nothing to do with this product). The
 * uncaught throw killed rev2's first run mid-C13. This swallows exactly that
 * error and nothing else; any other uncaught error still fails the run loudly.
 */
process.on('uncaughtException', (e) => {
  const s = String((e && e.stack) || e);
  if (s.includes('onParserTimeout') || s.includes("reading 'deref'")) {
    console.log('NOTE: ignored a Node/undici internal timer bug during the idle wait (harness, not product)');
    return;
  }
  console.error('GATE HARNESS ERROR (uncaught):', e);
  process.exit(2);
});

/** domain/src/reasons.ts NO_RECOVERY_GUIDANCE_TEXT — the ONE honest fallback. */
const NO_RECOVERY = 'No recovery guidance for this step.';
/** digits, optionally up to three decimal places — a number usable at a shelf. */
const SHOPPABLE = /^\d+(\.\d{1,3})?$/;

async function main() {
  const server = await boot();
  const { baseUrl } = server;
  const dom = installDom({ baseUrl });

  // The shim has no window.setInterval — cook.js's timer tick needs one.
  // Supplying a standard browser API the real product has is not a relaxation
  // of this gate; without it the timer path could not execute at all.
  dom.window.setInterval = (fn, ms) => setInterval(fn, ms);
  dom.window.clearInterval = (id) => clearInterval(id);

  const cookMod = await import('../../web/js/cook.js');
  const planMod = await import('../../web/js/plan.js');
  const groceryMod = await import('../../web/js/grocery.js');
  const apiMod = await import('../../web/js/api.js');

  const sheetRoot = () => dom.document.getElementById('sheet-root');
  const allText = (root) => norm(visibleText(root) + ' ' + (sheetRoot() ? visibleText(sheetRoot()) : ''));

  // A third household shape — different from cycle 14 rev1 (size 4) and
  // rev2 (size 5), so nothing tuned to either fixture survives by luck.
  const hh = await makeHousehold(baseUrl, {
    household: { name: 'C15 household', household_size: 3, novelty_preference: 'mostly_familiar' },
    assumed_staples: [
      { ingredient_id: 'olive_oil', quantity: { n: '120', d: '1' }, unit: 'ml' },
      { ingredient_id: 'salt', quantity: { n: '40', d: '1' }, unit: 'g' },
    ],
  });
  await makePlan(baseUrl, hh);
  const livePlan = (await currentPlan(baseUrl, hh)).body.plan;
  const planId = livePlan.plan_id;
  apiMod.setHouseholdId(hh);

  const liveList = (await grocery(baseUrl, hh, planId)).body.list;
  const liveLines = liveList.sections.flatMap((s) => s.lines);
  const measuredLines = liveLines.filter((l) => !(l.purchase_quantity.n === '0' && l.purchase_quantity.d === '1') || l.user_edited_quantity);

  console.log(
    `\n--- c15 ground truth: household_size 3, ${livePlan.meals.length} meals, ` +
      `${liveList.sections.length} sections, ${liveLines.length} grocery lines ---\n`,
  );

  // =======================================================================
  // T-052 — grocery quantities a parent can shop from
  // =======================================================================
  console.log('=== T-052 grocery purchase-quantity formatting ===');

  const app = dom.mountApp();
  app.replaceChildren();
  groceryMod.renderGrocery(app, {});
  await settle();
  const listText = allText(app);

  check('G0', listText.length > 200, `grocery screen renders (${listText.length} chars)`);

  const rawFractions = listText.match(/\b\d+\/\d{3,}\b/g) || [];
  check(
    'G1',
    rawFractions.length === 0,
    `no raw rational on the list surface${rawFractions.length ? ` — found ${rawFractions.length}: ${rawFractions.slice(0, 4).join(', ')}` : ''}`,
  );

  // --- G2..G5: every LINE amount, read from the DOM, checked against the
  // exact rational the API sent. Rows are matched by their `__name` node.
  const rows = app.descendants().filter((el) => {
    const c = String(el.getAttribute('class') || '').split(/\s+/);
    return c.includes('grocery-line');
  });
  const rowByName = new Map();
  for (const r of rows) {
    const nameEl = r.descendants().find((n) => String(n.getAttribute('class') || '').split(/\s+/).includes('grocery-line__name'));
    const qtyEl = r.descendants().find((n) => String(n.getAttribute('class') || '').split(/\s+/).includes('grocery-line__qty'));
    if (nameEl) rowByName.set(norm(visibleText(nameEl)).toLowerCase(), { row: r, qtyEl });
  }
  const shapeFails = [];
  const underbuys = [];
  const falseZeros = [];
  const wayOff = [];
  let amountsChecked = 0;
  for (const line of liveLines) {
    const entry = rowByName.get(String(line.display_name).toLowerCase());
    if (!entry) {
      shapeFails.push(`${line.display_name}: no row rendered`);
      continue;
    }
    if (!entry.qtyEl) {
      shapeFails.push(`${line.display_name}: row has no amount node`);
      continue;
    }
    const shownRaw = norm(visibleText(entry.qtyEl)).split(/\s+/)[0];
    // "To taste" lines legitimately carry no number at all.
    if (/^to$/i.test(shownRaw)) continue;
    if (!SHOPPABLE.test(shownRaw)) {
      shapeFails.push(`${line.display_name}: "${shownRaw}"`);
      continue;
    }
    amountsChecked += 1;
    const exact = ratNum(line.user_edited_quantity || line.purchase_quantity);
    const shown = Number(shownRaw);
    if (exact > 0 && shown < exact) underbuys.push(`${line.display_name}: shows ${shown}, needs ${exact.toFixed(4)}`);
    if (exact > 0 && shown === 0) falseZeros.push(`${line.display_name}: exact ${exact.toFixed(6)} shown as 0`);
    const tol = line.unit === 'count' ? 0.1001 : 1.0001;
    if (Math.abs(shown - exact) > tol) wayOff.push(`${line.display_name}: shows ${shown}, exact ${exact.toFixed(4)} (${line.unit})`);
  }
  check('G2', shapeFails.length === 0 && amountsChecked >= 15, `${amountsChecked} numeric line amounts, all shoppable${shapeFails.length ? ` — ${shapeFails.slice(0, 4).join('; ')}` : ''}`);
  check('G3', underbuys.length === 0, `display rounding never UNDERBUYS${underbuys.length ? ` — ${underbuys.slice(0, 4).join('; ')}` : ''}`);
  check('G4', falseZeros.length === 0, `no nonzero amount displays as "0"${falseZeros.length ? ` — ${falseZeros.slice(0, 3).join('; ')}` : ''}`);
  check('G5', wayOff.length === 0, `every shown amount within one unit of exact — not a fabricated constant${wayOff.length ? ` — ${wayOff.slice(0, 4).join('; ')}` : ''}`);

  // --- G6..G8: the OTHER call sites, inside the bottom sheet of a MEASURED
  // line: provenance contributions, deducted/surplus stats, the editor's
  // prefilled value and the reset label. rev1's failure here was a harness
  // fault; a fix that touched only buildLineRow would still fail these.
  const targetLine = measuredLines.find((l) => rowByName.has(String(l.display_name).toLowerCase()) && ratNum(l.purchase_quantity) > 0);
  let sheetText = '';
  let inputVal = null;
  let resetText = null;
  if (targetLine) {
    const btn = tappables(rowByName.get(String(targetLine.display_name).toLowerCase()).row).find(
      (el) => String(el.getAttribute('class') || '').includes('grocery-line__body'),
    );
    if (btn) {
      btn.dispatchEvent(makeEvent('click', btn));
      await settle();
      const sheet = sheetRoot();
      sheetText = sheet ? norm(visibleText(sheet)) : '';
      const input = sheet ? sheet.descendants().find((e) => e.tagName === 'INPUT' && String(e.getAttribute('aria-label') || '').startsWith('Amount of')) : undefined;
      inputVal = input ? String(input.value ?? '') : null;
      const rb = sheet ? tappables(sheet).find((el) => norm(visibleText(el)).startsWith('Reset to suggested')) : undefined;
      resetText = rb ? norm(visibleText(rb)) : null;
    }
  }
  const sheetFractions = (sheetText.match(/\b\d+\/\d{3,}\b/g) || []).slice(0, 4);
  check(
    'G6',
    sheetText.length > 40 && sheetFractions.length === 0,
    sheetText.length <= 40
      ? `sheet for "${targetLine?.display_name}" did not open — provenance call site UNTESTED`
      : `provenance sheet for "${targetLine.display_name}" carries no raw rationals (${sheetText.length} chars)`,
  );
  check(
    'G7',
    inputVal !== null && SHOPPABLE.test(inputVal),
    inputVal === null ? 'no quantity editor in the sheet — call site UNTESTED' : `editor prefills a shoppable number ("${inputVal}")`,
  );
  check(
    'G8',
    resetText === null || !/\d+\/\d{3,}/.test(resetText),
    resetText === null ? 'no reset control (line is not user-edited) — n/a' : `reset label is shoppable: "${resetText}"`,
  );

  // =======================================================================
  // T-019 — interruption-aware cooking mode
  // =======================================================================
  console.log('\n=== T-019 cooking mode ===');
  check('C0', typeof cookMod.renderCook === 'function', 'cook.js exports renderCook');

  const newSession = async (recipeId, planMealId) => {
    const r = await api(baseUrl, '/api/cooking/sessions', {
      method: 'POST',
      householdId: hh,
      body: { plan_meal_id: planMealId ?? null, recipe_id: recipeId, target_servings: 3 },
    });
    if (r.status !== 201) throw new Error(`session create failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.session.session_id;
  };
  const post = (sid, payload) =>
    api(baseUrl, `/api/cooking/sessions/${sid}/events`, { method: 'POST', householdId: hh, body: { payload } });
  const view = (sid) => api(baseUrl, `/api/cooking/sessions/${sid}`, { householdId: hh }).then((r) => r.body.session);

  // ---- SESSION A: step rendering, safe stop, recovery -------------------
  const meal0 = livePlan.meals[0];
  const sidA = await newSession(meal0.recipe_id, meal0.plan_meal_id);
  const sA = await view(sidA);

  app.replaceChildren();
  let cleanup = cookMod.renderCook(app, { sessionId: sidA });
  await settle();
  const cookText = allText(app);

  check('C1', cookText.length > 150, `cooking screen renders for "${meal0.name}" (${cookText.length} chars)`);
  check('C2', cookText.includes(sA.step.text), 'the step instruction is shown VERBATIM from the API — never re-worded');
  check('C3', cookText.includes(`Step ${sA.current_step_index + 1} of ${sA.total_steps}`), `title states API position: "Step ${sA.current_step_index + 1} of ${sA.total_steps}"`);

  const totalMin = Math.round(sA.step.total_seconds / 60);
  const activeMin = Math.round(sA.step.active_seconds / 60);
  const unattendedS = sA.step.total_seconds - sA.step.active_seconds;
  check('C4', cookText.includes(String(totalMin)) && cookText.includes(String(activeMin)), `step time carries BOTH total (${totalMin}m) and active (${activeMin}m)`);

  const stop = sA.next_safe_stop;
  const stopShown =
    stop.kind === 'end_of_recipe'
      ? /no further safe stopping point/i.test(cookText)
      : cookText.includes(`step ${stop.step_index + 1}`) && /safe to stop|next safe stop/i.test(cookText);
  check('C5', stopShown, `next safe stopping point rendered from API kind="${stop.kind}"${stop.step_index !== undefined ? ` step_index=${stop.step_index}` : ''}`);

  const mp = stop.kind !== 'end_of_recipe' ? stop.maximum_pause : null;
  check(
    'C6',
    mp === null ||
      (mp.kind === 'unlimited'
        ? /no time limit on the pause/i.test(cookText)
        : cookText.includes(String(mp.seconds < 60 ? Math.round(mp.seconds) : Math.round(mp.seconds / 60)))),
    mp === null ? 'no maximum_pause on this stop — n/a' : `maximum pause rendered from API (${mp.kind}${mp.kind === 'bounded' ? ` ${mp.seconds}s` : ''})`,
  );

  check('C7', cookText.includes(sA.recovery_text), `recovery text verbatim from API: "${sA.recovery_text.slice(0, 55)}${sA.recovery_text.length > 55 ? '…' : ''}"`);
  const afterHeading = cookText.split('If you get pulled away')[1] || '';
  check(
    'C8',
    sA.recovery_text !== NO_RECOVERY || !/you can |try to |it should be fine|just /i.test(afterHeading),
    'no invented cooking advice alongside a no-guidance fallback (Invariant 6)',
  );

  // ---- SESSION B: an UNATTENDED step, labelled as such ------------------
  // Read the catalog for a recipe with real unattended time so the clause is
  // exercised rather than declared n/a.
  const recipeFiles = readdirSync('data/recipes').map((f) => JSON.parse(readFileSync(`data/recipes/${f}`, 'utf8')));
  const unattendedRecipe = recipeFiles.find((r) => (r.steps || []).some((s) => (s.unattended_duration_seconds || 0) > 0));
  if (unattendedRecipe) {
    const sidB = await newSession(unattendedRecipe.id, null);
    const idx = unattendedRecipe.steps.findIndex((s) => (s.unattended_duration_seconds || 0) > 0);
    for (let i = 0; i < idx; i++) await post(sidB, { kind: 'step_completed', step_index: i });
    const sB = await view(sidB);
    cleanup();
    app.replaceChildren();
    cleanup = cookMod.renderCook(app, { sessionId: sidB });
    await settle();
    const tB = allText(app);
    const un = sB.step.total_seconds - sB.step.active_seconds;
    check('C9', un > 0 && /unattended/i.test(tB), `unattended interval (${un}s) on step ${sB.current_step_index + 1} is labelled as such`);
  } else {
    check('C9', false, 'NOT EXERCISED — no shipped recipe has unattended step time');
  }

  // ---- SESSION C: the continuous-attention warning ----------------------
  const caRecipe = recipeFiles.find((r) => (r.steps || []).some((s) => s.requires_continuous_attention));
  if (caRecipe) {
    const caIdx = caRecipe.steps.findIndex((s) => s.requires_continuous_attention);
    const sidC = await newSession(caRecipe.id, null);
    let sC = await view(sidC);
    for (let i = 0; i < caIdx && sC.attention_warning === null; i++) {
      const r = await post(sidC, { kind: 'step_completed', step_index: i });
      if (r.status >= 400) break;
      sC = r.body.session;
    }
    cleanup();
    app.replaceChildren();
    cleanup = cookMod.renderCook(app, { sessionId: sidC });
    await settle();
    const tC = allText(app);
    if (sC.attention_warning) {
      const secs = sC.attention_warning.uninterrupted_seconds;
      const wordNum = secs < 60 ? String(Math.round(secs)) : String(Math.round(secs / 60));
      check(
        'C10',
        /uninterrupted attention/i.test(tC) && tC.includes(wordNum),
        `attention warning on ${caRecipe.id.slice(0, 8)} step ${sC.current_step_index + 1} names the required duration (${secs}s → "${wordNum}", phase ${sC.attention_warning.phase})`,
      );
    } else {
      check('C10', false, `NOT EXERCISED — recipe ${caRecipe.id.slice(0, 8)} has a continuous-attention step at index ${caIdx} but the API produced no attention_warning`);
    }
    // The badge is a second, independent surface for the same fact.
    const sCstep = sC.step;
    check(
      'C11',
      sCstep === null || !sCstep.requires_continuous_attention || /needs full attention/i.test(tC),
      'a continuous-attention step also carries the standing "Needs full attention" badge',
    );
  } else {
    check('C10', false, 'NOT EXERCISED — no shipped recipe has a continuous-attention step');
    check('C11', false, 'NOT EXERCISED — same');
  }

  // ---- SESSION D: Invariant 2, timers from the absolute end instant -----
  const sidD = await newSession(meal0.recipe_id, meal0.plan_meal_id);
  const endsAt = new Date(Date.now() + 300_000).toISOString();
  const timerId = randomUUID();
  const tRes = await post(sidD, {
    kind: 'timer_started',
    timer: {
      id: timerId,
      step_index: 0,
      label: 'Gate timer',
      started_at_utc: new Date().toISOString(),
      ends_at_utc: endsAt,
      duration_seconds: 300,
    },
  });
  const timerLanded = tRes.status < 400 && (tRes.body?.session?.timers || []).some((t) => t.timer_id === timerId);
  check('C12', timerLanded, `a real timer with absolute ends_at_utc=${endsAt} is on the session (${tRes.status})`);

  const readClock = (root) => {
    const el = root.descendants().find((n) => String(n.getAttribute('class') || '').split(/\s+/).includes('cook-timer__clock'));
    return el ? norm(visibleText(el)) : null;
  };
  const clockSeconds = (txt) => {
    if (!txt || txt === 'Done') return 0;
    const [m, sec] = txt.split(':').map(Number);
    return m * 60 + sec;
  };

  let clock1 = null;
  let clock2 = null;
  if (timerLanded) {
    cleanup();
    app.replaceChildren();
    cleanup = cookMod.renderCook(app, { sessionId: sidD });
    await settle();
    clock1 = readClock(app);
    // Simulate a RELOAD after real wall-clock time: destroy the screen
    // entirely (all local state gone) and mount it fresh.
    await sleep(3200);
    cleanup();
    app.replaceChildren();
    cleanup = cookMod.renderCook(app, { sessionId: sidD });
    await settle();
    clock2 = readClock(app);
  }
  const delta = clock1 !== null && clock2 !== null ? clockSeconds(clock1) - clockSeconds(clock2) : null;
  check(
    'C13',
    delta !== null && delta >= 2 && delta <= 6,
    delta === null
      ? 'timer never rendered — Invariant 2 UNPROVEN'
      : `after a full remount 3.2s later the clock fell ${delta}s (${clock1} → ${clock2}) — recomputed from ends_at_utc, never restarted from a stored duration`,
  );

  // An already-expired timer reads as done and offers acknowledgement.
  await post(sidD, {
    kind: 'timer_started',
    timer: {
      id: randomUUID(),
      step_index: 0,
      label: 'Gate expired timer',
      started_at_utc: new Date(Date.now() - 120_000).toISOString(),
      ends_at_utc: new Date(Date.now() - 30_000).toISOString(),
      duration_seconds: 90,
    },
  });
  cleanup();
  app.replaceChildren();
  cleanup = cookMod.renderCook(app, { sessionId: sidD });
  await settle();
  const expiredText = allText(app);
  const ackBtn = tappables(app).find((el) => norm(visibleText(el)) === 'I heard it');
  check('C14', ackBtn !== undefined && /Done/.test(expiredText), 'an already-expired timer reads as done and offers the acknowledgement');

  // ---- SESSION E: resume-into-session recovery -------------------------
  const sidE = await newSession(meal0.recipe_id, meal0.plan_meal_id);
  await post(sidE, { kind: 'step_completed', step_index: 0 });
  const sE = await view(sidE);

  cleanup();
  app.replaceChildren();
  dom.localStorage.removeItem('tgd.cooking_session_id'); // prove load() re-sets it
  cleanup = cookMod.renderCook(app, { sessionId: sidE });
  await settle();
  const resumedText = allText(app);
  check(
    'C15',
    sE.current_step_index === 1 && resumedText.includes(`Step 2 of ${sE.total_steps}`),
    `a cold mount after progress lands on step 2 of ${sE.total_steps}, not step 1 — a reload resumes in the right place`,
  );
  check('C16', sE.step !== null && resumedText.includes(sE.step.text), "and shows THAT step's instruction, not the first step's");
  check('C17', dom.localStorage.getItem('tgd.cooking_session_id') === sidE, 'the session id is persisted on load so another screen can offer to resume');

  cleanup();
  app.replaceChildren();
  const planCleanup = planMod.renderPlan(app, {});
  await settle();
  await settle();
  const planText = allText(app);
  check(
    'C18',
    planText.includes(meal0.name) && planText.includes(`step 2 of ${sE.total_steps}`),
    `plan screen offers resume: names "${meal0.name}" at step 2 of ${sE.total_steps}`,
  );
  check('C19', tappables(app).some((el) => norm(visibleText(el)) === 'Resume cooking'), 'a "Resume cooking" control exists on the plan screen');
  if (typeof planCleanup === 'function') planCleanup();

  // ---- terminal session stops being offered ----------------------------
  await post(sidE, { kind: 'session_abandoned' });
  app.replaceChildren();
  cleanup = cookMod.renderCook(app, { sessionId: sidE });
  await settle();
  const doneText = allText(app);
  check(
    'C20',
    /stopped|complete/i.test(doneText) && dom.localStorage.getItem('tgd.cooking_session_id') === null,
    'an abandoned session shows a terminal screen and clears the stored resume id',
  );
  check(
    'C21',
    !tappables(app).some((el) => /Mark step done|Pause cooking/.test(norm(visibleText(el)))),
    'a terminal session offers no step controls',
  );
  cleanup();

  const bars = dom.document.descendants().filter((el) => String(el.getAttribute('class') || '').split(/\s+/).includes('primary-action-bar'));
  check('C22', bars.length <= 1, `at most one bottom-anchored primary action mounted at a time (found ${bars.length})`);

  console.log(`\npass ${pass} / ${pass + fail}`);
  if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  - ' + f);
  }
  await server.stop();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('GATE HARNESS ERROR:', e);
  process.exit(2);
});
