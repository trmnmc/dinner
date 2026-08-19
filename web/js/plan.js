/**
 * The plan screen: three dinners, each with the facts a parent needs to
 * trust the pick, and a reasoned three-alternative swap flow that never
 * touches the other two meals.
 *
 * Every time string and every per-meal reason string here is server-
 * rendered by `domain/src/reasons.ts` and shown verbatim (`meal.time_label`
 * via `renderTimeInfo`, `meal.reasons[].text` via `createStaticChips`,
 * `plan.shortfall.text` for an empty/partial plan). This file only formats
 * the RAW fields the frozen contract does not pre-render as prose — enum
 * values (`effort`, `cost_band`, `familiarity`), counts, and ingredient/
 * meal-name lookups — the same way `calibrate.js` title-cases `cuisine`/
 * `protein` today.
 *
 * Swap flow (DoD 3, at most three taps, other two meals untouched):
 *   tap 1 — "Swap" on a meal card opens a bottom sheet with the nine
 *           explicit swap reasons (`domain/src/recipe.ts`'s `SwapReason`).
 *   tap 2 — picking a reason calls `POST .../swap` (offer mode) and shows
 *           at most three alternatives in the same sheet.
 *   tap 3 — tapping an alternative calls `POST .../swap` (accept mode) and
 *           applies it immediately; the response's two other meals are the
 *           same data the screen already had, so nothing else moves.
 *
 * Required states (SPEC / T-016 acceptance): loading, error+retry, no plan
 * yet (honest CTA into `createPlan`), `is_empty` (shortfall explanation,
 * never a bare empty list — this is the T-041/KI-7 fix landing in the UI),
 * `is_partial` (shortfall alongside whatever DID fit), and the three-meal
 * happy path.
 */

import {
  h,
  icon,
  openSheet,
  createChipGroup,
  createStaticChips,
  createStatusBadge,
  mountPrimaryAction,
  renderTimeInfo,
  createLoadingState,
  createErrorState,
  createEmptyState,
  announce,
} from './ui.js';
import { getCurrentPlan, createPlan, offerSwap, acceptSwap, createCookingSession, getCookingSession, getHousehold, ApiError } from './api.js';
import { navigate } from './router.js';

/**
 * Matches the `tgd.` prefix convention `api.js` uses for
 * `household_id`/`calibration_done`. Not added to `api.js` itself — that
 * file is outside T-019's scope — so `cook.js` and this file each define
 * the same literal key locally instead of sharing an import.
 */
const COOKING_SESSION_ID_KEY = 'tgd.cooking_session_id';

// ---------------------------------------------------------------------------
// Local view types — the frozen contract's JSON shapes (routes.ts
// `buildMealView` / `buildPlanView` / `withShortfall`), typed here only so
// this file's own logic isn't stringly-typed. `api.js` still hands these
// back as parsed JSON at the boundary; that boundary is not this file's to
// change (frozen contract, T-016 scope).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ReasonView
 * @property {string} code
 * @property {string} text
 */

/**
 * @typedef {Object} MealView
 * @property {number} slot
 * @property {string} recipe_id
 * @property {string|null} plan_meal_id
 * @property {string} name
 * @property {number} total_seconds
 * @property {number} active_seconds
 * @property {string} time_label
 * @property {{has_continuous_attention_step: boolean, longest_continuous_seconds: number, next_safe_stop_step_index: number|null}} interruption
 * @property {'low'|'medium'|'high'} effort
 * @property {number} dish_count
 * @property {'low'|'medium'|'high'} cost_band
 * @property {'familiar'|'adjacent'|'novel'} familiarity
 * @property {ReasonView[]} reasons
 * @property {string[]} owned_ingredient_ids
 * @property {number[]} shared_with_slots
 */

/**
 * @typedef {Object} PlanShortfall
 * @property {string} code
 * @property {string} text
 */

/**
 * @typedef {Object} PlanView
 * @property {string} plan_id
 * @property {string} created_at_utc
 * @property {MealView[]} meals
 * @property {boolean} [is_partial]
 * @property {boolean} [is_empty]
 * @property {PlanShortfall|null} [shortfall]
 */

const MEALS_PER_PLAN = 3;

