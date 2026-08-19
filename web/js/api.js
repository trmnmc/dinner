/**
 * api.js — thin wrapper over FROZEN HTTP CONTRACT v1.
 *
 * This module is the ONLY place that calls `fetch`. It implements every
 * route in the frozen contract as a thin, typed wrapper — including the
 * routes this item does not use (6–15) — so later screens slot in against
 * a stable surface instead of inventing their own fetch calls.
 *
 * Do not rename a field, change a path, or add a request field beyond what
 * the contract states. If you need something the contract does not offer,
 * that is a contract-drift conversation (DESIGN.md), not a local patch.
 */

const HOUSEHOLD_ID_KEY = 'tgd.household_id';

/**
 * Client-only convenience flag, NOT part of the frozen HTTP contract. The
 * contract has no "has this household finished calibration" field, so
 * `router.js` uses this local marker (set by `calibrate.js` on completion)
 * to decide between `#/calibrate` and `#/plan` on repeat visits. See
 * T-015's handoff notes: a future server-authoritative signal (e.g. a
 * `calibration_complete` flag on `GET /api/household`) should replace this
 * once it exists in the contract.
 */
const CALIBRATION_DONE_KEY = 'tgd.calibration_done';

// ---------------------------------------------------------------------------
// Household id storage
// ---------------------------------------------------------------------------

/** @returns {string|null} */
export function getHouseholdId() {
  return localStorage.getItem(HOUSEHOLD_ID_KEY);
}

/** @param {string} id */
export function setHouseholdId(id) {
  localStorage.setItem(HOUSEHOLD_ID_KEY, id);
}

/** @returns {boolean} */
export function hasHouseholdId() {
  return Boolean(getHouseholdId());
}

/** @returns {boolean} */
export function hasCompletedCalibration() {
  return localStorage.getItem(CALIBRATION_DONE_KEY) === '1';
}

/** @returns {void} */
export function markCalibrationComplete() {
  localStorage.setItem(CALIBRATION_DONE_KEY, '1');
}

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------

/**
 * Thrown for every non-2xx response. Carries the server's `code` and
 * `message` verbatim — every screen shows `message`, never a generic
 * "something went wrong" (frozen contract).
 */
export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const NO_AUTH_PATHS = new Set(['/api/health', '/api/households']);

/**
 * @param {string} path - e.g. "/api/household"
 * @param {{method?: string, body?: any}} [opts]
 * @returns {Promise<any>}
 */
