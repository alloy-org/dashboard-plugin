// Independently model the Amplenote section behavior verified with a live note.

import { jest } from "@jest/globals";

// ----------------------------------------------------------------------------------------------
// @desc Make an isolated note API whose archived notes are excluded unless explicitly requested.
// @returns {object} App mock with mutable notes and observed API calls.
// Exercise real persistence flows rather than mock the repository under test.
export function createPlanWizardApp() {
  const notes = [];
  const tasks = [];
  return {
    notes,
    tasks,
    getTaskDomainTasks: jest.fn(async () => tasks.slice()),
    createNote: jest.fn(async (name, tags, options) => {
      const uuid = `note-${ notes.length + 1 }`;
      notes.push({ archived: options?.archive ?? false, content: "", localUuid: `local-${ uuid }`, name, tags, uuid });
      return `local-${ uuid }`;
    }),
    filterNotes: jest.fn(async (options = {}) => {
      const matched = notes.filter(note => (!options.tag || note.tags.includes(options.tag))
        && (options.group === "archived" ? note.archived : !note.archived));
      return matched.map(bridgeNoteHandle);
    }),
    findNote: jest.fn(async ({ uuid }) => {
      const note = noteForUuid(notes, uuid);
      return note ? bridgeNoteHandle(note) : null;
    }),
    getNoteContent: jest.fn(async ({ uuid }) => noteForUuid(notes, uuid)?.content ?? null),
    navigate: jest.fn(async () => true),
    replaceNoteContent: jest.fn(async (handle, content, options = {}) => {
      // A handle that still carries the fields findNote returned did not survive the bridge as a writable
      // reference; the host resolves nothing and reports the success it never performed.
      const uuid = handle && "archived" in handle ? null : handle?.uuid;
      const note = notes.find(item => item.uuid === uuid);
      if (!note) return true;
      if (!("section" in options)) { note.content = content; return true; }
      const range = mockSectionRange(note.content, options.section);
      if (!range) return false;
      note.content = `${ note.content.slice(0, range.start) }${ content.trim() }\n\n${ note.content.slice(range.end) }`;
      return true;
    }),
    settings: {},
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Find a section body, including deeper headings, while ignoring headings inside backtick fences.
// @param {string} content - Note content.
// @param {object} section - heading descriptor; a write with no section option replaces the whole note instead.
// @returns {object|null} Body offsets; implementation is independent of production markdown parsing.
// The live API retained siblings and replaced descendants; mimic that contract in tests.
function mockSectionRange(content, section) {
  if (!section || !("heading" in section)) throw new Error("Tests require an explicit section");
  let offset = 0;
  let fenced = false;
  const headings = [];
  for (const line of content.split("\n")) {
    if (/^```/.test(line)) fenced = !fenced;
    const match = !fenced && line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) headings.push({ body: offset + line.length + 1, level: match[1].length, start: offset, text: match[2] });
    offset += line.length + 1;
  }
  if (section.heading === null) return { end: headings[0]?.start ?? content.length, start: 0 };
  const matches = headings.filter(heading => heading.text === section.heading.text);
  const heading = matches[section.index ?? 0];
  if (!heading) return null;
  const following = headings.find(candidate => candidate.start > heading.start && candidate.level <= heading.level);
  return { end: following?.start ?? content.length, start: heading.body };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve a note by either the identifier it settled on or the local one creation handed back.
// @param {Array<object>} notes - Mock note store.
// @param {string} uuid - Identifier supplied by the caller.
// @returns {object|undefined} The matching note.
// createNote returns a local-prefixed identifier that changes once the note persists. Lookups keep honoring it, but a
//   write addressed to it reports success without changing anything, so the two are resolved differently on purpose.
function noteForUuid(notes, uuid) {
  return notes.find(note => note.uuid === uuid || note.localUuid === uuid);
}

// ----------------------------------------------------------------------------------------------
// @desc Build the note handle the host hands back across the embed bridge.
// @param {object} note - Internal fixture note record.
// @returns {object} Handle carrying only what a structured clone would preserve.
// The production bridge structured-clones every value it returns, so a caller never receives the host's own note
//   object and cannot write through it: the internal record is deliberately withheld here so that forwarding a
//   returned handle straight into replaceNoteContent fails in tests the way it does in the app.
function bridgeNoteHandle(note) {
  return { archived: note.archived, name: note.name, tags: note.tags.slice(), uuid: note.uuid };
}
