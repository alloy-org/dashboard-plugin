// Shared constants and validation utilities for the plan wizard's independently defined persisted model classes.

export const GUIDE_SCHEMA_VERSION = 1;
export const PLAN_MODEL_MARKER = Symbol.for("dashboard.plan-wizard.model");
export const USER_CATEGORIES = ["work", "personal"];
// Source enum spellings are preserved exactly as the brainstorming note wrote them.
export const PROSPECT_APPROVALS = ["awaitingJudgement", "humanAffirmed", "humanProvided", "humanRejected",
  "humanRetired"];
export const PROSPECT_PRIORITIES = ["monthFocus", "notNow", "quarterFocus", "stayWarm"];
export const PROSPECT_TASK_APPROVALS = ["awaitingJudgement", "humanApproved", "humanRejected"];
export const SCHEDULE_STATUSES = ["unscheduled", "scheduled"];
// Weekday enum stored as documented; display labels are formatted at the UI edge.
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

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
    const isPlanningModel = original[PLAN_MODEL_MARKER] === true;
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
