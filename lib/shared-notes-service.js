// [Claude claude-opus-4-8-authored file]
// Prompt summary: "build a Shared Notes widget showing notes recently updated by a collaborator,
// using app.filterNotes with the 'shared' group (optionally 'hasTasks') ordered by 'updated'"

import { logIfEnabled } from "util/log";

const MAX_SCAN = 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ------------------------------------------------------------------------------------------
// @desc filterNotes `group` param; "taskLists" appended when restricting to notes that have tasks.
export function sharedNotesGroupParam(onlyWithTasks) {
  return onlyWithTasks ? "shared,taskLists" : "shared";
}

// ------------------------------------------------------------------------------------------
// @desc Convert an ISO 8601 string (or epoch number) to ms; 0 when missing/unparseable.
// @param {string|number|null|undefined} value - A noteHandle timestamp (e.g. `updated`/`changed`).
// @returns {number} Milliseconds since the epoch, or 0 when the value cannot be parsed.
export function timestampMsFromValue(value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// ------------------------------------------------------------------------------------------
// @desc True when a collaborator edited after the current user: `updated` (anyone) > `changed` (us).
// @param {Object} noteHandle - A noteHandle with `updated` and `changed` timestamps.
// @returns {boolean} True when a collaborator updated the note after the current user.
export function noteUpdatedByCollaborator(noteHandle) {
  const updatedMs = timestampMsFromValue(noteHandle.updated);
  const changedMs = timestampMsFromValue(noteHandle.changed);
  return updatedMs > 0 && updatedMs > changedMs;
}

// ------------------------------------------------------------------------------------------
// @desc Invert app.getPeople() into a noteUUID -> people map so the widget can answer "who is
//   this note shared with?" in O(1). Each person's `sharing.notes` lists the UUIDs shared to them.
// @param {Array<Object>} people - person objects from app.getPeople(), each with `sharing.notes`.
// @returns {Map<string, Array<Object>>} Map of note UUID -> de-duplicated person objects.
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

// ------------------------------------------------------------------------------------------
// @desc Fetch app.getPeople() and return it indexed by note UUID, timing the build so we can gauge
//   its cost.
// @param {Object} app - Amplenote app bridge exposing getPeople().
// @returns {Promise<Map<string, Array<Object>>>} Note-UUID -> person index, possibly empty.
export async function fetchPeopleIndexByNote(app) {
  const startMs = Date.now();
  const people = await app.getPeople();
  const index = buildPeopleIndexByNote(people);
  const peopleCount = Array.isArray(people) ? people.length : 0;
  console.log(`[SharedNotes] Built note<>person index from ${ peopleCount } people across ${ index.size } notes in ${ Date.now() - startMs }ms`);
  return index;
}

// ------------------------------------------------------------------------------------------
// @desc Two-letter initials for a text avatar: a single word uses its first two letters, multiple
//   words use the first letter of the first and last. "?" when no usable name is available.
// @param {string} name - A collaborator display name (may be an email address).
// @returns {string} An uppercase 1–2 character initials string, or "?".
export function avatarTextFromName(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ------------------------------------------------------------------------------------------
// @desc Collaborators to render for a note as { name, avatar }, looked up in the getPeople index.
// @param {Object} params - { noteHandle, peopleIndex } (peopleIndex is noteUUID -> person[]).
// @returns {Array<Object>} Entries of the form { name, avatar }, or [] when the note has no people.
export function collaboratorsForNote({ noteHandle, peopleIndex }) {
  const people = peopleIndex?.get?.(noteHandle.uuid);
  if (!Array.isArray(people)) return [];
  return people.map(person => ({ avatar: person.avatar || null, name: person.name || person.uuid }));
}

// ------------------------------------------------------------------------------------------
// @desc Human-readable "last updated" label: relative for recent edits, an absolute date for older
//   ones. `nowMs` is passed in so callers and tests stay deterministic.
// @param {number} updatedMs - The note's `updated` timestamp in milliseconds.
// @param {number} nowMs - The reference "now" timestamp in milliseconds.
// @returns {string} A label such as "just now", "5m ago", "3h ago", "2d ago", or a locale date.
export function lastUpdatedLabelFromMs(updatedMs, nowMs) {
  if (!updatedMs) return "";
  const deltaMs = nowMs - updatedMs;
  if (deltaMs < MINUTE_MS) return "just now";
  if (deltaMs < HOUR_MS) return `${ Math.floor(deltaMs / MINUTE_MS) }m ago`;
  if (deltaMs < DAY_MS) return `${ Math.floor(deltaMs / HOUR_MS) }h ago`;
  if (deltaMs < 7 * DAY_MS) return `${ Math.floor(deltaMs / DAY_MS) }d ago`;
  if (deltaMs < 30 * DAY_MS) return new Date(updatedMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return new Date(updatedMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ------------------------------------------------------------------------------------------
// @desc Find the most recently collaborator-updated shared notes for the active task domain:
//   filterNotes (shared, optionally +taskLists, ordered by "updated") intersected with the
//   collaborator-edited predicate, de-duplicated by uuid, capped at `maxNotes`/MAX_SCAN.
// @param {Object} params - { app, maxNotes, taskDomainUUID, onlyWithTasks }.
// @returns {Promise<{notes: Array<Object>, sharerNames: Array<string>}>} `notes` are
//   { collaborators, noteHandle, updatedMs }; `sharerNames` is the alphabetical cross-person list.
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

  // filterNotes returns a plain array or async iterable; for await...of accepts both.
  for await (const noteHandle of handles || []) {
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

// ------------------------------------------------------------------------------------------
// @desc Distinct sharer names from the note<>person index, sorted alphabetically (case-insensitive)
//   for the widget's person-filter select.
// @param {Map<string, Array<Object>>} peopleIndex - noteUUID -> person[] index.
// @returns {Array<string>} Alphabetical, de-duplicated sharer names.
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
