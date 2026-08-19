/**
 * routes.test.ts — proves the FROZEN HTTP CONTRACT v1 routes against a real
 * `node:http` server on an ephemeral port, backed by a temp SQLite file per
 * test (T-014 acceptance criteria). Drives the actual entrypoint
 * (`server/src/main.ts`'s exported `startServer`), not a parallel test-only
 * bootstrap, so `--port 0` / `--db <path>` are exercised for real.
 *
 * No `any` anywhere (hard rule): JSON responses are typed `unknown` and
 * narrowed through small runtime-asserting helpers (`j`, `jArr`, `jStr`,
 * `jNum`, `jBool`) rather than cast away.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../server/src/main.ts';
import type { StartedServer } from '../server/src/main.ts';
import { rational, eq } from '../domain/src/qty.ts';
import { canonicalizeQuantity } from '../domain/src/units.ts';
import type { IngredientQuantity, Unit } from '../domain/src/recipe.ts';
import { renderActiveTimeLabel } from '../domain/src/reasons.ts';

// ---------------------------------------------------------------------------
// JSON navigation helpers (unknown, never any)
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
// HTTP helpers
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

/** Sends a raw, unnormalised request path over the wire (bypassing any
 * client-side URL dot-segment normalisation) — needed to prove the SERVER's
 * own traversal defence, not the HTTP client's. */
function rawGet(port: number, rawPath: string): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

interface TestServer {
  readonly base: string;
  readonly started: StartedServer;
  readonly tmpDir: string;
}

async function startTestServer(): Promise<TestServer> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'dinner-routes-test-'));
  const dbPath = join(tmpDir, 'test.db');
  const started = await startServer(['--port', '0', '--db', dbPath]);
  return { base: `http://127.0.0.1:${String(started.port)}`, started, tmpDir };
}

async function stopTestServer(ts: TestServer): Promise<void> {
  await new Promise<void>((resolve) => ts.started.server.close(() => resolve()));
  ts.started.db.close();
  rmSync(ts.tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

interface HouseholdOverrides {
  readonly household?: Partial<Json>;
  readonly member?: Partial<Json>;
  readonly assumed_staples?: readonly unknown[];
}

function householdPayload(overrides: HouseholdOverrides = {}): Json {
  return {
    household: {
      name: 'Test Household',
      household_size: 3,
      novelty_preference: 'mostly_familiar',
      weeknight_active_time_ceiling_seconds: null,
      weeknight_total_time_ceiling_seconds: null,
      ...overrides.household,
    },
    member: {
      display_name: 'Alex',
      dietary_restrictions: [],
      allergies: [],
      never_recommend_ingredients: [],
      ...overrides.member,
    },
    assumed_staples: overrides.assumed_staples ?? [],
  };
}

async function createHousehold(base: string, overrides: HouseholdOverrides = {}): Promise<string> {
  const res = await api(base, 'POST', '/api/households', { body: householdPayload(overrides) });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  return jStr(j(res.json)['household_id']);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /api/health', async () => {
  const ts = await startTestServer();
  try {
    const res = await api(ts.base, 'GET', '/api/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
  } finally {
    await stopTestServer(ts);
  }
});

test('household create -> read round trip; every id is server-minted', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);
    assert.match(householdId, /^[0-9a-f-]{36}$/i);

    const res = await api(ts.base, 'GET', '/api/household', { householdId });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const body = j(res.json);
    const household = j(body['household']);
    assert.equal(jStr(household['id']), householdId);
    assert.equal(jStr(household['name']), 'Test Household');

    const members = jArr(body['members']);
    assert.equal(members.length, 1);
    const member = j(members[0]);
    assert.match(jStr(member['id']), /^[0-9a-f-]{36}$/i);
    assert.equal(jStr(member['display_name']), 'Alex');
    assert.equal(jBool(member['is_primary']), true);
  } finally {
    await stopTestServer(ts);
  }
});

test('household creation rejects bad input with distinct, specific error codes', async () => {
  const ts = await startTestServer();
  try {
    const badSize = await api(ts.base, 'POST', '/api/households', {
      body: householdPayload({ household: { household_size: 0 } }),
    });
    assert.equal(badSize.status, 400);
    assert.equal(jStr(j(j(badSize.json)['error'])['code']), 'invalid_household_size');

    const badNovelty = await api(ts.base, 'POST', '/api/households', {
      body: householdPayload({ household: { novelty_preference: 'bogus' } }),
    });
    assert.equal(badNovelty.status, 400);
    assert.equal(jStr(j(j(badNovelty.json)['error'])['code']), 'invalid_novelty_preference');

    const badStaple = await api(ts.base, 'POST', '/api/households', {
      body: householdPayload({ assumed_staples: [{ ingredient_id: 'kosher_salt', quantity: { n: 'abc', d: '1' }, unit: 'g' }] }),
    });
    assert.equal(badStaple.status, 400);
    assert.equal(jStr(j(j(badStaple.json)['error'])['code']), 'invalid_staple_quantity');
  } finally {
    await stopTestServer(ts);
  }
});

