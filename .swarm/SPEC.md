# SPEC — dinner

<!-- Instantiated at kickoff. Frozen after user confirmation (LOCKED 2026-08-18).
     The conductor restates the digest every cycle and re-reads this file in full
     every 5th cycle (reference/cycle.md step 3). -->

## Idea

A dinner decision-and-execution system for a busy parent — not a recipe-discovery app.
The user opens it with no plan and leaves with three dinners they actually want, one
trustworthy grocery list, and a cooking process that survives an interruption.

Mobile-first web client over a deterministic TypeScript domain package and SQLite
(`node:sqlite`, zero runtime dependencies). The whole product is one loop:

> lightweight onboarding → taste calibration → a ranked 3-dinner plan → one-tap reasoned
> swaps → a consolidated grocery list where every quantity is traceable → prep plan →
> interruption-aware cooking mode → one-tap feedback that improves the next plan

Platform note (kickoff decision, recorded): the source brief specifies React Native +
Expo. This build machine is headless Linux with no iOS simulator, so an Expo client
could not be run, interacted with, or verified — it would ship unproven. The client is
therefore mobile-first web over an identical domain package; a React Native port
consumes that package unchanged later.

## Audience

A parent caring for an infant. Uses the phone one-handed, is interrupted unpredictably,
cooks about three dinners a week, orders groceries for pickup or delivery, likes good
food but dislikes the work around cooking, and repeats the same eight meals because
finding new ones costs more energy than it returns.

Explicitly NOT a meal-planning hobbyist: the product must never ask them to become a
diligent pantry manager or data-entry operator. Optional second adult in the household
with their own preferences.

## Must-haves

<!-- The PLAN gate holds until every box below is covered by a backlog item.
     Checked off only after conductor verification, never by claim. -->

- [ ] **Deterministic quantity engine** as pure, unit-tested functions: serving scaling,
      ingredient normalization with curated aliases and a confidence value, same-dimension
      unit conversion (mass→grams, volume→millilitres, count), exact decimal arithmetic
      with no binary floating point in authoritative paths, cross-recipe aggregation,
      inventory subtraction gated on confidence, and full traceability from every
      aggregated number back to the recipe lines that produced it. Volume→mass only with a
      curated ingredient density; count→mass only with a curated per-item estimate; ranges
      preserved and purchased conservatively; "to taste" never folded into a numeric
      quantity.
- [ ] **Catalog of ~30 internally authored, structurally complete recipes** spanning
      proteins, cuisines, cooking methods, effort levels and flavour profiles — each
      carrying machine-readable attributes (cuisine, protein, flavour, texture, spice,
      richness, method, equipment, cost band, dish count) AND per-step interruption
      metadata: `active_duration_seconds`, `unattended_duration_seconds`,
      `requires_continuous_attention`, `safe_to_pause_before/during/after`,
      `maximum_pause_seconds`, `natural_stopping_point`, `interruption_risk`,
      `recovery_instruction`, `timer_duration`. A validation gate makes a recipe
      ineligible for recommendation unless quantities are complete, steps ordered,
      servings known and dietary tags verified. Attribute spread is a requirement, not a
      nicety: the catalog must support meaningful swaps and novelty scoring.
- [ ] **Onboarding under four minutes** (household size, hard dietary restrictions,
      allergies, never-recommend ingredients, preferred proteins and cuisines, weeknight
      active-time and total-time ceilings, novelty preference, assumed staples) followed by
      **taste calibration** over 8–15 deliberately varied meal cards with four reactions
      (looks good / not for me / never recommend / too much work). Every reaction updates
      attribute-level preference signals — protein, cuisine, flavour, texture, spice,
      richness, method, effort — each stored with a value, a confidence and a durability,
      never collapsed into one opaque taste score.
- [ ] **Deterministic recommendation engine**, not an LLM prompt. Hard filters run first
      and are absolute: allergies, dietary restrictions, explicit exclusions, hard time
      ceilings, recent-repeat constraints. Survivors are ranked by configurable weights
      (preference fit 32%, context and interruption fit 20%, inventory use 16%, cost fit
      12%, novelty fit 10%, future leftover usefulness 10%) with explicit penalties for
      recent repetition, repeated cuisine or format, excessive active time, dish count and
      likely waste. Adjacent novelty is computed as attribute distance with at least one
      familiar anchor preserved. A second-stage **greedy set-scoring** pass then optimises
      the SET of three meals for useful ingredient overlap, protein and cuisine diversity,
      total weekly active time and cost. Every score breakdown is persisted for debugging.
