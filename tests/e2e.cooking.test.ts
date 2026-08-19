/**
 * e2e.cooking.test.ts — T-020: prove Definition-of-Done clause 7 BY
 * EXECUTION: a real cooking session with a running timer survives the server
 * process being hard-killed (SIGKILL — the clean-shutdown path never runs)
 * and restarted against the same SQLite file.
 *
 * Genuinely end-to-end: the server is a SPAWNED CHILD PROCESS running the
 * real entrypoint (`node server/src/main.ts --port 0 --db <tmpfile>`), not an
 * in-process `startServer` handle — an in-process handle cannot be
 * SIGKILLed without killing the test runner. `--port 0` (ephemeral) is the
 * frozen contract's stated mitigation for kill-test flake; the entrypoint
 * prints the ACTUAL bound port on a single machine-parseable stdout line
 * (`listening on http://127.0.0.1:<port>`), which is how this test discovers
 * where to talk.
 *
 * The post-restart assertion is pure arithmetic on ABSOLUTE INSTANTS
 * (Invariant 2): `ends_at_utc` must be BYTE-IDENTICAL across the kill, and
 * `remaining_seconds` — a derived view value, never persisted — must have
 * STRICTLY DECREASED by the real elapsed wall time and must equal
 * ceil((ends_at_utc − now) / 1000) for a `now` bracketed by client-side
 * timestamps. Asserting a preserved remaining-seconds snapshot would assert
 * the bug, not the fix; this test asserts the opposite.
 *
 * No `any` anywhere: JSON responses are `unknown`, narrowed through the same
 * runtime-asserting helpers (`j`, `jArr`, `jStr`, `jNum`, `jBool`) that
 * `tests/routes.test.ts` uses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// JSON navigation helpers (unknown, never any) — same pattern as
// tests/routes.test.ts.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function j(v: unknown): Json {
  assert.equal(typeof v, 'object');
  assert.notEqual(v, null);
  return v as Json;
}
function jArr(v: unknown): readonly unknown[] {
  assert.ok(Array.isArray(v), `expected an array, got ${JSON.stringify(v)}`);
  return v as readonly unknown[];
}
function jStr(v: unknown): string {
  assert.equal(typeof v, 'string', `expected a string, got ${JSON.stringify(v)}`);
  return v as string;
}
function jNum(v: unknown): number {
  assert.equal(typeof v, 'number', `expected a number, got ${JSON.stringify(v)}`);
  return v as number;
}
function jBool(v: unknown): boolean {
  assert.equal(typeof v, 'boolean', `expected a boolean, got ${JSON.stringify(v)}`);
  return v as boolean;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

interface ApiResponse {
  readonly status: number;
  readonly json: unknown;
}

async function api(
  base: string,
  method: string,
  path: string,
  opts: { readonly householdId?: string; readonly body?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.householdId !== undefined) headers['x-household-id'] = opts.householdId;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Child-process server lifecycle — the REAL entrypoint, spawned, killable.
// ---------------------------------------------------------------------------

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainPath = join(repoRoot, 'server', 'src', 'main.ts');

interface RunningServer {
  readonly child: ChildProcessWithoutNullStreams;
  readonly port: number;
  readonly base: string;
}

/** Spawn `node server/src/main.ts --port 0 --db <dbPath>` and resolve once
 * the entrypoint announces its ephemeral port on stdout. Rejects (with the
 * child's stderr attached) if the child exits or stays silent too long. */
function spawnServer(dbPath: string): Promise<RunningServer> {
  const child = spawn(process.execPath, [mainPath, '--port', '0', '--db', dbPath]);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server did not announce a port within 30s.\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const m = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      const portText = m?.[1];
      if (portText !== undefined) {
        clearTimeout(timeout);
        const port = Number.parseInt(portText, 10);
        resolve({ child, port, base: `http://127.0.0.1:${String(port)}` });
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      // No-op if we already resolved; a pre-listen exit is a startup failure.
      reject(new Error(`server exited before listening (code ${String(code)}, signal ${String(signal)}).\nstderr: ${stderr}`));
    });
  });
}

/** SIGKILL — the hard kill. No clean-shutdown handler can run (SIGKILL is
 * uncatchable), so whatever the restarted process observes was durably
 * persisted BEFORE the kill, not flushed by a shutdown path. Resolves only
 * once the OS reports the process gone. */
