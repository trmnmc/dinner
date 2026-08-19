/**
 * cycle-017-gate.mjs — CONDUCTOR-authored verification gate for T-043
 * (prep quantities must be scaled to the plan meal's target_servings).
 *
 * Authored AFTER the builder finished. The builder never saw this file and was
 * never told what it checks.
 *
 * INDEPENDENCE IS THE POINT. The builder's own tests import `scale.ts` — the
 * very module whose correctness is in question — so a bug inside scale.ts would
 * be invisible to them. This gate imports NO domain code at all. It reads the
 * raw recipe JSON off disk, re-derives every expected quantity with rational
 * BigInt arithmetic written here from scratch, and compares against what the
 * LIVE HTTP endpoint actually returns. The only product code in the loop is the
 * real server entrypoint.
 *
 * Checks:
 *   G1  server boots; a household of 2 gets a plan with active meals
 *   G2  every prep quantity == raw × target_servings / servings_default,
 *       re-derived independently, for every active meal, every line
 *   G3  to_taste passes through unscaled (there is no such thing as half a
 *       "to taste")
 *   G4  the scaling is actually observable — at least one line's value MOVED
 *       (a factor-1 coincidence would make G2 vacuous)
 *   G5  identity: a household of 4 against servings_default-4 recipes gets the
 *       raw amounts back, unchanged — no double-scaling
 *   G6  NON-INTEGER factor: a household of 3 gets exact thirds/quarters, not
 *       truncated integers (900 × 3/4 = 675, not 674 or 675.0000001)
 *   G7  THE ACCEPTANCE CRITERION: prep and grocery agree, on the wire, for the
 *       same plan — prep line amount == that recipe's grocery contribution
 *   G8  scaling touched ONLY quantities: equipment, do-ahead tasks, step text
 *       and the time labels are identical between a size-2 and a size-4 fetch
 *       (cooking time does not halve because the household did)
 *
 * Run: node .swarm/runs/cycle-017-gate.mjs
 */

import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../../server/src/main.ts';

const REPO = new URL('../../', import.meta.url).pathname;

let pass = 0;
let fail = 0;
const failures = [];

function check(id, ok, detail) {
  if (ok) {
    pass += 1;
    console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd());
  } else {
    fail += 1;
    failures.push(`${id}: ${detail ?? ''}`);
    console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd());
  }
}

