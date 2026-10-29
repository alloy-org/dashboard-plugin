// Read and grow the archived "User terms dictionary {year}" note: one bullet per notebook-specific term, such as
// "Amplenote" or "Diff Digest", whose definition lets a model that has never seen this notebook recognize when a
// task about "the dashboard" serves a project about Amplenote's AI goals.
//
// The note is shared with the user, so ownership follows the quarterly plan's convention: a bullet ending in
// `[builder]` was written by the plugin and may be refined by a later pass; a bullet without it is the user's and is
// never rewritten. Removing the marker is how a user adopts a generated definition. The People section defines the
// people the user's tasks name, in the format dictionary-people.js describes. A last section lists the projects whose
// wording has already been examined for terms, so discovery asks a provider only about new projects.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { BUILDER_MARKER, isBuilderMarkedText, textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";
import { dictionaryKeyFromEntry, mergedAliases, PEOPLE_HEADING, personBulletMarkdown,
  personFromLine } from "plan-wizard/stack-rank/dictionary-people";
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { unescapedMarkdownText } from "util/amplenote-markdown-escapes";
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
// @desc Read every term the Terms section defines, then every person the People section defines. Definitions have
//   their Rich Footnotes resolved, so a term the user explained at length in a footnote reaches the model in full
//   rather than as a bare `[^1]` label.
// @param {string} content - The dictionary note's markdown.
// @returns {Array<object>} { aliases, definition, isBuilderOwned, isPerson, lineIndex, term } in note order, one per
//   distinct term; aliases are the other names a person answers to, empty for a term.
export function dictionaryEntriesFromContent(content) {
  const { definitions } = parsedRichFootnotes(content || "");
  const lines = String(content || "").split("\n");
  const entries = [];
  const seenTermKeys = new Set();
  for (const isPerson of [false, true]) {
    const { end, start } = _sectionLineRange(lines, isPerson ? PEOPLE_HEADING : TERMS_HEADING);
    for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
      const parsed = _parsedBullet(lines[lineIndex], { isPerson });
      if (!parsed || seenTermKeys.has(parsed.term.toLowerCase())) continue;
      seenTermKeys.add(parsed.term.toLowerCase());
      const definition = passageWithResolvedFootnotes(parsed.rawDefinition, definitions).trim();
      entries.push({ aliases: parsed.aliases, definition, isBuilderOwned: parsed.isBuilderOwned, isPerson, lineIndex, term: parsed.term });
    }
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
// @desc Reduce dictionary entries to the { term: definition } object a prompt or Jev state carries. A person is keyed
//   by every name they answer to (dictionaryKeyFromEntry), so a task naming "Lucian" draws in Lucian Ruscanu's entry.
// @param {Array<object>} entries - Entries from dictionaryEntriesFromContent.
// @returns {object} Definitions keyed by term.
export function dictionaryObjectFromEntries(entries) {
  return Object.fromEntries(entries.map(entry => [dictionaryKeyFromEntry(entry), entry.definition]));
}

// ----------------------------------------------------------------------------------------------
// @desc Read the project summaries already examined for terms, lowercased so a change of case alone does not
//   send a project back through discovery. Each bullet is read without the backslashes Amplenote adds when it saves
//   the note, which turn "(examined" into "\(examined" and would otherwise hide every examined project.
// @param {string} content - The dictionary note's markdown.
// @returns {Set<string>} Lowercased project summaries.
export function examinedProjectSummaries(content) {
  const lines = String(content || "").split("\n");
  const { end, exists, start } = _sectionLineRange(lines, EXAMINED_HEADING);
  const summaries = new Set();
  if (!exists) return summaries;
  for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
    const match = unescapedMarkdownText(lines[lineIndex]).match(EXAMINED_BULLET_PATTERN);
    if (match) summaries.add(match[1].trim().toLowerCase());
  }
  return summaries;
}

