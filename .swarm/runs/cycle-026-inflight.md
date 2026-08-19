# cycle 26 — in-flight marker (written AT DISPATCH, before any agent runs)

Written per D-8 / D-10 / D-15 / D-24: if this cycle dies mid-wave, the next session reads
THIS file first and resumes cycle 26 rather than opening cycle 27.

## Clock and posture

- dispatch time: 2026-08-19T10:43Z (epoch ~1787136200)
- `stop_at` 2026-08-19T12:00:00Z; WRAP_UP trigger (`stop_at - 900`) = **11:45Z**
- REAL budget probe: gear 2, rho 1.20, k_cap 2, `demote: true`, `promote: false`
  (governor ceiling 2, weekly/opus heat 3.13). Effective wave size =
  min(k_current 5, gear cap 2) = **2**.
- Projected window depletion 11:46:19Z — one minute after the wrap trigger.
  **Cycle 26 is planned as the LAST WORK CYCLE of this run.** Cycle 27 is expected to
  find `stop_at - now - 900 < 600s` and go straight to WRAP_UP by admission control.

## Mechanism

Two **DIRECT, FOREGROUND `Agent` calls** editing the main working tree under strictly
disjoint file scopes — no `build-wave` workflow, no worktrees, no builder branches
(D-11: the Workflow tool is review-gated headless, and foreground agents are part of the
turn so KI-4's 600s background-task ceiling never applies). Both builders are FORBIDDEN
to run any git command; the conductor commits.

Neither item installs packages (`packages: []` on both), so there is no pre-wave install.

## Items dispatched

| item | model | scope (EXCLUSIVE) | why picked |
|---|---|---|---|
| T-020 | fable (`route_class: core`, exempt from the gear-2 demotion per D-13) | `tests/e2e.cooking.test.ts` (NEW FILE ONLY) | p1 DoD 7 — kill/reload survival, the differentiator D-4 found unoccupied across all five competitor products. Proven by execution instead of claim. |
| T-021 | fable (`route_class: core`, same exemption) | `tests/e2e.loop.test.ts` (NEW FILE ONLY) | p1 DoD 1/2/3/5/6/8/11 — the broadened full-loop sweep. Converts the run's biggest block of *claimed* behaviour into *machine-checked* behaviour before the morning report. |

Both scopes are NEW test files. **Zero production code is in either scope**, which is
deliberate for the final work cycle: a wave that cannot touch `domain/`, `server/` or
`web/` cannot break green main in the last hour. If a builder finds a product defect it
must FILE it in its return, never fix it.

## Recovery procedure if this cycle dies

1. `git -C /opt/targets/dinner status --porcelain` — the builders write directly to the
   main tree, so surviving work shows as untracked `tests/e2e.cooking.test.ts` and/or
   `tests/e2e.loop.test.ts`.
2. Judge coherence from the diff (D-10/D-24 standard: does `npm test` pass on the dirty
   tree, does every import resolve to something that already exists, is any file
   half-written). Coherent → `git add -A && git commit -m "WIP: crashed cycle 26"`.
   Incoherent → `git checkout . && git clean -fd` and return both items to todo.
3. **Do not trust a surviving test file as verified.** No gate has run at the time this
   marker is written. Author the gates from scratch (hard rule 2) — for a TEST
   deliverable that means MUTATION TESTING per D-12, not a green suite: a file of
   `assert.ok(true)` passes `npm test`. Inject defects into the modules each test claims
   to cover and require the committed test to go red for each.
4. State/backlog/journal/runfile for cycle 26 are NOT written at dispatch time. If they
   are still missing, this cycle never reached step 7 — finish it, do not open cycle 27
   (D-8: merged-but-ungated code is the most dangerous state this pipeline can be in).
5. If the clock is already past 11:45Z when you resume, go straight to WRAP_UP and list
   both items as unverified in-flight work in REPORT.md.
