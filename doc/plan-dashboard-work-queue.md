<!-- Implementation plan for scheduling Dashboard component mounts, project knowledge, and suggestions. -->
# Dashboard background work queue implementation plan

Recommend one work scheduler, shared by Dashboard and Plan Builder, with an urgent, transient lane for mounting
components and durable lanes for progressively refreshing project knowledge and suggestions. Urgent mounts start
before Dashboard settles and whenever the user scrolls; maintenance starts after the Dashboard is usable.
Instantiate `QuarterProject` at every project data boundary and update owned instances through its setters.
Keep the existing Project Tasks and dictionary notes as durable results, with cached suggestions serving widgets.

This plan is based on the working tree inspected October 3, 2026, including the revised mutable `QuarterProject` class
and its separate serialization module. It proposes implementation; the scheduler, class extensions, and behavior
changes described below have not been built. Existing classes/files and proposed additions are identified separately
in the implementation inventory. The implementation phases below define independent human-reviewed commit boundaries.

## Existing behavior and missing pieces

| Requested behavior | Present in the working tree | Work still needed |
| --- | --- | --- |
| Mount newly visible components promptly | Per-widget viewport observation, placeholders, mount-once behavior, and overlay suspension | Shared mount admission, visible versus near-viewport priority, cancellation, and coordination with background resource use |
| Discover and refine notebook terms | An annual dictionary, protected user definitions, term discovery from project and task text, relevant definitions supplied to ranking | Revisit changed task evidence; search notebook content for richer definitions; record evidence and refinement freshness independently of discovery |
| Refresh project similarity | Jev, Agent Pro delegation, and generative fallback; checksum cache; incremental task pools; limited deeper search for empty projects | Reliable new and edited task triggers; context-aware cache invalidation; per-visit coverage target; resumable batches and global request limits |
| Generate and rate novel tasks | Up to three ideas per generation, stored per project, with refinement of prior ideas | Explicit Intent context and completed task text; stable idea identity; independent actionability ratings; inclusion in the main daily ranking path |
| Refresh Dream Task from projects | Cached daily note, project-based ranking, reserves, completion checks, generative fallback | Prepare suggestions in the background; invalidate by source revisions; support rated ideas; separate preparation from recording exposure |
| Refresh Proposed Agenda from projects | Persistent agenda cache, project ranking, free-time placement, reserves, reconciliation, Calendar reuse | Background preparation and shared freshness rules; rated ideas in the primary ranking path; preserve decisions during refresh |

The key implementation points are:

- [`quarter-project.js`](../lib/dashboard/quarter-project.js) requires `summary` and `uuid`, declares every field,
  and defaults unset values and collections. It mutates through setters and commands including `adoptStoreFields`,
  `markRanked`, `recordObservedTasks`, `recordShownTasks`, `setProgressEvidence`, `setRelatedTaskRecords`,
  `setSimilarityScores`, and `setSuggestedTasks`. `from` returns an existing instance unchanged; it is not a clone.
- [`quarter-project-serialization.js`](../lib/dashboard/quarter-project-serialization.js) owns the progress/store
  record shapes and store-section parsing/rendering. The class exposes `fromStoreSection`, `toProgressRecord`,
  `toStoreRecord`, and `toStoreSection`. New durable fields must be added deliberately to the constructor, appropriate
  serialization shape, and store adoption rules. Setters and `adoptStoreFields` can retain supplied collection references.
- [`lazy-widget-mount.jsx`](../lib/dashboard/lazy-widget-mount.jsx) uses a separate observer per widget with a
  400-pixel margin and immediately admits each intersecting widget. Overlay release can mount several at once.
  There is no common prioritized mount queue yet.
- [`dashboard-load-tracking.js`](../lib/dashboard/dashboard-load-tracking.js) treats deferred placeholders as
  settled and reports React mount separately from the `dashboard:widget-loaded` data-readiness event. Its aggregate
  settle callback does not establish that all visible data/provider work has finished; the scheduler must track
  ongoing foreground demand separately.
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

## QuarterProject ownership and boundaries

Keep `QuarterProject` as the domain object for a committed quarter project. `ActionProspect` remains the Plan Builder
candidate/approval object; the queue does not replace it. `quarterlyProgressProjects` remains the source adapter that
combines the guide, plan prose, and stored evidence into `QuarterProject` instances. Matching, completion rules,
candidate eligibility, and the application of validated project results belong to the project class. Network calls,
queue policy, locks, and React state belong to collaborating services.

Use this boundary contract throughout reads, construction, refinement, and recommendations:

1. `QuarterProjectRepository.readMany(scope)` reads stored records and authoritative live planning choices, then
   returns `QuarterProject[]`. Expose `readStored(scope)` separately for historical/retired evidence. Raw markdown
   parsers may return records internally; public project consumers receive instances.
2. New guide/plan projects pass through `quarterlyProgressProjects`; legacy JSON and any app-bridge response are
   hydrated with `QuarterProject.from`, and store sections with `QuarterProject.fromStoreSection`. Class prototypes
   do not survive JSON/bridge transport. Neither `toStoreRecord()` nor `toProgressRecord()` is a complete transport
   snapshot: each intentionally omits fields owned by the other representation. Preserve both note contracts.
3. A job persists only scope, project UUID, revisions, and its cursor. At execution it obtains a fresh instance from
   the repository. It reads that isolated instance to prepare work and returns a validated result patch. At commit,
   the repository applies the patch through setters on a freshly read instance; it never persists a captured live
   class instance in the queue or exposes an uncommitted mutation to another job.
4. Recommendation services call `setProgressEvidence(targetDate)` and the proposed `taskCandidates(...)` on an
   instance owned by that recommendation request. When they only need computed evidence, they can call the existing
   non-mutating `progressEvidence(targetDate)`. Plain card/activity records retain project and candidate identity.
5. `QuarterProjectRepository.applyResult(...)` re-reads under the note writer, checks the job's input revision,
   applies only fields that job owns, and publishes a project revision after a successful write.

Use the existing setters for result application. Add only the behavior and state the queue needs; do not restore the
removed copy-returning methods. The implementation map is:

| Existing API or proposed extension | Responsibility |
| --- | --- |
| `taskCandidates({ excludeCandidateIds, now, openTasks })` | Return eligible existing tasks and rated ideas belonging to this project; delegate shared formatting to a pure helper if needed |
| Existing `setSimilarityScores`, `setRelatedTaskRecords`, and `markRanked` | The repository validates/merges a batch result, then sets the affected fields; call `markRanked` only after the entire required pool succeeds |
| Existing `setSuggestedTasks(ideas, { generatedAt })` | Set the validated merge of generated/refined ideas, retaining identities and decisions; supply generation time only when new ideas were generated |
| Existing `setSuggestedTasks(ratedIdeas)` | Apply ratings to matching idea text revisions without changing generation time; no separate copy-returning rating method |
| Existing `recordObservedTasks`, `setCompletedTasks`, and `recordShownTasks` | Record observed evidence and actual exposure while keeping generation separate from display |
| Proposed `recordRefreshSuccess(result)` | Mutate operation-specific successful input revision, time, and watermark; partial success cannot advance the whole project |
| Declared `linkedGoalUuids` | Carry `ActionProspect.linkedGoalUuids` through source construction; resolve selected Intent text from the guide rather than inventing a second Intent identity system |
| Declared `projectRevision` and `refreshState` | Persist project output revision plus operation-specific successful revisions/times and watermarks |
| Extended completion and idea records | Preserve available completion text/source identity and generated idea identity, ratings, revisions, and decisions |

