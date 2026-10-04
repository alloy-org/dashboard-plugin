// Keep a compact index of the tasks a domain's Dashboard has observed: a digest of each task's text and note, its
// status, and the change sequence at which either last changed. Comparing each fresh task read against the index
// reveals tasks that were added, edited, reopened, completed, or dismissed since a consumer last caught up, including
// edits made on another device, which no local event reports. A read that may have missed tasks is a partial
// observation: it can add and change entries but never marks a missing task absent, so a failed fetch is not taken for
// deleted tasks. A domain with more open tasks than the index can hold tracks the most recently updated ones.
import { textDigest } from "util/text-digest";

// The index layout this code writes. An index with a later version is read by nothing older.
export const TASK_SNAPSHOT_SCHEMA_VERSION = 1;
// Most tasks one index holds, which keeps its note well inside a single note write at about 55 characters a task.
export const MAXIMUM_TRACKED_TASKS = 1500;
// A task's status, as the one character an index entry stores it with.
const STATUS_CODES = { absent: "a", completed: "c", dismissed: "d", open: "o" };
const STATUS_BY_CODE = Object.fromEntries(Object.entries(STATUS_CODES).map(([status, code]) => [code, status]));
// An entry as stored: an eight-character digest, a status character, then the change sequence in base 36.
const ENTRY_PATTERN = /^([0-9a-f]{8})([acdo])([0-9a-z]+)$/;

