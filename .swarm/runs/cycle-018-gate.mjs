/**
 * cycle-018-gate.mjs — CONDUCTOR-authored verification gate for T-040
 * (every prep `active_time_block` must ship a rendered `time_label`).
 *
 * Authored AFTER the builder finished. The builder never saw this file and was
 * never told what it checks.
 *
 * INDEPENDENCE IS THE POINT. The builder's own routes.test.ts asserts the wire
 * label equals `renderActiveTimeLabel(active_seconds)` — i.e. it compares the
 * implementation against itself, which cannot catch a bug INSIDE
 * renderActiveTimeLabel. This gate imports no domain code at all: it re-derives
 * every expected label from `active_seconds` with integer arithmetic written
 * here, and compares against what the LIVE HTTP endpoint actually returns. The
 * only product code in the loop is the real server entrypoint.
 *
 * Checks:
 *   G1  server boots; a household of 3 gets a plan with active meals
 *   G2  EVERY active_time_block on EVERY meal carries a non-empty string
 *       `time_label` — the acceptance criterion's existence half
 *   G3  every label equals text re-derived here from active_seconds
 *       (round-to-nearest-minute, halves away from zero) — the correctness half
 *   G4  G3 is not a constant-string tautology: real minute counts, >1 distinct
 *   G5  CROSS-SURFACE: where a block's active_seconds equals the recipe's, the
 *       block label is byte-identical to the hands-on half of the prep header's
 *       own combined label — two independently-encoded wire surfaces, same
 *       duration, same words. This is what "one shared renderer" has to mean.
 *   G6  the smallest duration actually on the wire still renders correctly, and
 *       the sub-minute boundary is reported as NOT reachable from this catalog
 *   G7  raw seconds survive alongside the label — a client that needs the number
 *       is not forced to parse the prose back out
 *
 * Run: node .swarm/runs/cycle-018-gate.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../../server/src/main.ts';

let pass = 0;
let fail = 0;

function check(id, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd());
  } else {
    fail += 1;
    console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd());
  }
}

// ---------------------------------------------------------------------------
// Minute rounding, re-derived here. Integer-only (2*rem vs 60), so there is no
// float-boundary excuse and no shared code path with the product.
// ---------------------------------------------------------------------------

function minutesIndependently(seconds) {
  const q = Math.floor(seconds / 60);
  const rem = seconds - q * 60;
  return rem * 2 >= 60 ? q + 1 : q;
}

function expectedLabel(seconds) {
  const m = minutesIndependently(seconds);
  return m <= 0 ? 'under 1 min hands-on' : `${m} min hands-on`;
}

// ---------------------------------------------------------------------------
// Server + HTTP
// ---------------------------------------------------------------------------

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'dinner-gate-c18-'));
  const started = await startServer(['--port', '0', '--db', join(dir, 'gate.db')]);
  return {
    baseUrl: `http://127.0.0.1:${started.port}`,
    async stop() {
      try {
        await new Promise((r) => started.server.close(() => r()));
        started.db.close();
      } catch { /* already down */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

