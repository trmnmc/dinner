/**
 * aggregate.ts — cross-recipe requirement aggregation (wave 1A).
 *
 * Scaled requirement lines from several plan meals merge into a single
 * aggregated line ONLY when BOTH the canonical ingredient id AND the
 * base-unit dimension (mass/volume/count) match (SPEC "Domain rules").
 * Same id but different dimensions may be bridged ONLY through a curated
 * `density_g_per_ml` / `per_item_weight_g` on the registry entry, and only
 * when the WHOLE group unifies (into grams — every curated bridge routes
 * through mass); otherwise every dimension keeps its own line and the
 * refusal is explicit in the data as the exact `NotConvertible` values —
 * never a guessed conversion, never a silent drop.
 *
 * Traceability is the deliverable: every aggregated line carries a
 * `GroceryContribution` (recipe.ts) per contributing recipe line — recipe
 * id, plan meal id, the recipe's own line id, and the amount contributed in
 * the line's canonical unit. The total is BY CONSTRUCTION the exact sum of
 * those contribution amounts; ranges contribute conservatively (their max,
 * per the frozen `GroceryLine.required_quantity` contract), each bound
 * converted independently first.
 *
 * "To taste" contributions aggregate as a DISTINCT presence line per
 * ingredient (kind 'to_taste'), never as zero and never as a number.
 * Differing preparation states are preserved on the merged line, deduped
 * and sorted — never silently discarded, never a merge blocker.
 *
 * Deterministic output ordering (byte-identical for the same input set,
 * regardless of input order):
 *   lines          → (ingredient_id asc, kind: amount before to_taste,
 *                     dimension: mass < volume < count)
 *   contributions  → (recipe_id, plan_meal_id, recipe_ingredient_line_id) asc
 *   preparations   → lexicographic asc, deduped
 *   merge_refusals → from_dimension in mass < volume < count order
 *
 * Pure module: no I/O, no clocks, no globals. All quantity arithmetic goes
 * through qty.ts (Invariant 1 — no bare arithmetic operators on quantity numbers).
 */

import type { Rational } from './qty.ts';
import { ZERO, add } from './qty.ts';
import type {
  GroceryContribution,
  IngredientId,
  Preparation,
  StoreSection,
  UnitDimension,
  Uuid,
} from './recipe.ts';
import type { CanonicalQuantity, CanonicalUnit, NotConvertible } from './units.ts';
import { canonicalizeQuantity, convertQuantity } from './units.ts';
import type { IngredientRegistry, IngredientRegistryEntry } from './catalog.ts';
import type { ScaledRequirementLine } from './scale.ts';

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/** One non-numeric ("to taste") contributor: full provenance, no amount —
 * a `GroceryContribution` minus the number it deliberately does not have. */
export interface ToTasteContribution {
  readonly recipe_id: Uuid;
  readonly plan_meal_id: Uuid;
  /** `RecipeIngredientLine.id` within that recipe. */
  readonly recipe_ingredient_line_id: string;
}

/**
 * A numeric aggregated requirement in ONE canonical base unit. Answers
 * "why am I buying this, and who asked for it?" from the value alone:
 * every contribution names its recipe, plan meal, and recipe line, and
 * `required_quantity` equals the exact sum of the contribution amounts.
 */
export interface AggregatedAmountLine {
  readonly kind: 'amount';
  readonly ingredient_id: IngredientId;
  /** Curated registry display name (canonical, recipe-independent). */
  readonly display_name: string;
  readonly store_section: StoreSection;
  readonly dimension: UnitDimension;
  /** Canonical base unit of `dimension`; all amounts on this line use it. */
  readonly unit: CanonicalUnit;
  /** Exact sum of `contributions[].amount` (ranges counted conservatively
   * at their max — the frozen `GroceryLine` aggregation contract). */
  readonly required_quantity: Rational;
  /** Distinct preparation states preserved from contributing lines. */
  readonly preparations: readonly Preparation[];
  /** Full provenance, one entry per contributing recipe line (DoD 5). */
  readonly contributions: readonly GroceryContribution[];
  /** Non-empty iff other lines with this ingredient id stayed in a
   * different dimension: the exact refused conversions (which curated
   * fields were missing), straight from units.ts — never a guess. */
  readonly merge_refusals: readonly NotConvertible[];
  /** True iff EVERY contributing recipe line authored this ingredient
   * `optional: true` (T-062, garnish/serving-suggestion lines). One
   * required contributor is enough to make the merged line non-optional —
   * a parent must never be told they can skip something a recipe actually
   * needs. */
  readonly optional: boolean;
}

