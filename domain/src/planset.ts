/**
 * planset.ts — the greedy set-scoring pass (wave 1B, T-007).
 *
 * Phase 3 of the deterministic recommendation engine. `score.ts` ranks each
 * survivor INDIVIDUALLY; this module chooses three meals that are good
 * TOGETHER: useful ingredient overlap (a shared ingredient shrinks the
 * grocery list), protein and cuisine diversity (repeats within one week's
 * set are penalised), total weekly active time (the SET must respect the
 * household's time reality, not just each meal) and total cost.
 *
 * Greedy per decision D-2 — combinatorial search over all triples is an
 * explicit non-goal tonight (SPEC nice-to-have): seed with the best
 * individual score, then pick each subsequent meal by the best MARGINAL
 * set score given what is already chosen. Each chosen meal carries the
 * term-by-term marginal contribution that earned it its place, plus
 * `ReasonFact`s (`reasons.ts`) the UI renders — this module emits FACTS,
 * never user-facing strings.
 *
 * Every weight and threshold lives in the ONE exported `PLANSET_CONFIG`
 * object, exactly as `SCORE_CONFIG` does — never inline literals. These
 * are SET-level weights over per-meal scores; `score.ts`'s weights are not
 * restated here.
 *
 * Fewer than three survivors is an explicit, representable outcome (the
 * `short` result kind) — never a throw, never silent padding, never a
 * fabricated meal.
 *
 * Invariant 1 binds: every weight, raw term, weighted term and total is a
 * `Rational` through `qty.ts`. Determinism: pure function of its inputs —
 * no clock, no randomness, no I/O. Every tie breaks on the stable recipe
 * id, so the result can never depend on input array order or engine sort
 * stability: identical inputs give byte-identical output.
 */

import type { CostBand, Household, IngredientId, Recipe, ScoreBreakdown, Uuid } from './recipe.ts';
import type { Rational } from './qty.ts';
import { ONE, ZERO, add, compare, div, fromInt, max, min, mul, rational, sub } from './qty.ts';
import type { HardFilterResult } from './filters.ts';
import type { ReasonFact } from './reasons.ts';
import { MAX_REASON_CODES_PER_MEAL } from './reasons.ts';

// ---------------------------------------------------------------------------
// Errors — a misaligned scores array is a caller bug, reported loudly and
// typed. (A SHORT survivor list is NOT an error — see PlanSetResult.)
// ---------------------------------------------------------------------------

export type PlanSetErrorCode = 'misaligned_scores';