test('a scoped route requires the x-household-id header', async () => {
  const ts = await startTestServer();
  try {
    const res = await api(ts.base, 'GET', '/api/household');
    assert.equal(res.status, 400);
    assert.equal(jStr(j(j(res.json)['error'])['code']), 'household_required');
  } finally {
    await stopTestServer(ts);
  }
});

test('household isolation: A cannot read B\'s plan, grocery, cooking session, or feedback', async () => {
  const ts = await startTestServer();
  try {
    const a = await createHousehold(ts.base);
    const b = await createHousehold(ts.base);

    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId: a });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    const planId = jStr(plan['plan_id']);
    const meals = jArr(plan['meals']);
    const firstRecipeId = jStr(j(meals[0])['recipe_id']);
    const firstPlanMealId = jStr(j(meals[0])['plan_meal_id']);

    const groceryAsB = await api(ts.base, 'GET', `/api/plans/${planId}/grocery`, { householdId: b });
    assert.equal(groceryAsB.status, 404);
    assert.equal(jStr(j(j(groceryAsB.json)['error'])['code']), 'plan_not_found');

    const swapAsB = await api(ts.base, 'POST', `/api/plans/${planId}/meals/0/swap`, { householdId: b, body: { reason: 'faster' } });
    assert.equal(swapAsB.status, 404);
    assert.equal(jStr(j(j(swapAsB.json)['error'])['code']), 'plan_not_found');

    const sessionRes = await api(ts.base, 'POST', '/api/cooking/sessions', {
      householdId: a,
      body: { plan_meal_id: null, recipe_id: firstRecipeId, target_servings: 2 },
    });
    assert.equal(sessionRes.status, 201, JSON.stringify(sessionRes.json));
    const sessionId = jStr(j(j(sessionRes.json)['session'])['session_id']);

    const sessionAsB = await api(ts.base, 'GET', `/api/cooking/sessions/${sessionId}`, { householdId: b });
    assert.equal(sessionAsB.status, 404);
    assert.equal(jStr(j(j(sessionAsB.json)['error'])['code']), 'session_not_found');

    // Feedback has no dedicated read route in the frozen contract, so
    // isolation is proven directly at the structurally-scoped db layer —
    // the same handle the server itself uses.
    const feedbackRes = await api(ts.base, 'POST', '/api/feedback', {
      householdId: a,
      body: { plan_meal_id: firstPlanMealId, recipe_id: firstRecipeId, verdict: 'make_again', reason: null },
    });
    assert.equal(feedbackRes.status, 201, JSON.stringify(feedbackRes.json));
    assert.deepEqual(ts.started.db.listFeedback(b), []);
    assert.equal(ts.started.db.listFeedback(a).length, 1);
  } finally {
    await stopTestServer(ts);
  }
});

test('calibration cards + reactions round trip', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);

    const cardsRes = await api(ts.base, 'GET', '/api/calibration/cards', { householdId });
    assert.equal(cardsRes.status, 200, JSON.stringify(cardsRes.json));
    const cards = jArr(j(cardsRes.json)['cards']);
    assert.ok(cards.length > 0);
    const card = j(cards[0]);
    const recipeId = jStr(card['recipe_id']);
    jNum(card['total_seconds']);
    jNum(card['active_seconds']);
    jStr(card['time_label']);

    const reactRes = await api(ts.base, 'POST', '/api/calibration/reactions', {
      householdId,
      body: { reactions: [{ recipe_id: recipeId, reaction: 'looks_good' }] },
    });
    assert.equal(reactRes.status, 200, JSON.stringify(reactRes.json));
    assert.ok(jNum(j(reactRes.json)['signals_updated']) > 0);

    const badReaction = await api(ts.base, 'POST', '/api/calibration/reactions', {
      householdId,
      body: { reactions: [{ recipe_id: recipeId, reaction: 'bogus' }] },
    });
    assert.equal(badReaction.status, 400);
    assert.equal(jStr(j(j(badReaction.json)['error'])['code']), 'invalid_reaction_value');
  } finally {
    await stopTestServer(ts);
  }
});

