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


## cycle 6 | 2026-08-18T23:40:49+0000 | dinner | BUILD

work: RESUMED the killed cycle-6 build wave (T-002 units+normalization, T-006 filters+scoring)
gear: 2 (rho 1.23, weekly governor clamp 2) | wave: k=2, both route_class core -> fable
outcome: both items VERIFIED done. 32/32 + 18/18 gate checks, 152/152 suite, 14/14 mutants caught.

### ORIENT — cycle 6 was guillotined mid-wave, and left a map

`git status` clean; master carried `f793e77 cycle 6: in-flight marker`. state.json said
cycle 5. Two wave branches existed and neither was merged. The pacer log names the killer
exactly:

    2026-08-18T22:40:48+0000 decision=spawned auth=subscription
    Background tasks still running after 600s; terminating.
    2026-08-18T22:55:01+0000 decision=cycle-done cost=4.2696195

The harness kills a headless cycle's background tasks at 600s. build-wave's own duration
budget is 2700s. Any wave running past ten minutes is cut off mid-flight — which is also
what happened to cycle 4. Filed as KI-4 (high): the tool's two timeouts disagree with each
other by a factor of 4.5, and the wave always loses. Not fixable mid-run (hard rule 5).

The difference from cycle 4 is that this time the dying cycle left a map. Its in-flight
marker — written at dispatch, before any merge, as D-8 recommended — named the branches,
the worktrees, the runId and the recovery procedure. That is why this session spent its
time verifying rather than diagnosing. The mechanism D-8 asked for paid for itself on its
first real use.

Recovery taken (D-10): this session RESUMED cycle 6 instead of opening cycle 7.
  - `wave-006-T-002` was complete and committed by its builder -> merged, npm test green.
  - `wave-006-T-006` was EMPTY at the branch tip, but its worktree held three uncommitted
    files (filters.ts 434, score.ts 416, filters.test.ts 520). The builder had been killed
    between writing them and committing. The work is coherent and self-contained — it
    imports only frozen modules (recipe.ts, qty.ts, catalog.ts) — so it was salvage-
    committed and merged rather than discarded.
  - What the salvage cannot invent: `tests/score.test.ts` was never written. score.ts
    landed with ZERO committed coverage. That is filed as T-029 (priority 1), not papered
    over. My gate below verifies score.ts behaviourally, but the gate lives in SWARM, not
    in the repo, and `npm test` does not run it.
Also recorded: D-9, the scope cut of `domain/src/ingredients.ts` that cycle 6 ruled at
dispatch and died before it could journal.

control channel: polled, 0 pending, 0 injections. allocator posture trickle, dial 0.30
advertised against the runfile's 1.0 — recorded, not applied (pacing is a kickoff input).

### VERIFICATION EVIDENCE

Both builders' claims were unavailable — one never returned at all. That changes nothing
about method: I authored both gates this cycle, from SPEC.md and the frozen types, after
the code was already on disk. Neither builder saw a check. Both gates implement their own
bigint rational arithmetic rather than importing qty.ts, so the module under test is never
used to check itself.
Gate sources (conductor-owned): /opt/swarm/runs/cycle-006-gate-T002.mjs, cycle-006-gate-T006.mjs
Full output: .swarm/runs/cycle-006-verify-T-002.txt, cycle-006-verify-T-006.txt
Mutants: .swarm/runs/cycle-006-mutant-T-002.txt, cycle-006-mutant-T-006.txt

1. test_cmd, run by me on master after EACH merge — `npm test`:
     after T-002:  tests 132  pass 132  fail 0
     after T-006:  tests 152  pass 152  fail 0
   (`tsc --noEmit` gates test:unit in the npm script, so 152 passing means strict
   typecheck passed first.) Hard rule 4 satisfied at both merge points.

2. T-002 gate — 32 checks, GATE PASS, 0 failed:
     U1a-g  kg=1000g, lb=16oz, l=1000ml, tbsp=3tsp, cup=16tbsp, fl_oz=2tbsp  PASS
     U4a    1/3 cup -> ml is EXACTLY 157725491/2000000, no float drift        PASS
     U4b    round-trip 1/3 cup -> ml -> cup returns EXACTLY 1/3               PASS
     U6     24 cross-dimension combinations, 0 guesses, exact `missing` sets  PASS
     U8     "to taste" survives 12 convert paths as itself, never a number    PASS
     U9a    range keeps min AND max, never collapses to the midpoint          PASS
     N1     the four SPEC-named garlic variants -> ONE id, confidences 19/20, 4/5, 4/5, 4/5  PASS
     N3     registry sweep: 234 id+alias probes over 97 entries, 0 misroutes  PASS
     N4     no alias claimed by two entries (234 distinct claims)             PASS
   U1 asserts RELATIONS (3 tsp = 1 tbsp), not absolute constants, so the check cannot
   smuggle in my own choice of measurement standard. N3 is the one I trust most: it does
   not use hand-picked examples but walks every id and every alias the product ships.

3. T-006 gate — 18 checks, GATE PASS, 0 failed:
     W1     weights exactly 8/25, 1/5, 4/25, 3/25, 1/10, 1/10                 PASS
     W2     they sum to EXACTLY 1/1                                           PASS
     W3     all 6 components honour an INJECTED prime-weight config           PASS
     B1     total = SUM(weighted) - SUM(penalties), re-derived independently  PASS
     B2     not one JS number in a persisted breakdown (Invariant 1)          PASS
     P1     precedence: allergy 0 < household 1 < member 2 < strong_dislike 4 PASS
     P3     strong dislike NOT outweighed by inventory+low cost -> excluded   PASS
     P5     an OPTIONAL garnish cannot smuggle an allergen past the filter    PASS
     P7     a ceiling admits exactly-at, excludes strictly-above              PASS
     F1     fuzz 4000 pairs: 1169 survivors (995 constrained), 0 leaks        PASS
   W3 is how "weights live in one config object, never inline literals" becomes testable:
   I inject a config of distinct primes and demand every component follow it. An inlined
   0.32 anywhere fails immediately (mutant S2 confirms). P3 is the SPEC claim stated twice
   — the counter-case is built as strong as possible (cheapest cost band, everything in
   inventory, loved on five other axes, one strong dislike) and it must still be EXCLUDED,
   not merely out-ranked.
   F1 carries its own non-vacuity assertion: it FAILS if fewer than 100 survivors came
   from constrained households, so "0 violations" can never mean "nothing got through to
   check". It reported 995. Its notion of "hard-excluded" is re-derived from SPEC inside
   the check and never calls back into filters.ts.

4. MY GATES WERE THEMSELVES TESTED — 14 mutants, 14 caught

A gate that cannot fail is worse than no gate. Every check above is load-bearing only if
the defect it targets actually trips it, so I planted 14 defects one at a time and re-ran:
  T-002: floats in toCanonical -> U3/U4a/U4b/U4c/U9a FAIL. Missing density GUESSED as
    1 g/ml -> U6 FAIL. Range collapsed to midpoint -> U9a FAIL. Ambiguity coin-flipped ->
    N5c FAIL. Alias-uniqueness guard removed -> N5b FAIL. "to taste" folded to 0 g -> U8 FAIL.
  T-006: weight drift 0.32->0.30 -> W1+W2 FAIL. Weight inlined -> W3 FAIL. Penalties
    dropped from total -> B1 FAIL. Strong dislike demoted to a scoring input -> P3 FAIL.
    Optional lines exempted from the allergy sweep -> P5+F1 FAIL. Registry not consulted
    for allergens -> P4+P5+F1+F2+F5 FAIL. Ceiling off-by-one -> P7 FAIL. Reasons unsorted
    -> P2 FAIL.
All 14 detected by the check written for them. The PASSes above are earned.

5. ONE CHECK OF MINE PASSED FOR THE WRONG REASON, AND I CAUGHT IT

N5b originally built a colliding registry as a hand-made Map and asserted matchIngredient
reported ambiguity. It FAILED — the code returned `beta_thing`. The finding was mine, not
the code's: parseIngredientRegistry already refuses to admit two entries claiming one
name, so my fixture had bypassed the actual guard by constructing a state the product
cannot reach. I re-aimed the check at the guard itself rather than deleting it.
Re-aimed, it passed — but for the WRONG REASON: my fixture used store_section 'pantry',
which is not a valid section, so the parser threw on THAT and my regex matched a
collision message that happened to be elsewhere in the issues array. Fixed by adding a
CONTROL: the same fixture with the collision removed must parse cleanly first, and the
assertion now requires a message matching /collide/ specifically. Both edits made the
gate stricter; neither weakened it.
That detour also surfaced a real latent gap — filed as T-030, not as a pass:
parseIngredientRegistry keys uniqueness on `name.toLowerCase()` while normalize.ts indexes
on `foldIngredientText` (lowercase + COLLAPSED whitespace). Aliases differing only by
internal whitespace pass the parser and then silently collide in the fold index, last
writer winning. Check N4 proves the shipped 97-entry registry contains no such pair, so
this is latent, not live — an authoring trap rather than a current defect, which is
exactly why it is a backlog item and not a gate failure.

6. collision-scan: `no classic scripts found — not applicable`. Reported as
   not-applicable, never as a pass.

result: T-002 -> done, T-006 -> done. Five verified items of 30.
  - units.ts (280) + normalize.ts (268) + 61 tests. Cross-dimension conversion refuses
    with a typed NotConvertible naming the ingredient, both dimensions and every absent
    curated field — the "reported separately, never guessed" half of DoD 4, which is the
    part most implementations quietly skip.
  - filters.ts (434) + score.ts (416) + 20 tests. Exclusion is unreachability: scoring
    physically cannot see an excluded recipe because it takes HardFilterResult, not a
    recipe list. That is the structural reason a strong dislike can never be averaged
    away, rather than a rule someone has to remember.

wave autotune: zero reverted merges, zero failed verifies -> CLEAN on the rule's own
terms, so wave_streak 0 -> 1 (promotion needs 2). k_current stays 4. Honest caveat: this
wave was also KILLED mid-flight, but that is an infrastructure signal (KI-4), not evidence
about wave size, and the autotune rule keys on reverts and failed verifies. Effective wave
size next cycle = min(k_current 4, gear cap 2, hard max 5) = 2.

burn attribution: skipped — window_tokens went 55,551,168 -> 720,910 across the 23:00Z
window reset, a negative delta.

