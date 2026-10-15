# Plan: "Generate ideas" run from the Quarterly Planning widget

Written October 15, 2026. This is a working plan to be split into commits, not a specification. Each commit below
should leave the suite green, `npm run build` passing, and the production bundle smoke test passing.

## Goal

When the quarter's plan note exists, the Quarterly Planning header action reads **💡 Generate ideas**, not
**✍️ Build plan**. Clicking it starts one user-initiated run over the projects active this month. The run has four
steps:

1. **Refine definitions.** Look for terms in open tasks that are worth substantiating from existing notes. Collect
   evidence for them and refine their dictionary definitions. Then run a fresh DecisionsEndpoint ranking pass over
   the user's tasks, so tasks not yet checked can be associated with a project under the current terms.
2. **Generate ideas.** Run idea generation for each active project that is not saturated.
3. **Rate ideas.** Rate the new ideas for actionability and relevance, and rate the existing ideas for similarity
   (see open question 2).
4. **Summarize.** Report what changed.

A progress window shows the run. Its title is "Generating ideas for X Projects". It has a four-circle stepper, a
pulsing spinner, and an ETA that starts at 5:00 and only shrinks. A status line reads like "Run 1 of 2 max per day ·
Consumed 38% of Agent Pro quota". Runs are limited to two per local day.

## What already exists

Almost every step is already a durable job. What is missing is a coordinator that forces those jobs for the chosen
projects and watches them through to the end.

| Step | Existing job(s) | File |
|------|-----------------|------|
| Refine definitions | `discoverDictionaryTerms` → `collectTermEvidence` → `refineDictionaryTerm` | `lib/dashboard/work-queue/jobs/` |
| Re-associate tasks | `rankProjectTasks` (already re-rates tasks that mention a term changed since its last ranking) | `jobs/rank-project-tasks.js` |
| Generate ideas | `generateProjectIdeas` (skips the provider for a saturated project) | `jobs/generate-project-ideas.js` |
| Rate ideas | `rateProjectIdeas`, submitted as a follow-up of ideas | `jobs/rate-project-ideas.js` |

Other pieces already in place:

- **Saturation.** `ideasSaturated` and `IDEA_SATURATION_COUNT = 12` live in
  `lib/dashboard/project-task-idea-ratings.js`.
- **Active this month.** `QuarterProject.focusMonths` holds `"YYYY-MM"` keys. An empty list means every month of the
  quarter, which matches `progressEvidence`.
- **Watching outcomes.** `DurableWorkRunner#subscribeOutcomes` reports `{ entityId, jobKey, jobType, scopeKey,
  status }`. It does not report follow-ups.
- **Header action.** The button is built in `lib/dashboard/planning.jsx` (`buildPlanAction`, around line 317).
  Once a plan note exists, clicking a quarter card still opens Plan Builder, so the builder stays reachable after
  the swap.

### Gaps

- `projectIdeasRequest` and `projectIdeaRatingsRequest` always use the `maintenance` category. A click needs
  `foregroundData` so the work is not held behind scrolling and the idle delay.
- Outcomes do not name the follow-ups an attempt submitted. Without that, the tracker cannot tell "ideas finished,
  and a rating is coming" apart from "ideas finished, and nothing follows".
- `dueTermEvidenceRequests` is capped at `TERMS_PER_VISIT = 2`, and terms are on a 7-day cooldown. A user-initiated
  run may want a slightly larger cap, but it should still respect the cooldown.

## API findings that shape the design

**Progress window.**
- `app.prompt` accepts `inputs: [{ type: "embed", value }]`. Here `value` becomes the `renderEmbed` args, and
  `app.context.renderEmbedTarget === "prompt"`.
- The window is not one-shot. The embed's own JS can update its DOM and can call `window.callAmplenotePlugin` →
  `onEmbedCall`.
- There is no way to close a prompt from code. The user closes it with an action button such as "Close" or "Keep
  running in background". Because the jobs are durable, closing it does not cancel anything.
- `app.alert` cannot host an embed.

**Catch.** `plugin.renderEmbed` always returns the full dashboard HTML, and the prompt embed is a separate iframe
that does not share the dashboard's in-memory runner. So:

