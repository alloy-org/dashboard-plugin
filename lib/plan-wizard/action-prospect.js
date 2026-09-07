// Validate a persisted project candidate while keeping inference and human decisions distinct.

import { PLAN_MODEL_MARKER, PROSPECT_APPROVALS, PROSPECT_PRIORITIES, assertMonthLabels, assertUserCategory,
  assertUuidList, assertWeekdays, copyJsonValue, normalizedTimestamp, requireRecord,
  requiredText } from "plan-wizard/plan-models";

// ----------------------------------------------------------------------------------------------
// @desc A candidate project proposed from evidence or supplied by the user.
// @property {string} approvalStatusEm - awaitingJudgement, humanAffirmed, humanProvided, humanRejected, or humanRetired.
// @property {string|null} decidedAt - When the user last judged this prospect; null while awaiting judgement.
// @property {Array<object>} evidence - Structured note/task references supporting an inferred prospect.
// @property {Array<string>} focusMonths - YYYY-MM labels this project is meant to occupy.
// @property {Array<string>} linkedGoalUuids - GoalSet UUIDs this project advances.
// @property {string|null} primaryNote - Source-contract alias of primaryNoteUuid.
// @property {string|null} primaryNoteUuid - Note representing the project, when one exists.
// @property {Array<string>} preferredDows - Source-contract alias of preferredWeekdays.
// @property {Array<string>} preferredWeekdays - Weekday enum values this project's work suits.
// @property {string|null} priorityEm - monthFocus, notNow, quarterFocus, stayWarm, or null before selection.
// @property {string} quarterKey - YYYY-Qn planning period the prospect was raised for.
// @property {Array<string>} relatedNotes - Note UUIDs represented by structured evidence.
// @property {Array<string>} relatedTasks - Task UUIDs represented by structured evidence.
// @property {string} refreshedProspectAt - Last time the prospect itself was refreshed.
// @property {string} refreshedTasksAt - Last time its task evidence was refreshed.
// @property {string} substantiation - Compatibility alias of the first substantiations sentence.
// @property {Array<string>} substantiations - One or more reasons the project is worth considering.
// @property {string} summary - Short project description shown to the user.
// @property {string} userCategoryEm - work or personal.
// @property {string} uuid - Stable identity retained across refreshes, including rejected ideas.
export default class ActionProspect {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached, validated prospect from strict JSON data.
  // @param {object} record - Prospect fields, including UUID, approval status, and category.
  // @param {object} scope - Expected quarterKey; prospects are stored per category.
  constructor(record, scope) {
    const prospect = copyJsonValue(record);
    requireRecord(prospect);
    prospect.preferredWeekdays = prospect.preferredWeekdays ?? prospect.preferredDows;
    prospect.primaryNoteUuid = prospect.primaryNoteUuid ?? prospect.primaryNote ?? null;
    assertUserCategory(prospect.userCategoryEm);
    for (const field of ["summary", "uuid"]) prospect[field] = requiredText(field, prospect[field]);
    if (!PROSPECT_APPROVALS.includes(prospect.approvalStatusEm)) {
      throw new Error(`approvalStatusEm must be one of ${ PROSPECT_APPROVALS.join(", ") }`);
    }
    prospect.priorityEm = prospect.priorityEm ?? null;
    if (prospect.priorityEm !== null && !PROSPECT_PRIORITIES.includes(prospect.priorityEm)) {
      throw new Error(`priorityEm must be null or one of ${ PROSPECT_PRIORITIES.join(", ") }`);
    }
    prospect.focusMonths = assertMonthLabels(prospect.focusMonths ?? []);
    prospect.preferredWeekdays = assertWeekdays(prospect.preferredWeekdays ?? []);
    prospect.linkedGoalUuids = assertUuidList("linkedGoalUuids", prospect.linkedGoalUuids ?? []);
    prospect.evidence = prospect.evidence ?? [];
    if (!Array.isArray(prospect.evidence)) throw new Error("evidence must be an array");
    if (prospect.approvalStatusEm === "humanProvided" && prospect.evidence.length) {
      throw new Error("A user-provided prospect cannot claim inferred evidence");
    }
    if (prospect.primaryNoteUuid !== null) {
      prospect.primaryNoteUuid = requiredText("primaryNoteUuid", prospect.primaryNoteUuid);
    }
    prospect.substantiations = prospect.substantiations ?? (prospect.substantiation ? [prospect.substantiation] : []);
    if (!Array.isArray(prospect.substantiations) || !prospect.substantiations.length) {
      throw new Error("substantiations must contain at least one reason");
    }
    prospect.substantiations = prospect.substantiations.map(reason => requiredText("substantiations", reason));
    prospect.substantiation = prospect.substantiations[0];
    const evidenceNoteUuids = prospect.evidence.map(item => item?.noteUuid).filter(Boolean);
    const evidenceTaskUuids = prospect.evidence.map(item => item?.taskUuid).filter(Boolean);
    prospect.relatedNotes = assertUuidList("relatedNotes", prospect.relatedNotes ?? [...new Set(evidenceNoteUuids)]);
    prospect.relatedTasks = assertUuidList("relatedTasks", prospect.relatedTasks ?? [...new Set(evidenceTaskUuids)]);
    prospect.capturedAt = normalizedTimestamp(prospect.capturedAt);
    prospect.decidedAt = prospect.decidedAt ? normalizedTimestamp(prospect.decidedAt) : null;
    prospect.refreshedProspectAt = normalizedTimestamp(prospect.refreshedProspectAt ?? prospect.capturedAt);
    prospect.refreshedTasksAt = normalizedTimestamp(prospect.refreshedTasksAt ?? prospect.capturedAt);
    prospect.preferredDows = prospect.preferredWeekdays;
    prospect.primaryNote = prospect.primaryNoteUuid;
    if (prospect.quarterKey !== scope.quarterKey) throw new Error("Prospect scope does not match");
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(prospect));
    Object.defineProperty(this, PLAN_MODEL_MARKER, { value: true });
  }
}
