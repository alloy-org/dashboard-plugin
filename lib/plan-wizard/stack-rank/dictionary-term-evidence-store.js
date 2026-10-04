// Keep the latest evidence collected for each dictionary term in an archived "User terms dictionary {year} evidence"
// note as a JSON block, so a refinement run in a later job, or a later session, reasons over the passages a lookup
// found without searching the notebook again. One record is kept per term, keyed by the lowercased term, and a new
// collection replaces it. Passages are the bulk of the note, so once the records' passages together pass
// MAXIMUM_STORED_PASSAGE_CHARACTERS the oldest records give theirs up first; a record without passages keeps its
// sources and digests, which is all a later collection needs to tell whether its sources changed. A record also keeps
// how the term's last refinement ended, carried over when a new collection replaces it; a refinement that read the
// passages gives them up, since only new evidence brings the term back to refinement.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";

export const TERM_EVIDENCE_SCHEMA_VERSION = 1;
// The most passage text all records keep together, well inside what one note write accepts.
export const MAXIMUM_STORED_PASSAGE_CHARACTERS = 60000;
// Shown above the JSON in the evidence note.
const EVIDENCE_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It keeps the passages from "
  + "your notes that mention each term in the user terms dictionary, which the plugin reads when it refines a "
  + "definition. Notes the plugin maintains are never used as evidence.";

// ----------------------------------------------------------------------------------------------
// @desc Save one term's evidence, replacing the record a previous collection kept for it but keeping that record's
//   refinement. Updates are serialized through the app's note writer, so two collections in one session never
//   overwrite each other's record.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {object} evidence - A record from collectTermEvidence
//   - {DashboardNoteWriter} [noteWriter] - Serializes updates; the app's shared writer by default
//   - {number} year - The dictionary's year
// @returns {Promise<object>} The record as saved, without its passages when the note had no room for them.
// @throws When the note cannot be read or written, or holds a record this version cannot read.
export function savedTermEvidence(app, { evidence, noteWriter = DashboardNoteWriter.forApp(app), year }) {
  const name = termEvidenceNoteName(year);
  const termKey = evidence.term.trim().toLowerCase();
  return noteWriter.update(name, async () => {
    const { noteHandle, payload } = await readJsonNote(app, name);
    const saved = payload ? _readableEvidence(payload, name) : { schemaVersion: TERM_EVIDENCE_SCHEMA_VERSION, terms: {} };
    const refinement = saved.terms[termKey]?.refinement;
    const record = refinement ? { ...evidence, refinement } : evidence;
    const terms = _termsWithinPassageBudget({ ...saved.terms, [termKey]: record }, termKey);
    await writeJsonNote(app, { description: EVIDENCE_NOTE_DESCRIPTION, name, noteHandle,
      payload: { schemaVersion: TERM_EVIDENCE_SCHEMA_VERSION, terms }, title: `User terms dictionary ${ year } evidence` });
    return terms[termKey];
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Record how a term's refinement ended on its evidence record. A refinement that read the passages releases them
//   (passagesConsumed), keeping the sources and digests a later collection compares against.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {boolean} consumedPassages - Whether the refinement read the passages
//   - {DashboardNoteWriter} [noteWriter] - Serializes updates; the app's shared writer by default
//   - {object} refinement - { attemptedAt, citedNoteUuids, evidenceQuality, keptReason, outcome, refinedAt,
//     sourceDigest, uncertainty }; refinedAt is carried from the previous refinement when omitted
//   - {string} term - The term
//   - {number} year - The dictionary's year
// @returns {Promise<object|null>} The record as saved, or null when the term has no evidence record.
// @throws When the note cannot be read or written, or holds a record this version cannot read.
export function recordedTermRefinement(app, { consumedPassages, noteWriter = DashboardNoteWriter.forApp(app), refinement, term, year }) {
  const name = termEvidenceNoteName(year);
  const termKey = term.trim().toLowerCase();
  return noteWriter.update(name, async () => {
    const { noteHandle, payload } = await readJsonNote(app, name);
    const saved = payload ? _readableEvidence(payload, name) : null;
    const record = saved?.terms[termKey];
    if (!record) return null;
    const refinedAt = refinement.refinedAt ?? record.refinement?.refinedAt ?? null;
    const passageFields = consumedPassages ? { passages: [], passagesConsumed: true } : {};
    const updated = { ...record, ...passageFields, refinement: { ...refinement, refinedAt } };
    await writeJsonNote(app, { description: EVIDENCE_NOTE_DESCRIPTION, name, noteHandle,
      payload: { ...saved, terms: { ...saved.terms, [termKey]: updated } }, title: `User terms dictionary ${ year } evidence` });
    return updated;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Read every term's saved evidence.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { year }.
// @returns {Promise<object>} Records keyed by lowercased term; empty when the year has no evidence note.
// @throws When the note cannot be read, or holds a record this version cannot read.
export async function storedTermEvidence(app, { year }) {
  const name = termEvidenceNoteName(year);
  const { payload } = await readJsonNote(app, name);
  return payload ? _readableEvidence(payload, name).terms : {};
}

// ----------------------------------------------------------------------------------------------
// @desc Name the year's evidence note.
// @param {number} year - Calendar year.
// @returns {string} Note name.
export function termEvidenceNoteName(year) {
  return `User terms dictionary ${ year } evidence`;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Check a saved payload is a record this version reads.
// @param {object} payload - The parsed JSON.
// @param {string} name - Note name, for the error.
// @returns {object} The payload.
// @throws When a newer version wrote it, or it holds no term records.
function _readableEvidence(payload, name) {
  if (Number(payload.schemaVersion) > TERM_EVIDENCE_SCHEMA_VERSION) throw new Error(`"${ name }" was written by a newer version of the plugin`);
  if (!payload.terms || typeof payload.terms !== "object" || Array.isArray(payload.terms)) {
    throw new Error(`"${ name }" holds no readable term evidence`);
  }
  return payload;
}

// ----------------------------------------------------------------------------------------------
// @desc Drop passages from the oldest records until the passages kept fit MAXIMUM_STORED_PASSAGE_CHARACTERS. The
//   record just collected is given up last, and a record losing its passages is marked passagesDropped.
// @param {object} terms - Records keyed by lowercased term.
// @param {string} newestTermKey - The record just collected.
// @returns {object} Records keyed by lowercased term.
function _termsWithinPassageBudget(terms, newestTermKey) {
  const passageCharacters = record => (record.passages || []).reduce((count, passage) => count + String(passage.text).length, 0);
  let total = Object.values(terms).reduce((count, record) => count + passageCharacters(record), 0);
  if (total <= MAXIMUM_STORED_PASSAGE_CHARACTERS) return terms;
  const olderTermKeys = Object.keys(terms).filter(termKey => termKey !== newestTermKey);
  const oldestFirst = olderTermKeys.sort((first, second) => String(terms[first].collectedAt).localeCompare(String(terms[second].collectedAt)));
  const trimmed = { ...terms };
  for (const termKey of [...oldestFirst, newestTermKey]) {
    if (total <= MAXIMUM_STORED_PASSAGE_CHARACTERS) break;
    const record = trimmed[termKey];
    if (!record.passages?.length) continue;
    total -= passageCharacters(record);
    trimmed[termKey] = { ...record, passages: [], passagesDropped: true };
  }
  return trimmed;
}
