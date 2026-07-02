// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "persist the Shared Notes widget's pinned notes by creating an archived note and
//   storing the pinned note UUIDs as text (a fenced JSON block), rather than via app.setSetting"
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { parsePinnedNoteUuids } from "shared-notes-service";
import { logIfEnabled } from "util/log";

const PINS_NOTE_NAME = "Dashboard Shared Notes Pins";

// ----------------------------------------------------------------------------------------------
// @desc Parse the fenced-JSON pinned-UUID list out of the pins note's content, tolerating an empty or
//   corrupt note (returns []).
// @param {string|null} content - Raw note markdown.
// @returns {Array<string>} The normalized pinned note UUIDs.
// [Claude claude-opus-4-8 (1M context)] Task: read the pinned-note UUIDs stored as text in the pins note
function pinnedUuidsFromNoteContent(content) {
  if (!content || typeof content !== "string") return [];

  const match = content.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = match ? match[1] : content;
  const jsonContent = JSON.parse(jsonText)
  return jsonContent && parsePinnedNoteUuids(jsonContent.pinnedUuids);
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize the pinned UUIDs into readable archived-note content with a fenced JSON block as the
//   source of truth.
// @param {Array<string>} pinnedUuids - The note UUIDs the user has pinned.
// @returns {string}
function noteContentFromPinnedUuids(pinnedUuids) {
  return ["# Shared Notes pins", "",
    "This archived note is maintained by the dashboard plugin. It records which notes you have pinned to the top of the Shared Notes widget.",
    "", "```json", JSON.stringify({ pinnedUuids }, null, 2), "```", ""].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Find (or create) the archived pins note and return its handle plus current pinned UUIDs.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<{noteHandle: object, pinnedUuids: Array<string>}>}
// [Claude claude-opus-4-8 (1M context)] Task: resolve the archived pins note, creating it on first use
async function resolvePinsNote(app) {
  let noteHandle = await app.findNote({ name: PINS_NOTE_NAME, tags: [DASHBOARD_NOTE_TAG] }).catch(() => null);
  if (noteHandle?.uuid) {
    const content = await app.getNoteContent({ uuid: noteHandle.uuid }).catch(() => "");
    return { noteHandle, pinnedUuids: pinnedUuidsFromNoteContent(content) };
  }
  const created = await app.createNote(PINS_NOTE_NAME, [DASHBOARD_NOTE_TAG], { archive: true });
  noteHandle = { name: PINS_NOTE_NAME, uuid: typeof created === "object" ? created.uuid : created };
  await app.replaceNoteContent(noteHandle, noteContentFromPinnedUuids([])).catch(
    err => logIfEnabled("[shared-notes-archive] failed to initialize pins note:", err));
  logIfEnabled(`[shared-notes-archive] created pins note "${ PINS_NOTE_NAME }" uuid ${ noteHandle.uuid }`);
  return { noteHandle, pinnedUuids: [] };
}

// ----------------------------------------------------------------------------------------------
// @desc Load the persisted pinned-note UUIDs, returning [] when no pins note exists yet or on any read
//   error (never throws — the widget renders unpinned).
// @param {object} app - Amplenote app bridge.
// @returns {Promise<Array<string>>}
// [Claude claude-opus-4-8 (1M context)] Task: expose the persisted pinned UUIDs to the Shared Notes widget
// Prompt: "state is persisted by creating an archived note and storing settings/data as text"
export async function loadPinnedNoteUuids(app) {
  const noteHandle = await app.findNote({ name: PINS_NOTE_NAME, tags: [DASHBOARD_NOTE_TAG] });
  if (!noteHandle?.uuid) return [];
  const content = await app.getNoteContent({ uuid: noteHandle.uuid });
  return pinnedUuidsFromNoteContent(content);
}

// ----------------------------------------------------------------------------------------------
// @desc Persist the given pinned-note UUIDs to the archived pins note, creating it on first pin.
// @param {object} app - Amplenote app bridge.
// @param {Array<string>} pinnedUuids - The note UUIDs to persist as pinned.
// @returns {Promise<void>}
export async function storePinnedNoteUuids(app, pinnedUuids) {
  const cleaned = parsePinnedNoteUuids(pinnedUuids);
  const { noteHandle } = await resolvePinsNote(app);
  await app.replaceNoteContent(noteHandle, noteContentFromPinnedUuids(cleaned));
  logIfEnabled("[shared-notes-archive] stored pins", { count: cleaned.length });
}
