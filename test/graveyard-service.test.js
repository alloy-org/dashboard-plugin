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
});
