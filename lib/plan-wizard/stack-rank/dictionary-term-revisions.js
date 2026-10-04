// Track when each definition in the year's user terms dictionary last changed, so a project's ranking can re-rate
// only the tasks that mention a term whose definition changed since that project was last ranked. A rating stored for
// a task that mentions no changed term stays valid, since nothing else the rater was shown about it has changed.
//
// The record lives in its own archived "User terms dictionary {year} revisions" note as a JSON block, apart from the
// dictionary the user reads and edits. It holds a digest of each term's definition and the change sequence at which
// that digest was last seen to differ. Every reader that ranks compares the dictionary it read with the record and
// saves a new sequence when a term was added, rewritten, or removed, whoever changed it: discovery, refinement, or
// the user editing the note by hand. The first record for a year takes every term as it stands as its baseline, so
// starting to track definitions re-rates nothing.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { textContainsTerm } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { dictionaryEntriesFromContent, dictionaryObjectFromEntries,
  readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { textDigest } from "util/text-digest";

export const TERM_REVISIONS_SCHEMA_VERSION = 1;
// The most tasks one project's ranking re-rates for changed terms, so a definition of a word in hundreds of tasks
// spreads its re-rating over later rankings rather than holding up this one. The most recently listed are kept.
export const MAXIMUM_TERM_CHANGED_TASKS = 150;
// Shown above the JSON in the revisions note.
const REVISIONS_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It records a short digest "
  + "of each definition in the user terms dictionary and when it last changed, so a project's tasks are rated again "
  + "only when they mention a term whose definition changed.";

