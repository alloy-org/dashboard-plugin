// Quarterly Planning leaves the splash once saved answers or a plan note show the quarter has been begun.

import { jest } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";

const resolveBegunQuarterPlan = jest.fn();

await jest.unstable_mockModule("plan-wizard/plan-begun", () => ({
  resolveBegunQuarterPlan: (...args) => resolveBegunQuarterPlan(...args),
}));
await jest.unstable_mockModule("plan-wizard/wizard-prompt-runner", () => ({
  raceWizardPrompt: jest.fn(async () => ({ occupationHypothesis: "", personal: [], work: [] })),
}));

const { default: PlanningWidget } = await import("dashboard/planning");

const quarterlyPlans = {
  current: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q4 2026", noteUUID: null, quarter: 4,
    year: 2026 },
  next: { domainName: "Work", hasAllMonthlyDetails: false, label: "Q1 2027", noteUUID: null, quarter: 1,
    year: 2027 },
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
// @desc Flush the promise chains the widget's plan check and splash decision queue.
async function settle() {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Mount Planning on Oct 2, 2026, when Q4 is the quarter Plan Builder would open.
// @returns {Promise<object>} { cleanup, container }
async function renderPlanning() {
  const restoreNow = freezeNow(new Date(2026, 9, 2));
  const app = createPlanWizardApp();
  app.getNoteSections = jest.fn(async () => []);
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  await act(async () => {
    root.render(createElement(PlanningWidget, { app, quarterlyPlans, taskDomainName: "Work",
      taskDomainUUID: "domain-work" }));
  });
  await settle();
  return { cleanup: async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
    restoreNow();
  }, container: mountPoint };
}

// ----------------------------------------------------------------------------------------------
// @desc Answer each quarter's lookup from a table, so only the quarters named in it have been begun.
// @param {object} progressByQuarter - Map of quarter number to { begun, noteUUID }. Missing quarters are not begun.
function mockQuarterProgress(progressByQuarter) {
  resolveBegunQuarterPlan.mockImplementation(async (app, { quarter, year }) => {
    const progress = progressByQuarter[quarter] ?? { begun: false, noteUUID: null };
    return { ...progress, quarter, year };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc The status text on the card for one quarter.
// @param {HTMLElement} container - The widget's mount point.
// @param {string} label - The quarter's label, such as "Q4 2026".
// @returns {string|null} The card's status text, or null when no card shows that quarter.
function cardStatus(container, label) {
  const cards = [...container.querySelectorAll(".quarter-card")];
  const card = cards.find(candidate => candidate.querySelector(".quarter-label")?.textContent.startsWith(label));
  return card ? card.querySelector(".quarter-status").textContent : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Click an element the way the widget's handlers listen, then let the resulting promises settle.
// @param {HTMLElement} element - Element that owns the onClick.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

describe("Planning begun-plan detection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    resolveBegunQuarterPlan.mockReset();
  });

  it("keeps the splash when the quarter has no saved answers and no plan note", async () => {
    mockQuarterProgress({});
    const { cleanup, container } = await renderPlanning();
    try {
      expect(container.querySelector(".plan-entry-title")).not.toBeNull();
      expect(container.textContent).not.toContain("Checking your plan");
      expect(container.querySelector(".quarter-card")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("shows the begun quarter as Continue Plan once saved answers exist, even without a plan note", async () => {
    mockQuarterProgress({ 4: { begun: true, noteUUID: null } });
    const { cleanup, container } = await renderPlanning();
    try {
      expect(container.querySelector(".plan-entry-title")).toBeNull();
      expect(cardStatus(container, "Q4 2026")).toBe("✏️ Continue Plan");
      expect(cardStatus(container, "Q1 2027")).toBe("+ Create Plan");
      expect(container.textContent).not.toContain("Set your Q4 2026 plan");
    } finally {
      await cleanup();
    }
  });

  it("shows Open Plan when the lookup finds a plan note the dashboard had not loaded", async () => {
    mockQuarterProgress({ 4: { begun: true, noteUUID: "q4-note" } });
    const { cleanup, container } = await renderPlanning();
    try {
      expect(container.querySelector(".plan-entry-title")).toBeNull();
      expect(cardStatus(container, "Q4 2026")).toBe("📝 Open Plan");
    } finally {
      await cleanup();
    }
  });

  it("leaves the splash after the wizard closes once answers have been saved", async () => {
    mockQuarterProgress({});
    const { cleanup, container } = await renderPlanning();
    try {
      mockQuarterProgress({ 4: { begun: true, noteUUID: null } });
      const startPlan = container.querySelector(".plan-entry-scratch, .plan-entry-begin, .plan-entry-build");
      expect(startPlan).not.toBeNull();
      await clickAndSettle(startPlan);
      const backdrop = document.body.querySelector(".plan-wizard-backdrop");
      expect(backdrop).not.toBeNull();
      await clickAndSettle(backdrop);
      expect(container.querySelector(".plan-entry-title")).toBeNull();
      expect(cardStatus(container, "Q4 2026")).toBe("✏️ Continue Plan");
      const lookedUpQuarters = resolveBegunQuarterPlan.mock.calls.map(([, scope]) => `Q${ scope.quarter } ${ scope.year }`);
      expect(lookedUpQuarters).toEqual(["Q4 2026", "Q1 2027", "Q4 2026", "Q1 2027"]);
    } finally {
      await cleanup();
    }
  });
});
