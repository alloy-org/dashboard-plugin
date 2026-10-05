// Exercise the Name the quarter helpers without rendering: name ideas from Focus projects, deadline-clamped
// default windows, color cycling, and the focusMonths written for a dragged bar.

import { FOCUS_WINDOW_EDGE_HIT_PIXELS, movedWindowDraft, pointerOperationFromPosition,
  projectTooltipHtmlFromDraft, removedWindowDraft,
  windowDraftFromMonthIndex } from "dashboard/plan-wizard/project-focus-window-fields";
import { FOCUS_WINDOW_COLOR_COUNT, clampFocusWindow, deadlineNoteFromDraft, defaultFocusWindow,
  draftWindowsFromProspects, focusMonthsFromWindow, focusWindowColorIndex, nameIdeasFromProspects, prospectRecordsFromWindowDrafts,
  quarterBoundsFromScope, selectedNameFromRecord, updatedWindowDraft, windowDraftsNeedSave } from "dashboard/plan-wizard/quarter-name-step-fields";

const SCOPE = { quarter: 4, year: 2026 };

// ----------------------------------------------------------------------------------------------
// @desc Build a minimal live prospect with a chosen cadence for helper tests.
// @param {object} overrides - Fields to merge onto the default record.
// @returns {object} Prospect-shaped object.
function prospect(overrides = {}) {
  return { approvalStatusEm: "humanProvided", deadlineOn: null, focusMonths: [], paceEm: "twoFocusedBlocks", priorityEm: "quarterFocus",
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
  // ----------------------------------------------------------------------------------------------
  // @desc Only incomplete, live projects with a chosen cadence receive timeline rows, even with stored months.
  test("requires a chosen cadence and excludes completed or declined projects", () => {
    const paces = ["smallMoveMostDays", "twoFocusedBlocks", "oneSubstantialBlock", "deadlineSprint", "maintenanceOnly"];
    const pacedProspects = paces.map(paceEm => prospect({ paceEm, uuid: paceEm }));
    const excludedProspects = [
      prospect({ focusMonths: ["2026-10"], paceEm: null, uuid: "unpaced" }),
      prospect({ paceEm: undefined, uuid: "missing-pace" }),
      prospect({ paceEm: "", uuid: "empty-pace" }),
      prospect({ completedAt: "2026-10-04T12:00:00Z", uuid: "completed" }),
      prospect({ priorityEm: "notNow", uuid: "parked" }),
      prospect({ approvalStatusEm: "humanRejected", uuid: "rejected" }),
      prospect({ approvalStatusEm: "humanRetired", uuid: "removed" }),
    ];
    const drafts = draftWindowsFromProspects([...excludedProspects, ...pacedProspects], SCOPE);
    expect(drafts.map(draft => draft.uuid)).toEqual(paces);
    expect(drafts.map(draft => draft.colorIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(draftWindowsFromProspects(excludedProspects, SCOPE)).toEqual([]);
  });

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

  test("keeps an empty focusMonths list unplaced and instantiates the month the user clicks", () => {
    const bounds = quarterBoundsFromScope(SCOPE);
    const [emptyDraft] = draftWindowsFromProspects([prospect()], SCOPE);
    expect(emptyDraft).toMatchObject({ endOn: null, focusMonths: [], startOn: null });
    const novemberDraft = windowDraftFromMonthIndex(emptyDraft, { ...bounds, monthIndex: 1 });
    expect(novemberDraft).toMatchObject({
      endOn: "2026-11-30", focusMonths: ["2026-11"], startOn: "2026-11-01",
    });
  });

  test("moves a bar without changing its duration, clamps at the quarter edge, and removes it", () => {
    const bounds = quarterBoundsFromScope(SCOPE);
    const [draft] = draftWindowsFromProspects([prospect({ focusMonths: ["2026-11"] })], SCOPE);
    const moved = movedWindowDraft(draft, { ...bounds, dayDelta: 10 });
    expect(moved).toMatchObject({ endOn: "2026-12-10", startOn: "2026-11-11" });
    const clamped = movedWindowDraft(draft, { ...bounds, dayDelta: 100 });
    expect(clamped).toMatchObject({ endOn: "2026-12-31", startOn: "2026-12-02" });
    expect(removedWindowDraft(moved)).toMatchObject({ endOn: null, focusMonths: [], startOn: null });
  });

  test("resizes within 25 pixels of an edge and moves from the bar interior", () => {
    const position = clientX => pointerOperationFromPosition({ clientX,
      edgeHitPixels: FOCUS_WINDOW_EDGE_HIT_PIXELS, endDay: 60, maxDay: 90, startDay: 30,
      trackBounds: { left: 0, width: 900 } });
    expect(position(275)).toBe("resize-start");
    expect(position(325)).toBe("resize-start");
    expect(position(450)).toBe("move");
    expect(position(575)).toBe("resize-end");
    expect(position(625)).toBe("resize-end");
    expect(position(700)).toBeNull();
  });

  test("builds an escaped tooltip from project decisions made on earlier steps", () => {
    const tooltip = projectTooltipHtmlFromDraft({ deadlineOn: "2026-11-14", paceEm: "deadlineSprint",
      preferredWeekdays: ["monday"], priorityEm: "quarterFocus", substantiations: ["Closes <five> tasks"],
      summary: "Ship & learn", userCategoryEm: "work" });
    expect(tooltip).toContain("Ship &amp; learn");
    expect(tooltip).toContain("Focus this quarter");
    expect(tooltip).toContain("Deadline sprint");
    expect(tooltip).toContain("Monday");
    expect(tooltip).toContain("Closes &lt;five&gt; tasks");
  });

  test("omits Not now projects and cycles five distinct bar colors", () => {
    const drafts = draftWindowsFromProspects([
      prospect({ summary: "One", uuid: "1" }),
      prospect({ summary: "Two", uuid: "2" }),
      prospect({ summary: "Three", uuid: "3" }),
      prospect({ summary: "Four", uuid: "4" }),
      prospect({ summary: "Five", uuid: "5" }),
      prospect({ summary: "Six", uuid: "6" }),
      prospect({ priorityEm: "notNow", summary: "Parked", uuid: "parked" }),
    ], SCOPE);
    expect(drafts.map(draft => draft.summary)).toEqual(["One", "Two", "Three", "Four", "Five", "Six"]);
    expect(drafts.map(draft => draft.colorIndex)).toEqual([0, 1, 2, 3, 4, 0]);
    expect(focusWindowColorIndex(FOCUS_WINDOW_COLOR_COUNT)).toBe(0);
  });

  test("keeps a deadline footnote on the bar that contains that date", () => {
    const note = deadlineNoteFromDraft({ deadlineOn: "2026-11-14", endOn: "2026-11-30",
      startOn: "2026-10-15", summary: "ROI metrics API" });
    expect(note).toBe("Deadline Nov 14 sits inside the ROI metrics API bar.");
  });

  test("reports when stored focusMonths already match the draft, so a no-op Next does not rewrite", () => {
    const drafts = draftWindowsFromProspects([prospect({ focusMonths: ["2026-10"], uuid: "1" })], SCOPE);
    expect(windowDraftsNeedSave(drafts, [prospect({ focusMonths: drafts[0].focusMonths, uuid: "1" })], SCOPE)).toBe(false);
    expect(windowDraftsNeedSave(drafts, [prospect({ focusMonths: [], uuid: "1" })], SCOPE)).toBe(true);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A range spanning partial months and edits inside those same months must survive save and restore.
  test("round-trips exact focus dates and detects edits that retain the same month buckets", () => {
    const stored = prospect({ focusEndOn: "2026-11-09", focusMonths: ["2026-10", "2026-11"], focusStartOn: "2026-10-12" });
    const [draft] = draftWindowsFromProspects([stored], SCOPE);
    expect(draft).toMatchObject({ endOn: "2026-11-09", startOn: "2026-10-12" });
    expect(windowDraftsNeedSave([draft], [stored], SCOPE)).toBe(false);
    const resized = updatedWindowDraft(draft, { ...quarterBoundsFromScope(SCOPE), endDay: 46, startDay: 18 });
    expect(resized.focusMonths).toEqual(stored.focusMonths);
    expect(windowDraftsNeedSave([resized], [stored], SCOPE)).toBe(true);
    const [record] = prospectRecordsFromWindowDrafts([resized], "2026-10-04T12:00:00Z");
    expect(record).toMatchObject({ focusEndOn: "2026-11-16", focusStartOn: "2026-10-19" });
    const [restored] = draftWindowsFromProspects([{ ...stored, ...record }], SCOPE);
    expect(restored).toMatchObject({ endOn: resized.endOn, startOn: resized.startOn });
    expect(windowDraftsNeedSave([restored], [{ ...stored, ...record }], SCOPE)).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Clearing a persisted range clears both date fields and the compatibility month buckets.
  test("saves range removal without resurrecting the old dates", () => {
    const stored = prospect({ focusEndOn: "2026-11-09", focusMonths: ["2026-10", "2026-11"], focusStartOn: "2026-10-12" });
    const [draft] = draftWindowsFromProspects([stored], SCOPE);
    const removed = removedWindowDraft(draft);
    expect(windowDraftsNeedSave([removed], [stored], SCOPE)).toBe(true);
    const [record] = prospectRecordsFromWindowDrafts([removed], "2026-10-04T12:00:00Z");
    expect(record).toMatchObject({ focusEndOn: null, focusMonths: [], focusStartOn: null });
    expect(draftWindowsFromProspects([{ ...stored, ...record }], SCOPE)[0]).toMatchObject({ endOn: null, startOn: null });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Restored date ranges still respect the quarter bounds and any sprint deadline changed on the pace page.
  test("clamps stored dates to the quarter and sprint deadline", () => {
    const stored = prospect({ deadlineOn: "2026-11-10", focusEndOn: "2027-01-04", focusStartOn: "2026-09-28" });
    expect(draftWindowsFromProspects([stored], SCOPE)[0]).toMatchObject({ endOn: "2026-11-10", startOn: "2026-10-01" });
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
