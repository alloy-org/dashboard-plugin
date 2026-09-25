// Verify the true/false/null checkbox states that decide which quarterly plans feed task suggestions.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { isQuarterPlanEnabled, persistPromotedQuarterlyPlanToggles, promotedQuarterlyPlanToggles,
  quarterlyPlanTogglesFromSetting, quarterlyPlanTogglesWithState, storedQuarterToggle } from "util/quarterly-plan-toggles";

const Q3_2026 = { quarter: 3, year: 2026 };
const Q4_2026 = { quarter: 4, year: 2026 };

describe("isQuarterPlanEnabled", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc A null state counts for the current quarter and for one starting within 15 days.
  it("defaults to enabled only inside the lead window", () => {
    expect(isQuarterPlanEnabled({ now: new Date(2026, 7, 20), storedState: null, ...Q3_2026 })).toBe(true);
    expect(isQuarterPlanEnabled({ now: new Date(2026, 7, 20), storedState: null, ...Q4_2026 })).toBe(false);
    expect(isQuarterPlanEnabled({ now: new Date(2026, 8, 16), storedState: null, ...Q4_2026 })).toBe(true);
    expect(isQuarterPlanEnabled({ now: new Date(2026, 8, 15), storedState: null, ...Q4_2026 })).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A stored choice overrides the default, except that a past quarter is never used.
  it("honors stored states but never enables a past quarter", () => {
    expect(isQuarterPlanEnabled({ now: new Date(2026, 7, 20), storedState: true, ...Q4_2026 })).toBe(true);
    expect(isQuarterPlanEnabled({ now: new Date(2026, 8, 24), storedState: false, ...Q4_2026 })).toBe(false);
    expect(isQuarterPlanEnabled({ now: new Date(2026, 9, 1), storedState: true, ...Q3_2026 })).toBe(false);
  });
});

describe("promotedQuarterlyPlanToggles", () => {
  const plans = [{ ...Q3_2026, noteUUID: "q3-note" }, { ...Q4_2026, noteUUID: "q4-note" }];

  // ----------------------------------------------------------------------------------------------
  // @desc Inside the lead window, planned quarters with no state become true; an explicit false is kept.
  it("promotes null states with a plan inside the lead window", () => {
    const { changed, toggles } = promotedQuarterlyPlanToggles({ d: { "Q3 2026": false } }, { domainUuid: "d",
      now: new Date(2026, 8, 24), plans });
    expect(changed).toBe(true);
    expect(toggles).toEqual({ d: { "Q3 2026": false, "Q4 2026": true } });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A next-quarter plan written more than 15 days early stays null, and quarters without notes are skipped.
  it("leaves an early upcoming plan and unplanned quarters null", () => {
    const early = promotedQuarterlyPlanToggles({}, { domainUuid: "d", now: new Date(2026, 7, 20), plans });
    expect(early.toggles).toEqual({ d: { "Q3 2026": true } });
    const unplanned = promotedQuarterlyPlanToggles({}, { domainUuid: "d", now: new Date(2026, 8, 24),
      plans: [{ ...Q3_2026, noteUUID: null }, { ...Q4_2026, noteUUID: null }] });
    expect(unplanned).toEqual({ changed: false, toggles: {} });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Entries for quarters that have ended are pruned in every domain.
  it("drops states for ended quarters", () => {
    const { changed, toggles } = promotedQuarterlyPlanToggles({ other: { "Q2 2026": true }, d: { "Q3 2026": true } },
      { domainUuid: "d", now: new Date(2026, 7, 20), plans: [] });
    expect(changed).toBe(true);
    expect(toggles).toEqual({ d: { "Q3 2026": true } });
  });
});

describe("persistPromotedQuarterlyPlanToggles", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc The setting is written only when promotion changed something.
  it("writes the setting only on change", async () => {
    const app = { setSetting: jest.fn().mockResolvedValue(true) };
    const rawSetting = JSON.stringify({ d: { "Q3 2026": true } });
    const unchanged = await persistPromotedQuarterlyPlanToggles(app, { domainUuid: "d", plans: [], rawSetting });
    expect(unchanged).toBe(rawSetting);
    expect(app.setSetting).not.toHaveBeenCalled();
    const current = { label: "unused", noteUUID: "n", quarter: Math.floor(new Date().getMonth() / 3) + 1,
      year: new Date().getFullYear() };
    await persistPromotedQuarterlyPlanToggles(app, { domainUuid: "fresh", plans: [current], rawSetting });
    expect(app.setSetting).toHaveBeenCalledWith(SETTING_KEYS.QUARTERLY_PLAN_TOGGLES, expect.stringContaining("fresh"));
  });
});

describe("toggle storage helpers", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Writes and reads round-trip per domain, with All Notes stored under its own key.
  it("round-trips a user's choice", () => {
    const toggles = quarterlyPlanTogglesWithState({}, { domainUuid: null, enabled: false, ...Q4_2026 });
    expect(toggles).toEqual({ "all-notes": { "Q4 2026": false } });
    expect(storedQuarterToggle(toggles, { domainUuid: null, ...Q4_2026 })).toBe(false);
    expect(storedQuarterToggle(toggles, { domainUuid: null, ...Q3_2026 })).toBeNull();
    expect(quarterlyPlanTogglesFromSetting("not json")).toEqual({});
  });
});
