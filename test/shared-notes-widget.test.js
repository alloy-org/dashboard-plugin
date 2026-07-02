// [Claude claude-opus-4-8] Generated tests for: Shared Notes widget rendering and hasTasks toggle
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const { default: SharedNotesWidget } = await import("shared-notes");

const TASK_DOMAIN_UUID = "domain-1";
const DAY_MS = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Build an ISO string from a millisecond offset for note `changed`/`updated` fixtures.
// [Claude claude-opus-4-8] Task: produce comparable timestamps for widget fixtures
function iso(ms) {
  return new Date(ms).toISOString();
}

// ----------------------------------------------------------------------------------------------
// @desc Build a mock Amplenote app whose filterNotes yields collaborator-updated shared notes and
//   whose getPeople maps those notes to sharer names (the source of the "shared with" line).
// [Claude claude-opus-4-8] Task: stub filterNotes/getPeople/navigate for Shared Notes widget rendering
// Prompt: "Build an index of person.sharing.notes from the getPeople method"
function buildMockApp() {
  const baseHandles = [
    { active: iso(Date.now() - 2 * DAY_MS), changed: iso(1000), name: "Roadmap", updated: iso(Date.now()), uuid: "note-1" },
    { active: iso(Date.now() - 20 * DAY_MS), changed: iso(8000), name: "Self Only", updated: iso(8000), uuid: "note-2" }, // not collaborator-updated
    { active: iso(Date.now() - 5 * DAY_MS), changed: iso(2000), name: "Specs", updated: iso(Date.now() - 3 * 60 * 60 * 1000), uuid: "note-3" },
  ];
  const people = [
    { name: "Ada Lovelace", uuid: "p-ada", sharing: { notes: ["note-1"] } },
    { name: "Grace Hopper", uuid: "p-grace", sharing: { notes: ["note-3"] } },
  ];
  return {
    filterNotes: jest.fn().mockResolvedValue(baseHandles),
    getPeople: jest.fn().mockResolvedValue(people),
    navigate: jest.fn().mockResolvedValue(undefined),
    // Pins archive: no pins note exists yet, and writes are captured for assertions.
    findNote: jest.fn().mockResolvedValue(null),
    getNoteContent: jest.fn().mockResolvedValue(""),
    createNote: jest.fn().mockResolvedValue({ uuid: "pins-note" }),
    replaceNoteContent: jest.fn().mockResolvedValue(undefined),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Render SharedNotesWidget into jsdom and return its container plus the mock app.
// [Claude claude-opus-4-8] Task: mount the Shared Notes widget for interaction assertions
async function renderWidget(props = {}) {
  const app = buildMockApp();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(SharedNotesWidget, { app, gridHeightSize: 1, taskDomainUUID: TASK_DOMAIN_UUID, ...props }));
  });
  return { app, container, root };
}

