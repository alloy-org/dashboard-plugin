// Exercise the wizard's pages against the real persistence stack: only the provider call is substituted, so
// suggestion selection, optional personal answers, secondary ranks, retries, scope switching, project capture,
// weekday emphasis, and the two quarter-wide answers are verified through the same merge and note-writing code
// the plugin runs.

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
// @param {object} params - { app, onClose, scope } overrides; a fresh fixture app is created when none is
//   supplied, and onClose defaults to a no-op for the tests that never dismiss the wizard.
// @returns {Promise<object>} An object with the following properties:
//   - {object} app - The fixture app the wizard was mounted against.
//   - {Function} cleanup - Unmounts the wizard and removes its mount point.
//   - {HTMLElement} container - Element to query the rendered wizard through. The wizard portals itself to
//     document.body to escape the planning widget's stacking context, so its markup is not inside the mount
//     point; the body is therefore the element that contains it.
//   - {Function} rerender - Re-renders the wizard with a new scope.
async function renderPlanWizard({ app = createPlanWizardApp(), onClose = () => {}, scope = SCOPE } = {}) {
  const mountPoint = document.createElement("div");
  document.body.appendChild(mountPoint);
  const root = createRoot(mountPoint);
  const rerender = async nextScope => {
    await act(async () => {
      root.render(createElement(PlanWizard, { app, onClose, ...nextScope }));
    });
    await settle();
  };
  await rerender(scope);
  const cleanup = async () => {
    await act(async () => { root.unmount(); });
    mountPoint.remove();
  };
  return { app, cleanup, container: document.body, rerender };
}

// ----------------------------------------------------------------------------------------------
// @desc Flush the promise chains the wizard's load, inference, and save paths queue.
async function settle() {
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Type into a text field the way React's onChange expects. React installs its own value setter on the
//   element, so assigning to .value directly would not notify it; calling the prototype's setter does.
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
    const mountPoint = document.createElement("div");
    document.body.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    // The wizard renders through a portal, so its markup is in the body rather than under the mount point.
    const container = document.body;
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
    mountPoint.remove();
  });

  it("does not overwrite text the user is typing when a refresh lands", async () => {
    let releaseInference = null;
    inferenceImplementation = () => new Promise(resolve => {
      releaseInference = () => resolve({ occupationHypothesis: "Late", personal: [],
        work: [{ confidence: 6, intent: "Late suggestion", substantiation: "Arrived after typing began." }] });
    });

    const app = createPlanWizardApp();
    const mountPoint = document.createElement("div");
    document.body.appendChild(mountPoint);
    const root = createRoot(mountPoint);
    // The wizard renders through a portal, so its markup is in the body rather than under the mount point.
    const container = document.body;
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
    mountPoint.remove();
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

  it("advances to the projects step and says discovery has not run", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".plan-wizard-progress").textContent).toBe(`2 of ${ WIZARD_STEPS.length }`);
    expect(container.querySelector(".intent-step-page")).toBe(null);
    expect(container.querySelector(".projects-step-page")).not.toBe(null);
    expect(container.querySelector(".projects-step-discovery-notice").textContent).toContain("not built yet");
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

// ----------------------------------------------------------------------------------------------
// @desc Advance the wizard to a named step from wherever it currently sits, so a test does not depend on the
//   sequence's numeric positions or on how many steps an earlier helper already traversed.
// @param {HTMLElement} container - Mounted wizard.
// @param {string} stepKey - Step to land on.
async function advanceToStep(container, stepKey) {
  const targetIndex = WIZARD_STEPS.findIndex(step => step.key === stepKey);
  for (let guard = 0; guard < WIZARD_STEPS.length; guard += 1) {
    const [position] = container.querySelector(".plan-wizard-progress").textContent.split(" of ");
    if (Number(position) - 1 === targetIndex) return;
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
  }
  throw new Error(`Could not reach the ${ stepKey } step`);
}

// ----------------------------------------------------------------------------------------------
// @desc Save one professional project, the precondition for the weekday page having anything to assign.
// @param {HTMLElement} container - Mounted wizard, positioned on the projects step.
// @param {string} summary - Project name to enter.
async function saveFirstProject(container, summary) {
  const nameField = container.querySelector(".projects-step-category--work .project-row-name");
  await typeInto(nameField, summary);
  await clickAndSettle(container.querySelector(".projects-step-save"));
}

describe("PlanWizard projects step", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("saves a named project as a human-provided prospect and restores it on reopening", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Rebuild the ingestion pipeline");

    expect(container.querySelector(".projects-step-saved")).not.toBe(null);
    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects.map(prospect => prospect.summary)).toEqual(["Rebuild the ingestion pipeline"]);
    expect(stored.prospects[0].approvalStatus).toBe("humanProvided");
    await cleanup();

    const reopened = await renderPlanWizard({ app });
    await advanceToStep(reopened.container, "projects");
    const names = [...reopened.container.querySelectorAll(".projects-step-category--work .project-row-name")];
    expect(names.map(field => field.value)).toContain("Rebuild the ingestion pipeline");
    await reopened.cleanup();
  });

  it("ties a project to the intent it advances", async () => {
    const app = createPlanWizardApp();
    await savePlanGoals(app, { ...SCOPE, goals: [{ capturedAt: "2026-09-06T12:00:00Z", goalRank: 1,
      goalText: "Ship the analytics offering", userCategoryEm: "work" }] });
    const { cleanup, container } = await renderPlanWizard({ app });
    await advanceToStep(container, "projects");
    await typeInto(container.querySelector(".projects-step-category--work .project-row-name"), "Instrument the funnel");

    const goalCheckbox = container.querySelector(".projects-step-category--work .project-row-goal input");
    await clickAndSettle(goalCheckbox);
    await clickAndSettle(container.querySelector(".projects-step-save"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0].linkedGoalUuids).toEqual([stored.goals[0].uuid]);
    await cleanup();
  });

  it("remembers a removed project as rejected rather than forgetting it", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Retire the legacy exporter");
    await clickAndSettle(container.querySelector(".project-row-reject"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects).toEqual([]);
    expect(stored.prospectRecords.map(record => record.approvalStatus)).toEqual(["humanRejected"]);
    await cleanup();
  });
});

