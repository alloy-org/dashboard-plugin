// [Claude claude-opus-4-8-authored file]
// Prompt summary: "build a Shared Notes widget showing notes recently updated by a collaborator,
// using app.filterNotes with the 'shared' group (optionally 'hasTasks') ordered by 'updated'"

import { logIfEnabled } from "util/log";

// Hard cap on how many filterNotes results we inspect, protecting slower mobile
// clients from walking an unbounded shared-note list when few qualify.
const MAX_SCAN = 100;
const DEFAULT_MAX_NOTES = 5;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ----------------------------------------------------------------------------------------------
// @desc Build the comma-separated filterNotes `group` parameter for shared-note discovery. The
//   "shared" group is always present; "taskLists" is appended when the user only wants shared
//   notes that contain tasks. The token names mirror Amplenote's FILTER_GROUP values (SHARED =
//   "shared", HAS_TASKS = "taskLists"); see ample-web lib/ample-util/filter-group.js.
// @param {boolean} onlyWithTasks - Whether to restrict results to shared notes that have tasks.
// @returns {string} A filterNotes group string such as "shared" or "shared,taskLists".
// [Claude claude-opus-4-8] Task: toggle the has-tasks group via a checkbox in the Shared Notes widget
// Prompt: "checkbox to show only notes that have tasks, which toggles whether that group is included"
export function sharedNotesGroupParam(onlyWithTasks) {
  return onlyWithTasks ? "shared,taskLists" : "shared";
}

