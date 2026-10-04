// Read and grow the archived "User terms dictionary {year}" note: one bullet per notebook-specific term, such as
// "Amplenote" or "Diff Digest", whose definition lets a model that has never seen this notebook recognize when a
// task about "the dashboard" serves a project about Amplenote's AI goals.
//
// The note is shared with the user, so ownership follows the quarterly plan's convention: a bullet ending in
// `[builder]` was written by the plugin and may be refined by a later pass; a bullet without it is the user's and is
// never rewritten. Removing the marker is how a user adopts a generated definition. A second section lists the
// projects whose wording has already been examined for terms, so discovery asks a provider only about new projects.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { BUILDER_MARKER, isBuilderMarkedText, textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { parsedRichFootnotes, passageWithResolvedFootnotes } from "util/amplenote-rich-footnotes";

export const EXAMINED_HEADING = "Examined projects";
export const TERMS_HEADING = "Terms";
const EXAMINED_BULLET_PATTERN = /^[-*]\s+(.+?)\s+\(examined \d{4}-\d{2}-\d{2}\)\s*$/;
// A top-level bullet naming a term, bold or plain, followed by a colon and its definition.
const TERM_BULLET_PATTERN = /^[-*]\s+(?:\*\*([^*]+?)\*\*|([^:*][^:]*?))\s*:\s*(.+)$/;
// The definitions the user supplied when this pipeline was specified; a new note starts from these.
const SEED_TERMS = [
  { definition: "The extensible notes, tasks, and calendar app that this user is helping to program and grow "
    + "awareness of.", term: "Amplenote" },
  { definition: "The Amplenote app uses Dashboard as one of the five working panes, alongside Jots (journal), Notes, "
    + "Tasks, and Calendar. It uses LLM integration to help the user build their quarterly plan (Plan Wizard) and "
    + "suggest proposed tasks that are relevant to the current date and the user's stated cadence of work.",
  term: "Dashboard" },
];

// ----------------------------------------------------------------------------------------------
// @desc Render one dictionary bullet, marking it as plugin-owned.
// @param {object} entry - { definition, term }.
// @returns {string} A markdown bullet line.
export function dictionaryBulletMarkdown({ definition, term }) {
  const singleLineDefinition = String(definition).replace(/\s+/g, " ").trim();
  return `- **${ term.trim() }**: ${ singleLineDefinition } ${ BUILDER_MARKER }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read every term the Terms section defines. Definitions have their Rich Footnotes resolved, so a term the
//   user explained at length in a footnote reaches the model in full rather than as a bare `[^1]` label.
// @param {string} content - The dictionary note's markdown.
// @returns {Array<object>} { definition, isBuilderOwned, lineIndex, term } in note order, one per distinct term.
export function dictionaryEntriesFromContent(content) {
  const { definitions } = parsedRichFootnotes(content || "");
  const lines = String(content || "").split("\n");
  const { end, start } = _sectionLineRange(lines, TERMS_HEADING);
  const entries = [];
  const seenTermKeys = new Set();
  for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
    const match = lines[lineIndex].match(TERM_BULLET_PATTERN);
    if (!match) continue;
    const term = (match[1] || match[2]).trim();
    const termKey = term.toLowerCase();
    if (!term || seenTermKeys.has(termKey)) continue;
    seenTermKeys.add(termKey);
    const rawDefinition = textWithoutBuilderMarker(match[3]);
    const definition = passageWithResolvedFootnotes(rawDefinition, definitions).trim();
    entries.push({ definition, isBuilderOwned: isBuilderMarkedText(match[3]), lineIndex, term });
  }
  return entries;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the dictionary note for a year. One note per year keeps any single note small, and a term that
//   still matters next year is carried forward by the user or rediscovered from that year's projects.
// @param {number} year - Calendar year.
// @returns {string} Note title.
export function dictionaryNoteName(year) {
  return `User terms dictionary ${ year }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce dictionary entries to the { term: definition } object a prompt or Jev state carries.
// @param {Array<object>} entries - Entries from dictionaryEntriesFromContent.
// @returns {object} Definitions keyed by term.
export function dictionaryObjectFromEntries(entries) {
  return Object.fromEntries(entries.map(entry => [entry.term, entry.definition]));
}

// ----------------------------------------------------------------------------------------------
// @desc Read the project summaries already examined for terms, lowercased so a change of case alone does not
//   send a project back through discovery.
// @param {string} content - The dictionary note's markdown.
// @returns {Set<string>} Lowercased project summaries.
export function examinedProjectSummaries(content) {
  const lines = String(content || "").split("\n");
  const { end, exists, start } = _sectionLineRange(lines, EXAMINED_HEADING);
  const summaries = new Set();
  if (!exists) return summaries;
  for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
    const match = lines[lineIndex].match(EXAMINED_BULLET_PATTERN);
    if (match) summaries.add(match[1].trim().toLowerCase());
  }
  return summaries;
}

