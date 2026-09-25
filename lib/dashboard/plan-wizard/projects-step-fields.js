// Translate between the projects page's editable rows and the ActionProspect records the plan-wizard service
// persists. Kept apart from the component so the rules that matter — which projects are live, how a user-provided
// project differs from an inferred one, and what a rejection writes — can be exercised without rendering.

import { isCompletedActionProspect, isDeclinedActionProspect, planningRecordUuid } from "plan-wizard/plan-models";

// Once a category holds this many live projects with a pace chosen, the plan is full enough that moving onto the
// projects page skips discovery and simply shows what is there to adjust.
export const PACED_PROJECT_DISCOVERY_LIMITS = { personal: 3, work: 7 };
// A project the user typed states its own case; the substantiations field is required by the model, and this is
// the honest value for one that no inference proposed.
export const USER_PROVIDED_SUBSTANTIATION = "Named by you while planning this quarter.";
export const PROJECT_PRIORITY_OPTIONS = [
  { label: "Focus", value: "quarterFocus" },
  { label: "Keep warm", value: "stayWarm" },
  { label: "Not now", value: "notNow" },
];

// ----------------------------------------------------------------------------------------------
// @desc Build the record written when a user marks a project Complete, or clears that mark to resume it.
// @param {object} row - Stored project row being marked.
// @param {string|null} completedAt - ISO timestamp the project was finished, or null to reopen it.
// @param {string} capturedAt - ISO timestamp for this decision.
// @returns {object} Record accepted by savePlanProspects.
// Marking an awaiting proposal Complete affirms it, the same as choosing its emphasis would.
export function completionRecordFromRow(row, completedAt, capturedAt) {
  const approvalStatusEm = row.approvalStatusEm === "awaitingJudgement" ? "humanAffirmed" : row.approvalStatusEm;
  return { approvalStatusEm, capturedAt, completedAt, decidedAt: capturedAt, linkedGoalUuids: row.linkedGoalUuids,
    preferredWeekdays: row.preferredWeekdays, priorityEm: row.priorityEm, substantiations: row.substantiations,
    summary: row.summary.trim(), userCategoryEm: row.userCategoryEm, uuid: row.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Seed editable rows from stored prospects and one empty row per category, automatically linking a custom
//   project to the saved intents in the category now that those links are no longer user-facing checkboxes.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter, rejected ones already excluded.
// @param {Array<object>} goals - Saved GoalSet records whose identities custom projects inherit by category.
// @returns {Array<object>} Draft rows: { approvalStatusEm, completedAt, isDirty, isStored, linkedGoalUuids,
//   preferredWeekdays, priorityEm, shouldAutoFocus, substantiations, summary, userCategoryEm, uuid }.
// Discovery's reasons ride along so every suggested card can explain why it is worth considering.
export function draftRowsFromProspects(prospects = [], goals = []) {
  const rows = [];
  for (const userCategoryEm of ["work", "personal"]) {
    const categoryProspects = prospects.filter(prospect => prospect.userCategoryEm === userCategoryEm);
    const categoryGoalUuids = goals.filter(goal => goal.userCategoryEm === userCategoryEm).map(goal => goal.uuid);
    const storedRows = categoryProspects.map(prospect => ({ approvalStatusEm: prospect.approvalStatusEm,
      completedAt: prospect.completedAt ?? null, isDirty: false,
      isStored: true, linkedGoalUuids: prospect.linkedGoalUuids ?? [], preferredWeekdays: prospect.preferredWeekdays ?? [],
      priorityEm: prospect.priorityEm ?? null,
      substantiations: prospect.substantiations ?? [prospect.substantiation].filter(Boolean),
      summary: prospect.summary, userCategoryEm, uuid: prospect.uuid }));
    rows.push(...storedRows, emptyProjectRow(userCategoryEm, categoryGoalUuids));
  }
  return rows;
}

// ----------------------------------------------------------------------------------------------
// @desc Build an empty draft row with a fresh identity, used for the always-present blank row in a category.
// @param {string} userCategoryEm - work or personal.
// @param {Array<string>} linkedGoalUuids - Saved intents in the same category.
// @param {boolean} shouldAutoFocus - Whether the card rendering this row should focus its name field on mount.
// @returns {object} Draft row.
// A row added by the Add another project button carries shouldAutoFocus so the cursor lands in the field the
// click just produced; the blank row seeded with a category does not, so the page does not steal focus on load.
export function emptyProjectRow(userCategoryEm, linkedGoalUuids = [], shouldAutoFocus = false) {
  return { approvalStatusEm: "humanProvided", completedAt: null, isDirty: false, isStored: false, linkedGoalUuids,
    preferredWeekdays: [],
    priorityEm: null, shouldAutoFocus, substantiations: [USER_PROVIDED_SUBSTANTIATION], summary: "", userCategoryEm,
    uuid: planningRecordUuid() };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether the plan already holds enough paced projects that discovery should be skipped: seven
//   professional or three personal projects that are live, unfinished, and have a pace chosen.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter.
// @returns {boolean} True when either category has reached its limit.
export function hasEnoughPacedProjects(prospects = []) {
  const pacedProspects = prospects.filter(prospect => prospect.paceEm && !isDeclinedActionProspect(prospect)
    && !isCompletedActionProspect(prospect));
  const reachedCategories = Object.entries(PACED_PROJECT_DISCOVERY_LIMITS).filter(([userCategoryEm, limit]) =>
    pacedProspects.filter(prospect => prospect.userCategoryEm === userCategoryEm).length >= limit);
  return reachedCategories.length > 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the record written when a user sorts a project into Focus, Keep warm, or Not now.
// @param {object} row - Stored project row being judged.
// @param {string} priorityEm - Persisted ActionProspect priority enum.
// @param {string} capturedAt - ISO timestamp for this decision.
// @returns {object} Record accepted by savePlanProspects.
// Awaiting proposals become human-affirmed when judged; an existing human decision keeps its approval status.
export function priorityRecordFromRow(row, priorityEm, capturedAt) {
  const approvalStatusEm = row.approvalStatusEm === "awaitingJudgement" ? "humanAffirmed" : row.approvalStatusEm;
  return { approvalStatusEm, capturedAt, decidedAt: capturedAt, linkedGoalUuids: row.linkedGoalUuids,
    preferredWeekdays: row.preferredWeekdays, priorityEm, substantiations: row.substantiations,
    summary: row.summary.trim(),
    userCategoryEm: row.userCategoryEm, uuid: row.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Map changed draft rows onto savePlanProspects records, skipping untouched proposals and empty custom rows.
// @param {Array<object>} draftRows - Current draft rows.
// @param {string} capturedAt - ISO timestamp shared by every record in this edit, preserved across a retry.
// @returns {Array<object>} Records accepted by savePlanProspects.
// Editing an inferred proposal affirms it: the user has taken a position, so it stops awaiting judgement. Its
// stored evidence is deliberately not sent back — the merge carries it forward from the stored record, which is
// what keeps an affirmed proposal's provenance intact while a hand-typed project claims none.
export function prospectRecordsFromDraftRows(draftRows, capturedAt) {
  const records = [];
  for (const row of draftRows) {
    if (!row.isDirty) continue;
    const summary = row.summary.trim();
    if (!summary) continue;
    const wasProposed = row.approvalStatusEm === "awaitingJudgement";
    const approvalStatusEm = wasProposed ? "humanAffirmed" : row.approvalStatusEm;
    records.push({ approvalStatusEm, capturedAt, linkedGoalUuids: row.linkedGoalUuids, preferredWeekdays: row.preferredWeekdays,
      priorityEm: row.priorityEm, substantiations: row.substantiations, summary, userCategoryEm: row.userCategoryEm,
      uuid: row.uuid });
  }
  return records;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the record that removes a project from the plan without forgetting it, so a later discovery pass
//   does not propose the same idea again.
// @param {object} row - Draft row being rejected; it must already be stored.
// @param {string} capturedAt - ISO timestamp for this decision.
// @returns {object} Record accepted by savePlanProspects.
export function rejectionRecordFromRow(row, capturedAt) {
  return { approvalStatusEm: "humanRejected", capturedAt, decidedAt: capturedAt, linkedGoalUuids: row.linkedGoalUuids,
    preferredWeekdays: row.preferredWeekdays, priorityEm: row.priorityEm, substantiations: row.substantiations,
    summary: row.summary.trim(),
    userCategoryEm: row.userCategoryEm, uuid: row.uuid };
}
