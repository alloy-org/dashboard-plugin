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

await jest.unstable_mockModule("plan-wizard/wizard-prompt-runner", () => ({
  raceWizardPrompt: jest.fn(async (app, prompt, options) => {
    inferenceCalls.push({ options, prompt });
    if (inferenceImplementation) return inferenceImplementation(prompt);
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
const { draftPacesFromProspects } = await import("dashboard/plan-wizard/pace-cards-step-fields");
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

// ----------------------------------------------------------------------------------------------
// @desc Dispatch one pointer phase with a horizontal coordinate and settle React's resulting state update.
// @param {HTMLElement} element - Timeline track receiving the pointer event.
// @param {string} eventName - pointerdown, pointermove, or pointerup.
// @param {number} clientX - Horizontal viewport coordinate.
async function dispatchPointer(element, eventName, clientX) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent(eventName, { bubbles: true, clientX }));
  });
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

  it("fills the field from a clicked suggestion and persists it when Next is clicked", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    const firstSuggestion = container.querySelector(".intent-step-category--work .intent-step-suggestion");

    await clickAndSettle(firstSuggestion);
    expect(workFields(container)[0].value).toBe("Ship the analytics offering");

    const beforeNext = await readPlanGoals(app, SCOPE);
    expect(beforeNext.goals).toEqual([]);

    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    const afterNext = await readPlanGoals(app, SCOPE);
    expect(afterNext.goals.map(goal => goal.goalText)).toEqual(["Ship the analytics offering"]);
    expect(container.querySelector(".projects-step-container")).not.toBeNull();
    await cleanup();
  });

  it("focuses a newly added secondary goal field", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await clickAndSettle(container.querySelector(".intent-step-category--work .plan-button--dashed"));
    expect(document.activeElement).toBe(workFields(container)[1]);
    await clickAndSettle(container.querySelector(".intent-step-category--personal .plan-button--dashed"));
    expect(document.activeElement).toBe(personalFields(container)[1]);
    await clickAndSettle(container.querySelector(".intent-step-category--work .plan-button--dashed"));
    expect(document.activeElement).toBe(workFields(container)[2]);
    await cleanup();
  });

  it("saves without a personal answer and records added secondary goals at the next rank", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the rewrite");
    await clickAndSettle(container.querySelector(".intent-step-category--work .plan-button--dashed"));
    await typeInto(workFields(container)[1], "Cut the support backlog");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

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
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

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
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".plan-error")).not.toBeNull();
    expect(workFields(container)[0].value).toBe("Ship the rewrite");

    app.replaceNoteContent = workingReplace;
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.goals.map(goal => goal.goalText)).toEqual(["Ship the rewrite"]);
    await cleanup();
  });

  it("restores persisted answers when the wizard is reopened", async () => {
    const app = createPlanWizardApp();
    const first = await renderPlanWizard({ app });
    await typeInto(workFields(first.container)[0], "Ship the rewrite");
    await clickAndSettle(first.container.querySelector(".plan-wizard-next"));
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

  it("leaves Next disabled until an intent exists for a project to advance", async () => {
    const { cleanup, container } = await renderPlanWizard();
    expect(container.querySelector(".plan-wizard-next").disabled).toBe(true);
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    expect(container.querySelector(".plan-wizard-next").disabled).toBe(false);
    await cleanup();
  });

  it("keeps suggestions out of the intent page tab order", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    const suggestions = [...container.querySelectorAll(".intent-step-suggestion")];
    const tabbableControls = [...container.querySelectorAll(".plan-wizard-page input, .plan-wizard-page button")]
      .filter(element => !element.disabled && element.tabIndex >= 0);

    expect(container.querySelector(".plan-wizard-close")).toBeNull();
    expect(suggestions.every(button => button.tabIndex === -1)).toBe(true);
    expect(tabbableControls.every(element => element.matches(
      ".intent-step-input, .intent-step-container .plan-button--dashed, .plan-wizard-next"))).toBe(true);
    expect(container.querySelector(".intent-step-save")).toBeNull();
    expect(container.querySelector(".intent-step-continue")).toBeNull();
    await cleanup();
  });

  it("separates a load failure summary, record detail, and recovery guidance", async () => {
    const app = createPlanWizardApp();
    app.filterNotes = jest.fn(async () => { throw new Error("Vision Guide lookup was unavailable"); });
    const { cleanup, container } = await renderPlanWizard({ app });

    expect(container.querySelector(".plan-wizard-error-title").textContent)
      .toBe("Plan Builder could not read its saved Vision Guide.");
    expect(container.querySelector(".plan-wizard-error-message").textContent)
      .toBe("Vision Guide lookup was unavailable");
    expect(container.querySelector(".plan-wizard-error-guidance").textContent)
      .toContain("No planning data was changed");
    await cleanup();
  });
});

