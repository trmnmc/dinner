# dinner — overnight build report

A deterministic dinner decision-and-execution system for an interrupted parent: onboarding →
taste calibration → a ranked 3-dinner plan → reasoned one-tap swaps → a traceable grocery list →
prep plan → interruption-aware cooking mode that survives a process kill → two-tap feedback.
27 build cycles, 35 of 73 filed items conductor-verified, 411 tests green.

_No screenshot captured this run — the browse CLI was unavailable in this headless session, and
the run's live-look passes were recorded as text evidence rather than images._

## Run it

```
cd /opt/targets/dinner
npm install
npm start          # then open the printed localhost URL
npm test           # 411 assertions: tsc --noEmit (node + web) then node --test
```

## Must-haves

| Must-have | Status | Reason / evidence |
|---|---|---|
| Deterministic quantity engine (scaling, normalization, conversion, exact decimals, aggregation, confidence-gated inventory subtraction, traceability) | ✅ shipped | T-002/T-003/T-004, mutation-gated cycles 5–9. Exactness is asserted at the fraction level: 1 tsp is `157725491/32000000` ml, 1 lb is exactly 453.59237 g — never a float. Cross-dimension conversion without a curated density/per-item weight is an explicit typed refusal naming the missing field, not a guess. "To taste" is a distinct non-numeric state. |
| Catalog of ~30 recipes with interruption metadata + validation gate | ⚠️ **partial — 6 of ~30** | The *structure* is complete and verified: T-008 (validation gate, ingredient registry, allergen cross-check) and T-009 (6 recipes, maximum attribute spread) both conductor-verified at cycles 5 and 11. T-010 (recipes 7–18) and T-011 (19–30) were filed at cycle 2, never picked, and remain `todo`. What this costs: swap variety and novelty scoring have far less room than the spec intends. **To settle:** author 24 more recipes against the frozen contract in `domain/src/recipe.ts` — a human or a follow-on run, ~2 build waves. |
| Onboarding under 4 min + taste calibration over 8–15 varied cards, attribute-level signals | ⚠️ **partial** | Onboarding and the calibration screen shipped and are verified (T-015, cycle 12; T-042 fixed the KI-7 default-ceiling defect that produced zero dinners on first open, cycle 13). The attribute-level preference model itself (T-005) is **`blocked` at attempts 2** — its gate scored 44/45 at cycle 8 and failed again at cycle 9 on the calibration *variance-selection* surface. Its code is in main, green, and exercised by the product; KI-5, its blocking defect, was closed by T-034 (cycle 10). **What is not machine-checked:** that calibration cards are deliberately varied, and the feedback-update narrowing. T-037 was filed to gate exactly that and was never picked. |
| Deterministic recommendation engine — absolute hard filters, weighted scoring, penalties, greedy set-scoring | ✅ shipped | T-006 (filters + weights + persisted breakdowns) and T-007 (greedy set-scoring + frozen-context swap), mutation-gated cycles 6 and 11. Hard-constraint precedence is absolute and never averaged. No LLM is on any authoritative path. Caveat: DoD 9's fuzz proof over generated households did not run — see below. |
| Plan screen with separate total/active time, reason codes, one-tap swap by explicit reason | ✅ shipped | T-016 (cycle 14), T-038 swap no-alternatives copy (cycle 23), T-045 short-plan swap dead-end / KI-9 (cycle 19), T-053 + T-040 time rendering (cycles 18, 20). Swap arity was generalised from exactly-3 to 1–3 meals (D-27) after a constrained household was found to dead-end. Known defect: KI-13 (below). |
| Consolidated grocery list, aggregated, inventory-subtracted, package-matched, provenance per line | ✅ shipped | T-017 (ledger + provenance drawers + protected user edits, cycle 23, 15/15 reachable checks with 3 recorded NOT RUN by design — ruling D-33). T-052 fixed KI-10, where quantities rendered as `"Olive oil 44 12376473/25600000 ml"`. T-065 + T-069 (cycles 24–25) made package selection, estimate labelling and surplus reachable — they had been fully implemented and dead. T-062 (cycle 27) marks optional/garnish lines, all-or-nothing across contributors, mutation-gated. |
| Interruption-aware cooking mode; state survives kill, reload, backgrounding | ✅ shipped | T-019 (cycle 15) and T-012 (state machine with absolute-instant timers + kill-safe event log, cycle 5). T-020 **proved DoD 7 by execution** at cycle 26 — process killed, reloaded, step progress and timer state intact. T-058 (cycle 24) closed KI-12: kitchen timers had a complete state machine and no code path in the entire product that could start one. |
| Prep plan before cooking | ✅ shipped | T-057 (cycle 23), T-043 fixed unscaled prep quantities contradicting the grocery list (KI-8), T-040 time labels, T-067 (cycle 27) replaced "Pause up to 418 minutes" with "about 7 hours" on one shared formatter. |
| Post-meal feedback in <5 s and ≤2 taps | ✅ shipped | T-018, cycle 16. |
| Confirmed-only inventory | ⚠️ **partial** | Subtraction is correctly gated on `confirmed`/`assumed_staple` and mutation-gated (T-004, cycle 9); the confirmation-question path exists. **But nothing in the product marks a meal cooked or decrements inventory on cooking** — T-048 is filed and `todo`. The domain rule "inventory is decremented on cooked, never on planned" is therefore correct in the engine and unreachable in the app. **To settle:** wire a "cooked" action from cooking mode to the consumption path; ~1 S/M item. |
| Household isolation enforced server-side, with tests proving no cross-household read | ❌ **not proven** | The schema and `db.ts` helpers were built household-scoped from cycle 3 (Invariant 3), but **T-023, the test that proves it, was never picked** and remains `todo` at priority 1. This is reported as not-run, not as passed. **To settle:** a human must run T-023 before any multi-tenant deployment — it is the difference between a design intention and a proof. |
| Accessibility as part of done | ⚠️ **partial** | Applied per-screen as work landed — 44px targets, `aria-label`s, status conveyed beyond colour (explicitly re-checked in T-062, cycle 27), no gesture-only actions. **No dedicated accessibility pass ran**: T-024 (wave-2 screens) and T-068 (prep screen, 6 findings from the cycle-23 look pass) are both `todo`. No screen-reader or contrast audit was performed by any tool this run. |

