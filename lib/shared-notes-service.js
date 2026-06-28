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
// @desc Build a noteUUID -> collaborators index from the array app.getPeople() returns. Each
//   `person` (see appendix_i#person) carries `sharing.notes`: the UUIDs of the notes shared with
//   that person, plus the `name`/`avatar` we want to display. We invert that mapping so the widget
//   can look up "who is this note shared with?" by note UUID in O(1).
// @param {Array<Object>} people - person objects from app.getPeople(), each with `sharing.notes`.
// @returns {Map<string, Array<Object>>} Map of note UUID -> de-duplicated person objects.
// [Claude claude-opus-4-8] Task: index getPeople() by the notes each person is shared on
// Prompt: "build and store an index of notesUUID => person... use the person to show their avatar"
export function buildPeopleIndexByNote(people) {
  const index = new Map();
  if (!Array.isArray(people)) return index;
  for (const person of people) {
    const noteUUIDs = person?.sharing?.notes;
    if (!Array.isArray(noteUUIDs)) continue;
    for (const noteUUID of noteUUIDs) {
      if (!noteUUID) continue;
      const existing = index.get(noteUUID);
      if (!existing) {
        index.set(noteUUID, [person]);
      } else if (!existing.some(entry => entry.uuid === person.uuid)) {
        existing.push(person);
      }
    }
  }
  return index;
}

