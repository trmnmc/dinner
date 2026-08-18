/**
 * db.ts — FROZEN node:sqlite schema + household-scoped data access (wave 0).
 *
 * Invariant 3 (DESIGN.md): every data-access helper takes `household_id` as
 * a REQUIRED FIRST ARGUMENT and appends the WHERE clause itself. The raw
 * database handle is a #private field and no raw query/exec escape hatch is
 * exported — an unscoped query is structurally inexpressible by a caller.
 *
 * Schema is Postgres-shaped (decision D-3):
 * - UUID TEXT primary keys
 * - UTC ISO-8601 TEXT instants
 * - money (when a price column ever lands) is INTEGER cents — never REAL
 * - exact quantities stored losslessly as numerator/denominator base-10
 *   TEXT columns (arbitrary-precision bigint safe). A REAL column anywhere
 *   in this schema is a defect (Invariant 1).
 * - user-edited grocery quantities live in SEPARATE columns that list
 *   regeneration cannot express a write to (grafted steal C).
 *
 * The db file path is a required parameter — nothing here hardcodes a path
 * (the server entrypoint exposes a --db flag for tests).
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Rational } from '../../domain/src/qty.ts';
import { rationalFromJson } from '../../domain/src/qty.ts';
import type {
  CookingEvent,
  CookingEventPayload,
  CookingSession,
  CookingSessionStatus,
  CookingTimer,
  GroceryContribution,
  GroceryLine,
  GroceryList,
  Household,
  HouseholdMember,
  InventoryEntry,
  IsoUtcInstant,
  MealFeedback,
  Plan,
  PlanMeal,
  PlanMealStatus,
  PreferenceSignal,
  ScoreBreakdown,
  Uuid,
} from '../../domain/src/recipe.ts';

// ---------------------------------------------------------------------------
// JSON codec for nested shapes containing bigints (score breakdowns,
// grocery contributions). Bigints are wrapped as {"$bigint":"<base-10>"} —
// lossless and unambiguous. Internal; the frozen surface is the columns
// and the typed helpers, not the codec.
// ---------------------------------------------------------------------------

function encodeJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'bigint' ? { $bigint: v.toString() } : v,
  );
}

function decodeJson(text: string): unknown {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && '$bigint' in v) {
      const wrapped = (v as { $bigint: unknown }).$bigint;
      if (typeof wrapped === 'string') return BigInt(wrapped);
    }
    return v;
  });
}

/** Store a Rational losslessly as two base-10 TEXT columns. */
function num(r: Rational): string {
  return r.num.toString();
}
function den(r: Rational): string {
  return r.den.toString();
}
function toRational(numText: string, denText: string): Rational {
  return rationalFromJson({ num: numText, den: denText });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  household_size INTEGER NOT NULL,
  novelty_preference TEXT NOT NULL,
  weeknight_active_time_ceiling_seconds INTEGER,
  weeknight_total_time_ceiling_seconds INTEGER,
  created_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL,
  is_primary INTEGER NOT NULL,
  dietary_restrictions_json TEXT NOT NULL,
  allergies_json TEXT NOT NULL,
  never_recommend_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_household ON members(household_id);

CREATE TABLE IF NOT EXISTS preference_signals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  member_id TEXT REFERENCES members(id),
  attribute TEXT NOT NULL,
  attribute_value TEXT NOT NULL,
  value_num TEXT NOT NULL,
  value_den TEXT NOT NULL,
  confidence_num TEXT NOT NULL,
  confidence_den TEXT NOT NULL,
  durability TEXT NOT NULL,
  source TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_household ON preference_signals(household_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signals_axis
  ON preference_signals(household_id, COALESCE(member_id, ''), attribute, attribute_value);

CREATE TABLE IF NOT EXISTS inventory_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  ingredient_id TEXT NOT NULL,
  qty_num TEXT NOT NULL,
  qty_den TEXT NOT NULL,
  unit TEXT NOT NULL,
  confidence TEXT NOT NULL,
  source TEXT NOT NULL,
  best_by_utc TEXT,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_household ON inventory_entries(household_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_item
  ON inventory_entries(household_id, ingredient_id, unit);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  status TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_household ON plans(household_id);

CREATE TABLE IF NOT EXISTS plan_meals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  recipe_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  target_servings INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL,
  score_breakdown_json TEXT NOT NULL,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_meals_household ON plan_meals(household_id);
CREATE INDEX IF NOT EXISTS idx_plan_meals_plan ON plan_meals(plan_id);

CREATE TABLE IF NOT EXISTS grocery_lists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  regenerated_at_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_grocery_lists_household ON grocery_lists(household_id);

CREATE TABLE IF NOT EXISTS grocery_lines (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  grocery_list_id TEXT NOT NULL REFERENCES grocery_lists(id),
  ingredient_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  store_section TEXT NOT NULL,
  unit TEXT NOT NULL,
  required_num TEXT NOT NULL,
  required_den TEXT NOT NULL,
  deducted_num TEXT NOT NULL,
  deducted_den TEXT NOT NULL,
  package_description TEXT,
  is_estimate INTEGER NOT NULL,
  surplus_num TEXT NOT NULL,
  surplus_den TEXT NOT NULL,
  contributions_json TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  -- SEPARATE user-edit columns: regeneration helpers cannot write these.
  user_edited_num TEXT,
  user_edited_den TEXT
);
CREATE INDEX IF NOT EXISTS idx_grocery_lines_household ON grocery_lines(household_id);
CREATE INDEX IF NOT EXISTS idx_grocery_lines_list ON grocery_lines(grocery_list_id);

CREATE TABLE IF NOT EXISTS cooking_sessions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  plan_meal_id TEXT REFERENCES plan_meals(id),
  recipe_id TEXT NOT NULL,
  target_servings INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_step_index INTEGER NOT NULL,
  -- Timers persist ABSOLUTE UTC end instants (Invariant 2), never
  -- remaining seconds; recovery after kill/reload is pure arithmetic.
  timers_json TEXT NOT NULL,
  started_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cooking_sessions_household ON cooking_sessions(household_id);

CREATE TABLE IF NOT EXISTS cooking_events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  session_id TEXT NOT NULL REFERENCES cooking_sessions(id),
  seq INTEGER NOT NULL,
  occurred_at_utc TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_cooking_events_household ON cooking_events(household_id);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  plan_meal_id TEXT NOT NULL REFERENCES plan_meals(id),
  recipe_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT,
  created_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_household ON feedback(household_id);
`;

// Input shapes: the scoped helpers stamp household_id themselves, so the
// caller-provided record must not carry one — passing a mismatched id is
// unrepresentable, not merely checked.
export type HouseholdInput = Omit<Household, 'id'>;
export type MemberInput = Omit<HouseholdMember, 'household_id'>;
export type PreferenceSignalInput = Omit<PreferenceSignal, 'household_id'>;
export type InventoryEntryInput = Omit<InventoryEntry, 'household_id'>;
export type PlanInput = Omit<Plan, 'household_id'>;
export type PlanMealInput = Omit<PlanMeal, 'household_id'>;
export type GroceryListInput = Omit<GroceryList, 'household_id'>;
/** New lines never carry a user edit; that column is only reachable via
 * `setUserEditedQuantity`. */
export type GroceryLineInput = Omit<GroceryLine, 'household_id' | 'user_edited_quantity'>;
export type CookingSessionInput = Omit<CookingSession, 'household_id'>;
export type CookingEventInput = Omit<CookingEvent, 'household_id'>;
export type MealFeedbackInput = Omit<MealFeedback, 'household_id'>;

/** The regeneration write-path for a grocery line: computed columns only.
 * `user_edited_quantity` is structurally absent — regeneration cannot
 * clobber a user's edit by construction. */
export interface GroceryLineComputedPatch {
  readonly required_quantity: Rational;
  readonly inventory_deducted: Rational;
  readonly package_description: string | null;
  readonly is_estimate: boolean;
  readonly expected_surplus: Rational;
  readonly contributions: readonly GroceryContribution[];
}

/** Full recoverable-state write for a cooking session. */
export interface CookingSessionPatch {
  readonly status: CookingSessionStatus;
  readonly current_step_index: number;
  readonly timers: readonly CookingTimer[];
  readonly updated_at_utc: IsoUtcInstant;
}

/** Open (creating if absent) the database at `path` and ensure the schema.
 * `path` is required — tests pass a temp file; the server passes its
 * --db flag. */
export function openDb(path: string): DinnerDb {
  return new DinnerDb(path);
}

export class DinnerDb {
  #db: DatabaseSync;
  #stmts: Map<string, StatementSync>;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#stmts = new Map();
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec('PRAGMA foreign_keys = ON;');
    this.#db.exec(SCHEMA);
  }

  close(): void {
    this.#db.close();
  }

  #prepare(sql: string): StatementSync {
    let stmt = this.#stmts.get(sql);
    if (stmt === undefined) {
      stmt = this.#db.prepare(sql);
      this.#stmts.set(sql, stmt);
    }
    return stmt;
  }

  // --- households ----------------------------------------------------------

  createHousehold(householdId: Uuid, input: HouseholdInput): void {
    this.#prepare(
      `INSERT INTO households
         (id, name, household_size, novelty_preference,
          weeknight_active_time_ceiling_seconds, weeknight_total_time_ceiling_seconds,
          created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      householdId,
      input.name,
      input.household_size,
      input.novelty_preference,
      input.weeknight_active_time_ceiling_seconds,
      input.weeknight_total_time_ceiling_seconds,
      input.created_at_utc,
    );
  }

  getHousehold(householdId: Uuid): Household | undefined {
    const row = this.#prepare('SELECT * FROM households WHERE id = ?').get(householdId) as
      | {
          id: string;
          name: string;
          household_size: number;
          novelty_preference: Household['novelty_preference'];
          weeknight_active_time_ceiling_seconds: number | null;
          weeknight_total_time_ceiling_seconds: number | null;
          created_at_utc: string;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      id: row.id,
      name: row.name,
      household_size: row.household_size,
      novelty_preference: row.novelty_preference,
      weeknight_active_time_ceiling_seconds: row.weeknight_active_time_ceiling_seconds,
      weeknight_total_time_ceiling_seconds: row.weeknight_total_time_ceiling_seconds,
      created_at_utc: row.created_at_utc,
    };
  }

  // --- members -------------------------------------------------------------

  insertMember(householdId: Uuid, member: MemberInput): void {
    this.#prepare(
      `INSERT INTO members
         (id, household_id, display_name, is_primary,
          dietary_restrictions_json, allergies_json, never_recommend_json, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      member.id,
      householdId,
      member.display_name,
      member.is_primary ? 1 : 0,
      encodeJson(member.dietary_restrictions),
      encodeJson(member.allergies),
      encodeJson(member.never_recommend_ingredients),
      member.created_at_utc,
    );
  }

  listMembers(householdId: Uuid): HouseholdMember[] {
    const rows = this.#prepare(
      'SELECT * FROM members WHERE household_id = ? ORDER BY created_at_utc, id',
    ).all(householdId) as Array<{
      id: string;
      household_id: string;
      display_name: string;
      is_primary: number;
      dietary_restrictions_json: string;
      allergies_json: string;
      never_recommend_json: string;
      created_at_utc: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      display_name: row.display_name,
      is_primary: row.is_primary !== 0,
      dietary_restrictions: decodeJson(row.dietary_restrictions_json) as HouseholdMember['dietary_restrictions'],
      allergies: decodeJson(row.allergies_json) as HouseholdMember['allergies'],
      never_recommend_ingredients: decodeJson(row.never_recommend_json) as readonly string[],
      created_at_utc: row.created_at_utc,
    }));
  }

  // --- preference signals --------------------------------------------------

  /** Insert or replace the signal for (member, attribute, attribute_value). */
  upsertPreferenceSignal(householdId: Uuid, signal: PreferenceSignalInput): void {
    const updated = this.#prepare(
      `UPDATE preference_signals
         SET value_num = ?, value_den = ?, confidence_num = ?, confidence_den = ?,
             durability = ?, source = ?, updated_at_utc = ?
       WHERE household_id = ? AND COALESCE(member_id, '') = COALESCE(?, '')
         AND attribute = ? AND attribute_value = ?`,
    ).run(
      num(signal.value),
      den(signal.value),
      num(signal.confidence),
      den(signal.confidence),
      signal.durability,
      signal.source,
      signal.updated_at_utc,
      householdId,
      signal.member_id,
      signal.attribute,
      signal.attribute_value,
    );
    if (Number(updated.changes) === 0) {
      this.#prepare(
        `INSERT INTO preference_signals
           (id, household_id, member_id, attribute, attribute_value,
            value_num, value_den, confidence_num, confidence_den,
            durability, source, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        signal.id,
        householdId,
        signal.member_id,
        signal.attribute,
        signal.attribute_value,
        num(signal.value),
        den(signal.value),
        num(signal.confidence),
        den(signal.confidence),
        signal.durability,
        signal.source,
        signal.updated_at_utc,
      );
    }
  }

  listPreferenceSignals(householdId: Uuid): PreferenceSignal[] {
    const rows = this.#prepare(
      'SELECT * FROM preference_signals WHERE household_id = ? ORDER BY attribute, attribute_value',
    ).all(householdId) as Array<{
      id: string;
      household_id: string;
      member_id: string | null;
      attribute: PreferenceSignal['attribute'];
      attribute_value: string;
      value_num: string;
      value_den: string;
      confidence_num: string;
      confidence_den: string;
      durability: PreferenceSignal['durability'];
      source: PreferenceSignal['source'];
      updated_at_utc: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      member_id: row.member_id,
      attribute: row.attribute,
      attribute_value: row.attribute_value,
      value: toRational(row.value_num, row.value_den),
      confidence: toRational(row.confidence_num, row.confidence_den),
      durability: row.durability,
      source: row.source,
      updated_at_utc: row.updated_at_utc,
    }));
  }

  // --- inventory -----------------------------------------------------------

  /** Insert or replace the entry for (ingredient, unit). */
  upsertInventoryEntry(householdId: Uuid, entry: InventoryEntryInput): void {
    const updated = this.#prepare(
      `UPDATE inventory_entries
         SET qty_num = ?, qty_den = ?, confidence = ?, source = ?,
             best_by_utc = ?, updated_at_utc = ?
       WHERE household_id = ? AND ingredient_id = ? AND unit = ?`,
    ).run(
      num(entry.quantity),
      den(entry.quantity),
      entry.confidence,
      entry.source,
      entry.best_by_utc,
      entry.updated_at_utc,
      householdId,
      entry.ingredient_id,
      entry.unit,
    );
    if (Number(updated.changes) === 0) {
      this.#prepare(
        `INSERT INTO inventory_entries
           (id, household_id, ingredient_id, qty_num, qty_den, unit,
            confidence, source, best_by_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        householdId,
        entry.ingredient_id,
        num(entry.quantity),
        den(entry.quantity),
        entry.unit,
        entry.confidence,
        entry.source,
        entry.best_by_utc,
        entry.updated_at_utc,
      );
    }
  }

  listInventoryEntries(householdId: Uuid): InventoryEntry[] {
    const rows = this.#prepare(
      'SELECT * FROM inventory_entries WHERE household_id = ? ORDER BY ingredient_id, unit',
    ).all(householdId) as Array<{
      id: string;
      household_id: string;
      ingredient_id: string;
      qty_num: string;
      qty_den: string;
      unit: InventoryEntry['unit'];
      confidence: InventoryEntry['confidence'];
      source: InventoryEntry['source'];
      best_by_utc: string | null;
      updated_at_utc: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      ingredient_id: row.ingredient_id,
      quantity: toRational(row.qty_num, row.qty_den),
      unit: row.unit,
      confidence: row.confidence,
      source: row.source,
      best_by_utc: row.best_by_utc,
      updated_at_utc: row.updated_at_utc,
    }));
  }

  // --- plans + plan meals --------------------------------------------------

  insertPlan(householdId: Uuid, plan: PlanInput): void {
    this.#prepare(
      'INSERT INTO plans (id, household_id, status, created_at_utc) VALUES (?, ?, ?, ?)',
    ).run(plan.id, householdId, plan.status, plan.created_at_utc);
  }

  getPlan(householdId: Uuid, planId: Uuid): Plan | undefined {
    const row = this.#prepare('SELECT * FROM plans WHERE household_id = ? AND id = ?').get(
      householdId,
      planId,
    ) as
      | { id: string; household_id: string; status: Plan['status']; created_at_utc: string }
      | undefined;
    if (row === undefined) return undefined;
    return {
      id: row.id,
      household_id: row.household_id,
      status: row.status,
      created_at_utc: row.created_at_utc,
    };
  }

  listPlans(householdId: Uuid): Plan[] {
    const rows = this.#prepare(
      'SELECT * FROM plans WHERE household_id = ? ORDER BY created_at_utc, id',
    ).all(householdId) as Array<{
      id: string;
      household_id: string;
      status: Plan['status'];
      created_at_utc: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      status: row.status,
      created_at_utc: row.created_at_utc,
    }));
  }

  insertPlanMeal(householdId: Uuid, meal: PlanMealInput): void {
    this.#prepare(
      `INSERT INTO plan_meals
         (id, household_id, plan_id, recipe_id, slot, target_servings, status,
          reason_codes_json, score_breakdown_json, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      meal.id,
      householdId,
      meal.plan_id,
      meal.recipe_id,
      meal.slot,
      meal.target_servings,
      meal.status,
      encodeJson(meal.reason_codes),
      encodeJson(meal.score),
      meal.created_at_utc,
    );
  }

  listPlanMeals(householdId: Uuid, planId: Uuid): PlanMeal[] {
    const rows = this.#prepare(
      'SELECT * FROM plan_meals WHERE household_id = ? AND plan_id = ? ORDER BY slot',
    ).all(householdId, planId) as Array<{
      id: string;
      household_id: string;
      plan_id: string;
      recipe_id: string;
      slot: number;
      target_servings: number;
      status: PlanMealStatus;
      reason_codes_json: string;
      score_breakdown_json: string;
      created_at_utc: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      plan_id: row.plan_id,
      recipe_id: row.recipe_id,
      slot: row.slot,
      target_servings: row.target_servings,
      status: row.status,
      reason_codes: decodeJson(row.reason_codes_json) as PlanMeal['reason_codes'],
      score: decodeJson(row.score_breakdown_json) as ScoreBreakdown,
      created_at_utc: row.created_at_utc,
    }));
  }

  updatePlanMealStatus(householdId: Uuid, planMealId: Uuid, status: PlanMealStatus): void {
    this.#prepare('UPDATE plan_meals SET status = ? WHERE household_id = ? AND id = ?').run(
      status,
      householdId,
      planMealId,
    );
  }

  // --- grocery lists + lines ----------------------------------------------

  insertGroceryList(householdId: Uuid, list: GroceryListInput): void {
    this.#prepare(
      `INSERT INTO grocery_lists (id, household_id, plan_id, status, created_at_utc, regenerated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(list.id, householdId, list.plan_id, list.status, list.created_at_utc, list.regenerated_at_utc);
  }

  getGroceryList(householdId: Uuid, listId: Uuid): GroceryList | undefined {
    const row = this.#prepare('SELECT * FROM grocery_lists WHERE household_id = ? AND id = ?').get(
      householdId,
      listId,
    ) as
      | {
          id: string;
          household_id: string;
          plan_id: string;
          status: GroceryList['status'];
          created_at_utc: string;
          regenerated_at_utc: string | null;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      id: row.id,
      household_id: row.household_id,
      plan_id: row.plan_id,
      status: row.status,
      created_at_utc: row.created_at_utc,
      regenerated_at_utc: row.regenerated_at_utc,
    };
  }

  insertGroceryLine(householdId: Uuid, line: GroceryLineInput): void {
    this.#prepare(
      `INSERT INTO grocery_lines
         (id, household_id, grocery_list_id, ingredient_id, display_name, store_section,
          unit, required_num, required_den, deducted_num, deducted_den,
          package_description, is_estimate, surplus_num, surplus_den,
          contributions_json, checked, user_edited_num, user_edited_den)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      line.id,
      householdId,
      line.grocery_list_id,
      line.ingredient_id,
      line.display_name,
      line.store_section,
      line.unit,
      num(line.required_quantity),
      den(line.required_quantity),
      num(line.inventory_deducted),
      den(line.inventory_deducted),
      line.package_description,
      line.is_estimate ? 1 : 0,
      num(line.expected_surplus),
      den(line.expected_surplus),
      encodeJson(line.contributions),
      line.checked ? 1 : 0,
    );
  }

  listGroceryLines(householdId: Uuid, listId: Uuid): GroceryLine[] {
    const rows = this.#prepare(
      'SELECT * FROM grocery_lines WHERE household_id = ? AND grocery_list_id = ? ORDER BY store_section, display_name',
    ).all(householdId, listId) as Array<{
      id: string;
      household_id: string;
      grocery_list_id: string;
      ingredient_id: string;
      display_name: string;
      store_section: GroceryLine['store_section'];
      unit: GroceryLine['unit'];
      required_num: string;
      required_den: string;
      deducted_num: string;
      deducted_den: string;
      package_description: string | null;
      is_estimate: number;
      surplus_num: string;
      surplus_den: string;
      contributions_json: string;
      checked: number;
      user_edited_num: string | null;
      user_edited_den: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      grocery_list_id: row.grocery_list_id,
      ingredient_id: row.ingredient_id,
      display_name: row.display_name,
      store_section: row.store_section,
      unit: row.unit,
      required_quantity: toRational(row.required_num, row.required_den),
      inventory_deducted: toRational(row.deducted_num, row.deducted_den),
      package_description: row.package_description,
      is_estimate: row.is_estimate !== 0,
      expected_surplus: toRational(row.surplus_num, row.surplus_den),
      user_edited_quantity:
        row.user_edited_num !== null && row.user_edited_den !== null
          ? toRational(row.user_edited_num, row.user_edited_den)
          : null,
      checked: row.checked !== 0,
      contributions: decodeJson(row.contributions_json) as readonly GroceryContribution[],
    }));
  }

  /** Regeneration write-path: updates ONLY the computed columns. The
   * user-edit columns do not appear in this statement, so regeneration
   * cannot clobber them — by construction, not by convention. */
  updateGroceryLineComputed(householdId: Uuid, lineId: Uuid, patch: GroceryLineComputedPatch): void {
    this.#prepare(
      `UPDATE grocery_lines
         SET required_num = ?, required_den = ?, deducted_num = ?, deducted_den = ?,
             package_description = ?, is_estimate = ?, surplus_num = ?, surplus_den = ?,
             contributions_json = ?
       WHERE household_id = ? AND id = ?`,
    ).run(
      num(patch.required_quantity),
      den(patch.required_quantity),
      num(patch.inventory_deducted),
      den(patch.inventory_deducted),
      patch.package_description,
      patch.is_estimate ? 1 : 0,
      num(patch.expected_surplus),
      den(patch.expected_surplus),
      encodeJson(patch.contributions),
      householdId,
      lineId,
    );
  }

  /** The ONLY write-path for the user-edit columns. null clears the edit. */
  setUserEditedQuantity(householdId: Uuid, lineId: Uuid, quantity: Rational | null): void {
    this.#prepare(
      'UPDATE grocery_lines SET user_edited_num = ?, user_edited_den = ? WHERE household_id = ? AND id = ?',
    ).run(
      quantity === null ? null : num(quantity),
      quantity === null ? null : den(quantity),
      householdId,
      lineId,
    );
  }

  setGroceryLineChecked(householdId: Uuid, lineId: Uuid, checked: boolean): void {
    this.#prepare('UPDATE grocery_lines SET checked = ? WHERE household_id = ? AND id = ?').run(
      checked ? 1 : 0,
      householdId,
      lineId,
    );
  }

  // --- cooking sessions + events ------------------------------------------

  insertCookingSession(householdId: Uuid, session: CookingSessionInput): void {
    this.#prepare(
      `INSERT INTO cooking_sessions
         (id, household_id, plan_meal_id, recipe_id, target_servings, status,
          current_step_index, timers_json, started_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      session.id,
      householdId,
      session.plan_meal_id,
      session.recipe_id,
      session.target_servings,
      session.status,
      session.current_step_index,
      encodeJson(session.timers),
      session.started_at_utc,
      session.updated_at_utc,
    );
  }

  getCookingSession(householdId: Uuid, sessionId: Uuid): CookingSession | undefined {
    const row = this.#prepare(
      'SELECT * FROM cooking_sessions WHERE household_id = ? AND id = ?',
    ).get(householdId, sessionId) as
      | {
          id: string;
          household_id: string;
          plan_meal_id: string | null;
          recipe_id: string;
          target_servings: number;
          status: CookingSessionStatus;
          current_step_index: number;
          timers_json: string;
          started_at_utc: string;
          updated_at_utc: string;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      id: row.id,
      household_id: row.household_id,
      plan_meal_id: row.plan_meal_id,
      recipe_id: row.recipe_id,
      target_servings: row.target_servings,
      status: row.status,
      current_step_index: row.current_step_index,
      timers: decodeJson(row.timers_json) as readonly CookingTimer[],
      started_at_utc: row.started_at_utc,
      updated_at_utc: row.updated_at_utc,
    };
  }

  /** Write the full recoverable state in one statement (kill-safe). */
  updateCookingSession(householdId: Uuid, sessionId: Uuid, patch: CookingSessionPatch): void {
    this.#prepare(
      `UPDATE cooking_sessions
         SET status = ?, current_step_index = ?, timers_json = ?, updated_at_utc = ?
       WHERE household_id = ? AND id = ?`,
    ).run(
      patch.status,
      patch.current_step_index,
      encodeJson(patch.timers),
      patch.updated_at_utc,
      householdId,
      sessionId,
    );
  }

  appendCookingEvent(householdId: Uuid, event: CookingEventInput): void {
    this.#prepare(
      `INSERT INTO cooking_events (id, household_id, session_id, seq, occurred_at_utc, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      householdId,
      event.session_id,
      event.seq,
      event.occurred_at_utc,
      encodeJson(event.payload),
    );
  }

  listCookingEvents(householdId: Uuid, sessionId: Uuid): CookingEvent[] {
    const rows = this.#prepare(
      'SELECT * FROM cooking_events WHERE household_id = ? AND session_id = ? ORDER BY seq',
    ).all(householdId, sessionId) as Array<{
      id: string;
      household_id: string;
      session_id: string;
      seq: number;
      occurred_at_utc: string;
      payload_json: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      session_id: row.session_id,
      seq: row.seq,
      occurred_at_utc: row.occurred_at_utc,
      payload: decodeJson(row.payload_json) as CookingEventPayload,
    }));
  }

  // --- feedback ------------------------------------------------------------

  insertFeedback(householdId: Uuid, fb: MealFeedbackInput): void {
    this.#prepare(
      `INSERT INTO feedback (id, household_id, plan_meal_id, recipe_id, verdict, reason, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(fb.id, householdId, fb.plan_meal_id, fb.recipe_id, fb.verdict, fb.reason, fb.created_at_utc);
  }

  listFeedback(householdId: Uuid): MealFeedback[] {
    const rows = this.#prepare(
      'SELECT * FROM feedback WHERE household_id = ? ORDER BY created_at_utc, id',
    ).all(householdId) as Array<{
      id: string;
      household_id: string;
      plan_meal_id: string;
      recipe_id: string;
      verdict: MealFeedback['verdict'];
      reason: MealFeedback['reason'];
      created_at_utc: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      household_id: row.household_id,
      plan_meal_id: row.plan_meal_id,
      recipe_id: row.recipe_id,
      verdict: row.verdict,
      reason: row.reason,
      created_at_utc: row.created_at_utc,
    }));
  }
}
