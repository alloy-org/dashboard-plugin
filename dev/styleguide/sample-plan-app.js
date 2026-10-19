// An in-memory Amplenote app for opening the Plan Builder from the style guide: sample notes and completed tasks,
// with note reads and writes kept in this page's memory, so nothing touches the dev server's notes or settings.
// Modeled on test/fixtures/plan-wizard-app.js without the Jest mocks.

const SECONDS_PER_DAY = 86400;
// Completed work the Plan Builder reads as evidence: two themes, so the intent and project pages have content
const SAMPLE_TASKS = [
  { content: "Assemble the weekly analytics report by hand", daysAgo: 2, noteName: "Reporting" },
  { content: "Re-send last week's report to the team", daysAgo: 4, noteName: "Reporting" },
  { content: "Sketch the analytics dashboard layout", daysAgo: 6, noteName: "Analytics" },
  { content: "Interview a backend engineer candidate", daysAgo: 3, noteName: "Hiring" },
  { content: "Write the second engineer job description", daysAgo: 9, noteName: "Hiring" },
  { content: "Draft the October newsletter", daysAgo: 5, noteName: "Newsletter" },
  { content: "Reconcile the October invoices", daysAgo: 7, noteName: "Billing" },
  { content: "Chase the overdue invoice", daysAgo: 8, noteName: "Billing" },
];

// ----------------------------------------------------------------------------------------------
// @desc A fresh sample app; each call starts with no saved plan, so the Plan Builder opens on its first page.
// @returns {Object} App with the note and task methods the Plan Builder calls.
export function createSamplePlanApp() {
  const notes = [];
  const tasks = sampleTasks();
  return {
    context: {},
    createNote: async (name, tags, options) => {
      const uuid = `sample-note-${ notes.length + 1 }`;
      notes.push({ archived: options?.archive ?? false, content: "", localUuid: `local-${ uuid }`, name, tags, uuid });
      return `local-${ uuid }`;
    },
    deleteNote: async ({ uuid }) => removeNote(notes, uuid),
    filterNotes: async (options = {}) => notes.filter(note => (!options.tag || note.tags.includes(options.tag))
      && (options.group === "archived" ? note.archived : !note.archived)).map(noteHandle),
    findNote: async ({ uuid }) => { const note = noteForUuid(notes, uuid); return note ? noteHandle(note) : null; },
    getCompletedTasks: async () => tasks.slice(),
    getNoteContent: async ({ uuid }) => noteForUuid(notes, uuid)?.content ?? null,
    getTask: async uuid => tasks.find(task => task.uuid === uuid) || null,
    getTaskDomainTasks: async () => tasks.slice(),
    insertNoteContent: async ({ uuid }, content, options = {}) => {
      const note = noteForUuid(notes, uuid);
      if (!note) return false;
      note.content = options.atEnd ? `${ note.content }${ content }` : `${ content }${ note.content }`;
      return true;
    },
    navigate: async url => { console.info("[style guide] Plan Builder navigated to", url); return true; },
    replaceNoteContent: async (handle, content, options = {}) => replaceContent(notes, handle, content, options),
    searchNotes: async () => [],
    setSetting: async () => true,
    settings: {},
  };
}

// ----------------------------------------------------------------------------------------------
// @desc The handle the host returns for a note: plain fields only.
// @param {Object} note - Stored note.
// @returns {Object} { archived, name, tags, uuid }.
function noteHandle(note) {
  return { archived: note.archived, name: note.name, tags: note.tags.slice(), uuid: note.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc A note by its settled or local identifier.
// @param {Array<Object>} notes - Stored notes.
// @param {string} uuid - Identifier.
// @returns {Object|undefined} The note.
function noteForUuid(notes, uuid) {
  return notes.find(note => note.uuid === uuid || note.localUuid === uuid);
}

// ----------------------------------------------------------------------------------------------
// @desc Remove a note.
// @param {Array<Object>} notes - Stored notes.
// @param {string} uuid - Identifier.
// @returns {boolean} Whether a note was removed.
function removeNote(notes, uuid) {
  const index = notes.findIndex(note => note.uuid === uuid);
  if (index < 0) return false;
  notes.splice(index, 1);
  return true;
}

// ----------------------------------------------------------------------------------------------
// @desc Replace a note's content, or one heading's section of it, as the host does.
// @param {Array<Object>} notes - Stored notes.
// @param {Object} handle - { uuid }.
// @param {string} content - New content.
// @param {Object} options - { section: { heading: { text } | null, index } } to replace one section.
// @returns {boolean} Whether the write landed.
function replaceContent(notes, handle, content, options) {
  const note = notes.find(item => item.uuid === handle?.uuid);
  if (!note) return true;
  if (!("section" in options)) { note.content = content; return true; }
  const range = sectionRange(note.content, options.section);
  if (!range) return false;
  note.content = `${ note.content.slice(0, range.start) }${ content.trim() }\n\n${ note.content.slice(range.end) }`;
  return true;
}

// ----------------------------------------------------------------------------------------------
// @desc The sample tasks with ids, note ids, and completion times relative to now.
// @returns {Array<Object>} Tasks in the host's shape.
function sampleTasks() {
  const nowSeconds = Math.round(Date.now() / 1000);
  return SAMPLE_TASKS.map((task, index) => ({ completedAt: nowSeconds - task.daysAgo * SECONDS_PER_DAY,
    content: task.content, createdAt: nowSeconds - (task.daysAgo + 7) * SECONDS_PER_DAY, noteName: task.noteName,
    noteUUID: `sample-note-${ task.noteName.toLowerCase() }`, uuid: `sample-task-${ index + 1 }` }));
}

// ----------------------------------------------------------------------------------------------
// @desc A heading section's body offsets, ignoring headings inside code fences.
// @param {string} content - Note content.
// @param {Object} section - { heading: { text } | null, index }.
// @returns {Object|null} { end, start }, or null when the heading is missing.
function sectionRange(content, section) {
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
  const heading = headings.filter(candidate => candidate.text === section.heading.text)[section.index ?? 0];
  if (!heading) return null;
  const following = headings.find(candidate => candidate.start > heading.start && candidate.level <= heading.level);
  return { end: following?.start ?? content.length, start: heading.body };
}
