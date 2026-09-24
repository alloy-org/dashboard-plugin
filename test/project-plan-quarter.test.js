// Verify which quarter's plan seeds agenda suggestions in the days before a new quarter begins.
import { jest } from "@jest/globals";
import { resolveProjectPlanQuarter } from "project-plan-quarter";

const builderPlan = "# Projects\n\n## Launch Q4 dashboard [builder]\n- Outcome: Ship it\n";
const handwrittenPlan = "# Projects\n\n## Good alternative pages\n- Outcome: Publish comparisons\n";

// ----------------------------------------------------------------------------------------------
// @desc Build an app bridge holding one plan note per quarter label, with no vision guide notes.
// @param {object} contentByLabel - Plan markdown keyed by quarter label, e.g. { "Q3 2026": "..." }.
// @returns {object} Minimal app mock for resolveQuarterlyPlanNote, getNoteContent, and readVisionGuide.
function appWithPlans(contentByLabel) {
  const notes = Object.keys(contentByLabel).map(label => ({ name: `${ label } Work Plan`, uuid: `uuid-${ label }` }));
  return {
    filterNotes: jest.fn(async ({ query }) => notes.filter(note => note.name === query)),
    findNote: jest.fn().mockResolvedValue(null),
    getNoteContent: jest.fn(async ({ uuid }) => contentByLabel[uuid.replace("uuid-", "")] ?? ""),
  };
}

describe("resolveProjectPlanQuarter", () => {
  const options = { allowLegacyMigration: false, domainName: "Work", domainUuid: "work-domain" };

  // ----------------------------------------------------------------------------------------------
  // @desc A week before Q4, a Plan Builder plan that exists only for Q4 becomes the canonical source.
  it("uses the upcoming quarter when only it has Plan Builder projects", async () => {
    const app = appWithPlans({ "Q3 2026": handwrittenPlan, "Q4 2026": builderPlan });
    const result = await resolveProjectPlanQuarter(app, { ...options, targetDate: new Date(2026, 8, 24) });
    expect(result).toMatchObject({ planContent: builderPlan, quarter: 4, year: 2026 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc When both quarters carry Plan Builder projects, the target day's own quarter still applies.
  it("keeps the current quarter when both quarters have Plan Builder projects", async () => {
    const app = appWithPlans({ "Q3 2026": builderPlan, "Q4 2026": builderPlan });
    const result = await resolveProjectPlanQuarter(app, { ...options, targetDate: new Date(2026, 8, 24) });
    expect(result).toMatchObject({ quarter: 3, year: 2026 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Outside the lead window the upcoming plan is not consulted at all.
  it("keeps the current quarter well before the quarter ends", async () => {
    const app = appWithPlans({ "Q3 2026": handwrittenPlan, "Q4 2026": builderPlan });
    const result = await resolveProjectPlanQuarter(app, { ...options, targetDate: new Date(2026, 7, 20) });
    expect(result).toMatchObject({ planContent: handwrittenPlan, quarter: 3, year: 2026 });
    expect(app.filterNotes.mock.calls.some(([query]) => query.query.startsWith("Q4"))).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The quarter after Q4 is Q1 of the following year.
  it("rolls over to the next year at the end of Q4", async () => {
    const app = appWithPlans({ "Q1 2027": builderPlan, "Q4 2026": handwrittenPlan });
    const result = await resolveProjectPlanQuarter(app, { ...options, targetDate: new Date(2026, 11, 28) });
    expect(result).toMatchObject({ quarter: 1, year: 2027 });
  });
});
