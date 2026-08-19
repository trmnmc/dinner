# dinner — run retro

Run: 2026-08-18 → 2026-08-19 | cycles run: 27 (+ this WRAP_UP) | stop reason: `stop_at` 12:00:00Z reached (`now ≥ stop_at − 900` at cycle 28)

## What worked

- **The mutation gate as the definition of "verified", not a green suite.** Adopted at cycle 5
  and applied to every test-bearing item thereafter: inject a deliberate defect, require the
  new test alone to go red, restore. It caught tests that passed without pinning anything and
  is the single reason the 411-assertion suite means something. Killed mutants recorded at
  cycles 5, 6, 9, 20, 23, 25, 26 (12 mutants across T-020/T-021), 27 (2 mutants). (cycles 5, 6,
  9, 20, 23, 25, 26, 27)
- **Authoring the verify check at verification time, never from the backlog.** The gate that
  found the most real defects was always the one the builder had not seen. T-053's gate asserted
  client output against the domain's own `combined_label` computed live rather than a literal
  string (D-30) — a hardcoded literal would have passed a broken renderer. T-067's gate imported
  the shared export directly in node and read the ladder off real output. (cycles 20, 23, 27)
- **Two direct foreground Agent calls with strictly disjoint file scopes**, after the Workflow
  tool proved review-gated in headless `-p` sessions. Five consecutive clean waves at k=2 with
  zero cross-scope contamination, each builder independently confirming via `git status` that it
  had not touched the other's files. This is the pattern that made a headless night productive.
  (cycles 24, 25, 26, 27)
- **Filing the remainder as a named item instead of widening a builder's scope.** T-067 fixed
  the prep screen's duplicate `durationWords` and deliberately left `cook.js`'s copy alone to
  keep the two builders disjoint; the remainder went to T-063's notes rather than into the wave.
  No merge conflict occurred all night. (cycle 27)
- **Live-look passes finding what the suite structurally cannot.** The cycle-23 look pass found
  6 prep-screen defects; KI-10 (grocery quantities rendering as `"Olive oil 44 12376473/25600000 ml"`)
  and KI-12 (kitchen timers unreachable — nothing in the product could ever start one) were both
  fully-tested code that was simply not wired to a user. A green suite proved nothing about
  either. (cycles 12, 23, 24)
- **Re-probing before obeying a stale recommendation.** Cycle 26 recommended preferring WRAP_UP
  over one more item, on a projected depletion of 11:46:19Z. Cycle 27 re-probed, found burn had
  fallen 53.99 → 46.45 M/h and depletion had moved to 12:12Z, and overrode the recommendation —
  earning two more verified user-visible items. The recommendation was conditional on a number,
  and the number was re-read. (cycles 26, 27)

## What thrashed

- **T-005 hit attempts 2 and is permanently blocked** — why: the gate scored 44/45 at cycle 8
  (attempt 1) and failed again at cycle 9. The module was ~95% right both times; the failure was
  on the calibration *variance-selection* surface, not the preference arithmetic. The churn rule
  correctly refused a third attempt, but the effect is that a large item sits under one `blocked`
  label while most of its code is in main, green, and exercised by the product. T-037 was filed
  to re-gate exactly the unverified surface and never got picked. The lesson is about item
  granularity, not about the rule. (cycles 8, 9, 10, 37-filed)
- **KI-7: the default first-run path produced zero dinners** — why: onboarding pre-selected
  30 min total / 15 min active while every authored recipe exceeded it. Two independently
  correct components composed into a product that did nothing on first open. Neither
  component's tests could see it; only running the default path could. Cost ~1 cycle to find
  and fix. (cycles 12, 13)
- **KI-10, KI-12, D-34/T-065/T-069: four separate instances of "implemented and unreachable"** —
  why: the same failure shape recurred all night. Package-size selection, estimate labelling and
  surplus math were fully implemented and dead because `data/ingredients.json` shipped zero
  package options for all 97 ingredients (D-34); then when options were authored, `catalog.ts`
  dropped them and `routes.ts` passed `[]` (T-069). Kitchen timers had a complete state machine
  and no code path that produced a `timer_started` event (KI-12). Domain-first building without a
  wire-through check at each layer boundary is what produced all four. (cycles 23, 24, 25)
- **T-038's gate failed 13/14 and the work landed anyway** — why: cycle 21 dispatched and the
  gate failed on one check; the item was re-queued and only closed at cycle 23. One wasted cycle,
  and `consecutive_no_value` correctly rose to 1. (cycles 21, 23)
- **T-065 dispatched with a stale `files_hint`** — why: the stored hint named `data/ingredients.json`
  only, but the item's acceptance named a user-visible observable on the live grocery list, which
  required the route and client too. The data half landed and the gate failed 8/11 on the screen.
  Fixed by ruling D-33: derive file scope from the user-visible observable at pick time, never
  copy the stored hint. (cycle 24, resolved cycle 25)
