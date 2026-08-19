/**
 * cycle-025-gate-T-054.mjs — CONDUCTOR-authored gate. No builder has seen it.
 *
 * T-054 acceptance, quoted verbatim from the backlog:
 *
 *   "npm run typecheck covers web/js/*.js with checkJs, or a second explicit
 *    script does, and the command fails on a real type error introduced there.
 *    Proven by tsc --listFiles including web/js files, which today returns zero."
 *
 * The acceptance names its own failure mode, which is why this gate is mostly
 * about failability rather than about a green run. A config with an empty
 * `include`, or one that swallows errors, produces a green checker that checks
 * nothing — the exact vacuous-green state this item exists to end. So:
 *
 *   W1  the web checker runs clean
 *   W2  --listFiles covers EVERY web/js file enumerated off disk by this file
 *   W3  config integrity: allowJs + checkJs + strict, no exclusions
 *   W4  anti-cheat: no ts-ignore / ts-expect-error / ts-nocheck, and no NEWLY
 *       added `{any}` annotation (measured against git HEAD, not asserted)
 *   W5  FAILABILITY: a real semantic type error injected into three distinct
 *       client files — a leaf, a shared module, and the one file with a known
 *       history — must each break `npm test`. Restored byte-identically.
 *   W6  `npm test` is green with the new script wired in
 *
 *   PROBE (reported, NOT scored — outside the acceptance): whether node globals
 *   are ambient in browser code, i.e. whether `types` needs pinning.
 *
 * Run: node .swarm/runs/cycle-025-gate-T-054.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TARGET = '/opt/targets/dinner';
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

let pass = 0;
let fail = 0;
const failures = [];
const check = (id, ok, detail) => {
  if (ok) { pass += 1; console.log(`PASS ${id}  ${detail ?? ''}`.trimEnd()); }
  else { fail += 1; failures.push(`${id}: ${detail ?? ''}`); console.log(`FAIL ${id}  ${detail ?? ''}`.trimEnd()); }
};
const run = (cmd, args) => {
  try {
    return { code: 0, out: execFileSync(cmd, args, { cwd: TARGET, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

// --- W1 --------------------------------------------------------------------
const w1 = run('npx', ['tsc', '-p', 'tsconfig.web.json']);
check('W1', w1.code === 0,
  `npx tsc -p tsconfig.web.json -> exit ${w1.code}${w1.code ? ' :: ' + w1.out.split('\n').slice(0, 3).join(' / ') : ' (clean)'}`);

// --- W2: coverage measured against the directory, not against a claim -------
const onDisk = readdirSync(`${TARGET}/web/js`).filter((f) => f.endsWith('.js')).sort();
const listed = run('npx', ['tsc', '-p', 'tsconfig.web.json', '--listFiles']);
const covered = new Set(
  listed.out.split('\n').filter((l) => l.includes('/web/js/')).map((l) => l.trim().split('/').pop()),
);
const uncovered = onDisk.filter((f) => !covered.has(f));
check('W2', onDisk.length > 0 && uncovered.length === 0,
  `--listFiles covers ${covered.size}/${onDisk.length} client files on disk` +
  (uncovered.length ? ` -> UNCOVERED: ${uncovered.join(', ')}` : ` (${onDisk.join(', ')})`));

// --- W3: config integrity --------------------------------------------------
const cfg = JSON.parse(readFileSync(`${TARGET}/tsconfig.web.json`, 'utf8'));
const co = cfg.compilerOptions ?? {};
const cfgFaults = [];
if (co.allowJs !== true) cfgFaults.push('allowJs not true');
if (co.checkJs !== true) cfgFaults.push('checkJs not true');
if (co.strict !== true) cfgFaults.push('strict not true');
if (!Array.isArray(co.lib) || !co.lib.some((l) => String(l).toLowerCase().includes('dom'))) cfgFaults.push('lib omits dom');
if (cfg.exclude) cfgFaults.push(`exclude present: ${JSON.stringify(cfg.exclude)}`);
check('W3', cfgFaults.length === 0,
  cfgFaults.length ? cfgFaults.join(' | ') : `allowJs+checkJs+strict, lib=${JSON.stringify(co.lib)}, no exclude, include=${JSON.stringify(cfg.include)}`);

// --- W4: anti-cheat --------------------------------------------------------
let suppressions = [];
let addedAny = 0;
for (const f of onDisk) {
  const src = readFileSync(`${TARGET}/web/js/${f}`, 'utf8');
  for (const pat of ['@ts-ignore', '@ts-expect-error', '@ts-nocheck']) {
    if (src.includes(pat)) suppressions.push(`${f}:${pat}`);
  }
}
const diff = run('git', ['-C', TARGET, 'diff', '-U0', '--', 'web/js/']);
addedAny = diff.out.split('\n').filter((l) => l.startsWith('+') && /\{\s*any\b/.test(l) && !l.trimStart().startsWith('+//')).length;
check('W4a', suppressions.length === 0,
  `error suppressions in client code: ${suppressions.length}${suppressions.length ? ' -> ' + suppressions.join(', ') : ''}`);
check('W4b', addedAny === 0,
  `NEW {any} annotations added by this wave (diff vs HEAD): ${addedAny} — pre-existing ones are counted in the PROBE below, not here`);

// --- W5: FAILABILITY — the clause the acceptance actually names -------------
console.log('\n=== W5 — the checker must FAIL on a real type error in client code ===');
const INJECTIONS = [
  { file: 'web/js/ui.js', why: 'shared module every screen imports', anchor: null },
  { file: 'web/js/grocery.js', why: 'a leaf screen', anchor: null },
  { file: 'web/js/cook.js', why: 'the file whose NaN-label defect this item exists to have caught', anchor: null },
];
let killed = 0;
for (const inj of INJECTIONS) {
  const path = `${TARGET}/${inj.file}`;
  const before = readFileSync(path, 'utf8');
  const beforeSha = sha(path);
  // A REAL semantic error, not a syntax error: calling a method that does not
  // exist on a number. Syntax errors would prove only that the parser runs.
  const probe = '\nconst __gateProbe = 1;\n__gateProbe.notARealMethod();\n';
  writeFileSync(path, before + probe);
  const r = run('npm', ['test']);
  writeFileSync(path, before);
  const afterSha = sha(path);
  const namedTheFile = r.out.includes(inj.file) || r.out.includes(inj.file.split('/').pop());
  const ok = r.code !== 0 && namedTheFile && beforeSha === afterSha;
  if (ok) killed += 1;
  const firstErr = (r.out.match(/error TS\d+[^\n]*/) ?? ['(no TS error line)'])[0];
  check(`W5:${inj.file.split('/').pop()}`, ok,
    `${inj.why} -> npm test exit ${r.code}, names the file: ${namedTheFile}, restored identically: ${beforeSha === afterSha}\n        ${firstErr.slice(0, 130)}`);
}

