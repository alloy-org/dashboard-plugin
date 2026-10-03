<!-- Implementation plan for progressively refreshing Dashboard knowledge and suggestions. -->
# Dashboard background work queue implementation plan

Recommend one resumable work coordinator, shared by Dashboard and Plan Builder, which runs small jobs after the
Dashboard is usable. Keep the existing Project Tasks and dictionary notes as durable results. Show cached suggestions
immediately, refresh their inputs progressively, and publish replacements without making widget load depend on LLMs.

This plan is based on the working tree inspected October 3, 2026, including the existing uncommitted changes to project
ranking and storage. It proposes implementation; the queue and behavior changes described below have not been built.

## Existing behavior and missing pieces

| Requested behavior | Present in the working tree | Work still needed |
| --- | --- | --- |
| Discover and refine notebook terms | An annual dictionary, protected user definitions, term discovery from project and task text, relevant definitions supplied to ranking | Revisit changed task evidence; search notebook content for richer definitions; record evidence and refinement freshness independently of discovery |
| Refresh project similarity | Jev, Agent Pro delegation, and generative fallback; checksum cache; incremental task pools; limited deeper search for empty projects | Reliable new and edited task triggers; context-aware cache invalidation; per-visit coverage target; resumable batches and global request limits |
| Generate and rate novel tasks | Up to three ideas per generation, stored per project, with refinement of prior ideas | Explicit Intent context and completed task text; stable idea identity; independent actionability ratings; inclusion in the main daily ranking path |
| Refresh Dream Task from projects | Cached daily note, project-based ranking, reserves, completion checks, generative fallback | Prepare suggestions in the background; invalidate by source revisions; support rated ideas; separate preparation from recording exposure |
| Refresh Proposed Agenda from projects | Persistent agenda cache, project ranking, free-time placement, reserves, reconciliation, Calendar reuse | Background preparation and shared freshness rules; rated ideas in the primary ranking path; preserve decisions during refresh |

The key implementation points are:

- [`use-project-task-collection.js`](../lib/hooks/use-project-task-collection.js) starts once per mounted Dashboard,
  four seconds after `handleDashboardSettled`. An overlay can cancel that opportunity without resuming on close.
  [`project-task-collection.js`](../lib/dashboard/project-task-collection.js) prepares the dictionary/ranker, then
  ranks and generates ideas for each project before writing its section.
- [`project-refresh-schedule.js`](../lib/dashboard/project-refresh-schedule.js) refreshes every project older than
  72 hours without a time-budget stop. Otherwise it visits at least one project and continues within a 20-second
  admission budget. That does not implement the requested minimum number of projects per visit.
- [`use-project-task-ranking.js`](../lib/hooks/use-project-task-ranking.js) starts a separate Plan Builder pass
  after three seconds without a provider request. The service can run six Jev projects concurrently, each with up
  to four rating batches. Its write chain coordinates that pass only.
- [`build-project-task-context.js`](../lib/plan-wizard/stack-rank/build-project-task-context.js) discovers terms only
  for previously unexamined project summaries. An unchanged summary hides changed tasks and weak existing definitions.
- [`stack-rank-project-tasks.js`](../lib/plan-wizard/stack-rank/stack-rank-project-tasks.js) selects new candidates by
  creation time after `lastRankedAt` and rechecks retained similar tasks by checksum. An old, edited task whose low
  score was discarded can be missed. The checksum covers project summary and task text, but not dictionary or other
  context supplied to the model. The Builder's due-project selection also needs explicit change triggers.
- [`project-task-ideas.js`](../lib/dashboard/project-task-ideas.js) receives open tasks and plan prose, but its prompt
  does not include completed task text. Completion records currently preserve UUID and date, rather than text.
- [`day-project-candidates.js`](../lib/dashboard/day-project-candidates.js) draws from existing task records;
  [`ranked-task-suggestions.js`](../lib/dashboard/ranked-task-suggestions.js) makes Dream Task cards with
  `isExisting: true`. Stored ideas can reach fallback agenda generation, but cannot compete in this primary path.
