// Derive what Plan Builder contributes to a quarter's plan note from the records the wizard stored, so the
// markdown merge works from one settled shape instead of reaching into ActionProspect internals. Nothing here
// touches the app: a publication can be built in a test from a planning context alone.

import { isCompletedActionProspect, isDeclinedActionProspect } from "plan-wizard/plan-models";
import { dateKeyFromDateInput } from "util/date-utility";

// The rhythm wording shown in the plan note. It matches the labels on the pace page so a user reading the note
// recognizes the answer they gave, and lives in this host-compatible layer so the note never depends on the UI.
export const PACE_RHYTHM_LABELS = { deadlineSprint: "Deadline sprint", maintenanceOnly: "Other / TBD",
  oneSubstantialBlock: "About one block per week", smallMoveMostDays: "A small move most days",
  twoFocusedBlocks: "Two focused blocks per week" };
// Focus and Keep warm both earn a project block; Keep warm is marked so the two remain distinguishable.
const PLAN_NOTE_PRIORITIES = ["quarterFocus", "monthFocus", "stayWarm"];

// ----------------------------------------------------------------------------------------------
// @desc Order project blocks so the quarter's focus reads first, professional before personal, then by name, so
//   a re-publication of unchanged decisions produces byte-identical markdown.
// @param {object} first - Published project record.
// @param {object} second - Published project record.
// @returns {number} Comparator result.
function byPlanNoteOrder(first, second) {
  if (first.isKeptWarm !== second.isKeptWarm) return first.isKeptWarm ? 1 : -1;
  if (first.userCategoryEm !== second.userCategoryEm) return first.userCategoryEm === "work" ? -1 : 1;
  return first.summary.localeCompare(second.summary);
}

// ----------------------------------------------------------------------------------------------
// @desc List the YYYY-MM month keys belonging to a planning scope's quarter, used to match the note's
//   Month-by-Month headings against the focus months a project was placed in.
// @param {object} scope - Resolved planning scope carrying quarter and year.
// @returns {Array<string>} Three month keys in calendar order.
export function quarterMonthKeysFromScope(scope) {
  const firstMonthIndex = (scope.quarter - 1) * 3;
  const monthNumbers = [firstMonthIndex + 1, firstMonthIndex + 2, firstMonthIndex + 3];
  const monthKeys = monthNumbers.map(monthNumber => `${ scope.year }-${ String(monthNumber).padStart(2, "0") }`);
  return monthKeys;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce one stored ActionProspect to only what the plan note shows, dropping evidence, identities, and
//   approval bookkeeping that belong to the Vision Guide rather than to a note a human reads.
// @param {object} prospect - Stored ActionProspect.
// @returns {object} An object with the following properties:
//   - {string|null} completedOn - Local YYYY-MM-DD day the user marked the project Complete, or null.
//   - {string|null} deadlineOn - YYYY-MM-DD landing date for a deadline sprint, or null.
//   - {Array<string>} focusMonths - YYYY-MM labels this project was placed in on the timeline.
//   - {boolean} isKeptWarm - True when the user sorted this project into Keep warm rather than Focus.
//   - {string} paceLabel - Human wording for the chosen rhythm; empty when no pace was selected.
//   - {Array<string>} preferredWeekdays - Weekday enums the user protected for this project.
//   - {Array<string>} substantiations - Reasons the project is worth doing.
//   - {string} summary - Project title.
//   - {string} userCategoryEm - work or personal.
function publishedProject(prospect) {
  const substantiations = (prospect.substantiations ?? [prospect.substantiation]).filter(Boolean);
  const completedOn = prospect.completedAt ? dateKeyFromDateInput(prospect.completedAt) : null;
  return { completedOn, deadlineOn: prospect.deadlineOn ?? null, focusMonths: prospect.focusMonths ?? [],
    isKeptWarm: prospect.priorityEm === "stayWarm", paceLabel: PACE_RHYTHM_LABELS[prospect.paceEm] ?? "",
    preferredWeekdays: prospect.preferredWeekdays ?? [], substantiations, summary: prospect.summary.trim(),
    userCategoryEm: prospect.userCategoryEm };
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce the intents the user named on the wizard's first page to the text the plan note shows, keeping
//   the order readPlanGoals already sorted them into so a re-publication of unchanged answers is byte-identical.
// @param {Array<object>} goals - Live goal records from a planning context.
// @returns {Array<object>} An array of objects with the following properties:
//   - {string} text - The intent as the user wrote it.
//   - {string} userCategoryEm - work or personal.
// A goal whose text is blank is skipped: the intent page keeps an empty secondary field around for the user to
// type into, and an empty bullet in the plan note would say nothing.
function publishedIntents(goals) {
  const namedGoals = goals.filter(goal => typeof goal.goalText === "string" && goal.goalText.trim());
  const intents = namedGoals.map(goal => ({ text: goal.goalText.trim(), userCategoryEm: goal.userCategoryEm }));
  return intents;
}

// ----------------------------------------------------------------------------------------------
// @desc Collect everything Plan Builder is entitled to write into a quarter's plan note.
// @param {object} planningContext - Context returned by readPlanGoals or any save; its prospects have already
//   had rejected and retired projects removed, so the only declined records left are Not now.
// @param {object} scope - Resolved planning scope.
// @returns {object} An object with the following properties:
//   - {Array<object>} completedProjects - Published project records the user marked Complete, in note order.
//   - {string|null} dailySufficiencyText - The user's answer to when a day is enough, or null.
//   - {Array<object>} intents - { text, userCategoryEm } for each intent the user named, professional first.
//   - {Array<string>} notThisQuarter - Summaries the user sorted into Not now, alphabetically.
//   - {Array<object>} projects - Published project records for Focus and Keep warm that are still live, in note order.
//   - {Array<string>} quarterMonthKeys - The quarter's three YYYY-MM keys.
//   - {string|null} quarterNameText - The name the user gave the quarter, or null.
// A project the user has not yet sorted is deliberately absent: the note records ratified decisions, not drafts.
// A completed project is published whatever its emphasis, since finishing it is itself a decision worth recording,
//   and it is kept out of projects so the weekday and month lines stop naming it.
export function quarterlyPlanPublication(planningContext, scope) {
  const prospects = planningContext.prospects ?? [];
  const namedProspects = prospects.filter(prospect => typeof prospect.summary === "string" && prospect.summary.trim());
  const completedProspects = namedProspects.filter(isCompletedActionProspect);
  const completedProjects = completedProspects.map(publishedProject).sort(byPlanNoteOrder);
  const openProspects = namedProspects.filter(prospect => !isCompletedActionProspect(prospect));
  const ratifiedProspects = openProspects.filter(prospect => PLAN_NOTE_PRIORITIES.includes(prospect.priorityEm));
  const projects = ratifiedProspects.map(publishedProject).sort(byPlanNoteOrder);
  const declinedProspects = openProspects.filter(isDeclinedActionProspect);
  const notThisQuarter = declinedProspects.map(prospect => prospect.summary.trim()).sort();
  const dailySufficiencyText = planningContext.dailySufficiency?.text?.trim() || null;
  const quarterNameText = planningContext.quarterName?.text?.trim() || null;
  const intents = publishedIntents(planningContext.goals ?? []);
  return { completedProjects, dailySufficiencyText, intents, notThisQuarter, projects,
    quarterMonthKeys: quarterMonthKeysFromScope(scope), quarterNameText };
}
