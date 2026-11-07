// Verify when Plan Builder offers untagged task notes to its Task Domain: only when recent task notes carry no tags
// besides daily-jots and starter-notes, offering untagged notes changed in three months with open or recently
// completed tasks, without asking, with date boundaries, failures, and fresh discovery evidence.

import { jest } from "@jest/globals";
import { preparePlanTaskDomain } from "plan-wizard/task-domain-fallback";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";

const REFERENCE_DATE = new Date("2026-11-05T12:00:00Z");
const REFERENCE_SECONDS = REFERENCE_DATE.getTime() / 1000;
const SCOPE = { domainName: "Work", domainUuid: "domain-work", referenceDate: REFERENCE_DATE };

// ----------------------------------------------------------------------------------------------
// @desc Provide open-task and untagged note filters separately from current domain membership, with mutations
//   observed in order.
// @param {object} options - { notes, tasksByNoteUuid, untaggedNotes } for the taskLists filter, getNoteTasks results,
//   and the untagged filter.
// @returns {object} App mock whose domain tasks grow only after a note is explicitly included.
function fallbackApp({ notes = [], tasksByNoteUuid = {}, untaggedNotes = [] } = {}) {
  const domainTasks = [];
  return {
    addNoteTag: jest.fn(async () => true),
    addTaskDomainNote: jest.fn(async (domainUuid, { uuid }) => {
      domainTasks.push({ content: "New project evidence", createdAt: REFERENCE_SECONDS, noteUUID: uuid, uuid: `task-${ uuid }` });
      return true;
    }),
    alert: jest.fn(async () => null),
    filterNotes: jest.fn(async ({ group } = {}) => group === "untagged" ? untaggedNotes : notes),
    getNoteTasks: jest.fn(async ({ uuid }) => tasksByNoteUuid[uuid] || []),
    getTaskDomainTasks: jest.fn(async () => domainTasks.slice()),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Make an untagged note changed recently, as the taskLists filter returns it unless overridden.
// @param {object} overrides - Metadata for a particular eligibility case.
// @returns {object} Note handle.
function taskNote(overrides = {}) {
  return { changed: "2026-11-01T12:00:00Z", name: "Project work", tags: [], uuid: "note-recent", ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc The note UUIDs tagged todo, in order.
// @param {object} app - App mock.
// @returns {Array<string>} Tagged note UUIDs.
function taggedNoteUuids(app) {
  const taggedUuids = app.addNoteTag.mock.calls.map(([handle]) => handle.uuid);
  return taggedUuids;
}

describe("Plan Builder task-domain fallback", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A notebook whose recent task notes use tags is organized already, so nothing is offered.
  it("tags nothing when a recent task note carries a tag", async () => {
    const app = fallbackApp({ notes: [taskNote(), taskNote({ tags: ["project/launch"], uuid: "note-tagged" })] });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addNoteTag).not.toHaveBeenCalled();
    expect(app.addTaskDomainNote).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A todo tag on a recent task note is still a tag, so the notebook is treated as organized.
  it("tags nothing when a recent task note already carries todo", async () => {
    const app = fallbackApp({ notes: [taskNote(), taskNote({ tags: ["todo"], uuid: "note-todo" })] });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addNoteTag).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Daily jots and starter notes carry tags the user did not choose, so they neither block nor receive todo.
  it("ignores daily-jots and starter-notes when judging tag use", async () => {
    const notes = [taskNote(), taskNote({ tags: ["daily-jots"], uuid: "note-jot" }),
      taskNote({ tags: ["starter-notes/welcome"], uuid: "note-starter" })];
    const app = fallbackApp({ notes });
    await preparePlanTaskDomain(app, SCOPE);
    expect(taggedNoteUuids(app)).toEqual(["note-recent"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A tagged note older than thirty days does not decide tag use, and is not offered todo either.
  it("judges tag use from the past thirty days and offers only untagged notes from three months", async () => {
    const notes = [taskNote(), taskNote({ changed: "2026-10-06T12:00:00Z", uuid: "note-month-boundary" }),
      taskNote({ changed: "2026-09-01T12:00:00Z", tags: ["project"], uuid: "note-old-tagged" }),
      taskNote({ changed: "2026-08-07T12:00:00Z", uuid: "note-quarter-boundary" }),
      taskNote({ changed: "2026-08-07T11:59:59Z", uuid: "note-too-old" }),
      taskNote({ changed: "2026-11-06T00:00:00Z", uuid: "note-future" }), taskNote({ changed: "not a date", uuid: "note-invalid" }),
      taskNote({ archived: true, uuid: "note-archived" }), taskNote()];
    const app = fallbackApp({ notes });
    await preparePlanTaskDomain(app, SCOPE);

    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists" }, "changed");
    expect(taggedNoteUuids(app)).toEqual(["note-recent", "note-month-boundary", "note-quarter-boundary"]);
    expect(app.addTaskDomainNote.mock.calls.map(([domainUuid]) => domainUuid)).toEqual(["domain-work", "domain-work", "domain-work"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A recent note with only daily-jots or starter notes leaves nothing to judge tag use by.
  it("tags nothing when no untagged task note changed in the past thirty days", async () => {
    const notes = [taskNote({ tags: ["daily-jots"], uuid: "note-jot" }), taskNote({ changed: "2026-09-15T12:00:00Z", uuid: "note-older" })];
    const app = fallbackApp({ notes });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addNoteTag).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An untagged note with no open tasks qualifies only through a task completed in the past three months.
  it("offers untagged notes whose tasks were completed recently", async () => {
    const untaggedNotes = [taskNote(), taskNote({ uuid: "note-completed" }), taskNote({ uuid: "note-stale-completion" }),
      taskNote({ uuid: "note-no-tasks" }), taskNote({ tags: ["project"], uuid: "note-tagged-completion" })];
    const tasksByNoteUuid = { "note-completed": [{ completedAt: REFERENCE_SECONDS - 86400, uuid: "done-recent" }],
      "note-stale-completion": [{ completedAt: REFERENCE_SECONDS - 100 * 86400, uuid: "done-old" }],
      "note-tagged-completion": [{ completedAt: REFERENCE_SECONDS - 86400, uuid: "done-tagged" }] };
    const app = fallbackApp({ notes: [taskNote()], tasksByNoteUuid, untaggedNotes });
    await preparePlanTaskDomain(app, SCOPE);
    expect(taggedNoteUuids(app)).toEqual(["note-recent", "note-completed"]);
    const readNoteUuids = app.getNoteTasks.mock.calls.map(([handle]) => handle.uuid);
    expect(readNoteUuids).toEqual(["note-completed", "note-stale-completion", "note-no-tasks"]);
    expect(app.getNoteTasks.mock.calls[0][1]).toEqual({ includeDone: true });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A host that rejects the untagged group still offers the notes with open tasks.
  it("offers open-task notes when the untagged filter fails", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    app.filterNotes.mockImplementation(async ({ group } = {}) => {
      if (group === "untagged") throw new Error("Unknown group");
      return [taskNote()];
    });
    await preparePlanTaskDomain(app, SCOPE);
    expect(taggedNoteUuids(app)).toEqual(["note-recent"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each note is tagged and included without asking the user, then the evidence collector's cache is replaced.
  it("includes task notes without prompting and refreshes the shared tasks", async () => {
    const app = fallbackApp({ notes: [taskNote(), taskNote({ uuid: "note-second" })] });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.alert).not.toHaveBeenCalled();
    expect(app.addTaskDomainNote.mock.calls).toEqual([["domain-work", { uuid: "note-recent" }], ["domain-work", { uuid: "note-second" }]]);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(1);
    const tasks = await fetchDomainOrAllNotesTasks(app, SCOPE.domainUuid, { includeDone: true });
    expect(tasks.map(task => task.noteUUID)).toEqual(["note-recent", "note-second"]);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A host that lists included notes a few reads late must not leave discovery sharing the read taken first.
  it("reads the domain again until the host lists the included notes' tasks", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    const listedTasks = [{ content: "New project evidence", noteUUID: "note-recent", uuid: "task-note-recent" }];
    app.getTaskDomainTasks.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue(listedTasks);
    const wait = jest.fn(async () => {});
    const includedNoteCount = await preparePlanTaskDomain(app, { ...SCOPE, wait });
    expect(includedNoteCount).toBe(1);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    const tasks = await fetchDomainOrAllNotesTasks(app, SCOPE.domainUuid, { includeDone: true });
    expect(tasks.map(task => task.noteUUID)).toEqual(["note-recent"]);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(3);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc When the host never lists the included notes, the last incomplete read is not shared with discovery.
  it("stops after five reads and leaves no incomplete read to share", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    app.getTaskDomainTasks.mockResolvedValue([]);
    const wait = jest.fn(async () => {});
    await preparePlanTaskDomain(app, { ...SCOPE, wait });
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(5);
    expect(wait).toHaveBeenCalledTimes(4);
    await fetchDomainOrAllNotesTasks(app, SCOPE.domainUuid, { includeDone: true });
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(6);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Closing the builder while waiting on the host ends the retries.
  it("stops reading the domain once the builder closes", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    app.getTaskDomainTasks.mockResolvedValue([]);
    let isActive = true;
    const wait = jest.fn(async () => { isActive = false; });
    await preparePlanTaskDomain(app, { ...SCOPE, isActive: () => isActive, wait });
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(1);
  });

  // @desc A note whose changed timestamp is unavailable can still qualify through its updated timestamp.
  it("accepts updated metadata and async iterable note filters", async () => {
    const app = fallbackApp();
    app.filterNotes.mockReturnValue({
      // ----------------------------------------------------------------------------------------------
      // @desc Yield a recent handle in the same shape as the host's lazy note filter.
      async *[Symbol.asyncIterator]() {
        yield taskNote({ changed: undefined, updated: "2026-11-01T12:00:00Z" });
      },
    });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addNoteTag).toHaveBeenCalledWith({ uuid: "note-recent" }, "todo");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc All Notes has no Task Domain membership to expand.
  it("skips All Notes", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    await preparePlanTaskDomain(app, { ...SCOPE, domainUuid: null });
    expect(app.filterNotes).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Domain changes and closure while note tasks are being read revoke that builder instance's writes.
  it("does not mutate notes when the builder closes while notes are being read", async () => {
    const app = fallbackApp({ notes: [taskNote()], untaggedNotes: [taskNote({ uuid: "note-completed" })] });
    let isActive = true;
    app.getNoteTasks.mockImplementation(async () => { isActive = false; return []; });
    await preparePlanTaskDomain(app, { ...SCOPE, isActive: () => isActive });
    expect(app.addNoteTag).not.toHaveBeenCalled();
    expect(app.addTaskDomainNote).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Tag failures must not stop later notes or leave discovery using its pre-write task snapshot.
  it("skips failed notes silently and refreshes tasks from notes that were included", async () => {
    const app = fallbackApp({ notes: [taskNote(), taskNote({ uuid: "note-second" }), taskNote({ uuid: "note-third" })] });
    app.addNoteTag.mockResolvedValueOnce(false);
    app.addTaskDomainNote.mockRejectedValueOnce(new Error("Shared note cannot be included"));
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addNoteTag).toHaveBeenCalledTimes(3);
    expect(app.addTaskDomainNote).toHaveBeenCalledTimes(2);
    expect(app.alert).not.toHaveBeenCalled();
    const tasks = await fetchDomainOrAllNotesTasks(app, SCOPE.domainUuid, { includeDone: true });
    expect(tasks.map(task => task.noteUUID)).toEqual(["note-third"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The embed bridge may resolve a failed call as an envelope instead of rejecting its promise.
  it("does not treat bridge write failures as successful tagging", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    app.addNoteTag.mockResolvedValue({ embedCallFailed: true, error: "Cannot modify note" });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addTaskDomainNote).not.toHaveBeenCalled();
    expect(app.alert).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed note listing must not be read as a notebook without tags.
  it("tags nothing when listing task notes fails", async () => {
    const app = fallbackApp();
    app.filterNotes.mockRejectedValue(new Error("Offline"));
    await expect(preparePlanTaskDomain(app, SCOPE)).rejects.toThrow("Offline");
    expect(app.addNoteTag).not.toHaveBeenCalled();
  });
});
