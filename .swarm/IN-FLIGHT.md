# IN-FLIGHT MARKER — cycle 7

Written at dispatch time (2026-08-18T23:52Z, epoch ~1787097150) so a killed session can
resume without re-diagnosing. Delete this file at the end of a cycle that closes cleanly.

## What was dispatched

build-wave, effective k = 2 (min of k_current 4, gear-2 cap 2, hard max 5).

| item | scope | model | effort |
|---|---|---|---|
| T-003 | `domain/src/scale.ts`, `domain/src/aggregate.ts`, `tests/aggregate.test.ts` | fable (route_class core, fable guard) | medium (M) |
| T-029 | `tests/score.test.ts` | fable (route_class core, fable guard) | low (S) |

File scopes are pairwise disjoint. **No worktrees and no builder branches this cycle** —
both agents edit the main working tree directly at `/opt/targets/dinner`, under strictly
disjoint scopes, and are forbidden to run `git commit`. The conductor commits.

## Why direct foreground Agent calls instead of the build-wave workflow

Two independent reasons:

1. The Workflow tool is review-gated in headless `-p` sessions (SKILL.md, headless
   paragraph) — the documented fallback is direct Agent calls.
2. **KI-4 mitigation.** `bin/swarm-pacer.sh` spawns `claude -p` synchronously with NO
   timeout of its own (verified this cycle by reading lines 232-260). The 600s kill that
   destroyed cycles 4 and 6 is the harness's *background-task* wait ceiling at turn end
   (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, default 600000). Agents dispatched in the
   FOREGROUND are part of the turn, not background tasks, so the ceiling does not apply
   to them. This is a prompt-side workaround, not a SWARM edit — hard rule 5 intact. KI-4
   still belongs in the morning report; the durable fix is still in the pacer.

## Recovery procedure if this session dies

1. `git -C /opt/targets/dinner status --porcelain` — uncommitted files in the scopes above
   are salvageable builder work. Judge coherence from the diff, then salvage-commit.
2. There are NO branches and NO worktrees to clean up this cycle.
3. Baseline before dispatch: commit `2d50c25`, `npm test` = 152/152 pass, 0 fail.
4. Both items still need conductor verification gates authored from SPEC — no gate ran
   before this marker was written.
