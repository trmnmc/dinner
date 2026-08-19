/**
 * packaging.ts — package selection with surplus math (wave 1A).
 *
 * The contract (SPEC "Domain rules"):
 *   purchase_quantity = the package combination whose total usable yield ≥
 *   purchase_requirement, chosen by minimising (expected waste, package
 *   count) lexicographically when no price data exists. UNDERBUYING IS
 *   PROHIBITED. expected_surplus = total_package_yield − purchase_requirement
 *   (a value RETURNED here; the server writes it to inventory on purchase
 *   confirmation — this module is pure).
 *
 * Underbuying is impossible BY CONSTRUCTION, not by test: every candidate
 * combination the search can emit is a cover, because
 *   (a) in the enumeration, every option count is freely chosen EXCEPT the
 *       last (smallest-yield) option, whose count is DERIVED as
 *       ceil(remaining / yield) via qty.ts `ceilToInt` (rounds toward +∞ —
 *       the single rounding step, at the package boundary), so each leaf
 *       satisfies total ≥ requirement by the ceiling identity; and
 *   (b) the seeded single-option candidates are each ceil(requirement /
 *       yield) packages of one option — covers by the same identity.
 *   There is no code path that constructs a non-covering candidate.
 *
 * Algorithm: bounded exhaustive enumeration with a derived last coordinate.
 *   - Options are sorted deterministically (canonical yield desc, id asc).
 *   - Counts for options 0..k−2 are enumerated from 0 upward; a coordinate
 *     stops as soon as the running partial yield covers the requirement
 *     (any further packages of that option add waste AND count — strictly
 *     dominated), and is capped at min(ceil(R/yield), 24).
 *   - The last coordinate is always derived (never searched), uncapped.
 *   - For any true optimum (m_0..m_{k−1}), the leaf reached via its first
 *     k−1 coordinates derives a last count ≤ m_{k−1}, so the enumeration
 *     always contains a candidate at least as good — the returned choice is
 *     the exact lexicographic minimum of (waste, package count), with two
 *     further deterministic tie-breaks: fewer distinct options, then the
 *     lexicographically smaller count vector.
 *   Complexity: O(k · Π_{i<k−1} (cap_i + 1)) leaves, cap_i ≤ 24, and the
 *   covered-prefix cutoff collapses realistic cases (a handful of curated
 *   package sizes, requirements of a few packages) to tens of leaves.
 *   STATED SIMPLIFYING ASSUMPTION: enumerated (non-derived) coordinates are
 *   capped at 24 packages per option (`MAX_ENUMERATED_PACKAGES_PER_OPTION`).
 *   The cap can only ever cost optimality on absurd inputs, NEVER coverage —
 *   the derived coordinate and the single-option seeds are uncapped.
 *
 * Package data: the curated registry carries no package sizes, so options
 * are caller-supplied `PackageOption`s (curated per ingredient in data, or
 * generic fallbacks like "one bunch" / "one ~2 lb package" / "two 15 oz
 * cans"). A generic fallback is authored with `is_estimate: true`, and any
 * selection touching one is flagged `is_estimate` — labelled an ESTIMATE by
 * the UI, never presented as exact (SPEC taste notes). An option's yield in
 * a different dimension than the requirement converts ONLY through the
 * ingredient's curated density / per-item weight (units.ts); otherwise the
 * option is EXCLUDED with the exact `NotConvertible` refusal — reported,
 * never guessed. No options at all ⇒ the item is sold loose: buy exactly
 * the requirement, zero surplus, no false package precision.
 *
 * All quantity arithmetic goes through qty.ts (Invariant 1 — no bare
 * `+`/`*` on quantity numbers; package counts are integer `Rational`s).
 */

import type { Rational } from './qty.ts';
import {
  ONE,
  QtyError,
  ZERO,
  add,
  ceilToInt,
  compare,
  div,
  eq,
  fromInt,
  min,
  mul,
  sign,
  sub,
  toMixedString,
} from './qty.ts';
import type { UnitDimension } from './recipe.ts';
import type { CanonicalUnit, NotConvertible } from './units.ts';
import { CANONICAL_UNIT_BY_DIMENSION, convertAmount, toCanonical, unitDimension } from './units.ts';
import type { IngredientRegistryEntry, PackageOption } from './catalog.ts';

// `PackageOption` now lives in catalog.ts — it is registry-owned curated
// data (`data/ingredients.json` → `parseIngredientRegistry`) exactly like
// `density_g_per_ml` / `per_item_weight_g`, not something this module
// invents. Re-exported here so existing `from './packaging.ts'` imports
// (this file's own tests included) keep working unchanged.
export type { PackageOption } from './catalog.ts';

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

export interface ChosenPackage {
  readonly option: PackageOption;
  /** How many of this package to buy: a positive integer Rational. */
  readonly count: Rational;
  /** count × one-package yield, in the requirement's canonical unit. */
  readonly total_yield: Rational;
}

/** An option whose yield cannot be expressed in the requirement's dimension
 * without a missing curated value. Reported, never guessed. */
export interface ExcludedPackageOption {
  readonly option_id: string;
  readonly refusal: NotConvertible;
}

