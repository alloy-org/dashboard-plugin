/**
 * [Cursor Grok 4.5-authored file, substantially revised by Cursor Opus 5]
 * Created: 2026-08-07 | Model: Cursor Grok 4.5 | Revised: 2026-08-07 | Model: Cursor Opus 5
 * Task: Embed-side Sentry capture helpers for the dashboard, layered over the CDN SDK on window.Sentry
 * Prompt summary: "report every error that could plausibly occur, without wrapping calls that have no way to fail"
 */

import { logIfEnabled } from "util/log";
import { MAX_QUEUED_SENTRY_EVENTS } from "util/sentry-loader";

export { MAX_QUEUED_SENTRY_EVENTS };

// ------------------------------------------------------------------------------------------
// @desc Resolve the Sentry hub only when it is genuinely able to accept events. While the loader's queue is still
//   present, Sentry.init has not run yet and the SDK would silently discard anything handed to it, so callers must
//   queue instead. When no queue exists (dev server, tests) a present window.Sentry is used directly.
// @returns {Object|null} The initialized window.Sentry, or null when events should be queued or dropped
function readySentry() {
  if (typeof window === "undefined" || !window.Sentry) return null;
  if (Array.isArray(window.__dashboardSentryQueue) && window.__dashboardSentryReady !== true) return null;
  return window.Sentry;
}

// ------------------------------------------------------------------------------------------
// @desc Coerce an arbitrary thrown value into an Error so Sentry always receives a stack-bearing object.
// @param {Error|*} errorLike - Thrown value, rejection reason, or plain message string
// @returns {Error} The original Error, or a new Error carrying its message
function errorFromThrown(errorLike) {
  if (errorLike instanceof Error) return errorLike;
  return new Error(errorLike?.message || String(errorLike));
}

// ------------------------------------------------------------------------------------------
// @desc Hold an event for the loader to flush once Sentry.init has run. Silently drops events once the cap is hit.
// @param {Object} entry - Event descriptor as built by captureDashboardException / captureDashboardMessage
// @returns {undefined} Always undefined: no Sentry event id exists yet for a queued event
function queueEntry(entry) {
  if (typeof window === "undefined" || !Array.isArray(window.__dashboardSentryQueue)) return undefined;
  if (window.__dashboardSentryQueue.length < MAX_QUEUED_SENTRY_EVENTS) window.__dashboardSentryQueue.push(entry);
  return undefined;
}

// ------------------------------------------------------------------------------------------
// @desc Send one event descriptor to Sentry, or queue it when the SDK is not ready yet. Every reporting path in the
//   embed funnels through here, and every failure of the reporting itself is swallowed: telemetry must never be able
//   to break dashboard init or a widget's error recovery.
// @param {Object} entry - An event descriptor with the following properties:
// - {Error} [error] - Exception to report; when present the event is captured as an exception
// - {string} [message] - Message to report when there is no exception
// - {string} [level] - Sentry severity level, defaulting to the SDK's own default for the capture type
// - {Object} [tags] - Indexed key/value pairs, used for grouping and filtering in the Sentry UI
// - {Object} [extras] - Non-indexed context attached to the event for debugging
// @returns {string|undefined} Sentry event id when the event was sent, otherwise undefined
function captureEntry(entry) {
  const sentry = readySentry();
  if (!sentry || typeof sentry.withScope !== "function") return queueEntry(entry);
  try {
    return sentry.withScope(scope => {
      for (const [name, value] of Object.entries(entry.tags || {})) {
        if (value != null) scope.setTag(name, String(value));
      }
      for (const [name, value] of Object.entries(entry.extras || {})) {
        if (value != null) scope.setExtra(name, value);
      }
      if (entry.level) scope.setLevel(entry.level);
      if (entry.error) return sentry.captureException(entry.error);
      return sentry.captureMessage(String(entry.message));
    });
  } catch (reportingError) {
    logIfEnabled("[sentry] failed to capture dashboard event:", reportingError);
    return undefined;
  }
}

// ------------------------------------------------------------------------------------------
// @desc Split a caller's context object into Sentry tags (the low-cardinality fields we want to group and count by)
//   and extras (everything else, kept for debugging a single event).
// @param {Object} context - Free-form context; `source`, `action` and `widgetId` become tags, the rest become extras
// @returns {{ extras: Object, tags: Object }} Tag and extra maps ready for captureEntry
function scopeFromContext(context) {
  const { action, source, widgetId, ...extras } = context;
  const tags = { "dashboard.action": action, "dashboard.source": source, "dashboard.widgetId": widgetId };
  return { extras, tags };
}

// ------------------------------------------------------------------------------------------
// @desc Report an exception raised inside the embed. Safe no-op when no DSN was configured at build time or when the
//   loader was blocked, and queues the event when the SDK is still loading.
// @param {Error|*} error - Thrown value; non-Errors are wrapped so the event still carries a stack
// @param {Object} [context={}] - Tags and extras; `source` labels the origin (e.g. "widget-boundary", "init-empty")
// @returns {string|undefined} Sentry event id when the event was sent, otherwise undefined
export function captureDashboardException(error, context = {}) {
  const { extras, tags } = scopeFromContext(context);
  return captureEntry({ error: errorFromThrown(error), extras, tags });
}

// ------------------------------------------------------------------------------------------
// @desc Report a condition that is not itself an exception — an init payload that resolved without data, or a load
//   that has stalled — where an embed-side stack would point at the observer rather than the cause.
// @param {string} message - Human-readable description, also used as the Sentry grouping title
// @param {Object} [context={}] - Tags and extras; `level` overrides the default "error" severity
// @returns {string|undefined} Sentry event id when the event was sent, otherwise undefined
export function captureDashboardMessage(message, context = {}) {
  const { level, ...rest } = context;
  const { extras, tags } = scopeFromContext(rest);
  return captureEntry({ extras, level: level || "error", message, tags });
}

