Goal, intent, and project persistence for the planning wizard and other dashboard consumers.

# First-pass API

Import the service and pass the existing Amplenote `app` interface or embed app proxy. It uses ordinary
`filterNotes`, `findNote`, `createNote`, `getNoteContent`, and `replaceNoteContent` calls. No custom
`onEmbedCall` cases or new app methods are required.

```javascript
import { readPlanGoals, refreshPlanActionProspects, refreshPlanIntentPossibilities, savePlanGoals,
  savePlanIntentPossibilities, savePlanProspects, savePlanQuarterAnswer } from "plan-wizard/plan-wizard-service";

const scope = { domainName: "Work", domainUuid: "domain-uuid", quarter: 4, year: 2026 };
const planningContext = await readPlanGoals(app, scope);

await savePlanGoals(app, { ...scope, goals: [
  { capturedAt: new Date().toISOString(), goalRank: 1, goalText: "Grow revenue", userCategoryEm: "work" },
  { capturedAt: new Date().toISOString(), goalRank: 1, goalText: "Get outdoors weekly", userCategoryEm: "personal" },
] });

await savePlanIntentPossibilities(app, { ...scope, generatedAt: new Date().toISOString(), possibilities: [
  { confidence: 6, intent: "Grow revenue", sourceKind: "inferred", substantiation: "Several recent product tasks" },
], userCategoryEm: "work" });
```

`refreshPlanIntentPossibilities` is the generating counterpart: it collects evidence, calls the shared AI
provider, and persists a snapshot per category, returning the planning context plus `failureReason` and
`occupationHypothesis`. Pass `promptRunner` to substitute a deterministic provider and `referenceDate` to fix
the evidence window.

```javascript
const context = await refreshPlanIntentPossibilities(app, scope);
```

`readPlanGoals` returns `{ dailySufficiency, generatedAt, goalRecords, goals, noteUuid, possibilities,
prospectRecords, prospects, quarterName, scope }`:

- `goals`: active `GoalSet` instances, sorted by category and rank.
- `goalRecords`: all goal instances, including deletion records for reconciliation.
- `possibilities`: `{ personal: IntentPossibility[], work: IntentPossibility[] }`.
- `prospects`: `ActionProspect` instances for this quarter, excluding rejected and retired projects.
- `prospectRecords`: every prospect for this quarter, including rejected and retired ones, so an editor can
  reconcile them and discovery can avoid reproposing an idea the user already declined.
- `quarterName` / `dailySufficiency`: `{ capturedAt, text }` or null; the two answers scoped to the whole quarter
  rather than to any single project.
- `generatedAt`: separate inference timestamps for the two categories.
- `noteUuid`: null when the datastore has not been initialized. A read never creates or repairs a note.

`GoalSet`, `IntentPossibility`, `ActionProspect`, and `ProspectTask` are native JavaScript classes with validating
constructors. They serialize directly to plain JSON and are reconstructed on reads. Assignment to a property is
ordinary JavaScript; validation runs again when the object is saved or reloaded. Constructors retain compatible
extension fields.

Every save method returns the verified current context. They create an archived annual guide if necessary.
To default to All Notes, omit both domain fields. To default to the next quarter, omit both quarter/year;
explicit periods allow historical access, including after December 15. The same annual note contains all four
quarters so current and upcoming planning coexist.

# Update semantics

Each goal occupies `[goalRank, userCategoryEm]` within a domain/quarter. A capture newer than the stored timestamp
replaces that slot; older captures and exact timestamp ties leave the stored choice intact. A missing UUID
reuses the slot's current identity or generates a new one. Provide UUIDs when explicitly swapping ranks between
existing goals; the complete resulting set must have unique UUIDs.

Every update requires its own `capturedAt`. Preserve that timestamp when retrying the same edit. Omitting a goal
from a save leaves it unchanged. To delete a slot, send its rank/category with `goalText: ""`, `isDeleted: true`,
and a newer `capturedAt`. A later explicit restoration sends `isDeleted: false` and a newer timestamp.

