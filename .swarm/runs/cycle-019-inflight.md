# cycle 19 — in-flight marker

Written at DISPATCH time (1787123335 / 2026-08-19T07:08:55Z), before any agent ran.
If this cycle dies, the next session reads this file first.

- gear **1** (crawl), ρ 3.05, wave cap **1**, demote=true, promote blocked (weekly ceiling 2)
- window depletion projected **07:45:44Z**, reset 09:00Z — expect limp before the reset
- mechanism: **ONE foreground Agent call** editing the main working tree (D-11). No
  build-wave workflow, no worktree, no builder branch. The builder is forbidden to run
  any git command; the conductor commits.

## The item

**T-045** (S, priority 2, kind fix, sonnet) — *A plan with fewer than three active meals
can never be swapped out of.* This is **KI-9, severity high, open since cycle 12**.

`server/src/routes.ts:915-916` — `handleSwap` filters out `swapped_out` rows and then
requires `rows.length === 3`, else 409 `plan_incomplete`. A time-limited household is
exactly the household that gets a 1- or 2-meal partial plan (KI-7's shortfall path), so
the users most likely to receive a short plan are the users who can then never change it.
Permanent dead end, no recovery path in the product.

Root cause is not the route check on its own: `domain/src/swap.ts` types the request as a
fixed 3-tuple (`meals: readonly [SwapMealInput, SwapMealInput, SwapMealInput]`, line 152)
and returns `unchanged: readonly [SwapMealInput, SwapMealInput]` (209, 219). The route's
`=== 3` check is downstream of that contract.

## RULING — decided BEFORE dispatch, builder is told it

Fix by **generalising swap arity from exactly-3 to 1–3** in the domain, and dropping the
route's arity gate to match. The frozen set becomes "every active meal except the swapped
slot" and MAY BE EMPTY (a 1-meal plan).

Ruled OUT, explicitly, before the builder starts:

1. **No tuple padding.** Never duplicate a meal or synthesise a placeholder to satisfy the
   3-tuple. That fabricates a frozen meal that is not in the plan and corrupts
   `ingredient_overlap` and both diversity terms against a meal the parent does not have.
2. **No cast.** No `as [SwapMealInput, SwapMealInput, SwapMealInput]`, no `!`, nothing
   that lets `undefined` reach domain code. `swapMeal` destructures `request.meals` at
   line 660 and would read `undefined` straight into the frozen context.
3. **No planset re-run.** Do not top the plan back up to three meals. Invariant 4 is
   locked: swap re-ranks against the frozen remaining meals and never re-runs planset.
   Filling short plans is a different item and a different must-have.
4. **No weakening of the 409 into a silent success.** A genuinely malformed plan (a
   duplicate slot, a slot outside 0–2, zero active meals) must still fail loudly.
5. **Slot validation must stay real.** `parseSlot` accepts 0|1|2; a slot that is not
   OCCUPIED in this plan must still be rejected (400/409, builder's call which — but not
   silently swapped and not 500).

Semantics I have already checked in the code and am pinning so they are not "fixed":

- Empty frozen set → `overlapRaw` is `ZERO` (sharedCount 0), and `proteinRaw`/`cuisineRaw`
  are `ONE`, i.e. every candidate gets full diversity credit. That is **correct**: there
  is nothing to clash with. It shifts all candidates equally and cannot distort the
  ranking. Do not special-case it, do not zero it out.
- Empty frozen set → `factsFor` emits no `shares_ingredients` fact (`bestMeal` stays
  null). Correct — there is no other meal to share with. Do not fabricate a substitute.
- Neither loop divides by the frozen count, so no zero-division exists to guard.

Expected shape: `readonly [A,A,A]` → `readonly SwapMealInput[]`, same for the two
`frozen:` parameters (lines 465, 609) and `unchanged` (209, 219). Every existing index
read (`unchanged[0]`, `unchanged[1]`, the `[slot0,slot1,slot2]` destructure) stays valid
under the widened type; the destructure at 660 must be replaced by index/`swap_slot`
lookups. Existing 3-meal tests should keep passing unchanged — if one goes red, the fix
is wrong, not the test.

## File scope (single agent, whole tree, no worktree)

- `domain/src/swap.ts`
- `server/src/routes.ts` (handleSwap only)
- `tests/swap.test.ts`, `tests/routes.test.ts` (additions only)

Manifests are conductor-owned (D-6) and out of scope. `npm test` = `tsc --noEmit` then
`node --test 'tests/**/*.test.ts'`. Baseline before this cycle: **364/364**.

## If this cycle dies

Working tree may hold uncommitted edits to the four files above. Judge coherence from
`git diff --stat` + a green `npm test`; salvage-commit if coherent (D-24), else reset.
The verification gate had NOT been authored at dispatch time — author it fresh from this
ruling, never from the builder's notes.
