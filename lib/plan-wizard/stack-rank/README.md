Rate how applicable each prospective task is to each current project, using TypeSafe's Jev decision model. A Jev
Access Token uses that key. An installed Ample Agent Pro note is asked, through callPlugin, to call Jev's model at
Jev's URL. The generative provider's fast model rates only when neither of those is available and a provider key is.

# Pipeline

Dashboard and Plan Builder share one durable work queue. Its `reconcileProjects` job plans one `rankProjectTasks`
job per due project: stale or never-ranked projects, edited tasks, unscored cited tasks, changed dictionary terms,
and projects due a second search page. Each ranking yields between batches and saves progress. Nested provider
requests share the runtime's limits; repository writes serialize each project's section update.

Builder retains its selected quarter on the shared scheduler and requests reconciliation at foreground priority.
Closing Builder releases that extra scope, leaving unfinished records for reopening. Disabling durable work pauses
project maintenance; it does not start another ranking loop. Reconciliation also removes low uncited cached scores
without a provider request, preserving cited scores and similar tasks. See
`lib/dashboard/work-queue/quarter-project-work-planner.js` and `jobs/rank-project-tasks.js`.

```javascript
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";

const ranker = await prepareProjectTaskRanker(app, { domainName, domainUuid, projects, refineDictionary, tasks });
// null when no Jev key, Ample Agent Pro note, or generative provider is available
const { acceptedTasks, failureReason, minimumMatchScore } = await ranker.rankProject(project, matchedTaskRecords);
```

1. `build-project-task-context.js` opens `User terms dictionary {year}`. Any project not yet listed under its
   `Examined projects` heading goes through the queue's term-discovery job first. Builder requests reconciliation
   when its provider is idle; subsequent jobs share the runtime's provider limits.
2. `dictionary-term-discovery.js` asks the configured generative provider (the wizard's Agent Pro / direct provider
   race) which terms in those projects an outsider would misread. Jev can't take this step because it only rates
   and does not write text. A proposed term is kept only if it occurs in the wording of a project it was proposed
   for.
3. `stack-rank-project-tasks.js` draws each project's pool with `dashboard/project-candidate-tasks.js`, the same
   rule the generative provider's pool uses. The first ranking holds open tasks not already associated with the
   project, capped at the 500 most recently updated for Jev, or the 150 most recently updated for the fast model.
   A project that already has `lastRankedAt` submits only tasks created after that time. A cited task with no
   similarity score is still submitted, and so is every open task in the project's similarity hash (see below).
   Task details are cached within each ranker; queued jobs share the runtime's task reads.
4. `prospective-task-details.js` describes each pooled task. The details are its note's name, tags, and last-opened
   date, `isParent`, its parent task, and up to five child tasks. The task API exposes only `isParent`, so the
   outline is read from note markdown by indentation. The API has no view counts; the note's last-opened date is the
   closest available signal.
5. `rank-prospective-tasks.js` sends batches of 20, four at a time. Each batch is a single `state` holding the
   project, up to 8 of its existing tasks, and the dictionary terms the batch mentions, plus one 1–10 `score`
   question per task. With the fast model, batches are 25 tasks, two at a time (see **Fast-model rating** below).
6. `project-match-scores.js` picks the accepted tasks:
   - By default a project accepts tasks rated 6 or higher.
   - A project with more than 20 such tasks raises its minimum to 7. If nothing rates 7, it keeps its top 20 at 6.
   - A project with nothing at 6 takes up to three tasks rated 3 or higher.
   - When some batches failed, the project's stored minimum applies instead.

   Each project's minimum is saved in the `dashboard_project_match_scores` setting, keyed by domain, then quarter,
   then project. Dashboard load drops ended quarters, the way it does for the Quarterly Planning checkboxes.

Accepted tasks join the project's `relatedTaskRecords` with their `matchScore`. When Jev ranks a project, the
generative provider gets no attribution pool and only suggests ideas. If ranking fails outright, the provider
attributes tasks as it did before Jev.

# Similarity hash

Each project's section in `Project Tasks Q{n} {year} {domain}` holds its similarity scores in one code block under
`Task similarity scores, by checksum:task UUID, sorted by task UUID:`:

```
{"3f9a01c2:0b7e…":7.4,"9c21d0e4:5e1b…":2.1}
```

