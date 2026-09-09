import fs from "fs"
import dotenv from "dotenv"
import fetch from "isomorphic-fetch"
import { jest } from "@jest/globals"
import pluginObject from "plugin"
import path from "path"
import { replaceSectionContent } from "util/replace-note-section-content"
import { fileURLToPath } from "url"

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_INTERFACES = [ "appOption", "dailyJotOption", "imageOption", "insertText", "linkOption",
  "noteOption", "renderEmbed", "replaceText" ];

// --------------------------------------------------------------------------------------
export function contentFromFileName(fileName) {
  const filePath = path.join(__dirname, `fixtures/${ fileName }`);
  return fs.readFileSync(filePath, "utf8");
}

// --------------------------------------------------------------------------------------
export function mockAlertAccept(app) {
  app.alert.mockImplementation(async (text, options) => {
    if (!options) return null;
    return -1;
  });
}

// --------------------------------------------------------------------------------------
export function mockPlugin() {
  const plugin = pluginObject;
  global.fetch = fetch;

  PLUGIN_INTERFACES.forEach(entryPointKey => {
    if (plugin[entryPointKey]) {
      Object.entries(plugin[entryPointKey]).forEach(([ functionName, checkAndRunOrFunction ]) => {
        if (checkAndRunOrFunction.check || checkAndRunOrFunction.run) {
          if (checkAndRunOrFunction.check) {
            plugin[entryPointKey][functionName].check = plugin[entryPointKey][functionName].check.bind(plugin);
          }
          if (checkAndRunOrFunction.run) {
            plugin[entryPointKey][functionName].run = plugin[entryPointKey][functionName].run.bind(plugin);
          }
        } else {
          plugin[entryPointKey][functionName] = plugin[entryPointKey][functionName].bind(plugin); // .insertText
        }
      });
    }
  });

  plugin.constants.isTestEnvironment = true;

  return plugin;
}

// --------------------------------------------------------------------------------------
export function mockAppWithContent(content) {
  const note = mockNote("Baby's first plugin", content, "abc123");
  const app = mockApp(note);
  return { app, note };
}

// --------------------------------------------------------------------------------------
export function mockApp(notes, { plugin = null } = {}) {
  // Accept either a single note or an array of notes
  const allNotes = Array.isArray(notes) ? notes : (notes ? [notes] : []);
  const seedNote = allNotes[0] || null;

  const app = {};

  // Store all notes for search functionality
  app._allNotes = allNotes;

  // Identity set of every note object this mock has handed back from a lookup (findNote, filterNotes,
  // searchNotes, createNote). Writing through one of these is the production bug modeled in
  // bridgeDropsWrite: the host silently drops the write and answers true. Membership is by object
  // identity, so a caller that rebuilds the handle as { uuid } is unaffected.
  const LOOKUP_RESULT_HANDLES = new WeakSet();

  // ------------------------------------------------------------------------------------------
  // @desc Mark note objects as having crossed the bridge from a lookup, then return them unchanged.
  // @param {*} result - A note object, an array of them, or null/undefined.
  // @returns {*} The same value, with any note objects registered as unwritable handles.
  const markAsLookupResult = (result) => {
    if (Array.isArray(result)) {
      result.forEach(note => { if (note && typeof note === "object") LOOKUP_RESULT_HANDLES.add(note); });
    } else if (result && typeof result === "object") {
      LOOKUP_RESULT_HANDLES.add(result);
    }
    return result;
  };

  app.alert = jest.fn().mockImplementation(async (text, options = {}) => {
    console.debug("Alert was called", text);
  });
  app.context = {};
  app.context.noteUUID = seedNote?.uuid || "abc123";
  app.context.replaceSelection = jest.fn();
  app.context.replaceSelection.mockImplementation(async (newContent, sectionObject = null) => {
    if (seedNote) {
      await seedNote.replaceContent(newContent, sectionObject);
    }
  });
  app.context.updateEmbedArgs = {};

  app.createNote = jest.fn().mockImplementation(async (name, tags = []) => {
    const newNote = mockNote(name, "", `note-created-${ Date.now() }`, { tags });
    allNotes.push(newNote);
    return markAsLookupResult(newNote);
  });

  // Helper function to find a note by handle (can be UUID string or note object)
  const findNoteByHandle = (noteHandle) => {
    const uuid = typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
    return allNotes.find(n => n.uuid === uuid);
  };

  // ------------------------------------------------------------------------------------------
  // @desc Model the embed's postMessage bridge for a handle a caller is about to write through.
  //   In production, arguments to an app call are structured-cloned across the iframe boundary. A
  //   handle that came back from findNote or filterNotes is one of the bridge's lazily-populated
  //   objects, and it does not survive that round trip as anything the host can resolve to a note:
  //   the host reports a successful write it never performed, so the note reads back unchanged with
  //   no error to catch. Only a handle the caller built itself — a bare { uuid } literal — survives.
  //   Returning true for the refused write is the point of this helper, not an oversight; a mock
  //   that threw here would be easier to satisfy than the host and would keep hiding the bug.
  // @param {*} noteHandle - Handle as passed to a write method.
  // @returns {boolean} True when the write must be dropped while still reporting success.
  const bridgeDropsWrite = (noteHandle) => noteHandle !== null && typeof noteHandle === "object" &&
    LOOKUP_RESULT_HANDLES.has(noteHandle);

  // filterNotes - searches note titles and filters by tags
  // Supports hierarchical tag matching: tag "business" matches "business", "business/updates", etc.
  app.filterNotes = jest.fn().mockImplementation(async (options = {}) => {
    const { query, tag } = options;
    let results = [...app._allNotes];

    if (tag) {
      results = results.filter(note => {
        if (!note.tags) return false;
        return note.tags.some(noteTag =>
          noteTag === tag || noteTag.startsWith(tag + "/")
        );
      });
    }

    if (query) {
      const queryWords = query.toLowerCase().split(/\s+/);
      results = results.filter(note => {
        const nameLower = (note.name || "").toLowerCase();
        // Match only if all query words appear in the title
        return queryWords.every(word => nameLower.includes(word));
      });
    }

    return markAsLookupResult(results);
  });

  app.getNoteContent = jest.fn().mockImplementation(async (noteHandle) => {
    const note = findNoteByHandle(noteHandle);
    return note ? note.content() : null;
  });

  app.insertNoteContent = jest.fn().mockImplementation(async (noteHandle, content) => {
    if (bridgeDropsWrite(noteHandle)) return true;
    const note = findNoteByHandle(noteHandle);
    if (note) {
      note.body += content;
    }
    return true;
  });

  app.navigate = jest.fn();
  app.prompt = jest.fn().mockImplementation(async (text, options = {}) => {
    console.error("Prompting user", prompt, "You probably wanted to mock this so it would respond?");
  });
  app.notes = {};
  app.notes.find = jest.fn().mockResolvedValue(null);
  app.notes.filter = jest.fn().mockResolvedValue(null);
  app.openEmbed = jest.fn().mockImplementation(async () => plugin?.renderEmbed(app))
  app.replaceNoteContent = jest.fn().mockImplementation(async (noteHandle, content, options) => {
    if (bridgeDropsWrite(noteHandle)) return true;
    const note = findNoteByHandle(noteHandle);
    if (note) {
      note.body = replaceSectionContent(note.body, content, options);
    }
    return true;
  });
  app.setSetting = jest.fn().mockResolvedValue(null);
  app.setSetting.mockImplementation((key, value) => {
    app.settings[key] = value;
  });

  app.settings = {};
  for (const providerEm of Object.keys(PROVIDER_SETTING_KEY_LABELS)) {
    if (aiProviderTestKey(providerEm)) {
      app.settings[settingKeyLabel(providerEm)] = aiProviderTestKey(providerEm);
    }
  }

  // searchNotes - searches note content
  app.searchNotes = jest.fn().mockImplementation(async (query) => {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    const matches = app._allNotes.filter(note => {
      const contentLower = (note.body || "").toLowerCase();
      const nameLower = (note.name || "").toLowerCase();
      const combined = contentLower + " " + nameLower;
      // Match if the query appears as a phrase, or if all words appear
      return combined.includes(queryLower) || queryWords.every(word => combined.includes(word));
    });
    return markAsLookupResult(matches);
  });

  if (allNotes.length > 0) {
    const noteFunction = jest.fn();
    noteFunction.mockImplementation(async (noteHandle) => {
      return markAsLookupResult(findNoteByHandle(noteHandle) || null);
    });

    app.findNote = noteFunction;
    app.notes.find = noteFunction;
  }

  return app;
}

