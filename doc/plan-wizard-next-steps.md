# Plan wizard: next session handoff

Written September 6, 2026, at the end of the evidence/inference milestone. This is a working plan for the next
session, not a specification. `doc/plan-wizard-implementation-plan.md` remains the authoritative design; this file
only records where the work stopped and what to pick up first.

## State at handoff

Implemented and tested: persistence (`plan-models`, `vision-guide-*`), evidence collection (`intent-evidence.js`),
inference (`intent-inference.js`), and `refreshPlanIntentPossibilities` in `plan-wizard-service.js`. 41 focused
tests pass, `npm run build` succeeds, and the production bundle smoke test passes. Nothing is committed.

Two full-suite failures are **pre-existing on clean `main`** and unrelated to this work — verified by stashing:

- `test/dream-task-service.test.js:185` — expects `/Q\d \d{4} Plan/`, receives `"Q3 2026 Work Plan"`.
- `test/proposed-agenda-widget-range.test.js`.

Decide separately whether to fix these; do not let them block the wizard work, and do not assume a green full
suite means they were repaired.

## Settled September 6, 2026

The brainstorming note's four mockups were retrieved and reviewed. **None of them is the "This quarter will be a
success if…" page.** They are, in document order: a card-triage page carrying the `1 of 5` step indicator
("Which one to three things deserve your best hours over the next 90 days?" — "Drawn from your important tasks,
recent work, and inbox. Sort them, don't write them."), a "Name the quarter" page with a month-range timeline,
"Would themed weekdays make choosing tasks easier?", and "When have you done enough for today?".

The `1 of 5` mockup is a materially different interaction from the prose description: six suggestion cards each
carrying Focus this quarter / Keep warm / Not now, one "Something missing?" catch-all input, and no free-text goal
fields. It has no representation in the current persistence layer — `IntentPossibility` has no verdict field and
`GoalSet` is ranked free text.

**Bill chose the prose spec**, so the built page is the free-text one and the mockup is left unbuilt. If it is
revived later it needs a model change, not a restyle. The mockup's "Still part of your plans?" section (stale
items marked important months ago) was **deferred** and is not covered anywhere in the implementation plan; it
would also need an evidence query for long-stale important tasks that `intent-evidence.js` does not collect.

Visual styling of the built page is still outstanding — see "What remains in step 2" below.

## Step 2 — the first wizard page

Items 2a, 2b, 2c, 2e, and 2f are **implemented and tested**; 2d (styles) is not. The subsections below are kept
as written for reference, annotated with what was actually built.

### Added after step 2: entry point and step scaffolding

The planning widget's top bar now carries a "✨ Build plan" action (the shared `headerActions` prop and
`widget-header-action` class), so the wizard no longer opens only as a side effect of clicking a quarter card that
has no plan note. It targets the next quarter and appears only in the populated state.

`lib/dashboard/plan-wizard/wizard-steps.js` declares the five-page sequence — intent, projects, quarter-name,
themed-weekdays, enough-for-today — with each unbuilt step naming the milestone it waits on. The shell routes
between them, shows "N of 5", and offers Back/Next. Unbuilt steps render
`lib/dashboard/plan-wizard/pending-step.jsx`, which states the milestone is not built rather than showing inputs
that record nothing; this keeps the plan's rule that the UI must not imply unimplemented work has run.

The last four steps are scaffolding only. `projects` needs the discovery milestone; the other three correspond to
the three mockups that were reviewed but not built. Their step definitions are the place to attach components as
those milestones land — no other file needs to change to add a page.

### What remains in step 2

**2d — `lib/dashboard/plan-wizard/plan-wizard.scss` is not written.** The components render with their class
names in place (`plan-wizard-page`, `plan-wizard-header`, `intent-step-heading`, `intent-step-category`,
`intent-step-field`, `intent-step-suggestion`, `intent-step-actions`, and the rest) but no stylesheet is imported
anywhere, so the page is unstyled. Nothing else imports a plan-wizard stylesheet yet; adding one means an
`import "./plan-wizard.scss"` in `plan-wizard.jsx` alongside the pattern the other widgets use.

The four mockups do share a consistent visual language worth drawing on even though none depicts this page:
generous heading with a muted one-line subtitle beneath, rounded card surfaces, substantiation text in a lighter
weight, and pill-shaped secondary buttons. The `1 of 5` mockup is dark-themed while the other three are light, so
check `theme-dark.scss` / `theme-light.scss` before committing to either.