function hardKill(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Catalog fixture: first timer-bearing step per shipped recipe, read live
// from data/recipes/*.json (same idiom as routes.test.ts's timer fixture) so
// the test binds to whichever recipe the planner actually picks.
// ---------------------------------------------------------------------------

interface TimerStepInfo {
  readonly stepIndex: number;
  readonly durationSeconds: number;
}

function loadTimerStepByRecipeId(): ReadonlyMap<string, TimerStepInfo> {
  const dir = join(repoRoot, 'data', 'recipes');
  const out = new Map<string, TimerStepInfo>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const recipe = j(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const steps = jArr(recipe['steps']).map((s) => j(s));
    const withTimer = steps.find((s) => typeof s['timer_duration_seconds'] === 'number');
    if (withTimer === undefined) continue;
    out.set(jStr(recipe['id']), {
      stepIndex: jNum(withTimer['index']),
      durationSeconds: jNum(withTimer['timer_duration_seconds']),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

test('DoD 7 e2e: cooking session with a running timer survives SIGKILL + restart on the same db', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'dinner-e2e-cooking-'));
  const dbPath = join(tmpDir, 'e2e.db');
  const children: ChildProcessWithoutNullStreams[] = [];
  try {
    // ---- process 1: real onboarding → real plan → real cooking session ----
    const s1 = await spawnServer(dbPath);
    children.push(s1.child);

    const householdRes = await api(s1.base, 'POST', '/api/households', {
      body: {
        household: {
          name: 'Kill Test Household',
          household_size: 2,
          novelty_preference: 'mostly_familiar',
          weeknight_active_time_ceiling_seconds: null,
          weeknight_total_time_ceiling_seconds: null,
        },
        member: {
          display_name: 'Sam',
          dietary_restrictions: [],
          allergies: [],
          never_recommend_ingredients: [],
        },
        assumed_staples: [],
      },
    });
    assert.equal(householdRes.status, 201, JSON.stringify(householdRes.json));
    const householdId = jStr(j(householdRes.json)['household_id']);

    const planRes = await api(s1.base, 'POST', '/api/plans', { householdId, body: {} });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const meals = jArr(j(j(planRes.json)['plan'])['meals']);
    assert.ok(meals.length >= 1, 'plan must contain at least one meal');
    const meal = j(meals[0]);
    const recipeId = jStr(meal['recipe_id']);
    const planMealId = jStr(meal['plan_meal_id']);

    const timerStep = loadTimerStepByRecipeId().get(recipeId);
    assert.ok(timerStep !== undefined, `planned recipe ${recipeId} has no timer-bearing step in data/recipes`);
    assert.ok(timerStep.durationSeconds >= 60, 'fixture timer must comfortably outlive the test run');

    const sessionRes = await api(s1.base, 'POST', '/api/cooking/sessions', {
      householdId,
      body: { plan_meal_id: planMealId, recipe_id: recipeId, target_servings: 2 },
    });
    assert.equal(sessionRes.status, 201, JSON.stringify(sessionRes.json));
    const sessionId = jStr(j(j(sessionRes.json)['session'])['session_id']);

    // Advance the session for real: complete every step before the timer
    // step, start the timer THROUGH THE PRODUCT'S OWN PATH (client sends
    // only {kind, step_index}; the server derives id/duration/ends_at_utc —
    // T-058), then complete the timer step too so current_step_index is
    // ALWAYS ≥ 1 at the kill, even when the timer lives on step 0. The
    // timer stays live after its step completes (only cancel/acknowledge
    // removes it).
    for (let i = 0; i < timerStep.stepIndex; i += 1) {
      const stepRes = await api(s1.base, 'POST', `/api/cooking/sessions/${sessionId}/events`, {
        householdId,
        body: { payload: { kind: 'step_completed', step_index: i } },
      });
      assert.equal(stepRes.status, 200, JSON.stringify(stepRes.json));
    }
    const startTimerRes = await api(s1.base, 'POST', `/api/cooking/sessions/${sessionId}/events`, {
      householdId,
      body: { payload: { kind: 'timer_started', step_index: timerStep.stepIndex } },
    });
    assert.equal(startTimerRes.status, 200, JSON.stringify(startTimerRes.json));
    const completeTimerStepRes = await api(s1.base, 'POST', `/api/cooking/sessions/${sessionId}/events`, {
      householdId,
      body: { payload: { kind: 'step_completed', step_index: timerStep.stepIndex } },
    });
    assert.equal(completeTimerStepRes.status, 200, JSON.stringify(completeTimerStepRes.json));

    // ---- pre-kill snapshot -------------------------------------------------
    const before = await api(s1.base, 'GET', `/api/cooking/sessions/${sessionId}`, { householdId });
    const snapshot1DoneMs = Date.now(); // server derived the snapshot at some instant ≤ this
    assert.equal(before.status, 200, JSON.stringify(before.json));
    const beforeSession = j(j(before.json)['session']);
    const stepIndexBefore = jNum(beforeSession['current_step_index']);
    assert.equal(stepIndexBefore, timerStep.stepIndex + 1, 'session must have made real step progress before the kill');
    const totalSteps = jNum(beforeSession['total_steps']);
    const beforeTimers = jArr(beforeSession['timers']);
    assert.equal(beforeTimers.length, 1, JSON.stringify(beforeTimers));
    const beforeTimer = j(beforeTimers[0]);
    const timerId = jStr(beforeTimer['timer_id']);
    const endsAtBefore = jStr(beforeTimer['ends_at_utc']);
    const remainingBefore = jNum(beforeTimer['remaining_seconds']);
    assert.equal(jBool(beforeTimer['expired']), false);
    const endsAtMs = Date.parse(endsAtBefore);
    assert.ok(Number.isFinite(endsAtMs), `ends_at_utc is not a parseable instant: ${endsAtBefore}`);
    assert.ok(endsAtMs > snapshot1DoneMs, 'the running timer must end in the future');
    assert.ok(remainingBefore > 0, 'the timer must still be running at the kill');

    // ---- HARD KILL ---------------------------------------------------------
    await hardKill(s1.child);

    // ---- process 2: same db file, fresh ephemeral port ---------------------
    const s2 = await spawnServer(dbPath);
    children.push(s2.child);
    assert.notEqual(s2.child.pid, s1.child.pid, 'restart must be a genuinely new process');

    // Guarantee ≥ 1.1s of real wall clock between the two snapshots so a
    // correctly-recomputed remaining_seconds MUST strictly decrease (it is
    // ceil()ed, so a sub-second gap could legitimately tie). Usually the
    // restart already took this long; then this loop exits immediately.
    while (Date.now() < snapshot1DoneMs + 1_100) {
      await delay(50);
    }

    const snapshot2StartMs = Date.now(); // server derives the view at some instant ≥ this
    const after = await api(s2.base, 'GET', `/api/cooking/sessions/${sessionId}`, { householdId });
    const snapshot2DoneMs = Date.now(); // ... and ≤ this
    assert.equal(after.status, 200, JSON.stringify(after.json));
    const afterSession = j(j(after.json)['session']);

    // Step progress is IDENTICAL across the kill — nothing lost, nothing
    // invented.
    assert.equal(jNum(afterSession['current_step_index']), stepIndexBefore, 'step progress changed across kill/restart');
    assert.equal(jNum(afterSession['total_steps']), totalSteps);
    assert.equal(jStr(afterSession['status']), 'active');
    assert.equal(jStr(afterSession['recipe_id']), recipeId);

    // The SAME timer still exists at the SAME step.
    const afterTimers = jArr(afterSession['timers']);
    assert.equal(afterTimers.length, 1, JSON.stringify(afterTimers));
    const afterTimer = j(afterTimers[0]);
    assert.equal(jStr(afterTimer['timer_id']), timerId, 'timer identity changed across kill/restart');
    assert.equal(jNum(afterTimer['step_index']), timerStep.stepIndex);
    assert.equal(jBool(afterTimer['expired']), false);

    // Invariant 2, the heart of DoD 7: the persisted truth is an ABSOLUTE
    // UTC end instant, so it is BYTE-IDENTICAL across the kill. (If the
    // implementation had drifted to persisting remaining-seconds, the
    // restarted process would re-derive a LATER end instant and this
    // equality would go red.)
    assert.equal(jStr(afterTimer['ends_at_utc']), endsAtBefore, 'ends_at_utc must be byte-identical across kill/restart');

    // remaining_seconds is DERIVED, so across ≥ 1.1s of real elapsed wall
    // time it must have strictly decreased — never been "preserved" ...
    const remainingAfter = jNum(afterTimer['remaining_seconds']);
    assert.ok(
      remainingAfter < remainingBefore,
      `remaining_seconds must strictly decrease with wall time across the kill (before=${String(remainingBefore)}, after=${String(remainingAfter)})`,
    );
    // ... and it must be EXACTLY ceil((ends_at_utc − now) / 1000) for a now
    // inside the client-observed request window: pure arithmetic on the
    // absolute instant, no snapshot involved.
    const remainingMax = Math.ceil((endsAtMs - snapshot2StartMs) / 1000);
    const remainingMin = Math.ceil((endsAtMs - snapshot2DoneMs) / 1000);
    assert.ok(
      remainingAfter >= remainingMin && remainingAfter <= remainingMax,
      `remaining_seconds=${String(remainingAfter)} is not ceil((ends_at − now)/1000) for any now in the request window [${String(remainingMin)}, ${String(remainingMax)}]`,
    );
  } finally {
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already dead — nothing to clean up
      }
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
