/**
 * swap.ts — one-tap swap by explicit reason (wave 1B, T-007).
 *
 * Invariant 4 (DESIGN.md) lives here and is structural: a swap re-ranks
 * candidates against the FROZEN remaining two meals and NEVER re-runs the
 * set pass. This module does not import `planset.ts` AT ALL — there is no
 * way to "helpfully" re-optimise the whole set from here, and the two
 * untouched meals are returned as the SAME object references the caller
 * passed in (`unchanged`), so they are provably byte-identical.
 *
 * The nine explicit reasons (`SwapReason`, frozen in recipe.ts) each do two
 * things, both testable:
 *   1. an eligibility rule — every returned alternative genuinely delivers
 *      the reason relative to the meal being swapped out (a "faster"
 *      alternative IS strictly faster than the outgoing meal, a "cheaper"
 *      one IS a strictly cheaper cost band, …). A reason nothing satisfies
 *      returns the honest `no_alternatives` outcome, never a lie.
 *   2. a reason-fit term that dominates the ranking (largest weight in
 *      `SWAP_CONFIG.rank_weights`), so the ordering measurably moves in
 *      the direction the reason's name promises.
 *
 * Alternatives are then ranked against the two frozen meals: ingredient
 * overlap, protein and cuisine diversity are computed against those two,
 * held fixed — the outgoing meal contributes NOTHING to the ranking
 * context. At most `max_alternatives` (three) are returned, each carrying
 * `ReasonFact`s for `reasons.ts` to render — this module emits facts,
 * never user-facing strings.
 *
 * Zero valid alternatives is a representable outcome with a typed
 * explanation and honest counts — never an empty array with no reason,
 * never a throw.
 *
 * Invariant 1 binds: all arithmetic is `Rational` via `qty.ts`.
 * Determinism: pure function of the request — no clock, no randomness, no
 * I/O. Candidates are canonically sorted by recipe id before ranking and
 * every score tie breaks on recipe id, so input array order can never
 * change the output.
 */

import type {
  AttributeVector,
  CostBand,
  IngredientId,
  InventoryEntry,
  PreferenceSignal,
  Recipe,
  ScoreBreakdown,
  SwapReason,
  Uuid,
} from './recipe.ts';
import type { Rational } from './qty.ts';
import { ONE, ZERO, add, compare, div, fromInt, max, min, mul, rational, sign, sub } from './qty.ts';
import type { PlanningContext } from './filters.ts';
import { signalAppliesToRecipe } from './filters.ts';
import type { ReasonFact } from './reasons.ts';
import { MAX_REASON_CODES_PER_MEAL } from './reasons.ts';

// ---------------------------------------------------------------------------
// Configuration — every weight, reference and threshold in ONE object
// ---------------------------------------------------------------------------

export type SwapRankTermName =
  | 'reason_fit'
  | 'individual_fit'
  | 'ingredient_overlap'
  | 'protein_diversity'
  | 'cuisine_diversity';

export interface SwapConfig {
  /** At most this many alternatives are ever returned (SPEC: three). */
  readonly max_alternatives: number;
  /** Ranking weights; `reason_fit` must dominate so the chosen reason
   * measurably reorders candidates. Sum to exactly one (tested). */
  readonly rank_weights: Readonly<Record<SwapRankTermName, Rational>>;
  /** `faster` fit reference: a total time at/above this scores 0. */
  readonly faster_reference_total_seconds: number;
  /** `less_hands_on` fit reference: active time at/above this scores 0. */
  readonly hands_on_reference_active_seconds: number;
  /** `fewer_dishes` fit reference: a dish count at/above this scores 0. */
  readonly dishes_reference_count: number;
  /** Cost value per band (0 = cheapest); `cheaper` fit = 1 − value. */
  readonly cost_band_values: Readonly<Record<CostBand, Rational>>;
  /** Case-insensitive fragments that mark an ingredient line (id or
   * display name) or a recipe name as pasta, for `no_pasta`. */
  readonly pasta_name_fragments: readonly string[];
}