- The dashboard pushes progress snapshots to the host with `callPlugin("ideaRunProgress:update", snapshot)`.
- The host keeps the latest snapshot in plugin-instance memory.
- The prompt embed polls it with `callAmplenotePlugin("ideaRunProgress:read", runId)` about once a second.
- `renderEmbed` branches on `renderEmbedTarget === "prompt"` and on the args to render the progress view, not the
  dashboard.

**Agent Pro quota.**
- We cannot read Agent Pro's response headers. Agent Pro is reached only through `app.callPlugin`, which returns
  whatever serializable value Agent Pro's `onPluginCall` chooses to return. Agent Pro makes the HTTP call itself.
- Nothing in this repo reads headers today. The only usage data is the token `usage` in a decisions body.
- Showing "Consumed N% of Agent Pro quota" therefore needs Agent Pro to expose its quota. The cleanest way is a
  dedicated call such as `app.callPlugin(agentPro, "quotaStatus")` that returns
  `{ usedFraction, periodEndsAt }`. Agent Pro reads that from the response headers it already receives.
- That is a change in the Agent Pro repo. Until it ships, the meter stays hidden.

## Commits

### 1. Run plan and request plumbing (host-compatible, no UI)

- Add `{ category = "maintenance" }` options to `projectIdeasRequest`, `projectIdeaRatingsRequest`, and
  `projectRankingRequest`. Existing callers are unchanged.
- `DurableWorkRunner#_recordOutcome` adds `followUpKeys` (the keys `_submitFollowUps` saved) and `outcomeDetail` to
  the outcome it publishes.
- New `lib/dashboard/idea-generation-run-plan.js`:
  - `activeMonthProjects(projects, now)` returns the projects whose `focusMonths` is empty or includes this month.
  - `ideaGenerationTargets(storedProjects)` returns the active projects not `ideasSaturated`. Their count is the X in
    the window title.
  - `ideaGenerationRunRequests({ input, now, projects, runId, storedProjects, tasks })` returns the requests grouped
    by step, all `foregroundData`:
    - **Step 1:** a discovery request with revision `run:<runId>`; evidence requests from `dueTermEvidence`, capped
      at `RUN_TERM_LIMIT` (4) and still honoring the cooldown; and ranking requests with a `null` revision (which
      forces the run) for every active project, saturated ones included.
    - **Step 2:** ideas requests with a `null` revision for the targets.
    - **Step 3:** rating requests for active projects that already hold ideas awaiting a rating.
  - Steps 2 and 3 are submitted by the coordinator (commit 2) once the previous step settles, so ideas read the
    associations the ranking pass just wrote.
- Tests cover month filtering, saturation filtering, forced revisions, categories, and `followUpKeys` on outcomes.

### 2. Run coordinator and progress model (host-compatible, no UI)

- New `lib/dashboard/idea-generation-run.js`, the `IdeaGenerationRun` class. It takes the durable runner, a clock,
  and the plan from commit 1.
  - It submits step 1, subscribes to outcomes in its scope, and tracks the jobs it is waiting for. It adds each
    outcome's `followUpKeys`, so evidence → refinement and ideas → rating are awaited.
  - It moves to the next step when every awaited key is settled (completed, superseded, failed, or waiting to
    retry), or when the step's time budget runs out.
  - A failure is recorded for the summary and never blocks the next step.
- **Step budgets** add up to the 5-minute estimate: refine 75s, ideas 120s, rate 75s, summarize 30s.
  - Remaining ETA is the remaining steps' budgets scaled by the pace observed so far, clamped at or below the last
    value shown, so the ETA only ever shrinks.
  - When a step overruns, the ETA holds at "Finishing up…" rather than growing.
- `snapshot()` returns `{ runId, title, projectCount, steps: [{ key, label, state }], etaSeconds, startedAt,
  summary }` for the window to render.
- The summary reports:
  - ideas generated and kept, per project
  - ideas now recommendable (`ideaRecommendable`)
  - terms added or refined
  - tasks newly associated (the change in `relatedTaskRecords`)
  - failures
- Tests use an injected clock and a fake runner that emits outcomes and follow-ups.

### 3. Daily limit