// --------------------------------------------------------------------------------------
export function mockNote(name, content, uuid, options = {}) {
  const note = {};
  note.body = content;
  note.name = name;
  note.uuid = uuid;
  note.tags = options.tags || [];
  note.created = options.created || new Date().toISOString();
  note.updated = options.updated || new Date().toISOString();
  note._images = options.images || [];
  note._attachments = options.attachments || [];

  note.content = async () => note.body;

  // --------------------------------------------------------------------------------------
  note.attachments = async () => {
    return note._attachments;
  }

  // --------------------------------------------------------------------------------------
  note.insertContent = async (newContent, options = {}) => {
    if (options.atEnd) {
      note.body += newContent;
    } else {
      note.body = `${ note.body }\n${ newContent }`;
    }
  }

  // --------------------------------------------------------------------------------------
  note.replaceContent = async (newContent, sectionObject = null) => {
    note.body = replaceSectionContent(note.body, newContent, sectionObject);
  };

  // --------------------------------------------------------------------------------------
  note.sections = async () => {
    const headingMatches = note.body.matchAll(/^#+\s*([^\n]+)/gm);
    return Array.from(headingMatches).map(match => ({
      anchor: match[1].replace(/\s/g, "_"),
      level: /^#+/.exec(match[0]).length,
      text: match[1],
    }));
  }

  // --------------------------------------------------------------------------------------
  note.images = async () => {
    return note._images;
  }

  // --------------------------------------------------------------------------------------
  note.url = async () => {
    return `https://www.amplenote.com/notes/${ note.uuid }`;
  }

  return note;
}

// --------------------------------------------------------------------------------------
// @param {{ daysAgo?: number, monthsAgo?: number }} age - Relative note age from "now"
// @returns {string} ISO timestamp for a note created/updated time relative to now
export function noteTimestampFromNow(age = {}) {
  const { daysAgo, monthsAgo } = age;
  const timestamp = new Date();

  if (Number.isInteger(monthsAgo) && monthsAgo > 0) {
    timestamp.setMonth(timestamp.getMonth() - monthsAgo);
  }

  if (Number.isInteger(daysAgo) && daysAgo > 0) {
    timestamp.setDate(timestamp.getDate() - daysAgo);
  }

  return timestamp.toISOString();
}

// --------------------------------------------------------------------------------------
// Returns an array of provider identifiers that have API keys configured in the environment
export function providersWithApiKey() {
  const allProviders = Object.keys(PROVIDER_SETTING_KEY_LABELS);
  return allProviders.filter(providerEm => aiProviderTestKey(providerEm));
}
