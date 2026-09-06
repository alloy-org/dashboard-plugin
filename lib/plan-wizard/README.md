Goal and intent persistence for the planning wizard and other dashboard consumers.

# First-pass API

Import the service and pass the existing Amplenote `app` interface or embed app proxy. It uses ordinary
`filterNotes`, `findNote`, `createNote`, `getNoteContent`, and `replaceNoteContent` calls. No custom
`onEmbedCall` cases or new app methods are required.

```javascript
import { readPlanGoals, savePlanGoals, savePlanIntentPossibilities } from "plan-wizard/plan-wizard-service";

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

`readPlanGoals` returns `{ generatedAt, goalRecords, goals, noteUuid, possibilities, scope }`:

- `goals`: active `GoalSet` instances, sorted by category and rank.
- `goalRecords`: all goal instances, including deletion records for reconciliation.
- `possibilities`: `{ personal: IntentPossibility[], work: IntentPossibility[] }`.
- `generatedAt`: separate inference timestamps for the two categories.
- `noteUuid`: null when the datastore has not been initialized. A read never creates or repairs a note.

`GoalSet` and `IntentPossibility` are native JavaScript classes with validating constructors. They serialize
directly to plain JSON and are reconstructed on reads. Assignment to a property is ordinary JavaScript;
validation runs again when the object is saved or reloaded. Constructors retain compatible extension fields.

Both save methods return the verified current context. They create an archived annual guide if necessary.
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

Suggestion saves replace one category's snapshot, with up to three possibilities. They require `generatedAt`,
ignore older/tied snapshots, and reuse UUIDs when suggestion text matches. `sourceKind: "default"` identifies
generic advice and cannot carry personal evidence. Saving suggestions never picks a goal or alters human choices.

# Note format and write behavior

The note is named `[Task domain] Mission Builder Vision Guide [year]`, tagged `plugins/dashboard` and
`plugins/dashboard/plan-wizard`, with an additional domain/year tag for interrupted-creation recovery.
Metadata contains the stable domain UUID, year, and schema version. Renaming the domain or note does not change
identity. Multiple matching guides produce an error rather than silently choosing one.

All content writes use `replaceNoteContent` with an explicit section, including the initial headingless section.
Fenced JSON lives below unique quarter/category headings. Writes replace only the owned JSON fence within a leaf,
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

This first pass stores/retrieves top-level goals and supplied intent possibilities. It reserves project headings;
project discovery, `ActionProspect`/`ProspectTask` persistence, inference generation, wizard UI, monthly history,
and Quarterly Goals template population remain subsequent milestones.

Run the focused suites with:

```sh
NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --testPathPattern='plan-wizard' --no-coverage
```

The host suite builds the standalone service, checks its dependency boundary, and exercises saving/retrieving in
a VM without browser globals or a module loader. Repository tests also exercise the unchanged generic embed bridge.
