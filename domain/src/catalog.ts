/**
 * catalog.ts — the catalog validation gate + curated ingredient registry
 * parser (DESIGN.md Invariant 5, wave 1C).
 *
 * The gate EXCLUDES structurally incomplete recipes from recommendation and
 * returns per-recipe structured reasons; it never fails the build. A short
 * catalog is a graceful degradation — a broken one is not.
 *
 * A recipe is eligible only if, checked against the DATA (never merely the
 * type declarations):
 *   - quantities are complete: every line is exact / range / to_taste with
 *     exact positive Rational amounts (ranges ordered min ≤ max),
 *   - steps are strictly ordered: 0-based, contiguous, unique ids,
 *   - servings are known: positive integer `servings_default`,
 *   - dietary tags are verified: valid members, and not contradicted by any
 *     ingredient's allergen classes (or the recipe's own declared allergens),
 *   - all nine per-step interruption-metadata fields are present with their
 *     FROZEN shapes (decision D-7: `maximum_pause` is a union, never
 *     `maximum_pause_seconds`; `timer_duration_seconds: number | null`,
 *     never `timer_duration`; `recovery_instruction` is a union, never a
 *     bare string),
 *   - declared total/active time equals the per-step sums,
 *   - every `ingredient_id` resolves in the registry, and every allergen
 *     class any ingredient carries is declared on the recipe — an allergen
 *     can never hide behind an unverified tag.
 *
 * Registry ownership: `data/ingredients.json` is the single source of truth
 * for curated aliases, allergen classes, store sections, densities
 * (volume↔mass) and per-item weights (count↔mass). A density is NEVER
 * guessed: `null` is the representable absent state, and cross-dimension
 * conversion must then be reported separately, not invented.
 *
 * Invariant 1: all quantity and duration arithmetic goes through qty.ts.
 * Scope: imports only ./recipe.ts types and ./qty.ts — the units/normalize
 * conversion layer (wave 1A) CONSUMES this module's registry, not vice versa.
 */

import type {
  Allergen,
  AttributeVector,
  CookingMethod,
  CostBand,
  Cuisine,
  DietaryTag,
  EffortLevel,
  FlavourTag,
  IngredientId,
  IngredientQuantity,
  InterruptionRisk,
  MaximumPause,
  Protein,
  Recipe,
  RecipeIngredientLine,
  RecipeStep,
  RecoveryGuidance,
  Richness,
  SpiceLevel,
  StoreSection,
  TextureTag,
  Unit,
} from './recipe.ts';
import type { Rational } from './qty.ts';
import {
  QtyError,
  ZERO,
  add,
  compare,
  eq,
  fromInt,
  parseRational,
  rationalFromJson,
  sign,
  toMixedString,
} from './qty.ts';

// ---------------------------------------------------------------------------
// Ingredient registry
// ---------------------------------------------------------------------------

export interface IngredientRegistryEntry {
  readonly id: IngredientId;
  readonly display_name: string;
  /** Curated normalisation aliases; globally unique across ids + aliases. */
  readonly aliases: readonly string[];
  /** Allergen classes this ingredient carries. The gate cross-checks these
   * against every recipe's dietary tags and declared allergens. */
  readonly allergen_classes: readonly Allergen[];
  readonly store_section: StoreSection;
  /** Curated density in g/ml for volume↔mass conversion; null = no curated
   * value (never guessed — conversion must then be reported, not invented). */
  readonly density_g_per_ml: Rational | null;
  /** Curated weight of one item in grams for count↔mass conversion; null =
   * no curated value. */
  readonly per_item_weight_g: Rational | null;
}

export type IngredientRegistry = ReadonlyMap<IngredientId, IngredientRegistryEntry>;

export interface RegistryIssue {
  readonly path: string;
  readonly message: string;
}

/** Thrown when the curated registry itself is malformed. Unlike an
 * incomplete recipe (excluded gracefully), a corrupt registry cannot be
 * degraded around — every eligibility decision depends on it. */
