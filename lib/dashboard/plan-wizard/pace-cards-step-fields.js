// Translate between the pace page's per-project drafts and the ActionProspect fields it writes: which rhythm the
// user chose, which weekdays that rhythm occupies, and the deadline a sprint has to land on.

import { WEEKDAYS, isDeclinedActionProspect, isValidatedActionProspect } from "plan-wizard/plan-models";

export const MINIMUM_VALIDATED_PACE_PROSPECTS = 3;
export const PACE_CARDS_STEP_FORM_ID = "plan-wizard-pace-cards-form";
export const PACE_WORKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
export const PACE_OPTIONS = [
  { defaultWeekdays: PACE_WORKDAYS, label: "A small move most days", value: "smallMoveMostDays" },
  { defaultWeekdays: ["tuesday", "thursday"], label: "Two focused blocks per week", value: "twoFocusedBlocks" },
  { defaultWeekdays: ["wednesday"], label: "About one block per week", value: "oneSubstantialBlock" },
  { defaultWeekdays: [], label: "Deadline sprint", value: "deadlineSprint" },
  { defaultWeekdays: [], label: "Other / TBD", value: "maintenanceOnly" },
];

// ----------------------------------------------------------------------------------------------
// @desc Return the weekdays a newly chosen pace starts highlighted: two mid-week days for focused blocks, one
//   mid-week day for about one weekly block, every workday for a small daily move, and none for a sprint or
//   other/TBD rhythm. The user can then click days on or off from that starting set.
// @param {string|null} paceEm - Selected ActionProspect pace enum.
// @returns {Array<string>} Weekday enums to highlight.
export function defaultWeekdaysFromPace(paceEm) {
  const paceOption = PACE_OPTIONS.find(option => option.value === paceEm);
  return [...(paceOption?.defaultWeekdays ?? [])];
}

// ----------------------------------------------------------------------------------------------
// @desc Apply a newly chosen pace, including the days that rhythm starts with and clearing a deadline the new
//   pace does not use. Re-selecting the current pace leaves a user's day clicks intact.
// @param {object} draft - Current per-project draft.
// @param {string} paceEm - Selected ActionProspect pace enum.
// @returns {object} Updated draft.
export function draftFromPaceSelection(draft, paceEm) {
  if (draft.paceEm === paceEm) return draft;
  return { ...draft, deadlineOn: paceEm === "deadlineSprint" ? draft.deadlineOn : null, paceEm,
    preferredWeekdays: defaultWeekdaysFromPace(paceEm) };
}

// ----------------------------------------------------------------------------------------------
// @desc Seed one editable pace card per named live project. Unvalidated projects (no Focus or Keep warm) are
//   included only while fewer than three validated projects exist; once that bar is met, only those with a
//   selected option are paced.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter.
// @returns {Array<object>} Drafts: { approvalStatusEm, deadlineOn, paceEm, preferredWeekdays, substantiation,
//   summary, userCategoryEm, uuid }.
export function draftPacesFromProspects(prospects = []) {
  const namedProspects = prospects.filter(prospect => prospect.summary.trim());
  const liveProspects = namedProspects.filter(prospect => !isDeclinedActionProspect(prospect));
  const validatedProspects = liveProspects.filter(isValidatedActionProspect);
  const paceProspects = validatedProspects.length >= MINIMUM_VALIDATED_PACE_PROSPECTS ? validatedProspects : liveProspects;
  return paceProspects.map(prospect => ({ approvalStatusEm: prospect.approvalStatusEm,
    deadlineOn: prospect.deadlineOn ?? null, paceEm: prospect.paceEm ?? null,
    preferredWeekdays: prospect.preferredWeekdays ?? [], substantiation: prospect.substantiation,
    summary: prospect.summary, userCategoryEm: prospect.userCategoryEm, uuid: prospect.uuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Map pace drafts onto savePlanProspects records, including a cleared deadline when the pace is not a sprint.
// @param {Array<object>} drafts - Current per-project drafts.
// @param {string} capturedAt - ISO timestamp shared by every record in this edit, preserved across a retry.
// @returns {Array<object>} Records accepted by savePlanProspects.
export function paceRecordsFromDrafts(drafts, capturedAt) {
  return drafts.map(draft => ({ approvalStatusEm: draft.approvalStatusEm, capturedAt,
    deadlineOn: draft.paceEm === "deadlineSprint" ? draft.deadlineOn : null, paceEm: draft.paceEm,
    preferredWeekdays: draft.preferredWeekdays, substantiation: draft.substantiation, summary: draft.summary,
    userCategoryEm: draft.userCategoryEm, uuid: draft.uuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Add or remove one weekday. About one block per week keeps only the day just clicked, so choosing
//   Thursday drops Wednesday; other paces still toggle days independently while preserving week order.
// @param {string|null} paceEm - Selected ActionProspect pace enum.
// @param {Array<string>} selectedWeekdays - Currently chosen weekday enums.
// @param {string} weekday - Weekday being clicked.
// @returns {Array<string>} Updated weekday enums.
export function toggledWeekdaysFromSelection(paceEm, selectedWeekdays, weekday) {
  if (paceEm === "oneSubstantialBlock") return selectedWeekdays.length === 1 && selectedWeekdays[0] === weekday ? [] : [weekday];
  const remainingWeekdays = selectedWeekdays.filter(candidate => candidate !== weekday);
  if (selectedWeekdays.includes(weekday)) return remainingWeekdays;
  const orderedWeekdays = WEEKDAYS.filter(candidate => selectedWeekdays.includes(candidate) || candidate === weekday);
  return orderedWeekdays;
}

// ----------------------------------------------------------------------------------------------
// @desc Format a stored weekday enum value for display, keeping the datastore's lowercase values out of the UI.
// @param {string} weekday - Stored weekday value.
// @returns {string} Capitalized label.
export function weekdayLabel(weekday) {
  return `${ weekday.charAt(0).toUpperCase() }${ weekday.slice(1) }`;
}
