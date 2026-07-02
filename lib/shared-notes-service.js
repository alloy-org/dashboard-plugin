// [Claude claude-opus-4-8-authored file]
// Prompt summary: "build a Shared Notes widget showing notes shared with collaborators, sourced from
// app.getPeople() (each person's sharing.notes) hydrated via Promise.all(app.findNote), gating on
// 'a collaborator updated it since we last saw it' only for the default 'All collaborators' view"

import { logIfEnabled } from "util/log";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// ------------------------------------------------------------------------------------------
// @desc filterNotes `group` param for the shared-notes query: "taskLists" to restrict to notes that
//   carry tasks, or "" (no group constraint) otherwise. The "shared" group is intentionally NOT used —
//   in practice it returns only a small task-domain slice (e.g. 22 of 1704 shared notes). The primary
//   note list now comes from app.getPeople() (see findCollaboratorUpdatedNotes); this param only
//   supplies the "taskLists" token for the has-tasks intersection (taskBearingNoteUuids).
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
// @desc The set of note UUIDs that carry tasks, for the "Has tasks" toggle. A single
//   filterNotes("taskLists") call yields the domain's task-bearing notes; we intersect that with the
//   shared-notes set rather than probing getNoteTasks once per shared note.
// @param {Object} app - Amplenote app bridge exposing filterNotes.
// @param {string|null} taskDomainUUID - Active task domain to scope the query to (optional).
// @returns {Promise<Set<string>>} Note UUIDs that have at least one task list.
export async function taskBearingNoteUuids(app, taskDomainUUID) {
  const group = sharedNotesGroupParam(true); // "taskLists"
  const filterOptions = taskDomainUUID ? { group, taskDomainUUID } : { group };
  const uuids = new Set();
  // filterNotes returns a plain array or async iterable; for await...of accepts both.
  for await (const handle of (await app.filterNotes(filterOptions, "updated"))) {
    if (handle?.uuid) uuids.add(handle.uuid);
  }
  return uuids;
}

// ------------------------------------------------------------------------------------------
// @desc The notes the current user shares with collaborators, sourced from app.getPeople() (each
//   person's `sharing.notes`) rather than the "shared" filterNotes group, which only surfaces a small
//   slice. Every distinct shared note UUID is hydrated in parallel via app.findNote so we get its
//   current `updated`/`changed`/`active` stamps, and each entry is flagged `updatedSinceSeen` — true
//   when a collaborator edited it after we last changed OR opened it. The service returns ALL resolved
//   shared notes (newest-updated first) with that flag; the widget decides what to show: the default
//   "All collaborators" view keeps only `updatedSinceSeen` notes, while filtering on one person shows
//   every note shared with them. onlyWithTasks additionally intersects with taskBearingNoteUuids.
// @param {Object} params - { app, maxNotes, taskDomainUUID, onlyWithTasks }.
// @returns {notes: Array<Object>, sharerNames: Array<string>} each `notes` entry is
//   { ...noteHandle, activeMs, collaborators, openedAt, updatedMs, updatedSinceSeen }; `sharerNames`
//   is the alphabetical list of collaborators across the returned notes (for the person filter).
export async function findCollaboratorUpdatedNotes({ app, maxNotes = Infinity,
    taskDomainUUID = null, onlyWithTasks = false }) {
  const startMs = Date.now();
  // People (and the note<>person index) drive which notes are "shared"; the has-tasks set is fetched
  // in parallel only when the toggle is on.
  const [peopleIndex, taskUuids] = await Promise.all([
    fetchPeopleIndexByNote(app),
    onlyWithTasks ? taskBearingNoteUuids(app, taskDomainUUID) : Promise.resolve(null),
  ]);
  const sharedUuids = [...peopleIndex.keys()];

  // Hydrate every shared note UUID in parallel. findNote resolves the current handle (name/updated/
  // changed/active) or null when the note is unreachable (deleted, or shared-with-us and unresolvable).
  const handles = await Promise.all(sharedUuids.map(uuid => app.findNote({ uuid }).catch(() => null)));

  const unresolved = [];
  const entries = [];
  let sinceSeenCount = 0;
  for (let index = 0; index < handles.length; index++) {
    const noteHandle = handles[index];
    if (!noteHandle?.uuid) { unresolved.push(sharedUuids[index]); continue; }
    if (taskUuids && !taskUuids.has(noteHandle.uuid)) continue;
    const collaborators = collaboratorsForNote({ noteHandle, peopleIndex });
    // `updatedSinceSeen` is the "a collaborator touched it since I last saw it" gate; we compute it for
    // every note but only the default "All collaborators" view applies it (the widget decides).
    const seenSince = updatedSinceSeen(noteHandle);
    if (seenSince) sinceSeenCount++;
    // `updatedMs` is the last edit by anyone (a collaborator); `activeMs`/`openedAt` is when the current user last opened it.
    entries.push({ ...noteHandle, activeMs: timestampMsFromValue(noteHandle.active), collaborators,
      openedAt: noteHandle.active || null, updatedMs: timestampMsFromValue(noteHandle.updated), updatedSinceSeen: seenSince });
  }

  // Most-recently-updated first, so both the gated default view and a per-person view lead with the
  // freshest notes; the widget paginates from here.
  entries.sort((a, b) => b.updatedMs - a.updatedMs);
  const notes = Number.isFinite(maxNotes) ? entries.slice(0, maxNotes) : entries;
  const sharerNames = sharerNamesFromNotes(notes);

  console.log(`[SharedNotes] shared:${ sharedUuids.length } resolved:${ handles.length - unresolved.length } unresolved:${ unresolved.length } updatedSinceSeen:${ sinceSeenCount } returned:${ notes.length } sharers:${ sharerNames.length } onlyWithTasks:${ onlyWithTasks } in ${ Date.now() - startMs }ms`);
  // When a shared note can't be resolved by findNote the two data sources disagree — log those UUIDs
  // and, for context, how many notes each person is known to share (from the getPeople index).
  if (unresolved.length > 0) {
    logIfEnabled(`[SharedNotes] ${ unresolved.length } shared note(s) could not be resolved by findNote:`, unresolved);
    logIfEnabled("[SharedNotes] known note UUIDs per person (from getPeople):", peopleNoteUuidSummary(peopleIndex));
  }
  return { notes, sharerNames };
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
