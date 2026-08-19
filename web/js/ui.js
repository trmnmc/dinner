/**
 * ui.js — the ONLY source of shared components (DESIGN.md identity contract).
 *
 * Every screen in this product — onboarding and calibrate today, plan /
 * grocery / prep / cook / feedback in later items — imports its interactive
 * primitives from here instead of hand-rolling markup. That is what keeps
 * seven parallel-built screens from diverging into seven visual dialects.
 *
 * Exports (minimum set required by T-015's brief):
 *   - `h`                    tiny DOM builder used by every screen
 *   - `announce`             aria-live announcer
 *   - `openSheet`            bottom sheet
 *   - `showUndoSnackbar`     undo snackbar (undo, never a confirm() dialog —
 *                            there is no `confirm()` anywhere in this codebase)
 *   - `createChipGroup`      reason chips / multi-select chips (interactive)
 *   - `createStaticChips`    read-only reason chips (server-rendered reasons)
 *   - `createStatusBadge`    status badge, state conveyed beyond colour
 *   - `mountPrimaryAction`   the ONE dominant bottom-anchored action button
 *   - `mountReactionGrid`    calibration's explicit four-reaction exception
 *   - `renderTimeInfo`       the single shared total-vs-active time renderer
 *   - `createLoadingState` / `createErrorState` / `createEmptyState`
 *   - `icon`                 real inline SVG icons, never emoji
 *
 * Nothing in this module reaches into `localStorage` or `fetch` — that is
 * `api.js`'s job. Nothing in this module owns routing — that is
 * `router.js`'s job. This module only builds and wires DOM.
 */

// ---------------------------------------------------------------------------
// Tiny DOM builder — keeps every screen's markup declarative without a
// templating dependency (hard rule: zero dependencies).
// ---------------------------------------------------------------------------

/**
 * @param {string} tag
 * @param {Object<string, any>} [attrs] - attributes; `class`, `dataset`
 *   (object), `on<Event>` handlers, and `html` (raw innerHTML, use only for
 *   trusted inline SVG) get special handling; everything else is set via
 *   `setAttribute` (or as a property when it starts with `.`).
 * @param {(Node|string|null|undefined)[]} [children]
 * @returns {HTMLElement}
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') {
      el.className = value;
    } else if (key === 'dataset') {
      for (const [dk, dv] of Object.entries(value)) el.dataset[dk] = dv;
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key.startsWith('.')) {
      // Dynamic DOM-property assignment (e.g. `.value`) — `HTMLElement` has
      // no index signature, so this goes through `Reflect.set` instead of
      // bracket assignment. Behaviour is identical to `el[prop] = value`.
      Reflect.set(el, key.slice(1), value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children || []) {
    if (child == null) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// ---------------------------------------------------------------------------
// Icons — real inline SVG, never emoji (design guidance).
// ---------------------------------------------------------------------------

const ICONS = {
  check:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10.5l3.5 3.5L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  alert:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3l8.5 14.5H1.5L10 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="14.5" r="0.9" fill="currentColor"/></svg>',
  clock:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v4.3l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronLeft:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M12.5 4.5L7 10l5.5 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="6.3" r="0.9" fill="currentColor"/></svg>',
  leaf:
    '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 16c0-7 4-11.5 12-11.5C15.5 12 11.5 16 4 16z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M4 16C7 12.5 9.5 10 15.5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

/**
 * @param {keyof typeof ICONS} name
 * @returns {Element}
 */
export function icon(name) {
  const wrap = h('span', { class: 'icon', html: ICONS[name] || ICONS.info });
  const el = wrap.firstElementChild;
  // `wrap.innerHTML` is always one of the trusted `ICONS` strings, each a
  // single root SVG element, so this is never actually null — the guard
  // only exists so the return type can be `Element` instead of a fiction.
  if (el === null) throw new Error(`icon(): "${name}" produced no element`);
  return el;
}

// ---------------------------------------------------------------------------
// Aria-live announcer — one polite region, one assertive region, reused.
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} */
let politeRegion = null;
/** @type {HTMLElement|null} */
let assertiveRegion = null;

