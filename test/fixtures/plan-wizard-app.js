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
      notes.push({ archived: options?.archive ?? false, content: "", name, tags, uuid });
      return uuid;
    }),
    filterNotes: jest.fn(async (options = {}) => notes.filter(note => (!options.tag || note.tags.includes(options.tag))
      && (options.group === "archived" ? note.archived : !note.archived))),
    findNote: jest.fn(async ({ uuid }) => notes.find(note => note.uuid === uuid) ?? null),
    getNoteContent: jest.fn(async ({ uuid }) => notes.find(note => note.uuid === uuid)?.content ?? null),
    navigate: jest.fn(async () => true),
    replaceNoteContent: jest.fn(async ({ uuid }, content, { section }) => {
      const note = notes.find(item => item.uuid === uuid);
      if (!note) return false;
      const range = mockSectionRange(note.content, section);
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
// @param {object} section - heading descriptor, with heading:null selecting initial content.
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