test('plan build, then swap offer, then swap accept changes exactly one slot', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);

    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    const planId = jStr(plan['plan_id']);
    const originalMeals = jArr(plan['meals']).map((m) => j(m));
    assert.equal(originalMeals.length, 3);
    const originalRecipeIdBySlot = new Map<number, string>();
    for (const m of originalMeals) originalRecipeIdBySlot.set(jNum(m['slot']), jStr(m['recipe_id']));

    let swappedSlot: number | null = null;
    let acceptedRecipeId: string | null = null;
    for (const slot of [0, 1, 2]) {
      const offerRes = await api(ts.base, 'POST', `/api/plans/${planId}/meals/${String(slot)}/swap`, {
        householdId,
        body: { reason: 'different_protein' },
      });
      assert.equal(offerRes.status, 200, JSON.stringify(offerRes.json));
      const offerBody = j(offerRes.json);
      if ('alternatives' in offerBody) {
        const alternatives = jArr(offerBody['alternatives']);
        if (alternatives.length > 0) {
          swappedSlot = slot;
          acceptedRecipeId = jStr(j(alternatives[0])['recipe_id']);
          break;
        }
      }
    }
    assert.ok(swappedSlot !== null, 'expected at least one slot to offer a different_protein alternative');
    assert.ok(acceptedRecipeId !== null);

    const acceptRes = await api(ts.base, 'POST', `/api/plans/${planId}/meals/${String(swappedSlot)}/swap`, {
      householdId,
      body: { reason: 'different_protein', accept_recipe_id: acceptedRecipeId },
    });
    assert.equal(acceptRes.status, 200, JSON.stringify(acceptRes.json));
    const newPlan = j(j(acceptRes.json)['plan']);
    const newMeals = jArr(newPlan['meals']).map((m) => j(m));
    assert.equal(newMeals.length, 3);

    let changedCount = 0;
    for (const meal of newMeals) {
      const slot = jNum(meal['slot']);
      const recipeId = jStr(meal['recipe_id']);
      const original = originalRecipeIdBySlot.get(slot);
      assert.ok(original !== undefined);
      if (recipeId !== original) {
        changedCount += 1;
        assert.equal(slot, swappedSlot, 'the changed slot must be exactly the one that was swapped');
        assert.equal(recipeId, acceptedRecipeId);
      }
    }
    assert.equal(changedCount, 1, 'swap must change EXACTLY one slot');

    // GET /api/plans/current reflects the swap too.
    const currentRes = await api(ts.base, 'GET', '/api/plans/current', { householdId });
    assert.equal(currentRes.status, 200);
    const currentMeals = jArr(j(j(currentRes.json)['plan'])['meals']).map((m) => j(m));
    const currentBySlot = new Map<number, string>();
    for (const m of currentMeals) currentBySlot.set(jNum(m['slot']), jStr(m['recipe_id']));
    assert.equal(currentBySlot.get(swappedSlot as number), acceptedRecipeId);
  } finally {
    await stopTestServer(ts);
  }
});

// ---------------------------------------------------------------------------
// T-041 / KI-7 — an excluded or partial plan must explain itself.
//
// Ground truth (verified against the shipped 6-recipe catalog): active
// (hands-on) times are 18, 23.5, 19, 27, 16, 25 minutes; total times are
// 56, 36, 34, 78, 26, 50 minutes. So a 15-minute (900s) active ceiling
// excludes all six (quickest active is 16 min), and a 30-minute (1800s)
// total ceiling excludes five of six (only the 26-min dish survives; its
// active time is 16 min, so it alone would also fail a 900s active
// ceiling — used below to build a "both constraints alone exclude
// everything" household).
// ---------------------------------------------------------------------------

function shortfallOf(planJson: unknown): Json {
  return j(j(planJson)['shortfall']);
}

test('a household with no time ceilings never sees a shortfall', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);
    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    assert.equal(jArr(plan['meals']).length, 3);
    assert.equal(jBool(plan['is_empty']), false);
    assert.equal(jBool(plan['is_partial']), false);
    assert.equal(plan['shortfall'], null);
  } finally {
    await stopTestServer(ts);
  }
});

