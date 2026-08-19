/**
 * routes.ts — every `/api/*` route, composed from the frozen domain modules
 * and the frozen `db.ts` data layer (FROZEN HTTP CONTRACT v1, cycle 12).
 *
 * Invariant 3 (DESIGN.md) is structural here by construction: every db call
 * in this file goes through a `DinnerDb` method, and every one of those
 * methods takes `household_id` as a required first argument. There is no
 * raw-query escape hatch to misuse — an unscoped read/write is not
 * expressible from this file.
 *
 * Wire codec: every `Rational` crosses the wire as `{"n":"<num>","d":"<den>"}`
 * (STRINGS — bigints are not JSON-safe). `qty.ts` exports `rationalToJson`/
 * `rationalFromJson` using `{num,den}` field names for its own (db-facing)
 * codec; this module's `encodeRational`/`decodeRational` just remap those
 * two field names to the wire's `n`/`d` — the arithmetic and canonicalisation
 * stay entirely inside `qty.ts` (Invariant 1). No bigint is ever
 * `JSON.stringify`d directly.
 */

import { randomUUID } from 'node:crypto';
import type { DinnerDb } from './db.ts';
import type { JsonRouteContext, RouteDef, RouteResult } from './http.ts';
import { HttpError, createRequestListener } from './http.ts';

import type { Rational } from '../../domain/src/qty.ts';
import { ONE, add, eq, isZero, rationalFromJson, rationalToJson, sign, sub, toMixedString } from '../../domain/src/qty.ts';

import type {
  Allergen,
  AttributeVector,
  CalibrationReaction,
  CookingEvent,
  CookingEventPayload,
  CookingTimer,
  DietaryTag,
  FeedbackReason,
  FeedbackVerdict,
  GroceryContribution,
  Household,
  HouseholdMember,
  IngredientId,
  IngredientQuantity,
  InventoryEntry,
  NoveltyPreference,
  PlanMeal,
  PreferenceSignal,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
  ReasonCode,
  StoreSection,
  SwapReason,
  Unit,
  Uuid,
} from '../../domain/src/recipe.ts';

import type { IngredientRegistry } from '../../domain/src/catalog.ts';
import { HARD_FILTER_CONFIG, applyHardFilters, signalAppliesToRecipe } from '../../domain/src/filters.ts';
import type { HardFilterResult, PlanningContext, RecentMeal } from '../../domain/src/filters.ts';
import { SCORE_CONFIG, scoreSurvivors } from '../../domain/src/score.ts';
import { PLANSET_CONFIG, buildPlanSet } from '../../domain/src/planset.ts';
import type { ChosenMeal } from '../../domain/src/planset.ts';
import { CALIBRATION_CONFIG, selectCalibrationCards } from '../../domain/src/calibration.ts';
import { applyCalibrationReaction, applyFeedbackEvent, mergeSignal } from '../../domain/src/preferences.ts';
import type { PreferenceSignalUpdate } from '../../domain/src/preferences.ts';
import { SWAP_CONFIG, SWAP_RANK_TERM_NAMES, familiarityOf, swapMeal } from '../../domain/src/swap.ts';
import type { SwapAlternative, SwapMealInput, SwapNoAlternativesCode, SwapRankBreakdown } from '../../domain/src/swap.ts';
import { aggregateRequirements } from '../../domain/src/aggregate.ts';
import { subtractInventory } from '../../domain/src/inventoryMath.ts';
import { selectPackages } from '../../domain/src/packaging.ts';
import { scaleRecipeRequirements } from '../../domain/src/scale.ts';
import {
  CookingError,
  attentionWarnings as domainAttentionWarnings,
  nextSafeStop as domainNextSafeStop,
  reconstructSession,
} from '../../domain/src/cooking.ts';
import type { AttentionWarning, CookingSessionView, NextSafeStop } from '../../domain/src/cooking.ts';
import { derivePrepPlan } from '../../domain/src/prep.ts';
import type { PrepPlan } from '../../domain/src/prep.ts';
import {
  MAX_REASON_CODES_PER_MEAL,
  NO_RECOVERY_GUIDANCE_TEXT,
  derivePlanShortfall,
  renderMealReasons,
  renderTotalActiveTime,
  renderTotalActiveTimeFor,
} from '../../domain/src/reasons.ts';
import type { PlanShortfallExplanation, ReasonFact } from '../../domain/src/reasons.ts';

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

export interface AppDeps {
  readonly db: DinnerDb;
  /** Catalog-gate-eligible recipes only (T-014 never sees an excluded one). */
  readonly catalog: readonly Recipe[];
  readonly registry: IngredientRegistry;
  readonly webRoot: string;
}

interface Deps extends AppDeps {
  readonly catalogMap: ReadonlyMap<Uuid, Recipe>;
}

/** Build the full `node:http` request listener: every route below, plus
 * static serving of `webRoot` for everything outside `/api/`. */
export function createApp(deps: AppDeps): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void {
  const full: Deps = { ...deps, catalogMap: new Map(deps.catalog.map((r) => [r.id, r])) };
  return createRequestListener(buildRoutes(full), deps.webRoot);
}

// ---------------------------------------------------------------------------
// Small structural helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bodyObject(ctx: JsonRouteContext): Record<string, unknown> {
  return isPlainObject(ctx.body) ? ctx.body : {};
}

function encodeRational(r: Rational): { n: string; d: string } {
  const j = rationalToJson(r);
  return { n: j.num, d: j.den };
}

function decodeRational(v: unknown): Rational | null {
  if (!isPlainObject(v)) return null;
  const n = v['n'];
  const d = v['d'];
  if (typeof n !== 'string' || typeof d !== 'string') return null;
  try {
    return rationalFromJson({ num: n, den: d });
  } catch {
    return null;
  }
}

/** `plan_meal_id` columns (cooking_sessions, feedback) carry a REAL foreign
 * key to plan_meals(id) in the frozen schema. A syntactically-fine but
 * nonexistent id is a client input error (400), not a server fault (500) —
 * this converts SQLite's raw constraint error into the honest envelope
 * instead of letting it fall through as an opaque `internal_error`. */
function runPlanMealInsert(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (err instanceof Error && err.message.includes('FOREIGN KEY constraint failed')) {
      throw new HttpError(400, 'invalid_plan_meal_id', 'plan_meal_id does not reference an existing plan meal.');
    }
    throw err;
  }
}

function requireHousehold(db: DinnerDb, householdId: string): Household {
  const household = db.getHousehold(householdId);
  if (household === undefined) {
    throw new HttpError(404, 'household_not_found', 'No household with that id.');
  }
  return household;
}

// Frozen-union membership sets (mirrors the literal unions in recipe.ts —
// the same pattern catalog.ts's ALL_* tables already use for the same
// reason: validating raw JSON against a closed union needs a value list).
const NOVELTY_PREFERENCES = new Set<string>(['stick_to_favourites', 'mostly_familiar', 'adventurous']);
const DIETARY_TAGS = new Set<string>([
  'vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free',
  'nut_free', 'egg_free', 'soy_free', 'shellfish_free', 'low_carb',
]);
const ALLERGENS = new Set<string>([
  'peanut', 'tree_nut', 'dairy', 'egg', 'gluten', 'wheat', 'soy', 'fish',
  'shellfish', 'sesame', 'mustard', 'sulfite',
]);
const UNITS = new Set<string>(['g', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz', 'count']);
const SWAP_REASONS = new Set<string>([
  'faster', 'less_hands_on', 'fewer_dishes', 'cheaper', 'more_familiar',
  'more_adventurous', 'no_pasta', 'different_protein', 'use_what_i_have',
]);
const CALIBRATION_REACTIONS = new Set<string>(['looks_good', 'not_for_me', 'never_recommend', 'too_much_work']);
const FEEDBACK_VERDICTS = new Set<string>(['make_again', 'it_was_fine', 'not_again']);
const FEEDBACK_REASONS = new Set<string>([
  'too_much_work', 'took_longer_than_expected', 'too_bland', 'too_spicy',
  'easy_with_interruptions', 'not_filling',
]);

function parseStringUnionArray<T extends string>(v: unknown, allowed: ReadonlySet<string>): readonly T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || !allowed.has(item)) return null;
    out.push(item as T);
  }
  return out;
}

function parseOptionalPositiveInt(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return 'invalid';
}

// ---------------------------------------------------------------------------
// Planning-context derivation
//
// GAP (documented in the return summary): `db.ts` has no `cooked_at`
// timestamp anywhere — a plan_meal's status can become 'cooked' but no
// column records WHEN. `PlanningContext.recent_meals` needs a `days_ago`
// per past meal for the hard-repeat filter, the repeat penalties, and
// novelty/familiarity scoring. In the absence of a better signal, this
// derives recency from `MealFeedback.created_at_utc` (feedback is posted
// right after cooking, per SPEC) for every feedback row whose recipe is
// still catalog-eligible. This is honest (every number is real) but is
// not a substitute for a proper cooked_at column.
// ---------------------------------------------------------------------------

