// Exercise the first wizard page against the real persistence stack: only the provider call is substituted, so
// suggestion selection, optional personal answers, secondary ranks, retries, and scope switching are verified
// through the same merge and note-writing code the plugin runs.

import { jest } from "@jest/globals";
import { createPlanWizardApp } from "./fixtures/plan-wizard-app.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const SCOPE = { domainName: "Work", domainUuid: "domain-1", quarter: 4, year: 2026 };

const inferenceCalls = [];
let inferenceImplementation = null;

await jest.unstable_mockModule("providers/fetch-ai-provider", () => ({
  llmPromptWithPluginFallback: jest.fn(async (app, prompt, options) => {
    inferenceCalls.push({ options, prompt });
    if (inferenceImplementation) return inferenceImplementation();
    return {
      occupationHypothesis: "Builds developer tools",
      personal: [],
      work: [
        { confidence: 6, intent: "Ship the analytics offering", substantiation: "Repeated analytics tasks completed." },
        { confidence: 5, intent: "Hire a second engineer", substantiation: "Hiring tasks appear across two months." },
        { confidence: 4, intent: "Grow the newsletter", substantiation: "Newsletter work recurs weekly." },
      ],
    };
  }),
}));

const { default: PlanWizard, WIZARD_STEPS } = await import("dashboard/plan-wizard/plan-wizard");
const { readPlanGoals, savePlanGoals } = await import("plan-wizard/plan-wizard-service");