describe("PlanWizard step navigation", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  // A test that fails before its own cleanup would otherwise leave a mounted wizard in the body, and the next
  // test queries the body — so it would read the stranded wizard's step instead of its own.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens on the intent step and reports its position in the sequence", async () => {
    const { cleanup, container } = await renderPlanWizard();
    const stepDots = [...container.querySelectorAll(".plan-wizard-step-dot")];
    expect(container.querySelector(".plan-wizard-title").textContent).toBe("Plan Builder");
    expect(container.querySelector(".plan-wizard-progress").textContent).toBe(`1 of ${ WIZARD_STEPS.length }`);
    expect(stepDots).toHaveLength(WIZARD_STEPS.length);
    expect(stepDots[0].classList).toContain("plan-wizard-step-dot--current");
    expect(stepDots.slice(1).some(dot => dot.classList.contains("plan-wizard-step-dot--current"))).toBe(false);
    expect(container.querySelector(".intent-step-container")).not.toBe(null);
    expect(container.querySelector(".plan-wizard-back")).toBeNull();
    await cleanup();
  });

  it("renders each step's title and summary from WIZARD_STEPS", async () => {
    const { cleanup, container } = await renderPlanWizard();
    const headingSelector = ".plan-step-container > .plan-heading";
    const summarySelector = ".plan-step-container > .plan-summary";
    for (const step of WIZARD_STEPS) {
      await advanceToStep(container, step.key);
      expect(container.querySelector(headingSelector).textContent).toBe(step.title);
      expect(container.querySelector(summarySelector).textContent).toBe(step.summary);
    }
    await cleanup();
  });

  it("does not advance to projects until an intent is supplied", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".plan-wizard-progress").textContent).toBe(`1 of ${ WIZARD_STEPS.length }`);
    expect(container.querySelector(".intent-step-container")).not.toBeNull();
    await cleanup();
  });

  it("returns to the intent step with the user's saved answers intact", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    await clickAndSettle(container.querySelector(".plan-wizard-back"));

    expect(workFields(container)[0].value).toBe("Ship the analytics offering");
    expect(container.querySelector(".plan-wizard-next").disabled).toBe(false);
    await cleanup();
  });

  it("keeps Next enabled when returning to stored intents while discovery is still running", async () => {
    let releaseDiscovery = null;
    inferenceImplementation = prompt => {
      if (!prompt.includes('"prospects"')) {
        return { occupationHypothesis: "Builds developer tools", personal: [], work: [] };
      }
      return new Promise(resolve => { releaseDiscovery = () => resolve({ prospects: [] }); });
    };
    const { cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    expect(container.querySelector(".projects-step-container")).not.toBeNull();

    await clickAndSettle(container.querySelector(".plan-wizard-back"));
    expect(workFields(container)[0].value).toBe("Ship the analytics offering");
    expect(container.querySelector(".plan-wizard-next").disabled).toBe(false);

    await act(async () => { releaseDiscovery?.(); });
    await settle();
    await cleanup();
  });

  it("stops at the last step rather than running past the end of the sequence", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await typeInto(workFields(container)[0], "Ship the analytics offering");
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
// @desc Advance the wizard to a named step from wherever it currently sits, supplying a minimal intent when
//   leaving the first page so tests of later pages satisfy the same Next precondition as a user.
// @param {HTMLElement} container - Mounted wizard.
// @param {string} stepKey - Step to land on.
async function advanceToStep(container, stepKey) {
  const targetIndex = WIZARD_STEPS.findIndex(step => step.key === stepKey);
  for (let guard = 0; guard < WIZARD_STEPS.length; guard += 1) {
    const [position] = container.querySelector(".plan-wizard-progress").textContent.split(" of ");
    if (Number(position) - 1 === targetIndex) return;
    const nextButton = container.querySelector(".plan-wizard-next");
    if (nextButton.disabled && container.querySelector(".intent-step-container")) {
      await typeInto(workFields(container)[0], "Advance through the wizard");
    }
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
  }
  throw new Error(`Could not reach the ${ stepKey } step`);
}

// ----------------------------------------------------------------------------------------------
// @desc Find one "done enough" condition's radio by the option key it carries.
// @param {HTMLElement} container - Mounted wizard, positioned on the enough-for-today step.
// @param {string} conditionKey - DONE_ENOUGH_OPTIONS key, such as top-three-tasks or not-now.
// @returns {HTMLInputElement} The radio for that condition.
function conditionRadio(container, conditionKey) {
  return container.querySelector(`.done-enough-condition-radio[value="${ conditionKey }"]`);
}

// ----------------------------------------------------------------------------------------------
// @desc Save one professional project, the precondition for the weekday page having anything to assign.
// @param {HTMLElement} container - Mounted wizard, positioned on the projects step.
// @param {string} summary - Project name to enter.
async function saveFirstProject(container, summary) {
  const nameField = container.querySelector(".projects-step-category--work .project-row-name");
  await typeInto(nameField, summary);
  const projectCard = nameField.closest(".project-row");
  await clickAndSettle(projectCard.querySelector(".project-row-priority-button"));
}

// ----------------------------------------------------------------------------------------------
// @desc Find a pace option by its visible label on the current pace card.
// @param {HTMLElement} container - Mounted wizard.
// @param {string} label - Button text.
// @returns {HTMLElement} Matching pace choice button.
function paceChoice(container, label) {
  return [...container.querySelectorAll(".project-pace-choice")].find(button => button.textContent === label);
}

// ----------------------------------------------------------------------------------------------
// @desc Read the currently highlighted weekday chips on the pace page.
// @param {HTMLElement} container - Mounted wizard.
// @returns {Array<string>} Pressed day labels such as Tue.
function pressedPaceDays(container) {
  return [...container.querySelectorAll(".project-pace-day[aria-pressed='true']")].map(button => button.textContent);
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
    await typeInto(container.querySelector(".projects-step-category--work .project-row-name"),
      "Rebuild the ingestion pipeline");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects.map(prospect => prospect.summary)).toEqual(["Rebuild the ingestion pipeline"]);
    expect(stored.prospects[0].approvalStatusEm).toBe("humanProvided");
    await cleanup();

    const reopened = await renderPlanWizard({ app });
    await advanceToStep(reopened.container, "projects");
    const names = [...reopened.container.querySelectorAll(".projects-step-category--work .project-row-name")];
    expect(names.map(field => field.value)).toContain("Rebuild the ingestion pipeline");
    await reopened.cleanup();
  });

  it("automatically ties a custom project to its category intent when Back saves it", async () => {
    const app = createPlanWizardApp();
    await savePlanGoals(app, { ...SCOPE, goals: [{ capturedAt: "2026-09-06T12:00:00Z", goalRank: 1,
      goalText: "Ship the analytics offering", userCategoryEm: "work" }] });
    const { cleanup, container } = await renderPlanWizard({ app });
    await advanceToStep(container, "projects");
    await typeInto(container.querySelector(".projects-step-category--work .project-row-name"), "Instrument the funnel");
    expect(container.querySelector(".project-row-goal")).toBeNull();
    await clickAndSettle(container.querySelector(".plan-wizard-back"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0].linkedGoalUuids).toEqual([stored.goals[0].uuid]);
    await cleanup();
  });

  it("shows priority choices as soon as a custom project has text", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    const nameField = container.querySelector(".projects-step-category--work .project-row-name");
    const projectCard = nameField.closest(".project-row");
    expect(projectCard.querySelector(".project-row-priority")).toBeNull();

    await typeInto(nameField, "Instrument the funnel");
    const priorityButtons = [...projectCard.querySelectorAll(".project-row-priority-button")];
    expect(priorityButtons.map(button => button.textContent)).toEqual(["Focus", "Keep warm", "Not now"]);
    await clickAndSettle(priorityButtons[0]);

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0]).toMatchObject({ approvalStatusEm: "humanProvided", priorityEm: "quarterFocus" });
    await cleanup();
  });

  it("remembers a removed project as rejected rather than forgetting it", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Retire the legacy exporter");
    await clickAndSettle(container.querySelector(".project-row-reject"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects).toEqual([]);
    expect(stored.prospectRecords.map(record => record.approvalStatusEm)).toEqual(["humanRejected"]);
    expect(app.notes[0].content).toContain(`${ stored.prospectRecords[0].uuid } Rejected`);
    await cleanup();
  });
});

