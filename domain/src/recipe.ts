/**
 * recipe.ts — FROZEN shared types for the whole product (wave 0).
 *
 * Every downstream module imports its shapes from here; a later module must
 * never need to invent a persisted type of its own. Changing anything in
 * this file after wave 1 is an emergency (single-agent commit), never a
 * refactor — see DESIGN.md "Contract-drift rule".
 *
 * Conventions:
 * - Union string literal types, never enums (erasableSyntaxOnly).
 * - All quantities/prices/scores are `Rational` (Invariant 1) — no floats.
 * - All instants are UTC ISO-8601 strings; timers store their ABSOLUTE end
 *   instant, never remaining seconds (Invariant 2).
 * - Durations authored on recipe steps are integer seconds (exact).
 */

import type { Rational } from './qty.ts';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** UUID v4 text id (Postgres-shaped, decision D-3). */
export type Uuid = string;

/** UTC ISO-8601 instant, e.g. "2026-08-18T23:15:00.000Z". Always UTC. */
export type IsoUtcInstant = string;

/** Canonical ingredient id from the curated registry (`data/ingredients.json`). */
export type IngredientId = string;

// ---------------------------------------------------------------------------
// Units (types only — conversion logic is wave 1A's `units.ts`, not here)
// ---------------------------------------------------------------------------

export type UnitDimension = 'mass' | 'volume' | 'count';

/** Units a recipe line or inventory entry may carry. Canonical base units
 * per dimension are `g`, `ml`, `count` (SPEC "Domain rules"). */
export type Unit =
  | 'g'
  | 'kg'
  | 'oz'
  | 'lb'
  | 'ml'
  | 'l'
  | 'tsp'
  | 'tbsp'
  | 'cup'
  | 'fl_oz'
  | 'count';

// ---------------------------------------------------------------------------
// Ingredient quantities
// ---------------------------------------------------------------------------

/**
 * The quantity of an ingredient line. "To taste" is an explicit non-numeric
 * state and is NEVER folded into arithmetic or a purchase quantity.
 * Ranges are preserved and purchased conservatively (against `max`).
 */
export type IngredientQuantity =
  | { readonly kind: 'exact'; readonly amount: Rational; readonly unit: Unit }
  | { readonly kind: 'range'; readonly min: Rational; readonly max: Rational; readonly unit: Unit }
  | { readonly kind: 'to_taste' };

/** Preparation state, preserved on lines and never silently merged. */
export type Preparation = string; // e.g. "minced", "diced", "drained" — free text, curated in data

export interface RecipeIngredientLine {
  /** Stable id unique within the recipe (used by grocery provenance links). */
  readonly id: string;
  readonly ingredient_id: IngredientId;
  /** Human-readable name as authored, e.g. "flat-leaf parsley". */
  readonly display_name: string;
  readonly quantity: IngredientQuantity;
  /** null = no preparation state. */
  readonly preparation: Preparation | null;
  /** Optional garnish/serving suggestion — excluded from hard requirements. */
  readonly optional: boolean;
}

// ---------------------------------------------------------------------------
// Steps — the nine interruption-metadata fields are REQUIRED on every step
// (Invariant 6). "No guidance available" is a representable value, never an
// absent field.
// ---------------------------------------------------------------------------

export type InterruptionRisk = 'low' | 'medium' | 'high';

/** Recovery/panic guidance. `none_available` is explicit and renderable —
 * the UI says so; it never fabricates guidance. */
export type RecoveryGuidance =
  | { readonly kind: 'instruction'; readonly text: string }
  | { readonly kind: 'none_available' };

/** How long a step may be paused. `unlimited` is explicit, not a null. */
export type MaximumPause =
  | { readonly kind: 'bounded'; readonly seconds: number }
  | { readonly kind: 'unlimited' };

export interface RecipeStep {
  /** Stable id unique within the recipe. */
  readonly id: string;
  /** 0-based position; steps are strictly ordered. */
  readonly index: number;
  /** Imperative instruction, concrete and countable. */
  readonly instruction: string;
  readonly equipment: readonly string[];

