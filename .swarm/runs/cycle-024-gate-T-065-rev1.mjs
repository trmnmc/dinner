/**
 * cycle-024-gate-T-065.mjs — CONDUCTOR-authored gate. No builder has seen it.
 *
 * T-065 acceptance, quoted verbatim from the backlog:
 *
 *   "Every ingredient a catalog recipe can require carries at least one package
 *    option with a yield, and generic fallbacks are flagged is_estimate. A
 *    grocery list for a real plan then contains at least one line with a
 *    non-null package_label, at least one is_estimate line, and at least one
 *    line with non-zero expected_surplus - so the grocery screen renders the
 *    package, the estimate label and the surplus it was built to render."
 *
 * Two sentences, and BOTH are the acceptance. The gate is deliberately split so
 * the report can say which half landed:
 *
 *   D-checks  the DATA half   (sentence 1) — re-parsed off disk by this file
 *   L-checks  the LIVE half   (sentence 2) — driven through the real HTTP API
 *
 * The builder's own return reported proving the acceptance "at the domain layer
 * ... independent of routes.ts's current gap" by hand-assembling
 * scale → aggregate → subtractInventory → selectPackages. That is a different
 * claim from the one the acceptance makes. Sentence 2 says "A GROCERY LIST for
 * a real plan", and the only grocery list a user can get is the one
 * GET /api/plans/:planId/grocery returns. So the L-checks call that endpoint and
 * read the fields the grocery screen actually reads (`package_label`,
 * `is_estimate`, `expected_surplus` — routes.ts:1052 renames
 * package_description → package_label on the wire; grocery.js:305 reads
 * package_label). Nothing is hand-assembled.
 *
 * Run: node .swarm/runs/cycle-024-gate-T-065.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { boot, makeHousehold, makePlan, grocery } from './cycle-014-fixture.mjs';

const TARGET = '/opt/targets/dinner';

let pass = 0;
let fail = 0;
const failures = [];
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; failures.push(`${id}: ${detail ?? ''}`); console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};

// ---------------------------------------------------------------------------
// D — the DATA half. Re-parsed off disk here; no domain code is imported, so a
// bug inside catalog.ts could not make these pass.
// ---------------------------------------------------------------------------

const registry = JSON.parse(readFileSync(`${TARGET}/data/ingredients.json`, 'utf8'));
const ingredients = registry.ingredients;
const byId = new Map(ingredients.map((i) => [i.id, i]));

console.log('=== D — data half (sentence 1) ===');
check('D1', Array.isArray(ingredients) && ingredients.length === 97,
  `registry parses, ${ingredients.length} ingredients`);

// D2 — every ingredient carries >= 1 option.
const missing = ingredients.filter((i) => !Array.isArray(i.package_options) || i.package_options.length === 0);
check('D2', missing.length === 0,
  `ingredients with zero package options: ${missing.length}${missing.length ? ' -> ' + missing.slice(0, 5).map((i) => i.id).join(',') : ''}`);

// D3 — every option is WELL FORMED against packaging.ts's documented
// PackageOption contract: an id, a positive parseable yield, a unit, and an
// explicit boolean is_estimate. "Has a field" is not the same as "has a yield";
// the acceptance says "at least one package option WITH A YIELD".
const parseRat = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const s = v.trim();
  if (/^-?\d+\/\d+$/.test(s)) { const [n, d] = s.split('/').map(Number); return d === 0 ? NaN : n / d; }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
};
const malformed = [];
const optionIds = new Set();
let dupIds = 0;
for (const ing of ingredients) {
  for (const o of ing.package_options ?? []) {
    const y = parseRat(o.yield_amount);
    const bad = [];
    if (typeof o.id !== 'string' || o.id === '') bad.push('id');
    if (!(y > 0)) bad.push(`yield_amount=${JSON.stringify(o.yield_amount)}`);
    if (typeof o.yield_unit !== 'string' || o.yield_unit === '') bad.push('yield_unit');
    if (typeof o.is_estimate !== 'boolean') bad.push('is_estimate');
    if (bad.length) malformed.push(`${ing.id}/${o.id}: ${bad.join('+')}`);
    if (optionIds.has(o.id)) dupIds += 1;
    optionIds.add(o.id);
  }
}
check('D3', malformed.length === 0,
  `malformed options: ${malformed.length}${malformed.length ? ' -> ' + malformed.slice(0, 4).join(' | ') : ''} (${optionIds.size} distinct option ids)`);
check('D4', dupIds === 0, `duplicate option ids: ${dupIds}`);

// D5 — every ingredient id ANY shipped recipe can require resolves to an
// ingredient carrying >= 1 option. This is the literal clause "every ingredient
// a catalog recipe CAN require", read off the recipes rather than the registry.
const recipeDir = `${TARGET}/data/recipes`;
const required = new Set();
for (const f of readdirSync(recipeDir).filter((f) => f.endsWith('.json'))) {
  const r = JSON.parse(readFileSync(`${recipeDir}/${f}`, 'utf8'));
  for (const req of r.requirements ?? r.ingredients ?? []) {
    const id = req.ingredient_id ?? req.id;
    if (id) required.add(id);
  }
}
const unresolved = [...required].filter((id) => {
  const ing = byId.get(id);
  return !ing || !Array.isArray(ing.package_options) || ing.package_options.length === 0;
});
check('D5', required.size > 0 && unresolved.length === 0,
  `${required.size} distinct ingredient ids required across shipped recipes; unresolved/optionless: ${unresolved.length}${unresolved.length ? ' -> ' + unresolved.slice(0, 5).join(',') : ''}`);

// D6 — the estimate flag is actually USED, in both directions. A file where
// every option is is_estimate:false renders no estimate label; a file where
// every option is true is dishonest about precisely-packaged goods.
let est = 0, exact = 0;
for (const ing of ingredients) for (const o of ing.package_options ?? []) (o.is_estimate ? est++ : exact++);
check('D6', est > 0 && exact > 0, `is_estimate split — ${est} estimated / ${exact} exact of ${est + exact}`);

// ---------------------------------------------------------------------------
// L — the LIVE half. The endpoint a user's grocery screen actually calls.
// ---------------------------------------------------------------------------

console.log('\n=== L — live half (sentence 2): GET /api/plans/:planId/grocery ===');
const srv = await boot();
try {
  const householdId = await makeHousehold(srv.baseUrl);
  const plan = await makePlan(srv.baseUrl, householdId);
  const planId = plan?.plan?.id ?? plan?.plan_id ?? plan?.id;
  const meals = plan?.plan?.meals ?? plan?.meals ?? [];
  check('L0', Boolean(planId) && meals.length > 0,
    `real plan created: plan_id=${planId} meals=${meals.length}`);

  const g = await grocery(srv.baseUrl, householdId, planId);
  const lines = g.body?.grocery?.lines ?? g.body?.lines ?? [];
  check('L1', g.status === 200 && lines.length > 0,
    `grocery ${g.status}, ${lines.length} lines`);

  const labelled = lines.filter((l) => l.package_label !== null && l.package_label !== undefined);
  const estimated = lines.filter((l) => l.is_estimate === true);
  const surplus = lines.filter((l) => {
    const s = l.expected_surplus;
    if (s === null || s === undefined) return false;
    const n = typeof s === 'object' ? parseRat(s.amount ?? s.value) : parseRat(s);
    return Number.isFinite(n) && n > 0;
  });

  check('L2', labelled.length > 0,
    `lines with a non-null package_label: ${labelled.length}/${lines.length}`);
  check('L3', estimated.length > 0,
    `lines with is_estimate true: ${estimated.length}/${lines.length}`);
  check('L4', surplus.length > 0,
    `lines with non-zero expected_surplus: ${surplus.length}/${lines.length}`);

  // Census — printed whatever the verdict, so the journal records the real
  // shape of the list rather than only the pass/fail bit.
  console.log('  --- first 6 lines as the grocery screen receives them ---');
  for (const l of lines.slice(0, 6)) {
    console.log(`    ${String(l.display_name ?? l.ingredient_id).padEnd(22)} label=${JSON.stringify(l.package_label)} est=${l.is_estimate} surplus=${JSON.stringify(l.expected_surplus)}`);
  }
} finally {
  await srv.stop();
}

console.log(`\nT-065 GATE: ${pass} pass / ${fail} fail`);
if (failures.length) { console.log('failures:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail === 0 ? 0 : 1);