export const SWAP_CONFIG: SwapConfig = {
  max_alternatives: 3,
  rank_weights: {
    reason_fit: rational(60, 100),
    individual_fit: rational(20, 100),
    ingredient_overlap: rational(10, 100),
    protein_diversity: rational(5, 100),
    cuisine_diversity: rational(5, 100),
  },
  faster_reference_total_seconds: 5400, // 90 min
  hands_on_reference_active_seconds: 2700, // 45 min
  dishes_reference_count: 8,
  cost_band_values: { low: ZERO, medium: rational(1, 2), high: ONE },
  pasta_name_fragments: [
    'pasta',
    'spaghetti',
    'penne',
    'noodle',
    'macaroni',
    'linguine',
    'fettuccine',
    'rigatoni',
    'orzo',
    'lasagn',
    'fusilli',
    'tortellini',
    'ravioli',
    'gnocchi',
    'ramen',
    'udon',
    'soba',
    'vermicelli',
    'tagliatelle',
    'orecchiette',
    'ziti',
    'farfalle',
  ],
};

/** Fixed term order for summation and completeness assertions. */
export const SWAP_RANK_TERM_NAMES: readonly SwapRankTermName[] = [
  'reason_fit',
  'individual_fit',
  'ingredient_overlap',
  'protein_diversity',
  'cuisine_diversity',
];

// ---------------------------------------------------------------------------
// Request / result shapes
// ---------------------------------------------------------------------------

/** A meal as the plan holds it: the recipe plus the individual breakdown
 * `score.ts` produced. (Deliberately NOT planset's ChosenMeal — this
 * module must not know planset exists.) */
export interface SwapMealInput {
  readonly recipe: Recipe;
  readonly score: ScoreBreakdown;
}

export type SwapSlot = 0 | 1 | 2;

export interface SwapRequest {
  /** The current three-meal plan, in slot order. */
  readonly meals: readonly [SwapMealInput, SwapMealInput, SwapMealInput];
  /** WHICH meal is being swapped; the other two are the frozen context. */
  readonly swap_slot: SwapSlot;
  readonly reason: SwapReason;
  /** The same candidate pool the plan was built from (survivors + their
   * individual scores). Meals already in the plan are excluded here. */
  readonly candidates: readonly SwapMealInput[];
  /** For `more_familiar` / `more_adventurous` familiarity. */
  readonly signals: readonly PreferenceSignal[];
  /** For `use_what_i_have` (confirmed / assumed_staple only). */
  readonly inventory: readonly InventoryEntry[];
  /** For familiarity via recently cooked meals. */
  readonly context: PlanningContext;
}

export interface SwapRankTerm {
  readonly weight: Rational;
  readonly raw: Rational;
  readonly weighted: Rational;
}

export interface SwapRankBreakdown {
  readonly terms: Readonly<Record<SwapRankTermName, SwapRankTerm>>;
  /** Σ weighted terms. */
  readonly total: Rational;
}

export interface SwapAlternative {
  readonly recipe: Recipe;
  readonly score: ScoreBreakdown;
  readonly rank: SwapRankBreakdown;
  /** ≤ MAX_REASON_CODES_PER_MEAL facts; copy comes from reasons.ts. */
  readonly facts: readonly ReasonFact[];
}

/** Honest accounting of what happened to the pool. */
export interface SwapCounts {
  readonly pool_size: number;
  /** Removed because the recipe is already one of the three plan meals. */
  readonly already_in_plan: number;
  /** Removed because they do not deliver the requested reason. */
  readonly ineligible_for_reason: number;
  /** Candidates that were actually ranked. */
  readonly eligible: number;
}

export type SwapNoAlternativesCode =
  | 'no_candidates_in_pool'
  | 'all_candidates_already_in_plan'
  | 'no_candidate_satisfies_reason';

