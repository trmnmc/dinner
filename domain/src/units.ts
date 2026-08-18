/**
 * units.ts — exact unit conversion (wave 1A).
 *
 * Same-dimension conversion is TOTAL and EXACT: every mass unit converts to
 * grams, every volume unit to millilitres, count to count, through exact
 * Rational factors (Invariant 1 — qty.ts is the only arithmetic entry point;
 * no float ever touches a conversion). 1 tsp = 4.92892159375 ml is expressed
 * as the exact fraction 492892159375/100000000000, never as a JS number.
 *
 * Cross-dimension conversion (volume↔mass, count↔mass, volume↔count) is
 * possible ONLY through a curated `density_g_per_ml` or `per_item_weight_g`
 * on the ingredient's registry entry (`domain/src/catalog.ts`, sourced from
 * `data/ingredients.json` — the single source of truth). When the curated
 * value is absent (null) the result is an explicit typed `not_convertible`
 * member of a discriminated union naming the ingredient, both dimensions,
 * and exactly which curated fields are missing — NEVER a guessed density,
 * never a silent fallback, never an exception a caller could swallow.
 *
 * "To taste" is a distinct non-numeric state (recipe.ts contract) and passes
 * through conversion untouched — it is never folded into a number. Ranges
 * keep min and max and convert each bound INDEPENDENTLY, never a midpoint.
 */

import type { Rational } from './qty.ts';
import { ONE, div, mul, rational } from './qty.ts';
import type { IngredientId, IngredientQuantity, Unit, UnitDimension } from './recipe.ts';
import type { IngredientRegistryEntry } from './catalog.ts';

// ---------------------------------------------------------------------------
// Dimensions and canonical base units
// ---------------------------------------------------------------------------

/** The canonical base unit of each dimension (SPEC "Domain rules"). */
export type CanonicalUnit = 'g' | 'ml' | 'count';

export const CANONICAL_UNIT_BY_DIMENSION: Readonly<Record<UnitDimension, CanonicalUnit>> = {
  mass: 'g',
  volume: 'ml',
  count: 'count',
};

/** Dimension of every unit in the frozen `Unit` union — total by Record. */
export const UNIT_DIMENSIONS: Readonly<Record<Unit, UnitDimension>> = {
  g: 'mass',
  kg: 'mass',
  oz: 'mass',
  lb: 'mass',
  ml: 'volume',
  l: 'volume',
  tsp: 'volume',
  tbsp: 'volume',
  cup: 'volume',
  fl_oz: 'volume',
  count: 'count',
};

export function unitDimension(unit: Unit): UnitDimension {
  return UNIT_DIMENSIONS[unit];
}

// ---------------------------------------------------------------------------
// Exact factors to the canonical base unit. Every factor is a Rational
// literal built with rational(a, b) — a float here is a defect.
// ---------------------------------------------------------------------------

/** 1 lb = 453.59237 g exactly (international avoirdupois pound). */
const G_PER_LB: Rational = rational(45359237n, 100000n);
/** 1 oz = 1/16 lb = 28.349523125 g exactly. */
const G_PER_OZ: Rational = div(G_PER_LB, rational(16n));
const G_PER_KG: Rational = rational(1000n);
const ML_PER_L: Rational = rational(1000n);
/** 1 US tsp = 4.92892159375 ml exactly (1/6 US fl oz, 1/768 US gallon). */
const ML_PER_TSP: Rational = rational(492892159375n, 100000000000n);
/** 1 tbsp = 3 tsp = 14.78676478125 ml exactly. */
const ML_PER_TBSP: Rational = mul(rational(3n), ML_PER_TSP);
/** 1 US fl oz = 6 tsp = 29.5735295625 ml exactly. */
const ML_PER_FL_OZ: Rational = mul(rational(6n), ML_PER_TSP);
/** 1 US cup = 48 tsp = 236.5882365 ml exactly. */
const ML_PER_CUP: Rational = mul(rational(48n), ML_PER_TSP);

