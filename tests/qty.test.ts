/**
 * qty.test.ts — proves the arithmetic kernel is exact.
 *
 * Focus: values a float gets wrong (thirds, 0.1-like decimals, integers
 * beyond 2^53), canonical normalisation, every rounding helper at its
 * boundaries including exact .5 cases, and explicit typed failure on
 * division by zero / malformed input — never NaN, never a silent 0.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONE,
  QtyError,
  ZERO,
  abs,
  add,
  ceilToInt,
  compare,
  div,
  eq,
  floorToInt,
  fromInt,
  isInteger,
  isZero,
  max,
  min,
  mul,
  neg,
  parseRational,
  rational,
  rationalFromJson,
  rationalToJson,
  roundNearestInt,
  roundNearestToMultiple,
  roundUpToMultiple,
  sign,
  sub,
  toDecimalString,
  toMixedString,
} from '../domain/src/qty.ts';

test('thirds sum exactly to one (floats cannot)', () => {
  const third = rational(1, 3);
  const sum = add(add(third, third), third);
  assert.deepEqual(sum, { num: 1n, den: 1n });
  assert.ok(eq(sum, ONE));
});

test('0.1 + 0.2 is exactly 0.3', () => {
  const sum = add(parseRational('0.1'), parseRational('0.2'));
  assert.deepEqual(sum, { num: 3n, den: 10n });
  assert.ok(eq(sum, parseRational('0.3')));
});

test('repeated addition of 0.1 ten times is exactly 1', () => {
  let acc = ZERO;
  const tenth = parseRational('0.1');
  for (let i = 0; i < 10; i = i + 1) acc = add(acc, tenth);
  assert.deepEqual(acc, { num: 1n, den: 1n });
});

test('integers beyond 2^53 stay exact', () => {
  // 2^53 + 1 is the first integer IEEE doubles cannot represent.
  const big = rational(9007199254740993n);
  assert.deepEqual(add(big, ONE), { num: 9007199254740994n, den: 1n });
  const product = mul(big, big);
  assert.equal(product.num, 9007199254740993n * 9007199254740993n);
  assert.equal(product.den, 1n);
});

test('normalisation to lowest terms with canonical sign', () => {
  assert.deepEqual(rational(6, 8), { num: 3n, den: 4n });
  assert.deepEqual(rational(-6, 8), { num: -3n, den: 4n });
  // Sign always lives on the numerator; denominator is always positive.
  assert.deepEqual(rational(6, -8), { num: -3n, den: 4n });
  assert.deepEqual(rational(-6, -8), { num: 3n, den: 4n });
  // Zero is canonically 0/1.
  assert.deepEqual(rational(0, -7), { num: 0n, den: 1n });
  // Equality across representations.
  assert.ok(eq(rational(2, 6), rational(1, 3)));
});

test('compare, min, max, sign, neg, abs, isZero, isInteger', () => {
  assert.equal(compare(rational(1, 3), rational(1, 2)), -1);
  assert.equal(compare(rational(1, 2), rational(1, 3)), 1);
  assert.equal(compare(rational(2, 4), rational(1, 2)), 0);
  assert.deepEqual(min(rational(1, 3), rational(1, 2)), { num: 1n, den: 3n });
  assert.deepEqual(max(rational(1, 3), rational(1, 2)), { num: 1n, den: 2n });
  assert.equal(sign(rational(-5, 7)), -1);
  assert.equal(sign(ZERO), 0);
  assert.equal(sign(rational(5, 7)), 1);
  assert.deepEqual(neg(rational(1, 4)), { num: -1n, den: 4n });
  assert.deepEqual(abs(rational(-1, 4)), { num: 1n, den: 4n });
  assert.ok(isZero(sub(rational(1, 3), rational(2, 6))));
  assert.ok(isInteger(rational(8, 4)));
  assert.ok(!isInteger(rational(1, 4)));
});

test('sub and div are exact', () => {
  assert.deepEqual(sub(rational(1, 2), rational(1, 3)), { num: 1n, den: 6n });
  assert.deepEqual(div(rational(1, 3), rational(2, 5)), { num: 5n, den: 6n });
});

test('parsing: integers, decimals, fractions, mixed numbers', () => {
  assert.deepEqual(parseRational('2'), { num: 2n, den: 1n });
  assert.deepEqual(parseRational('-2'), { num: -2n, den: 1n });
  assert.deepEqual(parseRational('0.1'), { num: 1n, den: 10n });
  assert.deepEqual(parseRational('.5'), { num: 1n, den: 2n });
  assert.deepEqual(parseRational('-2.25'), { num: -9n, den: 4n });
  assert.deepEqual(parseRational('3/4'), { num: 3n, den: 4n });
  assert.deepEqual(parseRational('1 1/2'), { num: 3n, den: 2n });
  assert.deepEqual(parseRational('-1 1/2'), { num: -3n, den: 2n });
  assert.deepEqual(parseRational('  2/6  '), { num: 1n, den: 3n });
});

test('malformed input throws typed QtyError, never NaN or 0', () => {
  for (const bad of ['', 'abc', '1.2.3', '1/2/3', '1,5', 'NaN', 'Infinity', '1 / 2', '--3']) {
    assert.throws(
      () => parseRational(bad),
      (e: unknown) => e instanceof QtyError && e.code === 'malformed_input',
      `expected malformed_input for ${JSON.stringify(bad)}`,
    );
  }
  assert.throws(
    () => fromInt(1.5),
    (e: unknown) => e instanceof QtyError && e.code === 'malformed_input',
  );
  assert.throws(
    () => fromInt(Number.NaN),
    (e: unknown) => e instanceof QtyError && e.code === 'malformed_input',
  );
  assert.throws(
    () => rational(1, 0.5),
    (e: unknown) => e instanceof QtyError && e.code === 'malformed_input',
  );
});

test('division by zero throws typed QtyError, never NaN', () => {
  assert.throws(
    () => div(ONE, ZERO),
    (e: unknown) => e instanceof QtyError && e.code === 'division_by_zero',
  );
  assert.throws(
    () => rational(1, 0),
    (e: unknown) => e instanceof QtyError && e.code === 'division_by_zero',
  );
  assert.throws(
    () => parseRational('1/0'),
    (e: unknown) => e instanceof QtyError && e.code === 'division_by_zero',
  );
});

test('ceilToInt / floorToInt at boundaries and negatives', () => {
  assert.equal(ceilToInt(rational(7, 2)), 4n);
  assert.equal(ceilToInt(rational(-7, 2)), -3n);
  assert.equal(ceilToInt(rational(3)), 3n);
  assert.equal(ceilToInt(rational(1, 100)), 1n);
  assert.equal(floorToInt(rational(7, 2)), 3n);
  assert.equal(floorToInt(rational(-7, 2)), -4n);
  assert.equal(floorToInt(rational(-3)), -3n);
});

test('roundNearestInt: exact halves round away from zero', () => {
  assert.equal(roundNearestInt(rational(5, 2)), 3n); // 2.5 -> 3
  assert.equal(roundNearestInt(rational(-5, 2)), -3n); // -2.5 -> -3
  assert.equal(roundNearestInt(rational(3, 2)), 2n); // 1.5 -> 2
  assert.equal(roundNearestInt(rational(1, 3)), 0n);
  assert.equal(roundNearestInt(rational(2, 3)), 1n);
  assert.equal(roundNearestInt(rational(-1, 3)), 0n);
  assert.equal(roundNearestInt(rational(-2, 3)), -1n);
});

test('roundUpToMultiple: never rounds down (underbuying prohibited)', () => {
  const quarter = rational(1, 4);
  assert.deepEqual(roundUpToMultiple(parseRational('0.3'), quarter), { num: 1n, den: 2n });
  // Already an exact multiple stays put.
  assert.deepEqual(roundUpToMultiple(rational(1, 2), quarter), { num: 1n, den: 2n });
  assert.deepEqual(roundUpToMultiple(parseRational('2.01'), ONE), { num: 3n, den: 1n });
});

test('roundNearestToMultiple: nearest, halves away from zero', () => {
  const quarter = rational(1, 4);
  assert.deepEqual(roundNearestToMultiple(parseRational('0.3'), quarter), { num: 1n, den: 4n });
  // 3/8 is exactly halfway between 1/4 and 1/2 -> away from zero -> 1/2.
  assert.deepEqual(roundNearestToMultiple(rational(3, 8), quarter), { num: 1n, den: 2n });
  assert.deepEqual(roundNearestToMultiple(rational(-3, 8), quarter), { num: -1n, den: 2n });
});

test('rounding multiples must be positive and non-zero', () => {
  assert.throws(
    () => roundUpToMultiple(ONE, ZERO),
    (e: unknown) => e instanceof QtyError && e.code === 'division_by_zero',
  );
  assert.throws(
    () => roundNearestToMultiple(ONE, rational(-1, 4)),
    (e: unknown) => e instanceof QtyError && e.code === 'malformed_input',
  );
});

test('toDecimalString rounds once (half away from zero) and trims zeros', () => {
  assert.equal(toDecimalString(rational(1, 3), 2), '0.33');
  assert.equal(toDecimalString(rational(2, 3), 2), '0.67');
  assert.equal(toDecimalString(rational(1, 8), 2), '0.13'); // 0.125 -> .5 away from zero
  assert.equal(toDecimalString(rational(-1, 8), 2), '-0.13');
  assert.equal(toDecimalString(rational(3, 2), 3), '1.5'); // trailing zeros trimmed
  assert.equal(toDecimalString(rational(2), 2), '2');
  assert.equal(toDecimalString(ZERO, 2), '0');
  assert.equal(toDecimalString(rational(-1, 1000), 2), '0'); // never "-0"
  assert.throws(
    () => toDecimalString(ONE, -1),
    (e: unknown) => e instanceof QtyError && e.code === 'malformed_input',
  );
});

test('toMixedString is exact', () => {
  assert.equal(toMixedString(rational(3, 2)), '1 1/2');
  assert.equal(toMixedString(rational(-5, 4)), '-1 1/4');
  assert.equal(toMixedString(rational(3, 4)), '3/4');
  assert.equal(toMixedString(rational(2)), '2');
  assert.equal(toMixedString(ZERO), '0');
});

test('JSON round trip is lossless, including past 2^53', () => {
  const r = rational(9007199254740993n, 7n);
  const revived = rationalFromJson(rationalToJson(r));
  assert.deepEqual(revived, r);
  assert.deepEqual(rationalFromJson({ num: '-6', den: '8' }), { num: -3n, den: 4n });
  assert.throws(
    () => rationalFromJson({ num: '1.5', den: '1' }),
    (e: unknown) => e instanceof QtyError && e.code === 'malformed_input',
  );
  assert.throws(
    () => rationalFromJson({ num: '1', den: '0' }),
    (e: unknown) => e instanceof QtyError && e.code === 'division_by_zero',
  );
});
