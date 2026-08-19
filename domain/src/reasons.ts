/**
 * reasons.ts — the single copy module (wave 1D, T-013).
 *
 * EVERY human-readable time string and EVERY reason-code string in the
 * product originates here. Two exports carry the whole contract:
 *
 * - `renderTotalActiveTime` — the ONE shared total-vs-active time renderer
 *   (DESIGN.md Identity contract). It takes both a total and an active
 *   duration and returns both rendered separately (plus a combined label)
 *   in a single call — there is no code path that renders a time with only
 *   one of the two numbers, because the function signature does not allow
 *   supplying only one (DoD 6).
 * - `renderMealReasons` / `renderReason` — exhaustive, typed copy for every
 *   `ReasonCode` in the frozen union (recipe.ts), built from numeric slots
 *   the caller supplies, never string concatenation scattered through
 *   planning logic. A `never`-check in the switch makes a twelfth reason
 *   code a compile error here, not a silent gap.
 *
 * `renderRecoveryGuidance` also lives here (Invariant 6): recovery/panic
 * copy is either the verbatim per-step `recovery_instruction.text`, or the
 * one fixed, honest "no recovery guidance for this step" sentence when the
 * metadata is `none_available`. No other string is reachable from this
 * function — there is no template that could interpolate a fabricated
 * instruction.
 *
 * Rounding: seconds → minutes happens ONCE, in `renderTotalActiveTime`,
 * through `qty.ts`'s `roundNearestInt` (nearest, exact halves away from
 * zero) — never bare float division (Invariant 1).
 *
 * Voice (DESIGN.md): concrete and countable ("22 min total, 7 min
 * hands-on" — never "quick and convenient"), guilt-free (no "waste", no
 * "you should have"), honest about uncertainty, no false precision. This
 * module never emits a vague qualifier standing alone — every rendered
 * sentence carries at least one caller-supplied number.
 */

import type { Allergen, CostBand, DietaryTag, PreferenceAttribute, ReasonCode, RecoveryGuidance, Uuid } from './recipe.ts';
import type { Rational } from './qty.ts';
import { rational, roundNearestInt } from './qty.ts';
import type { HardExclusionReason, RecipeExclusion } from './filters.ts';

// ---------------------------------------------------------------------------
// Errors — always typed, never a silently wrong or truncated render.
// ---------------------------------------------------------------------------

export type ReasonsErrorCode = 'malformed_input' | 'too_many_reasons';

export class ReasonsError extends Error {
  readonly code: ReasonsErrorCode;
  constructor(code: ReasonsErrorCode, message: string) {
    super(message);
    this.name = 'ReasonsError';
    this.code = code;
  }
}

function nonNegInt(n: number, what: string): number {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ReasonsError('malformed_input', `${what} must be a non-negative integer, got ${String(n)}`);
  }
  return n;
}

/** "" for 1, "s" otherwise. Only ever applied to a caller-supplied count. */
function pluralS(n: number): string {
  return n === 1 ? '' : 's';
}

// ---------------------------------------------------------------------------
// The shared total-vs-active time renderer — DoD 6, structurally enforced.
// ---------------------------------------------------------------------------

export interface TimeRender {
  readonly total_seconds: number;
  readonly active_seconds: number;
  /** Nearest whole minute, rounded ONCE via qty.ts (may be 0). */
  readonly total_minutes: number;
  readonly active_minutes: number;
  /** e.g. "22 min total" / "under 1 min total". */
  readonly total_label: string;
  /** e.g. "7 min hands-on" / "under 1 min hands-on". */
  readonly active_label: string;
  /** e.g. "22 min total, 7 min hands-on" — both numbers, always together. */
  readonly combined_label: string;
}

function minutesOf(seconds: number): number {
  return Number(roundNearestInt(rational(seconds, 60)));
}

function minuteLabel(minutes: number, suffix: string): string {
  return minutes <= 0 ? `under 1 min ${suffix}` : `${String(minutes)} min ${suffix}`;
}

