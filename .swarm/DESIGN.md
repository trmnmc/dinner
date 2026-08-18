# DESIGN — Three Good Dinners

<!-- LOCKED cycle 1 (2026-08-18T19:33Z) by design-panel wf_0d145bc2-64b.
     Winner: candidate B (AMBITIOUS brief), judge score 45/50 (must_haves 10,
     buildability 9, value 9, coherence 9, depth 8) vs A 40, C 42.
     Six ideas grafted from the losing candidates — marked [steal] below.
     Raw panel return: .swarm/runs/cycle-001-design-panel.json
     This file is BINDING on every builder. Anything here overrides an agent's
     own taste. Changes require a conductor decision entry, not an edit. -->

## The one-line shape

Three strict layers in one zero-runtime-dependency repo, run directly by Node 24's
native type stripping. `tsc --noEmit` is the strict gate, never a build step.

```
domain/   pure, deterministic, side-effect-free TypeScript — no I/O, no floats
server/   node:http + node:sqlite — thin routes over domain functions
web/      framework-free HTML/CSS/JS — one design system, seven screens
data/     curated ingredient registry + 30 authored recipe JSON files
tests/    node:test only
```

## Non-negotiable invariants

These are the decisions that, if a builder quietly breaks one, cost the most to
recover at 4am. Each exists because a specific failure was predicted.

1. **`Rational` (bigint num/den) is the ONLY arithmetic type on authoritative
   paths.** No IEEE float ever touches a quantity, price, or persisted score.
   `domain/src/qty.ts` is the sole arithmetic entry point; `aggregate`,
   `packaging`, `inventoryMath`, and `score` import from it and never use bare
   `+`/`*` on numbers. Rounding happens once, at the display/package boundary.
   *Predicted failure: a rounding-lucky float that DoD 4/5 tests do not catch —
   review greps for arithmetic operators in those files.*

2. **Timers are stored as absolute UTC end instants, never as remaining
   seconds.** Kill/reload recovery is then arithmetic, not bookkeeping, and DoD 7
   cannot flake on it. The cooking-event shape is frozen in wave 0 for this reason
   alone.

3. **Every data-access helper in `server/src/db.ts` takes `household_id` as a
   REQUIRED first argument and appends the WHERE clause itself.** Routes cannot
   express an unscoped query. Isolation is structural, and the tests prove the
   structure rather than a convention.

4. **Swap re-ranks against the frozen remaining two meals — it never re-runs
   `planset`.** An agent who "helpfully" re-optimises the whole set breaks DoD 3.
   `domain/src/swap.ts` implements exactly this definition.

5. **The catalog validation gate exists BEFORE the first recipe is written**, and
   `tests/catalog.test.ts` cross-checks ingredient ids against allergen classes in
   the registry. That cross-check lands in wave 1C, not wave 3 — otherwise DoD 9
   fails via data at 5am, not via code.

6. **Recovery instructions and panic guidance are read from required per-step
   metadata only. Never fabricated.** If the metadata is absent, the UI says so.

## Identity contract [steal from C]

Free-hand CSS outside the tokens is the failure mode to police in review — seven
vanilla-JS screens written by parallel agents diverge into seven visual dialects
otherwise.

- `web/css/tokens.css` lands before any screen and every screen consumes it:
  type scale, 4px spacing grid, dark-first palette with verified contrast, 44px
  minimum targets, focus states, `prefers-reduced-motion`, and `tabular-nums`
  on every quantity and every minute.
- `web/js/ui.js` is the only source of shared components: bottom sheet, undo
  snackbar (**undo, never a confirmation modal**, everywhere), aria-live timer
  announcer, reason chips, status-beyond-colour badges.
- **One dominant action per screen**, bottom-anchored in the thumb zone. Never two
  primary buttons. Never more than three choices anywhere.
