/**
 * cycle-025-gate-T-069.mjs — CONDUCTOR-authored gate. No builder has seen it.
 *
 * T-069 acceptance, quoted verbatim from the backlog:
 *
 *   "A grocery list for a real 3-meal plan, fetched from
 *    GET /api/plans/:planId/grocery, contains at least one line with a non-null
 *    package_label, at least one is_estimate line, and at least one line with
 *    non-zero expected_surplus — sourced from the package options now authored
 *    in data/ingredients.json, not from a fixture."
 *
 * The three counting clauses are the easy half and cycle 24 already ran them
 * (0/22, 0/22, 0/22 before this cycle). The clause that actually carries the
 * item is the last one: "SOURCED FROM the package options now authored in
 * data/ingredients.json". A route that fabricated a plausible label from
 * `display_name`, or hardcoded `is_estimate: false`, or invented a surplus,
 * would satisfy the counting clauses and still be a lie. So:
 *
 *   P1   the three counting clauses, live over HTTP        (the literal words)
 *   P2   every label on the wire is traceable to an option authored on disk
 *        FOR THAT INGREDIENT ID                            (the sourcing clause)
 *   P3   each line's is_estimate equals the authored flag of the option its
 *        own label names                                   (no hardcoding)
 *   P4   exact rational arithmetic: surplus == purchase_quantity − (Σ recipe
 *        contributions − inventory deducted), on EVERY line, checked in BigInt
 *        by this file                                      (SPEC domain rule)
 *   P5   underbuying prohibited: surplus >= 0 on every line (SPEC domain rule)
 *
 * Expectations are re-parsed off `data/ingredients.json` by this file. No
 * domain module supplies an expectation, so a bug inside catalog.ts or
 * packaging.ts cannot make these pass. The only thing imported from the repo is
 * the HTTP driving fixture — no assertion depends on it.
 *
 * Run: node .swarm/runs/cycle-025-gate-T-069.mjs
 */

import { readFileSync } from 'node:fs';
import { boot, makeHousehold, makePlan, grocery } from './cycle-014-fixture.mjs';

const TARGET = '/opt/targets/dinner';

let pass = 0;
let fail = 0;
const failures = [];
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; failures.push(`${id}: ${detail ?? ''}`); console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};

// --- exact rational arithmetic, BigInt, written here so no repo code is trusted
const rat = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && 'n' in v && 'd' in v) {
    try { return { n: BigInt(v.n), d: BigInt(v.d) }; } catch { return null; }
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return { n: BigInt(v.trim()), d: 1n };
  if (typeof v === 'number' && Number.isInteger(v)) return { n: BigInt(v), d: 1n };
  return null;
};
const rSub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const rAdd = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const rEq = (a, b) => a.n * b.d === b.n * a.d;
const rSign = (a) => (a.n === 0n ? 0 : (a.n > 0n) === (a.d > 0n) ? 1 : -1);
const rNum = (a) => Number(a.n) / Number(a.d);

// ---------------------------------------------------------------------------
// Authored truth, read straight off disk.
// ---------------------------------------------------------------------------
const registry = JSON.parse(readFileSync(`${TARGET}/data/ingredients.json`, 'utf8'));
const byId = new Map(registry.ingredients.map((i) => [i.id, i]));
const totalOptions = registry.ingredients.reduce((n, i) => n + (i.package_options?.length ?? 0), 0);
console.log(`authored on disk: ${registry.ingredients.length} ingredients, ${totalOptions} package options\n`);

/** The option (for THIS ingredient) whose authored noun phrase the wire label
 *  names. Longest match wins so "12 oz bear" beats a shorter overlapping form. */
const sourceOption = (ingredientId, label) => {
  const ing = byId.get(ingredientId);
  if (!ing || typeof label !== 'string') return null;
  let best = null;
  let bestLen = 0;
  for (const o of ing.package_options ?? []) {
    for (const form of [o.label_singular, o.label_plural]) {
      if (typeof form === 'string' && form.length > bestLen && label.includes(form)) {
        best = o; bestLen = form.length;
      }
    }
  }
  return best;
};

