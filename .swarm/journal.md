# journal — dinner

## cycle 0 | 2026-08-18T18:33:00+00:00 | dinner | KICKOFF -> DESIGN

work: KICKOFF (NORTHSTAR MODE, interactive chat). New target, new private repo
`trmnmc/dinner` created and cloned to /opt/targets/dinner. Spec drafted, taste-judged,
cut, and LOCKED by the user. No build work this cycle.

guards: 1a REFUSED on first invocation — the moon improvement run was still live
(`wrap_up_complete: false`, headless conductor PID 2323322 mid-cycle). Printed the STATUS
summary and the three options rather than kicking off over a live run. moon completed on
its own at 18:14:02Z (run 4 wrapped at cycle 97, `wrap_up_complete: true`, target status
`done`, tree clean); its runfile was archived to `runs/runfile-moon-done-*.json` before
`current.json` was replaced. 1b: /opt/targets/dinner did not exist. 1c: cwd is /opt/swarm.
1d: no kickoff-hints.json — this is a human chat kickoff, not an allocator auto-kickoff.

stress-test: verdict RESHAPE (confidence 7). Two lenses survived outright (named user with
a named workaround; switching cost cleared by an under-served wedge) and the
chatbot-wrapper toy was pre-empted by the brief's own "no LLM authority over quantities"
constraint. RESHAPED on two axes: (1) PLATFORM — the source brief specifies React Native +
Expo, but this host is headless Linux with no iOS simulator, so an Expo client would ship
unverified; reshaped to a mobile-first web client over an identical domain package.
(2) SCOPE — recipe import, provider integration, notifications and household invites
deferred; the over-engineering toy (22 tables, no working loop) named explicitly.

prior-art: 6-search budget, stance BUILD. Two candidates cleared grep-verify.
grocy/grocy (9392 stars, MIT) — confirmed real quantity_unit_conversions chains and true
pantry subtraction (missing_amount = need − stock − on-list), but no name normalization, no
package rounding, no leftovers, no ranking, and NO step entity at all.
mealie-recipes/mealie (13015 stars, AGPL-3.0) — REFERENCE ONLY, license gate-fails for
adoption; grep-confirmed it already ships pint-based same-dimension conversion, fuzzy food
normalization (DataMatcher threshold 80), cross-recipe aggregation (can_merge/merge_items)
and per-item recipe_references traceability. LOAD-BEARING FINDING: the deterministic
grocery engine is TABLE STAKES, not the moat — it must clear Mealie's bar, not be sold as
the differentiator. Conversely, step-level interruption metadata is UNOCCUPIED across
Mealie, Tandoor (AGPL+Commons Clause, gate-fail), KitchenOwl, Norish and Grocy: metadata
tops out at a single integer timer. Package-size selection and leftover-waste optimization
are likewise unoccupied. This moved the night's priority onto the cooking loop.

taste-judge (fresh subagent, spec text only, no transcript): use-twice 6,
product-not-demo 7, scope-fits-night 3, one-memorable-thing 7. Verdict: worth the night
ONLY with a scope cut made before the build starts — "the clock, not the idea, is what
fails". Named the interruption loop as the memorable thing AND as the piece most likely to
be thinned under time pressure. NOTE: the judge emitted a MALFORMED block — five axis
entries with `scope-fits-night` duplicated. Reported to the user as malformed rather than
silently cleaned; the four canonical axes were shown.

