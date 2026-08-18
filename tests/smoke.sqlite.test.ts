/**
 * smoke.sqlite.test.ts — proves node:sqlite works on a REAL FILE database
 * with the actual statement API against the real frozen schema:
 * create the schema, write and read back through the household-scoped
 * helpers (Rationals losslessly, timers as absolute UTC end instants),
 * and demonstrate that data written for one household is NOT returned
 * when a different household_id is passed — structurally, on every entity.
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/src/db.ts';
import type { ScoreBreakdown, CookingTimer } from '../domain/src/recipe.ts';
import { rational, eq, ZERO } from '../domain/src/qty.ts';

// A real file under the worktree (tmp/ and *.db are gitignored), cleaned up
// after the run.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tmpParent = join(repoRoot, 'tmp');
mkdirSync(tmpParent, { recursive: true });
const tmpDir = mkdtempSync(join(tmpParent, 'sqlite-smoke-'));
const dbPath = join(tmpDir, 'smoke.db');

const db = openDb(dbPath);

after(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const NOW = '2026-08-18T21:00:00.000Z';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function scoreBreakdown(recipeId: string): ScoreBreakdown {
  const component = (weightNum: bigint) => ({
    weight: rational(weightNum, 100n),
    raw: rational(3, 4),
    weighted: rational(weightNum * 3n, 400n),
  });
  return {
    recipe_id: recipeId,
    components: {
      preference: component(32n),
      context_interruption: component(20n),
      inventory_use: component(16n),
      cost: component(12n),
      novelty: component(10n),
      leftover_usefulness: component(10n),
    },
    penalties: {
      recent_repeat: ZERO,
      repeated_cuisine: ZERO,
      repeated_format: rational(1, 20),
      excessive_active_time: ZERO,
      dish_count: ZERO,
      likely_waste: ZERO,
    },
    total: rational(7, 10),
  };
}

test('creates a real file database on disk', () => {
  assert.ok(existsSync(dbPath), 'db file must exist');
  assert.ok(statSync(dbPath).isFile());
});

test('households and members round trip; scoping is structural', () => {
  db.createHousehold(A, {
    name: 'Household A',
    household_size: 3,
    novelty_preference: 'mostly_familiar',
    weeknight_active_time_ceiling_seconds: 1800,
    weeknight_total_time_ceiling_seconds: 3600,
    created_at_utc: NOW,
  });
  db.createHousehold(B, {
    name: 'Household B',
    household_size: 2,
    novelty_preference: 'adventurous',
    weeknight_active_time_ceiling_seconds: null,
    weeknight_total_time_ceiling_seconds: null,
    created_at_utc: NOW,
  });

  const a = db.getHousehold(A);
  assert.ok(a !== undefined);
  assert.equal(a.name, 'Household A');
  assert.equal(a.weeknight_active_time_ceiling_seconds, 1800);
  const b = db.getHousehold(B);
  assert.ok(b !== undefined);
  assert.equal(b.weeknight_active_time_ceiling_seconds, null);

  db.insertMember(A, {
    id: 'member-a1',
    display_name: 'Alex',
    is_primary: true,
    dietary_restrictions: ['vegetarian'],
    allergies: ['peanut', 'tree_nut'],
    never_recommend_ingredients: ['ing.cilantro'],
    created_at_utc: NOW,
  });

  const membersA = db.listMembers(A);
  assert.equal(membersA.length, 1);
  const alex = membersA[0];
  assert.ok(alex !== undefined);
  assert.equal(alex.household_id, A);
  assert.deepEqual(alex.allergies, ['peanut', 'tree_nut']);
  // Household B sees nothing of A's members.
  assert.deepEqual(db.listMembers(B), []);
});

test('preference signals: exact rationals, upsert, isolation', () => {
  db.upsertPreferenceSignal(A, {
    id: 'sig-a1',
    member_id: null,
    attribute: 'protein',
    attribute_value: 'chicken',
    value: rational(1, 3),
    confidence: rational(2, 5),
    durability: 'durable',
    source: 'calibration',
    updated_at_utc: NOW,
  });
  // Upsert replaces in place (same axis), never duplicates.
  db.upsertPreferenceSignal(A, {
    id: 'sig-a1b',
    member_id: null,
    attribute: 'protein',
    attribute_value: 'chicken',
    value: rational(-1, 2),
    confidence: rational(4, 5),
    durability: 'durable',
    source: 'feedback',
    updated_at_utc: NOW,
  });

  const signals = db.listPreferenceSignals(A);
  assert.equal(signals.length, 1);
  const sig = signals[0];
  assert.ok(sig !== undefined);
  assert.ok(eq(sig.value, rational(-1, 2)), 'value must round trip exactly');
  assert.deepEqual(sig.value, { num: -1n, den: 2n });
  assert.equal(sig.source, 'feedback');
  assert.deepEqual(db.listPreferenceSignals(B), []);
});

test('inventory: lossless quantities, upsert by (ingredient, unit), isolation', () => {
  db.upsertInventoryEntry(A, {
    id: 'inv-a1',
    ingredient_id: 'ing.rice',
    quantity: rational(9007199254740993n, 7n), // exactness past 2^53
    unit: 'g',
    confidence: 'confirmed',
    source: 'purchase_confirmed',
    best_by_utc: null,
    updated_at_utc: NOW,
  });
  db.upsertInventoryEntry(A, {
    id: 'inv-a2',
    ingredient_id: 'ing.rice',
    quantity: rational(1, 3),
    unit: 'g',
    confidence: 'assumed_staple',
    source: 'onboarding_staple',
    best_by_utc: '2026-08-30T00:00:00.000Z',
    updated_at_utc: NOW,
  });

  const inv = db.listInventoryEntries(A);
  assert.equal(inv.length, 1, 'same (ingredient, unit) must upsert, not duplicate');
  const rice = inv[0];
  assert.ok(rice !== undefined);
  assert.deepEqual(rice.quantity, { num: 1n, den: 3n });
  assert.equal(rice.confidence, 'assumed_staple');
  assert.deepEqual(db.listInventoryEntries(B), []);
});

test('plans + plan meals: persisted score breakdown is exact; isolation', () => {
  db.insertPlan(A, { id: 'plan-a1', status: 'accepted', created_at_utc: NOW });
  db.insertPlanMeal(A, {
    id: 'meal-a1',
    plan_id: 'plan-a1',
    recipe_id: 'recipe-1',
    slot: 0,
    target_servings: 4,
    status: 'proposed',
    reason_codes: ['quick_total_time', 'uses_owned_ingredients'],
    score: scoreBreakdown('recipe-1'),
    created_at_utc: NOW,
  });

  const meals = db.listPlanMeals(A, 'plan-a1');
  assert.equal(meals.length, 1);
  const meal = meals[0];
  assert.ok(meal !== undefined);
  // Rational components revive as exact bigints, not floats.
  assert.deepEqual(meal.score.components.preference.weight, { num: 8n, den: 25n });
  assert.deepEqual(meal.score.components.preference.weighted, { num: 6n, den: 25n });
  assert.deepEqual(meal.score.penalties.repeated_format, { num: 1n, den: 20n });
  assert.deepEqual(meal.score.total, { num: 7n, den: 10n });
  assert.deepEqual(meal.reason_codes, ['quick_total_time', 'uses_owned_ingredients']);

  db.updatePlanMealStatus(A, 'meal-a1', 'accepted');
  const accepted = db.listPlanMeals(A, 'plan-a1')[0];
  assert.ok(accepted !== undefined);
  assert.equal(accepted.status, 'accepted');

  // B cannot see A's plan or meals — even knowing the ids.
  assert.equal(db.getPlan(B, 'plan-a1'), undefined);
  assert.deepEqual(db.listPlanMeals(B, 'plan-a1'), []);
  assert.deepEqual(db.listPlans(B), []);
});

test('grocery lines: provenance, and regeneration cannot clobber a user edit', () => {
  db.insertGroceryList(A, {
    id: 'list-a1',
    plan_id: 'plan-a1',
    status: 'current',
    created_at_utc: NOW,
    regenerated_at_utc: null,
  });
  db.insertGroceryLine(A, {
    id: 'line-a1',
    grocery_list_id: 'list-a1',
    ingredient_id: 'ing.garlic',
    display_name: 'garlic',
    store_section: 'produce',
    unit: 'count',
    required_quantity: rational(7, 1),
    inventory_deducted: rational(2, 1),
    package_description: 'one head',
    is_estimate: true,
    expected_surplus: rational(3, 1),
    checked: false,
    contributions: [
      {
        recipe_id: 'recipe-1',
        plan_meal_id: 'meal-a1',
        recipe_ingredient_line_id: 'ing-line-3',
        amount: rational(3, 1),
      },
      {
        recipe_id: 'recipe-2',
        plan_meal_id: 'meal-a2',
        recipe_ingredient_line_id: 'ing-line-1',
        amount: rational(4, 1),
      },
    ],
  });

  // The user edits the quantity...
  db.setUserEditedQuantity(A, 'line-a1', rational(9, 1));
  // ...then regeneration rewrites every computed column.
  db.updateGroceryLineComputed(A, 'line-a1', {
    required_quantity: rational(5, 1),
    inventory_deducted: ZERO,
    package_description: null,
    is_estimate: false,
    expected_surplus: ZERO,
    contributions: [
      {
        recipe_id: 'recipe-1',
        plan_meal_id: 'meal-a1',
        recipe_ingredient_line_id: 'ing-line-3',
        amount: rational(5, 1),
      },
    ],
  });

  const lines = db.listGroceryLines(A, 'list-a1');
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.ok(line !== undefined);
  // Computed columns took the regeneration...
  assert.deepEqual(line.required_quantity, { num: 5n, den: 1n });
  assert.equal(line.contributions.length, 1);
  const contribution = line.contributions[0];
  assert.ok(contribution !== undefined);
  assert.equal(contribution.recipe_ingredient_line_id, 'ing-line-3');
  assert.deepEqual(contribution.amount, { num: 5n, den: 1n });
  // ...and the user's edit SURVIVED — the separate column was untouched.
  assert.ok(line.user_edited_quantity !== null);
  assert.deepEqual(line.user_edited_quantity, { num: 9n, den: 1n });

  db.setGroceryLineChecked(A, 'line-a1', true);
  const checkedLine = db.listGroceryLines(A, 'list-a1')[0];
  assert.ok(checkedLine !== undefined);
  assert.equal(checkedLine.checked, true);

  // Isolation: B sees neither list nor lines.
  assert.equal(db.getGroceryList(B, 'list-a1'), undefined);
  assert.deepEqual(db.listGroceryLines(B, 'list-a1'), []);
});

test('cooking sessions: timers persist ABSOLUTE UTC end instants; isolation', () => {
  const timer: CookingTimer = {
    id: 'timer-1',
    step_index: 2,
    label: 'simmer',
    started_at_utc: '2026-08-18T21:10:00.000Z',
    ends_at_utc: '2026-08-18T21:22:00.000Z', // absolute end — never remaining seconds
    duration_seconds: 720,
  };
  db.insertCookingSession(A, {
    id: 'sess-a1',
    plan_meal_id: 'meal-a1',
    recipe_id: 'recipe-1',
    target_servings: 4,
    status: 'active',
    current_step_index: 2,
    timers: [timer],
    started_at_utc: NOW,
    updated_at_utc: NOW,
  });
  db.appendCookingEvent(A, {
    id: 'evt-1',
    session_id: 'sess-a1',
    seq: 1,
    occurred_at_utc: NOW,
    payload: { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 },
  });
  db.appendCookingEvent(A, {
    id: 'evt-2',
    session_id: 'sess-a1',
    seq: 2,
    occurred_at_utc: '2026-08-18T21:10:00.000Z',
    payload: { kind: 'timer_started', timer },
  });

  // Simulated kill/reload: a fresh read returns the full recoverable state.
  const revived = db.getCookingSession(A, 'sess-a1');
  assert.ok(revived !== undefined);
  assert.equal(revived.current_step_index, 2);
  assert.equal(revived.timers.length, 1);
  const revivedTimer = revived.timers[0];
  assert.ok(revivedTimer !== undefined);
  assert.equal(revivedTimer.ends_at_utc, '2026-08-18T21:22:00.000Z');

  db.updateCookingSession(A, 'sess-a1', {
    status: 'paused',
    current_step_index: 3,
    timers: [],
    updated_at_utc: '2026-08-18T21:15:00.000Z',
  });
  const paused = db.getCookingSession(A, 'sess-a1');
  assert.ok(paused !== undefined);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.current_step_index, 3);
  assert.deepEqual(paused.timers, []);

  const events = db.listCookingEvents(A, 'sess-a1');
  assert.equal(events.length, 2);
  const timerEvent = events[1];
  assert.ok(timerEvent !== undefined);
  assert.equal(timerEvent.payload.kind, 'timer_started');
  if (timerEvent.payload.kind === 'timer_started') {
    assert.equal(timerEvent.payload.timer.ends_at_utc, '2026-08-18T21:22:00.000Z');
  }

  // Isolation: B cannot read A's session or events, even with the ids.
  assert.equal(db.getCookingSession(B, 'sess-a1'), undefined);
  assert.deepEqual(db.listCookingEvents(B, 'sess-a1'), []);
});

test('feedback round trips and is isolated', () => {
  db.insertFeedback(A, {
    id: 'fb-1',
    plan_meal_id: 'meal-a1',
    recipe_id: 'recipe-1',
    verdict: 'make_again',
    reason: 'easy_with_interruptions',
    created_at_utc: NOW,
  });
  const fbA = db.listFeedback(A);
  assert.equal(fbA.length, 1);
  const fb = fbA[0];
  assert.ok(fb !== undefined);
  assert.equal(fb.verdict, 'make_again');
  assert.equal(fb.reason, 'easy_with_interruptions');
  assert.deepEqual(db.listFeedback(B), []);
});
