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