/**
 * THE only function in the product that turns a duration pair into display
 * text. Always takes total AND active together and always returns both,
 * separately, plus a combined label — it is not possible to call this and
 * get only one side of the pair.
 */
export function renderTotalActiveTime(total_seconds: number, active_seconds: number): TimeRender {
  nonNegInt(total_seconds, 'total_seconds');
  nonNegInt(active_seconds, 'active_seconds');
  if (active_seconds > total_seconds) {
    throw new ReasonsError(
      'malformed_input',
      `active_seconds (${String(active_seconds)}) exceeds total_seconds (${String(total_seconds)})`,
    );
  }
  const total_minutes = minutesOf(total_seconds);
  const active_minutes = minutesOf(active_seconds);
  const total_label = minuteLabel(total_minutes, 'total');
  const active_label = minuteLabel(active_minutes, 'hands-on');
  return {
    total_seconds,
    active_seconds,
    total_minutes,
    active_minutes,
    total_label,
    active_label,
    combined_label: `${total_label}, ${active_label}`,
  };
}

/** Convenience wrapper over `renderTotalActiveTime` for anything carrying
 * `total_time_seconds` / `active_time_seconds` (a `Recipe`, e.g.) — still
 * the same single renderer underneath, never a second implementation. */
export function renderTotalActiveTimeFor(carrier: {
  readonly total_time_seconds: number;
  readonly active_time_seconds: number;
}): TimeRender {
  return renderTotalActiveTime(carrier.total_time_seconds, carrier.active_time_seconds);
}

// ---------------------------------------------------------------------------
// Recovery / panic copy — Invariant 6: metadata verbatim, or the one
// explicit, honest "absent" sentence. Never fabricated.
// ---------------------------------------------------------------------------

/** The single fixed sentence used whenever a step's recovery metadata is
 * `none_available`. This is the ONLY other string this function can return
 * besides the verbatim per-step instruction text. */
export const NO_RECOVERY_GUIDANCE_TEXT = 'No recovery guidance for this step.';

export function renderRecoveryGuidance(guidance: RecoveryGuidance): string {
  if (guidance.kind === 'instruction') return guidance.text;
  return NO_RECOVERY_GUIDANCE_TEXT;
}

// ---------------------------------------------------------------------------
// Reason-code copy — exhaustive over the frozen eleven-member ReasonCode
// union, numeric slots supplied by the caller, never inline prose.
// ---------------------------------------------------------------------------

export type ReasonFact =
  | {
      readonly code: 'matches_taste';
      readonly attribute: PreferenceAttribute;
      readonly attribute_value: string;
      readonly signal_count: number;
    }
  | { readonly code: 'quick_total_time'; readonly total_seconds: number; readonly active_seconds: number }
  | { readonly code: 'low_active_time'; readonly total_seconds: number; readonly active_seconds: number }
  | {
      readonly code: 'interruption_friendly';
      readonly pausable_step_count: number;
      readonly total_step_count: number;
    }
  | { readonly code: 'uses_owned_ingredients'; readonly owned_count: number; readonly total_count: number }
  | { readonly code: 'shares_ingredients'; readonly shared_count: number; readonly other_meal_name: string }
  | { readonly code: 'budget_friendly'; readonly cost_band: CostBand; readonly ingredient_count: number }
  | { readonly code: 'few_dishes'; readonly dish_count: number }
  | { readonly code: 'familiar_favourite'; readonly times_cooked: number }
  | {
      readonly code: 'adjacent_novelty';
      readonly familiar_attribute: PreferenceAttribute;
      readonly familiar_value: string;
      readonly new_attribute: PreferenceAttribute;
      readonly new_value: string;
    }
  | { readonly code: 'leftover_friendly'; readonly extra_servings: number };

export interface RenderedReason {
  readonly code: ReasonCode;
  readonly text: string;
}

function costBandLabel(band: CostBand): string {
  return band === 'low' ? 'Low-cost' : band === 'medium' ? 'Mid-cost' : 'Higher-cost';
}

