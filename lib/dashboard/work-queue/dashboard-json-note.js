// Read and write the archived Dashboard notes that keep work queue state as a fenced JSON block beneath a short
// explanation, following the project's convention for plugin-maintained data. A note that exists but holds no
// readable JSON is reported as unreadable rather than treated as empty, so a caller never overwrites what it could
// not understand.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { checkedAppResult, MAXIMUM_GUIDE_SECTION_CHARACTERS } from "plan-wizard/vision-guide-notes";
import { jsonFenceContent } from "util/json-utility";

// ----------------------------------------------------------------------------------------------
// @desc The markdown a JSON note holds: a title, an explanation for anyone who opens it, and the payload. Backticks,
//   which JSON allows only inside strings, are written as \u0060, so a string quoting a fenced block, such as a
//   passage copied from a note, can never close the payload's fence early.
// @param {object} options - { description, payload, title }.
// @returns {string} Note markdown.
export function jsonNoteMarkdown({ description, payload, title }) {
  const payloadJson = JSON.stringify(payload).replace(/`/g, "\\u0060");
  return [`# ${ title }`, "", description, "", "```json", payloadJson, "```", ""].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Find a JSON note by name and parse its payload, without creating it.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} name - Note name.
// @returns {Promise<object>} { noteHandle, payload }: a bare { uuid } handle and the parsed payload, both null when no
//   such note exists; payload is also null for a note created but never written.
// @throws When the note holds text that is not a readable JSON block, or an app call fails. An error for a JSON block
//   that does not parse carries unreadableJson: true, the noteHandle, and the schemaVersion the block names, or null,
//   so a store whose records can be rebuilt may replace the note in place.
export async function readJsonNote(app, name) {
  const found = checkedAppResult(await app.findNote({ name }));
  if (!found?.uuid) return { noteHandle: null, payload: null };
  const noteHandle = { uuid: found.uuid };
  const content = checkedAppResult(await app.getNoteContent(noteHandle));
  if (typeof content !== "string") throw new Error(`Could not read "${ name }"`);
  if (!content.trim()) return { noteHandle, payload: null };
  const payload = _parsedJsonBlock(content, { name, noteHandle });
  if (!payload || typeof payload !== "object") throw new Error(`"${ name }" holds no JSON object`);
  return { noteHandle, payload };
}

// ----------------------------------------------------------------------------------------------
// @desc Write a payload to a JSON note, creating the note archived and tagged when it does not exist yet.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} description - Explanation shown above the payload
//   - {string} name - Note name
//   - {object|null} noteHandle - The handle readJsonNote returned, or null to create the note
//   - {object} payload - JSON-serializable payload
//   - {string} title - Heading shown above the explanation
// @returns {Promise<object>} The bare { uuid } handle written.
// @throws When the content would exceed what Amplenote accepts in one write, or an app call fails.
export async function writeJsonNote(app, { description, name, noteHandle, payload, title }) {
  const content = jsonNoteMarkdown({ description, payload, title });
  if (content.length > MAXIMUM_GUIDE_SECTION_CHARACTERS) throw new Error(`"${ name }" would exceed one note write`);
  let handle = noteHandle;
  if (!handle) {
    const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG], { archive: true }));
    const uuid = typeof created === "string" ? created : created?.uuid;
    if (!uuid) throw new Error(`Could not create "${ name }"`);
    handle = { uuid };
  }
  checkedAppResult(await app.replaceNoteContent(handle, content));
  return handle;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Parse a note's JSON block, whose closing fence jsonFenceContent anchors to the start of a line so a string
//   quoting a fenced block, as notes written before backticks were escaped may hold, does not end it early.
// @param {string} content - Note markdown.
// @param {object} options - { name, noteHandle }: the note's name, for the error, and its handle.
// @returns {*} The parsed payload.
// @throws When the note holds no JSON block, or one that does not parse, as readJsonNote describes.
function _parsedJsonBlock(content, { name, noteHandle }) {
  const jsonText = jsonFenceContent(content);
  if (jsonText === null) throw new Error(`"${ name }" holds no JSON block`);
  try {
    return JSON.parse(jsonText);
  } catch (parseError) {
    const schemaMatch = jsonText.match(/"schemaVersion"\s*:\s*(\d+)/);
    const schemaVersion = schemaMatch ? Number(schemaMatch[1]) : null;
    throw Object.assign(new Error(`"${ name }" holds unreadable JSON: ${ parseError.message }`), { noteHandle, schemaVersion,
      unreadableJson: true });
  }
}