/** @param {boolean} assertive */
function region(assertive) {
  const id = assertive ? 'aria-live-assertive' : 'aria-live-polite';
  let el = document.getElementById(id);
  if (!el) {
    el = h('div', { id, class: 'sr-only', 'aria-live': assertive ? 'assertive' : 'polite', 'aria-atomic': 'true' });
    document.body.appendChild(el);
  }
  if (assertive) assertiveRegion = el;
  else politeRegion = el;
  return el;
}

/**
 * Announce a message to screen readers via a shared live region. Use
 * `assertive: true` sparingly (timer warnings, errors) — polite is the
 * default for everything else (DESIGN.md accessibility bullets).
 * @param {string} message
 * @param {{assertive?: boolean}} [opts]
 * @returns {void}
 */
export function announce(message, opts = {}) {
  const el = opts.assertive ? assertiveRegion || region(true) : politeRegion || region(false);
  // Clearing first guarantees a re-announce even if the text is identical
  // to the last message.
  el.textContent = '';
  window.setTimeout(() => {
    el.textContent = message;
  }, 30);
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @typedef {Object} SheetHandle
 * @property {(opts?: {immediate?: boolean}) => void} close
 * @property {HTMLElement} element
 */

/** @type {SheetHandle|null} */
let activeSheet = null;

/**
 * Open a bottom sheet. Only one sheet is active at a time — opening a
 * second one closes the first.
 * @param {{title: string, content: HTMLElement, labelledby?: string, onClose?: () => void}} opts
 * @returns {SheetHandle}
 */
export function openSheet({ title, content, onClose }) {
  if (activeSheet) activeSheet.close({ immediate: true });

  const root = document.getElementById('sheet-root') || document.body;
  const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
  const previouslyFocused = document.activeElement;

  const backdrop = h('div', { class: 'sheet-backdrop', 'data-open': 'false' });
  const sheetEl = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'data-open': 'false' },
    [
      h('div', { class: 'sheet__grabber', 'aria-hidden': 'true' }),
      h('h2', { class: 'sheet__title', id: titleId }, [title]),
      content,
    ],
  );

  root.appendChild(backdrop);
  root.appendChild(sheetEl);

  function close({ immediate = false } = {}) {
    if (activeSheet && activeSheet.element === sheetEl) activeSheet = null;
    document.removeEventListener('keydown', onKeydown, true);
    const finish = () => {
      backdrop.remove();
      sheetEl.remove();
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
      if (onClose) onClose();
    };
    if (immediate) {
      finish();
      return;
    }
    backdrop.dataset.open = 'false';
    sheetEl.dataset.open = 'false';
    const exitMs = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--duration-exit'), 10) || 180;
    window.setTimeout(finish, exitMs);
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = /** @type {HTMLElement[]} */ (Array.from(sheetEl.querySelectorAll(FOCUSABLE_SELECTOR)));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  backdrop.addEventListener('click', () => close());
  document.addEventListener('keydown', onKeydown, true);

  // Open on next frame so the transform/opacity transition runs.
  requestAnimationFrame(() => {
    backdrop.dataset.open = 'true';
    sheetEl.dataset.open = 'true';
    const focusable = /** @type {HTMLElement|null} */ (sheetEl.querySelector(FOCUSABLE_SELECTOR));
    (focusable || sheetEl).focus({ preventScroll: true });
  });

  activeSheet = { element: sheetEl, close };
  return { close, element: sheetEl };
}

// ---------------------------------------------------------------------------
// Undo snackbar — undo, never a confirmation modal.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SnackbarHandle
 * @property {(opts?: {immediate?: boolean}) => void} dismiss
 */

/**
 * @typedef {Object} ActiveSnackbar
 * @property {HTMLElement} bar
 * @property {(opts?: {immediate?: boolean}) => void} dismiss
 */

/** @type {ActiveSnackbar|null} */
let activeSnackbar = null;