Prospects are matched by the tasks they cite rather than by their wording, because wording is the least stable
thing a provider returns. `prospect-similarity.js` measures Jaccard overlap of two records' cited task UUIDs; at
or above `PROSPECT_DUPLICATE_OVERLAP` (0.4) an incoming proposal is a restatement of the stored project and is
merged into it, inheriting its identity. A UUID the caller supplies is honoured first, so renaming a project
being edited cannot redirect the write into a neighbour. Either way the stored record absorbs the restatement's
citations and provenance, so the task count the page shows rises as duplicates fold together.

That replaced UUID equality alone. Discovery derived a UUID by hashing the summary, so every rewording arrived as
a project nobody had judged: one leaf accumulated 49 unjudged records that were really 6 undertakings, among them
eight spellings of the same Diff Digest launch, and it grew to 188,890 characters against a 100,000-character
write limit. Measured against those 49 records, overlap grouped them into exactly the 6 real projects, with the
closest unrelated pair at 0.32 and thresholds of 0.4 and 0.5 producing an identical grouping.

A newer `capturedAt` replaces the stored record; an older or tied one leaves its fields intact. A human decision
outranks an inference: once a prospect is `humanProvided`, `humanAffirmed`, `humanRejected`, or `retired`, a later
`awaitingJudgement` proposal for the same identity is discarded rather than demoting it, so a discovery rerun
cannot undo what the user chose. Rejected and retired records stay stored, with their evidence, so the same idea
is recognized and not reproposed.

Every proposal that shaped a project is recorded in its `provenance`: when it arrived, the `triggerAction` that
set the pass going, which provider answered (`agent-pro` or `direct-provider`, from the leg that won the race in
`wizard-prompt-runner.js`), the model, and the summary it proposed. The entry matching the project's current
summary is the `originator`; the rest are `mergedContributor`, so the wording that was folded in survives at
about 200 characters instead of a 3,500-character record. Roles are re-derived on every merge rather than carried
forward, so they stay honest through a rename. The trail is capped at 24 entries, keeping the oldest.

`consolidatePlanActionProspects` cleans up what is already stored: it groups a quarter's unjudged proposals by
the same overlap rule and writes one project per group under the surviving member's identity, carrying every
member's evidence, links, and provenance. Which records are one project, and which identity survives, is decided
from the cited tasks alone — the same rule the merge applies to incoming proposals, so a stored group collapses
on the same authority. Judged projects are never touched. It runs on demand, because combining is a rewrite of
what the user is about to read. Records it absorbs are removed through `savePlanProspects`'s
`removeProspectUuids`, and their placement buckets are emptied first.

A provider is asked for one thing the ratio cannot supply: the title a person would have written for the whole
undertaking, rather than the best of the eight summaries already in the group. That is a refinement layered over
a completed merge, not a gate on it — if the call fails, times out, or names a group unusably, the group still
collapses under the wording of the member covering most of the group's vocabulary, and the provenance entry
records a null `promptSource` to say so.

The projects page offers it as `Combine N overlapping suggestions`, shown only when a category's stored proposals
still form a group of more than one. They can, even though the merge folds restatements in on the way: the merge
matches one incoming record against one stored record, so a proposal bridging two others merges into whichever it
overlaps most and leaves the third beside it. Against the 49 production records, merging alone reduced them to 11
and 24,973 characters; grouping the survivors found 8 projects, at about 19,600.

`savePlanQuarterAnswer` writes one of `quarterName` or `dailySufficiency` into the picked-goals leaf, since both
are scoped to the quarter rather than to a project. They follow the same newest-capture-wins rule as goals.

Suggestion saves replace one category's snapshot, with up to three possibilities. They require `generatedAt`,
ignore older/tied snapshots, and reuse UUIDs when suggestion text matches. `sourceKind: "default"` identifies
generic advice and cannot carry personal evidence. Saving suggestions never picks a goal or alters human choices.

# Evidence and inference

`intent-evidence.js` collects the material inference reasons over, all host-compatible. Completion evidence
starts at one month of genuinely completed tasks in the selected domain and widens a month at a time, up to
three, until 50 exist; below that it is supplemented with up to 100 of the most recently created tasks, sorted
by actual creation time. Dismissed and crossed-out items are excluded, because completed-task retrieval returns
them alongside real completions. The window actually used is recorded in `coverage`, so a stored snapshot never
implies coverage it did not have.

