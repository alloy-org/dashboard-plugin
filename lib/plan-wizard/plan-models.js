// Validate serializable chosen goals, inferred intent possibilities, and the projects those intents are carried
// out through. A prospect is a candidate project and a prospect task is a candidate action within it; both keep a
// human decision separate from an inference, so refreshing suggestions can never overwrite something the user
// decided.

export const GUIDE_SCHEMA_VERSION = 1;
export const USER_CATEGORIES = ["work", "personal"];
// Source enum spellings are preserved exactly as the brainstorming note wrote them.
export const PROSPECT_APPROVALS = ["awaitingJudgement", "humanAffirmed", "humanProvided", "humanRejected", "retired"];
export const PROSPECT_PRIORITIES = ["quarterFocus", "opportunistic", "backburner"];
export const PROSPECT_TASK_APPROVALS = ["awaitingJudgement", "humanApproved", "humanRejected"];
export const SCHEDULE_STATUSES = ["unscheduled", "scheduled"];
// Weekday enum stored as documented; display labels are formatted at the UI edge.
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// ----------------------------------------------------------------------------------------------
// @desc A ranked human choice, validated on construction and whenever it is reloaded or saved.
// @property {string} capturedAt - ISO date or timestamp; newer captures displace older captures in a slot.
// @property {number} goalRank - Positive rank within a category and quarter.
// @property {string} goalText - User's desired outcome; may be empty for a deletion tombstone.
// @property {boolean} isDeleted - Explicit deletion, retained to prevent stale writes restoring the goal.
// @property {string} quarterKey - YYYY-Qn planning period.
// @property {string} taskDomain - Domain display name; category is independent of this name.
// @property {string|null} domainUuid - Stable domain identity, or null for All Notes.
// @property {string} userCategoryEm - work or personal.
// @property {string} uuid - Stable record identity, separate from any Amplenote task.
// Define the first persisted human-decision contract.
export class GoalSet {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached, validated goal from JSON or another GoalSet instance.
  // @param {object} record - Goal fields, including UUID, capture timestamp, and category.
  // @param {object} scope - Expected domainUuid and quarterKey.
  // Native classes provide runtime validation through this constructor, not through type annotations.
  constructor(record, scope) {
    const goal = copyJsonValue(record);
    requireRecord(goal);
    assertUserCategory(goal.userCategoryEm);
    if (!Number.isInteger(goal.goalRank) || goal.goalRank < 1) throw new Error("goalRank must be a positive integer");
    if (goal.isDeleted !== undefined && typeof goal.isDeleted !== "boolean") throw new Error("isDeleted must be boolean");
    goal.isDeleted = goal.isDeleted ?? false;
    if (typeof goal.goalText !== "string" || (!goal.isDeleted && !goal.goalText.trim())) throw new Error("goalText is required");
    goal.goalText = goal.goalText.trim();
    goal.capturedAt = normalizedTimestamp(goal.capturedAt);
    goal.uuid = requiredText("uuid", goal.uuid);
    if (goal.domainUuid !== scope.domainUuid || goal.quarterKey !== scope.quarterKey) throw new Error("Goal scope does not match");
    goal.taskDomain = requiredText("taskDomain", goal.taskDomain);
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(goal));
  }
}

