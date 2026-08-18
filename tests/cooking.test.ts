/**
 * cooking.test.ts — proves the cooking session state machine is kill-safe.
 *
 * The acceptance contract: a session reconstructed PURELY from its persisted
 * events at any later wall-clock time yields the correct current step,
 * elapsed/remaining timer state, next safe stopping point, and
 * continuous-attention warnings — with recovery guidance drawn only from
 * per-step metadata and an explicit 'unavailable' state when metadata is
 * absent. The core proof folds the SAME event log at several different query
 * instants, including one long after every timer expired.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CookingEvent,
  CookingEventPayload,
  Recipe,
  RecipeStep,
} from '../domain/src/recipe.ts';
import {
  CookingError,
  addSecondsToInstant,
  attentionWarnings,
  instantToEpochMs,
  nextSafeStop,
  reconstructSession,
  timerForStep,
  timerSnapshot,
} from '../domain/src/cooking.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = '2026-08-18T17:00:00.000Z';
/** T0 + n whole seconds. */
function at(seconds: number): string {
  return addSecondsToInstant(T0, seconds);
}

function step(index: number, overrides: Partial<RecipeStep> = {}): RecipeStep {
  return {
    id: `s${index}`,
    index,
    instruction: `Step ${index}`,
    equipment: [],
    active_duration_seconds: 120,
    unattended_duration_seconds: 0,
    requires_continuous_attention: false,
    safe_to_pause_before: true,
    safe_to_pause_during: true,
    safe_to_pause_after: true,
    maximum_pause: { kind: 'unlimited' },
    natural_stopping_point: false,
    interruption_risk: 'low',
    recovery_instruction: { kind: 'instruction', text: `Recover step ${index}.` },
    timer_duration_seconds: null,
    ...overrides,
  };
}

/**
 * Four steps exercising the metadata space:
 * 0 chop     — fully safe, recovery instruction present.
 * 1 sear     — continuous attention, unsafe during/after, bounded pause,
 *              high risk, validated recovery instruction.
 * 2 simmer   — 20-minute timer, safe during/after, natural stopping point,
 *              recovery metadata ABSENT (none_available).
 * 3 plate    — continuous attention, unsafe before/during/after, bounded
 *              pause, recovery instruction present.
 */
const STEPS: readonly RecipeStep[] = [
  step(0),
  step(1, {
    requires_continuous_attention: true,
    safe_to_pause_during: false,
    safe_to_pause_after: false,
    maximum_pause: { kind: 'bounded', seconds: 120 },
    interruption_risk: 'high',
    active_duration_seconds: 300,
    unattended_duration_seconds: 60,
    recovery_instruction: { kind: 'instruction', text: 'Slide the pan off the heat.' },
  }),
  step(2, {
    safe_to_pause_before: false,
    natural_stopping_point: true,
    timer_duration_seconds: 1200,
    active_duration_seconds: 30,
    unattended_duration_seconds: 1200,
    maximum_pause: { kind: 'bounded', seconds: 600 },
    recovery_instruction: { kind: 'none_available' },
  }),
  step(3, {
    requires_continuous_attention: true,
    safe_to_pause_before: false,
    safe_to_pause_during: false,
    safe_to_pause_after: false,
    maximum_pause: { kind: 'bounded', seconds: 300 },
    active_duration_seconds: 240,
    recovery_instruction: { kind: 'instruction', text: 'Serve what is plated; keep the rest warm.' },
  }),
];

const RECIPE: Recipe = {
  id: 'recipe-1',
  slug: 'test-skillet',
  name: 'Test skillet',
  description: 'Fixture recipe for the cooking state machine.',
  servings_default: 4,
  attributes: {
    protein: 'chicken',
    cuisine: 'american',
    flavour: ['savoury'],
    texture: ['tender'],
    spice: 'none',
    richness: 'medium',
    method: 'stovetop',
    effort: 'low',
  },
  dietary_tags: [],
  allergens: [],
  equipment: ['skillet'],
  cost_band: 'low',
  dish_count: 2,
  total_time_seconds: 1950,
  active_time_seconds: 690,
  ingredients: [],
  steps: STEPS,
};

