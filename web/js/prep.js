/**
 * prep.js — the prep plan screen (T-057): everything a parent needs before
 * starting to cook one dinner from the plan — ingredients to retrieve,
 * equipment needed, tasks that can be done earlier, the first step that
 * demands full attention, the first safe stopping point, and the blocks of
 * active (hands-on) time ahead.
 *
 * Data flow: `#/prep/:slot` carries only a slot number (no plan id), so —
 * same pattern as `grocery.js` — `getCurrentPlan()` resolves the
 * household's current plan first. That also supplies the meal's display
 * `name`, since the prep payload itself is recipe-scoped and carries no
 * meal name (`server/src/routes.ts` `encodePrepPlan` — see below). Once the
 * plan meal at this slot is found, `getPrepPlan(planId, slot)` calls
 * `GET /api/plans/:planId/meals/:slot/prep`, which returns `{prep: <PrepPlan>}`
 * (`handleGetPrep` / `encodePrepPlan`, ~routes.ts:1233-1330):
 *
 *   recipe_id, total_seconds, active_seconds, time_label,
 *   required_ingredients[], optional_ingredients[]   (IngredientLine: id,
 *     ingredient_id, display_name, quantity{kind:'to_taste'|'exact'|'range',
 *     ...}, preparation, optional)
 *   equipment[]                                      (plain strings)
 *   do_ahead_tasks[]                                 (ingredient_line_id,
 *     ingredient_id, display_name, preparation)
 *   first_non_interruptible_step                      (StepView | null:
 *     index, text, total_seconds, active_seconds, time_label,
 *     requires_continuous_attention, safe_to_pause_after)
 *   first_safe_stopping_point                          (NextSafeStop:
 *     {kind:'end_of_recipe'} | {kind, step_index, maximum_pause,
 *     natural_stopping_point})
 *   active_time_blocks[]                               (start_step_index,
 *     end_step_index, active_seconds, time_label)
 *
 * T-043: the server already scales every ingredient quantity to THIS plan
 * meal's `target_servings` (not the recipe's `servings_default`) — the same
 * scale factor the grocery list uses (a conductor gate proved prep and
 * grocery agree on 15 wire pairs) — so this screen never rescales anything
 * client-side; the numbers on screen are the wire numbers, formatted only.
 *
 * T-040: every `active_time_blocks[].time_label` arrives pre-rendered by
 * `domain/src/reasons.ts`'s `renderActiveTimeLabel` and is shown VERBATIM
 * here — this file computes no minutes from seconds for that field, or for
 * any `total_seconds`/`active_seconds`/`time_label` triple (those always go
 * through `ui.js`'s shared `renderTimeInfo`). The one place a duration IS
 * hand-converted to words is `first_safe_stopping_point.maximum_pause` —
 * `reasons.ts` has no renderer for `MaximumPause` (confirmed by reading it),
 * and `cook.js` already hand-formats this exact shape locally
 * (`durationWords` / `safeStopText`) for the same reason. `durationWords`
 * and `safeStopText` below are that same idiom, not a second convention.
 *
 * Ingredient quantities here are the RECIPE's own authored units (g, kg,
 * oz, lb, ml, l, tsp, tbsp, cup, fl_oz, count — `domain/src/recipe.ts`
 * `Unit`), not grocery's canonical g/ml/count. Every wire rational is
 * rendered through `formatQuantity(q, { maxFracDigits })` — same pattern as
 * `grocery.js`'s `formatInfoQty` for its own informational (non-purchase)
 * quantities — never as a raw exact-fraction string.
 *
 * Honest-absence handling (design guidance / Invariant 6): a slot with no
 * active plan meal, an API error, no step anywhere requiring continuous
 * attention (`first_non_interruptible_step: null`), no safe stopping point
 * anywhere (`first_safe_stopping_point.kind === 'end_of_recipe'`), and zero
 * active-time blocks (an entirely unattended recipe) are all rendered as
 * plain, explicit sentences — never an empty region. The frozen wire
 * contract for this route carries no per-step `recovery_instruction` (that
 * lives only on `cook.js`'s session view, driven by the session's CURRENT
 * step, not a precomputed prep-time step) — this screen has nothing to
 * honestly report or fabricate for "recovery guidance" and does not
 * attempt to invent one.
 */

