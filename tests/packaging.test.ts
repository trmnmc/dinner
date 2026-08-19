/**
 * packaging.test.ts — proves package selection with surplus math (wave 1A,
 * SPEC "Domain rules").
 *
 * Acceptance contract: the chosen combination's total usable yield is ALWAYS
 * ≥ the purchase requirement (underbuying prohibited — asserted here as a
 * property AND matched against an independent brute force, but guaranteed by
 * construction in the module); among covers, (expected waste, package count)
 * is minimised lexicographically — the tie-break order is pinned with a case
 * where the two disagree; expected_surplus = total_package_yield −
 * purchase_requirement, exactly; generic fallbacks are flagged as ESTIMATES;
 * cross-dimension package yields convert only through curated values and are
 * otherwise excluded with the exact refusal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPackages } from '../domain/src/packaging.ts';
import type { PackageOption, PackageSelection } from '../domain/src/packaging.ts';
import type { IngredientRegistryEntry } from '../domain/src/catalog.ts';
import { FACTOR_TO_CANONICAL } from '../domain/src/units.ts';
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
  isInteger,
  mul,
  rational,
  sign,
  sub,
} from '../domain/src/qty.ts';
import type { Rational } from '../domain/src/qty.ts';
import type { Unit } from '../domain/src/recipe.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function entry(
  id: string,
  density: Rational | null,
  perItemWeight: Rational | null,
): IngredientRegistryEntry {
  return {
    id,
    display_name: id,
    aliases: [],
    allergen_classes: [],
    store_section: 'other',
    density_g_per_ml: density,
    per_item_weight_g: perItemWeight,
  };
}

const PLAIN = entry('plain', null, null);

function opt(
  id: string,
  yieldAmount: Rational,
  unit: Unit,
  isEstimate = false,
): PackageOption {
  return {
    id,
    label_singular: `${id} pack`,
    label_plural: `${id} packs`,
    yield_amount: yieldAmount,
    yield_unit: unit,
    is_estimate: isEstimate,
  };
}

/** Coverage + exact-surplus identity, asserted on every selection here. */
function assertCoverAndSurplus(s: PackageSelection, requirement: Rational): void {
  if (s.kind === 'none_needed') {
    assert.ok(sign(requirement) !== 1);
    assert.ok(eq(s.expected_surplus, ZERO));
    return;
  }
  assert.ok(
    compare(s.total_yield, requirement) >= 0,
    'total yield must cover the requirement (never underbuy)',
  );
  assert.ok(
    eq(s.expected_surplus, sub(s.total_yield, requirement)),
    'expected_surplus = total_package_yield − purchase_requirement, exactly',
  );
  assert.ok(sign(s.expected_surplus) >= 0, 'surplus is never negative');
  if (s.kind === 'packages') {
    let total = ZERO;
    let count = ZERO;
    for (const p of s.packages) {
      assert.ok(isInteger(p.count) && sign(p.count) === 1, 'package counts are positive integers');
      total = add(total, p.total_yield);
      count = add(count, p.count);
    }
    assert.ok(eq(total, s.total_yield), 'total_yield is the exact sum of the chosen packages');
    assert.ok(eq(count, s.package_count), 'package_count is the exact sum of the counts');
  }
}

// ---------------------------------------------------------------------------
// The SPEC example, tie-breaks, and optimality
// ---------------------------------------------------------------------------

test('the SPEC phrasing: 700 g of tomatoes ⇒ "two 15 oz cans" — one can would underbuy', () => {
  const can: PackageOption = {
    id: 'can-15oz',
    label_singular: '15 oz can',
    label_plural: '15 oz cans',
    yield_amount: rational(15n),
    yield_unit: 'oz',
    is_estimate: false,
  };
  const s = selectPackages(rational(700n), 'mass', [can], PLAIN);
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.deepEqual(s.package_count, { num: 2n, den: 1n });
    assert.equal(s.package_description, 'two 15 oz cans');
    // 30 oz exactly, through the exact avoirdupois factor.
    assert.ok(eq(s.total_yield, mul(rational(30n), FACTOR_TO_CANONICAL.oz)));
    assert.ok(eq(s.expected_surplus, sub(mul(rational(30n), FACTOR_TO_CANONICAL.oz), rational(700n))));
    assert.equal(s.is_estimate, false);
  }
  assertCoverAndSurplus(s, rational(700n));
});

