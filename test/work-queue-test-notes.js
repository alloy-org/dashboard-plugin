// A small in-memory Amplenote app for the durable work queue tests: notes found by name or UUID, created with their
// tags and archive flag, and read and replaced whole. A test can make the next writes fail to model a failed save.

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
    replaceNoteContent: async ({ uuid }, content) => {
      if (failingWrites > 0) {
        failingWrites -= 1;
        throw new Error("Simulated write failure");
      }
      notes.get(uuid).content = content;
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