### Verification for what was built

```sh
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --runTestsByPath test/plan-wizard-ui.test.js --no-coverage
```

Fifteen tests pass (eleven for the intent page, four for step navigation). The two guards most likely to rot — discarding a superseded scope's response, and not
overwriting text the user is typing — were mutation-checked: each test fails when its guard is removed. The full
suite leaves only the two pre-existing failures named above; no new ones.

---

The original plan for this step follows. Build in this order; each item is independently verifiable.

### 2a. `lib/hooks/use-plan-wizard.js`

Wraps the service for the embed. Holds loading, saving, error, and retry state.

- Call `readPlanGoals` on mount, then `refreshPlanIntentPossibilities` only when the cached snapshot is missing
  or the user explicitly refreshes. The plan is explicit that cached suggestions and picked intents load *before*
  any LLM call, and that a read-only consumer never triggers inference.
- Guard against stale responses: a domain or quarter switch while an earlier request is in flight must not apply
  the old result. Keep a request token in a ref and compare on resolution — `use-completed-tasks.js` shows the
  established ref pattern in this repo.
- Never overwrite text the user has started typing when a background inference response lands. This is called
  out twice in the plan and is the single most likely thing to get wrong.
- On save failure, retain the user's input and surface retry rather than clearing the field.

### 2b. `lib/dashboard/plan-wizard/plan-wizard.jsx`

Shell: receives the selected domain and quarter as props, shows the quarter it is planning, routes to the current
step, and handles close/resume. Resuming shows persisted answers, so reopening after a close loses nothing.

### 2c. `lib/dashboard/plan-wizard/intent-step.jsx`

The first page proper. Clicking a suggestion populates the focused field; it becomes a chosen intent only when
saved. Personal is optional. Secondary goals take the next rank in their category.

Save maps fields to `savePlanGoals` with a fresh `capturedAt` per edit — preserve that timestamp across a retry of
the same edit, since the merge treats an older or tied timestamp as a no-op. Suggestions carry
`sourceKind: "default"` when they are the generic fallbacks; the UI should present those as starting points, not
as inferred conclusions about the user.

For this slice: save, show a saved state, and leave "Find my projects" disabled — the discovery milestone does not
exist yet, and the plan is explicit that the UI must not imply projects have been generated.

### 2d. `lib/dashboard/plan-wizard/plan-wizard.scss`

First-page styles. Two-word class names minimum (`intent-step-field`, not `field`). Narrow layout must work.

### 2e. Entry point and dev support

- `lib/dashboard/planning.jsx` — launch the wizard with the selected domain and quarter. Keep the existing
  navigation path for an already-created plan. Import the shell here, never from `lib/plugin.js`.
- `lib/util/browser-dev-app.js` — support the standard note APIs and the verified section behavior. Do not invent
  production app methods to make the mock pass.

### 2f. `test/plan-wizard-ui.test.js`

Cover: suggestion selection, optional Personal answers, secondary ranks, save failure and retry, reopening
restores answers, and switching domains while an earlier request is still pending.

## Boundary rules that constrain this step

`lib/plugin.js` must not reach hooks, JSX, or React. The wizard is client-side only; it talks to the service
through the existing generic app proxy, and no new `onEmbedCall` cases are needed. After touching host imports or
shared services, run both:

```sh
npm run build
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --runTestsByPath test/production-plugin.test.js --no-coverage
```

Focused suites during development:

```sh
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --testPathPattern='plan-wizard|rich-footnote' --no-coverage
```

## After step 2

Unchanged from the implementation plan: `ActionProspect`/`ProspectTask` persistence and project discovery, then
Proposed Agenda and calendar integration, then the remaining wizard steps and the Quarterly Goals projection.
Start history rollover before enabling continuous background harvesting so the annual guide stays bounded.

## Conventions to re-read before writing code

`CLAUDE.md` and `doc/code_conventions.md`. The ones most easily missed here: line-comment JSDoc only (no block
comments), alphabetized imports/arguments/functions, no dense `filter().map()` return chains, spaces inside
template interpolation, `from` rather than `to` in names, authorship only in `AI_CONTRIBUTIONS.md`, and no commits.
