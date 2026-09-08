// Exercise the Name the quarter helpers without rendering: name ideas from Focus projects, deadline-clamped
// default windows, color cycling, and the focusMonths written for a dragged bar.

import { FOCUS_WINDOW_COLOR_COUNT, clampFocusWindow, deadlineNoteFromDraft, defaultFocusWindow,
  draftWindowsFromProspects, focusMonthsFromWindow, focusWindowColorIndex, nameIdeasFromProspects,
  quarterBoundsFromScope, selectedNameFromRecord, windowDraftsNeedSave } from "dashboard/plan-wizard/quarter-name-step-fields";

const SCOPE = { quarter: 4, year: 2026 };

// ----------------------------------------------------------------------------------------------
// @desc Build a minimal live prospect for helper tests.
// @param {object} overrides - Fields to merge onto the default record.
// @returns {object} Prospect-shaped object.
function prospect(overrides = {}) {
  return { approvalStatusEm: "humanProvided", deadlineOn: null, focusMonths: [], priorityEm: "quarterFocus",
    substantiation: "Named while planning", summary: "Noteapps rebuild", userCategoryEm: "work", uuid: "prospect-1",
    ...overrides };
}

describe("nameIdeasFromProspects", () => {
  test("drafts three ideas from Focus projects, ignoring Keep warm for the titles", () => {
    const ideas = nameIdeasFromProspects([
      prospect({ summary: "Noteapps rebuild", uuid: "a" }),
      prospect({ priorityEm: "stayWarm", summary: "Calendar suggestions", uuid: "b" }),
      prospect({ summary: "ROI metrics API", uuid: "c" }),
    ], SCOPE);
    expect(ideas).toEqual([
      "The Noteapps rebuild quarter",
      "Finish Noteapps rebuild, then ROI metrics API",
      "Fewer open threads by December than October",
    ]);
  });

  test("falls back to static names when no live project has been chosen", () => {
    const ideas = nameIdeasFromProspects([prospect({ priorityEm: "notNow", summary: "Parked work" })], SCOPE);
    expect(ideas).toHaveLength(3);
    expect(ideas[0]).toBe("Fewer open threads by December than October");
    expect(ideas).toContain("The Shipping Quarter");
  });
});

describe("focus windows", () => {
  test("clamps a suggested window so it ends on or before a sprint deadline", () => {
    const { quarterEndOn, quarterStartOn } = quarterBoundsFromScope(SCOPE);
    const window = defaultFocusWindow({ deadlineOn: "2026-10-15", index: 0, quarterEndOn, quarterStartOn, totalCount: 1 });
    expect(window.startOn >= quarterStartOn).toBe(true);
    expect(window.endOn <= "2026-10-15").toBe(true);
    expect(window.endOn < "2026-10-16").toBe(true);
  });

  test("turns a calendar window into the quarter months it occupies", () => {
    const { quarterMonths } = quarterBoundsFromScope(SCOPE);
    expect(focusMonthsFromWindow({ endOn: "2026-11-14", quarterMonths, startOn: "2026-10-01" }))
      .toEqual(["2026-10", "2026-11"]);
  });

  test("omits Not now projects from the timeline and cycles bar colors past the third row", () => {
    const drafts = draftWindowsFromProspects([
      prospect({ summary: "One", uuid: "1" }),
      prospect({ summary: "Two", uuid: "2" }),
      prospect({ summary: "Three", uuid: "3" }),
      prospect({ summary: "Four", uuid: "4" }),
      prospect({ priorityEm: "notNow", summary: "Parked", uuid: "parked" }),
    ], SCOPE);
    expect(drafts.map(draft => draft.summary)).toEqual(["One", "Two", "Three", "Four"]);
    expect(drafts.map(draft => draft.colorIndex)).toEqual([0, 1, 2, 0]);
    expect(focusWindowColorIndex(FOCUS_WINDOW_COLOR_COUNT)).toBe(0);
  });

  test("keeps a deadline footnote on the bar that contains that date", () => {
    const note = deadlineNoteFromDraft({ deadlineOn: "2026-11-14", endOn: "2026-11-30",
      startOn: "2026-10-15", summary: "ROI metrics API" });
    expect(note).toBe("Deadline Nov 14 sits inside the ROI metrics API bar.");
  });

  test("reports when stored focusMonths already match the draft, so a no-op Next does not rewrite", () => {
    const drafts = draftWindowsFromProspects([prospect({ focusMonths: ["2026-10"], uuid: "1" })], SCOPE);
    expect(windowDraftsNeedSave(drafts, [prospect({ focusMonths: drafts[0].focusMonths, uuid: "1" })])).toBe(false);
    expect(windowDraftsNeedSave(drafts, [prospect({ focusMonths: [], uuid: "1" })])).toBe(true);
  });

  test("selects Write my own when the stored name is not one of the drafted chips", () => {
    expect(selectedNameFromRecord("The Shipping Quarter", ["The Noteapps rebuild quarter"])).toBe("custom");
    expect(selectedNameFromRecord("", ["The Noteapps rebuild quarter"])).toBe("The Noteapps rebuild quarter");
  });

  test("does not let a dragged window end after the deadline", () => {
    const clamped = clampFocusWindow({ deadlineOn: "2026-11-14", endOn: "2026-12-31", quarterEndOn: "2026-12-31",
      quarterStartOn: "2026-10-01", startOn: "2026-10-01" });
    expect(clamped.endOn).toBe("2026-11-14");
  });
});
