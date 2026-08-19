import fs from 'node:fs';
const p = '/opt/targets/dinner/.swarm/state.json';
const s = JSON.parse(fs.readFileSync(p, 'utf8'));

s.cycle = 23;
s.phase = 'BUILD';

// Churn breaker: three items verified this cycle → reset.
s.counters.consecutive_no_value = 0;
s.counters.consecutive_failures = 0;
// Wave autotune: the wave was CLEAN (zero reverts, zero failed verifies) →
// streak +1. It reaches 2 next clean wave, and only then does k_current move.
// k_current stays 5; the gear cap of 2 is what actually binds today.
s.counters.wave_streak = 1;
// Burn attribution: window_tokens went 141,578,956 → 411,729, i.e. NEGATIVE.
// That is the 09:00Z window reset, not a cycle that burned nothing, so
// attribution is skipped this cycle per cycle.md Multi-target failover.
s.counters.window_tokens_attributed = 411729;

s.last_cycle = {
  n: 23,
  work: 'build-wave (D-11 direct foreground/background Agent dispatch, 2 builders, disjoint scopes) + a third item closed by conductor verification alone',
  outcome: '3 verified (T-017, T-038, T-057) — the largest verified-value cycle of this run',
  verified: ['T-017', 'T-038', 'T-057'],
  failed: [],
  test_cmd: 'npm test → 394/394 pass, 0 fail (run by the conductor, not by an agent); npx tsc --noEmit clean',
  gate:
    'T-017 15/15 reachable + 3 unreachable-by-design (cycle-023-gate-T-017-rev2.mjs); ' +
    'T-038 13/14 + 4/4 wire reachability incl. 3 mutation kills (cycle-023-gate-T-038.mjs, -rev2.mjs); ' +
    'T-057 12/13 + 8/8 quantity addendum (cycle-023-gate-T-057.mjs, -p11.mjs). ' +
    'collision-scan: not applicable (no classic scripts — ES modules throughout).',
  note:
    'Three NEW findings came out of verification rather than out of a builder: T-065 (catalog ships zero package options, so package-size selection, estimate labelling and surplus are all dead code — two of D-4\'s three named differentiators are switched off), T-066 (confirmation questions unreachable by any user-facing path, a consequence of D-2), T-067 (prep screen renders "Pause up to 418 minutes"). None was visible to unit tests, because unit tests supply their own fixtures; only gates driving the REAL catalog through the REAL server could see them.',
};

s.qa.last_look_cycle = 23;
s.updated_at = new Date().toISOString();

fs.writeFileSync(p + '.tmp', JSON.stringify(s, null, 2));
fs.renameSync(p + '.tmp', p);
console.log('state cycle', s.cycle, 'counters', JSON.stringify(s.counters));