// --- W6 --------------------------------------------------------------------
console.log('\n=== W6 — the wired-up command is green on the real tree ===');
const w6 = run('npm', ['test']);
const counts = w6.out.match(/ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
check('W6', w6.code === 0,
  `npm test -> exit ${w6.code}${counts ? `, ${counts[1]} pass / ${counts[2]} fail` : ''}` +
  (w6.code ? ' :: ' + w6.out.split('\n').slice(-6).join(' / ') : ''));

// --- PROBE: reported, not scored ------------------------------------------
console.log('\n=== PROBE — reported, NOT part of the acceptance and NOT scored ===');
let preexistingAny = 0;
for (const f of onDisk) {
  preexistingAny += (readFileSync(`${TARGET}/web/js/${f}`, 'utf8').match(/\{\s*any\b/g) ?? []).length;
}
console.log(`  PROBE-1  {any} annotations still present in client code: ${preexistingAny}. checkJs enforces them AS any — these lines are checked but unconstrained. Not regressions (W4b shows this wave added none); a real remaining gap.`);
const nodeProbePath = `${TARGET}/web/js/router.js`;
const nodeBefore = readFileSync(nodeProbePath, 'utf8');
const nodeSha = sha(nodeProbePath);
writeFileSync(nodeProbePath, nodeBefore + '\nconst __nodeProbe = process.version;\n');
const np = run('npx', ['tsc', '-p', 'tsconfig.web.json']);
writeFileSync(nodeProbePath, nodeBefore);
console.log(`  PROBE-2  browser code referencing the node global \`process\`: tsc exit ${np.code} -> ${np.code === 0 ? 'ACCEPTED (tsconfig.web.json omits "types", so @types/node is ambient in client code — a real residual gap, file it)' : 'REJECTED (node globals are correctly out of scope)'}; router.js restored identically: ${nodeSha === sha(nodeProbePath)}`);

console.log(`\nT-054 GATE: ${pass} pass / ${fail} fail   (failability kills: ${killed}/${INJECTIONS.length})`);
if (failures.length) { console.log('failures:'); for (const f of failures) console.log('  - ' + f); }
process.exit(fail === 0 ? 0 : 1);