export type PackageSelection =
  | {
      /** purchase_requirement ≤ 0: fully stocked, nothing is bought. */
      readonly kind: 'none_needed';
      readonly unit: CanonicalUnit;
      readonly purchase_requirement: Rational; // ZERO
      readonly total_yield: Rational; // ZERO
      readonly expected_surplus: Rational; // ZERO
      readonly package_description: null;
      readonly is_estimate: false;
      readonly excluded_options: readonly ExcludedPackageOption[];
    }
  | {
      /** No usable package data: sold loose, buy exactly the requirement.
       * `package_description: null` per the frozen GroceryLine contract. */
      readonly kind: 'loose';
      readonly unit: CanonicalUnit;
      readonly purchase_requirement: Rational;
      readonly total_yield: Rational; // = purchase_requirement, exactly
      readonly expected_surplus: Rational; // ZERO
      readonly package_description: null;
      readonly is_estimate: false;
      readonly excluded_options: readonly ExcludedPackageOption[];
    }
  | {
      readonly kind: 'packages';
      readonly unit: CanonicalUnit;
      readonly purchase_requirement: Rational;
      /** Non-empty; deterministic order (canonical yield desc, id asc). */
      readonly packages: readonly ChosenPackage[];
      /** Total number of packages across all options (integer Rational). */
      readonly package_count: Rational;
      /** Σ package yields. ALWAYS ≥ purchase_requirement. */
      readonly total_yield: Rational;
      /** total_yield − purchase_requirement. Never negative. */
      readonly expected_surplus: Rational;
      /** e.g. "two 15 oz cans", "one 400 g pack + two 15 oz cans". */
      readonly package_description: string;
      /** True iff any chosen package option is a generic-fallback estimate. */
      readonly is_estimate: boolean;
      readonly excluded_options: readonly ExcludedPackageOption[];
    };

/** Cap on ENUMERATED per-option counts (the stated simplifying assumption).
 * The derived last coordinate and the single-option seeds are uncapped, so
 * coverage never depends on this — only optimality on absurd inputs. */
export const MAX_ENUMERATED_PACKAGES_PER_OPTION: Rational = fromInt(24);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** An option with its one-package yield in the requirement's canonical unit. */
interface UsableOption {
  readonly option: PackageOption;
  readonly canonical_yield: Rational;
}

interface Candidate {
  /** Per-usable-option package counts (integer Rationals), aligned with the
   * deterministic usable-option order. */
  readonly counts: readonly Rational[];
  readonly total_yield: Rational;
  readonly package_count: Rational;
  readonly distinct_options: Rational;
}

/** True iff `a` is strictly better than `b`: lexicographic on
 * (waste, package count, distinct options, count vector). Both candidates
 * cover the same requirement, so comparing total yield IS comparing waste. */
function strictlyBetter(a: Candidate, b: Candidate): boolean {
  const w = compare(a.total_yield, b.total_yield);
  if (w !== 0) return w < 0;
  const c = compare(a.package_count, b.package_count);
  if (c !== 0) return c < 0;
  const d = compare(a.distinct_options, b.distinct_options);
  if (d !== 0) return d < 0;
  for (const [i, countA] of a.counts.entries()) {
    const countB = b.counts[i] ?? ZERO;
    const l = compare(countA, countB);
    if (l !== 0) return l < 0;
  }
  return false;
}

const COUNT_WORDS: Readonly<Record<string, string>> = {
  '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six',
  '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten', '11': 'eleven', '12': 'twelve',
};

function countWord(count: Rational): string {
  const digits = toMixedString(count);
  return COUNT_WORDS[digits] ?? digits;
}

function describe(packages: readonly ChosenPackage[]): string {
  return packages
    .map((p) =>
      eq(p.count, ONE)
        ? `one ${p.option.label_singular}`
        : `${countWord(p.count)} ${p.option.label_plural}`,
    )
    .join(' + ');
}

/**
 * Choose the package combination for one purchase requirement.
 *
 * `purchaseRequirement` is `NetRequirementLine.purchase_requirement`
 * (inventoryMath.ts), in the canonical unit of `dimension`; a non-positive
 * value returns `none_needed`. `entry` is the ingredient's registry entry,
 * consulted ONLY when an option's yield is in a different dimension.
 *
 * Deterministic (option input order never matters), always covering, and
 * exact — the only rounding is the package-count ceiling. Throws a typed
 * `QtyError` on a non-positive option yield (curated-data defect, loud).
 */
