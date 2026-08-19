/**
 * feedback.js — the post-meal feedback screen (T-018): make again / it was
 * fine / not again, plus one optional reason, in at most two taps.
 *
 * Route: `#/feedback/:planMealId` (declared in `router.js`, previously the
 * `notBuiltYet('Feedback')` placeholder).
 *
 * Data flow: the frozen contract's `POST /api/feedback` takes
 * `{plan_meal_id, recipe_id, verdict, reason}` (`api.js`'s `postFeedback`)
 * and returns `{signals_updated}`. The route param only carries
 * `planMealId` — `recipe_id` is NOT in the URL, so it is resolved the same
 * way `plan.js`'s `checkResumable` resolves a session's meal: load
 * `GET /api/plans/current` and find the meal whose `plan_meal_id` matches
 * the param. This doubles as the honest "unknown/gone" check (hard
 * requirement 4): if no meal in the current plan carries this id — wrong
 * id, superseded plan, or no plan at all — that IS the answer, not a guess.
 *
 * GAP (documented, not a blocker): the frozen contract has no `GET` for
 * "has this plan_meal_id already received feedback" (only `POST
 * /api/feedback`, write-only, and `POST /api/feedback` has no upsert
 * semantics — `db.ts`'s `feedback` table has no unique constraint on
 * `plan_meal_id`, and every insert re-runs `applyFeedbackEvent` /
 * `applyPreferenceUpdates` in full). So calling it twice for the same
 * plan_meal_id would write two feedback rows and apply the verdict's
 * attribute signal TWICE (a real, provable inflation of confidence via
 * `mergeSignal`'s saturating combine — see `domain/src/preferences.ts` —
 * not merely a cosmetic duplicate). This screen therefore submits EXACTLY
 * ONE `POST /api/feedback` per visit (see `commit()` below), and tracks
 * "already submitted" locally in `localStorage` under `tgd.feedback.
 * <planMealId>` — the same client-only-marker pattern `api.js` already
 * documents for `tgd.calibration_done` (no server-authoritative field
 * exists for either). A future `GET /api/feedback/:planMealId` (or an
 * `already_submitted` flag alongside plan meals) would let this read
 * server state instead; until then, "already submitted" is honest for this
 * browser only, not across devices — same limitation `household_id`
 * itself already has.
 *
 * Two-tap design (hard requirement 2), reconciling "tap 1 alone is
 * sufficient" with "never write a wrong/duplicate signal":
 *   tap 1 — a verdict button (`mountReactionGrid`, the same equal-weight,
 *           no-single-dominant-action pattern calibration uses for its
 *           four reactions). This is recorded immediately in the sense
 *           that matters to the user: the confirmation state, the
 *           `announce()`, and the exit action all appear at once, and if
 *           nothing else happens the verdict WILL be saved with no further
 *           input. Under the hood, `commit()` (the one and only POST this
 *           screen ever sends) fires on whichever comes first: a reason
 *           tap, tapping "Done", navigating away (this screen's returned
 *           cleanup function calls `commit()` directly), the tab being
 *           hidden/closed (`pagehide`), or a short safety-net timer — so a
 *           user who taps once and puts the phone down has fully succeeded
 *           without this file ever risking two writes for one meal.
 *   tap 2 — (optional) one reason chip. Selecting it stages the reason and
 *           fires `commit()` immediately (no further tap needed) — never a
 *           form, never required, never blocks tap 1's own success.
 */

import {
  h,
  icon,
  announce,
  mountPrimaryAction,
  mountReactionGrid,
  createChipGroup,
  createLoadingState,
  createErrorState,
  createEmptyState,
} from './ui.js';
import { getCurrentPlan, postFeedback, ApiError } from './api.js';
import { navigate } from './router.js';

const FEEDBACK_RECORD_PREFIX = 'tgd.feedback.';
const SAFETY_NET_MS = 2500;

const VERDICT_OPTIONS = [
  { value: 'make_again', label: 'Make this again' },
  { value: 'it_was_fine', label: 'It was fine' },
  { value: 'not_again', label: 'Not this one again' },
];