describe("PlanWizard themed weekdays step", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("asks for a project before offering weekdays to assign", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "themed-weekdays");

    expect(container.querySelector(".themed-weekdays-grid")).toBe(null);
    expect(container.querySelector(".themed-weekdays-empty").textContent).toContain("Name a project");
    await cleanup();
  });

  it("stores a weekday emphasis on the project it belongs to", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Rebuild the ingestion pipeline");
    await advanceToStep(container, "themed-weekdays");

    const [monday] = [...container.querySelectorAll(".themed-weekdays-option")];
    await clickAndSettle(monday);
    await clickAndSettle(container.querySelector(".themed-weekdays-save"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0].preferredWeekdays).toEqual(["monday"]);
    expect(stored.prospects[0].approvalStatus).toBe("humanProvided");
    await cleanup();
  });
});

describe("PlanWizard quarter-wide answers", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("saves the quarter's name and restores it on reopening", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "quarter-name");
    await typeInto(container.querySelector(".quarter-answer-input"), "The Shipping Quarter");
    await clickAndSettle(container.querySelector(".quarter-answer-save"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.quarterName.text).toBe("The Shipping Quarter");
    await cleanup();

    const reopened = await renderPlanWizard({ app });
    await advanceToStep(reopened.container, "quarter-name");
    expect(reopened.container.querySelector(".quarter-answer-input").value).toBe("The Shipping Quarter");
    await reopened.cleanup();
  });

  it("saves the daily sufficiency bar separately from the quarter's name", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "quarter-name");
    await typeInto(container.querySelector(".quarter-answer-input"), "The Shipping Quarter");
    await clickAndSettle(container.querySelector(".quarter-answer-save"));
    await advanceToStep(container, "enough-for-today");
    await typeInto(container.querySelector(".quarter-answer-input"), "Two hours of focused project work");
    await clickAndSettle(container.querySelector(".quarter-answer-save"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.quarterName.text).toBe("The Shipping Quarter");
    expect(stored.dailySufficiency.text).toBe("Two hours of focused project work");
    await cleanup();
  });

  it("keeps the user's text and offers a retry when the write fails", async () => {
    const app = createPlanWizardApp();
    const { cleanup, container } = await renderPlanWizard({ app });
    await advanceToStep(container, "quarter-name");
    app.replaceNoteContent.mockRejectedValueOnce(new Error("Amplenote was unreachable"));
    await typeInto(container.querySelector(".quarter-answer-input"), "The Shipping Quarter");
    await clickAndSettle(container.querySelector(".quarter-answer-save"));

    expect(container.querySelector(".quarter-answer-error").textContent).toContain("Amplenote was unreachable");
    expect(container.querySelector(".quarter-answer-input").value).toBe("The Shipping Quarter");
    expect(container.querySelector(".quarter-answer-save").textContent).toBe("Retry saving");

    await clickAndSettle(container.querySelector(".quarter-answer-save"));
    expect(container.querySelector(".quarter-answer-saved")).not.toBe(null);
    await cleanup();
  });
});

describe("PlanWizard modal presentation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("portals the modal to the document body, out of the planning widget's stacking context", async () => {
    const { cleanup, container } = await renderPlanWizard();
    const overlay = container.querySelector(".plan-wizard-overlay");
    expect(overlay.parentElement).toBe(document.body);
    const dialog = overlay.querySelector(".plan-wizard-page");
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await cleanup();
  });

  it("removes the portaled modal when the wizard unmounts", async () => {
    const { cleanup } = await renderPlanWizard();
    expect(document.querySelector(".plan-wizard-overlay")).not.toBeNull();
    await cleanup();
    expect(document.querySelector(".plan-wizard-overlay")).toBeNull();
  });

  it("closes on a backdrop click but not on a click inside the dialog", async () => {
    const closeCalls = [];
    const { cleanup, container } = await renderPlanWizard({ onClose: () => closeCalls.push("closed") });
    await clickAndSettle(container.querySelector(".plan-wizard-page"));
    expect(closeCalls).toHaveLength(0);
    await clickAndSettle(container.querySelector(".plan-wizard-overlay"));
    expect(closeCalls).toEqual(["closed"]);
    await cleanup();
  });

  it("closes on Escape", async () => {
    const closeCalls = [];
    const { cleanup } = await renderPlanWizard({ onClose: () => closeCalls.push("closed") });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(closeCalls).toEqual(["closed"]);
    await cleanup();
  });

  it("captures each answer in a one-line text input, since every wizard answer is a phrase", async () => {
    const { cleanup, container } = await renderPlanWizard();
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    const intentField = container.querySelector(".intent-step-input");
    expect(intentField.tagName).toBe("INPUT");
    expect(intentField.getAttribute("type")).toBe("text");
    await advanceToStep(container, "quarter-name");
    const answerField = container.querySelector(".quarter-answer-input");
    expect(answerField.tagName).toBe("INPUT");
    expect(answerField.getAttribute("type")).toBe("text");
    await cleanup();
  });
});
