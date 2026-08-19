# cycle 24 — IN-FLIGHT MARKER (D-8)

Written BEFORE dispatch so a mid-wave death (KI-4 pacer 600s background guillotine,
KI-6 session cap) is recoverable by the next session from disk alone.

- clock at dispatch: 1787132242 (2026-08-19T09:37:22Z); stop_at 1787140800 (12:00:00Z)
- probe: REAL, probe_ok true, rho 1.10 → gear 2 (k_cap 2, demote true, promote blocked
  by the weekly governor, ceiling 2)
- work type: **build-wave**, dispatched as TWO DIRECT foreground Agent calls (the
  documented headless fallback — Workflow is review-gated in `-p` sessions; foreground
  rather than background specifically because of KI-4)
- effective wave size: min(k_current 5, gear cap 2, hard max 5) = **2**
- packages to install before dispatch: NONE (both items declare `packages: []`)

## items dispatched

| item | kind | effort | model | files (pairwise disjoint) |
|---|---|---|---|---|
| T-065 | fix | M | sonnet | `data/ingredients.json`, `tests/packaging.test.ts` |
| T-058 | fix | M | sonnet | `server/src/routes.ts`, `web/js/cook.js`, `tests/routes.test.ts` |

Disjointness checked by hand: T-065 touches catalog data + the packaging test; T-058
touches the server route encoder, the cooking client and the routes test. No overlap.
Manifest files (package.json, package-lock.json, tsconfig.json) are OUT of both scopes.

Routing: gear 2 sets `demote: true`, but the demotion rule never drops a build/fix item
below sonnet — both items stay **sonnet**, unchanged from their backlog `model`.

## why these two

T-058 resolves **KI-12 (high, open)** — kitchen timers are unreachable in the running
product. Step 4 ranks high-severity known_issues above new features, which is why it
outranks T-048 (also p1, also M, but a feature). Pre-dispatch fact-check by the
conductor: `timer_duration_seconds` ALREADY exists on every authored recipe step and 8
of 35 steps carry a non-null value, at least one in every one of the six recipes — so
the item is genuinely "expose the field + add the tap", not data authoring, and it is
end-to-end verifiable on the shipped catalog.

T-065 is the highest-value item on the board and the cycle-23 journal's named next
move: `data/ingredients.json` ships ZERO package options for all 97 ingredients, so
`packaging.ts` (fully implemented and unit-tested) and the `package_label` /
`is_estimate` / `expected_surplus` encoding in routes.ts are all switched off. D-4 named
package-size selection and leftover optimisation as two of the three differentiators
prior-art scouting found unoccupied across all five competitors.

## recovery instructions if this cycle died mid-wave

1. `git -C /opt/targets/dinner status --porcelain` — salvage per cycle.md step 2.
2. Both agents wrote DIRECTLY to the working tree (no worktrees, no branches — KI-3
   makes /tmp worktrees unusable for agent file tools on this host, and disjoint file
   scopes are what makes direct writes safe here). So partial work appears as
   uncommitted edits to the files listed above, not as dangling branches.
3. Neither item may be marked `done` without a conductor-authored gate run at
   verification time. If this file is the newest thing in `.swarm/runs/`, NO gate ran:
   both items stay `todo`, `attempts+1` each.
