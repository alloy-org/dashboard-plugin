// The notes a generated task idea may be created in: the user's task-bearing notes that changed recently, read with one
// filterNotes call so the idea prompt can name where each idea belongs without a second provider round trip. Amplenote's
// calendar requires a note UUID on every new task it is offered, so an idea without a destination cannot be suggested.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { arrayFromFilterNotesResult } from "util/note-handles";
import { logIfEnabled } from "util/log";

// A note left untouched longer than this is unlikely to be where the user keeps a project's current work.
export const DESTINATION_NOTE_RECENCY_DAYS = 90;
// Enough notes to cover the places a project's work plausibly lives, while keeping the idea prompt short.
export const MAXIMUM_DESTINATION_NOTES = 60;
// The longest note name the prompt repeats; anything longer is cut, since the UUID is what the model cites.
const MAXIMUM_NOTE_NAME_CHARACTERS = 80;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const STARTER_NOTES_TAG = "starter-notes";

// ----------------------------------------------------------------------------------------------
// @desc Read the task-bearing notes updated within DESTINATION_NOTE_RECENCY_DAYS, most recently updated first. Notes the
//   Dashboard writes for itself and starter sample notes are left out, since neither is where a user files real work.
//   A read that fails yields no notes, so idea generation proceeds and falls back to the project's own note.
// @param {object} app - Host-compatible Amplenote API exposing filterNotes.
// @param {object} [options] - An object with the following properties:
//   - {string|null} [domainUuid=null] - Task Domain to scope the read to, null for every task-bearing note
//   - {number} [maximumNoteCount=MAXIMUM_DESTINATION_NOTES] - The most notes returned
//   - {Date} [now=new Date()] - Reference time the recency window is measured from
// @returns {Promise<Array<object>>} Notes as { name, uuid }.
export async function recentTaskDestinationNotes(app, { domainUuid = null, maximumNoteCount = MAXIMUM_DESTINATION_NOTES,
    now = new Date() } = {}) {
  if (typeof app?.filterNotes !== "function") return [];
  const filterOptions = domainUuid ? { group: "taskLists", taskDomainUUID: domainUuid } : { group: "taskLists" };
  let handles = [];
  try {
    handles = await arrayFromFilterNotesResult(app.filterNotes(filterOptions, "updated"));
  } catch (error) {
    logIfEnabled("[task-destination-notes] filterNotes failed", error?.message);
    return [];
  }
  const oldestUpdatedMilliseconds = now.getTime() - DESTINATION_NOTE_RECENCY_DAYS * MILLISECONDS_PER_DAY;
  const eligibleHandles = handles.filter(handle => handle?.uuid && !_isExcludedNote(handle)
    && _updatedMilliseconds(handle) >= oldestUpdatedMilliseconds);
  const newestFirst = eligibleHandles.sort((first, second) => _updatedMilliseconds(second) - _updatedMilliseconds(first));
  const keptHandles = newestFirst.slice(0, maximumNoteCount);
  const destinationNotes = keptHandles.map(handle => ({ name: _promptNoteName(handle.name), uuid: handle.uuid }));
  return destinationNotes;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Whether a note is one the Dashboard writes for itself or starter sample content, judged from its tags.
// @param {object} handle - Note handle from filterNotes, carrying its tags.
// @returns {boolean} True when the note should not receive generated tasks.
function _isExcludedNote(handle) {
  const tags = Array.isArray(handle.tags) ? handle.tags.map(String) : [];
  const excludedRoots = [DASHBOARD_NOTE_TAG, STARTER_NOTES_TAG];
  return tags.some(tag => excludedRoots.some(root => tag === root || tag.startsWith(`${ root }/`)));
}

// ----------------------------------------------------------------------------------------------
// @desc A note name as the prompt lists it: single-line, trimmed, and cut to MAXIMUM_NOTE_NAME_CHARACTERS.
// @param {string|null} name - The note's name.
// @returns {string} Display name, "Untitled note" when the note has none.
function _promptNoteName(name) {
  const singleLine = String(name || "").replace(/\s+/g, " ").trim();
  if (!singleLine) return "Untitled note";
  return singleLine.length > MAXIMUM_NOTE_NAME_CHARACTERS ? `${ singleLine.slice(0, MAXIMUM_NOTE_NAME_CHARACTERS - 1) }…` : singleLine;
}

// ----------------------------------------------------------------------------------------------
// @desc When a note was last updated, in milliseconds since the epoch, 0 when the handle carries no usable time.
// @param {object} handle - Note handle from filterNotes.
// @returns {number} Milliseconds since the epoch.
function _updatedMilliseconds(handle) {
  const value = handle.updated ?? handle.changed ?? null;
  if (value == null) return 0;
  const milliseconds = typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}