export type SwapResult =
  | {
      readonly kind: 'alternatives';
      readonly reason: SwapReason;
      readonly swap_slot: SwapSlot;
      /** The two untouched meals, in slot order — the SAME references the
       * request carried. Provably unchanged. */
      readonly unchanged: readonly [SwapMealInput, SwapMealInput];
      /** 1..max_alternatives, best first. */
      readonly alternatives: readonly SwapAlternative[];
      readonly counts: SwapCounts;
    }
  | {
      readonly kind: 'no_alternatives';
      readonly reason: SwapReason;
      readonly swap_slot: SwapSlot;
      readonly unchanged: readonly [SwapMealInput, SwapMealInput];
      /** WHY there is nothing to offer — typed, with the counts above. */
      readonly explanation: SwapNoAlternativesCode;
      readonly counts: SwapCounts;
    };

// ---------------------------------------------------------------------------
// Helpers — all deterministic, all Rational arithmetic via qty.ts
// ---------------------------------------------------------------------------

function clamp01(x: Rational): Rational {
  return min(ONE, max(ZERO, x));
}

function compareIds(a: Uuid, b: Uuid): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function requiredIngredientIds(recipe: Recipe): ReadonlySet<IngredientId> {
  const ids = new Set<IngredientId>();
  for (const line of recipe.ingredients) {
    if (!line.optional) ids.add(line.ingredient_id);
  }
  return ids;
}

/** True when any ingredient line (id or display name, optional lines
 * included — a garnish is still pasta) or the recipe name itself carries a
 * configured pasta fragment. */
export function containsPasta(recipe: Recipe, config: SwapConfig = SWAP_CONFIG): boolean {
  const haystacks: string[] = [recipe.name.toLowerCase()];
  for (const line of recipe.ingredients) {
    haystacks.push(line.ingredient_id.toLowerCase(), line.display_name.toLowerCase());
  }
  return haystacks.some((h) => config.pasta_name_fragments.some((f) => h.includes(f)));
}

/** Anchored (attribute → familiar value set) evidence: everything seen in
 * a recently cooked meal or carried by a positive preference signal. */
type FamiliarSets = Readonly<Record<keyof AttributeVector, ReadonlySet<string>>>;

function familiarSets(
  signals: readonly PreferenceSignal[],
  context: PlanningContext,
): FamiliarSets {
  const familiar: Record<keyof AttributeVector, Set<string>> = {
    protein: new Set<string>(),
    cuisine: new Set<string>(),
    flavour: new Set<string>(),
    texture: new Set<string>(),
    spice: new Set<string>(),
    richness: new Set<string>(),
    method: new Set<string>(),
    effort: new Set<string>(),
  };
  for (const meal of context.recent_meals) {
    const a = meal.attributes;
    familiar.protein.add(a.protein);
    familiar.cuisine.add(a.cuisine);
    for (const f of a.flavour) familiar.flavour.add(f);
    for (const t of a.texture) familiar.texture.add(t);
    familiar.spice.add(a.spice);
    familiar.richness.add(a.richness);
    familiar.method.add(a.method);
    familiar.effort.add(a.effort);
  }
  for (const signal of signals) {
    if (sign(signal.value) === 1) familiar[signal.attribute].add(signal.attribute_value);
  }
  return familiar;
}

/** Per-axis anchor flags, in the fixed eight-axis order. Any overlap
 * counts for the list axes flavour/texture. */
function anchoredAxes(attributes: AttributeVector, familiar: FamiliarSets): readonly boolean[] {
  return [
    familiar.protein.has(attributes.protein),
    familiar.cuisine.has(attributes.cuisine),
    attributes.flavour.some((f) => familiar.flavour.has(f)),
    attributes.texture.some((t) => familiar.texture.has(t)),
    familiar.spice.has(attributes.spice),
    familiar.richness.has(attributes.richness),
    familiar.method.has(attributes.method),
    familiar.effort.has(attributes.effort),
  ];
}

/**
 * Familiarity in [0, 1]: the fraction of the eight attribute axes anchored
 * in either a recently cooked meal or a positive preference signal (any
 * overlap for the list axes flavour/texture). The same anchor notion the
 * individual novelty component uses, applied symmetrically here so
 * `more_familiar` and `more_adventurous` pull in exactly opposite
 * directions.
 */