// ----------------------------------------------------------------------------------------------
// @desc Compare the dictionary as read with the year's revisions record, and save a new change sequence for every term
//   added, rewritten, or removed since. The first record for a year is written as a baseline at sequence 0. Updates
//   to the record are serialized through the app's note writer, so two rankings in one session never overwrite each
//   other's observation.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {object} dictionary - Definitions keyed by term, as the ranking read them
//   - {DashboardNoteWriter} [noteWriter] - Serializes updates; the app's shared writer by default
//   - {number} year - The dictionary's year
// @returns {Promise<object>} The record as saved: { revisionsId, schemaVersion, sequence, terms }, terms keyed by
//   lowercased term as { digest, sequence }, digest null for a removed term.
// @throws When the note cannot be read or written, or holds a record this version cannot read.
export function observedTermRevisions(app, { dictionary, noteWriter = DashboardNoteWriter.forApp(app), year }) {
  const name = termRevisionsNoteName(year);
  return noteWriter.update(name, async () => {
    const { noteHandle, payload } = await readJsonNote(app, name);
    const saved = payload ? _readableRevisions(payload, name) : null;
    const revisions = saved ? _revisionsWithDictionary(saved, dictionary) : _baselineRevisions(dictionary);
    if (!saved || revisions.sequence !== saved.sequence) {
      await writeJsonNote(app, { description: REVISIONS_NOTE_DESCRIPTION, name, noteHandle, payload: revisions,
        title: `User terms dictionary ${ year } revisions` });
    }
    return revisions;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Read the year's dictionary as it stands, without creating it, and record its changes in the revisions note.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { noteWriter, year }, as observedTermRevisions takes them.
// @returns {Promise<object|null>} The record as saved, or null when the year has no dictionary note.
// @throws When either note cannot be read, or the revisions cannot be written.
export async function storedDictionaryTermRevisions(app, { noteWriter, year }) {
  const content = await readUserTermsDictionary(app, year);
  if (content === null) return null;
  const dictionary = dictionaryObjectFromEntries(dictionaryEntriesFromContent(content));
  return observedTermRevisions(app, noteWriter ? { dictionary, noteWriter, year } : { dictionary, year });
}

// ----------------------------------------------------------------------------------------------
// @desc The open tasks whose text mentions one of the given terms, as a ranking pools them, the most recently listed
//   kept when there are more than MAXIMUM_TERM_CHANGED_TASKS.
// @param {Array<object>} tasks - Native tasks as read.
// @param {Array<string>} terms - Terms whose definitions changed.
// @returns {Array<object>} { taskText, taskUuid } records, in the order given.
export function termChangedTaskRecords(tasks, terms) {
  if (!terms.length) return [];
  const openTasks = tasks.filter(task => task?.uuid && task.content && !task.completedAt && !task.dismissedAt);
  const mentioningTasks = openTasks.filter(task => terms.some(term => textContainsTerm(task.content, term)));
  const records = mentioningTasks.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
  const keptRecords = records.slice(-MAXIMUM_TERM_CHANGED_TASKS);
  return keptRecords;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the year's revisions note.
// @param {number} year - Calendar year.
// @returns {string} Note name.
export function termRevisionsNoteName(year) {
  return `User terms dictionary ${ year } revisions`;
}

// ----------------------------------------------------------------------------------------------
// @desc The position in a revisions record a ranking records as having read, to compare later changes against.
// @param {object} revisions - A record from observedTermRevisions.
// @returns {object} { revisionsId, sequence }.
export function termRevisionsPosition(revisions) {
  return { revisionsId: revisions.revisionsId, sequence: revisions.sequence };
}

// ----------------------------------------------------------------------------------------------
// @desc The terms whose definitions changed after a recorded position. A position from another record, or none at all,
//   counts from the record's baseline, so a project ranked before tracking began re-rates only for later changes.
// @param {object} revisions - A record from observedTermRevisions.
// @param {object|null|undefined} position - { revisionsId, sequence } a ranking recorded.
// @returns {Array<string>} Lowercased terms, added, rewritten, or removed since.
export function termsChangedSince(revisions, position) {
  const sinceSequence = position?.revisionsId === revisions.revisionsId ? Number(position.sequence) || 0 : 0;
  const changedEntries = Object.entries(revisions.terms).filter(([, entry]) => entry.sequence > sinceSequence);
  const changedTerms = changedEntries.map(([termKey]) => termKey);
  return changedTerms;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc A new record taking every term as it stands as the baseline.
// @param {object} dictionary - Definitions keyed by term.
// @returns {object} A record at sequence 0.
function _baselineRevisions(dictionary) {
  const digestEntries = [..._definitionDigests(dictionary)].map(([termKey, digest]) => [termKey, { digest, sequence: 0 }]);
  return { revisionsId: _newRevisionsId(), schemaVersion: TERM_REVISIONS_SCHEMA_VERSION, sequence: 0,
    terms: Object.fromEntries(digestEntries) };
}

// ----------------------------------------------------------------------------------------------
// @desc Digest each definition, keyed by lowercased term, matching how the dictionary tells terms apart.
// @param {object} dictionary - Definitions keyed by term.
// @returns {Map<string, string>} Digests by lowercased term.
function _definitionDigests(dictionary) {
  const digests = new Map();
  for (const [term, definition] of Object.entries(dictionary || {})) {
    digests.set(term.trim().toLowerCase(), textDigest(String(definition)));
  }
  return digests;
}

// ----------------------------------------------------------------------------------------------
// @desc Make an identity for a new record, so a position taken from a replaced record is never compared with it.
// @returns {string} Ten base-36 characters.
function _newRevisionsId() {
  return Math.random().toString(36).slice(2, 12).padEnd(10, "0");
}

// ----------------------------------------------------------------------------------------------
// @desc Check a saved payload is a record this version reads.
// @param {object} payload - The parsed JSON.
// @param {string} name - Note name, for the error.
// @returns {object} The record.
// @throws When a newer version wrote it, or it is not a record.
function _readableRevisions(payload, name) {
  if (Number(payload.schemaVersion) > TERM_REVISIONS_SCHEMA_VERSION) throw new Error(`"${ name }" was written by a newer version of the plugin`);
  const usable = typeof payload.revisionsId === "string" && Number.isFinite(payload.sequence) && payload.terms
    && typeof payload.terms === "object" && !Array.isArray(payload.terms);
  if (!usable) throw new Error(`"${ name }" holds no readable term revisions`);
  return payload;
}

// ----------------------------------------------------------------------------------------------
// @desc The record after comparing it with the dictionary: every term whose digest differs, including a term added or
//   removed, moves to one new sequence, so one observation is one change however many terms it found.
// @param {object} saved - The record as saved.
// @param {object} dictionary - Definitions keyed by term.
// @returns {object} The same record when nothing changed, else a new one at the next sequence.
function _revisionsWithDictionary(saved, dictionary) {
  const digests = _definitionDigests(dictionary);
  const nextSequence = saved.sequence + 1;
  const termKeys = new Set([...Object.keys(saved.terms), ...digests.keys()]);
  const terms = {};
  let changed = false;
  for (const termKey of termKeys) {
    const savedEntry = saved.terms[termKey];
    const digest = digests.get(termKey) ?? null;
    if (savedEntry && (savedEntry.digest ?? null) === digest) {
      terms[termKey] = savedEntry;
    } else if (savedEntry || digest) {
      terms[termKey] = { digest, sequence: nextSequence };
      changed = true;
    }
  }
  return changed ? { ...saved, sequence: nextSequence, terms } : saved;
}
