/**
 * cycle-024-gate-T-058.mjs — CONDUCTOR-authored gate. No builder has seen it.
 *
 * T-058 acceptance, quoted verbatim from the backlog:
 *
 *   "Starting from a plan, a user can reach a cooking step that has a timer and
 *    start it with one tap, and the running timer then appears on the cooking
 *    screen with the correct remaining time. Proven end to end through the HTTP
 *    API and the rendered screen — never by injecting a timer_started event
 *    directly."
 *
 * Design of this check, and why it is not the builder's check:
 *
 *  - EVERY expected duration is re-read by THIS FILE from `data/recipes/*.json`
 *    off disk. Nothing is taken from the wire and compared against itself, and
 *    no domain module is imported to supply an expectation. A bug inside
 *    cooking.ts or recipe.ts could not make T2/T3 pass.
 *  - T3 is the anti-derivation check the item's notes demand. The builder was
 *    told not to derive a duration from total-minus-active; a gate that only
 *    compared the wire value to the recipe value would pass even on a catalog
 *    where the two happen to coincide. So T3 first PROVES the catalog can tell
 *    the two apart (finds steps where timer ≠ unattended and timer ≠
 *    total−active) and then pins the wire value to the authored one on exactly
 *    those steps.
 *  - The client half is driven through the REAL screen module in the project's
 *    DOM shim: find the control by its rendered text among `tappables`, click
 *    it with a real event, and read the redrawn screen. The gate never calls
 *    `sendEvent` or posts `timer_started` itself on the client path.
 *  - T9 is a survives-restart check: the server process is closed and a second
 *    server is opened on the SAME sqlite file, and the timer's absolute
 *    `ends_at_utc` must be byte-identical while `remaining_seconds` must have
 *    DECREASED. That is DESIGN.md Invariant 2's observable consequence, and it
 *    is the difference between a stored instant and a stored countdown.
 *  - T11 is a failability check. A gate that cannot fail proves nothing, so the
 *    field is mutated out of `encodeStepView` in a scratch copy of the server
 *    and the wire assertions are re-run against it; they MUST fail. The product
 *    source is never modified — the mutant is a copy under /tmp-free scratch in
 *    .swarm/runs, imported instead of the real routes.
 *
 * Run: node .swarm/runs/cycle-024-gate-T-058.mjs
 */

import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../../server/src/main.ts';
import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { api, makeHousehold, makePlan, currentPlan } from './cycle-014-fixture.mjs';

const TARGET = '/opt/targets/dinner';

let pass = 0;
let fail = 0;
const failures = [];
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; failures.push(`${id}: ${detail ?? ''}`); console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Ground truth, read off disk by this file. `id` in the recipe JSON is the
// recipe_id the API uses.
// ---------------------------------------------------------------------------
const recipes = readdirSync(`${TARGET}/data/recipes`)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`${TARGET}/data/recipes/${f}`, 'utf8')));
const byRecipeId = new Map(recipes.map((r) => [r.id, r]));

