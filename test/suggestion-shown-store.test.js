// Verify the shown suggestions store: one write per showing, the later time kept per task or idea, times past the
// retention window dropped, and a note a newer version wrote never overwritten.
import { jest } from "@jest/globals";
import SuggestionShownStore, { shownSuggestionNoteName, suggestionEntriesFromShown } from "dashboard/suggestions/suggestion-shown-store";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";

const DOMAIN_UUID = "work-domain";

// ----------------------------------------------------------------------------------------------
// @desc An in-memory app holding notes by name.
// @returns {object} App mock carrying `contentNamed(name)` for assertions and `setContent(name, content)` for setup.
function notesApp() {
  const notes = new Map();
  const uuidNamed = name => [...notes.entries()].find(([, note]) => note.name === name)?.[0] || null;
  const createNote = name => { notes.set(`note-${ notes.size + 1 }`, { content: "", name }); return `note-${ notes.size }`; };
  return {
    contentNamed: name => notes.get(uuidNamed(name))?.content ?? null,
    context: { refreshNotesList: jest.fn().mockResolvedValue(true) },
    createNote: jest.fn(async name => createNote(name)),
    findNote: jest.fn(async ({ name }) => (uuidNamed(name) ? { name, uuid: uuidNamed(name) } : null)),
    getNoteContent: jest.fn(async ({ uuid }) => notes.get(uuid)?.content ?? ""),
    replaceNoteContent: jest.fn(async ({ uuid }, content) => { notes.get(uuid).content = content; return true; }),
    setContent: (name, content) => { notes.get(uuidNamed(name) || createNote(name)).content = content; },
  };
}

// ----------------------------------------------------------------------------------------------
// @desc A store over the app with its own note writer.
// @param {object} app - From notesApp.
// @returns {SuggestionShownStore} Store.
function storeFor(app) {
  return new SuggestionShownStore({ app, noteWriter: new DashboardNoteWriter({ app }) });
}

describe("SuggestionShownStore", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A missing note holds nothing, and a showing creates the note in one write holding each identity's time.
  it("creates the note on the first showing and reads its times back", async () => {
    const app = notesApp();
    const store = storeFor(app);
    await expect(store.read(DOMAIN_UUID)).resolves.toEqual({ ideas: {}, tasks: {} });
    await store.record(DOMAIN_UUID, { ideaIds: ["idea-1"], shownAt: "2026-09-20T12:00:00.000Z", taskUuids: ["task-1", "task-2"] });
    expect(app.replaceNoteContent).toHaveBeenCalledTimes(1);
    expect(app.createNote.mock.calls[0][0]).toBe(shownSuggestionNoteName(DOMAIN_UUID));
    const shown = await store.read(DOMAIN_UUID);
    expect(shown).toEqual({ ideas: { "idea-1": "2026-09-20T12:00:00.000Z" },
      tasks: { "task-1": "2026-09-20T12:00:00.000Z", "task-2": "2026-09-20T12:00:00.000Z" } });
    expect(suggestionEntriesFromShown(shown)).toEqual([{ suggestedAt: "2026-09-20T12:00:00.000Z", taskUuid: "task-1" },
      { suggestedAt: "2026-09-20T12:00:00.000Z", taskUuid: "task-2" }, { ideaId: "idea-1", suggestedAt: "2026-09-20T12:00:00.000Z" }]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Each identity keeps only its latest time, and times more than the retention window before the latest are
  //   dropped.
  it("keeps the latest time per identity and drops times past the retention window", async () => {
    const app = notesApp();
    const store = storeFor(app);
    await store.record(DOMAIN_UUID, { shownAt: "2026-09-01T12:00:00.000Z", taskUuids: ["old-task"] });
    await store.record(DOMAIN_UUID, { shownAt: "2026-09-20T12:00:00.000Z", taskUuids: ["task-1"] });
    await store.record(DOMAIN_UUID, { shownAt: "2026-09-18T12:00:00.000Z", taskUuids: ["task-1", "task-2"] });
    await expect(store.read(DOMAIN_UUID)).resolves.toEqual({ ideas: {},
      tasks: { "task-1": "2026-09-20T12:00:00.000Z", "task-2": "2026-09-18T12:00:00.000Z" } });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A note a newer version wrote reads as empty and is never overwritten; an empty showing writes nothing.
  it("never overwrites a note a newer version wrote", async () => {
    const app = notesApp();
    const name = shownSuggestionNoteName(DOMAIN_UUID);
    const newerContent = "# Dashboard shown suggestions\n\n```json\n{\"schemaVersion\":99,\"tasks\":{}}\n```\n";
    app.setContent(name, newerContent);
    const store = storeFor(app);
    await expect(store.read(DOMAIN_UUID)).resolves.toEqual({ ideas: {}, tasks: {} });
    await expect(store.record(DOMAIN_UUID, { shownAt: "2026-09-20T12:00:00.000Z", taskUuids: ["task-1"] })).rejects.toThrow("newer version");
    await store.record(DOMAIN_UUID, { shownAt: "2026-09-20T12:00:00.000Z", taskUuids: [] });
    expect(app.contentNamed(name)).toBe(newerContent);
    expect(app.replaceNoteContent).not.toHaveBeenCalled();
  });
});
