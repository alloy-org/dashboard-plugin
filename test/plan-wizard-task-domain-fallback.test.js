// Verify consent, date boundaries, domain membership, and fresh discovery evidence for sparse planning domains.

import { jest } from "@jest/globals";
import { preparePlanTaskDomain } from "plan-wizard/task-domain-fallback";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";

const REFERENCE_DATE = new Date("2026-11-05T12:00:00Z");
const SCOPE = { domainName: "Work", domainUuid: "domain-work", referenceDate: REFERENCE_DATE };

// ----------------------------------------------------------------------------------------------
// @desc Provide task-note filtering separately from current domain membership, with mutations observed in order.
// @param {object} options - { notes, tasks } for candidate notes and initial domain tasks.
// @returns {object} App mock whose domain tasks grow only after a note is explicitly included.
function fallbackApp({ notes = [], tasks = [] } = {}) {
  const domainTasks = tasks.slice();
  return {
    addNoteTag: jest.fn(async () => true),
    addTaskDomainNote: jest.fn(async (domainUuid, { uuid }) => {
      domainTasks.push({ content: "New project evidence", createdAt: REFERENCE_DATE.getTime() / 1000,
        noteUUID: uuid, uuid: `task-${ uuid }` });
      return true;
    }),
    alert: jest.fn(async () => "include-task-notes"),
    filterNotes: jest.fn(async () => notes),
    getTaskDomainTasks: jest.fn(async () => domainTasks.slice()),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Make a note with open tasks, changed recently and lacking todo unless overridden.
// @param {object} overrides - Metadata for a particular eligibility case.
// @returns {object} Note handle returned by the taskLists filter.
function taskNote(overrides = {}) {
  return { changed: "2026-11-01T12:00:00Z", name: "Project work", tags: [], uuid: "note-recent", ...overrides };
}

describe("Plan Builder task-domain fallback", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A domain at the threshold must never trigger account-wide discovery or consent.
  it("does not scan or prompt when the domain has twenty open tasks", async () => {
    const tasks = Array.from({ length: 20 }, (unused, index) => ({ uuid: `task-${ index }` }));
    const app = fallbackApp({ notes: [taskNote()], tasks });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.filterNotes).not.toHaveBeenCalled();
    expect(app.alert).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Completed and dismissed tasks do not hide a sparse domain at nineteen open tasks.
  it("offers the fallback at nineteen open tasks even when done tasks are returned", async () => {
    const tasks = Array.from({ length: 19 }, (unused, index) => ({ uuid: `task-${ index }` }));
    tasks.push({ completedAt: 123, uuid: "task-done" }, { dismissedAt: 123, uuid: "task-dismissed" });
    const app = fallbackApp({ notes: [taskNote()], tasks });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.alert.mock.calls[0][0]).toContain("19 tasks");
    expect(app.addNoteTag).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Approval must tag only eligible notes, ensure membership, and replace the evidence collector's cache.
  it("includes recent task notes with consent and refreshes the shared tasks", async () => {
    const notes = [taskNote(), taskNote({ changed: "2026-10-06T12:00:00Z", uuid: "note-boundary" }),
      taskNote({ changed: "2026-10-06T11:59:59Z", uuid: "note-old" }),
      taskNote({ changed: "2026-11-06T00:00:00Z", uuid: "note-future" }),
      taskNote({ changed: "not a date", uuid: "note-invalid" }),
      taskNote({ tags: ["todo"], uuid: "note-tagged" }), taskNote({ tags: ["todo/work"], uuid: "note-child-tag" }),
      taskNote({ archived: true, uuid: "note-archived" }), taskNote()];
    const app = fallbackApp({ notes });
    await preparePlanTaskDomain(app, SCOPE);

    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists", tag: "^todo" }, "changed");
    expect(app.alert.mock.calls[0][0]).toContain("2 notes");
    expect(app.alert.mock.calls[0][0]).toContain("Work Task Domain");
    expect(app.addNoteTag.mock.calls).toEqual([[{ uuid: "note-recent" }, "todo"], [{ uuid: "note-boundary" }, "todo"]]);
    expect(app.addTaskDomainNote.mock.calls).toEqual([["domain-work", { uuid: "note-recent" }],
      ["domain-work", { uuid: "note-boundary" }]]);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(2);
    const tasks = await fetchDomainOrAllNotesTasks(app, SCOPE.domainUuid, { includeDone: true });
    expect(tasks.map(task => task.noteUUID)).toEqual(["note-recent", "note-boundary"]);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The explicit Include notes action is the only response that authorizes tagging.
  it.each([null, -1, "unexpected"])("leaves notes untouched when consent returns %s", async action => {
    const app = fallbackApp({ notes: [taskNote()] });
    app.alert.mockResolvedValue(action);
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addNoteTag).not.toHaveBeenCalled();
    expect(app.addTaskDomainNote).not.toHaveBeenCalled();
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Empty, stale, and undated task-note sets should not interrupt the builder.
  it("does not prompt without eligible recent task notes", async () => {
    const app = fallbackApp({ notes: [taskNote({ changed: undefined }),
      taskNote({ changed: "2025-01-01T00:00:00Z", uuid: "note-old" })] });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.alert).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
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
    expect(app.getTaskDomainTasks).not.toHaveBeenCalled();
    expect(app.filterNotes).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Domain changes and closure while a prompt is pending revoke that builder instance's writes.
  it("does not mutate notes when the builder closes during confirmation", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    let isActive = true;
    app.alert.mockImplementation(async () => { isActive = false; return "include-task-notes"; });
    await preparePlanTaskDomain(app, { ...SCOPE, isActive: () => isActive });
    expect(app.addNoteTag).not.toHaveBeenCalled();
    expect(app.addTaskDomainNote).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Tag failures must not stop later approved notes or leave discovery using its pre-write task snapshot.
  it("reports partial failures and refreshes tasks from notes that were included", async () => {
    const app = fallbackApp({ notes: [taskNote(), taskNote({ uuid: "note-second" }), taskNote({ uuid: "note-third" })] });
    app.addNoteTag.mockResolvedValueOnce(false);
    app.addTaskDomainNote.mockRejectedValueOnce(new Error("Shared note cannot be included"));
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addNoteTag).toHaveBeenCalledTimes(3);
    expect(app.addTaskDomainNote).toHaveBeenCalledTimes(2);
    expect(app.getTaskDomainTasks).toHaveBeenCalledTimes(2);
    expect(app.alert.mock.calls[1][0]).toContain("2 of 3 notes could not be included");
    const tasks = await fetchDomainOrAllNotesTasks(app, SCOPE.domainUuid, { includeDone: true });
    expect(tasks.map(task => task.noteUUID)).toEqual(["note-third"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The embed bridge may resolve a failed call as an envelope instead of rejecting its promise.
  it("reports bridge write failures without treating them as successful tagging", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    app.addNoteTag.mockResolvedValue({ embedCallFailed: true, error: "Cannot modify note" });
    await preparePlanTaskDomain(app, SCOPE);
    expect(app.addTaskDomainNote).not.toHaveBeenCalled();
    expect(app.alert.mock.calls[1][0]).toContain("1 of 1 notes could not be included");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed initial domain read must not be interpreted as an empty Task Domain.
  it("does not prompt when task retrieval fails", async () => {
    const app = fallbackApp({ notes: [taskNote()] });
    app.getTaskDomainTasks.mockRejectedValue(new Error("Offline"));
    await expect(preparePlanTaskDomain(app, SCOPE)).rejects.toThrow("Offline");
    expect(app.alert).not.toHaveBeenCalled();
  });
});
