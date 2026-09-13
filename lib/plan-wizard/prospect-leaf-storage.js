// Translate a prospect leaf between the shape consumers read and the shape the note stores.
//
// A project's evidence is the note and task identities it cites, and consumers need all of them: the count is how
// the page says what a project would resolve, and the set is how a restatement of an existing project is
// recognized. Written out in full they were also the single largest thing in the datastore. One category leaf held
// 547 evidence entries naming only 92 distinct tasks and 19 distinct notes, each identity repeated about six times
// at roughly 45 characters with its indentation — and the leaf had to be rewritten whole on every save, which is
// the write that overflowed the plugin's 100,000-character bound at 188,890 characters.
//
// So the note keeps one table of identities per leaf and every citation is a pair of indexes into it, and the five
// fields ActionProspect recomputes in its constructor are left out of the note entirely. Both are lossless: every
// UUID survives the round trip, and a hydrated payload is identical to what the previous schema stored. Together
// they took that leaf from 188,877 characters to 83,718.

import { DERIVED_PROSPECT_FIELDS, copyJsonValue, requireRecord } from "plan-wizard/plan-models";

// Storage index standing for a citation that named no note; a task always names itself.
const ABSENT_IDENTITY_INDEX = -1;
// Leaves whose payload is stored in the interned form rather than as written.
export const PROSPECT_LEAF_KINDS = ["personalProspects", "workProspects"];

// ----------------------------------------------------------------------------------------------
// @desc Report whether a leaf stores prospects, so the callers that serialize and parse fences can ask once
//   rather than repeating the pair of kind names.
// @param {string} kind - Leaf kind.
// @returns {boolean} True for the two category index leaves.
export function isProspectLeafKind(kind) {
  return PROSPECT_LEAF_KINDS.includes(kind);
}

// ----------------------------------------------------------------------------------------------
// @desc Convert a leaf payload into what the note holds: derived fields dropped, evidence interned against one
//   table of task and note identities per leaf.
// @param {string} kind - Leaf kind; a non-prospect leaf is returned unchanged.
// @param {object} payload - Hydrated leaf payload.
// @returns {object} Storage payload.
// Identities are sorted so an unchanged leaf serializes identically and a save that changed nothing performs no
//   write, which is what keeps the note from gaining a revision every time the wizard is opened.
export function storedLeafPayload(kind, payload) {
  if (!isProspectLeafKind(kind)) return payload;
  requireRecord(payload);
  const prospects = payload.prospects ?? [];
  const taskUuids = [...new Set(prospects.flatMap(prospect => citationIdentities(prospect, "taskUuid")))].sort();
  const noteUuids = [...new Set(prospects.flatMap(prospect => citationIdentities(prospect, "noteUuid")))].sort();
  const taskIndexes = new Map(taskUuids.map((uuid, index) => [uuid, index]));
  const noteIndexes = new Map(noteUuids.map((uuid, index) => [uuid, index]));
  const storedProspects = prospects.map(prospect => storedProspectRecord(prospect, noteIndexes, taskIndexes));
  return { ...payload, noteUuids, prospectTasks: payload.prospectTasks ?? [], prospects: storedProspects, taskUuids };
}

