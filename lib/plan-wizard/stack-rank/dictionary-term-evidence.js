// Gather what the user's own notes say about one dictionary term, as the evidence a later refinement reasons over
// before it rewrites a definition. The term is searched quoted, then unquoted when the quoted search turns up no
// passage, and a bounded number of the best matching notes are read: search returns note handles, not snippets, so
// each passage is cut from a note's content where the term appears as a whole word. Rich Footnotes are resolved
// before a passage is cut, so a term explained at length in a footnote reaches the evidence in full, and a footnote
// that mentions the term contributes a passage of its own. Notes the dashboard plugin maintains, the dictionary among
// them, are never evidence, so a tentative definition cannot corroborate itself. Copied passages are kept once, and
// the passages kept are spread across distinct notes before any note gives a second one.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { textContainsTerm } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { parsedRichFootnotes, passageWithResolvedFootnotes,
  resolvedFootnotesForPassage } from "util/amplenote-rich-footnotes";
import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";
import { textDigest } from "util/text-digest";

// The most notes one collection reads, across the quoted search and its unquoted fallback.
export const MAXIMUM_EVIDENCE_NOTES_READ = 8;
// The most passages one collection keeps, and the most any one note gives.
export const MAXIMUM_EVIDENCE_PASSAGES = 10;
export const MAXIMUM_PASSAGES_PER_NOTE = 3;
// The most characters of note text one passage carries, before the footnotes it cites are added.
export const MAXIMUM_PASSAGE_CHARACTERS = 1200;
// The most characters the footnotes resolved for one passage add to it.
export const MAXIMUM_FOOTNOTE_CHARACTERS = 1500;
// The most characters all kept passages carry together, so the refinement prompt stays a bounded size.
export const MAXIMUM_EVIDENCE_CHARACTERS = 12000;
// How a collection ended: passages found, no note matched the search, or notes matched but none named the term.
export const EVIDENCE_OUTCOMES = Object.freeze({ found: "found", noMatchingNotes: "noMatchingNotes", noPassages: "noPassages" });

const LOG_LABEL = "[dictionary-term-evidence]";
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
const HEADING_PATTERN = /^#{1,6}\s+\S/;