function deriveRecentMeals(db: DinnerDb, householdId: string, catalogMap: ReadonlyMap<Uuid, Recipe>, nowMs: number): readonly RecentMeal[] {
  const out: RecentMeal[] = [];
  for (const fb of db.listFeedback(householdId)) {
    const recipe = catalogMap.get(fb.recipe_id);
    if (recipe === undefined) continue;
    const thenMs = Date.parse(fb.created_at_utc);
    if (Number.isNaN(thenMs)) continue;
    const daysAgo = Math.max(0, Math.floor((nowMs - thenMs) / 86_400_000));
    out.push({ recipe_id: fb.recipe_id, attributes: recipe.attributes, days_ago: daysAgo });
  }
  return out;
}

function loadPlanningContext(db: DinnerDb, householdId: string, catalogMap: ReadonlyMap<Uuid, Recipe>): PlanningContext {
  return { recent_meals: deriveRecentMeals(db, householdId, catalogMap, Date.now()) };
}

interface ScoredSurvivors {
  readonly filtered: HardFilterResult;
  readonly scores: readonly import('../../domain/src/recipe.ts').ScoreBreakdown[];
}

function computeSurvivorsAndScores(
  deps: Deps,
  household: Household,
  members: readonly HouseholdMember[],
  signals: readonly PreferenceSignal[],
  inventory: readonly InventoryEntry[],
  context: PlanningContext,
): ScoredSurvivors {
  const filtered = applyHardFilters(deps.catalog, household, members, signals, deps.registry, context, HARD_FILTER_CONFIG);
  const scores = scoreSurvivors(filtered, household, signals, inventory, context, SCORE_CONFIG);
  return { filtered, scores };
}

// ---------------------------------------------------------------------------
// Ingredient-id helpers shared by meal-view and reason-fact reconstruction
// ---------------------------------------------------------------------------

function requiredIngredientIdSet(recipe: Recipe): ReadonlySet<IngredientId> {
  const s = new Set<IngredientId>();
  for (const line of recipe.ingredients) {
    if (!line.optional) s.add(line.ingredient_id);
  }
  return s;
}

function usableInventoryIds(inventory: readonly InventoryEntry[]): ReadonlySet<IngredientId> {
  const usable = new Set<IngredientId>();
  for (const e of inventory) {
    if ((e.confidence === 'confirmed' || e.confidence === 'assumed_staple') && sign(e.quantity) === 1) {
      usable.add(e.ingredient_id);
    }
  }
  return usable;
}

function ownedIngredientIds(recipe: Recipe, inventory: readonly InventoryEntry[]): readonly IngredientId[] {
  const usable = usableInventoryIds(inventory);
  const out: IngredientId[] = [];
  for (const line of recipe.ingredients) {
    if (!line.optional && usable.has(line.ingredient_id) && !out.includes(line.ingredient_id)) {
      out.push(line.ingredient_id);
    }
  }
  return out;
}

function ownedIngredientCounts(recipe: Recipe, inventory: readonly InventoryEntry[]): { readonly owned: number; readonly total: number } {
  const usable = usableInventoryIds(inventory);
  let total = 0;
  let owned = 0;
  for (const line of recipe.ingredients) {
    if (line.optional) continue;
    total += 1;
    if (usable.has(line.ingredient_id)) owned += 1;
  }
  return { owned, total };
}

function familiarityBucket(fraction: Rational): 'familiar' | 'adjacent' | 'novel' {
  if (isZero(fraction)) return 'novel';
  if (eq(fraction, ONE)) return 'familiar';
  return 'adjacent';
}

// ---------------------------------------------------------------------------
// Reason-fact reconstruction
//
// GAP (documented in the return summary): `PlanMeal.reason_codes` (frozen
// in recipe.ts) persists only the `ReasonCode` enum values, never the full
// `ReasonFact` numeric payload (`total_seconds`, `shared_count`, …) that
// `planset.ts`/`swap.ts` computed at the moment a meal was chosen. On every
// READ of a persisted plan (GET .../current, the plan returned after a swap
// accept), this reconstructs a fresh, truthful `ReasonFact` for each stored
// code from the CURRENT recipe/plan/inventory state — every number in the
// reconstruction is real, but for the taste- and novelty-driven codes
// (`matches_taste`, `adjacent_novelty`, `familiar_favourite`) the specific
// evidence cited may differ from what was shown at the original moment,
// because that evidence itself was never persisted. This is unavoidable
// without a schema change to the frozen `recipe.ts`/`db.ts` contracts.
// ---------------------------------------------------------------------------

interface ReasonReconstructionAux {
  readonly inventory: readonly InventoryEntry[];
  readonly signals: readonly PreferenceSignal[];
  readonly context: PlanningContext;
  readonly siblingRecipes: readonly Recipe[];
  readonly householdSize: number;
}

function reconstructReasonFact(code: ReasonCode, recipe: Recipe, aux: ReasonReconstructionAux): ReasonFact {
  switch (code) {
    case 'quick_total_time':
      return { code, total_seconds: recipe.total_time_seconds, active_seconds: recipe.active_time_seconds };
    case 'low_active_time':
      return { code, total_seconds: recipe.total_time_seconds, active_seconds: recipe.active_time_seconds };
    case 'few_dishes':
      return { code, dish_count: recipe.dish_count };
    case 'budget_friendly':
      return { code, cost_band: recipe.cost_band, ingredient_count: requiredIngredientIdSet(recipe).size };
    case 'uses_owned_ingredients': {
      const counts = ownedIngredientCounts(recipe, aux.inventory);
      return { code, owned_count: counts.owned, total_count: counts.total };
    }
    case 'shares_ingredients': {
      const mine = requiredIngredientIdSet(recipe);
      let best: Recipe | null = null;
      let bestShared = 0;
      for (const other of aux.siblingRecipes) {
        const theirs = requiredIngredientIdSet(other);
        let shared = 0;
        for (const id of mine) if (theirs.has(id)) shared += 1;
        if (shared > bestShared) {
          bestShared = shared;
          best = other;
        }
      }
      return { code, shared_count: bestShared, other_meal_name: best !== null ? best.name : recipe.name };
    }
    case 'interruption_friendly': {
      const pausable = recipe.steps.filter((s) => s.safe_to_pause_during || s.natural_stopping_point).length;
      return { code, pausable_step_count: pausable, total_step_count: recipe.steps.length };
    }
    case 'familiar_favourite': {
      const timesCooked = aux.context.recent_meals.filter((m) => m.recipe_id === recipe.id).length;
      return { code, times_cooked: timesCooked };
    }
    case 'leftover_friendly': {
      const extra = Math.max(0, recipe.servings_default - aux.householdSize);
      return { code, extra_servings: extra };
    }
    case 'matches_taste': {
      const applying = aux.signals.filter((s) => sign(s.value) === 1 && signalAppliesToRecipe(s, recipe.attributes));
      const first = applying[0];
      if (first !== undefined) {
        return { code, attribute: first.attribute, attribute_value: first.attribute_value, signal_count: applying.length };
      }
      return { code, attribute: 'protein', attribute_value: recipe.attributes.protein, signal_count: 0 };
    }
    case 'adjacent_novelty': {
      const a = recipe.attributes;
      return { code, familiar_attribute: 'protein', familiar_value: a.protein, new_attribute: 'cuisine', new_value: a.cuisine };
    }
  }
}

// ---------------------------------------------------------------------------
// View shapes: meal / plan
// ---------------------------------------------------------------------------

interface MealData {
  readonly slot: number;
  readonly recipe: Recipe;
  readonly facts: readonly ReasonFact[];
  /** The persisted plan_meal row id, or null for a not-yet-accepted swap
   * offer. ADDED to MealView beyond the frozen field list — see the
   * "plan_meal_id" contract deviation in the return summary: POST
   * /api/feedback and POST /api/cooking/sessions both REQUIRE a
   * plan_meal_id (and db.ts enforces it with a real foreign key), but the
   * frozen MealView shape never exposes one, so no real client could ever
   * supply a valid value without this addition. */
  readonly planMealId: string | null;
}

interface PlanAux {
  readonly inventory: readonly InventoryEntry[];
  readonly signals: readonly PreferenceSignal[];
  readonly context: PlanningContext;
}

