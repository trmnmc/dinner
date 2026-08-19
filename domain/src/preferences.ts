/**
 * preferences.ts — the attribute-level preference model (wave 1B, T-005).
 *
 * Every calibration reaction and every post-meal feedback event is turned
 * into a set of `PreferenceSignalUpdate`s, one per (attribute,
 * attribute_value) pair on the recipe's `AttributeVector` — protein,
 * cuisine, flavour (one per tag), texture (one per tag), spice, richness,
 * method, effort. There is never one opaque score: a card that "looks good"
 * moves eight-or-more distinct attribute signals, not a single number.
 *
 * Asymmetry (SPEC, and the recipe.ts doc comment on `PreferenceSignal`:
 * "Negative signals are weighted more strongly and decay slower than weak
 * positives") is a first-class, injectable config object of Rationals —
 * `PREFERENCE_ASYMMETRY_CONFIG` — never an inline literal. Every reaction
 * and verdict is expressed as an UNSIGNED "raw" magnitude plus a sign; the
 * config's `negative_value_multiplier` / `negative_confidence_gain` are
 * strictly larger than their positive counterparts, so an equally-sized
 * negative and positive event provably produce different deltas (tested).
 *
 * `never_recommend` is special-cased to the extremes (value −1, confidence
 * 1, durability 'durable') — a deliberate, immediate lock, not merely a
 * strong dislike that happens to cross the hard-exclusion threshold — but
 * ONLY on the card's DISTINCTIVE axes (`never_recommend_lock_attributes`:
 * protein, cuisine). Because filters.ts's `strong_dislike` hard
 * exclusion fires on ANY signal with value ≤ −4/5 and confidence ≥ 1/2
 * (see HARD_FILTER_CONFIG), each locked signal is structurally guaranteed
 * to feed that exclusion the moment it is merged in. The GENERIC axes
 * (flavour, texture, spice, richness, method, effort) instead receive an
 * ordinary strong negative through the raw/multiplier path — durable, and
 * strictly stronger than `not_for_me` — whose single-event confidence sits
 * BELOW the hard filter's confidence gate. This scoping is the fix for a
 * measured interaction defect (KI-5, both halves): writing the lock to
 * every axis made each generic value (richness=rich, effort=high,
 * method=stir_fry, spice=hot, …) an independent absolute veto, and ONE tap
 * on one card hard-excluded most of a catalog that shared none of the
 * card's distinctive character. Flavour left the lock set last (the second
 * half of KI-5): `FlavourTag` contains generic members ('savoury', 'mild',
 * 'fresh') that a realistic catalog puts on most dinners, so locking
 * flavour let one tap on a savoury card veto the savoury majority — the
 * measured probe saw 3/12 survivors with flavour locked vs 10/12 without,
 * with shared-protein and shared-cuisine kin still correctly excluded.
 * Generic axes still learn from the tap; corroborating negative evidence
 * can still push them across the hard-exclusion threshold later, exactly
 * as repeated `not_again` feedback already can.
 *
 * A `reason` (feedback) or the `too_much_work` calibration reaction narrows
 * an EXTRA boost onto specific attribute(s) — effort, spice, richness — on
 * top of the broad base update every event still applies across the whole
 * vector. The boost reinforces whatever direction the base event already
 * signals; it never flips polarity. `easy_with_interruptions` has no
 * attribute-axis mapping (interruption-friendliness is the `score.ts`
 * `context_interruption` component, not one of the eight preference axes)
 * and so contributes no boost — documented judgement call, not an omission.
 *
 * Merging (`mergeSignal`) is where the real logic lives: confidence
 * combines via a saturating "independent evidence" rule
 * (c' = 1 − (1−c0)(1−c1)) so confidence only rises and a maximal-confidence
 * signal (never_recommend) stays locked at confidence 1 forever after.
 * Value merges as a confidence-weighted average of the existing and
 * incoming values, so a high-confidence existing signal resists — but is
 * not literally immune to — being eroded by many weaker countervailing
 * events. Durability only ever moves up the transient < seasonal < durable
 * ladder, never down.
 *
 * Pure domain code: no I/O, no clock reads. `mergeSignal` takes `now` and
 * the row `id` to use for a brand-new signal as explicit parameters —
 * identity/timestamp allocation is the caller's (server-layer) concern, not
 * this module's; a pure function cannot mint a UUID or read the clock
 * itself. Every persisted value is an exact `Rational` (Invariant 1); no
 * float ever touches `value` or `confidence`.
 */

