// Keep a bounded record of what the Dashboard work scheduler did: a ring of recent events, counters by event type,
// and run and wait timings by job type. An operator inspecting the queue reads it without Console Logging enabled.
// Events carry only allow-listed scalar fields, so no prompt, note text, or provider response body is retained, and
// anything resembling a key or token is redacted both when recorded and again when exported.
import { logIfEnabled } from "util/log";

// How many recent events are kept before the oldest is dropped.
export const DIAGNOSTIC_EVENT_LIMIT = 200;
// The fields an event may carry; any other field is dropped when the event is recorded.
const EVENT_FIELDS = ["at", "attempt", "category", "durationMilliseconds", "effectiveCategory", "error", "jobKey", "jobType",
  "resource", "scopeKey", "status", "type", "waitedMilliseconds", "waitingReason"];
// The fields an exported widget mount registration may carry.
const MOUNT_FIELDS = ["admittedAt", "committedAt", "generation", "nearViewport", "queuedCategory", "registeredAt", "releasedBy",
  "requestedAt", "status", "visible", "watchdogActive", "widgetId"];
// The fields an exported runtime session may carry.
const SESSION_FIELDS = ["sessionId", "startedAt"];
// Event types that mean a job finished doing work, which an operator reads as the queue making progress.
const PROGRESS_EVENT_TYPES = ["completed", "yielded"];
// The fields an exported job snapshot may carry.
const JOB_FIELDS = ["attempt", "category", "effectiveCategory", "enqueuedAt", "key", "resource", "scopeKey", "startedAt",
  "status", "type", "waitingExplanation", "waitingReason"];
// Longest string any diagnostic field keeps.
const MAXIMUM_FIELD_CHARACTERS = 160;
// A run of characters long enough to be a key, token, or other credential. Hyphens break a run, so UUIDs survive.
const CREDENTIAL_PATTERN = /[A-Za-z0-9_]{32,}/g;

