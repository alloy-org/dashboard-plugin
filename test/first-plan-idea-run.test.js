// Exercise the record of which quarters' first Plan Builder Done already started a "Generate ideas" run.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { firstPlanIdeaRunKey, firstPlanIdeaRunKeys, hasStartedFirstPlanIdeaRun,
  recordFirstPlanIdeaRun } from "dashboard/idea-generation/first-plan-idea-run";
import { setPluginData } from "plugin-data";

const QUARTER_SCOPE = { domainUuid: "domain-1", quarter: 4, year: 2026 };

describe("first plan idea run", () => {
  beforeEach(() => setPluginData({ settings: {} }));

  // ----------------------------------------------------------------------------------------------
  // @desc Each domain's quarter has its own key, and All Notes is named when no domain is given.
  it("keys a quarter by year, quarter, and domain", () => {
    expect(firstPlanIdeaRunKey(QUARTER_SCOPE)).toBe("2026-Q4:domain-1");
    expect(firstPlanIdeaRunKey({ quarter: 1, year: 2027 })).toBe("2027-Q1:all");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Unreadable settings remember no quarters, and stray entries are dropped.
  it("reads the stored keys", () => {
    expect(firstPlanIdeaRunKeys("not json")).toEqual([]);
    expect(firstPlanIdeaRunKeys(JSON.stringify(["2026-Q4:all", 7]))).toEqual(["2026-Q4:all"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Recording a quarter saves it once and makes later checks for it, and only it, true.
  it("remembers a quarter once its first run is recorded", async () => {
    const app = { setSetting: jest.fn(async () => {}) };
    expect(hasStartedFirstPlanIdeaRun(QUARTER_SCOPE)).toBe(false);
    await recordFirstPlanIdeaRun(app, QUARTER_SCOPE);
    await recordFirstPlanIdeaRun(app, QUARTER_SCOPE);
    expect(app.setSetting).toHaveBeenCalledTimes(1);
    expect(app.setSetting).toHaveBeenCalledWith(SETTING_KEYS.FIRST_PLAN_IDEA_RUNS, JSON.stringify(["2026-Q4:domain-1"]));
    expect(hasStartedFirstPlanIdeaRun(QUARTER_SCOPE)).toBe(true);
    expect(hasStartedFirstPlanIdeaRun({ ...QUARTER_SCOPE, domainUuid: null })).toBe(false);
  });
});