// ----------------------------------------------------------------------------------------------
// @desc Mount the wizard and settle the initial read plus any inference it triggers.
// @param {object} params - { app, scope } overrides; a fresh fixture app is created when none is supplied.
// @returns {Promise<object>} { app, cleanup, container, rerender }.
async function renderPlanWizard({ app = createPlanWizardApp(), scope = SCOPE } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = async nextScope => {
    await act(async () => {
      root.render(createElement(PlanWizard, { app, onClose: () => {}, ...nextScope }));
    });
    await settle();
  };
  await rerender(scope);
  return { app, cleanup: async () => { await act(async () => { root.unmount(); }); container.remove(); }, container,
    rerender };
}

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains the wizard's load, inference, and save paths queue.
async function settle() {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Type into a textarea the way React's onChange expects.
// @param {HTMLTextAreaElement} textarea - Field to edit.
// @param {string} text - New value.
async function typeInto(textarea, text) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Click a button and let any resulting async work settle.
// @param {HTMLElement} element - Button to click.
async function clickAndSettle(element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
}

function workFields(container) {
  return [...container.querySelectorAll(".intent-step-category--work .intent-step-input")];
}

function personalFields(container) {
  return [...container.querySelectorAll(".intent-step-category--personal .intent-step-input")];
}

describe("PlanWizard intent step", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers inferred professional suggestions and default personal starting points", async () => {
    const { cleanup, container } = await renderPlanWizard();
    const workSuggestions = [...container.querySelectorAll(".intent-step-category--work .intent-step-suggestion")];
    const personalSuggestions = [...container.querySelectorAll(".intent-step-category--personal .intent-step-suggestion")];

    expect(workSuggestions.map(button => button.textContent)).toEqual([
      "Ship the analytics offering", "Hire a second engineer", "Grow the newsletter"]);
    expect(personalSuggestions.map(button => button.textContent)).toEqual([
      "Get outdoors more", "Connect with family/friends", "Improve my diet"]);
    expect(personalSuggestions.every(button => button.className.includes("intent-step-suggestion--default"))).toBe(true);
    expect(container.querySelector(".intent-step-category--personal .intent-step-suggestion-note")).not.toBeNull();
    await cleanup();
  });

  it("fills the field from a clicked suggestion and only persists it on save", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    const firstSuggestion = container.querySelector(".intent-step-category--work .intent-step-suggestion");

    await clickAndSettle(firstSuggestion);
    expect(workFields(container)[0].value).toBe("Ship the analytics offering");

    const beforeSave = await readPlanGoals(app, SCOPE);
    expect(beforeSave.goals).toEqual([]);

    await clickAndSettle(container.querySelector(".intent-step-save"));
    const afterSave = await readPlanGoals(app, SCOPE);
    expect(afterSave.goals.map(goal => goal.goalText)).toEqual(["Ship the analytics offering"]);
    expect(container.querySelector(".intent-step-saved")).not.toBeNull();
    await cleanup();
  });

  it("saves without a personal answer and records added secondary goals at the next rank", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the rewrite");
    await clickAndSettle(container.querySelector(".intent-step-category--work .intent-step-add-secondary"));
    await typeInto(workFields(container)[1], "Cut the support backlog");
    await clickAndSettle(container.querySelector(".intent-step-save"));

    const stored = await readPlanGoals(app, SCOPE);
    const workGoals = stored.goals.filter(goal => goal.userCategoryEm === "work");
    expect(workGoals.map(goal => [goal.goalRank, goal.goalText])).toEqual([
      [1, "Ship the rewrite"], [2, "Cut the support backlog"]]);
    expect(stored.goals.some(goal => goal.userCategoryEm === "personal")).toBe(false);
    await cleanup();
  });

  it("keeps the personal answer when one is supplied", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the rewrite");
    await typeInto(personalFields(container)[0], "Run three times a week");
    await clickAndSettle(container.querySelector(".intent-step-save"));

    const stored = await readPlanGoals(app, SCOPE);
    const personalGoals = stored.goals.filter(goal => goal.userCategoryEm === "personal");
    expect(personalGoals.map(goal => goal.goalText)).toEqual(["Run three times a week"]);
    await cleanup();
  });

  it("retains the user's text on a save failure and succeeds on retry", async () => {
    const app = createPlanWizardApp();
    const { cleanup, container } = await renderPlanWizard({ app });
    await typeInto(workFields(container)[0], "Ship the rewrite");

    const workingReplace = app.replaceNoteContent;
    app.replaceNoteContent = jest.fn(async () => { throw new Error("Note write rejected"); });
    await clickAndSettle(container.querySelector(".intent-step-save"));

    expect(container.querySelector(".intent-step-error")).not.toBeNull();
    expect(workFields(container)[0].value).toBe("Ship the rewrite");
    expect(container.querySelector(".intent-step-save").textContent).toContain("Retry");

    app.replaceNoteContent = workingReplace;
    await clickAndSettle(container.querySelector(".intent-step-save"));
    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.goals.map(goal => goal.goalText)).toEqual(["Ship the rewrite"]);
    await cleanup();
  });

  it("restores persisted answers when the wizard is reopened", async () => {
    const app = createPlanWizardApp();
    const first = await renderPlanWizard({ app });
    await typeInto(workFields(first.container)[0], "Ship the rewrite");
    await clickAndSettle(first.container.querySelector(".intent-step-save"));
    await first.cleanup();

    const second = await renderPlanWizard({ app });
    expect(workFields(second.container)[0].value).toBe("Ship the rewrite");
    await second.cleanup();
  });

  it("reuses cached suggestions on reopen rather than running inference again", async () => {
    const app = createPlanWizardApp();
    const first = await renderPlanWizard({ app });
    expect(inferenceCalls).toHaveLength(1);
    await first.cleanup();

    const second = await renderPlanWizard({ app });
    expect(inferenceCalls).toHaveLength(1);
    expect([...second.container.querySelectorAll(".intent-step-category--work .intent-step-suggestion")]).toHaveLength(3);
    await second.cleanup();
  });

  it("does not apply a pending response after the domain switches", async () => {
    let releaseInference = null;
    inferenceImplementation = () => new Promise(resolve => {
      releaseInference = () => resolve({ occupationHypothesis: "Stale", personal: [],
        work: [{ confidence: 6, intent: "Stale domain suggestion", substantiation: "From the abandoned domain." }] });
    });

    const app = createPlanWizardApp();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PlanWizard, { app, onClose: () => {}, ...SCOPE }));
    });
    await act(async () => { await Promise.resolve(); });

    inferenceImplementation = () => Promise.resolve({ occupationHypothesis: "Current", personal: [],
      work: [{ confidence: 6, intent: "Current domain suggestion", substantiation: "From the selected domain." }] });
    await act(async () => {
      root.render(createElement(PlanWizard, { app, domainName: "Side project", domainUuid: "domain-2",
        onClose: () => {}, quarter: 4, year: 2026 }));
    });
    await settle();

    await act(async () => { releaseInference?.(); });
    await settle();

    const suggestionTexts = [...container.querySelectorAll(".intent-step-suggestion")].map(button => button.textContent);
    expect(suggestionTexts).not.toContain("Stale domain suggestion");
    expect(suggestionTexts).toContain("Current domain suggestion");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("does not overwrite text the user is typing when a refresh lands", async () => {
    let releaseInference = null;
    inferenceImplementation = () => new Promise(resolve => {
      releaseInference = () => resolve({ occupationHypothesis: "Late", personal: [],
        work: [{ confidence: 6, intent: "Late suggestion", substantiation: "Arrived after typing began." }] });
    });

    const app = createPlanWizardApp();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PlanWizard, { app, onClose: () => {}, ...SCOPE }));
    });
    await act(async () => { await Promise.resolve(); });

    const typedField = workFields(container)[0];
    await typeInto(typedField, "My own words");

    await act(async () => { releaseInference?.(); });
    await settle();

    expect(workFields(container)[0].value).toBe("My own words");
    expect([...container.querySelectorAll(".intent-step-suggestion")].map(button => button.textContent))
      .toContain("Late suggestion");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("shows suggestions and stored goals before inference is requested", async () => {
    const app = createPlanWizardApp();
    await savePlanGoals(app, { ...SCOPE, goals: [{ capturedAt: "2026-09-01T00:00:00.000Z", goalRank: 1,
      goalText: "Already chosen", userCategoryEm: "work", uuid: "goal-1" }] });
    inferenceCalls.length = 0;
    inferenceImplementation = () => { throw new Error("Inference must not run for a cached scope"); };

    const { cleanup, container } = await renderPlanWizard({ app });
    expect(workFields(container)[0].value).toBe("Already chosen");
    await cleanup();
  });

  it("leaves Find my projects disabled until project discovery exists", async () => {
    const { cleanup, container } = await renderPlanWizard();
    expect(container.querySelector(".intent-step-continue").disabled).toBe(true);
    await cleanup();
  });
});