/**
 * Show an undo snackbar for a destructive-feeling action that has ALREADY
 * happened. There is no confirm-before-acting dialog in this product —
 * every such action fires immediately and offers undo instead.
 * @param {{message: string, onUndo: () => void, actionLabel?: string, duration?: number}} opts
 * @returns {SnackbarHandle}
 */
export function showUndoSnackbar({ message, onUndo, actionLabel = 'Undo', duration = 6000 }) {
  if (activeSnackbar) activeSnackbar.dismiss({ immediate: true });

  const root = document.getElementById('snackbar-root') || document.body;
  /** @type {number|null} */
  let timer = null;

  const bar = h('div', { class: 'snackbar', role: 'status', 'data-open': 'false' }, [
    h('span', { class: 'snackbar__message' }, [message]),
    h('button', {
      type: 'button',
      class: 'snackbar__undo',
      onClick: () => {
        dismiss();
        onUndo();
      },
    }, [actionLabel]),
  ]);
  root.appendChild(bar);

  function dismiss({ immediate = false } = {}) {
    if (timer) window.clearTimeout(timer);
    if (activeSnackbar && activeSnackbar.bar === bar) activeSnackbar = null;
    if (immediate) {
      bar.remove();
      return;
    }
    bar.dataset.open = 'false';
    const exitMs = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--duration-exit'), 10) || 180;
    window.setTimeout(() => bar.remove(), exitMs);
  }

  requestAnimationFrame(() => {
    bar.dataset.open = 'true';
  });
  timer = window.setTimeout(dismiss, duration);
  announce(message);

  activeSnackbar = { bar, dismiss };
  return { dismiss };
}

// ---------------------------------------------------------------------------
// Chips — interactive (multi- or single-select) and static (read-only).
// ---------------------------------------------------------------------------

/**
 * @typedef {{value: string, label: string}} ChipOption
 */

/**
 * A group of toggleable chips. In `multi: false` mode, selecting one
 * deselects the rest (still rendered as chips, not a native <select> —
 * the visual language of choices stays consistent everywhere).
 * @param {{options: ChipOption[], multi?: boolean, selected?: string[], onChange?: (selected: string[]) => void, ariaLabel: string}} opts
 * @returns {{element: HTMLElement, getSelected: () => string[], setSelected: (values: string[]) => void}}
 */
export function createChipGroup({ options, multi = true, selected = [], onChange, ariaLabel }) {
  let state = new Set(selected);
  const buttons = new Map();

  const group = h('div', { class: 'chip-group', role: 'group', 'aria-label': ariaLabel });

  function render() {
    for (const [value, btn] of buttons) {
      btn.setAttribute('aria-pressed', state.has(value) ? 'true' : 'false');
    }
  }

  for (const opt of options) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'chip',
        'aria-pressed': state.has(opt.value) ? 'true' : 'false',
        onClick: () => {
          if (multi) {
            if (state.has(opt.value)) state.delete(opt.value);
            else state.add(opt.value);
          } else {
            state = state.has(opt.value) ? new Set() : new Set([opt.value]);
          }
          render();
          if (onChange) onChange(Array.from(state));
        },
      },
      [opt.label],
    );
    buttons.set(opt.value, btn);
    group.appendChild(btn);
  }

  return {
    element: group,
    getSelected: () => Array.from(state),
    setSelected: (values) => {
      state = new Set(values);
      render();
    },
  };
}

/**
 * Read-only reason chips — renders server-provided `{code, text}` reasons
 * (MealView.reasons, CardView attributes, etc.) as a static chip list.
 * @param {{code?: string, text: string}[]} reasons
 * @returns {HTMLElement}
 */
export function createStaticChips(reasons) {
  return h(
    'ul',
    { class: 'chip-group', 'aria-label': 'Reasons' },
    (reasons || []).map((r) => h('li', {}, [h('span', { class: 'chip chip--static' }, [r.text])])),
  );
}

// ---------------------------------------------------------------------------
// Status badge — state conveyed by icon + text together, never colour alone.
// ---------------------------------------------------------------------------

