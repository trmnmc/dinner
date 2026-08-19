/**
 * calibration.ts — the taste-calibration card selector (wave 1B, T-005).
 *
 * The point of this module: card SELECTION is deliberate, not sampled. A
 * greedy marginal-coverage pass repeatedly takes the card that adds the
 * most previously-uncovered (attribute, attribute_value) pairs (see
 * `preferences.ts`'s `attributeValuePairs`) until between
 * `config.min_cards` and `config.max_cards` cards are chosen — maximising
 * attribute SPREAD, never picking at random. Random or fixed-position
 * sampling is exactly the failure mode this module exists to beat
 * (regression-tested in `tests/calibration.test.ts`).
 *
 * Determinism: ties in marginal gain break on recipe id (a stable,
 * lexicographic key) — never `Math.random()`, never insertion order alone.
 * Identical inputs give an identical, byte-equal card list every time.
 *
 * Household signals already confidently known (confidence ≥
 * `config.known_confidence_threshold`) seed the initial "covered" set, so
 * an already-well-calibrated household is steered toward attribute values
 * it does NOT yet confidently know rather than re-asking about ones it
 * does — a graceful behaviour, not a special-cased branch.
 *
 * Degenerate cases handled explicitly (see module tests):
 *   - catalog smaller than `min_cards`: the whole catalog is calibration-
 *     worthy, so every card is returned, deterministically ordered.
 *   - a catalog whose cards all carry identical attributes: after the
 *     first pick every remaining card has zero marginal gain, so the pass
 *     falls back to deterministic (id-order) fill until the target count
 *     is reached — never crashes, never returns fewer than it can.
 *   - an already-well-calibrated household: covered-set seeding seeds full
 *     coverage from confident signals, producing the same zero-gain
 *     fallback behaviour above.
 *
 * Pure domain code: no I/O, no clock, no randomness.
 */

import type { PreferenceAttribute, PreferenceSignal, Recipe, Uuid } from './recipe.ts';
import type { Rational } from './qty.ts';
import { compare, rational } from './qty.ts';
import type { AttributeValuePair } from './preferences.ts';
import { attributeValuePairs } from './preferences.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CalibrationConfig {
  /** Absolute floor on the number of cards selected (SPEC: 8–15). */
  readonly min_cards: number;
  /** Absolute ceiling on the number of cards selected (SPEC: 8–15). */
  readonly max_cards: number;
  /** Preferred count, clamped into [min_cards, max_cards] and further
   * clamped down to the catalog size when the catalog is smaller. */
  readonly target_cards: number;
  /** A signal with confidence at/above this is "already confidently
   * known" and seeds the initial covered set, so selection is steered
   * toward attribute values the household does NOT yet confidently carry
   * an opinion on. */
  readonly known_confidence_threshold: Rational;
}

export const CALIBRATION_CONFIG: CalibrationConfig = {
  min_cards: 8,
  max_cards: 15,
  target_cards: 10,
  known_confidence_threshold: rational(3, 5),
};

// ---------------------------------------------------------------------------
// Coverage bookkeeping
// ---------------------------------------------------------------------------

function attributeKey(attribute: PreferenceAttribute, value: string): string {
  return `${attribute}:${value}`;
}

function distinctPairKeys(pairs: readonly AttributeValuePair[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const p of pairs) set.add(attributeKey(p.attribute, p.attribute_value));
  return set;
}

/** How many of a recipe's DISTINCT attribute-value pairs are NOT already in
 * `covered`. A recipe's own repeated pairs (shouldn't normally occur, but
 * the list axes flavour/texture make it possible) count once. */
function newCoverageCount(recipe: Recipe, covered: ReadonlySet<string>): number {
  let count = 0;
  for (const key of distinctPairKeys(attributeValuePairs(recipe.attributes))) {
    if (!covered.has(key)) count += 1;
  }
  return count;
}

function byId(a: Recipe, b: Recipe): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Deliberately SELECT 8–15 calibration cards to maximise attribute spread:
 * a greedy marginal-coverage pass, never random sampling. See module doc
 * for the degenerate cases and the determinism guarantee.
 */
export function selectCalibrationCards(
  catalog: readonly Recipe[],
  signals: readonly PreferenceSignal[],
  config: CalibrationConfig = CALIBRATION_CONFIG,
): readonly Recipe[] {
  if (catalog.length === 0) return [];

  const sortedCatalog = [...catalog].sort(byId);

  // Degenerate: catalog smaller than (or equal to) the floor — every card
  // is calibration-worthy, take them all, deterministically ordered.
  if (sortedCatalog.length <= config.min_cards) {
    return sortedCatalog;
  }

  const wantCount = Math.min(
    Math.max(config.target_cards, config.min_cards),
    config.max_cards,
    sortedCatalog.length,
  );

  const covered = new Set<string>();
  for (const signal of signals) {
    if (compare(signal.confidence, config.known_confidence_threshold) >= 0) {
      covered.add(attributeKey(signal.attribute, signal.attribute_value));
    }
  }

  const selected: Recipe[] = [];
  const takenIds = new Set<Uuid>();

  while (selected.length < wantCount) {
    let best: Recipe | undefined;
    let bestGain = -1;
    for (const recipe of sortedCatalog) {
      if (takenIds.has(recipe.id)) continue;
      const gain = newCoverageCount(recipe, covered);
      // sortedCatalog is already id-ordered and we replace `best` only on a
      // STRICT improvement, so among equal-gain candidates the lowest id
      // wins — a stable, deterministic tie-break, never insertion order or
      // randomness.
      if (best === undefined || gain > bestGain) {
        best = recipe;
        bestGain = gain;
      }
    }
    if (best === undefined) break;
    selected.push(best);
    takenIds.add(best.id);
    for (const pair of attributeValuePairs(best.attributes)) {
      covered.add(attributeKey(pair.attribute, pair.attribute_value));
    }
  }

  return selected;
}

/**
 * The number of DISTINCT (attribute, attribute_value) pairs present across
 * a set of cards — the coverage metric this module maximises. Exposed so
 * callers (and tests) can compare the selector's spread against a
 * baseline sample without duplicating the counting logic.
 */
export function attributeCoverage(cards: readonly Recipe[]): number {
  const covered = new Set<string>();
  for (const card of cards) {
    for (const pair of attributeValuePairs(card.attributes)) {
      covered.add(attributeKey(pair.attribute, pair.attribute_value));
    }
  }
  return covered.size;
}
