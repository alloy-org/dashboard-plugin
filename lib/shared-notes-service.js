// [Claude claude-opus-4-8-authored file]
// Prompt summary: "build a Shared Notes widget showing notes recently updated by a collaborator,
// using app.filterNotes with the 'shared' group (optionally 'hasTasks') ordered by 'updated'"

import { logIfEnabled } from "util/log";

const MAX_SCAN = 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// Only walk back this far through the updated-ordered notes; collaborator activity older than a
// quarter isn't worth surfacing, and stopping here bounds the scan to recent notes.
const THREE_MONTHS_MS = 90 * DAY_MS;

// ------------------------------------------------------------------------------------------
// @desc filterNotes `group` param for the shared-notes query: "taskLists" to restrict to notes that
//   carry tasks, or "" (no group constraint) otherwise. The "shared" group is intentionally NOT used —
//   in practice it returns only a small task-domain slice (e.g. 22 of 1704 shared notes), so we scan
//   the domain's updated-ordered notes and gate shared-ness via the getPeople index instead.
export function sharedNotesGroupParam(onlyWithTasks) {
  return onlyWithTasks ? "taskLists" : "";
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
// @desc True when a collaborator edited after the current user: `updated` (anyone) > `changed` (us) or `updated (anyone)` > `opened at` (us)
// @param {Object} noteHandle - A noteHandle with `updated` and `changed` timestamps.
// @returns {boolean} True when a collaborator updated the note after the current user.
export function updatedSinceSeen(noteHandle) {
  const updatedMs = timestampMsFromValue(noteHandle.updated);
  const changedMs = timestampMsFromValue(noteHandle.changed);
  const openedMs = timestampMsFromValue(noteHandle.active);
  return updatedMs > changedMs || updatedMs > openedMs;
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
  // How many of those people actually carry a (non-empty) sharing.notes array — the widget can only
  // attribute a collaborator to a note when at least one person lists that note under sharing.notes.
  const peopleWithNotes = Array.isArray(people)
    ? people.filter(person => Array.isArray(person?.sharing?.notes) && person.sharing.notes.length > 0).length : 0;
  console.log(`[SharedNotes] Built note<>person index from ${ peopleCount } people (${ peopleWithNotes } with a notes array) across ${ index.size } notes in ${ Date.now() - startMs }ms`);
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
// @desc Find the most recently collaborator-updated shared notes for the active task domain. We ask
//   filterNotes for the domain's notes ordered by "updated" (newest first, edited by anyone) and walk
//   them only back to THREE_MONTHS_MS, then stop — bounding the scan to recent activity rather than
//   the whole (potentially thousands-strong) shared corpus. A note is kept when it is shared (present
//   in the getPeople index, or flagged `shared`) AND a collaborator edited it since we last saw it
//   (updatedSinceSeen). The "shared" filterNotes group is deliberately avoided (it only surfaces a
//   small slice); onlyWithTasks narrows the query to the "taskLists" group.
// @param {Object} params - { app, maxNotes, taskDomainUUID, onlyWithTasks }.
// @returns {notes: Array<Object>, sharerNames: Array<string>} each `notes` entry is
//   { activeMs, collaborators, updatedMs, ...noteHandle } — the note's own attrs (e.g. `uuid`/`name`)
//   are spread onto the entry; `sharerNames` is the alphabetical list of collaborators on the results.
export async function findCollaboratorUpdatedNotes({ app, maxNotes = Infinity,
    taskDomainUUID = null, onlyWithTasks = false }) {
  const group = sharedNotesGroupParam(onlyWithTasks);
  const filterOptions = group ? { group, taskDomainUUID } : { taskDomainUUID };
  // Fetch the domain's updated-ordered notes and the people index concurrently.
  const [handles, peopleIndex] = await Promise.all([
    app.filterNotes(filterOptions, "updated"),
    fetchPeopleIndexByNote(app),
  ]);
  const cutoffMs = Date.now() - THREE_MONTHS_MS;
  const results = [];
  const seen = new Set();
  let scanned = 0, notShared = 0, qualified = 0, stoppedAtCutoff = false;
  // UUIDs shared (by flag) but absent from the getPeople index — surfaced with best-effort (empty) attribution, and logged so we can see when the two data sources disagree.
  const sharedButUnknownCollaborator = [];

  // filterNotes returns a plain array or async iterable; for await...of accepts both. Notes arrive
  // newest-updated first, so once we cross the 3-month window every later note is older too — stop.
  for await (const noteHandle of handles) {
    if (!noteHandle?.uuid || seen.has(noteHandle.uuid)) continue;
    seen.add(noteHandle.uuid);
    const updatedMs = timestampMsFromValue(noteHandle.updated);
    if (updatedMs && updatedMs < cutoffMs) { stoppedAtCutoff = true; break; }
    scanned++;

    const collaborators = collaboratorsForNote({ noteHandle, peopleIndex });
    // Gate on shared-ness: updatedSinceSeen alone would admit solo notes via its opened-since clause.
    if (collaborators.length === 0 && noteHandle.shared !== true) { notShared++; continue; }
    if (!updatedSinceSeen(noteHandle)) continue;
    qualified++;
    if (collaborators.length === 0) sharedButUnknownCollaborator.push(noteHandle.uuid);

    // `updatedMs` is the last edit by anyone (the collaborator); `activeMs` is when the current user last opened the note.
    results.push({ activeMs: timestampMsFromValue(noteHandle.active), collaborators, updatedMs, ...noteHandle });
    if (results.length >= maxNotes) break;
    if (seen.size >= MAX_SCAN) break;
  }

  // Derive the person-filter list from the notes we actually return (not the whole getPeople index)
  // so the filter only offers collaborators who appear on at least one shown note.
  const sharerNames = sharerNamesFromNotes(results);
  console.log(`[SharedNotes] taskDomain:${ taskDomainUUID } onlyWithTasks:${ onlyWithTasks } scanned:${ scanned } notShared:${ notShared } qualified:${ qualified } returned:${ results.length } sharers:${ sharerNames.length } stoppedAtCutoff:${ stoppedAtCutoff }`);
  // When a shared note has no collaborator in getPeople, the two sources disagree — log the note UUIDs
  // and, for context, how many notes each person is known to share (from the getPeople index).
  if (sharedButUnknownCollaborator.length > 0) {
    logIfEnabled(`[SharedNotes] ${ sharedButUnknownCollaborator.length } shared note(s) had no collaborator in getPeople:`, sharedButUnknownCollaborator);
    logIfEnabled("[SharedNotes] known note UUIDs per person (from getPeople):", peopleNoteUuidSummary(peopleIndex));
  }
  return { notes: results, sharerNames };
}

// ------------------------------------------------------------------------------------------
// @desc Invert the noteUUID -> person[] index back into a per-person summary of the note UUIDs each
//   collaborator is known to share, for diagnostics when a qualifying note has no matching person.
// @param {Map<string, Array<Object>>} peopleIndex - noteUUID -> person[] index.
// @returns {Array<Object>} Entries of { name, count, noteUuids } sorted by descending share count.
export function peopleNoteUuidSummary(peopleIndex) {
  const byPerson = new Map();
  if (peopleIndex && typeof peopleIndex.entries === "function") {
    for (const [noteUUID, people] of peopleIndex.entries()) {
      for (const person of people) {
        const name = person?.name || person?.uuid || "(unknown)";
        if (!byPerson.has(name)) byPerson.set(name, []);
        byPerson.get(name).push(noteUUID);
      }
    }
  }
  return [...byPerson.entries()].map(([name, noteUuids]) => ({ name, count: noteUuids.length, noteUuids }))
    .sort((a, b) => b.count - a.count);
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

// ------------------------------------------------------------------------------------------
// @desc Distinct collaborator names drawn from the notes we actually return, sorted alphabetically
//   (case-insensitive). Used for the person-filter select so it only lists people who appear on at
//   least one shown note (unlike sharerNamesFromIndex, which spans every shared note).
// @param {Array<Object>} notes - Result entries, each with a `collaborators` array of { name }.
// @returns {Array<string>} Alphabetical, de-duplicated collaborator names present in `notes`.
export function sharerNamesFromNotes(notes) {
  const names = new Set();
  if (!Array.isArray(notes)) return [];
  for (const note of notes) {
    for (const collaborator of note.collaborators || []) {
      if (collaborator.name) names.add(collaborator.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// ------------------------------------------------------------------------------------------
// @desc Normalize a list of pinned-note UUIDs (as read from the archive note) into a clean array:
//   drop non-strings/empties and de-duplicate while preserving order.
// @param {Array|null|undefined} raw - Candidate UUID list parsed from the pins archive note.
// @returns {Array<string>} De-duplicated, truthy note UUIDs (order preserved).
export function parsePinnedNoteUuids(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter(uuid => typeof uuid === "string" && uuid))];
}

// ------------------------------------------------------------------------------------------
// @desc Reorder result notes so pinned ones float to the top of the list (and thus the top of the
//   first page), each group keeping its original "updated"-descending order. Non-mutating.
// @param {Array<Object>} notes - Result entries carrying the note's `uuid` (spread from noteHandle).
// @param {Set<string>|Array<string>} pinnedUuids - UUIDs the user has pinned.
// @returns {Array<Object>} A new array: pinned notes first, then the rest.
export function orderNotesPinnedFirst(notes, pinnedUuids) {
  if (!Array.isArray(notes)) return [];

  const pinnedSet = pinnedUuids instanceof Set ? pinnedUuids : new Set(pinnedUuids || []);
  const pinned = [], rest = [];
  for (const note of notes) {
    (pinnedSet.has(note.uuid) ? pinned : rest).push(note);
  }
  return [...pinned, ...rest];
}
