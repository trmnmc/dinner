# IN-FLIGHT MARKER — cycle 13

Written at dispatch time so a session killed mid-wave (KI-4 background ceiling, KI-6 session
cap) can be resumed rather than restarted.

- **cycle**: 13
- **dispatched**: 2026-08-19T03:58Z
- **work type**: build-wave, k=2 (gear 2 cap)
- **mechanism**: DIRECT FOREGROUND `Agent` calls editing the MAIN working tree (D-11).
  No `build-wave.js`, no worktrees, no builder branches. Builders are forbidden to run any
  git command; the conductor commits.

## Items

| id | effort | model | file scope (strictly disjoint) |
|---|---|---|---|
| T-041 | M | sonnet | `server/src/routes.ts`, `domain/src/reasons.ts`, `tests/routes.test.ts` |
| T-042 | S | sonnet | `web/js/onboarding.js` |

Both items close **KI-7 (blocker)**: the default first-run path produces zero dinners.
T-041 makes the failure honest; T-042 stops it happening on the default path.

## Recovery procedure if this session dies

1. `git -C /opt/targets/dinner status --porcelain` — uncommitted files under the scopes above
   are builder work, not garbage. Judge coherence from `git diff --stat`, then salvage-commit.
2. Do NOT open cycle 14. RESUME cycle 13: author both verification gates from scratch, run
   them plus the full `npm test`, then close the wave (steps 6-10).
3. An item whose builder produced ZERO files returns to `todo` with `attempts` LEFT AT 0 —
   its build never ran (D-15).
4. Always `git -C <target>`, never a bare `git` after any `cd` (cycle-12 near-miss).