function buildMealView(m: MealData, allMeals: readonly MealData[], aux: PlanAux): Record<string, unknown> {
  const recipe = m.recipe;
  const time = renderTotalActiveTimeFor(recipe);
  const attentionSteps = recipe.steps.filter((s) => s.requires_continuous_attention);
  let longest = 0;
  for (const s of attentionSteps) {
    longest = Math.max(longest, s.active_duration_seconds + s.unattended_duration_seconds);
  }
  const stop = domainNextSafeStop(recipe.steps, 0);
  const nextSafeStopIndex = stop.kind === 'end_of_recipe' ? null : stop.step_index;

  const mine = requiredIngredientIdSet(recipe);
  const sharedWithSlots: number[] = [];
  for (const other of allMeals) {
    if (other.slot === m.slot) continue;
    const theirs = requiredIngredientIdSet(other.recipe);
    for (const id of mine) {
      if (theirs.has(id)) {
        sharedWithSlots.push(other.slot);
        break;
      }
    }
  }
  sharedWithSlots.sort((a, b) => a - b);

  const familiarity = familiarityBucket(familiarityOf(recipe.attributes, aux.signals, aux.context));
  const facts = m.facts.length > MAX_REASON_CODES_PER_MEAL ? m.facts.slice(0, MAX_REASON_CODES_PER_MEAL) : m.facts;

  return {
    slot: m.slot,
    recipe_id: recipe.id,
    plan_meal_id: m.planMealId,
    name: recipe.name,
    total_seconds: time.total_seconds,
    active_seconds: time.active_seconds,
    time_label: time.combined_label,
    interruption: {
      has_continuous_attention_step: attentionSteps.length > 0,
      longest_continuous_seconds: longest,
      next_safe_stop_step_index: nextSafeStopIndex,
    },
    effort: recipe.attributes.effort,
    dish_count: recipe.dish_count,
    cost_band: recipe.cost_band,
    familiarity,
    reasons: renderMealReasons(facts),
    owned_ingredient_ids: ownedIngredientIds(recipe, aux.inventory),
    shared_with_slots: sharedWithSlots,
  };
}

function buildPlanView(planId: Uuid, createdAt: string, mealsData: readonly MealData[], aux: PlanAux): Record<string, unknown> {
  const sorted = [...mealsData].sort((a, b) => a.slot - b.slot);
  return {
    plan_id: planId,
    created_at_utc: createdAt,
    meals: sorted.map((m) => buildMealView(m, mealsData, aux)),
  };
}

/** The active (not `swapped_out`) plan_meal rows for a plan, reconstructed
 * into `MealData` with fresh reason facts from the stored codes. May be
 * empty — an empty result is a REAL state (T-041: an empty/short plan is
 * not a "no plan" state), never collapsed to null here. */
function planMealsData(deps: Deps, household: Household, planId: Uuid, aux: PlanAux): readonly MealData[] {
  const rows = deps.db.listPlanMeals(household.id, planId).filter((r) => r.status !== 'swapped_out');
  const withRecipes = rows
    .map((row) => ({ row, recipe: deps.catalogMap.get(row.recipe_id) }))
    .filter((x): x is { row: PlanMeal; recipe: Recipe } => x.recipe !== undefined);
  const siblingRecipesAll = withRecipes.map((w) => w.recipe);
  return withRecipes.map((w) => ({
    slot: w.row.slot,
    recipe: w.recipe,
    planMealId: w.row.id,
    facts: w.row.reason_codes.map((code) =>
      reconstructReasonFact(code, w.recipe, {
        inventory: aux.inventory,
        signals: aux.signals,
        context: aux.context,
        siblingRecipes: siblingRecipesAll.filter((r) => r.id !== w.recipe.id),
        householdSize: household.household_size,
      }),
    ),
  }));
}

/** Rebuild a `PlanView` entirely from persisted state. Returns null when the
 * plan has no active meals — used ONLY by the swap route (a swap always
 * starts from three active meals, so null is unreachable there in
 * practice). `GET /api/plans/current` does NOT use this: it needs to tell
 * the truth about a zero/short-meal plan rather than report "no plan". */
function buildFullPlanView(deps: Deps, household: Household, planId: Uuid, createdAt: string, aux: PlanAux): Record<string, unknown> | null {
  const mealsData = planMealsData(deps, household, planId, aux);
  if (mealsData.length === 0) return null;
  return buildPlanView(planId, createdAt, mealsData, aux);
}

/** Attaches the honest empty/partial/full state + shortfall explanation
 * (T-041 acceptance 1-3) to an already-built plan view. Never a bare
 * `meals: []` with no further information. */
function withShortfall(view: Record<string, unknown>, mealCount: number, shortfall: PlanShortfallExplanation | null): Record<string, unknown> {
  return {
    ...view,
    is_partial: mealCount > 0 && mealCount < PLANSET_CONFIG.meals_per_plan,
    is_empty: mealCount === 0,
    shortfall,
  };
}

// ---------------------------------------------------------------------------
// Route: GET /api/health
// ---------------------------------------------------------------------------

function handleHealth(): RouteResult {
  return { status: 200, body: { ok: true } };
}

// ---------------------------------------------------------------------------
// Route: POST /api/households
// ---------------------------------------------------------------------------

function encodeHousehold(h: Household): Record<string, unknown> {
  return {
    id: h.id,
    name: h.name,
    household_size: h.household_size,
    novelty_preference: h.novelty_preference,
    weeknight_active_time_ceiling_seconds: h.weeknight_active_time_ceiling_seconds,
    weeknight_total_time_ceiling_seconds: h.weeknight_total_time_ceiling_seconds,
    created_at_utc: h.created_at_utc,
  };
}

function encodeMember(m: HouseholdMember): Record<string, unknown> {
  return {
    id: m.id,
    household_id: m.household_id,
    display_name: m.display_name,
    is_primary: m.is_primary,
    dietary_restrictions: m.dietary_restrictions,
    allergies: m.allergies,
    never_recommend_ingredients: m.never_recommend_ingredients,
    created_at_utc: m.created_at_utc,
  };
}

function handleCreateHousehold(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const body = bodyObject(ctx);
  const householdRaw = body['household'];
  const memberRaw = body['member'];
  if (!isPlainObject(householdRaw)) throw new HttpError(400, 'invalid_household', 'household must be an object.');
  if (!isPlainObject(memberRaw)) throw new HttpError(400, 'invalid_member', 'member must be an object.');

  const name = householdRaw['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new HttpError(400, 'invalid_household_name', 'household.name must be a non-empty string.');
  }
  const size = householdRaw['household_size'];
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    throw new HttpError(400, 'invalid_household_size', 'household.household_size must be a positive integer.');
  }
  const novelty = householdRaw['novelty_preference'];
  if (typeof novelty !== 'string' || !NOVELTY_PREFERENCES.has(novelty)) {
    throw new HttpError(
      400,
      'invalid_novelty_preference',
      'household.novelty_preference must be one of stick_to_favourites | mostly_familiar | adventurous.',
    );
  }
  const activeCeiling = parseOptionalPositiveInt(householdRaw['weeknight_active_time_ceiling_seconds']);
  if (activeCeiling === 'invalid') {
    throw new HttpError(400, 'invalid_time_ceiling', 'household.weeknight_active_time_ceiling_seconds must be null or a positive integer.');
  }
  const totalCeiling = parseOptionalPositiveInt(householdRaw['weeknight_total_time_ceiling_seconds']);
  if (totalCeiling === 'invalid') {
    throw new HttpError(400, 'invalid_time_ceiling', 'household.weeknight_total_time_ceiling_seconds must be null or a positive integer.');
  }

  const displayName = memberRaw['display_name'];
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    throw new HttpError(400, 'invalid_member_display_name', 'member.display_name must be a non-empty string.');
  }
  const dietary = parseStringUnionArray<DietaryTag>(memberRaw['dietary_restrictions'], DIETARY_TAGS);
  if (dietary === null) {
    throw new HttpError(400, 'invalid_dietary_restriction', 'member.dietary_restrictions must be an array of valid dietary tags.');
  }
  const allergies = parseStringUnionArray<Allergen>(memberRaw['allergies'], ALLERGENS);
  if (allergies === null) {
    throw new HttpError(400, 'invalid_allergy', 'member.allergies must be an array of valid allergens.');
  }
  const neverRecommendRaw = memberRaw['never_recommend_ingredients'];
  if (!Array.isArray(neverRecommendRaw) || !neverRecommendRaw.every((x) => typeof x === 'string')) {
    throw new HttpError(400, 'invalid_never_recommend_ingredients', 'member.never_recommend_ingredients must be an array of strings.');
  }
  const neverRecommend = neverRecommendRaw;

  const staplesRaw = body['assumed_staples'];
  const staples: { ingredient_id: string; quantity: Rational; unit: Unit }[] = [];
  if (staplesRaw !== undefined) {
    if (!Array.isArray(staplesRaw)) throw new HttpError(400, 'invalid_assumed_staples', 'assumed_staples must be an array.');
    staplesRaw.forEach((raw: unknown, i: number) => {
      if (!isPlainObject(raw)) throw new HttpError(400, 'invalid_staple', `assumed_staples[${String(i)}] must be an object.`);
      const ingredientId = raw['ingredient_id'];
      if (typeof ingredientId !== 'string' || ingredientId.trim() === '') {
        throw new HttpError(400, 'invalid_staple_ingredient_id', `assumed_staples[${String(i)}].ingredient_id must be a non-empty string.`);
      }
      const quantity = decodeRational(raw['quantity']);
      if (quantity === null) {
        throw new HttpError(400, 'invalid_staple_quantity', `assumed_staples[${String(i)}].quantity must be {"n","d"} strings.`);
      }
      const unit = raw['unit'];
      if (typeof unit !== 'string' || !UNITS.has(unit)) {
        throw new HttpError(400, 'invalid_staple_unit', `assumed_staples[${String(i)}].unit is not a valid unit.`);
      }
      staples.push({ ingredient_id: ingredientId, quantity, unit: unit as Unit });
    });
  }

  const now = new Date().toISOString();
  const householdId = randomUUID();
  deps.db.createHousehold(householdId, {
    name,
    household_size: size,
    novelty_preference: novelty as NoveltyPreference,
    weeknight_active_time_ceiling_seconds: activeCeiling,
    weeknight_total_time_ceiling_seconds: totalCeiling,
    created_at_utc: now,
  });
  deps.db.insertMember(householdId, {
    id: randomUUID(),
    display_name: displayName,
    is_primary: true,
    dietary_restrictions: dietary,
    allergies,
    never_recommend_ingredients: neverRecommend,
    created_at_utc: now,
  });
  for (const staple of staples) {
    deps.db.upsertInventoryEntry(householdId, {
      id: randomUUID(),
      ingredient_id: staple.ingredient_id,
      quantity: staple.quantity,
      unit: staple.unit,
      confidence: 'assumed_staple',
      source: 'onboarding_staple',
      best_by_utc: null,
      updated_at_utc: now,
    });
  }

  return { status: 201, body: { household_id: householdId } };
}