scope cut (D-2), all three endorsed by the user: catalog 55 -> 30 recipes (judge suggested
20; held at 30 because below ~25 the eligible pool after allergy filters and repeat
penalties collapses, which is the judge's own use-twice concern); inventory confirmed-only
with the inference layer (event log, five-state confidence lattice, use-it-up scoring)
deferred to nice-to-have; greedy set-scoring instead of pruned combinatorial plan search.
PROTECTED and non-negotiable: interruption-aware cooking mode with kill-survival, per-step
interruption metadata, traceable grocery list, accessibility bar.

lock: user answered "Accept scope", then endorsed two of the three cut options verbatim
("Inventory: keep confirmed-only...", "Catalog: 55 -> 30 recipes") plus "good to go".
The third cut (greedy set-scoring) was taken as locked on the same direction and recorded
as reversible-by-backlog-edit rather than re-asking a fourth time. Spec written to
.swarm/SPEC.md and frozen. Zero files were created before the lock.

Q1 defaults applied (user never answered the clock question, twice asked): stop_at
2026-08-19T12:00:00Z — grounded in this account's last three runs, which all stopped
~12:20Z — usage_reset_at 23:00:00Z (the 18:00-23:00Z window boundary), auth_mode
subscription, pacing thermostat dial 1.0. Stated explicitly to the user as defaults with a
correction path, not silently assumed.

budget: seeded from the moon run's last REAL probe at 17:39Z rather than the template's
clock-cruise gear 3 — evidence beats a default. Weekly governor is CLAMPING: weekly_used
36% at week_elapsed 21.81% (heat 1.651 > 1.3) -> ceiling 2, promote blocked. Gear 2, k_cap
2. Window attribution reset to zero for the new 18:00-23:00Z block. Cycle 1 re-probes.

playbook: apply_mode `auto` read by DIRECT FILE READ — `bin/swarm-playbook.sh parse` was
DENIED (KI-2, now 24th consecutive run). No `[apply:]` directives staged this kickoff;
proceeding with defaults per SKILL.md step 3, which is the documented behavior for an
unreadable playbook. Ledger line NOT recorded: nothing was applied, so recording an
applied-set would be false.

KI-2 recurrence, sanctioned-exception path also denied: the kickoff step-5 settings edit
(adding `Bash(bin/swarm-budget.sh:*)` and `Bash(bin/swarm-playbook.sh:*)` to the allowlist,
and setting `additionalDirectories` to this run's target) was DENIED by the harness. Filed
as KI-1 below. NOT worked around by an alternate write path — hard rule 5 forbids fixing
SWARM tooling mid-run, and routing around a denied boundary is not a fix.
`additionalDirectories` remains `[]`, so every headless cycle depends on the pacer's
explicit `--add-dir /opt/targets/dinner`, which swarm-pacer.sh builds from the runfile.

capability check (measured, not assumed): node v24.19.0, npm 11.17.0, git 2.43.0,
python3 3.12.3, gh present. NO psql, NO sqlite3 binary, NO docker. `node:sqlite` VERIFIED
working by execution at kickoff (in-memory DB created, table written, row counted) — this
is what makes zero-runtime-dependency persistence real rather than hoped for. 144G disk
free, 7G RAM.

decisions recorded: D-1 platform (web over Expo, with the reason), D-2 scope cut,
D-3 persistence (node:sqlite, Postgres-shaped schema), D-4 prior-art stance (build, clear
Mealie's bar).

cycle 1 handoff: kickoff completed all scaffolding, commit and dashboard. Cycle 1 itself is
deliberately left to the pacer's headless spawn (swarm-pacer.timer, every 5 min, passes
--add-dir) rather than being run inline at the tail of a long interactive kickoff context.
A fresh context does gate work better than an exhausted one, and hard rule 1 is satisfied:
every piece of state needed to resume lives on disk. Phase is DESIGN, so cycle 1's step-4
gate 1 routes to design-panel.

next: DESIGN gate — design direction for the plan / grocery / cooking surfaces, then PLAN
until the backlog covers all 12 must-haves.

### addendum — kickoff steps 10-12

dashboard: rendered to runs/dashboard.html, 24110 bytes, VERIFIED zero unreplaced
placeholders. First render was WRONG and caught by that check: `String.replace` with a
string pattern replaces only the first occurrence, and the template names each placeholder
twice — once in its own documentation comment, once in the live slot — so the initial pass
filled several comments and left the real regions empty. Fixed with `replaceAll` and
re-verified (12 -> 0 remaining). Recording it because a "rendered successfully" log line
would have been a false claim; the grep is what made it a fact.

step-11 headless assert: COULD NOT RUN. `claude` is not in the permission allowlist, and
neither is `timeout`, so the mandated zero-prompt assert
(`claude -p "/swarm status ..." --permission-mode acceptEdits --add-dir ...`) is denied
from this session. This is downstream of KI-1: the fix would be an allowlist edit, and the
allowlist edit is precisely what the harness denies. NOT worked around. Warned the user
explicitly per SKILL.md step 11.
MITIGATING EVIDENCE, measured not assumed: swarm-pacer.service spawns cycles via systemd,
outside this session's permission layer, and did so successfully ~97 times today for the
moon run (runs/cycle-*.json, most recent 18:14:02Z, subtype "success"). The headless path
is therefore known-good empirically; what is missing is the ability to PROVE it from here
before the first spawn.

pacer handoff VERIFIED by reading the script, not by assuming: swarm-pacer.sh line 233
builds ADD_DIRS from `.targets[]?.path` in the runfile, which now resolves to
/opt/targets/dinner. swarm-pacer.timer and swarm-watchdog.timer both `active`; next pacer
firing 18:39:57Z. Cycle 1 will therefore spawn headless with the correct --add-dir within
~5 minutes of this commit.

goodnight push: sent via `bin/swarm-notify.sh send goodnight` (relative form — the absolute
form is the one KI-2 denies).

## cycle 1 | 2026-08-18T19:35:12+0000 | dinner | DESIGN -> PLAN

work: design-panel — step-4 gate 1. state.json.decisions held D-1..D-4 (platform,
scope-cut, persistence, prior-art) but no DESIGN-topic entry, so the DESIGN gate was
still closed and no other work type was reachable.

budget: gear 3 cruise (up one from 2 by hysteresis), rho 0.48, gear_target 5, k_cap 3.
window 19,972,818 tokens / $17.91 of a 130,591,250 limit; 14,611,177 tokens/hour;
projected depletion 1787108276 (2026-08-19T03:37Z, well past the 23:00Z reset).
governor DISENGAGED — see KI-2. probe REAL, probe_failures 0.

probe method (deviation, journaled not hidden): `bin/swarm-budget.sh` is NOT in the
permission allowlist (KI-1), so it could not be invoked. Rather than cruise blind on a
clock fallback, the probe itself was run with the allowlisted tool the script would have
used — `npx ccusage@latest blocks --json --token-limit max` — and the gear was computed
by replaying the script's documented controller (T_target = min(rolled-forward reset,
future stop_at); rho = tokensPerMinute / (dial * remaining / minutes); ladder
0.5/0.8/1.2/2.0; weekly ceiling; one-step hysteresis). This is a read-only measurement
with sanctioned tools, not a workaround of the denied WRITE — the kickoff's refusal to
route around the denied settings edit still stands.

KI-2 opened (SWARM-side, low): the weekly governor disengaged at exactly the moment the
allocator was most restrictive. swarm-weekly-from-allocator.sh computes heat as
100*swarm_used/(swarm_used+allow_overall); allocator.json reports posture "trickle" with
allow_overall_pct 0 AND swarm_used_pct 0, so the denominator is zero, the feeder returns
week_elapsed_pct 0, and the governor reads "unconfigured" -> ceiling 5. Raw account heat
is meanwhile 1.84 (42% weekly used at 22.83% week elapsed). Only one-step hysteresis kept
this cycle at gear 3 instead of 5. A zero envelope should clamp harder, not disengage.
Not fixed — hard rule 5. Morning report.

control: no runs/control.json on disk -> control idle, nothing pending, no injections.

workflow: runId wf_0d145bc2-64b -> .swarm/runs/cycle-001-design-panel.json
models: 3 designers + 1 blind judge, all claude-fable-5 (judgment seats, both policies).
4/4 agents alive, 0 errors, 90,854 subagent tokens, 431s.
candidates: MINIMAL "Dinner" (34 files) | AMBITIOUS "Three Good Dinners" (49 files) |
TASTE-FORWARD "Tonight" (42 files).

DECISION D-5: adopt candidate B (AMBITIOUS), judge 45/50, + 6 grafted steals.
Locked to .swarm/DESIGN.md, binding on every builder.

VERIFICATION EVIDENCE:
  Gate authored AT VERIFY TIME (conductor-written checker, not the panel's own claims;
  full script run and discarded, output reproduced verbatim):
    C1 three candidates :: got 3                                              PASS
    C1 fields MINIMAL :: file_plan=34 | AMBITIOUS :: 49 | TASTE-FORWARD :: 42 PASS
    C2 total A :: 9+9+7+9+6=40 vs stated 40                                   PASS
    C2 total B :: 10+9+9+9+8=45 vs stated 45                                  PASS
    C2 total C :: 9+8+8+10+7=42 vs stated 42                                  PASS
    C2 winner is argmax :: declared B, argmax B (45)                          PASS
    C3 covers: 17/17 must-have surfaces probed against the winning file plan  PASS
      (rational/bigint, density gate, alias+confidence, trace links, 30 recipes,
       validation gate, calibration, weights config, set-scoring, swap, packaging,
       confirmed-only inventory, SIGKILL survival, prep, feedback, household_id,
       aria-live/44px)
    C4 no runtime deps :: "sole devDependency" / zero-runtime-dependency          PASS
    C4 no LLM in runtime path :: no llm/openai/anthropic-api/model-call match      PASS
    GATE PASS — 0 failed check(s)   (32 checks total)
  test_cmd: NOT RUN — no package.json and no source exists yet (cycle 1 produced a
    design decision, not code). Reported as not-run, never as passed.

