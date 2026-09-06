// Translate between the intent page's editable draft fields and the ranked GoalSet records the plan-wizard
// service persists. Kept apart from the component so the mapping rules — ranks, tombstones, and the optional
// personal category — can be exercised without rendering.

import { planningRecordUuid } from "plan-wizard/plan-models";

export const PRIMARY_GOAL_RANK = 1;
export const CATEGORY_LABELS = {
  personal: { heading: "Personally (optional)", placeholder: "Optional. What would make the quarter feel well spent?" },
  work: { heading: "Professionally", placeholder: "What outcome would make this quarter a success?" },
};

// ----------------------------------------------------------------------------------------------
// @desc Seed editable fields from stored goals, always offering a primary field per category even when the
//   user has answered neither.
// @param {Array<object>} goals - Active GoalSet records for the scope, already sorted by category and rank.
// @returns {Array<object>} Draft fields: { goalRank, goalText, possibilityUuid, userCategoryEm, uuid }.
// Reopening the wizard therefore shows the persisted answers rather than an empty form.
export function draftFieldsFromGoals(goals = []) {
  const fields = [];
  for (const userCategoryEm of ["work", "personal"]) {
    const categoryGoals = goals.filter(goal => goal.userCategoryEm === userCategoryEm);
    const storedFields = categoryGoals.map(goal => ({ goalRank: goal.goalRank, goalText: goal.goalText,
      possibilityUuid: goal.possibilityUuid ?? null, userCategoryEm, uuid: goal.uuid }));
    const hasPrimary = storedFields.some(field => field.goalRank === PRIMARY_GOAL_RANK);
    if (!hasPrimary) storedFields.unshift(emptyField(PRIMARY_GOAL_RANK, userCategoryEm));
    fields.push(...storedFields);
  }
  return fields;
}

// ----------------------------------------------------------------------------------------------
// @desc Build an empty draft field with a fresh identity, used for a primary slot or an added secondary goal.
// @param {number} goalRank - Rank within the category.
// @param {string} userCategoryEm - work or personal.
// @returns {object} Draft field.
function emptyField(goalRank, userCategoryEm) {
  return { goalRank, goalText: "", possibilityUuid: null, userCategoryEm, uuid: planningRecordUuid() };
}

// ----------------------------------------------------------------------------------------------
// @desc Map draft fields onto savePlanGoals records, writing a tombstone for a stored goal the user cleared
//   and skipping fields that were never filled in.
// @param {Array<object>} draftFields - Current draft fields.
// @param {object} planningContext - Provides goalRecords and the resolved scope.
// @param {string} capturedAt - ISO timestamp shared by every record in this edit, preserved across a retry.
// @returns {Array<object>} Records accepted by savePlanGoals.
// Personal is optional, so an untouched personal field produces no record at all.
export function goalRecordsFromDraftFields(draftFields, planningContext, capturedAt) {
  const { domainName, domainUuid, quarterKey } = planningContext.scope;
  const storedUuids = new Set((planningContext.goalRecords ?? []).filter(goal => !goal.isDeleted).map(goal => goal.uuid));
  const records = [];
  for (const field of draftFields) {
    const goalText = field.goalText.trim();
    const wasStored = storedUuids.has(field.uuid);
    if (!goalText && !wasStored) continue;
    const record = { capturedAt, domainUuid, goalRank: field.goalRank, goalText, isDeleted: !goalText, quarterKey,
      taskDomain: domainName, userCategoryEm: field.userCategoryEm, uuid: field.uuid };
    if (field.possibilityUuid) record.possibilityUuid = field.possibilityUuid;
    records.push(record);
  }
  return records;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the next secondary field for a category, taking the rank after its highest existing field.
// @param {Array<object>} draftFields - All current draft fields.
// @param {string} userCategoryEm - work or personal.
// @returns {object} New draft field.
export function nextSecondaryRank(draftFields, userCategoryEm) {
  const categoryFields = draftFields.filter(field => field.userCategoryEm === userCategoryEm);
  const ranks = categoryFields.map(field => field.goalRank);
  const highestRank = ranks.length ? Math.max(...ranks) : 0;
  return emptyField(highestRank + 1, userCategoryEm);
}