function assertNever(x: never): never {
  throw new ReasonsError('malformed_input', `unhandled reason code: ${JSON.stringify(x)}`);
}

/** Render one `ReasonFact` to its concrete, countable copy. Exhaustive over
 * every `ReasonCode` — the `default: assertNever(fact)` arm makes adding a
 * twelfth code without updating this switch a compile error. */
export function renderReason(fact: ReasonFact): RenderedReason {
  switch (fact.code) {
    case 'matches_taste': {
      const n = nonNegInt(fact.signal_count, 'signal_count');
      return {
        code: fact.code,
        text: `Matches your rated taste for ${fact.attribute_value} ${fact.attribute} (${String(n)} rating${pluralS(n)}).`,
      };
    }
    case 'quick_total_time': {
      const t = renderTotalActiveTime(fact.total_seconds, fact.active_seconds);
      return { code: fact.code, text: `${t.combined_label}.` };
    }
    case 'low_active_time': {
      const t = renderTotalActiveTime(fact.total_seconds, fact.active_seconds);
      return { code: fact.code, text: `${t.active_label} out of ${t.total_label}.` };
    }
    case 'interruption_friendly': {
      const pausable = nonNegInt(fact.pausable_step_count, 'pausable_step_count');
      const total = nonNegInt(fact.total_step_count, 'total_step_count');
      if (pausable > total) {
        throw new ReasonsError('malformed_input', 'pausable_step_count exceeds total_step_count');
      }
      return { code: fact.code, text: `${String(pausable)} of ${String(total)} steps are safe to pause.` };
    }
    case 'uses_owned_ingredients': {
      const owned = nonNegInt(fact.owned_count, 'owned_count');
      const total = nonNegInt(fact.total_count, 'total_count');
      if (owned > total) {
        throw new ReasonsError('malformed_input', 'owned_count exceeds total_count');
      }
      return {
        code: fact.code,
        text: `Uses ${String(owned)} of ${String(total)} ingredients already on hand.`,
      };
    }
    case 'shares_ingredients': {
      const n = nonNegInt(fact.shared_count, 'shared_count');
      return {
        code: fact.code,
        text: `Shares ${String(n)} ingredient${pluralS(n)} with ${fact.other_meal_name}.`,
      };
    }
    case 'budget_friendly': {
      const n = nonNegInt(fact.ingredient_count, 'ingredient_count');
      return {
        code: fact.code,
        text: `${costBandLabel(fact.cost_band)} ingredient list: ${String(n)} item${pluralS(n)}.`,
      };
    }
    case 'few_dishes': {
      const n = nonNegInt(fact.dish_count, 'dish_count');
      return { code: fact.code, text: `${String(n)} dish${n === 1 ? '' : 'es'} to wash.` };
    }
    case 'familiar_favourite': {
      const n = nonNegInt(fact.times_cooked, 'times_cooked');
      return { code: fact.code, text: `Cooked ${String(n)} time${pluralS(n)} before.` };
    }
    case 'adjacent_novelty': {
      return {
        code: fact.code,
        text: `Keeps the ${fact.familiar_value} ${fact.familiar_attribute} you know, tries ${fact.new_value} ${fact.new_attribute}.`,
      };
    }
    case 'leftover_friendly': {
      const n = nonNegInt(fact.extra_servings, 'extra_servings');
      return {
        code: fact.code,
        text: `Makes ${String(n)} extra serving${pluralS(n)} for later.`,
      };
    }
    default:
      return assertNever(fact);
  }
}

/** At most three reason codes per meal (SPEC / DESIGN.md), enforced here
 * rather than left to caller convention. */
export const MAX_REASON_CODES_PER_MEAL = 3;

/** Render a meal's reason codes, in the order supplied. Throws
 * `too_many_reasons` above the cap rather than silently truncating —
 * silent truncation would hide a planner bug instead of failing loudly. */