// ----------------------------------------------------------------------------------------------
// @desc Splice new and refined definitions, and the projects just examined, into the note as it was read, leaving
//   every other byte in place. A refinement replaces a plugin-owned bullet where it stands, a person's keeping the
//   names it listed; a term the user wrote is left alone; a new term is appended to the end of the Terms section, and
//   a new person to the end of the People section. An incoming person matches an existing one by any of their names.
// @param {string} content - The dictionary note's markdown as last read.
// @param {object} changes - { examinedOn (YYYY-MM-DD), examinedSummaries, incomingEntries: [{ aliases, definition,
//   isPerson, term }] }: aliases and isPerson are given for people only.
// @returns {object} { addedTerms, content, refinedTerms }.
export function mergedDictionaryContent(content, { examinedOn, examinedSummaries = [], incomingEntries = [] }) {
  const lines = String(content || "").split("\n");
  const existingByTermKey = _entriesByName(dictionaryEntriesFromContent(content));
  const addedTerms = [];
  const refinedTerms = [];
  const appendedLines = { [PEOPLE_HEADING]: [], [TERMS_HEADING]: [] };
  for (const incoming of incomingEntries) {
    const incomingNames = [incoming.term, ...(incoming.isPerson ? incoming.aliases || [] : [])];
    const existing = incomingNames.map(name => existingByTermKey.get(name.trim().toLowerCase())).find(Boolean);
    if (existing && !existing.isBuilderOwned) continue;
    if (existing) {
      lines[existing.lineIndex] = _bulletMarkdown(existing, incoming);
      refinedTerms.push(existing.term);
    } else {
      const aliases = incoming.isPerson ? mergedAliases(incoming.term, incoming.aliases) : [];
      appendedLines[incoming.isPerson ? PEOPLE_HEADING : TERMS_HEADING].push(_bulletMarkdown({ aliases, isPerson: incoming.isPerson,
        term: incoming.term.trim() }, incoming));
      addedTerms.push(incoming.term.trim());
    }
    // A second proposal for the same term in one pass is a restatement, not a refinement of the first.
    for (const name of incomingNames) existingByTermKey.set(name.trim().toLowerCase(), { isBuilderOwned: false, lineIndex: -1, term: incoming.term });
  }
  const alreadyExamined = examinedProjectSummaries(content);
  const newSummaries = examinedSummaries.filter(summary => !alreadyExamined.has(summary.trim().toLowerCase()));
  const examinedLines = newSummaries.map(summary => `- ${ summary.trim() } (examined ${ examinedOn })`);
  _appendToSection(lines, EXAMINED_HEADING, examinedLines);
  _appendToSection(lines, PEOPLE_HEADING, appendedLines[PEOPLE_HEADING]);
  _appendToSection(lines, TERMS_HEADING, appendedLines[TERMS_HEADING]);
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
// @desc Say where the year's dictionary note is and how many terms it defines, without creating or writing it.
// @param {object} app - Host-compatible Amplenote API.
// @param {number} year - Calendar year.
// @returns {Promise<object|null>} { noteUuid, termCount }, or null when the year has no dictionary note.
// @throws When an app call fails.
export async function userTermsDictionarySummary(app, year) {
  const found = checkedAppResult(await app.findNote({ name: dictionaryNoteName(year), tags: [DASHBOARD_NOTE_TAG] }));
  if (!found?.uuid) return null;
  const content = checkedAppResult(await app.getNoteContent({ uuid: found.uuid }));
  const termCount = dictionaryEntriesFromContent(typeof content === "string" ? content : "").length;
  return { noteUuid: found.uuid, termCount };
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
//   is recreated at the end of the note, since its bullets are only read beneath it; a missing People heading is
//   created just above the Examined heading, or at the end without one; when the Terms heading is gone, new terms join
//   the headingless list the note is then read as.
// @param {Array<string>} lines - Note lines; mutated.
// @param {string} headingText - Section heading.
// @param {Array<string>} additions - Lines to insert.
function _appendToSection(lines, headingText, additions) {
  if (!additions.length) return;
  const { end, exists } = _sectionLineRange(lines, headingText);
  const examinedIndex = _headingIndex(lines, EXAMINED_HEADING);
  if (!exists && headingText === PEOPLE_HEADING && examinedIndex >= 0) {
    lines.splice(examinedIndex, 0, `# ${ headingText }`, ...additions, "");
    return;
  }
  if (!exists && headingText !== TERMS_HEADING) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("", `# ${ headingText }`, ...additions, "");
    return;
  }
  let insertionIndex = end;
  while (insertionIndex > 0 && !lines[insertionIndex - 1].trim()) insertionIndex -= 1;
  lines.splice(insertionIndex, 0, ...additions);
}

// ----------------------------------------------------------------------------------------------
// @desc Render a bullet for an entry as it stands in the note, carrying an incoming definition and, for a person, the
//   names the bullet lists together with any the incoming entry adds.
// @param {object} existing - { aliases, isPerson, term }: the bullet's current names, or a new entry's.
// @param {object} incoming - { aliases, definition }.
// @returns {string} A markdown bullet line.
function _bulletMarkdown(existing, incoming) {
  if (!existing.isPerson) return dictionaryBulletMarkdown({ definition: incoming.definition, term: existing.term });
  const incomingNames = [incoming.term, ...(incoming.aliases || [])].filter(Boolean);
  const aliases = mergedAliases(existing.term, existing.aliases, incomingNames);
  return personBulletMarkdown({ aliases, definition: incoming.definition, term: existing.term });
}

// ----------------------------------------------------------------------------------------------
// @desc Index entries by each of their names, lowercased: a term by its term, a person also by every alias.
// @param {Array<object>} entries - From dictionaryEntriesFromContent.
// @returns {Map<string, object>} Entries by lowercased name; the first entry holding a name keeps it.
function _entriesByName(entries) {
  const entriesByName = new Map();
  for (const entry of entries) {
    for (const name of [entry.term, ...entry.aliases]) {
      const nameKey = name.toLowerCase();
      if (!entriesByName.has(nameKey)) entriesByName.set(nameKey, entry);
    }
  }
  return entriesByName;
}

// ----------------------------------------------------------------------------------------------
// @desc Find a section's heading line, of any level.
// @param {Array<string>} lines - Note lines.
// @param {string} headingText - Section heading.
// @returns {number} Its line index, or -1.
function _headingIndex(lines, headingText) {
  return lines.findIndex(line => /^#+\s/.test(line) && line.replace(/^#+\s+/, "").trim() === headingText);
}

// ----------------------------------------------------------------------------------------------
// @desc Read one bullet of the Terms or People section. A People line in the plain term format is read as a person
//   with no other names, so a user who writes `- Dana: my editor` still defines a person.
// @param {string} line - A note line.
// @param {object} options - { isPerson }: whether the line sits under the People heading.
// @returns {object|null} { aliases, isBuilderOwned, rawDefinition, term }, or null when the line defines nothing.
function _parsedBullet(line, { isPerson }) {
  const person = isPerson ? personFromLine(line) : null;
  if (person) return person;
  const match = line.match(TERM_BULLET_PATTERN);
  const term = match ? (match[1] || match[2]).trim() : "";
  if (!term) return null;
  return { aliases: [], isBuilderOwned: isBuilderMarkedText(match[3]), rawDefinition: textWithoutBuilderMarker(match[3]), term };
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
    + `ending in ${ BUILDER_MARKER } may be refined by the plugin; remove the marker to keep a definition as written. `
    + "People your tasks name are listed under People; add `- **Me** (also Your Name): The account owner.` there if "
    + "the plugin should know which name is yours."
    + `\n\n# ${ TERMS_HEADING }\n${ seedBullets }\n\n# ${ PEOPLE_HEADING }\n\n# ${ EXAMINED_HEADING }\n`;
  await writeUserTermsDictionary(app, { uuid }, content);
  return { content, noteHandle: { uuid } };
}

// ----------------------------------------------------------------------------------------------
// @desc Locate a section's body lines: from just past its heading to the next heading of any level. A note whose
//   Terms heading is missing is read whole up to its People or Examined heading, so a user who rewrote the note as a
//   plain bullet list keeps their terms; a missing People or Examined heading gives an empty section.
// @param {Array<string>} lines - Note lines.
// @param {string} headingText - Section heading.
// @returns {object} { end, exists, start } line indexes, end exclusive.
function _sectionLineRange(lines, headingText) {
  const headingIndex = _headingIndex(lines, headingText);
  if (headingIndex < 0 && headingText !== TERMS_HEADING) return { end: lines.length, exists: false, start: lines.length };
  if (headingIndex < 0) {
    const laterHeadingIndexes = [_headingIndex(lines, PEOPLE_HEADING), _headingIndex(lines, EXAMINED_HEADING)].filter(index => index >= 0);
    return { end: laterHeadingIndexes.length ? Math.min(...laterHeadingIndexes) : lines.length, exists: false, start: 0 };
  }
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex(line => /^#+\s/.test(line));
  const end = nextHeadingOffset >= 0 ? headingIndex + 1 + nextHeadingOffset : lines.length;
  return { end, exists: true, start: headingIndex + 1 };
}
