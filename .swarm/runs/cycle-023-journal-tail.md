
### QA look pass — DEGRADED (browserless), prep screen

Build-wave contract: merged files were user-visible (`web/js/prep.js`, `web/css/prep.css`),
so a look pass is part of this work type. **`qa-verify.js` exists on disk but the Workflow
tool is review-gated in `-p` sessions**, so it ran as ONE direct fable Agent call — the
documented failure-table fallback, journaled rather than silently substituted.

**The pass was degraded and its verdict is scoped accordingly: there is no browser on this
host** — no Chromium, no browse CLI — so nothing it reports is a judgment about rendered
pixels. It judged from source and from the executed DOM output of the T-057 gate. The agent
was briefed to mark anything it could not confirm as `speculative`, and returned none.

Findings: **8 raised, 0 blocker, 0 high, 3 medium, 5 low.** Filed as **ONE** consolidated
item, **T-068** (six findings, all small edits to `prep.js`) rather than eight — the live
backlog is already at the ~30 cap and eight items would buy nothing. Two were deliberately
NOT filed, with reasons recorded in T-068: the `"N count"` unit rendering is the same
convention `grocery.js:334` uses, so a prep-only fix would manufacture the cross-screen
divergence this pass exists to prevent; and the raw 2px icon margins are pre-existing shared
debt identical to `cook.css` and `plan.css`.

**One finding was checked rather than believed** (hard rule 2 — agent returns are claims).
The pass argued that `"No step in this recipe needs continuous attention — pause anywhere."`
overclaims, because `firstNonInterruptibleStep` reads `requires_continuous_attention` alone
while `safe_to_pause_before/during/after` and `maximum_pause` are independent fields. The
source check confirms that (`prep.ts:154-158`, `recipe.ts:117-125`). But the data check goes
the other way:

```
$ node -e "…scan every step in data/recipes…"
steps total 35 | not-continuous-attention BUT not fully pausable: 0
```

So the copy is **not wrong for any recipe that ships today**, and becomes wrong the first
time such a step is authored — with D-2 planning a 30-recipe catalog, that is a real
maturity risk, not a present defect. Filed as **latent** with both halves of the evidence,
so nobody re-derives this at 5am or, worse, files it as an active bug.

The pass found **no token violations** in `prep.css` — every colour, size, radius and
duration is a `var()` token, and the section/list/warning vocabulary reuses the
grocery/cook/plan patterns rather than inventing new ones. That is the outcome the craft
pack in the builder brief was for.

`state.json.qa.last_look_cycle` set to **23** (was stuck at 12 since cycle 12). **T-061
remains todo**: it asks for a look pass over four OTHER screens (plan, grocery, cooking,
feedback), and this pass covered only the prep screen. Not closed by proxy.

### bookkeeping

wave autotune: the wave was **CLEAN** — zero reverted merges, zero failed verifies →
`wave_streak` 0 → **1**. It needs 2 to move `k_current`, which stays **5**; the gear cap of
2 is what actually binds. burn attribution: `window_tokens` 141,578,956 → 411,729 is
**negative**, i.e. the 09:00Z window reset, so attribution is **skipped** this cycle per
cycle.md rather than recording a false 0. `cycles_since_recycle` 0 → **1**.
`consecutive_no_value` **1 → 0** (three verified items).

known_issues: **unchanged**, none opened, none closed. The three new findings are backlog
items, not known_issues — none is blocker or high severity. Still open: KI-1, KI-2, KI-3,
KI-4, KI-6, KI-11, KI-12. **KI-11** (no client JS has ever been typechecked) is worth
re-reading in light of this cycle: `prep.js` is 532 lines of untypechecked client code that
`tsc --noEmit` cannot see, and only the conductor's gate executing it caught anything at all.

result: **THREE items verified — T-017, T-038, T-057 — the largest verified-value cycle of
this run, and the first to close three.** Twenty-seven verified of 68 filed. Two came from
builders; the third cost no builder at all — T-017 had sat `todo` for nine cycles on a
failure `T-052` had already fixed at cycle 15, and one gate closed it and unblocked T-021,
T-024 and T-062. Verification also produced **four new findings no unit test could see**
(T-065, T-066, T-067, T-068), because unit tests supply their own fixtures and only a gate
driving the real catalog through the real server can see that the catalog is empty where it
matters.

**The one that matters for the morning: `data/ingredients.json` ships ZERO package options
for all 97 ingredients.** `packaging.ts` is fully implemented and unit-tested, `routes.ts`
encodes `package_label` / `is_estimate` / `expected_surplus` onto every grocery line, and a
live 22-line list measured this cycle had 0 estimated lines, 0 surplus and null package
labels throughout. **D-4 named package-size selection and leftover optimisation as two of
the three differentiators prior-art scouting found unoccupied across all five competitors.**
The moat is written and switched off. That is T-065, priority 1.

next: **T-065** at cycle 24 — it is the highest-value item on the board and it is data
authoring plus a validation gate, not new engine code. Then T-021 (the broadened DoD loop
sweep, now unblocked by T-017) or T-061 (the look pass over the four older screens, still
the largest unverified surface in this run).