export function renderMealReasons(facts: readonly ReasonFact[]): readonly RenderedReason[] {
  if (facts.length > MAX_REASON_CODES_PER_MEAL) {
    throw new ReasonsError(
      'too_many_reasons',
      `a meal may show at most ${String(MAX_REASON_CODES_PER_MEAL)} reasons, got ${String(facts.length)}`,
    );
  }
  return facts.map(renderReason);
}

// ---------------------------------------------------------------------------
// Plan shortfall — WHY a plan came back empty or short (T-041, KI-7).
//
// `applyHardFilters` (filters.ts) already returns, per excluded recipe, an
// ORDERED, non-empty list of `HardExclusionReason`s — the constraint that
// excluded it is never a guess, it is right there in the filter result.
// This section identifies WHICH constraint(s) actually did the excluding
// across the WHOLE excluded set — never a generic "no recipes matched" —
// and renders the honest, concrete, guilt-free copy (DESIGN.md Voice).
//
// A constraint is the "binding" one when it appears in EVERY excluded
// recipe's reasons (not merely its first/most-binding reason — a recipe
// can carry more than one absolute reason at once). When exactly one
// constraint is universal, that is the single named cause. When two or
// more are each independently universal, BOTH are named — picking one
// arbitrarily would be a lie (acceptance #2). When none is universal, the
// exclusions are genuinely mixed and every contributing constraint is
// named with its own count, still never a bare "no results".
// ---------------------------------------------------------------------------

/** One derived, typed cause behind some (or all) of the current exclusions.
 * `excluded_count` is always a real count from the filter results — never
 * estimated. The specific-value fields are `null` only when the excluded
 * recipes under this constraint disagree on the specific value (e.g. two
 * different allergens) — naming one of them then would be a guess, so the
 * copy falls back to the honest, still-concrete generic phrasing instead. */
export type PlanShortfallConstraint =
  | {
      readonly code: 'active_time_ceiling';
      readonly excluded_count: number;
      readonly ceiling_seconds: number;
      /** The shortest active (hands-on) time among the recipes this
       * ceiling excluded — tells the parent exactly how far off they are. */
      readonly quickest_seconds: number;
    }
  | {
      readonly code: 'total_time_ceiling';
      readonly excluded_count: number;
      readonly ceiling_seconds: number;
      readonly quickest_seconds: number;
    }
  | { readonly code: 'allergy'; readonly excluded_count: number; readonly allergen: Allergen | null }
  | { readonly code: 'dietary_restriction'; readonly excluded_count: number; readonly tag: DietaryTag | null }
  | {
      readonly code: 'strong_dislike';
      readonly excluded_count: number;
      readonly attribute: PreferenceAttribute | null;
      readonly attribute_value: string | null;
    }
  | { readonly code: 'explicit_exclusion'; readonly excluded_count: number }
  | { readonly code: 'recent_repeat'; readonly excluded_count: number }
  | { readonly code: 'unverifiable_ingredient'; readonly excluded_count: number };

export type PlanShortfallConstraintCode = PlanShortfallConstraint['code'];

/** The typed reason code the caller/UI switches on: either the one/each
 * universal constraint's own code, or one of these two set-level codes
 * when the honest answer isn't a single named constraint. */
export type PlanShortfallCode = PlanShortfallConstraintCode | 'multiple_constraints' | 'mixed_constraints';

export interface PlanShortfallExplanation {
  readonly code: PlanShortfallCode;
  /** Rendered, ready-to-show copy — concrete, countable, guilt-free, names
   * what the parent can change. Never generic "no results" text. */
  readonly text: string;
  /** Total excluded recipes considered (catalog minus survivors). */
  readonly excluded_count: number;
  /** How many meals short of a full plan this is (1..meals_per_plan). */
  readonly missing_meal_count: number;
  /** One entry per named constraint: length 1 for a single/named code,
   * 2+ for `multiple_constraints`, a full breakdown for `mixed_constraints`. */
  readonly constraints: readonly PlanShortfallConstraint[];
}

