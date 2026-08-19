# cycle 017 — in-flight marker

Written BEFORE dispatch so a crashed cycle is recoverable from disk alone.

- opened: 2026-08-19T06:22:44Z (epoch 1787120564)
- gear: **1 (crawl)** — probe ok, ρ 2.36, window 89,341,205 tok, burn 37.4M tok/h,
  projected depletion 07:29Z (before the 09:00Z reset). Weekly governor binding:
  weekly_used 100% / opus_used 100% at week_elapsed 29.39% ⇒ heat 3.40, ceiling 2,
  promote blocked. Wave cap **1**, demote=true.
- work type: **build-wave, k=1** (gear-1 cap binds; `counters.k_current` is 5)
- item: **T-043** — prep quantities are unscaled (S-effort, fix, sonnet; build/fix
  never demotes below sonnet)
- why this item: the only S-effort p1 in the backlog, and it is T-057's (prep screen,
  a must-have stage) hard dependency. Journal cycle 16 named it as next.
- dispatch shape: DIRECT Agent call, single foreground builder — this is a headless
  `-p` session, where the Workflow tool is review-gated (SKILL.md headless fallback).
- session PID: 2428973
- expected merge: none — the builder works on the checked-out tree, conductor gates.

If a later session finds this file with no `cycle 17:` commit after it, the builder
died mid-flight: judge the dirty tree per cycle.md step 2 and re-queue T-043 with
`attempts+1`.