// ----------------------------------------------------------------------------------------------
// @desc Convert an ISO 8601 date-time string (or epoch number) into milliseconds since the epoch.
//   Returns 0 for missing or unparseable values so comparisons stay well-defined.
// @param {string|number|null|undefined} value - A noteHandle timestamp (e.g. `updated`/`changed`).
// @returns {number} Milliseconds since the epoch, or 0 when the value cannot be parsed.
// [Claude claude-opus-4-8] Task: normalize noteHandle updated/changed timestamps for comparison
// Prompt: "noteHandles where the updated timestamp is greater than the changed timestamp"
export function timestampMsFromValue(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a note was last touched by a collaborator rather than the current user.
//   `updated` is the last modification by anyone; `changed` is the last modification by this user.
//   When `updated` is strictly greater than `changed`, someone else edited after we did.
// @param {Object} noteHandle - A noteHandle with `updated` and `changed` timestamps.
// @returns {boolean} True when a collaborator updated the note after the current user.
// [Claude claude-opus-4-8] Task: surface notes a collaborator changed after the current user
// Prompt: "looking for noteHandles where the updated timestamp is greater than the changed timestamp"
export function noteUpdatedByCollaborator(noteHandle) {
  const updatedMs = timestampMsFromValue(noteHandle?.updated);
  const changedMs = timestampMsFromValue(noteHandle?.changed);
  return updatedMs > 0 && updatedMs > changedMs;
}

// ----------------------------------------------------------------------------------------------
// @desc SCAFFOLD — return the display names of the collaborators a note is shared with.
//
//   I could not find a plugin API that exposes collaborator identities: the noteHandle from
//   noteHandleFromNote (ample-web lib/ample-notes-store/util/note-handle.js) carries only a boolean
//   `shared` flag (set when `note.accounts > 1`), and no method in the app interface
//   (use-get-app-interface.js) returns a note's recipients/sharers. Per Bill, this is left
//   scaffolded for him to wire up the real retrieval. Until then it reads the `shareAccess` array
//   the dev fixtures attach (see dev-sample-notes.js) so the widget is demonstrable in dev; that
//   field is NOT present on production noteHandles, so production currently yields [].
// @param {Object} noteHandle - A noteHandle for a shared note.
// @returns {Array<string>} De-duplicated collaborator display names, or [] when none are available.
// [Claude claude-opus-4-8] Task: scaffold collaborator-name retrieval for the Shared Notes widget
// Prompt: "leave it scaffolded and I'll fill it in soon"
export function collaboratorNamesFromNoteHandle(noteHandle) {
  // TODO(bill): replace this dev-fixture read with the real collaborator-retrieval API once known.
  const source = noteHandle?.shareAccess;
  if (!Array.isArray(source)) return [];
  const names = [];
  for (const entry of source) {
    const name = typeof entry === "string" ? entry : entry?.name || entry?.email || entry?.displayName;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

// ----------------------------------------------------------------------------------------------
// @desc Human-readable "last updated" label, relative for recent changes and an absolute date for
//   older ones. Accepts an explicit `nowMs` so callers (and tests) stay deterministic.
// @param {number} updatedMs - The note's `updated` timestamp in milliseconds.
// @param {number} nowMs - The reference "now" timestamp in milliseconds.
// @returns {string} A label such as "just now", "5m ago", "3h ago", "2d ago", or a locale date.
// [Claude claude-opus-4-8] Task: format the right-aligned last-updated label for each shared note
// Prompt: "On the right side of the second line, we should show when the note was last updated"
export function lastUpdatedLabelFromMs(updatedMs, nowMs) {
  if (!updatedMs) return "";
  const deltaMs = nowMs - updatedMs;
  if (deltaMs < MINUTE_MS) return "just now";
  if (deltaMs < HOUR_MS) return `${ Math.floor(deltaMs / MINUTE_MS) }m ago`;
  if (deltaMs < DAY_MS) return `${ Math.floor(deltaMs / HOUR_MS) }h ago`;
  if (deltaMs < 7 * DAY_MS) return `${ Math.floor(deltaMs / DAY_MS) }d ago`;
  return new Date(updatedMs).toLocaleDateString();
}

// ----------------------------------------------------------------------------------------------
// @desc Iterate filterNotes output, which may be a plain array or an async iterable depending on
//   the host. `for await...of` accepts both, so we hand back whatever filterNotes returned.
// @param {Array|AsyncIterable} result - The value returned from app.filterNotes.
// @returns {Array|AsyncIterable} The same value, suitable for `for await...of`.
function iterableFromFilterNotes(result) {
  return result || [];
}

// ----------------------------------------------------------------------------------------------
// @desc Find the most recently collaborator-updated shared notes for the active task domain. Calls
//   app.filterNotes with the "shared" group (plus "hasTasks" when requested) ordered by "updated",
//   then keeps only notes whose `updated` is newer than `changed` (i.e. a collaborator edited after
//   the current user), de-duplicating by uuid and capping at `maxNotes`.
// @param {Object} params - Named lookup options.
// @param {Object} params.app - Amplenote app bridge exposing filterNotes.
// @param {number} params.maxNotes - Maximum number of notes to return.
// @param {string|null} params.taskDomainUUID - Active task domain UUID from the dashboard.
// @param {boolean} params.onlyWithTasks - When true, restrict to shared notes that have tasks.
// @returns {Promise<Array<Object>>} Entries of the form { collaborators, noteHandle, updatedMs }.
// [Claude claude-opus-4-8] Task: query shared notes recently changed by collaborators
// Prompt: "use app.filterNotes with group of at least 'shared'... order by 'updated'... filter by the
//   user's task domain selected"
export async function findCollaboratorUpdatedNotes({ app, maxNotes = DEFAULT_MAX_NOTES,
    taskDomainUUID = null, onlyWithTasks = false }) {
  const group = sharedNotesGroupParam(onlyWithTasks);
  const handles = await app.filterNotes({ group, taskDomainUUID }, "updated");
  const results = [];
  const seen = new Set();

  for await (const noteHandle of iterableFromFilterNotes(handles)) {
    if (!noteHandle?.uuid || seen.has(noteHandle.uuid)) continue;
    seen.add(noteHandle.uuid);
    if (!noteUpdatedByCollaborator(noteHandle)) continue;
    results.push({ collaborators: collaboratorNamesFromNoteHandle(noteHandle), noteHandle,
      updatedMs: timestampMsFromValue(noteHandle.updated) });
    if (results.length >= maxNotes) break;
    if (seen.size >= MAX_SCAN) break;
  }

  logIfEnabled(`[SharedNotes] group:${ group } taskDomain:${ taskDomainUUID } found:${ results.length }`);
  return results;
}
