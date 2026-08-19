# cycle 23 — in-flight marker (written at dispatch, before any agent ran)

Written per D-8 so a session that dies mid-wave can recover without diagnosis.

- **Clock at dispatch:** 1787130 4xx (~2026-08-19T09:07Z). `stop_at` 12:00Z (~2h50m left).
- **Gear:** 2 (ρ 0.75, window reset at 09:00Z confirmed: 141.6M → 0.41M tokens).
  Wave cap 2. `demote: true`, `promote: false`. Weekly governor ENGAGED, ceiling 2.
- **Dispatch mechanism:** D-11 — DIRECT Agent calls editing the MAIN working tree
  under strictly disjoint file scopes. No build-wave workflow, no worktrees, no
  builder branches. Both builders are FORBIDDEN to run any git command; the
  conductor commits.

## Items in flight

| item | model | scope (exclusive) |
|---|---|---|
| T-038 | sonnet (base sonnet, attempts 1 → ladder opus, gear-2 demote → sonnet) | `domain/src/reasons.ts`, `tests/reasons.test.ts` |
| T-057 | sonnet (base sonnet, attempts 0, gear-2 demote floors at sonnet for build items) | `web/js/prep.js` (new), `web/css/prep.css` (new), `web/js/router.js` (route registration line only), `web/index.html` (stylesheet link only) |

Scopes are pairwise disjoint. Neither touches manifests.

## Conductor work running concurrently

T-017 (grocery ledger screen, `todo`, `attempts: 1`) — its ONLY recorded failure
(R21, raw rationals) looks already fixed by T-052 at cycle 15: `web/js/grocery.js`
now calls `formatQuantity(q, { maxFracDigits })` at both call sites. The conductor is
authoring a FRESH gate (never the cycle-14/15 one, never the builder's) to decide
whether T-017 is already satisfied. If it passes, T-017 → done, unblocking T-021,
T-024 and T-062.

## Recovery procedure if this session dies

1. `git status --porcelain` in `/opt/targets/dinner`. Uncommitted work in
   `domain/src/reasons.ts` / `tests/reasons.test.ts` is T-038's; anything under
   `web/js/prep.js` / `web/css/prep.css` is T-057's. Both are self-contained.
2. Judge coherence from `git diff --stat`, salvage-commit or reset per cycle.md step 2.
3. Author BOTH gates from scratch — no gate for either item existed at dispatch time,
   by design. T-038's gate must cover `renderSwapNoAlternatives` at `n === 1` for
   `all_candidates_already_in_plan` and the empty-pool arm's plain-English rewrite.
4. `npm test` must be green (391/391 at the cycle-21 baseline, plus whatever these add).