// ----------------------------------------------------------------------------------------------
// @desc Splice new and refined definitions, and the projects just examined, into the note as it was read, leaving
//   every other byte in place. A refinement replaces a plugin-owned bullet where it stands; a term the user wrote
//   is left alone; a new term is appended to the end of the Terms section.
// @param {string} content - The dictionary note's markdown as last read.
// @param {object} changes - { examinedOn (YYYY-MM-DD), examinedSummaries, incomingEntries: [{ definition, term }] }.
// @returns {object} { addedTerms, content, refinedTerms }.
export function mergedDictionaryContent(content, { examinedOn, examinedSummaries = [], incomingEntries = [] }) {
  const lines = String(content || "").split("\n");
  const existingByTermKey = new Map(dictionaryEntriesFromContent(content).map(entry => [entry.term.toLowerCase(), entry]));
  const addedTerms = [];
  const refinedTerms = [];
  const appendedTermLines = [];
  for (const incoming of incomingEntries) {
    const termKey = incoming.term.trim().toLowerCase();
    const existing = existingByTermKey.get(termKey);
    if (existing && !existing.isBuilderOwned) continue;
    if (existing) {
      lines[existing.lineIndex] = dictionaryBulletMarkdown({ definition: incoming.definition, term: existing.term });
      refinedTerms.push(existing.term);
    } else {
      appendedTermLines.push(dictionaryBulletMarkdown(incoming));
      addedTerms.push(incoming.term.trim());
    }
    // A second proposal for the same term in one pass is a restatement, not a refinement of the first.
    existingByTermKey.set(termKey, { isBuilderOwned: false, lineIndex: -1, term: incoming.term });
  }
  const alreadyExamined = examinedProjectSummaries(content);
  const newSummaries = examinedSummaries.filter(summary => !alreadyExamined.has(summary.trim().toLowerCase()));
  const examinedLines = newSummaries.map(summary => `- ${ summary.trim() } (examined ${ examinedOn })`);
  _appendToSection(lines, EXAMINED_HEADING, examinedLines);
  _appendToSection(lines, TERMS_HEADING, appendedTermLines);
  return { addedTerms, content: lines.join("\n"), refinedTerms };
}

// ----------------------------------------------------------------------------------------------
// @desc Open the year's dictionary note, creating it archived and seeded when it does not exist. The returned
//   handle is a bare { uuid }, since a handle that crossed the embed bridge does not write reliably.
// @param {object} app - Host-compatible Amplenote API.
// @param {number} year - Calendar year.
// @returns {Promise<object>} { content, noteHandle }.
export async function openUserTermsDictionary(app, year) {
  const name = dictionaryNoteName(year);
  const found = checkedAppResult(await app.findNote({ name, tags: [DASHBOARD_NOTE_TAG] }));
  if (found?.uuid) {
    const content = checkedAppResult(await app.getNoteContent({ uuid: found.uuid }));
    if (typeof content !== "string") throw new Error(`Could not read "${ name }"`);
    if (content.trim()) return { content, noteHandle: { uuid: found.uuid } };
    return _seededDictionary(app, found.uuid);
  }
  const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG], { archive: true }));
  const uuid = typeof created === "string" ? created : created?.uuid;
  if (!uuid) throw new Error(`Could not create "${ name }"`);
  return _seededDictionary(app, uuid);
}

