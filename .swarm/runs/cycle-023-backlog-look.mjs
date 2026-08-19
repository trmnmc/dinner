import fs from 'node:fs';
const p = '/opt/targets/dinner/.swarm/backlog.json';
const b = JSON.parse(fs.readFileSync(p, 'utf8'));

b.items.push({
  id: 'T-068',
  title: 'Prep screen copy and accessibility pass (6 findings from the cycle-23 look pass)',
  kind: 'fix',
  priority: 2,
  value: 'M',
  effort: 'S',
  status: 'todo',
  deps: ['T-057'],
  files_hint: ['web/js/prep.js'],
  acceptance:
    'All six findings below are fixed in prep.js: the safe-stop line no longer says "right now" on a screen shown before cooking starts; the "pause anywhere" line claims only what a null first_non_interruptible_step actually proves; the decorative "Prep plan" status badge is gone or carries a real fact; the empty state does not say "slot"; the two statically-rendered panels drop their live-region roles; and the optional-ingredients list carries a programmatic label.',
  packages: [],
  must_haves: ['Accessibility'],
  dod: [11],
  model: 'sonnet',
  attempts: 0,
  created_cycle: 23,
  notes:
    'FROM THE CYCLE-23 QA LOOK PASS — DEGRADED (browserless: no Chromium and no browse CLI on this host, so nothing below is a judgment about rendered pixels). Six findings consolidated into ONE item because they are all small edits to a single file; filing eight separate items would have pushed the live backlog past the ~30 cap for no gain. ' +
    '(1) SAFE-STOP TENSE, certain: prep.js:201 renders "Safe to stop right now, during step 1." — phrasing lifted verbatim from cook.js:187 where "right now" is true mid-session. On the prep screen the parent has not started cooking, so it asserts a state that is not happening. Wants a pre-cook phrasing for kind "now". ' +
    '(2) "PAUSE ANYWHERE" OVERCLAIM, real but LATENT — conductor-verified both ways. The agent is right that prep.ts:154-158 derives first_non_interruptible_step from requires_continuous_attention ALONE, while safe_to_pause_before/during/after and maximum_pause are independent fields (recipe.ts:117-125), so a null does NOT prove "pause anywhere". BUT the conductor also checked the shipped data: across all 35 steps in the 6-recipe catalog, ZERO steps are not-continuous-attention yet not fully pausable, so the copy is not wrong for any recipe that exists today. It becomes wrong the first time such a step is authored, and D-2 plans a 30-recipe catalog. Fix the copy to claim only what the null proves, and/or add the invariant to the catalog validation gate. Recorded as latent rather than active so nobody re-derives this at 5am. ' +
    '(3) DECORATIVE BADGE, certain: prep.js:446 renders a static "Prep plan" status badge restating the h1 — the rendered screen opens "PrepPrep planEverything to line up…". Elsewhere badges carry real status (cook.js "Paused", plan.js "Safe to pause anytime"); a decorative one dilutes the pattern and contradicts tokens.css\'s "nothing decorating harder than the numbers". ' +
    '(4) JARGON, certain: prep.js:428 empty state says "This slot doesn\'t have an active dinner in your current plan." plan.js keeps "slot" internal and says "Dinner N of 3" to users. ' +
    '(5) LIVE-REGION ROLES, certain: prep.js:301 and :317 put role="status" on panels rendered ONCE at mount, copied from cook.js:308,313 where those panels update during a live session (and where the attention warning is role="alert", not "status"). On static content they do nothing useful and some screen readers announce them on insertion. ' +
    '(6) OPTIONAL LIST UNLABELLED, certain: prep.js:242-243 introduces the optional ingredients with a bare <p> subhead over an unlabelled <ul>, so a screen-reader user navigating by list meets a second ingredient list with nothing distinguishing it from the required one — blurring exactly the must-have/nice-to-have split the code comment says must never blur. ' +
    'DELIBERATELY NOT FILED, with reasons: the "N count" unit rendering ("Lemons 3 count") is stilted but is the SAME convention grocery.js:334 uses, so a prep-only fix would create the cross-screen divergence this pass exists to prevent — it belongs in a shared helper or nowhere; and the raw 2px icon margins at prep.css:147,174 are pre-existing shared debt identical to cook.css:55,78 and plan.css:41, so the only accurate local fix is amending prep.css\'s own header comment, which currently claims "no raw px". ' +
    'The pass found NO token violations otherwise: every colour, size, radius and duration in prep.css is a var() token, and the section/list/warning vocabulary deliberately reuses grocery/cook/plan rather than inventing new patterns. ' +
    'STILL UNVERIFIED BY ANYONE (what a browser pass would need): real wrapping of long ingredient names against the nowrap quantity column, rendered contrast of the danger-bordered attention panel in both colour schemes, true 44px hit areas on a small viewport, whether six stacked sections scan as a checklist or a wall at real phone height, and screen-reader behaviour on load.',
});

fs.writeFileSync(p + '.tmp', JSON.stringify(b, null, 2));
fs.renameSync(p + '.tmp', p);
const c = {};
for (const i of b.items) c[i.status] = (c[i.status] || 0) + 1;
console.log('backlog:', JSON.stringify(c), 'total', b.items.length);