- **Four cycles lost to infrastructure, not to code** — why: KI-4 (the headless pacer terminates
  background tasks at 600s while build-wave's budget is 2700s) guillotined cycles 4 and 6
  mid-flight, taking a workflow return, a journal block and a builder's test file with it; KI-6
  (the account's 5-hour session limit) terminated cycle 10 mid-wave and killed three consecutive
  pacer spawns outright. Both are SWARM-side, both are recorded and neither was worked around
  mid-run (hard rule 5). (cycles 4, 6, 10, 11)
- **`bin/swarm-playbook.sh parse` and the env-prefixed `RUNFILE=… swarm-budget.sh` form were
  DENIED by the harness for the entire run** (KI-1) — why: the kickoff step-5 `settings.json`
  edit was itself denied, so `permissions.additionalDirectories` stayed `[]` and every headless
  cycle depended on `swarm-pacer.sh` passing `--add-dir` explicitly. Consequence: zero playbook
  directives were staged this run, so the run learned nothing from 20 existing lessons. This is
  the 26th consecutive run with this gap.

## Pacing honesty

- Governor clamps: **the weekly governor was engaged for effectively the whole run** (ceiling 2
  from roughly cycle 12 onward; weekly 100% / opus 100% against week_elapsed 32%, heat ~3.1).
  At cycle 27, ρ was **0.79 — a gear-4 ratio — but the governor ceiling of 2 is what bound**, so
  the applied gear was 2 and the effective wave was `min(k_current 5, gear cap 2) = 2` all night.
  `k_current` reached 5 by autotune and was academic from that point on.
- Full-mode overrides: 0. Promote-rung promotions: **0** (`promote_blocked: true` throughout).
  Demotions applied: every non-judgment item, all run (`demote: true`), which held fix/polish
  work on sonnet — its floor.
- Voluntary idle cycles: **0**. Limp episodes: 0.
- Window utilization: the 09:00Z window ran 51.8M → 95.3M tokens by 11:30Z at 46.5 M/h against a
  projected depletion of 12:12Z — i.e. the window was projected to survive the run with margin,
  which is *under* the ≥95% utilization target. The honest reading: the thermostat was never the
  constraint; the weekly governor was, and it held the run two gears below what the in-window
  ratio alone would have allowed for roughly 16 consecutive cycles.

## Config recommendations

- [process] A domain capability is not shipped until one check exercises it through the outermost
  layer a user touches; "implemented and unit-tested" and "reachable in the product" are different
  claims and the second is the one that counts. [apply: for any build item whose acceptance names a
  domain capability, add a wire-through check at the route AND client boundary to that item's gate]
  [confidence: high] [source: 2026-08-19 dinner]
  (evidence: KI-10 cycle 23, KI-12 cycle 24, D-34/T-065 cycle 24, T-069 cycle 25 — four instances,
  one shape)
- [wave] Two direct foreground Agent calls with pairwise-disjoint file scopes is the reliable
  headless dispatch when the Workflow tool is review-gated; declare each scope in the prompt and
  file the out-of-scope remainder as a named backlog item rather than widening the wave.
  [apply: in headless `-p` sessions dispatch build waves as direct Agent calls at k=2 with declared
  disjoint scopes] [confidence: high] [source: 2026-08-19 dinner]
  (evidence: cycles 24, 25, 26, 27 — five clean waves, zero merge conflicts, zero cross-scope
  contamination)
- [process] Size a build item so that one failed gate blocks one verifiable surface, not five. An
  item whose gate scores 44/45 twice and is then permanently blocked leaves most of its verified
  code under an unverified label. [apply: split any PLAN item whose acceptance lists more than
  three independently-checkable surfaces] [confidence: med] [source: 2026-08-19 dinner]
  (evidence: T-005 cycles 8, 9; remedy item T-037 filed and never picked)
- [qa] A run that never spends a cycle on the taste pass ships with zero evidence about whether
  the product is worth using twice, however green the suite is. [apply: schedule the taste pass at
  the run's midpoint, not in the tail where the clock eats it] [confidence: high]
  [source: 2026-08-19 dinner]
  (evidence: `qa.last_taste_cycle` null after 27 cycles; `last_full_qa_cycle` null; one look pass
  total, cycle 23)
- [routing] When the weekly governor pins the ceiling for most of a run, `k_current` autotune is
  measuring nothing — it climbed to 5 while the effective wave stayed 2 for ~16 cycles. Report the
  binding constraint explicitly each cycle so the gear number is not read as the reason.
  [apply: journal which of {ρ, governor ceiling, SMOKE cap} bound the effective wave size]
  [confidence: med] [source: 2026-08-19 dinner]
  (evidence: cycle 27 probe note — ρ 0.79 would earn gear 4, ceiling 2 bound; cycles 12–27)

## House-rules proposals

- [ui] Never signal a status by colour alone — pair it with text in the visible row AND the
  `aria-label` (the rule that made T-062's optional-line marker honest, cycle 27).
- [ui] Render a duration through the one shared formatter; a screen that formats its own minutes
  will eventually say "418 minutes" to a user (cycles 20, 27).
- [review] When reviewing a domain feature, open the client and confirm a user can reach it before
  accepting the item — four defects this run were reachability, not correctness (cycles 23, 24, 25).

## Applied lessons check

`runfile.playbook.applied` is empty — `bin/swarm-playbook.sh parse` was DENIED by the harness at
kickoff (KI-1), so no lessons were staged and none can be checked. This is itself the finding:
26 consecutive runs of accumulated playbook learning did not reach this run.

## Telemetry (squeeze slice, 2026-08-14)

- Weekly utilization achieved at reset: **100% overall / 100% premium** — the governor was
  saturated for the whole run and held the ceiling at gear 2.
- Allocator: no `runs/allocator.json` consulted this run; allowance vs burn not attributable.
- Auto-kickoffs this run/week: 0 — this was a manual chat kickoff (2026-08-18), no
  `kickoff-hints.json`, no 3-strike queue drops.
- Final-hours floor release: did not fire. The final hour ran at gear 2 under the governor ceiling
  and admitted only S-effort work via the carve-out (cycle 27, 2051 s to the wrap trigger).