### Definition of done — clause by clause

| # | Clause | Verdict |
|---|---|---|
| 1 | Onboarding → 3-meal plan in < 5 min | ✅ path proven end-to-end by T-021 (cycle 26); the *duration* was never timed with a real user |
| 2 | ≥ 2 of 3 meals approvable without leaving the app | ⚠️ not measured — needs a human |
| 3 | Swap ≤ 3 taps, changes only that meal | ⚠️ proven with one accepted exemption (D-35) — see KI-13 |
| 4 | Zero duplicate lines from naming differences | ✅ proven against the alias fixtures ("garlic cloves" / "cloves of garlic" / "fresh garlic") |
| 5 | Every grocery quantity traceable, test asserts links exist | ✅ T-017, cycle 23 |
| 6 | Total and active time separate everywhere | ✅ T-053/T-040/T-013, one shared renderer |
| 7 | Cooking mode survives kill + reload, proven by test not claim | ✅ **T-020, cycle 26, proven by execution** |
| 8 | Feedback in ≤ 2 taps | ✅ T-018, cycle 16 |
| 9 | Fuzz over generated households → zero hard-exclusion leaks | ❌ **NOT RUN** — T-022 filed at priority 1, never picked |
| 10 | Household isolation, no cross-household read | ❌ **NOT RUN** — T-023 filed at priority 1, never picked |
| 11 | Suite green, TypeScript strict, no `any` in domain | ✅ **verified by the conductor at WRAP_UP**: 411/411 pass, 0 fail; `grep ": any\|as any\|<any>" domain/src/` returns only two prose comments, zero types |

## Decisions log

38 decisions recorded in `.swarm/state.json`. The ones that shaped the build:

- cycle 1: web client instead of React Native + Expo — the build machine is headless Linux with no
  iOS simulator, so an Expo client could not be run or verified; it would have shipped unproven.
  The domain package is identical either way and a native port consumes it unchanged.
