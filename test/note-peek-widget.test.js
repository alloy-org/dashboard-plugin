// [Claude claude-opus-5 (1M context)] Generated tests for: Note Peek widget note selection and rendering
import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const { default: NotePeekWidget } = await import("note-peek");
const { widgetConfigKey } = await import("constants/settings");
const { setPluginData } = await import("plugin-data");

const NOTE_PEEK_CONFIG_KEY = widgetConfigKey("note-peek");
const NOTE_MARKDOWN = "# Roadmap\n\nShip the thing.";
const NOTE_HTML = '<div class="ample-editor"><h1>Roadmap</h1><p>Ship the thing.</p></div>';

// ----------------------------------------------------------------------------------------------
// @desc A fresh settings snapshot holding a stored Note Peek selection. Built per call because
//   setPluginData retains the object by reference and updatePluginSetting writes through it, so a
//   shared literal would carry one test's persisted choice into the next.
// [Claude claude-opus-5 (1M context)] Task: isolate the stored-selection fixture between tests
function storedRoadmapSettings() {
  return { [NOTE_PEEK_CONFIG_KEY]: ["note-1", "Roadmap"] };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a mock Amplenote app whose prompt returns the given noteHandle (as the host does for a
//   single "note" input) and whose getNoteContent/htmlFromContent answer for that note.
// @param {Object} params - { chosenNote, htmlFromContent }. `htmlFromContent` overrides the default
//   mock so a test can make the host's renderer fail.
// [Claude claude-opus-5 (1M context)] Task: stub prompt/getNoteContent/htmlFromContent/setSetting
function buildMockApp({ chosenNote = { name: "Roadmap", uuid: "note-1" }, htmlFromContent } = {}) {
  return {
    getNoteContent: jest.fn().mockResolvedValue(NOTE_MARKDOWN),
    htmlFromContent: htmlFromContent || jest.fn().mockResolvedValue(NOTE_HTML),
    prompt: jest.fn().mockResolvedValue(chosenNote),
    setSetting: jest.fn().mockResolvedValue(undefined),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Render NotePeekWidget into jsdom against the given settings snapshot and mock app.
// [Claude claude-opus-5 (1M context)] Task: mount the Note Peek widget for interaction assertions
async function renderWidget({ app = buildMockApp(), settings = {} } = {}) {
  setPluginData({ settings });
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(createElement(NotePeekWidget, { app }));
  });
  return { app, container };
}

describe("NotePeekWidget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setPluginData({ settings: {} });
  });

  it("shows a full-body chooser, and no configure link, until a note has been chosen", async () => {
    const { app, container } = await renderWidget();
    expect(container.querySelector(".note-peek-chooser")).not.toBeNull();
    expect(container.querySelector(".widget-configure")).toBeNull();
    expect(app.getNoteContent).not.toHaveBeenCalled();
  });

  it("opens the note selector from the body's Configure button, and does so only once", async () => {
    const { app, container } = await renderWidget();
    await act(async () => {
      container.querySelector(".note-peek-chooser-button").click();
    });
    // The button has no handler of its own: its click bubbles to the chooser wrapper, so a press must
    // not open two stacked prompts.
    expect(app.prompt).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".note-peek-content").innerHTML).toBe(NOTE_HTML);
  });

  it("prompts with a note-selector input, persists the choice, and renders the note", async () => {
    const { app, container } = await renderWidget();
    await act(async () => {
      container.querySelector(".note-peek-chooser").click();
    });

    const noteInput = { inputs: [{ label: "Note", type: "note" }] };
    expect(app.prompt).toHaveBeenCalledWith(expect.any(String), noteInput);
    expect(app.setSetting).toHaveBeenCalledWith(NOTE_PEEK_CONFIG_KEY, JSON.stringify(["note-1", "Roadmap"]));
    expect(app.getNoteContent).toHaveBeenCalledWith({ uuid: "note-1" });
    expect(app.htmlFromContent).toHaveBeenCalledWith(NOTE_MARKDOWN);
    expect(container.querySelector(".note-peek-content").innerHTML).toBe(NOTE_HTML);
    // Once a note is chosen the title bar carries the Configure link and the note name.
    expect(container.querySelector(".widget-configure")).not.toBeNull();
    expect(container.querySelector(".widget-title__subtitle").textContent).toBe("Roadmap");
  });

  it("renders the stored note from settings on mount without prompting", async () => {
    const { app, container } = await renderWidget({ settings: storedRoadmapSettings() });
    expect(app.prompt).not.toHaveBeenCalled();
    expect(app.getNoteContent).toHaveBeenCalledWith({ uuid: "note-1" });
    expect(container.querySelector(".note-peek-content").innerHTML).toBe(NOTE_HTML);
  });

  it("switches to the newly chosen note when the header Configure link is used", async () => {
    const app = buildMockApp({ chosenNote: { name: "Specs", uuid: "note-2" } });
    const { container } = await renderWidget({ app, settings: storedRoadmapSettings() });
    await act(async () => {
      container.querySelector(".widget-configure").click();
    });
    expect(app.setSetting).toHaveBeenCalledWith(NOTE_PEEK_CONFIG_KEY, JSON.stringify(["note-2", "Specs"]));
    expect(app.getNoteContent).toHaveBeenLastCalledWith({ uuid: "note-2" });
    expect(container.querySelector(".widget-title__subtitle").textContent).toBe("Specs");
  });

  it("keeps the current note when the note-selector prompt is cancelled", async () => {
    const app = buildMockApp({ chosenNote: null });
    const { container } = await renderWidget({ app, settings: storedRoadmapSettings() });
    await act(async () => {
      container.querySelector(".widget-configure").click();
    });
    expect(app.setSetting).not.toHaveBeenCalled();
    expect(container.querySelector(".widget-title__subtitle").textContent).toBe("Roadmap");
  });

  it("surfaces an error when the host cannot supply HTML for the note", async () => {
    // The plugin bridge resolves a failed host call to { error }, so a non-string answer is a failure.
    const app = buildMockApp({ htmlFromContent: jest.fn().mockResolvedValue({ error: "not supported" }) });
    const { container } = await renderWidget({ app, settings: storedRoadmapSettings() });
    expect(container.querySelector(".note-peek-content")).toBeNull();
    expect(container.querySelector(".note-error").textContent).toBe("Error: not supported");
  });

  it("reports an empty note rather than rendering blank content", async () => {
    const app = buildMockApp();
    app.getNoteContent = jest.fn().mockResolvedValue("   ");
    const { container } = await renderWidget({ app, settings: storedRoadmapSettings() });
    expect(container.querySelector(".note-empty")).not.toBeNull();
    expect(app.htmlFromContent).not.toHaveBeenCalled();
  });
});
