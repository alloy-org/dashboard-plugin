// The three Planning splashes: import, connect AI, and the video invitation. The entry decision itself is
// covered in quarterly-plan-entry.test.js; here the widget only has to render what that decision returns.

import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const resolveQuarterlyPlanEntry = jest.fn();

await jest.unstable_mockModule("quarterly-plan-service", () => ({
  createOrAppendMonthlyPlan: jest.fn(),
  createOrAppendWeeklyPlan: jest.fn(),
  createQuarterlyPlan: jest.fn(),
  findQuarterPlan: jest.fn(async () => null),
  getMonthlyPlanContent: jest.fn(async () => ({ content: "", found: false })),
  resolveQuarterlyPlanEntry: (...args) => resolveQuarterlyPlanEntry(...args),
}));
await jest.unstable_mockModule("plan-wizard/wizard-prompt-runner", () => ({
  raceWizardPrompt: jest.fn(async () => ({ occupationHypothesis: "", personal: [], work: [] })),
}));

const { default: PlanningWidget } = await import("dashboard/planning");

const quarterlyPlans = {
  current: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q3 2026", noteUUID: null, quarter: 3, year: 2026 },
  next: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q4 2026", noteUUID: null, quarter: 4, year: 2026 },
};
const sharedEntry = {
  agentProPriceLabel: "$8",
  agentProUrl: "https://www.amplenote.com/plugins/ample_agent_pro",
  importSources: [
    { id: "evernote", label: "Evernote", url: "https://www.amplenote.com/help/import_notes_and_tasks_overview#___import_from_evernote" },
    { id: "obsidian", label: "Obsidian", url: "https://www.amplenote.com/help/import_notes_and_tasks_overview#___import_from_obsidian" },
  ],
  taskThreshold: 25,
  videoEmbedUrl: "https://www.youtube.com/embed/zyLI9KCziNU?start=5",
  videoUrl: "https://www.youtube.com/watch?v=zyLI9KCziNU&t=5s",
};

// ----------------------------------------------------------------------------------------------
// @desc Make `new Date()` return one local day for the rest of the test.
// @param {Date} now - The day the widget should treat as today.
// @returns {Function} Restores the real Date.
function freezeNow(now) {
  const RealDate = global.Date;
  const fixedTime = now.getTime();
  function FrozenDate(...args) {
    if (args.length === 0) return new RealDate(fixedTime);
    return new RealDate(...args);
  }
  FrozenDate.now = () => fixedTime;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  FrozenDate.prototype = RealDate.prototype;
  global.Date = FrozenDate;
  return () => { global.Date = RealDate; };
}

// ----------------------------------------------------------------------------------------------
async function settle() {
  for (let iteration = 0; iteration < 8; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount Planning on Sep 20, 2026, eleven days before Q4, with the entry state the test supplies.
// @param {Object} entry - The splash resolveQuarterlyPlanEntry resolves to
// @param {Function|null} onOpenSettings - Settings opener
// @returns {Promise<Object>} { app, cleanup, container }
async function renderSplash(entry, onOpenSettings = jest.fn()) {
  resolveQuarterlyPlanEntry.mockResolvedValue(entry);
  const restoreNow = freezeNow(new Date(2026, 8, 20));
  const app = createPlanWizardApp();
  app.navigate = jest.fn();
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(PlanningWidget, { app, onOpenSettings, quarterlyPlans, taskDomainName: "Work",
      taskDomainUUID: "domain-work" }));
  });
  await settle();
  return { app, cleanup: async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
    restoreNow();
  }, container: mountPoint, onOpenSettings };
}

describe("Planning quarterly plan splash", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("links each importer and still lets the user build from scratch", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    const clipboard = navigator.clipboard;
    const execCommand = document.execCommand;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    document.execCommand = jest.fn(() => false);
    let cleanup = async () => {};
    try {
      const { app, cleanup: unmount, container } = await renderSplash({ ...sharedEntry, applicableTaskCount: 7, kind: "import" });
      cleanup = unmount;

      expect(container.textContent).toContain("7 tasks in your notes");
      expect(container.textContent).not.toContain("Import link copied. Open a new tab to paste");
      const evernote = [...container.querySelectorAll(".plan-entry-source")].find(button => button.textContent.includes("Evernote"));
      await act(async () => { evernote.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      const importUrl = "https://www.amplenote.com/help/import_notes_and_tasks_overview#___import_from_evernote";
      expect(app.navigate).toHaveBeenCalledWith(importUrl);
      expect(writeText).toHaveBeenCalledWith(importUrl);
      const copiedMessage = container.querySelector(".plan-entry-import-copied");
      expect(copiedMessage.textContent).toBe("Import link copied. Open a new tab to paste");
      expect(copiedMessage.previousElementSibling.className).toBe("plan-entry-sources");

      await act(async () => { container.querySelector(".plan-entry-scratch").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await settle();
      expect(document.body.querySelector(".plan-wizard-title-quarter").textContent).toBe("Q4 2026");
    } finally {
      document.execCommand = execCommand;
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
      await cleanup();
    }
  });

  it("opens Agent Pro and plugin settings from the no-AI splash", async () => {
    const { app, cleanup, container, onOpenSettings } = await renderSplash({ ...sharedEntry, applicableTaskCount: 142, kind: "needs-ai" });

    expect(container.textContent).toContain("Your 142 tasks are ready to become a plan");
    expect(container.textContent).toContain("$8/month");
    const subscribe = [...container.querySelectorAll("button")].find(button => button.textContent.includes("Subscribe to Agent Pro"));
    await act(async () => { subscribe.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(app.navigate).toHaveBeenCalledWith("https://www.amplenote.com/plugins/ample_agent_pro");

    const addKey = [...container.querySelectorAll("button")].find(button => button.textContent.includes("Add LLM key"));
    await act(async () => { addKey.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await cleanup();
  });

  it("embeds the planning video and opens Plan Builder from the ready splash", async () => {
    const { cleanup, container } = await renderSplash({ ...sharedEntry, applicableTaskCount: 142, kind: "ready" });

    expect(container.textContent).toContain("Set your Q4 2026 plan before the quarter begins");
    expect(container.textContent).toContain("Q4 2026 starts Thursday, Oct 1");
    expect(container.querySelector(".plan-entry-video-frame").getAttribute("src")).toBe(sharedEntry.videoEmbedUrl);

    await act(async () => { container.querySelector(".plan-entry-build").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(document.body.querySelector(".plan-wizard-title-quarter").textContent).toBe("Q4 2026");
    await cleanup();
  });

  it("opens Plan Builder from the Begin button beside the ready headline", async () => {
    const { cleanup, container } = await renderSplash({ ...sharedEntry, applicableTaskCount: 142, kind: "ready" });

    const beginButton = container.querySelector(".plan-entry-heading-row .plan-entry-begin");
    expect(beginButton.textContent).toBe("Begin Quarterly Plan");
    await act(async () => { beginButton.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(document.body.querySelector(".plan-wizard-title-quarter").textContent).toBe("Q4 2026");
    await cleanup();
  });
});
