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

import type { CostBand, PreferenceAttribute, ReasonCode, RecoveryGuidance } from './recipe.ts';
import type { Rational } from './qty.ts';
import { rational, roundNearestInt } from './qty.ts';

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

// Re-exported so callers needn't import qty.ts just to hand this module a
// Rational-typed input in the future without a second arithmetic path.
export type { Rational };
