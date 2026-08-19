/**
 * inventoryMath.ts — confidence-gated inventory subtraction (wave 1A).
 *
 * The one formula (SPEC "Domain rules"):
 *
 *   purchase_requirement = max(0, aggregated_requirement − usable_inventory)
 *
 * where usable inventory sums ONLY entries whose `InventoryConfidence` is
 * `confirmed` or `assumed_staple`. An `inferred` entry is NEVER silently
 * subtracted at any quantity — instead, when (and only when) confirming it
 * could actually reduce a purchase, it becomes a `ConfirmationQuestion`
 * ("your plan needs 4 lemons, we think you have 2 — still right?").
 *
 * Questions are high-value and FEW by construction, never a pantry review:
 *   - inventory for ingredients the plan does not need is ignored entirely;
 *   - an inferred entry whose line is already fully covered by usable
 *     inventory asks nothing (the answer could not change the purchase);
 *   - an inferred entry that cannot be expressed in the line's dimension
 *     asks nothing either — a confirmed answer still could not be
 *     subtracted, because cross-dimension subtraction is never guessed.
 * So questions ⊆ inferred entries × lines with a positive purchase.
 *
 * Cross-dimension inventory (e.g. grams on hand against a count line) is
 * usable ONLY through the entry's curated `density_g_per_ml` /
 * `per_item_weight_g` (units.ts). Anything else is returned as an explicit
 * `UnusableInventoryReport` carrying the exact `NotConvertible` refusal —
 * reported separately, never guessed, never silently dropped. One inventory
 * entry applies to AT MOST ONE aggregated line (exact dimension match first,
 * then curated conversion in the lines' deterministic dimension order), so
 * an entry can never be subtracted twice across a split ingredient.
 *
 * Traceability survives: every output line carries the aggregated line's
 * contributions untouched — subtraction decorates the ledger, it never
 * rewrites it. "To taste" lines pass through as themselves: there is no
 * number to subtract from and none is invented.
 *
 * Pure module: no I/O, no clocks, no database. Deducting from persisted
 * inventory happens later, in the server layer, on "cooked"/confirmation —
 * this module only RETURNS the arithmetic. All quantity arithmetic goes
 * through qty.ts (Invariant 1 — no bare `+`/`*` on quantity numbers).
 */

import type { Rational } from './qty.ts';
import { ZERO, add, max, min, sign, sub } from './qty.ts';
import type {
  IngredientId,
  InventoryConfidence,
  InventoryEntry,
  UnitDimension,
  Uuid,
} from './recipe.ts';
import type {
  AggregatedAmountLine,
  AggregatedLine,
  AggregatedToTasteLine,
} from './aggregate.ts';
import { UnknownIngredientError } from './aggregate.ts';
import type { CanonicalUnit, NotConvertible } from './units.ts';
import { convertAmount, toCanonical, unitDimension } from './units.ts';
import type { IngredientRegistry } from './catalog.ts';

// ---------------------------------------------------------------------------
// Output shapes — decorations of the frozen aggregate/recipe contracts.
// `inventory_deducted` and `purchase_requirement` map 1:1 onto the frozen
// `GroceryLine` fields (recipe.ts); no parallel source of truth is defined.
// ---------------------------------------------------------------------------

/** An aggregated amount line after confidence-gated subtraction. Everything
 * from the aggregation (including full contributions) survives untouched. */
export interface NetRequirementLine extends AggregatedAmountLine {
  /** Total usable inventory (confirmed + assumed_staple) expressed in this
   * line's canonical unit — UNCAPPED (may exceed the requirement). */
  readonly usable_inventory: Rational;
  /** min(required_quantity, usable_inventory) — the amount actually
   * deducted; the frozen `GroceryLine.inventory_deducted`. */
  readonly inventory_deducted: Rational;
  /** max(0, required_quantity − usable_inventory). Never negative. */
  readonly purchase_requirement: Rational;
}

export type NetLine = NetRequirementLine | AggregatedToTasteLine;

/** One genuine uncertainty worth the user's attention: an inferred entry
 * that, if confirmed, would reduce this line's purchase. All amounts are in
 * the line's canonical unit — concrete, countable copy fuel. */
