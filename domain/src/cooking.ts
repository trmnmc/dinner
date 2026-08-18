/**
 * cooking.ts — pure cooking-session state machine (wave 1D, item T-012).
 *
 * The core export is `reconstructSession`: a fold from an ordered, append-only
 * cooking-event log plus a QUERY INSTANT to a derived session view — current
 * step, per-timer elapsed/remaining, next safe stopping point, and
 * continuous-attention warnings. Because timers persist an ABSOLUTE UTC end
 * instant (Invariant 2, frozen in `recipe.ts`), recovery after a process kill
 * is arithmetic, not bookkeeping: fold the same log at any later wall-clock
 * time and the view is correct for that time.
 *
 * Rules this module is built on:
 * - PURE. No I/O, no `Date.now()` — the current instant is always a
 *   parameter. (`Date.parse` / `Date#toISOString` are used as pure
 *   ISO-8601 ↔ epoch-ms conversions only.)
 * - Nothing persisted ever carries a `remaining_seconds`. The derived
 *   `TimerSnapshot` below is view-model output, recomputed on every fold,
 *   and must never be written back to storage.
 * - Recovery/panic guidance comes from REQUIRED per-step metadata only
 *   (Invariant 6). When `recovery_instruction` is `none_available`, the view
 *   surfaces an explicit `unavailable` state — guidance is never invented.
 * - Durations are integer seconds; instant arithmetic is integer epoch-ms.
 *   No floats touch anything persisted.
 * - Safety flags (`safe_to_pause_*`) are advisory guidance for the cook; the
 *   machine does not forbid pausing at an unsafe moment (life does not ask),
 *   it tells the truth about the nearest safe stopping point instead.
 */

import type {
  CookingEvent,
  CookingSessionStatus,
  CookingTimer,
  IsoUtcInstant,
  MaximumPause,
  Recipe,
  RecipeStep,
  Uuid,
} from './recipe.ts';

// ---------------------------------------------------------------------------
// Errors — always typed, never a silent wrong view.
// ---------------------------------------------------------------------------

export type CookingErrorCode =
  | 'malformed_instant'
  | 'malformed_duration'
  | 'empty_log'
  | 'bad_first_event'
  | 'recipe_mismatch'
  | 'session_mismatch'
  | 'non_monotonic_seq'
  | 'event_after_terminal'
  | 'invalid_status_for_event'
  | 'step_out_of_order'
  | 'unknown_step'
  | 'no_timer_on_step'
  | 'duplicate_timer'
  | 'unknown_timer'
  | 'invalid_timer_instants';

export class CookingError extends Error {
  readonly code: CookingErrorCode;
  constructor(code: CookingErrorCode, message: string) {
    super(message);
    this.name = 'CookingError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Instant arithmetic — integer epoch milliseconds, pure conversions.
// ---------------------------------------------------------------------------

/** Parse a UTC ISO-8601 instant to integer epoch ms. Throws on garbage. */
export function instantToEpochMs(iso: IsoUtcInstant): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new CookingError('malformed_instant', `not an instant: ${JSON.stringify(iso)}`);
  }
  return ms;
}