  // --- the nine required interruption-metadata fields (SPEC must-have 2) ---
  /** 1. Hands-on time this step demands, integer seconds. */
  readonly active_duration_seconds: number;
  /** 2. Time this step runs without attention, integer seconds. */
  readonly unattended_duration_seconds: number;
  /** 3. True if walking away mid-step ruins it (gets a pre-step warning). */
  readonly requires_continuous_attention: boolean;
  /** 4a. Safe to pause before starting this step. */
  readonly safe_to_pause_before: boolean;
  /** 4b. Safe to pause while this step is in progress. */
  readonly safe_to_pause_during: boolean;
  /** 4c. Safe to pause after completing this step. */
  readonly safe_to_pause_after: boolean;
  /** 5. Longest safe pause during/after this step. */
  readonly maximum_pause: MaximumPause;
  /** 6. True if finishing this step is a natural stopping point. */
  readonly natural_stopping_point: boolean;
  /** 7. How badly an interruption here tends to go. */
  readonly interruption_risk: InterruptionRisk;
  /** 8. Validated recovery instruction after an interruption — or an
   * explicit `none_available`. Never fabricated (Invariant 6). */
  readonly recovery_instruction: RecoveryGuidance;
  /** 9. Timer this step starts, integer seconds; null = no timer.
   * (Running timers persist an ABSOLUTE end instant — see CookingTimer.) */
  readonly timer_duration_seconds: number | null;
}

// ---------------------------------------------------------------------------
// Recipe attributes (the eight preference axes) + dietary/allergen tags
// ---------------------------------------------------------------------------

/** The eight attribute axes preference signals are stored against —
 * never collapsed into one opaque taste score. */
export type PreferenceAttribute =
  | 'protein'
  | 'cuisine'
  | 'flavour'
  | 'texture'
  | 'spice'
  | 'richness'
  | 'method'
  | 'effort';

export type Protein =
  | 'chicken'
  | 'beef'
  | 'pork'
  | 'lamb'
  | 'turkey'
  | 'fish'
  | 'shellfish'
  | 'egg'
  | 'tofu'
  | 'tempeh'
  | 'legume'
  | 'cheese'
  | 'none';

export type Cuisine =
  | 'italian'
  | 'mexican'
  | 'tex_mex'
  | 'thai'
  | 'vietnamese'
  | 'chinese'
  | 'japanese'
  | 'korean'
  | 'indian'
  | 'middle_eastern'
  | 'north_african'
  | 'mediterranean'
  | 'greek'
  | 'french'
  | 'spanish'
  | 'american'
  | 'cajun'
  | 'caribbean'
  | 'british'
  | 'german'
  | 'other';

export type FlavourTag =
  | 'savoury'
  | 'umami'
  | 'garlicky'
  | 'herby'
  | 'bright'
  | 'tangy'
  | 'sweet'
  | 'smoky'
  | 'spicy'
  | 'mild'
  | 'fresh'
  | 'earthy';

export type TextureTag =
  | 'crispy'
  | 'creamy'
  | 'tender'
  | 'chewy'
  | 'crunchy'
  | 'saucy'
  | 'brothy'
  | 'sticky'
  | 'fluffy';

export type SpiceLevel = 'none' | 'mild' | 'medium' | 'hot';

export type Richness = 'light' | 'medium' | 'rich';

export type CookingMethod =
  | 'stovetop'
  | 'oven'
  | 'sheet_pan'
  | 'one_pot'
  | 'stir_fry'
  | 'braise'
  | 'roast'
  | 'grill'
  | 'broil'
  | 'simmer'
  | 'no_cook'
  | 'assembly';

export type EffortLevel = 'low' | 'medium' | 'high';

export type CostBand = 'low' | 'medium' | 'high';

/** Machine-readable attribute vector every recipe carries. */
export interface AttributeVector {
  readonly protein: Protein;
  readonly cuisine: Cuisine;
  readonly flavour: readonly FlavourTag[];
  readonly texture: readonly TextureTag[];
  readonly spice: SpiceLevel;
  readonly richness: Richness;
  readonly method: CookingMethod;
  readonly effort: EffortLevel;
}

export type DietaryTag =
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'gluten_free'
  | 'dairy_free'
  | 'nut_free'
  | 'egg_free'
  | 'soy_free'
  | 'shellfish_free'
  | 'low_carb';

export type Allergen =
  | 'peanut'
  | 'tree_nut'
  | 'dairy'
  | 'egg'
  | 'gluten'
  | 'wheat'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'sesame'
  | 'mustard'
  | 'sulfite';

// ---------------------------------------------------------------------------
// Recipe
// ---------------------------------------------------------------------------

