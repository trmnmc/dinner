/**
 * score.ts — configurable weighted scoring with persisted breakdowns
 * (wave 1B, T-006). Phase 2 of the deterministic recommendation engine.
 *
 * Scoring accepts ONLY a `HardFilterResult` from `filters.ts` and scores
 * its survivors — a hard-excluded recipe is structurally unreachable here,
 * by construction, never merely ranked last.
 *
 * SPEC weights: 0.32 preference + 0.20 context/interruption + 0.16
 * inventory use + 0.12 cost + 0.10 novelty + 0.10 leftover usefulness,
 * minus explicit penalties. All weights, penalty amounts and thresholds
 * live in the ONE exported `SCORE_CONFIG` object — never inline literals.
 *
 * Every survivor gets a full `ScoreBreakdown`: all six components and all
 * six penalty keys always present (a missing key is a bug — the
 * show-the-math drawer renders exactly this record and the persisted row
 * is the audit trail), with total = Σ weighted − Σ penalties, exactly.
 *
 * Invariant 1 binds: every weight, raw fit, weighted product, penalty and
 * total is a `Rational`. No floats anywhere.
 *
 * Determinism: a pure function of (survivors, household, signals,
 * inventory, context, config). No LLM, no randomness, no clock — recency
 * arrives as caller-supplied `days_ago`. Identical inputs give a
 * byte-identical breakdown.
 */

import type {
  Household,
  IngredientId,
  InventoryEntry,
  NoveltyPreference,
  PreferenceSignal,
  Recipe,
  ScoreBreakdown,
  ScoreComponent,
  ScoreComponentName,
  ScorePenaltyName,
  ScoreWeights,
} from './recipe.ts';
import type { Rational } from './qty.ts';
import {
  ONE,
  ZERO,
  abs,
  add,
  compare,
  div,
  fromInt,
  isZero,
  max,
  min,
  mul,
  rational,
  sign,
  sub,
} from './qty.ts';
import type { HardFilterResult, PlanningContext } from './filters.ts';
import { signalAppliesToRecipe } from './filters.ts';

// ---------------------------------------------------------------------------
// Configuration — the single source of every weight, amount and threshold
// ---------------------------------------------------------------------------

export interface ScoreConfig {
  /** The six component weights. Must sum to exactly one (tested). */
  readonly weights: ScoreWeights;
  /** Base penalty amounts; `dish_count` is PER extra dish (see cap). */
  readonly penalty_amounts: Readonly<Record<ScorePenaltyName, Rational>>;
  /** Meals cooked within this many days (inclusive) draw the repeat /
   * repeated-cuisine / repeated-format penalties. The HARD repeat window
   * (`filters.ts`) already removed anything more recent. */
  readonly repeat_penalty_window_days: number;
  /** Active seconds strictly above this draw `excessive_active_time`. */
  readonly excessive_active_time_threshold_seconds: number;
  /** Dishes at or under this count draw no `dish_count` penalty. */
  readonly dish_count_free_allowance: number;
  /** Ceiling on the accumulated per-dish penalty. */
  readonly dish_count_penalty_cap: Rational;
  /** Ideal attribute distance per novelty preference (see `noveltyRaw`). */
  readonly novelty_target_distance: Readonly<Record<NoveltyPreference, Rational>>;
  /** Servings strictly above this multiple of household size draw
   * `likely_waste` — more food than the household plausibly eats. */
  readonly waste_servings_per_person_max: Rational;
}

/** THE weights-and-penalties config object (SPEC "weights live in one
 * config object, never inline literals"). Weights sum to exactly 1. */
export const SCORE_CONFIG: ScoreConfig = {
  weights: {
    preference: rational(32, 100),
    context_interruption: rational(20, 100),
    inventory_use: rational(16, 100),
    cost: rational(12, 100),
    novelty: rational(10, 100),
    leftover_usefulness: rational(10, 100),
  },
  penalty_amounts: {
    recent_repeat: rational(15, 100),
    repeated_cuisine: rational(6, 100),
    repeated_format: rational(4, 100),
    excessive_active_time: rational(8, 100),
    dish_count: rational(2, 100),
    likely_waste: rational(5, 100),
  },
  repeat_penalty_window_days: 14,
  excessive_active_time_threshold_seconds: 2400,
  dish_count_free_allowance: 3,
  dish_count_penalty_cap: rational(10, 100),
  novelty_target_distance: {
    stick_to_favourites: ZERO,
    mostly_familiar: rational(1, 4),
    adventurous: rational(1, 2),
  },
  waste_servings_per_person_max: rational(2),
};

/** Component key order used when summing — fixed for byte-identical
 * output; also handy for tests asserting key completeness. */
export const SCORE_COMPONENT_NAMES: readonly ScoreComponentName[] = [
  'preference',
  'context_interruption',
  'inventory_use',
  'cost',
  'novelty',
  'leftover_usefulness',
];

export const SCORE_PENALTY_NAMES: readonly ScorePenaltyName[] = [
  'recent_repeat',
  'repeated_cuisine',
  'repeated_format',
  'excessive_active_time',
  'dish_count',
  'likely_waste',
];

