// Plan Builder writes the quarterly plan note as soon as the user leaves the projects page, including when every
// choice there was a card decision that saved without publishing, and brings that one note up to date as each
// later page is left.

import { jest } from "@jest/globals";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const SCOPE = { domainName: "Work", domainUuid: "domain-1", quarter: 4, year: 2026 };
const PLAN_NOTE_NAME = "Q4 2026 Work Plan";

await jest.unstable_mockModule("plan-wizard/wizard-prompt-runner", () => ({
  raceWizardPrompt: jest.fn(async () => ({ occupationHypothesis: "", personal: [], proposals: [], work: [] })),
}));

const { SETTING_KEYS } = await import("constants/settings");
const { setPluginData } = await import("plugin-data");
setPluginData({ context: {}, settings: { [SETTING_KEYS.LLM_API_KEY_ANTHROPIC]: "test-anthropic-key" } });

const { default: PlanWizard } = await import("dashboard/plan-wizard/plan-wizard");
const { savePlanGoals, savePlanProspects } = await import("plan-wizard/plan-wizard-service");

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains the wizard's load, save, and publication paths queue.
async function settle() {
  for (let iteration = 0; iteration < 16; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Click an element and let the resulting async work settle.
// @param {HTMLElement} element - Element that owns the onClick.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

// ----------------------------------------------------------------------------------------------
// @desc Seed an app whose quarter already holds a saved intent and one stored, unfocused project, so the projects
//   page opens with a card whose Focus button saves as a card decision.
// @returns {Promise<object>} The fixture app.
async function seededApp() {
  const app = createPlanWizardApp();
  await savePlanGoals(app, { ...SCOPE, goals: [{ capturedAt: "2026-10-01T12:00:00Z", goalRank: 1,
    goalText: "Ship the analytics offering", userCategoryEm: "work" }] });
  await savePlanProspects(app, { ...SCOPE, prospects: [{ approvalStatusEm: "humanProvided", capturedAt: "2026-10-01T12:00:00Z",
    focusMonths: [], substantiations: ["Named by you while planning this quarter."], summary: "Automate the weekly report",
    userCategoryEm: "work" }] });
  return app;
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the wizard, then advance from the intent page to the projects page.
// @param {object} app - Fixture app.
// @returns {Promise<object>} { cleanup, container }
async function renderOnProjectsPage(app) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => { root.render(createElement(PlanWizard, { app, onClose: () => {}, ...SCOPE })); });
  await settle();
  await clickAndSettle(document.body.querySelector(".plan-wizard-next"));
  expect(document.body.querySelector(".projects-step-container")).not.toBeNull();
  return { cleanup: async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
  }, container: document.body };
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's plan notes in the fixture app.
// @param {object} app - Fixture app.
// @returns {Array<object>} Notes named for this quarter's plan.
function planNotes(app) {
  return app.notes.filter(note => note.name === PLAN_NOTE_NAME);
}

describe("PlanWizard plan note publication on page changes", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("creates the plan note when Next leaves the projects page after only a card decision", async () => {
    const app = await seededApp();
    const { cleanup, container } = await renderOnProjectsPage(app);
    try {
      await clickAndSettle(container.querySelector(".project-row .project-row-priority-button"));
      expect(planNotes(app)).toHaveLength(0);

      await clickAndSettle(container.querySelector(".plan-wizard-next"));
      expect(container.querySelector(".pace-cards-container")).not.toBeNull();
      expect(planNotes(app)).toHaveLength(1);
      expect(planNotes(app)[0].content).toContain("Automate the weekly report");
    } finally {
      await cleanup();
    }
  });

  it("does not create a plan note when Back returns from the projects page to the intents", async () => {
    const app = await seededApp();
    const { cleanup, container } = await renderOnProjectsPage(app);
    try {
      await clickAndSettle(container.querySelector(".plan-wizard-back"));
      expect(container.querySelector(".intent-step-container")).not.toBeNull();
      expect(planNotes(app)).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it("keeps writing to the one plan note as each later page is left", async () => {
    const app = await seededApp();
    const { cleanup, container } = await renderOnProjectsPage(app);
    try {
      await clickAndSettle(container.querySelector(".project-row .project-row-priority-button"));
      await clickAndSettle(container.querySelector(".plan-wizard-next"));
      const replaceCountAfterProjects = app.replaceNoteContent.mock.calls.length;
      await savePlanProspects(app, { ...SCOPE, prospects: [{ approvalStatusEm: "humanProvided", capturedAt: "2026-10-02T12:00:00Z",
        focusMonths: [], priorityEm: "stayWarm", substantiations: ["Named by you while planning this quarter."],
        summary: "Close the billing backlog", userCategoryEm: "work" }] });

      await clickAndSettle(container.querySelector(".plan-wizard-next"));
      expect(container.querySelector(".pace-cards-container")).toBeNull();
      expect(planNotes(app)).toHaveLength(1);
      expect(planNotes(app)[0].content).toContain("Close the billing backlog");
      expect(app.replaceNoteContent.mock.calls.length).toBeGreaterThan(replaceCountAfterProjects);
    } finally {
      await cleanup();
    }
  });
});