// ----------------------------------------------------------------------------------------------
// @desc Read the year's dictionary note without creating, seeding, or writing it, for a caller that only inspects it.
// @param {object} app - Host-compatible Amplenote API.
// @param {number} year - Calendar year.
// @returns {Promise<string|null>} The note's markdown, or null when the year has no dictionary note.
// @throws When an app call fails.
export async function readUserTermsDictionary(app, year) {
  const found = checkedAppResult(await app.findNote({ name: dictionaryNoteName(year), tags: [DASHBOARD_NOTE_TAG] }));
  if (!found?.uuid) return null;
  const content = checkedAppResult(await app.getNoteContent({ uuid: found.uuid }));
  return typeof content === "string" ? content : "";
}

// ----------------------------------------------------------------------------------------------
// @desc Write the merged dictionary back as a whole note. The content was spliced from the note just read, so the
//   write carries everything the user wrote; a false return from the bridge is treated as a failed write.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} noteHandle - Bare { uuid } handle.
// @param {string} content - Full replacement markdown.
// @returns {Promise<void>}
export async function writeUserTermsDictionary(app, noteHandle, content) {
  const result = checkedAppResult(await app.replaceNoteContent({ uuid: noteHandle.uuid }, content));
  if (result === false) throw new Error("The user terms dictionary write was refused");
}

// ----------------------------------------------------------------------------------------------
// @desc Insert lines after the last non-blank line of a section. When the user has removed the Examined heading it
//   is recreated at the end of the note, since its bullets are only read beneath it; when the Terms heading is gone,
//   new terms join the headingless list the note is then read as.
// @param {Array<string>} lines - Note lines; mutated.
// @param {string} headingText - Section heading.
// @param {Array<string>} additions - Lines to insert.
function _appendToSection(lines, headingText, additions) {
  if (!additions.length) return;
  const { end, exists } = _sectionLineRange(lines, headingText);
  if (!exists && headingText === EXAMINED_HEADING) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", `# ${ headingText }`, ...additions, "");
    return;
  }
  let insertionIndex = end;
  while (insertionIndex > 0 && !lines[insertionIndex - 1].trim()) insertionIndex -= 1;
  lines.splice(insertionIndex, 0, ...additions);
}

// ----------------------------------------------------------------------------------------------
// @desc Write the initial dictionary into an empty note.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} uuid - The note's UUID.
// @returns {Promise<object>} { content, noteHandle }.
async function _seededDictionary(app, uuid) {
  const seedBullets = SEED_TERMS.map(dictionaryBulletMarkdown).join("\n");
  const content = "This archived note is maintained by the dashboard plugin. Each bullet defines a term from your "
    + "projects so the AI that ranks tasks for them can recognize what the term means in your notebook. A bullet "
    + `ending in ${ BUILDER_MARKER } may be refined by the plugin; remove the marker to keep a definition as written.`
    + `\n\n# ${ TERMS_HEADING }\n${ seedBullets }\n\n# ${ EXAMINED_HEADING }\n`;
  await writeUserTermsDictionary(app, { uuid }, content);
  return { content, noteHandle: { uuid } };
}

// ----------------------------------------------------------------------------------------------
// @desc Locate a section's body lines: from just past its heading to the next heading of any level. A note whose
//   Terms heading is missing is read whole, so a user who rewrote the note as a plain bullet list keeps their terms.
// @param {Array<string>} lines - Note lines.
// @param {string} headingText - Section heading.
// @returns {object} { end, exists, start } line indexes, end exclusive.
function _sectionLineRange(lines, headingText) {
  const headingIndex = lines.findIndex(line => line.replace(/^#+\s+/, "").trim() === headingText && /^#+\s/.test(line));
  if (headingIndex < 0) {
    const examinedIndex = lines.findIndex(line => /^#+\s/.test(line) && line.replace(/^#+\s+/, "").trim() === EXAMINED_HEADING);
    return { end: examinedIndex >= 0 ? examinedIndex : lines.length, exists: false, start: 0 };
  }
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex(line => /^#+\s/.test(line));
  const end = nextHeadingOffset >= 0 ? headingIndex + 1 + nextHeadingOffset : lines.length;
  return { end, exists: true, start: headingIndex + 1 };
}