Notes tagged `me` or `personal` at any level of a tag hierarchy — the boundary is `(^|/)(me|personal)(/|$)`, so
`mentoring` does not match — supply personal evidence. When the selected domain holds none, the collector falls
back to the calendar's available upcoming window rather than expanding into other domains or inventing a
historical event feed. Notes tagged for this subsystem are always excluded, so a generated guide never becomes
the evidence for regenerating itself. A bounded sample of source notes is rendered through
`util/amplenote-rich-footnotes.js`, which resolves `[^1]:` definitions — including multiline prose and fenced
code — so specifications stored in footnotes reach the prompt instead of just their visible labels.

`intent-inference.js` sends that evidence as clearly delimited data, never as instructions, and validates the
response into `IntentPossibility` instances, discarding entries that fail the contract rather than repairing
them. Thin evidence caps confidence. When personal evidence is absent it returns the documented defaults —
"Get outdoors more", "Connect with family/friends", "Improve my diet" — as `sourceKind: "default"` with no
evidence and minimal confidence, so the UI can present them as starting points rather than inferred conclusions.
A provider failure or unusable response degrades to those defaults instead of throwing; the caller decides
whether to persist a degraded snapshot.

# Note format and write behavior

There is no migration between schema versions. A guide written under a retired `GUIDE_SCHEMA_VERSION` is refused
with an error naming the note and saying to delete or retag it; the wizard then builds a new one.

The note is named `[Task domain] Mission Builder Vision Guide [year]`, tagged `plugins/dashboard` and
`plugins/dashboard/plan-wizard`, with an additional domain/year tag for interrupted-creation recovery.
Metadata contains the stable domain UUID, year, and schema version. Renaming the domain or note does not change
identity. Multiple matching guides produce an error rather than silently choosing one.

Every content write except bootstrap uses `replaceNoteContent` with an explicit section. Bootstrap passes no
`section` option, which the API documents as replacing the entire note: `section: { heading: null }` bounds the
write to the text above the first heading and silently drops the skeleton's headings. That whole-note write is
reached only for a note that is empty or holds nothing but the bootstrap preamble, never as a fallback for a
note whose parsing or section lookup failed.
Fenced JSON lives below unique quarter/category headings. Intent leaves are level-three headings scoped to a
quarter; the prospect leaves are level-two headings under their level-one project category, one per quarter
(`Q4 2026 Professional ideas & prospects`). They were scoped to the category alone, on the reasoning that a
project outlives the quarter that raised it — it does, and each record still names its own `quarterKey`, but a
leaf is rewritten whole on every save, so category scope made the cost of saving one project the size of every
project that category had ever held. A project carried into a later quarter is written into that quarter's leaf
under the identity it already had.

A prospect leaf is stored in an interned form and hydrated on read (`prospect-leaf-storage.js`). The leaf keeps
one `taskUuids` and one `noteUuids` table and each citation is a `[taskIndex, noteIndex]` pair, because 547
evidence entries in one leaf named only 92 distinct tasks and 19 distinct notes. The five fields
`ActionProspect` recomputes in its constructor — `relatedTasks`, `relatedNotes`, `substantiation`,
`preferredDows`, `primaryNote` — are not written at all. Both are lossless, and together they took that leaf from
188,877 characters to 83,718; with restatements folded together it is under 25,000. Placement buckets hold
`prospectUuids` rather than whole records, which used to store every project a second time.
`intentSectionDefinition` carries each leaf's expected depth and parent chain, and the repository asserts against
that data rather than against hardcoded levels. Writes replace only the owned JSON fence within a leaf,
retaining surrounding prose. Missing leaves are recreated under the nearest available ancestor, preserving its
subtree. The service verifies writes and treats false returns, bridge errors, malformed payloads, duplicate
headings, and unsupported schemas as errors. A failed bootstrap can resume in the same empty archived note.

On September 6, 2026, a live archived verification note confirmed headingless initialization, parent replacement
including child headings, sibling preservation, and a fenced JSON round trip through the connected Amplenote API.
Horizontal rules inside a section targeted for replacement are rejected in this first pass because they introduce
additional headingless boundaries. The parser handles headings/code fences; any future tables should use
`lib/util/markdown-table.js`.

