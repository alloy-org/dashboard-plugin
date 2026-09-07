// Translate between the projects page's editable rows and the ActionProspect records the plan-wizard service
// persists. Kept apart from the component so the rules that matter — which projects are live, how a user-provided
// project differs from an inferred one, and what a rejection writes — can be exercised without rendering.

import { planningRecordUuid } from "plan-wizard/plan-models";

// A project the user typed states its own case; the substantiations field is required by the model, and this is
// the honest value for one that no inference proposed.
export const USER_PROVIDED_SUBSTANTIATION = "Named by you while planning this quarter.";
export const PROJECT_PRIORITY_OPTIONS = [
  { label: "Focus", value: "quarterFocus" },
  { label: "Keep warm", value: "stayWarm" },
  { label: "Not now", value: "notNow" },
];

// ----------------------------------------------------------------------------------------------
// @desc Seed editable rows from stored prospects and one empty row per category, automatically linking a custom
//   project to the saved intents in the category now that those links are no longer user-facing checkboxes.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter, rejected ones already excluded.
// @param {Array<object>} goals - Saved GoalSet records whose identities custom projects inherit by category.
// @returns {Array<object>} Draft rows: { approvalStatusEm, isDirty, isStored, linkedGoalUuids, preferredWeekdays,
//   priorityEm, substantiations, summary, userCategoryEm, uuid }.
// Discovery's reasons ride along so every suggested card can explain why it is worth considering.
export function draftRowsFromProspects(prospects = [], goals = []) {
  const rows = [];
  for (const userCategoryEm of ["work", "personal"]) {
    const categoryProspects = prospects.filter(prospect => prospect.userCategoryEm === userCategoryEm);
    const categoryGoalUuids = goals.filter(goal => goal.userCategoryEm === userCategoryEm).map(goal => goal.uuid);
    const storedRows = categoryProspects.map(prospect => ({ approvalStatusEm: prospect.approvalStatusEm, isDirty: false,
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
// @returns {object} Draft row.
export function emptyProjectRow(userCategoryEm, linkedGoalUuids = []) {
  return { approvalStatusEm: "humanProvided", isDirty: false, isStored: false, linkedGoalUuids, preferredWeekdays: [],
    priorityEm: null, substantiations: [USER_PROVIDED_SUBSTANTIATION], summary: "", userCategoryEm,
    uuid: planningRecordUuid() };
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