// ---------------------------------------------------------------------------
// Rational arithmetic, written here, importing nothing from the product.
// ---------------------------------------------------------------------------

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function rat(n, d = 1n) {
  if (d === 0n) throw new Error('zero denominator');
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

/** Parse the catalog's on-disk amount form: "900", "3/4" or "1.5". */
function parseAmount(s) {
  const t = String(s).trim();
  if (t.includes('/')) {
    const [n, d] = t.split('/');
    return rat(BigInt(n), BigInt(d));
  }
  if (t.includes('.')) {
    const [i, f] = t.split('.');
    const neg = i.trim().startsWith('-');
    const scale = 10n ** BigInt(f.length);
    const whole = BigInt(i) * scale;
    const frac = BigInt(f);
    return rat(neg ? whole - frac : whole + frac, scale);
  }
  return rat(BigInt(t));
}

/** Parse the wire form the server encodes rationals in: {n, d} as strings. */
function parseWire(q) {
  if (q === null || typeof q !== 'object') return null;
  if (typeof q.n !== 'string' || typeof q.d !== 'string') return null;
  return rat(BigInt(q.n), BigInt(q.d));
}

const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const eqRat = (a, b) => a.n === b.n && a.d === b.d;
const showRat = (r) => (r.d === 1n ? `${r.n}` : `${r.n}/${r.d}`);

// ---------------------------------------------------------------------------
// Raw catalog, straight off disk — not through catalog.ts.
// ---------------------------------------------------------------------------

const RAW = new Map();
for (const f of readdirSync(join(REPO, 'data/recipes'))) {
  if (!f.endsWith('.json')) continue;
  const r = JSON.parse(readFileSync(join(REPO, 'data/recipes', f), 'utf8'));
  RAW.set(r.id, r);
}

// ---------------------------------------------------------------------------
// Server + HTTP
// ---------------------------------------------------------------------------

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'dinner-gate-c17-'));
  const started = await startServer(['--port', '0', '--db', join(dir, 'gate.db')]);
  return {
    baseUrl: `http://127.0.0.1:${started.port}`,
    async stop() {
      try {
        await new Promise((r) => started.server.close(() => r()));
        started.db.close();
      } catch { /* already down */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

async function api(baseUrl, path, { method = 'GET', body, householdId } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (householdId) headers['x-household-id'] = householdId;
  const res = await fetch(baseUrl + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  if (text.length > 0) { try { payload = JSON.parse(text); } catch { payload = { __raw: text.slice(0, 300) }; } }
  return { status: res.status, body: payload };
}

async function household(baseUrl, size) {
  const res = await api(baseUrl, '/api/households', {
    method: 'POST',
    body: {
      household: {
        name: `Gate household of ${size}`,
        household_size: size,
        novelty_preference: 'mostly_familiar',
        weeknight_active_time_ceiling_seconds: 1800,
        weeknight_total_time_ceiling_seconds: 3600,
      },
      member: { display_name: 'Gate parent', dietary_restrictions: [], allergies: [], never_recommend_ingredients: [] },
    },
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`household(${size}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body?.household_id ?? res.body?.household?.id ?? res.body?.id;
}

/** Create a plan and return [{slot, recipe_id, prep}] for every active meal. */
async function planWithPrep(baseUrl, hid) {
  const created = await api(baseUrl, '/api/plans', { method: 'POST', body: {}, householdId: hid });
  if (created.status !== 201 && created.status !== 200) throw new Error(`plan failed: ${created.status} ${JSON.stringify(created.body)}`);
  const plan = created.body?.plan ?? created.body;
  const planId = plan.id ?? plan.plan_id;
  const meals = (plan.meals ?? []).filter((m) => m.status !== 'swapped_out');
  const out = [];
  for (const m of meals) {
    const slot = m.slot;
    const prep = await api(baseUrl, `/api/plans/${planId}/meals/${slot}/prep`, { householdId: hid });
    if (prep.status !== 200) throw new Error(`prep slot ${slot} failed: ${prep.status} ${JSON.stringify(prep.body)}`);
    out.push({ slot, recipe_id: m.recipe_id ?? m.recipe?.id, prep: prep.body.prep });
  }
  return { planId, meals: out };
}

// ---------------------------------------------------------------------------

async function main() {
  const srv = await boot();
  try {
    // ---- G1 -------------------------------------------------------------
    const h2 = await household(srv.baseUrl, 2);
    const p2 = await planWithPrep(srv.baseUrl, h2);
    check('G1', p2.meals.length > 0, `household of 2 → plan ${p2.planId} with ${p2.meals.length} active meal(s)`);

    // ---- G2 / G3 / G4 ---------------------------------------------------
    // Expected = raw × 2/4 (or whatever the recipe's own servings_default is),
    // re-derived here. Nothing from scale.ts is in this arithmetic.
    let g2bad = [];
    let g3bad = [];
    let moved = 0;
    let lines = 0;
    for (const m of p2.meals) {
      const raw = RAW.get(m.recipe_id);
      if (!raw) { g2bad.push(`no raw json for ${m.recipe_id}`); continue; }
      const factor = rat(2n, BigInt(raw.servings_default));
      const wire = [...m.prep.required_ingredients, ...m.prep.optional_ingredients];
      for (const rawLine of raw.ingredients) {
        const got = wire.find((w) => w.id === rawLine.id);
        if (!got) { g2bad.push(`${raw.id}:${rawLine.id} missing from prep response`); continue; }
        lines += 1;
        const rq = rawLine.quantity;
        if (rq.kind === 'to_taste') {
          if (got.quantity.kind !== 'to_taste') g3bad.push(`${raw.id}:${rawLine.id} to_taste became ${got.quantity.kind}`);
          continue;
        }
        const parts = rq.kind === 'exact' ? ['amount'] : ['min', 'max'];
        for (const part of parts) {
          const want = mul(parseAmount(rq[part]), factor);
          const gotR = parseWire(got.quantity[part]);
          if (gotR === null) { g2bad.push(`${raw.id}:${rawLine.id}.${part} unparsable ${JSON.stringify(got.quantity[part])}`); continue; }
          if (!eqRat(want, gotR)) {
            g2bad.push(`${raw.id}:${rawLine.id}.${part} want ${showRat(want)} ${rq.unit}, got ${showRat(gotR)} ${got.quantity.unit}`);
          }
          if (!eqRat(parseAmount(rq[part]), gotR)) moved += 1;
        }
        if (got.quantity.unit !== rq.unit) g2bad.push(`${raw.id}:${rawLine.id} unit changed ${rq.unit} → ${got.quantity.unit}`);
      }
    }
    check('G2', g2bad.length === 0, `${lines} prep ingredient lines across ${p2.meals.length} meals match independently re-derived raw × target/servings_default` + (g2bad.length ? ` — ${g2bad.slice(0, 6).join(' | ')}` : ''));
    check('G3', g3bad.length === 0, 'to_taste lines pass through unscaled' + (g3bad.length ? ` — ${g3bad.join(' | ')}` : ''));
    check('G4', moved > 0, `${moved} quantity value(s) actually MOVED off the raw catalog number — G2 is not a factor-1 tautology`);

    // ---- G5 identity ----------------------------------------------------
    const h4 = await household(srv.baseUrl, 4);
    const p4 = await planWithPrep(srv.baseUrl, h4);
    let g5bad = [];
    let g5lines = 0;
    for (const m of p4.meals) {
      const raw = RAW.get(m.recipe_id);
      if (!raw || raw.servings_default !== 4) continue;
      const wire = [...m.prep.required_ingredients, ...m.prep.optional_ingredients];
      for (const rawLine of raw.ingredients) {
        const got = wire.find((w) => w.id === rawLine.id);
        if (!got || rawLine.quantity.kind === 'to_taste') continue;
        for (const part of rawLine.quantity.kind === 'exact' ? ['amount'] : ['min', 'max']) {
          g5lines += 1;
          const want = parseAmount(rawLine.quantity[part]);
          const gotR = parseWire(got.quantity[part]);
          if (!gotR || !eqRat(want, gotR)) g5bad.push(`${raw.id}:${rawLine.id}.${part} want ${showRat(want)}, got ${gotR ? showRat(gotR) : 'null'}`);
        }
      }
    }
    check('G5', g5lines > 0 && g5bad.length === 0, `identity case: ${g5lines} values from a size-4 household against servings_default-4 recipes come back unchanged (no double-scaling)` + (g5bad.length ? ` — ${g5bad.slice(0, 5).join(' | ')}` : ''));

    // ---- G6 non-integer factor -----------------------------------------
    const h3 = await household(srv.baseUrl, 3);
    const p3 = await planWithPrep(srv.baseUrl, h3);
    let g6bad = [];
    let g6frac = 0;
    for (const m of p3.meals) {
      const raw = RAW.get(m.recipe_id);
      if (!raw) continue;
      const factor = rat(3n, BigInt(raw.servings_default));
      const wire = [...m.prep.required_ingredients, ...m.prep.optional_ingredients];
      for (const rawLine of raw.ingredients) {
        const got = wire.find((w) => w.id === rawLine.id);
        if (!got || rawLine.quantity.kind === 'to_taste') continue;
        for (const part of rawLine.quantity.kind === 'exact' ? ['amount'] : ['min', 'max']) {
          const want = mul(parseAmount(rawLine.quantity[part]), factor);
          const gotR = parseWire(got.quantity[part]);
          if (!gotR || !eqRat(want, gotR)) g6bad.push(`${raw.id}:${rawLine.id}.${part} want ${showRat(want)}, got ${gotR ? showRat(gotR) : 'null'}`);
          else if (want.d !== 1n) g6frac += 1;
        }
      }
    }
    check('G6', g6bad.length === 0 && g6frac > 0, `household of 3: exact rational thirds/quarters preserved (${g6frac} genuinely fractional value(s), zero truncation)` + (g6bad.length ? ` — ${g6bad.slice(0, 5).join(' | ')}` : ''));

    // ---- G7 THE ACCEPTANCE CRITERION: prep agrees with grocery ----------
    const groc = await api(srv.baseUrl, `/api/plans/${p2.planId}/grocery`, { householdId: h2 });
    if (groc.status !== 200) throw new Error(`grocery failed: ${groc.status} ${JSON.stringify(groc.body)}`);
    // Live shape is { list: { sections: [ { lines: [...] } ] } } — confirmed
    // against the running server, not assumed. rev1 of this gate walked
    // `body.grocery.sections`, found nothing, and reported `compared 0`, which
    // FAILED the check rather than passing it vacuously. That is the harness
    // working: a check with no data is not a pass.
    const glist = groc.body.list ?? groc.body.grocery ?? groc.body;
    const glines = (glist.sections ?? []).flatMap((s) => s.lines ?? []);
    const prepByRecipeIngredient = new Map();
    for (const m of p2.meals) {
      for (const w of [...m.prep.required_ingredients, ...m.prep.optional_ingredients]) {
        prepByRecipeIngredient.set(`${m.recipe_id}::${w.ingredient_id}`, w);
      }
    }
    let compared = 0;
    const unitSkipped = [];
    const g7bad = [];
    for (const gl of glines) {
      for (const c of gl.provenance?.contributions ?? []) {
        const w = prepByRecipeIngredient.get(`${c.recipe_id}::${gl.ingredient_id}`);
        if (!w || w.quantity.kind === 'to_taste') continue;
        // Compare only where the grocery line's canonical unit is the same
        // unit prep reports in. Where they differ, the grocery path applied a
        // unit conversion this gate deliberately does not reimplement —
        // counted and named below, never silently dropped.
        if (w.quantity.unit !== c.unit) { unitSkipped.push(`${gl.ingredient_id} (${w.quantity.unit}→${c.unit})`); continue; }
        const prepAmt = parseWire(w.quantity.kind === 'exact' ? w.quantity.amount : w.quantity.max);
        const grocAmt = parseWire(c.amount);
        compared += 1;
        if (!prepAmt || !grocAmt || !eqRat(prepAmt, grocAmt)) {
          g7bad.push(`${gl.ingredient_id} from ${c.recipe_name}: prep ${prepAmt ? showRat(prepAmt) : 'null'} vs grocery ${grocAmt ? showRat(grocAmt) : 'null'} ${c.unit}`);
        }
      }
    }
    check('G7', compared > 0 && g7bad.length === 0, `${compared} prep↔grocery ingredient pairs agree on the same plan; ${unitSkipped.length} skipped as unit-converted${unitSkipped.length ? ` [${[...new Set(unitSkipped)].join(', ')}]` : ''}` + (g7bad.length ? ` — ${g7bad.slice(0, 6).join(' | ')}` : ''));

    // ---- G8 scaling touched nothing but quantities ----------------------
    // Same recipe seen by a size-2 and a size-4 household: everything except
    // the ingredient quantities must be byte-identical. Cooking time does not
    // halve because the household did.
    const g8bad = [];
    let g8pairs = 0;
    const byRecipe4 = new Map(p4.meals.map((m) => [m.recipe_id, m.prep]));
    for (const m of p2.meals) {
      const other = byRecipe4.get(m.recipe_id);
      if (!other) continue;
      g8pairs += 1;
      for (const field of ['equipment', 'do_ahead_tasks', 'active_time_blocks', 'first_non_interruptible_step', 'first_safe_stopping_point']) {
        if (JSON.stringify(m.prep[field]) !== JSON.stringify(other[field])) g8bad.push(`${m.recipe_id}.${field} differs between household sizes`);
      }
      for (const field of ['total_seconds', 'active_seconds', 'time_label']) {
        if (JSON.stringify(m.prep[field]) !== JSON.stringify(other[field])) g8bad.push(`${m.recipe_id}.${field}: ${JSON.stringify(m.prep[field])} vs ${JSON.stringify(other[field])}`);
      }
    }
    check('G8', g8pairs > 0 && g8bad.length === 0, `${g8pairs} recipe(s) seen at both household sizes: equipment, do-ahead, blocks, safe stop and every time field identical` + (g8bad.length ? ` — ${g8bad.slice(0, 5).join(' | ')}` : ''));
  } finally {
    await srv.stop();
  }

  console.log(`\npass ${pass} / ${pass + fail}`);
  if (fail > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log('  ' + f);
    process.exitCode = 1;
  }
}

await main();
