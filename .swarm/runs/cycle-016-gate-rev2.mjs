/**
 * cycle-016-gate.mjs — CONDUCTOR-authored verification gate for T-018
 * (two-tap post-meal feedback screen).
 *
 * Authored AFTER the builder's code was frozen and salvage-committed
 * (cd401d5). The builder never saw this file and was never told what it
 * checks. Expected values are derived from the live API and the live sqlite
 * file at run time — nothing is hard-coded to the implementation.
 *
 * The evidence standard here is SERVER-SIDE GROUND TRUTH, not the client's
 * own story: every "was it recorded?" check reads the `feedback` and
 * `preference_signals` tables out of the running server's sqlite file with a
 * second, read-only connection. A screen that renders "Saved" while writing
 * nothing fails. A screen that writes twice fails too — the duplicate-write
 * hazard the builder documented is exactly the kind of claim a gate must
 * test rather than accept.
 *
 * WHY REV2 EXISTS — rev1 (`cycle-016-gate.mjs`, preserved unmodified beside
 * this file with its output at `cycle-016-verify-rev1-CRASHED.txt`) crashed
 * after F5 with `TypeError: Cannot read properties of undefined (reading
 * 'deref')` inside undici's `onParserTimeout`. That is a fault in MY harness,
 * not in the product: `domshim.mjs` overwrites `globalThis.setTimeout` with
 * `(fn, ms) => realSetTimeout(fn, ms)`, which SILENTLY DROPS every argument
 * after the delay. Node's HTTP client schedules `setTimeout(onParserTimeout,
 * ms, weakRef)` — a three-argument call — so its callback fired with
 * `weakRef` undefined. Earlier gates never tripped it because none of them
 * sat idle long enough for a keep-alive parser timeout to fire; rev1's
 * deliberate 4-second "user puts the phone down" wait is the first that does.
 * Rev2 restores a variadic `globalThis.setTimeout` immediately after
 * `installDom` and leaves `window.setTimeout` (all the product ever calls,
 * always with two arguments) exactly as the shim defines it. No check was
 * weakened, removed or retimed — the fix is one line of plumbing.
 *
 * Run: node .swarm/runs/cycle-016-gate-rev2.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { installDom, visibleText, tappables, settle, makeEvent } from './domshim.mjs';
import { api, makeHousehold, makePlan, currentPlan, DEFAULT_HOUSEHOLD, DEFAULT_MEMBER } from './cycle-014-fixture.mjs';
import { startServer } from '../../server/src/main.ts';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

/**
 * Boot the REAL server entrypoint but keep the db path, so this gate can read
 * the same file the server writes. The shipped fixture hides it.
 */
