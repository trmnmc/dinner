/**
 * cook.js — cooking mode: one step at a time, built to survive interruption.
 *
 * T-018 entry point: once `session.status === 'completed'`, the terminal
 * panel's one dominant action is "How did it go?", which resolves this
 * session's `plan_meal_id` (see `goToFeedback` below) and navigates to
 * `#/feedback/:planMealId` (`feedback.js`) — the only way into post-meal
 * feedback in this product. "Back to plan" survives as a secondary button
 * so leaving without giving feedback is still one tap away.
 *
 * Data flow: `GET /api/cooking/sessions/:id` (on mount) and
 * `POST /api/cooking/sessions/:id/events` (every action) both return the
 * full session view (`server/src/routes.ts` `encodeSessionView`, backed by
 * `domain/src/cooking.ts` `reconstructSession`). This screen never derives
 * step/pause/timer state on its own — it only ever redraws from whatever
 * view the server last returned.
 *
 * `session.timers[].ends_at_utc` is the ONLY source of truth for a running
 * timer (Invariant 2). This file never decrements a local countdown
 * variable: every tick recomputes `remaining = ends_at_utc − Date.now()`
 * from that absolute instant, so a backgrounded tab, a reload, or this
 * whole process dying and restarting all show the correct remaining time
 * the moment the screen redraws (Invariant 1 / DoD 7's kill-safety
 * contract, extended to the client).
 *
 * T-058 (KI-12 fix): `encodeStepView` now exposes `step.timer_duration_seconds`
 * (`number|null`; null = no timer on this step — never derived from
 * `total_seconds − active_seconds`, which is wrong for several shipped
 * recipes). When it is non-null and no timer is already running for this
 * step, this screen renders ONE tap — "Start N minute timer" — that posts
 * `{ kind: 'timer_started', step_index }`. That is the entire client
 * contribution: `step_index` is the only thing the client supplies. The
 * server (`server/src/routes.ts`'s `resolveEventPayload`) derives the
 * timer's id, absolute `started_at_utc`/`ends_at_utc` and
 * `duration_seconds` itself, from the recipe's authoritative
 * `timer_duration_seconds` and its own clock — this file never computes or
 * sends a duration or an end instant. `session.timers[].step_index` (also
 * new on the wire) is what lets this screen tell "already running" apart
 * from "not started yet" so the control disappears once used rather than
 * risking a second timer for the same step.
 *
 * Resume-into-session recovery (Invariant 6): the session id is persisted
 * to `localStorage['tgd.cooking_session_id']` on every successful load,
 * and cleared the moment the session reaches a terminal status (completed
 * / abandoned) or turns out not to exist. `plan.js` reads the same key to
 * offer a "you're cooking X, step N of M" resume affordance. The route
 * itself (`#/cook/:sessionId`) already carries the id through a plain
 * reload; the localStorage copy is what lets the PLAN screen know a
 * session is in flight without the id being in its URL.
 *
 * Recovery guidance (Invariant 2 / DESIGN.md): `session.recovery_text` is
 * shown verbatim. The server has already resolved it to either the step's
 * real `recovery_instruction` or the one fixed, honest fallback sentence
 * (`domain/src/reasons.ts`'s `NO_RECOVERY_GUIDANCE_TEXT`) — this file never
 * invents, rewords, or generalises cooking advice on top of that.
 */

import {
  h,
  icon,
  mountPrimaryAction,
  renderTimeInfo,
  createStatusBadge,
  createLoadingState,
  createErrorState,
  createEmptyState,
  announce,
} from './ui.js';
import { getCookingSession, postCookingEvent, getCurrentPlan, ApiError } from './api.js';
import { navigate } from './router.js';

/** Matches the `tgd.` prefix convention `api.js` uses for
 * `household_id`/`calibration_done`. Not added to `api.js` itself — that
 * file is outside this item's scope — so both this file and `plan.js`
 * define the same literal key locally rather than sharing an import. */
const COOKING_SESSION_ID_KEY = 'tgd.cooking_session_id';

