// The header action and the current-quarter card choose a quarter from the calendar, not from which plan
// already exists. These cases pin the 15-day boundary, including the year rollover.

import { buildPlanTargetFromPlans, currentQuarterCardAction, daysUntilNextQuarter,
  isWithinUpcomingQuarterLead } from "dashboard/build-plan-quarter";

const currentPlan = { domainName: "Work", label: "Q3 2026", noteUUID: null, quarter: 3, year: 2026 };
const nextPlan = { domainName: "Work", label: "Q4 2026", noteUUID: null, quarter: 4, year: 2026 };
const quarterlyPlans = { current: currentPlan, next: nextPlan };

// ----------------------------------------------------------------------------------------------
// @desc A local date, so the quarter boundary is the one the dashboard clock uses.
// @param {number} monthIndex - 0-based month.
// @param {number} day - Day of the month.
// @param {number} [year] - Calendar year.
// @returns {Date} Local midnight on that day.
function onDay(monthIndex, day, year = 2026) {
  return new Date(year, monthIndex, day);
}

describe("daysUntilNextQuarter", () => {
  it("counts the day a quarter starts as 15 days out on the 16th of the month before", () => {
    expect(daysUntilNextQuarter(onDay(8, 16))).toBe(15);
    expect(daysUntilNextQuarter(onDay(8, 15))).toBe(16);
    expect(daysUntilNextQuarter(onDay(8, 21))).toBe(10);
  });

  it("rolls the count across the new year", () => {
    expect(daysUntilNextQuarter(onDay(11, 17))).toBe(15);
    expect(daysUntilNextQuarter(onDay(11, 16))).toBe(16);
  });

  it("measures the following quarter once the new one has started", () => {
    expect(daysUntilNextQuarter(onDay(9, 1))).toBeGreaterThan(15);
    expect(isWithinUpcomingQuarterLead({ now: onDay(8, 16) })).toBe(true);
    expect(isWithinUpcomingQuarterLead({ now: onDay(8, 15) })).toBe(false);
  });
});

describe("buildPlanTargetFromPlans", () => {
  it("opens the current quarter until the upcoming one is 15 days away", () => {
    const target = buildPlanTargetFromPlans({ now: onDay(8, 15), quarterlyPlans });
    expect(target.quarter).toBe(3);
  });

  it("opens the upcoming quarter on the day the lead window starts, and inside it", () => {
    expect(buildPlanTargetFromPlans({ now: onDay(8, 16), quarterlyPlans }).quarter).toBe(4);
    expect(buildPlanTargetFromPlans({ now: onDay(8, 21), quarterlyPlans }).label).toBe("Q4 2026");
  });
});

describe("currentQuarterCardAction", () => {
  it("copies an existing upcoming plan when the current quarter has none inside the lead window", () => {
    const plannedNext = { ...nextPlan, noteUUID: "next-note" };
    const action = currentQuarterCardAction({ now: onDay(8, 21), plan: currentPlan,
      quarterlyPlans: { current: currentPlan, next: plannedNext } });
    expect(action.kind).toBe("mirror-existing");
    expect(action.sourcePlan.noteUUID).toBe("next-note");
    expect(action.mirrorTarget).toBe(currentPlan);
  });

  it("opens the upcoming wizard, remembering to copy it back, when neither quarter has a plan", () => {
    const action = currentQuarterCardAction({ now: onDay(8, 16), plan: currentPlan, quarterlyPlans });
    expect(action.kind).toBe("open-wizard");
    expect(action.quarterPlan.quarter).toBe(4);
    expect(action.mirrorTarget).toBe(currentPlan);
  });

  it("opens the current quarter outside the lead window even when the upcoming plan already exists", () => {
    const plannedNext = { ...nextPlan, noteUUID: "next-note" };
    const action = currentQuarterCardAction({ now: onDay(8, 1), plan: currentPlan,
      quarterlyPlans: { current: currentPlan, next: plannedNext } });
    expect(action).toMatchObject({ kind: "open-wizard", mirrorTarget: null, quarterPlan: currentPlan });
  });

  it("opens whichever card was clicked once that quarter already has a plan", () => {
    const plannedCurrent = { ...currentPlan, noteUUID: "current-note" };
    const currentAction = currentQuarterCardAction({ now: onDay(8, 21), plan: plannedCurrent,
      quarterlyPlans: { current: plannedCurrent, next: nextPlan } });
    const nextAction = currentQuarterCardAction({ now: onDay(8, 21), plan: nextPlan,
      quarterlyPlans: { current: currentPlan, next: nextPlan } });
    expect(currentAction).toMatchObject({ kind: "open-wizard", mirrorTarget: null, quarterPlan: plannedCurrent });
    expect(nextAction).toMatchObject({ kind: "open-wizard", mirrorTarget: null, quarterPlan: nextPlan });
  });
});