test('POST /api/plans for a household whose active-time ceiling excludes the whole catalog returns 201 with a derived, typed shortfall — and GET /current does not lie about having no plan', async () => {
  const ts = await startTestServer();
  try {
    // The shipped onboarding defaults (T-041's reproduced blocker, KI-7).
    const householdId = await createHousehold(ts.base, {
      household: { weeknight_active_time_ceiling_seconds: 900, weeknight_total_time_ceiling_seconds: 1800 },
    });

    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    assert.equal(jArr(plan['meals']).length, 0, 'never a bare empty meals array — this is the exact defect being fixed');
    assert.equal(jBool(plan['is_empty']), true);
    assert.equal(jBool(plan['is_partial']), false);

    const shortfall = shortfallOf(plan);
    // Derived, not guessed: EVERY excluded recipe fails the active ceiling
    // (all six active times exceed 15 min), but only five of six also fail
    // the total ceiling — so active_time_ceiling, not total, is the one
    // TRUE binding constraint, and the module must find exactly that one.
    assert.equal(jStr(shortfall['code']), 'active_time_ceiling');
    assert.equal(jNum(shortfall['excluded_count']), 6);
    assert.equal(jNum(shortfall['missing_meal_count']), 3);
    const constraints = jArr(shortfall['constraints']).map((c) => j(c));
    assert.equal(constraints.length, 1);
    assert.equal(jStr(constraints[0]?.['code'] as string), 'active_time_ceiling');
    assert.equal(jNum(constraints[0]?.['ceiling_seconds'] as number), 900);
    assert.equal(jNum(constraints[0]?.['quickest_seconds'] as number), 960, 'the quickest excluded recipe needs 16 min (960s)');
    const text = jStr(shortfall['text']);
    assert.match(text, /15-minute/, 'copy must name the actual constraint value, not a generic message');
    assert.match(text, /16 minute/, 'copy must state the real quickest-recipe number, derived from the filter results');
    assert.doesNotMatch(text, /no results/i);

    // GET /api/plans/current: the household HAS a plan (it was just
    // created); it must never claim otherwise, even though that plan's
    // meals array is empty.
    const currentRes = await api(ts.base, 'GET', '/api/plans/current', { householdId });
    assert.equal(currentRes.status, 200, JSON.stringify(currentRes.json));
    const currentPlan = j(j(currentRes.json)['plan']);
    assert.equal(jArr(currentPlan['meals']).length, 0);
    assert.equal(jBool(currentPlan['is_empty']), true);
    const currentShortfall = shortfallOf(currentPlan);
    assert.equal(jStr(currentShortfall['code']), 'active_time_ceiling');
    assert.equal(jNum(currentShortfall['excluded_count']), 6);
  } finally {
    await stopTestServer(ts);
  }
});

test('a household that has genuinely never created a plan still gets 404 no_current_plan', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);
    const res = await api(ts.base, 'GET', '/api/plans/current', { householdId });
    assert.equal(res.status, 404);
    assert.equal(jStr(j(j(res.json)['error'])['code']), 'no_current_plan');
  } finally {
    await stopTestServer(ts);
  }
});

test('a PARTIAL plan (short, not empty) explains why it is short, both from POST and from GET /current', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base, {
      household: { weeknight_active_time_ceiling_seconds: null, weeknight_total_time_ceiling_seconds: 1800 },
    });

    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    assert.equal(jArr(plan['meals']).length, 1, 'only the 26-min-total dish survives a 30-minute total ceiling');
    assert.equal(jBool(plan['is_partial']), true);
    assert.equal(jBool(plan['is_empty']), false);

    const shortfall = shortfallOf(plan);
    assert.equal(jStr(shortfall['code']), 'total_time_ceiling');
    assert.equal(jNum(shortfall['excluded_count']), 5);
    assert.equal(jNum(shortfall['missing_meal_count']), 2);
    const constraints = jArr(shortfall['constraints']).map((c) => j(c));
    assert.equal(constraints.length, 1);
    assert.equal(jNum(constraints[0]?.['ceiling_seconds'] as number), 1800);
    assert.equal(jNum(constraints[0]?.['quickest_seconds'] as number), 2040, 'the quickest excluded-by-total recipe needs 34 min (2040s)');
    assert.match(jStr(shortfall['text']), /30-minute/);

    const currentRes = await api(ts.base, 'GET', '/api/plans/current', { householdId });
    assert.equal(currentRes.status, 200, JSON.stringify(currentRes.json));
    const currentPlan = j(j(currentRes.json)['plan']);
    assert.equal(jArr(currentPlan['meals']).length, 1);
    assert.equal(jBool(currentPlan['is_partial']), true);
    assert.equal(jStr(shortfallOf(currentPlan)['code']), 'total_time_ceiling');
  } finally {
    await stopTestServer(ts);
  }
});