// ---------------------------------------------------------------------------
// Route: GET /api/household
// ---------------------------------------------------------------------------

function handleGetHousehold(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const members = deps.db.listMembers(household.id);
  return { status: 200, body: { household: encodeHousehold(household), members: members.map(encodeMember) } };
}

// ---------------------------------------------------------------------------
// Route: GET /api/calibration/cards
// ---------------------------------------------------------------------------

function encodeCardView(recipe: Recipe): Record<string, unknown> {
  const time = renderTotalActiveTimeFor(recipe);
  return {
    recipe_id: recipe.id,
    name: recipe.name,
    total_seconds: time.total_seconds,
    active_seconds: time.active_seconds,
    time_label: time.combined_label,
    cuisine: recipe.attributes.cuisine,
    protein: recipe.attributes.protein,
    effort: recipe.attributes.effort,
    dish_count: recipe.dish_count,
    // image_alt_text OMITTED: Recipe (recipe.ts) carries no image or alt-text
    // field to derive one from — see return summary.
  };
}

function handleGetCalibrationCards(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const countRaw = ctx.query.get('count');
  let config = CALIBRATION_CONFIG;
  if (countRaw !== null) {
    const count = Number.parseInt(countRaw, 10);
    if (!Number.isInteger(count) || String(count) !== countRaw.trim() || count < CALIBRATION_CONFIG.min_cards || count > CALIBRATION_CONFIG.max_cards) {
      throw new HttpError(
        400,
        'invalid_count',
        `count must be an integer between ${String(CALIBRATION_CONFIG.min_cards)} and ${String(CALIBRATION_CONFIG.max_cards)}.`,
      );
    }
    config = { ...CALIBRATION_CONFIG, target_cards: count };
  }
  const signals = deps.db.listPreferenceSignals(household.id);
  const cards = selectCalibrationCards(deps.catalog, signals, config);
  return { status: 200, body: { cards: cards.map(encodeCardView) } };
}

// ---------------------------------------------------------------------------
// Route: POST /api/calibration/reactions   +   POST /api/feedback
// (both merge PreferenceSignalUpdates the same way)
// ---------------------------------------------------------------------------

function signalKey(memberId: Uuid | null, attribute: string, value: string): string {
  return `${memberId ?? ''}|${attribute}|${value}`;
}

function applyPreferenceUpdates(db: DinnerDb, householdId: string, updates: readonly PreferenceSignalUpdate[]): number {
  const existing = new Map<string, PreferenceSignal>();
  for (const s of db.listPreferenceSignals(householdId)) {
    existing.set(signalKey(s.member_id, s.attribute, s.attribute_value), s);
  }
  const now = new Date().toISOString();
  for (const update of updates) {
    const key = signalKey(update.member_id, update.attribute, update.attribute_value);
    const current = existing.get(key) ?? null;
    const merged = mergeSignal({ existing: current, update, household_id: householdId, id: current?.id ?? randomUUID(), now });
    existing.set(key, merged);
    db.upsertPreferenceSignal(householdId, merged);
  }
  return updates.length;
}

function handlePostCalibrationReactions(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const body = bodyObject(ctx);
  const reactions = body['reactions'];
  if (!Array.isArray(reactions) || reactions.length === 0) {
    throw new HttpError(400, 'invalid_reactions', 'reactions must be a non-empty array.');
  }
  const allUpdates: PreferenceSignalUpdate[] = [];
  reactions.forEach((raw: unknown, i: number) => {
    if (!isPlainObject(raw)) throw new HttpError(400, 'invalid_reaction', `reactions[${String(i)}] must be an object.`);
    const recipeId = raw['recipe_id'];
    const reaction = raw['reaction'];
    if (typeof recipeId !== 'string' || !deps.catalogMap.has(recipeId)) {
      throw new HttpError(400, 'recipe_not_found', `reactions[${String(i)}].recipe_id does not match a known recipe.`);
    }
    if (typeof reaction !== 'string' || !CALIBRATION_REACTIONS.has(reaction)) {
      throw new HttpError(
        400,
        'invalid_reaction_value',
        `reactions[${String(i)}].reaction must be one of looks_good | not_for_me | never_recommend | too_much_work.`,
      );
    }
    const recipe = deps.catalogMap.get(recipeId) as Recipe;
    allUpdates.push(...applyCalibrationReaction({ recipe, member_id: null, reaction: reaction as CalibrationReaction }));
  });
  const signalsUpdated = applyPreferenceUpdates(deps.db, household.id, allUpdates);
  return { status: 200, body: { signals_updated: signalsUpdated } };
}

// ---------------------------------------------------------------------------
// Route: POST /api/plans
// ---------------------------------------------------------------------------

function handleCreatePlan(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const members = deps.db.listMembers(household.id);
  const signals = deps.db.listPreferenceSignals(household.id);
  const inventory = deps.db.listInventoryEntries(household.id);
  const context = loadPlanningContext(deps.db, household.id, deps.catalogMap);
  const { filtered, scores } = computeSurvivorsAndScores(deps, household, members, signals, inventory, context);
  const result = buildPlanSet(filtered, scores, household);
  const chosen: readonly ChosenMeal[] = result.meals;

  const now = new Date().toISOString();
  const planId = randomUUID();
  deps.db.insertPlan(household.id, { id: planId, status: 'accepted', created_at_utc: now });

  const mealsData: MealData[] = [];
  for (const meal of chosen) {
    const planMealId = randomUUID();
    deps.db.insertPlanMeal(household.id, {
      id: planMealId,
      plan_id: planId,
      recipe_id: meal.recipe.id,
      slot: meal.slot,
      target_servings: household.household_size,
      status: 'accepted',
      reason_codes: meal.facts.map((f) => f.code),
      score: meal.score,
      created_at_utc: now,
    });
    mealsData.push({ slot: meal.slot, recipe: meal.recipe, facts: meal.facts, planMealId });
  }

  const view = buildPlanView(planId, now, mealsData, { inventory, signals, context });
  // T-041 / KI-7: an empty or short plan must explain itself — never a bare
  // 201 with `meals: []` and silence. `filtered.exclusions` names the exact
  // constraint(s) that excluded the catalog; `result.survivor_count` for a
  // `short` result is exactly `filtered.survivors.length`.
  const shortfall =
    result.kind === 'short' ? derivePlanShortfall(filtered.exclusions, result.survivor_count, PLANSET_CONFIG.meals_per_plan) : null;
  return { status: 201, body: { plan: withShortfall(view, mealsData.length, shortfall) } };
}