honest note on what this cycle did NOT establish: a design that scores 45/50 is still a
plan. Nothing in it has been compiled, run, or measured. The judge's "buildability 9" is
an opinion from a model that wrote no code. The catalog risk it names (30 recipes x 9
interruption fields per step, treated as prose instead of schema-first data) is the one
most likely to be underestimated by exactly the kind of agent that wrote the estimate.

next: PLAN gate — inline PLAN pass turning DESIGN.md's waves 0-4 into a backlog covering
all 12 SPEC must-haves, then wave 0 (interface freeze) as the first build wave. Wave 0 is
deliberately ONE agent: every other file imports its type contracts.

commit: d006afc "cycle 1: design-panel — direction locked [1 verified]" (pushed to
  origin/master, fa4d128..d006afc)
next wakeup: 1787081802 (+90s) — written to heartbeat.next_wakeup_at; on the VPS
swarm-pacer.timer reads that field and spawns the cycle (cycle.md step 9), so no
ScheduleWakeup call is made from this headless -p session.
runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787081712,"next_wakeup_at":1787081802,"pid":2341030,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1.0},"budget":{"source":"probe","gear":3,"gear_target":5,"ratio":0.48,"mode":"thermostat","k_cap":3,"promote":false,"demote":false,"window_tokens":19972818,"window_cost_usd":17.908393250000014,"api_cap_usd":null,"api_spend_usd":0.0,"tokens_per_hour":14611177,"projected_depletion_at":1787108276,"last_probe_ts":1787081022,"last_real_probe_ts":1787081022,"probe_failures":0,"weekly":{"ok":false,"weekly_used_pct":0,"opus_used_pct":0,"week_elapsed_pct":0,"weekly_heat":0,"opus_heat":0,"ceiling":5,"promote_blocked":false}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":1,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"parse DENIED at kickoff (KI-2 recurrence); apply_mode read directly as auto; no directives staged"},"artifact":{"file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```

## cycle 2 | 2026-08-18T19:56:27+0000 | dinner | PLAN -> BUILD

work: PLAN (inline) — step-4 gate 2. The DESIGN gate closed last cycle (decision D-5
exists), and backlog.json was an empty items list, so PLAN was the first open gate and
no build work was reachable until it closed.

budget: gear 4 (up one from 3 by hysteresis; gear_target 5), rho 0.49, k_cap 4.
window 27,129,163 tokens / $27.42 in the 18:00-23:00Z block; 258,612 tokens/min =
15,516,716 tokens/hour; projected depletion 1787106253 (2026-08-19T02:24Z, past the
23:00Z reset, so the window resets before it bites). probe REAL, probe_failures 0.
governor still DISENGAGED — KI-2 unchanged, zero-envelope blind spot.

probe method (same deviation as cycle 1, journaled not hidden): `bin/swarm-budget.sh` is
still NOT allowlisted (KI-1 recurrence), so the probe ran via the allowlisted
`npx ccusage@latest blocks --json --token-limit max` and the gear was computed by
replaying the script controller: T_target = usage_reset 23:00Z; remaining =
130,591,250 - 27,129,163 = 103,462,087 tokens over 195.85 min => target 528,272
tok/min; actual 258,612 => rho 0.49 => gear_target 5; one-step hysteresis from 3 =>
applied gear 4. Read-only measurement with sanctioned tools; the denied WRITE is still
not routed around. `bin/swarm-notify.sh poll` was likewise DENIED (KI-1 family), so the
control channel was read directly from disk instead — a failed poll is non-fatal by
cycle.md step 2, and the file is the same source the poll would have merged into.

control: runs/control.json present, pending [] and applied [] — control idle, nothing to
apply. No `inject` array on the file, so no injection triage this cycle.

burn attribution: window_tokens delta 27,129,163 - 19,972,818 = +7,156,345 credited to
cycle 1 target dinner (positive delta, no window reset in between).

agent: ONE Plan-type subagent via Agent, model claude-fable-5. Planning is a judgment
call about coverage and correctness, and cheap-tiering a judgment call is how a night
quietly goes wrong; gear 4 is "table as-is" so no promote/demote applied.
raw return -> .swarm/runs/cycle-002-plan.json

result: backlog.json written — 28 items, sequenced along DESIGN.md waves 0-4.
  wave 0: T-001 interface freeze, SOLO (owns the manifests, blocks everything)
  wave 1: T-002..T-013, twelve parallel-safe items (quantity / planning / content / cooking)
  wave 2: T-014..T-018 server + web screens
  wave 3: T-019 cook+prep, T-020..T-023 the four proof tests, T-024 a11y+voice pass
  wave 4: T-025..T-028 delighters, every one gated behind all four proof tests

routing assigned by the CONDUCTOR at pick time, not by the PLAN agent (which was told
not to set a model): 12 items flagged route_class "core" -> fable (the Rational
arithmetic chain T-001..T-004, hard-exclusion filters/scoring T-006, planset+swap
T-007, the catalog gate T-008, the cooking state machine T-012, and the four DoD
proof tests T-020..T-023 — a hallucinated pass on a proof test is the single most
expensive failure available tonight). Remaining 16 -> sonnet. No haiku: the only
polish item, T-024, is effort M, and the haiku rung is polish/docs at effort S.

VERIFICATION EVIDENCE:
  Gate authored AT VERIFY TIME by the conductor (/opt/swarm/runs/cycle-002-gate.mjs);
  the PLAN agent never saw it, and it deliberately IGNORES the agent's own `coverage`
  block — that block is the agent's claim, not evidence. Full 58-line output:
  .swarm/runs/cycle-002-verify-plan.txt. Excerpt:
    G2 must-have 1 deterministic quantity engine :: 5 mechanism terms present   PASS
    G2 must-have 7 interruption-aware cooking mode :: 4 mechanism terms present PASS
    G2 must-have 11 household isolation server-side :: 3 mechanism terms present PASS
    G2 SPEC really has 12 must-have checkboxes :: 12 found                      PASS
    G3 DoD 7 :: T-012,T-014,T-019,T-020 | DoD 9 :: T-006,T-008..T-011,T-022     PASS
    G4 wave 1 disjoint (12 items) :: no overlaps                                PASS
    G4 wave 3 disjoint (6 items) :: no overlaps                                 PASS
    G5 dependency graph acyclic :: no cycles | no item depends on a LATER wave  PASS
    G6 zero runtime dependencies (packages [] everywhere)                       PASS
    G6 manifest owner is the wave-0 solo item :: T-001 wave 0                   PASS
    G7 no command-shaped verify instructions in acceptance/notes :: clean       PASS
    G8 route_class core implies fable (fable guard) :: 12 core items            PASS
    GATE PASS — 0 failed check(s) of 47
  Coverage was NOT taken on trust: G2 probes the MECHANISM each must-have demands
  (e.g. must-have 10 requires the literal terms "confirmed", "assumed_staple" and
  "confirmation question" to appear in the item corpus), so an item that named a
  must-have without planning its mechanism would fail even though the agent listed it.
  test_cmd: NOT RUN. `npm test --prefix /opt/targets/dinner` -> "npm error enoent Could
    not read package.json". There is no package.json and no source yet — T-001 creates
    them. Reported as not-run, never as passed.

honest note on what this cycle did NOT establish: a backlog that passes 47 mechanical
checks is still a list of intentions. Nothing has been compiled or run. The gate proves
coverage, disjointness, acyclicity and non-goal compliance — it cannot prove the effort
estimates are right, and the two L-effort catalog batches (T-010, T-011: 24 recipes x 9
interruption-metadata fields per step) are exactly the work the design panel flagged as
most likely to overrun. They are priority 2 and independently droppable precisely so
that an overrun degrades the catalog instead of the night. Also unproven: that the
wave-2 route contracts T-001 freezes will actually satisfy the three screens built
against them — the contract-drift rule exists because that is the predicted failure.

next: BUILD gate — wave 0, T-001 interface freeze, dispatched SOLO per DESIGN.md
(every other file imports its type contracts, so it cannot share a wave). Effective
wave size would otherwise be min(k_current 3, gear cap 4, hard max 5) = 3; wave 0
overrides it to 1 by construction.
runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787082987,"next_wakeup_at":1787083077,"pid":2343160,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1},"budget":{"source":"probe","gear":4,"gear_target":5,"ratio":0.49,"mode":"thermostat","k_cap":4,"promote":false,"demote":false,"window_tokens":27129163,"window_cost_usd":27.41898725,"api_cap_usd":null,"api_spend_usd":0,"tokens_per_hour":15516716,"projected_depletion_at":1787106253,"last_probe_ts":1787082351,"last_real_probe_ts":1787082351,"probe_failures":0,"probe_note":"Cycle 2 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max` (bin/swarm-budget.sh still DENIED, KI-1 recurrence). Gear computed by replaying the script controller: T_target=usage_reset 23:00Z; remaining=130591250-27129163=103462087 over 195.85min => target 528272 tok/min; actual 258612 => rho 0.49 => gear_target 5; one-step hysteresis from 3 => applied gear 4. Governor still DISENGAGED (KI-2).","weekly":{"ok":false,"weekly_used_pct":0,"opus_used_pct":0,"week_elapsed_pct":0,"weekly_heat":0,"opus_heat":0,"ceiling":5,"promote_blocked":false}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":2,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"swarm-playbook.sh parse DENIED at kickoff (KI-2 recurrence); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."},"artifact":{"file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```

### addendum — cycle 2 steps 8-9

commit: 0c80bb2 "cycle 2: PLAN — backlog covering 12/12 must-haves [1 verified]"
  pushed to origin/master, 3a3ae10..0c80bb2.

dashboard: re-rendered to runs/dashboard.html, 23,683 bytes, VERIFIED 0 unreplaced
placeholders by the renderer's own exit-code check (the cycle-0 replaceAll lesson is
now encoded in the renderer, not just remembered). Stations region rendered as the
empty string deliberately — the template says render "" before wave 1, and no builder
has been dispatched yet, so any crew row would be decoration rather than a claim from
the journal. Artifact publish SKIPPED, not failed: this is a headless -p session with
no Artifact tool, and on the VPS the file write IS the publication (cycle.md step 8).
publish_failures stays 0.