export interface Recipe {
  readonly id: Uuid;
  /** URL-safe stable slug, e.g. "sheet-pan-lemon-chicken". */
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** Servings the base quantities are authored for; positive integer.
   * Scale factor = target_servings / servings_default (SPEC domain rules). */
  readonly servings_default: number;
  readonly attributes: AttributeVector;
  readonly dietary_tags: readonly DietaryTag[];
  /** Allergens present in the dish as authored (catalog gate cross-checks
   * these against the ingredient registry — Invariant 5, not this module). */
  readonly allergens: readonly Allergen[];
  readonly equipment: readonly string[];
  readonly cost_band: CostBand;
  /** Pots/pans/dishes generated — a scoring penalty input. */
  readonly dish_count: number;
  /** Sum of per-step active + unattended time. The catalog gate validates
   * these equal the step sums; both are always shown separately (DoD 6). */
  readonly total_time_seconds: number;
  readonly active_time_seconds: number;
  readonly ingredients: readonly RecipeIngredientLine[];
  /** Strictly ordered by `index`, 0-based, contiguous. */
  readonly steps: readonly RecipeStep[];
}

// ---------------------------------------------------------------------------
// Household + members
// ---------------------------------------------------------------------------

export type NoveltyPreference = 'stick_to_favourites' | 'mostly_familiar' | 'adventurous';

export interface Household {
  readonly id: Uuid;
  readonly name: string;
  /** People eating dinner, including children; positive integer. */
  readonly household_size: number;
  readonly novelty_preference: NoveltyPreference;
  /** Weeknight ceilings, integer seconds; null = no ceiling. Hard filters. */
  readonly weeknight_active_time_ceiling_seconds: number | null;
  readonly weeknight_total_time_ceiling_seconds: number | null;
  readonly created_at_utc: IsoUtcInstant;
}

export interface HouseholdMember {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly display_name: string;
  /** The onboarding adult. Optional second adult has their own row. */
  readonly is_primary: boolean;
  /** Hard filters — absolute, never averaged (SPEC precedence order). */
  readonly dietary_restrictions: readonly DietaryTag[];
  readonly allergies: readonly Allergen[];
  readonly never_recommend_ingredients: readonly IngredientId[];
  readonly created_at_utc: IsoUtcInstant;
}

// ---------------------------------------------------------------------------
// Preference signals (attribute-level; value + confidence + durability)
// ---------------------------------------------------------------------------

export type SignalDurability = 'transient' | 'seasonal' | 'durable';

export type SignalSource = 'onboarding' | 'calibration' | 'feedback' | 'swap';

/** Reactions offered on a taste-calibration card (exactly these four). */
export type CalibrationReaction = 'looks_good' | 'not_for_me' | 'never_recommend' | 'too_much_work';

export interface PreferenceSignal {
  readonly id: Uuid;
  readonly household_id: Uuid;
  /** null = household-level signal (no specific member). */
  readonly member_id: Uuid | null;
  readonly attribute: PreferenceAttribute;
  /** The attribute's value this signal is about, e.g. "chicken", "thai",
   * "one_pot", "hot" — a member of the matching union above. */
  readonly attribute_value: string;
  /** Preference strength in [-1, 1], exact. Negative signals are weighted
   * more strongly and decay slower than weak positives (SPEC). */
  readonly value: Rational;
  /** Confidence in [0, 1], exact. */
  readonly confidence: Rational;
  readonly durability: SignalDurability;
  readonly source: SignalSource;
  readonly updated_at_utc: IsoUtcInstant;
}

// ---------------------------------------------------------------------------
// Score breakdown — every weighted component and penalty, persisted for
// debugging (SPEC weights: 32/20/16/12/10/10, minus explicit penalties).
// All values are Rational; a float in a persisted score is a defect.
// ---------------------------------------------------------------------------

export type ScoreComponentName =
  | 'preference'
  | 'context_interruption'
  | 'inventory_use'
  | 'cost'
  | 'novelty'
  | 'leftover_usefulness';

export type ScorePenaltyName =
  | 'recent_repeat'
  | 'repeated_cuisine'
  | 'repeated_format'
  | 'excessive_active_time'
  | 'dish_count'
  | 'likely_waste';

/** The weight config shape. The single weights object lives in
 * `domain/src/score.ts` (wave 1B) — never inline literals. */
export type ScoreWeights = Readonly<Record<ScoreComponentName, Rational>>;

export interface ScoreComponent {
  /** Weight actually used (from the config object), e.g. 32/100. */
  readonly weight: Rational;
  /** Raw component fit in [0, 1] before weighting. */
  readonly raw: Rational;
  /** weight × raw. */
  readonly weighted: Rational;
}