/** Exact multiplier taking 1 of each unit to its canonical base unit.
 * Total over `Unit` by Record — a new unit cannot ship without a factor. */
export const FACTOR_TO_CANONICAL: Readonly<Record<Unit, Rational>> = {
  g: ONE,
  kg: G_PER_KG,
  oz: G_PER_OZ,
  lb: G_PER_LB,
  ml: ONE,
  l: ML_PER_L,
  tsp: ML_PER_TSP,
  tbsp: ML_PER_TBSP,
  cup: ML_PER_CUP,
  fl_oz: ML_PER_FL_OZ,
  count: ONE,
};

// ---------------------------------------------------------------------------
// Same-dimension conversion — total, exact, needs no ingredient knowledge
// ---------------------------------------------------------------------------

export interface CanonicalAmount {
  readonly amount: Rational;
  readonly unit: CanonicalUnit;
  readonly dimension: UnitDimension;
}

/**
 * Convert an amount in any `Unit` to its dimension's canonical base unit
 * (g / ml / count). Total and exact — this can never fail and never needs
 * an ingredient.
 */
export function toCanonical(amount: Rational, unit: Unit): CanonicalAmount {
  const dimension = UNIT_DIMENSIONS[unit];
  return {
    amount: mul(amount, FACTOR_TO_CANONICAL[unit]),
    unit: CANONICAL_UNIT_BY_DIMENSION[dimension],
    dimension,
  };
}

// ---------------------------------------------------------------------------
// Cross-dimension conversion — ONLY via curated registry values
// ---------------------------------------------------------------------------

/** The curated registry fields a cross-dimension conversion may require. */
export type CuratedConversionField = 'density_g_per_ml' | 'per_item_weight_g';

/**
 * The explicit "cannot convert" state. Reported separately, never guessed:
 * names the ingredient, both dimensions, and exactly which curated fields
 * are absent. A discriminated-union member, not a null and not an
 * exception, so callers must handle it.
 */
export interface NotConvertible {
  readonly kind: 'not_convertible';
  readonly ingredient_id: IngredientId;
  readonly from_dimension: UnitDimension;
  readonly to_dimension: UnitDimension;
  /** The curated fields that are null on the registry entry; non-empty. */
  readonly missing: readonly CuratedConversionField[];
}

export type ConvertAmountResult =
  | { readonly kind: 'converted'; readonly amount: Rational; readonly unit: CanonicalUnit; readonly dimension: UnitDimension }
  | NotConvertible;

function converted(amount: Rational, dimension: UnitDimension): ConvertAmountResult {
  return { kind: 'converted', amount, unit: CANONICAL_UNIT_BY_DIMENSION[dimension], dimension };
}

function notConvertible(
  entry: IngredientRegistryEntry,
  from: UnitDimension,
  to: UnitDimension,
  missing: readonly CuratedConversionField[],
): NotConvertible {
  return {
    kind: 'not_convertible',
    ingredient_id: entry.id,
    from_dimension: from,
    to_dimension: to,
    missing,
  };
}

/**
 * Convert an amount to the canonical base unit of `target`.
 *
 * Same dimension: always succeeds, exactly (no ingredient data consulted).
 * Cross dimension: only through the entry's curated `density_g_per_ml`
 * (volume↔mass) and/or `per_item_weight_g` (count↔mass); volume↔count needs
 * both. A missing curated value yields `not_convertible` listing every
 * absent field — the amount is never guessed and never dropped.
 */