// ----------------------------------------------------------------------------------------------
// @desc Collects scheduler events and notifies subscribers once per batch of events.
export default class DashboardWorkDiagnostics {
  clock; // {function} Returns epoch milliseconds; injected for tests.
  countersByType = {}; // {object} How many events of each type were recorded.
  eventLimit; // {number} How many events the ring keeps.
  events = []; // {Array<object>} The most recent sanitized events, oldest first.
  lastProgressAt = null; // {number|null} When a job last completed or checkpointed, in epoch milliseconds.
  listeners = new Set(); // {Set<function>} Called after a batch of recorded events.
  notifyScheduled = false; // {boolean} True while a notification is queued for the current batch.
  timingsByJobType = {}; // {object} { runs, totalRunMilliseconds, maximumRunMilliseconds, totalWaitMilliseconds, waits }.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct an empty record.
  // @param {object} [options] - { clock = Date.now, eventLimit = DIAGNOSTIC_EVENT_LIMIT }.
  constructor({ clock = Date.now, eventLimit = DIAGNOSTIC_EVENT_LIMIT } = {}) {
    Object.assign(this, { clock, eventLimit });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A sanitized copy of the record, with the given scheduler, mount, and session state, for an operator to copy
  //   or download. Every job, mount, and session field is passed through an allow-list again here.
  // @param {object|null} [schedulerSnapshot] - From DashboardWorkScheduler#snapshot.
  // @param {object} [options] - { mountSnapshot, session }: from WidgetMountCoordinator#snapshot, and { sessionId,
  //   startedAt } for the runtime.
  // @returns {object} { diagnostics, exportedAt, mounts, scheduler, session }.
  exportSnapshot(schedulerSnapshot = null, { mountSnapshot = null, session = null } = {}) {
    const diagnostics = this.snapshot();
    diagnostics.events = diagnostics.events.map(event => sanitizedFields(event, EVENT_FIELDS));
    const scheduler = schedulerSnapshot ? { ...schedulerSnapshot,
      jobs: (schedulerSnapshot.jobs || []).map(job => sanitizedFields(job, JOB_FIELDS)),
      scopeKey: sanitizedValue(schedulerSnapshot.scopeKey) } : null;
    const mounts = mountSnapshot ? (mountSnapshot.widgets || []).map(widget => sanitizedFields(widget, MOUNT_FIELDS)) : null;
    const exportedSession = session ? sanitizedFields(session, SESSION_FIELDS) : null;
    return { diagnostics, exportedAt: new Date(this.clock()).toISOString(), mounts, scheduler, session: exportedSession };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record one scheduler event. A failure is also logged when Console Logging is on.
  // @param {object} event - { type, jobKey, jobType, ... } with any of the allow-listed fields.
  record(event) {
    const sanitized = sanitizedFields({ at: this.clock(), ...event }, EVENT_FIELDS);
    this.events.push(sanitized);
    if (this.events.length > this.eventLimit) this.events.shift();
    this.countersByType[sanitized.type] = (this.countersByType[sanitized.type] || 0) + 1;
    if (PROGRESS_EVENT_TYPES.includes(sanitized.type)) this.lastProgressAt = sanitized.at;
    this._recordTimings(sanitized);
    if (sanitized.type === "failed") logIfEnabled("[dashboard-work] job failed", sanitized);
    this._scheduleNotify();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc A copy of the counters, events, last progress time, and timings.
  // @returns {object} { counters, events, lastProgressAt, timings }.
  snapshot() {
    const timings = {};
    for (const [jobType, timing] of Object.entries(this.timingsByJobType)) timings[jobType] = { ...timing };
    const events = this.events.map(event => ({ ...event }));
    return { counters: { ...this.countersByType }, events, lastProgressAt: this.lastProgressAt, timings };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Call a listener after each batch of recorded events.
  // @param {function} listener - Called with no arguments.
  // @returns {function} Removes the listener.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Add an event's run or wait duration to its job type's timings.
  // @param {object} event - A sanitized event.
  _recordTimings(event) {
    if (!event.jobType) return;
    const hasRun = typeof event.durationMilliseconds === "number";
    const hasWait = typeof event.waitedMilliseconds === "number";
    if (!hasRun && !hasWait) return;
    const timing = this.timingsByJobType[event.jobType]
      || { maximumRunMilliseconds: 0, runs: 0, totalRunMilliseconds: 0, totalWaitMilliseconds: 0, waits: 0 };
    if (hasRun) {
      timing.runs += 1;
      timing.totalRunMilliseconds += event.durationMilliseconds;
      timing.maximumRunMilliseconds = Math.max(timing.maximumRunMilliseconds, event.durationMilliseconds);
    }
    if (hasWait) {
      timing.waits += 1;
      timing.totalWaitMilliseconds += event.waitedMilliseconds;
    }
    this.timingsByJobType[event.jobType] = timing;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Queue one notification for every event recorded before it runs.
  _scheduleNotify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    Promise.resolve().then(() => {
      this.notifyScheduled = false;
      for (const listener of [...this.listeners]) listener();
    });
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Keep only the allowed fields of a record, each reduced to a sanitized scalar.
// @param {object} record - Event or job snapshot.
// @param {Array<string>} fields - Field names to keep.
// @returns {object} A new object holding the allowed fields that are present.
export function sanitizedFields(record, fields) {
  const sanitized = {};
  for (const field of fields) {
    if (record?.[field] === undefined) continue;
    sanitized[field] = sanitizedValue(record[field]);
  }
  return sanitized;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce one diagnostic value to a scalar: numbers, booleans, and null pass through; an Error keeps its message;
//   strings are shortened and anything resembling a credential is redacted; other values are dropped to null.
// @param {*} value - Value to sanitize.
// @returns {string|number|boolean|null} The sanitized value.
export function sanitizedValue(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  const text = value instanceof Error ? value.message : value;
  if (typeof text !== "string") return null;
  const redacted = text.replace(CREDENTIAL_PATTERN, "[redacted]");
  return redacted.length > MAXIMUM_FIELD_CHARACTERS ? `${ redacted.slice(0, MAXIMUM_FIELD_CHARACTERS - 1) }…` : redacted;
}