import {
  h,
  icon,
  createStatusBadge,
  mountPrimaryAction,
  renderTimeInfo,
  createLoadingState,
  createErrorState,
  createEmptyState,
  announce,
} from './ui.js';
import { getCurrentPlan, getPrepPlan, getHousehold, createCookingSession, formatQuantity, ApiError } from './api.js';
import { navigate } from './router.js';

/**
 * Matches the `tgd.` prefix convention `api.js` uses for
 * `household_id`/`calibration_done`, mirrored locally by `plan.js` and
 * `cook.js` for this same key (see `plan.js`'s header comment — not added
 * to `api.js` itself, outside that item's scope, so every screen that
 * needs it defines the same literal key rather than sharing an import).
 */
const COOKING_SESSION_ID_KEY = 'tgd.cooking_session_id';

/** Matches `plan.js`'s `MEALS_PER_PLAN` — the catalog always plans exactly
 * three dinners, so "Dinner N of 3" is a fixed fact, not a derived count. */
const MEALS_PER_PLAN = 3;

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Only `fl_oz` needs a display fix-up among the recipe's authored units
 * (`domain/src/recipe.ts` `Unit`) — every other value already reads as a
 * word (`g`, `kg`, `oz`, `lb`, `ml`, `l`, `tsp`, `tbsp`, `cup`, `count`). */
const UNIT_LABELS = { fl_oz: 'fl oz' };

function unitLabel(unit) {
  return UNIT_LABELS[unit] || unit;
}

/** Decimal precision per authored unit for on-screen display — same idea
 * as `grocery.js`'s `UNIT_DISPLAY_DECIMALS`, extended to cover every
 * recipe-authored `Unit` (grocery only ever sees the three canonical
 * units; a prep ingredient line can carry any of them). */
const QTY_DISPLAY_DECIMALS = {
  g: 0,
  kg: 2,
  oz: 1,
  lb: 2,
  ml: 0,
  l: 2,
  tsp: 2,
  tbsp: 2,
  cup: 2,
  fl_oz: 1,
  count: 2,
};

function qtyDecimals(unit) {
  return QTY_DISPLAY_DECIMALS[unit] ?? 2;
}

function isZeroQty(q) {
  return q.n === '0';
}

/**
 * Formats a single rational amount for this screen — an informational
 * "how much to retrieve" fact, never a purchase decision (that is
 * grocery.js's job), so ordinary round-to-nearest via `maxFracDigits` is
 * appropriate. Guards the same false-zero edge case grocery.js's
 * `formatInfoQty` guards: a genuinely nonzero scaled amount must never
 * display as a bare "0", which would misread as "none of this needed".
 * @param {{n: string, d: string}} q
 * @param {string} unit
 * @returns {string}
 */
function formatAmount(q, unit) {
  let decimals = qtyDecimals(unit);
  let text = formatQuantity(q, { maxFracDigits: decimals });
  while (!isZeroQty(q) && Number(text) === 0 && decimals < 4) {
    decimals += 1;
    text = formatQuantity(q, { maxFracDigits: decimals });
  }
  return text;
}

/**
 * @param {{kind: 'to_taste'}|{kind: 'exact', amount, unit}|{kind: 'range', min, max, unit}} quantity
 * @returns {string}
 */
function formatIngredientQuantity(quantity) {
  if (quantity.kind === 'to_taste') return 'To taste';
  if (quantity.kind === 'exact') {
    return `${formatAmount(quantity.amount, quantity.unit)} ${unitLabel(quantity.unit)}`;
  }
  return `${formatAmount(quantity.min, quantity.unit)}–${formatAmount(quantity.max, quantity.unit)} ${unitLabel(quantity.unit)}`;
}

/**
 * Concrete, countable duration copy for `maximum_pause` — several of the
 * authored windows are well under a minute, so anything under a minute is
 * shown in seconds rather than rounding it away to "under 1 minute"
 * (matches `cook.js`'s `durationWords`, the established idiom for this
 * exact shape — see header comment).
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

/**
 * @param {{kind: string, step_index?: number, maximum_pause?: {kind: string, seconds?: number}, natural_stopping_point?: boolean}} stop
 * @returns {string}
 */