- cycle 3: frozen contract — step fields follow `domain/src/recipe.ts`, not SPEC.md's names
  (`maximum_pause` union, `timer_duration_seconds`, `recovery_instruction` as a union).
- cycle 3: fewer fully-valid recipes beat more partially-valid ones; the validation gate excludes
  incomplete recipes anyway. This ruling is why 6 complete recipes shipped rather than 30 partial.
- cycle 5 (D-12): mutation testing, not a green suite, is the gate for any test deliverable.
- cycle 19 (D-27): swap arity generalised from exactly-3 to 1–3 meals — a constrained household
  could otherwise never swap out of a short plan.
- cycle 23 (D-33): an item closed on a gate with unreachable checks is recorded at *n/n reachable*
  with the NOT RUN checks named — never rounded up to passed.
- cycle 24 (D-34): `npm test` now typechecks the client too; every "typecheck passes" claim made
  about a client file before this cycle was vacuous — `tsc --listFiles` reported zero files under
  `web/js`.
- cycle 25 (D-33'): a build item whose acceptance names a user-visible observable derives its file
  scope from that observable at pick time, never from the stored `files_hint`.
- cycle 26 (D-35): T-021's byte-identity invariant accepted with one surgical exemption, after the
  conductor independently reproduced the divergence — filed as KI-13 rather than waived.

## Known issues

Product-side, open:

- **KI-13 (medium)** — found cycle 26. Reason evidence is re-derived on every read instead of being
  persisted at choose-time, so an untouched meal's explanation can silently change when a
  *different* meal is swapped. Conductor-measured: after swapping slot 0, untouched slot 2's first
  reason changed. Filed as T-073. This is the one accepted exemption to DoD 3.

Resolved during the run, listed because they show the failure shape: KI-5 (never-recommend lock
bleeding across all attribute axes), KI-7 (default time ceilings excluded the entire catalog → zero
dinners on first open), KI-8 (prep quantities unscaled, contradicting the grocery list), KI-9
(short plans could never be swapped), KI-10 (grocery quantities as raw rationals), KI-11 (no client
JavaScript had ever been typechecked), KI-12 (kitchen timers unreachable).

Tooling-side, open — these cost cycles and belong in the morning triage, not in the product:

- **KI-4 (high)** — the headless pacer terminates a cycle's background tasks at 600 s while
  build-wave's own budget is 2700 s. Cycles 4 and 6 were guillotined mid-flight, losing a workflow
  return, a journal block and a builder's test file.
- **KI-6 (high)** — the account's 5-hour session limit terminated cycle 10 mid-wave and killed
  three consecutive pacer spawns outright.
- **KI-1 (medium)** — the kickoff `settings.json` edit was denied, so
  `permissions.additionalDirectories` stayed empty and `bin/swarm-playbook.sh parse` was denied all
  run. **Consequence: zero playbook lessons reached this run.**
- **KI-2 (medium)** — weekly-governor zero-envelope blind spot: a zero denominator disengages the
  governor.
- **KI-3 (medium)** — `workflows/build-wave.js` hardcodes a `/tmp` worktree that agent file-edit
  tools cannot write to on this host.

## Night log

- cycle 1–2: design panel, then PLAN — 73 items filed against the must-haves.
- cycle 3–9: the deterministic core — units, aliases, conversion, scaling, aggregation,
  confidence-gated inventory, filters, weighted scoring, set-scoring, catalog gate. Every item
  mutation-gated. Cycles 4 and 6 partially lost to the 600 s background-task kill (KI-4).
- cycle 10–11: KI-5 closed (T-034); first recipe batch verified. Cycle 10 killed mid-wave by the
  session limit (KI-6).
- cycle 12–13: the product becomes reachable — HTTP server, web shell, onboarding, calibration.
  The first live-look pass finds KI-7: the default path produced zero dinners.
- cycle 14–19: plan screen, grocery ledger, cooking mode, feedback screen, prep-time labels,
  short-plan swap dead-end (KI-9).
- cycle 20–23: time rendering unified; T-038 gate failed 13/14 and was re-landed; RECYCLE at 22;
  cycle 23 closes T-017/T-038/T-057 and rules D-33/D-34.
- cycle 24–25: the "implemented but unreachable" sweep — kitchen timers (KI-12), package options,
  estimate labelling and surplus all wired through to the screen.
- cycle 26: **T-020 and T-021** — DoD 7 kill/reload survival and the full product loop, both proven
  by execution, 12 mutants killed. KI-13 filed rather than waived.
- cycle 27: last work cycle — T-067 (humane pause copy on one shared formatter) and T-062 (optional
  grocery lines), both user-visible, both mutation-gated.
- cycle 28: WRAP_UP.

## Night control log

_No commands received._ (`runs/control.json`: `pending: []`, `applied: []`.)

## Stats

| Stat | Value |
|---|---|
| Cycles run | 27 work cycles + 1 WRAP_UP (1 RECYCLE at cycle 22) |
| Commits | 81 |
| Agents dispatched | ~45 (design panel, PLAN, and 2 builders per wave from cycle 12 on) |
| Models used | fable (judgment/verification seats), opus, sonnet (all build/fix work under `demote: true`) |
| Notifications sent | 21 |
| Pace | mode thermostat (dial 1.0), gear range 2–3, weekly governor engaged with ceiling 2 for ~16 consecutive cycles; window utilization at the 09:00Z reset: window projected to survive past `stop_at` (below the ≥95% target — the governor, not the window, was the binding constraint); voluntary idle cycles: **0** |

## Honest hand-off

**Machine-checked.** The deterministic core is the part you can trust: 411 assertions, green,
re-run by the conductor at wrap-up rather than taken from any agent's word. Exact rational
arithmetic on authoritative paths is asserted at the fraction level. Every test deliverable from
cycle 5 onward passed a mutation gate — a deliberate defect was injected and the test alone had to
go red — so the suite pins behaviour rather than merely executing it. TypeScript strict passes on
both the node and web configs, and the domain package contains no `any`. DoD 7, the kill-and-reload
survival of cooking state, was proven by actually killing the process (cycle 26). The full product
loop was walked end-to-end by execution, not by inspection.

**Not run — reported as not-run, never as passed.**

- **DoD 9, the hard-exclusion fuzz (T-022), and DoD 10, household isolation (T-023).** Both were
  filed at priority 1 and neither was ever picked. The engine's hard-constraint precedence is
  unit-tested and the DB helpers are household-scoped by construction, but *no test proves either
  property holds under adversarial input*. Treat the allergy path as unproven until T-022 runs.
  **Do not deploy multi-tenant until T-023 runs.**
- **No QA pass and no taste pass ever ran.** `qa.last_full_qa_cycle` and `qa.last_taste_cycle` are
  both `null` after 27 cycles; there was one live-look pass, at cycle 23. Nothing in this run
  judged whether the product is *good* — only whether it is correct. The Workflow tool is
  review-gated in headless sessions, which is why; the honest consequence is that the taste of this
  product has never been assessed by anything.
- **No accessibility audit.** Accessibility was applied per-screen as work landed, but T-024 and
  T-068 (6 known prep-screen findings) are unstarted, and no screen-reader or contrast tool was run.

**What only a human can finish.** Whether two of three recommended dinners are actually appetising
(DoD 2) is not a machine question, and with only 6 recipes in the catalog the answer is probably
"not yet" — the recommendation engine is doing real work over a set too small to show it. Author
recipes 7–30 (T-010, T-011) before judging the recommendations. Wire the "cooked" action (T-048) or
inventory never decrements in the running product. Then run T-022 and T-023 before anyone else's
data touches this.

The single most valuable thing here is the interruption model — per-step active/unattended/
continuous-attention time, safe stopping points, validated-only recovery instructions, and cooking
state that survives a kill. That is the differentiator, it is built, and it is proven. The catalog
is what is thin.

---

Repo tagged `v0.1-overnight`. Generated by /swarm WRAP_UP at 2026-08-19T12:00Z.
