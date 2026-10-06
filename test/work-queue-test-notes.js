// A small in-memory Amplenote app for the durable work queue tests: notes found by name or UUID, created with their
// tags and archive flag, and read and replaced whole or by heading. A test can make the next writes fail to model a failed save.

import { guideSectionRange } from "plan-wizard/vision-guide-markdown";

// ----------------------------------------------------------------------------------------------
// @desc Create the app.
// @returns {object} The app methods the queue notes use, plus { failNextWrites(count), noteContent(name), notes }.
export function workQueueNotesApp() {
  const notes = new Map();
  let sequence = 0;
  let failingWrites = 0;
  const entryNamed = name => [...notes.entries()].find(([, note]) => note.name === name) || null;
  return {
    createNote: async (name, tags = [], options = {}) => {
      sequence += 1;
      const uuid = `note-${ sequence }`;
      notes.set(uuid, { archived: Boolean(options.archive), content: "", name, tags });
      return uuid;
    },
    failNextWrites: count => { failingWrites = count; },
    findNote: async ({ name, uuid }) => {
      if (uuid) return notes.has(uuid) ? { uuid } : null;
      const entry = entryNamed(name);
      return entry ? { name, uuid: entry[0] } : null;
    },
    getNoteContent: async ({ uuid }) => notes.get(uuid)?.content ?? null,
    noteContent: name => entryNamed(name)?.[1].content ?? null,
    notes,
    // ----------------------------------------------------------------------------------------------
    // @desc Apply a whole-note or section replacement against current content, as independent client patches do.
    // @param {object} noteHandle - Note UUID.
    // @param {string} content - Replacement body.
    // @param {object} options - Optional section descriptor.
    // @returns {Promise<boolean>} Whether the target exists and was replaced.
    replaceNoteContent: async ({ uuid }, content, options = {}) => {
      if (failingWrites > 0) {
        failingWrites -= 1;
        throw new Error("Simulated write failure");
      }
      const note = notes.get(uuid);
      if (options.section) {
        const section = guideSectionRange(note.content, options.section.heading.text);
        if (!section) return false;
        note.content = `${ note.content.slice(0, section.bodyStart) }${ content }${ note.content.slice(section.end) }`;
      } else note.content = content;
      return true;
    },
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Let every queued promise callback run.
// @returns {Promise<void>}
export async function flushPromises() {
  for (let round = 0; round < 30; round += 1) await Promise.resolve();
}
