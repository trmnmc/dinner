# IN-FLIGHT MARKER — cycle 11

Written at dispatch, BEFORE any builder ran. If you are reading this in a later session,
cycle 11 died between dispatch and its journal block. Recover with the procedure below.

- cycle: 11
- dispatched_at: 2026-08-19T02:20Z (epoch ~1787105980)
- work type: build-wave, 2 items, effective wave size min(k_current 5, gear cap 2) = 2
- mechanism: **DIRECT FOREGROUND Agent calls** editing the MAIN working tree
  (D-11 / KI-4 workaround). NO worktrees, NO builder branches, NO build-wave.js.
  Both builders were forbidden to run any git command; the conductor commits.

## items in flight

| id | model | effort | scope (disjoint, pairwise) |
|---|---|---|---|
| T-007 | fable (route_class core, fable guard exempts it from the gear-2 demotion) | M | `domain/src/planset.ts`, `domain/src/swap.ts`, `tests/planset.test.ts`, `tests/swap.test.ts` |
| T-009 | sonnet (kind feature — build never demotes below sonnet) | M | `data/recipes/r01.json` … `r06.json` |

The two scopes share no file and no directory. Nothing else in the repo is in either scope.

## why this pair

T-014 (HTTP server — the item that finally makes anything reachable) is blocked by exactly
two todo items: T-007 and T-009. Landing both here unblocks the server NEXT cycle, so the
pair is chosen for critical path, not for size. Cycle 10's journal named the run's biggest
exposure as "nothing renders"; this is the shortest path out of it.

## recovery procedure if this cycle died

1. `git -C /opt/targets/dinner status --porcelain` — builders wrote into the MAIN tree, so
   any surviving work is an uncommitted diff here, not on a branch and not in `.wt/`.
2. Judge each item's files independently; the scopes are disjoint so one may be salvageable
   while the other is garbage.
   - `domain/src/planset.ts` + `swap.ts` + their tests → T-007.
   - `data/recipes/r0N.json` → T-009.
3. Salvage-commit coherent work, `git checkout --` incoherent work, then AUTHOR FRESH GATES
   (hard rule 2 — never reuse a builder's own check) and run `npm test` yourself.
4. An item whose builder produced ZERO files is returned to todo with **attempts LEFT AT 0**
   (D-15): the attempts+1 rule escalates items whose BUILD failed, not items whose conductor
   session died. An item with a partial diff takes attempts+1 normally.
5. Delete this file when the cycle closes.