import type {
  AttributeVector,
  CalibrationReaction,
  FeedbackReason,
  FeedbackVerdict,
  IsoUtcInstant,
  PreferenceAttribute,
  PreferenceSignal,
  Recipe,
  SignalDurability,
  SignalSource,
  Uuid,
} from './recipe.ts';
import type { Rational } from './qty.ts';
import { ONE, ZERO, add, compare, div, isZero, max, min, mul, neg, rational, sub } from './qty.ts';

// ---------------------------------------------------------------------------
// Configuration — the ONE object carrying every asymmetry amount, as exact
// Rationals. A later item pins these literals against drift; nothing here
// may be inlined elsewhere in this module.
// ---------------------------------------------------------------------------

export interface PreferenceAsymmetryConfig {
  /** Multiplies the raw magnitude of a POSITIVE event's value delta.
   * Kept at exactly 1 so `negative_value_multiplier` below is the whole,
   * visible-in-one-place source of the value asymmetry. */
  readonly positive_value_multiplier: Rational;
  /** Multiplies the raw magnitude of a NEGATIVE event's value delta.
   * Strictly greater than `positive_value_multiplier` — a negative event of
   * the SAME raw magnitude as a positive one moves value further (SPEC). */
  readonly negative_value_multiplier: Rational;
  /** Confidence a POSITIVE event contributes on merge. */
  readonly positive_confidence_gain: Rational;
  /** Confidence a NEGATIVE event contributes on merge. Strictly greater
   * than `positive_confidence_gain` — negative signals reach higher
   * confidence FASTER than an equally-sized weak positive (SPEC). */
  readonly negative_confidence_gain: Rational;

  /** Raw (unsigned) magnitude of a single `looks_good` reaction. */
  readonly looks_good_raw_value: Rational;
  /** Raw magnitude of a single `not_for_me` reaction — deliberately equal
   * to `looks_good_raw_value` so the multiplier above is the entire proof
   * of asymmetry, not a difference smuggled into the raw amounts. */
  readonly not_for_me_raw_value: Rational;
  /** `never_recommend` is a deliberate lock, not a scaled reaction: exact
   * value it writes (−1) — to the lock attributes ONLY (see
   * `never_recommend_lock_attributes`). */
  readonly never_recommend_value: Rational;
  /** Exact confidence `never_recommend` writes (1, i.e. maximal) — to the
   * lock attributes ONLY. */
  readonly never_recommend_confidence: Rational;
  /** The DISTINCTIVE axes that receive `never_recommend`'s absolute lock.
   * Every axis NOT listed here (the generic axes: flavour, texture, spice,
   * richness, method, effort) receives an ordinary strong negative via the
   * raw/multiplier path instead (`never_recommend_generic_raw_value`), so a
   * single tap cannot turn each generic attribute value into an independent
   * absolute hard-filter veto (the measured interaction defect with
   * filters.ts's `strong_dislike` exclusion — see module doc; flavour is
   * generic here because `FlavourTag` carries catalog-wide members like
   * 'savoury'). */
  readonly never_recommend_lock_attributes: readonly PreferenceAttribute[];
  /** Raw (unsigned) magnitude `never_recommend` applies to every NON-lock
   * (generic) axis through the ordinary raw/multiplier path. At or above
   * `durable_raw_threshold`, so the generic signals are still durable and
   * strictly stronger than `not_for_me` — a meaningful strong negative, not
   * a toothless one. Its single-event confidence is the ordinary
   * `negative_confidence_gain`, which sits below
   * HARD_FILTER_CONFIG.strong_dislike_confidence_min by design. */
  readonly never_recommend_generic_raw_value: Rational;
  /** Raw magnitude of a single `too_much_work` calibration reaction
   * (before its `effort` boost — see module doc). */
  readonly too_much_work_raw_value: Rational;

