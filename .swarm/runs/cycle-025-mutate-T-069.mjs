/**
 * cycle-025-mutate-T-069.mjs — CONDUCTOR-authored failability run.
 *
 * A gate that cannot fail proves nothing. Each mutant below re-creates a
 * specific wrong world; the T-069 gate must FAIL in each, and every file must
 * be restored byte-identically afterwards (sha256 printed before and after).
 *
 *   M1  routes.ts passes `[]` to selectPackages again — the exact pre-cycle-25
 *       defect. Kills: P1a/P1b/P1c (the literal acceptance) must all go to zero.
 *   M2  catalog.ts parses package_options and then discards them — the OTHER
 *       half of the seam. Proves both edits are load-bearing, not just one.
 *   M3  routes.ts hardcodes is_estimate: false on the wire while labels stay
 *       real. Kills: P3a/P3b only — proves the estimate flag is checked against
 *       the authored data and not merely counted.
 *
 * Run: node .swarm/runs/cycle-025-mutate-T-069.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TARGET = '/opt/targets/dinner';
const ROUTES = `${TARGET}/server/src/routes.ts`;
const CATALOG = `${TARGET}/domain/src/catalog.ts`;

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'M1',
    file: ROUTES,
    desc: 'routes.ts passes [] to selectPackages again (the pre-cycle-25 defect)',
    from: 'selectPackages(line.purchase_requirement, line.dimension, registryEntry.package_options, registryEntry)',
    to: 'selectPackages(line.purchase_requirement, line.dimension, [], registryEntry)',
  },
  {
    id: 'M2',
    file: CATALOG,
    desc: 'catalog.ts parses package_options then discards them (the loader half)',
    from: 'package_options: packageOptions.value,',
    to: 'package_options: [],',
  },
  {
    id: 'M3',
    file: ROUTES,
    desc: 'routes.ts hardcodes is_estimate: false on the wire, labels untouched',
    from: '      is_estimate: selection.is_estimate,',
    to: '      is_estimate: false,',
  },
];

for (const m of MUTANTS) {
  const before = readFileSync(m.file, 'utf8');
  const beforeSha = sha(m.file);
  console.log(`\n=== ${m.id}: ${m.desc} ===`);
  if (!before.includes(m.from)) {
    console.log(`  SKIPPED — anchor not found in ${m.file}: ${JSON.stringify(m.from.slice(0, 60))}`);
    console.log('  (a skipped mutant is NOT a kill; recorded as not-run)');
    continue;
  }
  writeFileSync(m.file, before.replace(m.from, m.to));
  let out = '';
  let code = 0;
  try {
    out = execFileSync('node', [`${TARGET}/.swarm/runs/cycle-025-gate-T-069.mjs`], {
      cwd: TARGET, encoding: 'utf8', timeout: 300000,
    });
  } catch (e) {
    code = e.status ?? 1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  } finally {
    writeFileSync(m.file, before);
  }
  const verdict = out.match(/T-069 GATE: (\d+) pass \/ (\d+) fail/);
  const killed = code !== 0;
  const failedChecks = [...out.matchAll(/^FAIL (\S+)\s+(.*)$/gm)].map((x) => `${x[1]}`);
  console.log(`  gate exit=${code} -> ${killed ? 'KILLED' : 'SURVIVED (gate is too weak)'}`);
  console.log(`  ${verdict ? verdict[0] : 'gate produced no verdict line'}`);
  console.log(`  failing checks: [${failedChecks.join(',')}]`);
  for (const line of [...out.matchAll(/^FAIL (\S+)\s+(.*)$/gm)].slice(0, 4)) {
    console.log(`    - ${line[1]}: ${line[2].slice(0, 110)}`);
  }
  const afterSha = sha(m.file);
  console.log(`  ${m.file.replace(TARGET + '/', '')} sha256 before: ${beforeSha}`);
  console.log(`  ${m.file.replace(TARGET + '/', '')} sha256 after : ${afterSha}   RESTORED IDENTICALLY: ${beforeSha === afterSha}`);
}

console.log('\n=== post-run tree check (must be clean of mutant residue) ===');
console.log(execFileSync('git', ['-C', TARGET, 'diff', '--stat', '--', 'server/src/routes.ts', 'domain/src/catalog.ts'], { encoding: 'utf8' }).trim() || '(no unstaged diff vs HEAD in the two mutated files — expected, since the wave is not committed yet)');