export function familiarityOf(
  attributes: AttributeVector,
  signals: readonly PreferenceSignal[],
  context: PlanningContext,
): Rational {
  const axes = anchoredAxes(attributes, familiarSets(signals, context));
  const count = axes.filter((x) => x).length;
  return rational(count, axes.length);
}

/** Fraction of required (non-optional) ingredient lines with USABLE
 * inventory — confidence `confirmed` or `assumed_staple`, positive
 * quantity. `inferred` is never trusted (SPEC). Zero countable lines → 0. */
export function ownedIngredientFraction(
  recipe: Recipe,
  inventory: readonly InventoryEntry[],
): Rational {
  const counts = ownedIngredientCounts(recipe, inventory);
  if (counts.total === 0) return ZERO;
  return rational(counts.owned, counts.total);
}

function ownedIngredientCounts(
  recipe: Recipe,
  inventory: readonly InventoryEntry[],
): { readonly owned: number; readonly total: number } {
  const usable = new Set<IngredientId>();
  for (const entry of inventory) {
    if (
      (entry.confidence === 'confirmed' || entry.confidence === 'assumed_staple') &&
      sign(entry.quantity) === 1
    ) {
      usable.add(entry.ingredient_id);
    }
  }
  let total = 0;
  let owned = 0;
  for (const line of recipe.ingredients) {
    if (line.optional) continue;
    total += 1;
    if (usable.has(line.ingredient_id)) owned += 1;
  }
  return { owned, total };
}

/** 1 − seconds/reference, clamped — strictly decreasing up to the
 * reference, so less time is always a better fit. */
function timeFit(seconds: number, referenceSeconds: number): Rational {
  if (referenceSeconds <= 0) return ZERO;
  return clamp01(sub(ONE, div(fromInt(seconds), fromInt(referenceSeconds))));
}

// ---------------------------------------------------------------------------
// The nine reasons: eligibility (a promise kept) + fit (a direction)
// ---------------------------------------------------------------------------

interface ReasonInputs {
  readonly current: SwapMealInput;
  readonly signals: readonly PreferenceSignal[];
  readonly inventory: readonly InventoryEntry[];
  readonly context: PlanningContext;
  readonly config: SwapConfig;
}

/** True when the candidate genuinely DELIVERS the reason relative to the
 * outgoing meal — strict, so an alternative can never quietly be "faster"
 * while taking the same or longer. */
function eligibleForReason(reason: SwapReason, candidate: Recipe, r: ReasonInputs): boolean {
  const current = r.current.recipe;
  switch (reason) {
    case 'faster':
      return compare(fromInt(candidate.total_time_seconds), fromInt(current.total_time_seconds)) === -1;
    case 'less_hands_on':
      return compare(fromInt(candidate.active_time_seconds), fromInt(current.active_time_seconds)) === -1;
    case 'fewer_dishes':
      return compare(fromInt(candidate.dish_count), fromInt(current.dish_count)) === -1;
    case 'cheaper':
      return (
        compare(
          r.config.cost_band_values[candidate.cost_band],
          r.config.cost_band_values[current.cost_band],
        ) === -1
      );
    case 'more_familiar':
      return (
        compare(
          familiarityOf(candidate.attributes, r.signals, r.context),
          familiarityOf(current.attributes, r.signals, r.context),
        ) === 1
      );
    case 'more_adventurous':
      return (
        compare(
          familiarityOf(candidate.attributes, r.signals, r.context),
          familiarityOf(current.attributes, r.signals, r.context),
        ) === -1
      );
    case 'no_pasta':
      return !containsPasta(candidate, r.config);
    case 'different_protein':
      return candidate.attributes.protein !== current.attributes.protein;
    case 'use_what_i_have':
      return (
        compare(
          ownedIngredientFraction(candidate, r.inventory),
          ownedIngredientFraction(current, r.inventory),
        ) === 1
      );
  }
}