test('when two constraints each independently exclude every recipe, the shortfall names BOTH rather than picking one arbitrarily', async () => {
  const ts = await startTestServer();
  try {
    // 900s active ceiling alone excludes all six (quickest active 16 min).
    // 1200s (20 min) total ceiling ALSO alone excludes all six (quickest
    // total is 26 min, the same dish that is quickest-active). Every
    // excluded recipe therefore carries BOTH reasons — two independently-
    // sufficient universal constraints, neither of which may be dropped.
    const householdId = await createHousehold(ts.base, {
      household: { weeknight_active_time_ceiling_seconds: 900, weeknight_total_time_ceiling_seconds: 1200 },
    });

    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    assert.equal(jArr(plan['meals']).length, 0);
    assert.equal(jBool(plan['is_empty']), true);

    const shortfall = shortfallOf(plan);
    assert.equal(jStr(shortfall['code']), 'multiple_constraints');
    const constraints = jArr(shortfall['constraints']).map((c) => j(c));
    const codes = constraints.map((c) => jStr(c['code'])).sort();
    assert.deepEqual(codes, ['active_time_ceiling', 'total_time_ceiling']);
    const byCode = new Map(constraints.map((c) => [jStr(c['code']), c]));
    assert.equal(jNum((byCode.get('active_time_ceiling') as Json)['ceiling_seconds']), 900);
    assert.equal(jNum((byCode.get('active_time_ceiling') as Json)['quickest_seconds']), 960);
    assert.equal(jNum((byCode.get('total_time_ceiling') as Json)['ceiling_seconds']), 1200);
    assert.equal(jNum((byCode.get('total_time_ceiling') as Json)['quickest_seconds']), 1560);
    assert.equal(jNum(shortfall['excluded_count']), 6);
  } finally {
    await stopTestServer(ts);
  }
});

test('grocery list has a populated provenance drawer, and a user quantity edit survives a re-read', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);
    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const planId = jStr(j(j(planRes.json)['plan'])['plan_id']);

    const groceryRes = await api(ts.base, 'GET', `/api/plans/${planId}/grocery`, { householdId });
    assert.equal(groceryRes.status, 200, JSON.stringify(groceryRes.json));
    const list = j(j(groceryRes.json)['list']);
    assert.equal(jStr(list['list_id']), planId);
    const sections = jArr(list['sections']).map((s) => j(s));
    assert.ok(sections.length > 0);

    let firstLine: Json | null = null;
    for (const section of sections) {
      const lines = jArr(section['lines']).map((l) => j(l));
      if (lines.length > 0) {
        firstLine = lines[0] as Json;
        break;
      }
    }
    assert.ok(firstLine !== null, 'expected at least one grocery line across all sections');
    const line = firstLine as Json;
    const lineId = jStr(line['line_id']);
    const provenance = j(line['provenance']);
    const contributions = jArr(provenance['contributions']).map((c) => j(c));
    assert.ok(contributions.length > 0, 'every line must answer "why am I buying this?"');
    jStr(contributions[0]?.['recipe_name']);
    jStr(contributions[0]?.['recipe_id']);
    const purchaseQuantity = j(line['purchase_quantity']);
    jStr(purchaseQuantity['n']);
    jStr(purchaseQuantity['d']);

    // A non-clean-float fraction (1/3) must survive the wire unchanged, and
    // the edit must survive a full list re-read.
    const patchRes = await api(ts.base, 'PATCH', `/api/grocery/lines/${lineId}`, {
      householdId,
      body: { user_edited_quantity: { n: '1', d: '3' } },
    });
    assert.equal(patchRes.status, 200, JSON.stringify(patchRes.json));
    const patchedLine = j(j(patchRes.json)['line']);
    assert.deepEqual(patchedLine['user_edited_quantity'], { n: '1', d: '3' });

    const rereadRes = await api(ts.base, 'GET', `/api/plans/${planId}/grocery`, { householdId });
    assert.equal(rereadRes.status, 200);
    const rereadSections = jArr(j(j(rereadRes.json)['list'])['sections']).map((s) => j(s));
    let rereadLine: Json | null = null;
    for (const section of rereadSections) {
      const lines = jArr(section['lines']).map((l) => j(l));
      const found = lines.find((l) => jStr(l['line_id']) === lineId);
      if (found !== undefined) {
        rereadLine = found;
        break;
      }
    }
    assert.ok(rereadLine !== null, 'the edited line must still be present after re-read');
    assert.deepEqual((rereadLine as Json)['user_edited_quantity'], { n: '1', d: '3' });

    // checked toggling round-trips independently of the quantity edit.
    const checkRes = await api(ts.base, 'PATCH', `/api/grocery/lines/${lineId}`, { householdId, body: { checked: true } });
    assert.equal(checkRes.status, 200);
    assert.equal(jBool(j(j(checkRes.json)['line'])['checked']), true);

    // A cross-household PATCH on a real lineId is invisible (isolation).
    const otherHousehold = await createHousehold(ts.base);
    const crossPatch = await api(ts.base, 'PATCH', `/api/grocery/lines/${lineId}`, {
      householdId: otherHousehold,
      body: { checked: false },
    });
    assert.equal(crossPatch.status, 404);
    assert.equal(jStr(j(j(crossPatch.json)['error'])['code']), 'grocery_line_not_found');
  } finally {
    await stopTestServer(ts);
  }
});

