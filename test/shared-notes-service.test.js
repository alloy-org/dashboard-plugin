// [Claude claude-opus-4-8] Generated tests for: Shared Notes service — collaborator-updated note discovery
import { jest } from "@jest/globals";
import { collaboratorNamesFromNoteHandle, findCollaboratorUpdatedNotes, lastUpdatedLabelFromMs,
  noteUpdatedByCollaborator, sharedNotesGroupParam, timestampMsFromValue } from "shared-notes-service";

const TASK_DOMAIN_UUID = "domain-all";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ----------------------------------------------------------------------------------------------
// @desc Build a noteHandle with ISO 8601 `created`/`changed`/`updated` strings from ms offsets.
// @param {Object} overrides - Fields to merge onto the base handle (uuid, name, changed, updated...).
// [Claude claude-opus-4-8] Task: construct shared-note fixtures with comparable timestamps
function buildNoteHandle(overrides = {}) {
  return { changed: new Date(0).toISOString(), name: "Untitled", shared: true,
    updated: new Date(0).toISOString(), uuid: "note", ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a mock Amplenote app whose filterNotes returns the supplied handles and records calls.
// @param {Array<Object>} handles - noteHandles to return from filterNotes.
// [Claude claude-opus-4-8] Task: capture filterNotes arguments for the shared-notes service
function buildMockApp(handles) {
  return { filterNotes: jest.fn().mockResolvedValue(handles) };
}

describe("sharedNotesGroupParam", () => {
  it("returns only 'shared' by default and appends 'taskLists' when requested", () => {
    expect(sharedNotesGroupParam(false)).toBe("shared");
    expect(sharedNotesGroupParam(true)).toBe("shared,taskLists");
  });
});

describe("timestampMsFromValue", () => {
  it("parses ISO strings, passes through numbers, and zeroes invalid input", () => {
    expect(timestampMsFromValue("1970-01-01T00:00:01.000Z")).toBe(1000);
    expect(timestampMsFromValue(1234)).toBe(1234);
    expect(timestampMsFromValue(null)).toBe(0);
    expect(timestampMsFromValue("not-a-date")).toBe(0);
  });
});

describe("noteUpdatedByCollaborator", () => {
  it("is true only when updated is strictly newer than changed", () => {
    const collaboratorEdited = buildNoteHandle({
      changed: new Date(1000).toISOString(),
      updated: new Date(5000).toISOString(),
    });
    const selfEditedOnly = buildNoteHandle({
      changed: new Date(5000).toISOString(),
      updated: new Date(5000).toISOString(),
    });
    expect(noteUpdatedByCollaborator(collaboratorEdited)).toBe(true);
    expect(noteUpdatedByCollaborator(selfEditedOnly)).toBe(false);
    expect(noteUpdatedByCollaborator({})).toBe(false);
  });
});

describe("lastUpdatedLabelFromMs", () => {
  it("formats recent times relatively and older times as a date", () => {
    const now = 10 * DAY_MS;
    expect(lastUpdatedLabelFromMs(0, now)).toBe("");
    expect(lastUpdatedLabelFromMs(now - 30 * 1000, now)).toBe("just now");
    expect(lastUpdatedLabelFromMs(now - 5 * MINUTE_MS, now)).toBe("5m ago");
    expect(lastUpdatedLabelFromMs(now - 3 * HOUR_MS, now)).toBe("3h ago");
    expect(lastUpdatedLabelFromMs(now - 2 * DAY_MS, now)).toBe("2d ago");
    expect(lastUpdatedLabelFromMs(now - 9 * DAY_MS, now)).toBe(new Date(now - 9 * DAY_MS).toLocaleDateString());
  });
});

describe("findCollaboratorUpdatedNotes", () => {
  it("queries filterNotes by shared group + task domain ordered by updated, keeping collaborator edits", async () => {
    const handles = [
      buildNoteHandle({ uuid: "a", name: "Alpha", changed: new Date(1000).toISOString(), updated: new Date(9000).toISOString() }),
      buildNoteHandle({ uuid: "b", name: "Beta", changed: new Date(8000).toISOString(), updated: new Date(8000).toISOString() }), // self only
      buildNoteHandle({ uuid: "c", name: "Gamma", changed: new Date(2000).toISOString(), updated: new Date(7000).toISOString() }),
    ];
    const app = buildMockApp(handles);

    const results = await findCollaboratorUpdatedNotes({ app, maxNotes: 5, onlyWithTasks: false, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(app.filterNotes).toHaveBeenCalledWith({ group: "shared", taskDomainUUID: TASK_DOMAIN_UUID }, "updated");
    expect(results.map(entry => entry.noteHandle.uuid)).toEqual(["a", "c"]);
    expect(results[0].updatedMs).toBe(9000);
  });

  it("includes the hasTasks group when onlyWithTasks is set and caps results at maxNotes", async () => {
    const handles = Array.from({ length: 8 }, (_, index) => buildNoteHandle({
      changed: new Date(0).toISOString(),
      updated: new Date((index + 1) * 1000).toISOString(),
      uuid: `note-${ index }`,
    }));
    const app = buildMockApp(handles);

    const results = await findCollaboratorUpdatedNotes({ app, maxNotes: 3, onlyWithTasks: true, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(app.filterNotes).toHaveBeenCalledWith({ group: "shared,taskLists", taskDomainUUID: TASK_DOMAIN_UUID }, "updated");
    expect(results).toHaveLength(3);
  });

  it("de-duplicates repeated uuids returned by filterNotes", async () => {
    const handle = buildNoteHandle({ uuid: "dupe", changed: new Date(0).toISOString(), updated: new Date(1000).toISOString() });
    const app = buildMockApp([handle, { ...handle }]);

    const results = await findCollaboratorUpdatedNotes({ app, maxNotes: 5, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(results).toHaveLength(1);
  });
});