export interface ScoreBreakdown {
  readonly recipe_id: Uuid;
  readonly components: Readonly<Record<ScoreComponentName, ScoreComponent>>;
  /** Each penalty ≥ 0; zero when not applied. Always all keys present. */
  readonly penalties: Readonly<Record<ScorePenaltyName, Rational>>;
  /** Σ weighted components − Σ penalties. */
  readonly total: Rational;
}

// ---------------------------------------------------------------------------
// Plans + meals + reasons
// ---------------------------------------------------------------------------

export type PlanStatus = 'draft' | 'accepted' | 'superseded';

export interface Plan {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly status: PlanStatus;
  readonly created_at_utc: IsoUtcInstant;
}

/** Structured reason codes rendered as concrete copy by
 * `domain/src/reasons.ts` (wave 1D). At most three per meal. */
export type ReasonCode =
  | 'matches_taste'
  | 'quick_total_time'
  | 'low_active_time'
  | 'interruption_friendly'
  | 'uses_owned_ingredients'
  | 'shares_ingredients'
  | 'budget_friendly'
  | 'few_dishes'
  | 'familiar_favourite'
  | 'adjacent_novelty'
  | 'leftover_friendly';

/** The nine explicit swap reasons (SPEC plan screen). Swap re-ranks against
 * the frozen remaining two meals — it never re-runs planset (Invariant 4). */
export type SwapReason =
  | 'faster'
  | 'less_hands_on'
  | 'fewer_dishes'
  | 'cheaper'
  | 'more_familiar'
  | 'more_adventurous'
  | 'no_pasta'
  | 'different_protein'
  | 'use_what_i_have';

export type PlanMealStatus = 'proposed' | 'accepted' | 'swapped_out' | 'cooked';

export interface PlanMeal {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly plan_id: Uuid;
  readonly recipe_id: Uuid;
  /** Position in the 3-meal plan: 0, 1, or 2. */
  readonly slot: number;
  readonly target_servings: number;
  readonly status: PlanMealStatus;
  /** At most three (SPEC). */
  readonly reason_codes: readonly ReasonCode[];
  /** Persisted in full for debugging — never recomputed lossily. */
  readonly score: ScoreBreakdown;
  readonly created_at_utc: IsoUtcInstant;
}

// ---------------------------------------------------------------------------
// Grocery list — a ledger: every line traceable to the recipe lines that
// produced it, and user edits live in a separate never-overwritten field.
// ---------------------------------------------------------------------------

export type StoreSection =
  | 'produce'
  | 'meat_seafood'
  | 'dairy_eggs'
  | 'bakery'
  | 'frozen'
  | 'canned'
  | 'dry_goods'
  | 'spices'
  | 'condiments'
  | 'beverages'
  | 'other';

export type GroceryListStatus = 'current' | 'superseded';

export interface GroceryList {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly plan_id: Uuid;
  readonly status: GroceryListStatus;
  readonly created_at_utc: IsoUtcInstant;
  /** null until the list is regenerated (regeneration NEVER touches
   * `user_edited_quantity` on any line — schema-enforced). */
  readonly regenerated_at_utc: IsoUtcInstant | null;
}

/** One contributing recipe line: answers "why am I buying this?". */
export interface GroceryContribution {
  readonly recipe_id: Uuid;
  readonly plan_meal_id: Uuid;
  /** RecipeIngredientLine.id within that recipe. */
  readonly recipe_ingredient_line_id: string;
  /** Scaled amount this line contributed, in `GroceryLine.unit`. */
  readonly amount: Rational;
}