test('tie-break pinned: minimal WASTE beats minimal package count — two 5-packs (waste 0) over one 12-pack (waste 2)', () => {
  const a = opt('a-12', rational(12n), 'count');
  const b = opt('b-5', rational(5n), 'count');
  const s = selectPackages(rational(10n), 'count', [a, b], PLAIN);
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    // (waste 0, count 2) wins over (waste 2, count 1): waste compares FIRST.
    assert.deepEqual(s.packages.map((p) => [p.option.id, p.count]), [['b-5', { num: 2n, den: 1n }]]);
    assert.ok(eq(s.expected_surplus, ZERO));
    assert.deepEqual(s.package_count, { num: 2n, den: 1n });
    assert.equal(s.package_description, 'two b-5 packs');
  }
  assertCoverAndSurplus(s, rational(10n));
});

test('among equal waste, FEWER packages win: one 10-pack over two 5-packs', () => {
  const s = selectPackages(
    rational(10n),
    'count',
    [opt('a-10', rational(10n), 'count'), opt('b-5', rational(5n), 'count')],
    PLAIN,
  );
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.deepEqual(s.packages.map((p) => [p.option.id, p.count]), [['a-10', { num: 1n, den: 1n }]]);
    assert.deepEqual(s.package_count, { num: 1n, den: 1n });
  }
  assertCoverAndSurplus(s, rational(10n));
});

test('a mixed combination is found when it beats every single-option cover', () => {
  // Need 20: 2×15 wastes 10; 4×5 wastes 0 but takes 4 packages;
  // 1×15 + 1×5 wastes 0 with 2 packages — the true optimum.
  const s = selectPackages(
    rational(20n),
    'count',
    [opt('a-15', rational(15n), 'count'), opt('b-5', rational(5n), 'count')],
    PLAIN,
  );
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.deepEqual(
      s.packages.map((p) => [p.option.id, p.count]),
      [
        ['a-15', { num: 1n, den: 1n }],
        ['b-5', { num: 1n, den: 1n }],
      ],
    );
    assert.ok(eq(s.expected_surplus, ZERO));
    assert.equal(s.package_description, 'one a-15 pack + one b-5 pack');
  }
  assertCoverAndSurplus(s, rational(20n));
});

// ---------------------------------------------------------------------------
// Properties: coverage never violated; optimal against a brute force
// ---------------------------------------------------------------------------

const OPTION_SETS: readonly (readonly PackageOption[])[] = [
  [opt('a-7', rational(7n), 'count')],
  [opt('a-12', rational(12n), 'count'), opt('b-5', rational(5n), 'count')],
  [opt('a-10', rational(10n), 'count'), opt('b-4', rational(4n), 'count'), opt('c-3', rational(3n), 'count')],
];

test('property: coverage is NEVER violated and surplus is exact, across a requirement grid', () => {
  for (const options of OPTION_SETS) {
    for (let n = 1; n <= 50; n = n + 1) {
      for (const den of [1n, 3n]) {
        const requirement = rational(BigInt(n), den);
        const s = selectPackages(requirement, 'count', options, PLAIN);
        assertCoverAndSurplus(s, requirement);
        assert.equal(s.kind, 'packages', 'options exist, something must be bought');
      }
    }
  }
});

