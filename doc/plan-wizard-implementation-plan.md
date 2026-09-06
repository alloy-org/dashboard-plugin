# Plan Builder / plan-wizard: implementation plan and progress

Build a React-free subsystem in `lib/plan-wizard/` that owns a durable, progressively refined planning model.
The archived Vision Guide note is its source of truth. The wizard, background discovery, Proposed Agenda,
calendar suggestions, and eventual Quarterly Goals output consume explicit views of that same model.
Keep wizard components in `lib/dashboard/plan-wizard/` to follow the repository's JSX convention.

This proposal is based on the complete
[brainstorming note](https://public.amplenote.com/t85cci4pmXL6of2XmtnW75wt.md), including its Rich Footnotes.
The initial deliverable is reliable persistence plus inferred and chosen intents; the remaining wizard designs
inform the schema without requiring all their screens now. The first persistence slice is now implemented;
see [`lib/plan-wizard/README.md`](../lib/plan-wizard/README.md) for its API and current scope.

## Progress as of September 6, 2026

**Goal/intent persistence, evidence collection, and intent inference are implemented and tested. The
user-facing wizard is not implemented.**

Completed:

- [x] Native `GoalSet` and `IntentPossibility` classes with validating constructors and JSON persistence.
- [x] Archived annual guide discovery/creation, domain identity, all four quarterly intent sections, and
  recovery from interrupted initialization using a stable domain/year tag.
- [x] Read-only retrieval through `readPlanGoals`; timestamped chosen-goal updates through `savePlanGoals`;
  independent category-specific suggestion snapshots through `savePlanIntentPossibilities`.
- [x] Stable record IDs, ranked/category uniqueness, stale-update protection, explicit deletion records,
  preservation of extension fields/prose, and separation of human choices from suggestions.
- [x] Section-targeted writes, missing-ancestor recovery, local write serialization, and save verification.
- [x] Compatibility with the existing generic app bridge; no plan-wizard-specific `onEmbedCall` cases.
- [x] Live API checks for headingless initialization, parent/child replacement, sibling preservation, and JSON
  round trips. All 28 datastore tests and 21 plugin/production smoke tests passed; production build succeeded.
- [x] Usage documentation and persistent Rich Footnote reading guidance. Attribution remains only in
  `AI_CONTRIBUTIONS.md`.
- [x] Evidence collection and intent inference: bounded task/note/calendar retrieval, the shared Rich Footnote
  parser, window widening with recorded coverage, personal-tag boundaries, defaults for sparse evidence, and
  `refreshPlanIntentPossibilities` orchestration. Suggestions are now generated rather than only accepted.

Remaining, in recommended order:

1. Build the first wizard page, hook, and planning-card entry point, including development app support,
   loading/error/retry behavior, saving, and resuming. The service APIs already exist for these operations.
2. Implement `ActionProspect` and `ProspectTask` classes/persistence, project discovery, human endorsement,
   proposal counting, scheduling/completion/rejection transitions, and monthly history rollover.
3. Connect ongoing discovery and read-only planning context to Proposed Agenda and calendar recommendations.
4. Implement the remaining wizard steps and populate the Quarterly Goals template from confirmed choices.

Current limits: the wizard UI does not exist, so inference is reachable only through the service API.
Project headings are placeholders; no project/task records are managed yet. Horizontal rules
inside a section being rewritten are rejected. Local queues do not provide transactions across embeds/devices.
The design sections below include planned behavior beyond the implemented first pass; file statuses identify
which parts are still pending.

## Storage contract

Create one archived `[Task domain] Mission Builder Vision Guide [year]` note per domain and planning year,
using the existing dashboard tag. Create `[Task domain] Mission Builder History [year]` only when needed.
Use the domain UUID for identity and its display name for titles. The domain is independent of the two user
categories: the Work domain can contain both professional and personal intents, as in the source examples.
Use an explicit All Notes identity when there is no configured domain.

Store schema version, domain UUID/name, and year in metadata. Cache resolved note UUIDs only as an optimization;
validate them and recover through archived-note discovery and metadata matching. Handle renamed domains,
local UUID resolution, deleted notes, partial initialization, and duplicate candidates without silently choosing
an unrelated note or creating another copy. A read-only consumer must never create a missing guide.

The service accepts an explicit quarter/year or defaults to the next quarter using local calendar dates.
December defaults therefore select Q1 of the next year, including on and after December 15. Explicit historical
periods remain accessible and are never silently redirected. The future wizard should show the selected quarter
and receive it from the planning card; derive the guide year from that effective quarter.

Use readable headings with one fenced JSON payload per writable leaf. JSON fits the nested arrays, nullable
fields, and evolving records better than tables. Avoid maintaining a table and JSON as competing sources of
truth; a readable table can be a later derived view. Persist strict JSON, not the JavaScript-like sketches in
the footnotes. Preserve unknown fields for compatible additions; reject unsupported schema versions for writes.

Proposed structure, with bracketed content below standing for actual labels/identifiers:

```text
Preamble: purpose and link to the quarterly plan, when one exists
# Guide metadata
# Top-line intent
## Intents prophesized
### [Q4 2026] Professional possibilities
### [Q4 2026] Personal possibilities
## Intents picked
### [Q4 2026] Picked intents
# Professional projects and goals
## Professional ideas & prospects
## [October 2026] [Calendar task suggestions] [prospect UUID]
### [2026-10] [prospect UUID] Awaiting approval
### [2026-10] [prospect UUID] Scheduled
### [2026-10] [prospect UUID] Completed
### [2026-10] [prospect UUID] Rejected
# Personal projects and goals
## Personal ideas & prospects
```

Precreate all fixed headings. When adding a quarter or prospect/month, insert its complete set of child headings.
The category-specific prospect indexes each hold canonical `ActionProspect` records; the month/prospect sections
hold task buckets. Sort sibling month/prospect headings alphabetically as requested. Include the prospect UUID
in its display heading to disambiguate identical summaries, and the month in task headings because the same
prospect can span months. Resolve targets by stored identity, not a summary that the user may rename.

Quarter-specific intent leaves are implemented: they prevent planning next quarter from replacing
the current quarter's choices in the same annual guide. Other quarter-specific preferences should follow the
same pattern when their screens are implemented.

## Models and ownership

Use native JavaScript classes with validating constructors and plain JSON serialization.
Keep the four model names from the note. These additions are proposed clarifications rather than fields already
specified by the source.

`GoalSet` and `IntentPossibility` are implemented. `ActionProspect` and `ProspectTask` remain planned. In the current
suggestion format, the quarter is identified by its note section and `generatedAt` belongs to the category
snapshot envelope. Storage permits zero to three suggestions; generating the intended three is future work.

| Model | Source fields and proposed additions | Update rules |
| --- | --- | --- |
| `IntentPossibility` | Keep `intent`, `substantiation`, `confidence` (1–10). Add UUID, category, quarter key, evidence references, generation time, and source kind (`inferred` or `default`). | Maintain three suggestions per category. Reuse stable IDs for equivalent suggestions; refresh evidence without converting a suggestion into a picked intent. Defaults explicitly have no supporting personal evidence. |
| `GoalSet` | Keep `goalText`, `goalRank`, `taskDomain`, `userCategoryEm`, `capturedAt`. Add stable UUID, domain UUID, quarter key, and optional originating possibility UUID. | Unique by `[goalRank, userCategoryEm]` within domain/quarter. Newer capture wins. Use full ISO timestamps for new writes and a deterministic conflict rule for ties. Preserve ranks when secondary goals are edited; explicitly handle deletion/reordering. |
| `ActionProspect` | Keep UUID, approval status, summary, focus months, preferred weekdays, primary note, priority, related notes/tasks, substantiations, and both refresh timestamps. Add category, linked goal UUIDs, evidence references, and decision timestamp. | Human-provided/affirmed/rejected/retired status and chosen priorities survive inference refreshes. Merge evidence by stable task/note identity. Keep rejected/retired identities to avoid proposing the same idea repeatedly. |
| `ProspectTask` | Keep approval, importance, task UUID/text, proposal count, substantiation, completion time, duration, and match score. Add its own stable UUID, parent prospect UUID, decision time, and schedule data. | A suggestion needs identity even before an Amplenote task exists. Link a real task later without changing that identity. Validate match score 1–10 and positive duration. |

Preserve source enum spellings such as `awaitingJudgement`, `humanAffirmed`, and `quarterFocus` in storage.
Normalize month labels to `YYYY-MM` and weekdays to a documented enum; format display labels at the edges.
Use a task UUID for a prospect initially when appropriate, as proposed, but never change its established identity
if a primary task is linked later. A prospect can support multiple chosen intents.

Separate task approval from scheduling: `humanApproved` does not prove the task is on the calendar. Add a small
schedule status (`unscheduled`/`scheduled`) and optional start time. With the four requested headings, approved
but unscheduled tasks remain in the pending-work bucket headed “Awaiting approval”; consumers inspect the record
rather than infer approval from that heading. A fifth “Approved, unscheduled” heading is a possible later UX
improvement. Completion is based on the actual task state, not an LLM prediction.

For authoritative task placement, identify one active prospect/month bucket per task suggestion. Other focus
months reference the same identity instead of copying a mutable task record. Cross-bucket moves write the
destination, verify it, then remove the source; reads deduplicate by UUID/transition time after interruption.
Count distinct proposal events, not retries, in `proposedCount`.

## Section writes and recovery

Route every datastore content mutation through one repository writer using
[`app.replaceNoteContent` with `section`](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface#app.replaceNoteContent).
The API preserves the targeted heading and can return `false` if the section is missing. Re-read sections and
handle that return value as a failed write. Do not report success on a bridge error envelope.

Live API checks confirmed that parent replacement includes nested headings and preserves sibling sections.
The initial headingless section also accepts the complete note skeleton, so bootstrap requires no exception
to targeted writes. Duplicate owned headings are rejected before writing. Horizontal rules introduce additional
headingless boundaries and remain unsupported inside a target being rewritten. The existing development
`replaceSectionContent` utility was not used as evidence for production behavior.

Use the nearest existing ancestor/insertion section to create missing children, preserving exactly the content
that the host says belongs to that target. Fetch current sections/content just before structural updates.
For a new empty note, write the complete skeleton to its initial headingless section. Never fall back to
overwriting an existing whole note because parsing or section lookup failed.

Serialize writes per note in the running service, including structural edits that overlap child writes.
Apply field-aware merges to freshly read records, retain unrelated prose/unknown sections, and verify affected
records after writes. Malformed JSON remains intact and produces a recoverable error; it must not become `[]`.
Bound retries and preserve the user's unsaved text on failure. Long inference runs must re-read at merge time.

Section isolation reduces collisions; it is not a cross-device transaction or compare-and-swap guarantee.
Local queues cannot prevent other clients from writing concurrently. Tests should cover recoverable conflicts,
and the implementation should state the remaining last-writer risk rather than promise lossless concurrency.

## Initial files and implementation status

Implement these in dependency order. Keep files around 300 lines and functions around 50 lines; split further
only when actual implementation size warrants it.

| File | Status | Responsibility / remaining work |
| --- | --- | --- |
| `lib/plan-wizard/plan-models.js` | Implemented for intents/goals | Validating classes, stable identities, JSON validation, planning periods. Add prospect/task classes later. |
| `lib/plan-wizard/vision-guide-markdown.js` | Implemented for intents/goals | Annual skeleton, heading/fence parsing, JSON payload updates. Dynamic prospect/month headings remain. |
| `lib/plan-wizard/vision-guide-notes.js` | Implemented | Archived discovery, metadata identity, interrupted initialization, and targeted API writes; extracted from the proposed repository responsibility. |
| `lib/plan-wizard/vision-guide-repository.js` | Implemented for intents/goals | Validated reads, serialized updates, ancestor recovery, and write verification using an explicit `app`. |
| `lib/plan-wizard/vision-guide-merge.js` | Implemented for intents/goals | Ranked uniqueness, timestamps, stable IDs, deletions, and separate suggestion snapshots. Prospect evidence/events/transitions remain. |
| `lib/plan-wizard/plan-wizard-service.js` | Implemented for intents/goals | Read goals, save chosen goals, save supplied suggestions, and refresh generated suggestions end to end. |
| `lib/plan-wizard/README.md` | Implemented | Consumer API examples, storage semantics, validation, and current limitations. |
| `lib/plan-wizard/intent-evidence.js` | Implemented | Bounded task/note/calendar collection, completion filtering, personal tags, and evidence references. |
| `lib/plan-wizard/intent-inference.js` | Implemented | Prompt construction, provider invocation, response validation, up to three suggestions per category, and defaults. |
| `lib/util/amplenote-rich-footnotes.js` | Implemented | Shared host-compatible parser: multiline definitions, fenced content, nested references, and missing-definition reporting. |
| `lib/hooks/use-plan-wizard.js` | Not started | Loading/saving/retry state, stale-response protection, and service calls with the existing app proxy. |
| `lib/dashboard/plan-wizard/plan-wizard.jsx` | Not started | Wizard shell, selected quarter/domain, close/resume behavior, and routing. |
| `lib/dashboard/plan-wizard/intent-step.jsx` | Not started | Intent fields, suggestion buttons, secondary goals, and save/continue interaction. |
| `lib/dashboard/plan-wizard/plan-wizard.scss` | Not started | First-page styles matching the supplied design. |

Existing integrations to modify when implementing:

- `lib/plugin.js`: keep the existing generic bridge. Service functions accept the normal host app or embed app
  proxy and call its existing API methods; do not add plan-wizard-specific dispatch cases.
- `lib/dashboard/planning.jsx`: launch the wizard with the selected domain and quarter; retain the existing
  navigation path for an already-created plan. Import the new shell here, not from the host.
- `lib/util/browser-dev-app.js` and test helpers: support the standard note APIs and verified section behavior
  for the development UI. Do not invent production app methods to make a mock pass.
- `jest.config.js`: existing module paths already resolve `plan-wizard/...`; verified without configuration
  changes. The existing esbuild resolver also supports the new service, including its standalone host test.
- `AI_CONTRIBUTIONS.md`: keep all authorship attribution here. Source files get purpose comments and behavioral
  line-comment JSDoc, following `CLAUDE.md` and `doc/code_conventions.md`. No commits.

## First-page behavior and inference

Load cached suggestions and picked intents before calling the LLM. For a first run, show the shell/loading state
while gathering evidence; the form should still permit manual answers if inference is slow or unavailable.
Never overwrite text the user has started typing when a background response arrives.

Evidence collection follows the brainstorm:

1. Read one month of genuinely completed tasks in the selected domain. Extend the window up to three months
   until at least 50 exist. If fewer than 50 remain, supplement with up to 100 of the most recently created
   tasks, deduplicated and sorted by actual creation time. Bound note fan-out and summarize in batches when
   the resulting evidence exceeds the prompt budget; persist the actual coverage window and sampling counts.
2. Interpret personal tags by path segments: case-insensitive `me` or `personal` at any hierarchy level,
   equivalent to `(^|/)(me|personal)(/|$)`. Read recently completed tasks from matching notes within the selected
   domain; missing domain evidence leads to defaults, not an implicit expansion into other domains.
3. If personal tagged evidence is absent, use three months of completion evidence and available calendar events
   to identify hobbies/pursuits. The calendar fallback uses its available upcoming window, not an invented
   three-month historical feed. Exclude the datastore/generated planning notes from evidence to avoid feedback.
4. Produce a compact occupation/hustle hypothesis and three high-level professional possibilities. Produce three
   personal possibilities, defaulting to “Get outdoors more”, “Connect with family/friends”, and “Improve my diet”.
   Store the hypothesis with its evidence window and timestamp beside the possibilities. Low evidence means low
   confidence; defaults must not pretend the user has expressed these goals.

The [app API reference](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface) notes that
completed-task retrieval also includes dismissed/crossed-out items, so filter outcomes deliberately. Normalize
API timestamps before applying date rules. Reuse `util/all-notes-tasks.js`, `util/note-handles.js`,
`util/task-domain-utility.js`, and `util/calendar-utility.js` where suitable; handle arrays/iterators consistently.
Reuse `providers/fetch-ai-provider.js` rather than adding provider configuration. Send compact referenced evidence,
including relevant Rich Footnote bodies, and treat note content as data, not prompt instructions.

Match the first design's prompt: “This quarter will be a success if…” with Professional and optional Personal
fields, three clickable suggestions each, and “Add a secondary or more granular goal.” Clicking a suggestion
populates the focused field; it becomes a chosen intent when saved. Explain that the next stage derives concrete
projects from notes/tasks. Show save progress, errors, and retry inline; reopening restores the persisted answers.

For the first slice, save the answers and show a saved state. Enable “Find my projects” as the continuation only
when the discovery milestone exists. Do not imply projects have been generated by an unimplemented next step.

## Following files, after the first slice

All files in this section remain unimplemented.

| File | Milestone |
| --- | --- |
| `lib/plan-wizard/prospect-discovery.js` | Harvest ongoing ActionProspects from at least two supporting tasks, recent important work, completion clusters, and useful note titles. Tie candidates to chosen intents and favor automation/upstream improvements. |
| `lib/plan-wizard/prospect-task-service.js` | Generate implementation ideas, persist proposal events, and reconcile approvals, actual scheduling, completion, and rejection through the repository. |
| `lib/plan-wizard/vision-guide-history.js` | Move past month/prospect combinations into archived annual history: month headings, prospect subheadings, and completed-task evidence. Copy, verify, then remove; resume safely after interruption. Preserve active multi-month prospects and rejection memory. |
| `lib/plan-wizard/quarterly-goals-template.js` | Pure projection of confirmed intents, endorsed prospects, months, and later pacing/preferences into the existing Quarterly Goals structure. |

Start history rollover before enabling continuous background harvesting, so an evergreen annual guide stays
bounded. Keep the history heading month tied to the archived work's year, independent of the next planning year.
Retain only useful compact evidence in active records; move older completed detail to history.

Wire the context reader into `lib/recommendation-context/` and Proposed Agenda/calendar services once prospect
discovery exists. Recommendation paths read a bounded snapshot and continue normally when no guide exists;
they should not wait for a fresh LLM analysis. Refresh on wizard entry and throttled dashboard activity, with
last-success timestamps and evidence fingerprints, rather than on every render. Rejected/retired prospects are
exclusions; inferred and affirmed prospects remain distinguishable in prompts.

The brainstorm's “ten most-opened notes in the past month” needs an API capability check: sorting by most
recently opened does not establish frequency counts. Omit that signal if unavailable; do not fake it. Likewise,
check creator metadata before claiming notes are authored by the current user.

The existing template is `_defaultQuarterlyTemplate` in `lib/data-service.js`; existing plan lookup/naming is in
`lib/util/quarterly-plan-notes.js`. Extract/reuse the template when implementing the output adapter. Use the
guide as planning knowledge and the quarterly note as its user-facing projection. Preview generated content and
preserve existing user-written content; retain destination note UUID and generation fingerprint for idempotency.
If “Quarterly Goals Template” refers to a separate custom note, its concrete content will be needed at that
milestone, but it does not block this datastore design.

## Validation and implementation order

1. **Completed for goal/intent persistence:** live section checks; validating classes, markdown, merge, repository,
   and service APIs. Existing suites are `test/plan-wizard-models.test.js` (including merge tests),
   `test/plan-wizard-markdown.test.js`, `test/plan-wizard-repository.test.js`, and
   `test/plan-wizard-host.test.js`, supported by `test/fixtures/plan-wizard-app.js`. All 28 tests passed, plus
   21 plugin/production smoke tests and the production build. No separate merge test file was needed.
2. **Completed for evidence/inference:** `test/amplenote-rich-footnotes.test.js` and
   `test/plan-wizard-intents.test.js` cover footnote resolution, window widening, outcome filtering, personal-tag
   boundaries, sparse-evidence defaults, provider failure, and end-to-end refresh, using deterministic provider
   responses rather than a live LLM. **Next:** the first page, its hook, and the planning entry point, with
   `test/plan-wizard-ui.test.js`.
3. **Later:** add prospect/task classes and persistence, ongoing discovery, task transitions, history rollover,
   and consumer integration with focused
   lifecycle/history tests. Implement the remaining wizard steps and template projection after those contracts.

Persistence tests must cover archived note discovery, domain/year isolation, December 14/15 and year boundaries,
multiple quarters in one guide, JSON round trips, duplicate summaries, missing sections, false write returns,
interleaved writes to separate leaves, human decisions surviving refresh, malformed content preservation, and
restart/retry behavior. Test personal-tag boundaries, sparse evidence/defaults, outcome filtering, and footnotes
with multiline code. UI tests cover suggestion selection, optional Personal answers, secondary ranks, failure
and retry, reopening, and switching domains while an earlier request is still pending.

After host imports/shared services change, run `npm run build` and
`NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --runTestsByPath test/production-plugin.test.js --no-coverage`,
plus the focused new suites using the same VM-modules flag. Visually verify the first page in development against
the supplied design, including loading, failure, and narrow layouts.

The first user-facing milestone, still pending, is complete when a user can open the wizard, see grounded suggestions (or explicit defaults),
choose or type ranked intents, save them in the correctly scoped archived guide, close/reopen without losing
choices, and have another service read those choices without generating suggestions or mutating the note.