export interface ConfirmationQuestion {
  readonly inventory_entry_id: Uuid;
  readonly ingredient_id: IngredientId;
  /** Curated registry display name (from the aggregated line). */
  readonly display_name: string;
  readonly dimension: UnitDimension;
  readonly unit: CanonicalUnit;
  /** What we THINK is on hand (the inferred entry's quantity, converted). */
  readonly claimed_quantity: Rational;
  /** The line's full aggregated requirement ("your plan needs 4 lemons"). */
  readonly required_quantity: Rational;
  /** What will be bought if the question goes unanswered (the line's
   * purchase_requirement — inferred inventory subtracts NOTHING). */
  readonly purchase_without_confirmation: Rational;
  /** max(0, purchase_without_confirmation − claimed_quantity): what would
   * be bought if the user confirms the claim. */
  readonly purchase_if_confirmed: Rational;
}

/** An inventory entry the plan needs but that cannot be expressed in any of
 * the ingredient's line dimensions without a missing curated value. The
 * refusal is the exact `NotConvertible` from units.ts — never a guess. */
export interface UnusableInventoryReport {
  readonly inventory_entry_id: Uuid;
  readonly ingredient_id: IngredientId;
  readonly confidence: InventoryConfidence;
  readonly refusal: NotConvertible;
}