describe("PlanWizard project discovery", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Answer both prompts the wizard issues from one implementation, reading the intent's stored identity out
  //   of the discovery prompt itself. The identity is minted during the save, so a candidate cannot be written
  //   with a hardcoded link — which also verifies the prompt carries the identities a proposal must cite.
  // @param {object} params - { proposals, workIntent } to return and to match.
  // @returns {Function} Implementation for the mocked provider.
  function respondToBothPrompts({ proposals, workIntent }) {
    return prompt => {
      if (!prompt.includes('"prospects"')) return { occupationHypothesis: "Builds developer tools", personal: [], work: [] };
      const goalMatch = prompt.match(new RegExp(`\\[([^\\]]+)\\] \\(work\\) ${ workIntent }`));
      const linkedGoalUuids = goalMatch ? [goalMatch[1]] : [];
      return { prospects: proposals.map(proposal => ({ ...proposal, linkedGoalUuids })) };
    };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Add two tasks completed in the past few days, so a candidate citing both clears the two-task bar.
  // @param {object} app - Fixture app whose tasks are read by evidence collection.
  function pushRecentCompletions(app) {
    const secondsAgo = days => Math.round((Date.now() - days * 86400000) / 1000);
    app.tasks.push({ completedAt: secondsAgo(2), content: "Assemble the weekly report by hand", createdAt: secondsAgo(9),
      noteName: "Reporting", noteUUID: "note-reporting", uuid: "task-a" });
    app.tasks.push({ completedAt: secondsAgo(4), content: "Re-send last week's report", createdAt: secondsAgo(11),
      noteName: "Reporting", noteUUID: "note-reporting", uuid: "task-b" });
  }

  it("saves the intent, advances to projects, and shows what discovery proposed with its reasoning", async () => {
    const app = createPlanWizardApp();
    pushRecentCompletions(app);
    inferenceImplementation = respondToBothPrompts({ workIntent: "Ship the analytics offering",
      proposals: [{ focusMonths: [], resolvedTaskUuids: ["task-a", "task-b"], summary: "Automate the weekly report",
        substantiation: "Generating the report would resolve both reporting tasks without writing either one.",
        userCategoryEm: "work" }] });
    const { cleanup, container } = await renderPlanWizard({ app });
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".plan-wizard-progress").textContent).toBe(`2 of ${ WIZARD_STEPS.length }`);
    const proposedRow = container.querySelector(".projects-step-category--work .project-row--proposed");
    expect(proposedRow.querySelector(".project-row-name").value).toBe("Automate the weekly report");
    expect(proposedRow.querySelector(".project-row-provenance").textContent).toContain("without writing either one");
    expect(container.querySelector(".projects-step-discovery-notice").textContent).toContain("waiting on you");
    expect(container.querySelector(".projects-step-container > .plan-actions")).toBeNull();
    expect(container.querySelectorAll(".projects-step-category .projects-step-discover")).toHaveLength(2);
    const workActions = container.querySelector(".projects-step-category--work .plan-actions");
    expect(workActions.querySelector(".projects-step-add")).not.toBeNull();
    expect(workActions.querySelector(".projects-step-discover")).not.toBeNull();
    expect(proposedRow.querySelector(".project-row-goal")).toBeNull();
    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0]).toMatchObject({ approvalStatusEm: "awaitingJudgement", summary: "Automate the weekly report" });
    expect(stored.prospects[0].substantiations[0]).toContain("without writing either one");
    expect(stored.prospects[0]).toMatchObject({ approvalStatusEm: "awaitingJudgement",
      preferredDows: [], priorityEm: null, relatedTasks: ["task-a", "task-b"] });
    expect(stored.prospects[0].refreshedProspectAt).toBeTruthy();
    expect(stored.prospects[0].refreshedTasksAt).toBeTruthy();

    const priorityButtons = [...proposedRow.querySelectorAll(".project-row-priority-button")];
    expect(priorityButtons.map(button => button.textContent)).toEqual(["Focus", "Keep warm", "Not now"]);
    await clickAndSettle(priorityButtons[1]);
    const prioritized = await readPlanGoals(app, SCOPE);
    expect(prioritized.prospects[0]).toMatchObject({ approvalStatusEm: "humanAffirmed", priorityEm: "stayWarm" });
    expect(proposedRow.querySelector('[aria-pressed="true"]').textContent).toBe("Keep warm");
    await cleanup();
  });

  it("affirms an edited proposal while keeping the reasoning discovery gave it", async () => {
    const app = createPlanWizardApp();
    pushRecentCompletions(app);
    inferenceImplementation = respondToBothPrompts({ workIntent: "Ship the analytics offering",
      proposals: [{ focusMonths: [], resolvedTaskUuids: ["task-a", "task-b"], summary: "Automate the weekly report",
        substantiation: "Generating the report would resolve both reporting tasks without writing either one.",
        userCategoryEm: "work" }] });
    const { cleanup, container } = await renderPlanWizard({ app });
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    const proposedName = container.querySelector(".projects-step-category--work .project-row--proposed .project-row-name");
    await typeInto(proposedName, "Automate the weekly report end to end");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const stored = await readPlanGoals(app, SCOPE);
    const affirmed = stored.prospects.find(prospect => prospect.summary === "Automate the weekly report end to end");
    expect(affirmed.approvalStatusEm).toBe("humanAffirmed");
    expect(affirmed.substantiations[0]).toContain("without writing either one");
    expect(affirmed.evidence.map(citation => citation.taskUuid)).toEqual(["task-a", "task-b"]);
    await cleanup();
  });

  it("keeps sibling project cards interactive while one priority decision saves", async () => {
    const app = createPlanWizardApp();
    pushRecentCompletions(app);
    inferenceImplementation = respondToBothPrompts({ workIntent: "Ship the analytics offering",
      proposals: [
        { focusMonths: [], resolvedTaskUuids: ["task-a", "task-b"], substantiations: ["Automates both reports."],
          summary: "Automate the weekly report", userCategoryEm: "work" },
        { focusMonths: [], resolvedTaskUuids: ["task-a", "task-b"], substantiations: ["Prevents both report failures."],
          summary: "Harden report delivery", userCategoryEm: "work" },
      ] });
    const { cleanup, container } = await renderPlanWizard({ app });
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    const projectCards = [...container.querySelectorAll(".projects-step-category--work .project-row--proposed")];
    const workingReplace = app.replaceNoteContent;
    let releaseWrite = null;
    app.replaceNoteContent = jest.fn((...args) => new Promise(resolve => {
      releaseWrite = async () => resolve(await workingReplace(...args));
    }));

    await act(async () => {
      projectCards[0].querySelector(".project-row-priority-button").dispatchEvent(
        new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await settle();

    expect([...projectCards[0].querySelectorAll(".project-row-priority-button")]
      .every(button => button.disabled)).toBe(true);
    expect([...projectCards[1].querySelectorAll(".project-row-priority-button")]
      .every(button => button.disabled === false)).toBe(true);
    expect(container.querySelector(".plan-wizard-next").disabled).toBe(false);

    await act(async () => { await releaseWrite(); });
    await settle();
    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects.find(prospect => prospect.summary === "Automate the weekly report").priorityEm)
      .toBe("quarterFocus");
    await cleanup();
  });

  it("says why a pass proposed nothing rather than leaving an unexplained empty list", async () => {
    const app = createPlanWizardApp();
    inferenceImplementation = respondToBothPrompts({ proposals: [], workIntent: "Ship the analytics offering" });
    const { cleanup, container } = await renderPlanWizard({ app });
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    expect(container.querySelector(".projects-step-discover").disabled).toBe(false);

    expect(container.querySelector(".projects-step-discovery-notice").textContent)
      .toContain("no candidate the evidence supports");
    expect(container.querySelector(".project-row--proposed")).toBe(null);
    await cleanup();
  });
});