/**
 * @param {{text: string, tone?: 'neutral'|'ok'|'warn'|'accent', iconName?: keyof typeof ICONS}} opts
 * @returns {HTMLElement}
 */
export function createStatusBadge({ text, tone = 'neutral', iconName }) {
  const toneClass = tone === 'neutral' ? '' : ` badge--${tone}`;
  const children = [];
  if (iconName) children.push(icon(iconName));
  children.push(h('span', {}, [text]));
  return h('span', { class: `badge${toneClass}` }, children);
}

// ---------------------------------------------------------------------------
// The ONE dominant, bottom-anchored primary action.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PrimaryBarHandle
 * @property {HTMLElement} element
 * @property {(v: boolean) => void} setDisabled
 * @property {(v: string) => void} setLabel
 * @property {() => void} unmount
 */

/** @type {PrimaryBarHandle|null} */
let activePrimaryBar = null;

/**
 * Mount the single dominant action for the current screen. Mounting a new
 * one removes any previous primary action bar — there is structurally never
 * more than one on screen at a time.
 * @param {{label: string, onClick: () => void, disabled?: boolean, ariaLabel?: string}} opts
 * @returns {PrimaryBarHandle}
 */
export function mountPrimaryAction({ label, onClick, disabled = false, ariaLabel }) {
  if (activePrimaryBar) activePrimaryBar.unmount();

  const btn = /** @type {HTMLButtonElement} */ (
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        disabled,
        'aria-label': ariaLabel || undefined,
        onClick: () => {
          if (btn.disabled) return;
          onClick();
        },
      },
      [label],
    )
  );
  const bar = h('div', { class: 'primary-action-bar' }, [btn]);
  document.body.appendChild(bar);

  /** @type {PrimaryBarHandle} */
  const api = {
    element: bar,
    setDisabled: (v) => {
      btn.disabled = v;
    },
    setLabel: (v) => {
      btn.textContent = v;
    },
    unmount: () => {
      bar.remove();
      if (activePrimaryBar === api) activePrimaryBar = null;
    },
  };
  activePrimaryBar = api;
  return api;
}

/**
 * Calibration's deliberate four-choice exception to "one dominant action"
 * (SPEC: exactly four reactions — looks good / not for me / never
 * recommend / too much work). Equal visual weight; never framed as a single
 * primary button.
 * @param {{value: string, label: string, onClick: () => void}[]} reactions
 * @returns {{unmount: () => void, setDisabled: (v: boolean) => void}}
 */
export function mountReactionGrid(reactions) {
  if (activePrimaryBar) {
    activePrimaryBar.unmount();
  }
  const buttons = reactions.map((r) =>
    /** @type {HTMLButtonElement} */ (
      h(
        'button',
        {
          type: 'button',
          class: 'reaction-btn',
          dataset: { reaction: r.value },
          onClick: () => r.onClick(),
        },
        [r.label],
      )
    ),
  );
  const grid = h('div', { class: 'reaction-grid', role: 'group', 'aria-label': 'React to this meal' }, buttons);
  document.body.appendChild(grid);

  return {
    unmount: () => grid.remove(),
    setDisabled: (v) => {
      for (const b of buttons) b.disabled = v;
    },
  };
}

// ---------------------------------------------------------------------------
// The single shared total-vs-active time renderer (DoD 6).
// ---------------------------------------------------------------------------

/**
 * @typedef {{total_seconds?: number, active_seconds?: number, time_label?: string}} TimeFields
 */

/** @param {number} seconds */
function minutesFromSeconds(seconds) {
  return Math.round(seconds / 60);
}

/**
 * @param {number} minutes
 * @param {string} suffix
 */
function minuteText(minutes, suffix) {
  return minutes <= 0 ? `under 1 min ${suffix}` : `${minutes} min ${suffix}`;
}

/**
 * Visible children for one side (total or active) of the pair: the bolded
 * numeral when there is one to show, or the plain "under 1 min ..." phrase
 * — byte-identical to `minuteText` — when rounding lands on zero, so the
 * on-screen text never disagrees with the `aria-label` fallback below.
 * @param {number} minutes
 * @param {string} suffix
 */