function safeStopText(stop) {
  if (stop.kind === 'end_of_recipe') {
    return 'No safe stopping point until the dish is done.';
  }
  const stepNum = /** @type {number} */ (stop.step_index) + 1;
  let base;
  if (stop.kind === 'now') base = `Safe to stop right now, during step ${String(stepNum)}.`;
  else if (stop.kind === 'during_step') base = `First safe stop: during step ${String(stepNum)}.`;
  else if (stop.kind === 'after_step') base = `First safe stop: right after step ${String(stepNum)}.`;
  else base = `First safe stop: before you start step ${String(stepNum)}.`; // before_step

  const pause = stop.maximum_pause;
  const pauseText =
    pause && pause.kind === 'bounded'
      ? ` Pause up to ${durationWords(/** @type {number} */ (pause.seconds))}.`
      : ' No time limit on the pause.';
  const naturalText = stop.natural_stopping_point ? ' This is a natural stopping point.' : '';
  return base + pauseText + naturalText;
}

// ---------------------------------------------------------------------------
// Section builders — each renders one of the six required prep elements as
// its own section, honest about absence rather than an empty region.
// ---------------------------------------------------------------------------

function ingredientListItem(line) {
  return h('li', { class: 'prep-ingredient' }, [
    h('span', { class: 'prep-ingredient__name' }, [capitalize(line.display_name)]),
    h('span', { class: 'prep-ingredient__qty num' }, [formatIngredientQuantity(line.quantity)]),
  ]);
}

/** Ingredients to retrieve — required first, optional called out separately
 * so "what MUST I have" and "what's a nice-to-have" never blur together.
 * @param {any[]} required @param {any[]} optional @returns {HTMLElement}
 */
function ingredientsSection(required, optional) {
  const children = [
    h('h2', { class: 'prep-section__title' }, ['Ingredients to retrieve']),
  ];
  if (required.length === 0 && optional.length === 0) {
    children.push(h('p', { class: 'prep-section__note text-secondary' }, ['This recipe has no ingredient lines.']));
  } else {
    if (required.length > 0) {
      children.push(h('ul', { class: 'prep-list' }, required.map(ingredientListItem)));
    }
    if (optional.length > 0) {
      children.push(h('p', { class: 'prep-section__subhead text-muted' }, ['Optional']));
      children.push(h('ul', { class: 'prep-list' }, optional.map(ingredientListItem)));
    }
  }
  return h('section', { class: 'prep-section prep-ingredients' }, children);
}

/** @param {string[]} equipment @returns {HTMLElement} */
function equipmentSection(equipment) {
  const children = [h('h2', { class: 'prep-section__title' }, ['Equipment needed'])];
  if (equipment.length === 0) {
    children.push(h('p', { class: 'prep-section__note text-secondary' }, ['No special equipment called out for this recipe.']));
  } else {
    children.push(
      h(
        'ul',
        { class: 'prep-list prep-list--plain' },
        equipment.map((item) => h('li', { class: 'prep-equipment-item' }, [capitalize(item)])),
      ),
    );
  }
  return h('section', { class: 'prep-section prep-equipment' }, children);
}

/** @param {any[]} tasks @returns {HTMLElement} */
function doAheadSection(tasks) {
  const children = [h('h2', { class: 'prep-section__title' }, ['Tasks you can do earlier'])];
  if (tasks.length === 0) {
    children.push(
      h('p', { class: 'prep-section__note text-secondary' }, ['Nothing here can be done ahead — every step needs to happen at cook time.']),
    );
  } else {
    children.push(
      h(
        'ul',
        { class: 'prep-list prep-list--plain' },
        tasks.map((t) =>
          h('li', { class: 'prep-do-ahead-item' }, [`${capitalize(t.display_name)} — ${t.preparation}`]),
        ),
      ),
    );
  }
  return h('section', { class: 'prep-section prep-do-ahead' }, children);
}

/** The first step demanding continuous attention — an explicit warning,
 * matching `cook.js`'s `cook-warning` visual language (icon + text
 * together, never colour alone) so the same "this needs you" signal reads
 * identically in prep and in cooking mode.
 * @param {any|null} step @returns {HTMLElement}
 */
