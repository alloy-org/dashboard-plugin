// Verify which quarters' plans seed task suggestions, as decided by the Quarterly Planning checkboxes.
import { jest } from "@jest/globals";
import { combinedQuarterlyContent, loadEnabledQuarterlyPlans } from "project-plan-quarter";

const currentPlan = "# Projects\n\n## Good alternative pages\n- Outcome: Publish comparisons\n";
const upcomingPlan = "# Projects\n\n## Launch Q4 dashboard [builder]\n- Outcome: Ship it\n";

// ----------------------------------------------------------------------------------------------
// @desc Build an app bridge holding one plan note per quarter label.
// @param {object} contentByLabel - Plan markdown keyed by quarter label, e.g. { "Q3 2026": "..." }.
// @returns {object} Minimal app mock for resolveQuarterlyPlanNote and getNoteContent.
function appWithPlans(contentByLabel) {
  const notes = Object.keys(contentByLabel).map(label => ({ name: `${ label } Work Plan`, uuid: `uuid-${ label }` }));
  return {
    filterNotes: jest.fn(async ({ query }) => notes.filter(note => note.name === query)),
    findNote: jest.fn().mockResolvedValue(null),
    getNoteContent: jest.fn(async ({ uuid }) => contentByLabel[uuid.replace("uuid-", "")] ?? ""),
  };
}

describe("loadEnabledQuarterlyPlans", () => {
  const options = { allowLegacyMigration: false, domainName: "Work", domainUuid: "work-domain" };
  const bothPlans = { "Q3 2026": currentPlan, "Q4 2026": upcomingPlan };

  // ----------------------------------------------------------------------------------------------
  // @desc With no stored states, the upcoming quarter joins once it starts within 15 days.
  it("uses both quarters inside the lead window when neither was toggled", async () => {
    const result = await loadEnabledQuarterlyPlans(appWithPlans(bothPlans), { ...options, targetDate: new Date(2026, 8, 24),
      toggles: {} });
    expect(result.map(plan => plan.label)).toEqual(["Q3 2026", "Q4 2026"]);
    expect(result[1]).toMatchObject({ planContent: upcomingPlan, quarter: 4, year: 2026 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Well before the quarter ends, an untoggled upcoming plan is not consulted.
  it("leaves out an untoggled upcoming quarter outside the lead window", async () => {
    const app = appWithPlans(bothPlans);
    const result = await loadEnabledQuarterlyPlans(app, { ...options, targetDate: new Date(2026, 7, 20), toggles: {} });
    expect(result.map(plan => plan.label)).toEqual(["Q3 2026"]);
    expect(app.filterNotes.mock.calls.some(([query]) => query.query.startsWith("Q4"))).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A checked upcoming quarter counts even when it is months away.
  it("uses a checked upcoming quarter outside the lead window", async () => {
    const toggles = { "work-domain": { "Q4 2026": true } };
    const result = await loadEnabledQuarterlyPlans(appWithPlans(bothPlans), { ...options, targetDate: new Date(2026, 7, 20),
      toggles });
    expect(result.map(plan => plan.label)).toEqual(["Q3 2026", "Q4 2026"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Unchecking the current quarter removes it, leaving only the upcoming one.
  it("drops an unchecked current quarter", async () => {
    const toggles = { "work-domain": { "Q3 2026": false } };
    const result = await loadEnabledQuarterlyPlans(appWithPlans(bothPlans), { ...options, targetDate: new Date(2026, 8, 24),
      toggles });
    expect(result.map(plan => plan.label)).toEqual(["Q4 2026"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Stored states belong to one Task Domain and do not leak into another.
  it("reads toggles for the active Task Domain only", async () => {
    const toggles = { "other-domain": { "Q3 2026": false } };
    const result = await loadEnabledQuarterlyPlans(appWithPlans(bothPlans), { ...options, targetDate: new Date(2026, 7, 20),
      toggles });
    expect(result.map(plan => plan.label)).toEqual(["Q3 2026"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The quarter after Q4 is Q1 of the following year.
  it("rolls over to the next year at the end of Q4", async () => {
    const app = appWithPlans({ "Q1 2027": upcomingPlan, "Q4 2026": currentPlan });
    const result = await loadEnabledQuarterlyPlans(app, { ...options, targetDate: new Date(2026, 11, 28), toggles: {} });
    expect(result.map(plan => plan.label)).toEqual(["Q4 2026", "Q1 2027"]);
  });
});

describe("combinedQuarterlyContent", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc One plan passes through untouched; several are labeled by quarter.
  it("labels plans only when more than one has content", () => {
    expect(combinedQuarterlyContent([{ content: "A", label: "Q3 2026" }, { content: null, label: "Q4 2026" }])).toBe("A");
    expect(combinedQuarterlyContent([{ content: "A", label: "Q3 2026" }, { content: "B", label: "Q4 2026" }]))
      .toBe("### Plan for Q3 2026\nA\n\n### Plan for Q4 2026\nB");
    expect(combinedQuarterlyContent([])).toBeNull();
  });
});