  /** Raw magnitude of a single `make_again` feedback verdict. */
  readonly make_again_raw_value: Rational;
  /** Raw magnitude of a single `it_was_fine` feedback verdict — treated as
   * a weak positive (SPEC framing: "weak positives"). */
  readonly it_was_fine_raw_value: Rational;
  /** Raw magnitude of a single `not_again` feedback verdict — deliberately
   * equal to `make_again_raw_value`, for the same reason as
   * `not_for_me_raw_value` above. */
  readonly not_again_raw_value: Rational;

  /** Extra raw magnitude a matched feedback reason (or the `too_much_work`
   * calibration reaction) adds, signed with and on top of the base event,
   * to ONLY the attribute(s) it targets. */
  readonly reason_boost_raw_value: Rational;

  /** Raw-magnitude floor at/above which an event's durability escalates
   * (positive: transient → seasonal; negative: seasonal → durable). */
  readonly durable_raw_threshold: Rational;
}

/** THE asymmetry config (SPEC "named, exported, injectable config object
 * of Rationals — not inline literals scattered through the code"). */
export const PREFERENCE_ASYMMETRY_CONFIG: PreferenceAsymmetryConfig = {
  positive_value_multiplier: rational(1),
  negative_value_multiplier: rational(3, 2),
  positive_confidence_gain: rational(1, 5),
  negative_confidence_gain: rational(2, 5),

  looks_good_raw_value: rational(2, 5),
  not_for_me_raw_value: rational(2, 5),
  never_recommend_value: rational(-1),
  never_recommend_confidence: rational(1),
  never_recommend_lock_attributes: ['protein', 'cuisine'],
  never_recommend_generic_raw_value: rational(3, 5),
  too_much_work_raw_value: rational(3, 5),

  make_again_raw_value: rational(3, 5),
  it_was_fine_raw_value: rational(1, 10),
  not_again_raw_value: rational(3, 5),

  reason_boost_raw_value: rational(1, 5),

  durable_raw_threshold: rational(3, 5),
};

/** A feedback `reason`'s (or `too_much_work`'s) targeted attribute(s); an
 * empty list means the reason has no attribute-axis mapping and applies no
 * boost (documented judgement call — see module doc for
 * `easy_with_interruptions`). */
const REASON_ATTRIBUTE_TARGETS: Readonly<Record<FeedbackReason, readonly PreferenceAttribute[]>> = {
  too_much_work: ['effort'],
  took_longer_than_expected: ['effort'],
  too_bland: ['spice'],
  too_spicy: ['spice'],
  easy_with_interruptions: [],
  not_filling: ['richness'],
};

// ---------------------------------------------------------------------------
// Attribute-value pairs derived from a recipe's vector — the "eight
// attributes", expanded (flavour/texture contribute one pair per tag).
// ---------------------------------------------------------------------------

export interface AttributeValuePair {
  readonly attribute: PreferenceAttribute;
  readonly attribute_value: string;
}

/** Every (attribute, attribute_value) pair implied by a recipe's
 * `AttributeVector`, in a fixed, deterministic order: the six single-valued
 * axes first (protein, cuisine, spice, richness, method, effort), then
 * flavour tags in vector order, then texture tags in vector order. */
export function attributeValuePairs(attributes: AttributeVector): readonly AttributeValuePair[] {
  const pairs: AttributeValuePair[] = [
    { attribute: 'protein', attribute_value: attributes.protein },
    { attribute: 'cuisine', attribute_value: attributes.cuisine },
    { attribute: 'spice', attribute_value: attributes.spice },
    { attribute: 'richness', attribute_value: attributes.richness },
    { attribute: 'method', attribute_value: attributes.method },
    { attribute: 'effort', attribute_value: attributes.effort },
  ];
  for (const f of attributes.flavour) pairs.push({ attribute: 'flavour', attribute_value: f });
  for (const t of attributes.texture) pairs.push({ attribute: 'texture', attribute_value: t });
  return pairs;
}