test('T-043: prep quantities agree with the grocery list for the same plan meal, scaled to household size (not servings_default)', async () => {
  const ts = await startTestServer();
  try {
    // household_size 2, distinct from every catalog recipe's servings_default
    // (4 in the fixtures, and typically 4 in the real catalog) — this is the
    // exact repro shape from the T-043 bug report (450g/2 potatoes expected,
    // 900g/4 potatoes was the bug).
    const householdId = await createHousehold(ts.base, { household: { household_size: 2 } });
    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    const planId = jStr(plan['plan_id']);
    const meals = jArr(plan['meals']).map((m) => j(m));

    const groceryRes = await api(ts.base, 'GET', `/api/plans/${planId}/grocery`, { householdId });
    assert.equal(groceryRes.status, 200, JSON.stringify(groceryRes.json));
    const sections = jArr(j(j(groceryRes.json)['list'])['sections']).map((s) => j(s));
    const groceryLines: Json[] = [];
    for (const section of sections) groceryLines.push(...jArr(section['lines']).map((l) => j(l)));

    // WHY these two numbers, and not e.g. `purchase_quantity`: grocery
    // aggregates a line across every recipe that wants that ingredient and
    // then rounds UP to a purchasable package (packaging.ts) — that rounded,
    // aggregated number is allowed to differ from any one recipe's need.
    // What must agree between prep and grocery is the UNDERLYING scaled
    // requirement for THIS recipe's THIS ingredient line: prep's
    // `required_ingredients[].quantity` (scaled, still in the recipe's own
    // unit — scale.ts's documented contract) run through the same
    // `canonicalizeQuantity` the aggregation path uses, versus the grocery
    // line's per-recipe `provenance.contributions[].amount` (also scaled +
    // canonicalized, pre-aggregation, pre-rounding) for a contribution from
    // that same recipe. Comparing those two — not the rounded, cross-recipe
    // `purchase_quantity` — is the comparison the T-043 acceptance criterion
    // actually calls for ("agreeing with the grocery list for the same
    // plan"), because it isolates exactly the scale-factor bug and nothing
    // packaging/aggregation is allowed to legitimately change.
    let compared = 0;
    for (const meal of meals) {
      const slot = jNum(meal['slot']);
      const recipeId = jStr(meal['recipe_id']);
      const prepRes = await api(ts.base, 'GET', `/api/plans/${planId}/meals/${String(slot)}/prep`, { householdId });
      assert.equal(prepRes.status, 200, JSON.stringify(prepRes.json));
      const prep = j(j(prepRes.json)['prep']);
      const requiredIngredients = jArr(prep['required_ingredients']).map((l) => j(l));

      for (const line of requiredIngredients) {
        const quantity = j(line['quantity']);
        if (jStr(quantity['kind']) !== 'exact') continue; // ranges/to_taste aggregate differently; compare the unambiguous case
        const ingredientId = jStr(line['ingredient_id']);
        const groceryLine = groceryLines.find((g) => jStr(g['ingredient_id']) === ingredientId);
        if (groceryLine === undefined) continue;
        const contributions = jArr(j(groceryLine['provenance'])['contributions']).map((c) => j(c));
        const fromThisRecipe = contributions.filter((c) => jStr(c['recipe_id']) === recipeId);
        // Wire contributions only carry recipe_id (not the recipe-line id),
        // so if this recipe contributed more than one line for this
        // ingredient (e.g. a required + an optional/garnish line both
        // resolving to the same ingredient) the match would be ambiguous —
        // skip rather than risk comparing the wrong pair.
        if (fromThisRecipe.length !== 1) continue;
        const contribution = fromThisRecipe[0] as Json;

        const amt = j(quantity['amount']);
        const prepQuantity: IngredientQuantity = {
          kind: 'exact',
          amount: rational(BigInt(jStr(amt['n'])), BigInt(jStr(amt['d']))),
          unit: jStr(quantity['unit']) as Unit,
        };
        const canonical = canonicalizeQuantity(prepQuantity);
        assert.equal(canonical.kind, 'exact', 'an exact prep quantity canonicalizes to an exact amount');
        if (canonical.kind !== 'exact') continue; // narrow for TS; asserted above

        const contribAmt = j(contribution['amount']);
        const contribRational = rational(BigInt(jStr(contribAmt['n'])), BigInt(jStr(contribAmt['d'])));

        assert.equal(
          eq(canonical.amount, contribRational),
          true,
          `prep vs grocery mismatch for ingredient ${ingredientId} on recipe ${recipeId}: ` +
            `prep canonical ${String(canonical.amount.num)}/${String(canonical.amount.den)} ${canonical.unit} vs ` +
            `grocery contribution ${String(contribRational.num)}/${String(contribRational.den)} ${jStr(groceryLine['unit'])}`,
        );
        compared++;
      }
    }
    assert.ok(compared > 0, 'expected at least one directly comparable required-ingredient line across the plan');
  } finally {
    await stopTestServer(ts);
  }
});

