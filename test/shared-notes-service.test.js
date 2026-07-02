// [Claude claude-opus-4-8] Generated tests for: Shared Notes service — collaborator-updated note discovery
import { jest } from "@jest/globals";
import { avatarTextFromName, buildPeopleIndexByNote, collaboratorsForNote, fetchPeopleIndexByNote,
  findCollaboratorUpdatedNotes, lastUpdatedLabelFromMs, orderNotesPinnedFirst,
  parsePinnedNoteUuids, sharedNotesGroupParam, sharerNamesFromIndex, sharerNamesFromNotes,
  timestampMsFromValue, updatedSinceSeen } from "shared-notes-service";

const TASK_DOMAIN_UUID = "domain-all";
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.now();

// ----------------------------------------------------------------------------------------------
// @desc ISO 8601 string for a time `ms` before the fixed test "now" — keeps fixtures inside the
//   service's 3-month scan window while letting each test express relative updated/changed/active gaps.
// @param {number} ms - Milliseconds before NOW.
// [Claude claude-opus-4-8 (1M context)] Task: recent, relative timestamps for the 3-month scan window
function agoIso(ms) {
  return new Date(NOW - ms).toISOString();
}

// ----------------------------------------------------------------------------------------------
// @desc Build a noteHandle with ISO 8601 `changed`/`updated` strings. Defaults to a recent,
//   collaborator-updated, shared note (updated 1h ago, our last change 10d ago) so tests only override
//   the timestamps that matter to them.
// @param {Object} overrides - Fields to merge onto the base handle (uuid, name, changed, updated...).
// [Claude claude-opus-4-8] Task: construct shared-note fixtures with comparable timestamps
function buildNoteHandle(overrides = {}) {
  return { changed: agoIso(10 * DAY_MS), name: "Untitled", shared: true,
    updated: agoIso(HOUR_MS), uuid: "note", ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a mock Amplenote app whose filterNotes returns the supplied handles and whose getPeople
//   returns the supplied person objects, recording calls to both.
// @param {Array<Object>} handles - noteHandles to return from filterNotes.
// @param {Array<Object>} people - person objects to return from getPeople (defaults to none).
// [Claude claude-opus-4-8] Task: capture filterNotes/getPeople calls for the shared-notes service
function buildMockApp(handles, people = []) {
  return { filterNotes: jest.fn().mockResolvedValue(handles),
    getPeople: jest.fn().mockResolvedValue(people) };
}

describe("sharedNotesGroupParam", () => {
  it("returns no group by default and 'taskLists' when restricting to notes with tasks", () => {
    expect(sharedNotesGroupParam(false)).toBe("");
    expect(sharedNotesGroupParam(true)).toBe("taskLists");
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

describe("updatedSinceSeen", () => {
  it("is true when updated is newer than either our last change or our last open", () => {
    const collaboratorEdited = buildNoteHandle({
      active: new Date(1000).toISOString(),
      changed: new Date(1000).toISOString(),
      updated: new Date(5000).toISOString(),
    });
    // Both our last change and our last open are current with `updated`, so nothing is unseen.
    const selfEditedOnly = buildNoteHandle({
      active: new Date(5000).toISOString(),
      changed: new Date(5000).toISOString(),
      updated: new Date(5000).toISOString(),
    });
    expect(updatedSinceSeen(collaboratorEdited)).toBe(true);
    expect(updatedSinceSeen(selfEditedOnly)).toBe(false);
    expect(updatedSinceSeen({})).toBe(false);
  });
});

describe("lastUpdatedLabelFromMs", () => {
  it("formats recent times relatively", () => {
    const now = 10 * DAY_MS;
    expect(lastUpdatedLabelFromMs(0, now)).toBe("");
    expect(lastUpdatedLabelFromMs(now - 30 * 1000, now)).toBe("just now");
    expect(lastUpdatedLabelFromMs(now - 5 * MINUTE_MS, now)).toBe("5m ago");
    expect(lastUpdatedLabelFromMs(now - 3 * HOUR_MS, now)).toBe("3h ago");
    expect(lastUpdatedLabelFromMs(now - 2 * DAY_MS, now)).toBe("2d ago");
  });
});

describe("findCollaboratorUpdatedNotes", () => {
  it("queries filterNotes by task domain (no shared group) ordered by updated, keeping collaborator edits", async () => {
    const handles = [
      buildNoteHandle({ uuid: "a", name: "Alpha", active: agoIso(2 * DAY_MS), changed: agoIso(2 * DAY_MS), updated: agoIso(HOUR_MS) }),
      buildNoteHandle({ uuid: "b", name: "Beta", active: agoIso(2 * DAY_MS), changed: agoIso(2 * DAY_MS), updated: agoIso(2 * DAY_MS) }), // self only (updated==changed==active)
      buildNoteHandle({ uuid: "c", name: "Gamma", active: agoIso(2 * DAY_MS), changed: agoIso(2 * DAY_MS), updated: agoIso(3 * HOUR_MS) }),
    ];
    const app = buildMockApp(handles);

    const { notes } = await findCollaboratorUpdatedNotes({ app, maxNotes: 5, onlyWithTasks: false, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(app.filterNotes).toHaveBeenCalledWith({ taskDomainUUID: TASK_DOMAIN_UUID }, "updated");
    expect(notes.map(entry => entry.uuid)).toEqual(["a", "c"]);
    expect(notes[0].updatedMs).toBe(new Date(handles[0].updated).getTime());
    // Each entry also carries when the current user last opened the note (`active`) for the 2nd datestamp.
    expect(notes[0].activeMs).toBe(new Date(handles[0].active).getTime());
  });

  it("stops scanning once notes fall outside the 3-month window", async () => {
    const handles = [
      buildNoteHandle({ uuid: "recent", changed: agoIso(10 * DAY_MS), updated: agoIso(2 * DAY_MS) }),
      buildNoteHandle({ uuid: "old", changed: agoIso(200 * DAY_MS), updated: agoIso(120 * DAY_MS) }),
      buildNoteHandle({ uuid: "also-recent", changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) }), // never reached
    ];
    const app = buildMockApp(handles);

    const { notes } = await findCollaboratorUpdatedNotes({ app, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(notes.map(entry => entry.uuid)).toEqual(["recent"]);
  });

  it("includes the taskLists group when onlyWithTasks is set and caps results at maxNotes", async () => {
    const handles = Array.from({ length: 8 }, (_, index) => buildNoteHandle({
      changed: agoIso(10 * DAY_MS),
      updated: agoIso((index + 1) * HOUR_MS),
      uuid: `note-${ index }`,
    }));
    const app = buildMockApp(handles);

    const { notes } = await findCollaboratorUpdatedNotes({ app, maxNotes: 3, onlyWithTasks: true, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(app.filterNotes).toHaveBeenCalledWith({ group: "taskLists", taskDomainUUID: TASK_DOMAIN_UUID }, "updated");
    expect(notes).toHaveLength(3);
  });

  it("de-duplicates repeated uuids returned by filterNotes", async () => {
    const handle = buildNoteHandle({ uuid: "dupe", changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) });
    const app = buildMockApp([handle, { ...handle }]);

    const { notes } = await findCollaboratorUpdatedNotes({ app, maxNotes: 5, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(notes).toHaveLength(1);
  });

  it("skips recent notes that are not shared with anyone", async () => {
    const handles = [
      buildNoteHandle({ uuid: "solo", shared: false, changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) }),
      buildNoteHandle({ uuid: "shared", shared: false, changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) }),
    ];
    const people = [{ name: "Ada", uuid: "p-ada", sharing: { notes: ["shared"] } }];
    const app = buildMockApp(handles, people);

    const { notes } = await findCollaboratorUpdatedNotes({ app, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(notes.map(entry => entry.uuid)).toEqual(["shared"]);
  });

  it("resolves collaborator names and the alphabetical sharer list from getPeople", async () => {
    const handles = [
      buildNoteHandle({ uuid: "n1", changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) }),
      buildNoteHandle({ uuid: "n2", changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) }),
    ];
    const people = [
      { name: "Zoe", uuid: "p-zoe", sharing: { notes: ["n1"] } },
      { name: "Aaron", uuid: "p-aaron", sharing: { notes: ["n1", "n2"] } },
    ];
    const app = buildMockApp(handles, people);

    const { notes, sharerNames } = await findCollaboratorUpdatedNotes({ app, maxNotes: 5, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(sharerNames).toEqual(["Aaron", "Zoe"]);
    const n1Names = notes.find(n => n.uuid === "n1").collaborators.map(c => c.name).sort();
    expect(n1Names).toEqual(["Aaron", "Zoe"]);
    expect(notes.find(n => n.uuid === "n2").collaborators.map(c => c.name)).toEqual(["Aaron"]);
  });
});

describe("sharerNamesFromIndex", () => {
  it("returns every distinct sharer alphabetically, case-insensitively, from the note<>person index", () => {
    const peopleIndex = buildPeopleIndexByNote([
      { uuid: "p1", name: "zoe", sharing: { notes: ["n1"] } },
      { uuid: "p2", name: "Aaron", sharing: { notes: ["n1", "n2"] } },
      { uuid: "p3", name: "bea", sharing: { notes: ["n2"] } },
    ]);
    expect(sharerNamesFromIndex(peopleIndex)).toEqual(["Aaron", "bea", "zoe"]);
    expect(sharerNamesFromIndex(null)).toEqual([]);
  });
});

describe("findCollaboratorUpdatedNotes sharer filter list", () => {
  it("lists only collaborators who appear on a returned note (not everyone in getPeople)", async () => {
    // "a" is collaborator-updated (kept); "b" is self-only (dropped). Bea shares only "b".
    const handles = [
      buildNoteHandle({ uuid: "a", active: agoIso(2 * DAY_MS), changed: agoIso(2 * DAY_MS), updated: agoIso(HOUR_MS) }),
      buildNoteHandle({ uuid: "b", active: agoIso(2 * DAY_MS), changed: agoIso(2 * DAY_MS), updated: agoIso(2 * DAY_MS) }),
    ];
    const people = [
      { name: "Ada", uuid: "p-ada", sharing: { notes: ["a"] } },
      { name: "Bea", uuid: "p-bea", sharing: { notes: ["b"] } },
    ];
    const app = buildMockApp(handles, people);

    const { sharerNames } = await findCollaboratorUpdatedNotes({ app, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(sharerNames).toEqual(["Ada"]);
  });
});

describe("sharerNamesFromNotes", () => {
  it("collects distinct collaborator names from the returned notes, sorted case-insensitively", () => {
    const notes = [
      { collaborators: [{ name: "zoe" }, { name: "Aaron" }] },
      { collaborators: [{ name: "Aaron" }, { name: "bea" }] },
      { collaborators: [] },
    ];
    expect(sharerNamesFromNotes(notes)).toEqual(["Aaron", "bea", "zoe"]);
    expect(sharerNamesFromNotes(null)).toEqual([]);
  });
});

describe("parsePinnedNoteUuids", () => {
  it("de-duplicates and drops non-string/empty entries, returning [] for non-arrays", () => {
    expect(parsePinnedNoteUuids(["a", "b", "a", "", null, 3])).toEqual(["a", "b"]);
    expect(parsePinnedNoteUuids(null)).toEqual([]);
    expect(parsePinnedNoteUuids("a,b")).toEqual([]);
  });
});

describe("orderNotesPinnedFirst", () => {
  it("floats pinned notes to the front, preserving each group's relative order", () => {
    const notes = [
      { uuid: "a" }, { uuid: "b" }, { uuid: "c" },
    ];
    expect(orderNotesPinnedFirst(notes, new Set(["c"])).map(n => n.uuid)).toEqual(["c", "a", "b"]);
    expect(orderNotesPinnedFirst(notes, ["b", "a"]).map(n => n.uuid)).toEqual(["a", "b", "c"]);
    expect(orderNotesPinnedFirst(notes, new Set()).map(n => n.uuid)).toEqual(["a", "b", "c"]);
    expect(orderNotesPinnedFirst(null, new Set(["a"]))).toEqual([]);
  });
});

describe("findCollaboratorUpdatedNotes collaborator resolution", () => {
  it("attaches getPeople-derived collaborators (name + avatar) indexed by note uuid", async () => {
    const handles = [
      buildNoteHandle({ uuid: "a", name: "Alpha", changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) }),
    ];
    const people = [
      { uuid: "p1", name: "Ada Lovelace", avatar: { image: "https://example.com/ada.png" }, sharing: { notes: ["a"] } },
      { uuid: "p2", name: "Grace Hopper", avatar: { text: "GH" }, sharing: { notes: ["a", "other"] } },
      { uuid: "p3", name: "Not On This Note", avatar: { text: "NO" }, sharing: { notes: ["other"] } },
    ];
    const app = buildMockApp(handles, people);

    const { notes } = await findCollaboratorUpdatedNotes({ app, maxNotes: 5, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(app.getPeople).toHaveBeenCalled();
    expect(notes[0].collaborators).toEqual([
      { avatar: { image: "https://example.com/ada.png" }, name: "Ada Lovelace" },
      { avatar: { text: "GH" }, name: "Grace Hopper" },
    ]);
  });

  it("returns [] collaborators for a note nobody is indexed against (but flagged shared)", async () => {
    const handles = [
      buildNoteHandle({ uuid: "a", name: "Alpha", changed: agoIso(10 * DAY_MS), updated: agoIso(HOUR_MS) }),
    ];
    const app = buildMockApp(handles, []);

    const { notes } = await findCollaboratorUpdatedNotes({ app, maxNotes: 5, taskDomainUUID: TASK_DOMAIN_UUID });

    expect(notes[0].collaborators).toEqual([]);
  });
});

describe("buildPeopleIndexByNote", () => {
  it("inverts each person's sharing.notes into a note-uuid -> people map, de-duplicating people", () => {
    const ada = { uuid: "p1", name: "Ada", sharing: { notes: ["n1", "n2"] } };
    const grace = { uuid: "p2", name: "Grace", sharing: { notes: ["n2"] } };
    const index = buildPeopleIndexByNote([ada, grace, ada]);

    expect(index.get("n1")).toEqual([ada]);
    expect(index.get("n2")).toEqual([ada, grace]);
    expect(index.has("missing")).toBe(false);
  });

  it("tolerates missing/non-array input and people without sharing.notes", () => {
    expect(buildPeopleIndexByNote(null).size).toBe(0);
    expect(buildPeopleIndexByNote([{ uuid: "p1", name: "No Sharing" }]).size).toBe(0);
  });
});

describe("fetchPeopleIndexByNote", () => {
  it("builds a note<>person index from getPeople", async () => {
    const app = { getPeople: jest.fn().mockResolvedValue([{ uuid: "p1", name: "Ada", sharing: { notes: ["n1"] } }]) };
    expect((await fetchPeopleIndexByNote(app)).get("n1")).toHaveLength(1);
  });
});

describe("avatarTextFromName", () => {
  it("derives initials from one- and multi-word names and degrades to '?'", () => {
    expect(avatarTextFromName("Ada Lovelace")).toBe("AL");
    expect(avatarTextFromName("Ada Babbage Lovelace")).toBe("AL");
    expect(avatarTextFromName("madonna")).toBe("MA");
    expect(avatarTextFromName("")).toBe("?");
    expect(avatarTextFromName(null)).toBe("?");
  });
});

describe("collaboratorsForNote", () => {
  it("maps indexed people to { name, avatar } and returns [] for an unindexed note", () => {
    const person = { uuid: "p1", name: "Ada", avatar: { text: "A" }, sharing: { notes: ["n1"] } };
    const peopleIndex = buildPeopleIndexByNote([person]);

    expect(collaboratorsForNote({ noteHandle: { uuid: "n1" }, peopleIndex }))
      .toEqual([{ avatar: { text: "A" }, name: "Ada" }]);
    expect(collaboratorsForNote({ noteHandle: { uuid: "n2" }, peopleIndex })).toEqual([]);
  });
});
