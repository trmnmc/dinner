/**
 * calibrate.js — taste calibration: 8–15 deliberately varied meal cards,
 * exactly four reactions (SPEC must-have): looks good · not for me ·
 * never recommend · too much work. Every reaction updates attribute-level
 * preference signals server-side (`POST /api/calibration/reactions`).
 *
 * One card at a time, one reaction grid in the thumb zone (the spec's
 * explicit four-choice exception to "one dominant action" — see
 * `ui.js`'s `mountReactionGrid` doc comment). Reactions accumulate locally
 * and are submitted as a single batch when the deck is finished, matching
 * the frozen contract's plural `reactions` array — this also means a
 * network hiccup mid-deck never loses work already reacted to.
 */

import {
  h,
  mountReactionGrid,
  renderTimeInfo,
  createStatusBadge,
  createLoadingState,
  createErrorState,
  createEmptyState,
  showUndoSnackbar,
  announce,
} from './ui.js';
import { getCalibrationCards, postCalibrationReactions, markCalibrationComplete, ApiError } from './api.js';
import { navigate } from './router.js';

const CARD_COUNT = 12;

/**
 * @typedef {Object} ReactionDef
 * @property {'looks_good'|'not_for_me'|'never_recommend'|'too_much_work'} value
 * @property {string} label
 */

/** @type {ReactionDef[]} */
const REACTIONS = [
  { value: 'looks_good', label: 'Looks good' },
  { value: 'not_for_me', label: 'Not for me' },
  { value: 'never_recommend', label: 'Never recommend' },
  { value: 'too_much_work', label: 'Too much work' },
];

/**
 * Wire shape of one calibration card (`encodeCardView`, server/src/routes.ts).
 * @typedef {Object} CardView
 * @property {string} recipe_id
 * @property {string} name
 * @property {number} total_seconds
 * @property {number} active_seconds
 * @property {string} time_label
 * @property {string} cuisine
 * @property {string} protein
 * @property {string} effort
 * @property {number} dish_count
 */