// ----------------------------------------------------------------------------------------------
// @desc The observed tasks of one domain, with a change sequence consumers record as a watermark to ask what changed.
export default class DashboardTaskSnapshot {
  compactedThroughSequence; // {number} Highest change sequence among entries dropped to stay within capacity; 0 if none.
  entriesByUuid; // {Map<string, object>} { digest, sequence, status } per tracked task UUID.
  sequence; // {number} Change sequence of the latest reconciliation that changed an entry; 0 before any.
  snapshotId; // {string} Identity of this index, so a watermark taken from a replaced index is never compared with it.
  updatedAt; // {number|null} Epoch milliseconds of the latest reconciliation.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct an index, empty unless given entries.
  // @param {object} [fields] - { compactedThroughSequence = 0, entriesByUuid = new Map(), sequence = 0, snapshotId,
  //   updatedAt = null }; a missing snapshotId is generated.
  constructor({ compactedThroughSequence = 0, entriesByUuid = new Map(), sequence = 0, snapshotId = _newSnapshotId(),
      updatedAt = null } = {}) {
    Object.assign(this, { compactedThroughSequence, entriesByUuid, sequence, snapshotId, updatedAt });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read an index back from the record toRecord produced.
  // @param {object} record - Parsed note payload.
  // @returns {DashboardTaskSnapshot|null} The index, or null when the record is not a readable index of this version.
  static fromRecord(record) {
    if (record?.schemaVersion !== TASK_SNAPSHOT_SCHEMA_VERSION || typeof record.snapshotId !== "string") return null;
    if (!record.tasks || typeof record.tasks !== "object" || !Number.isInteger(record.sequence)) return null;
    const entriesByUuid = new Map();
    for (const [taskUuid, storedEntry] of Object.entries(record.tasks)) {
      const match = typeof storedEntry === "string" ? storedEntry.match(ENTRY_PATTERN) : null;
      if (match) entriesByUuid.set(taskUuid, { digest: match[1], sequence: parseInt(match[3], 36), status: STATUS_BY_CODE[match[2]] });
    }
    const compactedThroughSequence = Number.isInteger(record.compactedThroughSequence) ? record.compactedThroughSequence : 0;
    return new DashboardTaskSnapshot({ compactedThroughSequence, entriesByUuid, sequence: record.sequence,
      snapshotId: record.snapshotId, updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : null });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The tasks whose entries changed after a watermark, oldest change first.
  // @param {object|null} watermark - { sequence, snapshotId }, as watermark() returned it earlier, or null.
  // @returns {object} An object with the following properties:
  //   - {Array<object>} changes - { sequence, status, taskUuid } per changed task
  //   - {boolean} complete - False when the watermark is missing, belongs to another index, is ahead of this one, or
  //     predates entries dropped for capacity, so changes may be missing and the caller should not rely on them alone
  //   - {object} watermark - This index's current watermark
  changesSince(watermark) {
    const comparable = watermark?.snapshotId === this.snapshotId && Number.isInteger(watermark.sequence)
      && watermark.sequence <= this.sequence;
    if (!comparable) return { changes: [], complete: false, watermark: this.watermark() };
    const changedEntries = [...this.entriesByUuid].filter(([, entry]) => entry.sequence > watermark.sequence);
    const changes = changedEntries.map(([taskUuid, entry]) => ({ sequence: entry.sequence, status: entry.status, taskUuid }));
    changes.sort((first, second) => first.sequence - second.sequence);
    const complete = watermark.sequence >= this.compactedThroughSequence;
    return { changes, complete, watermark: this.watermark() };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Compare a fresh read of the domain's tasks with the index and record what changed under one new change
  //   sequence. A complete read also marks tracked tasks it no longer holds absent, and limits the open tasks tracked
  //   to the most recently updated ones the index can hold; a partial read only adds and changes entries.
  // @param {Array<object>} tasks - Native tasks as read, each with uuid, content, noteUUID, and when present
  //   completedAt, dismissedAt, and updatedAt.
  // @param {object} [options] - { complete = false, observedAt = Date.now() }: complete is true only when the read
  //   holds every task of the domain the index tracks.
  // @returns {object} { changedTaskUuids, sequence }: the tasks whose entries changed, and the index's sequence after.
  reconcile(tasks, { complete = false, observedAt = Date.now() } = {}) {
    const observationsByUuid = _observationsByUuid(tasks);
    const trackedUuids = complete ? _trackedObservedUuids(observationsByUuid) : new Set(observationsByUuid.keys());
    const nextSequence = this.sequence + 1;
    const changedTaskUuids = [];
    for (const taskUuid of trackedUuids) {
      const { digest, status } = observationsByUuid.get(taskUuid);
      const entry = this.entriesByUuid.get(taskUuid);
      if (entry && entry.digest === digest && entry.status === status) continue;
      this.entriesByUuid.set(taskUuid, { digest, sequence: nextSequence, status });
      changedTaskUuids.push(taskUuid);
    }
    if (complete) changedTaskUuids.push(...this._recordUnobservedTasks(observationsByUuid, trackedUuids, nextSequence));
    if (changedTaskUuids.length) this.sequence = nextSequence;
    this.updatedAt = observedAt;
    this._compact();
    return { changedTaskUuids, sequence: this.sequence };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The plain record a note persists for this index. Each entry is one short string, so a large domain's index
  //   stays within a single note write.
  // @returns {object} { compactedThroughSequence, schemaVersion, sequence, snapshotId, tasks, updatedAt }.
  toRecord() {
    const taskEntries = [...this.entriesByUuid].map(([taskUuid, entry]) => [taskUuid,
      `${ entry.digest }${ STATUS_CODES[entry.status] }${ entry.sequence.toString(36) }`]);
    return { compactedThroughSequence: this.compactedThroughSequence, schemaVersion: TASK_SNAPSHOT_SCHEMA_VERSION,
      sequence: this.sequence, snapshotId: this.snapshotId, tasks: Object.fromEntries(taskEntries), updatedAt: this.updatedAt };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The position a consumer records once it has processed every change up to now.
  // @returns {object} { sequence, snapshotId }.
  watermark() {
    return { sequence: this.sequence, snapshotId: this.snapshotId };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Drop entries beyond capacity, closed and absent tasks first and the least recently changed first within
  //   each, remembering the highest sequence dropped so a consumer behind it knows its changes may be incomplete.
  _compact() {
    const overflow = this.entriesByUuid.size - MAXIMUM_TRACKED_TASKS;
    if (overflow <= 0) return;
    const entries = [...this.entriesByUuid];
    entries.sort(([, first], [, second]) => (first.status === "open") - (second.status === "open")
      || first.sequence - second.sequence);
    for (const [taskUuid, entry] of entries.slice(0, overflow)) this._dropEntry(taskUuid, entry);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Remove one entry and remember its sequence as compacted.
  // @param {string} taskUuid - Task to stop tracking.
  // @param {object} entry - Its entry.
  _dropEntry(taskUuid, entry) {
    this.entriesByUuid.delete(taskUuid);
    this.compactedThroughSequence = Math.max(this.compactedThroughSequence, entry.sequence);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc After a complete read, mark tracked tasks it no longer holds absent, and stop tracking open tasks it holds
  //   but did not keep among the most recently updated.
  // @param {Map<string, object>} observationsByUuid - The read's observations.
  // @param {Set<string>} trackedUuids - The observed tasks the index keeps.
  // @param {number} nextSequence - The sequence this reconciliation records changes under.
  // @returns {Array<string>} Tasks newly marked absent.
  _recordUnobservedTasks(observationsByUuid, trackedUuids, nextSequence) {
    const absentTaskUuids = [];
    for (const [taskUuid, entry] of [...this.entriesByUuid]) {
      if (trackedUuids.has(taskUuid)) continue;
      if (observationsByUuid.has(taskUuid)) this._dropEntry(taskUuid, entry);
      else if (entry.status !== "absent") {
        this.entriesByUuid.set(taskUuid, { ...entry, sequence: nextSequence, status: "absent" });
        absentTaskUuids.push(taskUuid);
      }
    }
    return absentTaskUuids;
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc A fresh identity for an index.
// @returns {string} Ten random base-36 characters.
function _newSnapshotId() {
  return Math.random().toString(36).slice(2, 12).padEnd(10, "0");
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a task read to what the index compares, keyed by task UUID. A task's digest covers its text and its
//   note, since moving a task to another note can change which project it belongs to.
// @param {Array<object>} tasks - Native tasks.
// @returns {Map<string, object>} { digest, status, updatedAt } per task UUID; tasks without a UUID are skipped.
function _observationsByUuid(tasks) {
  const observationsByUuid = new Map();
  for (const task of tasks || []) {
    if (!task?.uuid) continue;
    const digest = textDigest(`${ task.noteUUID || "" }\n${ task.content || "" }`);
    const status = task.dismissedAt ? "dismissed" : task.completedAt ? "completed" : "open";
    observationsByUuid.set(task.uuid, { digest, status, updatedAt: Number(task.updatedAt) || 0 });
  }
  return observationsByUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Choose which tasks of a complete read the index keeps: every closed task, and the most recently updated open
//   tasks up to capacity. Ordering by update time keeps the same open tasks tracked from one read to the next, so a
//   large domain's index does not churn, and an old task that is edited moves into it.
// @param {Map<string, object>} observationsByUuid - The read's observations.
// @returns {Set<string>} Task UUIDs to track.
function _trackedObservedUuids(observationsByUuid) {
  const observations = [...observationsByUuid];
  const openObservations = observations.filter(([, observation]) => observation.status === "open");
  if (openObservations.length <= MAXIMUM_TRACKED_TASKS) return new Set(observationsByUuid.keys());
  openObservations.sort(([, first], [, second]) => second.updatedAt - first.updatedAt);
  const keptOpenUuids = openObservations.slice(0, MAXIMUM_TRACKED_TASKS).map(([taskUuid]) => taskUuid);
  const closedUuids = observations.filter(([, observation]) => observation.status !== "open").map(([taskUuid]) => taskUuid);
  return new Set([...keptOpenUuids, ...closedUuids]);
}
