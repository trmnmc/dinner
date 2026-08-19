# cycle 9 — IN-FLIGHT MARKER (written at dispatch, before any agent ran)

Written per the D-8 / D-10 lesson: if this session is killed mid-wave, the next session
reads THIS file first and knows exactly what was in flight and how to close it.

## Dispatch mechanism

DIRECT FOREGROUND Agent calls into the MAIN working tree (D-11, KI-4 workaround) — no
build-wave workflow, no worktrees, no builder branches. Both builders are forbidden to
run any git command; the CONDUCTOR commits. Foreground agents are part of the turn, so
the pacer's 600s background-task ceiling never applies to them.

## Gear / wave

gear 2 (gear_target 4 clamped by the weekly governor, heat 2.30), wave cap 2,
k_current 5 → effective k = 2.

## Items in flight

| item | scope (STRICTLY DISJOINT) | model | why |
|---|---|---|---|
| T-005 (attempt 1, re-fix) | `domain/src/preferences.ts`, `tests/preferences.test.ts`, and — only if it chooses the filters-side fix — `domain/src/filters.ts`, `tests/filters.test.ts` | fable | newly flagged `route_class: "core"` (D-13); fable guard exempts it from the gear-2 demotion |
| T-004 | `domain/src/inventoryMath.ts`, `domain/src/packaging.ts`, `tests/inventory.test.ts`, `tests/packaging.test.ts` | fable | pre-existing `route_class: "core"`; fable guard exempts it |

No file appears in both scopes. No manifest is in either scope. Neither item has
`packages`, so no conductor install was needed before dispatch.

## Recovery procedure if this session dies

1. `git -C /opt/targets/dinner status --porcelain` — uncommitted work in the paths above
   is a builder's partial output. Judge coherence from the diff; salvage-commit if
   coherent, `git checkout --` those paths if not.
2. Run `npm test` in `/opt/targets/dinner` (265 tests were green at dispatch — any new
   failure is this wave's).
3. The gates were NOT authored at dispatch time (hard rule 2 — verify checks are authored
   at verification time, never before). Author them fresh.
4. T-005's gate MUST re-run the cycle-8 integration probe: 6-recipe catalog, one
   `never_recommend` tap on a chicken/thai card, then `applyHardFilters` with the
   resulting signals — a MAJORITY of the 6 must survive. That probe is the entire reason
   the item failed at cycle 8 (KI-5). Do not accept a green unit suite in its place.
5. Neither item is done until its own gate passes AND the full suite is green.