- **A single shared total-vs-active time renderer** [steal from C]: DoD 6 ("total
  and active time separately everywhere") becomes a property of one helper instead
  of a per-screen convention. Reason-code copy lives with it, in
  `domain/src/reasons.ts`, with numeric slots — so a voice review is a one-file
  diff.
- The grocery list is a **ledger/receipt**: tabular numerals, each line expanding
  into a provenance drawer. Typography does the trust-building work that the
  traceability must-have exists for.

## Voice

Concrete and countable. "22 min total, 7 hands-on" — never "quick and convenient".
Guilt-free: "the leftover half-can of coconut milk fits Thursday's curry", never
"you're about to waste your coconut milk". Honest about uncertainty: estimated
packages say **estimated**, and the app never shows false precision to look
competent — which is exactly what makes the numbers it does state believable.

## Grafted steals (from the losing candidates)

- **[C]** One copy module with numeric slots + the shared time renderer (above).
- **[C]** User grocery-quantity edits live in a **separate, never-overwritten
  column**, so list regeneration cannot clobber them by construction — a schema
  mechanism where B only stated the invariant.
- **[C]** This DESIGN.md as a binding contract + the tokens-only CSS rule.
- **[C]** **Wave-0 `node:sqlite` smoke check on Node 24.19**: verify it loads
  unflagged before anything else is built, not at 4am. (Kickoff already proved it
  in-memory; wave 0 re-proves it on a real file DB with the actual statement API.)
- **[C]** Receipt/ledger treatment of the grocery list (folded into Identity above).
- **[A]** Broaden `tests/e2e.loop.test.ts` to the full DoD sweep — explicitly assert
  DoD 2 (≥2 of 3 meals approvable) and DoD 6 (total+active time present in every
  payload carrying a time), which B's loop test covered only for DoD 1, 3, 8.
- **[A]** **Ephemeral-port and db-path flags on the server entrypoint as first-class
  test affordances**, so the SIGKILL/restart e2e gets a temp SQLite file and a free
  port per run. This is the stated mitigation for kill-test flake.

## Build order (waves)

Wave numbers here are DESIGN sequence, not cycle numbers. The conductor composes
each cycle's wave from the backlog under the effective-k cap.

- **Wave 0 — interface freeze (1 agent, blocks everything).** `package.json`,
  `tsconfig.json`, `domain/src/qty.ts`, `domain/src/recipe.ts` (all shared types
  incl. score-breakdown and cooking-event shapes), `server/src/db.ts` schema,
  `web/css/tokens.css`, and the node:sqlite smoke check. Nothing else starts until
  these contracts are committed.
- **Wave 1 — four parallel, non-overlapping.** (A) quantity pipeline: units,
  normalize, ingredients, scale, aggregate, inventoryMath, packaging + its tests.
  (B) planning intelligence: preferences, filters, score, planset, swap,
  calibration + its tests. (C) content: `data/ingredients.json` + 30
  `data/recipes/*.json` + catalog tests, run against the wave-0 gate continuously.
  (D) cooking core: cooking, prep, reasons + its tests.
- **Wave 2 — three parallel, disjoint.** (E) server: http, main, all routes.
  (F) web shell + onboarding: api.js, router.js, ui.js, app.css, index.html.
  (G) plan.js and grocery.js against the wave-0 route contracts.
- **Wave 3 — proof.** cook.js with resume-into-session; the four proof tests
  (e2e.cooking kill/reload, e2e.loop, fuzz, isolation); accessibility and copy pass.
  **Full DoD green at the end of this wave.**
- **Wave 4 — delighters, strictly after DoD is green, each independently
  droppable.** Panic button in cook.js; show-the-math drawer in plan.js;
  copy-to-clipboard export; `useitup.ts` + its chip; second-adult preferences
  **first to cut** (it is the only delighter that edits an existing module rather
  than adding a leaf).

## Contract-drift rule

Three wave-2 agents build against route contracts defined in wave 0. **Any change
to a frozen type after wave 1 is a single-agent commit, never parallel edits.**
Treat it as an emergency, not a refactor.

## What the panel flagged as most likely to overrun

Catalog authoring: 30 recipes × complete quantities × attribute vectors × 9
interruption-metadata fields per step. If it is treated as prose instead of
schema-first data entry against the gate, calibration, novelty scoring, and swaps
all degrade silently. **Fewer fully-valid recipes beat 30 partially-valid ones** —
the gate excludes incomplete recipes from recommendation anyway, so a short catalog
is a graceful degradation and a broken one is not.