// ----------------------------------------------------------------------------------------------
// @desc Search the notebook for one term and select the passages that show how the user uses it.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {Set<string>} [excludedNoteUuids] - Further notes never read as evidence
//   - {Date} [now=new Date()] - When the collection ran
//   - {string} term - The term, as the dictionary names it
// @returns {Promise<object>} An evidence record with the following properties:
//   - {string} collectedAt - ISO time of collection
//   - {number} notesRead - Notes whose content was read
//   - {string} outcome - One of EVIDENCE_OUTCOMES
//   - {Array<object>} passages - { noteUuid, text } in selection order
//   - {object} query - { text, unquotedFallback }: the last search sent, and whether the quoted search fell short
//   - {string|null} sourceDigest - Digest of every contributing note's identity and content, null without passages
//   - {Array<object>} sources - { contentDigest, noteName, noteUuid, passageCount } for each contributing note
//   - {string} term - The term as given
// @throws When the search itself fails; a note that cannot be read is skipped.
export async function collectTermEvidence(app, { excludedNoteUuids = new Set(), now = new Date(), term }) {
  const quotedQuery = `"${ term }"`;
  const quoted = await _searchedNotes(app, { excludedNoteUuids, query: quotedQuery, readUuids: new Set(),
    remainingReads: MAXIMUM_EVIDENCE_NOTES_READ, term });
  let readNotes = quoted.readNotes;
  let matchedNoteCount = quoted.matchedNoteCount;
  let query = { text: quotedQuery, unquotedFallback: false };
  const quotedPassageCount = readNotes.reduce((count, note) => count + note.passages.length, 0);
  if (!quotedPassageCount && readNotes.length < MAXIMUM_EVIDENCE_NOTES_READ) {
    const readUuids = new Set(readNotes.map(note => note.noteUuid));
    const unquoted = await _searchedNotes(app, { excludedNoteUuids, query: term, readUuids,
      remainingReads: MAXIMUM_EVIDENCE_NOTES_READ - readNotes.length, term });
    readNotes = readNotes.concat(unquoted.readNotes);
    matchedNoteCount += unquoted.matchedNoteCount;
    query = { text: term, unquotedFallback: true };
  }
  const passages = _selectedPassages(readNotes);
  const sources = _contributingSources(readNotes, passages);
  const outcome = _evidenceOutcome({ matchedNoteCount, passages });
  logIfEnabled(LOG_LABEL, { notesRead: readNotes.length, outcome, passageCount: passages.length, query: query.text, term });
  return { collectedAt: now.toISOString(), notesRead: readNotes.length, outcome, passages, query,
    sourceDigest: _sourceDigest(sources), sources, term };
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a note is one the dashboard plugin maintains, by its tags, so it never serves as evidence. The
//   dictionary, its revisions and evidence notes, the work queue, and the planning notes all carry the plugin's tag.
// @param {object} noteHandle - A handle as search returned it.
// @returns {boolean} True when the note carries the plugin's tag or one beneath it.
export function isPluginMaintainedNote(noteHandle) {
  const tags = Array.isArray(noteHandle?.tags) ? noteHandle.tags : [];
  return tags.some(tag => tag === DASHBOARD_NOTE_TAG || String(tag).startsWith(`${ DASHBOARD_NOTE_TAG }/`));
}

// ----------------------------------------------------------------------------------------------
// @desc Cut every passage naming a term from one note's markdown. Each prose block (a paragraph, a list, or a fenced
//   block, under the nearest heading) naming the term gives a passage carrying its heading and the footnotes it cites;
//   a block longer than MAXIMUM_PASSAGE_CHARACTERS is narrowed to the lines around the first mention. A footnote
//   definition naming the term that no such passage already cites gives a passage of its own.
// @param {string} content - The note's markdown.
// @param {string} term - The term.
// @returns {Array<string>} Passage texts in note order, prose before footnotes.
export function termPassagesFromContent(content, term) {
  const { body, definitions } = parsedRichFootnotes(content || "");
  const passages = [];
  const citedIdentifiers = new Set();
  for (const block of _proseBlocks(body)) {
    if (!textContainsTerm(block.text, term)) continue;
    const excerpt = _excerptAroundTerm(block.lines, term);
    const headedExcerpt = block.heading && block.heading !== excerpt ? `${ block.heading }\n${ excerpt }` : excerpt;
    passages.push(_passageWithFootnotes(headedExcerpt, definitions));
    const { resolved } = resolvedFootnotesForPassage(headedExcerpt, definitions);
    for (const definition of resolved) citedIdentifiers.add(definition.identifier);
  }
  for (const definition of definitions.values()) {
    if (citedIdentifiers.has(definition.identifier)) continue;
    if (!textContainsTerm(`${ definition.label }\n${ definition.body }`, term)) continue;
    // Written without the caret, so the heading is not read as a citation of the footnote it introduces.
    const heading = definition.label ? `Footnote ${ definition.identifier }: ${ definition.label }` : `Footnote ${ definition.identifier }:`;
    const excerpt = _excerptAroundTerm(String(definition.body).split("\n"), term);
    passages.push(_passageWithFootnotes(`${ heading }\n${ excerpt }`, definitions));
  }
  return passages;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Describe each note that gave a kept passage, with a digest of the content it was read from, so a later
//   collection can tell whether its sources changed.
// @param {Array<object>} readNotes - Notes as _readNote returned them.
// @param {Array<object>} passages - Kept passages.
// @returns {Array<object>} { contentDigest, noteName, noteUuid, passageCount } in search order.
function _contributingSources(readNotes, passages) {
  const passageCounts = new Map();
  for (const passage of passages) passageCounts.set(passage.noteUuid, (passageCounts.get(passage.noteUuid) || 0) + 1);
  const contributingNotes = readNotes.filter(note => passageCounts.has(note.noteUuid));
  const sources = contributingNotes.map(note => ({ contentDigest: note.contentDigest, noteName: note.noteName,
    noteUuid: note.noteUuid, passageCount: passageCounts.get(note.noteUuid) }));
  return sources;
}

// ----------------------------------------------------------------------------------------------
// @desc Name how a collection ended.
// @param {object} options - { matchedNoteCount, passages }.
// @returns {string} One of EVIDENCE_OUTCOMES.
function _evidenceOutcome({ matchedNoteCount, passages }) {
  if (passages.length) return EVIDENCE_OUTCOMES.found;
  return matchedNoteCount ? EVIDENCE_OUTCOMES.noPassages : EVIDENCE_OUTCOMES.noMatchingNotes;
}

// ----------------------------------------------------------------------------------------------
// @desc Narrow lines to at most MAXIMUM_PASSAGE_CHARACTERS around the first that names the term, growing the window
//   one line at a time, alternating after and before, so the mention keeps the context nearest it.
// @param {Array<string>} lines - A block's lines.
// @param {string} term - The term.
// @returns {string} The lines kept, joined; a single over-long line is cut with an ellipsis.
function _excerptAroundTerm(lines, term) {
  const whole = lines.join("\n").trim();
  if (whole.length <= MAXIMUM_PASSAGE_CHARACTERS) return whole;
  const mentionIndex = Math.max(0, lines.findIndex(line => textContainsTerm(line, term)));
  let first = mentionIndex;
  let last = mentionIndex;
  let length = lines[mentionIndex].length;
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of [last + 1, first - 1]) {
      if (candidate < 0 || candidate >= lines.length || length + lines[candidate].length + 1 > MAXIMUM_PASSAGE_CHARACTERS) continue;
      length += lines[candidate].length + 1;
      if (candidate > last) last = candidate; else first = candidate;
      grew = true;
    }
  }
  const excerpt = lines.slice(first, last + 1).join("\n").trim();
  return _truncated(excerpt, MAXIMUM_PASSAGE_CHARACTERS);
}