/** The reason-fit term in [0, 1] — each reason's fit strictly improves in
 * the direction its name promises, so with the dominant `reason_fit`
 * weight the ranking measurably moves that way. Purely-categorical reasons
 * (`no_pasta`, `different_protein`) already did their work in eligibility
 * and rank neutrally at 1. */
function reasonFit(reason: SwapReason, candidate: Recipe, r: ReasonInputs): Rational {
  switch (reason) {
    case 'faster':
      return timeFit(candidate.total_time_seconds, r.config.faster_reference_total_seconds);
    case 'less_hands_on':
      return timeFit(candidate.active_time_seconds, r.config.hands_on_reference_active_seconds);
    case 'fewer_dishes':
      if (r.config.dishes_reference_count <= 0) return ZERO;
      return clamp01(
        sub(ONE, div(fromInt(candidate.dish_count), fromInt(r.config.dishes_reference_count))),
      );
    case 'cheaper':
      return sub(ONE, r.config.cost_band_values[candidate.cost_band]);
    case 'more_familiar':
      return familiarityOf(candidate.attributes, r.signals, r.context);
    case 'more_adventurous':
      return sub(ONE, familiarityOf(candidate.attributes, r.signals, r.context));
    case 'no_pasta':
      return ONE;
    case 'different_protein':
      return ONE;
    case 'use_what_i_have':
      return ownedIngredientFraction(candidate, r.inventory);
  }
}

// ---------------------------------------------------------------------------
// Frozen-context ranking — computed against the two untouched meals ONLY
// ---------------------------------------------------------------------------

function rankCandidate(
  candidate: SwapMealInput,
  reason: SwapReason,
  frozen: readonly [SwapMealInput, SwapMealInput],
  r: ReasonInputs,
): SwapRankBreakdown {
  const w = r.config.rank_weights;

  // Ingredient overlap with the FROZEN pair: fraction of the candidate's
  // required ingredients already needed by the two untouched meals — those
  // items are on the grocery list regardless.
  const own = requiredIngredientIds(candidate.recipe);
  const frozenIds = new Set<IngredientId>();
  for (const meal of frozen) {
    for (const id of requiredIngredientIds(meal.recipe)) frozenIds.add(id);
  }
  let sharedCount = 0;
  for (const id of own) {
    if (frozenIds.has(id)) sharedCount += 1;
  }
  const overlapRaw = own.size === 0 ? ZERO : rational(sharedCount, own.size);

  // Diversity against the FROZEN pair only — the outgoing meal is gone and
  // must contribute nothing to the context.
  const frozenProteins = new Set(frozen.map((m) => m.recipe.attributes.protein));
  const frozenCuisines = new Set(frozen.map((m) => m.recipe.attributes.cuisine));
  const proteinRaw = frozenProteins.has(candidate.recipe.attributes.protein) ? ZERO : ONE;
  const cuisineRaw = frozenCuisines.has(candidate.recipe.attributes.cuisine) ? ZERO : ONE;

  const mkTerm = (weight: Rational, rawValue: Rational): SwapRankTerm => {
    const raw = clamp01(rawValue);
    return { weight, raw, weighted: mul(weight, raw) };
  };
  const terms: Readonly<Record<SwapRankTermName, SwapRankTerm>> = {
    reason_fit: mkTerm(w.reason_fit, reasonFit(reason, candidate.recipe, r)),
    individual_fit: mkTerm(w.individual_fit, candidate.score.total),
    ingredient_overlap: mkTerm(w.ingredient_overlap, overlapRaw),
    protein_diversity: mkTerm(w.protein_diversity, proteinRaw),
    cuisine_diversity: mkTerm(w.cuisine_diversity, cuisineRaw),
  };
  let total = ZERO;
  for (const name of SWAP_RANK_TERM_NAMES) total = add(total, terms[name].weighted);
  return { terms, total };
}

// ---------------------------------------------------------------------------
// Reason facts — emitted for reasons.ts to render; never prose here
// ---------------------------------------------------------------------------

