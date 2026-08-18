# cycle 6 — IN FLIGHT marker

Written at dispatch time, BEFORE any merge. If you are reading this in a later cycle and
the journal has no `## cycle 6` block, cycle 6 died mid-wave. This file is the trail
D-8 wished cycle 4 had left.

- dispatched: 2026-08-18T22:45:00+00:00 (epoch ~1787092950)
- work type: build-wave, effective k=2 (min(k_current 4, gear cap 2, hard max 5))
- items: T-002 (units + normalize), T-006 (filters + score) — both route_class core -> fable
- expected branches: `wave-006-T-002`, `wave-006-T-006`
- expected worktrees: `.wt/T-002`, `.wt/T-006` (gitignored; conductor prunes after merge)
- workflow runId: wf_0351841e-6eb

## Recovery instructions if cycle 6 crashed

1. `git -C /opt/targets/dinner log --oneline -5` — if commits say "cycle 6" but
   state.json still says `cycle: 5`, the merges landed and the GATE NEVER RAN. Do NOT
   dispatch new work. Author gates for T-002 and T-006 from SPEC.md + the frozen types
   in domain/src/recipe.ts and qty.ts, run them, then close the wave (this is exactly
   what cycle 5 did for cycle 4).
2. If the branches exist but are unmerged, merge them sequentially with `npm test` after
   each (hard rule 4), then gate.
3. Either way: prune `.wt/T-002` and `.wt/T-006` and delete the merged wave branches.

## Conductor scope ruling made this cycle (record as D-9 if the journal block is missing)

T-002's `domain/src/ingredients.ts` was CUT from scope. `domain/src/catalog.ts` (landed
by T-008) already owns the curated ingredient registry — aliases, allergen classes,
densities, per-item weights — sourced from `data/ingredients.json`. A second curated
table would be a second source of truth, which is the data-drift failure Invariant 5
exists to prevent. `normalize.ts` consumes `IngredientRegistry` as a parameter instead.
