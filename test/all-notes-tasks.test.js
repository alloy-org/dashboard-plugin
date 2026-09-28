// The All Notes scan reads tasks from the note handles filterNotes already returned. Notes tagged
// starter-notes are skipped from those handles' tags, without a second lookup for the tag.

import { jest } from "@jest/globals";

const { fetchDomainOrAllNotesTasks } = await import("util/all-notes-tasks");

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
