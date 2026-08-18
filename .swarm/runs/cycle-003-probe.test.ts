// Conductor toolchain probe, cycle 3. Proves Node 24 native type stripping runs
// under `node --test` with a glob, before the wave-0 manifests claim it works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

type Rational = { num: bigint; den: bigint };

test('type stripping under node --test', () => {
  const r: Rational = { num: 3n, den: 4n };
  assert.equal(r.num * 100n / r.den, 75n);
});

test('node:sqlite on a real file db with the statement api', (t) => {
  const path = new URL('./cycle-003-probe.db', import.meta.url).pathname;
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS t (id TEXT PRIMARY KEY, n INTEGER)');
  const ins = db.prepare('INSERT OR REPLACE INTO t (id, n) VALUES (?, ?)');
  ins.run('a', 1);
  const got = db.prepare('SELECT n FROM t WHERE id = ?').get('a') as { n: number };
  assert.equal(got.n, 1);
  db.close();
});
