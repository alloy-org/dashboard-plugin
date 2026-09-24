// Plan Builder cannot produce any of its pages without an AI provider, so it blocks with a gate instead of
// opening on a question it cannot answer. These tests cover which of the three provider sources satisfy the
// gate, and the round trip through Dashboard Settings: the builder closes so the settings popup is reachable,
// and the builder that reopens afterwards reads the key that was saved while it was gone.

import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

await jest.unstable_mockModule("plan-wizard/wizard-prompt-runner", () => ({
  raceWizardPrompt: jest.fn(async () => ({ occupationHypothesis: "", personal: [], work: [] })),
}));

const { SETTING_KEYS } = await import("constants/settings");
const { default: PlanningWidget } = await import("dashboard/planning");
const { setPluginData, updatePluginSetting } = await import("plugin-data");

const SCOPE = { taskDomainName: "Work", taskDomainUUID: "domain-work" };
const QUARTERLY_PLANS = {
  current: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q3 2026", noteUUID: null, quarter: 3, year: 2026 },
  next: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q4 2026", noteUUID: null, quarter: 4, year: 2026 },
};

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains the widget's month load, the wizard's plan read, and the Ample Agent Pro
//   lookup each queue.
async function settle() {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount the planning widget, which owns both the Build plan action and the wizard overlay.
// @param {object} params - An object with the following properties:
//   - {object} [app] - App proxy the widget and wizard run against.
//   - {Function|null} [onOpenSettings] - The dashboard's settings opener, or null to model a caller that
//     cannot open settings.
// @returns {Promise<object>} An object with the following properties:
//   - {Function} cleanup - Unmounts the widget and removes its mount point.
//   - {HTMLElement} container - The widget's mount point.
async function renderPlanning({ app = createPlanWizardApp(), onOpenSettings = null } = {}) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(PlanningWidget, { app, onOpenSettings, quarterlyPlans: QUARTERLY_PLANS, ...SCOPE }));
  });
  await settle();
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
  };
  return { cleanup, container: mountPoint };
}

// ----------------------------------------------------------------------------------------------
// @desc Click an element the way the widget's handlers listen, then let the resulting promises settle.
// @param {HTMLElement} element - Element that owns the onClick.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

// ----------------------------------------------------------------------------------------------
// @desc Open Plan Builder through the widget's header action.
// @param {HTMLElement} container - The widget's mount point.
async function openPlanBuilder(container) {
  await clickAndSettle(container.querySelector(".widget-header-action"));
}

// ----------------------------------------------------------------------------------------------
// @desc An app whose Ample Agent Pro lookup answers with a note, modelling a user who runs AI features through
//   the plugin rather than through a key of their own.
// @returns {object} The plan wizard fixture app with that one lookup replaced.
function appWithAmpleAgentPro() {
  const app = createPlanWizardApp();
  const findNote = app.findNote;
  app.findNote = jest.fn(async (query = {}) => {
    if (query.name === "Ample Agent Pro") return { name: query.name, uuid: "agent-pro-note" };
    return findNote(query);
  });
  return app;
}

describe("PlanWizard provider gate", () => {
  beforeEach(() => {
    setPluginData({ context: {}, settings: {} });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("blocks the questions with the gate when no provider is reachable", async () => {
    const { cleanup, container } = await renderPlanning({ onOpenSettings: jest.fn() });
    await openPlanBuilder(container);

    expect(document.body.querySelector(".provider-key-gate")).not.toBeNull();
    expect(document.body.querySelector(".intent-step-category--work")).toBeNull();
    expect(document.body.querySelector(".plan-wizard-navigation")).toBeNull();
    await cleanup();
  });

  it("asks the questions when an API key is configured", async () => {
    updatePluginSetting(SETTING_KEYS.LLM_API_KEY_OPENAI, "an-openai-key");
    const { cleanup, container } = await renderPlanning({ onOpenSettings: jest.fn() });
    await openPlanBuilder(container);

    expect(document.body.querySelector(".provider-key-gate")).toBeNull();
    expect(document.body.querySelector(".intent-step-category--work")).not.toBeNull();
    await cleanup();
  });

  it("asks the questions when Ample Agent Pro can run them without a key", async () => {
    const { cleanup, container } = await renderPlanning({ app: appWithAmpleAgentPro(), onOpenSettings: jest.fn() });
    await openPlanBuilder(container);

    expect(document.body.querySelector(".provider-key-gate")).toBeNull();
    expect(document.body.querySelector(".intent-step-category--work")).not.toBeNull();
    await cleanup();
  });

  it("leaves out the settings link when no caller can open settings", async () => {
    const { cleanup, container } = await renderPlanning({ onOpenSettings: null });
    await openPlanBuilder(container);

    expect(document.body.querySelector(".provider-key-gate")).not.toBeNull();
    expect(document.body.querySelector(".provider-key-gate-button--primary")).toBeNull();
    await cleanup();
  });

  it("closes the builder for the settings popup and reopens it on the key saved there", async () => {
    let onSettingsClosed = null;
    const onOpenSettings = jest.fn(callback => { onSettingsClosed = callback; });
    const { cleanup, container } = await renderPlanning({ onOpenSettings });
    await openPlanBuilder(container);

    await clickAndSettle(document.body.querySelector(".provider-key-gate-button--primary"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // The wizard portals above the settings popup's stacking layer, so it has to be gone for the popup to be usable.
    expect(document.body.querySelector(".plan-wizard-page")).toBeNull();

    updatePluginSetting(SETTING_KEYS.LLM_API_KEY_ANTHROPIC, "an-anthropic-key");
    await act(async () => { onSettingsClosed(); });
    await settle();

    expect(document.body.querySelector(".plan-wizard-title-quarter").textContent).toBe("Q4 2026");
    expect(document.body.querySelector(".provider-key-gate")).toBeNull();
    expect(document.body.querySelector(".intent-step-category--work")).not.toBeNull();
    await cleanup();
  });

  it("leaves the builder closed when the user cancels out of the gate", async () => {
    const { cleanup, container } = await renderPlanning({ onOpenSettings: jest.fn() });
    await openPlanBuilder(container);

    const [, cancelButton] = document.body.querySelectorAll(".provider-key-gate-button");
    await clickAndSettle(cancelButton);

    expect(document.body.querySelector(".plan-wizard-page")).toBeNull();
    await cleanup();
  });
});