export function convertAmount(
  amount: Rational,
  unit: Unit,
  target: UnitDimension,
  entry: IngredientRegistryEntry,
): ConvertAmountResult {
  const canonical = toCanonical(amount, unit);
  const from = canonical.dimension;
  if (from === target) return converted(canonical.amount, from);

  const density = entry.density_g_per_ml;
  const weight = entry.per_item_weight_g;
  const a = canonical.amount;

  if (from === 'volume' && target === 'mass') {
    if (density === null) return notConvertible(entry, from, target, ['density_g_per_ml']);
    return converted(mul(a, density), target);
  }
  if (from === 'mass' && target === 'volume') {
    if (density === null) return notConvertible(entry, from, target, ['density_g_per_ml']);
    return converted(div(a, density), target);
  }
  if (from === 'count' && target === 'mass') {
    if (weight === null) return notConvertible(entry, from, target, ['per_item_weight_g']);
    return converted(mul(a, weight), target);
  }
  if (from === 'mass' && target === 'count') {
    if (weight === null) return notConvertible(entry, from, target, ['per_item_weight_g']);
    return converted(div(a, weight), target);
  }
  if (from === 'volume' && target === 'count') {
    if (density === null || weight === null) {
      return notConvertible(entry, from, target, missingFields(density, weight));
    }
    return converted(div(mul(a, density), weight), target);
  }
  // from === 'count' && target === 'volume'
  if (density === null || weight === null) {
    return notConvertible(entry, from, target, missingFields(density, weight));
  }
  return converted(div(mul(a, weight), density), target);
}

function missingFields(density: Rational | null, weight: Rational | null): CuratedConversionField[] {
  const missing: CuratedConversionField[] = [];
  if (density === null) missing.push('density_g_per_ml');
  if (weight === null) missing.push('per_item_weight_g');
  return missing;
}

// ---------------------------------------------------------------------------
// Quantity-level conversion — preserves to_taste and range structure
// ---------------------------------------------------------------------------

/**
 * A quantity expressed in a canonical base unit. `to_taste` survives as
 * itself — a distinct non-numeric state, never folded into an amount.
 * Ranges keep min and max, each converted independently.
 */
export type CanonicalQuantity =
  | { readonly kind: 'exact'; readonly amount: Rational; readonly unit: CanonicalUnit; readonly dimension: UnitDimension }
  | { readonly kind: 'range'; readonly min: Rational; readonly max: Rational; readonly unit: CanonicalUnit; readonly dimension: UnitDimension }
  | { readonly kind: 'to_taste' };

export type ConvertQuantityResult = CanonicalQuantity | NotConvertible;

/**
 * Express a quantity in its own dimension's canonical base unit. Total —
 * same-dimension conversion can never fail.
 */
export function canonicalizeQuantity(quantity: IngredientQuantity): CanonicalQuantity {
  if (quantity.kind === 'to_taste') return { kind: 'to_taste' };
  if (quantity.kind === 'exact') {
    const c = toCanonical(quantity.amount, quantity.unit);
    return { kind: 'exact', amount: c.amount, unit: c.unit, dimension: c.dimension };
  }
  // Range bounds convert INDEPENDENTLY — never collapsed to a midpoint.
  const lo = toCanonical(quantity.min, quantity.unit);
  const hi = toCanonical(quantity.max, quantity.unit);
  return { kind: 'range', min: lo.amount, max: hi.amount, unit: lo.unit, dimension: lo.dimension };
}

/**
 * Convert a quantity to the canonical base unit of `target`. `to_taste`
 * passes through untouched regardless of target or registry data. A range
 * converts min and max independently; a cross-dimension conversion without
 * the curated value yields the same explicit `not_convertible` as
 * `convertAmount` — never a guess.
 */
export function convertQuantity(
  quantity: IngredientQuantity,
  target: UnitDimension,
  entry: IngredientRegistryEntry,
): ConvertQuantityResult {
  if (quantity.kind === 'to_taste') return { kind: 'to_taste' };
  if (quantity.kind === 'exact') {
    const r = convertAmount(quantity.amount, quantity.unit, target, entry);
    if (r.kind === 'not_convertible') return r;
    return { kind: 'exact', amount: r.amount, unit: r.unit, dimension: r.dimension };
  }
  const lo = convertAmount(quantity.min, quantity.unit, target, entry);
  if (lo.kind === 'not_convertible') return lo;
  const hi = convertAmount(quantity.max, quantity.unit, target, entry);
  if (hi.kind === 'not_convertible') return hi;
  return { kind: 'range', min: lo.amount, max: hi.amount, unit: lo.unit, dimension: lo.dimension };
}
