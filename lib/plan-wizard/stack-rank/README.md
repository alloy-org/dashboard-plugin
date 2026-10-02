Rate how applicable each prospective task is to each current project, using TypeSafe's Jev decision model. A Jev
Access Token uses that key. An installed Ample Agent Pro note is asked, through callPlugin, to call Jev's model at
Jev's URL. The generative provider's fast model rates only when neither of those is available and a provider key is.

# Pipeline

Two passes rank projects. The background collection pass (`lib/dashboard/project-task-collection.js`) ranks each
project it refreshes. Plan Builder runs `refresh-stale-project-rankings.js` on opening, because the background pass
stands down while the builder is open. Both passes prepare one ranker and then rank project by project:

```javascript
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";

const ranker = await prepareProjectTaskRanker(app, { domainName, domainUuid, projects, refineDictionary, tasks });
// null when no Jev key, Ample Agent Pro note, or generative provider is available
const { acceptedTasks, failureReason, minimumMatchScore } = await ranker.rankProject(project, matchedTaskRecords);
```

1. `build-project-task-context.js` opens `User terms dictionary {year}`. Any project not yet listed under its
   `Examined projects` heading goes through term discovery first. Plan Builder skips this step while it is waiting
   on the generative provider. Its hook waits until the builder is idle before starting.
2. `dictionary-term-discovery.js` asks the configured generative provider (the wizard's Agent Pro / direct provider
   race) which terms in those projects an outsider would misread. Jev can't take this step because it only rates
   and does not write text. A proposed term is kept only if it occurs in the wording of a project it was proposed
   for.
3. `stack-rank-project-tasks.js` draws each project's pool with `dashboard/project-candidate-tasks.js`, the same
   rule the generative provider's pool uses. The pool holds open tasks not already associated with the project,
   capped at the 500 most recently updated for Jev, or the 150 most recently updated for the fast model. Task
   details are cached across the pass's projects.
4. `prospective-task-details.js` describes each pooled task. The details are its note's name, tags, and last-opened
   date, `isParent`, its parent task, and up to five child tasks. The task API exposes only `isParent`, so the
   outline is read from note markdown by indentation. The API has no view counts; the note's last-opened date is the
   closest available signal.
5. `rank-prospective-tasks.js` sends batches of 20, four at a time. Each batch is a single `state` holding the
   project, up to 8 of its existing tasks, and the dictionary terms the batch mentions, plus one 1–10 `score`
   question per task. With the fast model, batches are 25 tasks, two at a time (see **Fast-model rating** below).
6. `project-match-scores.js` picks the accepted tasks:
   - By default a project accepts tasks rated 5 or higher.
   - A project with more than 20 such tasks raises its minimum to 7. If nothing rates 7, it keeps its top 20 at 5.
   - A project with nothing at 5 takes up to three tasks rated 3 or higher.
   - When some batches failed, the project's stored minimum applies instead.

   Each project's minimum is saved in the `dashboard_project_match_scores` setting, keyed by domain, then quarter,
   then project. Dashboard load drops ended quarters, the way it does for the Quarterly Planning checkboxes.

Accepted tasks join the project's `relatedTaskRecords` with their `matchScore`. Tasks rated 5 or higher are also
added to `relatedTasks`, so the project keeps them. Fallback leads are rated again on the next pass. When Jev ranks
a project, the generative provider gets no attribution pool and only suggests ideas. If ranking fails outright, the
provider attributes tasks as it did before Jev.

Each project's section in the project task store note keeps Jev's ratings in a code block, under the line
`Jev ratings of tasks the project did not keep, by checksum:task UUID:`. The block holds one line of JSON:

```
{"3f9a01c2:5e1b…":1.1,"b7d4e590:a20c…":4.4}
```

The checksum digests the project's summary together with the task's text (`task-rating-cache.js`), so rewording
either one invalidates the rating and the task is rated again. A task with a valid rating is not sent to Jev. The
ratings are sparse: a task the project keeps (accepted at 5 or higher) appears only in the bullet list and is never
written to the block, and a rating is dropped once its task leaves the pool, for example when the task is completed
or edited.

Cost: a live 20-task batch used about 320 input tokens per task, so a project's first ranking over a full 500-task
pool is roughly 160k input tokens. Later rankings send only new or edited tasks.

# Fast-model rating

Without a Jev key and without Ample Agent Pro, `prepareProjectTaskRanker` rates with the generative provider's fast
model instead, provided a provider key is set. `generative-task-scores.js` renders the same state and score
questions a Jev batch carries as one prompt, using the same rubric, and asks for `{ "ratings": { "task_1": 7, … } }`.
It sends the prompt through `raceWizardPrompt` with `wizardLlmOptions`, the fast model Plan Builder uses. The reply is
converted to Jev's zero-indexed score answers, so the rating cache, thresholds, and stored ratings work as they do
for Jev. A rating outside 1–10, or one the reply leaves out, leaves that task unrated.

Because a generative prompt costs far more per task, the pool is capped at 150 tasks. In Plan Builder, a fast-model
pass also stops before its next project once the builder is waiting on the provider again, so rating never delays a
page the user is on. Ratings from either rater share one cache, so a Jev key added later rates only tasks that are
new, edited, or newly inside its larger pool.

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