// ---------------------------------------------------------------------------
// Route: GET /api/plans/current
//
// GAP (documented in the return summary): `db.ts` has no `updatePlanStatus`
// helper, so a superseded plan's `status` column can never be flipped away
// from 'accepted' after a later plan is built. "Current" is therefore
// determined here as the household's most-recently-created plan (by
// `created_at_utc`, id as tiebreak) rather than a stored status flag.
// ---------------------------------------------------------------------------

function handleGetCurrentPlan(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const plans = deps.db.listPlans(household.id);
  // "No plan yet" (404) is reserved for the household never having created
  // one at all. A plan that WAS created but came back empty or short is a
  // real, different state (T-041 / KI-7) — reported as 200 with an honest
  // explanation below, never collapsed into this 404.
  if (plans.length === 0) throw new HttpError(404, 'no_current_plan', 'This household has no plan yet.');
  let latest = plans[0] as (typeof plans)[number];
  for (const p of plans) {
    if (p.created_at_utc > latest.created_at_utc || (p.created_at_utc === latest.created_at_utc && p.id > latest.id)) {
      latest = p;
    }
  }
  const members = deps.db.listMembers(household.id);
  const signals = deps.db.listPreferenceSignals(household.id);
  const inventory = deps.db.listInventoryEntries(household.id);
  const context = loadPlanningContext(deps.db, household.id, deps.catalogMap);
  const aux: PlanAux = { inventory, signals, context };

  const mealsData = planMealsData(deps, household, latest.id, aux);
  const view = buildPlanView(latest.id, latest.created_at_utc, mealsData, aux);

  let shortfall: PlanShortfallExplanation | null = null;
  if (mealsData.length < PLANSET_CONFIG.meals_per_plan) {
    // Recomputed live (same GAP-documented pattern reason-fact
    // reconstruction already uses above): the exclusions that produced
    // this plan were never persisted, so WHY it is short is derived fresh
    // from the household's current state, not a frozen snapshot.
    const { filtered } = computeSurvivorsAndScores(deps, household, members, signals, inventory, context);
    shortfall = derivePlanShortfall(filtered.exclusions, filtered.survivors.length, PLANSET_CONFIG.meals_per_plan);
  }

  return { status: 200, body: { plan: withShortfall(view, mealsData.length, shortfall) } };
}

// ---------------------------------------------------------------------------
// Route: POST /api/plans/:planId/meals/:slot/swap
// ---------------------------------------------------------------------------

function noAlternativesMessage(code: SwapNoAlternativesCode): string {
  if (code === 'no_candidates_in_pool') return 'There are no other eligible recipes to offer right now.';
  if (code === 'all_candidates_already_in_plan') return 'Every eligible recipe is already in this plan.';
  return 'No other recipe satisfies that reason right now.';
}

function encodeSwapRankBreakdown(rank: SwapRankBreakdown): Record<string, unknown> {
  const terms: Record<string, unknown> = {};
  for (const name of SWAP_RANK_TERM_NAMES) {
    const t = rank.terms[name];
    terms[name] = { weight: encodeRational(t.weight), raw: encodeRational(t.raw), weighted: encodeRational(t.weighted) };
  }
  return { terms, total: encodeRational(rank.total) };
}

function encodeSwapAlternative(alt: SwapAlternative, targetSlot: number, frozenMeals: readonly MealData[], aux: PlanAux): Record<string, unknown> {
  // Not yet accepted — there is no persisted plan_meal row for it yet.
  const mealData: MealData = { slot: targetSlot, recipe: alt.recipe, facts: alt.facts, planMealId: null };
  const view = buildMealView(mealData, [...frozenMeals, mealData], aux);
  return { ...view, rank_breakdown: encodeSwapRankBreakdown(alt.rank) };
}

function parseSlot(raw: string): 0 | 1 | 2 {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || String(n) !== raw.trim() || n < 0 || n > 2) {
    throw new HttpError(400, 'invalid_slot', 'slot must be 0, 1, or 2.');
  }
  return n as 0 | 1 | 2;
}

function handleSwap(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const planId = ctx.params['planId'] as string;
  const plan = deps.db.getPlan(household.id, planId);
  if (plan === undefined) throw new HttpError(404, 'plan_not_found', 'No plan with that id for this household.');
  const slot = parseSlot(ctx.params['slot'] as string);

  const body = bodyObject(ctx);
  const reasonRaw = body['reason'];
  if (typeof reasonRaw !== 'string' || !SWAP_REASONS.has(reasonRaw)) {
    throw new HttpError(400, 'invalid_swap_reason', 'reason must be one of the nine swap reasons.');
  }
  const reason = reasonRaw as SwapReason;
  const acceptRaw = body['accept_recipe_id'];
  if (acceptRaw !== undefined && acceptRaw !== null && typeof acceptRaw !== 'string') {
    throw new HttpError(400, 'invalid_accept_recipe_id', 'accept_recipe_id must be a string.');
  }
  const acceptRecipeId: string | null = typeof acceptRaw === 'string' ? acceptRaw : null;

  const rows = deps.db.listPlanMeals(household.id, planId).filter((r) => r.status !== 'swapped_out');
  if (rows.length !== 3) throw new HttpError(409, 'plan_incomplete', 'This plan does not have three active meals to swap against.');
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  const row0 = bySlot.get(0);
  const row1 = bySlot.get(1);
  const row2 = bySlot.get(2);
  if (row0 === undefined || row1 === undefined || row2 === undefined) {
    throw new HttpError(409, 'plan_incomplete', 'This plan is missing a slot.');
  }
  const recipe0 = deps.catalogMap.get(row0.recipe_id);
  const recipe1 = deps.catalogMap.get(row1.recipe_id);
  const recipe2 = deps.catalogMap.get(row2.recipe_id);
  if (recipe0 === undefined || recipe1 === undefined || recipe2 === undefined) {
    throw new HttpError(500, 'internal_error', 'Plan references an unknown recipe.');
  }
  const rowsBySlot = [row0, row1, row2] as const;
  const recipesBySlot = [recipe0, recipe1, recipe2] as const;
  const meals: readonly [SwapMealInput, SwapMealInput, SwapMealInput] = [
    { recipe: recipe0, score: row0.score },
    { recipe: recipe1, score: row1.score },
    { recipe: recipe2, score: row2.score },
  ];

  const members = deps.db.listMembers(household.id);
  const signals = deps.db.listPreferenceSignals(household.id);
  const inventory = deps.db.listInventoryEntries(household.id);
  const context = loadPlanningContext(deps.db, household.id, deps.catalogMap);
  const { filtered, scores } = computeSurvivorsAndScores(deps, household, members, signals, inventory, context);
  const inPlanIds = new Set(meals.map((m) => m.recipe.id));
  const candidates: SwapMealInput[] = filtered.survivors
    .map((recipe, i) => ({ recipe, score: scores[i] as import('../../domain/src/recipe.ts').ScoreBreakdown }))
    .filter((c) => !inPlanIds.has(c.recipe.id));

  const swapResult = swapMeal({ meals, swap_slot: slot, reason, candidates, signals, inventory, context }, SWAP_CONFIG);

  const frozenMeals: MealData[] = [];
  for (let s = 0; s < 3; s += 1) {
    if (s !== slot) frozenMeals.push({ slot: s, recipe: recipesBySlot[s] as Recipe, facts: [], planMealId: rowsBySlot[s].id });
  }
  const aux: PlanAux = { inventory, signals, context };

  if (acceptRecipeId === null) {
    if (swapResult.kind === 'no_alternatives') {
      return {
        status: 200,
        body: { alternatives: [], none_reason: swapResult.explanation, message: noAlternativesMessage(swapResult.explanation) },
      };
    }
    const alternatives = swapResult.alternatives.map((alt) => encodeSwapAlternative(alt, slot, frozenMeals, aux));
    return { status: 200, body: { alternatives } };
  }

  if (swapResult.kind === 'no_alternatives') {
    throw new HttpError(400, 'no_alternatives_to_accept', 'There is nothing to accept for this reason.');
  }
  const chosen = swapResult.alternatives.find((a) => a.recipe.id === acceptRecipeId);
  if (chosen === undefined) {
    throw new HttpError(400, 'accept_recipe_not_offered', 'accept_recipe_id is not among the current alternatives for this reason.');
  }
  const oldRow = rowsBySlot[slot];
  deps.db.updatePlanMealStatus(household.id, oldRow.id, 'swapped_out');
  const now = new Date().toISOString();
  deps.db.insertPlanMeal(household.id, {
    id: randomUUID(),
    plan_id: planId,
    recipe_id: chosen.recipe.id,
    slot,
    target_servings: oldRow.target_servings,
    status: 'accepted',
    reason_codes: chosen.facts.map((f) => f.code),
    score: chosen.score,
    created_at_utc: now,
  });

  const view = buildFullPlanView(deps, household, planId, plan.created_at_utc, aux);
  if (view === null) throw new HttpError(500, 'internal_error', 'Failed to rebuild the plan after the swap.');
  return { status: 200, body: { plan: view } };
}

