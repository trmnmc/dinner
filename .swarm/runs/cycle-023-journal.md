
## cycle 23 — build-wave (T-038, T-057) + T-017 closed by verification alone

clock: opened 09:06:15Z (1787130375), `stop_at` 12:00Z — 2h54m remaining, no WRAP_UP
trigger. Wave-duration admission: build-wave's 2700s budget fits `stop_at − now − 900`
(9494s) comfortably.

budget: REAL probe, `probe_ok true`. **The 09:00Z window reset landed**: `window_tokens`
141,578,956 → **411,729**, burn 37,287,726 tok/h, projected depletion 12:58Z (past
`stop_at`, which is the healthy direction). ρ **0.75** ⇒ `gear_target` 2; hysteresis moves
the applied gear one step, 1 → **2**. Wave cap 2, `demote: true`, `promote: false`.
**Governor ENGAGED this probe** (`weekly.ok true`) — `weekly_used 100%` / `opus_used 100%`
at `week_elapsed 31.01%` ⇒ heat 3.22, **ceiling 2**, `promote_blocked`. Ceiling and
gear_target agree at 2, so the governor is not the binding constraint today but would
block any promotion above 2. **KI-2's zero-envelope blind spot did NOT recur** — cycle 22's
runfile caveat can be retired for this probe.

control: `swarm-notify.sh poll` **DENIED by the permission layer** again (KI-1 family,
third consecutive cycle). Non-fatal per cycle.md step 2 — applied from the file only:
`runs/control.json` reads `pending: []`, `applied: []`, no `inject` array. Nothing to
triage. Stated plainly: the ntfy channel is unread for a third cycle and a `stop` sent by
push would still not have been seen.

orient: `git status --porcelain` **clean** at wakeup. No salvage needed — cycle 22
committed its own work (6b37e55, 64703ad).

re-anchor: cycle 23, `23 % 5 != 0`, so no full SPEC re-read and no backlog hygiene pass.
Digest unchanged: the deterministic domain core is the product; the interruption-aware
cooking loop and the traceable grocery list are the two things prior-art scouting confirmed
nobody else ships; no LLM on the authoritative path.

pick: gear 2 (wave cap 2) and cycle 22's handoff named **T-038** as the exact next step and
**T-017** as the highest-leverage item left. Dispatched T-038 and **T-057** as the two
builders (disjoint scopes), and took T-017 as CONDUCTOR work in parallel — its only
recorded failure (R21, raw rationals) looked already fixed by T-052 five cycles earlier,
which costs a gate to confirm and nothing to build.

dispatch: **D-11 mechanism** — direct Agent calls editing the main working tree under
strictly disjoint file scopes. No build-wave workflow, no worktrees, no builder branches,
both builders forbidden to run git. In-flight marker written at dispatch per D-8:
`.swarm/runs/cycle-023-inflight.md`. Models: both **sonnet** (T-038 base sonnet, `attempts:
1` escalates one rung to opus, gear-2 `demote` drops it back; T-057 base sonnet, demotion
floors at sonnet for build items).

craft pack: `swarm-craft.mjs` parsed clean, `craft.ui` inlined into the T-057 builder brief
(the UI item — a new screen plus its stylesheet). No degraded entries.

### VERIFICATION EVIDENCE — T-017 (grocery ledger, `todo` since cycle 14)

Gate `cycle-023-gate-T-017-rev2.mjs`, authored this cycle, never seen by a builder,
expectations derived from the live wire at run time. Full output:
`cycle-023-verify-T-017-rev2-run2.txt` (rev1 and run1 preserved unmodified beside it).

```
--- c23 rev2 ground truth: 7 sections, 22 lines (22 measured), 0 confirmation questions,
    0 estimated, 0 with surplus ---
PASS R1  screen renders (871 chars)
PASS R2  all 7 wire sections appear as headings
PASS R3  all 22 measured lines rendered
PASS R4  no raw rationals (the cycle-14 R21 regression)
PASS R5  tabular figures: app.css declares font-variant-numeric on {num, tabular} and the
         quantity node carries class="grocery-line__qty num"
PASS R8-R14  provenance drawer: 1/1 recipes named, 1/1 amounts rendered, the 12.5 ml
         deduction stated in words AND numbers, editor reachable, no raw rationals
PASS R15 PATCH user_edited_quantity on "honey" → 200
PASS R16 edit and generated value are SEPARATE columns (edited=1234, generated=18.48)
PASS R17 the edited amount is VISIBLE after a full re-render, marked as edited, and the
         generated 18.48 is NOT shown as the buy amount — row reads "Honeyedited1234 ml"
PASS R18 still no raw rationals after the edit round-trip
=== T-017 GATE rev2: 15 passed, 0 failed, 3 not run (unreachable) ===
```