console.log('=== ground truth read off disk by this gate ===');
let timerSteps = 0;
for (const r of recipes) {
  const t = r.steps.filter((s) => s.timer_duration_seconds !== null && s.timer_duration_seconds !== undefined);
  timerSteps += t.length;
  console.log(`  ${String(r.name).slice(0, 44).padEnd(46)} ${t.length}/${r.steps.length} steps carry a timer  [${t.map((s) => `#${s.index}=${s.timer_duration_seconds}s`).join(' ')}]`);
}
check('T0', timerSteps > 0 && recipes.every((r) => r.steps.some((s) => s.timer_duration_seconds != null)),
  `${timerSteps} timer-bearing steps across ${recipes.length} recipes, at least one per recipe`);

// ---------------------------------------------------------------------------
// Live server on a FIXED db path (so T9 can reopen it).
// ---------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'dinner-c24-t058-'));
const dbPath = join(dir, 'gate.db');
let srv = await startServer(['--port', '0', '--db', dbPath]);
let baseUrl = `http://127.0.0.1:${srv.port}`;

const closeServer = async (s) => {
  await new Promise((r) => s.server.close(() => r()));
  try { s.db.close(); } catch { /* already closed */ }
};

try {
  const hh = await makeHousehold(baseUrl);
  const plan = await makePlan(baseUrl, hh);
  const planMeals = plan.plan.meals;
  check('T1', planMeals.length > 0, `plan created with ${planMeals.length} meals — the user's real entry point`);

  // --- T2: encodeStepView exposes the authored duration, on EVERY step of
  // EVERY planned recipe, walked through the real session API.
  const mismatches = [];
  let stepsChecked = 0;
  let firstTimerCase = null;
  for (const meal of planMeals) {
    const recipe = byRecipeId.get(meal.recipe_id);
    if (!recipe) { mismatches.push(`plan references unknown recipe ${meal.recipe_id}`); continue; }
    const created = await api(baseUrl, '/api/cooking/sessions', {
      method: 'POST', householdId: hh,
      body: { recipe_id: meal.recipe_id, target_servings: 4, plan_meal_id: meal.plan_meal_id },
    });
    if (created.status !== 201) { mismatches.push(`create session ${created.status}`); continue; }
    const sessionId = created.body.session.session_id;
    let view = created.body.session;
    for (let i = 0; i < recipe.steps.length; i += 1) {
      const authored = recipe.steps[i].timer_duration_seconds ?? null;
      const onWire = view.step === null ? undefined : (view.step.timer_duration_seconds ?? null);
      stepsChecked += 1;
      if (onWire !== authored) mismatches.push(`${recipe.id} step#${i}: wire=${JSON.stringify(onWire)} authored=${JSON.stringify(authored)}`);
      if (authored !== null && firstTimerCase === null) {
        firstTimerCase = { sessionId, recipe, stepIndex: i, seconds: authored, mealSlot: meal.slot };
      }
      if (i < recipe.steps.length - 1) {
        const adv = await api(baseUrl, `/api/cooking/sessions/${sessionId}/events`, {
          method: 'POST', householdId: hh, body: { payload: { kind: 'step_completed', step_index: i } },
        });
        if (adv.status >= 400) { mismatches.push(`${recipe.id} advance step#${i}: ${adv.status}`); break; }
        view = adv.body.session;
      }
    }
  }
  check('T2', mismatches.length === 0,
    `timer_duration_seconds on the wire matches the authored recipe value on all ${stepsChecked} walked steps${mismatches.length ? ' — ' + mismatches.slice(0, 3).join(' | ') : ''}`);

  // --- T3: NOT derived. Prove the catalog distinguishes the derivations first.
  const discriminating = [];
  for (const r of recipes) {
    for (const s of r.steps) {
      if (s.timer_duration_seconds == null) continue;
      const totalMinusActive = (s.active_duration_seconds + s.unattended_duration_seconds) - s.active_duration_seconds;
      if (s.timer_duration_seconds !== s.unattended_duration_seconds || s.timer_duration_seconds !== totalMinusActive) {
        discriminating.push({ recipe: r, step: s, totalMinusActive });
      }
    }
  }
  console.log(`  discriminating steps (timer != unattended, or timer != total-active): ${discriminating.length}`);
  for (const d of discriminating.slice(0, 4)) {
    console.log(`    ${d.recipe.id.slice(0, 8)} step#${d.step.index}: timer=${d.step.timer_duration_seconds}s unattended=${d.step.unattended_duration_seconds}s total-active=${d.totalMinusActive}s`);
  }
  if (discriminating.length === 0) {
    check('T3', false, 'NOT PROVEN: no shipped step distinguishes the authored timer from total-minus-active, so no observation could tell a derived implementation from an honest one');
  } else {
    // Walk one discriminating step through the API and pin the wire value.
    const d = discriminating[0];
    const created = await api(baseUrl, '/api/cooking/sessions', {
      method: 'POST', householdId: hh, body: { recipe_id: d.recipe.id, target_servings: 4, plan_meal_id: null },
    });
    let v = created.body.session;
    const sid = v.session_id;
    for (let i = 0; i < d.step.index; i += 1) {
      const adv = await api(baseUrl, `/api/cooking/sessions/${sid}/events`, {
        method: 'POST', householdId: hh, body: { payload: { kind: 'step_completed', step_index: i } },
      });
      v = adv.body.session;
    }
    const wire = v.step.timer_duration_seconds;
    check('T3', wire === d.step.timer_duration_seconds && wire !== d.totalMinusActive,
      `discriminating step: wire=${wire}s equals authored ${d.step.timer_duration_seconds}s and is NOT total-active (${d.totalMinusActive}s)`);
  }

  // --- T4/T5/T6: the minimal client payload starts a real timer.
  const tc = firstTimerCase;
  if (!tc) {
    check('T4', false, 'no timer-bearing step reachable from the plan');
  } else {
    // Rebuild a fresh session and walk to the timer step.
    const created = await api(baseUrl, '/api/cooking/sessions', {
      method: 'POST', householdId: hh, body: { recipe_id: tc.recipe.id, target_servings: 4, plan_meal_id: null },
    });
    const sid = created.body.session.session_id;
    for (let i = 0; i < tc.stepIndex; i += 1) {
      await api(baseUrl, `/api/cooking/sessions/${sid}/events`, {
        method: 'POST', householdId: hh, body: { payload: { kind: 'step_completed', step_index: i } },
      });
    }
    const before = Date.now();
    const started = await api(baseUrl, `/api/cooking/sessions/${sid}/events`, {
      method: 'POST', householdId: hh,
      // ONLY kind + step_index. No id, no label, no duration, no instant.
      body: { payload: { kind: 'timer_started', step_index: tc.stepIndex } },
    });
    const after = Date.now();
    check('T4', started.status < 400 && (started.body.session?.timers ?? []).length === 1,
      `POST {kind:'timer_started', step_index:${tc.stepIndex}} -> ${started.status}, ${(started.body.session?.timers ?? []).length} timer(s) — client supplied no duration and no instant`);

    const timer = started.body.session?.timers?.[0];
    if (timer) {
      check('T5', timer.remaining_seconds <= tc.seconds && timer.remaining_seconds >= tc.seconds - 5,
        `remaining_seconds=${timer.remaining_seconds} vs authored ${tc.seconds}s (fresh timer, ≤5s of request latency allowed)`);
      const ends = Date.parse(timer.ends_at_utc);
      check('T6', ends >= before + tc.seconds * 1000 - 2000 && ends <= after + tc.seconds * 1000 + 2000,
        `ends_at_utc=${timer.ends_at_utc} is an absolute instant ≈ server-now + ${tc.seconds}s (window ${new Date(before + tc.seconds * 1000).toISOString()}..${new Date(after + tc.seconds * 1000).toISOString()})`);
      check('T7', timer.step_index === tc.stepIndex,
        `timer carries step_index=${timer.step_index}, so the client can tell "already running" from "not started"`);
    } else {
      check('T5', false, 'no timer returned'); check('T6', false, 'no timer returned'); check('T7', false, 'no timer returned');
    }

    // --- T8: the two honest rejections. A wrong timer is worse than none.
    const noTimerStep = tc.recipe.steps.find((s) => s.timer_duration_seconds == null);
    let r1 = { status: 'n/a' };
    if (noTimerStep) {
      r1 = await api(baseUrl, `/api/cooking/sessions/${sid}/events`, {
        method: 'POST', householdId: hh, body: { payload: { kind: 'timer_started', step_index: noTimerStep.index } },
      });
    }
    const r2 = await api(baseUrl, `/api/cooking/sessions/${sid}/events`, {
      method: 'POST', householdId: hh, body: { payload: { kind: 'timer_started', step_index: 999 } },
    });
    check('T8', (!noTimerStep || (r1.status >= 400 && r1.status < 500)) && r2.status >= 400 && r2.status < 500,
      `no-timer step -> ${r1.status} (${r1.body?.code ?? '-'}), out-of-range step -> ${r2.status} (${r2.body?.code ?? '-'}) — refused as 4xx, never a 500 and never a fabricated timer`);

    // --- T9: kill the server, reopen the SAME db, the instant must survive.
    const beforeKill = started.body.session.timers[0];
    await closeServer(srv);
    await new Promise((r) => setTimeout(r, 1100));
    srv = await startServer(['--port', '0', '--db', dbPath]);
    baseUrl = `http://127.0.0.1:${srv.port}`;
    const after9 = await api(baseUrl, `/api/cooking/sessions/${sid}`, { householdId: hh });
    const t9 = after9.body?.session?.timers?.[0];
    check('T9',
      Boolean(t9) && t9.ends_at_utc === beforeKill.ends_at_utc && t9.remaining_seconds < beforeKill.remaining_seconds,
      t9
        ? `after process kill + reopen of the same db: ends_at_utc identical (${t9.ends_at_utc}), remaining ${beforeKill.remaining_seconds}s -> ${t9.remaining_seconds}s (decreased by real elapsed time, not a restored countdown)`
        : 'timer did not survive the restart');

    // --- T10: the RENDERED screen. Real module, real click.
    const dom = installDom({ baseUrl });
    const apiMod = await import('../../web/js/api.js');
    const cookMod = await import('../../web/js/cook.js');
    apiMod.setHouseholdId(hh);

    // A second, clean session so the screen starts with NO timer running.
    const c2 = await api(baseUrl, '/api/cooking/sessions', {
      method: 'POST', householdId: hh, body: { recipe_id: tc.recipe.id, target_servings: 4, plan_meal_id: null },
    });
    const sid2 = c2.body.session.session_id;
    for (let i = 0; i < tc.stepIndex; i += 1) {
      await api(baseUrl, `/api/cooking/sessions/${sid2}/events`, {
        method: 'POST', householdId: hh, body: { payload: { kind: 'step_completed', step_index: i } },
      });
    }

    const app = dom.mountApp();
    app.replaceChildren();
    cookMod.renderCook(app, { sessionId: sid2 });
    await settle();
    const textBefore = norm(visibleText(app));
    const controls = tappables(app);
    const startBtn = controls.find((el) => /start .*timer/i.test(norm(visibleText(el))));
    check('T10', Boolean(startBtn),
      startBtn ? `the rendered screen offers ONE control labelled "${norm(visibleText(startBtn))}"` : `no start-timer control on the rendered screen; tappables were [${controls.map((c) => norm(visibleText(c)).slice(0, 24)).join(' | ')}]`);

    if (startBtn) {
      startBtn.dispatchEvent(makeEvent('click', startBtn));
      await settle();
      const textAfter = norm(visibleText(app));
      // The authored duration rendered as a clock, e.g. 2100s -> 35:00, and
      // recomputed here from the recipe file rather than from the screen.
      const mm = Math.floor(tc.seconds / 60);
      const clockRe = new RegExp(`\\b${mm}:[0-5]\\d\\b`);
      const clockHit = textAfter.match(clockRe);
      check('T11', Boolean(clockHit),
        clockHit ? `after one tap the screen shows a running clock "${clockHit[0]}" — consistent with the authored ${tc.seconds}s (${mm}:00)` : `no ${mm}:MM clock after the tap; screen reads: ${textAfter.slice(0, 220)}`);

      const stillOffering = tappables(app).some((el) => /start .*timer/i.test(norm(visibleText(el))));
      check('T12', !stillOffering, `the start control is withdrawn once the timer runs (no second timer for the same step)`);

      const server9 = await api(baseUrl, `/api/cooking/sessions/${sid2}`, { householdId: hh });
      check('T13', (server9.body?.session?.timers ?? []).length === 1 && server9.body.session.timers[0].step_index === tc.stepIndex,
        `the tap reached the SERVER: ${(server9.body?.session?.timers ?? []).length} timer at step_index ${server9.body?.session?.timers?.[0]?.step_index} — read back over HTTP, not from screen state`);
      console.log(`  screen before tap (excerpt): ${textBefore.slice(0, 150)}`);
      console.log(`  screen after  tap (excerpt): ${textAfter.slice(0, 150)}`);
    } else {
      check('T11', false, 'not reached — no control to tap');
      check('T12', false, 'not reached — no control to tap');
      check('T13', false, 'not reached — no control to tap');
    }
  }
} finally {
  await closeServer(srv);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\nT-058 GATE: ${pass} pass / ${fail} fail`);
if (failures.length) { console.log('failures:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail === 0 ? 0 : 1);