describe("PlanWizard pace cards step", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("asks for a project before offering a pace to protect", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "pace-cards");

    expect(container.querySelector(".pace-cards-list")).toBe(null);
    expect(container.querySelector(".plan-empty").textContent).toContain("Name a project");
    await cleanup();
  });

  it("omits Not now projects from the pace page", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Park this project");
    const notNow = [...container.querySelectorAll(".project-row-priority-button")]
      .find(button => button.textContent === "Not now");
    await clickAndSettle(notNow);
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".pace-cards-list")).toBe(null);
    expect(container.querySelector(".plan-empty").textContent).toContain("Name a project");
    await cleanup();
  });

  it("shows an unvalidated project on pace when fewer than three Focus or Keep warm projects exist", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await typeInto(container.querySelector(".projects-step-category--work .project-row-name"), "Sketch the API");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".project-pace-title").textContent).toBe("Sketch the API");
    await cleanup();
  });

  it("hides unvalidated projects on pace once three Focus or Keep warm projects exist", () => {
    const paceDraft = (priorityEm, summary) => ({ approvalStatusEm: "humanProvided", priorityEm, summary,
      userCategoryEm: "work", uuid: summary });
    const withUnvalidated = [paceDraft("quarterFocus", "Focus one"), paceDraft("stayWarm", "Keep warm"),
      paceDraft(null, "Still unchosen")];
    expect(draftPacesFromProspects(withUnvalidated).map(draft => draft.summary))
      .toEqual(["Focus one", "Keep warm", "Still unchosen"]);
    const withThreeValidated = [...withUnvalidated, paceDraft("quarterFocus", "Focus two")];
    expect(draftPacesFromProspects(withThreeValidated).map(draft => draft.summary))
      .toEqual(["Focus one", "Keep warm", "Focus two"]);
  });

  it("stores the chosen pace, its default days, and preferredDows on the project", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Rebuild the ingestion pipeline");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    await clickAndSettle(paceChoice(container, "Two focused blocks per week"));
    expect(pressedPaceDays(container)).toEqual(["Tue", "Thu"]);
    expect(container.querySelector(".project-pace-days-label").textContent).toBe("Preferred days of week (optional)");
    expect(container.querySelector(".project-pace-hint")).toBe(null);
    await clickAndSettle(container.querySelectorAll(".project-pace-day")[0]);
    expect(pressedPaceDays(container)).toEqual(["Mon", "Tue", "Thu"]);
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0]).toMatchObject({ paceEm: "twoFocusedBlocks", preferredDows: ["monday", "tuesday", "thursday"],
      preferredWeekdays: ["monday", "tuesday", "thursday"] });
    await cleanup();
  });

  it("highlights one day for about one weekly block and none for a sprint or other/TBD until clicked", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Rebuild the ingestion pipeline");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    await clickAndSettle(paceChoice(container, "About one block per week"));
    expect(pressedPaceDays(container)).toEqual(["Wed"]);
    await clickAndSettle(container.querySelectorAll(".project-pace-day")[4]);
    expect(pressedPaceDays(container)).toEqual(["Fri"]);
    await clickAndSettle(paceChoice(container, "Deadline sprint"));
    expect(pressedPaceDays(container)).toEqual([]);
    await clickAndSettle(container.querySelectorAll(".project-pace-day")[1]);
    expect(pressedPaceDays(container)).toEqual(["Tue"]);
    await clickAndSettle(paceChoice(container, "Other / TBD"));
    expect(pressedPaceDays(container)).toEqual([]);
    await clickAndSettle(container.querySelectorAll(".project-pace-day")[4]);
    expect(pressedPaceDays(container)).toEqual(["Fri"]);
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0]).toMatchObject({ paceEm: "maintenanceOnly", preferredDows: ["friday"],
      preferredWeekdays: ["friday"] });
    await cleanup();
  });

  it("opens a deadline field for a sprint and stores the chosen date", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Rebuild the ingestion pipeline");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".project-pace-deadline-input")).toBe(null);
    await clickAndSettle(paceChoice(container, "Deadline sprint"));
    const deadlineField = container.querySelector(".project-pace-deadline-input");
    expect(deadlineField).not.toBe(null);
    await typeInto(deadlineField, "2026-10-15");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.prospects[0]).toMatchObject({ deadlineOn: "2026-10-15", paceEm: "deadlineSprint",
      preferredWeekdays: [] });
    await cleanup();
  });

  it("links to the Vision Guide note when a pace save fails", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Rebuild the ingestion pipeline");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    await clickAndSettle(paceChoice(container, "Two focused blocks per week"));

    const workingReplace = app.replaceNoteContent;
    app.replaceNoteContent = jest.fn(async () => {
      throw new Error("Vision Guide section \"Professional ideas & prospects\" is 288538 characters; the write limit is 200000");
    });
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const error = container.querySelector(".plan-error");
    expect(error.textContent).toContain("write limit is 200000");
    const noteLink = container.querySelector(".plan-error-note-link");
    expect(noteLink.textContent).toBe("Open data note");
    expect(noteLink.getAttribute("href")).toBe(`https://www.amplenote.com/notes/${ app.notes[0].uuid }`);
    await act(async () => { noteLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    await settle();
    expect(app.navigate).toHaveBeenCalledWith(`https://www.amplenote.com/notes/${ app.notes[0].uuid }`);

    app.replaceNoteContent = workingReplace;
    await cleanup();
  });
});