const HALF = rational(1, 2);
const TWO = rational(2);

// ---------------------------------------------------------------------------
// Entry point — takes ONLY the hard-filter result (phase separation)
// ---------------------------------------------------------------------------

/**
 * Score every hard-filter survivor. One full `ScoreBreakdown` per
 * survivor, aligned with `filtered.survivors` order. Excluded recipes
 * cannot be scored: they are simply not in the input.
 */
export function scoreSurvivors(
  filtered: HardFilterResult,
  household: Household,
  signals: readonly PreferenceSignal[],
  inventory: readonly InventoryEntry[],
  context: PlanningContext,
  config: ScoreConfig = SCORE_CONFIG,
): readonly ScoreBreakdown[] {
  return filtered.survivors.map((recipe) =>
    scoreOne(recipe, household, signals, inventory, context, config),
  );
}

function scoreOne(
  recipe: Recipe,
  household: Household,
  signals: readonly PreferenceSignal[],
  inventory: readonly InventoryEntry[],
  context: PlanningContext,
  config: ScoreConfig,
): ScoreBreakdown {
  const w = config.weights;
  const components: Readonly<Record<ScoreComponentName, ScoreComponent>> = {
    preference: component(w.preference, preferenceRaw(recipe, signals)),
    context_interruption: component(w.context_interruption, contextInterruptionRaw(recipe)),
    inventory_use: component(w.inventory_use, inventoryUseRaw(recipe, inventory)),
    cost: component(w.cost, costRaw(recipe)),
    novelty: component(w.novelty, noveltyRaw(recipe, household, signals, context, config)),
    leftover_usefulness: component(w.leftover_usefulness, leftoverUsefulnessRaw(recipe, household)),
  };
  const penalties = penaltiesFor(recipe, household, context, config);

  let weightedSum = ZERO;
  for (const name of SCORE_COMPONENT_NAMES) {
    weightedSum = add(weightedSum, components[name].weighted);
  }
  let penaltySum = ZERO;
  for (const name of SCORE_PENALTY_NAMES) {
    penaltySum = add(penaltySum, penalties[name]);
  }

  return {
    recipe_id: recipe.id,
    components,
    penalties,
    total: sub(weightedSum, penaltySum),
  };
}

function clamp01(x: Rational): Rational {
  return min(ONE, max(ZERO, x));
}

function component(weight: Rational, rawFit: Rational): ScoreComponent {
  const raw = clamp01(rawFit);
  return { weight, raw, weighted: mul(weight, raw) };
}

// ---------------------------------------------------------------------------
// Component raw fits — each an exact Rational in [0, 1]
// ---------------------------------------------------------------------------

/**
 * Preference fit (0.32): confidence-weighted mean of the values of every
 * signal that applies to this recipe (see `signalAppliesToRecipe`), mapped
 * from [−1, 1] to [0, 1] via (mean + 1) / 2. No applicable signals →
 * neutral 1/2. Strong dislikes never reach here — they hard-filter.
 */
function preferenceRaw(recipe: Recipe, signals: readonly PreferenceSignal[]): Rational {
  let weightedValues = ZERO;
  let confidenceSum = ZERO;
  for (const signal of signals) {
    if (!signalAppliesToRecipe(signal, recipe.attributes)) continue;
    weightedValues = add(weightedValues, mul(signal.value, signal.confidence));
    confidenceSum = add(confidenceSum, signal.confidence);
  }
  if (isZero(confidenceSum)) return HALF;
  const mean = div(weightedValues, confidenceSum); // in [−1, 1]
  return div(add(mean, ONE), TWO);
}

/**
 * Context/interruption fit (0.20): mean per-step fit over the recipe's
 * steps. Per step: (risk value + pausability) / 2, halved again when the
 * step requires continuous attention. Risk value: low = 1, medium = 1/2,
 * high = 0. Pausability: 1 when the step is safe to pause during or ends
 * at a natural stopping point, else 0.
 */
function contextInterruptionRaw(recipe: Recipe): Rational {
  if (recipe.steps.length === 0) return HALF;
  let total = ZERO;
  for (const step of recipe.steps) {
    const risk =
      step.interruption_risk === 'low' ? ONE : step.interruption_risk === 'medium' ? HALF : ZERO;
    const pausable = step.safe_to_pause_during || step.natural_stopping_point ? ONE : ZERO;
    let fit = div(add(risk, pausable), TWO);
    if (step.requires_continuous_attention) fit = div(fit, TWO);
    total = add(total, fit);
  }
  return div(total, fromInt(recipe.steps.length));
}

/**
 * Inventory-use fit (0.16): the fraction of the recipe's non-optional
 * ingredient lines whose ingredient has a USABLE inventory entry —
 * confidence `confirmed` or `assumed_staple` with positive quantity
 * (`inferred` is never trusted, per SPEC). Count-based on canonical
 * ingredient ids; unit conversion is a different module's concern. No
 * countable lines → neutral 1/2.
 */