// ---------------------------------------------------------------------------
// The signal update an event implies — not yet a persisted PreferenceSignal
// (no id, no household_id, no updated_at_utc: those are `mergeSignal`'s
// job, using caller-supplied identity and instant).
// ---------------------------------------------------------------------------

export interface PreferenceSignalUpdate {
  readonly member_id: Uuid | null;
  readonly attribute: PreferenceAttribute;
  readonly attribute_value: string;
  /** This single event's contribution, already clamped to [−1, 1]. */
  readonly value: Rational;
  /** This single event's confidence contribution, already clamped to [0, 1]. */
  readonly confidence: Rational;
  readonly durability: SignalDurability;
  readonly source: SignalSource;
}

const NEG_ONE: Rational = rational(-1);

function clampValue(v: Rational): Rational {
  return max(NEG_ONE, min(ONE, v));
}

function clampConfidence(v: Rational): Rational {
  return max(ZERO, min(ONE, v));
}

interface RawEvent {
  readonly value: Rational;
  readonly confidence: Rational;
  readonly durability: SignalDurability;
}

/**
 * Turn a signed raw magnitude into a clamped value/confidence/durability
 * triple via the asymmetry config. `evSign` is the event's direction; `raw`
 * is its UNSIGNED magnitude (before the sign and the multiplier apply).
 */
function computeEvent(evSign: 1 | -1, raw: Rational, config: PreferenceAsymmetryConfig): RawEvent {
  const multiplier = evSign === 1 ? config.positive_value_multiplier : config.negative_value_multiplier;
  const magnitude = mul(raw, multiplier);
  const value = clampValue(evSign === 1 ? magnitude : neg(magnitude));
  const confidence = clampConfidence(
    evSign === 1 ? config.positive_confidence_gain : config.negative_confidence_gain,
  );
  const strong = compare(raw, config.durable_raw_threshold) >= 0;
  const durability: SignalDurability =
    evSign === 1 ? (strong ? 'seasonal' : 'transient') : strong ? 'durable' : 'seasonal';
  return { value, confidence, durability };
}

/** The signed extra magnitude a matched boost target adds, on top of the
 * base event, to the attribute(s) it targets. */
function boostDelta(evSign: 1 | -1, config: PreferenceAsymmetryConfig): Rational {
  const multiplier = evSign === 1 ? config.positive_value_multiplier : config.negative_value_multiplier;
  const magnitude = mul(config.reason_boost_raw_value, multiplier);
  return evSign === 1 ? magnitude : neg(magnitude);
}

function buildUpdates(
  pairs: readonly AttributeValuePair[],
  memberId: Uuid | null,
  ev: RawEvent,
  boostAttrs: readonly PreferenceAttribute[],
  evSign: 1 | -1,
  config: PreferenceAsymmetryConfig,
  source: SignalSource,
): readonly PreferenceSignalUpdate[] {
  const boost = boostAttrs.length > 0 ? boostDelta(evSign, config) : ZERO;
  return pairs.map((p) => ({
    member_id: memberId,
    attribute: p.attribute,
    attribute_value: p.attribute_value,
    value: boostAttrs.includes(p.attribute) ? clampValue(add(ev.value, boost)) : ev.value,
    confidence: ev.confidence,
    durability: ev.durability,
    source,
  }));
}

// ---------------------------------------------------------------------------
// Calibration reactions
// ---------------------------------------------------------------------------

export interface ApplyCalibrationReactionInput {
  readonly recipe: Recipe;
  /** null = household-level signal (no specific member). */
  readonly member_id: Uuid | null;
  readonly reaction: CalibrationReaction;
  readonly config?: PreferenceAsymmetryConfig;
}

