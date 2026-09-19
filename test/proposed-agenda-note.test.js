// Verify date-note persistence preserves existing work and retries without duplicate suggestions.
import { jest } from "@jest/globals";
import { populateAgendaNote, prepareAgendaNote, scheduleProjectStep } from "proposed-agenda-note";

// ----------------------------------------------------------------------------------------------
// @desc Provide a stateful note API that records inserted tasks and simulates actual subsequent reads.
// @returns {object} App bridge stub with its backing tasks.
function noteApp() {
  const tasks = [{ completedAt: 100, content: "Existing task", uuid: "existing-task" }];
  return { addTaskDomainNote: jest.fn().mockResolvedValue(true), createNote: jest.fn().mockResolvedValue("dated-note"),
    findNote: jest.fn().mockResolvedValue(null), getNoteTasks: jest.fn(async () => tasks),
    insertTask: jest.fn(async (_note, task) => { tasks.push({ ...task, uuid: `task-${ tasks.length }` }); return tasks.at(-1).uuid; }), tasks };
}

describe("dated agenda notes", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Explicit weekend dates stay exact, and a new dated note joins the domain for future completion tracking.
  it("creates a Saturday note and checks its existing tasks", async () => {
    const app = noteApp();
    const result = await prepareAgendaNote(app, { domainName: "Work", domainUuid: "work-domain", targetDate: new Date(2026, 8, 19) });
    expect(app.createNote.mock.calls[0][0]).toBe("Proposed Agenda 2026-09-19 Work");
    expect(app.addTaskDomainNote).toHaveBeenCalledWith("work-domain", { uuid: "dated-note" });
    expect(result.tasks).toEqual(app.tasks);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Completed tasks and inserted references survive repeated generation without duplication or scheduling.
  it("preserves completed tasks and deduplicates source links across retries", async () => {
    const app = noteApp();
    const note = { uuid: "dated-note" };
    const suggestions = [{ projectUuid: "project-uuid", reason: "One of two blocks completed", startTime: "09:00",
      taskUuid: "source-task", title: "Build the date picker" }];
    await populateAgendaNote(app, note, suggestions);
    await populateAgendaNote(app, note, [{ ...suggestions[0], title: "A different label for the same task" }]);
    expect(app.tasks).toHaveLength(2);
    expect(app.tasks[0].completedAt).toBe(100);
    expect(app.insertTask).toHaveBeenCalledTimes(1);
    expect(app.tasks[1].content).toContain("https://www.amplenote.com/notes/tasks/source-task");
    expect(app.tasks[1].startAt).toBeUndefined();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc An unreadable note cannot be mistaken for an empty note and populated with duplicates.
  it("stops before writing when the existing-task read fails", async () => {
    const app = noteApp();
    app.getNoteTasks.mockResolvedValue({ embedCallFailed: true, error: "read failed" });
    await expect(populateAgendaNote(app, { uuid: "dated-note" }, [{ title: "New task" }])).rejects.toThrow("read failed");
    expect(app.insertTask).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Approving a fallback step schedules the checkbox already written in the dated note.
  it("reuses the existing generated project task on approval", async () => {
    const app = noteApp();
    app.getTaskDomains = jest.fn().mockResolvedValue([]);
    app.updateTask = jest.fn().mockResolvedValue(true);
    app.findNote.mockResolvedValue({ uuid: "dated-note" });
    app.tasks.push({ content: "Ship date picker (project:project-uuid)", uuid: "project-step" });
    const result = await scheduleProjectStep({ projectUuid: "project-uuid", title: "Ship date picker" }, app, 1789822800);
    expect(result.taskUuid).toBe("project-step");
    expect(app.updateTask).toHaveBeenCalledWith("project-step", { startAt: 1789822800 });
    expect(app.insertTask).not.toHaveBeenCalled();
  });
});
