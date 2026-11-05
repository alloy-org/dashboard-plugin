// Read a note's markdown only when it is short enough to process. A note can grow far past what any reader expects:
// Amplenote's automatic merge reports have reached 61 MB, and relaying one across the embed bridge and parsing it
// pins the Dashboard's renderer. Inside the embed the length is checked on the plugin side, through the
// "boundedNoteContent" embed action, so an oversized note never crosses into the Dashboard; anywhere else, such as the
// dev app and tests, it is checked after the read. Host-compatible: plugin.js imports this module.

// ----------------------------------------------------------------------------------------------
// @desc Read a note and keep its content only when it is within a length. This is the plugin side of the
//   "boundedNoteContent" embed action, and the fallback for an app that does not offer that action.
// @param {object} app - Amplenote API with getNoteContent.
// @param {object} noteHandle - { uuid } of the note.
// @param {number} maximumCharacters - The longest content returned.
// @returns {Promise<string|object|*>} The content when it fits, { omittedCharacters } with its length when it does
//   not, or whatever getNoteContent returned when that was not a string.
export async function boundedNoteContent(app, noteHandle, maximumCharacters) {
  const content = await app.getNoteContent(noteHandle);
  if (typeof content !== "string" || content.length <= maximumCharacters) return content;
  return { omittedCharacters: content.length };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a note's content within a length, through the embed action when the app offers it, so the plugin drops an
//   oversized note before it is relayed. The embed's app answers every method name, so the action is always used there.
// @param {object} app - Amplenote API, or the embed's bridge to it.
// @param {object} noteHandle - { uuid } of the note.
// @param {number} maximumCharacters - The longest content returned.
// @returns {Promise<string|object|*>} As boundedNoteContent returns.
export async function readNoteContentWithinLength(app, noteHandle, maximumCharacters) {
  if (typeof app.boundedNoteContent === "function") return await app.boundedNoteContent(noteHandle, maximumCharacters);
  return await boundedNoteContent(app, noteHandle, maximumCharacters);
}