const REASON_OPTIONS = [
  { value: 'too_much_work', label: 'Too much work' },
  { value: 'took_longer_than_expected', label: 'Took longer than expected' },
  { value: 'too_bland', label: 'Too bland' },
  { value: 'too_spicy', label: 'Too spicy' },
  { value: 'easy_with_interruptions', label: 'Easy with interruptions' },
  { value: 'not_filling', label: 'Not filling' },
];

function verdictLabel(value) {
  const opt = VERDICT_OPTIONS.find((o) => o.value === value);
  return opt ? opt.label : value;
}

function reasonLabel(value) {
  const opt = REASON_OPTIONS.find((o) => o.value === value);
  return opt ? opt.label : value;
}

/** @param {string} planMealId @returns {{verdict: string, reason: string|null}|null} */
function readStoredRecord(planMealId) {
  try {
    const raw = localStorage.getItem(FEEDBACK_RECORD_PREFIX + planMealId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.verdict === 'string') {
      return { verdict: parsed.verdict, reason: typeof parsed.reason === 'string' ? parsed.reason : null };
    }
    return null;
  } catch {
    return null;
  }
}

/** @param {string} planMealId @param {{verdict: string, reason: string|null}} record */
function writeStoredRecord(planMealId, record) {
  try {
    localStorage.setItem(FEEDBACK_RECORD_PREFIX + planMealId, JSON.stringify(record));
  } catch {
    // Storage can fail (private browsing, full quota) — the feedback still
    // reached the server via `commit()`; only the local "already
    // submitted" convenience marker is lost, which is honest degradation,
    // not data loss.
  }
}

/**
 * Mount the feedback screen into `container`.
 * @param {HTMLElement} container
 * @param {Record<string,string>} params - `{planMealId}` from `/feedback/:planMealId`.
 * @returns {() => void} cleanup
 */