- [`wizard-prompt-runner.js`](../lib/plan-wizard/wizard-prompt-runner.js) races Agent Pro and the direct provider,
  leaving the losing request running. Reusing that runner for every maintenance job can spend two requests per job.

## Coordinator and execution model

Use a plain JavaScript coordinator with injected clock, storage, app interface, and provider request functions.
One React hook supplies Dashboard lifecycle signals. Plan Builder submits work and foreground-busy signals to the
same coordinator instead of starting an independent maintenance loop. Keep shared services React-free so Calendar's
host action can read the same prepared results without importing hooks or browser APIs.

Make one job one resumable unit: one dictionary discovery batch, one term's evidence lookup, one definition refinement,
one project's rating batch, one project's idea generation, one idea-rating batch, or one day's suggestion preparation.
A large project yields between batches. Dictionary enrichment and idea generation no longer block saving completed
similarity work. Existing dictionary definitions remain usable while better definitions are being prepared.

The dependency sequence is:

1. Reconcile projects and task changes, producing a versioned input snapshot.
2. Schedule similarity refresh and dictionary work independently against the latest usable dictionary.
3. Schedule idea generation when project evidence is ready, with persisted older evidence permitted if still valid.
4. Schedule actionability rating for newly generated or changed ideas.
5. Invalidate the affected day's candidate ranking and prepare Dream Task and agenda results.

Dictionary improvements may make an affected project's scores stale; enqueue one replacement rating job. Debounce and
coalesce invalidations so one burst of updates produces one preparation run. Do not require all projects, terms, or
ideas to be current before any useful suggestion becomes available.

### Scheduling and responsiveness

Retain the existing settled callback and four-second grace period as the initial maintenance gate. Change widget
loading so a cache result or a usable empty state counts as settled even while suggestions are being prepared; a
widget must never wait for a job that itself waits for that widget to settle. A cold visible widget may request a
high-priority preparation job after first render.

Use the following initial policies, then tune them from measurements:

| Resource or concern | Proposed policy |
| --- | --- |
| Interactive work | User-requested refresh and missing visible suggestions take priority; pause new maintenance requests while Plan Builder awaits generation |
| Generative requests | One background request globally per coordinator; use one provider path, then sequential fallback on failure |
| Jev requests | Four background batch requests globally, shared across projects; reduce concurrency during interaction |
| Note and task reads | At most two background reads in flight; reuse the current domain snapshot and cache note details within a pass |
| Writes | One writer per destination note within an execution context; all relevant callers use it |
| Browser work | Yield between short local chunks; a proposed 5–10 ms chunk target avoids long synchronous parsing or hashing |
| Idle continuation | Admit work in roughly 20-second windows, then recheck visibility, foreground demand, and budget before continuing |

The 20-second window is an admission policy, not a deadline for a request already in flight. Abort supported direct
requests when appropriate; stopping a wait does not imply an Agent Pro call stopped. Apply finite deadlines, discard
late results from superseded attempts, and avoid immediate duplicate retries after an ambiguous timeout.

Use idle callbacks only as an optional browser adapter for local work. They do not make network requests cheaper or
guarantee execution. Stop admitting maintenance when hidden or unmounted; resume on visibility, overlay close, new
task evidence, or the next Dashboard visit. A domain/quarter switch activates a new scoped queue and prevents old
results from reaching its UI. Run a bounded snapshot reconciliation on a long-lived visible Dashboard, initially
every five minutes when foreground work is idle, because local events do not capture edits from other clients.

Use weighted fairness within background work: allocate most rating opportunities to the project coverage target,
but reserve progress for dictionary and idea work. Raise the priority of jobs that have waited across visits. A
failed or unusually large project must not prevent other projects from advancing.

### Project coverage per visit

For N active projects, target `min(N, max(5, ceil(N / 2)))` distinct completed project refreshes per Dashboard visit.
Define a visit as a mounted Dashboard session, with coverage scoped to the active domain and quarter. A rerender or
overlay close resumes that session; it does not reset coverage. Track checked, rated, successful, and failed counts
separately. A current project with no changed inputs can complete a freshness check without a redundant provider call.