/** The nine explicit swap reasons (`domain/src/recipe.ts` `SwapReason`,
 * mirrored by `SWAP_REASONS` in `server/src/routes.ts`) — this product has
 * no server-rendered copy for these (they are a user-facing CHOICE menu,
 * not a derived fact), so labels are authored here the same way
 * `onboarding.js` labels `NOVELTY_OPTIONS` / `DIETARY_OPTIONS`. */
const SWAP_REASON_OPTIONS = [
  { value: 'faster', label: 'Less time overall' },
  { value: 'less_hands_on', label: 'Less hands-on time' },
  { value: 'fewer_dishes', label: 'Fewer dishes' },
  { value: 'cheaper', label: 'Cheaper' },
  { value: 'more_familiar', label: 'More familiar' },
  { value: 'more_adventurous', label: 'More adventurous' },
  { value: 'no_pasta', label: 'No pasta' },
  { value: 'different_protein', label: 'Different protein' },
  { value: 'use_what_i_have', label: 'Use what I have' },
];

const EFFORT_LABELS = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' };
const COST_LABELS = { low: 'Low-cost', medium: 'Mid-cost', high: 'Higher-cost' };
const NOVELTY_LABELS = { familiar: 'Familiar', adjacent: 'Adjacent twist', novel: 'Novel pick' };

/** Same id -> label formatting `calibrate.js` uses for `cuisine`/`protein` —
 * ingredient ids (`olive_oil`, `chicken_stock`, …) have no display-name
 * field in `MealView.owned_ingredient_ids` (that only exists on grocery
 * lines), so this is the same convention, not a second one. */
function titleCase(s) {
  if (!s) return '';
  return String(s)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Interruption profile — deliberately NOT a second seconds-to-minutes
 * converter. The only sanctioned total/active time renderer in this product
 * is `ui.js`'s `renderTimeInfo` (backed by `domain/src/reasons.ts`), and
 * `longest_continuous_seconds` is not a total/active pair — it is a single
 * "how long before you can safely step away" number, so it is surfaced as a
 * concrete, countable STEP fact (which step, out of how many) instead of a
 * second, hand-rolled duration conversion.
 * @param {MealView} meal
 * @returns {HTMLElement}
 */
function interruptionSection(meal) {
  const { has_continuous_attention_step, next_safe_stop_step_index } = meal.interruption;
  const attentionBadge = has_continuous_attention_step
    ? createStatusBadge({ text: 'Needs full attention', iconName: 'alert' })
    : createStatusBadge({ text: 'Safe to pause anytime', iconName: 'check' });
  const safeStopText =
    next_safe_stop_step_index === null
      ? 'No safe stopping point until the dish is done.'
      : `First safe stop: step ${String(next_safe_stop_step_index + 1)}.`;
  return h('div', { class: 'stack stack--tight' }, [
    h('span', { class: 'card__eyebrow' }, ['Interruptions']),
    h('div', { class: 'card__meta' }, [attentionBadge]),
    h('p', { class: 'meal-card__body-text' }, [safeStopText]),
  ]);
}

/**
 * @param {MealView} meal
 * @param {readonly MealView[]} allMeals
 * @returns {string}
 */
function sharedIngredientsText(meal, allMeals) {
  if (meal.shared_with_slots.length === 0) {
    return "Doesn't share ingredients with the other dinners this week.";
  }
  const names = meal.shared_with_slots
    .map((slot) => allMeals.find((m) => m.slot === slot))
    .filter((m) => m !== undefined)
    .map((m) => m.name);
  return `Shares ingredients with ${names.join(' and ')}.`;
}

/**
 * @param {MealView} meal
 * @returns {string}
 */
function ownedIngredientsText(meal) {
  if (meal.owned_ingredient_ids.length === 0) {
    return 'Nothing from your kitchen on hand for this one yet.';
  }
  return `On hand already: ${meal.owned_ingredient_ids.map(titleCase).join(', ')}.`;
}

/**
 * @param {MealView} meal
 * @returns {HTMLElement}
 */
function metaBadgeRow(meal) {
  return h('div', { class: 'card__meta' }, [
    createStatusBadge({ text: EFFORT_LABELS[meal.effort] || titleCase(meal.effort) }),
    createStatusBadge({ text: COST_LABELS[meal.cost_band] || titleCase(meal.cost_band) }),
    createStatusBadge({ text: NOVELTY_LABELS[meal.familiarity] || titleCase(meal.familiarity) }),
    createStatusBadge({ text: `${String(meal.dish_count)} dish${meal.dish_count === 1 ? '' : 'es'}` }),
  ]);
}

/**
 * A meal card for the main plan screen (full detail — DoD: name, total AND
 * active time separately, interruption profile, effort, ≤3 reasons,
 * owned/shared ingredients, cost band, novelty).
 * @param {MealView} meal
 * @param {readonly MealView[]} allMeals
 * @param {(meal: MealView) => void} onSwap
 * @param {(meal: MealView) => void} onCook
 * @returns {HTMLElement}
 */
function buildMealCard(meal, allMeals, onSwap, onCook) {
  const sections = [
    h('span', { class: 'card__eyebrow' }, [`Dinner ${String(meal.slot + 1)} of ${String(MEALS_PER_PLAN)}`]),
    h('h2', { class: 'card__title' }, [meal.name]),
    renderTimeInfo({ total_seconds: meal.total_seconds, active_seconds: meal.active_seconds, time_label: meal.time_label }),
    metaBadgeRow(meal),
    interruptionSection(meal),
  ];

  if (meal.reasons.length > 0) {
    sections.push(
      h('div', { class: 'stack stack--tight' }, [
        h('span', { class: 'card__eyebrow' }, ['Why this dinner']),
        createStaticChips(meal.reasons),
      ]),
    );
  }

  sections.push(
    h('div', { class: 'stack stack--tight' }, [
      h('span', { class: 'card__eyebrow' }, ['Ingredients']),
      h('p', { class: 'meal-card__body-text' }, [ownedIngredientsText(meal)]),
      h('p', { class: 'meal-card__body-text' }, [sharedIngredientsText(meal, allMeals)]),
    ]),
  );

  sections.push(
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--secondary meal-card__cook',
        'aria-label': `Start cooking ${meal.name}`,
        onClick: () => onCook(meal),
      },
      ['Start cooking'],
    ),
  );

  sections.push(
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--secondary meal-card__swap',
        'aria-label': `Swap ${meal.name} for something else`,
        onClick: () => onSwap(meal),
      },
      ['Swap this dinner'],
    ),
  );

  return h('div', { class: 'card' }, sections);
}