Keep domain/quarter identity in the repository's resolved scope and include it in every job/cache key; project UUID
alone is insufficient. `QuarterProject` is intentionally mutable. The repository gives each job, recommendation date,
and UI publication its own instance with detached nested collections. Cached plain snapshots may be shared for reading,
but mutable project objects cannot be shared across concurrent jobs or with React state. `QuarterProject.from(existing)`
and `adoptStoreFields` do not create that isolation. Build detached instances from declared-field snapshots, including
task records and scores, rather than round-tripping an incomplete note record.

Replace changed arrays/maps through setters. In particular, pass a fresh hash to `setSimilarityScores` instead of
editing the existing hash in place, because the WeakMap cache keys by hash identity. A failed write discards its working
instance without publishing it. After success publish a new revision/snapshot reference so React subscribers can notice
the change. Tests must prove that parallel jobs, different target dates, and preexisting UI snapshots remain isolated.

Document each field's source of truth. Guide-owned pace, priority, deadline, and next-action values are rehydrated from
the live guide; stored evidence cannot overwrite them. Plan-note projects preserve their corresponding source choices.
`toStoreRecord()` omits some of these choices while `toProgressRecord()` includes them; repository reads must merge
their authoritative source before recommending work. Extend the constructor's explicit fields/defaults and
`quarter-project-serialization.js` when adding refresh state or goal linkage. Add store-owned refresh fields to
`STORE_OWNED_FIELDS` so `adoptStoreFields` retains them, while goal linkage follows its guide/progress authority.
Preserve the existing completion-adoption rule deliberately and test it against newer observations. Day-specific
`due`, `reason`, and completion counts remain transient and cannot be accepted as persisted constructor inputs.

Derive each job's input revision from the fields that operation actually reads. `projectRevision` is an output/cache
notification revision, not a universal freshness key: successful refresh timestamps or queue status must not make
their own job stale. In particular, similarity results invalidate idea/day inputs where relevant, but they do not
automatically invalidate the similarity input that produced them.

Do not grow the class into an orchestration layer. Keep its public project behavior there, while extracting substantial
pure implementation details into `quarter-project-task-candidates.js` and `quarter-project-refresh-state.js` as needed
to respect the project's file-size conventions. Continue using `quarter-project-serialization.js` for note formats;
`project-task-store-markdown.js` now owns only note roots and project headings. These pure helpers cannot import
repositories or scheduling modules.

## Scheduler classes and files

These are concrete target files, not requests to create empty scaffolding. Classes own state or invariants; stateless
policies and job handlers remain functions. Avoid one subclass per job type. Implement each file when its phase
needs it, with behavior documentation and attribution only in `AI_CONTRIBUTIONS.md`.

### Shared domain and execution classes

All files in this table must remain React-free and host-compatible, including their full import graphs.

| Class | File and status | State and public contract |
| --- | --- | --- |
| `QuarterProject` | Extend `lib/dashboard/quarter-project.js` | Reuse mutable setters and serialization methods; add candidate selection and successful-refresh state only when needed; no timers or app interface |
| `QuarterProjectRepository` | Add `lib/dashboard/quarter-project-repository.js` | Inject app and note writer; `readMany`, `readStored`, `readOne`, `applyResult`; wraps existing project store/source adapters rather than creating a competing store |
| `DashboardWorkJob` | Add `lib/dashboard/work-queue/dashboard-work-job.js` | Validates serializable durable job records, identity, attempt tokens, transitions, and checkpoints; no executable callback or project snapshot in its persisted payload |
| `DashboardWorkScheduler` | Add `lib/dashboard/work-queue/dashboard-work-scheduler.js` | Owns ready work, coalescing, foreground demand, scope generations, and subscribers; `enqueue`, `promote`, `cancel`, `runReady`, `setForegroundDemand`, `setScope`, `subscribe`, `dispose` |
| `DashboardResourceBudget` | Add `lib/dashboard/work-queue/dashboard-resource-budget.js` | Tracks independent mount, bridge-read, generative, Jev, and write permits; `tryAcquire`, `release`, `setForegroundDemand`; release handles are idempotent |
| `DashboardWorkRepository` | Add `lib/dashboard/work-queue/dashboard-work-repository.js` | Durable queue reads/writes and recovery; `readPending`, `saveJob`, `checkpoint`, `complete`, `recoverExpired`; uses section updates and bounded retention |
| `DashboardNoteWriter` | Add `lib/dashboard/work-queue/dashboard-note-writer.js` | Serializes read-transform-write per note in one runtime; `update` accepts a transform over the latest content; failures release the chain |
| `DashboardTaskSnapshot` | Add `lib/dashboard/work-queue/dashboard-task-snapshot.js` | Owns a domain's observed task revisions/change sequence; `reconcile`, `changesSince`, `snapshot`; distinguishes complete snapshots from partial observations |
| `QuarterProjectWorkPlanner` | Add `lib/dashboard/work-queue/quarter-project-work-planner.js` | Owns per-visit project coverage and plans desired jobs from instances and revisions; `plan`, `recordSuccess`, `coverage`; scheduling policy is not a method on `QuarterProject` |

Supporting shared modules have one concern each:

| File to add | Exports and responsibility |
| --- | --- |
| `lib/dashboard/work-queue/dashboard-work-policy.js` | Priority categories, fairness, resource caps, retry delays, and admission rules as testable functions/constants |
| `lib/dashboard/work-queue/dashboard-work-handlers.js` | Registry mapping durable job types to handlers and input validators; imports host-compatible handlers only |
| `lib/dashboard/work-queue/dashboard-work-runtime.js` | `createDashboardWorkRuntime` composition factory that injects app, clock, repositories, provider access, and event publication |
| `lib/dashboard/work-queue/dashboard-work-diagnostics.js` | Bounded queue timing/counter snapshots integrated with existing logging; no prompt bodies or unbounded event history |
| `lib/dashboard/work-queue/dashboard-work-diagnostics-store.js` | Bounded persisted completion/failure summaries for inspection after reopening; shares the note writer and excludes its own housekeeping from queue metrics |
| `lib/dashboard/work-queue/dashboard-task-snapshot-store.js` | Versioned persistence and compaction for the task evidence index/change sequence; separate from small job metadata |
| `lib/dashboard/work-queue/dashboard-provider-dispatch.js` | Resource-aware Jev/generative requests and sequential maintenance fallback; all nested batches acquire permits here |
| `lib/dashboard/work-queue/dashboard-app-dispatch.js` | Priority-aware app reads with explicit request context; writes delegate to `DashboardNoteWriter`; avoid mutable global priority across concurrent calls |

