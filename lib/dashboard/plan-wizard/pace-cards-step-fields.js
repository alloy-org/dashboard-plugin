// Translate between the pace page's per-project drafts and the ActionProspect fields it writes: which rhythm the
// user chose, which weekdays that rhythm occupies, and the deadline a sprint has to land on.

import { WEEKDAYS } from "plan-wizard/plan-models";

export const PACE_CARDS_STEP_FORM_ID = "plan-wizard-pace-cards-form";
export const PACE_WORKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
export const PACE_OPTIONS = [
  { defaultWeekdays: PACE_WORKDAYS, label: "A small move most days", value: "smallMoveMostDays" },
  { defaultWeekdays: ["tuesday", "thursday"], label: "Two focused blocks per week", value: "twoFocusedBlocks" },
  { defaultWeekdays: ["wednesday"], label: "One substantial block", value: "oneSubstantialBlock" },
  { defaultWeekdays: [], label: "Deadline sprint", value: "deadlineSprint" },
  { defaultWeekdays: [], label: "Maintenance only", value: "maintenanceOnly" },
];

// ----------------------------------------------------------------------------------------------
// @desc Apply a newly chosen pace, including the days that rhythm starts with and clearing a deadline the new
//   pace does not use.
// @param {object} draft - Current per-project draft.
// @param {string} paceEm - Selected ActionProspect pace enum.
// @returns {object} Updated draft.
export function draftFromPaceSelection(draft, paceEm) {
  const paceOption = PACE_OPTIONS.find(option => option.value === paceEm);
  const defaultWeekdays = paceOption?.defaultWeekdays ?? [];
  return { ...draft, deadlineOn: paceEm === "deadlineSprint" ? draft.deadlineOn : null, paceEm,
    preferredWeekdays: [...defaultWeekdays] };
}

// ----------------------------------------------------------------------------------------------
// @desc Seed one editable pace card per named project, carrying the stored rhythm, days, and deadline forward.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter.
// @returns {Array<object>} Drafts: { approvalStatusEm, deadlineOn, paceEm, preferredWeekdays, substantiation,
//   summary, userCategoryEm, uuid }.
export function draftPacesFromProspects(prospects = []) {
  const namedProspects = prospects.filter(prospect => prospect.summary.trim());
  return namedProspects.map(prospect => ({ approvalStatusEm: prospect.approvalStatusEm,
    deadlineOn: prospect.deadlineOn ?? null, paceEm: prospect.paceEm ?? null,
    preferredWeekdays: prospect.preferredWeekdays ?? [], substantiation: prospect.substantiation,
    summary: prospect.summary, userCategoryEm: prospect.userCategoryEm, uuid: prospect.uuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Explain the chosen rhythm in one sentence, so the card states what the days (or deadline) will do.
// @param {object} draft - Current per-project draft.
// @returns {string} Hint shown under the weekday controls.
export function paceHintText(draft) {
  if (draft.paceEm === "deadlineSprint") {
    return draft.deadlineOn ? `Work concentrates toward ${ draft.deadlineOn }.` : "Set the date this sprint has to land.";
  }
  if (draft.paceEm === "maintenanceOnly") return "This project stays available without a weekly rhythm.";
  if (!draft.preferredWeekdays.length) return "Choose the days this project's work belongs on.";
  const orderedWeekdays = WEEKDAYS.filter(weekday => draft.preferredWeekdays.includes(weekday));
  const lastWeekdayName = weekdayLabel(orderedWeekdays[orderedWeekdays.length - 1]);
  return `If ${ lastWeekdayName } arrives with no progress, this project moves up your suggestions.`;
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
// @desc Add or remove one weekday while keeping the stored weekday order, so later hints name the last day in
//   the week rather than the last one clicked.
// @param {Array<string>} selectedWeekdays - Currently chosen weekday enums.
// @param {string} weekday - Weekday being toggled.
// @returns {Array<string>} Updated weekday enums.
export function toggledWeekdaysFromSelection(selectedWeekdays, weekday) {
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