export interface InventorySubtractionResult {
  /** One output line per input line, in the input's (deterministic) order.
   * Amount lines gain the three subtraction fields; to-taste lines pass
   * through as the very same values. */
  readonly lines: readonly NetLine[];
  /** Sorted by (ingredient_id, inventory_entry_id) — deterministic. */
  readonly confirmation_questions: readonly ConfirmationQuestion[];
  /** Sorted by (ingredient_id, inventory_entry_id) — deterministic. */
  readonly unusable_inventory: readonly UnusableInventoryReport[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Mutable accumulator for one amount line during subtraction. */
interface LineState {
  readonly line: AggregatedAmountLine;
  usable: Rational;
  readonly inferred: { readonly entry: InventoryEntry; readonly claimed: Rational }[];
}

function isUsableConfidence(c: InventoryConfidence): boolean {
  // The gate. `inferred` (and any future less-certain state) falls through
  // to the question path — subtraction is opt-in per confidence, never
  // default-on for an unknown value.
  return c === 'confirmed' || c === 'assumed_staple';
}

/**
 * Subtract usable inventory from aggregated requirements.
 *
 * - Only `confirmed` / `assumed_staple` entries subtract; `inferred` entries
 *   become `ConfirmationQuestion`s iff they could reduce a purchase.
 * - Each entry resolves to at most one line: exact dimension match first,
 *   then curated cross-dimension conversion tried in the lines' order
 *   (aggregate's deterministic mass < volume < count). No resolution ⇒ an
 *   explicit `UnusableInventoryReport`, nothing subtracted.
 * - Entries for ingredients absent from `lines`, and entries with a
 *   non-positive quantity, are ignored (nothing to subtract, nothing to ask).
 * - Pure and deterministic: input inventory order never affects the result.
 *
 * Throws `UnknownIngredientError` only if a needed ingredient is missing
 * from the registry — unreachable after `aggregateRequirements`, which
 * already resolved every line id (defensive, never a silent skip).
 */
export function subtractInventory(
  lines: readonly AggregatedLine[],
  inventory: readonly InventoryEntry[],
  registry: IngredientRegistry,
): InventorySubtractionResult {
  // Index the amount lines by ingredient, preserving line order (aggregate
  // emits an ingredient's dimensions in mass < volume < count order).
  const states = new Map<AggregatedAmountLine, LineState>();
  const byIngredient = new Map<IngredientId, LineState[]>();
  for (const line of lines) {
    if (line.kind !== 'amount') continue;
    const state: LineState = { line, usable: ZERO, inferred: [] };
    states.set(line, state);
    const bucket = byIngredient.get(line.ingredient_id);
    if (bucket === undefined) byIngredient.set(line.ingredient_id, [state]);
    else bucket.push(state);
  }

  const unusable: UnusableInventoryReport[] = [];

  // Deterministic processing order regardless of caller's inventory order.
  // (Rational addition is exact, so usable sums are order-independent
  // anyway; sorting makes the whole pass order-blind by construction.)
  const sortedInventory = [...inventory].sort(
    (a, b) => compareStrings(a.ingredient_id, b.ingredient_id) || compareStrings(a.id, b.id),
  );

  for (const entry of sortedInventory) {
    const targets = byIngredient.get(entry.ingredient_id);
    if (targets === undefined) continue; // not in the plan — ignored entirely
    if (sign(entry.quantity) !== 1) continue; // nothing on hand to subtract

    // Resolve the entry to AT MOST ONE line (never subtracted twice).
    const entryDimension = unitDimension(entry.unit);
    let resolved: { readonly state: LineState; readonly amount: Rational } | null = null;
    let firstRefusal: NotConvertible | null = null;
    const exactTarget = targets.find((t) => t.line.dimension === entryDimension);
    if (exactTarget !== undefined) {
      // Same dimension: total, exact, needs no curated data.
      resolved = { state: exactTarget, amount: toCanonical(entry.quantity, entry.unit).amount };
    } else {
      const registryEntry = registry.get(entry.ingredient_id);
      if (registryEntry === undefined) throw new UnknownIngredientError(entry.ingredient_id);
      for (const t of targets) {
        const converted = convertAmount(entry.quantity, entry.unit, t.line.dimension, registryEntry);
        if (converted.kind === 'not_convertible') {
          if (firstRefusal === null) firstRefusal = converted;
        } else {
          resolved = { state: t, amount: converted.amount };
          break;
        }
      }
    }

    if (resolved === null) {
      // targets is non-empty and no exact match existed, so at least one
      // conversion was attempted and refused.
      if (firstRefusal !== null) {
        unusable.push({
          inventory_entry_id: entry.id,
          ingredient_id: entry.ingredient_id,
          confidence: entry.confidence,
          refusal: firstRefusal,
        });
      }
      continue;
    }

    if (isUsableConfidence(entry.confidence)) {
      resolved.state.usable = add(resolved.state.usable, resolved.amount);
    } else {
      // The gate: anything less certain is NEVER silently subtracted.
      resolved.state.inferred.push({ entry, claimed: resolved.amount });
    }
  }

  // Finalise lines (input order preserved) and collect questions.
  const questions: ConfirmationQuestion[] = [];
  const outLines: NetLine[] = lines.map((line) => {
    if (line.kind !== 'amount') return line; // to_taste: the very same value
    const state = states.get(line);
    if (state === undefined) return { ...line, usable_inventory: ZERO, inventory_deducted: ZERO, purchase_requirement: line.required_quantity }; // unreachable; typing
    const deducted = min(line.required_quantity, state.usable);
    const purchase = sub(line.required_quantity, deducted); // = max(0, req − usable)
    if (sign(purchase) === 1) {
      // Only genuine uncertainty that could reduce THIS purchase asks.
      for (const { entry, claimed } of state.inferred) {
        questions.push({
          inventory_entry_id: entry.id,
          ingredient_id: line.ingredient_id,
          display_name: line.display_name,
          dimension: line.dimension,
          unit: line.unit,
          claimed_quantity: claimed,
          required_quantity: line.required_quantity,
          purchase_without_confirmation: purchase,
          purchase_if_confirmed: max(ZERO, sub(purchase, claimed)),
        });
      }
    }
    return {
      ...line,
      usable_inventory: state.usable,
      inventory_deducted: deducted,
      purchase_requirement: purchase,
    };
  });

  questions.sort(
    (a, b) =>
      compareStrings(a.ingredient_id, b.ingredient_id) ||
      compareStrings(a.inventory_entry_id, b.inventory_entry_id),
  );
  unusable.sort(
    (a, b) =>
      compareStrings(a.ingredient_id, b.ingredient_id) ||
      compareStrings(a.inventory_entry_id, b.inventory_entry_id),
  );

  return { lines: outLines, confirmation_questions: questions, unusable_inventory: unusable };
}
