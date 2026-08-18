/**
 * normalize.ts — free ingredient text → canonical ingredient id (wave 1A).
 *
 * CONSUMES the curated registry owned by `domain/src/catalog.ts` (sourced
 * from `data/ingredients.json`, the single source of truth — Invariant 5).
 * This module re-declares NO aliases, densities or per-item weights; it only
 * matches text against what the registry curates.
 *
 * Normalisation pipeline (in order): lowercase + collapse whitespace, strip
 * the trailing preparation phrase after the first comma, strip leading
 * articles, leading quantities ("3", "1 1/2", "2-3", "0.5", "½") and leading
 * measure words ("cloves", "cups", optionally followed by "of"), singularise
 * each word, and drop curated modifier words ("fresh", "organic", "large").
 *
 * Matching is graded — the confidence is an exact Rational, never a float:
 *   exact id hit (1) > exact alias hit (19/20) > normalised-form hit (4/5).
 * An input that resolves to nothing returns an explicit `unmatched` result
 * carrying the normalised form so a human can see WHY — never a best-guess
 * id. A normalised form claimed by two different registry entries returns
 * `unmatched_ambiguous` naming every candidate — never a coin flip.
 */

import type { Rational } from './qty.ts';
import { ONE, rational } from './qty.ts';
import type { IngredientId } from './recipe.ts';
import type { IngredientRegistry } from './catalog.ts';

// ---------------------------------------------------------------------------
// Result union — callers must handle every branch; no null, no exception
// ---------------------------------------------------------------------------

/** How the match was made, in strictly decreasing confidence order. */
export type MatchGrade = 'exact_id' | 'exact_alias' | 'normalized_form';

export type NormalizeResult =
  | {
      readonly kind: 'matched';
      readonly ingredient_id: IngredientId;
      /** Exact graded confidence: exact_id 1 > exact_alias 19/20 > normalized_form 4/5. */
      readonly confidence: Rational;
      readonly grade: MatchGrade;
      readonly normalized_form: string;
    }
  | {
      /** No registry entry claims this text. The normalised form is carried
       * so a human can see exactly what failed to resolve. */
      readonly kind: 'unmatched';
      readonly normalized_form: string;
    }
  | {
      /** Two or more entries claim the normalised form. Never resolved by a
       * coin flip — every candidate is named, deterministically ordered. */
      readonly kind: 'unmatched_ambiguous';
      readonly normalized_form: string;
      readonly candidates: readonly IngredientId[];
    };

export const CONFIDENCE_EXACT_ID: Rational = ONE;
export const CONFIDENCE_EXACT_ALIAS: Rational = rational(19n, 20n);
export const CONFIDENCE_NORMALIZED_FORM: Rational = rational(4n, 5n);

// ---------------------------------------------------------------------------
// Curated word lists (matching-time vocabulary, NOT ingredient data — the
// ingredient data itself lives only in data/ingredients.json)
// ---------------------------------------------------------------------------

const ARTICLES: ReadonlySet<string> = new Set(['a', 'an', 'the']);

/** Unit words and count-nouns that may precede an ingredient name,
 * compared after singularisation ("cloves" → "clove"). */
const MEASURE_WORDS: ReadonlySet<string> = new Set([
  // unit words
  'g', 'gram', 'kg', 'kilogram', 'oz', 'ounce', 'lb', 'pound',
  'ml', 'milliliter', 'millilitre', 'l', 'liter', 'litre',
  'tsp', 'teaspoon', 'tbsp', 'tablespoon', 'cup', 'fl',
  'pinch', 'dash', 'handful',
  // count-nouns
  'clove', 'head', 'bunch', 'stalk', 'sprig', 'rib', 'can', 'jar',
  'slice', 'piece', 'ear', 'stick', 'fillet', 'bulb', 'knob',
]);

/** Modifier words dropped anywhere in the normalised form. Deliberately
 * small: words like "boneless" or "whole" distinguish real entries. */
const MODIFIER_WORDS: ReadonlySet<string> = new Set([
  'fresh', 'organic', 'large', 'small', 'medium', 'ripe', 'extra',
]);

/** Words a naive singulariser would mangle; kept as-is. */
const KEEP_SINGULAR: ReadonlySet<string> = new Set([
  'couscous', 'asparagus', 'hummus', 'molasses',
]);

// ---------------------------------------------------------------------------
// Text pipeline
// ---------------------------------------------------------------------------

const RE_WHITESPACE = /\s+/g;
/** "3", "12", "0.5", ".5", "3/4", "1½", "½" — a single quantity token. */
const RE_NUMBER_TOKEN = /^(?:\d*\.\d+|\d+(?:[./]\d+)?|\d*[½⅓⅔¼¾⅛⅜⅝⅞])$/;
/** "2-3", "1.5-2" — a numeric range token. */
const RE_RANGE_TOKEN = /^\d+(?:[./]\d+)?[-–—]\d+(?:[./]\d+)?$/;

function collapse(s: string): string {
  return s.replace(RE_WHITESPACE, ' ').trim();
}

/** Lowercase, collapse whitespace. The "as written" folded form used for
 * exact id/alias matching. */
export function foldIngredientText(text: string): string {
  return collapse(text.toLowerCase());
}

/** Naive English singular: "cloves"→"clove", "tomatoes"→"tomato",
 * "berries"→"berry"; leaves "couscous"/"hummus"-class words alone. */