function timeSpanChildren(minutes, suffix) {
  return minutes <= 0 ? [minuteText(minutes, suffix)] : [h('strong', {}, [`${minutes} min`]), ` ${suffix}`];
}

/**
 * The ONE function in the client that turns a meal/recipe/step's time
 * fields into on-screen markup. Every view shape in the frozen contract
 * carries `total_seconds`, `active_seconds` AND a pre-rendered `time_label`
 * — this renderer shows total and active SEPARATELY, always, everywhere
 * (DoD 6), and falls back gracefully when a field is absent rather than
 * fabricating a number.
 * @param {TimeFields} [fields]
 * @returns {HTMLElement}
 */
export function renderTimeInfo(fields = {}) {
  const { total_seconds, active_seconds, time_label } = fields;
  const hasTotal = typeof total_seconds === 'number' && Number.isFinite(total_seconds);
  const hasActive = typeof active_seconds === 'number' && Number.isFinite(active_seconds);

  if (!hasTotal && !hasActive) {
    const text = time_label || 'Time not available';
    return h('div', { class: 'time-info' }, [h('span', { class: 'time-info__total' }, [text])]);
  }

  const parts = [];
  let ariaLabel = time_label;
  if (hasTotal) {
    const children = timeSpanChildren(minutesFromSeconds(total_seconds), 'total');
    // Domain's combined_label joins total and active with ", " — that
    // separator has to be a real text node, not CSS spacing, or it is
    // invisible to textContent/aria consumers. It lives at the end of the
    // total span (rather than as its own flex child) so the container's
    // existing gap between spans doesn't stack a second gap around it.
    if (hasActive) children.push(', ');
    parts.push(h('span', { class: 'time-info__total num' }, children));
  }
  if (hasActive) {
    parts.push(
      h('span', { class: 'time-info__active num' }, timeSpanChildren(minutesFromSeconds(active_seconds), 'hands-on')),
    );
  }
  if (!ariaLabel) {
    const totalTxt = hasTotal ? minuteText(minutesFromSeconds(total_seconds), 'total') : null;
    const activeTxt = hasActive ? minuteText(minutesFromSeconds(active_seconds), 'hands-on') : null;
    ariaLabel = [totalTxt, activeTxt].filter(Boolean).join(', ');
  }
  return h('div', { class: 'time-info', 'aria-label': ariaLabel }, parts);
}

// ---------------------------------------------------------------------------
// State surfaces — every surface gets an explicit loading / error / empty
// state, not just the happy path (design guidance).
// ---------------------------------------------------------------------------

/**
 * @param {{label?: string}} [opts]
 * @returns {HTMLElement}
 */
export function createLoadingState({ label = 'Loading…' } = {}) {
  return h('div', { class: 'state-panel', role: 'status' }, [
    h('div', { class: 'spinner', 'aria-hidden': 'true' }),
    h('span', { class: 'sr-only' }, [label]),
  ]);
}

/**
 * @param {{title?: string, message: string, retryLabel?: string, onRetry?: () => void}} opts
 * @returns {HTMLElement}
 */
export function createErrorState({ title = 'Something needs your attention', message, retryLabel, onRetry }) {
  const children = [
    icon('alert'),
    h('p', { class: 'state-panel__title' }, [title]),
    h('p', { class: 'state-panel__body' }, [message]),
  ];
  if (onRetry) {
    children.push(
      h('button', { type: 'button', class: 'btn btn--secondary', onClick: onRetry }, [retryLabel || 'Try again']),
    );
  }
  return h('div', { class: 'state-panel', role: 'alert' }, children);
}

/**
 * @param {{title: string, message: string, iconName?: keyof typeof ICONS}} opts
 * @returns {HTMLElement}
 */
export function createEmptyState({ title, message, iconName = 'info' }) {
  return h('div', { class: 'state-panel' }, [
    icon(iconName),
    h('p', { class: 'state-panel__title' }, [title]),
    h('p', { class: 'state-panel__body' }, [message]),
  ]);
}