- [ ] **Plan screen**: three dinners, each with name, total time AND active time shown
      separately, interruption profile, effort, at most three structured reason codes
      rendered as concise concrete copy, ingredients already owned or shared with another
      meal, cost band, familiarity/novelty indicator. **One-tap swap by explicit reason**
      (faster, less hands-on, fewer dishes, cheaper, more familiar, more adventurous, no
      pasta, different protein, use what I have) which replaces ONLY that meal and offers
      at most three alternatives respecting the rest of the plan's ingredient context.
- [ ] **Consolidated grocery list**: requirements from all planned recipes scaled to
      servings, normalised, converted, aggregated, inventory subtracted, matched to package
      options with a generic fallback ("one bunch", "one ~2 lb package", "two 15 oz cans")
      labelled as estimates. Grouped by store section by default. Every item answers
      "why am I buying this?" by naming each contributing recipe and its amount, the
      inventory deducted and the expected surplus. User quantity edits are preserved and
      never silently overwritten.
- [ ] **Interruption-aware cooking mode**: one step at a time, large text, one-handed
      completion, background-safe timers, active versus unattended intervals labelled, an
      explicit warning before any step requiring continuous attention (with the
      uninterrupted duration it needs), the next safe stopping point always visible, and
      validated recovery instructions only — never fabricated. State survives process kill,
      reload and backgrounding with step progress and timer state intact.
- [ ] **Prep plan** before cooking: ingredients to retrieve, equipment needed, tasks that
      can be done earlier, the first non-interruptible step, the first safe stopping point,
      expected active-time blocks.
- [ ] **Post-meal feedback** in under five seconds and at most two taps (make again / it
      was fine / not again, plus one optional reason such as too much work, took longer
      than expected, too bland, easy with interruptions), updating attribute-level
      preferences with negative signals weighted more strongly and faster than weak
      positive ones.