export function renderFeedback(container, params) {
  const planMealId = params.planMealId;

  let destroyed = false;
  let primaryBar = null;
  let reactionGrid = null;
  let reasonChips = null;
  let safetyNetTimer = null;
  let pagehideHandler = null;

  /** @type {string} */
  let verdict = null;
  /** @type {string|null} */
  let reason = null;
  let committing = false;
  let committed = false;
  /** @type {{recipe_id: string, name: string}|null} */
  let meal = null;

  function unmountPrimary() {
    if (primaryBar) {
      primaryBar.unmount();
      primaryBar = null;
    }
  }

  function unmountReactionGrid() {
    if (reactionGrid) {
      reactionGrid.unmount();
      reactionGrid = null;
    }
  }

  function clearSafetyNet() {
    if (safetyNetTimer) {
      window.clearTimeout(safetyNetTimer);
      safetyNetTimer = null;
    }
  }

  function detachPagehide() {
    if (pagehideHandler) {
      window.removeEventListener('pagehide', pagehideHandler);
      pagehideHandler = null;
    }
  }

  function screenShell(children) {
    return h('div', { class: 'screen' }, [
      h('div', { class: 'screen-header' }, [
        h('span', { class: 'screen-header__eyebrow' }, ['Feedback']),
        h('h1', { class: 'screen-header__title', tabindex: '-1' }, [
          meal ? `How was ${meal.name}?` : 'How did it go?',
        ]),
        h('p', { class: 'screen-header__subtitle' }, [
          'One tap tells us what to plan more or less of. A reason is optional.',
        ]),
      ]),
      ...children,
    ]);
  }

  function drawLoading() {
    unmountPrimary();
    unmountReactionGrid();
    container.replaceChildren(screenShell([createLoadingState({ label: 'Loading this dinner…' })]));
  }

  function drawLoadError(err, retry) {
    unmountPrimary();
    unmountReactionGrid();
    const message = err instanceof ApiError ? err.message : 'Could not load your plan.';
    container.replaceChildren(
      screenShell([
        createErrorState({ title: 'This did not load', message, retryLabel: 'Try again', onRetry: retry }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Back to plan', onClick: () => navigate('/plan') });
  }

  /** Honest "unknown or gone" state — never a guess at recipe_id/verdict. */
  function drawNotFound() {
    unmountPrimary();
    unmountReactionGrid();
    container.replaceChildren(
      screenShell([
        createEmptyState({
          iconName: 'info',
          title: "We can't find this dinner",
          message:
            "This link doesn't match a meal in your current plan — it may have been swapped, or the plan has moved on. Nothing was recorded.",
        }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Back to plan', onClick: () => navigate('/plan') });
  }

  /** @param {{verdict: string, reason: string|null}} record */
  function drawAlreadySubmitted(record) {
    unmountPrimary();
    unmountReactionGrid();
    const lines = [h('p', { class: 'meal-card__body-text' }, [`You said: ${verdictLabel(record.verdict)}.`])];
    if (record.reason) {
      lines.push(h('p', { class: 'meal-card__body-text' }, [`Reason: ${reasonLabel(record.reason)}.`]));
    }
    container.replaceChildren(
      screenShell([
        h('div', { class: 'card feedback-confirm' }, [
          h('div', { class: 'feedback-confirm__header' }, [icon('check'), h('span', { class: 'card__eyebrow' }, ['Already recorded'])]),
          ...lines,
        ]),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Back to plan', onClick: () => navigate('/plan') });
  }

  /** The initial choice: three equal-weight verdict buttons (tap 1). */
  function drawChoice() {
    unmountPrimary();
    unmountReactionGrid();
    container.replaceChildren(screenShell([]));
    reactionGrid = mountReactionGrid(
      VERDICT_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        onClick: () => chooseVerdict(opt.value),
      })),
    );
  }

  /** Post-tap-1 state: confirmation + optional reason chips + exit action. */
  function drawPending() {
    unmountPrimary();
    unmountReactionGrid();

    // Not `role="status"` here: `chooseVerdict` already calls `announce()`
    // explicitly for this transition, and the codebase's convention (see
    // `cook.js`'s `buildSafeStopPanel`) is to pick ONE mechanism per
    // transition, never both — a live-region role on top of a manual
    // `announce()` would double-speak the same text to a screen reader.
    const confirmCard = h('div', { class: 'card feedback-confirm' }, [
      h('div', { class: 'feedback-confirm__header' }, [icon('check'), h('span', { class: 'card__eyebrow' }, ['Recorded'])]),
      h('p', { class: 'feedback-confirm__verdict' }, [verdictLabel(verdict)]),
      h('p', { class: 'meal-card__body-text' }, ["That's already saved — a reason is optional and takes one more tap."]),
    ]);

    reasonChips = createChipGroup({
      options: REASON_OPTIONS,
      multi: false,
      ariaLabel: 'Optional reason',
      onChange: (selected) => chooseReason(selected[0] || null),
    });

    container.replaceChildren(
      screenShell([
        confirmCard,
        h('div', { class: 'stack stack--tight' }, [
          h('span', { class: 'card__eyebrow' }, ['Add a reason (optional)']),
          reasonChips.element,
        ]),
      ]),
    );

    primaryBar = mountPrimaryAction({ label: 'Done', onClick: () => finishNow() });
  }

  function drawSending() {
    unmountPrimary();
    unmountReactionGrid();
    container.replaceChildren(screenShell([createLoadingState({ label: 'Saving your feedback…' })]));
  }

  /** @param {unknown} err */
  function drawSendError(err) {
    unmountPrimary();
    unmountReactionGrid();
    const message = err instanceof ApiError ? err.message : 'Could not save your feedback.';
    container.replaceChildren(
      screenShell([
        createErrorState({
          title: 'Feedback did not save',
          message,
          retryLabel: 'Try again',
          onRetry: () => commit(),
        }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Back to plan', onClick: () => navigate('/plan') });
  }

  function drawDone() {
    unmountPrimary();
    unmountReactionGrid();
    const lines = [h('p', { class: 'meal-card__body-text' }, [`You said: ${verdictLabel(verdict)}.`])];
    if (reason) lines.push(h('p', { class: 'meal-card__body-text' }, [`Reason: ${reasonLabel(reason)}.`]));
    container.replaceChildren(
      screenShell([
        h('div', { class: 'card feedback-confirm' }, [
          h('div', { class: 'feedback-confirm__header' }, [icon('check'), h('span', { class: 'card__eyebrow' }, ['Thanks — saved'])]),
          ...lines,
        ]),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Back to plan', onClick: () => navigate('/plan') });
  }

  // -------------------------------------------------------------------------
  // Interaction — tap 1 (verdict), tap 2 (reason, optional), and the single
  // commit that either follows.
  // -------------------------------------------------------------------------

  /** @param {string} value */
  function chooseVerdict(value) {
    verdict = value;
    announce(`Recorded: ${verdictLabel(value)}. You can add a reason, or you're done.`);
    drawPending();
    clearSafetyNet();
    safetyNetTimer = window.setTimeout(() => commit(), SAFETY_NET_MS);
  }

  /** @param {string|null} value */
  function chooseReason(value) {
    if (!value || committing || committed) return;
    reason = value;
    clearSafetyNet();
    announce(`Reason added: ${reasonLabel(value)}.`);
    commit();
  }

  function finishNow() {
    clearSafetyNet();
    commit();
  }

  async function commit() {
    if (committing || committed || !verdict || !meal) return;
    committing = true;
    clearSafetyNet();
    if (!destroyed) drawSending();
    try {
      await postFeedback({
        plan_meal_id: planMealId,
        recipe_id: meal.recipe_id,
        verdict,
        reason,
      });
      // The local "already submitted" record and `committed` flag must be
      // set unconditionally, even if the screen was unmounted (e.g. the
      // user navigated away, and this call is `cleanup`'s flush) — this is
      // the ONLY POST this screen ever sends (file header), so a real,
      // successful save that failed to update local state here would
      // leave the marker missing and risk a genuine double-submission (a
      // second, wrongly-inflated preference signal — see file header) if
      // the user ever returns to this same URL. Only the DOM redraw below
      // is conditional on the screen still being mounted.
      committed = true;
      writeStoredRecord(planMealId, { verdict, reason });
      detachPagehide();
      if (destroyed) return;
      announce(`Saved: ${verdictLabel(verdict)}${reason ? `, ${reasonLabel(reason)}` : ''}.`);
      drawDone();
    } catch (err) {
      committing = false;
      if (destroyed) return;
      drawSendError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Load — resolve the meal for `planMealId` from the current plan (the
  // only source of `recipe_id`; see file header), then dispatch to the
  // already-submitted, not-found, or fresh-choice state.
  // -------------------------------------------------------------------------

  async function load() {
    drawLoading();
    try {
      const { plan } = await getCurrentPlan();
      if (destroyed) return;
      const found = (plan.meals || []).find((m) => m.plan_meal_id === planMealId);
      if (!found) {
        drawNotFound();
        return;
      }
      meal = { recipe_id: found.recipe_id, name: found.name };

      const stored = readStoredRecord(planMealId);
      if (stored) {
        verdict = stored.verdict;
        reason = stored.reason;
        committed = true;
        drawAlreadySubmitted(stored);
        return;
      }

      drawChoice();
    } catch (err) {
      if (destroyed) return;
      if (err instanceof ApiError && err.code === 'no_current_plan') {
        drawNotFound();
        return;
      }
      drawLoadError(err, load);
    }
  }

  pagehideHandler = () => {
    if (!committing && !committed && verdict) commit();
  };
  window.addEventListener('pagehide', pagehideHandler);

  load();

  return () => {
    destroyed = true;
    clearSafetyNet();
    detachPagehide();
    unmountPrimary();
    unmountReactionGrid();
    // Leaving the screen (in-app navigation) is the same document/JS
    // runtime — an in-flight or not-yet-fired commit is safe to finish or
    // start here, unlike a real page unload.
    if (!committing && !committed && verdict) commit();
  };
}
