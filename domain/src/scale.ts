/**
 * scale.ts — serving scaling (wave 1A).
 *
 * Scale factor = target_servings / servings_default, computed ONCE as an
 * exact `Rational` (SPEC "Domain rules") and applied to a quantity's min and
 * max INDEPENDENTLY — a range is never collapsed to a midpoint, and nothing
 * is rounded here. Rounding happens once, later, at the display/package
 * boundary (Invariant 1; qty.ts owns it).
 *
 * "To taste" is a distinct non-numeric quantity state (recipe.ts contract)
 * and passes through scaling untouched — it is never folded into a number
 * and never multiplied.
 *
 * Pure module: no I/O, no clocks, no globals. All arithmetic goes through
 * qty.ts (Invariant 1 — no bare arithmetic operators on quantity numbers).
 */

import type { Rational } from './qty.ts';
import { QtyError, div, fromInt, mul } from './qty.ts';
import type {
  IngredientId,
  IngredientQuantity,
  Preparation,
  Recipe,
  Uuid,
} from './recipe.ts';

// ---------------------------------------------------------------------------
// Scale factor
// ---------------------------------------------------------------------------

/**
 * The exact serving scale factor `target_servings / servings_default`.
 * Both inputs must be positive integers (a recipe with unknown servings is
 * excluded by the catalog gate long before this point); anything else throws
 * a typed `QtyError` — never NaN, never a silent 1.
 */
export function scaleFactor(servingsDefault: number, targetServings: number): Rational {
  if (!Number.isSafeInteger(servingsDefault) || servingsDefault < 1) {
    throw new QtyError(
      'malformed_input',
      `servings_default must be a positive integer, got ${String(servingsDefault)}`,
    );
  }
  if (!Number.isSafeInteger(targetServings) || targetServings < 1) {
    throw new QtyError(
      'malformed_input',
      `target_servings must be a positive integer, got ${String(targetServings)}`,
    );
  }
  return div(fromInt(targetServings), fromInt(servingsDefault));
}

// ---------------------------------------------------------------------------
// Quantity scaling
// ---------------------------------------------------------------------------

/**
 * Scale one quantity by an exact factor. Exact amounts multiply exactly;
 * range bounds multiply INDEPENDENTLY (never a midpoint); `to_taste` is
 * returned as itself, untouched. The unit is preserved — scaling never
 * converts (units.ts owns conversion).
 */
export function scaleQuantity(quantity: IngredientQuantity, factor: Rational): IngredientQuantity {
  if (quantity.kind === 'to_taste') return quantity;
  if (quantity.kind === 'exact') {
    return { kind: 'exact', amount: mul(quantity.amount, factor), unit: quantity.unit };
  }
  return {
    kind: 'range',
    min: mul(quantity.min, factor),
    max: mul(quantity.max, factor),
    unit: quantity.unit,
  };
}

// ---------------------------------------------------------------------------
// Recipe → scaled requirement lines (the aggregation input)
// ---------------------------------------------------------------------------

/**
 * One ingredient requirement scaled to a plan meal's target servings,
 * carrying everything aggregation needs to keep full line-level provenance:
 * the recipe, the plan meal, and the recipe's own line identity — so every
 * aggregated number can link back to exactly who asked for it
 * (`GroceryContribution` in recipe.ts is built from these three ids).
 */
export interface ScaledRequirementLine {
  readonly recipe_id: Uuid;
  readonly plan_meal_id: Uuid;
  /** `RecipeIngredientLine.id` within that recipe. */
  readonly recipe_ingredient_line_id: string;
  /** Canonical registry id (the catalog gate guarantees resolution). */
  readonly ingredient_id: IngredientId;
  /** Name as authored on the recipe line (provenance display). */
  readonly display_name: string;
  /** The scaled quantity — still in the recipe's own unit, unrounded. */
  readonly quantity: IngredientQuantity;
  /** Preparation state, preserved verbatim; null = none. */
  readonly preparation: Preparation | null;
  /** Garnish/serving suggestion flag, passed through — callers decide
   * whether optional lines join hard requirements. */
  readonly optional: boolean;
}

/**
 * Scale every ingredient line of a recipe to `targetServings` for one plan
 * meal. The factor is computed once; line order is preserved (the recipe's
 * own authored order). Pure — the recipe is never mutated.
 */
export function scaleRecipeRequirements(
  recipe: Recipe,
  planMealId: Uuid,
  targetServings: number,
): readonly ScaledRequirementLine[] {
  const factor = scaleFactor(recipe.servings_default, targetServings);
  return recipe.ingredients.map((line) => ({
    recipe_id: recipe.id,
    plan_meal_id: planMealId,
    recipe_ingredient_line_id: line.id,
    ingredient_id: line.ingredient_id,
    display_name: line.display_name,
    quantity: scaleQuantity(line.quantity, factor),
    preparation: line.preparation,
    optional: line.optional,
  }));
}