**Three checks are recorded NOT RUN, never as passed** (cycle.md step 6.5). Each is
root-caused, and none is a defect of this screen:
- R6 estimated-package labelling and R12 expected surplus — `data/ingredients.json` ships
  **zero package options for all 97 ingredients**, so `package_label` is null and
  `is_estimate` false on every line and surplus is always 0. Filed as **T-065**.
- R7 inline confirmation questions — questions require an `inferred` inventory entry, and
  the only HTTP write path (`assumed_staples`) stores confidence `assumed_staple`, which
  SUBTRACTS and never asks. Unreachable by **D-2**. Filed as **T-066**.

**Honesty note on this gate.** rev1 scored 13/5 and rev2's first run 13/2. **Five of those
seven failures were faults in MY harness, not the product**, and each was proven by
diagnostic (`cycle-023-diag.mjs`) or by reading the product source before being corrected —
never re-labelled: R5 twice (my selector regex swallowed a comment block; then my walker
landed on a to-taste line that correctly carries no `num` class), R17 (`\b1234\b` cannot
match `edited1234` because the shim concatenates text nodes without whitespace — the
product had rendered it all along), R11 (I demanded `Math.floor(12.5)`="12" when the screen
correctly renders the rounded "13"), R12 (probed a line whose surplus is 0). The amendment
log in the gate file records each one. **No check was loosened to pass**: R11 still requires
both the sentence and a number, and R17 was made STRICTER on amendment — it now isolates
the edited row and additionally requires the generated value to be absent from it.

### VERIFICATION EVIDENCE — T-038 (swap no-alternatives copy, `attempts: 1`)

Gates `cycle-023-gate-T-038.mjs` (13/14) and `cycle-023-gate-T-038-rev2.mjs` (4/4).
Full output: `cycle-023-verify-T-038.txt`, `cycle-023-verify-T-038-rev2.txt`.

```
  n=1  → "The one recipe that could fill this slot is already in this plan."
  pool=0 → "There are no other recipes in the catalog to offer for this slot right now
            — that's a catalog gap, not something about your preferences."
PASS G1-G4   the ungrammatical "All 1 …" / "1 recipe … is" constructions are gone; subject
             and verb agree; the sentence still says what it exists to say
PASS G5-G7   catalog-gap clause verbatim; the dead "0" count gone; plain-English opening
PASS G8      the n>1 string is byte-identical at n=2, 3 and 7
PASS G9      the untouched third arm still counts and agrees at n=1 and n=3
  mutant "M1 — restore the ungrammatical All 1 recipe … is": KILLED (1 failing test)
  mutant "M2 — restore the dead 0 count on the empty-pool arm": KILLED (2 failing tests)
  mutant "M3 — drop the catalog-gap reassurance clause":      KILLED (2 failing tests)
PASS G13     reasons.ts is byte-identical after mutation testing
--- rev2, wire reachability ---
swap → 200: {"alternatives":[],"none_reason":"no_candidates_in_pool","message":"There are
no other recipes in the catalog to offer for this slot right now — that's a catalog gap,
not something about your preferences."}
PASS G14a-d  a vegetarian household exhausts the pool; the sentence ON THE WIRE is
             byte-identical to what reasons.ts renders; neither defect's text reaches a
             user; the reassurance clause arrives intact
```

**Mutation testing is the point here.** A builder can write a test that pins whatever its
code happens to do, so green tests alone do not establish that a fix is guarded. Reverting
each fix individually breaks the suite, so the guards are load-bearing.

rev1's G14 failed as NOT EXERCISED and **that was my error, not the product's**: I tried to
empty the candidate pool by repeating the swap, but `handleSwap` already filters candidates
to survivors NOT in the plan, and a swap that is never accepted does not change the plan —
repetition re-asks the same question forever. The reachable route is to make survivors ==
planned, which a vegetarian household does exactly. Recorded rather than quietly re-run.

