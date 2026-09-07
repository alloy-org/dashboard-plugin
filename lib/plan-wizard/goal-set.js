// Validate one ranked, persisted intent chosen by the user for a planning quarter.

import { PLAN_MODEL_MARKER, assertUserCategory, copyJsonValue, normalizedTimestamp, requireRecord,
  requiredText } from "plan-wizard/plan-models";

// ----------------------------------------------------------------------------------------------
// @desc A ranked human intent, validated on construction and whenever reloaded or saved.
// @property {string} capturedAt - ISO timestamp; newer captures displace older captures in a slot.
// @property {string|null} domainUuid - Stable task-domain identity, or null for All Notes.
// @property {number} goalRank - Positive rank within a category and quarter.
// @property {string} goalText - Desired outcome; may be empty for a deletion tombstone.
// @property {boolean} isDeleted - Explicit deletion retained to prevent stale resurrection.
// @property {string} quarterKey - YYYY-Qn planning period.
// @property {string} taskDomain - Task-domain display name.
// @property {string} userCategoryEm - work or personal.
// @property {string} uuid - Stable record identity.
export default class GoalSet {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached, validated goal from strict JSON data.
  // @param {object} record - Goal fields, including UUID, capture timestamp, and category.
  // @param {object} scope - Expected domainUuid and quarterKey.
  constructor(record, scope) {
    const goal = copyJsonValue(record);
    requireRecord(goal);
    assertUserCategory(goal.userCategoryEm);
    if (!Number.isInteger(goal.goalRank) || goal.goalRank < 1) throw new Error("goalRank must be a positive integer");
    if (goal.isDeleted !== undefined && typeof goal.isDeleted !== "boolean") throw new Error("isDeleted must be boolean");
    goal.isDeleted = goal.isDeleted ?? false;
    if (typeof goal.goalText !== "string" || (!goal.isDeleted && !goal.goalText.trim())) {
      throw new Error("goalText is required");
    }
    goal.goalText = goal.goalText.trim();
    goal.capturedAt = normalizedTimestamp(goal.capturedAt);
    goal.uuid = requiredText("uuid", goal.uuid);
    if (goal.domainUuid !== scope.domainUuid || goal.quarterKey !== scope.quarterKey) {
      throw new Error("Goal scope does not match");
    }
    goal.taskDomain = requiredText("taskDomain", goal.taskDomain);
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(goal));
    Object.defineProperty(this, PLAN_MODEL_MARKER, { value: true });
  }
}