function inventoryUseRaw(recipe: Recipe, inventory: readonly InventoryEntry[]): Rational {
  const usable = new Set<IngredientId>();
  for (const entry of inventory) {
    if (
      (entry.confidence === 'confirmed' || entry.confidence === 'assumed_staple') &&
      sign(entry.quantity) === 1
    ) {
      usable.add(entry.ingredient_id);
    }
  }
  let counted = 0;
  let owned = 0;
  for (const line of recipe.ingredients) {
    if (line.optional) continue;
    counted += 1;
    if (usable.has(line.ingredient_id)) owned += 1;
  }
  if (counted === 0) return HALF;
  return div(fromInt(owned), fromInt(counted));
}

/** Cost fit (0.12): band low = 1, medium = 1/2, high = 0. */
function costRaw(recipe: Recipe): Rational {
  return recipe.cost_band === 'low' ? ONE : recipe.cost_band === 'medium' ? HALF : ZERO;
}

/**
 * Adjacent-novelty fit (0.10): attribute distance with at least one
 * familiar anchor preserved (SPEC).
 *
 * A recipe axis is FAMILIAR when its value appears in a recent meal's
 * attributes or in any positive preference signal (any overlap for the
 * list axes flavour/texture). distance = unfamiliar axes / 8.
 *
 * With ZERO familiar anchors the fit is 0 — a fully alien recipe is never
 * "adjacent", however adventurous the household. Otherwise the fit is
 * 1 − |distance − target|, where the target distance per novelty
 * preference lives in the config (stick_to_favourites 0, mostly_familiar
 * 1/4, adventurous 1/2).
 */
function noveltyRaw(
  recipe: Recipe,
  household: Household,
  signals: readonly PreferenceSignal[],
  context: PlanningContext,
  config: ScoreConfig,
): Rational {
  const familiar = {
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

  const a = recipe.attributes;
  const axisFamiliarity: readonly boolean[] = [
    familiar.protein.has(a.protein),
    familiar.cuisine.has(a.cuisine),
    a.flavour.some((f) => familiar.flavour.has(f)),
    a.texture.some((t) => familiar.texture.has(t)),
    familiar.spice.has(a.spice),
    familiar.richness.has(a.richness),
    familiar.method.has(a.method),
    familiar.effort.has(a.effort),
  ];
  const anchors = axisFamiliarity.filter((x) => x).length;
  if (anchors === 0) return ZERO;
  const distance = rational(axisFamiliarity.length - anchors, axisFamiliarity.length);
  const target = config.novelty_target_distance[household.novelty_preference];
  return clamp01(sub(ONE, abs(sub(distance, target))));
}

/**
 * Leftover-usefulness fit (0.10): how much deliberate surplus the default
 * batch yields — clamp01(servings_default / household_size − 1). Exactly
 * feeding the household → 0; a full second dinner (2×) → 1.
 */
function leftoverUsefulnessRaw(recipe: Recipe, household: Household): Rational {
  const size = household.household_size >= 1 ? household.household_size : 1;
  const ratio = div(fromInt(recipe.servings_default), fromInt(size));
  return clamp01(sub(ratio, ONE));
}

// ---------------------------------------------------------------------------
// Penalties — every key always present; ≥ 0; exactly zero when not applied
// ---------------------------------------------------------------------------

function penaltiesFor(
  recipe: Recipe,
  household: Household,
  context: PlanningContext,
  config: ScoreConfig,
): Readonly<Record<ScorePenaltyName, Rational>> {
  const amounts = config.penalty_amounts;
  const recent = context.recent_meals.filter(
    (m) => m.days_ago <= config.repeat_penalty_window_days,
  );

  const recentRepeat = recent.some((m) => m.recipe_id === recipe.id)
    ? amounts.recent_repeat
    : ZERO;
  const repeatedCuisine = recent.some((m) => m.attributes.cuisine === recipe.attributes.cuisine)
    ? amounts.repeated_cuisine
    : ZERO;
  const repeatedFormat = recent.some((m) => m.attributes.method === recipe.attributes.method)
    ? amounts.repeated_format
    : ZERO;

  const excessiveActive =
    compare(
      fromInt(recipe.active_time_seconds),
      fromInt(config.excessive_active_time_threshold_seconds),
    ) === 1
      ? amounts.excessive_active_time
      : ZERO;

  const extraDishes =
    recipe.dish_count > config.dish_count_free_allowance
      ? recipe.dish_count - config.dish_count_free_allowance
      : 0;
  const dishCount =
    extraDishes === 0
      ? ZERO
      : min(config.dish_count_penalty_cap, mul(fromInt(extraDishes), amounts.dish_count));

  const size = household.household_size >= 1 ? household.household_size : 1;
  const wasteCeiling = mul(config.waste_servings_per_person_max, fromInt(size));
  const likelyWaste =
    compare(fromInt(recipe.servings_default), wasteCeiling) === 1 ? amounts.likely_waste : ZERO;

  return {
    recent_repeat: recentRepeat,
    repeated_cuisine: repeatedCuisine,
    repeated_format: repeatedFormat,
    excessive_active_time: excessiveActive,
    dish_count: dishCount,
    likely_waste: likelyWaste,
  };
}