One runtime is created for a mounted Dashboard and shared with its widgets and Plan Builder. Host Calendar actions
create a bounded host runtime over the same stores. They do not share an in-memory singleton with the embed or acquire
browser behavior through the handler registry. Cross-context coordination retains the best-effort limits described below.

### Browser mounting adapter and React integration

The scheduler handles admission of component mounts and local publish callbacks; React still controls reconciliation
and commit. It is not a replacement React renderer, and ordinary widget state updates do not all become queue jobs.

| Class or export | File and status | Responsibility |
| --- | --- | --- |
| `WidgetMountCoordinator` | Add `lib/dashboard/work-queue/widget-mount-coordinator.js` | Browser-only class; owns shared viewport/near-viewport observers, mount registrations and generation tokens; `register`, `updateVisibility`, `requestMount`, `reportCommitted`, `unregister`, `dispose` |
| `createBrowserWorkDriver` | Add `lib/dashboard/work-queue/browser-work-driver.js` | Browser-only scheduling adapter for frame callbacks, yielding, visibility, and wake timers; plugs into the shared scheduler |
| `DashboardWorkProvider` and `useDashboardWork` | Add `lib/dashboard/work-queue/dashboard-work-context.jsx` | Provide one runtime to the mounted Dashboard tree without publishing the whole changing queue into React state |
| `useDashboardWorkQueue` | Add `lib/hooks/use-dashboard-work-queue.js` | Create/clean up runtime and connect scope, load gate, task updates, visibility, and foreground/overlay demand; subscriptions select small stable snapshots |
| `LazyWidgetMount` | Modify `lib/dashboard/lazy-widget-mount.jsx` | Preserve placeholders and mount-once behavior; register a mount callback and supply the placeholder node to `WidgetMountCoordinator` |
| Mount suspension exports | Split `lib/dashboard/widget-mount-suspension.js`; add `lib/hooks/use-widget-mount-suspension.js` | Keep the counted suspension state and subscriptions React-free in the existing file; move its React hooks into the new hook file and update callers |
| Load/mount reporters | Modify `lib/dashboard/dashboard-load-tracking.js` and `lib/dashboard/dashboard.jsx` | Report commit/error/cancellation separately from usable data; preserve existing aggregate analytics and memory-measurement events |
| `DashboardQueueInspector` | Add `lib/dashboard/work-queue/dashboard-queue-inspector.jsx` | Admin Queue view inside the existing Debug Console; subscribes to diagnostics and displays filters, waiting reasons, progress, failures, and timings |
| `useDashboardQueueDiagnostics` | Add `lib/hooks/use-dashboard-queue-diagnostics.js` | Select/throttle inspector snapshots while open; load durable history on demand; unsubscribe while closed |
| Admin tools availability | Add `lib/dashboard/dashboard-admin-tools.js`; modify `dashboard.jsx` and `debug-console.jsx` | Centralize the existing debug-tools availability rule so the Queue view and existing tools use one policy |
| Inspector styles | Add `lib/dashboard/styles/dashboard-queue-inspector.scss` | Scope all rules under the inspector's root `.dashboard-queue-inspector` class |

Mount requests are transient records keyed by dashboard session, widget identity, and registration generation. Their
callbacks, DOM references, visibility, and commit state stay in memory; never write a render request into an Amplenote
note or block a mount on queue recovery, note lookup, a provider permit, or an unrelated running job.

### Job handler and result files

Paths below are relative to `lib/`. All additions here are host-compatible function modules, and project-specific
handlers read isolated `QuarterProject` instances and commit result patches through the repository.

| Durable job type | Handler file to add | Reuse and result |
| --- | --- | --- |
| `reconcileProjects` | `dashboard/work-queue/jobs/reconcile-projects.js` | Existing source adapter plus `DashboardTaskSnapshot`; update evidence and ask the planner for jobs |
| `discoverDictionaryTerms` | `dashboard/work-queue/jobs/discover-dictionary-terms.js` | Existing discovery and dictionary modules, keyed by changed evidence digest |
| `collectTermEvidence` | `dashboard/work-queue/jobs/collect-term-evidence.js` | New `plan-wizard/stack-rank/dictionary-term-evidence.js` for search, bounded note reads, full footnote resolution, and passage selection |
| `refineDictionaryTerm` | `dashboard/work-queue/jobs/refine-dictionary-term.js` | New `plan-wizard/stack-rank/dictionary-term-refinement.js`; ownership-aware definition commit and affected-project invalidation |
| `rankProjectTasks` | `dashboard/work-queue/jobs/rank-project-tasks.js` | Existing ranker/cache logic; checkpoint batches and commit via score/association setters; `markRanked` only on full success |
| `generateProjectIdeas` | `dashboard/work-queue/jobs/generate-project-ideas.js` | Extend `dashboard/project-task-ideas.js`; validate/merge ideas and commit with `setSuggestedTasks` |
| `rateProjectIdeas` | `dashboard/work-queue/jobs/rate-project-ideas.js` | New `dashboard/project-task-idea-ratings.js`; validate IDs/text revisions and set updated ideas without restamping generation |
| `prepareDayRanking` | `dashboard/work-queue/jobs/prepare-day-ranking.js` | Existing day groups/ranker with mixed candidates; persist one context-specific ranked list |
| `prepareDreamTasks` | `dashboard/work-queue/jobs/prepare-dream-tasks.js` | Existing Dream Task selection/reserves and daily note format, without recording exposure |
| `prepareProposedAgenda` | `dashboard/work-queue/jobs/prepare-proposed-agenda.js` | Existing slotting, obligations, agenda cache, and decision reconciliation |

Add `dashboard/day-ranking-store.js` for the shared ranked-list cache and `dashboard/project-task-idea-records.js`
for pure idea validation, migration, and identity handling. Extend `user-terms-dictionary.js` to persist term evidence
metadata and revisions without rewriting protected definitions. Reuse `ranked-task-suggestions.js` as the public
recommendation facade, separating preparation from `recordShownTaskSuggestions`. An idea is a typed record owned by
`QuarterProject`; it does not require another orchestration class.

## Scheduler execution contract

Inject clock, storage, app access, provider access, and browser wake functions. Plan Builder submits work and foreground
signals to the shared scheduler instead of starting an independent maintenance loop. Keep browser adapter imports out
of all host services.