/** @param {string} s */
function titleCase(s) {
  if (!s) return '';
  return String(s)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** @param {CardView} card */
function cardMetaBadges(card) {
  const badges = [];
  if (card.cuisine) badges.push(createStatusBadge({ text: titleCase(card.cuisine) }));
  if (card.protein) badges.push(createStatusBadge({ text: titleCase(card.protein) }));
  if (card.effort) badges.push(createStatusBadge({ text: `${titleCase(card.effort)} effort` }));
  if (typeof card.dish_count === 'number') {
    badges.push(createStatusBadge({ text: `${card.dish_count} dish${card.dish_count === 1 ? '' : 'es'}` }));
  }
  return badges;
}

/**
 * Mount taste calibration into `container`.
 * @param {HTMLElement} container
 * @returns {() => void} cleanup
 */
export function renderCalibrate(container) {
  /** @type {ReturnType<typeof mountReactionGrid>|null} */
  let reactionGrid = null;
  /** @type {ReturnType<typeof showUndoSnackbar>|null} */
  let snackbarHandle = null;
  let destroyed = false;

  function unmountGrid() {
    if (reactionGrid) {
      reactionGrid.unmount();
      reactionGrid = null;
    }
  }

  function dismissSnackbar() {
    if (snackbarHandle) {
      snackbarHandle.dismiss({ immediate: true });
      snackbarHandle = null;
    }
  }

  /** @param {(Node|string|null)[]} children */
  function screenShell(children) {
    return h('div', { class: 'screen' }, [
      h('div', { class: 'screen-header' }, [
        h('span', { class: 'screen-header__eyebrow' }, ['Taste calibration']),
        h('h1', { class: 'screen-header__title', tabindex: '-1' }, ['A few reactions before we plan']),
        h('p', { class: 'screen-header__subtitle' }, [
          'Four honest reactions per card — this teaches the planner what you actually cook.',
        ]),
      ]),
      ...children,
    ]);
  }

  function drawLoading() {
    unmountGrid();
    container.replaceChildren(screenShell([createLoadingState({ label: 'Loading calibration cards…' })]));
  }

  /** @param {unknown} err */
  function drawError(err) {
    unmountGrid();
    const message = err instanceof ApiError ? err.message : 'Could not load calibration cards.';
    container.replaceChildren(
      screenShell([
        createErrorState({
          title: 'Calibration cards did not load',
          message,
          retryLabel: 'Try again',
          onRetry: load,
        }),
      ]),
    );
  }

  function drawEmpty() {
    unmountGrid();
    container.replaceChildren(
      screenShell([
        createEmptyState({
          iconName: 'info',
          title: 'Nothing to react to right now',
          message: 'There are no calibration cards available. You can continue straight to your plan.',
        }),
      ]),
    );
    reactionGrid = mountReactionGrid([
      {
        value: 'continue',
        label: 'Continue',
        onClick: () => {
          markCalibrationComplete();
          navigate('/plan');
        },
      },
    ]);
  }

  /** @type {CardView[]} */
  let cards = [];
  /** @type {{recipe_id: string, reaction: ReactionDef['value']}[]} */
  const reactions = [];
  let index = 0;
  let submitting = false;
  /** @type {HTMLElement|null} */
  let saveErrorHost = null;

  function drawCard() {
    unmountGrid();
    if (index >= cards.length) {
      drawFinishing();
      return;
    }
    const card = cards[index];
    const timeInfo = renderTimeInfo({
      total_seconds: card.total_seconds,
      active_seconds: card.active_seconds,
      time_label: card.time_label,
    });

    const cardEl = h('div', { class: 'card' }, [
      h('span', { class: 'card__eyebrow' }, [`Card ${index + 1} of ${cards.length}`]),
      h('h2', { class: 'card__title' }, [card.name]),
      timeInfo,
      h('div', { class: 'card__meta' }, cardMetaBadges(card)),
    ]);

    container.replaceChildren(screenShell([cardEl]));

    reactionGrid = mountReactionGrid(
      REACTIONS.map((r) => ({
        value: r.value,
        label: r.label,
        onClick: () => react(card, r),
      })),
    );
  }

  /**
   * @param {CardView} card
   * @param {ReactionDef} reactionDef
   */
  function react(card, reactionDef) {
    reactions.push({ recipe_id: card.recipe_id, reaction: reactionDef.value });
    const isLastCard = index === cards.length - 1;
    index += 1;

    if (!isLastCard) {
      const reactedIndex = index - 1;
      snackbarHandle = showUndoSnackbar({
        message: `Marked "${card.name}" as ${reactionDef.label.toLowerCase()}.`,
        onUndo: () => {
          // Remove the reaction that corresponds to this card, wherever it
          // ended up in the list (later cards may already have reacted).
          const pos = reactions.findIndex((r) => r.recipe_id === card.recipe_id && r.reaction === reactionDef.value);
          if (pos !== -1) reactions.splice(pos, 1);
          index = reactedIndex;
          drawCard();
        },
      });
    }
    drawCard();
  }

  function drawFinishing() {
    unmountGrid();
    saveErrorHost = h('div', {});
    container.replaceChildren(
      screenShell([createLoadingState({ label: 'Saving your reactions…' }), saveErrorHost]),
    );
    save();
  }

  async function save() {
    if (submitting) return;
    submitting = true;
    try {
      await postCalibrationReactions(reactions);
      markCalibrationComplete();
      announce('Taste calibration saved. Building your plan.');
      navigate('/plan');
    } catch (err) {
      submitting = false;
      const message = err instanceof ApiError ? err.message : 'Could not save your reactions.';
      if (saveErrorHost) {
        saveErrorHost.replaceChildren(
          createErrorState({
            title: 'Your reactions did not save',
            message,
            retryLabel: 'Try again',
            onRetry: save,
          }),
        );
      }
      announce(message, { assertive: true });
    }
  }

  async function load() {
    drawLoading();
    try {
      const { cards: fetched } = await getCalibrationCards(CARD_COUNT);
      if (destroyed) return;
      cards = fetched || [];
      index = 0;
      if (cards.length === 0) {
        drawEmpty();
      } else {
        drawCard();
      }
    } catch (err) {
      if (destroyed) return;
      drawError(err);
    }
  }

  load();

  return () => {
    destroyed = true;
    unmountGrid();
    dismissSnackbar();
  };
}