export function selectPackages(
  purchaseRequirement: Rational,
  dimension: UnitDimension,
  options: readonly PackageOption[],
  entry: IngredientRegistryEntry,
): PackageSelection {
  const unit = CANONICAL_UNIT_BY_DIMENSION[dimension];

  // Validate and canonicalise every option's yield up front (a malformed
  // curated option is a defect even when nothing needs buying).
  const usable: UsableOption[] = [];
  const excluded: ExcludedPackageOption[] = [];
  for (const option of options) {
    if (sign(option.yield_amount) !== 1) {
      throw new QtyError(
        'malformed_input',
        `package option '${option.id}' must have a positive yield`,
      );
    }
    if (unitDimension(option.yield_unit) === dimension) {
      usable.push({ option, canonical_yield: toCanonical(option.yield_amount, option.yield_unit).amount });
    } else {
      const converted = convertAmount(option.yield_amount, option.yield_unit, dimension, entry);
      if (converted.kind === 'not_convertible') {
        excluded.push({ option_id: option.id, refusal: converted });
      } else {
        usable.push({ option, canonical_yield: converted.amount });
      }
    }
  }
  excluded.sort((a, b) => compareStrings(a.option_id, b.option_id));

  if (sign(purchaseRequirement) !== 1) {
    return {
      kind: 'none_needed',
      unit,
      purchase_requirement: ZERO,
      total_yield: ZERO,
      expected_surplus: ZERO,
      package_description: null,
      is_estimate: false,
      excluded_options: excluded,
    };
  }

  if (usable.length === 0) {
    return {
      kind: 'loose',
      unit,
      purchase_requirement: purchaseRequirement,
      total_yield: purchaseRequirement,
      expected_surplus: ZERO,
      package_description: null,
      is_estimate: false,
      excluded_options: excluded,
    };
  }

  // Deterministic search order: canonical yield descending, then id.
  usable.sort(
    (a, b) =>
      compare(b.canonical_yield, a.canonical_yield) ||
      compareStrings(a.option.id, b.option.id),
  );
  const requirement = purchaseRequirement;
  const yields = usable.map((u) => u.canonical_yield);
  const caps = yields.map((y) => min(fromInt(ceilToInt(div(requirement, y))), MAX_ENUMERATED_PACKAGES_PER_OPTION));
  const lastIndex = usable.length - 1;

  let best: Candidate | null = null;
  const consider = (counts: readonly Rational[]): void => {
    let total = ZERO;
    let packageCount = ZERO;
    let distinct = ZERO;
    for (const [i, y] of yields.entries()) {
      const count = counts[i] ?? ZERO;
      if (sign(count) === 1) {
        total = add(total, mul(count, y));
        packageCount = add(packageCount, count);
        distinct = add(distinct, ONE);
      }
    }
    // Every constructed candidate covers (see module docs); this guard is
    // defence in depth on the prohibition, not the mechanism.
    if (compare(total, requirement) < 0) return;
    const candidate: Candidate = {
      counts: [...counts],
      total_yield: total,
      package_count: packageCount,
      distinct_options: distinct,
    };
    if (best === null || strictlyBetter(candidate, best)) best = candidate;
  };

  const counts: Rational[] = yields.map(() => ZERO);
  const enumerate = (i: number, partial: Rational): void => {
    if (i === lastIndex) {
      // The DERIVED coordinate: ceil(remaining / yield), uncapped — every
      // leaf is a cover by the ceiling identity. Never searched.
      const remaining = sub(requirement, partial);
      const y = yields[i];
      if (y === undefined) return; // unreachable; typing
      counts[i] = sign(remaining) === 1 ? fromInt(ceilToInt(div(remaining, y))) : ZERO;
      consider(counts);
      counts[i] = ZERO;
      return;
    }
    const y = yields[i];
    const cap = caps[i];
    if (y === undefined || cap === undefined) return; // unreachable; typing
    for (let n = ZERO; compare(n, cap) <= 0; n = add(n, ONE)) {
      counts[i] = n;
      const next = add(partial, mul(n, y));
      enumerate(i + 1, next);
      // Once this prefix covers, more of option i adds waste AND count —
      // strictly dominated by the leaf just visited. Stop.
      if (compare(next, requirement) >= 0) break;
    }
    counts[i] = ZERO;
  };
  enumerate(0, ZERO);

  // Uncapped single-option seeds: ceil(R / yield) of each option alone.
  // Guarantees a covering candidate exists even where the enumeration caps
  // bite, and costs O(k).
  for (const [i, y] of yields.entries()) {
    const seed = yields.map(() => ZERO);
    seed[i] = fromInt(ceilToInt(div(requirement, y)));
    consider(seed);
  }

  // A cover always exists (the all-zero-prefix leaf derives one), so `best`
  // is non-null here. (The widening annotation exists because TS control
  // flow does not track assignments made inside the search closures.)
  const chosen = best as Candidate | null;
  if (chosen === null) {
    throw new QtyError('malformed_input', 'package search produced no covering candidate'); // unreachable
  }

  const packages: ChosenPackage[] = [];
  for (const [i, u] of usable.entries()) {
    const count = chosen.counts[i] ?? ZERO;
    if (sign(count) === 1) {
      packages.push({ option: u.option, count, total_yield: mul(count, u.canonical_yield) });
    }
  }

  return {
    kind: 'packages',
    unit,
    purchase_requirement: requirement,
    packages,
    package_count: chosen.package_count,
    total_yield: chosen.total_yield,
    expected_surplus: sub(chosen.total_yield, requirement),
    package_description: describe(packages),
    is_estimate: packages.some((p) => p.option.is_estimate),
    excluded_options: excluded,
  };
}