/**
 * A compact alternative card for the swap sheet (tap 3 target).
 * @param {MealView} alt
 * @param {() => void} onAccept
 * @returns {HTMLElement}
 */
function buildAlternativeCard(alt, onAccept) {
  const children = [
    h('h3', { class: 'swap-alt__title' }, [alt.name]),
    renderTimeInfo({ total_seconds: alt.total_seconds, active_seconds: alt.active_seconds, time_label: alt.time_label }),
    h('div', { class: 'card__meta' }, [
      createStatusBadge({ text: EFFORT_LABELS[alt.effort] || titleCase(alt.effort) }),
      createStatusBadge({ text: COST_LABELS[alt.cost_band] || titleCase(alt.cost_band) }),
      createStatusBadge({ text: NOVELTY_LABELS[alt.familiarity] || titleCase(alt.familiarity) }),
    ]),
  ];
  if (alt.reasons.length > 0) children.push(createStaticChips(alt.reasons));
  children.push(
    h('button', { type: 'button', class: 'btn btn--primary', onClick: onAccept }, ['Use this dinner']),
  );
  return h('div', { class: 'card swap-alt' }, children);
}

/**
 * @param {PlanShortfall} shortfall
 * @returns {HTMLElement}
 */
function shortfallBanner(shortfall) {
  return h('div', { class: 'plan-shortfall', role: 'status' }, [
    icon('info'),
    h('p', {}, [shortfall.text]),
  ]);
}

/**
 * Mount the plan screen into `container`.
 * @param {HTMLElement} container
 * @param {Record<string,string>} [params]
 * @returns {() => void} cleanup
 */
