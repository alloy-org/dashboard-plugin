// In the dev environment a failed Vision Guide write should open the data note in a contentEditable editor,
// since app.navigate cannot take the user to Amplenote the way the production plugin does.

import { jest } from "@jest/globals";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

await jest.unstable_mockModule("util/goal-notes", () => ({
  fetchNoteContent: async (app, noteUUID) => app.getNoteContent({ uuid: noteUUID }),
  navigateToNote: async (_app, noteUUID) => ({ devEdit: true, noteUUID }),
  saveNoteContent: async (app, noteUUID, content, options) => app.replaceNoteContent({ uuid: noteUUID }, content, options),
}));

await jest.unstable_mockModule("providers/fetch-ai-provider", () => ({
  llmPromptWithPluginFallback: jest.fn(async () => ({
    occupationHypothesis: "Builds developer tools", personal: [],
    work: [{ confidence: 6, intent: "Ship the analytics offering", substantiation: "Repeated analytics tasks." }],
  })),
}));

const { default: PlanWizard } = await import("dashboard/plan-wizard/plan-wizard");
const { default: NoteEditor } = await import("dashboard/note-editor");

const SCOPE = { domainName: "Work", domainUuid: "domain-1", quarter: 4, year: 2026 };

// ----------------------------------------------------------------------------------------------
// @desc Flush queued load, inference, and save work.
async function settle() {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Type into a text field the way React's onChange expects.
// @param {HTMLInputElement} input - Field to edit.
// @param {string} text - New value.
async function typeInto(input, text) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Click a control and let resulting async work settle.
// @param {HTMLElement} element - Control to click.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  await settle();
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the wizard against a fixture app.
// @returns {Promise<object>} { app, cleanup, container }.
async function renderPlanWizard(app = createPlanWizardApp()) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(PlanWizard, { app, onClose: () => {}, ...SCOPE }));
  });
  await settle();
  return { app, cleanup: async () => { await act(async () => { root.unmount(); }); mountPoint.remove(); },
    container: document.body };
}

describe("PlanWizard data note in the dev environment", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the full data note in a contentEditable field from the save-error link", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await typeInto(container.querySelector(".intent-step-category--work .intent-step-input"), "Ship the rewrite");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    const nameField = container.querySelector(".projects-step-category--work .project-row-name");
    await typeInto(nameField, "Rebuild the ingestion pipeline");
    await clickAndSettle(nameField.closest(".project-row").querySelector(".project-row-priority-button"));
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    const paceChoice = [...container.querySelectorAll(".project-pace-choice")]
      .find(button => button.textContent === "Two focused blocks per week");
    await clickAndSettle(paceChoice);

    const noteUuid = app.notes[0].uuid;
    const workingReplace = app.replaceNoteContent;
    app.replaceNoteContent = jest.fn(async () => {
      const overflowError = new Error("Vision Guide section \"Professional ideas & prospects\" is 288538 characters; the write limit is 200000");
      overflowError.noteUuid = noteUuid;
      throw overflowError;
    });
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    await clickAndSettle(container.querySelector(".plan-error-note-link"));

    const editor = container.querySelector("[contenteditable='true']");
    expect(editor).not.toBe(null);
    expect(editor.textContent).toContain("Professional ideas & prospects");
    expect(container.querySelector(".plan-error")).toBe(null);

    app.replaceNoteContent = workingReplace;
    await cleanup();
  });

  it("loads a note's markdown into the contentEditable editor", async () => {
    const app = createPlanWizardApp();
    const uuid = await app.createNote("Vision Guide", ["dashboard/plan-wizard"]);
    app.notes[0].content = "# Professional ideas & prospects\n\n```json\n{\"prospects\":[]}\n```\n";
    const mountPoint = document.createElement("div");
    document.body.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    await act(async () => {
      root.render(createElement(NoteEditor, { app, noteUUID: uuid, onBack: () => {} }));
    });
    await settle();
    const editor = mountPoint.querySelector("[contenteditable='true']");
    expect(editor.textContent).toContain("Professional ideas & prospects");
    await act(async () => { root.unmount(); });
    mountPoint.remove();
  });
});