// ----------------------------------------------------------------------------------------------
// @desc A passage followed by the footnotes it cites, those footnotes trimmed to MAXIMUM_FOOTNOTE_CHARACTERS.
// @param {string} untrimmedExcerpt - Passage markdown.
// @param {Map<string, object>} definitions - Footnote definitions from parsedRichFootnotes.
// @returns {string} The passage, then its resolved footnotes.
function _passageWithFootnotes(untrimmedExcerpt, definitions) {
  const excerpt = untrimmedExcerpt.trim();
  const resolved = passageWithResolvedFootnotes(excerpt, definitions);
  const footnoteText = resolved.slice(excerpt.length).trim();
  if (!footnoteText) return excerpt;
  return `${ excerpt }\n\n${ _truncated(footnoteText, MAXIMUM_FOOTNOTE_CHARACTERS) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Split a note body into the blocks passages are cut from: runs of lines ended by a blank line or a backslash-only
//   line (Amplenote's blank paragraph) outside a fence, each carrying the nearest heading above it. A heading is a
//   block of its own, so a heading naming the term is a passage.
// @param {string} body - Note markdown with footnote definitions removed.
// @returns {Array<object>} { heading, lines, text }.
function _proseBlocks(body) {
  const blocks = [];
  let current = [];
  let heading = null;
  let insideFence = false;
  const finish = () => {
    if (current.length) blocks.push({ heading, lines: current, text: current.join("\n") });
    current = [];
  };
  for (const line of String(body).split("\n")) {
    if (FENCE_PATTERN.test(line)) insideFence = !insideFence;
    const isBlank = !line.trim() || line.trim() === "\\";
    if (!insideFence && isBlank) { finish(); continue; }
    if (!insideFence && HEADING_PATTERN.test(line)) {
      finish();
      heading = line.trim();
      blocks.push({ heading, lines: [line], text: line });
      continue;
    }
    current.push(line);
  }
  finish();
  return blocks;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one note and cut its passages naming the term.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} noteHandle - The handle search returned.
// @param {string} term - The term.
// @returns {Promise<object|null>} { contentDigest, noteName, noteUuid, passages }, or null when it could not be read.
async function _readNote(app, noteHandle, term) {
  let content;
  try {
    content = await app.getNoteContent({ uuid: noteHandle.uuid });
  } catch (error) {
    logIfEnabled(LOG_LABEL, "getNoteContent failed", { message: error?.message, noteUuid: noteHandle.uuid });
    return null;
  }
  if (typeof content !== "string") return null;
  return { contentDigest: textDigest(content), noteName: noteHandle.name || null, noteUuid: noteHandle.uuid,
    passages: termPassagesFromContent(content, term) };
}

// ----------------------------------------------------------------------------------------------
// @desc Search once and read the best matching notes not yet read, up to the reads remaining. Search uses the app's
//   full search when the client offers it, else the relevance-sorted notes filter.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { excludedNoteUuids, query, readUuids, remainingReads, term }.
// @returns {Promise<object>} { matchedNoteCount, readNotes }: matchedNoteCount counts usable matches, read or not.
// @throws When the search fails.
async function _searchedNotes(app, { excludedNoteUuids, query, readUuids, remainingReads, term }) {
  const searchResult = typeof app.searchNotes === "function" ? app.searchNotes(query) : app.filterNotes({ query }, "relevance");
  const handles = await arrayFromFilterNotesResult(searchResult);
  const usableHandles = handles.filter(handle => handle?.uuid && !excludedNoteUuids.has(handle.uuid) && !isPluginMaintainedNote(handle));
  const unreadHandles = usableHandles.filter(handle => !readUuids.has(handle.uuid));
  const readNotes = [];
  for (const handle of unreadHandles.slice(0, remainingReads)) {
    const note = await _readNote(app, handle, term);
    if (note) readNotes.push(note);
  }
  return { matchedNoteCount: usableHandles.length, readNotes };
}

// ----------------------------------------------------------------------------------------------
// @desc Choose passages across notes: one from each note in search order, then a second from each, and so on, up to
//   MAXIMUM_PASSAGES_PER_NOTE apiece. A note whose next passage repeats one already kept (compared without case or
//   spacing), or would pass the character limit, offers its following passage instead, so a copy never costs a note
//   its turn. Selection stops at MAXIMUM_EVIDENCE_PASSAGES.
// @param {Array<object>} readNotes - Notes as _readNote returned them, in search order.
// @returns {Array<object>} { noteUuid, text }.
function _selectedPassages(readNotes) {
  const selected = [];
  const keptDigests = new Set();
  const offeredCounts = readNotes.map(() => 0);
  const keptCounts = readNotes.map(() => 0);
  let characterCount = 0;
  for (let round = 0; round < MAXIMUM_PASSAGES_PER_NOTE; round += 1) {
    readNotes.forEach((note, noteIndex) => {
      while (offeredCounts[noteIndex] < note.passages.length && keptCounts[noteIndex] <= round
        && selected.length < MAXIMUM_EVIDENCE_PASSAGES) {
        const text = note.passages[offeredCounts[noteIndex]];
        offeredCounts[noteIndex] += 1;
        const digest = textDigest(text.replace(/\s+/g, " ").trim().toLowerCase());
        if (keptDigests.has(digest) || characterCount + text.length > MAXIMUM_EVIDENCE_CHARACTERS) continue;
        keptDigests.add(digest);
        characterCount += text.length;
        keptCounts[noteIndex] += 1;
        selected.push({ noteUuid: note.noteUuid, text });
      }
    });
  }
  return selected;
}

// ----------------------------------------------------------------------------------------------
// @desc Digest the contributing notes' identities and contents, in a fixed order.
// @param {Array<object>} sources - From _contributingSources.
// @returns {string|null} Eight hex characters, or null without sources.
function _sourceDigest(sources) {
  if (!sources.length) return null;
  const sourceKeys = sources.map(source => `${ source.noteUuid }:${ source.contentDigest }`);
  const sortedSourceKeys = sourceKeys.sort();
  return textDigest(sortedSourceKeys.join("|"));
}

// ----------------------------------------------------------------------------------------------
// @desc Cut text to a length, marking the cut with an ellipsis.
// @param {string} text - Text.
// @param {number} maximum - Most characters kept, the ellipsis included.
// @returns {string} The text, cut when it was longer.
function _truncated(text, maximum) {
  return text.length <= maximum ? text : `${ text.slice(0, maximum - 1).trimEnd() }…`;
}