async function bootWithDb() {
  const dir = mkdtempSync(join(tmpdir(), 'dinner-gate-c16-'));
  const dbPath = join(dir, 'gate.db');
  const started = await startServer(['--port', '0', '--db', dbPath]);
  return {
    baseUrl: `http://127.0.0.1:${started.port}`,
    dbPath,
    async stop() {
      try {
        await new Promise((resolve) => started.server.close(() => resolve()));
        started.db.close();
      } catch {
        /* already down */
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

/** Every feedback row the SERVER actually holds for one plan meal. */
function feedbackRows(dbPath, planMealId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare('SELECT plan_meal_id, recipe_id, verdict, reason FROM feedback WHERE plan_meal_id = ?')
      .all(planMealId);
  } finally {
    db.close();
  }
}

/** A comparable snapshot of one household's attribute-level preference signals. */
function signalSnapshot(dbPath, householdId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT attribute, attribute_value, value_num, value_den, confidence_num, confidence_den, source
           FROM preference_signals WHERE household_id = ?
          ORDER BY attribute, attribute_value`,
      )
      .all(householdId);
    return rows.map((r) => JSON.stringify(r));
  } finally {
    db.close();
  }
}

const gate = await bootWithDb();
const { baseUrl, dbPath } = gate;

// Captured BEFORE the shim overwrites them (see REV2 note in the header).
const REAL_SET_TIMEOUT = globalThis.setTimeout;
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout;

const dom = installDom({ baseUrl });
// Node's own HTTP client lives on the real, variadic timers. The shim's
// two-argument replacement breaks it; the product only ever calls
// `window.setTimeout(fn, ms)`, which the shim still owns, untouched.
globalThis.setTimeout = REAL_SET_TIMEOUT;
globalThis.clearTimeout = REAL_CLEAR_TIMEOUT;

const app = dom.mountApp();
const win = dom.window;

// Route by doing what a browser does: set the hash, fire hashchange. Never by
// calling a screen's render() directly — this gate is also testing that the
// route table actually points at the new screen.
async function goto(path) {
  win.location.hash = `#${path}`;
  win.dispatchEvent(makeEvent('hashchange', null));
  await settle();
}

/** All text the user can read, INCLUDING the body-mounted action bars. */
const screenText = () => norm(visibleText(dom.document.body));
/** Every tappable on screen, including the body-mounted grids/bars. */
const buttons = () => tappables(dom.document.body).filter((el) => el.tagName === 'BUTTON');
const buttonLabelled = (re) => buttons().find((b) => re.test(norm(visibleText(b))));

const apiMod = await import('../../web/js/api.js');

// The route table must be loaded through the app's real entry module.
win.location.hash = '#/plan';
await import('../../web/js/router.js');
await settle();

try {
  // =========================================================================
  // PHASE A — one tap, nothing else: is it really recorded?
  // =========================================================================
  const hhA = await makeHousehold(baseUrl);
  apiMod.setHouseholdId(hhA);
  apiMod.markCalibrationComplete();
  await makePlan(baseUrl, hhA);
  const planA = (await currentPlan(baseUrl, hhA)).body.plan;
  const mealA = planA.meals[0];

  const signalsBefore = signalSnapshot(dbPath, hhA);

  await goto(`/feedback/${mealA.plan_meal_id}`);
  const textA0 = screenText();

  check(
    'F1',
    !/isn't built yet|is not a route/i.test(textA0),
    `#/feedback/:planMealId resolves to a real screen, not the placeholder`,
  );
  check(
    'F2',
    textA0.includes(mealA.name),
    `screen names the actual meal from the API ("${mealA.name.slice(0, 40)}")`,
  );

  const verdictButtons = buttons().filter((b) => b.getAttribute('class') === 'reaction-btn');
  check('F3', verdictButtons.length === 3, `exactly 3 verdict choices offered (found ${verdictButtons.length})`);
  check(
    'F4',
    verdictButtons.every((b) => b.tagName === 'BUTTON' && b.disabled !== true),
    'verdict choices are real, enabled <button> elements — keyboard reachable, not click-only divs',
  );

  // THE tap. One. Then the phone goes down: no Done, no reason, no navigation.
  const makeAgainBtn = verdictButtons.find((b) => /make this again/i.test(norm(visibleText(b))));
  check('F5', Boolean(makeAgainBtn), 'a "make again"-shaped choice exists');
  makeAgainBtn.dispatchEvent(makeEvent('click', makeAgainBtn));
  await settle();

  const rowsImmediately = feedbackRows(dbPath, mealA.plan_meal_id);
  const textAfterTap = screenText();

  await sleep(4000); // longer than any safety net a screen could reasonably use
  await settle();

  const rowsA = feedbackRows(dbPath, mealA.plan_meal_id);
  check(
    'F6',
    rowsA.length === 1,
    `ONE tap and nothing else -> exactly 1 feedback row on the SERVER (found ${rowsA.length}${
      rowsImmediately.length === 0 ? '; deferred, arrived within 4s of the tap' : '; written on the tap itself'
    })`,
  );
  check('F7', rowsA[0]?.verdict === 'make_again', `stored verdict is the enum value for the tapped label ("${rowsA[0]?.verdict}")`);
  check('F8', rowsA[0]?.reason === null, `no reason invented when the user never chose one (reason=${JSON.stringify(rowsA[0]?.reason)})`);
  check(
    'F9',
    rowsA[0]?.recipe_id === mealA.recipe_id,
    'stored recipe_id matches the plan meal the URL pointed at — resolved, not guessed',
  );

  const signalsAfter = signalSnapshot(dbPath, hhA);
  const changed = signalsAfter.filter((s) => !signalsBefore.includes(s)).length;
  check(
    'F10',
    changed > 0,
    `the verdict moved ${changed} attribute-level preference signal rows in the DB (before ${signalsBefore.length} rows, after ${signalsAfter.length})`,
  );

  check(
    'F11',
    /recorded|saved/i.test(textAfterTap),
    'the user is told it is recorded on the tap itself, not left guessing',
  );
  check(
    'F12',
    Boolean(buttonLabelled(/done|back to plan/i)),
    'after one tap there is a visible way to be finished — the reason is never a gate',
  );

  // Engagement mechanics are a SPEC non-goal. Scan everything the screen said.
  const banned = /streak|badge|points|score|on a roll|keep it up|in a row|\bxp\b|level up/i;
  check('F13', !banned.test(textA0 + ' ' + textAfterTap), 'no streaks, scores, badges or engagement mechanics in the copy');

  // Re-visiting must not double-write (the builder's own documented hazard).
  await goto('/plan');
  await goto(`/feedback/${mealA.plan_meal_id}`);
  const textRevisit = screenText();
  await sleep(3500);
  await settle();
  const rowsAfterRevisit = feedbackRows(dbPath, mealA.plan_meal_id);
  check(
    'F14',
    rowsAfterRevisit.length === 1,
    `revisiting the same feedback URL wrote NO second row (still ${rowsAfterRevisit.length}) — no inflated signal`,
  );
  check('F15', /already recorded|you said/i.test(textRevisit), 'the revisit is honest about what was already recorded');

  // =========================================================================
  // PHASE B — two taps: verdict + reason. Still exactly one write.
  // =========================================================================
  const hhB = await makeHousehold(baseUrl);
  apiMod.setHouseholdId(hhB);
  await makePlan(baseUrl, hhB);
  const planB = (await currentPlan(baseUrl, hhB)).body.plan;
  const mealB = planB.meals[0];

  await goto(`/feedback/${mealB.plan_meal_id}`);
  const notAgainBtn = buttons()
    .filter((b) => b.getAttribute('class') === 'reaction-btn')
    .find((b) => /not this one again|not again/i.test(norm(visibleText(b))));
  check('F16', Boolean(notAgainBtn), 'a negative verdict is offered');

  // Tap 1
  notAgainBtn.dispatchEvent(makeEvent('click', notAgainBtn));
  await settle();

  // Tap 2 — one reason chip, whatever the screen offers.
  const reasonChip = buttons().find((b) => /too much work|took longer|too bland|too spicy|easy with interruptions|not filling/i.test(norm(visibleText(b))));
  check('F17', Boolean(reasonChip), 'the optional reason is one tap on a chip, not a form');
  if (reasonChip) {
    reasonChip.dispatchEvent(makeEvent('click', reasonChip));
    await settle();
  }
  await sleep(3500);
  await settle();

  const rowsB = feedbackRows(dbPath, mealB.plan_meal_id);
  check('F18', rowsB.length === 1, `verdict + reason = exactly 1 row on the server (found ${rowsB.length}), never two`);
  check(
    'F19',
    rowsB[0]?.verdict === 'not_again',
    `the negative label maps to the server enum "not_again" (stored "${rowsB[0]?.verdict}")`,
  );
  const REASONS = ['too_much_work', 'took_longer_than_expected', 'too_bland', 'too_spicy', 'easy_with_interruptions', 'not_filling'];
  check(
    'F20',
    REASONS.includes(rowsB[0]?.reason),
    `the reason tap reached the server as a valid enum value ("${rowsB[0]?.reason}")`,
  );
  check(
    'F21',
    /thanks|saved|recorded/i.test(screenText()),
    'the two-tap path ends in a calm confirmation',
  );

  // =========================================================================
  // PHASE C — the way IN. A finished cooking session must reach this screen.
  // This is the check this run has failed twice before (T-055, T-058): code
  // that is correct and unreachable.
  // =========================================================================
  const hhC = await makeHousehold(baseUrl);
  apiMod.setHouseholdId(hhC);
  await makePlan(baseUrl, hhC);
  const planC = (await currentPlan(baseUrl, hhC)).body.plan;
  const mealC = planC.meals[0];

  const created = await api(baseUrl, '/api/cooking/sessions', {
    method: 'POST',
    householdId: hhC,
    body: { plan_meal_id: mealC.plan_meal_id, recipe_id: mealC.recipe_id, target_servings: 3 },
  });
  const sessionId = created.body?.session?.session_id;
  check('F22', Boolean(sessionId), `a cooking session opens for "${mealC.name.slice(0, 32)}"`);

  const done = await api(baseUrl, `/api/cooking/sessions/${sessionId}/events`, {
    method: 'POST',
    householdId: hhC,
    body: { payload: { kind: 'session_completed' } },
  });
  check('F23', done.status === 200, `the session reaches status completed via the real API (${done.status})`);

  await goto(`/cook/${sessionId}`);
  const cookText = screenText();
  check('F24', /complete/i.test(cookText), 'the cooking screen shows the finished state');

  const feedbackEntry = buttons().find((b) => /how did it go|how was|feedback|rate|tell us/i.test(norm(visibleText(b))));
  check(
    'F25',
    Boolean(feedbackEntry),
    feedbackEntry
      ? `the finished cooking screen offers a way to feedback: "${norm(visibleText(feedbackEntry))}"`
      : 'NO route from a finished cooking session to feedback — the screen would be unreachable',
  );

  if (feedbackEntry) {
    feedbackEntry.dispatchEvent(makeEvent('click', feedbackEntry));
    await settle();
    const landedHash = win.location.hash;
    check(
      'F26',
      landedHash === `#/feedback/${mealC.plan_meal_id}`,
      `that tap navigates to this meal's feedback route (hash "${landedHash}")`,
    );
    // A browser would now re-render. Do exactly that, and confirm the user
    // arrives on a usable screen rather than a dead route.
    win.dispatchEvent(makeEvent('hashchange', null));
    await settle();
    const arrived = screenText();
    check(
      'F27',
      arrived.includes(mealC.name) && buttons().some((b) => b.getAttribute('class') === 'reaction-btn'),
      'and the feedback screen renders there with its verdict choices — the loop is closed end to end',
    );

    // Cooking-session route must not itself have recorded anything.
    check(
      'F28',
      feedbackRows(dbPath, mealC.plan_meal_id).length === 0,
      'merely arriving records nothing — no verdict is written without a tap',
    );
  }

  // =========================================================================
  // PHASE D — honest failure states.
  // =========================================================================
  const bogus = `bogus-${randomUUID()}`;
  await goto(`/feedback/${bogus}`);
  const bogusText = screenText();
  check(
    'F29',
    bogusText.length > 40 && !/isn't built yet/i.test(bogusText),
    `an unknown plan_meal_id gets a real panel, not a blank screen (${bogusText.length} chars)`,
  );
  check(
    'F30',
    /can't find|cannot find|not.*match|nothing was recorded/i.test(bogusText),
    'and it says plainly that nothing was recorded',
  );
  check('F31', feedbackRows(dbPath, bogus).length === 0, 'nothing was written for the unknown id');
  check('F32', Boolean(buttonLabelled(/back to plan/i)), 'the dead end offers a way out');

  // A verdict must never be recorded for a meal the screen could not resolve.
  const strayVerdict = buttons().find((b) => b.getAttribute('class') === 'reaction-btn');
  check('F33', !strayVerdict, 'no verdict buttons are offered for a meal that could not be resolved');
} finally {
  await gate.stop();
}

console.log(`\npass ${pass} / ${pass + fail}`);
if (fail > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log('  ' + f);
}
process.exit(fail > 0 ? 1 : 0);
