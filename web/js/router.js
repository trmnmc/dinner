/**
 * router.js — the hash route table for the whole app (module entry point,
 * loaded from `index.html` as `<script type="module" src="/js/router.js">`).
 *
 * Declares every route later screens will claim so those agents slot in
 * rather than reinvent routing: `#/onboarding`, `#/calibrate`, `#/plan`,
 * `#/grocery`, `#/prep/:slot`, `#/cook/:sessionId`, `#/feedback/:planMealId`.
 * Only `#/prep/:slot` still resolves to an honest, styled "not built yet"
 * panel; every other route above has a real implementation.
 *
 * First-run routing (applied only when the hash is empty/root):
 *   no `tgd.household_id` in localStorage          -> #/onboarding
 *   household present but calibration not complete -> #/calibrate
 *   otherwise                                        -> #/plan
 *
 * To add a real screen later: import its `render(container, params)`
 * function below and replace its `NOT_BUILT` entry in `ROUTES` with
 * `{ pattern: '...', render: renderYourScreen }`. `render` may return an
 * optional cleanup function; the router calls it before leaving the route.
 */

import { hasHouseholdId, hasCompletedCalibration } from './api.js';
import { createEmptyState, h } from './ui.js';
import { renderOnboarding } from './onboarding.js';
import { renderCalibrate } from './calibrate.js';
import { renderPlan } from './plan.js';
import { renderGrocery } from './grocery.js';
import { renderPrep } from './prep.js';
import { renderCook } from './cook.js';
import { renderFeedback } from './feedback.js';

/**
 * @typedef {Object} Route
 * @property {string} pattern - e.g. "/prep/:slot"
 * @property {(container: HTMLElement, params: Record<string,string>) => (void|(() => void))} render
 * @property {string} [label] - human name used in the "not built yet" panel
 */

function notBuiltYet(label) {
  return (container) => {
    container.replaceChildren(
      h('div', { class: 'screen screen--centered' }, [
        createEmptyState({
          iconName: 'info',
          title: `${label} isn't built yet`,
          message:
            'This screen lands in a later cycle of this build. Nothing is broken — you just got here before it did.',
        }),
      ]),
    );
  };
}

/** @type {Route[]} */
const ROUTES = [
  { pattern: '/onboarding', render: renderOnboarding, label: 'Onboarding' },
  { pattern: '/calibrate', render: renderCalibrate, label: 'Taste calibration' },
  { pattern: '/plan', render: renderPlan, label: 'Plan' },
  { pattern: '/grocery', render: renderGrocery, label: 'Grocery' },
  { pattern: '/prep/:slot', render: renderPrep, label: 'Prep' },
  { pattern: '/cook/:sessionId', render: renderCook, label: 'Cook' },
  { pattern: '/feedback/:planMealId', render: renderFeedback, label: 'Feedback' },
];

function computeHomeRoute() {
  if (!hasHouseholdId()) return '/onboarding';
  if (!hasCompletedCalibration()) return '/calibrate';
  return '/plan';
}

/**
 * @param {string} pattern
 * @param {string} path
 * @returns {Record<string,string>|null}
 */
function matchPattern(pattern, path) {
  const patternSegs = pattern.split('/').filter(Boolean);
  const pathSegs = path.split('/').filter(Boolean);
  if (patternSegs.length !== pathSegs.length) return null;
  /** @type {Record<string,string>} */
  const params = {};
  for (let i = 0; i < patternSegs.length; i++) {
    const p = patternSegs[i];
    const s = pathSegs[i];
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(s);
    } else if (p !== s) {
      return null;
    }
  }
  return params;
}

function currentPath() {
  const hash = window.location.hash || '';
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  return path === '' || path === '/' ? null : path;
}

/**
 * Navigate to an app-relative path (no leading "#"), e.g. "/calibrate".
 * @param {string} path
 * @param {{replace?: boolean}} [opts]
 * @returns {void}
 */
export function navigate(path, opts = {}) {
  const target = `#${path}`;
  if (opts.replace) {
    const url = window.location.pathname + window.location.search + target;
    window.history.replaceState(null, '', url);
    render();
  } else {
    window.location.hash = target;
  }
}

let currentCleanup = null;

function render() {
  const app = document.getElementById('app');
  if (!app) return;

  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch {
      // A misbehaving screen's cleanup must never wedge navigation.
    }
    currentCleanup = null;
  }

  let path = currentPath();
  if (path === null) {
    navigate(computeHomeRoute(), { replace: true });
    return;
  }

  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, path);
    if (params) {
      const result = route.render(app, params);
      if (typeof result === 'function') currentCleanup = result;
      return;
    }
  }

  // Unknown hash: an honest not-found panel, never a blank screen.
  app.replaceChildren(
    h('div', { class: 'screen screen--centered' }, [
      createEmptyState({
        iconName: 'alert',
        title: "That page doesn't exist",
        message: `"${path}" is not a route in this app.`,
      }),
    ]),
  );
}

window.addEventListener('hashchange', render);
render();