test('property: (waste, package count) matches an independent brute force on every grid point', () => {
  // Independent oracle: enumerate ALL count vectors up to ceil(R/yield) per
  // option and take the lexicographic minimum of (waste, count).
  function bruteBest(requirement: Rational, yields: readonly Rational[]): { total: Rational; count: Rational } {
    let best: { total: Rational; count: Rational } | null = null;
    const walk = (i: number, total: Rational, count: Rational): void => {
      if (i === yields.length) {
        if (compare(total, requirement) < 0) return;
        if (
          best === null ||
          compare(total, best.total) < 0 ||
          (compare(total, best.total) === 0 && compare(count, best.count) < 0)
        ) {
          best = { total, count };
        }
        return;
      }
      const y = yields[i];
      assert.ok(y !== undefined);
      const cap = fromInt(ceilToInt(div(requirement, y)));
      for (let c = ZERO; compare(c, cap) <= 0; c = add(c, ONE)) {
        walk(i + 1, add(total, mul(c, y)), add(count, c));
      }
    };
    walk(0, ZERO, ZERO);
    assert.ok(best !== null);
    return best;
  }

  for (const options of OPTION_SETS) {
    const yields = options.map((o) => o.yield_amount);
    for (let n = 1; n <= 30; n = n + 1) {
      const requirement = fromInt(n);
      const s = selectPackages(requirement, 'count', options, PLAIN);
      assert.equal(s.kind, 'packages');
      if (s.kind === 'packages') {
        const oracle = bruteBest(requirement, yields);
        assert.ok(
          eq(s.total_yield, oracle.total),
          `waste must be optimal at R=${String(n)}`,
        );
        assert.ok(
          eq(s.package_count, oracle.count),
          `package count must be optimal among minimal-waste covers at R=${String(n)}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Estimates, loose items, nothing needed
// ---------------------------------------------------------------------------

test('a generic fallback is flagged as an ESTIMATE, never presented as exact', () => {
  const bunch: PackageOption = {
    id: 'bunch',
    label_singular: 'bunch',
    label_plural: 'bunches',
    yield_amount: rational(60n),
    yield_unit: 'g',
    is_estimate: true,
  };
  const s = selectPackages(rational(50n), 'mass', [bunch], PLAIN);
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.equal(s.is_estimate, true, 'the estimate flag must survive to the selection');
    assert.equal(s.package_description, 'one bunch');
  }
  assertCoverAndSurplus(s, rational(50n));
});

test('an unchosen estimate option does not taint an exact selection', () => {
  const s = selectPackages(
    rational(10n),
    'count',
    [opt('exact-10', rational(10n), 'count'), opt('guess-30', rational(30n), 'count', true)],
    PLAIN,
  );
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.deepEqual(s.packages.map((p) => p.option.id), ['exact-10']);
    assert.equal(s.is_estimate, false);
  }
  assertCoverAndSurplus(s, rational(10n));
});

test('zero purchase requirement ⇒ none_needed: nothing bought, zero surplus, no package copy', () => {
  const s = selectPackages(ZERO, 'mass', [opt('a-100', rational(100n), 'g')], PLAIN);
  assert.equal(s.kind, 'none_needed');
  assert.ok(eq(s.total_yield, ZERO));
  assert.ok(eq(s.expected_surplus, ZERO));
  assert.equal(s.package_description, null);
  assert.equal(s.is_estimate, false);
  assertCoverAndSurplus(s, ZERO);
});

test('no package data ⇒ loose: buy exactly the requirement, zero surplus, no false precision', () => {
  const requirement = rational(350n);
  const s = selectPackages(requirement, 'mass', [], PLAIN);
  assert.equal(s.kind, 'loose');
  if (s.kind === 'loose') {
    assert.ok(eq(s.total_yield, requirement));
    assert.ok(eq(s.expected_surplus, ZERO));
    assert.equal(s.package_description, null);
    assert.equal(s.is_estimate, false);
  }
  assertCoverAndSurplus(s, requirement);
});

// ---------------------------------------------------------------------------
// Cross-dimension options, exact fractional surplus, defects, determinism
// ---------------------------------------------------------------------------

test('a cross-dimension package yield converts ONLY through a curated density — and exactly', () => {
  // 800 ml needed; a 400 g jar of 0.91 g/ml oil = 40000/91 ml per jar.
  const oil = entry('test_oil', rational(91n, 100n), null);
  const jar = opt('jar-400g', rational(400n), 'g');
  const s = selectPackages(rational(800n), 'volume', [jar], oil);
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.equal(s.unit, 'ml');
    assert.deepEqual(s.package_count, { num: 2n, den: 1n });
    // 2 × 40000/91 = 80000/91 ml; surplus = 80000/91 − 800 = 7200/91, exactly.
    assert.deepEqual(s.total_yield, { num: 80000n, den: 91n });
    assert.deepEqual(s.expected_surplus, { num: 7200n, den: 91n });
    assert.deepEqual(s.excluded_options, []);
  }
  assertCoverAndSurplus(s, rational(800n));
});

test('a cross-dimension option WITHOUT a curated value is excluded with the exact refusal — and with no other options the item stays loose', () => {
  const noDensity = entry('test_dry', null, null);
  const jar = opt('jar-400g', rational(400n), 'g');
  const s = selectPackages(rational(800n), 'volume', [jar], noDensity);
  assert.equal(s.kind, 'loose', 'never a guessed density to force a package');
  assert.deepEqual(s.excluded_options, [
    {
      option_id: 'jar-400g',
      refusal: {
        kind: 'not_convertible',
        ingredient_id: 'test_dry',
        from_dimension: 'mass',
        to_dimension: 'volume',
        missing: ['density_g_per_ml'],
      },
    },
  ]);
  assertCoverAndSurplus(s, rational(800n));
});

test('surplus arithmetic is exact on fractions: 1/3 needed from 1/4-yield packages ⇒ 2 packages, surplus exactly 1/6', () => {
  const s = selectPackages(rational(1n, 3n), 'mass', [opt('quarter', rational(1n, 4n), 'g')], PLAIN);
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.deepEqual(s.package_count, { num: 2n, den: 1n });
    assert.deepEqual(s.total_yield, { num: 1n, den: 2n });
    assert.deepEqual(s.expected_surplus, { num: 1n, den: 6n });
  }
  assertCoverAndSurplus(s, rational(1n, 3n));
});

test('a non-positive package yield is a curated-data defect: typed QtyError, never a silent skip', () => {
  assert.throws(
    () => selectPackages(rational(10n), 'count', [opt('broken', ZERO, 'count')], PLAIN),
    (err: unknown) => err instanceof QtyError && err.code === 'malformed_input',
  );
});

test('deterministic: option input order never changes the selection', () => {
  const options = [
    opt('a-12', rational(12n), 'count'),
    opt('b-5', rational(5n), 'count'),
    opt('c-3', rational(3n), 'count'),
  ];
  const base = selectPackages(rational(17n), 'count', options, PLAIN);
  assert.deepEqual(selectPackages(rational(17n), 'count', [...options].reverse(), PLAIN), base);
  assert.deepEqual(
    selectPackages(rational(17n), 'count', [options[1] as PackageOption, options[2] as PackageOption, options[0] as PackageOption], PLAIN),
    base,
  );
  assertCoverAndSurplus(base, rational(17n));
});

test('a huge requirement still terminates and covers — the cap can cost optimality, never coverage', () => {
  // 100000 g from 7 g sachets: ceil = 14286 packages, total 100002, surplus 2.
  const s = selectPackages(rational(100000n), 'mass', [opt('sachet-7', rational(7n), 'g')], PLAIN);
  assert.equal(s.kind, 'packages');
  if (s.kind === 'packages') {
    assert.deepEqual(s.package_count, { num: 14286n, den: 1n });
    assert.deepEqual(s.expected_surplus, { num: 2n, den: 1n });
    assert.equal(s.package_description, '14286 sachet-7 packs', 'counts past twelve fall back to digits');
  }
  assertCoverAndSurplus(s, rational(100000n));

  // With a second, larger option the enumeration stays bounded and covered.
  const mixed = selectPackages(
    rational(100000n),
    'mass',
    [opt('sack-9000', rational(9000n), 'g'), opt('sachet-7', rational(7n), 'g')],
    PLAIN,
  );
  assertCoverAndSurplus(mixed, rational(100000n));
  assert.equal(mixed.kind, 'packages');
  if (mixed.kind === 'packages') {
    // Zero-waste covers exist only at sack counts ≡ 1 (mod 7): (1, 13000)
    // and (8, 4000). Both are reachable ONLY because the sachet coordinate
    // is DERIVED (never searched, never capped), and the package-count
    // tie-break then picks the 4008-package cover over the 13001-package one.
    assert.deepEqual(mixed.total_yield, { num: 100000n, den: 1n });
    assert.ok(eq(mixed.expected_surplus, ZERO));
    assert.deepEqual(
      mixed.packages.map((p) => [p.option.id, p.count]),
      [
        ['sack-9000', { num: 8n, den: 1n }],
        ['sachet-7', { num: 4000n, den: 1n }],
      ],
    );
  }
});