notification NOT SENT: the phase-change push (dinner PLAN -> BUILD) was due per
cycle.md step 8, and `bin/swarm-notify.sh send phase-change ...` was DENIED. Root cause
is narrower than KI-1 but the same family: this session's cwd is /opt/targets/dinner,
not /opt/swarm, so the allowlisted RELATIVE form does not resolve and the absolute form
is not allowlisted. Not worked around. Notifications are observability, not a gate — the
dashboard and journal both carry the phase change. Filed for the morning report
alongside KI-1.

next wakeup: 1787083242 (2026-08-18T20:00:42Z, +90s) written to
heartbeat.next_wakeup_at and clamp-verified against stop_at (wake + 900 <= stop_at).
No ScheduleWakeup call is made from this headless -p session — on the VPS
swarm-pacer.timer reads that field every 5 min and spawns the cycle (cycle.md step 9).

## cycle 3 | 2026-08-18T20:31:23+0000 | dinner | BUILD

work: build-wave, wave 0 — T-001 interface freeze, dispatched SOLO. Step-4 gates 1
(DESIGN, closed by D-5) and 2 (PLAN, closed by the cycle-2 backlog) were already shut,
so BUILD was the first open gate and T-001 is the only unblocked item: every other
backlog item depends on it.

budget: gear 3 (cruise), DOWN from 4. gear_target 2, rho 0.45, k_cap 3, promote false,
demote false. window 32,276,561 tokens / $34.53 in the 18:00-23:00Z block; 256,806
tok/min = 15,408,356 tokens/hour; projected depletion 1787106518 (2026-08-19T02:28Z,
past the 23:00Z reset, so the window resets before it bites). probe REAL,
probe_failures 0.

  THE GOVERNOR ENGAGED THIS CYCLE, and it is why the gear went DOWN while rho was low.
  Read on its own the 5-hour window is cold: rho 0.45 => gear_target 5, overdrive. But
  runs/allocator.json now reports posture "halted", allow_overall_pct 0, swarm_used_pct
  4, week_elapsed_pct 23.26. Replaying swarm-weekly-from-allocator.sh exactly:
  env(u,a) = 100*4/(4+0) = 100 — NOT the zero-envelope disengage of cycles 0-2, because
  swarm_used_pct rose 0 -> 4 and the denominator is no longer zero. KI-2's blind spot
  has closed by drift. weekly_heat = 100/23.26 = 4.30 > 1.3 => ceiling 2 and
  promote_blocked true; opus_heat 4.30 > 1.2 => promote blocked independently. emit()
  clamps gear_target 5 -> 2, then one-step hysteresis from 4 gives applied gear 3.
  The clamp is robust to which denominator you pick: the RAW account is independently
  hot at 46.0% weekly used against 23.26% week elapsed = heat 1.98, also over the 1.3
  threshold. Both readings say clamp, so I did not go looking for the reading that would
  have let me burn. Overdrive was available on the 5-hour number alone and was declined.