export function renderPlan(container, params) {
  void params; // /plan carries no route params; kept for router's call shape.

  let destroyed = false;
  let primaryBar = null;
  /** @type {PlanView|null} */
  let plan = null;
  let closeActiveSheet = null;
  /** Cached only after the first "Start cooking" tap — most visits never
   * need it, so this avoids an extra request on every plan load. */
  let cachedHouseholdSize = null;
  /** Set once `checkResumable` resolves; drives the resume banner in
   * `drawPlan`. `undefined` = not checked yet (render nothing extra),
   * `null` = checked, nothing to resume. */
  let resumeInfo = undefined;

  function unmountPrimary() {
    if (primaryBar) {
      primaryBar.unmount();
      primaryBar = null;
    }
  }

  function closeSheetIfOpen() {
    if (closeActiveSheet) {
      closeActiveSheet({ immediate: true });
      closeActiveSheet = null;
    }
  }

  function screenShell(children) {
    return h('div', { class: 'screen' }, [
      h('div', { class: 'screen-header' }, [
        h('span', { class: 'screen-header__eyebrow' }, ['Plan']),
        h('h1', { class: 'screen-header__title', tabindex: '-1' }, ['Your plan']),
        h('p', { class: 'screen-header__subtitle' }, [
          'Swap any dinner in three taps — the other two never change.',
        ]),
      ]),
      ...children,
    ]);
  }

  function drawLoading() {
    unmountPrimary();
    closeSheetIfOpen();
    container.replaceChildren(screenShell([createLoadingState({ label: 'Loading your plan…' })]));
  }

  function drawError(err, retry) {
    unmountPrimary();
    closeSheetIfOpen();
    const message = err instanceof ApiError ? err.message : 'Could not load your plan.';
    container.replaceChildren(
      screenShell([
        createErrorState({ title: 'Your plan did not load', message, retryLabel: 'Try again', onRetry: retry }),
      ]),
    );
  }

  function drawNoPlanYet() {
    unmountPrimary();
    closeSheetIfOpen();
    container.replaceChildren(
      screenShell([
        createEmptyState({
          iconName: 'info',
          title: "You don't have a plan yet",
          message:
            "Create your first plan and we'll pick three dinners from your taste calibration and what's in your kitchen.",
        }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Create your plan', onClick: createFirstPlan });
  }

  async function createFirstPlan() {
    if (!primaryBar) return;
    primaryBar.setDisabled(true);
    primaryBar.setLabel('Building your plan…');
    try {
      const { plan: p } = await createPlan({});
      if (destroyed) return;
      plan = /** @type {PlanView} */ (p);
      drawPlan();
    } catch (err) {
      if (destroyed) return;
      const message = err instanceof ApiError ? err.message : 'Could not create your plan.';
      drawError(err, load);
      announce(message, { assertive: true });
    }
  }

  /** Renders the current `plan` — dispatches on `is_empty` vs. meals
   * present (T-041/KI-7: an empty plan always explains itself, never a bare
   * list). Reused after initial load AND after every successful swap. */
  function drawPlan() {
    unmountPrimary();
    if (!plan) return;

    if (plan.is_empty) {
      const shortfall = plan.shortfall;
      container.replaceChildren(
        screenShell([
          shortfall
            ? shortfallBanner(shortfall)
            : shortfallBanner({ code: 'unknown', text: 'No dinners fit right now, and no further detail is available.' }),
          h('button', { type: 'button', class: 'btn btn--secondary', onClick: load }, ['Check again']),
        ]),
      );
      return;
    }

    const meals = plan.meals;
    const body = [];
    if (resumeInfo) {
      body.push(buildResumeBanner(resumeInfo));
    }
    if (plan.is_partial) {
      const shortfall = plan.shortfall;
      body.push(
        shortfall
          ? shortfallBanner(shortfall)
          : shortfallBanner({ code: 'unknown', text: 'Fewer dinners fit this time, and no further detail is available.' }),
      );
    }
    for (const meal of meals) {
      body.push(buildMealCard(meal, meals, (m) => openSwapSheet(m), (m) => startCooking(m)));
    }

    container.replaceChildren(screenShell(body));

    if (meals.length > 0) {
      primaryBar = mountPrimaryAction({ label: 'Continue to grocery list', onClick: () => navigate('/grocery') });
    }
  }

  /**
   * The resume affordance (T-019): "you're cooking X, step N of M". Shown
   * above the meal cards, never as the one dominant bottom-anchored action
   * (that stays reserved for "Continue to grocery list") — a secondary
   * button here is enough to get back into cooking mode.
   * @param {{sessionId: string, mealName: string, stepIndex: number, totalSteps: number}} info
   * @returns {HTMLElement}
   */
  function buildResumeBanner(info) {
    const stepText =
      info.totalSteps > 0 ? `step ${String(Math.min(info.stepIndex + 1, info.totalSteps))} of ${String(info.totalSteps)}` : 'getting started';
    return h('div', { class: 'card plan-resume' }, [
      h('span', { class: 'card__eyebrow' }, ['Still cooking']),
      h('p', { class: 'plan-resume__text' }, [`You're cooking ${info.mealName} — ${stepText}.`]),
      h(
        'button',
        { type: 'button', class: 'btn btn--secondary', onClick: () => navigate(`/cook/${info.sessionId}`) },
        ['Resume cooking'],
      ),
    ]);
  }

  /** Reads the cooking-session id `cook.js` persists to localStorage
   * (Invariant 6) and, if it points at a still-in-progress session, sets
   * `resumeInfo` and redraws. Never blocks the initial plan render — this
   * runs after `drawPlan()` has already shown the meals. */
  async function checkResumable() {
    const storedId = localStorage.getItem(COOKING_SESSION_ID_KEY);
    if (!storedId) {
      resumeInfo = null;
      return;
    }
    try {
      const { session } = await getCookingSession(storedId);
      if (destroyed) return;
      if (session.status !== 'active' && session.status !== 'paused') {
        // Terminal session left behind by a tab that never got to clean up
        // its own key — an honest, harmless cleanup, not this file's data.
        if (localStorage.getItem(COOKING_SESSION_ID_KEY) === storedId) {
          localStorage.removeItem(COOKING_SESSION_ID_KEY);
        }
        resumeInfo = null;
        return;
      }
      const matchedMeal = plan && !plan.is_empty ? plan.meals.find((m) => m.recipe_id === session.recipe_id) : undefined;
      resumeInfo = {
        sessionId: storedId,
        mealName: matchedMeal ? matchedMeal.name : 'this dinner',
        stepIndex: session.current_step_index,
        totalSteps: session.total_steps,
      };
    } catch {
      // A stale/foreign session id (e.g. 404) is not worth surfacing as an
      // error on the plan screen — just stop offering to resume it.
      if (destroyed) return;
      resumeInfo = null;
    }
    if (destroyed) return;
    drawPlan();
  }

  /**
   * Tap 1 of the entry-into-cooking flow: create a session for this meal
   * and go straight to cooking mode. `target_servings` is not part of the
   * frozen `MealView` shape, so this mirrors how `POST /api/plans` itself
   * sets a plan meal's target servings (`server/src/routes.ts`:
   * `target_servings: household.household_size`) rather than guessing.
   * @param {MealView} meal
   */
  async function startCooking(meal) {
    try {
      if (cachedHouseholdSize === null) {
        const { household } = await getHousehold();
        if (destroyed) return;
        cachedHouseholdSize = household.household_size;
      }
      const { session } = await createCookingSession({
        plan_meal_id: meal.plan_meal_id,
        recipe_id: meal.recipe_id,
        target_servings: cachedHouseholdSize,
      });
      if (destroyed) return;
      localStorage.setItem(COOKING_SESSION_ID_KEY, session.session_id);
      navigate(`/cook/${session.session_id}`);
    } catch (err) {
      if (destroyed) return;
      announce(err instanceof ApiError ? err.message : 'Could not start cooking. Try again.', { assertive: true });
    }
  }

  /**
   * The swap flow, tap 2 and 3, inside one bottom sheet (tap 1 already
   * happened — the "Swap this dinner" button that called this).
   * @param {MealView} meal
   */
  function openSwapSheet(meal) {
    if (!plan) return;
    const planId = plan.plan_id; // captured now so a later reassignment of `plan` can't shift this sheet's target mid-flow
    const contentHost = h('div', { class: 'stack' });
    const sheet = openSheet({
      title: `Swap ${meal.name}`,
      content: contentHost,
      onClose: () => {
        closeActiveSheet = null;
      },
    });
    closeActiveSheet = sheet.close;

    drawReasonPicker();

    function drawReasonPicker() {
      const picker = createChipGroup({
        options: SWAP_REASON_OPTIONS,
        multi: false,
        ariaLabel: `Reason to swap ${meal.name}`,
        onChange: (selected) => {
          const reason = selected[0];
          if (reason) fetchAlternatives(reason);
        },
      });
      contentHost.replaceChildren(
        h('p', { class: 'swap-sheet__intro' }, ['The other two dinners stay exactly as they are.']),
        picker.element,
      );
    }

    /** @param {string} reason */
    async function fetchAlternatives(reason) {
      contentHost.replaceChildren(createLoadingState({ label: 'Finding alternatives…' }));
      try {
        const res = await offerSwap(planId, String(meal.slot), reason);
        if (destroyed) return;
        if (!res.alternatives || res.alternatives.length === 0) {
          drawNoAlternatives(reason, res.message);
          return;
        }
        drawAlternatives(reason, /** @type {MealView[]} */ (res.alternatives));
      } catch (err) {
        if (destroyed) return;
        drawFetchError(reason, err);
      }
    }

    /**
     * @param {string} reason
     * @param {string} [message]
     */
    function drawNoAlternatives(reason, message) {
      contentHost.replaceChildren(
        createEmptyState({
          iconName: 'info',
          title: 'No alternatives right now',
          message: message || 'No other recipe satisfies that reason right now.',
        }),
        h('button', { type: 'button', class: 'btn btn--secondary', onClick: drawReasonPicker }, [
          'Choose a different reason',
        ]),
      );
    }

    function drawFetchError(reason, err) {
      const message = err instanceof ApiError ? err.message : 'Could not load alternatives.';
      contentHost.replaceChildren(
        createErrorState({
          title: 'Alternatives did not load',
          message,
          retryLabel: 'Try again',
          onRetry: () => fetchAlternatives(reason),
        }),
      );
    }

    /**
     * @param {string} reason
     * @param {MealView[]} alternatives
     */
    function drawAlternatives(reason, alternatives) {
      const cards = alternatives.map((alt) =>
        buildAlternativeCard(alt, () => acceptAlternative(reason, alt)),
      );
      contentHost.replaceChildren(
        h('p', { class: 'swap-sheet__intro' }, [
          `Pick one — ${meal.name} stays until you do, and the other two dinners won't change.`,
        ]),
        h('div', { class: 'stack' }, cards),
        h('button', { type: 'button', class: 'btn btn--secondary', onClick: drawReasonPicker }, [
          'Choose a different reason',
        ]),
      );
    }

    /**
     * @param {string} reason
     * @param {MealView} alt
     */
    async function acceptAlternative(reason, alt) {
      contentHost.replaceChildren(createLoadingState({ label: 'Swapping…' }));
      try {
        const res = await acceptSwap(planId, String(meal.slot), reason, alt.recipe_id);
        if (destroyed) return;
        // GAP (report only, not fixed here — outside this file's scope):
        // POST .../swap's accept-mode response body is `{ plan }` built by
        // `buildFullPlanView` in server/src/routes.ts, which — unlike
        // GET /api/plans/current and POST /api/plans — never attaches
        // is_partial/is_empty/shortfall. A swap only ever runs against an
        // already-complete 3-meal plan (the route 409s otherwise), so
        // defaulting them here is safe, not a guess.
        const swapped = /** @type {PlanView} */ (res.plan);
        plan = { ...swapped, is_partial: false, is_empty: false, shortfall: null };
        closeSheetIfOpen();
        announce(`Swapped in ${alt.name}. The other two dinners are unchanged.`);
        drawPlan();
      } catch (err) {
        if (destroyed) return;
        const message = err instanceof ApiError ? err.message : 'Could not complete the swap.';
        contentHost.replaceChildren(
          createErrorState({
            title: 'Swap did not go through',
            message,
            retryLabel: 'Try again',
            onRetry: () => acceptAlternative(reason, alt),
          }),
        );
        announce(message, { assertive: true });
      }
    }
  }

  async function load() {
    drawLoading();
    try {
      const { plan: p } = await getCurrentPlan();
      if (destroyed) return;
      plan = /** @type {PlanView} */ (p);
      drawPlan();
      checkResumable(); // non-blocking: redraws again once/if it finds a session to resume
    } catch (err) {
      if (destroyed) return;
      if (err instanceof ApiError && err.code === 'no_current_plan') {
        drawNoPlanYet();
      } else {
        drawError(err, load);
      }
    }
  }

  load();

  return () => {
    destroyed = true;
    unmountPrimary();
    closeSheetIfOpen();
  };
}