test('T-040: every active_time_block on a real prep response carries a time_label matching renderActiveTimeLabel, never hand-formatted', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);
    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    assert.equal(planRes.status, 201, JSON.stringify(planRes.json));
    const plan = j(j(planRes.json)['plan']);
    const planId = jStr(plan['plan_id']);
    const meals = jArr(plan['meals']).map((m) => j(m));

    let blocksSeen = 0;
    let maxBlocksInOneMeal = 0;
    for (const meal of meals) {
      const slot = jNum(meal['slot']);
      const prepRes = await api(ts.base, 'GET', `/api/plans/${planId}/meals/${String(slot)}/prep`, { householdId });
      assert.equal(prepRes.status, 200, JSON.stringify(prepRes.json));
      const prep = j(j(prepRes.json)['prep']);
      const blocks = jArr(prep['active_time_blocks']).map((b) => j(b));
      maxBlocksInOneMeal = Math.max(maxBlocksInOneMeal, blocks.length);
      for (const block of blocks) {
        const activeSeconds = jNum(block['active_seconds']);
        const label = jStr(block['time_label']);
        // The anti-drift assertion: the wire label must be BYTE-IDENTICAL to
        // what the shared renderer produces for this same active duration —
        // never a route-local reformat of the minutes.
        assert.equal(label, renderActiveTimeLabel(activeSeconds));
        blocksSeen++;
      }
    }
    assert.ok(blocksSeen > 0, 'expected at least one active_time_block across the plan to assert time_label on');
    // NOTE: the current 6-recipe catalog (data/recipes/r01..r06.json) has
    // every step's active_duration_seconds > 0 in every recipe, so
    // deriveActiveTimeBlocks (prep.ts) always coalesces to exactly ONE
    // contiguous block per recipe — there is no multi-block plan meal
    // reachable through the frozen HTTP surface with today's fixture data.
    // This assertion documents that fact rather than silently assuming it;
    // the per-block loop above still proves every block (whatever the
    // count) carries the correct label.
    assert.equal(maxBlocksInOneMeal, 1, 'catalog fixture assumption: today every recipe yields exactly one active_time_block (see note above)');
  } finally {
    await stopTestServer(ts);
  }
});

test('cooking session: create, complete a step, prep, and full feedback loop', async () => {
  const ts = await startTestServer();
  try {
    const householdId = await createHousehold(ts.base);
    const planRes = await api(ts.base, 'POST', '/api/plans', { householdId });
    const plan = j(j(planRes.json)['plan']);
    const planId = jStr(plan['plan_id']);
    const firstMeal = j(jArr(plan['meals'])[0]);
    const recipeId = jStr(firstMeal['recipe_id']);
    const planMealId = jStr(firstMeal['plan_meal_id']);
    const slot = jNum(firstMeal['slot']);

    const prepRes = await api(ts.base, 'GET', `/api/plans/${planId}/meals/${String(slot)}/prep`, { householdId });
    assert.equal(prepRes.status, 200, JSON.stringify(prepRes.json));
    const prep = j(j(prepRes.json)['prep']);
    assert.equal(jStr(prep['recipe_id']), recipeId);
    jNum(prep['total_seconds']);
    jNum(prep['active_seconds']);
    jStr(prep['time_label']);

    const sessionRes = await api(ts.base, 'POST', '/api/cooking/sessions', {
      householdId,
      body: { plan_meal_id: null, recipe_id: recipeId, target_servings: 2 },
    });
    assert.equal(sessionRes.status, 201, JSON.stringify(sessionRes.json));
    const session = j(j(sessionRes.json)['session']);
    const sessionId = jStr(session['session_id']);
    assert.equal(jNum(session['current_step_index']), 0);

    const stepRes = await api(ts.base, 'POST', `/api/cooking/sessions/${sessionId}/events`, {
      householdId,
      body: { payload: { kind: 'step_completed', step_index: 0 } },
    });
    assert.equal(stepRes.status, 200, JSON.stringify(stepRes.json));
    assert.equal(jNum(j(j(stepRes.json)['session'])['current_step_index']), 1);

    // An illegal transition (completing the wrong step) is rejected with a
    // specific code and does NOT corrupt the append-only log.
    const badStepRes = await api(ts.base, 'POST', `/api/cooking/sessions/${sessionId}/events`, {
      householdId,
      body: { payload: { kind: 'step_completed', step_index: 0 } },
    });
    assert.equal(badStepRes.status, 400);
    assert.equal(jStr(j(j(badStepRes.json)['error'])['code']), 'step_out_of_order');

    const getRes = await api(ts.base, 'GET', `/api/cooking/sessions/${sessionId}`, { householdId });
    assert.equal(getRes.status, 200);
    assert.equal(jNum(j(j(getRes.json)['session'])['current_step_index']), 1, 'the rejected event must not have advanced state');

    const feedbackRes = await api(ts.base, 'POST', '/api/feedback', {
      householdId,
      body: { plan_meal_id: planMealId, recipe_id: recipeId, verdict: 'make_again', reason: 'easy_with_interruptions' },
    });
    assert.equal(feedbackRes.status, 201, JSON.stringify(feedbackRes.json));

    // A plan_meal_id that is syntactically fine but does not exist is a
    // 400 (client input error), never a 500 (the FK constraint is real).
    const badFeedback = await api(ts.base, 'POST', '/api/feedback', {
      householdId,
      body: { plan_meal_id: 'not-a-real-plan-meal-id', recipe_id: recipeId, verdict: 'make_again', reason: null },
    });
    assert.equal(badFeedback.status, 400);
    assert.equal(jStr(j(j(badFeedback.json)['error'])['code']), 'invalid_plan_meal_id');
    assert.ok(jNum(j(feedbackRes.json)['signals_updated']) > 0);
  } finally {
    await stopTestServer(ts);
  }
});

