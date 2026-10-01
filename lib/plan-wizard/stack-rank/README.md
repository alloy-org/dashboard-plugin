Rate how applicable each prospective task is to each current project, using TypeSafe's Jev decision model.

# Pipeline

```javascript
import { stackRankProjectTasks } from "plan-wizard/stack-rank/stack-rank-project-tasks";

const { dictionaryChanges, projectRankings } = await stackRankProjectTasks(app, { domainName, domainUuid });
// projectRankings: [{ failures, inputTokens, projectSummary, projectUuid,
//   rankedTasks: [{ confidence, noteName, rating, taskText, taskUuid }] }], highest rating first
```

1. `build-project-task-context.js` reads the quarter's active projects from the project task store, the note the
   background collection pass (`lib/dashboard/project-task-collection.js`) writes. It also opens
   `User terms dictionary {year}` and sends any project not yet listed under its `Examined projects` heading
   through term discovery.
2. `dictionary-term-discovery.js` asks the configured generative provider (the wizard's Agent Pro / direct provider
   race) which terms in those projects an outsider would misread. Jev can't take this step because it only rates
   and does not write text. A proposed term is kept only if it occurs in the wording of a project it was proposed
   for.
3. `stack-rank-project-tasks.js` rebuilds each project's prospective-task pool with the collection pass's own
   `_candidateTaskRecords`. That pool holds open tasks not already associated with the project, capped at the 40
   most recently updated.
4. `prospective-task-details.js` describes each pooled task: its note's name and tags, `isParent`, its parent task,
   and up to five child tasks. The task API exposes only `isParent`, so the outline is read from note markdown by
   indentation.
5. `rank-prospective-tasks.js` sends batches of 12 to Jev. Each batch is a single `state` holding the project, up to 8
   of its existing tasks, and the dictionary terms the batch mentions, plus one 1–10 `score` question per task.

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