`DashboardWorkScheduler.runReady()` admits eligible work and returns control; it must not await an entire queue drain.
Each admitted async operation registers its completion independently. Choose the highest-priority job whose dependency
and resource requirements are satisfied, skipping blocked jobs so a pending provider request cannot hold up a mount.
Release provider/read permits when that operation ends, before waiting for subsequent work, and recheck priority at
every batch boundary. Note serialization deliberately spans its fresh read, transform, and write; coordinate its read
and write permits without recursive acquisition. Never retain a note-write lock across a provider call.

Handlers expose `run({ context, job, signal })` and return a result status, checkpoint, affected revisions, and optional
follow-up descriptors. A handler may return `yielded`, `completed`, or `superseded`; retry/configuration failures carry
structured reasons. The runtime applies typed results through the correct repository before acknowledging completion.
Handlers cannot launch detached child batches outside the dispatcher. In-flight cancellation remains cooperative.

If a visible widget needs a result already queued as maintenance, promote that existing job and only its necessary
prerequisites. Propagate foreground priority to their provider/bridge requests, retain hard capacity limits, and avoid
waiting for unrelated dictionary refinement or project coverage. When the final requesting widget unsubscribes,
remove its foreground demand; any still-useful durable work returns to its ordinary priority.

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

Mount work is eligible immediately. Use initial viewport classification and the existing settled callback plus a
four-second grace period as the initial maintenance gate; also check foreground demand at admission time. Do not
reinterpret the existing aggregate mount/deferred analytics as proof of data readiness. A usable cached or empty
widget shell can coexist with pending data; a cold widget's foreground preparation bypasses the maintenance gate.
This prevents a widget waiting for a job that itself waits for the widget to settle.

Use priority categories `visibleRender`, `foregroundData`, `nearViewportRender`, `visibleRefresh`, and `maintenance`.
Select work separately for each resource; these categories are not a single serial promise chain. Local render
callbacks always outrank background local work. Maintenance aging never promotes it above visible rendering. Track
foreground demand after initial settle as well, so scrolling restores priority without resetting the visit.

Use the following initial policies, then tune them from measurements:

| Resource or concern | Proposed policy |
| --- | --- |
| Visible mounts | Admit one new widget per frame initially; release its mount permit on commit/error, then admit another on a later frame; no provider or data-readiness wait |
| Near-viewport mounts | Preserve the initial 400-pixel lookahead, but admit only when no visible mount is waiting and foreground pressure is low |
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

### Scrolling and urgent component renders

`WidgetMountCoordinator` uses shared observers for the actual viewport and the 400-pixel lookahead region so it can
distinguish urgent from speculative mounts. Observe the actual scroll container. Observer callbacks enqueue/promote
small requests and return promptly; they do not parse project notes or hydrate a notebook. Intersection observation
is asynchronous and a positive root margin expands the observed region, as documented by the
[Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API).

On a scroll into view, promote the widget's existing request rather than enqueueing another. If it leaves view before
admission, demote or cancel the speculative request. Repeated callbacks, rapid direction changes, StrictMode cleanup,
and layout edits must not produce duplicate mounts. Revalidate the registration generation when a callback runs;
unregistering removes its callback, observer references, and foreground demand. Once mounted, retain the widget's
existing state when it scrolls away.