let seqCounter = 0;
function ev(seq: number, occurredSeconds: number, payload: CookingEventPayload): CookingEvent {
  seqCounter = seqCounter + 1;
  return {
    id: `ev-${String(seqCounter)}-${String(seq)}`,
    household_id: 'hh-1',
    session_id: 'sess-1',
    seq,
    occurred_at_utc: at(occurredSeconds),
    payload,
  };
}

const SIMMER_TIMER = timerForStep(STEPS[2] as RecipeStep, 'tmr-1', at(600));

/** The canonical log: start, chop done at +3m, sear done at +10m, simmer
 * timer started at +10m (ends +30m). Persisted state holds ONLY absolute
 * instants — every elapsed/remaining figure below is derived per query. */
const LOG: readonly CookingEvent[] = [
  ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
  ev(2, 180, { kind: 'step_completed', step_index: 0 }),
  ev(3, 600, { kind: 'step_completed', step_index: 1 }),
  ev(4, 600, { kind: 'timer_started', timer: SIMMER_TIMER }),
];

// ---------------------------------------------------------------------------
// Invariant 2 — timers persist absolute end instants, never remaining time.
// ---------------------------------------------------------------------------

test('timerForStep persists the absolute end instant, never remaining seconds', () => {
  assert.equal(SIMMER_TIMER.started_at_utc, at(600));
  assert.equal(SIMMER_TIMER.ends_at_utc, at(1800)); // start + 1200s, exact
  assert.equal(SIMMER_TIMER.duration_seconds, 1200);
  assert.ok(!('remaining_seconds' in SIMMER_TIMER), 'persisted timer must not carry remaining_seconds');
  assert.equal(
    instantToEpochMs(SIMMER_TIMER.ends_at_utc) - instantToEpochMs(SIMMER_TIMER.started_at_utc),
    1200 * 1000,
  );
});

test('timerForStep refuses to invent a timer for a timerless step', () => {
  assert.throws(
    () => timerForStep(STEPS[0] as RecipeStep, 'tmr-x', T0),
    (e: unknown) => e instanceof CookingError && e.code === 'no_timer_on_step',
  );
});

// ---------------------------------------------------------------------------
// THE CORE PROOF — the same log folded at several query instants.
// ---------------------------------------------------------------------------

test('same log, query at +11m: mid-simmer view is exact', () => {
  const view = reconstructSession(RECIPE, LOG, at(660));
  assert.equal(view.status, 'active');
  assert.equal(view.current_step_index, 2);
  assert.equal((view.current_step as RecipeStep).id, 's2');
  assert.equal(view.steps_completed, 2);
  assert.equal(view.steps_total, 4);

  // Timer state derived from the absolute end instant minus the query instant.
  assert.equal(view.timers.length, 1);
  const t = view.timers[0]!;
  assert.equal(t.elapsed_seconds, 60);
  assert.equal(t.remaining_seconds, 1140);
  assert.equal(t.expired, false);
  assert.equal(t.overrun_seconds, 0);

  // Simmer is safe to pause during — the safe stop is NOW, bounded 600s.
  assert.deepEqual(view.next_safe_stop, {
    kind: 'now',
    step_index: 2,
    maximum_pause: { kind: 'bounded', seconds: 600 },
    natural_stopping_point: false,
  });

  // Simmer itself needs no continuous attention; plating (step 3) does —
  // the warning lands before it, with its uninterrupted duration.
  assert.deepEqual(view.attention_warnings, [
    { step_index: 3, phase: 'upcoming', uninterrupted_seconds: 240 },
  ]);

  // Step 2's recovery metadata is none_available → EXPLICIT unavailable,
  // never a fabricated instruction.
  assert.deepEqual(view.recovery, { kind: 'unavailable', step_index: 2 });
  assert.deepEqual(view.pause, { kind: 'not_paused' });
});

test('same log, query at +20m: only the derived numbers moved', () => {
  const view = reconstructSession(RECIPE, LOG, at(1200));
  assert.equal(view.current_step_index, 2);
  const t = view.timers[0]!;
  assert.equal(t.elapsed_seconds, 600);
  assert.equal(t.remaining_seconds, 600);
  assert.equal(t.expired, false);
  assert.deepEqual(view.recovery, { kind: 'unavailable', step_index: 2 });
});