function firstAttentionStepSection(step) {
  const children = [h('h2', { class: 'prep-section__title' }, ['Needs your full attention first'])];
  if (step === null) {
    children.push(
      h('p', { class: 'prep-section__note text-secondary' }, ['No step in this recipe needs continuous attention — pause anywhere.']),
    );
  } else {
    children.push(
      h('div', { class: 'prep-attention', role: 'status' }, [
        icon('alert'),
        h('div', { class: 'stack stack--tight' }, [
          h('p', { class: 'prep-attention__text' }, [`Step ${String(step.index + 1)}: ${step.text}`]),
          renderTimeInfo({ total_seconds: step.total_seconds, active_seconds: step.active_seconds, time_label: step.time_label }),
        ]),
      ]),
    );
  }
  return h('section', { class: 'prep-section prep-first-step' }, children);
}

/** @param {any} stop @returns {HTMLElement} */
function safeStopSection(stop) {
  return h('section', { class: 'prep-section prep-safe-stop' }, [
    h('h2', { class: 'prep-section__title' }, ['First safe stopping point']),
    h('div', { class: 'prep-safe-stop__panel', role: 'status' }, [icon('clock'), h('p', {}, [safeStopText(stop)])]),
  ]);
}

/** @param {any} b @returns {HTMLElement} */
function activeTimeBlockRow(b) {
  const stepRange =
    b.start_step_index === b.end_step_index
      ? `Step ${String(b.start_step_index + 1)}`
      : `Steps ${String(b.start_step_index + 1)}–${String(b.end_step_index + 1)}`;
  return h('li', { class: 'prep-block' }, [
    h('span', { class: 'prep-block__steps' }, [stepRange]),
    // Rendered VERBATIM (T-040) — never recomputed from active_seconds here.
    h('span', { class: 'prep-block__time num' }, [b.time_label]),
  ]);
}

