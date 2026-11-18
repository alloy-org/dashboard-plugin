// Keep, per task domain, the latest time each task or generated idea was shown as a suggestion, in a small archived
// "Dashboard Shown Suggestions" note. Goal Coach skips what the agenda showed recently, and the ranker prefers
// candidates not shown recently, so only the latest time matters: a showing replaces the time held for each task or
// idea, and times older than the retention window are dropped. Recording a showing is one small note write, so it
// never reads or rewrites the quarterly Project Tasks note. A note this version cannot read, including one a later
// version wrote, is never overwritten.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";

export const SHOWN_SUGGESTION_SCHEMA_VERSION = 1;
// Names the note of the "All Notes" fallback, which suggests tasks without a task domain.
const ALL_NOTES_DOMAIN_KEY = "all-notes";
// Most tasks and ideas kept, latest shown first, so a long-lived domain's note stays one small write.
const MAXIMUM_SHOWN_ENTRIES = 500;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// Shown above the JSON in the note.
const SHOWN_SUGGESTION_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It keeps the "
  + "latest time each task and generated idea was suggested, so the Dashboard can avoid repeating a suggestion it "
  + "showed recently.";
// Days a shown time is kept; well beyond the window within which a recent suggestion is held back.
const SHOWN_RETENTION_DAYS = 14;

// ----------------------------------------------------------------------------------------------
// @desc Name a domain's shown suggestions note.
// @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
// @returns {string} Note name.
export function shownSuggestionNoteName(domainUuid) {
  return `Dashboard Shown Suggestions ${ domainUuid || ALL_NOTES_DOMAIN_KEY }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The suggestion log entries a project record carries, from the shown times this store holds.
// @param {object} shown - { ideas, tasks }, each an object of ISO times keyed by idea ID or task UUID.
// @returns {Array<object>} { suggestedAt, taskUuid } and { ideaId, suggestedAt } entries.
export function suggestionEntriesFromShown(shown) {
  const taskEntries = Object.entries(shown?.tasks || {}).map(([taskUuid, suggestedAt]) => ({ suggestedAt, taskUuid }));
  const ideaEntries = Object.entries(shown?.ideas || {}).map(([ideaId, suggestedAt]) => ({ ideaId, suggestedAt }));
  return [...taskEntries, ...ideaEntries];
}

// ----------------------------------------------------------------------------------------------
// @desc Reads and saves each domain's latest shown times.
export default class SuggestionShownStore {
  app; // {object} Host-compatible Amplenote API.
  noteWriter; // {DashboardNoteWriter} Serializes each shown suggestions note's read-then-write changes.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a store, sharing the app's note writer unless given another.
  // @param {object} options - { app, noteWriter }.
  constructor({ app, noteWriter = DashboardNoteWriter.forApp(app) }) {
    Object.assign(this, { app, noteWriter });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a domain's latest shown times. A note that is missing or cannot be read holds none.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @returns {Promise<object>} { ideas, tasks }, each an object of ISO times keyed by idea ID or task UUID.
  async read(domainUuid) {
    const { payload } = await this._readNote(domainUuid);
    return { ideas: { ...payload?.ideas }, tasks: { ...payload?.tasks } };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record that tasks and ideas were shown, in one write. Each keeps the later of its held time and shownAt.
  //   Times more than SHOWN_RETENTION_DAYS before the latest time held are dropped, as are the oldest beyond
  //   MAXIMUM_SHOWN_ENTRIES. Measuring from the latest time held rather than the clock keeps a showing recorded for a
  //   day other than today, which is what shownAt names, from being dropped as it is written.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @param {object} options - { ideaIds, shownAt, taskUuids }: shownAt is an ISO time.
  // @returns {Promise<void>}
  // @throws When the note cannot be read, was written by a newer version, or cannot be written.
  async record(domainUuid, { ideaIds = [], shownAt, taskUuids = [] }) {
    if (!shownAt || (!ideaIds.length && !taskUuids.length)) return;
    const name = shownSuggestionNoteName(domainUuid);
    await this.noteWriter.update(name, async () => {
      const { noteHandle, payload } = await this._readNote(domainUuid, { strict: true });
      const earliestKeptAt = _earliestKeptAt([payload?.ideas, payload?.tasks], shownAt);
      const ideas = _retainedShownTimes(payload?.ideas, ideaIds, { earliestKeptAt, shownAt });
      const tasks = _retainedShownTimes(payload?.tasks, taskUuids, { earliestKeptAt, shownAt });
      await writeJsonNote(this.app, { description: SHOWN_SUGGESTION_NOTE_DESCRIPTION, name, noteHandle,
        payload: { ideas, schemaVersion: SHOWN_SUGGESTION_SCHEMA_VERSION, tasks }, title: "Dashboard shown suggestions" });
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a domain's note and its payload.
  // @param {string|null} domainUuid - Task domain UUID, or null for the All Notes fallback.
  // @param {object} [options] - { strict = false }: true throws for a note this version cannot read, so a write never
  //   overwrites it; otherwise such a note reads as holding nothing.
  // @returns {Promise<object>} { noteHandle, payload }, both null when the note does not exist.
  async _readNote(domainUuid, { strict = false } = {}) {
    const name = shownSuggestionNoteName(domainUuid);
    try {
      const { noteHandle, payload } = await readJsonNote(this.app, name);
      if (payload && Number(payload.schemaVersion) > SHOWN_SUGGESTION_SCHEMA_VERSION) {
        throw new Error(`"${ name }" was written by a newer version of the plugin`);
      }
      return { noteHandle, payload };
    } catch (error) {
      if (strict) throw error;
      return { noteHandle: null, payload: null };
    }
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The earliest shown time kept: SHOWN_RETENTION_DAYS before the latest of shownAt and the times held.
// @param {Array<object|undefined>} heldTimeMaps - ISO times keyed by identity, as the note held them.
// @param {string} shownAt - ISO time of the showing being recorded.
// @returns {string} ISO time.
function _earliestKeptAt(heldTimeMaps, shownAt) {
  const heldTimes = heldTimeMaps.flatMap(heldTimes => Object.values(heldTimes || {}));
  const latestTime = [shownAt, ...heldTimes].filter(time => typeof time === "string").sort().pop();
  const latestMilliseconds = Date.parse(latestTime);
  if (!Number.isFinite(latestMilliseconds)) return shownAt;
  return new Date(latestMilliseconds - SHOWN_RETENTION_DAYS * MILLISECONDS_PER_DAY).toISOString();
}

// ----------------------------------------------------------------------------------------------
// @desc Merge newly shown identities into held shown times, keeping the later time for each, dropping times before
//   the retention window, and keeping only the latest MAXIMUM_SHOWN_ENTRIES.
// @param {object|undefined} heldTimes - ISO times keyed by identity, as the note held them.
// @param {Array<string>} identities - Task UUIDs or idea IDs just shown.
// @param {object} options - { earliestKeptAt, shownAt }: ISO times.
// @returns {object} ISO times keyed by identity.
function _retainedShownTimes(heldTimes, identities, { earliestKeptAt, shownAt }) {
  const shownTimes = { ...heldTimes };
  for (const identity of identities) {
    if (identity && !(shownTimes[identity] > shownAt)) shownTimes[identity] = shownAt;
  }
  const recentEntries = Object.entries(shownTimes).filter(([, time]) => typeof time === "string" && time >= earliestKeptAt);
  const latestFirst = recentEntries.sort(([, first], [, second]) => second.localeCompare(first));
  const keptEntries = latestFirst.slice(0, MAXIMUM_SHOWN_ENTRIES);
  return Object.fromEntries(keptEntries);
}