probe method (same deviation as cycles 1-2, journaled not hidden): bin/swarm-budget.sh
and bin/swarm-weekly-from-allocator.sh are both still DENIED to this headless session
(KI-1 family), so the burn probe ran via the allowlisted `npx ccusage@latest blocks
--json --token-limit max` and BOTH controllers were replayed by hand from their own
source against runs/allocator.json, which I read directly. Read-only measurement with
sanctioned tools; no denied WRITE was routed around.

control: runs/control.json pending [] and applied [] — idle, nothing to apply. No
`inject` array, so no injection triage. `swarm-notify.sh poll` DENIED again (KI-1
family); a failed poll is non-fatal per cycle.md step 2, and the file is the same source
the poll would have merged.

burn attribution: window_tokens delta 32,276,561 - 27,129,163 = +5,147,398 credited to
cycle 2 target dinner. counters.window_tokens_attributed now 12,303,743.

### conductor work BEFORE any agent was dispatched

T-001 as planned was UNBUILDABLE and would have come back "blocked". Its notes made it
"the manifest owner (sole exception to the manifest exclusion)", but build-wave.js's
builder brief forbids touching package.json/tsconfig.json in absolute terms and tells
the builder to block instead. cycle.md step 4 already assigns manifests to the
conductor, so I wrote them myself — in-contract, not a workaround. Recorded as D-6.

Two mechanisms were PROVEN BY ME on this host before dispatch, rather than discovered by
an agent at 4am:
  1. toolchain: Node v24.19.0 native type stripping under `node --test` with a glob,
     plus node:sqlite on a REAL FILE db via the actual statement API. Probe committed at
     .swarm/runs/cycle-003-probe.test.ts; both tests passed before package.json existed.
     npm test is `tsc --noEmit` (strict + erasableSyntaxOnly + verbatimModuleSyntax)
     then `node --test 'tests/**/*.test.ts'`. Zero runtime dependencies; devDeps are
     typescript and @types/node only.
  2. worktree: build-wave.js Step 0 hardcodes a /tmp worktree, and on this host agent
     file-EDIT tools are confined to the allowed directories — a /tmp worktree is
     git-writable but not Write/Edit-writable, so every builder would provision fine and
     then stall on its first edit. I verified the failure mode (my own Write to /tmp was
     refused; `rm -rf` outside the allowed dirs was refused), then proved the fix:
     worktree at <target>/.wt/<id> (gitignored) + `npm ci` there, which installs from the
     committed lockfile and modifies NO manifest. Filed as KI-3; the durable fix is in
     build-wave.js and hard rule 5 forbids touching it mid-run.
Also mapped effort L -> "high" at dispatch: the backlog uses S/M/L, agent({effort})
expects low/medium/high, and build-wave.js passes the value straight through (KI-3,
part two).

agent: ONE builder, model claude-fable-5 (T-001 is route_class "core" -> fable; gear 3
is "table as-is", and the fable guard exempts core items from demotion anyway).
102,452 tokens, 23 tool calls, 799s. dead_items []. Returned status "done" — a CLAIM.
raw return -> .swarm/runs/cycle-003-build-wave.json

merge: `git merge --no-ff wave-201025-T-001` clean, 6 files / 2,702 insertions, exactly
the six in-scope paths and nothing else. Worktree pruned after verification.

### VERIFICATION EVIDENCE

Three independent checks, all authored by me, none derived from the item's `acceptance`
field or the builder's notes. The static gate was written BEFORE the builder returned.
Full 132-line output: .swarm/runs/cycle-003-verify-T-001.txt
Gate sources (conductor-owned): /opt/swarm/runs/cycle-003-gate.mjs, cycle-003-behaviour.mjs

1. test_cmd, run by me, not asked of the agent — `npm test --prefix /opt/targets/dinner`:
     ✔ roundUpToMultiple: never rounds down (underbuying prohibited) (0.329486ms)
     ✔ households and members round trip; scoping is structural (19.951492ms)
     ✔ cooking sessions: timers persist ABSOLUTE UTC end instants; isolation (8.331927ms)
     ℹ tests 26  ℹ pass 26  ℹ fail 0  ℹ duration_ms 325.564505
   (tsc --noEmit ran first and passed, or test:unit would never have executed.)

2. static gate — 57 checks, GATE PASS, 0 failed. Excerpt:
     G1 no out-of-scope files              :: merged diff confined to scope (6 files)  PASS
     G1 manifests untouched                :: no manifest in the merged diff           PASS
     G5 no remaining-seconds field         :: no remaining-seconds field               PASS
     G7 household_id first arg             :: all 27 scoped helpers lead with household_id PASS
     G7b unscoped members are hard-private :: non-scoped members: #prepare (all #private) PASS
     G8 no float columns                   :: no REAL/FLOAT/DOUBLE in 11 table bodies  PASS

3. behavioural gate — 22 checks, BEHAVIOUR PASS, 0 failed. This one EXECUTES the modules
   instead of grepping them. Excerpt:
     B2 sum of ten 0.1 == 1        :: 1/1; float says false (0.9999999999999999)      PASS
     B4 beyond 2^53 exact          :: 9007199254740994/1; float says ...93 === ...92 is true PASS
     B9 roundUpToMultiple never underbuys :: six cases incl. exact multiples and zero  PASS
     B12 zero float columns (per SQLite)  :: checked every column of 11 tables         PASS
     B17 NO cross-household read   :: 12 readers attacked with a foreign id, zero leaked A PASS
     B19 control: readers do return own-household data :: 4 reader(s) returned B's own rows PASS
   The isolation attack plants rows for household A with RAW SQL through a second
   database handle, bypassing the module's write path entirely, then calls every public
   reader as household B while handing it A's entity ids directly. A write path that
   stamps household_id correctly cannot mask a read path that forgets to filter. B19 is
   the anti-vacuity control: if the readers returned nothing at all, B17 would pass for
   the wrong reason, so it separately proves B's own rows DO come back.