// ---------------------------------------------------------------------------
// Route: GET /api/plans/:planId/grocery   +   PATCH /api/grocery/lines/:lineId
// ---------------------------------------------------------------------------

interface GroceryLineData {
  readonly id: Uuid;
  readonly ingredient_id: IngredientId;
  readonly display_name: string;
  readonly store_section: StoreSection;
  readonly unit: Unit;
  readonly required_quantity: Rational;
  readonly inventory_deducted: Rational;
  readonly package_description: string | null;
  readonly is_estimate: boolean;
  readonly expected_surplus: Rational;
  readonly user_edited_quantity: Rational | null;
  readonly checked: boolean;
  readonly contributions: readonly GroceryContribution[];
}

function buildGroceryLineView(d: GroceryLineData, recipeNameFor: (id: Uuid) => string): Record<string, unknown> {
  // purchase_quantity is not a persisted column; it is derived from the
  // three that are (required, deducted, surplus), which always satisfy
  // purchase_requirement = required − deducted and
  // purchase_quantity     = purchase_requirement + surplus — the same
  // relationship inventoryMath.ts / packaging.ts establish when the line is
  // first computed, so re-deriving it here from a re-read row is exact.
  const purchaseRequirement = sub(d.required_quantity, d.inventory_deducted);
  const purchaseQuantity = add(purchaseRequirement, d.expected_surplus);
  return {
    line_id: d.id,
    ingredient_id: d.ingredient_id,
    display_name: d.display_name,
    section: d.store_section,
    purchase_quantity: encodeRational(purchaseQuantity),
    unit: d.unit,
    package_label: d.package_description,
    is_estimate: d.is_estimate,
    user_edited_quantity: d.user_edited_quantity === null ? null : encodeRational(d.user_edited_quantity),
    checked: d.checked,
    provenance: {
      contributions: d.contributions.map((c) => ({
        recipe_id: c.recipe_id,
        recipe_name: recipeNameFor(c.recipe_id),
        amount: encodeRational(c.amount),
        unit: d.unit,
      })),
      inventory_deducted: encodeRational(d.inventory_deducted),
      expected_surplus: encodeRational(d.expected_surplus),
    },
  };
}

function mustRegistryEntry(registry: IngredientRegistry, id: IngredientId): import('../../domain/src/catalog.ts').IngredientRegistryEntry {
  const entry = registry.get(id);
  if (entry === undefined) throw new HttpError(500, 'internal_error', 'Unknown ingredient in the registry.');
  return entry;
}

function handleGetGrocery(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const planId = ctx.params['planId'] as string;
  const plan = deps.db.getPlan(household.id, planId);
  if (plan === undefined) throw new HttpError(404, 'plan_not_found', 'No plan with that id for this household.');

  const rows = deps.db.listPlanMeals(household.id, planId).filter((r) => r.status !== 'swapped_out');
  const scaledLines: import('../../domain/src/scale.ts').ScaledRequirementLine[] = [];
  for (const row of rows) {
    const recipe = deps.catalogMap.get(row.recipe_id);
    if (recipe === undefined) continue;
    scaledLines.push(...scaleRecipeRequirements(recipe, row.id, row.target_servings));
  }
  const aggregated = aggregateRequirements(scaledLines, deps.registry);
  const inventory = deps.db.listInventoryEntries(household.id);
  const subtraction = subtractInventory(aggregated, inventory, deps.registry);

  // Deterministic 1:1 mapping: the grocery list's id IS the plan's id.
  // `db.ts` has no "find the grocery list for a plan" query, so this
  // convention is what makes GET idempotent (update-in-place on re-read)
  // and makes PATCH .../lines/:lineId findable — see findGroceryLineOwner.
  const listId = planId;
  const existingList = deps.db.getGroceryList(household.id, listId);
  const now = new Date().toISOString();
  if (existingList === undefined) {
    deps.db.insertGroceryList(household.id, { id: listId, plan_id: planId, status: 'current', created_at_utc: now, regenerated_at_utc: null });
  } else {
    // Regeneration write-path only ever touches computed columns — the user
    // edit columns are untouched by construction (updateGroceryLineComputed).
  }
  const existingLines = deps.db.listGroceryLines(household.id, listId);
  const existingByKey = new Map(existingLines.map((l) => [`${l.ingredient_id}::${l.unit}`, l]));

  const recipeNameFor = (id: Uuid): string => deps.catalogMap.get(id)?.name ?? id;
  const sectionsMap = new Map<string, Record<string, unknown>[]>();
  const toTasteOut: Record<string, unknown>[] = [];

  for (const line of subtraction.lines) {
    if (line.kind === 'to_taste') {
      toTasteOut.push({
        ingredient_id: line.ingredient_id,
        display_name: line.display_name,
        recipe_names: [...new Set(line.contributions.map((c) => recipeNameFor(c.recipe_id)))],
      });
      continue;
    }
    // No curated PackageOption data exists anywhere in this repo (see
    // return summary) — every line resolves through packaging.ts's
    // documented "loose" path (no options ⇒ buy exactly the requirement,
    // zero surplus, package_description null), never a guessed package.
    const selection = selectPackages(line.purchase_requirement, line.dimension, [], mustRegistryEntry(deps.registry, line.ingredient_id));
    const key = `${line.ingredient_id}::${line.unit}`;
    const existing = existingByKey.get(key);
    const lineId = existing?.id ?? randomUUID();
    const patch = {
      required_quantity: line.required_quantity,
      inventory_deducted: line.inventory_deducted,
      package_description: selection.package_description,
      is_estimate: selection.is_estimate,
      expected_surplus: selection.expected_surplus,
      contributions: line.contributions,
    };
    if (existing !== undefined) {
      deps.db.updateGroceryLineComputed(household.id, lineId, patch);
    } else {
      deps.db.insertGroceryLine(household.id, {
        id: lineId,
        grocery_list_id: listId,
        ingredient_id: line.ingredient_id,
        display_name: line.display_name,
        store_section: line.store_section,
        unit: line.unit,
        checked: false,
        ...patch,
      });
    }
    const view = buildGroceryLineView(
      {
        id: lineId,
        ingredient_id: line.ingredient_id,
        display_name: line.display_name,
        store_section: line.store_section,
        unit: line.unit,
        user_edited_quantity: existing?.user_edited_quantity ?? null,
        checked: existing?.checked ?? false,
        ...patch,
      },
      recipeNameFor,
    );
    const bucket = sectionsMap.get(line.store_section) ?? [];
    bucket.push(view);
    sectionsMap.set(line.store_section, bucket);
  }

  const sections = [...sectionsMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([section, lines]) => ({ section, lines }));

  const confirmationQuestions = subtraction.confirmation_questions.map((q) => ({
    ingredient_id: q.ingredient_id,
    display_name: q.display_name,
    needed: encodeRational(q.required_quantity),
    believed_on_hand: encodeRational(q.claimed_quantity),
    unit: q.unit,
    question: `Your plan needs ${toMixedString(q.required_quantity)} ${q.unit} of ${q.display_name}, and we think you have ${toMixedString(q.claimed_quantity)} — still right?`,
  }));

  return {
    status: 200,
    body: { list: { list_id: listId, sections, to_taste: toTasteOut, confirmation_questions: confirmationQuestions } },
  };
}

function findGroceryLineOwner(deps: Deps, householdId: string, lineId: Uuid): { readonly listId: Uuid } | null {
  for (const plan of deps.db.listPlans(householdId)) {
    const list = deps.db.getGroceryList(householdId, plan.id); // listId === planId (see handleGetGrocery)
    if (list === undefined) continue;
    const lines = deps.db.listGroceryLines(householdId, plan.id);
    if (lines.some((l) => l.id === lineId)) return { listId: plan.id };
  }
  return null;
}