test('same log, query at +4h — long after every timer expired', () => {
  const view = reconstructSession(RECIPE, LOG, at(14400));
  assert.equal(view.status, 'active');
  assert.equal(view.current_step_index, 2);
  const t = view.timers[0]!;
  assert.equal(t.remaining_seconds, 0);
  assert.equal(t.expired, true);
  assert.equal(t.elapsed_seconds, 1200); // clamped at the timer's duration
  assert.equal(t.overrun_seconds, 14400 - 1800); // ended at +30m
  // Step, safe stop, warnings and recovery are unchanged by wall-clock time.
  assert.deepEqual(view.next_safe_stop, {
    kind: 'now',
    step_index: 2,
    maximum_pause: { kind: 'bounded', seconds: 600 },
    natural_stopping_point: false,
  });
  assert.deepEqual(view.attention_warnings, [
    { step_index: 3, phase: 'upcoming', uninterrupted_seconds: 240 },
  ]);
  assert.deepEqual(view.recovery, { kind: 'unavailable', step_index: 2 });
});

test('reconstruction is deterministic: same log + same instant → deep-equal views', () => {
  assert.deepEqual(
    reconstructSession(RECIPE, LOG, at(750)),
    reconstructSession(RECIPE, LOG, at(750)),
  );
});

test('reconstruction from a log prefix (as after a kill mid-write) is coherent', () => {
  const view = reconstructSession(RECIPE, LOG.slice(0, 2), at(300));
  assert.equal(view.current_step_index, 1);
  assert.equal(view.timers.length, 0);
  // Sear: continuous attention NOW, with its uninterrupted stretch.
  assert.deepEqual(view.attention_warnings, [
    { step_index: 1, phase: 'current', uninterrupted_seconds: 360 },
    { step_index: 3, phase: 'upcoming', uninterrupted_seconds: 240 },
  ]);
  // Sear is unsafe during and after; step 2 is unsafe before but safe
  // during — the nearest safe stop is during step 2.
  assert.deepEqual(view.next_safe_stop, {
    kind: 'during_step',
    step_index: 2,
    maximum_pause: { kind: 'bounded', seconds: 600 },
    natural_stopping_point: false,
  });
  // Recovery text comes verbatim from the step metadata.
  assert.deepEqual(view.recovery, {
    kind: 'instruction',
    step_index: 1,
    text: 'Slide the pan off the heat.',
  });
});

// ---------------------------------------------------------------------------
// Pause bookkeeping against maximum_pause metadata.
// ---------------------------------------------------------------------------

const PAUSED_LOG: readonly CookingEvent[] = [
  ...LOG,
  ev(5, 1810, { kind: 'timer_acknowledged', timer_id: 'tmr-1' }),
  ev(6, 1860, { kind: 'step_completed', step_index: 2 }),
  ev(7, 1920, { kind: 'session_paused', at_step_index: 3 }),
];

test('paused session: pause clock and deadline derive from paused_at + maximum_pause', () => {
  const early = reconstructSession(RECIPE, PAUSED_LOG, at(1980));
  assert.equal(early.status, 'paused');
  assert.equal(early.timers.length, 0); // acknowledged timer is gone
  assert.deepEqual(early.pause, {
    kind: 'paused',
    paused_at_utc: at(1920),
    seconds_paused: 60,
    limit: { kind: 'bounded', seconds: 300 },
    deadline_utc: at(2220),
    overdue: false,
  });
  // Same log, much later: the pause is now overdue — pure arithmetic.
  const late = reconstructSession(RECIPE, PAUSED_LOG, at(4000));
  assert.equal(late.pause.kind, 'paused');
  assert.ok(late.pause.kind === 'paused' && late.pause.overdue);
  assert.ok(late.pause.kind === 'paused' && late.pause.seconds_paused === 2080);
  // Step 3 and everything after it is pause-unsafe: no stop until the end.
  assert.deepEqual(late.next_safe_stop, { kind: 'end_of_recipe' });
  assert.deepEqual(late.recovery, {
    kind: 'instruction',
    step_index: 3,
    text: 'Serve what is plated; keep the rest warm.',
  });
});