function reasonToConstraintCode(reason: HardExclusionReason): PlanShortfallConstraintCode {
  switch (reason.kind) {
    case 'time_ceiling':
      return reason.which === 'active' ? 'active_time_ceiling' : 'total_time_ceiling';
    case 'allergy':
      return 'allergy';
    case 'dietary_restriction':
      return 'dietary_restriction';
    case 'strong_dislike':
      return 'strong_dislike';
    case 'explicit_exclusion':
      return 'explicit_exclusion';
    case 'recent_repeat':
      return 'recent_repeat';
    case 'unverifiable_ingredient':
      return 'unverifiable_ingredient';
  }
}

interface ConstraintBucket {
  readonly recipeIds: Set<Uuid>;
  readonly reasons: HardExclusionReason[];
}

/** Every reason in `bucket.reasons` has `reasonToConstraintCode(r) === code`
 * by construction (buildConstraint is only ever called with a code's own
 * bucket) — the `if (r.kind === ...)` checks below exist to let TypeScript
 * narrow the union, not because the runtime invariant is in doubt. */
function buildConstraint(code: PlanShortfallConstraintCode, bucket: ConstraintBucket): PlanShortfallConstraint {
  const excluded_count = bucket.recipeIds.size;
  switch (code) {
    case 'active_time_ceiling':
    case 'total_time_ceiling': {
      const which = code === 'active_time_ceiling' ? 'active' : 'total';
      let ceiling_seconds = 0;
      let quickest_seconds = Number.POSITIVE_INFINITY;
      for (const r of bucket.reasons) {
        if (r.kind === 'time_ceiling' && r.which === which) {
          ceiling_seconds = r.ceiling_seconds;
          quickest_seconds = Math.min(quickest_seconds, r.recipe_seconds);
        }
      }
      return { code, excluded_count, ceiling_seconds, quickest_seconds: Number.isFinite(quickest_seconds) ? quickest_seconds : 0 };
    }
    case 'allergy': {
      const allergens = new Set<Allergen>();
      for (const r of bucket.reasons) if (r.kind === 'allergy') allergens.add(r.allergen);
      const only = allergens.size === 1 ? [...allergens][0] : undefined;
      return { code, excluded_count, allergen: only ?? null };
    }
    case 'dietary_restriction': {
      const tags = new Set<DietaryTag>();
      for (const r of bucket.reasons) if (r.kind === 'dietary_restriction') tags.add(r.tag);
      const only = tags.size === 1 ? [...tags][0] : undefined;
      return { code, excluded_count, tag: only ?? null };
    }
    case 'strong_dislike': {
      let attribute: PreferenceAttribute | null = null;
      let attribute_value: string | null = null;
      let consistent = true;
      for (const r of bucket.reasons) {
        if (r.kind !== 'strong_dislike') continue;
        if (attribute === null) {
          attribute = r.attribute;
          attribute_value = r.attribute_value;
        } else if (attribute !== r.attribute || attribute_value !== r.attribute_value) {
          consistent = false;
        }
      }
      return { code, excluded_count, attribute: consistent ? attribute : null, attribute_value: consistent ? attribute_value : null };
    }
    case 'explicit_exclusion':
      return { code, excluded_count };
    case 'recent_repeat':
      return { code, excluded_count };
    case 'unverifiable_ingredient':
      return { code, excluded_count };
  }
}

/** e.g. "peanut allergy" / "gluten-free requirement" — never invents a
 * value; only ever echoes one the filter results actually named. */
function tagLabel(tag: DietaryTag): string {
  return tag.replace(/_/g, ' ');
}

/** One self-contained sentence naming this constraint AND what the parent
 * can change — the acceptance #1 requirement lives here, per constraint,
 * so it is never missing regardless of which branch (single/multiple/mixed)
 * assembles the final `text`.
 *
 * `isEmptyPlan` matters ONLY for the "Nothing fits" absolute framing below:
 * a constraint can explain 100% of the EXCLUDED recipes while the plan is
 * still PARTIAL (a real, non-empty state, acceptance #3) — one recipe DID
 * survive elsewhere. Claiming "nothing fits" then would be false, so that
 * phrasing is reserved for a genuinely empty plan; a partial plan always
 * gets the scoped "every excluded recipe" / "N of M excluded recipes"
 * framing instead, which is true regardless of what survived. */