function handlePatchGroceryLine(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const lineId = ctx.params['lineId'] as string;
  const body = bodyObject(ctx);
  const hasUserEdit = Object.hasOwn(body, 'user_edited_quantity');
  const hasChecked = Object.hasOwn(body, 'checked');
  if (hasUserEdit === hasChecked) {
    throw new HttpError(400, 'invalid_patch_body', 'Provide exactly one of user_edited_quantity or checked.');
  }

  const owner = findGroceryLineOwner(deps, household.id, lineId);
  if (owner === null) throw new HttpError(404, 'grocery_line_not_found', 'No grocery line with that id for this household.');

  if (hasUserEdit) {
    const raw = body['user_edited_quantity'];
    let quantity: Rational | null = null;
    if (raw !== null) {
      const decoded = decodeRational(raw);
      if (decoded === null) throw new HttpError(400, 'invalid_quantity', 'user_edited_quantity must be null or {"n","d"} strings.');
      quantity = decoded;
    }
    deps.db.setUserEditedQuantity(household.id, lineId, quantity);
  } else {
    const checked = body['checked'];
    if (typeof checked !== 'boolean') throw new HttpError(400, 'invalid_checked', 'checked must be a boolean.');
    deps.db.setGroceryLineChecked(household.id, lineId, checked);
  }

  const refreshed = deps.db.listGroceryLines(household.id, owner.listId).find((l) => l.id === lineId);
  if (refreshed === undefined) throw new HttpError(404, 'grocery_line_not_found', 'No grocery line with that id for this household.');
  const recipeNameFor = (id: Uuid): string => deps.catalogMap.get(id)?.name ?? id;
  const view = buildGroceryLineView(refreshed, recipeNameFor);
  return { status: 200, body: { line: view } };
}

// ---------------------------------------------------------------------------
// Route: GET /api/plans/:planId/meals/:slot/prep
//
// The frozen contract states only `{"prep":<PrepPlan>}` — it does not spell
// out a wire shape for PrepPlan the way it does for CardView/MealView/etc.
// This composes one from `prep.ts`'s domain `PrepPlan`, encoding the
// embedded Rationals (ingredient quantities) and reusing the exact StepView
// shape the contract DOES define for SessionView.step (below), plus a
// recipe-level total/active/time_label pair added for DoD 6 ("if a payload
// has a time, it has both numbers") since `PrepPlan` itself carries none.
// ---------------------------------------------------------------------------

function encodeIngredientQuantity(q: IngredientQuantity): Record<string, unknown> {
  if (q.kind === 'to_taste') return { kind: 'to_taste' };
  if (q.kind === 'exact') return { kind: 'exact', amount: encodeRational(q.amount), unit: q.unit };
  return { kind: 'range', min: encodeRational(q.min), max: encodeRational(q.max), unit: q.unit };
}

function encodeIngredientLine(line: RecipeIngredientLine): Record<string, unknown> {
  return {
    id: line.id,
    ingredient_id: line.ingredient_id,
    display_name: line.display_name,
    quantity: encodeIngredientQuantity(line.quantity),
    preparation: line.preparation,
    optional: line.optional,
  };
}

function encodeStepView(step: RecipeStep): Record<string, unknown> {
  const time = renderTotalActiveTime(step.active_duration_seconds + step.unattended_duration_seconds, step.active_duration_seconds);
  return {
    index: step.index,
    text: step.instruction,
    total_seconds: time.total_seconds,
    active_seconds: time.active_seconds,
    time_label: time.combined_label,
    requires_continuous_attention: step.requires_continuous_attention,
    safe_to_pause_after: step.safe_to_pause_after,
  };
}

function encodeNextSafeStop(s: NextSafeStop): Record<string, unknown> {
  if (s.kind === 'end_of_recipe') return { kind: 'end_of_recipe' };
  return { kind: s.kind, step_index: s.step_index, maximum_pause: s.maximum_pause, natural_stopping_point: s.natural_stopping_point };
}

function encodePrepPlan(p: PrepPlan, recipe: Recipe): Record<string, unknown> {
  const time = renderTotalActiveTimeFor(recipe);
  return {
    recipe_id: p.recipe_id,
    total_seconds: time.total_seconds,
    active_seconds: time.active_seconds,
    time_label: time.combined_label,
    required_ingredients: p.required_ingredients.map(encodeIngredientLine),
    optional_ingredients: p.optional_ingredients.map(encodeIngredientLine),
    equipment: p.equipment,
    do_ahead_tasks: p.do_ahead_tasks,
    first_non_interruptible_step: p.first_non_interruptible_step === null ? null : encodeStepView(p.first_non_interruptible_step),
    first_safe_stopping_point: encodeNextSafeStop(p.first_safe_stopping_point),
    active_time_blocks: p.active_time_blocks,
  };
}

function handleGetPrep(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const planId = ctx.params['planId'] as string;
  const plan = deps.db.getPlan(household.id, planId);
  if (plan === undefined) throw new HttpError(404, 'plan_not_found', 'No plan with that id for this household.');
  const slot = parseSlot(ctx.params['slot'] as string);
  const row = deps.db.listPlanMeals(household.id, planId)
    .filter((r) => r.status !== 'swapped_out')
    .find((r) => r.slot === slot);
  if (row === undefined) throw new HttpError(404, 'meal_not_found', 'No active meal at that slot.');
  const recipe = deps.catalogMap.get(row.recipe_id);
  if (recipe === undefined) throw new HttpError(500, 'internal_error', 'Plan references an unknown recipe.');
  const prep = derivePrepPlan(recipe);
  return { status: 200, body: { prep: encodePrepPlan(prep, recipe) } };
}

// ---------------------------------------------------------------------------
// Route: POST /api/cooking/sessions   +   GET .../:id   +   POST .../:id/events
// ---------------------------------------------------------------------------

function encodeAttentionWarning(w: AttentionWarning): Record<string, unknown> {
  return { step_index: w.step_index, phase: w.phase, uninterrupted_seconds: w.uninterrupted_seconds };
}

function encodeSessionView(view: CookingSessionView): Record<string, unknown> {
  return {
    session_id: view.session_id,
    recipe_id: view.recipe_id,
    status: view.status,
    current_step_index: view.current_step_index,
    total_steps: view.steps_total,
    // `step` is null once every step is complete — the contract does not
    // spell out the completed-session case; null is the honest state
    // (current_step: RecipeStep | null in cooking.ts) rather than a
    // fabricated placeholder step. See return summary.
    step: view.current_step === null ? null : encodeStepView(view.current_step),
    timers: view.timers.map((t) => ({
      timer_id: t.timer.id,
      label: t.timer.label,
      ends_at_utc: t.timer.ends_at_utc,
      remaining_seconds: t.remaining_seconds,
      expired: t.expired,
    })),
    next_safe_stop: encodeNextSafeStop(view.next_safe_stop),
    attention_warning: view.attention_warnings.length > 0 ? encodeAttentionWarning(view.attention_warnings[0] as AttentionWarning) : null,
    recovery_text: view.recovery.kind === 'instruction' ? view.recovery.text : NO_RECOVERY_GUIDANCE_TEXT,
  };
}

/** Rebuild the session view PURELY from the persisted event log — never
 * from server memory (DoD 7). `recipe_id` itself comes from the log's own
 * first event, not a snapshot column. */
function loadSessionView(deps: Deps, householdId: string, sessionId: Uuid): CookingSessionView | null {
  const events = deps.db.listCookingEvents(householdId, sessionId);
  if (events.length === 0) return null;
  const first = events[0] as CookingEvent;
  if (first.payload.kind !== 'session_started') return null;
  const recipe = deps.catalogMap.get(first.payload.recipe_id);
  if (recipe === undefined) return null;
  return reconstructSession(recipe, events, new Date().toISOString());
}

function handleCreateSession(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const body = bodyObject(ctx);
  const recipeId = body['recipe_id'];
  if (typeof recipeId !== 'string' || !deps.catalogMap.has(recipeId)) {
    throw new HttpError(400, 'recipe_not_found', 'recipe_id does not match a known recipe.');
  }
  const targetServings = body['target_servings'];
  if (typeof targetServings !== 'number' || !Number.isInteger(targetServings) || targetServings < 1) {
    throw new HttpError(400, 'invalid_target_servings', 'target_servings must be a positive integer.');
  }
  const planMealIdRaw = body['plan_meal_id'];
  if (planMealIdRaw !== null && planMealIdRaw !== undefined && typeof planMealIdRaw !== 'string') {
    throw new HttpError(400, 'invalid_plan_meal_id', 'plan_meal_id must be a string or null.');
  }
  const planMealId: string | null = typeof planMealIdRaw === 'string' ? planMealIdRaw : null;

  const now = new Date().toISOString();
  const sessionId = randomUUID();
  runPlanMealInsert(() => {
    deps.db.insertCookingSession(household.id, {
      id: sessionId,
      plan_meal_id: planMealId,
      recipe_id: recipeId,
      target_servings: targetServings,
      status: 'active',
      current_step_index: 0,
      timers: [],
      started_at_utc: now,
      updated_at_utc: now,
    });
  });
  deps.db.appendCookingEvent(household.id, {
    id: randomUUID(),
    session_id: sessionId,
    seq: 1,
    occurred_at_utc: now,
    payload: { kind: 'session_started', recipe_id: recipeId, target_servings: targetServings },
  });
  const view = loadSessionView(deps, household.id, sessionId);
  if (view === null) throw new HttpError(500, 'internal_error', 'Failed to build the new cooking session.');
  return { status: 201, body: { session: encodeSessionView(view) } };
}

