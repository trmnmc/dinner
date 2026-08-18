/**
 * qty.ts — the SOLE arithmetic entry point for authoritative paths.
 *
 * FROZEN CONTRACT (wave 0). Invariant 1 (DESIGN.md): `Rational` (bigint
 * num/den) is the ONLY arithmetic type allowed to touch a quantity, price,
 * or persisted score. Downstream modules (`aggregate`, `packaging`,
 * `inventoryMath`, `score`, …) import from this module and never use bare
 * `+` / `*` on quantity numbers — review greps for that.
 *
 * Guarantees:
 * - Every value is normalised: lowest terms, denominator > 0 (the sign
 *   lives on the numerator), zero is canonically 0/1.
 * - Division by zero and malformed input throw a typed `QtyError` —
 *   never NaN, never a silent 0.
 * - Rounding happens ONCE, at the display/package boundary, through the
 *   explicit helpers here. Each helper states its tie-breaking rule.
 */

/** An exact rational number. Fields are canonical (see module docs). */
export interface Rational {
  /** Numerator; carries the sign. */
  readonly num: bigint;
  /** Denominator; always > 0. */
  readonly den: bigint;
}

/** JSON-safe serialised form (bigints as base-10 strings). Lossless. */
export interface RationalJson {
  readonly num: string;
  readonly den: string;
}

export type QtyErrorCode = 'division_by_zero' | 'malformed_input';