function singularizeWord(word: string): string {
  if (KEEP_SINGULAR.has(word)) return word;
  if (word.length > 3 && /ies$/.test(word)) return word.replace(/ies$/, 'y');
  if (/(?:sh|ch|ss|x|z|o)es$/.test(word)) return word.replace(/es$/, '');
  if (/(?:ss|us|is)$/.test(word)) return word;
  if (/s$/.test(word)) return word.replace(/s$/, '');
  return word;
}

function isQuantityToken(token: string): boolean {
  return RE_NUMBER_TOKEN.test(token) || RE_RANGE_TOKEN.test(token);
}

/**
 * The full normalisation pipeline (module docs). Pure text → text; returns
 * '' when nothing but quantities/units remained.
 */
export function normalizeIngredientText(text: string): string {
  const folded = foldIngredientText(text);
  // Strip the trailing preparation phrase: everything after the first comma.
  const beforeComma = folded.split(',')[0] ?? '';
  // Punctuation that should not glue tokens together.
  const cleaned = collapse(beforeComma.replace(/[().]/g, ' '));
  if (cleaned === '') return '';

  const tokens = cleaned.split(' ');
  while (tokens.length > 0 && ARTICLES.has(tokens[0] ?? '')) tokens.shift();
  while (tokens.length > 0 && isQuantityToken(tokens[0] ?? '')) tokens.shift();
  let droppedMeasure = false;
  while (tokens.length > 0 && MEASURE_WORDS.has(singularizeWord(tokens[0] ?? ''))) {
    tokens.shift();
    droppedMeasure = true;
  }
  if (droppedMeasure && tokens[0] === 'of') tokens.shift();

  const kept = tokens
    .map(singularizeWord)
    .filter((t) => t !== '' && !MODIFIER_WORDS.has(t));
  return kept.join(' ');
}

// ---------------------------------------------------------------------------
// Registry-derived match index (cached per registry instance)
// ---------------------------------------------------------------------------

interface MatchIndex {
  /** folded alias → owning id (globally unique — catalog.ts enforces it). */
  readonly aliasToId: ReadonlyMap<string, IngredientId>;
  /** normalised form → every id that claims it (ids AND aliases). */
  readonly normalizedToIds: ReadonlyMap<string, readonly IngredientId[]>;
}

const INDEX_CACHE = new WeakMap<IngredientRegistry, MatchIndex>();

function idAsText(id: IngredientId): string {
  return id.replace(/_/g, ' ');
}

function buildIndex(registry: IngredientRegistry): MatchIndex {
  const aliasToId = new Map<string, IngredientId>();
  const normalizedToIds = new Map<string, IngredientId[]>();
  for (const entry of registry.values()) {
    for (const alias of entry.aliases) {
      aliasToId.set(foldIngredientText(alias), entry.id);
    }
    const forms = new Set<string>();
    forms.add(normalizeIngredientText(idAsText(entry.id)));
    for (const alias of entry.aliases) {
      forms.add(normalizeIngredientText(alias));
    }
    forms.delete('');
    for (const form of forms) {
      const claimants = normalizedToIds.get(form);
      if (claimants === undefined) {
        normalizedToIds.set(form, [entry.id]);
      } else if (!claimants.includes(entry.id)) {
        claimants.push(entry.id);
      }
    }
  }
  return { aliasToId, normalizedToIds };
}

function indexFor(registry: IngredientRegistry): MatchIndex {
  const cached = INDEX_CACHE.get(registry);
  if (cached !== undefined) return cached;
  const built = buildIndex(registry);
  INDEX_CACHE.set(registry, built);
  return built;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Resolve free ingredient text against the curated registry.
 *
 * Grading: an input that IS an id ("garlic", "olive oil" → `olive_oil`)
 * matches at confidence 1; an input that IS a curated alias matches at
 * 19/20; an input whose normalised form equals an entry's normalised
 * id/alias matches at 4/5. Anything else is `unmatched` (with the
 * normalised form) or `unmatched_ambiguous` (with all candidates) — a
 * best-guess id is never returned.
 */
export function matchIngredient(text: string, registry: IngredientRegistry): NormalizeResult {
  const index = indexFor(registry);
  const folded = foldIngredientText(text);
  const normalized = normalizeIngredientText(text);

  const idKey = folded.replace(/ /g, '_');
  if (registry.has(idKey)) {
    return {
      kind: 'matched',
      ingredient_id: idKey,
      confidence: CONFIDENCE_EXACT_ID,
      grade: 'exact_id',
      normalized_form: normalized,
    };
  }

  const aliasOwner = index.aliasToId.get(folded);
  if (aliasOwner !== undefined) {
    return {
      kind: 'matched',
      ingredient_id: aliasOwner,
      confidence: CONFIDENCE_EXACT_ALIAS,
      grade: 'exact_alias',
      normalized_form: normalized,
    };
  }

  if (normalized === '') return { kind: 'unmatched', normalized_form: '' };

  const claimants = index.normalizedToIds.get(normalized);
  if (claimants === undefined) {
    return { kind: 'unmatched', normalized_form: normalized };
  }
  const [only] = claimants;
  if (claimants.length === 1 && only !== undefined) {
    return {
      kind: 'matched',
      ingredient_id: only,
      confidence: CONFIDENCE_NORMALIZED_FORM,
      grade: 'normalized_form',
      normalized_form: normalized,
    };
  }
  return {
    kind: 'unmatched_ambiguous',
    normalized_form: normalized,
    candidates: [...claimants].sort(),
  };
}