/**
 * @typedef {Object} StepView
 * @property {number} index
 * @property {string} text
 * @property {number} total_seconds
 * @property {number} active_seconds
 * @property {string} time_label
 * @property {boolean} requires_continuous_attention
 * @property {boolean} safe_to_pause_after
 * @property {number|null} timer_duration_seconds
 */

/**
 * @typedef {Object} TimerView
 * @property {string} timer_id
 * @property {number} step_index
 * @property {string} label
 * @property {string} ends_at_utc
 * @property {number} remaining_seconds
 * @property {boolean} expired
 */

/**
 * @typedef {Object} MaximumPause
 * @property {'bounded'|'unlimited'} kind
 * @property {number} [seconds]
 */

/**
 * @typedef {Object} NextSafeStop
 * @property {'now'|'before_step'|'during_step'|'after_step'|'end_of_recipe'} kind
 * @property {number} [step_index]
 * @property {MaximumPause} [maximum_pause]
 * @property {boolean} [natural_stopping_point]
 */

/**
 * @typedef {Object} AttentionWarning
 * @property {number} step_index
 * @property {'current'|'upcoming'} phase
 * @property {number} uninterrupted_seconds
 */

/**
 * @typedef {Object} SessionView
 * @property {string} session_id
 * @property {string} recipe_id
 * @property {'active'|'paused'|'completed'|'abandoned'} status
 * @property {number} current_step_index
 * @property {number} total_steps
 * @property {StepView|null} step
 * @property {TimerView[]} timers
 * @property {NextSafeStop} next_safe_stop
 * @property {AttentionWarning|null} attention_warning
 * @property {string} recovery_text
 */

// ---------------------------------------------------------------------------
// Copy — concrete and countable, never a vague qualifier standing alone.
// ---------------------------------------------------------------------------

/**
 * Concrete, countable duration copy. Several authored durations in this
 * product are well under a minute (some `maximum_pause` windows are as
 * short as 20s) — rounding those to "under 1 minute" would throw away the
 * exact, countable number the copy guidance asks for, so anything under a
 * minute is shown in seconds instead.
 * @param {number} seconds @returns {string}
 */
function durationWords(seconds) {
  if (seconds < 60) {
    const s = Math.max(0, Math.round(seconds));
    return `${String(s)} second${s === 1 ? '' : 's'}`;
  }
  const m = Math.round(seconds / 60);
  return `${String(m)} minute${m === 1 ? '' : 's'}`;
}

