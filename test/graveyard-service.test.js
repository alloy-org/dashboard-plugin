/**
 * [OpenAI gpt-5.4-authored file]
 * Prompt summary: "ensure graveyard-service persists task-to-note mappings in its cache rows"
 */
import { jest } from "@jest/globals";
import { loadGraveyardCandidates } from "../lib/graveyard-service.js";

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${ year }-${ month }-${ day }`;
}

// [OpenAI gpt-5.4] Task: build a stateful graveyard-service app stub for cache roundtrip tests
// Prompt: "keep a table of which task maps to which note when we are extracting the tasks"
function buildMockApp() {
  let noteContent = "# Graveyard task candidates\n\n| Date | Task UUIDs | Task note metadata |\n|------|------------|--------------------|\n";
  const taskFromNotes = {
    content: "Review graveyard cache metadata",
    createdAt: Math.floor(new Date("2024-01-15T12:00:00Z").getTime() / 1000),
    noteName: "Source Note",
    noteUUID: "note-123",
    uuid: "task-123",
    victoryValue: 6,
  };
  const domainTaskWithoutNoteName = {
    content: taskFromNotes.content,
    createdAt: taskFromNotes.createdAt,
    noteUUID: taskFromNotes.noteUUID,
    uuid: taskFromNotes.uuid,
    victoryValue: taskFromNotes.victoryValue,
  };

  return {
    app: {
      createNote: jest.fn().mockResolvedValue("graveyard-note-uuid"),
      filterNotes: jest.fn().mockImplementation(async function* () {
        yield { name: "Source Note", uuid: taskFromNotes.noteUUID };
      }),
      findNote: jest.fn().mockResolvedValue({ name: "Task graveyard data: May 2026", uuid: "graveyard-note-uuid" }),
      getNoteContent: jest.fn().mockImplementation(async () => noteContent),
      getNoteTasks: jest.fn().mockResolvedValue([taskFromNotes]),
      getTask: jest.fn().mockImplementation(async uuid => uuid === taskFromNotes.uuid ? domainTaskWithoutNoteName : null),
      getTaskDomainTasks: jest.fn().mockResolvedValue([domainTaskWithoutNoteName]),
      replaceNoteContent: jest.fn().mockImplementation(async (_noteHandle, content) => {
        noteContent = content;
      }),
    },
    getNoteContentValue: () => noteContent,
    taskFromNotes,
  };
}

// [OpenAI gpt-5.4] Generated tests for: graveyard cache task-to-note mapping persistence
// [OpenAI gpt-5.5] Generated tests for: graveyard nine-month value/proximity heuristic
describe("loadGraveyardCandidates", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("roundtrips note metadata through the graveyard cache without note lookups by uuid", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-10T15:00:00Z"));
    const { app, getNoteContentValue, taskFromNotes } = buildMockApp();

    const firstLoad = await loadGraveyardCandidates(app, 5, "domain-1");
    expect(firstLoad.candidates).toHaveLength(1);
    expect(firstLoad.candidates[0].noteName).toBe("Source Note");
    expect(getNoteContentValue()).toContain(encodeURIComponent(JSON.stringify([{
      noteName: "Source Note",
      noteUUID: "note-123",
      uuid: "task-123",
    }])));

    app.getNoteTasks.mockClear();
    app.filterNotes.mockClear();
    app.findNote.mockClear();

    const secondLoad = await loadGraveyardCandidates(app, 5, "domain-1");

    expect(secondLoad.candidates).toHaveLength(1);
    expect(secondLoad.candidates[0]).toMatchObject({
      noteName: "Source Note",
      noteUUID: taskFromNotes.noteUUID,
      uuid: taskFromNotes.uuid,
    });
    expect(app.getNoteTasks).not.toHaveBeenCalled();
    expect(app.filterNotes).not.toHaveBeenCalled();
    expect(app.findNote).toHaveBeenCalledTimes(1);
    expect(app.findNote).not.toHaveBeenCalledWith({ uuid: taskFromNotes.noteUUID });
  });

  it("forceRefresh bypasses today's cache row and persists a fresh replacement candidate set", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-10T15:00:00Z"));
    const todayKey = localDateKey(new Date("2026-05-10T15:00:00Z"));
    let noteContent = [
      "# Graveyard task candidates",
      "",
      "| Date | Task UUIDs | Task note metadata |",
      "|------|------------|--------------------|",
      `| ${ todayKey } | cached-task | ${ encodeURIComponent(JSON.stringify([{ noteName: "Cached Note", noteUUID: "cached-note", uuid: "cached-task" }])) } |`,
      "",
    ].join("\n");
    const freshTask = {
      content: "Fresh candidate after refresh",
      createdAt: Math.floor(new Date("2024-01-10T12:00:00Z").getTime() / 1000),
      noteName: "Fresh Note",
      noteUUID: "fresh-note",
      uuid: "fresh-task",
      victoryValue: 8,
    };
    const app = {
      createNote: jest.fn().mockResolvedValue("graveyard-note-uuid"),
      filterNotes: jest.fn().mockImplementation(async function* () {
        yield { name: freshTask.noteName, uuid: freshTask.noteUUID };
      }),
      findNote: jest.fn().mockResolvedValue({ name: "Task graveyard data: May 2026", uuid: "graveyard-note-uuid" }),
      getNoteContent: jest.fn().mockImplementation(async () => noteContent),
      getNoteTasks: jest.fn().mockResolvedValue([freshTask]),
      getTaskDomainTasks: jest.fn().mockResolvedValue([{ uuid: "cached-task" }]),
      replaceNoteContent: jest.fn().mockImplementation(async (_noteHandle, content) => {
        noteContent = content;
      }),
    };

    const refreshedLoad = await loadGraveyardCandidates(app, 5, "domain-1", { forceRefresh: true });

    expect(refreshedLoad.candidates).toHaveLength(1);
    expect(refreshedLoad.candidates[0]).toMatchObject({
      noteName: freshTask.noteName,
      noteUUID: freshTask.noteUUID,
      uuid: freshTask.uuid,
    });
    expect(app.getTaskDomainTasks).not.toHaveBeenCalled();
    expect(app.filterNotes).toHaveBeenCalledTimes(1);
    expect(noteContent).toContain("fresh-task");
    expect(noteContent).not.toContain("cached-task");
  });

  it("scores every discovered task before selecting the top graveyard candidates", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-10T15:00:00Z"));
    let noteContent = "# Graveyard task candidates\n\n| Date | Task UUIDs | Task note metadata |\n|------|------------|--------------------|\n";
    const timestampFromDate = date => Math.floor(new Date(date).getTime() / 1000);
    const tasks = [
      { content: "Created close to nine months ago", createdAt: timestampFromDate("2025-08-10T15:00:00Z"), uuid: "near-target", victoryValue: 10 },
      { content: "Slightly newer but still valuable", createdAt: timestampFromDate("2025-08-17T15:00:00Z"), uuid: "near-newer", victoryValue: 9.5 },
      { content: "High value but years too old", createdAt: timestampFromDate("2023-08-10T15:00:00Z"), uuid: "far-old", victoryValue: 12 },
      { content: "Exactly target age with less value", createdAt: timestampFromDate("2025-08-10T15:00:00Z"), uuid: "lower-target", victoryValue: 7.6 },
      { content: "Recent high value", createdAt: timestampFromDate("2026-05-10T15:00:00Z"), uuid: "far-new", victoryValue: 10 },
      { content: "Low value at target age", createdAt: timestampFromDate("2025-08-10T15:00:00Z"), uuid: "low-target", victoryValue: 1 },
    ];
    const app = {
      createNote: jest.fn().mockResolvedValue("graveyard-note-uuid"),
      filterNotes: jest.fn().mockImplementation(async function* () {
        yield { name: "Heuristic Note", uuid: "heuristic-note" };
      }),
      findNote: jest.fn().mockResolvedValue({ name: "Task graveyard data: May 2026", uuid: "graveyard-note-uuid" }),
      getNoteContent: jest.fn().mockImplementation(async () => noteContent),
      getNoteTasks: jest.fn().mockResolvedValue(tasks),
      replaceNoteContent: jest.fn().mockImplementation(async (_noteHandle, content) => {
        noteContent = content;
      }),
    };

    const { candidates } = await loadGraveyardCandidates(app, 5, "domain-1");

    expect(candidates).toHaveLength(5);
    expect(candidates.map(task => task.uuid)).toEqual(["near-target", "near-newer", "lower-target", "far-old", "far-new"]);
    expect(candidates.every(task => Number.isFinite(task.graveyardHeuristicScore))).toBe(true);
    expect(candidates).not.toEqual(expect.arrayContaining([expect.objectContaining({ uuid: "low-target" })]));
  });
});