describe("PlanWizard quarter name step", () => {
  beforeEach(() => {
    inferenceCalls.length = 0;
    inferenceImplementation = null;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("drafts three name ideas from Focus projects and lets the user write their own", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Noteapps rebuild");
    await clickAndSettle(container.querySelector(".projects-step-category--work .projects-step-add"));
    const nameFields = [...container.querySelectorAll(".projects-step-category--work .project-row-name")];
    const secondName = nameFields[nameFields.length - 1];
    const secondCard = secondName.closest(".project-row");
    await typeInto(secondName, "ROI metrics API");
    await clickAndSettle(secondCard.querySelector(".project-row-priority-button"));
    await advanceToStep(container, "quarter-name");

    const ideas = [...container.querySelectorAll(".quarter-name-idea")].map(button => button.textContent);
    expect(ideas).toEqual([
      "The Noteapps rebuild quarter",
      "Finish Noteapps rebuild, then ROI metrics API",
      "Fewer open threads by December than October",
    ]);
    expect(container.querySelector(".quarter-name-idea--selected").textContent).toBe("The Noteapps rebuild quarter");
    expect(container.querySelector(".quarter-name-custom-input").getAttribute("placeholder")).toBe("Write my own");
    await cleanup();
  });

  it("places an empty project in the clicked month, pulses it, removes it, and persists its replacement", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Noteapps rebuild");
    await advanceToStep(container, "quarter-name");

    expect(container.querySelector(".quarter-name-window-label").textContent).toBe("Noteapps rebuild");
    expect(container.querySelector(".quarter-name-bar")).toBeNull();
    expect(container.querySelector(".quarter-name-window-remove")).toBeNull();
    const track = container.querySelector(".quarter-name-window-track");
    track.getBoundingClientRect = () => ({ left: 100, width: 900 });
    await dispatchPointer(track, "pointerdown", 550);
    await dispatchPointer(track, "pointerup", 550);

    expect(container.querySelector(".quarter-name-window-start").value).toBe("31");
    expect(container.querySelector(".quarter-name-window-end").value).toBe("60");
    expect(container.querySelector(".quarter-name-bar--pulse")).not.toBeNull();
    await clickAndSettle(container.querySelector(".quarter-name-window-remove"));
    expect(container.querySelector(".quarter-name-bar")).toBeNull();

    await dispatchPointer(track, "pointerdown", 850);
    await dispatchPointer(track, "pointerup", 850);
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.quarterName.text).toBe("The Noteapps rebuild quarter");
    expect(stored.prospects[0].focusMonths).toEqual(["2026-12"]);
    await cleanup();
  });

  it("drags a bar by its middle while preserving its duration and pulses after release", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Noteapps rebuild");
    await advanceToStep(container, "quarter-name");
    const track = container.querySelector(".quarter-name-window-track");
    track.getBoundingClientRect = () => ({ left: 100, width: 900 });
    await dispatchPointer(track, "pointerdown", 250);
    await dispatchPointer(track, "pointerup", 250);
    const originalStart = Number(container.querySelector(".quarter-name-window-start").value);
    const originalEnd = Number(container.querySelector(".quarter-name-window-end").value);

    await dispatchPointer(track, "pointerdown", 250);
    await dispatchPointer(track, "pointermove", 350);
    await dispatchPointer(track, "pointerup", 350);

    const movedStart = Number(container.querySelector(".quarter-name-window-start").value);
    const movedEnd = Number(container.querySelector(".quarter-name-window-end").value);
    expect(movedStart).toBeGreaterThan(originalStart);
    expect(movedEnd - movedStart).toBe(originalEnd - originalStart);
    expect(container.querySelector(".quarter-name-bar--pulse")).not.toBeNull();
    await cleanup();
  });

  it("keeps a sprint deadline on or before the suggested bar and names it in the footnote", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "ROI metrics API");
    await advanceToStep(container, "pace-cards");
    await clickAndSettle(paceChoice(container, "Deadline sprint"));
    await typeInto(container.querySelector(".project-pace-deadline-input"), "2026-10-15");
    await advanceToStep(container, "quarter-name");

    const track = container.querySelector(".quarter-name-window-track");
    track.getBoundingClientRect = () => ({ left: 100, width: 900 });
    await dispatchPointer(track, "pointerdown", 250);
    await dispatchPointer(track, "pointerup", 250);
    const endInput = container.querySelector(".quarter-name-window-end");
    expect(Number(endInput.value)).toBeLessThanOrEqual(14);
    expect(container.querySelector(".quarter-name-deadline-note").textContent)
      .toContain("Deadline Oct 15 sits inside the ROI metrics API bar.");
    await cleanup();
  });

  it("omits Not now projects from the timeline", async () => {
    const { cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "projects");
    await saveFirstProject(container, "Park this project");
    const notNow = [...container.querySelectorAll(".project-row-priority-button")]
      .find(button => button.textContent === "Not now");
    await clickAndSettle(notNow);
    await advanceToStep(container, "quarter-name");

    expect(container.querySelector(".quarter-name-window")).toBeNull();
    expect(container.querySelector(".plan-empty")).not.toBeNull();
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
    await typeInto(container.querySelector(".quarter-name-custom-input"), "A quarter of finishing the directory");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.quarterName.text).toBe("A quarter of finishing the directory");
    await cleanup();

    const reopened = await renderPlanWizard({ app });
    await advanceToStep(reopened.container, "quarter-name");
    expect(reopened.container.querySelector(".quarter-name-custom-input").value).toBe("A quarter of finishing the directory");
    expect(reopened.container.querySelector(".quarter-name-custom--selected")).not.toBeNull();
    await reopened.cleanup();
  });

  it("saves the chosen daily condition and its release activities separately from the quarter's name", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "quarter-name");
    await typeInto(container.querySelector(".quarter-name-custom-input"), "The Shipping Quarter");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    await clickAndSettle(conditionRadio(container, "two-focus-blocks"));
    await clickAndSettle(container.querySelectorAll(".done-enough-release-choice")[0]);
    await clickAndSettle(container.querySelector(".plan-button--primary"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.quarterName.text).toBe("The Shipping Quarter");
    expect(stored.dailySufficiency.text)
      .toBe("Two focused work blocks on quarterly goals — released toward: Walk");
    await cleanup();
  });

  it("restores the chosen condition and activities on reopening, rather than the line of text they saved as", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "enough-for-today");
    await clickAndSettle(conditionRadio(container, "top-three-tasks"));
    await clickAndSettle(container.querySelectorAll(".done-enough-release-choice")[2]);
    await clickAndSettle(container.querySelector(".plan-button--primary"));
    await cleanup();

    const reopened = await renderPlanWizard({ app });
    await advanceToStep(reopened.container, "enough-for-today");
    expect(conditionRadio(reopened.container, "top-three-tasks").checked).toBe(true);
    const pressedActivities = [...reopened.container.querySelectorAll(".done-enough-release-choice")]
      .filter(chip => chip.getAttribute("aria-pressed") === "true");
    expect(pressedActivities.map(chip => chip.textContent)).toEqual(["Read"]);
    await reopened.cleanup();
  });

  it("saves a condition the user writes themselves, and reads it back as the custom choice", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "enough-for-today");
    await clickAndSettle(conditionRadio(container, "custom-condition"));
    await typeInto(container.querySelector(".done-enough-custom-input"), "Inbox empty and one dream task moved");
    await clickAndSettle(container.querySelector(".plan-button--primary"));

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.dailySufficiency.text).toBe("Inbox empty and one dream task moved");
    await cleanup();

    const reopened = await renderPlanWizard({ app });
    await advanceToStep(reopened.container, "enough-for-today");
    expect(conditionRadio(reopened.container, "custom-condition").checked).toBe(true);
    expect(reopened.container.querySelector(".done-enough-custom-input").value)
      .toBe("Inbox empty and one dream task moved");
    await reopened.cleanup();
  });

  it("leaves the daily condition unanswered when the user chooses Not now", async () => {
    const { app, cleanup, container } = await renderPlanWizard();
    await advanceToStep(container, "enough-for-today");
    expect(conditionRadio(container, "not-now").checked).toBe(true);
    expect(container.querySelector(".done-enough-container .plan-button--primary").disabled).toBe(true);
    expect(container.querySelector(".plan-wizard-navigation")).not.toBeNull();

    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.dailySufficiency).toBeNull();
    await cleanup();
  });

  it("keeps the user's text and offers a retry when the write fails", async () => {
    const app = createPlanWizardApp();
    const { cleanup, container } = await renderPlanWizard({ app });
    await advanceToStep(container, "quarter-name");
    app.replaceNoteContent.mockRejectedValueOnce(new Error("Amplenote was unreachable"));
    await typeInto(container.querySelector(".quarter-name-custom-input"), "The Shipping Quarter");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));

    expect(container.querySelector(".plan-error").textContent).toContain("Amplenote was unreachable");
    expect(container.querySelector(".quarter-name-custom-input").value).toBe("The Shipping Quarter");
    expect(container.querySelector(".quarter-name-container")).not.toBeNull();

    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    const stored = await readPlanGoals(app, SCOPE);
    expect(stored.quarterName.text).toBe("The Shipping Quarter");
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

  it("anchors the overlay in the document at the scroll offset the wizard opened at", async () => {
    const scrollOffsetPixels = 480;
    const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "scrollY", { configurable: true, value: scrollOffsetPixels });
    const { cleanup, container } = await renderPlanWizard();
    const overlay = container.querySelector(".plan-wizard-overlay");
    expect(overlay.style.top).toBe(`${ scrollOffsetPixels }px`);
    if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY); else delete window.scrollY;
    await cleanup();
  });

  it("returns the viewport to the top of the dialog when the page changes", async () => {
    const scrollRequests = [];
    Element.prototype.scrollIntoView = function scrollIntoViewStub(options) {
      scrollRequests.push({ element: this, options });
    };
    const { cleanup, container } = await renderPlanWizard();
    scrollRequests.length = 0;
    await typeInto(workFields(container)[0], "Ship the analytics offering");
    await clickAndSettle(container.querySelector(".plan-wizard-next"));
    expect(scrollRequests).toHaveLength(1);
    expect(scrollRequests[0].element).toBe(container.querySelector(".plan-wizard-overlay"));
    expect(scrollRequests[0].options.block).toBe("start");
    delete Element.prototype.scrollIntoView;
    await cleanup();
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

  it("dims the rest of the viewport with a fixed layer below the dialog", async () => {
    const closeCalls = [];
    const { cleanup, container } = await renderPlanWizard({ onClose: () => closeCalls.push("closed") });
    const overlay = container.querySelector(".plan-wizard-overlay");
    const backdrop = overlay.querySelector(".plan-wizard-backdrop");
    expect(backdrop).not.toBeNull();
    await clickAndSettle(backdrop);
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
    const nameField = container.querySelector(".quarter-name-custom-input");
    expect(nameField.tagName).toBe("INPUT");
    expect(nameField.getAttribute("type")).toBe("text");
    await advanceToStep(container, "enough-for-today");
    await clickAndSettle(conditionRadio(container, "custom-condition"));
    const answerField = container.querySelector(".done-enough-custom-input");
    expect(answerField.tagName).toBe("INPUT");
    expect(answerField.getAttribute("type")).toBe("text");
    await cleanup();
  });
});
