# IN-FLIGHT MARKER — cycle 10

Written at dispatch time (2026-08-19T01:30Z, epoch ~1787103000) so a killed cycle is
recoverable without diagnosis. Overwritten at the next dispatch.

## Wave

build-wave, effective k=2 (min(k_current 5, gear cap 2 — weekly governor ceiling)).
Mechanism: DIRECT FOREGROUND Agent calls on the MAIN working tree under strictly disjoint
file scopes — per D-11, the KI-4 workaround. No worktrees, no builder branches. Builders
are forbidden to run any git command; the CONDUCTOR commits.

| item | model | scope (exclusive) |
|---|---|---|
| T-034 | fable (route_class core; fable guard exempts it from the gear-2 demotion) | `domain/src/preferences.ts`, `tests/preferences.test.ts` |
| T-007 | fable (route_class core; same exemption) | `domain/src/planset.ts`, `domain/src/swap.ts`, `tests/planset.test.ts`, `tests/swap.test.ts` |

Scopes are provably disjoint: T-034 edits two EXISTING files, T-007 creates four NEW
files. No shared file, no manifest, no overlap.

## Recovery procedure if this cycle is killed

1. `git -C /opt/targets/dinner status --porcelain` — uncommitted builder files are the
   salvage candidates. T-007's four files are NEW; T-034's two are MODIFIED, so a
   `git checkout .` WOULD discard T-034's work and a `git clean -fd` WOULD destroy
   T-007's. Do not run either blindly — judge first.
2. Judge each file set for coherence. T-007 may import only frozen/verified modules
   (qty.ts, recipe.ts, catalog.ts, score.ts, filters.ts). T-034 is expected to be a
   ONE-LINE config change plus test updates — a large preferences.ts diff is itself a
   red flag worth reading before salvaging.
3. The verification gates were NOT written before dispatch (they are authored at
   verification time, per hard rule 2). A resuming session must author them from scratch
   against `.swarm/backlog.json` acceptance text — never from builder notes. For T-034
   the measured remedy probe lives at `SWARM/runs/cycle-009-remedy-probe.mjs` and is a
   fair starting point for a gate, but the gate must ALSO test a realistic broad-tag
   catalog (D-14).
4. Then run `npm test` in the target and close the gate normally.

## Pre-dispatch state

- HEAD before dispatch: 029433d
- suite before dispatch: 297/297 green (conductor-run this cycle, `npm test`)
- verified items before this wave: 9 of 35
- gear 2, ρ 0.741, weekly heat 2.57 (governor engaged, ceiling 2, promote blocked)