/** @param {any[]} blocks @returns {HTMLElement} */
function activeTimeBlocksSection(blocks) {
  const children = [h('h2', { class: 'prep-section__title' }, ['Active time ahead'])];
  if (blocks.length === 0) {
    children.push(
      h('p', { class: 'prep-section__note text-secondary' }, ['No hands-on stretches — every step here runs unattended.']),
    );
  } else {
    children.push(h('ul', { class: 'prep-list prep-list--plain' }, blocks.map(activeTimeBlockRow)));
  }
  return h('section', { class: 'prep-section prep-active-blocks' }, children);
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

/**
 * Mount the prep screen into `container`.
 * @param {HTMLElement} container
 * @param {Record<string, string>} params - `{slot}` from `/prep/:slot`.
 * @returns {() => void} cleanup
 */
export function renderPrep(container, params) {
  let destroyed = false;
  let primaryBar = null;
  /** @type {any|null} */
  let currentMeal = null;
  /** @type {string|null} */
  let planId = null;
  /** Cached only once "Start cooking" is tapped — mirrors plan.js's
   * `startCooking`, which does the same lookup for the same reason
   * (`target_servings` is not part of MealView, so this mirrors how
   * `POST /api/plans` itself sets a plan meal's target servings). */
  let cachedHouseholdSize = null;

  function unmountPrimary() {
    if (primaryBar) {
      primaryBar.unmount();
      primaryBar = null;
    }
  }

  function screenShell(children) {
    return h('div', { class: 'screen' }, [
      h('div', { class: 'screen-header' }, [
        h('span', { class: 'screen-header__eyebrow' }, ['Prep']),
        h('h1', { class: 'screen-header__title', tabindex: '-1' }, ['Prep plan']),
        h('p', { class: 'screen-header__subtitle' }, [
          'Everything to line up before you start cooking.',
        ]),
      ]),
      ...children,
    ]);
  }

  function drawLoading() {
    unmountPrimary();
    container.replaceChildren(screenShell([createLoadingState({ label: 'Loading your prep plan…' })]));
  }

  function drawError(err, retry) {
    unmountPrimary();
    const message = err instanceof ApiError ? err.message : 'Could not load your prep plan.';
    container.replaceChildren(
      screenShell([
        createErrorState({ title: 'Your prep plan did not load', message, retryLabel: 'Try again', onRetry: retry }),
      ]),
    );
  }

  function drawNoPlan() {
    unmountPrimary();
    container.replaceChildren(
      screenShell([
        createEmptyState({
          iconName: 'info',
          title: 'No plan yet',
          message: 'Prep plans are built from your plan. Set up a plan first and this fills in on its own.',
        }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Go to plan', onClick: () => navigate('/plan') });
  }

  /** Honest handling of "a slot with no prep data" — an invalid slot number,
   * or a plan whose meal at this slot was swapped out / never existed. */
  function drawNoMealAtSlot() {
    unmountPrimary();
    container.replaceChildren(
      screenShell([
        createEmptyState({
          iconName: 'info',
          title: 'No prep plan for this dinner',
          message: "This slot doesn't have an active dinner in your current plan.",
        }),
      ]),
    );
    primaryBar = mountPrimaryAction({ label: 'Go to plan', onClick: () => navigate('/plan') });
  }

  /**
   * @param {any} meal
   * @param {any} prep
   */
  function drawPrep(meal, prep) {
    unmountPrimary();
    const children = [
      h('div', { class: 'card' }, [
        h('span', { class: 'card__eyebrow' }, [`Dinner ${String(meal.slot + 1)} of ${String(MEALS_PER_PLAN)}`]),
        h('h2', { class: 'card__title' }, [meal.name]),
        renderTimeInfo({ total_seconds: prep.total_seconds, active_seconds: prep.active_seconds, time_label: prep.time_label }),
        h('div', { class: 'card__meta' }, [createStatusBadge({ text: 'Prep plan' })]),
      ]),
      ingredientsSection(prep.required_ingredients, prep.optional_ingredients),
      equipmentSection(prep.equipment),
      doAheadSection(prep.do_ahead_tasks),
      firstAttentionStepSection(prep.first_non_interruptible_step),
      safeStopSection(prep.first_safe_stopping_point),
      activeTimeBlocksSection(prep.active_time_blocks),
    ];
    container.replaceChildren(screenShell(children));
    primaryBar = mountPrimaryAction({ label: 'Start cooking', onClick: startCooking });
  }

  async function startCooking() {
    if (!primaryBar || !currentMeal) return;
    primaryBar.setDisabled(true);
    primaryBar.setLabel('Starting…');
    try {
      if (cachedHouseholdSize === null) {
        const { household } = await getHousehold();
        if (destroyed) return;
        cachedHouseholdSize = household.household_size;
      }
      const { session } = await createCookingSession({
        plan_meal_id: currentMeal.plan_meal_id,
        recipe_id: currentMeal.recipe_id,
        target_servings: cachedHouseholdSize,
      });
      if (destroyed) return;
      localStorage.setItem(COOKING_SESSION_ID_KEY, session.session_id);
      navigate(`/cook/${session.session_id}`);
    } catch (err) {
      if (destroyed) return;
      if (primaryBar) {
        primaryBar.setDisabled(false);
        primaryBar.setLabel('Start cooking');
      }
      announce(err instanceof ApiError ? err.message : 'Could not start cooking. Try again.', { assertive: true });
    }
  }

  async function load() {
    drawLoading();
    let plan;
    try {
      ({ plan } = await getCurrentPlan());
      if (destroyed) return;
    } catch (err) {
      if (destroyed) return;
      if (err instanceof ApiError && err.code === 'no_current_plan') {
        drawNoPlan();
      } else {
        drawError(err, load);
      }
      return;
    }

    const slotParam = params.slot;
    const slotNum = Number(slotParam);
    const meal =
      !plan.is_empty && Array.isArray(plan.meals) && Number.isInteger(slotNum)
        ? plan.meals.find((m) => m.slot === slotNum)
        : undefined;
    if (!meal) {
      drawNoMealAtSlot();
      return;
    }
    currentMeal = meal;
    planId = plan.plan_id;

    try {
      const { prep } = await getPrepPlan(planId, slotParam);
      if (destroyed) return;
      drawPrep(meal, prep);
    } catch (err) {
      if (destroyed) return;
      drawError(err, load);
    }
  }

  load();

  return () => {
    destroyed = true;
    unmountPrimary();
  };
}