// ----------------------------------------------------------------------------------------------
// @desc An inferred or default suggestion, validated independently of human choices.
// @property {number} confidence - Evidence confidence from 1 through 10.
// @property {Array<object>} evidence - Optional structured evidence references.
// @property {string} intent - Suggested broad outcome.
// @property {string} sourceKind - inferred or default; defaults have no personal evidence.
// @property {string} substantiation - Explanation supporting the suggestion.
// @property {string} userCategoryEm - work or personal.
// @property {string} uuid - Stable identity reused when refreshing the same suggestion.
// Keep inference separate from GoalSet decisions.
export class IntentPossibility {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached suggestion with explicit provenance and confidence.
  // @param {object} record - Suggestion fields, including UUID and category.
  // Defaults cannot claim supporting personal evidence; invalid values throw immediately.
  constructor(record) {
    const possibility = copyJsonValue(record);
    requireRecord(possibility);
    assertUserCategory(possibility.userCategoryEm);
    for (const field of ["intent", "substantiation", "uuid"]) possibility[field] = requiredText(field, possibility[field]);
    if (!Number.isFinite(possibility.confidence) || possibility.confidence < 1 || possibility.confidence > 10) {
      throw new Error("confidence must be between 1 and 10");
    }
    if (!["default", "inferred"].includes(possibility.sourceKind)) throw new Error("sourceKind must be default or inferred");
    possibility.evidence = possibility.evidence ?? [];
    if (!Array.isArray(possibility.evidence)) throw new Error("evidence must be an array");
    if (possibility.sourceKind === "default" && possibility.evidence.length) throw new Error("Defaults cannot claim evidence");
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(possibility));
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A candidate project: the work a chosen intent is actually carried out through. A prospect may be named by
//   the user or proposed by discovery, and its approval status records which, so a later inference refresh can add
//   candidates without disturbing anything the user decided.
// @property {string} approvalStatus - awaitingJudgement, humanAffirmed, humanProvided, humanRejected, or retired.
// @property {string|null} decidedAt - When the user last judged this prospect; null while awaiting judgement.
// @property {Array<object>} evidence - Structured note/task references supporting an inferred prospect.
// @property {Array<string>} focusMonths - YYYY-MM labels this project is meant to occupy.
// @property {Array<string>} linkedGoalUuids - GoalSet UUIDs this project advances; one project may serve several.
// @property {Array<string>} preferredWeekdays - Weekday enum values this project's work suits.
// @property {string|null} primaryNoteUuid - Note representing the project, when one exists.
// @property {string} priority - quarterFocus, opportunistic, or backburner.
// @property {string} quarterKey - YYYY-Qn planning period the prospect was raised for.
// @property {string} substantiation - Why this project is proposed; a user-provided prospect states its own case.
// @property {string} summary - Short project description shown to the user.
// @property {string} userCategoryEm - work or personal.
// @property {string} uuid - Stable identity retained across refreshes, including for rejected ideas.
// Rejected and retired identities are kept so discovery does not propose the same idea repeatedly.
export class ActionProspect {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached, validated prospect from JSON or another ActionProspect instance.
  // @param {object} record - Prospect fields, including UUID, approval status, and category.
  // @param {object} scope - Expected quarterKey; prospects are stored per category rather than per domain leaf.
  // A human-provided prospect cannot claim inferred evidence, mirroring the IntentPossibility default rule.
  constructor(record, scope) {
    const prospect = copyJsonValue(record);
    requireRecord(prospect);
    assertUserCategory(prospect.userCategoryEm);
    for (const field of ["substantiation", "summary", "uuid"]) prospect[field] = requiredText(field, prospect[field]);
    if (!PROSPECT_APPROVALS.includes(prospect.approvalStatus)) throw new Error(`approvalStatus must be one of ${ PROSPECT_APPROVALS.join(", ") }`);
    prospect.priority = prospect.priority ?? "opportunistic";
    if (!PROSPECT_PRIORITIES.includes(prospect.priority)) throw new Error(`priority must be one of ${ PROSPECT_PRIORITIES.join(", ") }`);
    prospect.focusMonths = assertMonthLabels(prospect.focusMonths ?? []);
    prospect.preferredWeekdays = assertWeekdays(prospect.preferredWeekdays ?? []);
    prospect.linkedGoalUuids = assertUuidList("linkedGoalUuids", prospect.linkedGoalUuids ?? []);
    prospect.evidence = prospect.evidence ?? [];
    if (!Array.isArray(prospect.evidence)) throw new Error("evidence must be an array");
    if (prospect.approvalStatus === "humanProvided" && prospect.evidence.length) throw new Error("A user-provided prospect cannot claim inferred evidence");
    prospect.primaryNoteUuid = prospect.primaryNoteUuid ?? null;
    if (prospect.primaryNoteUuid !== null) prospect.primaryNoteUuid = requiredText("primaryNoteUuid", prospect.primaryNoteUuid);
    prospect.capturedAt = normalizedTimestamp(prospect.capturedAt);
    prospect.decidedAt = prospect.decidedAt ? normalizedTimestamp(prospect.decidedAt) : null;
    if (prospect.quarterKey !== scope.quarterKey) throw new Error("Prospect scope does not match");
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(prospect));
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A candidate action within a prospect. It carries its own identity before any Amplenote task exists, so a
//   real task can be linked later without the suggestion changing identity, and approval is kept separate from
//   scheduling because approving work does not put it on a calendar.
// @property {string} approvalStatus - awaitingJudgement, humanApproved, or humanRejected.
// @property {string|null} completedAt - Actual completion time, read from task state rather than predicted.
// @property {string|null} decidedAt - When the user last judged this task.
// @property {number|null} durationMinutes - Positive estimated duration, when known.
// @property {string} importance - Free text describing why this action matters within its prospect.
// @property {number} matchScore - How well this action fits its prospect, 1 through 10.
// @property {number} proposalCount - How many times this action has been proposed to the user.
// @property {string} prospectUuid - Parent ActionProspect identity.
// @property {string|null} scheduledStartAt - Start time once scheduled.
// @property {string} scheduleStatus - unscheduled or scheduled; independent of approval.
// @property {string} substantiation - Why this action is proposed.
// @property {string|null} taskUuid - Amplenote task once one exists; null while the action is only a suggestion.
// @property {string} taskText - The action itself.
// @property {string} uuid - Stable identity, distinct from taskUuid.
// Completion reflects real task state; an approved task is not thereby scheduled.
export class ProspectTask {
  // ----------------------------------------------------------------------------------------------
  // @desc Construct a detached, validated prospect task from JSON or another ProspectTask instance.
  // @param {object} record - Task fields, including its own UUID and its parent prospect UUID.
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
    if (!SCHEDULE_STATUSES.includes(prospectTask.scheduleStatus)) throw new Error("scheduleStatus must be unscheduled or scheduled");
    if (!Number.isFinite(prospectTask.matchScore) || prospectTask.matchScore < 1 || prospectTask.matchScore > 10) {
      throw new Error("matchScore must be between 1 and 10");
    }
    prospectTask.proposalCount = prospectTask.proposalCount ?? 1;
    if (!Number.isInteger(prospectTask.proposalCount) || prospectTask.proposalCount < 1) throw new Error("proposalCount must be a positive integer");
    prospectTask.durationMinutes = prospectTask.durationMinutes ?? null;
    if (prospectTask.durationMinutes !== null && (!Number.isFinite(prospectTask.durationMinutes) || prospectTask.durationMinutes <= 0)) {
      throw new Error("durationMinutes must be a positive number");
    }
    prospectTask.importance = typeof prospectTask.importance === "string" ? prospectTask.importance.trim() : "";
    prospectTask.taskUuid = prospectTask.taskUuid ?? null;
    if (prospectTask.taskUuid !== null) prospectTask.taskUuid = requiredText("taskUuid", prospectTask.taskUuid);
    for (const field of ["completedAt", "decidedAt", "scheduledStartAt"]) {
      prospectTask[field] = prospectTask[field] ? normalizedTimestamp(prospectTask[field]) : null;
    }
    if (prospectTask.scheduleStatus === "scheduled" && !prospectTask.scheduledStartAt) throw new Error("A scheduled task requires scheduledStartAt");
    Object.defineProperties(this, Object.getOwnPropertyDescriptors(prospectTask));
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Validate YYYY-MM focus month labels, so display formatting never leaks into storage.
// @param {Array<string>} months - Proposed month labels.
// @returns {Array<string>} The same labels, verified and deduplicated.
export function assertMonthLabels(months) {
  if (!Array.isArray(months)) throw new Error("focusMonths must be an array");
  for (const month of months) {
    if (typeof month !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("focusMonths must be YYYY-MM labels");
  }
  if (new Set(months).size !== months.length) throw new Error("focusMonths must be unique");
  return months;
}

// ----------------------------------------------------------------------------------------------
// @desc Validate a list of record identities, rejecting duplicates that would make a link ambiguous.
// @param {string} field - Field being validated, named in any error.
// @param {Array<string>} uuids - Proposed identities.
// @returns {Array<string>} The same identities, verified.
export function assertUuidList(field, uuids) {
  if (!Array.isArray(uuids)) throw new Error(`${ field } must be an array`);
  for (const uuid of uuids) requiredText(field, uuid);
  if (new Set(uuids).size !== uuids.length) throw new Error(`${ field } must be unique`);
  return uuids;
}

// ----------------------------------------------------------------------------------------------
// @desc Validate stored weekday enum values, keeping display labels out of the datastore.
// @param {Array<string>} weekdays - Proposed weekday values.
// @returns {Array<string>} The same values, verified and deduplicated.
export function assertWeekdays(weekdays) {
  if (!Array.isArray(weekdays)) throw new Error("preferredWeekdays must be an array");
  for (const weekday of weekdays) {
    if (!WEEKDAYS.includes(weekday)) throw new Error(`preferredWeekdays must be among ${ WEEKDAYS.join(", ") }`);
  }
  if (new Set(weekdays).size !== weekdays.length) throw new Error("preferredWeekdays must be unique");
  return weekdays;
}

// ----------------------------------------------------------------------------------------------
// @desc Validate a user category without conflating it with the selected task domain.
// @returns {string} Valid category.
// Reject misspelled categories before reading or writing a leaf.
export function assertUserCategory(category) {
  if (!USER_CATEGORIES.includes(category)) throw new Error("userCategoryEm must be work or personal");
  return category;
}

// ----------------------------------------------------------------------------------------------
// @desc Copy strict JSON data, rejecting values JSON.stringify would silently discard or change.
// @param {*} value - JSON value or planning model; undefined, non-finite numbers, dates, and cycles are invalid.
// @returns {*} Detached JSON value.
// Preserve extension fields without accepting lossy serialization.
export function copyJsonValue(value) {
  const serialized = JSON.stringify(value, planningJsonReplacer);
  if (serialized === undefined) throw new Error("Planning records must contain JSON data");
  return JSON.parse(serialized);
}

// ----------------------------------------------------------------------------------------------
// @desc Parse ISO calendar dates/timestamps strictly, rejecting invalid dates such as February 30.
// @returns {string} ISO timestamp in UTC.
// Comparable timestamps make stale writes deterministic.
export function normalizedTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    throw new Error("Expected an ISO date or timestamp with timezone");
  }
  const calendarDate = value.slice(0, 10);
  const parsedDate = new Date(`${ calendarDate }T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== calendarDate) throw new Error("Invalid calendar date");
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("Invalid timestamp");
  return timestamp.toISOString();
}

// ----------------------------------------------------------------------------------------------
// @desc Validate original values before JSON's toJSON conversion can hide unsupported objects such as Date.
// @param {string} key - Property being serialized.
// @param {*} item - Value after JSON's optional conversion.
// @returns {*} Valid JSON value.
// Native model instances serialize as enumerable data; plain objects may come from another realm.
function planningJsonReplacer(key, item) {
  const original = this[key];
  if (original === undefined || ["bigint", "function", "symbol"].includes(typeof original)) {
    throw new Error("Planning records must contain only JSON values");
  }
  if (typeof original === "number" && !Number.isFinite(original)) throw new Error("Planning numbers must be finite");
  if (original && typeof original === "object" && !Array.isArray(original)) {
    const prototype = Object.getPrototypeOf(original);
    const isPlain = prototype === null || (prototype.constructor?.name === "Object" && Object.getPrototypeOf(prototype) === null);
    const isPlanningModel = [ActionProspect, GoalSet, IntentPossibility, ProspectTask].some(model => original instanceof model);
    if (!isPlain && !isPlanningModel) throw new Error("Planning records must be JSON objects or planning models");
  }
  return item;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate an RFC 4122 version-4 shaped record UUID without a Node/browser dependency.
// @returns {string} Record identifier; the Math.random fallback is identity-only, never a security token.
// Amplenote host contexts do not guarantee crypto.randomUUID.
export function planningRecordUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 3) | 8).toString(16);
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Reject arrays/null wherever the schema requires an object.
// @param {*} record - Value being validated.
// Share record shape checks across the persistence boundary.
export function requireRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Expected a planning record object");
}

// ----------------------------------------------------------------------------------------------
// @desc Require a nonempty string and trim surrounding whitespace.
// @returns {string} Trimmed text.
// Keep validation messages attached to their field.
export function requiredText(field, value) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${ field } is required`);
  return value.trim();
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve explicit historical quarters or default to the next quarter, including December rollover.
// @param {object} options - { date?, domainName?, domainUuid?, quarter?, year? }; quarter/year must be supplied together.
// @returns {object} { domainName, domainUuid, quarter, quarterKey, year }.
// Persist by stable domain identity and local calendar planning year.
export function resolvePlanScope({ date = new Date(), domainName, domainUuid = null, quarter, year } = {}) {
  if (domainUuid !== null) domainUuid = requiredText("domainUuid", domainUuid);
  domainName = domainUuid === null ? "All Notes" : requiredText("domainName", domainName);
  if ((quarter === undefined) !== (year === undefined)) throw new Error("Supply both quarter and year");
  if (quarter === undefined) {
    const calendarDate = new Date(date);
    if (!Number.isFinite(calendarDate.getTime())) throw new Error("Invalid planning date");
    quarter = Math.floor(calendarDate.getMonth() / 3) + 2;
    year = calendarDate.getFullYear();
    if (quarter === 5) { quarter = 1; year += 1; }
  }
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error("quarter must be 1 through 4");
  if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error("year must be 1900 through 9999");
  return { domainName, domainUuid, quarter, quarterKey: `${ year }-Q${ quarter }`, year };
}