const srv = await boot();
try {
  const householdId = await makeHousehold(srv.baseUrl);
  const plan = await makePlan(srv.baseUrl, householdId);
  const planId = plan?.plan?.plan_id;
  const meals = plan?.plan?.meals ?? [];
  check('P0', Boolean(planId) && meals.length === 3,
    `real 3-meal plan created over HTTP: plan_id=${planId} meals=${meals.length}`);

  const g = await grocery(srv.baseUrl, householdId, planId);
  const sections = g.body?.list?.sections ?? [];
  const lines = sections.flatMap((s) => s.lines ?? []);
  check('P0b', g.status === 200 && lines.length > 0,
    `GET /api/plans/:planId/grocery -> ${g.status}, ${sections.length} sections, ${lines.length} measured lines`);

  // --- P1: the three counting clauses, verbatim -----------------------------
  console.log('\n=== P1 — the acceptance as literally written ===');
  const labelled = lines.filter((l) => l.package_label !== null && l.package_label !== undefined);
  const estimated = lines.filter((l) => l.is_estimate === true);
  const surplused = lines.filter((l) => {
    const s = rat(l.provenance?.expected_surplus);
    return s !== null && rSign(s) > 0;
  });
  check('P1a', labelled.length > 0, `lines with a non-null package_label: ${labelled.length}/${lines.length}`);
  check('P1b', estimated.length > 0, `lines with is_estimate true: ${estimated.length}/${lines.length}`);
  check('P1c', surplused.length > 0, `lines with non-zero expected_surplus: ${surplused.length}/${lines.length}`);

  // --- P2: sourcing. Every label traceable to THIS ingredient's own option ---
  console.log('\n=== P2 — every label is sourced from data/ingredients.json ===');
  const untraceable = [];
  for (const l of labelled) {
    if (sourceOption(l.ingredient_id, l.package_label) === null) {
      untraceable.push(`${l.ingredient_id}: ${JSON.stringify(l.package_label)}`);
    }
  }
  check('P2a', labelled.length > 0 && untraceable.length === 0,
    `labels traceable to an option authored for that same ingredient: ${labelled.length - untraceable.length}/${labelled.length}` +
    (untraceable.length ? ` -> untraceable: ${untraceable.slice(0, 4).join(' | ')}` : ''));

  // A label that resolves only because the phrase is generic would be weak
  // evidence, so name the distinct authored option ids the wire actually used.
  const usedOptionIds = new Set(labelled.map((l) => sourceOption(l.ingredient_id, l.package_label)?.id).filter(Boolean));
  check('P2b', usedOptionIds.size >= 5,
    `distinct authored option ids reached the wire: ${usedOptionIds.size} (e.g. ${[...usedOptionIds].slice(0, 4).join(', ')})`);

  // --- P3: is_estimate is the AUTHORED flag, not a constant -----------------
  console.log('\n=== P3 — is_estimate matches the authored option it names ===');
  const mismatched = [];
  for (const l of labelled) {
    const o = sourceOption(l.ingredient_id, l.package_label);
    if (o && o.is_estimate !== l.is_estimate) {
      mismatched.push(`${l.ingredient_id}: wire=${l.is_estimate} authored=${o.is_estimate} (${o.id})`);
    }
  }
  const authoredTrue = labelled.filter((l) => sourceOption(l.ingredient_id, l.package_label)?.is_estimate === true).length;
  const authoredFalse = labelled.length - authoredTrue;
  check('P3a', mismatched.length === 0,
    `estimate flag matches disk on ${labelled.length - mismatched.length}/${labelled.length} labelled lines` +
    (mismatched.length ? ` -> ${mismatched.slice(0, 4).join(' | ')}` : ''));
  check('P3b', authoredTrue > 0 && authoredFalse > 0,
    `the flag discriminates on this very list: ${authoredTrue} estimated / ${authoredFalse} exact — a hardcoded constant would fail P3a`);

  // --- P4/P5: the SPEC domain rule, in exact rationals ----------------------
  console.log('\n=== P4/P5 — expected_surplus arithmetic, exact rationals ===');
  const badMath = [];
  const underbought = [];
  let checkedMath = 0;
  for (const l of lines) {
    const yieldTotal = rat(l.purchase_quantity);
    const surplus = rat(l.provenance?.expected_surplus);
    const deducted = rat(l.provenance?.inventory_deducted) ?? { n: 0n, d: 1n };
    if (!yieldTotal || !surplus) continue;
    let required = { n: 0n, d: 1n };
    let ok = true;
    for (const c of l.provenance?.contributions ?? []) {
      const a = rat(c.amount);
      if (!a || c.unit !== l.unit) { ok = false; break; }
      required = rAdd(required, a);
    }
    if (!ok) continue;
    const net = rSub(required, deducted);
    const expected = rSub(yieldTotal, rSign(net) > 0 ? net : { n: 0n, d: 1n });
    checkedMath += 1;
    if (!rEq(expected, surplus)) {
      badMath.push(`${l.ingredient_id}: surplus=${rNum(surplus).toFixed(4)} expected=${rNum(expected).toFixed(4)} (yield=${rNum(yieldTotal).toFixed(4)} req=${rNum(net).toFixed(4)} ${l.unit})`);
    }
    if (rSign(surplus) < 0) underbought.push(`${l.ingredient_id}: surplus=${rNum(surplus).toFixed(4)}`);
  }
  check('P4', checkedMath >= 10 && badMath.length === 0,
    `surplus == package yield − (Σ contributions − inventory) on ${checkedMath - badMath.length}/${checkedMath} lines` +
    (badMath.length ? ` -> ${badMath.slice(0, 3).join(' | ')}` : ''));
  check('P5', underbought.length === 0,
    `underbuying prohibited — lines with negative surplus: ${underbought.length}${underbought.length ? ' -> ' + underbought.slice(0, 3).join(' | ') : ''}`);

  // --- census, printed whatever the verdict --------------------------------
  console.log('\n  --- every line as the grocery screen receives it ---');
  for (const l of lines) {
    const o = sourceOption(l.ingredient_id, l.package_label);
    const s = rat(l.provenance?.expected_surplus);
    console.log(
      `    ${String(l.ingredient_id).padEnd(24)} label=${JSON.stringify(l.package_label ?? null).padEnd(34)} est=${String(l.is_estimate).padEnd(5)} option=${o ? o.id : '—'} surplus=${s ? rNum(s).toFixed(3) : 'n/a'} ${l.unit}`,
    );
  }
} finally {
  await srv.stop();
}

console.log(`\nT-069 GATE: ${pass} pass / ${fail} fail`);
if (failures.length) { console.log('failures:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail === 0 ? 0 : 1);
