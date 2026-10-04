// Keep each task domain's DashboardTaskSnapshot in an archived "Dashboard Task Snapshot" note, apart from the small
// job records of the work queue, so the change history a project's ranking catches up from survives between visits
// and is shared by every quarter of the domain. Each reconciliation is a fresh read, a comparison, and a write through
// the shared note writer, so two reconciliations in one session never overwrite each other. A note this version cannot
// read, including one a later version wrote, is never overwritten. A reconciliation whose write fails reports the
// failure rather than an index nothing saved, so no consumer records a watermark the note does not hold.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import DashboardTaskSnapshot, { TASK_SNAPSHOT_SCHEMA_VERSION } from "dashboard/work-queue/dashboard-task-snapshot";

// Names the index of the "All Notes" fallback, which reads tasks without a task domain.
export const ALL_NOTES_DOMAIN_KEY = "all-notes";
// Shown above the JSON in the snapshot note.
const SNAPSHOT_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It records a short digest "
  + "of each task the Dashboard has seen in this task domain, so it can tell which tasks were added or edited since "
  + "each project was last refreshed.";

// ----------------------------------------------------------------------------------------------
// @desc Name a domain's snapshot note.
// @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
// @returns {string} Note name.
export function taskSnapshotNoteName(domainUuid) {
  return `Dashboard Task Snapshot ${ domainUuid || ALL_NOTES_DOMAIN_KEY }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Reads and reconciles the task snapshot of each domain.
export default class DashboardTaskSnapshotStore {
  app; // {object} Host-compatible Amplenote API.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  noteWriter; // {DashboardNoteWriter} Serializes each snapshot note's read-then-write changes.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a store, sharing the app's note writer unless given another.
  // @param {object} options - { app, clock = Date.now, noteWriter }.
  constructor({ app, clock = Date.now, noteWriter = DashboardNoteWriter.forApp(app) }) {
    Object.assign(this, { app, clock, noteWriter });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a domain's index without changing it, bringing the notes list up to date first.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @returns {Promise<DashboardTaskSnapshot|null>} The index, or null when the domain has none yet.
  // @throws When the note cannot be read, or holds an index this version cannot read.
  async read(domainUuid) {
    await this.noteWriter.refreshNotesList();
    const { snapshot } = await this._readNote(domainUuid);
    return snapshot;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Compare a fresh task read with the domain's saved index and save what changed, creating the index on the
  //   domain's first read. A reconciliation that changed no entry leaves the note alone, so a quiet domain does not
  //   rewrite it on every visit.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @param {Array<object>} tasks - Native tasks as read.
  // @param {object} [options] - { complete = false }: true only when the read holds every task the domain tracks.
  // @returns {Promise<object>} { changedTaskUuids, snapshot }: the tasks whose entries changed, and the saved index.
  // @throws When the note cannot be read, holds an index this version cannot read, or cannot be written.
  reconcile(domainUuid, tasks, { complete = false } = {}) {
    const name = taskSnapshotNoteName(domainUuid);
    return this.noteWriter.update(name, async () => {
      const { noteHandle, snapshot: savedSnapshot } = await this._readNote(domainUuid);
      const snapshot = savedSnapshot || new DashboardTaskSnapshot();
      const previousCompaction = snapshot.compactedThroughSequence;
      const { changedTaskUuids } = snapshot.reconcile(tasks, { complete, observedAt: this.clock() });
      const compacted = snapshot.compactedThroughSequence !== previousCompaction;
      if (changedTaskUuids.length || compacted || !savedSnapshot) {
        await writeJsonNote(this.app, { description: SNAPSHOT_NOTE_DESCRIPTION, name, noteHandle,
          payload: snapshot.toRecord(), title: "Dashboard task snapshot" });
      }
      return { changedTaskUuids, snapshot };
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a domain's note and its index.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @returns {Promise<object>} { noteHandle, snapshot }, both null when the note does not exist, and snapshot null for
  //   a note created but never written.
  // @throws When the note holds a payload that is not an index this version reads.
  async _readNote(domainUuid) {
    const name = taskSnapshotNoteName(domainUuid);
    const { noteHandle, payload } = await readJsonNote(this.app, name);
    if (!payload) return { noteHandle, snapshot: null };
    if (Number(payload.schemaVersion) > TASK_SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`"${ name }" was written by a newer version of the plugin`);
    }
    const snapshot = DashboardTaskSnapshot.fromRecord(payload);
    if (!snapshot) throw new Error(`"${ name }" holds no readable task snapshot`);
    return { noteHandle, snapshot };
  }
}
