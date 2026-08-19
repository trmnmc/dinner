# cycle 18 — in-flight marker

Written BEFORE dispatch so a crashed cycle is legible to the next orient.

- target: /opt/targets/dinner
- cycle: 18
- gear: 1 (crawl) — ρ 2.70, wave cap 1, demote=true, weekly governor ceiling 2, promote blocked
- probe: window 100,238,763 tok, 36.5M tok/h, projected depletion 07:34Z (reset 09:00Z)
- work type: build-wave, ONE item, single foreground agent (Workflow tool is review-gated
  in a headless `-p` session — documented failure-table fallback to a direct Agent call)

## item in flight

**T-040** (S, fix, sonnet — `fix` never demotes below sonnet even at gear 1)
Prep `active_time_blocks` ship no `time_label`, forcing the prep screen to hand-format
minutes.

files in scope: `domain/src/reasons.ts`, `server/src/routes.ts`, `tests/routes.test.ts`
(+ `tests/reasons.test.ts` for the new helper)

## conductor ruling made before dispatch (D-18)

The label is PRODUCED in `domain/src/reasons.ts` and ATTACHED at the route encode
boundary — not stored on the domain `ActiveTimeBlock`.

Why: DoD 6's mechanism is "one shared time renderer", and reasons.ts already owns the
only duration→text function in the product (`renderTotalActiveTime`, reasons.ts:101).
A new formatter anywhere else reintroduces the drift the rule exists to prevent. But an
`ActiveTimeBlock` is derived recipe data (prep.ts:206) and does not otherwise carry
presentation text; pushing a label into it would also churn the deepEqual assertions at
prep.test.ts:210/226 for no correctness gain. Produce in the domain, attach at the wire.

A block carries `active_seconds` only — there is no total for the pair that
`renderTotalActiveTime` demands — so the helper must reuse that function's internals
(`minutesOf` / `minuteLabel`), never open-code a second minute formatter.

## crash recovery

If this file is the newest thing in the tree and no `cycle 18: … verified` commit exists,
T-040 was in flight and unverified. Reset it to `todo`, do NOT trust any partial diff.