// ----------------------------------------------------------------------------------------------
// @desc Fetch the people known to the current user via app.getPeople() and return them indexed by
//   note UUID. Degrades gracefully: hosts that predate getPeople (or that throw) yield an empty
//   index, in which case collaboratorsForNote falls back to the dev-fixture `shareAccess` names.
// @param {Object} app - Amplenote app bridge that may expose getPeople().
// @returns {Promise<Map<string, Array<Object>>>} Note-UUID -> person index, possibly empty.
// [Claude claude-opus-4-8] Task: retrieve collaborators through app.getPeople and cache by note
// Prompt: "there is now documentation... app.getPeople... build and store an index of notesUUID => person"
// [Claude claude-opus-4-8] Task: time and console.log the getPeople-to-index build so we can judge cost
// Prompt: "Console log the time used to iterate over all getPeople and note updated times, so we can
//   understand how much time is consumed building the index"
export async function fetchPeopleIndexByNote(app) {
  if (typeof app?.getPeople !== "function") return new Map();
  try {
    const startMs = Date.now();
    const people = await app.getPeople();
    const index = buildPeopleIndexByNote(people);
    const elapsedMs = Date.now() - startMs;
    const peopleCount = Array.isArray(people) ? people.length : 0;
    console.log(`[SharedNotes] Built note<>person index from ${ peopleCount } people across ${ index.size } notes in ${ elapsedMs }ms`);
    logIfEnabled(`[SharedNotes] getPeople -> ${ peopleCount } people across ${ index.size } notes`);
    return index;
  } catch (error) {
    logIfEnabled("[SharedNotes] getPeople failed:", error);
    return new Map();
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Derive up-to-two-letter initials for a text avatar when a person has no `avatar.text` and
//   no `avatar.image`. Single-word names contribute their first two letters; multi-word names use
//   the first letter of the first and last word.
// @param {string} name - A collaborator display name (may be an email address).
// @returns {string} An uppercase 1–2 character initials string, or "?" when no name is available.
// [Claude claude-opus-4-8] Task: fall back to initials when a person has no avatar image or text
// Prompt: "use the details about the person to show their avatar when it is present"
export function avatarTextFromName(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ----------------------------------------------------------------------------------------------
// @desc Fallback collaborator-name reader for hosts/dev fixtures without getPeople(). The dev
//   fixtures attach a `shareAccess` array (see dev-sample-notes.js); production noteHandles do not,
//   so this yields [] in production and the getPeople index (collaboratorsForNote) is used instead.
// @param {Object} noteHandle - A noteHandle for a shared note.
// @returns {Array<string>} De-duplicated collaborator display names, or [] when none are available.
// [Claude claude-opus-4-8] Task: keep the dev-fixture shareAccess path as a getPeople fallback
// Prompt: "build and store an index of notesUUID => person... show their avatar when it is present"
export function collaboratorNamesFromNoteHandle(noteHandle) {
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
// @desc Resolve the collaborators to display for a note into a uniform { name, avatar } shape the
//   widget can render. Prefers the getPeople index (real names + avatars); when a note has no
//   indexed people it falls back to the dev-fixture `shareAccess` names with no avatar metadata.
// @param {Object} params - Named lookup options.
// @param {Object} params.noteHandle - The noteHandle being rendered.
// @param {Map<string, Array<Object>>} params.peopleIndex - noteUUID -> person index from getPeople.
// @returns {Array<Object>} Entries of the form { name, avatar }, where avatar is the person's
//   avatar object ({ image } or { text }) or null when only a name is known.
// [Claude claude-opus-4-8] Task: combine the getPeople index with the shareAccess fallback per note
// Prompt: "use the details about the person to show their avatar when it is present"
export function collaboratorsForNote({ noteHandle, peopleIndex }) {
  const people = peopleIndex?.get?.(noteHandle?.uuid);
  if (Array.isArray(people) && people.length > 0) {
    return people.map(person => ({ avatar: person.avatar || null, name: person.name || person.uuid }));
  }
  return collaboratorNamesFromNoteHandle(noteHandle).map(name => ({ avatar: null, name }));
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
// @returns {Promise<{notes: Array<Object>, sharerNames: Array<string>}>} `notes` are entries of the
//   form { collaborators, noteHandle, updatedMs }, where each `collaborators` entry is a
//   { name, avatar } object (see collaboratorsForNote); `sharerNames` is the alphabetical list of
//   every person who has shared a note (for the widget's "Filter on user..." select).
// [Claude claude-opus-4-8] Task: query shared notes recently changed by collaborators
// Prompt: "use app.filterNotes with group of at least 'shared'... order by 'updated'... filter by the
//   user's task domain selected"
// [Claude claude-opus-4-8] Task: attach getPeople-derived collaborators (name + avatar) per note
// Prompt: "build and store an index of notesUUID => person... use the person to show their avatar"
// [Claude claude-opus-4-8] Task: return the full list (capped at MAX_SCAN) plus the cross-person
//   sharer names so the widget can page and filter client-side
// Prompt: "Add a select... with each of the people the user has shared notes with... Add pagination"
export async function findCollaboratorUpdatedNotes({ app, maxNotes = Infinity,
    taskDomainUUID = null, onlyWithTasks = false }) {
  const group = sharedNotesGroupParam(onlyWithTasks);
  // Fetch the shared notes and the people index concurrently; the index is reused across results.
  const [handles, peopleIndex] = await Promise.all([
    app.filterNotes({ group, taskDomainUUID }, "updated"),
    fetchPeopleIndexByNote(app),
  ]);
  const results = [];
  const seen = new Set();

  for await (const noteHandle of iterableFromFilterNotes(handles)) {
    if (!noteHandle?.uuid || seen.has(noteHandle.uuid)) continue;
    seen.add(noteHandle.uuid);
    if (!noteUpdatedByCollaborator(noteHandle)) continue;
    results.push({ collaborators: collaboratorsForNote({ noteHandle, peopleIndex }), noteHandle,
      updatedMs: timestampMsFromValue(noteHandle.updated) });
    if (results.length >= maxNotes) break;
    if (seen.size >= MAX_SCAN) break;
  }

  const sharerNames = sharerNamesFromIndex(peopleIndex);
  logIfEnabled(`[SharedNotes] group:${ group } taskDomain:${ taskDomainUUID } found:${ results.length } sharers:${ sharerNames.length }`);
  return { notes: results, sharerNames };
}

// ----------------------------------------------------------------------------------------------
// @desc Collect every distinct sharer display name from the getPeople-derived note<>person index
//   and return them sorted alphabetically (case-insensitive) for the widget's person-filter select.
// @param {Map<string, Array<Object>>} peopleIndex - noteUUID -> person[] index (see buildPeopleIndexByNote).
// @returns {Array<string>} Alphabetical, de-duplicated sharer names.
// [Claude claude-opus-4-8] Task: derive the alphabetical cross-person filter list from the index
// Prompt: "Add a select... with each of the people the user has shared notes with... alphabetical"
export function sharerNamesFromIndex(peopleIndex) {
  const names = new Set();
  if (!peopleIndex || typeof peopleIndex.values !== "function") return [];
  for (const people of peopleIndex.values()) {
    for (const person of people) {
      const name = person?.name || person?.uuid;
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