export interface GroceryLine {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly grocery_list_id: Uuid;
  readonly ingredient_id: IngredientId;
  readonly display_name: string;
  readonly store_section: StoreSection;
  /** Unit all quantities on this line are expressed in (canonical base). */
  readonly unit: Unit;
  /** Aggregated requirement across contributing recipes (conservative max
   * of any ranges), before inventory subtraction. */
  readonly required_quantity: Rational;
  /** Usable inventory deducted (confirmed/assumed_staple only). */
  readonly inventory_deducted: Rational;
  /** Package phrasing, e.g. "two 15 oz cans"; null when sold loose. */
  readonly package_description: string | null;
  /** True when the package match is a generic fallback — the UI labels it
   * "estimated"; honest uncertainty, never false precision. */
  readonly is_estimate: boolean;
  /** total package yield − purchase requirement; written to inventory on
   * purchase confirmation. */
  readonly expected_surplus: Rational;
  /** User's manual quantity edit. SEPARATE, NEVER-OVERWRITTEN by list
   * regeneration (its own DB column; regeneration cannot express a write
   * to it). null = user has not edited this line. */
  readonly user_edited_quantity: Rational | null;
  readonly checked: boolean;
  /** Provenance: every contributing recipe line and its amount (DoD 5). */
  readonly contributions: readonly GroceryContribution[];
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

/** Subtraction applies ONLY to `confirmed` and `assumed_staple`.
 * `inferred` (less certain) becomes a confirmation question, never a
 * silent deduction (SPEC domain rules). */
export type InventoryConfidence = 'confirmed' | 'assumed_staple' | 'inferred';

export type InventorySource =
  | 'onboarding_staple'
  | 'purchase_confirmed'
  | 'surplus'
  | 'consumption'
  | 'manual';

export interface InventoryEntry {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly ingredient_id: IngredientId;
  readonly quantity: Rational;
  readonly unit: Unit;
  readonly confidence: InventoryConfidence;
  readonly source: InventorySource;
  /** null = no useful best-by information. */
  readonly best_by_utc: IsoUtcInstant | null;
  readonly updated_at_utc: IsoUtcInstant;
}

// ---------------------------------------------------------------------------
// Cooking sessions, timers and events (Invariant 2: absolute UTC end
// instants — recovery after kill/reload is pure arithmetic).
// ---------------------------------------------------------------------------

export interface CookingTimer {
  readonly id: Uuid;
  /** Step index this timer belongs to. */
  readonly step_index: number;
  readonly label: string;
  readonly started_at_utc: IsoUtcInstant;
  /** ABSOLUTE UTC end instant. NEVER remaining seconds. Remaining time is
   * always derived: ends_at_utc − now. */
  readonly ends_at_utc: IsoUtcInstant;
  /** Original planned duration, integer seconds — display only. */
  readonly duration_seconds: number;
}

export type CookingSessionStatus = 'active' | 'paused' | 'completed' | 'abandoned';

/** Current recoverable state; survives kill/reload intact. The event log
 * below is the append-only history. */
export interface CookingSession {
  readonly id: Uuid;
  readonly household_id: Uuid;
  /** null when cooking off-plan (e.g. re-cooking a past favourite). */
  readonly plan_meal_id: Uuid | null;
  readonly recipe_id: Uuid;
  readonly target_servings: number;
  readonly status: CookingSessionStatus;
  /** 0-based index of the step the cook is on. */
  readonly current_step_index: number;
  /** All timers not yet cancelled/acknowledged, absolute end instants. */
  readonly timers: readonly CookingTimer[];
  readonly started_at_utc: IsoUtcInstant;
  readonly updated_at_utc: IsoUtcInstant;
}

export type CookingEventPayload =
  | { readonly kind: 'session_started'; readonly recipe_id: Uuid; readonly target_servings: number }
  | { readonly kind: 'step_completed'; readonly step_index: number }
  | { readonly kind: 'timer_started'; readonly timer: CookingTimer }
  | { readonly kind: 'timer_cancelled'; readonly timer_id: Uuid }
  | { readonly kind: 'timer_acknowledged'; readonly timer_id: Uuid }
  | { readonly kind: 'session_paused'; readonly at_step_index: number }
  | { readonly kind: 'session_resumed'; readonly at_step_index: number }
  | { readonly kind: 'session_completed' }
  | { readonly kind: 'session_abandoned' };

export interface CookingEvent {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly session_id: Uuid;
  /** Monotonic per-session sequence number, starting at 1. */
  readonly seq: number;
  readonly occurred_at_utc: IsoUtcInstant;
  readonly payload: CookingEventPayload;
}

// ---------------------------------------------------------------------------
// Post-meal feedback (≤ 2 taps: verdict + at most one optional reason)
// ---------------------------------------------------------------------------

export type FeedbackVerdict = 'make_again' | 'it_was_fine' | 'not_again';

export type FeedbackReason =
  | 'too_much_work'
  | 'took_longer_than_expected'
  | 'too_bland'
  | 'too_spicy'
  | 'easy_with_interruptions'
  | 'not_filling';

export interface MealFeedback {
  readonly id: Uuid;
  readonly household_id: Uuid;
  readonly plan_meal_id: Uuid;
  readonly recipe_id: Uuid;
  readonly verdict: FeedbackVerdict;
  /** At most one optional reason (SPEC). */
  readonly reason: FeedbackReason | null;
  readonly created_at_utc: IsoUtcInstant;
}
