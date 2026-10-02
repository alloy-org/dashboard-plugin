// The Quarterly Planning pager moves one quarter at a time and rolls across the year boundary.
import { quarterPageWindow, quarterPlanForPage, quarterShiftedBy } from "dashboard/quarter-page";

const currentPlan = { domainName: "Work", hasAllMonthlyDetails: false, label: "Q4 2026", noteUUID: "q4-note", quarter: 4,
  year: 2026 };
const nextPlan = { domainName: "Work", hasAllMonthlyDetails: false, label: "Q1 2027", noteUUID: null, quarter: 1, year: 2027 };

describe("quarterShiftedBy", () => {
  it("steps backward and forward across the new year", () => {
    expect(quarterShiftedBy({ quarter: 4, year: 2026 }, -1).label).toBe("Q3 2026");
    expect(quarterShiftedBy({ quarter: 4, year: 2026 }, 2).label).toBe("Q2 2027");
    expect(quarterShiftedBy({ quarter: 1, year: 2026 }, -1)).toEqual({ label: "Q4 2025", quarter: 4, year: 2025 });
  });
});

describe("quarterPageWindow", () => {
  it("shows the current quarter beside the next one, with the adjacent quarters on the buttons", () => {
    const page = quarterPageWindow({ anchorQuarter: 4, anchorYear: 2026, pageOffset: 0 });
    expect(page.earlier.label).toBe("Q4 2026");
    expect(page.later.label).toBe("Q1 2027");
    expect(page.previous.label).toBe("Q3 2026");
    expect(page.following.label).toBe("Q2 2027");
  });

  it("lands on Q2 and Q3 after two steps back from Q4", () => {
    const page = quarterPageWindow({ anchorQuarter: 4, anchorYear: 2026, pageOffset: -2 });
    expect(page.earlier.label).toBe("Q2 2026");
    expect(page.later.label).toBe("Q3 2026");
    expect(page.previous.label).toBe("Q1 2026");
    expect(page.following.label).toBe("Q4 2026");
  });
});

describe("quarterPlanForPage", () => {
  it("keeps the dashboard's loaded plan when that quarter is still on screen", () => {
    const quarter = { label: "Q4 2026", quarter: 4, year: 2026 };
    const plan = quarterPlanForPage({ currentPlan, domainName: "Work", nextPlan, pagedPlans: null, pageOffset: -1, quarter });
    expect(plan.noteUUID).toBe("q4-note");
  });

  it("holds a placeholder until a quarter the dashboard did not load has been fetched", () => {
    const quarter = { label: "Q2 2026", quarter: 2, year: 2026 };
    const plan = quarterPlanForPage({ currentPlan, domainName: "Work", nextPlan, pagedPlans: null, pageOffset: -2, quarter });
    expect(plan.pending).toBe(true);
    expect(plan.noteUUID).toBeNull();
  });
});
