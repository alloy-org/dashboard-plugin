/**
 * [Claude-authored file]
 * Created: 2026-03-16 | Model: claude-4.6-opus-high-thinking
 * Task: Tests for DaySketch widget — note creation on new date
 * Prompt summary: "test that when a new date is encountered, a new Day Sketch note is created"
 */
import { jest } from "@jest/globals";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import DaySketchWidget from "../lib/dashboard/day-sketch.js";
import { DASHBOARD_NOTE_TAG } from "constants/settings";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flushAsync = () =>
  act(async () => { await new Promise(r => setTimeout(r, 0)); });

function buildMockApp({ findNoteResult = null, existingContent = null } = {}) {
  const app = {};
  app.findNote = jest.fn().mockResolvedValue(findNoteResult);
  app.createNote = jest.fn().mockResolvedValue("new-sketch-uuid");
  app.replaceNoteContent = jest.fn().mockResolvedValue(true);
  app.getNoteContent = jest.fn().mockResolvedValue(existingContent || "");
  return app;
}

// [Claude] Generated tests for: DaySketch note creation when encountering a new date
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
describe("DaySketchWidget", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => { root.unmount(); });
      root = null;
    }
    container.remove();
  });

  it("creates a new Day Sketch note with the correct name when no note exists for the date", async () => {
    const app = buildMockApp();
    const testDate = "2026-04-15";

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: testDate,
      }));
    });
    await flushAsync();

    const input = container.querySelector(".day-sketch-input");
    expect(input).not.toBeNull();

    await act(async () => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      nativeInputValueSetter.call(input, "Morning meeting");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushAsync();

    const saveBtn = container.querySelector(".day-sketch-save-btn");
    expect(saveBtn).not.toBeNull();

    await act(async () => { saveBtn.click(); });
    await flushAsync();

    expect(app.findNote).toHaveBeenCalledWith({ name: "Day Sketch Wednesday, April 15, 2026" });
    expect(app.createNote).toHaveBeenCalledWith(
      "Day Sketch Wednesday, April 15, 2026",
      [DASHBOARD_NOTE_TAG],
    );
    expect(app.replaceNoteContent).toHaveBeenCalledWith(
      { uuid: "new-sketch-uuid" },
      expect.any(String),
    );
  });

  it("does not create a note when one already exists for the date", async () => {
    const existingNote = { uuid: "existing-uuid", name: "Day Sketch Wednesday, April 15, 2026" };
    const app = buildMockApp({
      findNoteResult: existingNote,
      existingContent: "9am: standup\n10am: deep work",
    });
    const testDate = "2026-04-15";

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: testDate,
      }));
    });
    await flushAsync();

    expect(app.findNote).toHaveBeenCalledWith({ name: "Day Sketch Wednesday, April 15, 2026" });
    expect(app.createNote).not.toHaveBeenCalled();
    expect(app.getNoteContent).toHaveBeenCalledWith({ uuid: "existing-uuid" });
  });

  it("generates the correct note name for different dates", async () => {
    const app = buildMockApp();

    await act(async () => {
      root.render(createElement(DaySketchWidget, {
        app,
        agendaTasks: {},
        currentDate: "2026-01-01",
      }));
    });
    await flushAsync();

    expect(app.findNote).toHaveBeenCalledWith({
      name: "Day Sketch Thursday, January 1, 2026",
    });
  });
});
