// Map each durable job type to the handler that runs it, since a saved job carries a type rather than a function.
// Only handlers that exist are registered, so a job saved by a later version, or of a type this version has dropped,
// stays in its queue note untouched instead of failing. Every handler must be host-compatible: the host's bounded
// runtime may run the same jobs as the Dashboard.

// The durable job types this version runs. Project maintenance adds the first of them.
export const DASHBOARD_WORK_HANDLERS = [];

// ----------------------------------------------------------------------------------------------
// @desc Validate handlers and index them by job type. A handler is an object with the following properties:
//   - {string} type - The job type it runs
//   - {function} run - Async ({ context, job, signal }) => result. job carries { attempt, cursor, desiredRevision,
//     entityId, input, key, scopeKey, type }. A result { status: "yielded", checkpoint } saves progress to resume from;
//     { status: "superseded" } retires the job; any other result completes it, optionally naming the output revision
//     as result.revision. Throw to fail the attempt; see workFailureClassification for how errors are classified
//   - {function} [appliedRevision] - Async ({ context, job }) => the revision its output store already reflects, so
//     an attempt interrupted after writing its output completes without running again
//   - {function} [applyResult] - Async ({ context, job, result }) writing a completed result to its store before the
//     job is acknowledged; a run may instead write its output itself
//   - {string} [category="maintenance"] - Priority category its jobs are enqueued at
//   - {string|null} [resource=null] - Resource held for the whole attempt; leave null when the run's provider and app
//     calls take their own permits through the context's dispatchers, so it never holds a permit it also waits for
//   - {function} [validateInput] - (input) => void, throwing when a request's input is unusable
// @param {Array<object>} [handlers=DASHBOARD_WORK_HANDLERS] - Handlers to register.
// @returns {Map<string, object>} Handlers by job type, with defaults filled in.
// @throws When a handler lacks a type or run, or two handlers claim one type.
export function workHandlerRegistry(handlers = DASHBOARD_WORK_HANDLERS) {
  const handlersByType = new Map();
  for (const handler of handlers) {
    if (typeof handler?.type !== "string" || !handler.type) throw new Error("A work handler needs a type");
    if (typeof handler.run !== "function") throw new Error(`Work handler "${ handler.type }" needs a run function`);
    if (handlersByType.has(handler.type)) throw new Error(`Two work handlers claim type "${ handler.type }"`);
    handlersByType.set(handler.type, { category: "maintenance", resource: null, ...handler });
  }
  return handlersByType;
}