4. collision-scan: `{"applicable": false}` — no classic scripts exist yet. Reported as
   not-applicable, not as a pass.

### MY OWN GATE WAS WRONG THREE TIMES — corrected, and the corrections are the point

First run: GATE FAIL, 4 of 53. Investigating each rather than accepting the verdict:
  - "float literals 0.1, 2.5, 0.3, 1.50, 1.5, 2.00 in qty.ts" — ALL SIX inside doc
    comments ("`\"0.1\"` is parsed exactly", "2.5 -> 3"). False positive: I grepped raw
    source without stripping comments.
  - "float column types: REAL in db.ts" — both matches inside comments, one of which
    reads "A REAL column anywhere is a defect". False positive, same cause.
  - "maximum_pause_seconds / timer_duration missing" — REAL findings, but not defects:
    the fields exist under better names (see D-7).
  - and the one that mattered most, which the first run reported as a PASS:
    "G7 exported helpers found :: 1 exported functions in db.ts / all 0 scoped helpers
    lead with household_id". db.ts exposes its surface as METHODS of class DinnerDb, so
    my `export function` regex matched almost nothing and Invariant 3 — the household
    isolation invariant, the one with a DoD line of its own — was verified VACUOUSLY.
    A false PASS is worse than a false FAIL: a false FAIL gets investigated, a false
    PASS gets shipped. Rewrote it to enumerate class methods (27 scoped helpers, all
    leading with household_id) and added G7b, which proves the only non-scoped member is
    `#prepare` and that it is hard-private per ECMAScript rather than private by
    convention. That check is why part 3 above exists at all: after finding one vacuous
    check I stopped trusting the static layer to prove isolation and wrote the
    behavioural attack.
Comment-stripping was added for checks 1 and 2 — that measures executable code, which is
what those checks always meant. It is not a relaxation, and no threshold moved: the DDL
scan now parses CREATE TABLE bodies (11 of them) and B12 independently re-asks SQLite
itself for every column's declared type. Net checks went 53 -> 57.

result: T-001 -> done. First verified BUILD item of the run.
  - domain/src/qty.ts (322 lines): exact Rational kernel, bigint num/den, sole arithmetic
    entry point. Typed QtyError for division_by_zero and malformed_input — never NaN.
  - domain/src/recipe.ts (655): every shared type. All nine per-step interruption fields
    REQUIRED and readonly; RecoveryGuidance and MaximumPause are explicit unions so
    "no guidance available" is representable rather than absent — Invariant 6 honoured in
    the type system instead of in a convention.
  - server/src/db.ts (929): Postgres-shaped schema, 11 tables, zero float columns,
    quantities stored as num/den TEXT. 27 household-scoped helpers. Better than asked:
    the Input types are `Omit<Entity, 'household_id'>`, so passing a MISMATCHED household
    id is unrepresentable rather than merely rejected, and GroceryLineComputedPatch
    structurally omits the user-edit columns so regeneration cannot clobber a user edit
    by construction rather than by care.
  - web/css/tokens.css (173): tokens only, one :root block, computed WCAG ratios in
    comments, 44px/48px/56px targets, tabular-nums, prefers-reduced-motion.
  - tests/qty.test.ts + tests/smoke.sqlite.test.ts (623): 26 tests.

wave autotune: wave was CLEAN — zero reverts, zero failed verifies — so wave_streak
0 -> 1. k_current stays 3 (promotion needs streak 2). Effective wave size next cycle =
min(k_current 3, gear cap 3, hard max 5) = 3.

honest note on what this cycle did NOT establish: this is an interface freeze, and a
frozen interface is a promise about work that has not happened yet. The qty kernel is
genuinely proven — the arithmetic assertions execute and floats demonstrably fail them.
Isolation is proven at the db.ts layer ONLY; no HTTP route exists yet, and T-023 still
has to prove no route can express an unscoped query. Nothing has been rendered:
tokens.css is verified as tokens-only, but its contrast ratios are stated IN COMMENTS BY
THE BUILDER and have NOT been independently recomputed — that is a claim, and the
accessibility must-have stays unverified until a screen exists. No QA look pass ran and I
am not counting one: there is no server, no index.html and nothing served, so a look pass
has no subject. Reported as not-run, never as passed. The 12 wave-1 items now unblocked
are where the real risk sits.