The checksum digests the project's summary together with the task's text (`task-rating-cache.js`). The hash holds
every task rated 6 or higher, plus the tasks the sources page cites, whatever their score. Each ranking re-checks the
hash's open tasks. A task whose text is unchanged is read from the hash. A task that was edited gets a new key, so
it is rated again, and it leaves the hash if it now rates below 6. Low scores for tasks the page does not cite are
dropped during reconciliation when the Vision Guide is available.

The hash is the only place a score is stored. The payload's `relatedTasks` leaves out the tasks the hash rates
similar, and `QuarterProject#matchesTask` counts those tasks toward the project's progress. The existing tasks are written
once, as the `Existing tasks` list, and read back from that list's task links. Sections written before the hash
existed are read as before. Their kept tasks' `matchScore`s and their `Jev ratings…` block fold into the hash on the
next write.

The sources page leaves out cited tasks rated below 6, both from the project's task count and from the list it
opens to. Tasks not yet rated are still shown.

# Search depth

The first ranking searches one page: the 500 most recently updated open tasks for Jev, or 150 for the fast model.
The section records `similaritySearchedTaskCount` and `similaritySearchPageCount`, and shows the first as `- Searched
N tasks for similarity`. A project whose first page was full is due a second page once, under these conditions:

- Jev: it found no task rated 6 or higher.
- Fast model: it found fewer than three, and the tasks created since its last ranking would not fill a page.

The second page is the next 500 (or 150) most recently updated open tasks, whatever their age, sent alongside the
tasks created since the last ranking. The searched count then reads 1000 (or less, when fewer tasks exist). A
project ranked before the count was recorded is assumed to have searched one full page.

Cost: a live 20-task batch used about 320 input tokens per task, so a project's first ranking over a full 500-task
pool is roughly 160k input tokens, and a second page as much again. Later rankings send only tasks created since
`lastRankedAt`, plus cited tasks that still have no score and edited tasks from the hash. A batch that fails leaves
`lastRankedAt` and the search progress unchanged, so the missed tasks are sent again.

# Fast-model rating

Without a Jev key and without Ample Agent Pro, `prepareProjectTaskRanker` rates with the generative provider's fast
model instead, provided a provider key is set. `generative-task-scores.js` renders the same state and score
questions a Jev batch carries as one prompt, using the same rubric, and asks for `{ "ratings": { "task_1": 7, … } }`.
It sends the prompt through `raceWizardPrompt` with `wizardLlmOptions`, the fast model Plan Builder uses. The reply is
converted to Jev's zero-indexed score answers, so the rating cache, thresholds, and stored ratings work as they do
for Jev. A rating outside 1–10, or one the reply leaves out, leaves that task unrated.

Because a generative prompt costs far more per task, the pool is capped at 150 tasks. Ranking yields between batches;
the queue admits nested provider calls through its shared budget and reserves generative capacity for foreground
requests. Ratings from either rater share one cache, so a Jev key added later rates only tasks that are new, edited,
or newly inside its larger pool.

# User terms dictionary

The note is archived, tagged `plugins/dashboard`, and seeded with `Amplenote` and `Dashboard`. Each bullet reads
`- **Term**: definition`. A bullet ending in `[builder]` is plugin-owned and may be refined in place. A bullet
without that marker belongs to the user and is never rewritten. Definitions have their Rich Footnotes resolved
before they are sent anywhere.

# Jev

`lib/providers/jev-client.js` posts to System One. Jev numbers a rubric from zero, so a rating is `score + 1`. It
can fall between whole numbers. The live API rejects `null` rubric entries even though the SDK's types allow them.

TypeSafe's endpoint refuses browser origins: its CORS preflight returns 400 for amplenote.com, `null`, and
localhost. **Jev Access Token**, entered by choosing Jev in Dashboard Settings' LLM Provider dropdown, accepts either key:

- An OpenRouter key (`sk-or-…`) goes straight to OpenRouter's `/api/v1/systemone`, which allows any origin.
- From a browser, a TypeSafe key goes through `aged-sunset-proxy.amplenote.workers.dev`, the Worker Ample Agent Pro
  uses for Tinify, as `?apiurl=https://api.typesafe.ai/v1/systemone`. An installed Ample Agent Pro note is not sent there: Agent Pro
  receives the System One body, the model `jev-latest`, and `https://api.typesafe.ai/v1/systemone`.
- From Node, a TypeSafe key goes to TypeSafe directly. That is how `test/stack-rank.test.js` makes its live call when
  `JEV_ACCESS_TOKEN` is set in `.env`.

In the dev environment, `JEV_ACCESS_TOKEN` from `.env` is injected into the bundle and used whenever the setting is
empty.
