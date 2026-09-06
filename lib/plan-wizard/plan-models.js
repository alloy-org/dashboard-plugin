// Validate serializable chosen goals and inferred intent possibilities.

export const GUIDE_SCHEMA_VERSION = 1;
export const USER_CATEGORIES = ["work", "personal"];

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
    if (!isPlain && !(original instanceof GoalSet) && !(original instanceof IntentPossibility)) {
      throw new Error("Planning records must be JSON objects or planning models");
    }
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