// ----------------------------------------------------------------------------------------------
// @desc Convert what the note holds back into the payload consumers read, restoring interned evidence to its
//   { noteUuid, taskUuid } records and letting ActionProspect recompute the derived fields from them.
// @param {string} kind - Leaf kind; a non-prospect leaf is returned unchanged.
// @param {object} storage - Payload parsed from a note fence.
// @returns {object} Hydrated leaf payload.
// A leaf written before interning carries no identity tables and its evidence already holds UUIDs, so it hydrates
//   as itself. That is the whole of the migration: the first save rewrites the leaf in the new form.
export function hydratedLeafPayload(kind, storage) {
  if (!isProspectLeafKind(kind)) return storage;
  requireRecord(storage);
  const taskUuids = storage.taskUuids ?? [];
  const noteUuids = storage.noteUuids ?? [];
  if (!Array.isArray(taskUuids) || !Array.isArray(noteUuids)) throw new Error("Stored evidence identity tables must be arrays");
  const prospects = storage.prospects ?? [];
  if (!Array.isArray(prospects)) throw new Error("Stored prospects must be an array");
  const hydratedProspects = prospects.map(prospect => hydratedProspectRecord(prospect, noteUuids, taskUuids));
  const payload = { ...storage, prospectTasks: storage.prospectTasks ?? [], prospects: hydratedProspects };
  delete payload.noteUuids;
  delete payload.taskUuids;
  return payload;
}

// ----------------------------------------------------------------------------------------------
// @desc Collect one field's identities from a project's evidence, so the leaf table can be built from every
//   citation every project makes.
// @param {object} prospect - Hydrated prospect record.
// @param {string} field - noteUuid or taskUuid.
// @returns {Array<string>} Identities cited under that field.
function citationIdentities(prospect, field) {
  const evidence = Array.isArray(prospect?.evidence) ? prospect.evidence : [];
  return evidence.map(entry => entry?.[field]).filter(identity => typeof identity === "string" && identity);
}

// ----------------------------------------------------------------------------------------------
// @desc Render one project as the note stores it, dropping the fields its constructor derives and replacing each
//   evidence record with a [taskIndex, noteIndex] pair.
// @param {object} prospect - Hydrated prospect record.
// @param {Map<string, number>} noteIndexes - Note identity positions in the leaf table.
// @param {Map<string, number>} taskIndexes - Task identity positions in the leaf table.
// @returns {object} Storage record.
// Unknown fields are carried through rather than dropped, so a record written by a later build survives a save by
//   this one; only the five fields this build knows to be derived are removed.
function storedProspectRecord(prospect, noteIndexes, taskIndexes) {
  const stored = copyJsonValue(prospect);
  for (const field of DERIVED_PROSPECT_FIELDS) delete stored[field];
  const evidence = Array.isArray(prospect.evidence) ? prospect.evidence : [];
  stored.evidence = evidence.map(entry => {
    const taskIndex = taskIndexes.has(entry?.taskUuid) ? taskIndexes.get(entry.taskUuid) : ABSENT_IDENTITY_INDEX;
    const noteIndex = noteIndexes.has(entry?.noteUuid) ? noteIndexes.get(entry.noteUuid) : ABSENT_IDENTITY_INDEX;
    return [taskIndex, noteIndex];
  });
  return stored;
}

// ----------------------------------------------------------------------------------------------
// @desc Restore one stored project's evidence to { noteUuid, taskUuid } records, leaving a record whose evidence
//   was never interned exactly as it was found.
// @param {object} prospect - Stored prospect record.
// @param {Array<string>} noteUuids - Leaf note identity table.
// @param {Array<string>} taskUuids - Leaf task identity table.
// @returns {object} Hydrated record.
function hydratedProspectRecord(prospect, noteUuids, taskUuids) {
  const hydrated = copyJsonValue(prospect);
  const evidence = Array.isArray(prospect?.evidence) ? prospect.evidence : [];
  hydrated.evidence = evidence.map(entry => {
    if (!Array.isArray(entry)) return entry;
    const [taskIndex, noteIndex] = entry;
    const taskUuid = taskUuids[taskIndex] ?? null;
    const noteUuid = noteUuids[noteIndex] ?? null;
    if (taskIndex !== ABSENT_IDENTITY_INDEX && taskUuid === null) throw new Error("Stored evidence cites an unknown task identity");
    if (noteIndex !== ABSENT_IDENTITY_INDEX && noteUuid === null) throw new Error("Stored evidence cites an unknown note identity");
    return { noteUuid, taskUuid };
  });
  return hydrated;
}
