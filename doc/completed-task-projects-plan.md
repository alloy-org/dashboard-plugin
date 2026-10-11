# Plan: Completed Tasks by Project

Record which quarterly-plan project each completed task advanced, color the Victory Value chart by project, and raise
the victory value of completed tasks that a decisions model judges to have outsized project impact.

The work lands in three commits. Each one leaves the Dashboard working and is useful by itself:

| Commit | What it delivers | User-visible? |
|--------|------------------|---------------|
| 1. Ledger + classification job | A low-priority queued job writes `Completed Tasks by Project Q4 2026 <Domain>` | Only the archived note |
| 2. Victory Value project colors | Bars stack by project, tooltip and legend name the project | Yes |
| 3. Potential scoring job | A follow-up job rates upside/impact and raises `victoryValue` through `updateTask` | Yes (bar heights) |

Before commit 3, check that `app.updateTask` accepts `victoryValue` (see [Risks](#risks-and-open-questions)). That
check can happen at any time and does not hold up commits 1 or 2.

---

## Existing pieces this builds on

- **Work queue**: `lib/dashboard/work-queue/`. Job types are named, and their requests built, in
  `jobs/project-job-requests.js`. Handlers are registered in `dashboard-work-handlers.js`, and `"maintenance"` is the
  lowest `PRIORITY_CATEGORIES` entry. A handler returns `result.followUps` to queue further jobs, which is how
  `reconcile-projects.js` plans its jobs. Handlers must be host-compatible, so the code they use cannot touch React.
- **Submission point**: `lib/hooks/use-project-maintenance-queue.js` already submits the quarter's reconciliation
  after the load settles, every five minutes, and after `DASHBOARD_TASKS_UPDATED_EVENT`. The new job is submitted at
  those same moments.
- **Quarter-scoped note naming**: `projectTaskStoreNoteName(scope)` → `Project Tasks Q4 2026 Work`.
- **Projects + examples**: `readCollectedProjectTasks(app, scope)` returns active `QuarterProject`s. Each one has
  `relatedTaskRecords` (with `matchScore`/`linkedBy`), `taskSimilarityScores`, `relatedTasks`, `primaryNoteUuid`, and
  `matchesTask(task)`. `projectIntentTexts(guide, project)` gives the plan-note description.
- **Terms Dictionary**: `readUserTermsDictionary(app, year)`, `dictionaryObjectFromEntries`, and
  `relevantDictionaryTerms(dictionary, passages)`, which narrows the dictionary to the terms the request mentions.
- **DecisionsEndpoint**: `decisionsEndpointForApp(app, { includeFastScore })` returns an endpoint, and
  `.withProviderDispatch({ providerDispatch, signal })` adds the permit. `rankedResponses({ questions, state })`
  returns a `DecisionsResponse`. Questions are name-keyed: `scoreQuestion(instructions, criteria)` for 1–10 ratings,
  and `{ type: "choice", instructions, choices }` for choices. Read answers with `ratingFor`, `answerFor`, and
  `confidenceFor`.
- **Section-scoped writes**: `guideSectionRange` + `replaceGuideSection` (as used by `project-task-store.js`) keep
  each write under `MAXIMUM_GUIDE_SECTION_CHARACTERS` even when the whole note is larger.

---

## Commit 1: Ledger note and the classification job

### Ledger note format

Name: `Completed Tasks by Project Q<quarter> <year> <domainName>`, built the same way as `projectTaskStoreNoteName`.
It is archived and tagged with `DASHBOARD_NOTE_TAG`.

There is one `##` section per local date, newest first. Each section has human-readable bullets followed by a compact
JSON fence for that date's machine data. The JSON is the source of truth, and the bullets are generated from it, so
editing a bullet never corrupts the ledger. Keeping a section per date means writes stay section-scoped: a quarter of
completions can exceed the 100k write limit, but a single day never will.

~~~markdown
# Completed Tasks by Project

Written by the Dashboard. Each completed task is listed under the day it was completed with the project it advanced.

## 2026-10-11

- Draft onboarding email sequence → **Launch onboarding v2**
- Renew passport → None

```json
{"schemaVersion":1,"entries":[{"taskUuid":"…","taskText":"Draft onboarding email sequence","completedAt":"2026-10-11T17:02:00.000Z","projectUuid":"…","classifiedBy":"link","confidence":null,"classifiedAt":"…"},{"taskUuid":"…","projectUuid":null,"classifiedBy":"decisions","confidence":0.82,"classifiedAt":"…"}]}
```
~~~

Each entry can later carry the commit 3 fields as well: `longTermUpside`, `shortTermImpact`, `potentialScoredAt`,
`priorVictoryValue`, `appliedVictoryValue`.

A completion is filed under the quarter it occurred in. When the seven-day window crosses a quarter boundary, the job
writes to both notes.

### New files

- `lib/dashboard/completed-task-project-ledger.js`: React-free reader/writer.
  - `completedTaskLedgerNoteName(scope)`
  - `readCompletedTaskLedger(app, scope)` returns `{ entriesByTaskUuid, noteHandle, content }` and never creates the
    note.
  - `writeLedgerDateSection(app, { content, noteHandle, dateKey, entries })` replaces or inserts one date section in
    date order and returns the updated content, mirroring `writeProjectSection`.
  - `ledgerDateSectionMarkdown(dateKey, entries, projectsByUuid)` renders the bullets and JSON.
- `lib/dashboard/completed-task-project-classification.js`: pure logic, testable without the queue.
  - `projectsWithExampleTasks(projects)` gives each active project its 3 highest-similarity open tasks. It ranks by
    `relatedTaskRecords[].matchScore`, falls back to `taskSimilarityScores`, and prefers directly linked tasks on ties.
  - `linkedProjectUuid(task, projects)` is the deterministic pass. If exactly one project claims the task through a
    direct link reason (assigned, primary note, or Plan Builder citation), the task is recorded with
    `classifiedBy: "link"` and is never sent to a model. A similarity-hash match counts only as a hint.
  - `classificationQuestions(tasks)` builds one `choice` question per task, named `task:<uuid>`, whose choices are
    each project's UUID (with its summary as `description`) plus `"none"`.
  - `classificationState({ projects, terms, tasks })` builds a state with projects (summary, intent text, 3 example
    tasks), the relevant dictionary terms, and the tasks being classified.
  - `classifiedEntries(response, tasks, { minimumConfidence })` treats any answer below the confidence threshold
    (start at 0.5) or outside the choices as `projectUuid: null`.
- `lib/dashboard/work-queue/jobs/classify-completed-tasks.js`: the handler.
  1. Read the active projects from the project store. If there are none yet, return `{ status: "superseded" }`; the
     next reconciliation-time submission retries.
  2. `app.getCompletedTasks(from, to, { taskDomainUUID })` for the past 7 days, using the same day boundaries as
     `weekBoundariesFromDateInput`.
  3. Drop tasks the ledger already holds. Run the deterministic link pass.
  4. Send the remaining tasks to the DecisionsEndpoint in batches of about 25, with `relevantDictionaryTerms` computed
     over the task and project text. Use `includeFastScore: false` at first (see risks), so that users with no decision
     model still get link-based entries and their remaining tasks wait.
  5. Write the affected date sections through the `write` permit.
  6. Return `{ classifiedCount, linkedCount, revision }`. Commit 3 adds `followUps` here.
- Additions to `project-job-requests.js`:
  - `CLASSIFY_COMPLETED_TASKS_JOB_TYPE`
  - `completedTaskClassificationRequest(input, { requestedAt })` with category `"maintenance"`, keyed per
    quarter/domain so that repeat submissions coalesce.
- `dashboard-work-handlers.js`: register the handler.
- `use-project-maintenance-queue.js`: submit the request alongside each reconciliation.

### Tests

- `test/completed-task-project-ledger.test.js`: section round-trip, date ordering, inserting a new date between
  existing ones, and an unreadable JSON fence reported rather than overwritten.
- `test/completed-task-project-classification.test.js`: example-task selection, the link pass skipping the model,
  and low-confidence or unknown choices becoming `null`.
- `test/classify-completed-tasks-job.test.js`: an injected `DecisionsEndpoint.fromRequester` checks batching,
  already-ledgered tasks not being re-sent, the quarter-boundary split, and the missing-configuration path.
- `npm run build` plus the production smoke test, since the handler joins the host graph.

---

## Commit 2: Victory Value colored by project

- `lib/dashboard/completed-task-project-colors.js` (React-free): `projectColorAssignments(projects)` gives each
  project a stable color slot by its plan order, so a project keeps its color from week to week. Unassociated tasks
  use the existing `--dashboard-color-background-accent`.
- Theme tokens: add 6 categorical colors (`--dashboard-color-category-1..6`) with light and dark values in the theme
  stylesheets. Projects past the sixth share the last slot, or we cap at 6 and fold the rest into "Other". Run the
  `dataviz` skill's palette validator when choosing the values.
- `lib/hooks/use-completed-task-projects.js`: reads the ledger (both quarters when the displayed week crosses a
  boundary) and returns `projectByTaskUuid`. It re-reads on `DASHBOARD_TASKS_UPDATED_EVENT` and when the
  classification job completes (subscribe through the work runtime's job-completion notification, if there is one;
  otherwise re-read on the maintenance interval).
- `dashboard.jsx`: pass `projectByTaskUuid` and `projectColors` into the Victory Value cell (`pickProps`).
- `victory-value.jsx`:
  - `buildDailyValuesForWeek` returns `segments: [{ projectUuid, value }]` per day, with "None" first so it sits at
    the bar's base.
  - `drawBars` draws stacked segments. Only the top segment gets rounded corners, and the total label stays where it
    is today.
  - The tooltip puts a color swatch and the project name on each task row.
  - A small legend row under the header shows only the projects present in the displayed week.
  - With no ledger data, the chart renders exactly as it does today.
- Tests: segment building from `completedTasksByDate` + `projectByTaskUuid`, the stable color assignment, and the
  tooltip HTML including the project name.

---

## Commit 3: Potential scoring and victory value raise

- Before starting, confirm `updateTask(uuid, { victoryValue })` against a real Amplenote session. Check that it
  returns `true` and that `getCompletedTasks` then reports the new value.
- `lib/dashboard/completed-task-potential.js` (pure):
  - `potentialQuestions(entries)` asks two `scoreQuestion`s per task: `upside:<uuid>` for "Long-term Potential
    Upside" and `impact:<uuid>` for "Short-term predicted impact", each with a 10-step criteria list.
  - `potentialState({ projects, terms, entries })` sends the projects, terms, and each task with the project it was
    associated with.
  - `raisedVictoryValue(entry, response, currentVictoryValue)` returns `upside + impact` when that exceeds the current
    value, otherwise `null`. It never lowers a value.
- `lib/dashboard/work-queue/jobs/score-completed-task-potential.js`: reads ledger entries that have a `projectUuid`
  and no `potentialScoredAt`. It asks the DecisionsEndpoint, fetches each task's current `victoryValue` fresh (this
  week's `getCompletedTasks`), and calls `app.updateTask` through the app dispatcher where the sum is higher. It then
  records the scores, `priorVictoryValue`, and `appliedVictoryValue` in the ledger, so a retry never asks or raises
  twice.
- The classification job returns `followUps: [completedTaskPotentialRequest(...)]` whenever it recorded at least one
  project-associated entry. The request is `"maintenance"` and keyed per quarter/domain, so it coalesces.
- After a raise, the Victory Value hook re-fetches the week's completed tasks so the bar heights update.
- Tests: question construction, the never-lower rule, idempotence on retry (`appliedRevision` from the ledger), and
  `updateTask` returning `false` (record and move on).

---

## Risks and open questions

1. **Can `victoryValue` be set?** The task-attributes appendix lists `victoryValue` but, unlike `score`, `important`,
   and `urgent`, does not say whether it can be set. If `updateTask` ignores it, there are two fallbacks: keep the
   computed value as `appliedVictoryValue` in the ledger and have the chart show `max(victoryValue,
   appliedVictoryValue)` (display only), or nudge `important`/`urgent` instead. Decide this before commit 3.
2. **Scale.** The sum of two 1–10 ratings runs 2–20. Check what range victory values typically fall in for this
   notebook. If most are under 5, nearly every project task gets raised, which may or may not be what you want.
3. **Fast-model fallback.** The `fastScorePromptBuilder` path is built for score questions. Commit 1 uses
   `includeFastScore: false`, so users without Jev, OpenAI, or Agent Pro get link-only classification. Adding a
   choice-capable fast prompt can be a follow-up.
4. **Domain filtering.** `useCompletedTasks` calls `getCompletedTasks(from, to)` without `taskDomainUUID`, so Victory
   Value shows completions from every domain while the ledger is per domain. Tasks from other domains render as
   "None" unless we either filter the chart by domain or read every domain's ledger.
5. **Backfill.** Only the past 7 days are classified, so earlier weeks render uncolored. A one-time backfill to the
   start of the quarter is cheap with decision models; it could run the first time the ledger is created.
6. **Note name.** The request said "Completed Task by Project"; this plan uses the plural, "Completed Tasks by
   Project". Settle it before commit 1, since renaming later orphans existing ledgers.
7. **Overlap with `QuarterProject.completedTasks`.** The project store already records completions it matched by
   link or similarity for progress evidence. Later, the ledger could become that evidence's source, so the two never
   disagree about which project a completion counted toward.