export class CatalogDataError extends Error {
  readonly issues: readonly RegistryIssue[];
  constructor(issues: readonly RegistryIssue[]) {
    super(
      `ingredient registry is malformed (${String(issues.length)} issue(s)): ` +
        issues.map((i) => `${i.path}: ${i.message}`).join('; '),
    );
    this.name = 'CatalogDataError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Dietary-tag ↔ allergen-class cross-check table
// ---------------------------------------------------------------------------

/**
 * Allergen classes that CONTRADICT a dietary tag. The check is deliberately
 * one-directional: it can prove a tag is contradicted by an allergen class,
 * so an allergen can never hide behind an unverified tag. It cannot prove
 * e.g. meat-absence for `vegetarian` (meat is not an allergen class) — that
 * remains an authoring responsibility. Complete over DietaryTag by
 * construction (Record), so a new tag cannot be added without deciding its
 * forbidden classes.
 */
export const FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG: Readonly<
  Record<DietaryTag, readonly Allergen[]>
> = {
  vegetarian: ['fish', 'shellfish'],
  vegan: ['dairy', 'egg', 'fish', 'shellfish'],
  pescatarian: [],
  gluten_free: ['gluten', 'wheat'],
  dairy_free: ['dairy'],
  nut_free: ['peanut', 'tree_nut'],
  egg_free: ['egg'],
  soy_free: ['soy'],
  shellfish_free: ['shellfish'],
  low_carb: [],
};

// ---------------------------------------------------------------------------
// Gate result shapes — structured reasons, never a bare boolean
// ---------------------------------------------------------------------------

export type CatalogIssueCode =
  | 'malformed_recipe'
  | 'servings_unknown'
  | 'quantity_incomplete'
  | 'steps_missing'
  | 'steps_unordered'
  | 'interruption_metadata_incomplete'
  | 'time_totals_inconsistent'
  | 'invalid_dietary_tag'
  | 'unresolved_ingredient_id'
  | 'undeclared_allergen'
  | 'dietary_tag_contradicted'
  | 'duplicate_id';

export interface CatalogIssue {
  readonly code: CatalogIssueCode;
  /** JSON-path-ish locator, e.g. "steps[3].maximum_pause". */
  readonly path: string;
  readonly message: string;
}

export interface RecipeValidationReport {
  /** Best-effort id extracted from the data; null when unextractable. */
  readonly recipe_id: string | null;
  readonly slug: string | null;
  readonly eligible: boolean;
  /** Structured exclusion reasons; empty iff eligible. */
  readonly issues: readonly CatalogIssue[];
  /** The fully validated recipe; non-null iff eligible. */
  readonly recipe: Recipe | null;
}

export interface CatalogGateResult {
  /** Recipes eligible for recommendation, in input order. */
  readonly eligible: readonly Recipe[];
  /** One report per input, aligned by index. */
  readonly reports: readonly RecipeValidationReport[];
}

// ---------------------------------------------------------------------------
// Small structural helpers
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

function memberOf<T extends string>(allowed: readonly T[], v: unknown): T | null {
  for (const a of allowed) {
    if (a === v) return a;
  }
  return null;
}

/** Exact amount from either a `RationalJson` object or a `parseRational`
 * string ("3/4", "1 1/2", "0.5"). Returns null on anything else — a float
 * literal in the data is rejected, never coerced (Invariant 1). */
function parseExactAmount(v: unknown): Rational | null {
  try {
    if (typeof v === 'string') return parseRational(v);
    if (isJsonObject(v) && typeof v['num'] === 'string' && typeof v['den'] === 'string') {
      return rationalFromJson({ num: v['num'], den: v['den'] });
    }
  } catch (err) {
    if (err instanceof QtyError) return null;
    throw err;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Union membership tables (values mirror the frozen unions in recipe.ts)
// ---------------------------------------------------------------------------

const ALL_UNITS: readonly Unit[] = [
  'g', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'fl_oz', 'count',
];

const ALL_ALLERGENS: readonly Allergen[] = [
  'peanut', 'tree_nut', 'dairy', 'egg', 'gluten', 'wheat', 'soy', 'fish',
  'shellfish', 'sesame', 'mustard', 'sulfite',
];

const ALL_DIETARY_TAGS: readonly DietaryTag[] = [
  'vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free',
  'nut_free', 'egg_free', 'soy_free', 'shellfish_free', 'low_carb',
];

const ALL_STORE_SECTIONS: readonly StoreSection[] = [
  'produce', 'meat_seafood', 'dairy_eggs', 'bakery', 'frozen', 'canned',
  'dry_goods', 'spices', 'condiments', 'beverages', 'other',
];

const ALL_INTERRUPTION_RISKS: readonly InterruptionRisk[] = ['low', 'medium', 'high'];

const ALL_PROTEINS: readonly Protein[] = [
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'fish', 'shellfish', 'egg',
  'tofu', 'tempeh', 'legume', 'cheese', 'none',
];

const ALL_CUISINES: readonly Cuisine[] = [
  'italian', 'mexican', 'tex_mex', 'thai', 'vietnamese', 'chinese',
  'japanese', 'korean', 'indian', 'middle_eastern', 'north_african',
  'mediterranean', 'greek', 'french', 'spanish', 'american', 'cajun',
  'caribbean', 'british', 'german', 'other',
];

const ALL_FLAVOURS: readonly FlavourTag[] = [
  'savoury', 'umami', 'garlicky', 'herby', 'bright', 'tangy', 'sweet',
  'smoky', 'spicy', 'mild', 'fresh', 'earthy',
];

const ALL_TEXTURES: readonly TextureTag[] = [
  'crispy', 'creamy', 'tender', 'chewy', 'crunchy', 'saucy', 'brothy',
  'sticky', 'fluffy',
];

const ALL_SPICE_LEVELS: readonly SpiceLevel[] = ['none', 'mild', 'medium', 'hot'];

const ALL_RICHNESS: readonly Richness[] = ['light', 'medium', 'rich'];

const ALL_METHODS: readonly CookingMethod[] = [
  'stovetop', 'oven', 'sheet_pan', 'one_pot', 'stir_fry', 'braise', 'roast',
  'grill', 'broil', 'simmer', 'no_cook', 'assembly',
];

const ALL_EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high'];

const ALL_COST_BANDS: readonly CostBand[] = ['low', 'medium', 'high'];

const RE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Registry parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate the curated ingredient registry (`data/ingredients.json`
 * after `JSON.parse`). Throws `CatalogDataError` with every issue found.
 *
 * Enforced: unique ids, globally unique names (ids ∪ aliases,
 * case/whitespace-insensitive — a conversion layer must never face an
 * ambiguous alias), valid allergen classes and store sections, and curated
 * values that are either explicitly null or exact positive rationals. The
 * `density_g_per_ml` / `per_item_weight_g` keys must be PRESENT — omitting
 * one is an authoring error, `null` is the deliberate "no curated value".
 */
export function parseIngredientRegistry(data: unknown): IngredientRegistry {
  const issues: RegistryIssue[] = [];
  const fail = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!isJsonObject(data)) {
    throw new CatalogDataError([{ path: '', message: 'registry must be a JSON object' }]);
  }
  const rawList = data['ingredients'];
  if (!Array.isArray(rawList)) {
    throw new CatalogDataError([
      { path: 'ingredients', message: 'registry must carry an "ingredients" array' },
    ]);
  }

  const entries = new Map<IngredientId, IngredientRegistryEntry>();
  /** lower-trimmed name → claiming entry id, across ids AND aliases. */
  const claimedNames = new Map<string, string>();

  rawList.forEach((raw: unknown, i: number) => {
    const path = `ingredients[${String(i)}]`;
    if (!isJsonObject(raw)) {
      fail(path, 'entry must be an object');
      return;
    }

    const id = isNonEmptyString(raw['id']) ? raw['id'].trim() : null;
    if (id === null) fail(`${path}.id`, 'id must be a non-empty string');

    const displayName = isNonEmptyString(raw['display_name']) ? raw['display_name'] : null;
    if (displayName === null) fail(`${path}.display_name`, 'display_name must be a non-empty string');

    let aliases: readonly string[] | null = null;
    const rawAliases = raw['aliases'];
    if (Array.isArray(rawAliases) && rawAliases.every((a) => isNonEmptyString(a))) {
      aliases = rawAliases.map((a) => a.trim());
    } else {
      fail(`${path}.aliases`, 'aliases must be an array of non-empty strings');
    }

    let allergenClasses: readonly Allergen[] | null = null;
    const rawClasses = raw['allergen_classes'];
    if (Array.isArray(rawClasses)) {
      const parsed: Allergen[] = [];
      let ok = true;
      rawClasses.forEach((c: unknown, j: number) => {
        const m = memberOf(ALL_ALLERGENS, c);
        if (m === null) {
          fail(`${path}.allergen_classes[${String(j)}]`, `invalid allergen class ${JSON.stringify(c)}`);
          ok = false;
        } else {
          parsed.push(m);
        }
      });
      if (ok) allergenClasses = parsed;
    } else {
      fail(`${path}.allergen_classes`, 'allergen_classes must be an array');
    }

    const storeSection = memberOf(ALL_STORE_SECTIONS, raw['store_section']);
    if (storeSection === null) {
      fail(`${path}.store_section`, `invalid store_section ${JSON.stringify(raw['store_section'])}`);
    }

    const density = parseCuratedRational(raw, 'density_g_per_ml', path, fail);
    const perItem = parseCuratedRational(raw, 'per_item_weight_g', path, fail);

    if (id !== null && aliases !== null) {
      for (const name of [id, ...aliases]) {
        const key = name.toLowerCase();
        const owner = claimedNames.get(key);
        if (owner !== undefined) {
          fail(`${path}`, `name ${JSON.stringify(name)} collides with entry '${owner}' — ids and aliases must be globally unique`);
        } else {
          claimedNames.set(key, id);
        }
      }
    }

    if (
      id !== null &&
      displayName !== null &&
      aliases !== null &&
      allergenClasses !== null &&
      storeSection !== null &&
      density.ok &&
      perItem.ok &&
      !entries.has(id)
    ) {
      entries.set(id, {
        id,
        display_name: displayName,
        aliases,
        allergen_classes: allergenClasses,
        store_section: storeSection,
        density_g_per_ml: density.value,
        per_item_weight_g: perItem.value,
      });
    }
  });

  if (issues.length > 0) throw new CatalogDataError(issues);
  return entries;
}

function parseCuratedRational(
  obj: JsonObject,
  key: string,
  path: string,
  fail: (path: string, message: string) => void,
): { readonly ok: boolean; readonly value: Rational | null } {
  if (!(key in obj)) {
    fail(`${path}.${key}`, `${key} must be present — write null explicitly when no curated value exists`);
    return { ok: false, value: null };
  }
  const v = obj[key];
  if (v === null) return { ok: true, value: null };
  const r = parseExactAmount(v);
  if (r === null || sign(r) !== 1) {
    fail(`${path}.${key}`, `${key} must be null or an exact positive rational (e.g. "91/100" or {"num":"91","den":"100"})`);
    return { ok: false, value: null };
  }
  return { ok: true, value: r };
}

// ---------------------------------------------------------------------------
// Recipe validation
// ---------------------------------------------------------------------------

type Push = (code: CatalogIssueCode, path: string, message: string) => void;

/**
 * Validate ONE recipe's raw data (post-`JSON.parse`) against the frozen
 * `Recipe` contract and the ingredient registry. Never throws on bad recipe
 * data — every defect becomes a structured `CatalogIssue`.
 */
export function validateRecipe(data: unknown, registry: IngredientRegistry): RecipeValidationReport {
  const issues: CatalogIssue[] = [];
  const push: Push = (code, path, message) => {
    issues.push({ code, path, message });
  };

  if (!isJsonObject(data)) {
    push('malformed_recipe', '', 'recipe must be a JSON object');
    return { recipe_id: null, slug: null, eligible: false, issues, recipe: null };
  }

  const id = isNonEmptyString(data['id']) ? data['id'] : null;
  if (id === null) push('malformed_recipe', 'id', 'id must be a non-empty string');

  const rawSlug = data['slug'];
  const slug = typeof rawSlug === 'string' && RE_SLUG.test(rawSlug) ? rawSlug : null;
  if (slug === null) {
    push('malformed_recipe', 'slug', 'slug must be a lowercase url-safe string, e.g. "sheet-pan-lemon-chicken"');
  }

  const name = isNonEmptyString(data['name']) ? data['name'] : null;
  if (name === null) push('malformed_recipe', 'name', 'name must be a non-empty string');

  const description = typeof data['description'] === 'string' ? data['description'] : null;
  if (description === null) push('malformed_recipe', 'description', 'description must be a string');

  // Servings known: positive integer (SPEC gate criterion).
  const servings = isPositiveInt(data['servings_default']) ? data['servings_default'] : null;
  if (servings === null) {
    push('servings_unknown', 'servings_default', 'servings_default must be a positive integer — a recipe with unknown servings cannot be scaled');
  }

  const attributes = validateAttributes(data['attributes'], push);
  const dietaryTags = validateDietaryTags(data['dietary_tags'], push);
  const declaredAllergens = validateDeclaredAllergens(data['allergens'], push);
  const equipment = validateStringList(data['equipment'], 'equipment', push);

  const costBand = memberOf(ALL_COST_BANDS, data['cost_band']);
  if (costBand === null) push('malformed_recipe', 'cost_band', `invalid cost_band ${JSON.stringify(data['cost_band'])}`);

  const dishCount = isNonNegativeInt(data['dish_count']) ? data['dish_count'] : null;
  if (dishCount === null) push('malformed_recipe', 'dish_count', 'dish_count must be a non-negative integer');

  const totalTime = isNonNegativeInt(data['total_time_seconds']) ? data['total_time_seconds'] : null;
  if (totalTime === null) push('malformed_recipe', 'total_time_seconds', 'total_time_seconds must be a non-negative integer');

  const activeTime = isNonNegativeInt(data['active_time_seconds']) ? data['active_time_seconds'] : null;
  if (activeTime === null) push('malformed_recipe', 'active_time_seconds', 'active_time_seconds must be a non-negative integer');

  const ingredients = validateIngredientLines(data['ingredients'], push);
  const steps = validateSteps(data['steps'], push);

  // Declared totals must equal the per-step sums (recipe.ts contract).
  // All duration arithmetic through qty.ts (Invariant 1).
  if (steps !== null && totalTime !== null && activeTime !== null) {
    let activeSum = ZERO;
    let totalSum = ZERO;
    for (const s of steps) {
      const a = fromInt(s.active_duration_seconds);
      const u = fromInt(s.unattended_duration_seconds);
      activeSum = add(activeSum, a);
      totalSum = add(totalSum, add(a, u));
    }
    if (!eq(fromInt(activeTime), activeSum)) {
      push('time_totals_inconsistent', 'active_time_seconds', `declared ${String(activeTime)}s but per-step active durations sum to ${toMixedString(activeSum)}s`);
    }
    if (!eq(fromInt(totalTime), totalSum)) {
      push('time_totals_inconsistent', 'total_time_seconds', `declared ${String(totalTime)}s but per-step active+unattended durations sum to ${toMixedString(totalSum)}s`);
    }
  }

  // Registry resolution + allergen-class cross-check. An allergen can never
  // hide behind an unverified tag: every carried class must be declared, and
  // no tag may be contradicted by a carried OR declared class.
  if (ingredients !== null) {
    const carriersByClass = new Map<Allergen, string[]>();
    ingredients.forEach((line, i) => {
      const entry = registry.get(line.ingredient_id);
      if (entry === undefined) {
        push('unresolved_ingredient_id', `ingredients[${String(i)}].ingredient_id`, `ingredient id '${line.ingredient_id}' does not resolve in the registry`);
        return;
      }
      for (const c of entry.allergen_classes) {
        const carriers = carriersByClass.get(c) ?? [];
        carriers.push(line.ingredient_id);
        carriersByClass.set(c, carriers);
      }
    });

    if (declaredAllergens !== null) {
      for (const [c, carriers] of carriersByClass) {
        if (!declaredAllergens.includes(c)) {
          push('undeclared_allergen', 'allergens', `allergen class '${c}' (carried by ${carriers.join(', ')}) is not declared on the recipe`);
        }
      }
      if (dietaryTags !== null) {
        for (const tag of dietaryTags) {
          for (const c of FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG[tag]) {
            const carriers = carriersByClass.get(c);
            if (carriers !== undefined) {
              push('dietary_tag_contradicted', 'dietary_tags', `tag '${tag}' is contradicted: ${carriers.join(', ')} carries allergen class '${c}'`);
            } else if (declaredAllergens.includes(c)) {
              push('dietary_tag_contradicted', 'dietary_tags', `tag '${tag}' is contradicted by the recipe's own declared allergen '${c}'`);
            }
          }
        }
      }
    }
  }

  let recipe: Recipe | null = null;
  if (
    issues.length === 0 &&
    id !== null &&
    slug !== null &&
    name !== null &&
    description !== null &&
    servings !== null &&
    attributes !== null &&
    dietaryTags !== null &&
    declaredAllergens !== null &&
    equipment !== null &&
    costBand !== null &&
    dishCount !== null &&
    totalTime !== null &&
    activeTime !== null &&
    ingredients !== null &&
    steps !== null
  ) {
    recipe = {
      id,
      slug,
      name,
      description,
      servings_default: servings,
      attributes,
      dietary_tags: dietaryTags,
      allergens: declaredAllergens,
      equipment,
      cost_band: costBand,
      dish_count: dishCount,
      total_time_seconds: totalTime,
      active_time_seconds: activeTime,
      ingredients,
      steps,
    };
  }

  return { recipe_id: id, slug, eligible: recipe !== null, issues, recipe };
}

/**
 * Gate a whole catalog: validate every raw recipe, then enforce unique
 * ids/slugs across the catalog (first occurrence wins; later duplicates are
 * excluded). Never throws on bad recipe data — exclusion with structured
 * reasons IS the failure mode (graceful degradation, DESIGN.md).
 */
export function gateCatalog(catalog: readonly unknown[], registry: IngredientRegistry): CatalogGateResult {
  const reports: RecipeValidationReport[] = [];
  const seenIds = new Set<string>();
  const seenSlugs = new Set<string>();

  for (const data of catalog) {
    let report = validateRecipe(data, registry);
    const recipe = report.recipe;
    if (recipe !== null) {
      const dupIssues: CatalogIssue[] = [];
      if (seenIds.has(recipe.id)) {
        dupIssues.push({ code: 'duplicate_id', path: 'id', message: `recipe id '${recipe.id}' duplicates an earlier catalog entry` });
      }
      if (seenSlugs.has(recipe.slug)) {
        dupIssues.push({ code: 'duplicate_id', path: 'slug', message: `recipe slug '${recipe.slug}' duplicates an earlier catalog entry` });
      }
      if (dupIssues.length > 0) {
        report = { ...report, eligible: false, recipe: null, issues: [...report.issues, ...dupIssues] };
      } else {
        seenIds.add(recipe.id);
        seenSlugs.add(recipe.slug);
      }
    }
    reports.push(report);
  }

  return {
    reports,
    eligible: reports.flatMap((r) => (r.recipe === null ? [] : [r.recipe])),
  };
}

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

function validateStringList(v: unknown, path: string, push: Push): readonly string[] | null {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.map((x) => x);
  push('malformed_recipe', path, `${path} must be an array of strings`);
  return null;
}

function validateDietaryTags(v: unknown, push: Push): readonly DietaryTag[] | null {
  if (!Array.isArray(v)) {
    push('invalid_dietary_tag', 'dietary_tags', 'dietary_tags must be an array');
    return null;
  }
  const out: DietaryTag[] = [];
  let ok = true;
  v.forEach((x: unknown, i: number) => {
    const m = memberOf(ALL_DIETARY_TAGS, x);
    if (m === null) {
      push('invalid_dietary_tag', `dietary_tags[${String(i)}]`, `${JSON.stringify(x)} is not a verifiable dietary tag`);
      ok = false;
    } else if (out.includes(m)) {
      push('invalid_dietary_tag', `dietary_tags[${String(i)}]`, `duplicate dietary tag '${m}'`);
      ok = false;
    } else {
      out.push(m);
    }
  });
  return ok ? out : null;
}

function validateDeclaredAllergens(v: unknown, push: Push): readonly Allergen[] | null {
  if (!Array.isArray(v)) {
    push('malformed_recipe', 'allergens', 'allergens must be an array');
    return null;
  }
  const out: Allergen[] = [];
  let ok = true;
  v.forEach((x: unknown, i: number) => {
    const m = memberOf(ALL_ALLERGENS, x);
    if (m === null) {
      push('malformed_recipe', `allergens[${String(i)}]`, `invalid allergen ${JSON.stringify(x)}`);
      ok = false;
    } else if (!out.includes(m)) {
      out.push(m);
    }
  });
  return ok ? out : null;
}

function validateAttributes(v: unknown, push: Push): AttributeVector | null {
  if (!isJsonObject(v)) {
    push('malformed_recipe', 'attributes', 'attributes must be an object (the eight-axis vector)');
    return null;
  }
  const protein = required(memberOf(ALL_PROTEINS, v['protein']), 'attributes.protein', push);
  const cuisine = required(memberOf(ALL_CUISINES, v['cuisine']), 'attributes.cuisine', push);
  const flavour = memberArray(ALL_FLAVOURS, v['flavour'], 'attributes.flavour', push);
  const texture = memberArray(ALL_TEXTURES, v['texture'], 'attributes.texture', push);
  const spice = required(memberOf(ALL_SPICE_LEVELS, v['spice']), 'attributes.spice', push);
  const richness = required(memberOf(ALL_RICHNESS, v['richness']), 'attributes.richness', push);
  const method = required(memberOf(ALL_METHODS, v['method']), 'attributes.method', push);
  const effort = required(memberOf(ALL_EFFORTS, v['effort']), 'attributes.effort', push);
  if (
    protein === null || cuisine === null || flavour === null || texture === null ||
    spice === null || richness === null || method === null || effort === null
  ) {
    return null;
  }
  return { protein, cuisine, flavour, texture, spice, richness, method, effort };
}

function required<T>(v: T | null, path: string, push: Push): T | null {
  if (v === null) push('malformed_recipe', path, `${path} is missing or not a valid member of its union`);
  return v;
}

function memberArray<T extends string>(
  allowed: readonly T[],
  v: unknown,
  path: string,
  push: Push,
): readonly T[] | null {
  if (!Array.isArray(v)) {
    push('malformed_recipe', path, `${path} must be an array`);
    return null;
  }
  const out: T[] = [];
  let ok = true;
  v.forEach((x: unknown, i: number) => {
    const m = memberOf(allowed, x);
    if (m === null) {
      push('malformed_recipe', `${path}[${String(i)}]`, `invalid value ${JSON.stringify(x)}`);
      ok = false;
    } else {
      out.push(m);
    }
  });
  return ok ? out : null;
}

// --- ingredient lines -------------------------------------------------------

function validateIngredientLines(v: unknown, push: Push): readonly RecipeIngredientLine[] | null {
  if (!Array.isArray(v) || v.length === 0) {
    push('malformed_recipe', 'ingredients', 'ingredients must be a non-empty array of lines');
    return null;
  }
  const out: RecipeIngredientLine[] = [];
  const seenLineIds = new Set<string>();
  let ok = true;
  v.forEach((raw: unknown, i: number) => {
    const line = validateIngredientLine(raw, i, seenLineIds, push);
    if (line === null) ok = false;
    else out.push(line);
  });
  return ok ? out : null;
}

function validateIngredientLine(
  raw: unknown,
  i: number,
  seenLineIds: Set<string>,
  push: Push,
): RecipeIngredientLine | null {
  const path = `ingredients[${String(i)}]`;
  if (!isJsonObject(raw)) {
    push('malformed_recipe', path, 'ingredient line must be an object');
    return null;
  }
  let ok = true;

  const lineId = isNonEmptyString(raw['id']) ? raw['id'] : null;
  if (lineId === null) {
    push('malformed_recipe', `${path}.id`, 'line id must be a non-empty string');
    ok = false;
  } else if (seenLineIds.has(lineId)) {
    push('duplicate_id', `${path}.id`, `line id '${lineId}' duplicates another line in this recipe`);
    ok = false;
  } else {
    seenLineIds.add(lineId);
  }

  const ingredientId = isNonEmptyString(raw['ingredient_id']) ? raw['ingredient_id'] : null;
  if (ingredientId === null) {
    push('malformed_recipe', `${path}.ingredient_id`, 'ingredient_id must be a non-empty string');
    ok = false;
  }

  const displayName = isNonEmptyString(raw['display_name']) ? raw['display_name'] : null;
  if (displayName === null) {
    push('malformed_recipe', `${path}.display_name`, 'display_name must be a non-empty string');
    ok = false;
  }

  const quantity = validateQuantity(raw['quantity'], `${path}.quantity`, push);
  if (quantity === null) ok = false;

  const rawPrep = raw['preparation'];
  let preparation: string | null = null;
  if (rawPrep !== null && rawPrep !== undefined) {
    if (isNonEmptyString(rawPrep)) {
      preparation = rawPrep;
    } else {
      push('malformed_recipe', `${path}.preparation`, 'preparation must be null or a non-empty string');
      ok = false;
    }
  } else if (rawPrep === undefined) {
    push('malformed_recipe', `${path}.preparation`, 'preparation must be present — null means "no preparation state"');
    ok = false;
  }

  const optional = raw['optional'];
  if (typeof optional !== 'boolean') {
    push('malformed_recipe', `${path}.optional`, 'optional must be a boolean');
    ok = false;
  }

  if (!ok || lineId === null || ingredientId === null || displayName === null || quantity === null || typeof optional !== 'boolean') {
    return null;
  }
  return { id: lineId, ingredient_id: ingredientId, display_name: displayName, quantity, preparation, optional };
}

/** Quantities are COMPLETE or the recipe is out: exact positive amounts with
 * a valid unit; ranges ordered min ≤ max; `to_taste` explicit — never a
 * missing field, never a float, never folded into arithmetic. */
function validateQuantity(v: unknown, path: string, push: Push): IngredientQuantity | null {
  if (!isJsonObject(v)) {
    push('quantity_incomplete', path, 'quantity must be an object with a kind of exact | range | to_taste');
    return null;
  }
  const kind = v['kind'];
  if (kind === 'to_taste') {
    return { kind: 'to_taste' };
  }
  if (kind === 'exact') {
    const amount = parseExactAmount(v['amount']);
    const unit = memberOf(ALL_UNITS, v['unit']);
    if (amount === null || sign(amount) !== 1) {
      push('quantity_incomplete', `${path}.amount`, 'exact amount must be a positive exact rational (RationalJson or "1 1/2")');
      return null;
    }
    if (unit === null) {
      push('quantity_incomplete', `${path}.unit`, `invalid unit ${JSON.stringify(v['unit'])}`);
      return null;
    }
    return { kind: 'exact', amount, unit };
  }
  if (kind === 'range') {
    const min = parseExactAmount(v['min']);
    const max = parseExactAmount(v['max']);
    const unit = memberOf(ALL_UNITS, v['unit']);
    if (min === null || max === null || sign(min) !== 1 || sign(max) !== 1) {
      push('quantity_incomplete', path, 'range min and max must both be positive exact rationals');
      return null;
    }
    if (unit === null) {
      push('quantity_incomplete', `${path}.unit`, `invalid unit ${JSON.stringify(v['unit'])}`);
      return null;
    }
    if (compare(min, max) === 1) {
      push('quantity_incomplete', path, 'range min must not exceed max');
      return null;
    }
    return { kind: 'range', min, max, unit };
  }
  push('quantity_incomplete', path, `unknown quantity kind ${JSON.stringify(kind)}`);
  return null;
}

// --- steps ------------------------------------------------------------------

function validateSteps(v: unknown, push: Push): readonly RecipeStep[] | null {
  if (!Array.isArray(v) || v.length === 0) {
    push('steps_missing', 'steps', 'steps must be a non-empty array');
    return null;
  }
  const out: RecipeStep[] = [];
  const seenStepIds = new Set<string>();
  let ok = true;
  v.forEach((raw: unknown, i: number) => {
    const step = validateStep(raw, i, seenStepIds, push);
    if (step === null) ok = false;
    else out.push(step);
  });
  return ok ? out : null;
}

function validateStep(raw: unknown, i: number, seenStepIds: Set<string>, push: Push): RecipeStep | null {
  const path = `steps[${String(i)}]`;
  if (!isJsonObject(raw)) {
    push('malformed_recipe', path, 'step must be an object');
    return null;
  }
  let ok = true;

  const stepId = isNonEmptyString(raw['id']) ? raw['id'] : null;
  if (stepId === null) {
    push('malformed_recipe', `${path}.id`, 'step id must be a non-empty string');
    ok = false;
  } else if (seenStepIds.has(stepId)) {
    push('duplicate_id', `${path}.id`, `step id '${stepId}' duplicates another step in this recipe`);
    ok = false;
  } else {
    seenStepIds.add(stepId);
  }

  // Strict ordering: 0-based, contiguous — index must equal position.
  const index = raw['index'];
  if (!isNonNegativeInt(index) || index !== i) {
    push('steps_unordered', `${path}.index`, `steps must be strictly ordered and contiguous from 0 — expected index ${String(i)}, got ${JSON.stringify(index)}`);
    ok = false;
  }

  const instruction = isNonEmptyString(raw['instruction']) ? raw['instruction'] : null;
  if (instruction === null) {
    push('malformed_recipe', `${path}.instruction`, 'instruction must be a non-empty string');
    ok = false;
  }

  const rawEquipment = raw['equipment'];
  let equipment: readonly string[] | null = null;
  if (Array.isArray(rawEquipment) && rawEquipment.every((x) => typeof x === 'string')) {
    equipment = rawEquipment.map((x) => x);
  } else {
    push('malformed_recipe', `${path}.equipment`, 'equipment must be an array of strings');
    ok = false;
  }

  // --- the nine required interruption-metadata fields (Invariant 6). The
  // gate proves the DATA carries them — a hole here is exactly the 5am DoD 9
  // failure Invariant 5 exists to prevent.
  const active = metaSeconds(raw, 'active_duration_seconds', path, push);
  const unattended = metaSeconds(raw, 'unattended_duration_seconds', path, push);
  const continuous = metaBool(raw, 'requires_continuous_attention', path, push);
  const pauseBefore = metaBool(raw, 'safe_to_pause_before', path, push);
  const pauseDuring = metaBool(raw, 'safe_to_pause_during', path, push);
  const pauseAfter = metaBool(raw, 'safe_to_pause_after', path, push);
  const maximumPause = metaMaximumPause(raw, path, push);
  const stoppingPoint = metaBool(raw, 'natural_stopping_point', path, push);
  const risk = metaRisk(raw, path, push);
  const recovery = metaRecovery(raw, path, push);
  const timer = metaTimer(raw, path, push);

  if (
    !ok ||
    stepId === null ||
    instruction === null ||
    equipment === null ||
    active === null ||
    unattended === null ||
    continuous === null ||
    pauseBefore === null ||
    pauseDuring === null ||
    pauseAfter === null ||
    maximumPause === null ||
    stoppingPoint === null ||
    risk === null ||
    recovery === null ||
    !timer.ok
  ) {
    return null;
  }

  return {
    id: stepId,
    index: i,
    instruction,
    equipment,
    active_duration_seconds: active,
    unattended_duration_seconds: unattended,
    requires_continuous_attention: continuous,
    safe_to_pause_before: pauseBefore,
    safe_to_pause_during: pauseDuring,
    safe_to_pause_after: pauseAfter,
    maximum_pause: maximumPause,
    natural_stopping_point: stoppingPoint,
    interruption_risk: risk,
    recovery_instruction: recovery,
    timer_duration_seconds: timer.value,
  };
}

function metaMissing(key: string, present: boolean): string {
  return present
    ? `interruption-metadata field '${key}' has an invalid shape`
    : `required interruption-metadata field '${key}' is missing`;
}

function metaSeconds(o: JsonObject, key: string, path: string, push: Push): number | null {
  const v = o[key];
  if (isNonNegativeInt(v)) return v;
  push('interruption_metadata_incomplete', `${path}.${key}`, `${metaMissing(key, v !== undefined)} — must be a non-negative integer number of seconds`);
  return null;
}

function metaBool(o: JsonObject, key: string, path: string, push: Push): boolean | null {
  const v = o[key];
  if (typeof v === 'boolean') return v;
  push('interruption_metadata_incomplete', `${path}.${key}`, `${metaMissing(key, v !== undefined)} — must be a boolean`);
  return null;
}

function metaRisk(o: JsonObject, path: string, push: Push): InterruptionRisk | null {
  const v = o['interruption_risk'];
  const m = memberOf(ALL_INTERRUPTION_RISKS, v);
  if (m !== null) return m;
  push('interruption_metadata_incomplete', `${path}.interruption_risk`, `${metaMissing('interruption_risk', v !== undefined)} — must be low | medium | high`);
  return null;
}

/** D-7: `maximum_pause` union — never SPEC.md's `maximum_pause_seconds`. */
function metaMaximumPause(o: JsonObject, path: string, push: Push): MaximumPause | null {
  const v = o['maximum_pause'];
  if (isJsonObject(v)) {
    if (v['kind'] === 'unlimited') return { kind: 'unlimited' };
    if (v['kind'] === 'bounded' && isNonNegativeInt(v['seconds'])) {
      return { kind: 'bounded', seconds: v['seconds'] };
    }
  }
  push('interruption_metadata_incomplete', `${path}.maximum_pause`, `${metaMissing('maximum_pause', v !== undefined)} — must be {kind:"bounded",seconds} or {kind:"unlimited"} (decision D-7, not maximum_pause_seconds)`);
  return null;
}

/** D-7: `recovery_instruction` union — an explicit `none_available`, never a
 * bare string and never an absent field (guidance is never fabricated). */
function metaRecovery(o: JsonObject, path: string, push: Push): RecoveryGuidance | null {
  const v = o['recovery_instruction'];
  if (isJsonObject(v)) {
    if (v['kind'] === 'none_available') return { kind: 'none_available' };
    if (v['kind'] === 'instruction' && isNonEmptyString(v['text'])) {
      return { kind: 'instruction', text: v['text'] };
    }
  }
  push('interruption_metadata_incomplete', `${path}.recovery_instruction`, `${metaMissing('recovery_instruction', v !== undefined)} — must be {kind:"instruction",text} or {kind:"none_available"} (decision D-7, never a bare string)`);
  return null;
}

/** D-7: `timer_duration_seconds: number | null` — never `timer_duration`.
 * null is the explicit "no timer"; a present timer must be ≥ 1 second. */
function metaTimer(
  o: JsonObject,
  path: string,
  push: Push,
): { readonly ok: boolean; readonly value: number | null } {
  const present = 'timer_duration_seconds' in o;
  const v = o['timer_duration_seconds'];
  if (present && v === null) return { ok: true, value: null };
  if (present && isPositiveInt(v)) return { ok: true, value: v };
  push('interruption_metadata_incomplete', `${path}.timer_duration_seconds`, `${metaMissing('timer_duration_seconds', present)} — must be a positive integer or an explicit null (decision D-7, not timer_duration)`);
  return { ok: false, value: null };
}