honest note on what this cycle did NOT establish: score.ts has no committed test coverage
(T-029) — my gate proves it correct TODAY, and nothing in `npm test` will notice if it
drifts TOMORROW. That is the single most important thing a reader of this journal should
know about the current state. DoD 9's fuzz is proven at the FILTER layer only; there is no
planner yet, so "zero plans containing a hard-excluded ingredient" remains unproven
end-to-end and T-007 is where that risk lands. Still nothing rendered: no server, no
screen, so the accessibility must-have and tokens.css contrast ratios remain unverified
exactly as at cycles 3 and 5, and DoD 7's kill-survival claim stays a domain-layer claim
until T-020. No QA or look pass ran — still no subject. All reported as not-run.

next: wave 2 with effective k=2. Best-value unblocked pair with disjoint scopes:
T-029 (score.ts regression tests — closes the coverage hole this cycle opened, S-effort)
and T-003 (serving scaling + cross-recipe aggregation + traceability, which T-002 just
unblocked and DoD 5 depends on). Disjoint: tests/score.test.ts vs domain/src/aggregate.ts.
runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787096449,"next_wakeup_at":1787097349,"pid":2361607,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1},"budget":{"source":"probe","gear":2,"gear_target":2,"ratio":1.23,"mode":"thermostat","k_cap":2,"promote":false,"demote":true,"window_tokens":720910,"window_cost_usd":0.8827030000000001,"api_cap_usd":null,"api_spend_usd":0,"tokens_per_hour":35326700,"projected_depletion_at":1787108960,"last_probe_ts":1787096449,"last_real_probe_ts":1787096449,"probe_failures":0,"probe_note":"Cycle 6 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max` (bin/swarm-budget.sh DENIED again \u2014 KI-1 recurs, 3rd consecutive cycle). Raw probe: runs/cc-probe-c6.json; rho arithmetic: runs/.c6-rho.mjs. NEW 5h window 23:00-04:00Z opened 12 min before this cycle. limit=max prior block 130,591,250; used 720,910; remaining 129,870,340 over 16,274s to T_target (block end 04:00Z, earlier than stop_at 12:00Z) => target 28,728,845 tok/h; actual 35,326,700 tok/h (ccusage burnRate 588,778 tok/min) => rho 1.23 => gear_target 2. Caveat recorded, not hidden: a burn rate sampled 12 min into a fresh window is spiky and this rho is the least trustworthy of the run so far \u2014 but it lands in the same gear the governor would force anyway, so nothing rests on it. WEEKLY GOVERNOR ENGAGED on the RAW ACCOUNT: weekly_used 54.0% at week_elapsed 25.27% => heat 2.14 > 1.3 (opus 50/25.27 = 1.98) => ceiling 2 + promote_blocked. KI-2 status: allocator swarm_used_pct recovered 0 -> 2 with allow_overall_pct still 0, so the feeder's denominator is non-zero this cycle and the governor would engage \u2014 but ONLY by luck of drift, exactly as at cycle 3. The zero-envelope blind spot is unchanged and the bug stays open. gear_target 2, prev gear 2, hysteresis no-op => applied gear 2. Wave cap 2, demote=true. Allocator dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).","weekly":{"ok":true,"weekly_used_pct":54,"opus_used_pct":50,"week_elapsed_pct":25.27,"weekly_heat":2.14,"opus_heat":1.98,"ceiling":2,"promote_blocked":true}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":7,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."},"artifact":{"url":"","file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```

## cycle 7 | 2026-08-19T00:05:00+0000 | dinner | BUILD

clock: now 1787097900, stop_at 1787140800 — 11.9h remaining. No admission pressure; a
2700s build wave fits with 9h to spare.

budget: gear 2 (rho 0.966 => gear_target 3 CRUISE, clamped by the weekly governor to 2).
9,939,931 of 130,591,250 window tokens used, 27.9M tok/h actual vs 28.9M target to the
04:00Z block end. Read plainly: this WINDOW is paced almost perfectly, but the WEEK is
hot — 54.0% used at 25.47% elapsed, heat 2.12 — and the week wins. promote blocked,
demote true, wave cap 2. bin/swarm-budget.sh DENIED for the 4th consecutive cycle
(KI-1); probe run directly via the allowlisted npx ccusage. KI-2 unchanged and still
open — the feeder would have engaged the governor this cycle only by luck of drift
(swarm_used_pct 2, allow_overall_pct 0), which is not a fix; my own arithmetic never
uses that formula, so this clamp is sound regardless.

orient: tree clean, no stray branches or worktrees, control.json pending empty, no
injections. Baseline 152/152 green at 2d50c25.

work: build-wave, effective k = min(k_current 4, gear cap 2, hard max 5) = 2.
  T-003  scaling + cross-recipe aggregation + traceability   fable/medium  (route_class core)
  T-029  score.ts regression tests                            fable/low     (route_class core)
Both are route_class core, so the fable guard exempts them from the gear-2 demotion —
correctness-core items keep fable in every gear. Effort mapped mechanically S->low,
M->medium (KI-3's second gap: the backlog speaks S/M/L, the harness wants low/medium/high).

### KI-4: mechanism found, and worked around at zero cost

The 600s guillotine that destroyed cycles 4 and 6 is NOT a pacer timeout. Reading
bin/swarm-pacer.sh lines 232-260 settles it: the pacer spawns `claude -p` SYNCHRONOUSLY
with no timeout of its own. The killer is the harness background-task wait ceiling
(CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, default 600000) applied at TURN END. Agents
dispatched in the FOREGROUND are part of the turn, not background tasks, so the ceiling
never applies to them.

So this cycle dispatched both builders as direct foreground Agent calls against the main
working tree under strictly disjoint file scopes — no workflow, no worktrees, no branches,
builders forbidden to run git at all, conductor commits. They ran 424s and 356s. Under the
old pattern the wave would have been at risk again. Recorded as D-11. This is a prompt-side
workaround inside a run; the durable fix is still in the pacer and still belongs in the
morning report, so KI-4 stays OPEN at high severity.

Honest caveat: one builder (T-029) returned prose instead of its JSON contract — it was
mid-flight, waiting on the other builder's typecheck, when it summarised. Its self-report is
therefore incomplete. That changed nothing, because a builder self-report is a claim I do
not spend anything on: both items were gated from scratch below.

### VERIFICATION EVIDENCE — T-003 (gate: SWARM/runs/cycle-007-gate-T003.mjs, 43/43)

Authored at verification time from the acceptance criterion, without reading the builder's
tests. Full output: .swarm/runs/cycle-007-verify-T-003.txt

```
N1 — the four garlic alias forms all resolve to ONE canonical id
  PASS  "garlic cloves" -> garlic — got garlic
  PASS  "cloves of garlic" -> garlic — got garlic
  PASS  "fresh garlic" -> garlic — got garlic
  PASS  "3 cloves garlic, minced" -> garlic — got garlic
  PASS  all four collapse to exactly one id — ids=garlic
N2 — four alias forms from FOUR DIFFERENT recipes => exactly ONE aggregated line
  PASS  exactly one aggregated line — got 1
  PASS  that line is the garlic line — got garlic
  PASS  it carries all FOUR contributions — got 4
  PASS  sum(contributions) == required_quantity — sum=10 total=10
  PASS  unbridgeable dimensions stay SEPARATE lines — got 2
  PASS  a curated density bridges into ONE line — got 1
  PASS  a range is NOT collapsed to a midpoint
```

The four-alias fixture is the headline criterion and it holds end to end: the registry only
carries two of the four forms as aliases, so "cloves of garlic" and "fresh garlic" survive
by normalization, and all four land on one line carrying four contributions naming four
distinct recipes. The merge rule is proven in both directions — an unbridgeable pair stays
two lines AND names the missing curated field (fresh_ginger, missing density_g_per_ml),
while a curated density merges exactly (103 g + 100 ml x 103/100 = 206 g, no drift).

### VERIFICATION EVIDENCE — T-029 (gate: SWARM/runs/cycle-007-gate-T029.mjs)

T-029's deliverable is a TEST FILE, so "the suite is green" is close to worthless as a gate
— a file of assert.ok(true) passes too. The only honest question is whether the tests would
CATCH drift, so the gate MUTATES score.ts 13 times and requires the suite to go red for
each. Full output: .swarm/runs/cycle-007-verify-T-029.txt

```
  PASS  KILLED: weight preference 0.32 -> 0.33
  PASS  KILLED: weight context_interruption 0.20 -> 0.21
  PASS  KILLED: weight inventory_use 0.16 -> 0.15
  PASS  KILLED: weight cost 0.12 -> 0.13
  PASS  KILLED: weight novelty 0.10 -> 0.11
  PASS  KILLED: weight leftover_usefulness 0.10 -> 0.09
  PASS  KILLED: weights preference<->cost SWAPPED (sum still 1)
  FAIL  KILLED: penalty recent_repeat 0.15 -> 0.05 — mutant SURVIVED — suite stayed green
  PASS  KILLED: penalty excessive_active_time zeroed
  PASS  KILLED: dish_count_free_allowance 3 -> 99 (penalty never fires)
  FAIL  KILLED: excessive_active_time threshold 2400 -> 999999 — mutant SURVIVED — suite stayed green
  PASS  KILLED: repeat window 14 -> 0
  PASS  KILLED: config injection IGNORED (inlines SCORE_CONFIG)
  PASS  score.ts byte-identical after mutation run
  PASS  suite green again after restore
  mutants killed: 11/13; SURVIVED: penalty recent_repeat 0.15 -> 0.05 | excessive_active_time threshold 2400 -> 999999
```

11 of 13 killed. Two SURVIVED, and the root cause is precise: the total test recomputes
weighted components from a SPEC_WEIGHTS literal declared in the test (which is why every
weight mutant dies instantly) but subtracts penalties by reading b.penalties[name] back
from the engine, so a penalty AMOUNT drift mutates test and engine in lockstep and stays
invisible. The same mechanism hides the excessive_active_time threshold.

Ruling, stated plainly rather than smoothed over: T-029's written acceptance names the six
WEIGHTS, the sum-to-one, the recomputed total, the Rational structure check and config
injection — every one of those is met and independently drift-proven. Penalty AMOUNT
literals and thresholds are not in that acceptance. So T-029 passes on its own terms and
the residue is filed as its own item (T-031) with the exact surviving mutants named. I am
not weakening a gate to open it; I am recording what the gate did and did not cover.

One correction to my own gate: its static check "compares with exact rational equality, not
a float epsilon" FAILED as a false positive — it pattern-matched the word "epsilon" inside
comments that say there is none ("Weights sum to exactly one — exact Rational arithmetic,
no epsilon"). Manually confirmed: the file uses eq/compare throughout and no tolerance
comparison exists anywhere. My regex was wrong, not the test file.

### full-suite check (conductor-run, not builder-reported)

```
$ npm test
tests 187
pass 187
fail 0
```

152 -> 187, zero failing, tsc --noEmit clean. score.ts confirmed byte-identical after the
mutation run and the suite green again on restore, so the gate left nothing behind.

scope check (mechanical, git status): exactly 4 new files — domain/src/scale.ts,
domain/src/aggregate.ts, tests/aggregate.test.ts, tests/score.test.ts. No manifest touched,
no out-of-scope file touched, the two builders' scopes provably disjoint.

collision-scan: not applicable — no classic browser scripts exist yet. Reported as
not-applicable, never as a pass. No QA or look pass ran: still no server and no screen, so
there is nothing to look at. Not-run, not passed.

result: T-003 -> done, T-029 -> done. SEVEN verified items of 31.
  - scale.ts (127) + aggregate.ts (317) + 12 tests. Traceability is a data structure, not a
    UI afterthought: required_quantity is the exact sum of its own contributions, and the
    gate recomputes that relationship rather than trusting it. The all-or-nothing bridging
    judgement is the interesting one — a group unifies to grams only if EVERY member
    converts, otherwise each dimension keeps its line and carries the explicit refusal.
  - score.test.ts (631 lines, 22 tests) closes the coverage hole cycle 6 opened.

wave autotune: zero reverts, zero failed verifies => CLEAN. wave_streak 1 -> 2, which trips
promotion: k_current 4 -> 5, streak reset to 0. Effective wave size next cycle is still
min(5, gear cap 2) = 2 — the governor, not the autotune, is what bounds this run.

burn attribution: window_tokens 720,910 -> 9,939,931, delta +9,219,021 credited to cycle 6's
target (dinner). Running total 28,482,688.

honest note on what this cycle did NOT establish: still nothing renders. No server, no
screen, so the accessibility must-have and tokens.css contrast ratios remain unverified
exactly as at cycles 3, 5 and 6, and DoD 7's kill-survival claim stays a domain-layer claim
until T-020. DoD 5 now has real aggregation behind it but no grocery SCREEN, so "every line
answers why am I buying this" is proven at the data layer only. The critical path to
anything a human can look at runs through T-014 (server) and T-015 (web shell), and T-014
still waits on five other items: T-004, T-005, T-007, T-009 and T-013.

next: wave with effective k=2, both on the T-014 critical path — T-005 (preference model +
variance-selecting calibration, which also unblocks T-015) and T-013 (prep derivation +
the single copy/time-renderer module that makes DoD 6 a property of one helper). Disjoint:
preferences.ts/calibration.ts vs prep.ts/reasons.ts. T-030 and T-031 are S-effort fixes
held for a cycle where the critical path has no unblocked pair.
runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787097822,"next_wakeup_at":1787097912,"pid":2363929,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1},"budget":{"source":"probe","gear":2,"gear_target":3,"ratio":0.966,"mode":"thermostat","k_cap":2,"promote":false,"demote":true,"window_tokens":9939931,"window_cost_usd":9.055952500000004,"api_cap_usd":null,"api_spend_usd":0,"tokens_per_hour":27903562,"projected_depletion_at":1787112524,"last_probe_ts":1787097822,"last_real_probe_ts":1787097822,"probe_failures":0,"probe_note":"Cycle 7 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max` (bin/swarm-budget.sh still DENIED — KI-1, 4th consecutive cycle). Raw: runs/cc-probe-c7.json; arithmetic: runs/.c7-rho.mjs. Block 23:00-04:00Z, limit 130,591,250 (max prior completed block), used 9,939,931, remaining 120,651,319 over 15,041s to T_target (block end 04:00Z, earlier than stop_at 12:00Z) => target 28,877,385 tok/h; actual 27,903,562 tok/h (ccusage 465,059 tok/min) => rho 0.966 => gear_target 3 (cruise). This rho is far more trustworthy than cycle 6s: it is sampled 50 min into the window rather than 12, so the burn rate has real history behind it. WEEKLY GOVERNOR ENGAGED on the RAW ACCOUNT: weekly_used 54.0% at week_elapsed 25.47% => heat 2.12 > 1.3 (opus 50/25.47 = 1.96) => ceiling 2 + promote_blocked. So the pace is fine for THIS window but the WEEK is hot, and the week wins: gear_target 3 clamped to 2. prev gear 2, hysteresis no-op => applied gear 2. Wave cap 2, demote=true. KI-2 status UNCHANGED and still open: allocator swarm_used_pct 2 with allow_overall_pct 0, so the feeders u/(u+a) denominator is 2, non-zero, and it would engage the governor — again only by luck of drift, exactly as at cycles 3 and 6. My arithmetic does not use that formula (I compute heat from the raw account weekly_used/week_elapsed), so the clamp here is sound regardless; the feeder bug is untouched. Allocator dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).","weekly":{"ok":true,"weekly_used_pct":54,"opus_used_pct":50,"week_elapsed_pct":25.47,"weekly_heat":2.12,"opus_heat":1.96,"ceiling":2,"promote_blocked":true}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":8,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."},"artifact":{"url":"","file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```

---

## cycle 8 | 2026-08-19T00:38:47+0000 | dinner | BUILD

**work**: build-wave k=2 (foreground agents, D-11): T-005 preference model + variance-selecting
calibration; T-013 prep derivation + the single copy/time-renderer module.
**outcome**: T-013 verified DONE. T-005 FAILED the gate on a product-breaking integration
defect and returns to todo at attempts 1. Suite 187 -> 265, all green.

### clock + burn probe

`bin/swarm-budget.sh` DENIED again — KI-1, 5th consecutive cycle. Fell back to the
allowlisted probe: `npx ccusage@latest blocks --json --token-limit max` (raw:
SWARM/runs/cc-probe-c8.json).

Block 23:00–04:00Z. Limit 130,591,250 (max prior completed block). Used 20,499,247 =>
remaining 110,092,003 over 13,649s to T_target (block end 04:00Z, earlier than stop_at
12:00Z) => target 29,038,880 tok/h. Actual 26,776,013 tok/h (ccusage 446,267 tok/min)
=> **rho 0.922 => gear_target 3 (cruise)**.

WEEKLY GOVERNOR still ENGAGED on the raw account: weekly_used 56.0% at week_elapsed
25.72% => heat 2.18 > 1.3 (opus 53/25.72 = 2.06). Heat is up from 2.12 last cycle — the
window is fine, the WEEK keeps getting hotter, and the week wins. Ceiling 2 +
promote_blocked => gear_target 3 clamped to **gear 2**. Wave cap 2, demote=true.

KI-2 UNCHANGED and still open. allocator.json now reads posture "halted",
swarm_used_pct 4, allow_overall_pct 0 — so the feeder's `u/(u+a)` denominator is 4,
non-zero, and it would engage the governor again only by luck of drift (4th time this
run). My arithmetic never uses that formula, so this clamp is sound regardless.
Allocator dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).

### wave dispatch

Effective k = min(k_current 5, gear cap 2) = **2**. Both picks sit on the T-014 critical
path; both are sonnet, which is the cheapest legal tier for a build item under gear-2
demotion (build/fix never drops below sonnet). Deliberate pacing choice: the burn block
resets at 04:00Z, so the cheap sonnet pair runs now and the fable-class pair
(T-004 packaging, T-007 planset/swap) waits for the fresh window rather than being
deferred into an even hotter week.

Dispatched as DIRECT FOREGROUND Agent calls on the main tree under disjoint scopes
(D-11, the KI-4 workaround). **The workaround earned its keep twice over this cycle**:
the builders ran **869s and 472s**. Both exceed the pacer's 600s background-task
guillotine; as background tasks this wave would have been killed mid-flight exactly as
cycles 4 and 6 were. In-flight marker written and committed before dispatch (8ed718f).

### VERIFICATION EVIDENCE — mechanical scope + suite (conductor-run)

```
$ git -C /opt/targets/dinner status --porcelain
?? domain/src/calibration.ts   ?? domain/src/preferences.ts
?? domain/src/prep.ts          ?? domain/src/reasons.ts
?? tests/calibration.test.ts   ?? tests/preferences.test.ts
?? tests/prep.test.ts          ?? tests/reasons.test.ts

$ npm test
tests 265   pass 265   fail 0
```

Exactly 8 new files, ZERO modified. No manifest touched. The two builders' scopes were
provably disjoint. tsc --noEmit clean. 187 -> 265 tests (+78).

collision-scan: NOT APPLICABLE — no classic browser scripts exist yet. Reported as
not-applicable, never as a pass. No QA or look pass: still no server and no screen, so
there is nothing to look at. Not-run, not passed.

### VERIFICATION EVIDENCE — T-013 (gate: SWARM/runs/cycle-008-gate-T013.mjs)

94 checks, all pass. The ones that matter:

```
== C. INVARIANT 6 — recovery guidance is NEVER fabricated ==
  PASS  an authored instruction renders VERBATIM, with nothing added
  PASS  none_available renders the explicit honest absence
  PASS  the absence copy does NOT invent an instruction (no imperative cooking verb)
  PASS  no fabricated recovery-instruction literal exists in the copy module
== B. DoD 6 — total and active time ALWAYS rendered as separate values ==
  PASS  the combined rendering contains BOTH
  PASS  the renderer REFUSES an impossible pair (active > total)
  PASS  there is no exported renderer that emits total ALONE
== A ==  all eleven ReasonCodes render distinct, countable, non-placeholder copy
---- T-013 GATE: 94 passed, 0 failed ----
```

Invariant 6 is proven in BOTH directions, which is the point: authored text passes
through verbatim, absence renders as one fixed honest sentence, and a source-literal
sweep confirms no invented cooking guidance exists anywhere in the module to leak out.
DoD 6 is now structurally a property of one helper rather than a per-screen convention.

One correction to my own gate, recorded rather than smoothed over: my first run FAILED
on "59s should render as under 1 min". That was MY check being wrong — 59s legitimately
rounds to "1 min", and "under 1 min" is correctly reserved for durations rounding to
zero. I rewrote the check to test the real boundary (20s -> "under 1 min", never
"0 min"; 59s -> "1 min"; 0s -> "under 1 min") and it passes. The module was right and
my assertion was wrong — same class of false positive as cycle 7's epsilon regex.

### VERIFICATION EVIDENCE — T-005 (gate: SWARM/runs/cycle-008-gate-T005.mjs) — FAILED

44 of 45 checks pass. The module is largely excellent:

```
  PASS  raw magnitudes of looks_good and not_for_me are EQUAL (asymmetry cannot be
        smuggled into raws)
  PASS  negative value delta is STRICTLY larger, by exactly the config ratio 3/2
  PASS  negative reaches confidence 1/2 in FEWER events than positive (neg 2, pos 4)
  PASS  30 negative merges never drive value below -1
  PASS  greedy coverage 34 vs random over 500 trials: best 34, mean 28.97
  PASS  deterministic under INPUT REORDERING
```

Then the check that decides the item — an INTEGRATION probe calling the real
`filters.applyHardFilters` with real signals, not preferences.ts in isolation:

```
== E. INTEGRATION with filters.ts ==
  PASS  a never_recommend signal qualifies as a strong dislike in filters.ts
      ONE never_recommend tap on a chicken/thai card -> 2/6 recipes survive
        excluded r-01: strong_dislike:richness=rich, strong_dislike:effort=high
        excluded r-02: strong_dislike:method=stir_fry
        excluded r-03: strong_dislike:spice=hot
        excluded r-06: strong_dislike:richness=rich, strong_dislike:effort=high
  FAIL  a single never_recommend does NOT wipe out a catalog that shares no
        protein/cuisine with it — only 2/6 survived
```

`applyCalibrationReaction('never_recommend')` writes value -1 / confidence 1 to EVERY
attribute-value pair of the card — all six single axes plus every flavour and texture
tag — and filters.ts converts any signal at &lt;= -4/5 with confidence &gt;= 1/2 into an
ABSOLUTE hard exclusion. So four of six recipes died despite sharing neither protein nor
cuisine with the disliked card: they were killed on `richness=rich`, `effort=high`,
`method=stir_fry`, `spice=hot`. On a real 30-recipe catalog this plausibly empties the
plan and breaks **DoD 2** (&gt;= 2 of 3 meals approvable) from the first onboarding flow.

Note the CLASS of defect: neither module is wrong alone, and both passed their own
gates — filters.ts was verified done at cycle 6, and its config comment even anticipates
"never_recommend writes value -1". It is the interaction that breaks, which is exactly
why this gate calls the real filter with real signals instead of testing the new module
in isolation. Filed as **KI-5 (high)**.

**Ruling, stated plainly.** T-005's item notes explicitly bind it to this integration
("'never recommend' feeds the hard-exclusion set consumed by filters"), and the
integration is broken in a way that breaks the product. So T-005 is NOT done: status
todo, attempts 0 -&gt; 1, routing escalates one rung at next pick. I am not passing it on a
technicality that its written acceptance sentence happens not to name never_recommend,
and I am not relaxing my threshold to open the gate. The code STAYS committed — it is
good work, main is green at 265/265, and the fix next cycle is a targeted change to how
one reaction distributes its lock, not a rebuild of 1,685 lines.

Credit where it is due: the builder flagged this exact risk unprompted in its own return
("worth a second look"). That honesty is what made the defect cheap to find.

### VERIFICATION EVIDENCE — mutation gate, both items (D-12 method)

Both items ship their own regression tests, so a green suite proves nothing about them.
20 deliberate defects injected one at a time; the committed suite must go red for each.
Full output: .swarm/runs/cycle-008-verify-mutation.txt

```
  T-013: 8/9 mutants killed
    KILLED: INVARIANT 6: absence copy replaced by fabricated guidance
    KILLED: three-reason cap raised to 4 | zero minutes prints "0 min"
    KILLED: nearest-minute rounding becomes truncation | copy drift x3
    SURVIVED: active-time blocks stop splitting on zero-active steps
  T-005: 9/11 mutants killed
    KILLED: VALUE ASYMMETRY ERASED | CONFIDENCE ASYMMETRY ERASED
    KILLED: never_recommend lock weakened | greedy tie-break flips
    SURVIVED: card floor dropped below the 8-15 band
    SURVIVED: signal seeding all but disabled
  PASS  every mutated file is byte-identical to its original
  PASS  suite green again after restore
```

All three survivors are committed-test COVERAGE holes, not behaviour defects — my own
gate independently proved each of those behaviours correct (block splitting in section
G, the 8-15 band and live seeding in section F). Filed honestly as **T-032** and
**T-033** rather than papered over. The asymmetry mutants dying is the notable win: the
builder was warned about the cycle-7 read-back-your-own-number hole and did not repeat
it — the asymmetry config is pinned as literals in its tests.

### bookkeeping

wave autotune: zero reverts, ONE failed verify =&gt; neither the clean branch nor the
degrade branch. Per the table this is "any other outcome": `wave_streak` -&gt; 0,
`k_current` unchanged at 5. The gear cap of 2 is what bounds this run, not the autotune.

burn attribution: window_tokens 9,939,931 -&gt; 20,499,247, delta +10,559,316 credited to
cycle 7's target (dinner). Running total 39,042,004.

result: **T-013 -&gt; done. T-005 -&gt; todo (attempts 1).** EIGHT verified items of 33.

honest note on what this cycle did NOT establish: still nothing renders. No server, no
screen — the accessibility must-have and tokens.css contrast ratios remain unverified
exactly as at cycles 3, 5, 6 and 7, and DoD 7's kill-survival claim stays a domain-layer
claim until T-020. DoD 6 now has a real single-renderer behind it, but no SCREEN yet
consumes it, so "total and active everywhere" is proven at the helper, not the product.

next: the fresh burn window opens at 04:00Z. Next cycle picks the T-005 targeted fix
(re-verified against the same integration probe, which it will now have to survive)
paired with one disjoint critical-path item — T-004 (inventoryMath/packaging) is the
natural partner, files provably disjoint from preferences.ts/calibration.ts. T-007
depends on nothing new and remains the other candidate. T-032/T-033 are S-effort test
pins held for a cycle with no unblocked critical-path pair.
runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787100054,"next_wakeup_at":1787102113,"pid":2367528,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1},"budget":{"source":"probe","gear":2,"gear_target":3,"ratio":0.922,"mode":"thermostat","k_cap":2,"promote":false,"demote":true,"window_tokens":20499247,"window_cost_usd":24.03808,"api_cap_usd":null,"api_spend_usd":0,"tokens_per_hour":26776013,"projected_depletion_at":1787112000,"last_probe_ts":1787098351,"last_real_probe_ts":1787098351,"probe_failures":0,"probe_note":"Cycle 8 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max` (bin/swarm-budget.sh DENIED — KI-1, 5th consecutive cycle). Raw: runs/cc-probe-c8.json. Block 23:00-04:00Z, limit 130,591,250 (max prior completed block), used 20,499,247, remaining 110,092,003 over 13,649s to T_target (block end 04:00Z, earlier than stop_at 12:00Z) => target 29,038,880 tok/h; actual 26,776,013 tok/h (ccusage 446,267 tok/min) => rho 0.922 => gear_target 3 (cruise). WEEKLY GOVERNOR ENGAGED on the RAW ACCOUNT: weekly_used 56.0% at week_elapsed 25.72% => heat 2.18 > 1.3 (opus 53/25.72 = 2.06). Heat rose from 2.12 at cycle 7 — this window is fine, the WEEK keeps heating, and the week wins: gear_target 3 clamped to ceiling 2 + promote_blocked. prev gear 2, hysteresis no-op => applied gear 2. Wave cap 2, demote=true. KI-2 UNCHANGED and still open: allocator posture now `halted`, swarm_used_pct 4 with allow_overall_pct 0, so the feeder u/(u+a) denominator is 4, non-zero, and it would engage the governor again only by luck of drift (4th time this run). My arithmetic computes heat from the raw account weekly_used/week_elapsed and never uses that formula, so this clamp is sound regardless. Allocator dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).","weekly":{"ok":true,"weekly_used_pct":56,"opus_used_pct":53,"week_elapsed_pct":25.72,"weekly_heat":2.18,"opus_heat":2.06,"ceiling":2,"promote_blocked":true}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":9,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."},"artifact":{"url":"","file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```

## cycle 9 | 2026-08-19T00:48:04+0000 | dinner | BUILD

### clock + burn probe

`date +%s` = 1787100484. stop_at 1787140800 (12:00Z) — 11h12m of runway, no admission
pressure. Tree clean at orient, 265/265 green, nothing to salvage. Control channel:
`swarm-notify.sh poll` returned silently, `pending[]` empty, `inject[]` absent — no
commands, no injections this cycle.

`bin/swarm-budget.sh` DENIED for the 6th consecutive cycle (KI-1). Tonight the deny
surfaced in a new shape — the harness refused the compound
`cd /opt/swarm && RUNFILE=... ./bin/swarm-budget.sh` form on a "simple_expansion" /
multiple-operations grounds rather than on the script itself. Same workaround as cycles
4-8: real probe via allowlisted `npx ccusage@latest blocks --json --token-limit max`
(raw: `SWARM/runs/cc-probe-c9.json`).

Block 23:00-04:00Z. Limit 130,591,250 (max prior completed block), used 32,920,288,
remaining 97,670,962 over 11,351s to T_target (block end 04:00Z, earlier than stop_at)
=> target 30,976,606 tok/h. Actual 24,211,726 tok/h (ccusage 403,529 tok/min).
**ρ = 0.782 => gear_target 4.**

**Weekly governor ENGAGED, and this is the cycle where it actually bites.** Raw account
weekly_used 60.0% at week_elapsed 26.07% => heat 2.30 (opus 58/26.07 = 2.22). Heat has
risen every cycle this run: 2.11 → 2.12 → 2.18 → **2.30**. The window is now genuinely
cool — ρ 0.782 alone would buy gear 4 — and the WEEK is the sole binding constraint.
That is precisely the case the governor exists for, so: gear_target 4 clamped to ceiling
2, promote blocked. prev gear 2, hysteresis no-op => **applied gear 2**, wave cap 2,
demote true.

KI-2 unchanged and still open: allocator posture `halted`, `swarm_used_pct` 8 with
`allow_overall_pct` 0, so the feeder's `u/(u+a)` denominator is 8 — non-zero again by
drift, the 5th time this run. My arithmetic reads `weekly_used`/`week_elapsed` off the
raw account and never touches that formula, so the clamp is sound regardless. Allocator
dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).

### wave dispatch

Effective k = min(k_current 5, gear cap 2) = **2**. Both items dispatched as DIRECT
FOREGROUND Agent calls into the main tree (D-11, the KI-4 workaround) — third consecutive
cycle on this mechanism, third consecutive cycle it survived. Foreground agents are part
of the turn, so the pacer's 600s background-task ceiling never applies. In-flight marker
written and committed BEFORE dispatch (`ef6249a`), per D-8/D-10.

| item | model | why that model |
|---|---|---|
| T-004 | fable | pre-existing `route_class: "core"`; fable guard exempts it from the gear-2 demotion |
| T-005 | fable | newly flagged `route_class: "core"` this cycle — **D-13** records the flag and its pacing consequence |

Scopes strictly disjoint (T-004: inventoryMath/packaging + their tests; T-005:
preferences + its tests, with filters.ts allowed only if it chose the filters-side fix).
Neither item carried `packages`, so no conductor install preceded the wave. Craft pack
ran clean; neither item is UI-flagged, so no `craft.ui` splice applied. Both builders
were forbidden every git command; the conductor commits.

### VERIFICATION EVIDENCE — mechanical scope check (conductor-run)

Scope claims are never taken on trust. `git status --porcelain` after the wave:

```
 M domain/src/preferences.ts
 M tests/preferences.test.ts
?? domain/src/inventoryMath.ts
?? domain/src/packaging.ts
?? tests/inventory.test.ts
?? tests/packaging.test.ts
```

Exactly the two declared scopes, no overlap, no manifest touched, `filters.ts` untouched
(matching T-005's claim that it chose the preferences-side fix). Full suite, conductor-run:
`ℹ tests 297 / ℹ pass 297 / ℹ fail 0` — 265 before the wave, +2 preferences, +30 new.

I also diffed the existing test file for silently weakened assertions, because T-005's
builder disclosed rewriting one test. Total lines REMOVED from `tests/preferences.test.ts`:
two — one test title and one comment. The old "every pair gets the lock" loop was narrowed
by a `continue` guard and the generic axes were then pinned to exact hand-computed literals
(-9/10, 2/5). The disclosure was complete and the net change tightens the file rather than
loosening it.

### VERIFICATION EVIDENCE — T-004 (gate: SWARM/runs/cycle-009-gate-T004.mjs) — 22/22 PASS

Full output: `.swarm/runs/cycle-009-verify-T-004.txt`. The builder claimed it validated
its search against its own brute-force oracle; that is its claim. This is mine, written
from the acceptance text and sharing no code with the module.

```
== A. PACKAGING: coverage + optimality against an INDEPENDENT oracle ==
      probed 240 (requirement, option-set) pairs across 4 package grids
  PASS  coverage is NEVER violated — no selection ever underbuys
  PASS  expected_surplus is exactly total_yield − requirement on every probe
  PASS  the chosen combination matches an INDEPENDENT brute-force (waste, count) oracle everywhere
  PASS  tie-break is (waste THEN count): two 5g packs (waste 0, count 2) beats one 12g (waste 2, count 1)
  PASS  selection is byte-identical under option REORDERING (determinism)
== B. INVENTORY: the formula, as an identity on every line ==
  PASS  purchase = max(0, required − usable) and deducted = min(required, usable) on all 1,681 (req, have) pairs
  PASS  an `inferred` entry is NEVER subtracted at ANY magnitude; confirmed/assumed_staple always are
  PASS  no question is asked when confirmed stock already covers the line (few, high-value questions)
  PASS  a to_taste line passes through subtraction unchanged and gains NO numeric field
  PASS  one inventory entry is deducted from AT MOST one line (never double-counted across dimensions)
== RESULT: 22 passed, 0 failed ==
```

The two checks I care about most: the oracle agreed on **every one of 240 probes** (so the
"minimise waste then count" contract is real, not just untested prose), and the confidence
gate held at four magnitudes per confidence level — an `inferred` entry of 100,000g never
subtracted a gram.

### VERIFICATION EVIDENCE — T-005 (gate: SWARM/runs/cycle-009-gate-T005.mjs) — 14/16, **FAILED**

Full output: `.swarm/runs/cycle-009-verify-T-005.txt`. Section A re-runs the cycle-8 probe
verbatim; section B is new.

```
== A. THE CYCLE-8 PROBE, VERBATIM — the defect that failed this item ==
      ONE never_recommend tap -> 6/6 survive (cycle 8 measured 2/6)
  PASS  CYCLE-8 REGRESSION: a single never_recommend no longer wipes a catalog sharing no protein/cuisine
== B. THE HARDER PROBE — realistic catalog, BROAD flavour tags ==
      catalog carries 'savoury' on 8/12 recipes
      ONE never_recommend tap on a savoury+spicy chicken/thai card -> 3/12 survive
        c-01: strong_dislike:flavour=savoury      c-05: strong_dislike:flavour=savoury
        c-02: strong_dislike:flavour=savoury      c-06: strong_dislike:flavour=savoury
        c-03: strong_dislike:flavour=savoury      c-07: strong_dislike:flavour=savoury
        c-09: strong_dislike:flavour=savoury      c-11: strong_dislike:protein=chicken, flavour=savoury
  FAIL  BROAD-TAG PROBE: a tap on a savoury card does not hard-exclude the catalog's savoury dinners
  FAIL  BROAD-TAG PROBE: a clear majority of a realistic 12-recipe catalog still survives one tap
== C. never_recommend is still GENUINELY BINDING (not fixed by defanging) ==
  PASS  the reacted card itself is excluded / PASS  shared PROTEIN excluded / PASS  shared CUISINE excluded
  PASS  never_recommend is strictly more negative AND more durable than not_for_me on EVERY pair
  PASS  CONTROL: a single not_for_me tap hard-excludes nothing at all
== RESULT: 14 passed, 2 failed ==
```

**The over-exclusion did not disappear — it moved axis.** The cycle-8 fix direction (mine)
named protein, cuisine and flavour as the "distinctive" axes. The first two are. But
`FlavourTag` contains `savoury`, `mild` and `fresh`, and a real weeknight catalog puts
`savoury` on most dinners — so locking flavour reproduces the identical product-breaking
failure through a different door. **T-005 → blocked, attempts 2, KI-5 stays open.**

Two things I want on the record. First, the cycle-8 probe's catalog carried **no flavour
tags at all**, which is why it could not have caught this; a gate that merely re-ran the
original probe would have marked this done and shipped the same bug invisibly (**D-14**).
Second, the attribution: the builder followed my scoped direction verbatim, then flagged
this exact risk unprompted in its return — naming `savoury` specifically, naming the
one-line remedy, and explaining that it declined to deviate on an unmeasured hypothesis.
That was the correct call. The failure is in my scoping, not in the build, and the honest
record says so.

### VERIFICATION EVIDENCE — remedy probe (SWARM/runs/cycle-009-remedy-probe.mjs)

So that T-034 carries a measured fix rather than a plausible one, I exploited the fact
that `PreferenceAsymmetryConfig` is injectable — no source edit, nothing written to the
target:

```
AS SHIPPED (lock = protein, cuisine, flavour):
  survivors: 3/12  -> c-04, c-08, c-10
REMEDY (lock = protein, cuisine only — flavour falls through to the generic path):
  survivors: 10/12 -> c-01..c-10
  excluded c-11: strong_dislike:protein=chicken
  excluded c-12: strong_dislike:cuisine=thai
REMEDY VERDICT: CLEARS the broad-tag probe while staying binding on protein+cuisine
```

One config line. Filed as **T-034**, priority 1, route_class core.

### VERIFICATION EVIDENCE — mutation gate, T-004 (D-12 method)

Full output: `.swarm/runs/cycle-009-mutant-T-004.txt`. Nine deliberate defects; the
committed suite must go red for each.

```
  killed    M1  ceil -> floor on the derived last coordinate (UNDERBUYING)
  killed    M2  ceil -> floor on the single-option seed (UNDERBUYING)
  killed    M3  tie-break compares package COUNT before waste
  killed    M4  strictlyBetter inverted on waste (picks the WORST cover)
  killed    M5  expected_surplus computed backwards (requirement - yield)
  killed    M6  estimate flag always false (a guess presented as exact)
  killed    M7  confidence gate admits 'inferred' (silent subtraction)
  killed    M8  deducted uncapped: uses raw usable instead of min(required, usable)
  SURVIVED  M9  purchase_if_confirmed drops its max(0,...) clamp (negative buy)
== mutants killed: 8 / 9 ==
restored cleanly: YES (0 files differ)
post-mutation suite: GREEN
```

Both underbuy mutants died, which is the claim that mattered most. M9 is a missing test
pin, not a module defect — filed as **T-035**, same class as T-031/T-032/T-033.

### bookkeeping

Why the failing item's code is COMMITTED rather than reverted: it is strictly better than
the cycle-8 state — defect A is fixed and verified, only defect B remains — and the suite
is green at 297/297, so hard rule 4 holds. Reverting would restore a worse defect. The
item is marked blocked and the exact residual failure is recorded in KI-5 and T-034; nothing is
being passed off as done.

Wave autotune: no reverted merges, one failed verify (not ≥ 2) — "any other outcome", so
`k_current` stays 5 and `wave_streak` resets to 0. `consecutive_no_value` stays 0: T-004
is real verified value.

Burn attribution: window_tokens 20,499,247 → 32,920,288, delta +12,421,041 credited to
cycle 8's target (dinner). Running total 51,463,045.

result: **T-004 → done. T-005 → BLOCKED (attempts 2).** NINE verified items of 35.

honest note on what this cycle did NOT establish: still nothing renders. No server, no
screen — the accessibility must-have and the tokens.css contrast ratios remain unverified
exactly as at cycles 3 and 5-8, and DoD 7's kill-survival stays a domain-layer claim until
T-020. The deterministic core is now genuinely deep — quantities, units, normalization,
scaling, aggregation, filtering, scoring, inventory, packaging, prep — and none of it has
ever been seen by a human eye or a browser.

next: T-034 is the priority-1 pick — it unblocks DoD 2, it is S-effort, and its remedy is
already measured, so it should pair with a disjoint critical-path item. T-007 (planset +
frozen-context swap) is the natural partner: it depends only on modules now verified done,
and its files (`domain/src/planset.ts`, `swap.ts`) are provably disjoint from
`preferences.ts`. That pairing would leave T-014/T-015 (server + web shell) as the last
untouched critical path — and those are what finally put something on a screen, which the
remaining ~11h needs to reach.

runfile-mirror:
```json
{"version":1,"run_label":"dinner-2026-08-18","targets":[{"path":"/opt/targets/dinner","status":"active","weight":1}],"rotation_cursor":0,"rotation_schedule":[0],"stop_at":"2026-08-19T12:00:00+00:00","usage_reset_at":"2026-08-18T23:00:00+00:00","model_policy":"value-routing","auth_mode":"subscription","heartbeat":{"ts":1787100649,"next_wakeup_at":1787103349,"pid":2390530,"limp":false,"degraded_tiers":[]},"pacing":{"mode":"thermostat","dial":1},"budget":{"source":"probe","gear":2,"gear_target":4,"ratio":0.782,"mode":"thermostat","k_cap":2,"promote":false,"demote":true,"window_tokens":32920288,"window_cost_usd":34.68,"api_cap_usd":null,"api_spend_usd":0,"tokens_per_hour":24211726,"projected_depletion_at":1787112000,"last_probe_ts":1787100649,"last_real_probe_ts":1787100649,"probe_failures":0,"probe_note":"Cycle 9 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max` (bin/swarm-budget.sh DENIED again - KI-1, 6th consecutive cycle; this cycle the deny surfaced as a harness refusal on the compound `cd /opt/swarm && RUNFILE=... ./bin/swarm-budget.sh` form). Raw: runs/cc-probe-c9.json. Block 23:00-04:00Z, limit 130,591,250 (max prior completed block), used 32,920,288, remaining 97,670,962 over 11351s to T_target (block end 04:00Z, earlier than stop_at 12:00Z) => target 30,976,606 tok/h; actual 24,211,726 tok/h (ccusage 403,529 tok/min) => rho 0.782 => gear_target 4. WEEKLY GOVERNOR ENGAGED on the RAW ACCOUNT: weekly_used 60.0% at week_elapsed 26.07% => heat 2.30 > 1.3 (opus 58/26.07 = 2.22). Heat rose again, 2.18 -> 2.30: the WINDOW is now comfortably cool (rho 0.78 alone would buy gear 4) and the WEEK is the binding constraint - exactly the case the governor exists for. gear_target 4 clamped to ceiling 2 + promote_blocked; prev gear 2, hysteresis no-op => applied gear 2. Wave cap 2, demote=true. KI-2 UNCHANGED and still open: allocator posture `halted`, swarm_used_pct 8 with allow_overall_pct 0, so the feeder's u/(u+a) denominator is 8 - non-zero again by drift, 5th time this run. My arithmetic reads weekly_used/week_elapsed off the raw account and never uses that formula, so this clamp is sound regardless. Allocator dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).","weekly":{"ok":true,"weekly_used_pct":60.0,"opus_used_pct":58,"week_elapsed_pct":26.07,"weekly_heat":2.3,"opus_heat":2.22,"ceiling":2,"promote_blocked":true}},"watchdog":{"mode":"normal","plist_loaded":true,"lockfile":"/opt/swarm/runs/watchdog.lock","relaunch_attempts":0},"caffeinate_pid":0,"wrap_up_complete":false,"cycles_since_recycle":10,"playbook":{"mode":"auto","applied":[],"vetoed":[],"note":"swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."},"artifact":{"url":"","file":"/opt/swarm/runs/dashboard.html","publish_failures":0}}
```


## cycle 10 | 2026-08-19T01:59:54+0000 | dinner | BUILD

work: **resume the killed cycle-10 wave** — salvage + gate T-034; T-007 never ran.
gear 2 (rho 0.499, weekly heat 2.58 — governor binding), wave cap 2, demote true.

### orient — the cycle died of something new, and it is NOT KI-4

The tree was dirty with T-034's two files and the last commit was cycle 10's in-flight
marker, so this looked at first like the third KI-4 guillotining of the run. It is not.
`runs/pacer.log` shows cycle 10 spawned 01:24:28Z and reported `cycle-failed` at 01:38:22Z
— 834s, past the 600s ceiling, but the result record says something else entirely:

```
runs/cycle-1787102668.json  is_error=true  num_turns=38  duration_ms=831019  cost=$8.49
  result: "You've hit your session limit · resets 3:20am (UTC)"
runs/cycle-1787103828.json  is_error=true  num_turns=1  duration_ms=473  cost=$0.00  (same message)
runs/cycle-1787104138.json  is_error=true  num_turns=1  duration_ms=368  cost=$0.00  (same message)
runs/cycle-1787104455.json  is_error=true  num_turns=1  duration_ms=385  cost=$0.00  (same message)
```

The account's 5-hour SESSION cap cut cycle 10 off mid-wave, and then the pacer respawned
into that wall three times at ~5-minute intervals, each dying in under half a second. Filed
as **KI-6**, separate from KI-4 on purpose: had I written this off as the 600s ceiling, the
next cycle would have gone hunting a timeout that was never the cause. Note what neither
pacing signal caught — the window probe reads rho 0.50 (cool) and the weekly governor reads
heat 2.58 (hot); the SESSION cap is a third limit that neither models. Also note the pacer
has no session-limit awareness: it converted a usage pause into a stream of failed cycles.
Both consequences are in KI-6 with a concrete fix direction, recorded not edited (hard rule 5).

I am running normally at 01:59Z, before the quoted 03:20Z reset, so the cap had already
lifted by my spawn — which is exactly why I did NOT set limp and did NOT stall the night.

### salvage

T-034 (modified `preferences.ts` + `preferences.test.ts`): the marker warned that a large
`preferences.ts` diff would itself be a red flag. It is not large — the source change is
literally one line, `never_recommend_lock_attributes: ['protein','cuisine','flavour']` ->
`['protein','cuisine']`, plus a rewritten module doc and 4 rewritten/added tests. Exactly the
shape the cycle-9 remedy probe predicted. Salvaged.

T-007 (`planset.ts`, `swap.ts` + tests): **zero files produced**. Nothing to salvage,
nothing to discard. Returned to todo with **attempts left at 0** — see D-15. The attempts+1
rule exists to escalate items whose BUILD failed; T-007's build never ran. Incrementing it
for a conductor-session death twice over would blocked-cap the top critical-path item for a
reason having nothing to do with its code. Recorded rather than done silently.

control channel: polled clean — `pending: []`, `applied: []`, no injections.

### VERIFICATION EVIDENCE — T-034 (gate: SWARM/runs/cycle-010-gate-T034.mjs) — 23/23, **PASSED**

Full output: `.swarm/runs/cycle-010-verify-T-034.txt`. Authored at verification time from the
backlog acceptance text; the builder never saw it. Deliberately harder than cycle 9's gate in
four ways it could not have coded to: it taps all THREE generic flavour members (cycle 9 tapped
only `savoury`), it measures the resulting SIGNALS so both "fixed by weakening the locks" and
"fixed by deleting flavour" fail, it proves corroborated flavour evidence still escalates, and
it asserts the SHIPPED default config rather than an injected one.

```
== 0. THE SHIPPED CONFIG ==   never_recommend_lock_attributes = ["protein","cuisine"]
  PASS  the SHIPPED lock set is EXACTLY protein + cuisine   PASS  flavour is NOT in it
== A. ACCEPTANCE, PER GENERIC FLAVOUR MEMBER (card protein=duck cuisine=korean, both unique) ==
      'savoury' -> 12/12 survive | holders c-01,c-02,c-03,c-05,c-06,c-07,c-09,c-11 | lost: none
      'mild'    -> 12/12 survive | holders c-06,c-08 | lost: none
      'fresh'   -> 12/12 survive | holders c-04,c-10,c-12 | lost: none
  PASS x6  a generic-flavour tap hard-excludes NOTHING (was 3/12 survivors at cycle 9)
== B. LOCKS STILL BINDING ==  chicken/thai/savoury tap -> 10/12 survive
  PASS  c-11 (shares PROTEIN) excluded / PASS  c-12 (shares CUISINE) excluded
  PASS  all 7 other savoury dishes survive / PASS  exactly the 2 kin fall / PASS  reacted dish excluded
== C. FLAVOUR STILL IN THE MODEL ==  savoury v=-9/10 c=2/5 durable | spicy v=-9/10 c=2/5 durable
      protein v=-1/1 c=1/1 durable | cuisine v=-1/1 c=1/1 durable
  PASS  signals still emitted / negative / below the 1/2 gate / durable; locks NOT weakened
== D. CORROBORATION STILL ESCALATES ==  hand-built savoury (v=-9/10, c=4/5) -> 4/12 survive
  PASS  corroborated evidence DOES exclude all 8 savoury dishes — the axis was not defanged
== E. ASYMMETRY + CONTROL ==
  PASS  not_for_me excludes nothing, not even the reacted dish / PASS  never_recommend strictly stronger
== RESULT: 23 passed, 0 failed ==
```

Structural corroboration that the fix was not bought by defanging something out of frame:
`git status` showed only two modified files all cycle, so `filters.ts` and its
`HARD_FILTER_CONFIG` thresholds (value <= -4/5, confidence >= 1/2) are provably untouched.

**KI-5 is CLOSED** after three cycles — the defect that survived cycles 8 and 9 by moving axis.

### VERIFICATION EVIDENCE — full test_cmd (`npm test`, conductor-run)

```
> three-good-dinners@0.1.0 test
> npm run typecheck && npm run test:unit
ℹ tests 299   ℹ pass 299   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0
```

Typecheck ran and passed (the suite is reached only through `&&`). Hard rule 4 holds.

### the residual I am NOT hiding

T-034 buys correctness by dropping flavour from the lock WHOLESALE, so distinctive tags —
`garlicky`, `smoky`, `umami`, `earthy`, `herby`, `tangy`, `bright`, `spicy` — now also fall
through the generic path. A tap on a smoky dish no longer vetoes other smoky dishes. That is
a real loss of precision, accepted tonight because the shipped alternative broke the product.
Section F of the gate records it as a measured consequence rather than a footnote, and the
durable fix (a curated distinctive/generic partition of `FlavourTag`) is filed as **T-036**,
explicitly deferred. The builder raised this itself, unprompted, as it was asked to.

Also filed: **T-037**, to gate the calibration-variance and feedback-narrowing halves of
T-005 that the T-034 gate does not cover — so the morning report can say precisely which
parts of T-005 are machine-checked instead of leaving the whole item under one blocked label.
T-005 itself stays blocked; the churn rule is the rule and only a human un-blocks it.

### bookkeeping

Wave autotune: no reverted merges and no failed verifies, but half the wave never executed —
that is not a clean wave, so it takes the "any other outcome" branch: `wave_streak` -> 0,
`k_current` stays 5. Effective wave size is gear-capped at 2 regardless.

Burn attribution: window_tokens 32,920,288 -> 50,916,143, delta +17,995,855 credited to cycle
9's target (dinner). Running total 69,458,900.

`consecutive_no_value` stays 0 — T-034 is real verified value.

result: **T-034 -> done. T-007 -> todo (never ran, attempts 0). KI-5 CLOSED, KI-6 OPENED.**
TEN verified items of 37.

honest note on what this cycle did NOT establish: unchanged from cycle 9 and still the
run's biggest exposure — **nothing renders**. No server, no screen. The accessibility
must-have and the tokens.css contrast ratios remain unverified as they have since cycle 3,
and DoD 7's kill-survival is still a domain-layer claim until T-020. The deterministic core
is now eleven verified modules deep and not one pixel of it has been seen by a browser.

next: T-007 (planset + frozen-context swap) is still the top pick — priority 1, deps all
verified done, and it never got its attempt. But the run has now spent four cycles without
touching T-014/T-015 (server + web shell), which are the items that finally put something on
a screen, and ~10h remain. If T-007 lands next cycle, T-014 should take the one after it
regardless of what else is queued — a night that ships a flawless invisible engine and no
interface is the wrong outcome, and the clock is the only thing that can still cause it.

runfile-mirror:
```json
{"version": 1, "run_label": "dinner-2026-08-18", "targets": [{"path": "/opt/targets/dinner", "status": "active", "weight": 1}], "rotation_cursor": 0, "rotation_schedule": [0], "stop_at": "2026-08-19T12:00:00+00:00", "usage_reset_at": "2026-08-18T23:00:00+00:00", "model_policy": "value-routing", "auth_mode": "subscription", "heartbeat": {"ts": 1787104794, "next_wakeup_at": 1787107494, "pid": 2399315, "limp": false, "degraded_tiers": []}, "pacing": {"mode": "thermostat", "dial": 1}, "budget": {"source": "probe", "gear": 2, "gear_target": 5, "ratio": 0.499, "mode": "thermostat", "k_cap": 2, "promote": false, "demote": true, "window_tokens": 50916143, "window_cost_usd": 62.97, "api_cap_usd": null, "api_spend_usd": 0, "tokens_per_hour": 19879890, "projected_depletion_at": 1787112000, "last_probe_ts": 1787104794, "last_real_probe_ts": 1787104794, "probe_failures": 0, "probe_note": "Cycle 10 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max`. bin/swarm-budget.sh DENIED again (KI-1, 7th consecutive cycle; the compound `cd && RUNFILE=... ./bin/...` form is refused by the harness). Raw: runs/cc-probe-c10.json. Block 23:00-04:00Z, limit 130,591,250, used 50,916,143, remaining 79,675,107 over 7,206s to T_target (block end 04:00Z, earlier than stop_at 12:00Z) => target 39,804,220 tok/h; actual 19,879,890 tok/h (ccusage 331,332 tok/min) => rho 0.499 => gear_target 5. The WINDOW is now genuinely cool. WEEKLY GOVERNOR still binding on the RAW ACCOUNT (runs/allocator.json): weekly_used 69.0% at week_elapsed 26.78% => heat 2.58 > 1.3; opus 75/26.78 = 2.80. Heat climbed again, 2.30 -> 2.58, and opus_used jumped 58% -> 75% in one cycle. gear_target 5 clamped to ceiling 2 + promote_blocked; prev gear 2, hysteresis no-op => applied gear 2. Wave cap 2, demote=true. THE DECISIVE FACT THIS CYCLE IS NEITHER OF THESE: the account 5h SESSION cap killed cycle 10 mid-wave and 3 pacer spawns after it (KI-6). Neither rho (cool) nor the weekly heat (hot) models that third limit, so the gear arithmetic below is correct and was still not protective. KI-2 UNCHANGED: allocator posture trickle, swarm_used_pct 0 with allow_overall_pct 0, so the feeder u/(u+a) denominator is 0/0 and would DISENGAGE the governor; my arithmetic reads weekly_used/week_elapsed off the raw account and never uses that formula, so this clamp is sound regardless. Allocator dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).", "weekly": {"ok": true, "weekly_used_pct": 69.0, "opus_used_pct": 75, "week_elapsed_pct": 26.78, "weekly_heat": 2.58, "opus_heat": 2.8, "ceiling": 2, "promote_blocked": true}}, "watchdog": {"mode": "normal", "plist_loaded": true, "lockfile": "/opt/swarm/runs/watchdog.lock", "relaunch_attempts": 0}, "caffeinate_pid": 0, "wrap_up_complete": false, "cycles_since_recycle": 12, "playbook": {"mode": "auto", "applied": [], "vetoed": [], "note": "swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."}, "artifact": {"url": "", "file": "/opt/swarm/runs/dashboard.html", "publish_failures": 0}}
```

## cycle 11 | 2026-08-19T02:47:34Z | dinner | BUILD

work: build-wave [T-007 planset+swap (fable, route_class core), T-009 recipe batch 1 (sonnet)]
why: T-014 — the HTTP server, the item that finally makes ANY of this reachable — was blocked by
exactly two todo items, T-007 and T-009. Landing both here unblocks it next cycle. Cycle 10 closed
by naming the run's biggest exposure as "nothing renders"; this pair is the shortest path out of it,
which is why it beat the web shell (T-015) for the second seat even though T-015 is the item that
literally draws pixels. T-015 unblocks nothing; the server unblocks the four e2e proofs and every
screen at once.

dispatch: DIRECT FOREGROUND Agent calls into the main working tree, disjoint scopes, builders
forbidden every git command (D-11 / KI-4 workaround — no build-wave.js, no worktrees, no branches).
In-flight marker committed BEFORE dispatch (c75f99b), deleted at close.
models: T-007 fable (route_class core; the fable guard exempts it from the gear-2 demotion — D-13's
precedent), T-009 sonnet (kind feature; build never demotes below sonnet). Effective wave size
min(k_current 5, gear cap 2) = 2.
craft pack: `node bin/swarm-craft.mjs` ran clean, `degraded: []`. Neither item is UI-flagged (domain
TypeScript and recipe JSON), so `craft.ui` was not spliced into either prompt — it will matter for
T-015/T-016 next.

budget: gear 2 (ρ 0.452, gear_target 5 clamped to weekly ceiling 2, promote blocked, demote on).
Window genuinely cool — 55.6M of 130.6M used with actual burn 19.7M tok/h against a 43.6M target.
The clamp is the WEEKLY governor, not the window: weekly_used 69.0% at week_elapsed 26.93% ⇒ heat
2.56, opus 2.79. Both flat versus cycle 10 (2.58 / 75%) — the account did not get hotter this cycle.
KI-6 quiet: the 01:59Z spawn ran ten minutes to completion and this 02:14Z spawn started clean, so
the 5h session cap that killed cycle 10 and three pacer spawns has lifted. bin/swarm-budget.sh
DENIED for the 8th consecutive cycle (KI-1) — probe run directly via the allowlisted npx form, raw
at runs/cc-probe-c11.json.

control channel: `pending: []`, `applied: []`, no injections. Nothing to apply.

scope discipline, verified mechanically not claimed: `git status --porcelain` after both builders
returned showed ZERO modified tracked files — only new untracked paths. Neither builder touched a
manifest, a frozen module, `data/ingredients.json`, or the other's scope. That is the check that
makes two concurrent agents in one working tree safe, and it is worth more than either builder's
assurance that they behaved.

### VERIFICATION EVIDENCE — T-007 (gate: SWARM/runs/cycle-011-gate-T007-rev2.mjs) — 58/58, **PASSED**

Full output: `.swarm/runs/cycle-011-verify-T-007-rev2.txt` (rev1 and its 4 failures kept alongside at
`cycle-011-verify-T-007.txt` — see D-16). Authored at verification time; the builder never saw it and
it shares nothing with the 40 tests the builder wrote. Run against the SIX REAL RECIPES T-009 landed
this same cycle plus derived variants — D-14's rule, gate against realistic data, not the author's
own fixture. Every reason-direction check is re-derived from raw Recipe fields, never from swap.ts's
own eligibility helpers, which are the thing under test.

```
== A. INVARIANT 4, STRUCTURALLY ==
  PASS  "planset" appears NOWHERE in swap.ts outside comments (8 imports, 0 reference it)
  PASS  never names buildPlanSet/evaluateSet / PASS no dynamic import could smuggle it in
== C. THE SET PASS ==
  PASS  greedy SET score 0.7712 >= naive top-3-individually 0.5186
  PASS  the set pass CHOSE DIFFERENTLY from naive top-3 on real data (so it is actually exercised)
  PASS  Sigma marginal contributions == set total EXACTLY, and telescopes per TERM (no float slop)
  PASS  byte-identical on re-run; a SHUFFLED candidate array yields the identical set, same order
  PASS  0/1/2 survivors -> kind 'short', missing 3/2/1 — no throw, no fabricated meal
  PASS  wrong-ORDER scores caught by id cross-check, not just a length check
== D. INVARIANT 4, BEHAVIOURALLY (27 slot x reason swaps) ==
  PASS  27/27 the two untouched meals deep-equal before and after
  PASS  27/27 returned as the SAME OBJECT REFERENCES (Object.is), not copies
  PASS  cap of three alternatives held 27/27 / PASS outgoing meal never offered back to itself
== E. THE NINE REASONS, re-derived from raw fields ==
  PASS  zero broken promises across all 27 swaps
  PASS  faster:6 less_hands_on:8 fewer_dishes:6 more_familiar:6 more_adventurous:3 no_pasta:9
        different_protein:9 — cheaper excused: 0 strictly-cheaper candidates EXIST (all 3 plan
        meals are already 'low' band); exercised separately against a high-band meal -> 3 alts,
        all strictly cheaper
  PASS  5 distinct top picks across the nine reasons — the reason materially reorders, not just filters
  PASS  the pasta dish never survives a no_pasta swap; zero false positives on the six real recipes
  PASS  an all-`inferred` pantry yields NO use_what_i_have alternatives — inferred is never trusted
  PASS  echo-outgoing-only overlap 0 == disjoint 0, while frozen-echo 1 > disjoint 0
  PASS  no float in any rank/weight field; every alternative carries 1..3 renderable facts
== RESULT: 58 passed, 0 failed ==
```

The E8 pair is the one I would point a reviewer at. It is not enough that a swap RETURNS the frozen
meals untouched — the alternatives must also be RANKED against them and not against the meal being
replaced. A candidate carrying only the outgoing meal's exclusive ingredients scores overlap 0,
exactly like a fully disjoint candidate, while a candidate echoing a frozen meal scores 1. That
proves the term is correctly scoped AND still alive; either check alone could be passed by a bug.

### VERIFICATION EVIDENCE — T-009 (gate: SWARM/runs/cycle-011-gate-T009.mjs) — 37/37, **PASSED**

Full output: `.swarm/runs/cycle-011-verify-T-009.txt`. Deliberately does NOT reuse the builder's own
throwaway checker, which only asked "does gateCatalog say eligible?" — the one question a data author
can trivially satisfy.

```
  PASS  gateCatalog: 6/6 eligible with ZERO issues (independent re-run)
  PASS  no step carries a SPEC.md-era field name (D-7 held); 35/35 steps' unions well-formed
  PASS  all 11 required interruption keys present + typed on all 35 steps
  PASS  D1 no continuous-attention step is also pause-safe-during or unlimited-pause
  PASS  D5 22/22 recovery instructions unique — none copy-pasted; shortest 86 chars
        (informational) 22 instructions, 13 explicit none_available
  PASS  D7 declared active/total time equals the step sums, re-derived
  PASS  E1-E3 six DISTINCT proteins / cuisines / methods
        chicken,beef,shellfish,legume,tofu,egg | greek,mexican,thai,north_african,chinese,japanese
        sheet_pan,one_pot,stir_fry,braise,no_cook,stovetop
  PASS  E8 9 distinctive (non-generic) flavour tags / E9 fastest 16 min active, range 16-27 min
  PASS  F1 no dietary tag contradicted by a registry-resolved allergen class
  PASS  F2 every registry-carried allergen DECLARED / F3 79/79 ingredient lines resolve
  PASS  G1 69/69 string-authored quantities parse to the hand-computed EXACT value
  PASS  G2 every quantity an exact bigint Rational — no float leaked in
== RESULT: 37 passed, 0 failed ==
```

Section F is the one that mattered most: allergen classes re-derived INDEPENDENTLY through the
registry rather than trusting `gateCatalog`, so a bug in the gate could not have hidden a lie in the
data. That is the "DoD 9 fails via data" failure the design panel predicted and the early catalog
gate exists to catch.

### VERIFICATION EVIDENCE — full test_cmd (`npm test`, conductor-run)

```
> three-good-dinners@0.1.0 test
> npm run typecheck && npm run test:unit
ℹ tests 339   ℹ pass 339   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0
```

299 -> 339 (+40 from T-007's own suite). Typecheck ran and passed — the suite is reached only through
`&&`. Hard rule 4 holds.

post-merge checks: `collision-scan.mjs` and the qa-verify look pass were NOT run, and the reason is
that neither applies rather than that I skipped them — every file this cycle is domain TypeScript,
node:test files, or recipe JSON. Nothing the browser is served changed; `web/` still contains only
`css/tokens.css`. The look pass gets its first real job the cycle T-015 lands.

### the gate corrections, stated plainly

The T-007 gate failed 4 of 52 checks on its first run. All four were the GATE's fault, and I proved
each one before touching it — diagnostics in `runs/.c11-probe.mjs`, ruling recorded as **D-16**, rev1
and its failing output kept on disk next to rev2 rather than overwritten. Briefly: A1 tripped on
swap.ts's own doc comment saying it does not import planset; E2 demanded alternatives from `cheaper`
when a hand-derived count proved zero strictly-cheaper candidates exist (all three planned meals are
already the cheapest band); E5c required a specific dish to rank first when five variants tie at 100%
owned; and E8 cloned an outgoing meal that shared all eight of its required ingredients with the
frozen pair, so overlap 1 was the correct answer to a confounded question. The rebuilt E8 is a
strictly stronger test than the one it replaced, and it only exists because the first one went red.

### builder-raised gaps, filed rather than absorbed

Both builders raised their own doubts unprompted, which is what they were asked to do and is worth
recording as having worked:

- **T-038** (priority 2): swap.ts returns a typed code when it can offer nothing
  (`no_candidates_in_pool` / `all_candidates_already_in_plan` / `no_candidate_satisfies_reason`), but
  `reasons.ts` — the single copy module — has no fact for "nothing to offer", so there is no rendered
  copy. The plan screen needs it or a legitimate empty answer will read as a bug.
- **T-039** (priority 4, deliberately low): `familiarityOf` is duplicated in swap.ts because score.ts's
  novelty anchor logic is not exported and score.ts is frozen. Two copies of one definition is real
  drift debt — but both are currently correct and tested, so it must not outrank a screen the user
  can see.
- `no_pasta` is a name-fragment heuristic with no pasta class in the registry. Recorded as a binding
  constraint on T-010/T-011: keep pasta ingredient ids and dish names recognisable, or the app will
  silently show pasta to someone who asked for none.

One small correction to a builder claim, non-blocking: T-009's notes said quantities were authored as
mixed fractions like `"1 1/2"`. The gate found 69 string-authored quantities and ZERO mixed fractions
— they are plain decimal/integer strings. All 69 were verified to parse to the hand-computed exact
value regardless, so the data is right and only the description was off.

### bookkeeping

Wave autotune: zero reverted merges, zero failed verifies, both items delivered — a CLEAN wave.
`wave_streak` 0 -> 1; `k_current` stays 5 (it rises at a streak of 2). Effective wave size is
gear-capped at 2 regardless, so this is bookkeeping rather than capacity.

Burn attribution: window_tokens 50,916,143 -> 55,596,640, delta +4,680,497 credited to cycle 10's
target (dinner). Running total 74,139,397.

`consecutive_no_value` stays 0 — two verified items is real value.

result: **T-007 -> done. T-009 -> done. TWELVE verified items of 39.** T-014's dependency list is now
fully satisfied.

honest note on what this cycle did NOT establish: the same one as cycles 9 and 10, and it is now the
only thing standing between this run and a good morning. **Nothing still renders.** Thirteen verified
domain modules, six proven recipes, 339 green tests, and not one pixel has been seen by a browser.
The accessibility must-have and the tokens.css contrast ratios have been unverified since cycle 3,
and DoD 7's kill-survival remains a domain-layer claim until T-020 can run against a real server. The
difference tonight is that the blocker is gone: T-014 was waiting on exactly these two items and is
now free.

next: **T-014 (HTTP server + routes + entrypoint) takes the next cycle, and it is not negotiable
against anything else in the backlog** — it is effort L, it unblocks T-015 through T-023 in one move,
and it is the only item that converts a proven engine into something a person can open. Pair it with
T-015 (web shell, deps already satisfied, disjoint scope: server/ + tests/routes vs web/) if the wave
cap still allows two. ~9h remain to stop_at 12:00Z, which is enough — but only if the server lands
next, not the cycle after.

runfile-mirror:
```json
{"version": 1, "run_label": "dinner-2026-08-18", "targets": [{"path": "/opt/targets/dinner", "status": "active", "weight": 1}], "rotation_cursor": 0, "rotation_schedule": [0], "stop_at": "2026-08-19T12:00:00+00:00", "usage_reset_at": "2026-08-18T23:00:00+00:00", "model_policy": "value-routing", "auth_mode": "subscription", "heartbeat": {"ts": 1787107098, "next_wakeup_at": 1787109798, "pid": 2399315, "limp": false, "degraded_tiers": []}, "pacing": {"mode": "thermostat", "dial": 1}, "budget": {"source": "probe", "gear": 2, "gear_target": 5, "ratio": 0.499, "mode": "thermostat", "k_cap": 2, "promote": false, "demote": true, "window_tokens": 50916143, "window_cost_usd": 62.97, "api_cap_usd": null, "api_spend_usd": 0, "tokens_per_hour": 19879890, "projected_depletion_at": 1787112000, "last_probe_ts": 1787104794, "last_real_probe_ts": 1787104794, "probe_failures": 0, "probe_note": "Cycle 10 REAL probe via allowlisted `npx ccusage@latest blocks --json --token-limit max`. bin/swarm-budget.sh DENIED again (KI-1, 7th consecutive cycle; the compound `cd && RUNFILE=... ./bin/...` form is refused by the harness). Raw: runs/cc-probe-c10.json. Block 23:00-04:00Z, limit 130,591,250, used 50,916,143, remaining 79,675,107 over 7,206s to T_target (block end 04:00Z, earlier than stop_at 12:00Z) => target 39,804,220 tok/h; actual 19,879,890 tok/h (ccusage 331,332 tok/min) => rho 0.499 => gear_target 5. The WINDOW is now genuinely cool. WEEKLY GOVERNOR still binding on the RAW ACCOUNT (runs/allocator.json): weekly_used 69.0% at week_elapsed 26.78% => heat 2.58 > 1.3; opus 75/26.78 = 2.80. Heat climbed again, 2.30 -> 2.58, and opus_used jumped 58% -> 75% in one cycle. gear_target 5 clamped to ceiling 2 + promote_blocked; prev gear 2, hysteresis no-op => applied gear 2. Wave cap 2, demote=true. THE DECISIVE FACT THIS CYCLE IS NEITHER OF THESE: the account 5h SESSION cap killed cycle 10 mid-wave and 3 pacer spawns after it (KI-6). Neither rho (cool) nor the weekly heat (hot) models that third limit, so the gear arithmetic below is correct and was still not protective. KI-2 UNCHANGED: allocator posture trickle, swarm_used_pct 0 with allow_overall_pct 0, so the feeder u/(u+a) denominator is 0/0 and would DISENGAGE the governor; my arithmetic reads weekly_used/week_elapsed off the raw account and never uses that formula, so this clamp is sound regardless. Allocator dial 0.30 vs runfile pacing dial 1.0: recorded, not applied (hard rule 5).", "weekly": {"ok": true, "weekly_used_pct": 69.0, "opus_used_pct": 75, "week_elapsed_pct": 26.78, "weekly_heat": 2.58, "opus_heat": 2.8, "ceiling": 2, "promote_blocked": true}}, "watchdog": {"mode": "normal", "plist_loaded": true, "lockfile": "/opt/swarm/runs/watchdog.lock", "relaunch_attempts": 0}, "caffeinate_pid": 0, "wrap_up_complete": false, "cycles_since_recycle": 12, "playbook": {"mode": "auto", "applied": [], "vetoed": [], "note": "swarm-playbook.sh parse DENIED at kickoff (KI-1 family); apply_mode read directly from playbook/learnings.md as 'auto'. No directives staged - proceeding with defaults per SKILL.md step 3."}, "artifact": {"file": "/opt/swarm/runs/dashboard.html", "publish_failures": 0}}
```

---

## cycle 12 — IN-FLIGHT MARKER (written before dispatch, D-8)

- ts 1787108346 (2026-08-19T03:00Z) · pid 2404495 · headless pacer spawn
- gear 2 (rho 0.350 cool, weekly heat 2.52 → ceiling 2) · wave cap 2 · demote=true
- work type: build-wave, 2 items, direct foreground Agent calls (KI-4 workaround)
  - T-014 HTTP server + routes + entrypoint — L — opus demoted to sonnet
  - T-015 web shell + ui + onboarding + calibration — L — opus demoted to sonnet
- worktrees: /opt/targets/dinner/.wt/T-014, /opt/targets/dinner/.wt/T-015 (KI-3 workaround)
- branches: wave-1787108346-T-014, wave-1787108346-T-015
- conductor authored a FROZEN HTTP CONTRACT v1 and passed it verbatim to BOTH builders;
  they cannot see each other and this contract is the only thing keeping them compatible.
- if this marker is the last block in the file, cycle 12 died mid-wave: check the two
  branches above, merge only what verifies, and re-queue the rest with attempts+1.