/** The distinct non-numeric presence of an ingredient: at least one recipe
 * wants it "to taste". Never folded into a number, never zero. */
export interface AggregatedToTasteLine {
  readonly kind: 'to_taste';
  readonly ingredient_id: IngredientId;
  readonly display_name: string;
  readonly store_section: StoreSection;
  readonly preparations: readonly Preparation[];
  readonly contributions: readonly ToTasteContribution[];
  /** True iff EVERY contributing recipe line authored this ingredient
   * `optional: true` (T-062) — same all-or-nothing rule as the amount line. */
  readonly optional: boolean;
}

export type AggregatedLine = AggregatedAmountLine | AggregatedToTasteLine;

/** Thrown when a line's ingredient id does not resolve in the registry.
 * The catalog gate guarantees resolution for every eligible recipe, so
 * reaching this is a pipeline defect — loud, never a silent skip. */
export class UnknownIngredientError extends Error {
  readonly ingredient_id: IngredientId;
  constructor(id: IngredientId) {
    super(`ingredient id '${id}' does not resolve in the registry`);
    this.name = 'UnknownIngredientError';
    this.ingredient_id = id;
  }
}

// ---------------------------------------------------------------------------
// Deterministic ordering helpers (plain string/rank comparisons — these
// order identities, never quantities; quantity arithmetic stays in qty.ts)
// ---------------------------------------------------------------------------