/** The one failure type for quantity arithmetic. Always thrown, never NaN. */
export class QtyError extends Error {
  readonly code: QtyErrorCode;
  constructor(code: QtyErrorCode, message: string) {
    super(message);
    this.name = 'QtyError';
    this.code = code;
  }
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function normalise(num: bigint, den: bigint): Rational {
  if (den === 0n) {
    throw new QtyError('division_by_zero', 'rational with zero denominator');
  }
  if (num === 0n) return { num: 0n, den: 1n };
  // Canonical sign: denominator strictly positive.
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

function toBigInt(v: bigint | number, what: string): bigint {
  if (typeof v === 'bigint') return v;
  if (!Number.isSafeInteger(v)) {
    throw new QtyError('malformed_input', `${what} must be a safe integer, got ${String(v)}`);
  }
  return BigInt(v);
}

export const ZERO: Rational = { num: 0n, den: 1n };
export const ONE: Rational = { num: 1n, den: 1n };

/**
 * Construct num/den from integers (bigint or safe-integer number).
 * Throws `division_by_zero` if den is 0, `malformed_input` on non-integers.
 */
export function rational(num: bigint | number, den: bigint | number = 1n): Rational {
  return normalise(toBigInt(num, 'numerator'), toBigInt(den, 'denominator'));
}

/** Construct from an integer. Throws `malformed_input` on non-integers. */
export function fromInt(n: bigint | number): Rational {
  return { num: toBigInt(n, 'integer'), den: 1n };
}

const RE_INTEGER = /^([+-]?)(\d+)$/;
const RE_DECIMAL = /^([+-]?)(\d*)\.(\d+)$/;
const RE_FRACTION = /^([+-]?)(\d+)\/(\d+)$/;
const RE_MIXED = /^([+-]?)(\d+)[ ]+(\d+)\/(\d+)$/;

/**
 * Parse an exact quantity from text. Accepted forms (with optional sign):
 * integers `"2"`, decimals `"0.1"` / `".5"`, fractions `"3/4"`, and mixed
 * numbers `"1 1/2"`. The sign applies to the whole mixed number.
 * Throws `malformed_input` for anything else and `division_by_zero` for a
 * zero fraction denominator. Decimals are parsed exactly — `"0.1"` is
 * exactly 1/10, never the nearest IEEE double.
 */
export function parseRational(text: string): Rational {
  const s = text.trim();
  let m = RE_INTEGER.exec(s);
  if (m !== null) {
    const sign = m[1] === '-' ? -1n : 1n;
    return normalise(sign * BigInt(m[2] as string), 1n);
  }
  m = RE_DECIMAL.exec(s);
  if (m !== null) {
    const sign = m[1] === '-' ? -1n : 1n;
    const whole = m[2] === '' ? 0n : BigInt(m[2] as string);
    const fracText = m[3] as string;
    const den = 10n ** BigInt(fracText.length);
    return normalise(sign * (whole * den + BigInt(fracText)), den);
  }
  m = RE_FRACTION.exec(s);
  if (m !== null) {
    const sign = m[1] === '-' ? -1n : 1n;
    return normalise(sign * BigInt(m[2] as string), BigInt(m[3] as string));
  }
  m = RE_MIXED.exec(s);
  if (m !== null) {
    const sign = m[1] === '-' ? -1n : 1n;
    const whole = BigInt(m[2] as string);
    const fnum = BigInt(m[3] as string);
    const fden = BigInt(m[4] as string);
    if (fden === 0n) {
      throw new QtyError('division_by_zero', `zero denominator in ${JSON.stringify(text)}`);
    }
    return normalise(sign * (whole * fden + fnum), fden);
  }
  throw new QtyError('malformed_input', `not a quantity: ${JSON.stringify(text)}`);
}

export function add(a: Rational, b: Rational): Rational {
  return normalise(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function sub(a: Rational, b: Rational): Rational {
  return normalise(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mul(a: Rational, b: Rational): Rational {
  return normalise(a.num * b.num, a.den * b.den);
}

/** Throws `division_by_zero` when b is zero. Never NaN. */
export function div(a: Rational, b: Rational): Rational {
  if (b.num === 0n) {
    throw new QtyError('division_by_zero', 'division by zero');
  }
  return normalise(a.num * b.den, a.den * b.num);
}

export function neg(a: Rational): Rational {
  return { num: -a.num, den: a.den };
}

export function abs(a: Rational): Rational {
  return a.num < 0n ? { num: -a.num, den: a.den } : a;
}

/** -1 if a < b, 0 if equal, 1 if a > b. Exact. */
export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a.num * b.den;
  const r = b.num * a.den;
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
}

export function eq(a: Rational, b: Rational): boolean {
  return compare(a, b) === 0;
}

export function min(a: Rational, b: Rational): Rational {
  return compare(a, b) <= 0 ? a : b;
}

export function max(a: Rational, b: Rational): Rational {
  return compare(a, b) >= 0 ? a : b;
}

/** -1, 0, or 1. Exact zero test is `sign(a) === 0` or `isZero`. */
export function sign(a: Rational): -1 | 0 | 1 {
  if (a.num < 0n) return -1;
  if (a.num > 0n) return 1;
  return 0;
}

export function isZero(a: Rational): boolean {
  return a.num === 0n;
}

export function isInteger(a: Rational): boolean {
  return a.den === 1n;
}

// ---------------------------------------------------------------------------
// Rounding — the ONLY place a Rational may lose precision, used exactly once
// at the display/package boundary. Each helper states its rule explicitly.
// ---------------------------------------------------------------------------

/** Round toward +∞ to an integer (packaging: underbuying is prohibited). */
export function ceilToInt(a: Rational): bigint {
  const q = a.num / a.den; // bigint division truncates toward zero
  return a.num > 0n && a.num % a.den !== 0n ? q + 1n : q;
}

/** Round toward −∞ to an integer. */
export function floorToInt(a: Rational): bigint {
  const q = a.num / a.den;
  return a.num < 0n && a.num % a.den !== 0n ? q - 1n : q;
}

/**
 * Round to the nearest integer; exact halves round AWAY FROM ZERO
 * (2.5 → 3, −2.5 → −3). Stated rule, tested at the boundary.
 */
export function roundNearestInt(a: Rational): bigint {
  const q = a.num / a.den;
  const rem = a.num % a.den;
  const twice = 2n * (rem < 0n ? -rem : rem);
  if (twice >= a.den) return a.num < 0n ? q - 1n : q + 1n;
  return q;
}

function checkMultiple(multiple: Rational): void {
  if (multiple.num === 0n) {
    throw new QtyError('division_by_zero', 'rounding multiple must be non-zero');
  }
  if (multiple.num < 0n) {
    throw new QtyError('malformed_input', 'rounding multiple must be positive');
  }
}

/**
 * Round UP (toward +∞) to the nearest multiple of `multiple` (> 0).
 * E.g. roundUpToMultiple(0.3, 1/4) = 1/2. Used for package counts.
 */
export function roundUpToMultiple(a: Rational, multiple: Rational): Rational {
  checkMultiple(multiple);
  return mul(fromInt(ceilToInt(div(a, multiple))), multiple);
}

/**
 * Round to the NEAREST multiple of `multiple` (> 0); exact halves round
 * away from zero. E.g. roundNearestToMultiple(3/8, 1/4) = 1/2.
 */
export function roundNearestToMultiple(a: Rational, multiple: Rational): Rational {
  checkMultiple(multiple);
  return mul(fromInt(roundNearestInt(div(a, multiple))), multiple);
}

// ---------------------------------------------------------------------------
// Display — exact until the single rounding step documented per function.
// ---------------------------------------------------------------------------

/**
 * Decimal display string with at most `maxFracDigits` fraction digits.
 * Rounds ONCE to that precision (nearest; exact halves away from zero),
 * then trims trailing zeros ("1.50" → "1.5", "2.00" → "2").
 */
export function toDecimalString(a: Rational, maxFracDigits: number): string {
  if (!Number.isSafeInteger(maxFracDigits) || maxFracDigits < 0) {
    throw new QtyError('malformed_input', `invalid fraction digit count ${String(maxFracDigits)}`);
  }
  const pow = 10n ** BigInt(maxFracDigits);
  const scaled = roundNearestInt({ num: a.num * pow, den: a.den });
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const wholePart = magnitude / pow;
  let fracPart = (magnitude % pow).toString().padStart(maxFracDigits, '0');
  fracPart = fracPart.replace(/0+$/, '');
  const body = fracPart === '' ? wholePart.toString() : `${wholePart.toString()}.${fracPart}`;
  return negative && body !== '0' ? `-${body}` : body;
}

/**
 * Exact mixed-number display string: "2", "3/4", "1 1/2", "-1 1/4", "0".
 * Never rounds — the fraction is already in lowest terms.
 */
export function toMixedString(a: Rational): string {
  if (a.num === 0n) return '0';
  const negative = a.num < 0n;
  const magnitude = negative ? -a.num : a.num;
  const whole = magnitude / a.den;
  const rem = magnitude % a.den;
  let body: string;
  if (rem === 0n) {
    body = whole.toString();
  } else if (whole === 0n) {
    body = `${rem.toString()}/${a.den.toString()}`;
  } else {
    body = `${whole.toString()} ${rem.toString()}/${a.den.toString()}`;
  }
  return negative ? `-${body}` : body;
}

// ---------------------------------------------------------------------------
// Lossless serialisation (bigint → base-10 string) for JSON files and rows.
// ---------------------------------------------------------------------------

export function rationalToJson(a: Rational): RationalJson {
  return { num: a.num.toString(), den: a.den.toString() };
}

const RE_BIGINT = /^-?\d+$/;

/** Revive from `RationalJson`. Throws `malformed_input` on bad strings. */
export function rationalFromJson(j: RationalJson): Rational {
  if (!RE_BIGINT.test(j.num) || !RE_BIGINT.test(j.den)) {
    throw new QtyError('malformed_input', `bad RationalJson {num:${JSON.stringify(j.num)}, den:${JSON.stringify(j.den)}}`);
  }
  return normalise(BigInt(j.num), BigInt(j.den));
}