Prioritize changed projects, never-ranked projects, projects with no usable tasks, then oldest successful refresh.
Continue across multiple admission windows to reach the target. If the user closes the Dashboard or a provider is
unavailable, persist unfinished work for the next opportunity. No in-app queue can guarantee five completed remote
calls during a two-second visit. Do not let the old catch-up regime bypass resource limits.

### Persistence and recovery

Persist work descriptions and checkpoints; reconstruct executable functions from a job-type registry. Use an archived
`Dashboard Work Queue` note per domain and quarter for compact job records, while term jobs use annual dictionary scope
so multiple domains do not independently refine the same term. Keep outputs in their existing notes. A settings value
can point to the queue note, but avoid rewriting a large queue through a settings snapshot on every transition.

Each record needs a schema version, stable job key, type, scope, entity ID, desired input revision, status, priority,
enqueue time, attempt count, next eligible time, successful revision/time, cursor, and last failure. Running records
also carry an owner ID, attempt token, and expiry. Keep prompts and full task snapshots out of queue metadata; durable
input evidence lives in the source stores. Prune terminal records after a short diagnostic retention period.

Coalesce pending jobs by type/scope/entity; replace their desired revision when inputs change. Keep at most the current
attempt and its replacement. A job can be pending, running, waiting for retry, blocked on configuration, completed,
or superseded. Back off transient failures with jitter and honor rate-limit delays; missing credentials wait for a
settings change. Valid empty results get their own freshness/cooldown rather than being retried as errors.

Persist results and their input revision before acknowledging job completion. If execution stops between those steps,
the next runner recognizes the already-written revision and completes the job without another provider call. Checkpoint
successful rating batches; advance the project watermark only after all required batches complete. Keep `lastAttemptedAt`
distinct from `lastSucceededAt`, and track dictionary, similarity, ideas, and daily preparation separately.

Use an in-memory single-flight registry and a shared note-write queue within each execution context. Re-read the latest
project section before applying a field-level result patch; never write a whole project object captured before an LLM
request. Validate input revision and attempt token again before publishing. Dictionary commits must recheck ownership
so a user removing `[builder]` during generation protects that definition.

Across embeds/devices, an expiring claim is only best-effort coordination. The documented note API does not expose a
compare-and-swap transaction; synchronized settings also are not a mutex and may remain stale until the next plugin
invocation. Treat execution as at least once, make result application idempotent, and merge/reconcile rather than
claiming exactly-once behavior. Read-merge-write still has a cross-device race window. If strict exclusion becomes a
requirement, add a transactional server coordinator as a separate architecture change. See the
[Amplenote app API](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface).

## Dictionary discovery and refinement

Separate discovery from enrichment. Discovery tracks a digest of project wording plus relevant high-rated task text,
instead of permanently marking a summary examined. Cover the current quarter first. Keep the existing ownership
convention and Rich Footnote resolution.

When new vocabulary coverage is adequate, spend the dictionary allocation refining a small number of frequently used,
poorly evidenced, or old definitions. Start with one or two terms per visit and a seven-day refinement cooldown;
new source evidence can invalidate that cooldown. These are proposed defaults, not measured optimal values.

For each selected term:

1. Search the quoted term, with an unquoted fallback when necessary. Verify exact-phrase behavior in integration
   tests; the API documents a query string but does not guarantee special quoting semantics.
