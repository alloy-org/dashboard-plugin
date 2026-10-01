Rate how applicable each prospective task is to each current project, using TypeSafe's Jev decision model.

# Pipeline

Two passes rank projects. The background collection pass (`lib/dashboard/project-task-collection.js`) ranks each
project it refreshes. Plan Builder runs `refresh-stale-project-rankings.js` on opening, because the background pass
stands down while the builder is open. Both passes prepare one ranker and then rank project by project:

```javascript
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";

const ranker = await prepareProjectTaskRanker(app, { domainName, domainUuid, projects, refineDictionary, tasks });
// null when no Jev Access Token is set
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
   capped at the 500 most recently updated. Task details are cached across the pass's projects.
4. `prospective-task-details.js` describes each pooled task. The details are its note's name, tags, and last-opened
   date, `isParent`, its parent task, and up to five child tasks. The task API exposes only `isParent`, so the
   outline is read from note markdown by indentation. The API has no view counts; the note's last-opened date is the
   closest available signal.
5. `rank-prospective-tasks.js` sends batches of 20, four at a time. Each batch is a single `state` holding the
   project, up to 8 of its existing tasks, and the dictionary terms the batch mentions, plus one 1–10 `score`
   question per task.
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

Cost: a live 20-task batch used about 320 input tokens per task, so a full 500-task pool is roughly 160k input
tokens per project.

# User terms dictionary

The note is archived, tagged `plugins/dashboard`, and seeded with `Amplenote` and `Dashboard`. Each bullet reads
`- **Term**: definition`. A bullet ending in `[builder]` is plugin-owned and may be refined in place. A bullet
without that marker belongs to the user and is never rewritten. Definitions have their Rich Footnotes resolved
before they are sent anywhere.

# Jev

`lib/providers/jev-client.js` posts to System One. Jev numbers a rubric from zero, so a rating is `score + 1`. It
can fall between whole numbers. The live API rejects `null` rubric entries even though the SDK's types allow them.

TypeSafe's endpoint refuses browser origins: its CORS preflight returns 400 for amplenote.com, `null`, and
localhost. Inside Amplenote, set **Jev Access Token** to an OpenRouter key (`sk-or-…`), which routes to OpenRouter's
`/api/v1/systemone`. That route allows any origin. A TypeSafe key works from Node, which is how
`test/stack-rank.test.js` makes its live call when `JEV_ACCESS_TOKEN` is set in `.env`.