// ------------------------------------------------------------------------------------------
// @desc Report a failure that happened on the plugin side of the bridge. The plugin cannot report for itself: its
//   code runs in the host app's JavaScript context, where installing a second Sentry client would both miss the
//   embed's context and capture Amplenote's own errors. Instead onEmbedCall hands back the message and stack, and
//   this rebuilds an Error carrying those plugin-side frames — without them Sentry would group every bridge failure
//   under the same embed-side call site and show no clue as to which plugin code actually threw.
// @param {Object} failure - Failure envelope with the following properties:
// - {string} error|message - Message reported by the plugin side
// - {string} [errorStack|stack] - Stack captured where the exception was originally thrown
// @param {Object} [context={}] - Tags and extras; `action` names the bridge call or init branch that failed
// @returns {string|undefined} Sentry event id when the event was sent, otherwise undefined
export function capturePluginFailure(failure, context = {}) {
  const message = failure?.error || failure?.message || `${ context.action || "plugin" } failed`;
  const pluginStack = failure?.errorStack || failure?.stack;
  const error = new Error(String(message));
  if (pluginStack) error.stack = String(pluginStack);
  return captureDashboardException(error, context);
}

// ------------------------------------------------------------------------------------------
// @desc Watch one embed→plugin bridge call and report its failure, whether that arrives as a rejection or as the
//   resolved `{ embedCallFailed }` envelope onEmbedCall returns (mobile hosts do not reliably reject). Most widgets
//   consume bridge results without inspecting them for that envelope, so without this observer a failing
//   getNoteContent or setSetting produces no signal at all and we cannot see which API calls fail how often.
//   Deliberately passive: the caller receives the original thenable untouched, because the host bridge returns a
//   non-spec-compliant thenable (see util/all-notes-tasks) that must not be re-wrapped. If observing that thenable
//   yields nothing, we simply report nothing.
// @param {string} actionType - Name of the plugin action / Amplenote API method being called
// @param {*} result - Whatever window.callAmplenotePlugin returned, usually a promise or promise-like
// @returns {*} The untouched `result`, so this can wrap a call site transparently
export function observeEmbedCall(actionType, result) {
  Promise.resolve(result).then(value => {
    if (value && typeof value === "object" && value.embedCallFailed) {
      capturePluginFailure(value, { action: actionType, source: "bridge-call" });
    }
  }, error => {
    captureDashboardException(error, { action: actionType, source: "bridge-reject" });
  });
  return result;
}

// ------------------------------------------------------------------------------------------
// @desc Wire the embed's reporting into the loader installed by embed-html.js. The loader owns the window error
//   listeners (it runs before this bundle evaluates, so it also covers failures during module evaluation) and the
//   pre-init queue; this registers the drain hook it calls after Sentry.init and drains immediately in case the SDK
//   was already ready before React mounted.
// @returns {void}
export function installDashboardSentryReporting() {
  if (typeof window === "undefined") return;
  window.__dashboardDrainSentryQueue = drainSentryQueue;
  // The CDN SDK usually settles after this point, so subscribe rather than relying on the snapshot alone. By the time
  // the resolution actually fires, setLoggingEnabled has typically run, so this line is the one that reaches console.
  window.__dashboardSentryStatusChanged = status => logIfEnabled(describeSentryStatus(status));
  drainSentryQueue();
}

// ------------------------------------------------------------------------------------------
// @desc Render the loader's status record as one console-ready line. Kept separate from logging so both the snapshot
//   read and the change subscription produce identically-shaped output.
// @param {Object|undefined} status - window.__dashboardSentryStatus, or undefined when no loader was emitted
// @returns {string} Human-readable one-line summary
function describeSentryStatus(status) {
  if (!status) return "[sentry] loader absent — no SENTRY_DSN at build time, so no exceptions will be reported";
  const elapsed = status.elapsedMs == null ? "" : ` after ${ status.elapsedMs }ms`;
  const detail = status.detail ? ` (${ status.detail })` : "";
  if (status.state === "ready") return `[sentry] SDK loaded and initialized${ elapsed }, environment "${ status.environment }"`;
  if (status.state === "loading") return `[sentry] SDK still loading from ${ status.cdnUrl }, environment "${ status.environment }"`;
  return `[sentry] SDK unavailable — ${ status.state }${ detail }${ elapsed }; exceptions will not be reported`;
}

// ------------------------------------------------------------------------------------------
// @desc Log whether Sentry actually loaded. Exists because none of that is visible at the moment it happens: the
//   loader snippet runs before this bundle evaluates, and logIfEnabled stays muted until the init payload supplies
//   the Console Logging setting. Callers therefore invoke this right after setLoggingEnabled, and the subscription
//   registered by installDashboardSentryReporting covers a CDN that settles later still.
// @returns {void}
export function logSentryStatus() {
  if (typeof window === "undefined") return;
  logIfEnabled(describeSentryStatus(window.__dashboardSentryStatus));
}

// ------------------------------------------------------------------------------------------
// @desc Send every event queued while the SDK was loading, then discard the queue so later captures go direct.
//   No-op while Sentry is still unavailable, leaving the queued events in place for the next attempt.
// @returns {void}
export function drainSentryQueue() {
  if (typeof window === "undefined" || !Array.isArray(window.__dashboardSentryQueue)) return;
  if (!readySentry()) return;
  const queued = window.__dashboardSentryQueue;
  window.__dashboardSentryQueue = null;
  for (const entry of queued) captureEntry(entry);
}
