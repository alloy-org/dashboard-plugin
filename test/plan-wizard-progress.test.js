// Exercise the progress sidebar's summary rules without rendering: what each step reports from stored state,
// which steps count as complete, and when the rail has earned its place beside the questions.

import { hasCompletedPlanCore, progressRowsFromContext } from "dashboard/plan-wizard/wizard-progress-fields";
import { WIZARD_STEPS } from "dashboard/plan-wizard/wizard-steps";

// ----------------------------------------------------------------------------------------------
// @desc Build a minimal live project for summary tests.
// @param {object} overrides - Fields to merge onto the default record.
// @returns {object} Prospect-shaped object.
function prospect(overrides = {}) {
  return { approvalStatusEm: "humanProvided", paceEm: null, priorityEm: "quarterFocus",
    substantiation: "Named while planning", summary: "Noteapps rebuild", userCategoryEm: "work", uuid: "prospect-1",
    ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a planning context carrying only the fields the sidebar reads.
// @param {object} overrides - Fields to merge onto an empty context.
// @returns {object} Context-shaped object.
function context(overrides = {}) {
  return { dailySufficiency: null, goals: [], prospects: [], quarterName: null, ...overrides };
}

// ----------------------------------------------------------------------------------------------
// @desc Read one step's row out of a built rail.
// @param {object} planningContext - Context to build rows from.
// @param {string} stepKey - Step whose row is wanted.
// @returns {object} The matching progress row.
function rowFor(planningContext, stepKey) {
  const rows = progressRowsFromContext({ currentStepKey: "intent", planningContext, wizardSteps: WIZARD_STEPS });
  return rows.find(row => row.key === stepKey);
}

describe("intent summary", () => {
  test("counts saved goals by category and names personal only when one exists", () => {
    const workOnly = rowFor(context({ goals: [{ goalText: "Grow revenue", userCategoryEm: "work" },
      { goalText: "Ship Diff Digest", userCategoryEm: "work" }] }), "intent");
    expect(workOnly.summary).toBe("2 professional");

    const bothCategories = rowFor(context({ goals: [{ goalText: "Grow revenue", userCategoryEm: "work" },
      { goalText: "Get outdoors", userCategoryEm: "personal" }] }), "intent");
    expect(bothCategories.summary).toBe("1 professional · 1 personal");
  });

  test("ignores blank goal text, so an untouched field is not counted as an answer", () => {
    const row = rowFor(context({ goals: [{ goalText: "   ", userCategoryEm: "work" }] }), "intent");
    expect(row.summary).toBeNull();
    expect(row.isComplete).toBe(false);
  });
});

describe("project summaries", () => {
  test("counts only the projects the user kept, excluding declined ones", () => {
    const planningContext = context({ prospects: [prospect({ uuid: "a" }), prospect({ priorityEm: "notNow", uuid: "b" }),
      prospect({ approvalStatusEm: "humanRejected", uuid: "c" }), prospect({ priorityEm: "stayWarm", uuid: "d" })] });
    expect(rowFor(planningContext, "projects").summary).toBe("2 projects");
  });

  test("uses the singular for one project", () => {
    expect(rowFor(context({ prospects: [prospect()] }), "projects").summary).toBe("1 project");
  });

  test("groups paces by rhythm and leaves unpaced projects out", () => {
    const planningContext = context({ prospects: [prospect({ paceEm: "twoFocusedBlocks", uuid: "a" }),
      prospect({ paceEm: "twoFocusedBlocks", uuid: "b" }), prospect({ paceEm: "deadlineSprint", uuid: "c" }),
      prospect({ uuid: "d" })] });
    expect(rowFor(planningContext, "pace-cards").summary).toBe("2 two focused blocks per week · 1 deadline sprint");
  });

  test("reports no pace before any rhythm is chosen", () => {
    expect(rowFor(context({ prospects: [prospect()] }), "pace-cards").summary).toBeNull();
  });
});

describe("quarter name and done enough", () => {
  test("quotes the stored quarter name", () => {
    const row = rowFor(context({ quarterName: { text: "Ship and validate" } }), "quarter-name");
    expect(row.summary).toBe("“Ship and validate”");
  });

  test("treats the optional final step as incomplete until it is actually answered", () => {
    const unanswered = rowFor(context(), "enough-for-today");
    expect(unanswered.summary).toBe("Optional");
    expect(unanswered.isComplete).toBe(false);

    const answered = rowFor(context({ dailySufficiency: { text: "My top three planned tasks" } }), "enough-for-today");
    expect(answered.summary).toBe("Daily bar set");
    expect(answered.isComplete).toBe(true);
  });
});

describe("rail visibility and position", () => {
  // The rail is offered once the four required steps are stored, whether or not the optional final page was
  // answered, since that page is not a precondition for reviewing the plan.
  test("appears only when every required step has stored progress", () => {
    const partialContext = context({ goals: [{ goalText: "Grow revenue", userCategoryEm: "work" }],
      prospects: [prospect({ paceEm: "twoFocusedBlocks" })] });
    const partialRows = progressRowsFromContext({ currentStepKey: "intent", planningContext: partialContext,
      wizardSteps: WIZARD_STEPS });
    expect(hasCompletedPlanCore(partialRows)).toBe(false);

    const completeContext = context({ goals: [{ goalText: "Grow revenue", userCategoryEm: "work" }],
      prospects: [prospect({ paceEm: "twoFocusedBlocks" })], quarterName: { text: "Ship and validate" } });
    const completeRows = progressRowsFromContext({ currentStepKey: "intent", planningContext: completeContext,
      wizardSteps: WIZARD_STEPS });
    expect(hasCompletedPlanCore(completeRows)).toBe(true);
  });

  test("marks the step being shown as current, and only that one", () => {
    const rows = progressRowsFromContext({ currentStepKey: "pace-cards", planningContext: context(),
      wizardSteps: WIZARD_STEPS });
    const currentRows = rows.filter(row => row.isCurrent);
    expect(currentRows.map(row => row.key)).toEqual(["pace-cards"]);
  });

  test("labels every step in the wizard's own order", () => {
    const rows = progressRowsFromContext({ currentStepKey: "intent", planningContext: context(),
      wizardSteps: WIZARD_STEPS });
    expect(rows.map(row => row.label)).toEqual(["High-level intent", "Project list", "Project cadence",
      "Quarter name", "Define “done enough”"]);
  });
});