const DIMENSION_RANK: Readonly<Record<UnitDimension, number>> = {
  mass: 0,
  volume: 1,
  count: 2,
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareProvenance(
  a: { readonly recipe_id: Uuid; readonly plan_meal_id: Uuid; readonly recipe_ingredient_line_id: string },
  b: { readonly recipe_id: Uuid; readonly plan_meal_id: Uuid; readonly recipe_ingredient_line_id: string },
): number {
  return (
    compareStrings(a.recipe_id, b.recipe_id) ||
    compareStrings(a.plan_meal_id, b.plan_meal_id) ||
    compareStrings(a.recipe_ingredient_line_id, b.recipe_ingredient_line_id)
  );
}

function lineRank(line: AggregatedLine): number {
  // amount lines first (by dimension), the to_taste presence line last.
  return line.kind === 'amount' ? DIMENSION_RANK[line.dimension] : 3;
}

function distinctSortedPreparations(
  lines: readonly ScaledRequirementLine[],
): readonly Preparation[] {
  const seen = new Set<Preparation>();
  for (const l of lines) {
    if (l.preparation !== null) seen.add(l.preparation);
  }
  return [...seen].sort(compareStrings);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** A numeric input line together with its quantity in a canonical unit. */
interface CanonicalLine {
  readonly line: ScaledRequirementLine;
  readonly quantity: Exclude<CanonicalQuantity, { readonly kind: 'to_taste' }>;
}

/** Conservative single amount of a canonical quantity: an exact amount as
 * itself, a range at its max (bounds were converted independently first). */
function conservativeAmount(q: CanonicalLine['quantity']): Rational {
  return q.kind === 'exact' ? q.amount : q.max;
}

function buildAmountLine(
  entry: IngredientRegistryEntry,
  dimension: UnitDimension,
  unit: CanonicalUnit,
  members: readonly CanonicalLine[],
  refusals: readonly NotConvertible[],
): AggregatedAmountLine {
  const contributions: GroceryContribution[] = members
    .map((m) => ({
      recipe_id: m.line.recipe_id,
      plan_meal_id: m.line.plan_meal_id,
      recipe_ingredient_line_id: m.line.recipe_ingredient_line_id,
      amount: conservativeAmount(m.quantity),
    }))
    .sort(compareProvenance);
  // The total IS the sum of the contributions — the tested relationship.
  let total = ZERO;
  for (const c of contributions) total = add(total, c.amount);
  return {
    kind: 'amount',
    ingredient_id: entry.id,
    display_name: entry.display_name,
    store_section: entry.store_section,
    dimension,
    unit,
    required_quantity: total,
    preparations: distinctSortedPreparations(members.map((m) => m.line)),
    contributions,
    merge_refusals: refusals,
    // All-or-nothing (T-062): one non-optional contributor makes the whole
    // merged line something the parent genuinely needs to buy.
    optional: members.every((m) => m.line.optional),
  };
}

/**
 * Aggregate scaled requirement lines across recipes.
 *
 * Merge rule: one line per (canonical ingredient id, base-unit dimension).
 * A multi-dimension ingredient group is unified into a single mass line
 * ONLY when every member converts exactly through the entry's curated
 * density / per-item weight (all-or-nothing — a partial bridge would
 * scatter one refusal across a surprise unit change, so instead each
 * dimension keeps its line and each carries the explicit refusals).
 *
 * Output ordering is deterministic — see the module docs for the keys.
 * Throws `UnknownIngredientError` for an id absent from the registry.
 */
export function aggregateRequirements(
  lines: readonly ScaledRequirementLine[],
  registry: IngredientRegistry,
): readonly AggregatedLine[] {
  // Group by canonical ingredient id, preserving nothing about input order.
  const byIngredient = new Map<IngredientId, ScaledRequirementLine[]>();
  for (const line of lines) {
    if (!registry.has(line.ingredient_id)) throw new UnknownIngredientError(line.ingredient_id);
    const group = byIngredient.get(line.ingredient_id);
    if (group === undefined) byIngredient.set(line.ingredient_id, [line]);
    else group.push(line);
  }

  const out: AggregatedLine[] = [];

  for (const [ingredientId, group] of byIngredient) {
    const entry = registry.get(ingredientId);
    if (entry === undefined) throw new UnknownIngredientError(ingredientId); // unreachable; typing
    const toTaste = group.filter((l) => l.quantity.kind === 'to_taste');
    const numeric = group.filter((l) => l.quantity.kind !== 'to_taste');

    // --- numeric lines: bucket by canonical base-unit dimension ------------
    const byDimension = new Map<UnitDimension, CanonicalLine[]>();
    for (const line of numeric) {
      const canonical = canonicalizeQuantity(line.quantity);
      if (canonical.kind === 'to_taste') continue; // unreachable; typing
      const bucket = byDimension.get(canonical.dimension);
      const member: CanonicalLine = { line, quantity: canonical };
      if (bucket === undefined) byDimension.set(canonical.dimension, [member]);
      else bucket.push(member);
    }

    if (byDimension.size === 1) {
      // Single dimension: id + dimension match ⇒ one merged line.
      for (const [dimension, members] of byDimension) {
        const unit = members[0]?.quantity.unit;
        if (unit !== undefined) out.push(buildAmountLine(entry, dimension, unit, members, []));
      }
    } else if (byDimension.size > 1) {
      // Multiple dimensions: bridge to mass only if the WHOLE group can.
      const unified: CanonicalLine[] = [];
      const refusals: NotConvertible[] = [];
      for (const bucket of byDimension.values()) {
        for (const member of bucket) {
          const converted = convertQuantity(member.line.quantity, 'mass', entry);
          if (converted.kind === 'not_convertible') {
            // One refusal per failing source dimension is enough — the
            // missing curated fields are identical for the same entry.
            if (!refusals.some((r) => r.from_dimension === converted.from_dimension)) {
              refusals.push(converted);
            }
          } else if (converted.kind !== 'to_taste') {
            // (to_taste is unreachable here — numeric input stays numeric —
            // but the units.ts result union carries it for its own callers.)
            unified.push({ line: member.line, quantity: converted });
          }
        }
      }
      if (refusals.length === 0) {
        out.push(buildAmountLine(entry, 'mass', 'g', unified, []));
      } else {
        refusals.sort((a, b) => DIMENSION_RANK[a.from_dimension] - DIMENSION_RANK[b.from_dimension]);
        for (const [dimension, members] of byDimension) {
          const unit = members[0]?.quantity.unit;
          if (unit !== undefined) out.push(buildAmountLine(entry, dimension, unit, members, refusals));
        }
      }
    }

    // --- to-taste presence: its own line, never a number --------------------
    if (toTaste.length > 0) {
      out.push({
        kind: 'to_taste',
        ingredient_id: entry.id,
        display_name: entry.display_name,
        store_section: entry.store_section,
        preparations: distinctSortedPreparations(toTaste),
        contributions: toTaste
          .map((l) => ({
            recipe_id: l.recipe_id,
            plan_meal_id: l.plan_meal_id,
            recipe_ingredient_line_id: l.recipe_ingredient_line_id,
          }))
          .sort(compareProvenance),
        optional: toTaste.every((l) => l.optional),
      });
    }
  }

  // Deterministic final ordering (see module docs).
  out.sort(
    (a, b) => compareStrings(a.ingredient_id, b.ingredient_id) || lineRank(a) - lineRank(b),
  );
  return out;
}
