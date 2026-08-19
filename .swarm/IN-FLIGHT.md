# IN-FLIGHT MARKER — cycle 8

Written at dispatch time (2026-08-19T00:2xZ, epoch ~1787098351) so a killed cycle is
recoverable without diagnosis. Delete/overwrite at the next dispatch.

## Wave

build-wave, effective k=2 (min(k_current 5, gear cap 2)). Mechanism: DIRECT FOREGROUND
Agent calls on the MAIN working tree under strictly disjoint file scopes — per D-11, the
KI-4 workaround. No worktrees, no builder branches. Builders are forbidden to run any git
command; the CONDUCTOR commits.

| item | model | scope (exclusive) |
|---|---|---|
| T-005 | sonnet | `domain/src/preferences.ts`, `domain/src/calibration.ts`, `tests/preferences.test.ts`, `tests/calibration.test.ts` |
| T-013 | sonnet | `domain/src/prep.ts`, `domain/src/reasons.ts`, `tests/prep.test.ts`, `tests/reasons.test.ts` |

Scopes are provably disjoint: 8 distinct new files, no shared file, no manifest.

## Recovery procedure if this cycle is killed

1. `git -C /opt/targets/dinner status --porcelain` — uncommitted builder files are the
   salvage candidates. They are NEW files only; nothing pre-existing is edited by either
   builder, so a `git checkout .` can never lose landed work (but `git clean -fd` WOULD
   destroy the wave — do not run it blindly).
2. Judge each file set for coherence (imports only frozen modules: qty.ts, recipe.ts,
   catalog.ts, score.ts). Coherent → salvage-commit it; incoherent → discard that item's
   files and return the item to todo with attempts+1.
3. The verification gates were NOT written before dispatch (they are authored at
   verification time, per hard rule 2). A resuming session must author them from scratch
   against `.swarm/backlog.json` acceptance text — never from builder notes.
4. Then run `npm test` in the target and close the gate normally.

## Pre-dispatch state

- HEAD before dispatch: 45d506c
- suite before dispatch: 187/187 green, tsc --noEmit clean (cycle 7 evidence)
- verified items before this wave: 7 of 31
