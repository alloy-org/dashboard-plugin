// [Claude claude-opus-4-8] Generated tests for: Shared Notes widget rendering and hasTasks toggle
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const { default: SharedNotesWidget } = await import("shared-notes");

const TASK_DOMAIN_UUID = "domain-1";

// ----------------------------------------------------------------------------------------------
// @desc Build an ISO string from a millisecond offset for note `changed`/`updated` fixtures.
// [Claude claude-opus-4-8] Task: produce comparable timestamps for widget fixtures
function iso(ms) {
  return new Date(ms).toISOString();
}

// ----------------------------------------------------------------------------------------------
// @desc Build a mock Amplenote app whose filterNotes yields collaborator-updated shared notes.
//   Notes carry a collaborator name so the widget can render the "shared with" line.
// [Claude claude-opus-4-8] Task: stub filterNotes + navigate for Shared Notes widget rendering
function buildMockApp() {
  const baseHandles = [
    { changed: iso(1000), name: "Roadmap", shareAccess: ["Ada Lovelace"], updated: iso(Date.now()), uuid: "note-1" },
    { changed: iso(8000), name: "Self Only", updated: iso(8000), uuid: "note-2" }, // not collaborator-updated
    { changed: iso(2000), name: "Specs", shareAccess: [{ name: "Grace Hopper" }], updated: iso(Date.now() - 3 * 60 * 60 * 1000), uuid: "note-3" },
  ];
  return {
    filterNotes: jest.fn().mockResolvedValue(baseHandles),
    navigate: jest.fn().mockResolvedValue(undefined),
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
    expect(container.querySelectorAll(".shared-note-updated")[1].textContent).toBe("3h ago");
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
        { changed: iso(1000), name: "Roadmap", updated: recentIso, uuid: "note-1" },
      ]),
      getPeople: jest.fn().mockResolvedValue([
        { uuid: "p1", name: "Ada Lovelace", avatar: { image: "https://example.com/ada.png" }, sharing: { notes: ["note-1"] } },
        { uuid: "p2", name: "Grace Hopper", avatar: { text: "GH" }, sharing: { notes: ["note-1"] } },
      ]),
      navigate: jest.fn(),
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

  it("shows an empty-state message when no notes were updated by collaborators", async () => {
    const app = { filterNotes: jest.fn().mockResolvedValue([]), navigate: jest.fn() };
    const container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      createRoot(container).render(createElement(SharedNotesWidget, { app, taskDomainUUID: TASK_DOMAIN_UUID }));
    });
    expect(container.querySelector(".note-empty").textContent).toBe("No notes recently updated by collaborators.");
  });
});