2. Read a bounded set of best matching notes and extract 5–10 contextual passages across distinct sources. The
   [search API](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface#app.searchNotes) returns note
   handles, not snippets, so passage extraction requires separate content reads.
3. Resolve full multiline Rich Footnote definitions before excerpting. Exclude the generated dictionary and generated
   suggestion/cache notes as evidence so a tentative definition cannot corroborate itself. Deduplicate copied passages
   and cap prompt size while retaining source links and any relevant footnote code/prose.
4. Ask for a concise definition, supported relationships to projects, source references, and explicit uncertainty.
   Require improvement supported by the supplied evidence; keep the old definition if evidence is weak or conflicting.
5. Store source UUIDs/content digests, an evidence-quality category, and `lastRefinedAt`. Increment a term revision
   only when its semantic definition changes, not when a timestamp changes.

Include the relevant dictionary revision in rating freshness. Refresh affected project/task pairings progressively;
changing an unrelated term should not invalidate every score in the notebook.

## Similarity changes and task evidence

Maintain a compact task evidence index per domain: task UUID, content/context digest, observed status, and change
sequence. Compare refreshed snapshots to detect new, edited, reopened, completed, or dismissed tasks. Use the existing
`dashboard:tasks-updated` event for immediate invalidation, plus snapshot comparison for external edits. Missing data
from a partial or failed fetch must not be interpreted as deleted tasks.

Each project records the last fully processed change sequence. A changed old task must be eligible even if its previous
low similarity score was discarded. Split a large change set into batches and preserve each batch's success; retain
change evidence until active consumers have advanced, or force a reconciliation scan if history was compacted.

Version the score context with project meaning/Intent, relevant dictionary definitions, provider/model and rubric,
and the task evidence actually used. Continue rendering similarity as the existing `checksum:taskUuid` map, with a
separate context revision in metadata. Do not assume that an unchanged task string means an unchanged rating context.

For projects with no usable open tasks, schedule deeper discovery and idea generation with a cooldown. Keep the current
bounded deeper-search behavior initially, but do not repeatedly resubmit the same exhausted page on every visit.
Persist completed task text and source note identity alongside date and UUID when available. Backfill existing
completion records gradually; missing historical text stays explicitly unavailable rather than being invented.

## Novel task generation and rating

Extend the existing idea generator with explicit selected Intent → project → evidence context. Supply high-similarity
open tasks, all known completion records with available text, existing ideas, and accepted/rejected idea history.
For unusually large completion histories, use checkpointed chunks and a cached summary covering older records, while
keeping recent and relevant verbatim tasks. Do not silently truncate the history and call it complete.

Persist ideas separately from existing-task similarity scores. Each idea needs stable `ideaId`, project ID, text,
generation time, source revision, optional superseded idea ID, status, and rating metadata. Render readable bullets
with actionability scores in the existing Suggested tasks section; retain structured metadata for round trips.
Existing text-only suggestions migrate as unrated ideas. A text change invalidates its rating.

Queue an independent Jev or generative actionability pass after generation. Measure whether the action is specific,
feasible, unblocked, and startable in one work block. Also require project relevance and exclude duplicates of open or
completed work. Keep actionability, project similarity, and suitability today as separate concepts: a similarity 9
does not imply an actionability 9. Normalize provider scale handling in one adapter.

Use a candidate identity such as `task:<uuid>` or `idea:<ideaId>` through daily ranking, reserves, history, dismissal,
and selection. Never present an idea ID as an Amplenote task UUID. Extend the current UUID-only response parsing and
Dream Task's `isExisting` mapping to carry this distinction. Calendar already supports a new-task suggestion shape.

Start with an explicit, tunable eligibility threshold, for example actionability at least 7/10 plus sufficient
project relevance. Let eligible ideas compete in the daily ranking; prefer an existing task on otherwise comparable
scores. Explain why a novel action is useful. Materialize it as a real task only on user acceptance, record its resulting
task UUID, and reconcile duplicate acceptance/retry paths before inserting again. A dismissed idea should not reappear
under a trivial rewording.

## Prepared Dream Task and Proposed Agenda

Refactor the existing generators into three operations: prepare candidates/results, read valid prepared results, and
record an actual presentation or decision. Preparation must not append the “suggested” history: today some ranking
helpers record exposure as part of building their return value. Prefetching through those helpers would wrongly make
unseen tasks look recently recommended.

Share the expensive per-day candidate ranking between Dream Task, Proposed Agenda, and Calendar when scope and
recommendation context match. Keep separate presentation rules: Dream Task chooses its cards and reserves; the agenda
places tasks into available hours; Calendar uses the agenda path. Reuse existing caches and their reconciliation logic.

Cache keys must include stable domain identity, enabled plan quarters, local target date/timezone, project/task/idea
revisions, recommendation settings and context, and relevant decision history. Occupied times and current time also
affect agenda placement. Preserve support for multiple enabled quarters; do not collapse all work into the wall-clock
quarter when preparing a future date.

On load, show available cached content after lightweight native-task checks. A stale knowledge revision requests
background refresh while useful suggestions remain visible. A hard invalidation such as completed/dismissed work,
changed scope, or an occupied time slot removes or reconciles the affected item immediately. A cold cache displays a
usable empty/loading state without holding the Dashboard's settle signal open.

After a meaningful source revision, debounce one preparation job for today. Prepare tomorrow or a visible Calendar
date range only after today's needs and project coverage are served. Avoid a full regenerate after every project batch.
Keep displayed cards stable while the user acts; top up missing cards or offer refreshed results rather than constantly
reordering. Preserve accepted, scheduled, and dismissed items when merging newly prepared agenda suggestions. Recheck
live task state and occupied time at display/acceptance, since precomputation cannot guarantee current availability.

Calendar host invocations read persisted results and can perform bounded foreground preparation on a miss. Do not
assume timers or detached promises survive an embed closing or a host invocation returning. Durable pending work resumes
at the next authorized plugin execution opportunity.

## Implementation order and verification

1. **Coordinator and storage foundation.** Add small React-free modules under `lib/dashboard/work-queue/` for policy,
   runner, repository, and shared write coordination, plus `use-dashboard-work-queue.js`. Adapt both existing refresh
   entry points to enqueue jobs and retire their independent loops. Add resource admission at actual provider/bridge
   calls so nested helpers cannot bypass limits. Preserve existing output schemas initially.
2. **Project freshness and coverage.** Extract a resumable project/batch rating operation; add task-change reconciliation,
   per-project successful watermarks, context revisions, and the coverage target. Reuse task details across projects.
3. **Dictionary enrichment.** Add evidence lookup and definition-refinement jobs, ownership-aware writes, provenance,
   and targeted rating invalidation. Keep discovery independently schedulable.
4. **Rated ideas.** Extend completion evidence and idea persistence, add the actionability rubric, then support mixed
   existing/generated candidates throughout ranking, reserves, and acceptance. Keep legacy records readable.
5. **Prepared suggestions.** Separate preparation from exposure, add shared daily ranking persistence, and connect
   invalidations to Dream Task, Proposed Agenda, and Calendar with stable visible state.

Ship each phase behind a queue enable setting until its output and performance are verified. Never run the legacy
maintenance loops and queue for the same scope simultaneously. A rollback may use retained output notes without
running pending jobs from the new queue.

Use deterministic clock/provider tests for priority, global concurrency, fairness, budget yielding, the project quota,
overlay resume, domain switches, and failures isolated to one job. Simulate interruption after result persistence but
before acknowledgement, expired claims, concurrent result patches, and obsolete responses. Verify that a write failure
does not poison later jobs and that duplicate execution does not duplicate ideas or recorded completions.

Regression scenarios should cover a low-rated old task edited into a good match, new tasks during the 72-hour window,
dictionary changes invalidating scores, user-owned definition protection, full Rich Footnote evidence, unrated idea
migration, rejected ideas, acceptance retries, and a project with completions but no open tasks. Ensure preparation never
records exposure, foreground cache hits make no generative request, cold caches do not deadlock settling, and refreshed
agendas preserve decisions and avoid new conflicts. Extend the existing stack-rank, project-task-store, ranked-task-
suggestions, Dream Task, and Proposed Agenda suites where those behaviors already belong.

Instrument time to first usable Dashboard, widget cache-hit latency, foreground provider wait, background request
counts/durations, distinct project coverage, successful refresh age, queue age by job type, retry counts, and request
token usage. Compare queue enabled/disabled on the same seeded notebook, including mobile-sized task sets and slow
provider responses. The acceptance criterion is no maintenance provider work before the load gate, no foreground
request waiting behind newly admitted maintenance, and no material regression in measured first usable load latency.
Track an already-running non-cancellable request separately; priority cannot retroactively preempt it.

Run focused Jest suites with `NODE_OPTIONS=--experimental-vm-modules` during implementation. For shared services or host
imports, finish with `npm run build` and the production smoke test:
`NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --runTestsByPath test/production-plugin.test.js --no-coverage`.

The first milestone should deliver resumability, shared request limits, and reliable project coverage. Those changes
make every later improvement safe to run progressively without putting it on the user's Dashboard loading path.
