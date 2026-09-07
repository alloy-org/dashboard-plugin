// Translate between the projects page's editable rows and the ActionProspect records the plan-wizard service
// persists. Kept apart from the component so the rules that matter — which projects are live, how a user-provided
// project differs from an inferred one, and what a rejection writes — can be exercised without rendering.

import { planningRecordUuid } from "plan-wizard/plan-models";

// A project the user typed states its own case; the substantiation field is required by the model, and this is
// the honest value for one that no inference proposed.
export const USER_PROVIDED_SUBSTANTIATION = "Named by you while planning this quarter.";
export const PROJECT_PRIORITY_OPTIONS = [
  { label: "Focus", value: "quarterFocus" },
  { label: "Keep warm", value: "stayWarm" },
  { label: "Not now", value: "notNow" },
];

// ----------------------------------------------------------------------------------------------
// @desc Seed editable rows from stored prospects, always offering one empty row per category so the page is
//   usable before discovery exists and before the user has named anything.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter, rejected ones already excluded.
// @returns {Array<object>} Draft rows: { approvalStatus, isStored, linkedGoalUuids, preferredWeekdays, priority,
//   substantiation, summary, userCategoryEm, uuid }.
// A stored prospect's substantiation rides along on its row: discovery's reasoning is what the page shows the
// user about a proposal, and saving an edited proposal must write that reasoning back rather than replacing it
// with the boilerplate a hand-typed project carries.
export function draftRowsFromProspects(prospects = []) {
  const rows = [];
  for (const userCategoryEm of ["work", "personal"]) {
    const categoryProspects = prospects.filter(prospect => prospect.userCategoryEm === userCategoryEm);
    const storedRows = categoryProspects.map(prospect => ({ approvalStatus: prospect.approvalStatus, isStored: true,
      linkedGoalUuids: prospect.linkedGoalUuids ?? [], preferredWeekdays: prospect.preferredWeekdays ?? [],
      priority: prospect.priority ?? "opportunistic", substantiation: prospect.substantiation ?? null,
      summary: prospect.summary, userCategoryEm,
      uuid: prospect.uuid }));
    rows.push(...storedRows, emptyProjectRow(userCategoryEm));
  }
  return rows;
}

// ----------------------------------------------------------------------------------------------
// @desc Build an empty draft row with a fresh identity, used for the always-present blank row in a category.
// @param {string} userCategoryEm - work or personal.
// @returns {object} Draft row.
export function emptyProjectRow(userCategoryEm) {
  return { approvalStatus: "humanProvided", isStored: false, linkedGoalUuids: [], preferredWeekdays: [],
    priority: "opportunistic", substantiation: null, summary: "", userCategoryEm, uuid: planningRecordUuid() };
}

// ----------------------------------------------------------------------------------------------
// @desc Build the record written when a user sorts a project into Focus, Keep warm, or Not now.
// @param {object} row - Stored project row being judged.
// @param {string} priority - Persisted ActionProspect priority enum.
// @param {string} capturedAt - ISO timestamp for this decision.
// @returns {object} Record accepted by savePlanProspects.
// Awaiting proposals become human-affirmed when judged; an existing human decision keeps its approval status.
export function priorityRecordFromRow(row, priority, capturedAt) {
  const approvalStatus = row.approvalStatus === "awaitingJudgement" ? "humanAffirmed" : row.approvalStatus;
  const substantiation = row.substantiation ?? USER_PROVIDED_SUBSTANTIATION;
  return { approvalStatus, capturedAt, decidedAt: capturedAt, linkedGoalUuids: row.linkedGoalUuids,
    preferredWeekdays: row.preferredWeekdays, priority, substantiation, summary: row.summary.trim(),
    userCategoryEm: row.userCategoryEm, uuid: row.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Map draft rows onto savePlanProspects records, skipping rows the user never filled in and preserving the
//   approval status of anything discovery proposed that the user has now edited into a project they endorse.
// @param {Array<object>} draftRows - Current draft rows.
// @param {string} capturedAt - ISO timestamp shared by every record in this edit, preserved across a retry.
// @returns {Array<object>} Records accepted by savePlanProspects.
// Editing an inferred proposal affirms it: the user has taken a position, so it stops awaiting judgement. Its
// stored evidence is deliberately not sent back — the merge carries it forward from the stored record, which is
// what keeps an affirmed proposal's provenance intact while a hand-typed project claims none.
export function prospectRecordsFromDraftRows(draftRows, capturedAt) {
  const records = [];
  for (const row of draftRows) {
    const summary = row.summary.trim();
    if (!summary) continue;
    const wasProposed = row.approvalStatus === "awaitingJudgement";
    const approvalStatus = wasProposed ? "humanAffirmed" : row.approvalStatus;
    const substantiation = row.substantiation ?? USER_PROVIDED_SUBSTANTIATION;
    records.push({ approvalStatus, capturedAt, linkedGoalUuids: row.linkedGoalUuids, preferredWeekdays: row.preferredWeekdays,
      priority: row.priority, substantiation, summary, userCategoryEm: row.userCategoryEm, uuid: row.uuid });
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
  const substantiation = row.substantiation ?? USER_PROVIDED_SUBSTANTIATION;
  return { approvalStatus: "humanRejected", capturedAt, decidedAt: capturedAt, linkedGoalUuids: row.linkedGoalUuids,
    preferredWeekdays: row.preferredWeekdays, priority: row.priority, substantiation, summary: row.summary.trim(),
    userCategoryEm: row.userCategoryEm, uuid: row.uuid };
}