Schedule only the brief mount admission/state update in a frame callback. Release the mount permit from a committed
reporter or error boundary, not immediately after `setMounted(true)`; React may commit later. A cancelled registration
or bounded commit watchdog must release a stuck permit without requesting a second mount of the same generation.
Do not wait for `dashboard:widget-loaded`, because network data can remain pending while other visible shells mount.
Frame callbacks run before repaint and are generally paused in hidden tabs; they are not a place for heavy computation
or a promise of a completed paint. See
[requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

While visible mounts are queued, defer new maintenance CPU chunks and provider requests. An already-running remote
request may complete, but its parsing and publication yield to visible rendering where practical. Large synchronous
JSON parsing or a single expensive component render cannot be preempted by a queue; bound payloads, reduce component
work, and use measured commit duration to adjust speculative admission. One mount per frame is a starting cap, not
a guarantee that a mount fits within a frame.

Overlay suspension holds only the covered Dashboard's mount requests. The active overlay's own urgent UI remains
eligible. On the last overlay release, refresh visibility and drain visible requests first across frames; do not
replay every historical intersection at once. Keep the immediate-mount override used by the memory-measurement
harness explicit. Without IntersectionObserver, admit all widgets through bounded fallback mounting so none remains
a placeholder forever; without frame callbacks, use the browser driver's timer fallback.

Example: a Jev batch is in flight when the user scrolls to Agenda. Its mount request runs on the next available frame,
independently of Jev. Agenda commits a shell and releases its mount permit; another visible widget can then mount.
Agenda's missing data requests priority through the app/provider dispatcher. Maintenance resumes admission once the
visible mount backlog and foreground pressure clear, using its saved cursor.

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

## Admin queue observability

Provide a Queue view in the existing Debug Console, available through the same admin/developer tools policy. The
current Dashboard uses `debug_console`, development environment/host checks, and a designated plugin identity; there
is no separate authenticated administrator role in this code. Extract that existing policy into
`dashboard-admin-tools.js` rather than introducing a second inconsistent check. This is an operator UI for the current
user's Dashboard and notes, not a way to inspect other users' queues. Gate both the entry point and diagnostics access
through that policy. Any later host diagnostics endpoint must check host-side access too; a hidden button is not
authorization. The initial inspector needs no new host endpoint and no expression evaluation.

The Queue view must answer “what is running, why is this waiting, and is the queue making progress?” without requiring
Console Logging to be enabled. Add the following views using structured scheduler events and snapshots:

| View | Required information |
| --- | --- |
| Overview | Runtime/session, scope, enabled features, foreground demand, overlay/visibility/load gate, counts by status, oldest pending age, last successful progress, and project coverage versus target |
| Active and pending work | Job ID/type, project or term identity, priority, dependencies, resource needed, input revision, attempt, checkpoint progress, enqueue/start times, next eligible time, and explicit waiting reason |
| Urgent renders | Widget ID, actual versus near visibility, priority promotion, admission/commit times, mount permit/watchdog state, and overlay-held requests |
| Resources | Used/available permits for mounts, app reads, generative requests, Jev and writes; pending foreground versus maintenance demand |
| Recent outcomes | Completed, superseded, cancelled and failed jobs, sanitized failure classification, retry/backoff, provider timing/token usage when supplied, and output revision |

Use waiting reason codes such as `loadGate`, `overlay`, `hidden`, `foregroundDemand`, `resourceBusy`, `dependency`,
`retryBackoff`, and `missingConfiguration`, with a readable explanation. Filters cover scope, job type, priority,
status, and project. Distinguish current-runtime live state from persisted observations of another runtime: show its
last-observed time and claim expiry, and never label an unverified remote request as definitely running.

Expose `snapshot()`, `subscribe(listener)`, and `exportSnapshot()` from the diagnostics module. Copy/download a
sanitized snapshot from the Queue view for troubleshooting. Keep inspection read-only in this implementation;
opening the view or exporting it must not retry jobs, resume paused work, or change priority.

Capture cheap counters and a bounded in-memory event ring from phase 2; propose 200 events initially. From phase 5,
retain up to 100 compact outcome records for at most seven days per queue scope, checkpointed in low-priority batches.
Persisted pending/running job metadata already lives in the queue repository. Label history gaps or unavailable
durable storage explicitly. Do not store every scroll event, prompt, notebook snippet, API key, or raw provider error
body; sanitize diagnostic fields at emission and again at export. Diagnostic persistence failure must not fail work.

Throttle live inspector updates to at most four per second while open, unsubscribe when closed, and read durable
history only on open or explicit refresh. Keep its own shell accessible even when the work queue is paused or stalled;
do not enqueue its diagnostic read behind the job being diagnosed. Count diagnostic storage separately so it cannot
create a self-observation loop. Include the inspector in mobile performance checks.

## Implementation phases and commit boundaries

Each phase below is a separately reviewable commit-sized change or a short cohesive series. Every commit must build,
include the tests for the behavior it changes, and leave the current feature path usable. Commit the implementation
and its tests together. Add fields, migrations, and imports only when their first consumer arrives; do not import
future handler files or commit empty scaffolding. Update `AI_CONTRIBUTIONS.md` with each implemented part.

These are proposed boundaries for the human to review and commit; this planning task creates no commits. All phases
remain unimplemented. The current mutable class and serialization extraction are the baseline, not work to redo.

| Phase | Commit scope | Prerequisite | Safe stop point |
| --- | --- | --- | --- |
| 1 | Isolated project repository and serialized writes | Current class | Existing behavior uses the repository; no scheduler changes |
| 2 | Scheduler, resource budgets and diagnostics contract | None beyond current code | Tested execution core with no production maintenance activation |
| 3 | Urgent component mounting | 2 | Prioritized rendering can ship while legacy maintenance remains selected |
| 4 | Admin Queue inspector | 2 and 3 | Admins can inspect live rendering and scheduler state before maintenance rollout |
| 5 | Durable jobs and resource-aware dispatch | 1, 2 and 4 | Durable recovery and history are testable; live maintenance still uses one selected path |
| 6 | Resumable project maintenance and coverage | 3 and 5 | Queue can replace both legacy passes without losing existing discovery or idea generation |
| 7 | Evidence-based dictionary refinement | 6 | Better definitions are independent of idea rating and prepared suggestions |
| 8 | Generated idea ratings and mixed candidates | 6; 7 recommended | Existing daily consumers can recommend rated ideas without requiring background preparation |
| 9 | Shared daily preparation and cache consumers | 8 | Dream Task, Proposed Agenda and Calendar consume prepared output |
| 10 | Default rollout and legacy cleanup | 7, 8 and 9 | Verified queue behavior becomes the default; obsolete orchestration is removed |

### Phase 1 Project repository and mutable instance ownership

Add `QuarterProjectRepository` and `DashboardNoteWriter` at the inventory paths. Route existing store reads and writes
through them, keeping public compatibility exports. Reuse the current setters, `fromStoreSection`, `toStoreSection`,
and `toProgressRecord`; keep note conversion in `quarter-project-serialization.js`. Adopt authoritative guide/store
fields with detached collections. Defer queue-specific fields and idea schema changes to their consuming phases.
Before a pass reads the store, and before each serialized write, the note writer calls
[`app.context.refreshNotesList`](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface#app.context.refreshNotesList)
(the embed reaches it through a `refreshNotesList` bridge action), reusing a success for one minute. Amplenote documents
that it refreshes note metadata without guaranteeing changed content has arrived, so it narrows, not closes, the window
in which a freshly opened client reads stale notes before spending provider requests on them.

Verify repository and note-writer tests plus existing QuarterProject, project-task-store, progress, and ranking suites.
Include two concurrent results, two recommendation dates, failed writes, and unchanged UI snapshots. The stop point
preserves today's behavior and note formats with no timer or rendering change.

### Phase 2 Scheduling core and diagnostic events

Add `DashboardWorkScheduler`, `DashboardResourceBudget`, policy/runtime/diagnostics modules, and their focused tests.
The runtime accepts an injected optional job repository and registry; it must operate without durable services until
phase 5. Implement priority, independent resource admission, cancellation, coalescing, waiting reasons, and bounded
diagnostic snapshots now so the inspector observes real scheduler state rather than reconstructing it from logs.

Verify a controlled unresolved provider promise cannot block another resource, and cancellation releases permits
without duplicate completion. This commit does not activate production maintenance or require a queue note.

As built, jobs carry their own `run` functions; the handler registry and the optional job repository arrive with
their first consumers in phase 5, so the runtime takes neither yet. The in-memory job records live in
`work-queue/scheduled-work-job.js`, apart from the durable `DashboardWorkJob` that phase 5 adds. Admission conditions
(`hidden`, `loadSettled`, `overlayHeld`) are set through `setConditions`, which phase 3 wires to the Dashboard.

### Phase 3 Urgent rendering integration

Add `WidgetMountCoordinator`, browser driver, context, and `useDashboardWorkQueue`. Modify `LazyWidgetMount`, load
reporters, Dashboard wiring, and suspension hooks as listed in the inventory. Introduce a render-scheduler switch
independent of maintenance selection; until phase 6, legacy maintenance continues through its existing path.

Verify mount coordinator, lazy mount, load tracking and integration tests, then fast scroll and overlay-release behavior
in the browser. This commit can ship independently: rendering works if persistence is unavailable or never initialized.
Reverting its switch restores the existing lazy mount path without changing project data.

As built, the switch is `SCHEDULED_WIDGET_MOUNTING_ENABLED` in `work-queue/dashboard-work-features.js`. Without
IntersectionObserver the Dashboard keeps the unscheduled path, which already mounts every widget at once, rather than
duplicating that fallback in the coordinator. Mount jobs are unscoped, so a domain switch does not withdraw them. The
existing load reporters were sufficient: a widget that throws before committing unmounts its lazy mount, which
unregisters it and releases the permit, so `dashboard-load-tracking.js` is unchanged. Task-update wiring waits for
its first consumer in phase 6.

### Phase 4 Admin Queue inspector

Add `DashboardQueueInspector`, `useDashboardQueueDiagnostics`, scoped styles, and the shared admin tools policy helper.
Extend the existing Debug Console with the Queue view and sanitized copy/download. Add
`test/dashboard-queue-inspector.test.js`, `test/dashboard-work-diagnostics.test.js`, and
`test/dashboard-admin-tools.test.js`. Runtime states absent before phase 5 are shown as unavailable, not fabricated.

Verify the existing admin gate, live updates without Console Logging, explicit waiting reasons, filters, export
redaction, throttling, cleanup, and inspection of a deliberately stalled scheduler. This phase ships a useful live
inspector before any durable maintenance is enabled; it adds no job control actions.

As built, the Queue view is a Log/Queue toggle in the Debug Console's header, offered only when
`dashboard-admin-tools.js` allows admin tools; the Dashboard's Debug Console and memory measurement read the same
policy. The inspector's selection and filtering live in React-free `work-queue/dashboard-queue-inspector-model.js`, and
its sections in `work-queue/dashboard-queue-inspector-sections.jsx`. `WidgetMountCoordinator` gained `snapshot` and
`subscribe` with request, admission, commit and release times, so urgent renders show visibility-to-admission and
admission-to-commit durations and what released each permit. The project filter matches text in a job key, which holds
the project identity of project work. Project coverage, durable history, dependencies and checkpoint progress, and
observations from other runtimes are labelled unavailable until phases 5 and 6 supply them.

### Phase 5 Durable execution and diagnostic history

Add `DashboardWorkJob`, `DashboardWorkRepository`, diagnostics store, and app/provider dispatchers. Extend the runtime
with repository recovery and a handler registry that registers only implemented handlers. Add durable success/failure
history to the inspector. Record output-before-acknowledgement and stale-attempt rejection semantics in tests.

Verify queue recovery, retry/backoff, serializer versions, permit limits across nested provider calls, and diagnostic
retention/failure isolation. Add `test/dashboard-work-diagnostics-store.test.js`. Keep live maintenance disabled until
phase 6 supplies resumable handlers; the existing maintenance route remains functional during this foundation phase.

As built, durable execution lives in `work-queue/durable-work-runner.js`, which the runtime composes only when given
a repository and handlers; `DURABLE_WORK_ENABLED` in `dashboard-work-features.js` stays false, so the Dashboard reads
and creates no queue or history note until phase 6 registers handlers. Queue and history notes are archived, one per
scope, named `Dashboard Work Queue <scopeKey>` and `Dashboard Work History <scopeKey>`, each a fenced JSON block written
whole through `work-queue/dashboard-json-note.js`; their payloads are small and bounded, so section updates were not
needed. A durable job keeps its in-memory key, so the inspector's live rows and saved rows match. A yielded attempt
keeps its claim and renews it on resume; a lapsed claim returns the job to pending with its cursor. Handlers report the
revision their output already reflects through `appliedRevision`, which is how an interrupted attempt completes without
rerunning. Nested provider and app calls wait for permits through `DashboardResourceBudget#acquire`, so a handler that
uses the dispatchers should declare no scheduler resource. Records and notes a newer schema wrote are preserved, not
rewritten.

### Phase 6 Project maintenance migration

Add `DashboardTaskSnapshot`, its store, `QuarterProjectWorkPlanner`, reconciliation/ranking handlers, and resumable
ranker operations. Add `projectRevision`, operation `refreshState`, and `recordRefreshSuccess` to the class, with the
appropriate constructor defaults, serialization, store adoption, and legacy-read tests in the same commit series.
Use existing score/association setters and `markRanked` at the fully successful boundary.

Wrap existing dictionary discovery and idea generation as separate handlers in this phase so selecting the queue
does not silently remove existing behavior. They retain today's prompts/schema; richer evidence and ratings arrive
later. Ranking reads the latest usable dictionary instead of awaiting discovery. Implement all nested resource
admission before switching live traffic. Preserve partial batch results and the distinct-project visit quota.

For reviewable commits, split this phase into 6a task change tracking and persisted revisions, 6b checkpointed handlers
with equivalence tests, and 6c routing both refresh hooks through the queue. Only 6c enables queued maintenance. Keep
the legacy compatibility path selected until then; once selected, never run both routes for the same scope. The stop
point supports today's maintenance plus change detection, recovery, coverage, and admin progress/failure visibility.

As built, 6a's first consumer is the legacy collection pass, so change tracking fixes the missed-edit gap before the
queue takes over. `work-queue/dashboard-task-snapshot.js` indexes each task as an eight-character digest of its note
and text, a status, and a change sequence; `work-queue/dashboard-task-snapshot-store.js` keeps one archived
`Dashboard Task Snapshot <domainUuid>` note per domain (`all-notes` for the fallback), shared by its quarters and
rewritten only when an entry changes. A domain read is complete; the All Notes scan is partial and never marks a task
absent. Past 1,500 tracked tasks the index keeps the most recently updated open tasks, and a watermark older than a
dropped entry's last change reports itself incomplete. Watermarks carry the index's `snapshotId`, so a replaced note
is never compared by sequence alone. The pass reconciles once (only when a ranker exists) and passes up to 150 open
tasks changed since the project's `refreshState.similarity.watermark` to the ranker's new `changedTaskRecords` option,
which pools them past the creation-time cutoff and keeps only similar ones in the hash. A complete ranking records
`recordRefreshSuccess("similarity", ...)` with the snapshot's watermark; a ranking with missed batches records nothing.
The similarity input revision digests the project summary and scorer, leaving dictionary context to phase 7.
`projectRevision` advances in `QuarterProjectRepository.applyResult` only when a field readers consume changes, never
for refresh times, refresh state, or the shown-task log. Refresh-state helpers live in `quarter-project-refresh-state.js`.
`use-dashboard-task-updates.js` is unchanged: with no runtime-held snapshot before 6c, the next pass's reconciliation
already sees a local edit, so event-driven invalidation waits for queued maintenance.

As built, 6b adds three handlers under `work-queue/jobs/`, registered but run only once 6c submits them:
`discoverDictionaryTerms` (per quarter), `rankProjectTasks` and `generateProjectIdeas` (per project). Their input is
`{ domainName, domainUuid, quarter, year }` plus `projectUuid`; everything else is read fresh each attempt. The
collection pass's per-project steps moved to `project-collection-steps.js`, which both routes call, and tests show
discovery, ranking, and ideas run as jobs leave the store section and dictionary as one pass does. The ranker gained
`beginRanking`, returning a `ProjectRankingProgress` that rates one round of concurrent batches per turn; `rankProject`
is that rated whole. A paused ranking saves its similar and cited ratings to the hash and keeps the rest in memory under
a `progressId` in the cursor, since the 2,000-character cursor cannot hold a pool's low ratings; a session resuming
another's job restarts the ranking, reading the saved ratings from cache. `markRanked` and the similarity success move
only on full success. A ranking that fails outright or misses batches still writes its associations and partial scores,
then fails the attempt for backoff, rather than handing attribution to the idea prompt as the pass does; the ideas job
offers its pool only when nothing can rate. Provider requests take runtime permits through `providerDispatch`, and the
task read takes an app read permit; note reads inside task details do not yet. Job revisions come from
`refreshRevision` (similarity) and `ideasInputRevision`; dictionary progress stays in the dictionary note's examined
list. The planner, `reconcileProjects` (which must store a plan-only project before a job names its UUID, since an
unstored one gets a fresh UUID on each read), and routing remain for 6c.

As built, 6c turns `DURABLE_WORK_ENABLED` on. `queuedMaintenanceSelected` (true only with scheduled mounting and
IntersectionObserver) picks one route: the Dashboard's settle submits `reconcileProjects` through
`use-project-maintenance-queue.js` and the collection pass stays off, or the reverse. The hook submits again on a scope
change, every five minutes, and 15 seconds after a burst of `dashboard:tasks-updated`; `use-dashboard-task-updates.js`
is unchanged. Plan Builder submits the same job as `foregroundData` when it plans the Dashboard's quarter and re-reads
scores as rankings complete; for another quarter it keeps its own pass, since the queue holds only the Dashboard's
scope. The reconciliation stores plan-only projects and retires departed ones, reconciles the task snapshot when a
rater exists, and returns `QuarterProjectWorkPlanner#plan`'s requests as `followUps`, which the runner submits after
acknowledging the job, in one queue write and at the job's category. A ranking is due when changed (its similarity
revision differs from `<inputRevision>@<snapshotId>:<sequence>`, requested at that revision), or forced with a null
revision when never ranked, past 72 hours, due its second page, or missing a cited score. The rank job now pools the
sources page's unscored cited tasks (`cited-task-records.js`) and asks for ideas as a follow-up when
`ideasRefreshDue`; current-ranking projects get an ideas job alone. Ideas always run as maintenance. Due projects are
taken changed, never ranked, no tasks, then oldest, with at most the visit target
(`min(N, max(5, ceil(N / 2)))`) in flight; finished ones free slots for the next reconciliation. Current projects count
as checked; the Queue overview shows checked, refreshed, ranked, in-flight and failed counts. Two fixes surfaced here:
a job in a foreground category takes foreground permits (`jobPriorityContext`), since its own foreground pressure
otherwise starves its single-permit generative requests, and the planner digests ideas inputs from the live project
with store fields adopted, as the ideas job does. A runtime's jobs share one task read for two minutes. An ideas
request that fails with no provider configured waits for configuration. The builder pass's compaction of low uncited
scores does not run on the queued route.

### Phase 7 Dictionary enrichment

Add term evidence/refinement services and handlers, extend dictionary provenance/revision persistence, and add targeted
project invalidation. Extend the inspector with term identity, lookup/refinement progress and meaningful empty-result
outcomes. Keep all user-owned definition and Rich Footnote preservation rules.

Verify refinement, ownership, source selection, cooldown, and score invalidation tests. This phase can be disabled
independently while ordinary discovery, ranking, ideas, and urgent rendering continue working.

Split for review into 7a definition-change invalidation, 7b term evidence collection, and 7c refinement and its
scheduling. As built, 7a re-rates only the open tasks whose text names a term whose definition changed, never every
task a project's summary relates to. `plan-wizard/stack-rank/dictionary-term-revisions.js` keeps an archived
`User terms dictionary <year> revisions` JSON note with each term's definition digest and the change sequence at which
it last differed; the first record is a baseline at sequence 0, so adopting it re-rated nothing. Whoever changed a
definition (discovery, later refinement, or the user by hand), the next reader that ranks notices it: the ranking job
observes the dictionary its ranker read, and the similarity success records `dictionaryPosition` ({ revisionsId,
sequence }). A project's next ranking pools the open tasks naming a term changed since that position (at most 150) as
`rescoredTaskRecords`, which bypass their cached rating, so a low-rated task discarded from the hash is reconsidered
too. `reconcileProjects` counts those tasks per ranked project and the planner forces a ranking when there are any.
The rating key and `similarityInputRevision` are unchanged, so no other stored score is invalidated.

As built, 7b adds `plan-wizard/stack-rank/dictionary-term-evidence.js` and the `collectTermEvidence` job, which nothing
submits until 7c schedules it. A collection searches `"<term>"` with `app.searchNotes` (the relevance-sorted
`filterNotes` query when a client lacks it), and the bare term when the quoted search yields no passage, reading at
most eight notes in all. Notes tagged `plugins/dashboard` or beneath it (the dictionary and its revisions and evidence
notes, the queue, the planning notes) are never read. Passages are cut only where the term is a whole word: each block
under its nearest heading, narrowed around the mention past 1,200 characters, followed by the full Rich Footnotes it
cites (up to 1,500 characters); a footnote naming the term that no passage cites is a passage of its own. Copies are
kept once, notes take turns (at most three passages each, ten in all, 12,000 characters together), and the outcome is
`found`, `noPassages`, or `noMatchingNotes`. The archived `User terms dictionary <year> evidence` JSON note keeps one
record per term with its passages, source note UUIDs and content digests, and a `sourceDigest` 7c can compare to tell
whether a term's evidence changed; past 60,000 characters of passages the oldest records drop theirs and keep their
sources. The job is keyed `collectTermEvidence:<year>:<term>`, retires when the dictionary no longer defines the term,
and holds one app read permit for the bounded collection. Exact-phrase behavior of the quoted search is not yet
verified against Amplenote; passages are checked locally, so a looser search costs reads but never admits a passage
that lacks the term.

### Phase 8 Rated ideas and recommendation candidates

Add idea records/rating helpers and the rating handler; enhance the existing generation handler. Extend completion
text/source evidence and `linkedGoalUuids` through constructor, source adapters and serialization. Use
`setSuggestedTasks` for generated and rated ideas; rating alone must not change their generation time. Add the
project's `taskCandidates` method and migrate identity handling through daily ranking, reserves and acceptance.

Commit schema/legacy normalization and generation context as 8a, then independent rating and all mixed-candidate
consumer support together as 8b. Existing ideas remain unrated/ineligible for the new path until rated. Verify idea
revision/decision handling, same-text deduplication, actionability, completion history and acceptance retries. The stop
point uses existing on-demand daily generators, so background preparation is not a hidden dependency.

### Phase 9 Prepared daily output

Add `day-ranking-store.js` and day-ranking, Dream Task, and Proposed Agenda preparation handlers. Refactor existing
recommendation facades to separate preparation from exposure. Update widget consumers and Calendar's bounded host
runtime, preserving current caches, live-task checks, decisions and fallback behavior.

Split into 9a shared ranking persistence plus prepare/read/exposure separation, then 9b consumer subscriptions and
background activation. Until 9b, existing foreground generation remains the selected behavior. Verify cross-surface
context keys, no exposure on prefetch, unchanged accepted/dismissed choices, cold-cache settling, and native Calendar
output. Admins must be able to follow a project revision through preparation to the published result revision.

### Phase 10 Rollout and cleanup

Use recorded admin diagnostics and mobile/browser checks to compare rendering latency, provider contention, project
coverage and error recovery with each feature enabled. Change defaults only after those acceptance checks pass.
Then remove unused legacy timers/loops and temporary compatibility routes in a separate cleanup commit. Keep output
formats backward-readable and document the oldest compatible rollback version before removing a legacy writer;
older writers that drop new metadata cannot be assumed safe merely because they can parse the notes.

Run the relevant regression suites, production build and host smoke test. This phase is operational activation and
cleanup, not a prerequisite for reviewing or committing phases 1–9. Each earlier stop point remains buildable.

### Integration map

Concrete integration changes:

- `lib/dashboard/dashboard.jsx` provides the single runtime before lazy children render, passes current domain/scope,
  and supplies commit/error signals from `createWidgetCell`. It retains the memory harness's `mountImmediately` path.
- `lib/hooks/use-project-task-collection.js` and `lib/hooks/use-project-task-ranking.js` become thin enqueue adapters
  during migration, then fold into `useDashboardWorkQueue` and the Builder's foreground requests. Remove their
  independent timers and once-per-mount guards after both callers are migrated.
- `lib/dashboard/project-refresh-schedule.js` contributes its useful staleness policy to the work planner; remove the
  unbounded catch-up loop and replace its once-per-pass budget with scheduler admission and coverage accounting.
- `lib/dashboard/project-task-collection.js` and
  `lib/plan-wizard/stack-rank/refresh-stale-project-rankings.js` retain compatibility exports while their orchestration
  is extracted into handlers. Their domain transformations call `QuarterProject` methods.
- `lib/hooks/use-dashboard-task-updates.js` sends observations to `DashboardTaskSnapshot` and invalidates affected
  work, while preserving the immediate existing widget update behavior.
- `lib/dashboard/day-project-candidates.js` qualifies projects for the day and asks each hydrated project's
  `taskCandidates` for its candidate records. `suggestion-task-rank.js` and `suggestion-task-slots.js` carry the
  shared `task:`/`idea:` identity through ranking, reserve promotion, and deduplication.
- `lib/dashboard/dream-task.jsx` and `lib/dashboard/proposed-agenda.jsx` subscribe to narrow result revisions, promote
  jobs for missing visible data, and keep stable cached UI. An accepted result updates the relevant surface, not the
  whole Dashboard tree on every queue transition.
- `lib/dashboard/proposed-agenda-suggest-action.js` reads prepared output through a bounded host runtime. Neither
  it nor `lib/plugin.js` imports the browser driver, mount coordinator, context, or React hook.

Keep urgent rendering and maintenance activation independently selectable. Later enrichment features can be disabled
without disabling either foundation. Never run legacy maintenance and queued maintenance for the same scope
simultaneously. A rollback may read retained outputs without resuming new jobs, but verify that its writers preserve
the current schema. Feature activation and commit readiness are separate decisions.

### Verification across phases

Add or extend the following focused tests. Use injected clocks, frame callbacks, observers, and controlled promises;
do not make tests wait real seconds for a scheduling window.

| Test file | Required behavior |
| --- | --- |
| Extend `test/quarter-project.test.js` | Required identity/defaults, mutable setter semantics, replacement score-map cache correctness, serialization/adoption of new fields, and deliberate omission of day evidence |
| Add `test/quarter-project-repository.test.js` | Detached instance/collection ownership, guide-versus-store authority, JSON rehydration, different recommendation dates, failed-write isolation, legacy migration, stale result rejection, and field-level merges from overlapping jobs |
| Add `test/dashboard-work-scheduler.test.js` | Promotion/deduplication, resource-independent dispatch, foreground inheritance, fairness, domain cancellation, no drain-wide await, and no self-invalidating refresh loop |
| Add `test/dashboard-resource-budget.test.js` | Global nested-batch limits, idempotent release, no permits held across resources, and foreground requests overtaking pending maintenance |
| Add `test/dashboard-work-repository.test.js` | Versioned persistence, checkpoint recovery, interruption after output commit, expired claims, retries, and bounded history |
| Add `test/dashboard-note-writer.test.js` | Same-note serialization, fresh merge inputs, preservation of user-owned definitions, and failures not poisoning later writes |
| Add `test/widget-mount-coordinator.test.js`; extend `test/lazy-widget-mount.test.js` | Visible/near priority, many entries in one observer batch, scroll reversal, promotion, one admission per frame, commit/error/watchdog release, nested overlays, missing-observer fallback, removed widgets, and StrictMode cleanup |
| Add `test/dashboard-work-integration.test.js`; extend `test/dashboard-load-tracking.test.js` | A visible mount completes while a provider promise remains pending; offscreen placeholders still settle; late scroll does not reset initial analytics or project coverage; cold data does not deadlock mounting |
| Add `test/dashboard-task-snapshot.test.js` and `test/quarter-project-work-planner.test.js` | Old-task edits, reopen/completion observations, partial fetches, successful watermarks, distinct-project quotas, and background work retained across visits |
| Add `test/dictionary-term-refinement.test.js` and `test/project-task-idea-ratings.test.js` | Bounded sourced passages with full footnotes, protected definitions, revision invalidation, independent actionability, and changed/rejected idea handling |
| Add `test/day-ranking-store.test.js`; extend existing suggestion suites | Shared context keys, exposure separated from preparation, mixed candidate reserves, and preserved user decisions |
| Add `test/dashboard-work-diagnostics.test.js` and `test/dashboard-work-diagnostics-store.test.js` | Explicit waiting reasons, bounded events/history, post-reopen outcomes, sanitized export, stale remote observations, and telemetry failures not failing jobs |
| Add `test/dashboard-queue-inspector.test.js` and `test/dashboard-admin-tools.test.js` | Existing admin/debug availability policy, observation without Console Logging, filters, update throttling/cleanup, and inspection without mutating or depending on the stalled queue |

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

Also measure visibility-to-admission and visibility-to-commit latency, mount backlog, React commit duration, and long
main-thread tasks during fast scrolling and overlay dismissal. Verify on mobile that a pending LLM request never holds
up admission of a visible component. Measure actual commit cost rather than treating a cheap state setter as proof of
a cheap render. Browser verification should exercise rapid scrolling, layout changes, and foreground data contention;
no library upgrade or bundler code splitting is required by this design.

Run focused Jest suites with `NODE_OPTIONS=--experimental-vm-modules` during implementation. For shared services or host
imports, finish with `npm run build` and the production smoke test:
`NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --runTestsByPath test/production-plugin.test.js --no-coverage`.

Urgent rendering and the admin inspector can ship after phases 3 and 4. Queued project maintenance becomes usable after
phase 6; dictionary enrichment, rated ideas, and prepared suggestions can then ship independently in phases 7–9.
There is no requirement to combine these phases into one commit or wait for the entire vision before shipping a part.
