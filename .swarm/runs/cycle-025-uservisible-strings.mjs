/**
 * cycle-025-uservisible-strings.mjs (rev2) — CONDUCTOR check, substituting for
 * the qa-verify look pass this headless session cannot run.
 *
 * T-054 touched all 10 client files. The builder claims the edit is
 * annotation-only and behaviour-preserving. That claim is checkable without a
 * browser: extract every string LITERAL from each client file at HEAD and in
 * the working tree and diff the multisets. Changed copy, a removed label, a
 * changed CSS class or a changed API path all show up. JSDoc annotations live
 * in comments and cannot.
 *
 * AMENDMENT LOG (rev2). rev1 is preserved unmodified at
 * `cycle-025-uservisible-strings-rev1.mjs`, its output at
 * `cycle-025-uservisible-strings-rev1-HARNESSFAULT.txt` (+16 / -1). rev1
 * stripped comments with regexes, block comments FIRST. onboarding.js line 29
 * at HEAD is a LINE comment containing the glob `data/recipes/*` — the block
 * pass read that `/*` as an opener and swallowed every literal down to the next
 * `*​/`, roughly 40 lines of real stepper code. A JSDoc block added by this wave
 * closes the fake comment earlier, so those literals "reappeared" and rev1
 * reported 22 phantom additions in onboarding.js ("Fewer people", "More
 * people", "field__hint" …). Every one of them is present at HEAD — verified by
 * grep — so rev1's whole delta for that file was an artefact of MY check.
 *
 * rev2 stops hand-rolling a lexer and uses the TypeScript compiler's own
 * scanner (already a devDependency) to walk the real AST. That is strictly
 * stronger than rev1, not weaker: it cannot be confused by a glob, a regex
 * literal, a `//` inside a string, or a nested template.
 *
 * This is still narrower than a look pass — it says nothing about layout,
 * states or visual craft — and is reported as exactly that.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const TARGET = '/opt/targets/dinner';
const ts = createRequire(`${TARGET}/package.json`)('typescript');

/** Every string / template literal in the file, via the real parser. */
const literals = (src, name) => {
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const out = [];
  const walk = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      out.push(node.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
};

const count = (arr) => arr.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map());

let totalAdded = 0;
let totalRemoved = 0;
const files = readdirSync(`${TARGET}/web/js`).filter((f) => f.endsWith('.js')).sort();
for (const f of files) {
  const head = execFileSync('git', ['-C', TARGET, 'show', `HEAD:web/js/${f}`], { encoding: 'utf8' });
  const now = readFileSync(`${TARGET}/web/js/${f}`, 'utf8');
  const ca = count(literals(head, f));
  const cb = count(literals(now, f));
  const added = [];
  const removed = [];
  for (const [s, n] of cb) if ((ca.get(s) ?? 0) < n) added.push(s);
  for (const [s, n] of ca) if ((cb.get(s) ?? 0) < n) removed.push(s);
  totalAdded += added.length;
  totalRemoved += removed.length;
  const nA = [...ca.values()].reduce((a, b) => a + b, 0);
  const nB = [...cb.values()].reduce((a, b) => a + b, 0);
  console.log(`${f.padEnd(16)} ${String(nA).padStart(4)} literals @HEAD -> ${String(nB).padStart(4)} now   ${added.length || removed.length ? 'CHANGED' : 'identical'}`);
  for (const s of added) console.log(`    + ${JSON.stringify(s).slice(0, 130)}`);
  for (const s of removed) console.log(`    - ${JSON.stringify(s).slice(0, 130)}`);
}
console.log(`\nstring-literal delta across all ${files.length} client files: +${totalAdded} / -${totalRemoved}`);