test('cooking session step progress survives a server restart against the same db file (DoD 7, in-process half)', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'dinner-routes-test-'));
  const dbPath = join(tmpDir, 'restart-test.db');
  let started = await startServer(['--port', '0', '--db', dbPath]);
  let base = `http://127.0.0.1:${String(started.port)}`;
  try {
    const householdId = await createHousehold(base);
    const planRes = await api(base, 'POST', '/api/plans', { householdId });
    const recipeId = jStr(j(jArr(j(j(planRes.json)['plan'])['meals'])[0])['recipe_id']);

    const sessionRes = await api(base, 'POST', '/api/cooking/sessions', {
      householdId,
      body: { plan_meal_id: null, recipe_id: recipeId, target_servings: 2 },
    });
    const sessionId = jStr(j(j(sessionRes.json)['session'])['session_id']);

    const stepRes = await api(base, 'POST', `/api/cooking/sessions/${sessionId}/events`, {
      householdId,
      body: { payload: { kind: 'step_completed', step_index: 0 } },
    });
    assert.equal(jNum(j(j(stepRes.json)['session'])['current_step_index']), 1);

    // Simulate a process restart: close this server + its db handle, then
    // open a brand-new `startServer` against the SAME file and re-read the
    // session through IT — proving persistence, not in-memory state.
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    started.db.close();

    started = await startServer(['--port', '0', '--db', dbPath]);
    base = `http://127.0.0.1:${String(started.port)}`;

    const revived = await api(base, 'GET', `/api/cooking/sessions/${sessionId}`, { householdId });
    assert.equal(revived.status, 200, JSON.stringify(revived.json));
    assert.equal(jNum(j(j(revived.json)['session'])['current_step_index']), 1, 'step progress must survive a restart');
  } finally {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    started.db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('static file serving: a real file works, path traversal is always rejected', async () => {
  const ts = await startTestServer();
  try {
    const okRes = await fetch(`${ts.base}/css/tokens.css`);
    assert.equal(okRes.status, 200);
    assert.match(okRes.headers.get('content-type') ?? '', /text\/css/);

    const missingRes = await fetch(`${ts.base}/css/does-not-exist.css`);
    assert.equal(missingRes.status, 404);

    const traversalPlain = await rawGet(ts.started.port, '/css/../../package.json');
    assert.equal(traversalPlain.status, 404);
    assert.doesNotMatch(traversalPlain.body, /"name": ?"three-good-dinners"/);

    const traversalEncodedSlash = await rawGet(ts.started.port, '/css/..%2f..%2fpackage.json');
    assert.equal(traversalEncodedSlash.status, 404);

    const traversalDeep = await rawGet(ts.started.port, '/js/../../../etc/passwd');
    assert.equal(traversalDeep.status, 404);
  } finally {
    await stopTestServer(ts);
  }
});