test('completed session: no current step, recovery explicitly unavailable', () => {
  const done: readonly CookingEvent[] = [
    ...PAUSED_LOG,
    ev(8, 2100, { kind: 'session_resumed', at_step_index: 3 }),
    ev(9, 2400, { kind: 'step_completed', step_index: 3 }),
    ev(10, 2410, { kind: 'session_completed' }),
  ];
  const view = reconstructSession(RECIPE, done, at(90000));
  assert.equal(view.status, 'completed');
  assert.equal(view.current_step, null);
  assert.equal(view.current_step_index, 4);
  assert.equal(view.steps_completed, 4);
  assert.deepEqual(view.recovery, { kind: 'unavailable', step_index: null });
  assert.deepEqual(view.next_safe_stop, { kind: 'end_of_recipe' });
  assert.deepEqual(view.attention_warnings, []);
  assert.deepEqual(view.pause, { kind: 'not_paused' });
  assert.equal(view.last_event_at_utc, at(2410));
});

test('timer_cancelled removes the timer from every later reconstruction', () => {
  const cancelled: readonly CookingEvent[] = [
    ...LOG,
    ev(5, 700, { kind: 'timer_cancelled', timer_id: 'tmr-1' }),
  ];
  assert.equal(reconstructSession(RECIPE, cancelled, at(800)).timers.length, 0);
});

// ---------------------------------------------------------------------------
// timerSnapshot boundary arithmetic.
// ---------------------------------------------------------------------------

test('timerSnapshot at the exact end instant: expired, zero remaining', () => {
  const s = timerSnapshot(SIMMER_TIMER, SIMMER_TIMER.ends_at_utc);
  assert.equal(s.remaining_seconds, 0);
  assert.equal(s.expired, true);
  assert.equal(s.overrun_seconds, 0);
  assert.equal(s.elapsed_seconds, 1200);
});

test('timerSnapshot rounds a partial second of remaining time UP, not to zero', () => {
  const justBefore = new Date(instantToEpochMs(SIMMER_TIMER.ends_at_utc) - 300).toISOString();
  const s = timerSnapshot(SIMMER_TIMER, justBefore);
  assert.equal(s.remaining_seconds, 1);
  assert.equal(s.expired, false);
});

test('timerSnapshot before the timer started clamps elapsed to zero', () => {
  const s = timerSnapshot(SIMMER_TIMER, at(0));
  assert.equal(s.elapsed_seconds, 0);
  assert.equal(s.remaining_seconds, 1800);
});

// ---------------------------------------------------------------------------
// nextSafeStop / attentionWarnings unit coverage.
// ---------------------------------------------------------------------------

test('nextSafeStop: safe-during current step wins as "now"', () => {
  assert.equal(nextSafeStop(STEPS, 0).kind, 'now');
});

test('nextSafeStop: after_step carries natural_stopping_point and maximum_pause', () => {
  const steps = [
    step(0, { safe_to_pause_during: false, safe_to_pause_after: true, natural_stopping_point: true, maximum_pause: { kind: 'bounded', seconds: 900 } }),
    step(1),
  ];
  assert.deepEqual(nextSafeStop(steps, 0), {
    kind: 'after_step',
    step_index: 0,
    maximum_pause: { kind: 'bounded', seconds: 900 },
    natural_stopping_point: true,
  });
});

test('nextSafeStop: before_step boundary inherits the previous step metadata', () => {
  const steps = [
    step(0, { safe_to_pause_during: false, safe_to_pause_after: false, natural_stopping_point: true, maximum_pause: { kind: 'bounded', seconds: 60 } }),
    step(1, { safe_to_pause_before: true }),
  ];
  assert.deepEqual(nextSafeStop(steps, 0), {
    kind: 'before_step',
    step_index: 1,
    maximum_pause: { kind: 'bounded', seconds: 60 },
    natural_stopping_point: true,
  });
});

test('nextSafeStop: nothing safe anywhere → end_of_recipe', () => {
  const unsafe = { safe_to_pause_before: false, safe_to_pause_during: false, safe_to_pause_after: false } as const;
  const steps = [step(0, unsafe), step(1, unsafe)];
  assert.deepEqual(nextSafeStop(steps, 0), { kind: 'end_of_recipe' });
  assert.deepEqual(nextSafeStop(steps, 2), { kind: 'end_of_recipe' });
});

