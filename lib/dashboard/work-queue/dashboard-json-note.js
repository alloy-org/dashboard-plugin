// Read and write the archived Dashboard notes that keep work queue state as a fenced JSON block beneath a short
// explanation, following the project's convention for plugin-maintained data. A note that exists but holds no
// readable JSON is reported as unreadable rather than treated as empty, so a caller never overwrites what it could
// not understand.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { checkedAppResult, MAXIMUM_GUIDE_SECTION_CHARACTERS } from "plan-wizard/vision-guide-notes";

// ----------------------------------------------------------------------------------------------
// @desc The markdown a JSON note holds: a title, an explanation for anyone who opens it, and the payload.
// @param {object} options - { description, payload, title }.
// @returns {string} Note markdown.
export function jsonNoteMarkdown({ description, payload, title }) {
  return [`# ${ title }`, "", description, "", "```json", JSON.stringify(payload), "```", ""].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Find a JSON note by name and parse its payload, without creating it.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} name - Note name.
// @returns {Promise<object>} { noteHandle, payload }: a bare { uuid } handle and the parsed payload, both null when no
//   such note exists; payload is also null for a note created but never written.
// @throws When the note holds text that is not a readable JSON block, or an app call fails.
export async function readJsonNote(app, name) {
  const found = checkedAppResult(await app.findNote({ name }));
  if (!found?.uuid) return { noteHandle: null, payload: null };
  const noteHandle = { uuid: found.uuid };
  const content = checkedAppResult(await app.getNoteContent(noteHandle));
  if (typeof content !== "string") throw new Error(`Could not read "${ name }"`);
  if (!content.trim()) return { noteHandle, payload: null };
  const match = content.match(/```json\s*([\s\S]*?)```/i);
  if (!match) throw new Error(`"${ name }" holds no JSON block`);
  const payload = JSON.parse(match[1]);
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
