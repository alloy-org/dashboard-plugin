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

Prospects are keyed by their own UUID rather than by a slot, because a project has no rank and its summary is
renameable. A newer `capturedAt` replaces the stored record; an older or tied one is ignored. A human decision
outranks an inference: once a prospect is `humanProvided`, `humanAffirmed`, `humanRejected`, or `retired`, a later
`awaitingJudgement` proposal for the same identity is discarded rather than demoting it, so a discovery rerun
cannot undo what the user chose. Rejected and retired records stay stored so the same idea is not reproposed.

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
quarter; the two prospect leaves are level-two headings under their level-one project category and are scoped to
the category, since a project outlives the quarter that raised it and each record names its own `quarterKey`.
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

`prospect-task-service.js`, continuous background harvesting, monthly history, and Quarterly Goals template
population remain subsequent milestones.

Run the focused suites with:

```sh
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --testPathPattern='plan-wizard' --no-coverage
```

The host suite builds the standalone service, checks its dependency boundary, and exercises saving/retrieving in
a VM without browser globals or a module loader. Repository tests also exercise the unchanged generic embed bridge.