function renderConstraintSentence(c: PlanShortfallConstraint, excludedTotal: number, isEmptyPlan: boolean): string {
  const n = nonNegInt(c.excluded_count, 'excluded_count');
  const all = n === nonNegInt(excludedTotal, 'excludedTotal') && n > 0;
  switch (c.code) {
    case 'active_time_ceiling':
    case 'total_time_ceiling': {
      const dimension = c.code === 'active_time_ceiling' ? 'hands-on' : 'total';
      const ceilingMin = minutesOf(c.ceiling_seconds);
      const quickestMin = minutesOf(c.quickest_seconds);
      const lead =
        all && isEmptyPlan
          ? `Nothing fits your ${String(ceilingMin)}-minute ${dimension} limit`
          : all
            ? `Every excluded recipe exceeds your ${String(ceilingMin)}-minute ${dimension} limit`
            : `${String(n)} of ${String(excludedTotal)} excluded recipes exceed your ${String(ceilingMin)}-minute ${dimension} limit`;
      const quickestNoun = all && isEmptyPlan ? 'the quickest dinner here' : 'the quickest of those';
      return `${lead} — ${quickestNoun} needs ${String(quickestMin)} minute${pluralS(quickestMin)}. Raise the ${dimension} time limit in household settings to see more.`;
    }
    case 'allergy': {
      const who = c.allergen !== null ? `the ${c.allergen} allergy on file` : 'an allergy on file';
      const subject = all ? 'Every excluded recipe' : `${String(n)} of ${String(excludedTotal)} excluded recipes`;
      return `${subject} conflict${all ? 's' : ''} with ${who}. Review allergies in household settings if this doesn't look right.`;
    }
    case 'dietary_restriction': {
      const what = c.tag !== null ? `the ${tagLabel(c.tag)} requirement` : 'a dietary requirement on the household';
      const subject = all ? 'Every excluded recipe' : `${String(n)} of ${String(excludedTotal)} excluded recipes`;
      return `${subject} ${all ? 'is' : 'are'} missing ${what}. Review dietary restrictions in household settings if this doesn't look right.`;
    }
    case 'strong_dislike': {
      const what =
        c.attribute !== null && c.attribute_value !== null
          ? `${c.attribute_value} ${c.attribute}, rated a strong dislike`
          : 'a taste rated a strong dislike';
      const subject = all ? 'Every excluded recipe' : `${String(n)} of ${String(excludedTotal)} excluded recipes`;
      return `${subject} match${all ? 'es' : ''} ${what}. Update that rating in taste preferences to see more.`;
    }
    case 'explicit_exclusion': {
      const subject = all ? 'Every excluded recipe uses' : `${String(n)} of ${String(excludedTotal)} excluded recipes use`;
      return `${subject} an ingredient this household has excluded. Review excluded ingredients in household settings to see more.`;
    }
    case 'recent_repeat': {
      const subject = all ? 'Every excluded recipe was' : `${String(n)} of ${String(excludedTotal)} excluded recipes were`;
      return `${subject} cooked too recently to repeat this week. Check back in a few days.`;
    }
    case 'unverifiable_ingredient': {
      const subject = all ? 'Every excluded recipe has' : `${String(n)} of ${String(excludedTotal)} excluded recipes have`;
      return `${subject} an ingredient this catalog can't yet verify as safe for this household's allergies. This is a catalog gap, not something to change in settings.`;
    }
    default:
      return assertNever(c);
  }
}