const AXIS_ORDER: readonly (keyof AttributeVector)[] = [
  'protein',
  'cuisine',
  'flavour',
  'texture',
  'spice',
  'richness',
  'method',
  'effort',
];

/** The reason-specific fact, when one is honestly renderable. */
function primaryFact(reason: SwapReason, candidate: Recipe, r: ReasonInputs): ReasonFact | null {
  switch (reason) {
    case 'faster':
      return {
        code: 'quick_total_time',
        total_seconds: candidate.total_time_seconds,
        active_seconds: candidate.active_time_seconds,
      };
    case 'less_hands_on':
      return {
        code: 'low_active_time',
        total_seconds: candidate.total_time_seconds,
        active_seconds: candidate.active_time_seconds,
      };
    case 'fewer_dishes':
      return { code: 'few_dishes', dish_count: candidate.dish_count };
    case 'cheaper':
      return {
        code: 'budget_friendly',
        cost_band: candidate.cost_band,
        ingredient_count: requiredIngredientIds(candidate).size,
      };
    case 'use_what_i_have': {
      const counts = ownedIngredientCounts(candidate, r.inventory);
      return { code: 'uses_owned_ingredients', owned_count: counts.owned, total_count: counts.total };
    }
    case 'more_familiar': {
      // Prefer a positive signal that applies; deterministic choice: the
      // strongest confidence, then attribute order, then value.
      const applying = r.signals
        .filter((s) => sign(s.value) === 1 && signalAppliesToRecipe(s, candidate.attributes))
        .sort((a, b) => {
          const byConfidence = compare(b.confidence, a.confidence);
          if (byConfidence !== 0) return byConfidence;
          if (a.attribute !== b.attribute) return a.attribute < b.attribute ? -1 : 1;
          return compareIds(a.attribute_value, b.attribute_value);
        });
      const strongest = applying[0];
      if (strongest !== undefined) {
        return {
          code: 'matches_taste',
          attribute: strongest.attribute,
          attribute_value: strongest.attribute_value,
          signal_count: applying.length,
        };
      }
      const timesCooked = r.context.recent_meals.filter((m) => m.recipe_id === candidate.id).length;
      if (timesCooked > 0) return { code: 'familiar_favourite', times_cooked: timesCooked };
      return null;
    }
    case 'more_adventurous': {
      // One familiar anchor kept + one new axis tried, in fixed axis order.
      const attrs = candidate.attributes;
      const familiar = familiarSets(r.signals, r.context);
      let familiarAxis: { readonly attribute: keyof AttributeVector; readonly value: string } | null =
        null;
      let newAxis: { readonly attribute: keyof AttributeVector; readonly value: string } | null = null;
      for (const axis of AXIS_ORDER) {
        const values: readonly string[] =
          axis === 'flavour' || axis === 'texture' ? attrs[axis] : [attrs[axis]];
        for (const value of values) {
          const anchored = familiar[axis].has(value);
          if (anchored && familiarAxis === null) familiarAxis = { attribute: axis, value };
          if (!anchored && newAxis === null) newAxis = { attribute: axis, value };
        }
      }
      if (familiarAxis !== null && newAxis !== null) {
        return {
          code: 'adjacent_novelty',
          familiar_attribute: familiarAxis.attribute,
          familiar_value: familiarAxis.value,
          new_attribute: newAxis.attribute,
          new_value: newAxis.value,
        };
      }
      return null;
    }
    case 'no_pasta':
    case 'different_protein':
      return null;
  }
}

