/**
 * cycle-014-fixture.mjs — CONDUCTOR-authored live-server fixture (cycle 14).
 *
 * Boots the REAL entrypoint (`server/src/main.ts` → `startServer`) on an
 * ephemeral port against a throwaway sqlite file, then drives the real HTTP
 * API to produce the exact response bodies the plan and grocery screens will
 * consume. Nothing here is mocked: if the server would 500 for a user, this
 * fixture 500s too.
 *
 * Builders never saw this file.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../../server/src/main.ts';

const DEFAULT_HOUSEHOLD = {
  name: 'Gate household',
  household_size: 4,
  novelty_preference: 'mostly_familiar',
  weeknight_active_time_ceiling_seconds: 1800,
  weeknight_total_time_ceiling_seconds: 3600,
};

const DEFAULT_MEMBER = {
  display_name: 'Gate parent',
  dietary_restrictions: [],
  allergies: [],
  never_recommend_ingredients: [],
};

export async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'dinner-gate-c14-'));
  const dbPath = join(dir, 'gate.db');
  const started = await startServer(['--port', '0', '--db', dbPath]);
  const port = started.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    port,
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

export async function api(baseUrl, path, { method = 'GET', body, householdId } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (householdId) headers['x-household-id'] = householdId;
  const res = await fetch(baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { __unparsable: text.slice(0, 400) };
    }
  }
  return { status: res.status, body: payload };
}

/**
 * Create a household. `overrides.household` / `overrides.member` are shallow
 * merges, so a gate check can build a deliberately over-constrained household
 * (the empty-plan case) from the same helper as the happy path.
 */
export async function makeHousehold(baseUrl, overrides = {}) {
  const payload = {
    household: { ...DEFAULT_HOUSEHOLD, ...(overrides.household || {}) },
    member: { ...DEFAULT_MEMBER, ...(overrides.member || {}) },
  };
  // `assumed_staples` is the ONLY HTTP write path into inventory (routes.ts
  // handleCreateHousehold) — it is how a gate makes inventory_deducted and
  // confirmation_questions non-empty, which no default household produces.
  if (overrides.assumed_staples) payload.assumed_staples = overrides.assumed_staples;
  const res = await api(baseUrl, '/api/households', { method: 'POST', body: payload });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createHousehold failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body?.household_id ?? res.body?.household?.id ?? res.body?.id;
  if (!id) throw new Error(`createHousehold returned no id: ${JSON.stringify(res.body)}`);
  return id;
}

export async function makePlan(baseUrl, householdId) {
  const res = await api(baseUrl, '/api/plans', { method: 'POST', body: {}, householdId });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`createPlan failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

export async function currentPlan(baseUrl, householdId) {
  return api(baseUrl, '/api/plans/current', { householdId });
}

export async function grocery(baseUrl, householdId, planId) {
  return api(baseUrl, `/api/plans/${planId}/grocery`, { householdId });
}

export { DEFAULT_HOUSEHOLD, DEFAULT_MEMBER };