export class PlanSetError extends Error {
  readonly code: PlanSetErrorCode;
  constructor(code: PlanSetErrorCode, message: string) {
    super(message);
    this.name = 'PlanSetError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Configuration — the single source of every set-level weight and threshold
// ---------------------------------------------------------------------------

/** The five acceptance-named set-level terms plus the individual-score
 * carrier, each a separate, individually-inspectable contribution. */
export type SetTermName =
  | 'individual_fit'
  | 'ingredient_overlap'
  | 'protein_diversity'
  | 'cuisine_diversity'
  | 'weekly_active_time'
  | 'total_cost';

export interface PlanSetConfig {
  /** Meals in a full plan (SPEC: three dinners). */
  readonly meals_per_plan: number;
  /** SET-level term weights. Must sum to exactly one (tested). These are
   * NOT `score.ts`'s weights — those already produced `individual_fit`. */
  readonly weights: Readonly<Record<SetTermName, Rational>>;
  /** Weekly hands-on budget when the household has no active-time ceiling.
   * With a ceiling, the budget is ceiling × meals_per_plan instead. */
  readonly default_weekly_active_budget_seconds: number;
  /** Cost value per band for the set's total-cost term (0 = cheapest). */
  readonly cost_band_values: Readonly<Record<CostBand, Rational>>;
  /** Reason-fact thresholds (facts are emitted, copy lives in reasons.ts). */
  readonly reason_low_active_max_seconds: number;
  readonly reason_quick_total_max_seconds: number;
  readonly reason_few_dishes_max: number;
}

/** THE set-level config object — every weight and threshold, no inline
 * numeric literals anywhere in the logic below. */
export const PLANSET_CONFIG: PlanSetConfig = {
  meals_per_plan: 3,
  weights: {
    individual_fit: rational(40, 100),
    ingredient_overlap: rational(20, 100),
    protein_diversity: rational(12, 100),
    cuisine_diversity: rational(8, 100),
    weekly_active_time: rational(12, 100),
    total_cost: rational(8, 100),
  },
  default_weekly_active_budget_seconds: 5400, // 3 dinners × 30 min hands-on
  cost_band_values: { low: ZERO, medium: rational(1, 2), high: ONE },
  reason_low_active_max_seconds: 1200, // ≤ 20 min hands-on
  reason_quick_total_max_seconds: 1800, // ≤ 30 min total
  reason_few_dishes_max: 2,
};

/** Fixed term order for summation and for tests asserting completeness. */
export const SET_TERM_NAMES: readonly SetTermName[] = [
  'individual_fit',
  'ingredient_overlap',
  'protein_diversity',
  'cuisine_diversity',
  'weekly_active_time',
  'total_cost',
];

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** A survivor paired with the individual breakdown `score.ts` gave it. */
export interface PlanCandidate {
  readonly recipe: Recipe;
  readonly score: ScoreBreakdown;
}

export interface SetTerm {
  /** Weight actually used (from the config object). */
  readonly weight: Rational;
  /** Raw term value in [0, 1] before weighting. */
  readonly raw: Rational;
  /** weight × raw. */
  readonly weighted: Rational;
}

/** The set-level score of a whole (possibly partial) set of meals. */
export interface SetEvaluation {
  readonly terms: Readonly<Record<SetTermName, SetTerm>>;
  /** Σ weighted terms. */
  readonly total: Rational;
}

/** The term-by-term MARGINAL contribution a meal added at the moment it
 * was chosen: eval(set ∪ meal) − eval(set), per weighted term. Diversity
 * deltas can be negative — that is honest, inspectable data. */
export interface SetContribution {
  readonly terms: Readonly<Record<SetTermName, Rational>>;
  readonly total: Rational;
}

export interface ChosenMeal {
  /** Position in the plan: 0 is the seed (best individual). */
  readonly slot: number;
  readonly recipe: Recipe;
  /** The individual breakdown from `score.ts`, passed through untouched. */
  readonly score: ScoreBreakdown;
  /** WHY the set pass chose it: its marginal set-score contribution. */
  readonly set_contribution: SetContribution;
  /** At most MAX_REASON_CODES_PER_MEAL facts, rendered by `reasons.ts`. */
  readonly facts: readonly ReasonFact[];
}

/** Fewer than three survivors is representable, never a throw and never a
 * fabricated meal: the `short` kind says exactly how many are missing. */
export type PlanSetResult =
  | {
      readonly kind: 'full';
      readonly meals: readonly [ChosenMeal, ChosenMeal, ChosenMeal];
      /** Set-level evaluation of the three chosen meals together. */
      readonly set: SetEvaluation;
    }
  | {
      readonly kind: 'short';
      /** Every survivor, chosen in greedy order; may be empty. */
      readonly meals: readonly ChosenMeal[];
      readonly set: SetEvaluation;
      readonly survivor_count: number;
      /** How many meals short of a full plan this is (1..meals_per_plan). */
      readonly missing: number;
    };

// ---------------------------------------------------------------------------
// Small helpers — deterministic throughout
// ---------------------------------------------------------------------------

function clamp01(x: Rational): Rational {
  return min(ONE, max(ZERO, x));
}

/** Locale-independent codepoint comparison — the ONE tie-break key. */
function compareIds(a: Uuid, b: Uuid): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Distinct non-optional ingredient ids of a recipe. */
function requiredIngredientIds(recipe: Recipe): ReadonlySet<IngredientId> {
  const ids = new Set<IngredientId>();
  for (const line of recipe.ingredients) {
    if (!line.optional) ids.add(line.ingredient_id);
  }
  return ids;
}

function term(weight: Rational, rawValue: Rational): SetTerm {
  const raw = clamp01(rawValue);
  return { weight, raw, weighted: mul(weight, raw) };
}

/** The weekly hands-on budget: the household's own ceiling × meals when it
 * has one (its stated time reality), else the config default. */
function weeklyActiveBudgetSeconds(household: Household, config: PlanSetConfig): number {
  const ceiling = household.weeknight_active_time_ceiling_seconds;
  return ceiling !== null ? ceiling * config.meals_per_plan : config.default_weekly_active_budget_seconds;
}

// ---------------------------------------------------------------------------
// Set evaluation — the one definition of "good together", exported so a
// test (or the show-the-math drawer) can score ANY set with the same rule.
// ---------------------------------------------------------------------------

/**
 * Score a set of meals TOGETHER. Each term is a separate, inspectable
 * contribution in [0, 1] before its weight:
 *
 * - `individual_fit`: mean of the members' `score.total` (clamped) — the
 *   per-meal quality `score.ts` already established.
 * - `ingredient_overlap`: of all distinct required (non-optional)
 *   ingredient ids in the set, the fraction used by two or more meals.
 *   Shared ingredients are GOOD — they shrink the grocery list.
 * - `protein_diversity` / `cuisine_diversity`: distinct values ÷ set size;
 *   a repeat within the set lowers the term.
 * - `weekly_active_time`: (budget − Σ active seconds) ÷ budget, clamped —
 *   the SET respects the household's weekly hands-on budget.
 * - `total_cost`: 1 − mean cost-band value — a set of low-band meals
 *   scores 1, a set of high-band meals scores 0.
 *
 * The empty set evaluates to all-zero terms.
 */
export function evaluateSet(
  meals: readonly PlanCandidate[],
  household: Household,
  config: PlanSetConfig = PLANSET_CONFIG,
): SetEvaluation {
  const w = config.weights;
  const k = meals.length;
  if (k === 0) {
    const zero: Readonly<Record<SetTermName, SetTerm>> = {
      individual_fit: term(w.individual_fit, ZERO),
      ingredient_overlap: term(w.ingredient_overlap, ZERO),
      protein_diversity: term(w.protein_diversity, ZERO),
      cuisine_diversity: term(w.cuisine_diversity, ZERO),
      weekly_active_time: term(w.weekly_active_time, ZERO),
      total_cost: term(w.total_cost, ZERO),
    };
    return { terms: zero, total: ZERO };
  }
  const count = fromInt(k);

  // Individual fit: mean of the totals score.ts produced.
  let totalSum = ZERO;
  for (const meal of meals) totalSum = add(totalSum, meal.score.total);
  const individualRaw = div(totalSum, count);

  // Ingredient overlap: ids used by ≥ 2 meals ÷ all distinct ids.
  const usage = new Map<IngredientId, number>();
  for (const meal of meals) {
    for (const id of requiredIngredientIds(meal.recipe)) {
      usage.set(id, (usage.get(id) ?? 0) + 1);
    }
  }
  let shared = 0;
  for (const uses of usage.values()) {
    if (uses > 1) shared += 1;
  }
  const overlapRaw = usage.size === 0 ? ZERO : div(fromInt(shared), fromInt(usage.size));

  // Protein / cuisine diversity: distinct ÷ set size.
  const proteins = new Set<string>();
  const cuisines = new Set<string>();
  for (const meal of meals) {
    proteins.add(meal.recipe.attributes.protein);
    cuisines.add(meal.recipe.attributes.cuisine);
  }
  const proteinRaw = div(fromInt(proteins.size), count);
  const cuisineRaw = div(fromInt(cuisines.size), count);

  // Weekly active time: remaining fraction of the hands-on budget.
  const budget = weeklyActiveBudgetSeconds(household, config);
  let activeSum = 0;
  for (const meal of meals) activeSum += meal.recipe.active_time_seconds;
  const timeRaw =
    budget <= 0
      ? activeSum === 0
        ? ONE
        : ZERO
      : div(sub(fromInt(budget), fromInt(activeSum)), fromInt(budget));

  // Total cost: 1 − mean band value.
  let costSum = ZERO;
  for (const meal of meals) {
    costSum = add(costSum, config.cost_band_values[meal.recipe.cost_band]);
  }
  const costRaw = sub(ONE, div(costSum, count));

  const terms: Readonly<Record<SetTermName, SetTerm>> = {
    individual_fit: term(w.individual_fit, individualRaw),
    ingredient_overlap: term(w.ingredient_overlap, overlapRaw),
    protein_diversity: term(w.protein_diversity, proteinRaw),
    cuisine_diversity: term(w.cuisine_diversity, cuisineRaw),
    weekly_active_time: term(w.weekly_active_time, timeRaw),
    total_cost: term(w.total_cost, costRaw),
  };
  let total = ZERO;
  for (const name of SET_TERM_NAMES) total = add(total, terms[name].weighted);
  return { terms, total };
}

function contributionBetween(before: SetEvaluation, after: SetEvaluation): SetContribution {
  const terms: Record<SetTermName, Rational> = {
    individual_fit: sub(after.terms.individual_fit.weighted, before.terms.individual_fit.weighted),
    ingredient_overlap: sub(
      after.terms.ingredient_overlap.weighted,
      before.terms.ingredient_overlap.weighted,
    ),
    protein_diversity: sub(
      after.terms.protein_diversity.weighted,
      before.terms.protein_diversity.weighted,
    ),
    cuisine_diversity: sub(
      after.terms.cuisine_diversity.weighted,
      before.terms.cuisine_diversity.weighted,
    ),
    weekly_active_time: sub(
      after.terms.weekly_active_time.weighted,
      before.terms.weekly_active_time.weighted,
    ),
    total_cost: sub(after.terms.total_cost.weighted, before.terms.total_cost.weighted),
  };
  return { terms, total: sub(after.total, before.total) };
}

// ---------------------------------------------------------------------------
// Reason facts — computed on the FINAL set, emitted as facts only; every
// user-facing string comes from reasons.ts.
// ---------------------------------------------------------------------------

function factsForMeal(
  meal: PlanCandidate,
  others: readonly PlanCandidate[],
  config: PlanSetConfig,
): readonly ReasonFact[] {
  const facts: ReasonFact[] = [];

  // Set-level first: the shared-ingredient story is why this pass exists.
  const own = requiredIngredientIds(meal.recipe);
  let bestOther: PlanCandidate | null = null;
  let bestShared = 0;
  for (const other of others) {
    const theirs = requiredIngredientIds(other.recipe);
    let sharedCount = 0;
    for (const id of own) {
      if (theirs.has(id)) sharedCount += 1;
    }
    // Strictly-greater keeps the earliest slot on ties — deterministic.
    if (sharedCount > bestShared) {
      bestShared = sharedCount;
      bestOther = other;
    }
  }
  if (bestOther !== null && bestShared > 0) {
    facts.push({
      code: 'shares_ingredients',
      shared_count: bestShared,
      other_meal_name: bestOther.recipe.name,
    });
  }

  const recipe = meal.recipe;
  if (recipe.active_time_seconds <= config.reason_low_active_max_seconds) {
    facts.push({
      code: 'low_active_time',
      total_seconds: recipe.total_time_seconds,
      active_seconds: recipe.active_time_seconds,
    });
  }
  if (recipe.total_time_seconds <= config.reason_quick_total_max_seconds) {
    facts.push({
      code: 'quick_total_time',
      total_seconds: recipe.total_time_seconds,
      active_seconds: recipe.active_time_seconds,
    });
  }
  if (recipe.cost_band === 'low') {
    facts.push({
      code: 'budget_friendly',
      cost_band: recipe.cost_band,
      ingredient_count: own.size,
    });
  }
  if (recipe.dish_count <= config.reason_few_dishes_max) {
    facts.push({ code: 'few_dishes', dish_count: recipe.dish_count });
  }

  return facts.slice(0, MAX_REASON_CODES_PER_MEAL);
}

// ---------------------------------------------------------------------------
// The greedy set pass
// ---------------------------------------------------------------------------

/**
 * Choose up to `meals_per_plan` meals that are good TOGETHER.
 *
 * Greedy (decision D-2): the seed is the best INDIVIDUAL score; every
 * subsequent pick maximises `evaluateSet(chosen ∪ candidate).total` given
 * what is already chosen. Ties always break on the smaller recipe id, so
 * input order can never influence the result.
 *
 * `scores` must align one-to-one, in order, with `filtered.survivors`
 * (exactly what `scoreSurvivors` returns) — anything else throws a typed
 * `PlanSetError`, because a silently mispaired score would corrupt every
 * downstream decision.
 */
export function buildPlanSet(
  filtered: HardFilterResult,
  scores: readonly ScoreBreakdown[],
  household: Household,
  config: PlanSetConfig = PLANSET_CONFIG,
): PlanSetResult {
  if (scores.length !== filtered.survivors.length) {
    throw new PlanSetError(
      'misaligned_scores',
      `scores (${String(scores.length)}) must align with survivors (${String(filtered.survivors.length)})`,
    );
  }
  const paired: PlanCandidate[] = filtered.survivors.map((recipe, i) => {
    const score = scores[i] as ScoreBreakdown;
    if (score.recipe_id !== recipe.id) {
      throw new PlanSetError(
        'misaligned_scores',
        `score at index ${String(i)} is for ${score.recipe_id}, survivor is ${recipe.id}`,
      );
    }
    return { recipe, score };
  });
  // Canonical candidate order: sorted by recipe id. From here on nothing
  // depends on the caller's array order.
  paired.sort((a, b) => compareIds(a.recipe.id, b.recipe.id));

  const chosen: PlanCandidate[] = [];
  const contributions: SetContribution[] = [];
  const remaining = new Map<Uuid, PlanCandidate>();
  for (const candidate of paired) remaining.set(candidate.recipe.id, candidate);

  const target = Math.min(config.meals_per_plan, paired.length);
  while (chosen.length < target) {
    const before = evaluateSet(chosen, household, config);
    let best: PlanCandidate | null = null;
    let bestKey: Rational = ZERO;
    for (const candidate of remaining.values()) {
      // Seed by best individual total (D-2); later picks by best set score.
      const key =
        chosen.length === 0
          ? candidate.score.total
          : evaluateSet([...chosen, candidate], household, config).total;
      if (best === null || compare(key, bestKey) === 1) {
        best = candidate;
        bestKey = key;
      }
      // Equal keys never replace: `remaining` iterates in id order, so the
      // smaller recipe id wins ties by construction.
    }
    if (best === null) break; // unreachable while remaining is non-empty
    remaining.delete(best.recipe.id);
    chosen.push(best);
    contributions.push(
      contributionBetween(before, evaluateSet(chosen, household, config)),
    );
  }

  const set = evaluateSet(chosen, household, config);
  const meals: ChosenMeal[] = chosen.map((candidate, slot) => ({
    slot,
    recipe: candidate.recipe,
    score: candidate.score,
    set_contribution: contributions[slot] as SetContribution,
    facts: factsForMeal(
      candidate,
      chosen.filter((_, i) => i !== slot),
      config,
    ),
  }));

  if (meals.length === config.meals_per_plan && meals.length === 3) {
    return {
      kind: 'full',
      meals: [meals[0] as ChosenMeal, meals[1] as ChosenMeal, meals[2] as ChosenMeal],
      set,
    };
  }
  return {
    kind: 'short',
    meals,
    set,
    survivor_count: paired.length,
    missing: config.meals_per_plan - meals.length,
  };
}