function handleGetSession(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const sessionId = ctx.params['id'] as string;
  const view = loadSessionView(deps, household.id, sessionId);
  if (view === null) throw new HttpError(404, 'session_not_found', 'No cooking session with that id for this household.');
  return { status: 200, body: { session: encodeSessionView(view) } };
}

function validateCookingTimer(v: unknown): CookingTimer | null {
  if (!isPlainObject(v)) return null;
  const id = v['id'];
  const stepIndex = v['step_index'];
  const label = v['label'];
  const startedAt = v['started_at_utc'];
  const endsAt = v['ends_at_utc'];
  const duration = v['duration_seconds'];
  if (typeof id !== 'string') return null;
  if (typeof stepIndex !== 'number' || !Number.isInteger(stepIndex)) return null;
  if (typeof label !== 'string' || typeof startedAt !== 'string' || typeof endsAt !== 'string') return null;
  if (typeof duration !== 'number' || !Number.isInteger(duration)) return null;
  return { id, step_index: stepIndex, label, started_at_utc: startedAt, ends_at_utc: endsAt, duration_seconds: duration };
}

function validateEventPayload(v: unknown): CookingEventPayload | null {
  if (!isPlainObject(v)) return null;
  const kind = v['kind'];
  switch (kind) {
    case 'session_started': {
      const recipeId = v['recipe_id'];
      const servings = v['target_servings'];
      if (typeof recipeId !== 'string' || typeof servings !== 'number') return null;
      return { kind, recipe_id: recipeId, target_servings: servings };
    }
    case 'step_completed': {
      const idx = v['step_index'];
      if (typeof idx !== 'number' || !Number.isInteger(idx)) return null;
      return { kind, step_index: idx };
    }
    case 'timer_started': {
      const timer = validateCookingTimer(v['timer']);
      if (timer === null) return null;
      return { kind, timer };
    }
    case 'timer_cancelled':
    case 'timer_acknowledged': {
      const timerId = v['timer_id'];
      if (typeof timerId !== 'string') return null;
      return { kind, timer_id: timerId };
    }
    case 'session_paused':
    case 'session_resumed': {
      const idx = v['at_step_index'];
      if (typeof idx !== 'number' || !Number.isInteger(idx)) return null;
      return { kind, at_step_index: idx };
    }
    case 'session_completed':
      return { kind };
    case 'session_abandoned':
      return { kind };
    default:
      return null;
  }
}

function handlePostSessionEvent(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const sessionId = ctx.params['id'] as string;
  const events = deps.db.listCookingEvents(household.id, sessionId);
  if (events.length === 0) throw new HttpError(404, 'session_not_found', 'No cooking session with that id for this household.');
  const first = events[0] as CookingEvent;
  if (first.payload.kind !== 'session_started') throw new HttpError(500, 'internal_error', 'Corrupt session log.');
  const recipe = deps.catalogMap.get(first.payload.recipe_id);
  if (recipe === undefined) throw new HttpError(500, 'internal_error', 'Session references an unknown recipe.');

  const body = bodyObject(ctx);
  const payload = validateEventPayload(body['payload']);
  if (payload === null) throw new HttpError(400, 'invalid_event_payload', 'payload is not a recognised cooking event.');
  if (payload.kind === 'session_started') {
    throw new HttpError(400, 'invalid_event_kind', 'session_started cannot be posted after session creation.');
  }

  const lastSeq = (events[events.length - 1] as CookingEvent).seq;
  const now = new Date().toISOString();
  const candidateEvent: CookingEvent = {
    id: randomUUID(),
    household_id: household.id,
    session_id: sessionId,
    seq: lastSeq + 1,
    occurred_at_utc: now,
    payload,
  };

  let view: CookingSessionView;
  try {
    // Validate the transition BEFORE persisting — the append-only log must
    // never gain an event that reconstructSession itself would reject.
    view = reconstructSession(recipe, [...events, candidateEvent], now);
  } catch (err) {
    if (err instanceof CookingError) throw new HttpError(400, err.code, err.message);
    throw err;
  }
  deps.db.appendCookingEvent(household.id, {
    id: candidateEvent.id,
    session_id: sessionId,
    seq: candidateEvent.seq,
    occurred_at_utc: candidateEvent.occurred_at_utc,
    payload,
  });
  return { status: 200, body: { session: encodeSessionView(view) } };
}

// ---------------------------------------------------------------------------
// Route: POST /api/feedback
// ---------------------------------------------------------------------------

function handleFeedback(deps: Deps, ctx: JsonRouteContext): RouteResult {
  const household = requireHousehold(deps.db, ctx.householdId as string);
  const body = bodyObject(ctx);
  const planMealId = body['plan_meal_id'];
  const recipeId = body['recipe_id'];
  const verdictRaw = body['verdict'];
  const reasonRaw = body['reason'];

  if (typeof planMealId !== 'string' || planMealId.trim() === '') {
    throw new HttpError(400, 'invalid_plan_meal_id', 'plan_meal_id must be a non-empty string.');
  }
  if (typeof recipeId !== 'string' || !deps.catalogMap.has(recipeId)) {
    throw new HttpError(400, 'recipe_not_found', 'recipe_id does not match a known recipe.');
  }
  if (typeof verdictRaw !== 'string' || !FEEDBACK_VERDICTS.has(verdictRaw)) {
    throw new HttpError(400, 'invalid_verdict', 'verdict must be one of make_again | it_was_fine | not_again.');
  }
  let reason: FeedbackReason | null = null;
  if (reasonRaw !== null && reasonRaw !== undefined) {
    if (typeof reasonRaw !== 'string' || !FEEDBACK_REASONS.has(reasonRaw)) {
      throw new HttpError(400, 'invalid_reason', 'reason must be a valid feedback reason or null.');
    }
    reason = reasonRaw as FeedbackReason;
  }

  const recipe = deps.catalogMap.get(recipeId) as Recipe;
  const updates = applyFeedbackEvent({ recipe, member_id: null, verdict: verdictRaw as FeedbackVerdict, reason });
  const signalsUpdated = applyPreferenceUpdates(deps.db, household.id, updates);

  const now = new Date().toISOString();
  runPlanMealInsert(() => {
    deps.db.insertFeedback(household.id, {
      id: randomUUID(),
      plan_meal_id: planMealId,
      recipe_id: recipeId,
      verdict: verdictRaw as FeedbackVerdict,
      reason,
      created_at_utc: now,
    });
  });

  return { status: 201, body: { signals_updated: signalsUpdated } };
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

function buildRoutes(deps: Deps): readonly RouteDef[] {
  const sync = (fn: (deps: Deps, ctx: JsonRouteContext) => RouteResult) => (ctx: JsonRouteContext): RouteResult => fn(deps, ctx);
  return [
    { method: 'GET', pattern: '/api/health', requiresHousehold: false, handler: () => handleHealth() },
    { method: 'POST', pattern: '/api/households', requiresHousehold: false, handler: sync(handleCreateHousehold) },
    { method: 'GET', pattern: '/api/household', requiresHousehold: true, handler: sync(handleGetHousehold) },
    { method: 'GET', pattern: '/api/calibration/cards', requiresHousehold: true, handler: sync(handleGetCalibrationCards) },
    { method: 'POST', pattern: '/api/calibration/reactions', requiresHousehold: true, handler: sync(handlePostCalibrationReactions) },
    { method: 'POST', pattern: '/api/plans', requiresHousehold: true, handler: sync(handleCreatePlan) },
    { method: 'GET', pattern: '/api/plans/current', requiresHousehold: true, handler: sync(handleGetCurrentPlan) },
    { method: 'POST', pattern: '/api/plans/:planId/meals/:slot/swap', requiresHousehold: true, handler: sync(handleSwap) },
    { method: 'GET', pattern: '/api/plans/:planId/grocery', requiresHousehold: true, handler: sync(handleGetGrocery) },
    { method: 'PATCH', pattern: '/api/grocery/lines/:lineId', requiresHousehold: true, handler: sync(handlePatchGroceryLine) },
    { method: 'GET', pattern: '/api/plans/:planId/meals/:slot/prep', requiresHousehold: true, handler: sync(handleGetPrep) },
    { method: 'POST', pattern: '/api/cooking/sessions', requiresHousehold: true, handler: sync(handleCreateSession) },
    { method: 'GET', pattern: '/api/cooking/sessions/:id', requiresHousehold: true, handler: sync(handleGetSession) },
    { method: 'POST', pattern: '/api/cooking/sessions/:id/events', requiresHousehold: true, handler: sync(handlePostSessionEvent) },
    { method: 'POST', pattern: '/api/feedback', requiresHousehold: true, handler: sync(handleFeedback) },
  ];
}