test('attentionWarnings: current plus first upcoming only, durations from metadata', () => {
  const steps = [
    step(0, { requires_continuous_attention: true, active_duration_seconds: 100, unattended_duration_seconds: 20 }),
    step(1),
    step(2, { requires_continuous_attention: true, active_duration_seconds: 50 }),
    step(3, { requires_continuous_attention: true }),
  ];
  assert.deepEqual(attentionWarnings(steps, 0), [
    { step_index: 0, phase: 'current', uninterrupted_seconds: 120 },
    { step_index: 2, phase: 'upcoming', uninterrupted_seconds: 50 },
  ]);
  assert.deepEqual(attentionWarnings(steps, 1), [
    { step_index: 2, phase: 'upcoming', uninterrupted_seconds: 50 },
  ]);
  assert.deepEqual(attentionWarnings(steps, 4), []);
});

// ---------------------------------------------------------------------------
// The state machine rejects malformed logs with typed errors — a corrupt
// log must never yield a plausible wrong view.
// ---------------------------------------------------------------------------

function rejects(events: readonly CookingEvent[], code: string): void {
  assert.throws(
    () => reconstructSession(RECIPE, events, at(3600)),
    (e: unknown) => e instanceof CookingError && e.code === code,
    `expected CookingError ${code}`,
  );
}

test('rejects an empty log', () => {
  rejects([], 'empty_log');
});

test('rejects a log that does not begin with session_started', () => {
  rejects([ev(1, 0, { kind: 'step_completed', step_index: 0 })], 'bad_first_event');
});

test('rejects a log for a different recipe', () => {
  rejects([ev(1, 0, { kind: 'session_started', recipe_id: 'other-recipe', target_servings: 2 })], 'recipe_mismatch');
});

test('rejects non-monotonic sequence numbers', () => {
  rejects(
    [
      ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
      ev(3, 60, { kind: 'step_completed', step_index: 0 }),
      ev(2, 120, { kind: 'step_completed', step_index: 1 }),
    ],
    'non_monotonic_seq',
  );
});

test('rejects an event from a different session interleaved into the log', () => {
  const stray: CookingEvent = { ...ev(2, 60, { kind: 'step_completed', step_index: 0 }), session_id: 'sess-2' };
  rejects([LOG[0] as CookingEvent, stray], 'session_mismatch');
});

test('rejects steps completed out of order', () => {
  rejects(
    [
      ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
      ev(2, 60, { kind: 'step_completed', step_index: 2 }),
    ],
    'step_out_of_order',
  );
});

test('rejects cancelling a timer that was never started', () => {
  rejects(
    [
      ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
      ev(2, 60, { kind: 'timer_cancelled', timer_id: 'ghost' }),
    ],
    'unknown_timer',
  );
});

test('rejects any event after a terminal status', () => {
  rejects(
    [
      ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
      ev(2, 60, { kind: 'session_abandoned' }),
      ev(3, 120, { kind: 'step_completed', step_index: 0 }),
    ],
    'event_after_terminal',
  );
});

test('rejects pausing twice / resuming an active session', () => {
  rejects(
    [
      ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
      ev(2, 60, { kind: 'session_paused', at_step_index: 0 }),
      ev(3, 120, { kind: 'session_paused', at_step_index: 0 }),
    ],
    'invalid_status_for_event',
  );
  rejects(
    [
      ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
      ev(2, 60, { kind: 'session_resumed', at_step_index: 0 }),
    ],
    'invalid_status_for_event',
  );
});

test('rejects completing a step while paused', () => {
  rejects(
    [
      ev(1, 0, { kind: 'session_started', recipe_id: 'recipe-1', target_servings: 4 }),
      ev(2, 60, { kind: 'session_paused', at_step_index: 0 }),
      ev(3, 120, { kind: 'step_completed', step_index: 0 }),
    ],
    'invalid_status_for_event',
  );
});

test('rejects a malformed query instant with a typed error', () => {
  assert.throws(
    () => reconstructSession(RECIPE, LOG, 'yesterday-ish'),
    (e: unknown) => e instanceof CookingError && e.code === 'malformed_instant',
  );
});