describe("PlanWizard step navigation", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  it("opens on the intent step and reports its position in the sequence", async () => {
    const { cleanup, container } = await renderPlanWizard();
    expect(container.querySelector(".plan-wizard-progress").textContent).toBe(`1 of ${ WIZARD_STEPS.length }`);
    expect(container.querySelector(".intent-step-page")).not.toBe(null);
    expect(container.querySelector(".plan-wizard-back").disabled).toBe(true);
    await cleanup();
  });

  it("advances to the next step and names the milestone that is not built", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".plan-wizard-progress").textContent).toBe(`2 of ${ WIZARD_STEPS.length }`);
    expect(container.querySelector(".intent-step-page")).toBe(null);
    expect(container.querySelector(".pending-step-notice").textContent).toContain("not built yet");
    await cleanup();
  });

  it("returns to the intent step with the user's saved answers intact", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".intent-step-save"));
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    await clickAndSettle(container.querySelector(".plan-wizard-back"));

    expect(workFields(container)[0].value).toBe("Ship the analytics offering");
    await cleanup();
  });

  it("stops at the last step rather than running past the end of the sequence", async () => {
    const { cleanup, container } = await renderPlanWizard();
    for (let step = 1; step < WIZARD_STEPS.length; step += 1) {
      await clickAndSettle(container.querySelector(".plan-wizard-next"));
    }

    expect(container.querySelector(".plan-wizard-progress").textContent)
      .toBe(`${ WIZARD_STEPS.length } of ${ WIZARD_STEPS.length }`);
    expect(container.querySelector(".plan-wizard-next").disabled).toBe(true);
    await cleanup();
  });
});
