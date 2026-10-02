// Saved Plan Builder answers count as a begun quarter even when no plan note exists yet.
import { planAnswersHaveBegun } from "plan-wizard/plan-begun";

const emptyContext = { dailySufficiency: null, goals: [], prospects: [], quarterName: null };

describe("planAnswersHaveBegun", () => {
  it("is false before the user has saved anything", () => {
    expect(planAnswersHaveBegun(null)).toBe(false);
    expect(planAnswersHaveBegun(emptyContext)).toBe(false);
    expect(planAnswersHaveBegun({ ...emptyContext, goals: [{ goalText: "  " }] })).toBe(false);
  });

  it("is true once a goal, a quarter name, a daily bar, or a kept project is saved", () => {
    expect(planAnswersHaveBegun({ ...emptyContext, goals: [{ goalText: "Ship the pager" }] })).toBe(true);
    expect(planAnswersHaveBegun({ ...emptyContext,
      quarterName: { text: "The shipping quarter" } })).toBe(true);
    expect(planAnswersHaveBegun({ ...emptyContext,
      dailySufficiency: { text: "One deep block" } })).toBe(true);
    expect(planAnswersHaveBegun({ ...emptyContext, prospects: [{ approvalStatusEm: "awaitingJudgement",
      priorityEm: "quarterFocus", summary: "Quarter pager" }] })).toBe(true);
  });

  it("ignores projects the user declined", () => {
    expect(planAnswersHaveBegun({ ...emptyContext, prospects: [{ approvalStatusEm: "humanRejected",
      summary: "Old idea" }] })).toBe(false);
    expect(planAnswersHaveBegun({ ...emptyContext, prospects: [{ approvalStatusEm: "humanAffirmed",
      priorityEm: "notNow", summary: "Later" }] })).toBe(false);
  });
});
