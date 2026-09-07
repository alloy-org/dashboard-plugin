// Validate a candidate action belonging to one persisted ActionProspect.

import { PLAN_MODEL_MARKER, PROSPECT_TASK_APPROVALS, SCHEDULE_STATUSES, copyJsonValue, normalizedTimestamp,
  requireRecord, requiredText } from "plan-wizard/plan-models";

// ----------------------------------------------------------------------------------------------
// @desc A candidate action whose identity, approval, scheduling, and completion remain independent.
// @property {string} approvalStatus - awaitingJudgement, humanApproved, or humanRejected.
// @property {string|null} completedAt - Actual completion time.
// @property {string|null} decidedAt - When the user last judged this task.
// @property {number|null} durationMinutes - Positive estimated duration, when known.
// @property {string} importance - Why this action matters within its prospect.
// @property {number} matchScore - How well this action fits its prospect, 1 through 10.
// @property {number} proposalCount - Number of distinct proposal events.
// @property {string} prospectUuid - Parent ActionProspect identity.
// @property {string|null} scheduledStartAt - Start time once scheduled.
// @property {string} scheduleStatus - unscheduled or scheduled.
// @property {string} substantiation - Why this action is proposed.
// @property {string|null} taskUuid - Linked Amplenote task, when one exists.
// @property {string} taskText - The proposed action.
// @property {string} uuid - Stable candidate-action identity.
export default class ProspectTask {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached, validated prospect task from strict JSON data.
  // @param {object} record - Task fields, including its UUID and parent prospect UUID.
  constructor(record) {
    const prospectTask = copyJsonValue(record);
    requireRecord(prospectTask);
    for (const field of ["prospectUuid", "substantiation", "taskText", "uuid"]) {
      prospectTask[field] = requiredText(field, prospectTask[field]);
    }
    if (!PROSPECT_TASK_APPROVALS.includes(prospectTask.approvalStatus)) {
      throw new Error(`approvalStatus must be one of ${ PROSPECT_TASK_APPROVALS.join(", ") }`);
    }
    prospectTask.scheduleStatus = prospectTask.scheduleStatus ?? "unscheduled";
    if (!SCHEDULE_STATUSES.includes(prospectTask.scheduleStatus)) {
      throw new Error("scheduleStatus must be unscheduled or scheduled");
    }
    if (!Number.isFinite(prospectTask.matchScore) || prospectTask.matchScore < 1 || prospectTask.matchScore > 10) {
      throw new Error("matchScore must be between 1 and 10");
    }
    prospectTask.proposalCount = prospectTask.proposalCount ?? 1;
    if (!Number.isInteger(prospectTask.proposalCount) || prospectTask.proposalCount < 1) {
      throw new Error("proposalCount must be a positive integer");
    }
    prospectTask.durationMinutes = prospectTask.durationMinutes ?? null;
    if (prospectTask.durationMinutes !== null
      && (!Number.isFinite(prospectTask.durationMinutes) || prospectTask.durationMinutes <= 0)) {
      throw new Error("durationMinutes must be a positive number");
    }
    prospectTask.importance = typeof prospectTask.importance === "string" ? prospectTask.importance.trim() : "";
    prospectTask.taskUuid = prospectTask.taskUuid ?? null;
    if (prospectTask.taskUuid !== null) prospectTask.taskUuid = requiredText("taskUuid", prospectTask.taskUuid);
    for (const field of ["completedAt", "decidedAt", "scheduledStartAt"]) {
      prospectTask[field] = prospectTask[field] ? normalizedTimestamp(prospectTask[field]) : null;
    }
    if (prospectTask.scheduleStatus === "scheduled" && !prospectTask.scheduledStartAt) {
      throw new Error("A scheduled task requires scheduledStartAt");
    }
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(prospectTask));
    Object.defineProperty(this, PLAN_MODEL_MARKER, { value: true });
  }
}