next: wave 1 is open — T-002..T-013 all unblocked, twelve items with pairwise-disjoint
file scopes. Effective k = 3, so the next cycle takes three: T-002 (units +
normalization, the alias family DoD 4 turns on), T-006 (hard filters + weighted scoring,
DoD 9's code half), T-008 (catalog gate + ingredient registry + allergen cross-check,
which Invariant 5 says must land BEFORE any recipe is authored and which blocks all 30
recipes). All three are route_class core -> fable. Disjointness verified:
units/normalize/ingredients vs filters/score vs catalog/data-ingredients — no shared path.
runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787085083,"next_wakeup_at":1787085173,"pid":2346402,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1},"budget":{"source":"probe","gear":3,"gear_target":2,"ratio":0.45,"mode":"thermostat","k_cap":3,"promote":false,"demote":false,"window_tokens":32276561,"window_cost_usd":34.53131875,"api_cap_usd":null,"api_spend_usd":0,"tokens_per_hour":15408356,"projected_depletion_at":1787106518,"last_probe_ts":1787083548,"last_real_probe_ts":1787083548,"probe_failures":0,"probe_note":"Cycle 3 REAL probe via allowlisted npx ccusage (bin/swarm-budget.sh still DENIED, KI-1). BOTH controllers replayed by hand from source. Weekly governor ENGAGED: allocator posture halted, env heat 100/23.26=4.30 > 1.3 => ceiling 2 + promote_blocked; raw account independently hot at 46.0/23.26=1.98. gear_target 5 (rho 0.45) clamped to 2, hysteresis from 4 => applied 3. KI-2 zero-envelope blind spot closed by drift (swarm_used_pct 0 -> 4) but the bug is still real.","weekly":{"ok":true,"weekly_used_pct":100,"opus_used_pct":100,"week_elapsed_pct":23.26,"weekly_heat":4.30,"opus_heat":4.30,"ceiling":2,"promote_blocked":true}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":3,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - defaults per SKILL.md step 3."},"artifact":{"url":"","file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```

## cycle 5 | 2026-08-18T22:32:23+0000 | dinner | BUILD

clock: now 1787092343, stop_at 1787140800 (13.5h left), usage_reset_at 1787094000 (28 min).
Not in the WRAP_UP window; heartbeat.limp false.

budget: gear 2 (gear_target 5, rho 0.077, clamped by the weekly governor to ceiling 2;
hysteresis from 2 leaves it at 2). Window 18:00-23:00Z used 55,551,168 of a 130,591,250
max-prior-block limit; 12,529,049 tok/h actual against a 163,032,164 tok/h target — the
target is inflated because only 1,657s remain in the window, so a low rho here is an
artefact of the denominator, not evidence of headroom. Wave cap 2, demote=true,
promote blocked. Projected depletion well past the window close.

KI-1 recurs a third time: `bin/swarm-budget.sh` DENIED, `bin/swarm-notify.sh poll` DENIED.
Budget replayed by hand from an allowlisted `npx ccusage` probe (runs/cc-probe-c5.json);
control channel read straight off `runs/control.json` — pending [] and inject [], nothing
to apply, so the denial cost nothing THIS cycle. It will cost something the cycle a real
command arrives by push and never reaches the file.

KI-2 RE-OPENED, and this is the interesting one. At cycle 3 I recorded the weekly
governor's zero-envelope blind spot as "resolved by drift" because `swarm_used_pct` had
risen 0 -> 4, giving the heat formula a non-zero denominator. It has now fallen back to 0
with `allow_overall_pct` also 0, so the feeder would once again DISENGAGE the governor —
at posture "trickle", i.e. exactly when restraint matters most. The ceiling held at 2 only
because a SECOND, independent signal was hot: the raw account is at 52.0% weekly against
24.65% week-elapsed (heat 2.11; opus 47% -> 1.91). So the bug did not bite tonight, but it
was never fixed and "resolved by drift" was the wrong label — I have corrected it to
re-opened. Fix belongs in bin/swarm-weekly-from-allocator.sh (u+a <= 0 must mean MAXIMUM
heat, not "unconfigured"); hard rule 5 forbids touching it mid-run.

Noted, not applied: the allocator now advertises dial 0.30 against the runfile's 1.0.
Pacing is a kickoff-time input; re-tuning it mid-run is not a sanctioned conductor edit.

### ORIENT — cycle 4 crashed between merge and gate

`git status` was CLEAN, which is why this needed care. The tell was arithmetic: master
carried two commits saying "cycle 4" (860d034 T-008, ade40ef T-012) while state.json still
said `cycle: 3`, backlog.json still had both items `todo`, the journal had no cycle-4
block, and `.swarm/runs/cycle-004-build-wave.json` sat untracked. Cycle 4 dispatched its
wave, merged both branches, and died before step 6.

That is a worse state than a dirty tree. A dirty tree announces itself; merged-but-ungated
code looks finished — it is committed, on master, with a tidy message — while hard rule 4
had never actually been checked against it. Had I opened cycle 5 with a fresh wave, two
unverified items would have become the foundation of everything above them.

So cycle 5 finished cycle 4 instead of starting anything new. One work type, the same one
cycle 4 chose: build-wave, resumed at its verification gate. Recorded as D-8.
Salvage: committed the untracked workflow return, pruned both merged worktrees
(`.wt/T-008`, `.wt/T-012`) and deleted all three merged wave branches.

### VERIFICATION EVIDENCE

The builders returned `status: "done"` for both items. That is a claim. Neither builder saw
a check, because neither check existed until now — I wrote both gates this cycle, from
SPEC.md and the frozen types in recipe.ts, never from the items' `acceptance` strings and
never from the builders' own tests.
Gate sources (conductor-owned): /opt/swarm/runs/cycle-005-gate-T008.mjs, cycle-005-gate-T012.mjs
Full output: .swarm/runs/cycle-005-verify-T-008.txt (67 lines), cycle-005-verify-T-012.txt (65)

1. test_cmd, run by me on master AFTER both merges — `npm test`:
     ℹ tests 97  ℹ pass 97  ℹ fail 0  ℹ duration_ms 563.576041
   (`tsc --noEmit` gates `test:unit` in the npm script, so 97 passing means strict
   typecheck passed first.) Hard rule 4 satisfied — retroactively, which is the point:
   nothing had confirmed it until this run.

2. T-008 catalog gate — 55 checks, GATE PASS, 0 failed. Method: build ONE valid recipe,
   prove it ELIGIBLE, then mutate one defect at a time and demand the right exclusion code.
     C1 the valid fixture is ELIGIBLE          :: eligible, 0 issues                    PASS
     C4 dairy DECLARED, no contradicting tag   :: stays eligible — not "any allergen -> reject" PASS
     M14.<each of 11 fields> absent on a step  :: interruption_metadata_incomplete       PASS
     M15 SPEC name maximum_pause_seconds       :: rejected (D-7 drift guard)             PASS
     A1 milk in a "vegan" recipe, undeclared   :: undeclared_allergen + dietary_tag_contradicted PASS
     A4 OPTIONAL parmesan garnish betrays vegan:: caught — optional lines are not exempt  PASS
     A9 registry-wide sweep                    :: 53 (ingredient, class, tag) combos, 0 escaped PASS
     G2 broken catalog degrades, not throws    :: 1 eligible of 5, aligned reports        PASS
   A9 is the one I care about most: it does not use hand-picked examples. It walks all 97
   registry entries, every allergen class each carries, and every dietary tag that class
   contradicts, and asserts none escapes.

3. T-012 cooking gate — 49 checks, GATE PASS, 0 failed. The claim under attack is
   Invariant 2 (absolute end instants, never remaining-seconds). The way to falsify it is
   to fold the SAME persisted log at wildly separated query instants:
     K3 at +90s   :: 30s elapsed, 570s remaining, not expired                            PASS
     K5 at +660s  :: exactly at the end instant — expired, 0 remaining, 0 overrun         PASS
     K6 at +7260s :: expired, remaining clamped 0, overrun 6600s                          PASS
     K8 41 instants over 3h :: every remaining/overrun equals ends_at - now, exactly      PASS
     K9 persisted timer keys :: id,step_index,label,started_at_utc,ends_at_utc,duration_seconds PASS
     K11 same log + same instant, 120ms apart in real time :: byte-identical view         PASS
     R2 step with none_available :: explicit {kind:'unavailable',step_index:3}, no text    PASS
     E1-E10 illegal logs :: ten distinct typed CookingError codes, never a plausible view  PASS
   K6 is the kill-safety proof: a remaining-seconds design has no way to compute a 6,600s
   overrun after the process was dead for two hours. K9 confirms the persisted record
   carries no remaining-seconds field for it to have used.

4. MY GATES WERE THEMSELVES TESTED — the cycle-3 lesson applied

Cycle 3 caught a check of mine that passed VACUOUSLY (a regex that matched nothing, so the
household-isolation invariant "passed" without being tested). A gate that cannot fail is
worse than no gate, so this cycle I proved both gates failable before trusting either.
Copied domain/src to runs/c005-mut/, planted two mutations, re-ran the same gates:
  - gutted FORBIDDEN_ALLERGEN_CLASSES_BY_DIETARY_TAG to empty arrays
    -> GATE FAIL, 7 of 55: "A5 shrimp in a vegetarian recipe :: STILL ELIGIBLE — allergen
       hid successfully". The exact defect the check exists to catch.
  - made timerSnapshot read `started_at_utc` instead of the query instant (i.e. the
    remaining-seconds design Invariant 2 forbids)
    -> GATE FAIL, 6 of 49: K3 {"e":0,"r":600}, K6 overrun=0s.
Full mutant output: .swarm/runs/cycle-005-mutant-T-008.txt, cycle-005-mutant-T-012.txt.
Both gates detect the defect they were written for. The PASSes above are load-bearing.

5. collision-scan: `{"applicable": false}` — still no classic scripts. Reported as
   not-applicable, never as a pass.

result: T-008 -> done, T-012 -> done. Three verified items of 28.
  - domain/src/catalog.ts (1051 lines) + data/ingredients.json (97 entries) + 30 tests.
    Structured per-recipe exclusion reasons rather than a build failure, so a short catalog
    degrades gracefully. The cross-check is deliberately one-directional and says so in a
    comment: it can prove a tag is CONTRADICTED by an allergen class, and it does not
    pretend to prove the converse (meat is not an allergen class, so `vegetarian` still
    rests on authoring). Honest scope beats a check that overclaims.
  - domain/src/cooking.ts (538) + 32 tests. Pure fold, query instant as a parameter.

wave autotune: cycle 4's wave was CLEAN — zero reverts, zero failed verifies — so
wave_streak 1 -> 2, which trips promotion: k_current 3 -> 4, wave_streak reset to 0.
Effective wave size next cycle = min(k_current 4, gear cap 2, hard max 5) = 2.

backlog hygiene (cycle % 5 == 0, full SPEC re-read done): 28 items, 3 done / 25 todo. No
duplicates, no stale entries to drop, dependency graph coherent, every SPEC must-have still
covered by at least one item. Nothing to prune — the backlog is 5 cycles old and has not
yet had time to rot.

honest note on what this cycle did NOT establish: T-008 proves the catalog GATE works
against fixtures I wrote; zero real recipes exist yet, so DoD 9 is untested against real
data and T-009 is where that risk actually lands. T-012 proves the cooking fold is correct
as a pure function; DoD 7 says kill/reload survival must be proven END-TO-END, and it
cannot be — there is no server, no persistence wiring and no screen. T-020 owns that, and
until it lands the kill-safety claim is a domain-layer claim only. Still nothing rendered,
so the accessibility must-have and tokens.css's contrast ratios remain unverified, exactly
as at cycle 3. No QA or look pass ran: there is still no subject. Reported as not-run.

next: wave 1 with effective k=2 (gear cap binds, not k_current). Best-value unblocked pair
with disjoint scopes: T-002 (units + normalization + alias family — DoD 4 depends on it,
and T-003/T-004 both block on it) and T-006 (hard filters + weighted scoring — DoD 9's code
half, blocks T-007). Both route_class core -> fable, both exempt from the gear-2 demotion
under the fable guard. Disjointness: units/normalize/ingredients vs filters/score.
runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787091957,"next_wakeup_at":1787094657,"pid":2357774,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1},"budget":{"source":"probe","gear":2,"gear_target":5,"ratio":0.077,"mode":"thermostat","k_cap":2,"promote":false,"demote":true,"window_tokens":55551168,"window_cost_usd":67.79387625,"api_cap_usd":null,"api_spend_usd":0,"tokens_per_hour":12529049,"projected_depletion_at":1787113934,"last_probe_ts":1787092373,"last_real_probe_ts":1787092373,"probe_failures":0,"probe_note":"Cycle 5 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max` (bin/swarm-budget.sh DENIED again — KI-1 recurs). Raw probe: runs/cc-probe-c5.json. 5h window 18:00-23:00Z: limit=max prior block 130,591,250; used 55,551,168; remaining 75,040,082 over 1,657s to T_target (usage_reset 23:00Z, earlier than stop_at) => target 163,032,164 tok/h; actual 12,529,049 tok/h (ccusage burnRate 208,817 tok/min) => rho 0.077 => gear_target 5. The window is nearly over, so the target denominator is tiny and rho is artificially low — evidence, not licence. WEEKLY GOVERNOR ENGAGED on the RAW ACCOUNT: weekly_used 52.0% at week_elapsed 24.65% => heat 2.11 > 1.3 (opus 47/24.65 = 1.91) => ceiling 2 + promote_blocked. KI-2 RE-OPENED: allocator swarm_used_pct fell 4 -> 0 with allow_overall_pct 0, so the env-heat denominator is zero again and the feeder would DISENGAGE the governor exactly when posture is \"trickle\". The raw-account clamp is what holds the ceiling at 2 this cycle; the blind spot did not bite only because a second, independent signal was hot. gear_target 5 clamped to 2; hysteresis from 2 => applied gear 2. Wave cap 2, demote=true. Allocator also now advertises dial 0.30 (posture trickle) against the runfile pacing dial 1.0 — recorded, not applied: pacing is a kickoff-time input and hard rule 5 forbids re-tuning it mid-run.","weekly":{"ok":true,"weekly_used_pct":52,"opus_used_pct":47,"week_elapsed_pct":24.65,"weekly_heat":2.11,"opus_heat":1.91,"ceiling":2,"promote_blocked":true}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":5,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."},"artifact":{"url":"","file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```