async function request(path, opts = {}) {
  const method = opts.method || 'GET';
  /** @type {Record<string, string>} */
  const headers = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (!(NO_AUTH_PATHS.has(path) && method === 'GET') && path !== '/api/health') {
    const householdId = getHouseholdId();
    // POST /api/households is the one path that creates the id, so it is
    // exempt even though it is not a GET.
    if (path !== '/api/households' && householdId) {
      headers['x-household-id'] = householdId;
    }
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError('network_error', 'Could not reach the server. Check your connection and try again.');
  }

  let payload = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError('invalid_response', 'The server sent a response that could not be read.', res.status);
    }
  }

  if (!res.ok) {
    const err = payload && payload.error;
    throw new ApiError(
      (err && err.code) || 'unknown_error',
      (err && err.message) || 'Something went wrong on the server.',
      res.status,
    );
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Rational quantity helpers — the wire format is {"n": "<num>", "d": "<den>"}
// STRINGS (bigints are not JSON-safe). Never coerce a quantity to a JS
// number for anything other than final display rounding.
// ---------------------------------------------------------------------------

/** @typedef {{n: string, d: string}} QuantityJson */

function bgcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Normalise to lowest terms, denominator > 0. */
function normalise(num, den) {
  if (den === 0n) throw new ApiError('malformed_input', 'quantity has a zero denominator');
  if (num === 0n) return { num: 0n, den: 1n };
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = bgcd(num, den);
  return { num: num / g, den: den / g };
}

const RE_INTEGER = /^([+-]?)(\d+)$/;
const RE_DECIMAL = /^([+-]?)(\d*)\.(\d+)$/;
const RE_FRACTION = /^([+-]?)(\d+)\/(\d+)$/;
const RE_MIXED = /^([+-]?)(\d+)[ ]+(\d+)\/(\d+)$/;

/**
 * Build a wire-format quantity `{n, d}` from a user-typed amount. Accepts
 * integers ("2"), decimals ("1.5", ".5"), fractions ("3/4"), and mixed
 * numbers ("1 1/2") — mirrors `domain/src/qty.ts`'s `parseRational` grammar
 * exactly, using BigInt throughout so the client never rounds a quantity
 * through an IEEE float before it reaches the wire.
 * @param {string} text
 * @returns {QuantityJson}
 */
export function buildQuantity(text) {
  const s = String(text).trim();
  let m = RE_INTEGER.exec(s);
  if (m) {
    const sign = m[1] === '-' ? -1n : 1n;
    const { num, den } = normalise(sign * BigInt(m[2]), 1n);
    return { n: num.toString(), d: den.toString() };
  }
  m = RE_DECIMAL.exec(s);
  if (m) {
    const sign = m[1] === '-' ? -1n : 1n;
    const whole = m[2] === '' ? 0n : BigInt(m[2]);
    const frac = m[3];
    const den = 10n ** BigInt(frac.length);
    const { num, den: d } = normalise(sign * (whole * den + BigInt(frac)), den);
    return { n: num.toString(), d: d.toString() };
  }
  m = RE_FRACTION.exec(s);
  if (m) {
    const sign = m[1] === '-' ? -1n : 1n;
    const { num, den } = normalise(sign * BigInt(m[2]), BigInt(m[3]));
    return { n: num.toString(), d: den.toString() };
  }
  m = RE_MIXED.exec(s);
  if (m) {
    const sign = m[1] === '-' ? -1n : 1n;
    const whole = BigInt(m[2]);
    const fnum = BigInt(m[3]);
    const fden = BigInt(m[4]);
    if (fden === 0n) throw new ApiError('malformed_input', `zero denominator in "${text}"`);
    const { num, den } = normalise(sign * (whole * fden + fnum), fden);
    return { n: num.toString(), d: den.toString() };
  }
  throw new ApiError('malformed_input', `"${text}" is not a quantity (try "2", "1.5", "3/4", or "1 1/2")`);
}

/**
 * Format a wire-format quantity `{n, d}` as an exact mixed-number display
 * string ("2", "3/4", "1 1/2") for anything other than final rounded
 * display, and as a rounded decimal string when `maxFracDigits` is given.
 * @param {QuantityJson} q
 * @param {{maxFracDigits?: number}} [opts]
 * @returns {string}
 */
export function formatQuantity(q, opts = {}) {
  const num = BigInt(q.n);
  const den = BigInt(q.d);
  if (opts.maxFracDigits != null) {
    const pow = 10n ** BigInt(opts.maxFracDigits);
    const scaledNum = num * pow;
    // Round to nearest, ties away from zero — display rounding only.
    const half = den / 2n;
    const negative = scaledNum < 0n;
    const magNum = negative ? -scaledNum : scaledNum;
    const rounded = (magNum + half) / den;
    const wholePart = rounded / pow;
    let fracPart = (rounded % pow).toString().padStart(Number(opts.maxFracDigits), '0');
    fracPart = fracPart.replace(/0+$/, '');
    const body = fracPart === '' ? wholePart.toString() : `${wholePart}.${fracPart}`;
    return negative && body !== '0' ? `-${body}` : body;
  }
  if (num === 0n) return '0';
  const negative = num < 0n;
  const magnitude = negative ? -num : num;
  const whole = magnitude / den;
  const rem = magnitude % den;
  let body;
  if (rem === 0n) body = whole.toString();
  else if (whole === 0n) body = `${rem}/${den}`;
  else body = `${whole} ${rem}/${den}`;
  return negative ? `-${body}` : body;
}

// ---------------------------------------------------------------------------
// Routes 1–5 (used this item)
// ---------------------------------------------------------------------------

/** @returns {Promise<{ok: boolean}>} */
export function health() {
  return request('/api/health');
}

/**
 * @typedef {Object} CreateHouseholdRequest
 * @property {{name: string, household_size: number, novelty_preference: 'stick_to_favourites'|'mostly_familiar'|'adventurous', weeknight_active_time_ceiling_seconds: number|null, weeknight_total_time_ceiling_seconds: number|null}} household
 * @property {{display_name: string, dietary_restrictions: string[], allergies: string[], never_recommend_ingredients: string[]}} member
 * @property {{ingredient_id: string, quantity: QuantityJson, unit: string}[]} assumed_staples
 */

/**
 * @param {CreateHouseholdRequest} payload
 * @returns {Promise<{household_id: string}>}
 */
export async function createHousehold(payload) {
  const result = await request('/api/households', { method: 'POST', body: payload });
  setHouseholdId(result.household_id);
  return result;
}

/** @returns {Promise<{household: any, members: any[]}>} */
export function getHousehold() {
  return request('/api/household');
}

/**
 * @param {number} count
 * @returns {Promise<{cards: any[]}>}
 */
export function getCalibrationCards(count) {
  return request(`/api/calibration/cards?count=${encodeURIComponent(count)}`);
}

/**
 * @param {{recipe_id: string, reaction: 'looks_good'|'not_for_me'|'never_recommend'|'too_much_work'}[]} reactions
 * @returns {Promise<{signals_updated: number}>}
 */
export function postCalibrationReactions(reactions) {
  return request('/api/calibration/reactions', { method: 'POST', body: { reactions } });
}

// ---------------------------------------------------------------------------
// Routes 6–15 — not used by onboarding/calibrate, implemented now so later
// screens (plan, grocery, prep, cook, feedback) have a stable surface and
// cannot invent their own fetch calls.
// ---------------------------------------------------------------------------

/**
 * @param {any} payload
 * @returns {Promise<{plan: any}>}
 */
export function createPlan(payload) {
  return request('/api/plans', { method: 'POST', body: payload });
}

/** @returns {Promise<{plan: any}>} */
export function getCurrentPlan() {
  return request('/api/plans/current');
}

/**
 * Offer swap alternatives for one slot, by reason. A `200` with an empty
 * `alternatives` array and a `none_reason`/`message` is a valid, calm
 * response — not an error (frozen contract).
 * @param {string} planId
 * @param {string} slot
 * @param {string} reason
 * @returns {Promise<{alternatives: any[], none_reason?: string, message?: string}>}
 */
export function offerSwap(planId, slot, reason) {
  return request(`/api/plans/${encodeURIComponent(planId)}/meals/${encodeURIComponent(slot)}/swap`, {
    method: 'POST',
    body: { reason },
  });
}

/**
 * @param {string} planId
 * @param {string} slot
 * @param {string} reason
 * @param {string} acceptRecipeId
 * @returns {Promise<{plan: any}>}
 */
export function acceptSwap(planId, slot, reason, acceptRecipeId) {
  return request(`/api/plans/${encodeURIComponent(planId)}/meals/${encodeURIComponent(slot)}/swap`, {
    method: 'POST',
    body: { reason, accept_recipe_id: acceptRecipeId },
  });
}

/**
 * @param {string} planId
 * @returns {Promise<{list: any}>}
 */
export function getGroceryList(planId) {
  return request(`/api/plans/${encodeURIComponent(planId)}/grocery`);
}

/**
 * @param {string} lineId
 * @param {{user_edited_quantity?: QuantityJson|null, checked?: boolean}} patch
 * @returns {Promise<{line: any}>}
 */
export function patchGroceryLine(lineId, patch) {
  return request(`/api/grocery/lines/${encodeURIComponent(lineId)}`, { method: 'PATCH', body: patch });
}

/**
 * @param {string} planId
 * @param {string} slot
 * @returns {Promise<{prep: any}>}
 */
export function getPrepPlan(planId, slot) {
  return request(`/api/plans/${encodeURIComponent(planId)}/meals/${encodeURIComponent(slot)}/prep`);
}

/**
 * @param {{plan_meal_id: string|null, recipe_id: string, target_servings: number}} payload
 * @returns {Promise<{session: any}>}
 */
export function createCookingSession(payload) {
  return request('/api/cooking/sessions', { method: 'POST', body: payload });
}

/**
 * @param {string} sessionId
 * @returns {Promise<{session: any}>}
 */
export function getCookingSession(sessionId) {
  return request(`/api/cooking/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * @param {string} sessionId
 * @param {any} eventPayload - `CookingEventPayload`, frozen in domain/cooking.ts
 * @returns {Promise<{session: any}>}
 */
export function postCookingEvent(sessionId, eventPayload) {
  return request(`/api/cooking/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST',
    body: { payload: eventPayload },
  });
}

/**
 * @param {{plan_meal_id: string, recipe_id: string, verdict: string, reason: string|null}} payload
 * @returns {Promise<{signals_updated: number}>}
 */
export function postFeedback(payload) {
  return request('/api/feedback', { method: 'POST', body: payload });
}
