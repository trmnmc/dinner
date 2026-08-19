import fs from 'node:fs';
const p = '/opt/targets/dinner/.swarm/backlog.json';
const b = JSON.parse(fs.readFileSync(p, 'utf8'));

const t38 = b.items.find((i) => i.id === 'T-038');
t38.status = 'done';
t38.notes += ` | CYCLE 23 VERIFIED DONE. Conductor gates cycle-023-gate-T-038.mjs (13/14) + cycle-023-gate-T-038-rev2.mjs (4/4) = 17/17. Both defects fixed: n===1 now renders "The one recipe that could fill this slot is already in this plan.", and the empty-pool arm renders "There are no other recipes in the catalog to offer for this slot right now — that's a catalog gap, not something about your preferences." with the reassurance clause byte-intact. The n>1 string is byte-identical at n=2, 3 and 7, and the untouched third arm still counts and agrees at n=1 and n=3. MUTATION KILLS prove the guarding tests are not vacuous: reverting defect 1 fails 1 test, reverting defect 2 fails 2, deleting the catalog-gap clause fails 2, and reasons.ts is byte-identical after mutation testing. WIRE REACHABILITY: rev1's G14 could not drive the API into a no-alternatives outcome, which was MY error, not the product's — handleSwap already filters candidates to survivors NOT in the plan, and a swap that is never accepted does not change the plan, so repeating the request can never empty the pool. The reachable route is to make survivors == planned: a VEGETARIAN household has exactly that, so candidates is empty. Live POST returns 200 with alternatives:[], none_reason no_candidates_in_pool, and a message BYTE-IDENTICAL to what reasons.ts renders — proving routes.ts delegates rather than carrying its own copy (the triplicated private copy cycle 21 found is gone for real). Suite 394/394 and tsc --noEmit clean, both run by the conductor.`;

const t57 = b.items.find((i) => i.id === 'T-057');
t57.status = 'done';
t57.notes += ` | CYCLE 23 VERIFIED DONE. Conductor gate cycle-023-gate-T-057.mjs: 12 passed / 1 failed / 1 not run, plus the P11 addendum gate 8/8. ALL SIX required elements render against a real plan: 8/8 required ingredients, 3/3 equipment items, 4/4 do-ahead tasks, the first-non-interruptible-step region (null on this recipe — and the screen SAYS SO rather than rendering an empty region), the first safe stopping point, and 1/1 active-time blocks rendering time_label VERBATIM (T-040 honoured). DoD 6 satisfied: total and active present as separate values ("56 min total, 18 min hands-on"). No raw rationals anywhere. The route is live: router.js resolves #/prep/:slot to renderPrep and the notBuiltYet placeholder is gone. An out-of-range slot renders an honest message rather than a crash or a blank screen. The P11 addendum extended the quantity check to ALL THREE plan meals: 8/8, 10/10 and 11/11 exact quantities rendered exactly as the wire states them, and every to-taste ingredient stays non-numeric on all three (no fabricated numbers). The ONE gate failure (P9) is NOT an acceptance failure and is filed separately as T-067. NOTE: the builder could not run any of this itself — the agent sandbox denies ad-hoc POST, so it never created a household or a plan and verified by source reading plus existing route tests. This gate is the first time prep.js ever executed.`;

b.items.push({
  id: 'T-067',
  title: 'Prep screen tells a parent to "Pause up to 418 minutes"',
  kind: 'polish',
  priority: 2,
  value: 'M',
  effort: 'S',
  status: 'todo',
  deps: ['T-057'],
  files_hint: ['web/js/prep.js', 'server/src/routes.ts'],
  acceptance:
    'A bounded maximum_pause renders in humane units — "about 7 hours", not "418 minutes" — and duration formatting lives in ONE shared place rather than a second private helper inside prep.js.',
  packages: [],
  model: 'sonnet',
  attempts: 0,
  created_cycle: 23,
  notes:
    'FOUND BY THE CYCLE-23 T-057 GATE (check P9), root-caused at web/js/prep.js:182-188 durationWords() and :206-212 safeStopText(). Two things in one finding. (1) COPY: durationWords divides by 60 and stops, so a bounded pause of 25,080s renders "Pause up to 418 minutes". No parent reads 418 minutes; SPEC.md asks for concrete COUNTABLE copy, and a count nobody can hold in their head is not countable. Wants hours-and-minutes above some threshold. (2) ARCHITECTURE: this is a SECOND time-formatting path in the client. DESIGN.md grafted the single shared total-vs-active time renderer precisely so DoD 6 would be a property of ONE helper, and T-040 put time_label on the wire so screens never compute minutes themselves. maximum_pause ships raw seconds with no label, so prep.js had no local choice — which means the RIGHT fix is the wire-side one: give maximum_pause a time_label exactly as T-040 did for active_time_blocks, and delete durationWords. Prefer that over a client-side helper, for consistency with the invariant that already exists. NOT an acceptance failure for T-057 (all six required elements and the T-040 verbatim rule pass), which is why T-057 is done and this is filed separately rather than reopening it.',
});

fs.writeFileSync(p + '.tmp', JSON.stringify(b, null, 2));
fs.renameSync(p + '.tmp', p);
const c = {};
for (const i of b.items) c[i.status] = (c[i.status] || 0) + 1;
console.log('backlog:', JSON.stringify(c), 'total', b.items.length);
