/**
 * cycle-015-gate.mjs — CONDUCTOR-authored verification gate for cycle 15's wave.
 *
 * Items under test: T-019 (interruption-aware cooking mode) and T-052
 * (grocery purchase-quantity formatting).
 *
 * AUTHORED AFTER the code was frozen and salvage-committed (5622810). Neither
 * builder could have seen this file. It is deliberately NOT a copy of
 * cycle-014-gate-rev2.mjs's R21: T-052's acceptance names that check, so the
 * unaltered rev2 file is run SEPARATELY and verbatim; the T-052 checks here are
 * strictly stronger and differently shaped (every call site, a different
 * household, and an underbuy/overbuy direction test rev2 never had), so a fix
 * tuned to R21's regex alone would fail here.
 *
 * Every expected value is DERIVED from the live API at run time. Nothing is
 * hardcoded except the two honesty sentences the product itself must not
 * paraphrase.
 *
 * Run: node .swarm/runs/cycle-015-gate.mjs
 */

import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { boot, makeHousehold, makePlan, currentPlan, grocery, api } from './cycle-014-fixture.mjs';
import { randomUUID } from 'node:crypto';

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

/** domain/src/reasons.ts NO_RECOVERY_GUIDANCE_TEXT — the ONE honest fallback. */
const NO_RECOVERY = 'No recovery guidance for this step.';

/**
 * A "shoppable number": digits, optionally a decimal point with at most three
 * places. Anything with a slash, or a longer decimal tail, is not a number a
 * parent can act on at a shelf.
 */
const SHOPPABLE = /^\d+(\.\d{1,3})?$/;