/** `iso + seconds`, returned as a canonical UTC ISO-8601 instant. */
export function addSecondsToInstant(iso: IsoUtcInstant, seconds: number): IsoUtcInstant {
  if (!Number.isSafeInteger(seconds)) {
    throw new CookingError('malformed_duration', `seconds must be a safe integer, got ${String(seconds)}`);
  }
  return new Date(instantToEpochMs(iso) + seconds * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Timer construction + derived snapshots
// ---------------------------------------------------------------------------

/**
 * Build the persistable timer a step starts: the absolute end instant is
 * computed ONCE here (`started_at + timer_duration_seconds`) and stored;
 * everything afterwards is derived from it. Throws `no_timer_on_step` when
 * the step's `timer_duration_seconds` is null — a timer is never invented.
 */
export function timerForStep(
  step: RecipeStep,
  id: Uuid,
  started_at_utc: IsoUtcInstant,
  label?: string,
): CookingTimer {
  const duration = step.timer_duration_seconds;
  if (duration === null) {
    throw new CookingError('no_timer_on_step', `step ${step.index} defines no timer`);
  }
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new CookingError('malformed_duration', `step ${step.index} timer duration ${String(duration)} is not a positive integer`);
  }
  return {
    id,
    step_index: step.index,
    label: label ?? step.instruction,
    started_at_utc,
    ends_at_utc: addSecondsToInstant(started_at_utc, duration),
    duration_seconds: duration,
  };
}

/**
 * DERIVED timer state at a query instant. Never persisted — recomputed from
 * the timer's absolute end instant on every fold. `remaining_seconds` rounds
 * up (a timer with 300ms left still shows 1s); `elapsed_seconds` rounds down
 * and is clamped to [0, duration]; `overrun_seconds` is how long ago an
 * expired timer ended (0 while running).
 */
export interface TimerSnapshot {
  readonly timer: CookingTimer;
  readonly elapsed_seconds: number;
  readonly remaining_seconds: number;
  readonly expired: boolean;
  readonly overrun_seconds: number;
}

export function timerSnapshot(timer: CookingTimer, at: IsoUtcInstant): TimerSnapshot {
  const atMs = instantToEpochMs(at);
  const startMs = instantToEpochMs(timer.started_at_utc);
  const endsMs = instantToEpochMs(timer.ends_at_utc);
  if (endsMs <= startMs) {
    throw new CookingError('invalid_timer_instants', `timer ${timer.id} ends at or before it starts`);
  }
  const remaining = Math.max(0, Math.ceil((endsMs - atMs) / 1000));
  const elapsed = Math.min(timer.duration_seconds, Math.max(0, Math.floor((atMs - startMs) / 1000)));
  const expired = atMs >= endsMs;
  const overrun = Math.max(0, Math.floor((atMs - endsMs) / 1000));
  return { timer, elapsed_seconds: elapsed, remaining_seconds: remaining, expired, overrun_seconds: overrun };
}

// ---------------------------------------------------------------------------
// Next safe stopping point — from safe_to_pause_before/during/after and
// natural_stopping_point metadata only.
// ---------------------------------------------------------------------------

export type NextSafeStop =
  /** The current step itself is safe to pause during — stop right now. */
  | {
      readonly kind: 'now';
      readonly step_index: number;
      readonly maximum_pause: MaximumPause;
      readonly natural_stopping_point: boolean;
    }
  /** Safe once step `step_index` is complete. */
  | {
      readonly kind: 'after_step';
      readonly step_index: number;
      readonly maximum_pause: MaximumPause;
      readonly natural_stopping_point: boolean;
    }
  /** Safe at the boundary before starting step `step_index` (the same
   * instant as completing step `step_index − 1`, whose maximum_pause and
   * natural_stopping_point therefore apply). */
  | {
      readonly kind: 'before_step';
      readonly step_index: number;
      readonly maximum_pause: MaximumPause;
      readonly natural_stopping_point: boolean;
    }
  /** A later step is safe to pause during (mid-step). */
  | {
      readonly kind: 'during_step';
      readonly step_index: number;
      readonly maximum_pause: MaximumPause;
      readonly natural_stopping_point: boolean;
    }
  /** No safe pause remains before the recipe simply ends. */
  | { readonly kind: 'end_of_recipe' };

/**
 * The nearest safe stopping point at or after `currentStepIndex`, scanning
 * each step's pause boundaries in time order: before → during → after.
 * `safe_to_pause_before` of the CURRENT step is not offered as "now" —
 * without a step_started event the fold cannot know the cook has not already
 * begun it, so only `safe_to_pause_during` earns `kind: 'now'`.
 */
export function nextSafeStop(steps: readonly RecipeStep[], currentStepIndex: number): NextSafeStop {
  for (let j = currentStepIndex; j < steps.length; j = j + 1) {
    const s = steps[j] as RecipeStep;
    if (j > currentStepIndex && s.safe_to_pause_before) {
      const prev = steps[j - 1] as RecipeStep;
      return {
        kind: 'before_step',
        step_index: j,
        maximum_pause: prev.maximum_pause,
        natural_stopping_point: prev.natural_stopping_point,
      };
    }
    if (s.safe_to_pause_during) {
      return {
        kind: j === currentStepIndex ? 'now' : 'during_step',
        step_index: j,
        maximum_pause: s.maximum_pause,
        natural_stopping_point: false,
      };
    }
    if (s.safe_to_pause_after) {
      return {
        kind: 'after_step',
        step_index: j,
        maximum_pause: s.maximum_pause,
        natural_stopping_point: s.natural_stopping_point,
      };
    }
  }
  return { kind: 'end_of_recipe' };
}

// ---------------------------------------------------------------------------
// Continuous-attention warnings — from requires_continuous_attention only.
// ---------------------------------------------------------------------------

export interface AttentionWarning {
  readonly step_index: number;
  /** 'current': the step underway needs uninterrupted attention.
   *  'upcoming': the next continuous-attention step ahead — warn BEFORE it. */
  readonly phase: 'current' | 'upcoming';
  /** The uninterrupted stretch the step demands: active + unattended time. */
  readonly uninterrupted_seconds: number;
}

/** Warning for the current step (if it demands continuous attention) plus
 * the FIRST later step that does, so the warning lands before it starts. */
export function attentionWarnings(
  steps: readonly RecipeStep[],
  currentStepIndex: number,
): readonly AttentionWarning[] {
  const warnings: AttentionWarning[] = [];
  for (let j = currentStepIndex; j < steps.length; j = j + 1) {
    const s = steps[j] as RecipeStep;
    if (!s.requires_continuous_attention) continue;
    warnings.push({
      step_index: j,
      phase: j === currentStepIndex ? 'current' : 'upcoming',
      uninterrupted_seconds: s.active_duration_seconds + s.unattended_duration_seconds,
    });
    if (j > currentStepIndex) break; // current + first upcoming only
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Recovery view — metadata or an EXPLICIT unavailable state, never invented.
// ---------------------------------------------------------------------------

export type RecoveryView =
  | { readonly kind: 'instruction'; readonly step_index: number; readonly text: string }
  /** `step_index` null when there is no current step (all steps complete). */
  | { readonly kind: 'unavailable'; readonly step_index: number | null };

export function recoveryView(currentStep: RecipeStep | null): RecoveryView {
  if (currentStep === null) return { kind: 'unavailable', step_index: null };
  const guidance = currentStep.recovery_instruction;
  if (guidance.kind === 'instruction') {
    return { kind: 'instruction', step_index: currentStep.index, text: guidance.text };
  }
  return { kind: 'unavailable', step_index: currentStep.index };
}

// ---------------------------------------------------------------------------
// Pause view — how long the pause has run against the step's maximum_pause.
// ---------------------------------------------------------------------------

export type PauseView =
  | { readonly kind: 'not_paused' }
  | {
      readonly kind: 'paused';
      readonly paused_at_utc: IsoUtcInstant;
      /** Derived: whole seconds since the pause began, ≥ 0. */
      readonly seconds_paused: number;
      /** The current step's maximum_pause (unlimited when no current step —
       * with nothing left to cook there is nothing to spoil). */
      readonly limit: MaximumPause;
      /** paused_at + bounded seconds; null when the limit is unlimited. */
      readonly deadline_utc: IsoUtcInstant | null;
      readonly overdue: boolean;
    };

// ---------------------------------------------------------------------------
// The fold: ordered event log + query instant → derived session view.
// ---------------------------------------------------------------------------

export interface CookingSessionView {
  readonly session_id: Uuid;
  readonly household_id: Uuid;
  readonly recipe_id: Uuid;
  readonly target_servings: number;
  readonly status: CookingSessionStatus;
  /** 0-based; equals steps.length once every step is complete. */
  readonly current_step_index: number;
  /** null once every step is complete. */
  readonly current_step: RecipeStep | null;
  readonly steps_total: number;
  readonly steps_completed: number;
  /** Live (uncancelled, unacknowledged) timers, in start order, with state
   * DERIVED for the query instant from each absolute end instant. */
  readonly timers: readonly TimerSnapshot[];
  readonly next_safe_stop: NextSafeStop;
  readonly attention_warnings: readonly AttentionWarning[];
  readonly recovery: RecoveryView;
  readonly pause: PauseView;
  readonly started_at_utc: IsoUtcInstant;
  readonly last_event_at_utc: IsoUtcInstant;
  /** The query instant this view was derived for. */
  readonly reconstructed_at_utc: IsoUtcInstant;
}

interface FoldState {
  session_id: Uuid;
  household_id: Uuid;
  recipe_id: Uuid;
  target_servings: number;
  status: CookingSessionStatus;
  current_step_index: number;
  timers: CookingTimer[];
  started_at_utc: IsoUtcInstant;
  last_event_at_utc: IsoUtcInstant;
  paused_at_utc: IsoUtcInstant | null;
}

function requireStatus(state: FoldState, event: CookingEvent, allowed: readonly CookingSessionStatus[]): void {
  if (!allowed.includes(state.status)) {
    throw new CookingError(
      'invalid_status_for_event',
      `event seq ${event.seq} (${event.payload.kind}) is illegal while session is ${state.status}`,
    );
  }
}

function applyEvent(state: FoldState, event: CookingEvent, steps: readonly RecipeStep[]): void {
  if (state.status === 'completed' || state.status === 'abandoned') {
    throw new CookingError('event_after_terminal', `event seq ${event.seq} after terminal status ${state.status}`);
  }
  const payload = event.payload;
  switch (payload.kind) {
    case 'session_started':
      throw new CookingError('bad_first_event', `session_started again at seq ${event.seq}`);
    case 'step_completed': {
      requireStatus(state, event, ['active']);
      if (payload.step_index !== state.current_step_index || payload.step_index >= steps.length) {
        throw new CookingError(
          'step_out_of_order',
          `step_completed ${payload.step_index} at seq ${event.seq}, expected ${state.current_step_index} of ${steps.length}`,
        );
      }
      state.current_step_index = state.current_step_index + 1;
      break;
    }
    case 'timer_started': {
      requireStatus(state, event, ['active']);
      const timer = payload.timer;
      if (timer.step_index < 0 || timer.step_index >= steps.length) {
        throw new CookingError('unknown_step', `timer ${timer.id} references step ${timer.step_index}`);
      }
      if (instantToEpochMs(timer.ends_at_utc) <= instantToEpochMs(timer.started_at_utc)) {
        throw new CookingError('invalid_timer_instants', `timer ${timer.id} ends at or before it starts`);
      }
      if (state.timers.some((t) => t.id === timer.id)) {
        throw new CookingError('duplicate_timer', `timer ${timer.id} started twice`);
      }
      state.timers.push(timer);
      break;
    }
    case 'timer_cancelled':
    case 'timer_acknowledged': {
      requireStatus(state, event, ['active', 'paused']);
      const index = state.timers.findIndex((t) => t.id === payload.timer_id);
      if (index === -1) {
        throw new CookingError('unknown_timer', `${payload.kind} for unknown timer ${payload.timer_id}`);
      }
      state.timers.splice(index, 1);
      break;
    }
    case 'session_paused': {
      requireStatus(state, event, ['active']);
      if (payload.at_step_index !== state.current_step_index) {
        throw new CookingError(
          'step_out_of_order',
          `session_paused at step ${payload.at_step_index}, session is at ${state.current_step_index}`,
        );
      }
      state.status = 'paused';
      state.paused_at_utc = event.occurred_at_utc;
      break;
    }
    case 'session_resumed': {
      requireStatus(state, event, ['paused']);
      if (payload.at_step_index !== state.current_step_index) {
        throw new CookingError(
          'step_out_of_order',
          `session_resumed at step ${payload.at_step_index}, session is at ${state.current_step_index}`,
        );
      }
      state.status = 'active';
      state.paused_at_utc = null;
      break;
    }
    case 'session_completed':
      requireStatus(state, event, ['active', 'paused']);
      state.status = 'completed';
      state.paused_at_utc = null;
      break;
    case 'session_abandoned':
      requireStatus(state, event, ['active', 'paused']);
      state.status = 'abandoned';
      state.paused_at_utc = null;
      break;
  }
  state.last_event_at_utc = event.occurred_at_utc;
}

function pauseView(state: FoldState, currentStep: RecipeStep | null, atMs: number): PauseView {
  if (state.status !== 'paused' || state.paused_at_utc === null) return { kind: 'not_paused' };
  const pausedAtMs = instantToEpochMs(state.paused_at_utc);
  const secondsPaused = Math.max(0, Math.floor((atMs - pausedAtMs) / 1000));
  const limit: MaximumPause = currentStep === null ? { kind: 'unlimited' } : currentStep.maximum_pause;
  if (limit.kind === 'bounded') {
    const deadline = addSecondsToInstant(state.paused_at_utc, limit.seconds);
    return {
      kind: 'paused',
      paused_at_utc: state.paused_at_utc,
      seconds_paused: secondsPaused,
      limit,
      deadline_utc: deadline,
      overdue: atMs > instantToEpochMs(deadline),
    };
  }
  return {
    kind: 'paused',
    paused_at_utc: state.paused_at_utc,
    seconds_paused: secondsPaused,
    limit,
    deadline_utc: null,
    overdue: false,
  };
}

/**
 * Reconstruct the full session view from the persisted event log alone, as
 * of the query instant `at`. This is the kill-safety contract: fold the same
 * ordered log at ANY later wall-clock time and every derived number —
 * elapsed, remaining, overrun, pause deadline — is correct for that time,
 * because persisted state holds absolute instants only.
 *
 * The log must be ordered by `seq` (strictly increasing), begin with
 * `session_started`, belong to one session, and describe legal transitions;
 * anything else throws a typed `CookingError` rather than yielding a
 * plausible wrong view.
 */
export function reconstructSession(
  recipe: Recipe,
  events: readonly CookingEvent[],
  at: IsoUtcInstant,
): CookingSessionView {
  const atMs = instantToEpochMs(at);
  if (events.length === 0) {
    throw new CookingError('empty_log', 'cannot reconstruct a session from zero events');
  }
  const first = events[0] as CookingEvent;
  if (first.payload.kind !== 'session_started') {
    throw new CookingError('bad_first_event', `log begins with ${first.payload.kind}, expected session_started`);
  }
  if (first.payload.recipe_id !== recipe.id) {
    throw new CookingError(
      'recipe_mismatch',
      `log is for recipe ${first.payload.recipe_id}, reconstructing against ${recipe.id}`,
    );
  }
  const state: FoldState = {
    session_id: first.session_id,
    household_id: first.household_id,
    recipe_id: first.payload.recipe_id,
    target_servings: first.payload.target_servings,
    status: 'active',
    current_step_index: 0,
    timers: [],
    started_at_utc: first.occurred_at_utc,
    last_event_at_utc: first.occurred_at_utc,
    paused_at_utc: null,
  };
  let prevSeq = first.seq;
  for (let i = 1; i < events.length; i = i + 1) {
    const event = events[i] as CookingEvent;
    if (event.session_id !== state.session_id || event.household_id !== state.household_id) {
      throw new CookingError('session_mismatch', `event seq ${event.seq} belongs to a different session`);
    }
    if (event.seq <= prevSeq) {
      throw new CookingError('non_monotonic_seq', `seq ${event.seq} after seq ${prevSeq}`);
    }
    prevSeq = event.seq;
    applyEvent(state, event, recipe.steps);
  }
  const currentStep =
    state.current_step_index < recipe.steps.length
      ? (recipe.steps[state.current_step_index] as RecipeStep)
      : null;
  return {
    session_id: state.session_id,
    household_id: state.household_id,
    recipe_id: state.recipe_id,
    target_servings: state.target_servings,
    status: state.status,
    current_step_index: state.current_step_index,
    current_step: currentStep,
    steps_total: recipe.steps.length,
    steps_completed: state.current_step_index,
    timers: state.timers.map((timer) => timerSnapshot(timer, at)),
    next_safe_stop: nextSafeStop(recipe.steps, state.current_step_index),
    attention_warnings: attentionWarnings(recipe.steps, state.current_step_index),
    recovery: recoveryView(currentStep),
    pause: pauseView(state, currentStep, atMs),
    started_at_utc: state.started_at_utc,
    last_event_at_utc: state.last_event_at_utc,
    reconstructed_at_utc: at,
  };
}