Writes are serialized per app instance, domain, and year within a running JavaScript context. Reuse the existing
app/proxy instance across callers. Separate embeds, host contexts, and devices do not share that queue; the API
offers no compare-and-swap guarantee, so verification reduces but cannot eliminate simultaneous-writer conflicts.
Failed writes throw, allowing the eventual UI to retain the user's input and offer a reload/retry.

# Scope and validation

This pass stores/retrieves top-level goals, generates and stores intent possibilities, persists `ActionProspect`
and `ProspectTask` records, and stores the two quarter-wide answers. All five wizard pages are built and styled;
the wizard opens as a modal over the dashboard (`lib/dashboard/styles/plan-wizard.scss`) rather than inside the
planning widget's cell, since a widget column cannot hold a five-page form.

`refreshPlanActionProspects` proposes the projects that would carry a quarter's chosen intents, from the evidence
`prospect-evidence.js` collects: tasks marked important in the past three months, completions from the past month,
other recently created tasks, and the notes that work happened in. A candidate must cite at least two of those
tasks and advance a chosen intent of its own category, or it is discarded rather than stored. It runs on demand
rather than continuously, and its proposals arrive as `awaitingJudgement` for the user to affirm or reject.

`prospect-task-service.js`, continuous background harvesting, and monthly history remain subsequent milestones.

Both generating passes are run at most once at a time per scope by `usePlanWizard`'s `runExclusivePass`. The
request token discards a superseded pass's rendered result but cannot stop it writing, because a pass persists
what it produced before it returns; a second click therefore used to store a second full set of proposals while
the page showed one. Eleven passes beginning inside the same second is how 48 unjudged near-duplicates reached a
single leaf.

# Publishing to the quarterly plan note

The Vision Guide is the datastore; the quarterly plan note (`Q4 2026 Work Plan`) is what the user reads.
`quarterly-plan-publisher.js` carries decisions from the first into the second, and `use-plan-wizard.js` calls it
after the projects, pace, quarter-name, and done-enough pages save. Per-card priority clicks do not publish, so a
chip click never rewrites the note.

Ownership is carried by a visible `[builder]` suffix on a heading, a line, or one semicolon-separated segment.
The builder may replace or delete anything carrying it and may touch nothing else, which is what lets a plan note
hold hand-written and generated content at once. Where both have something to say on one line — a day-of-week
bullet, a month's Focus — the user's text stays first and project names are appended after it.

- Focus and Keep warm projects become `##` blocks under `# Projects`; Keep warm is marked `[builder: keep warm]`.
  A rewrite carries the user's `Outcome`, `Constraints`, and `Done enough when` values forward from the block it
  replaces, since the wizard never asks about those.
- Not now projects become plain bullets under `# Not This Quarter`. They are bullets rather than `- [ ]`
  checkboxes on purpose: publishing must not create tasks in the user's lists. The done-enough answer, appended
  under `## Success Looks Like`, is a plain bullet for the same reason.
- The quarter's name leads the note as an H1 and is deliberately not repeated under `# Quarter Theme`; that
  sentence and the `## Success Looks Like` outcomes stay the user's. The only scaffolding cleared is a
  `## [Project N]` block still holding its bracketed name and no filled bullets, and only once real projects
  exist to take its place.

`mergedQuarterlyPlanContent` splices the note that was just read, so everything outside the owned sections is
copied forward byte for byte, and the result is written in one whole-note call rather than several section
writes. That write is bracketed: nothing is written if the merge would drop a heading the user wrote, and the
saved note is read back and confirmed to carry every published project before the call reports success.
Republishing an unchanged plan produces identical markdown and performs no write. A section the note does not
have is skipped rather than created, so a plan note restructured by hand degrades instead of breaking.

Run the focused suites with:

```sh
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --testPathPattern='plan-wizard' --no-coverage
```

The host suite builds the standalone service, checks its dependency boundary, and exercises saving/retrieving in
a VM without browser globals or a module loader. Repository tests also exercise the unchanged generic embed bridge.