async function api(baseUrl, path, { method = 'GET', body, householdId } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (householdId) headers['x-household-id'] = householdId;
  const res = await fetch(baseUrl + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  if (text.length > 0) { try { payload = JSON.parse(text); } catch { payload = { __raw: text.slice(0, 300) }; } }
  return { status: res.status, body: payload };
}

async function household(baseUrl, size) {
  const res = await api(baseUrl, '/api/households', {
    method: 'POST',
    body: {
      household: {
        name: `Gate household of ${size}`,
        household_size: size,
        novelty_preference: 'mostly_familiar',
        weeknight_active_time_ceiling_seconds: 1800,
        weeknight_total_time_ceiling_seconds: 3600,
      },
      member: { display_name: 'Gate parent', dietary_restrictions: [], allergies: [], never_recommend_ingredients: [] },
    },
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`household(${size}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body?.household_id ?? res.body?.household?.id ?? res.body?.id;
}

async function planWithPrep(baseUrl, hid) {
  const created = await api(baseUrl, '/api/plans', { method: 'POST', body: {}, householdId: hid });
  if (created.status !== 201 && created.status !== 200) throw new Error(`plan failed: ${created.status} ${JSON.stringify(created.body)}`);
  const plan = created.body?.plan ?? created.body;
  const planId = plan.id ?? plan.plan_id;
  const meals = (plan.meals ?? []).filter((m) => m.status !== 'swapped_out');
  const out = [];
  for (const m of meals) {
    const slot = m.slot;
    const prep = await api(baseUrl, `/api/plans/${planId}/meals/${slot}/prep`, { householdId: hid });
    if (prep.status !== 200) throw new Error(`prep slot ${slot} failed: ${prep.status} ${JSON.stringify(prep.body)}`);
    out.push({ slot, prep: prep.body.prep });
  }
  return { planId, meals: out };
}

// ---------------------------------------------------------------------------

const srv = await boot();
try {
  const hid = await household(srv.baseUrl, 3);
  const { planId, meals } = await planWithPrep(srv.baseUrl, hid);
  check('G1', meals.length > 0, `household of 3 → plan ${planId} with ${meals.length} active meal(s)`);

  // --- G2: the field exists everywhere -------------------------------------
  let totalBlocks = 0;
  const absent = [];
  for (const { slot, prep } of meals) {
    const blocks = prep.active_time_blocks;
    if (!Array.isArray(blocks)) { absent.push(`slot ${slot}: active_time_blocks is not an array`); continue; }
    for (const b of blocks) {
      totalBlocks += 1;
      if (typeof b.time_label !== 'string' || b.time_label.length === 0) {
        absent.push(`slot ${slot} block ${b.start_step_index}-${b.end_step_index}: time_label = ${JSON.stringify(b.time_label)}`);
      }
    }
  }
  check('G2', totalBlocks > 0 && absent.length === 0,
    `${totalBlocks} active_time_block(s) across ${meals.length} meal(s), every one carries a non-empty time_label${absent.length ? ` — ${absent.join('; ')}` : ''}`);

  // --- G3: correctness against independently re-derived text ---------------
  const observed = [];
  const wrong = [];
  for (const { slot, prep } of meals) {
    for (const b of prep.active_time_blocks ?? []) {
      const want = expectedLabel(b.active_seconds);
      observed.push({ slot, seconds: b.active_seconds, label: b.time_label });
      if (b.time_label !== want) wrong.push(`slot ${slot} ${b.active_seconds}s: got ${JSON.stringify(b.time_label)}, gate re-derived ${JSON.stringify(want)}`);
    }
  }
  check('G3', wrong.length === 0,
    `all ${observed.length} label(s) match text re-derived here from active_seconds${wrong.length ? ` — ${wrong.join('; ')}` : ''}`);
  for (const o of observed) console.log(`       slot ${o.slot}: ${o.seconds}s → ${JSON.stringify(o.label)}`);

  // --- G4: G3 is not a tautology -------------------------------------------
  const realMinutes = observed.filter((o) => /^\d+ min hands-on$/.test(o.label));
  const distinct = new Set(realMinutes.map((o) => o.label));
  check('G4', realMinutes.length > 0 && distinct.size > 1,
    `${realMinutes.length} label(s) carry a genuine minute count across ${distinct.size} distinct value(s) — G3 is not matching a constant string`);

  // --- G5: cross-surface phrasing agreement, wire-only ---------------------
  let compared = 0;
  const drift = [];
  for (const { slot, prep } of meals) {
    const combined = prep.time_label;               // "N min total, M min hands-on"
    const handsOnHalf = typeof combined === 'string' ? combined.split(', ')[1] : undefined;
    for (const b of prep.active_time_blocks ?? []) {
      if (b.active_seconds !== prep.active_seconds) continue;
      compared += 1;
      if (b.time_label !== handsOnHalf) {
        drift.push(`slot ${slot}: block ${JSON.stringify(b.time_label)} vs prep header ${JSON.stringify(handsOnHalf)}`);
      }
    }
  }
  check('G5', compared > 0 && drift.length === 0,
    `${compared} block(s) span the recipe's whole active duration; every one is byte-identical to the prep header's own hands-on phrasing${drift.length ? ` — ${drift.join('; ')}` : ''}`);

  // --- G6: smallest real duration, and an honest note about the boundary ---
  const smallest = observed.reduce((a, o) => (o.seconds < a.seconds ? o : a), observed[0]);
  check('G6', smallest.label === expectedLabel(smallest.seconds),
    `smallest block on the wire is ${smallest.seconds}s → ${JSON.stringify(smallest.label)} (the sub-minute "under 1 min" boundary is NOT reachable from this catalog — unit-tested only)`);

  // --- G7: the raw number survives -----------------------------------------
  const lostSeconds = observed.filter((o) => !Number.isInteger(o.seconds));
  check('G7', lostSeconds.length === 0,
    `all ${observed.length} block(s) still ship integer active_seconds alongside the label — no client has to parse minutes back out of the prose`);
} finally {
  await srv.stop();
}

console.log(`\npass ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