/**
 * Derive WHY the current plan came back empty or short, straight from the
 * hard-filter results, and render the copy. Returns `null` when there is
 * nothing to explain (`survivorCount >= mealsPerPlan` — a full plan).
 *
 * `exclusions` must be the `HardFilterResult.exclusions` computed against
 * the SAME candidate set `survivorCount` counts survivors out of — pure
 * function of its inputs, deterministic, no guessing.
 */
export function derivePlanShortfall(
  exclusions: readonly RecipeExclusion[],
  survivorCount: number,
  mealsPerPlan: number,
): PlanShortfallExplanation | null {
  nonNegInt(survivorCount, 'survivorCount');
  nonNegInt(mealsPerPlan, 'mealsPerPlan');
  if (survivorCount >= mealsPerPlan) return null;
  const missing_meal_count = mealsPerPlan - survivorCount;
  const excludedTotal = exclusions.length;

  if (excludedTotal === 0) {
    // Short with nothing excluded: the catalog itself has fewer than
    // `mealsPerPlan` eligible recipes total. Real, honest, not a filter
    // problem — say exactly that rather than naming a constraint that
    // played no part.
    return {
      code: 'mixed_constraints',
      text: 'There are not enough recipes in the catalog yet to fill a full plan — none were excluded by your preferences, the catalog itself is small right now.',
      excluded_count: 0,
      missing_meal_count,
      constraints: [],
    };
  }

  const byCode = new Map<PlanShortfallConstraintCode, ConstraintBucket>();
  for (const exclusion of exclusions) {
    for (const reason of exclusion.reasons) {
      const code = reasonToConstraintCode(reason);
      let bucket = byCode.get(code);
      if (bucket === undefined) {
        bucket = { recipeIds: new Set(), reasons: [] };
        byCode.set(code, bucket);
      }
      bucket.recipeIds.add(exclusion.recipe_id);
      bucket.reasons.push(reason);
    }
  }

  const universal: PlanShortfallConstraintCode[] = [];
  for (const [code, bucket] of byCode) {
    if (bucket.recipeIds.size === excludedTotal) universal.push(code);
  }
  universal.sort();

  const isEmptyPlan = survivorCount === 0;

  if (universal.length === 1) {
    const code = universal[0] as PlanShortfallConstraintCode;
    const constraint = buildConstraint(code, byCode.get(code) as ConstraintBucket);
    return {
      code,
      text: renderConstraintSentence(constraint, excludedTotal, isEmptyPlan),
      excluded_count: excludedTotal,
      missing_meal_count,
      constraints: [constraint],
    };
  }

  if (universal.length >= 2) {
    const constraints = universal.map((code) => buildConstraint(code, byCode.get(code) as ConstraintBucket));
    const sentences = constraints.map((c) => renderConstraintSentence(c, excludedTotal, isEmptyPlan));
    return {
      code: 'multiple_constraints',
      text: `More than one constraint independently accounts for every excluded recipe here — changing just one of them will still leave the others excluded. ${sentences.join(' ')}`,
      excluded_count: excludedTotal,
      missing_meal_count,
      constraints,
    };
  }

  // No single constraint is universal: the exclusions are genuinely mixed.
  // Name every contributing constraint with its own real count rather than
  // picking the loudest one arbitrarily.
  const allCodes = [...byCode.keys()].sort(
    (a, b) => (byCode.get(b) as ConstraintBucket).recipeIds.size - (byCode.get(a) as ConstraintBucket).recipeIds.size || a.localeCompare(b),
  );
  const constraints = allCodes.map((code) => buildConstraint(code, byCode.get(code) as ConstraintBucket));
  const sentences = constraints.map((c) => renderConstraintSentence(c, excludedTotal, isEmptyPlan));
  return {
    code: 'mixed_constraints',
    text: `No single constraint explains every exclusion here — it's a mix. ${sentences.join(' ')}`,
    excluded_count: excludedTotal,
    missing_meal_count,
    constraints,
  };
}

// Re-exported so callers needn't import qty.ts just to hand this module a
// Rational-typed input in the future without a second arithmetic path.
export type { Rational };