- [ ] **Confirmed-only inventory**: onboarding staples, confirmed purchases, consumption
      on "cooked", package surplus recorded on purchase confirmation. Subtraction applies
      only to `confirmed` and `assumed_staple` entries; anything less certain becomes a
      high-value confirmation question ("your plan needs 4 lemons, we think you have 2 —
      still right?"), never a 47-item pantry review.
- [ ] **Household isolation** enforced server-side on every query, with tests proving one
      household cannot read another's recipes, preferences, inventory, plans, lists or
      feedback.
- [ ] **Accessibility as part of done**: screen-reader labels, dynamic type, sufficient
      contrast, 44px minimum targets, status conveyed beyond colour, accessible timer
      announcements, no gesture-only critical actions, and an undo for every
      destructive-feeling action instead of a confirmation modal.

## Nice-to-haves

- Pasted-text recipe import with a structured review step and per-field confidence
- Inference inventory layer: append-only event log, five-state confidence lattice
- Use-it-up suggestions that score a surplus ingredient against future plan fit
- Shareable / copy-to-clipboard grocery list export
- Second household adult with independent preferences and a minimum-acceptable-fit rule
- Combinatorial plan search (pruned) replacing the greedy set-scoring pass

## Non-goals

- Recipe import from URL, screenshot or Instagram — deferred; the deterministic core must
  be trustworthy before messy input touches it
- Any grocery-provider integration, live pricing, cart creation or ordering. The manual,
  copyable list is the product
- Push notifications, calendar integration, barcode scanning, voice control
- Nutrition, calorie or macro tracking; any medical or infant-feeding guidance
- Social features of any kind: feeds, sharing, comments, creator profiles, streaks,
  badges, gamification
- Native iOS/Android build — web client only tonight
- **Any LLM call in the authoritative runtime path.** Quantities, conversions, inventory
  subtraction, dietary filtering, package selection and recommendation ranking are
  deterministic code, always
- Seven-day plans, breakfast, lunch, restaurant ordering, coupons, price comparison
- PostgreSQL tonight (SQLite via `node:sqlite`), but the schema stays Postgres-shaped:
  UUID ids, UTC timestamps, integer cents, exact numeric quantities

## Taste notes

Built for one hand at 6pm with a baby on the hip. One dominant action per screen; never
two buttons competing. At most three choices anywhere.

Copy is concrete and countable — "9 minutes hands-on", "safe stopping point after step 3",
"uses the parsley from Tuesday" — never "quick and convenient".

Neutral, guilt-free language: "this parsley is best used by Thursday", never "you're about
to waste your parsley".

Honest about uncertainty: estimated packages say estimated, unverified interruption
metadata says unverified, and the app never shows false precision to look competent.

Calm, legible, dark-friendly, fast. No engagement mechanics of any kind — a household
cooking three good dinners a week is the win condition, not daily opens.

## Domain rules

- Serving scale factor = `target_servings / recipe.servings_default`, applied to each
  ingredient's base quantity (min and max independently).
- Canonical base units: grams (mass), millilitres (volume), count (discrete). Conversion is
  permitted only within one dimension. Volume→mass requires a curated ingredient density;
  count→mass requires a curated per-item weight; absent either, the requirement stays in
  its own dimension and is reported separately rather than guessed.
- Aggregation: requirements merge only when canonical ingredient id AND base unit dimension
  match. Differing preparation states are preserved on the line, never silently merged.
- Inventory subtraction applies only to entries with confidence `confirmed` or
  `assumed_staple`. Less certain entries are surfaced as a confirmation question and are
  NOT subtracted until answered.
- `purchase_requirement = max(0, aggregated_requirement − usable_inventory)`.
- `purchase_quantity` = the package combination whose total usable yield ≥
  `purchase_requirement`, chosen by minimising (expected waste, package count) when no
  price data exists. **Underbuying is prohibited.**
- `expected_surplus = total_package_yield − purchase_requirement`, written to inventory on
  purchase confirmation.
- Recipe score = `0.32·preference + 0.20·context_interruption + 0.16·inventory_use +
  0.12·cost + 0.10·novelty + 0.10·leftover_usefulness`, minus penalties. Weights live in
  one config object, never inline literals.
- Hard-constraint precedence, absolute and never averaged:
  allergy > household hard restriction > member hard restriction > strong dislike >
  soft preference > optimisation.
- A strong dislike can never be outweighed by inventory use or lower cost.
- Inventory is decremented on "cooked", never on "planned".
- "To taste" ingredients are never aggregated into a numeric purchase quantity.

## Definition of done

1. A new user completes onboarding and reaches a three-meal plan in under five minutes of
   interaction.
2. At least two of the three recommended meals are approvable without leaving the app.
3. Swapping one meal takes at most three taps and changes only that meal.
4. The grocery list contains zero duplicate ingredient lines caused by naming differences —
   proven against alias fixtures ("garlic cloves", "cloves of garlic", "fresh garlic",
   "3 cloves garlic, minced").
5. Every grocery quantity is traceable: the UI names each contributing recipe and its
   amount, and a test asserts the links exist for every line.
6. Total time and active time appear separately everywhere a time is shown.
7. Cooking mode survives a process kill and page reload with step progress and timer state
   intact — proven by an end-to-end test, not a claim.
8. Post-meal feedback is recorded in at most two taps.
9. A fuzz test over generated households with random allergies and exclusions produces
   zero plans containing a hard-excluded ingredient.
10. Household isolation tests pass: no cross-household read is possible on any entity.
11. Full test suite green; TypeScript strict with no `any` in the domain package.

## Commands

- run: `npm start`
- test: `npm test`

## Spec digest

- Dinner decision-and-execution system for an interrupted parent: onboarding → 3-meal plan
  → reasoned swap → traceable grocery list → interruption-aware cooking → feedback.
- Deterministic core is the product: quantities, units, aggregation, inventory subtraction,
  dietary filtering and ranking are pure tested code — never an LLM.
- The differentiator nothing else ships: per-step active/unattended/continuous-attention
  time, safe stopping points, validated recovery, and cooking state that survives a kill.
- Non-goals: no import, no grocery integration, no notifications, no nutrition, no social,
  no native build, no LLM in the authoritative path.
- Taste: one hand, one dominant action per screen, ≤3 choices, concrete countable copy,
  guilt-free language, honest uncertainty, zero engagement mechanics.