async function main() {
  const server = await boot();
  const { baseUrl } = server;
  const dom = installDom({ baseUrl });

  // The shim has no window.setInterval — cook.js's timer tick needs one.
  // Adding a genuinely-standard browser API the real product has is not a
  // relaxation of this gate; without it the timer path could not run at all.
  dom.window.setInterval = (fn, ms) => setInterval(fn, ms);
  dom.window.clearInterval = (id) => clearInterval(id);

  const cookMod = await import('../../web/js/cook.js');
  const planMod = await import('../../web/js/plan.js');
  const groceryMod = await import('../../web/js/grocery.js');
  const apiMod = await import('../../web/js/api.js');
  const routerMod = await import('../../web/js/router.js');

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

  // --- G1: no raw rational anywhere on the ledger surface ---------------
  const rawFractions = listText.match(/\b\d+\/\d{3,}\b/g) || [];
  check(
    'G1',
    rawFractions.length === 0,
    `no raw rational on the list surface${rawFractions.length ? ` — found ${rawFractions.length}: ${rawFractions.slice(0, 4).join(', ')}` : ''}`,
  );

  // --- G2/G3/G4: every LINE amount, checked against its exact value ------
  // Read the rendered amount per line from the DOM (the `.grocery-line__qty`
  // node), so this is what the parent sees, not a re-derivation.
  const qtyNodes = app.descendants().filter((el) => String(el.getAttribute('class') || '').includes('grocery-line__qty'));
  const shapeFails = [];
  const underbuys = [];
  const falseZeros = [];
  const wayOff = [];
  for (const line of liveLines) {
    const exactQ = line.user_edited_quantity || line.purchase_quantity;
    const exact = ratNum(exactQ);
    const node = qtyNodes.find((n) => {
      const p = n.parentNode;
      return p && norm(visibleText(p)).includes(line.display_name);
    });
    const shownRaw = node ? norm(visibleText(node)).split(/\s+/)[0] : null;
    if (shownRaw === null) {
      shapeFails.push(`${line.display_name}: no rendered amount found`);
      continue;
    }
    if (!SHOPPABLE.test(shownRaw)) {
      shapeFails.push(`${line.display_name}: "${shownRaw}"`);
      continue;
    }
    const shown = Number(shownRaw);
    if (exact > 0 && shown < exact) underbuys.push(`${line.display_name}: shows ${shown}, needs ${exact.toFixed(4)}`);
    if (exact > 0 && shown === 0) falseZeros.push(`${line.display_name}: exact ${exact.toFixed(6)} shown as 0`);
    // A display rounding may never move an amount by a whole unit or more
    // (count is finer-grained, so allow a tenth there).
    const tol = line.unit === 'count' ? 0.1001 : 1.0001;
    if (Math.abs(shown - exact) > tol) wayOff.push(`${line.display_name}: shows ${shown}, exact ${exact.toFixed(4)} (${line.unit})`);
  }
  check('G2', shapeFails.length === 0, `all ${liveLines.length} line amounts are shoppable numbers${shapeFails.length ? ` — ${shapeFails.slice(0, 4).join('; ')}` : ''}`);
  check('G3', underbuys.length === 0, `display rounding never UNDERBUYS${underbuys.length ? ` — ${underbuys.slice(0, 4).join('; ')}` : ''}`);
  check('G4', falseZeros.length === 0, `no nonzero amount displays as "0"${falseZeros.length ? ` — ${falseZeros.slice(0, 3).join('; ')}` : ''}`);
  check('G5', wayOff.length === 0, `every shown amount is within one unit of the exact value — not a fabricated constant${wayOff.length ? ` — ${wayOff.slice(0, 4).join('; ')}` : ''}`);

  // --- G6/G7: the OTHER call sites — drawer contributions, deducted,
  // surplus, the edit-sheet input value and the reset-to-suggested label.
  // rev2's R21 only ever read the closed list, so a fix that touched only
  // buildLineRow would pass R21 and fail here.
  const drawerToggle = tappables(app).find((el) => {
    const t = norm(visibleText(el));
    return /why|breakdown|provenance|where|from/i.test(t) || String(el.getAttribute('class') || '').includes('drawer');
  });
  let drawerText = '';
  if (drawerToggle) {
    drawerToggle.dispatchEvent(makeEvent('click', drawerToggle));
    await settle();
    drawerText = allText(app);
  }
  const drawerFractions = (drawerText.match(/\b\d+\/\d{3,}\b/g) || []).slice(0, 4);
  check(
    'G6',
    drawerToggle !== undefined && drawerFractions.length === 0,
    drawerToggle === undefined
      ? 'no provenance drawer control found to open — call site UNTESTED'
      : `provenance drawer amounts carry no raw rationals${drawerFractions.length ? ` — ${drawerFractions.join(', ')}` : ''}`,
  );

  const editInput = app.descendants().find((el) => el.tagName === 'INPUT' && String(el.getAttribute('aria-label') || '').startsWith('Amount of'));
  const inputVal = editInput ? String(editInput.value ?? '') : null;
  check(
    'G7',
    editInput !== undefined && inputVal !== null && SHOPPABLE.test(inputVal),
    editInput === undefined ? 'no edit input rendered — call site UNTESTED' : `edit-sheet input prefills a shoppable number ("${inputVal}")`,
  );

  const resetBtn = tappables(app).find((el) => norm(visibleText(el)).startsWith('Reset to suggested'));
  const resetText = resetBtn ? norm(visibleText(resetBtn)) : '';
  check(
    'G8',
    resetBtn === undefined || !/\d+\/\d{3,}/.test(resetText),
    resetBtn === undefined ? 'no reset control on this line (not user-edited) — n/a' : `reset label is shoppable: "${resetText}"`,
  );

  // =======================================================================
  // T-019 — interruption-aware cooking mode
  // =======================================================================
  console.log('\n=== T-019 cooking mode ===');

  // Route wiring, read from the router's own table via its behaviour.
  check('C0', typeof cookMod.renderCook === 'function', 'cook.js exports renderCook');

  // Start a real session on the first planned meal, exactly as plan.js does.
  const meal0 = livePlan.meals[0];
  const created = await api(baseUrl, '/api/cooking/sessions', {
    method: 'POST',
    householdId: hh,
    body: { plan_meal_id: meal0.plan_meal_id, recipe_id: meal0.recipe_id, target_servings: 3 },
  });
  check('C1', created.status === 201 && created.body?.session?.session_id, `session created for "${meal0.name}" (${created.status})`);
  const sessionId = created.body.session.session_id;

  const liveSession = () => api(baseUrl, `/api/cooking/sessions/${sessionId}`, { householdId: hh }).then((r) => r.body.session);

  // --- first mount ------------------------------------------------------
  let s = await liveSession();
  app.replaceChildren();
  let cleanup = cookMod.renderCook(app, { sessionId });
  await settle();
  let cookText = allText(app);

  check('C2', cookText.length > 150, `cooking screen renders (${cookText.length} chars)`);
  check('C3', cookText.includes(s.step.text), 'the step instruction is shown VERBATIM from the API — never re-worded');
  check(
    'C4',
    cookText.includes(`Step ${s.current_step_index + 1} of ${s.total_steps}`),
    `title states position from the API: "Step ${s.current_step_index + 1} of ${s.total_steps}"`,
  );

  // --- active vs unattended, labelled separately (acceptance clause) -----
  const totalMin = Math.round(s.step.total_seconds / 60);
  const activeMin = Math.round(s.step.active_seconds / 60);
  const unattendedS = s.step.total_seconds - s.step.active_seconds;
  const bothShown = cookText.includes(String(totalMin)) && cookText.includes(String(activeMin));
  const unattendedShown = unattendedS <= 0 || /unattended/i.test(cookText);
  check('C5', bothShown, `step time carries BOTH total (${totalMin}m) and active (${activeMin}m)`);
  check(
    'C6',
    unattendedShown,
    unattendedS > 0 ? `unattended interval (${unattendedS}s) is labelled as such` : 'step has no unattended time — clause n/a for this step',
  );

  // --- next safe stop always visible, derived from the API --------------
  const stop = s.next_safe_stop;
  const stopShown =
    stop.kind === 'end_of_recipe'
      ? /no further safe stopping point/i.test(cookText)
      : cookText.includes(`step ${stop.step_index + 1}`) && /safe to stop|next safe stop/i.test(cookText);
  check('C7', stopShown, `next safe stopping point rendered from API kind="${stop.kind}"${stop.step_index !== undefined ? ` step_index=${stop.step_index}` : ''}`);
  if (stop.kind !== 'end_of_recipe' && stop.maximum_pause) {
    const mp = stop.maximum_pause;
    const pauseShown =
      mp.kind === 'unlimited'
        ? /no time limit on the pause/i.test(cookText)
        : cookText.includes(String(mp.seconds < 60 ? Math.round(mp.seconds) : Math.round(mp.seconds / 60)));
    check('C8', pauseShown, `maximum pause rendered from API (${mp.kind}${mp.kind === 'bounded' ? ` ${mp.seconds}s` : ''})`);
  } else {
    check('C8', true, 'no maximum_pause on this stop — clause n/a');
  }

  // --- recovery guidance: verbatim, or the ONE honest fallback ----------
  check(
    'C9',
    cookText.includes(s.recovery_text),
    `recovery text shown verbatim from API: "${s.recovery_text.slice(0, 60)}${s.recovery_text.length > 60 ? '…' : ''}"`,
  );
  const fabricationRisk = s.recovery_text === NO_RECOVERY && /you can|try to|it should be fine|just /i.test(cookText.split('If you get pulled away')[1] || '');
  check('C10', !fabricationRisk, 'no invented cooking advice alongside the no-guidance fallback (Invariant 6)');

  // --- continuous-attention warning, with the required duration ---------
  if (s.attention_warning) {
    const w = s.attention_warning;
    const secs = w.uninterrupted_seconds;
    const wordNum = secs < 60 ? String(Math.round(secs)) : String(Math.round(secs / 60));
    check(
      'C11',
      /uninterrupted attention/i.test(cookText) && cookText.includes(wordNum),
      `attention warning names the required duration (${secs}s → "${wordNum}")`,
    );
  } else {
    // Drive the session forward until the API produces one, so the clause is
    // actually EXERCISED rather than skipped.
    let found = null;
    let probe = s;
    for (let i = 0; i < probe.total_steps && found === null; i++) {
      const r = await api(baseUrl, `/api/cooking/sessions/${sessionId}/events`, {
        method: 'POST',
        householdId: hh,
        body: { payload: { kind: 'step_completed', step_index: i } },
      });
      if (r.status >= 400) break;
      probe = r.body.session;
      if (probe.attention_warning) found = probe;
    }
    if (found) {
      app.replaceChildren();
      cleanup();
      cleanup = cookMod.renderCook(app, { sessionId });
      await settle();
      const t = allText(app);
      const secs = found.attention_warning.uninterrupted_seconds;
      const wordNum = secs < 60 ? String(Math.round(secs)) : String(Math.round(secs / 60));
      check('C11', /uninterrupted attention/i.test(t) && t.includes(wordNum), `attention warning exercised at step ${found.current_step_index}: names ${secs}s → "${wordNum}"`);
    } else {
      check('C11', false, 'NOT EXERCISED — no step of this recipe produced an attention_warning; clause unproven');
    }
  }

  // =======================================================================
  // Invariant 2 — timers derived from the absolute end instant, never a
  // local countdown. THE decisive check for this item.
  // =======================================================================
  const endsAt = new Date(Date.now() + 300_000).toISOString();
  const timerId = randomUUID();
  const nowIso = new Date().toISOString();
  const cur = await liveSession();
  const tRes = await api(baseUrl, `/api/cooking/sessions/${sessionId}/events`, {
    method: 'POST',
    householdId: hh,
    body: {
      payload: {
        kind: 'timer_started',
        timer: {
          id: timerId,
          step_index: cur.current_step_index,
          label: 'Gate timer',
          started_at_utc: nowIso,
          ends_at_utc: endsAt,
          duration_seconds: 300,
        },
      },
    },
  });
  const timerLanded = tRes.status < 400 && (tRes.body?.session?.timers || []).some((t) => t.timer_id === timerId);
  check('C12', timerLanded, `a real timer with absolute ends_at_utc=${endsAt} is on the session (${tRes.status})`);

  function readClock(root) {
    const el = root.descendants().find((n) => String(n.getAttribute('class') || '').includes('cook-timer__clock'));
    return el ? norm(visibleText(el)) : null;
  }
  const clockSeconds = (txt) => {
    if (!txt || txt === 'Done') return 0;
    const [m, sec] = txt.split(':').map(Number);
    return m * 60 + sec;
  };

  let clock1 = null;
  let clock2 = null;
  if (timerLanded) {
    app.replaceChildren();
    cleanup();
    cleanup = cookMod.renderCook(app, { sessionId });
    await settle();
    clock1 = readClock(app);

    // Simulate a RELOAD after real wall-clock time: destroy the screen
    // completely (all local state gone) and mount it fresh.
    await sleep(3200);
    cleanup();
    app.replaceChildren();
    cleanup = cookMod.renderCook(app, { sessionId });
    await settle();
    clock2 = readClock(app);
  }
  const d = clock1 !== null && clock2 !== null ? clockSeconds(clock1) - clockSeconds(clock2) : null;
  check(
    'C13',
    d !== null && d >= 2 && d <= 6,
    d === null
      ? 'timer never rendered — Invariant 2 UNPROVEN'
      : `after a full remount 3.2s later the clock fell ${d}s (${clock1} → ${clock2}) — recomputed from ends_at_utc, not restarted from a stored duration`,
  );

  // Expired timer renders as expired with an acknowledgement affordance.
  const expiredId = randomUUID();
  const cur2 = await liveSession();
  await api(baseUrl, `/api/cooking/sessions/${sessionId}/events`, {
    method: 'POST',
    householdId: hh,
    body: {
      payload: {
        kind: 'timer_started',
        timer: {
          id: expiredId,
          step_index: cur2.current_step_index,
          label: 'Gate expired timer',
          started_at_utc: new Date(Date.now() - 120_000).toISOString(),
          ends_at_utc: new Date(Date.now() - 30_000).toISOString(),
          duration_seconds: 90,
        },
      },
    },
  });
  cleanup();
  app.replaceChildren();
  cleanup = cookMod.renderCook(app, { sessionId });
  await settle();
  const expiredText = allText(app);
  const ackBtn = tappables(app).find((el) => norm(visibleText(el)) === 'I heard it');
  check('C14', ackBtn !== undefined && /Done/.test(expiredText), 'an already-expired timer reads as done and offers the acknowledgement');

  // =======================================================================
  // Resume-into-session recovery
  // =======================================================================
  const beforeAdvance = await liveSession();
  const targetIdx = beforeAdvance.current_step_index;
  await api(baseUrl, `/api/cooking/sessions/${sessionId}/events`, {
    method: 'POST',
    householdId: hh,
    body: { payload: { kind: 'step_completed', step_index: targetIdx } },
  });
  const advanced = await liveSession();

  cleanup();
  app.replaceChildren();
  dom.localStorage.removeItem('tgd.cooking_session_id'); // prove the KEY is re-set by load(), not left over
  cleanup = cookMod.renderCook(app, { sessionId });
  await settle();
  const resumedText = allText(app);
  check(
    'C15',
    advanced.current_step_index === targetIdx + 1 && resumedText.includes(`Step ${advanced.current_step_index + 1} of ${advanced.total_steps}`),
    `a cold mount after progress lands on step ${advanced.current_step_index + 1}, not step 1 — reload resumes at the right place`,
  );
  check('C16', resumedText.includes(advanced.step.text), 'and shows THAT step\'s instruction, not the first step\'s');
  check(
    'C17',
    dom.localStorage.getItem('tgd.cooking_session_id') === sessionId,
    'the session id is persisted on load so another screen can offer to resume',
  );

  // The plan screen must then offer the resume affordance, naming the meal
  // and the CURRENT step — derived from the API, not from a cached guess.
  app.replaceChildren();
  cleanup();
  const planCleanup = planMod.renderPlan(app, {});
  await settle();
  await settle();
  const planText = allText(app);
  check(
    'C18',
    planText.includes(meal0.name) && planText.includes(`step ${advanced.current_step_index + 1} of ${advanced.total_steps}`),
    `plan screen offers resume: names "${meal0.name}" at step ${advanced.current_step_index + 1} of ${advanced.total_steps}`,
  );
  const resumeBtn = tappables(app).find((el) => norm(visibleText(el)) === 'Resume cooking');
  check('C19', resumeBtn !== undefined, 'a "Resume cooking" control exists on the plan screen');
  if (typeof planCleanup === 'function') planCleanup();

  // A terminal session must stop being offered and must clear its key.
  await api(baseUrl, `/api/cooking/sessions/${sessionId}/events`, {
    method: 'POST',
    householdId: hh,
    body: { payload: { kind: 'session_abandoned' } },
  });
  app.replaceChildren();
  cleanup = cookMod.renderCook(app, { sessionId });
  await settle();
  const doneText = allText(app);
  check(
    'C20',
    /stopped|complete/i.test(doneText) && dom.localStorage.getItem('tgd.cooking_session_id') === null,
    'an abandoned session shows a terminal screen and clears the stored resume id',
  );
  const stillHasStepControls = tappables(app).some((el) => /Mark step done|Pause cooking/.test(norm(visibleText(el))));
  check('C21', !stillHasStepControls, 'a terminal session offers no step controls');
  cleanup();

  // --- one dominant action per screen (taste rule, DESIGN.md) -----------
  const primaryBars = dom.document.descendants().filter((el) => String(el.getAttribute('class') || '').includes('primary-action'));
  check('C22', primaryBars.length <= 1, `at most one bottom-anchored primary action mounted at a time (found ${primaryBars.length})`);

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
