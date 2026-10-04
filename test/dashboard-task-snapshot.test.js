// Exercise DashboardTaskSnapshot and its store: change detection across reads, partial versus complete observations,
// watermarks, capacity, and the archived note each domain's index lives in.
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import DashboardTaskSnapshot, { MAXIMUM_TRACKED_TASKS } from "dashboard/work-queue/dashboard-task-snapshot";
import DashboardTaskSnapshotStore, { taskSnapshotNoteName } from "dashboard/work-queue/dashboard-task-snapshot-store";
import { workQueueNotesApp } from "./work-queue-test-notes";

// ----------------------------------------------------------------------------------------------
// @desc An open task as a task read returns it.
// @param {string} uuid - Task UUID.
// @param {object} [overrides] - Fields to replace.
// @returns {object} Task.
function openTask(uuid, overrides = {}) {
  return { content: `Task ${ uuid }`, noteUUID: "task-note", updatedAt: 1, uuid, ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc The task UUIDs among a changesSince result's changes.
// @param {object} result - From changesSince.
// @returns {Array<string>} Changed task UUIDs, oldest change first.
function changedUuids(result) {
  return result.changes.map(change => change.taskUuid);
}

describe("DashboardTaskSnapshot", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Edits, moves between notes, completion, and reopening each change a task's entry, under one new sequence
  //   per read; a read that changes nothing leaves the sequence where it was.
  it("records added, edited, completed, and reopened tasks under one sequence per read", () => {
    const snapshot = new DashboardTaskSnapshot();
    snapshot.reconcile([openTask("first"), openTask("second")], { complete: true });
    const baseline = snapshot.watermark();
    expect(snapshot.reconcile([openTask("first"), openTask("second")], { complete: true }).changedTaskUuids).toEqual([]);
    expect(snapshot.sequence).toBe(baseline.sequence);
    const edited = snapshot.reconcile([openTask("first", { content: "Reworded" }), openTask("second", { noteUUID: "moved" }),
      openTask("third")], { complete: true });
    expect(edited.changedTaskUuids.sort()).toEqual(["first", "second", "third"]);
    expect(edited.sequence).toBe(baseline.sequence + 1);
    const afterEdit = snapshot.watermark();
    snapshot.reconcile([openTask("first", { completedAt: 5, content: "Reworded" }), openTask("second", { noteUUID: "moved" }),
      openTask("third")], { complete: true });
    expect(snapshot.changesSince(afterEdit).changes).toEqual([{ sequence: afterEdit.sequence + 1, status: "completed",
      taskUuid: "first" }]);
    expect(changedUuids(snapshot.changesSince(baseline))).toEqual(["second", "third", "first"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Only a complete read marks a missing task absent; a partial read that misses a task changes nothing.
  it("marks tasks absent only after a complete read", () => {
    const snapshot = new DashboardTaskSnapshot();
    snapshot.reconcile([openTask("kept"), openTask("gone")], { complete: true });
    const baseline = snapshot.watermark();
    expect(snapshot.reconcile([openTask("kept")], { complete: false }).changedTaskUuids).toEqual([]);
    expect(snapshot.changesSince(baseline).changes).toEqual([]);
    snapshot.reconcile([openTask("kept")], { complete: true });
    expect(snapshot.changesSince(baseline).changes).toEqual([{ sequence: baseline.sequence + 1, status: "absent",
      taskUuid: "gone" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A missing watermark, one from a different index, or one ahead of this index cannot be compared.
  it("reports watermarks it cannot compare as incomplete", () => {
    const snapshot = new DashboardTaskSnapshot();
    snapshot.reconcile([openTask("first")], { complete: true });
    expect(snapshot.changesSince(null)).toMatchObject({ changes: [], complete: false, watermark: snapshot.watermark() });
    expect(snapshot.changesSince({ sequence: 0, snapshotId: "another-index" }).complete).toBe(false);
    expect(snapshot.changesSince({ sequence: 99, snapshotId: snapshot.snapshotId }).complete).toBe(false);
    expect(snapshot.changesSince({ sequence: 0, snapshotId: snapshot.snapshotId })).toMatchObject({ complete: true });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Past capacity a complete read tracks the most recently updated open tasks, so an edited old task moves in.
  //   A watermark taken before the last change of a task that left the index is reported as possibly incomplete.
  it("tracks the most recently updated open tasks past capacity", () => {
    const tasks = Array.from({ length: MAXIMUM_TRACKED_TASKS + 2 }, (unused, index) => openTask(`task-${ index }`,
      { updatedAt: index }));
    const snapshot = new DashboardTaskSnapshot();
    snapshot.reconcile(tasks, { complete: true });
    expect(snapshot.entriesByUuid.size).toBe(MAXIMUM_TRACKED_TASKS);
    expect(snapshot.entriesByUuid.has("task-0")).toBe(false);
    const baseline = snapshot.watermark();
    const editedTasks = [...tasks.slice(1), openTask("task-0", { content: "Edited", updatedAt: 10000 })];
    snapshot.reconcile(editedTasks, { complete: true });
    expect(snapshot.entriesByUuid.has("task-0")).toBe(true);
    expect(snapshot.entriesByUuid.has("task-2")).toBe(false);
    const result = snapshot.changesSince(baseline);
    expect(changedUuids(result)).toEqual(["task-0"]);
    expect(result.complete).toBe(true);
    expect(snapshot.changesSince({ sequence: 0, snapshotId: snapshot.snapshotId }).complete).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An index survives its note record, and a record of another shape is refused.
  it("round-trips through its record", () => {
    const snapshot = new DashboardTaskSnapshot();
    snapshot.reconcile([openTask("first"), openTask("second", { dismissedAt: 3 })], { complete: true, observedAt: 42 });
    const restored = DashboardTaskSnapshot.fromRecord(JSON.parse(JSON.stringify(snapshot.toRecord())));
    expect(restored.entriesByUuid).toEqual(snapshot.entriesByUuid);
    expect(restored).toMatchObject({ sequence: snapshot.sequence, snapshotId: snapshot.snapshotId, updatedAt: 42 });
    expect(DashboardTaskSnapshot.fromRecord({ summary: "A project payload" })).toBeNull();
  });
});

describe("DashboardTaskSnapshotStore", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A store over the in-memory notes app, with its own note writer.
  // @param {object} app - From workQueueNotesApp.
  // @returns {DashboardTaskSnapshotStore} Store.
  function snapshotStore(app) {
    return new DashboardTaskSnapshotStore({ app, clock: () => 1000, noteWriter: new DashboardNoteWriter({ app }) });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The first read creates the domain's archived note; a later read sees the saved index and its changes, and
  //   a read that changes nothing does not rewrite the note.
  it("saves each domain's index in an archived note and rewrites it only on change", async () => {
    const app = workQueueNotesApp();
    const store = snapshotStore(app);
    const first = await store.reconcile("work-domain", [openTask("first")], { complete: true });
    expect(first.changedTaskUuids).toEqual(["first"]);
    const [note] = [...app.notes.values()];
    expect(note).toMatchObject({ archived: true, name: taskSnapshotNoteName("work-domain") });
    const savedContent = app.noteContent(taskSnapshotNoteName("work-domain"));
    const unchanged = await store.reconcile("work-domain", [openTask("first")], { complete: true });
    expect(unchanged.changedTaskUuids).toEqual([]);
    expect(app.noteContent(taskSnapshotNoteName("work-domain"))).toBe(savedContent);
    const edited = await store.reconcile("work-domain", [openTask("first", { content: "Edited" })], { complete: true });
    expect(edited.changedTaskUuids).toEqual(["first"]);
    expect((await store.read("work-domain")).changesSince(first.snapshot.watermark()).changes).toHaveLength(1);
    expect(await store.read(null)).toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A note this version cannot read is reported and left as it was, and a failed write rejects rather than
  //   handing back an index the note does not hold.
  it("never overwrites an unreadable note and rejects a failed save", async () => {
    const app = workQueueNotesApp();
    const store = snapshotStore(app);
    const uuid = await app.createNote(taskSnapshotNoteName("work-domain"));
    const newerContent = "```json\n{\"schemaVersion\": 9, \"snapshotId\": \"later\"}\n```";
    app.notes.get(uuid).content = newerContent;
    await expect(store.reconcile("work-domain", [openTask("first")], { complete: true })).rejects.toThrow("newer version");
    expect(app.notes.get(uuid).content).toBe(newerContent);
    app.failNextWrites(1);
    await expect(store.reconcile("other-domain", [openTask("first")], { complete: true })).rejects.toThrow("write failure");
  });
});
