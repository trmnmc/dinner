/**
 * cycle-025-uservisible-strings.mjs — CONDUCTOR check, substituting for the
 * qa-verify look pass that this headless session cannot run.
 *
 * T-054 touched all 10 client files (618 insertions across the wave). The
 * builder claims the edit is type-annotation-only and behaviour-preserving.
 * That claim is checkable without a browser: extract every string LITERAL from
 * each client file at HEAD and in the working tree, and diff the multisets.
 * A copy change, a removed label, a changed CSS class or a changed API path all
 * show up here. Type annotations live in comments and cannot.
 *
 * This is narrower than a look pass — it says nothing about layout or states —
 * and is reported as exactly that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const TARGET = '/opt/targets/dinner';

// Strip comments first, so JSDoc prose (where the type annotations went) cannot
// be mistaken for shipped copy.
const literals = (src) => {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out = [];
  const re = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g;
  let m;
  while ((m = re.exec(noComments)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out.sort();
};

let totalAdded = 0;
let totalRemoved = 0;
const files = readdirSync(`${TARGET}/web/js`).filter((f) => f.endsWith('.js')).sort();
for (const f of files) {
  const head = execFileSync('git', ['-C', TARGET, 'show', `HEAD:web/js/${f}`], { encoding: 'utf8' });
  const now = readFileSync(`${TARGET}/web/js/${f}`, 'utf8');
  const a = literals(head);
  const b = literals(now);
  const count = (arr) => arr.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const added = [];
  const removed = [];
  for (const [s, n] of cb) if ((ca.get(s) ?? 0) < n) added.push(s);
  for (const [s, n] of ca) if ((cb.get(s) ?? 0) < n) removed.push(s);
  totalAdded += added.length;
  totalRemoved += removed.length;
  const flag = added.length || removed.length ? 'CHANGED' : 'identical';
  console.log(`${f.padEnd(16)} ${String(a.length).padStart(4)} literals @HEAD -> ${String(b.length).padStart(4)} now   ${flag}`);
  for (const s of added.slice(0, 8)) console.log(`    + ${JSON.stringify(s).slice(0, 120)}`);
  for (const s of removed.slice(0, 8)) console.log(`    - ${JSON.stringify(s).slice(0, 120)}`);
}
console.log(`\nstring-literal delta across all ${files.length} client files: +${totalAdded} / -${totalRemoved}`);
console.log(totalAdded === 0 && totalRemoved === 0
  ? 'VERDICT: not one shipped string changed — the client edit is annotation-only in everything a user can read.'
  : 'VERDICT: shipped strings changed — inspect the deltas above before trusting the behaviour-preserving claim.');