- Add `SETTING_KEYS.IDEA_GENERATION_RUNS`: a JSON array of ISO start times, pruned to the last two days. It is small,
  so `app.setSetting` fits rather than an archived note.
- `ideaGenerationRunAllowance(runTimes, now)` returns `{ allowed, runNumber, maximum: 2 }` for the local day.
- A run is recorded when it starts. Tests cover the day boundary and pruning.

### 4. Progress window (spike first, then build)

- **Spike, about one hour, before writing the UI.** Check three things:
  - `app.prompt` with an embed input, called from inside the dashboard embed, opens without blocking the dashboard's
    JS. The dashboard should not await it.
  - Plugin-instance state written by one `callPlugin` is visible to the prompt embed's `onEmbedCall`.
  - It works on mobile.
- If the spike fails, fall back to an in-dashboard modal built on `config-popup.jsx`. The progress component is the
  same either way, so only the host relay is thrown away.
- Host side, React-free:
  - `lib/idea-run-progress-relay.js` holds the latest snapshot per run.
  - `onEmbedCall` gains `ideaRunProgress:update` and `ideaRunProgress:read`.
  - `renderEmbed` branches on `renderEmbedTarget === "prompt"` with args `{ view: "ideaRunProgress", runId }`.
- Client side:
  - `lib/dashboard/idea-run-progress.jsx` renders the status line, the four-circle stepper, the pulsing spinner, the
    ETA, and the summary panel at step 4.
  - It has one wrapping class per stylesheet, in `styles/idea-run-progress.scss`.
  - The quota meter is a thin bar in the status line. It renders only when quota data exists.
- Run the boundary build and the production smoke test, because this commit touches host imports.

### 5. Header action swap and wiring

- In `planning.jsx`, once the target quarter's plan note exists, show **💡 Generate ideas** in place of Build plan.
  - Its tooltip reads "Run 1 of 2 today" or "Both of today's runs used — available tomorrow".
  - It is disabled when the allowance is spent, or when no generative provider and no rater are available.
- A click records the run, constructs `IdeaGenerationRun`, pushes snapshots to the relay on change (throttled to 1
  per second), and opens the window.
- A run already in flight reopens its window rather than starting another.

### 6. Agent Pro quota meter (needs Agent Pro work)

- Agent Pro repo: add a `quotaStatus` plugin call returning `{ usedFraction, periodEndsAt }`, derived from the
  headers it already receives.
- This repo: add `agentProQuotaStatus(app)` in `lib/providers/fetch-ai-provider.js` (host-compatible). It returns
  `null` when Agent Pro is absent or the call is not supported.
  - The run reads it at start and after each step.
  - The meter shows "Consumed 38% of Agent Pro quota" only when the user has no direct key for the provider in use.
    Otherwise their own key is paying.

### 7. Docs and cleanup

- Update `lib/plan-wizard/README.md` (or the work-queue doc) with the run's lifecycle.
- Add an `AI_CONTRIBUTIONS.md` entry for each commit.

## Open questions

1. **Saturation definition.** The request says "ideas scored 6+ on relevance and actionability".
   - `ideasSaturated` (added yesterday) counts open ideas whose *average* of the scored fields (actionability,
     relevance, similarity) is 6 or higher.
   - Plan: reuse `ideasSaturated`, so the button and background maintenance never disagree about which projects are
     full.
   - If you want "both ≥ 6", change `ideasSaturated` itself rather than adding a second rule.
2. **"Rate the existing ideas on similarity."** The plan reads this as: after new ideas land, existing open ideas get
   a similarity check against the new ones and the project's tasks, so near-duplicates are dropped.
   - Today only actionability and relevance are asked in `rateProjectIdeas`; `similarity` is averaged when present.
   - If you meant something else, such as similarity to the project, step 3's scope changes.
3. **Agent Pro quota contract.** Is adding a `quotaStatus` call to Agent Pro acceptable, or does Agent Pro already
   expose quota somewhere this repo can't see?
4. **Run with nothing to generate.** If every active project is saturated, should the click still run steps 1 and 3
   and count against the daily limit? Plan: run it, title it "Refreshing N projects", and count it.
5. **Projects with no focus months.** Treated as active every month, as `progressEvidence` does. Confirm.
