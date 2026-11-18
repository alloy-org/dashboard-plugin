// The All Notes scan reads tasks from the note handles filterNotes already returned. Notes tagged
// starter-notes are skipped from those handles' tags, without a second lookup for the tag. Callers asking for the same
// tasks close together share one host read, each receiving its own copies, until the read ages out or is forgotten.

import { jest } from "@jest/globals";

const { fetchDomainOrAllNotesTasks, forgetSharedTaskReads, SHARED_TASK_READ_MILLISECONDS } = await import("util/all-notes-tasks");

// ----------------------------------------------------------------------------------------------
// @desc One task living in the given note.
// @param {string} noteUUID - Note the task belongs to
// @returns {Object} A task
function taskOnNote(noteUUID) {
  return { uuid: `${ noteUUID }-task` };
}

// ----------------------------------------------------------------------------------------------
// @desc An app whose task-list notes are the given handles. getNoteTasks returns one task per note.
// @param {Array<Object>} notes - Note handles
// @returns {Object} The app stub
function notesApp(notes) {
  return {
    filterNotes: jest.fn(async () => notes),
    getNoteTasks: jest.fn(async handle => [taskOnNote(handle.uuid)]),
  };
}

describe("fetchDomainOrAllNotesTasks", () => {
  it("skips notes tagged starter-notes, including a child tag, and still reads a note with no tags", async () => {
    const notes = [
      { name: "Welcome", tags: ["starter-notes"], uuid: "starter" },
      { name: "Tour", tags: ["starter-notes/welcome"], uuid: "nested" },
      { name: "Real", tags: ["work"], uuid: "real" },
      { name: "Loose", uuid: "untagged" },
    ];
    const app = notesApp(notes);

    const tasks = await fetchDomainOrAllNotesTasks(app, null);

    expect(tasks.map(task => task.uuid)).toEqual(["real-task", "untagged-task"]);
    expect(app.filterNotes).toHaveBeenCalledTimes(1);
    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists" }, "changed");
    expect(app.getNoteTasks.mock.calls.map(call => call[0].uuid)).toEqual(["real", "untagged"]);
  });

  it("does not let starter notes consume the note cap", async () => {
    const notes = [
      { name: "Welcome", tags: ["starter-notes"], uuid: "starter" },
      { name: "First", tags: ["work"], uuid: "first" },
      { name: "Second", tags: ["work"], uuid: "second" },
    ];
    const app = notesApp(notes);

    const tasks = await fetchDomainOrAllNotesTasks(app, null, { maxNotes: 1 });

    expect(tasks.map(task => task.uuid)).toEqual(["first-task"]);
  });
});

describe("shared task reads", () => {
  afterEach(() => jest.useRealTimers());

  // ----------------------------------------------------------------------------------------------
  // @desc Concurrent and closely following callers share one domain read, and each gets copies it may change freely.
  it("shares one read among callers and gives each its own copies", async () => {
    const app = { getTaskDomainTasks: jest.fn(async () => [{ content: "Plan", uuid: "task-1" }]) };
    const [first, second] = await Promise.all([fetchDomainOrAllNotesTasks(app, "domain"), fetchDomainOrAllNotesTasks(app, "domain")]);
    first[0].content = "Changed";
    const third = await fetchDomainOrAllNotesTasks(app, "domain");
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(1);
    expect(second[0].content).toBe("Plan");
    expect(third[0].content).toBe("Plan");
    expect(first).not.toBe(second);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A read older than the sharing window, a fresh request, or a forgotten read sends the host another request.
  it("reads again once the read ages out, when asked for fresh tasks, or after it is forgotten", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 30, 9, 0) });
    const app = { getTaskDomainTasks: jest.fn(async () => [{ uuid: "task-1" }]) };
    await fetchDomainOrAllNotesTasks(app, "domain");
    jest.setSystemTime(Date.now() + SHARED_TASK_READ_MILLISECONDS);
    await fetchDomainOrAllNotesTasks(app, "domain");
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(2);
    await fetchDomainOrAllNotesTasks(app, "domain", { fresh: true });
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(3);
    forgetSharedTaskReads(app);
    await fetchDomainOrAllNotesTasks(app, "domain");
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(4);
    await fetchDomainOrAllNotesTasks(app, "other-domain");
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(5);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed read rejects every caller sharing it, and the next caller tries the host again.
  it("does not share a failed read", async () => {
    const app = { getTaskDomainTasks: jest.fn().mockRejectedValueOnce(new Error("Host busy")).mockResolvedValue([{ uuid: "task-1" }]) };
    await expect(fetchDomainOrAllNotesTasks(app, "domain")).rejects.toThrow("Host busy");
    const tasks = await fetchDomainOrAllNotesTasks(app, "domain");
    expect(tasks).toEqual([{ uuid: "task-1" }]);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(2);
  });
});