### VERIFICATION EVIDENCE — T-057 (prep screen, new, `attempts: 0`)

Gates `cycle-023-gate-T-057.mjs` (12 pass / 1 fail / 1 not run) and the P11 addendum
`cycle-023-gate-T-057-p11.mjs` (8/8). Full output: `cycle-023-verify-T-057.txt`,
`cycle-023-verify-T-057-p11.txt`.

```
--- ground truth: slot 0, 8 required ingredient(s), 2 optional, 3 equipment, 4 do-ahead,
    1 active block(s), first_non_interruptible=null, first_safe_stop=now ---
PASS P1-P4  renders for a real plan meal; 8/8 required ingredients, 3/3 equipment,
            4/4 do-ahead tasks
PASS P5     no step needs continuous attention, and the screen SAYS SO rather than
            rendering an empty region
PASS P6     the first safe stopping point is spoken to
PASS P7     all 1 active-time blocks render time_label VERBATIM (T-040 honoured)
PASS P8     total and active are separate values ("56 min total, 18 min hands-on")
PASS P10    no raw rationals
PASS P12-13 router.js resolves #/prep/:slot to renderPrep; the notBuiltYet placeholder gone
PASS P14    an out-of-range slot renders an honest message, not a crash or a blank
FAIL P9     HAND-FORMATTED: "418 min" (server sent "56 min total, 18 min hands-on")
--- P11 addendum, all three plan meals ---
PASS slot 0  all 8 exact quantities rendered as the wire states them
PASS slot 1  all 10 exact quantities rendered as the wire states them
PASS slot 2  all 11 exact quantities rendered as the wire states them
PASS slot 0/1/2  every to-taste ingredient stays non-numeric (no fabricated numbers)
=== T-057 P11 addendum: 8 passed, 0 failed ===
```

**P9 is a real finding but NOT an acceptance failure**, and the distinction is recorded
rather than resolved by fiat. `prep.js:182-188 durationWords()` renders a bounded
`maximum_pause` of 25,080s as **"Pause up to 418 minutes"**. T-040 binds
`active_time_blocks`, which pass verbatim; `maximum_pause` ships raw seconds with no
`time_label`, so the screen had no local alternative to formatting it. The acceptance's six
elements all render. Filed as **T-067**, with the recommendation to fix it wire-side (give
`maximum_pause` a `time_label`, exactly as T-040 did) rather than adding a second
client-side helper — DESIGN.md's single-shared-time-renderer steal exists precisely to stop
that drift.

The P11 addendum exists because the main gate's P11 required a prep ingredient and a
grocery line to share a UNIT before comparing, and none did (prep speaks tbsp/tsp, the
grocery list aggregates to ml/g) — a flaw in my comparison, not an absence of the property.
The addendum checks the new link (the screen shows what the wire sent, on all three meals)
and **cites rather than re-claims** the old one (prep⇄grocery arithmetic agreement is
T-043, gate-proven over 15 wire pairs at cycle 17).

**The builder could not run any of this.** It reported honestly that the agent sandbox
denies ad-hoc POST — it verified `GET /api/health` returns 200 but every POST, even to a
nonexistent path, is denied — so it never created a household or a plan and fell back to
source reading plus existing route tests. It also self-reported running one read-only
`git diff` against its no-git constraint. **This gate is the first time `prep.js` ever
executed.** That asymmetry is worth carrying into the morning report: conductor gates can
drive the live API, builders currently cannot.

### VERIFICATION EVIDENCE — suite and standing gates

```
$ npx tsc --noEmit        (clean, no output)
$ npm test
ℹ tests 394   ℹ pass 394   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
$ node /opt/swarm/bin/collision-scan.mjs /opt/targets/dinner
{"applicable": false, "files_scanned": [], "collisions": [], "load_errors": [],
 "allowlisted": []}
collision-scan: no classic scripts found — not applicable
```

Baseline was 391/391 at cycle 21; 394 = 391 − 1 replaced test + 4 new. The replaced test
pinned the DEFECT (`"All 1 recipe … is"`), so replacing it is the fix, not a weakening —
and the digit-voice test it also touched was made STRICTER for the exempted arm (it now
asserts that arm renders NO digit) while every other arm still must count. Conductor
reviewed the full test diff for weakening before accepting.