/**
 * A single calibration-card reaction, expanded into the set of
 * `PreferenceSignalUpdate`s it implies across every attribute-value pair on
 * the card's `AttributeVector`. `too_much_work` additionally boosts
 * `effort` (see module doc); `never_recommend` writes the extreme lock
 * value/confidence directly — but only to the distinctive
 * `never_recommend_lock_attributes` — while the generic axes receive an
 * ordinary strong durable negative via the raw/multiplier path (see the
 * module doc for the interaction defect this scoping fixes).
 */
export function applyCalibrationReaction(
  input: ApplyCalibrationReactionInput,
): readonly PreferenceSignalUpdate[] {
  const config = input.config ?? PREFERENCE_ASYMMETRY_CONFIG;
  const pairs = attributeValuePairs(input.recipe.attributes);
  switch (input.reaction) {
    case 'looks_good': {
      const ev = computeEvent(1, config.looks_good_raw_value, config);
      return buildUpdates(pairs, input.member_id, ev, [], 1, config, 'calibration');
    }
    case 'not_for_me': {
      const ev = computeEvent(-1, config.not_for_me_raw_value, config);
      return buildUpdates(pairs, input.member_id, ev, [], -1, config, 'calibration');
    }
    case 'never_recommend': {
      // The absolute lock — reserved for the card's DISTINCTIVE axes.
      const lockEv: RawEvent = {
        value: clampValue(config.never_recommend_value),
        confidence: clampConfidence(config.never_recommend_confidence),
        durability: 'durable',
      };
      // The generic axes get an ordinary strong negative: durable and
      // stronger than not_for_me, but with the ordinary single-event
      // confidence, so ONE tap cannot make every generic attribute value
      // an independent absolute hard-filter veto (see module doc).
      const genericEv = computeEvent(-1, config.never_recommend_generic_raw_value, config);
      return pairs.map((p) => {
        const ev = config.never_recommend_lock_attributes.includes(p.attribute) ? lockEv : genericEv;
        return {
          member_id: input.member_id,
          attribute: p.attribute,
          attribute_value: p.attribute_value,
          value: ev.value,
          confidence: ev.confidence,
          durability: ev.durability,
          source: 'calibration' as const,
        };
      });
    }
    case 'too_much_work': {
      const ev = computeEvent(-1, config.too_much_work_raw_value, config);
      return buildUpdates(pairs, input.member_id, ev, ['effort'], -1, config, 'calibration');
    }
    default: {
      const exhaustive: never = input.reaction;
      throw new Error(`unhandled calibration reaction: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Post-meal feedback
// ---------------------------------------------------------------------------

export interface ApplyFeedbackEventInput {
  readonly recipe: Recipe;
  readonly member_id: Uuid | null;
  readonly verdict: FeedbackVerdict;
  /** At most one optional reason (SPEC). */
  readonly reason: FeedbackReason | null;
  readonly config?: PreferenceAsymmetryConfig;
}

/**
 * A single post-meal feedback event, expanded the same way as a calibration
 * reaction. A present `reason` boosts its mapped attribute(s) (see
 * `REASON_ATTRIBUTE_TARGETS`) in the SAME direction as the base verdict —
 * it sharpens what the feedback is about, it never flips polarity.
 */
export function applyFeedbackEvent(input: ApplyFeedbackEventInput): readonly PreferenceSignalUpdate[] {
  const config = input.config ?? PREFERENCE_ASYMMETRY_CONFIG;
  const pairs = attributeValuePairs(input.recipe.attributes);
  const boostAttrs = input.reason !== null ? REASON_ATTRIBUTE_TARGETS[input.reason] : [];

  let ev: RawEvent;
  let evSign: 1 | -1;
  switch (input.verdict) {
    case 'make_again':
      evSign = 1;
      ev = computeEvent(evSign, config.make_again_raw_value, config);
      break;
    case 'it_was_fine':
      evSign = 1;
      ev = computeEvent(evSign, config.it_was_fine_raw_value, config);
      break;
    case 'not_again':
      evSign = -1;
      ev = computeEvent(evSign, config.not_again_raw_value, config);
      break;
    default: {
      const exhaustive: never = input.verdict;
      throw new Error(`unhandled feedback verdict: ${String(exhaustive)}`);
    }
  }
  return buildUpdates(pairs, input.member_id, ev, boostAttrs, evSign, config, 'feedback');
}

// ---------------------------------------------------------------------------
// Merging — confidence-weighted, honest about durability
// ---------------------------------------------------------------------------

const DURABILITY_RANK: Readonly<Record<SignalDurability, number>> = {
  transient: 0,
  seasonal: 1,
  durable: 2,
};

/** The more durable of the two — durability only ever moves up the
 * transient < seasonal < durable ladder, never down. */
function moreDurable(a: SignalDurability, b: SignalDurability): SignalDurability {
  return DURABILITY_RANK[a] >= DURABILITY_RANK[b] ? a : b;
}

export interface MergeSignalInput {
  /** The stored signal for this exact (member, attribute, attribute_value),
   * or null when none exists yet. */
  readonly existing: PreferenceSignal | null;
  readonly update: PreferenceSignalUpdate;
  readonly household_id: Uuid;
  /** Id to use when `existing` is null. Ignored (the existing row's id is
   * kept) otherwise. Pure code cannot mint a UUID itself — the caller
   * supplies it. */
  readonly id: Uuid;
  /** The instant to stamp `updated_at_utc` with — pure code cannot read a
   * clock (DESIGN.md). */
  readonly now: IsoUtcInstant;
}

/**
 * Merge a `PreferenceSignalUpdate` into the existing stored signal for the
 * same (member, attribute, attribute_value) — or create a fresh one.
 *
 * Confidence combines via a saturating "independent evidence" rule,
 * `c' = 1 − (1 − c0)(1 − c1)`: confidence only ever rises, and once a
 * signal reaches confidence 1 (e.g. from `never_recommend`) it STAYS at 1
 * through every future merge, because `(1 − 1) = 0` regardless of the
 * incoming confidence.
 *
 * Value merges as the confidence-weighted average of the existing and
 * incoming values (weights = each side's OWN confidence, not the combined
 * one) — so a confidence-1 existing value dominates a lower-confidence
 * incoming one heavily, but is not literally frozen: enough repeated
 * countervailing evidence can still move it. This is a deliberate
 * modelling choice (durable ≠ permanently unmovable) — see module doc.
 *
 * Durability only ever moves up (`moreDurable`), never down.
 */
export function mergeSignal(input: MergeSignalInput): PreferenceSignal {
  const { existing, update, household_id, id, now } = input;

  if (
    existing !== null &&
    (existing.member_id !== update.member_id ||
      existing.attribute !== update.attribute ||
      existing.attribute_value !== update.attribute_value)
  ) {
    throw new Error(
      `mergeSignal: existing signal (member ${String(existing.member_id)}, ${existing.attribute}:${existing.attribute_value}) does not identify the same (member, attribute, attribute_value) as the update (member ${String(update.member_id)}, ${update.attribute}:${update.attribute_value})`,
    );
  }

  const incomingValue = clampValue(update.value);
  const incomingConfidence = clampConfidence(update.confidence);

  if (existing === null) {
    return {
      id,
      household_id,
      member_id: update.member_id,
      attribute: update.attribute,
      attribute_value: update.attribute_value,
      value: incomingValue,
      confidence: incomingConfidence,
      durability: update.durability,
      source: update.source,
      updated_at_utc: now,
    };
  }

  const c0 = existing.confidence;
  const c1 = incomingConfidence;
  const confidence = clampConfidence(sub(ONE, mul(sub(ONE, c0), sub(ONE, c1))));
  const weightSum = add(c0, c1);
  const value = isZero(weightSum)
    ? incomingValue
    : clampValue(div(add(mul(existing.value, c0), mul(incomingValue, c1)), weightSum));
  const durability = moreDurable(existing.durability, update.durability);

  return {
    id: existing.id,
    household_id,
    member_id: update.member_id,
    attribute: update.attribute,
    attribute_value: update.attribute_value,
    value,
    confidence,
    durability,
    source: update.source,
    updated_at_utc: now,
  };
}