/** @param {number} seconds @returns {string} */
function formatClock(seconds) {
  if (seconds <= 0) return 'Done';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

/** @param {number} seconds @returns {string} */
function formatClockWords(seconds) {
  if (seconds <= 0) return 'timer done';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const parts = [];
  if (m > 0) parts.push(`${String(m)} minute${m === 1 ? '' : 's'}`);
  if (s > 0 || m === 0) parts.push(`${String(s)} second${s === 1 ? '' : 's'}`);
  return `${parts.join(' ')} remaining`;
}

/** @param {AttentionWarning} w @returns {string} */
function attentionWarningText(w) {
  const duration = durationWords(w.uninterrupted_seconds);
  if (w.phase === 'current') {
    return `Stay with this step — it needs ${duration} of uninterrupted attention.`;
  }
  return `Heads up: the next step needs ${duration} of uninterrupted attention once you start it.`;
}

/** @param {NextSafeStop} stop @returns {string} */
function safeStopText(stop) {
  if (stop.kind === 'end_of_recipe') {
    return 'No further safe stopping point before the dish is done.';
  }
  const stepNum = /** @type {number} */ (stop.step_index) + 1;
  let base;
  if (stop.kind === 'now') base = `Safe to stop right now, during step ${String(stepNum)}.`;
  else if (stop.kind === 'during_step') base = `Next safe stop: during step ${String(stepNum)}.`;
  else if (stop.kind === 'after_step') base = `Next safe stop: right after step ${String(stepNum)}.`;
  else base = `Next safe stop: before you start step ${String(stepNum)}.`; // before_step

  const pause = /** @type {MaximumPause} */ (stop.maximum_pause);
  const pauseText =
    pause.kind === 'bounded'
      ? ` Pause up to ${durationWords(/** @type {number} */ (pause.seconds))}.`
      : ' No time limit on the pause.';
  const naturalText = stop.natural_stopping_point ? ' This is a natural stopping point.' : '';
  return base + pauseText + naturalText;
}

// ---------------------------------------------------------------------------
// Local session-id persistence (Invariant 6 — see header comment).
// ---------------------------------------------------------------------------

/** @param {string} id */
function setStoredSessionId(id) {
  localStorage.setItem(COOKING_SESSION_ID_KEY, id);
}

/** @param {string} id */
function clearStoredSessionIdIfMatches(id) {
  if (localStorage.getItem(COOKING_SESSION_ID_KEY) === id) {
    localStorage.removeItem(COOKING_SESSION_ID_KEY);
  }
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

/**
 * Mount the cooking screen into `container`.
 * @param {HTMLElement} container
 * @param {Record<string,string>} params - `{sessionId}` from `/cook/:sessionId`.
 * @returns {() => void} cleanup
 */
export function renderCook(container, params) {
  const sessionId = params.sessionId;

  let destroyed = false;
  /** @type {ReturnType<typeof mountPrimaryAction>|null} */
  let primaryBar = null;
  /** @type {SessionView|null} */
  let session = null;
  /** @type {number|null} */
  let tickInterval = null;
  /** @type {Map<string, {el: HTMLElement, clockEl: HTMLElement}>} */
  let timerNodes = new Map();
  /** @type {Set<string>} */
  const announcedExpired = new Set();
  let busy = false;

  function unmountPrimary() {
    if (primaryBar) {
      primaryBar.unmount();
      primaryBar = null;
    }
  }

  function stopTicking() {
    if (tickInterval) {
      window.clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  /**
   * @param {(Node|string|null)[]} children
   * @param {string} titleText
   * @returns {HTMLElement}
   */
  function screenShell(children, titleText) {
    return h('div', { class: 'screen' }, [
      h('div', { class: 'screen-header' }, [
        h('span', { class: 'screen-header__eyebrow' }, ['Cooking']),
        h('h1', { class: 'screen-header__title', tabindex: '-1' }, [titleText]),
        h('p', { class: 'screen-header__subtitle' }, [
          'If you close this or get pulled away, reopening it lands you right back here.',
        ]),
      ]),
      ...children,
    ]);
  }

  function drawLoading() {
    unmountPrimary();
    stopTicking();
    container.replaceChildren(screenShell([createLoadingState({ label: 'Loading your cooking session…' })], 'Cooking'));
  }

  /** @param {unknown} err */
  function drawError(err) {
    unmountPrimary();
    stopTicking();
    const notFound = err instanceof ApiError && err.code === 'session_not_found';
    const message = err instanceof ApiError ? err.message : 'Could not load this cooking session.';
    if (notFound) clearStoredSessionIdIfMatches(sessionId);
    container.replaceChildren(
      screenShell(
        [
          createErrorState({
            title: notFound ? "This cooking session isn't there anymore" : 'Cooking session did not load',
            message,
            retryLabel: notFound ? undefined : 'Try again',
            onRetry: notFound ? undefined : load,
          }),
        ],
        'Cooking',
      ),
    );
    primaryBar = mountPrimaryAction({ label: 'Back to plan', onClick: () => navigate('/plan') });
  }

  /** @param {AttentionWarning} w @returns {HTMLElement} */
  function buildAttentionWarning(w) {
    // `role="alert"` — matching `plan.js`'s `plan-shortfall` idiom of
    // letting the banner's own role do the screen-reader announcement
    // (assertive here, since this one is safety-relevant) rather than a
    // second, redundant manual `announce()` call.
    return h('div', { class: 'cook-warning', role: 'alert' }, [icon('alert'), h('p', {}, [attentionWarningText(w)])]);
  }

  /** @param {NextSafeStop} stop @returns {HTMLElement} */
  function buildSafeStopPanel(stop) {
    return h('div', { class: 'cook-safe-stop', role: 'status' }, [icon('clock'), h('p', {}, [safeStopText(stop)])]);
  }

  /** @param {TimerView[]} timers @returns {HTMLElement} */
  function buildTimersSection(timers) {
    const items = timers.map((t) => {
      const endsMs = Date.parse(t.ends_at_utc);
      const remaining = Math.max(0, Math.ceil((endsMs - Date.now()) / 1000));
      const expired = remaining <= 0;
      if (expired) announcedExpired.add(t.timer_id);

      const clockEl = h('span', { class: 'cook-timer__clock num', 'aria-hidden': 'true' }, [formatClock(remaining)]);
      const row = h(
        'li',
        {
          class: 'cook-timer',
          dataset: { expired: String(expired) },
          'aria-label': `${t.label}: ${formatClockWords(remaining)}`,
        },
        [
          h('div', { class: 'cook-timer__info' }, [h('span', { class: 'cook-timer__label' }, [t.label]), clockEl]),
          h('div', { class: 'cook-timer__actions' }, [
            expired
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--secondary',
                    onClick: () => sendEvent({ kind: 'timer_acknowledged', timer_id: t.timer_id }),
                  },
                  ['I heard it'],
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                class: 'back-link',
                onClick: () => sendEvent({ kind: 'timer_cancelled', timer_id: t.timer_id }),
              },
              ['Cancel timer'],
            ),
          ]),
        ],
      );
      timerNodes.set(t.timer_id, { el: row, clockEl });
      return row;
    });
    return h('div', { class: 'stack stack--tight' }, [
      h('span', { class: 'card__eyebrow' }, ['Timers']),
      h('ul', { class: 'cook-timers' }, items),
    ]);
  }

  /**
   * The one-tap "start this step's timer" control (T-058 / KI-12). Only
   * ever rendered when `step.timer_duration_seconds` is non-null AND no
   * timer is already running for this step index — reusing
   * `session.timers[].step_index` rather than any local "did I just start
   * one" flag, since the server's session view is this screen's only source
   * of truth (file header). The tap sends nothing but `step_index`; the
   * server derives the real duration and absolute end instant.
   * @param {StepView} step
   * @returns {HTMLElement}
   */
  function buildStartTimerControl(step) {
    const seconds = /** @type {number} */ (step.timer_duration_seconds);
    return h('div', { class: 'stack stack--tight' }, [
      h('span', { class: 'card__eyebrow' }, ['Timer for this step']),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--secondary',
          onClick: () => sendEvent({ kind: 'timer_started', step_index: step.index }),
        },
        [`Start ${durationWords(seconds)} timer`],
      ),
    ]);
  }

  function buildSecondaryControls() {
    /** @type {(Node|null)[]} */
    const controls = [];
    if (session && session.status === 'active' && session.step !== null) {
      const activeSession = session;
      controls.push(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--secondary',
            onClick: () => sendEvent({ kind: 'session_paused', at_step_index: activeSession.current_step_index }),
          },
          ['Pause cooking'],
        ),
      );
    }
    controls.push(
      h('button', { type: 'button', class: 'btn btn--danger-quiet', onClick: () => sendEvent({ kind: 'session_abandoned' }) }, [
        'Stop cooking',
      ]),
    );
    return h('div', { class: 'cook-controls' }, controls);
  }

  function mountPrimary() {
    if (!session) return;
    const s = session;
    if (s.status === 'paused') {
      primaryBar = mountPrimaryAction({
        label: 'Resume cooking',
        onClick: () => sendEvent({ kind: 'session_resumed', at_step_index: s.current_step_index }),
      });
      return;
    }
    if (s.step === null) {
      primaryBar = mountPrimaryAction({ label: 'Finish cooking', onClick: () => sendEvent({ kind: 'session_completed' }) });
      return;
    }
    primaryBar = mountPrimaryAction({
      label: 'Mark step done',
      onClick: () => sendEvent({ kind: 'step_completed', step_index: s.current_step_index }),
      ariaLabel: `Mark step ${String(s.current_step_index + 1)} done`,
    });
  }

  function startTicking() {
    stopTicking();
    if (!session || session.timers.length === 0) return;
    tickInterval = window.setInterval(() => {
      if (!session) return;
      for (const t of session.timers) {
        const node = timerNodes.get(t.timer_id);
        if (!node) continue;
        const endsMs = Date.parse(t.ends_at_utc);
        const remaining = Math.max(0, Math.ceil((endsMs - Date.now()) / 1000));
        node.clockEl.textContent = formatClock(remaining);
        node.el.setAttribute('aria-label', `${t.label}: ${formatClockWords(remaining)}`);
        node.el.dataset.expired = String(remaining <= 0);
        if (remaining <= 0 && !announcedExpired.has(t.timer_id)) {
          announcedExpired.add(t.timer_id);
          announce(`${t.label} timer is done.`, { assertive: true });
        }
      }
    }, 1000);
  }

  /**
   * @param {{title: string, message: string, iconName: 'check'|'info', primary?: {label: string, onClick: () => void}}} opts
   */
  function drawTerminal({ title, message, iconName, primary }) {
    unmountPrimary();
    stopTicking();
    const body = [createEmptyState({ iconName, title, message })];
    if (primary) {
      // A dedicated primary CTA (the feedback entry point below) takes the
      // one dominant bottom-anchored action; "back to plan" still needs a
      // way out, so it becomes a plain secondary button instead of a
      // second primary action competing for attention.
      body.push(h('button', { type: 'button', class: 'btn btn--secondary', onClick: () => navigate('/plan') }, ['Back to plan']));
    }
    container.replaceChildren(screenShell(body, title));
    primaryBar = mountPrimaryAction(primary || { label: 'Back to plan', onClick: () => navigate('/plan') });
  }

  /**
   * Entry point into post-meal feedback (T-018): resolve this completed
   * session's `plan_meal_id` by matching `recipe_id` against the current
   * plan's meals — `encodeSessionView` (server/src/routes.ts) never
   * exposes `plan_meal_id` on a cooking session, so this is the same
   * lookup `plan.js`'s `checkResumable` already does for the resume
   * banner, reused here rather than guessed at. If no meal in the current
   * plan matches (swapped out, plan superseded, or gone), that is an
   * honest dead end, not a fabricated id — this button stays put and
   * explains itself instead of navigating to a broken feedback link.
   * @param {SessionView} completedSession
   */
  async function goToFeedback(completedSession) {
    if (primaryBar) {
      primaryBar.setDisabled(true);
      primaryBar.setLabel('Finding your plan…');
    }
    try {
      const { plan } = await getCurrentPlan();
      if (destroyed) return;
      /** @type {(m: {recipe_id: string, plan_meal_id: string|null}) => boolean} */
      const matchesCompletedRecipe = (m) => m.recipe_id === completedSession.recipe_id;
      const meal = (plan.meals || []).find(matchesCompletedRecipe);
      if (!meal || !meal.plan_meal_id) {
        if (primaryBar) {
          primaryBar.setDisabled(false);
          primaryBar.setLabel('How did it go?');
        }
        announce("This dinner isn't in your current plan anymore, so feedback can't be recorded for it.", {
          assertive: true,
        });
        return;
      }
      navigate(`/feedback/${meal.plan_meal_id}`);
    } catch (err) {
      if (destroyed) return;
      if (primaryBar) {
        primaryBar.setDisabled(false);
        primaryBar.setLabel('How did it go?');
      }
      announce(err instanceof ApiError ? err.message : "Couldn't check your plan — try again.", { assertive: true });
    }
  }

  function draw() {
    unmountPrimary();
    stopTicking();
    if (!session) return;

    if (session.status === 'completed') {
      const completed = session;
      drawTerminal({
        title: 'Cooking complete',
        message: 'Nice work — this session is done.',
        iconName: 'check',
        primary: { label: 'How did it go?', onClick: () => goToFeedback(completed) },
      });
      return;
    }
    if (session.status === 'abandoned') {
      drawTerminal({
        title: 'Cooking stopped',
        message: "You stopped this session. That's fine — dinner interruptions happen.",
        iconName: 'info',
      });
      return;
    }

    timerNodes = new Map();
    const step = session.step;
    /** @type {(Node|null)[]} */
    const body = [];

    const badges = [];
    if (session.status === 'paused') badges.push(createStatusBadge({ text: 'Paused', iconName: 'clock' }));
    if (step && step.requires_continuous_attention) {
      badges.push(createStatusBadge({ text: 'Needs full attention', iconName: 'alert' }));
    }
    if (badges.length > 0) body.push(h('div', { class: 'card__meta' }, badges));

    if (session.attention_warning) {
      body.push(buildAttentionWarning(session.attention_warning));
    }

    if (step) {
      body.push(h('p', { class: 'cook-step__text' }, [step.text]));
      body.push(renderTimeInfo({ total_seconds: step.total_seconds, active_seconds: step.active_seconds, time_label: step.time_label }));
      const unattended = step.total_seconds - step.active_seconds;
      if (unattended > 0) {
        body.push(
          h('p', { class: 'meal-card__body-text' }, [
            `${durationWords(step.active_seconds)} hands-on, ${durationWords(unattended)} unattended.`,
          ]),
        );
      }
      const timerAlreadyRunning = session.timers.some((t) => t.step_index === step.index);
      if (step.timer_duration_seconds !== null && !timerAlreadyRunning) {
        body.push(buildStartTimerControl(step));
      }
    } else {
      body.push(h('p', { class: 'cook-step__text' }, ['Every step is done.']));
    }

    body.push(buildSafeStopPanel(session.next_safe_stop));

    if (session.timers.length > 0) {
      body.push(buildTimersSection(session.timers));
    }

    body.push(
      h('div', { class: 'stack stack--tight' }, [
        h('span', { class: 'card__eyebrow' }, ['If you get pulled away']),
        h('p', { class: 'meal-card__body-text' }, [session.recovery_text]),
      ]),
    );

    body.push(buildSecondaryControls());

    const titleText = step
      ? `Step ${String(step.index + 1)} of ${String(session.total_steps)}`
      : `All ${String(session.total_steps)} steps done`;
    container.replaceChildren(screenShell(body, titleText));

    mountPrimary();
    startTicking();
  }

  /** @param {any} payload */
  async function sendEvent(payload) {
    if (busy || !session) return;
    busy = true;
    if (primaryBar) primaryBar.setDisabled(true);
    try {
      const { session: updated } = await postCookingEvent(sessionId, payload);
      if (destroyed) return;
      session = /** @type {SessionView} */ (updated);
      if (session.status === 'completed' || session.status === 'abandoned') {
        clearStoredSessionIdIfMatches(sessionId);
      }
      draw();
    } catch (err) {
      if (destroyed) return;
      if (primaryBar) primaryBar.setDisabled(false);
      announce(err instanceof ApiError ? err.message : 'Could not save that — try again.', { assertive: true });
    } finally {
      busy = false;
    }
  }

  async function load() {
    drawLoading();
    try {
      const { session: fetched } = await getCookingSession(sessionId);
      if (destroyed) return;
      session = /** @type {SessionView} */ (fetched);
      if (session.status === 'completed' || session.status === 'abandoned') {
        clearStoredSessionIdIfMatches(sessionId);
      } else {
        setStoredSessionId(sessionId);
      }
      draw();
    } catch (err) {
      if (destroyed) return;
      drawError(err);
    }
  }

  load();

  return () => {
    destroyed = true;
    stopTicking();
    unmountPrimary();
  };
}