function factsFor(
  reason: SwapReason,
  candidate: SwapMealInput,
  frozen: readonly [SwapMealInput, SwapMealInput],
  r: ReasonInputs,
): readonly ReasonFact[] {
  const facts: ReasonFact[] = [];
  const primary = primaryFact(reason, candidate.recipe, r);
  if (primary !== null) facts.push(primary);

  // The frozen meal sharing the most required ingredients, ties to the
  // earlier slot — the set-context story the alternative was ranked with.
  const own = requiredIngredientIds(candidate.recipe);
  let bestMeal: SwapMealInput | null = null;
  let bestShared = 0;
  for (const meal of frozen) {
    const theirs = requiredIngredientIds(meal.recipe);
    let sharedCount = 0;
    for (const id of own) {
      if (theirs.has(id)) sharedCount += 1;
    }
    if (sharedCount > bestShared) {
      bestShared = sharedCount;
      bestMeal = meal;
    }
  }
  if (bestMeal !== null && bestShared > 0 && !facts.some((f) => f.code === 'shares_ingredients')) {
    facts.push({
      code: 'shares_ingredients',
      shared_count: bestShared,
      other_meal_name: bestMeal.recipe.name,
    });
  }
  if (!facts.some((f) => f.code === 'quick_total_time' || f.code === 'low_active_time')) {
    facts.push({
      code: 'quick_total_time',
      total_seconds: candidate.recipe.total_time_seconds,
      active_seconds: candidate.recipe.active_time_seconds,
    });
  }
  return facts.slice(0, MAX_REASON_CODES_PER_MEAL);
}

// ---------------------------------------------------------------------------
// The swap
// ---------------------------------------------------------------------------

/**
 * Re-rank the candidate pool for ONE meal slot against the two frozen
 * remaining meals. Returns at most `max_alternatives` alternatives, best
 * first, plus the two untouched meals as the same references the request
 * carried — or a typed `no_alternatives` outcome with honest counts.
 */
export function swapMeal(request: SwapRequest, config: SwapConfig = SWAP_CONFIG): SwapResult {
  const [slot0, slot1, slot2] = request.meals;
  const current = request.meals[request.swap_slot];
  // The frozen context: the SAME references the request carried, in slot
  // order — provably untouched.
  const frozenPair: readonly [SwapMealInput, SwapMealInput] =
    request.swap_slot === 0 ? [slot1, slot2] : request.swap_slot === 1 ? [slot0, slot2] : [slot0, slot1];
  const r: ReasonInputs = {
    current,
    signals: request.signals,
    inventory: request.inventory,
    context: request.context,
    config,
  };

  // Canonical order: nothing downstream depends on caller array order.
  const pool = [...request.candidates].sort((a, b) => compareIds(a.recipe.id, b.recipe.id));

  const planIds = new Set(request.meals.map((m) => m.recipe.id));
  const notInPlan = pool.filter((c) => !planIds.has(c.recipe.id));
  const eligible = notInPlan.filter((c) => eligibleForReason(request.reason, c.recipe, r));

  const counts: SwapCounts = {
    pool_size: pool.length,
    already_in_plan: pool.length - notInPlan.length,
    ineligible_for_reason: notInPlan.length - eligible.length,
    eligible: eligible.length,
  };

  if (eligible.length === 0) {
    const explanation: SwapNoAlternativesCode =
      pool.length === 0
        ? 'no_candidates_in_pool'
        : notInPlan.length === 0
          ? 'all_candidates_already_in_plan'
          : 'no_candidate_satisfies_reason';
    return {
      kind: 'no_alternatives',
      reason: request.reason,
      swap_slot: request.swap_slot,
      unchanged: frozenPair,
      explanation,
      counts,
    };
  }

  const ranked = eligible
    .map((candidate) => ({
      candidate,
      rank: rankCandidate(candidate, request.reason, frozenPair, r),
    }))
    .sort((a, b) => {
      const byScore = compare(b.rank.total, a.rank.total);
      if (byScore !== 0) return byScore;
      return compareIds(a.candidate.recipe.id, b.candidate.recipe.id);
    });

  const alternatives: readonly SwapAlternative[] = ranked
    .slice(0, config.max_alternatives)
    .map(({ candidate, rank }) => ({
      recipe: candidate.recipe,
      score: candidate.score,
      rank,
      facts: factsFor(request.reason, candidate, frozenPair, r),
    }));

  return {
    kind: 'alternatives',
    reason: request.reason,
    swap_slot: request.swap_slot,
    unchanged: frozenPair,
    alternatives,
    counts,
  };
}