describe("SharedNotesWidget", () => {
  it("lists collaborator-updated notes with their titles, collaborators, and a last-updated label", async () => {
    const { app, container } = await renderWidget();

    expect(app.filterNotes).toHaveBeenCalledWith({ group: "shared", taskDomainUUID: TASK_DOMAIN_UUID }, "updated");
    const titles = [...container.querySelectorAll(".shared-note-title")].map(node => node.textContent);
    expect(titles).toEqual(["Roadmap", "Specs"]);
    const collaborators = [...container.querySelectorAll(".shared-note-collaborators")].map(node => node.textContent);
    expect(collaborators).toEqual(["Ada Lovelace", "Grace Hopper"]);
    const lastUpdated = container.querySelectorAll(".shared-note-updated")[1];
    expect(lastUpdated.textContent).toBe("Updated 3h ago");
    expect(lastUpdated.getAttribute("title")).toBe("When a collaborator last updated this note");
    // When the current user last opened the note ("active", 5d ago) is shown as a second datestamp.
    expect(container.querySelectorAll(".shared-note-opened")[1].textContent).toBe("Opened 5d ago");
  });

  it("shows the person filter (with the has-tasks toggle on the same row) when 2+ people have shared", async () => {
    const { container } = await renderWidget();
    const filterRow = container.querySelector(".shared-notes-filter");
    expect(filterRow).not.toBeNull();
    const options = [...filterRow.querySelectorAll("option")].map(node => node.textContent);
    expect(options).toEqual(["All collaborators", "Ada Lovelace", "Grace Hopper"]);
    // The toggle lives inside the filter row, not the widget header, when the filter is shown.
    expect(filterRow.querySelector(".shared-notes-toggle input")).not.toBeNull();
  });

  it("hides the person filter and keeps the has-tasks toggle when only one person has shared", async () => {
    const app = {
      filterNotes: jest.fn().mockResolvedValue([
        { active: iso(Date.now() - 5 * DAY_MS), changed: iso(1000), name: "Roadmap", updated: iso(Date.now()), uuid: "note-1" },
      ]),
      getPeople: jest.fn().mockResolvedValue([{ name: "Ada Lovelace", uuid: "p-ada", sharing: { notes: ["note-1"] } }]),
      navigate: jest.fn(),
      findNote: jest.fn().mockResolvedValue(null),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(createElement(SharedNotesWidget, { app, taskDomainUUID: TASK_DOMAIN_UUID }));
    });
    expect(container.querySelector(".shared-notes-filter")).toBeNull();
    expect(container.querySelector(".shared-notes-toggle input")).not.toBeNull();
  });

  it("navigates to the note when a row is clicked", async () => {
    const { app, container } = await renderWidget();
    await act(async () => {
      container.querySelector(".shared-note-link").click();
    });
    expect(app.navigate).toHaveBeenCalledWith("https://www.amplenote.com/notes/note-1");
  });

  it("re-queries filterNotes with the hasTasks group when the checkbox is toggled", async () => {
    const { app, container } = await renderWidget();
    const checkbox = container.querySelector(".shared-notes-toggle input");
    await act(async () => {
      checkbox.click();
    });
    expect(app.filterNotes).toHaveBeenLastCalledWith({ group: "shared,taskLists", taskDomainUUID: TASK_DOMAIN_UUID }, "updated");
  });

  it("renders getPeople avatars: an <img> when a person has an avatar image, a text badge otherwise", async () => {
    const recentIso = iso(Date.now());
    const app = {
      filterNotes: jest.fn().mockResolvedValue([
        { active: iso(Date.now() - 5 * DAY_MS), changed: iso(1000), name: "Roadmap", updated: recentIso, uuid: "note-1" },
      ]),
      getPeople: jest.fn().mockResolvedValue([
        { uuid: "p1", name: "Ada Lovelace", avatar: { image: "https://example.com/ada.png" }, sharing: { notes: ["note-1"] } },
        { uuid: "p2", name: "Grace Hopper", avatar: { text: "GH" }, sharing: { notes: ["note-1"] } },
      ]),
      navigate: jest.fn(),
      findNote: jest.fn().mockResolvedValue(null),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(createElement(SharedNotesWidget, { app, taskDomainUUID: TASK_DOMAIN_UUID }));
    });

    expect(container.querySelector("img.collaborator-avatar")?.getAttribute("src")).toBe("https://example.com/ada.png");
    expect(container.querySelector(".collaborator-avatar-text").textContent).toBe("GH");
    expect(container.querySelector(".shared-note-collaborators").textContent).toBe("Ada Lovelace, Grace Hopper");
  });

  it("pins a note atop the list and persists the pinned UUID to the archive note", async () => {
    const { app, container } = await renderWidget();
    // Second row's pin (Specs / note-3); clicking it should float note-3 above Roadmap (note-1).
    const specsPin = container.querySelectorAll(".shared-note-pin")[1];
    await act(async () => {
      specsPin.click();
    });
    const titlesAfterPin = [...container.querySelectorAll(".shared-note-title")].map(node => node.textContent);
    expect(titlesAfterPin).toEqual(["Specs", "Roadmap"]);
    // The pinned button reflects its active state and the UUID was written to the archive note.
    expect(container.querySelectorAll(".shared-note-pin")[0].classList.contains("shared-note-pin-active")).toBe(true);
    const written = app.replaceNoteContent.mock.calls.at(-1)[1];
    expect(written).toContain("note-3");
  });

  it("shows an empty-state message when no notes were updated by collaborators", async () => {
    const app = { filterNotes: jest.fn().mockResolvedValue([]), getPeople: jest.fn().mockResolvedValue([]),
      navigate: jest.fn(), findNote: jest.fn().mockResolvedValue(null) };
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(createElement(SharedNotesWidget, { app, taskDomainUUID: TASK_DOMAIN_UUID }));
    });
    expect(container.querySelector(".note-empty").textContent).toBe("No notes recently updated by collaborators.");
  });
});
