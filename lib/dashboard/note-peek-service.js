// [Claude claude-opus-5 (1M context)-authored file]
// Prompt summary: "new NotePeek component that displays the markdown-rendered contents of a note from
//   the user's account, chosen through an app.prompt note selector and remembered via app.setSetting"
import { parseWidgetConfig, widgetConfigKey } from "constants/settings";
import { updatePluginSetting } from "plugin-data";
import { logIfEnabled } from "util/log";

export const NOTE_PEEK_WIDGET_ID = "note-peek";

// ----------------------------------------------------------------------------------------------
// @desc Resolve the HTML the widget displays for one note. The host does the rendering: the note's
//   markdown goes to app.htmlFromContent, which answers with the full breadth of Amplenote content
//   (headings, tables, checkboxes, images, rich footnotes) already rendered as HTML, so nothing here
//   parses markdown. The plugin bridge resolves a failed host call to `{ error }` rather than throwing,
//   so anything that is not a string is treated as a failure.
// @param {Object} app - Amplenote app bridge.
// @param {string} noteUUID - UUID of the note whose content should be rendered.
// @returns {Promise<string>} HTML ready for dangerouslySetInnerHTML; "" when the note has no content.
export async function fetchNotePeekHtml(app, noteUUID) {
  const markdown = await app.getNoteContent({ uuid: noteUUID });
  if (typeof markdown !== "string") logIfEnabled("[NotePeek] getNoteContent returned no markdown:", markdown);
  const content = typeof markdown === "string" ? markdown : "";
  if (!content.trim()) return "";
  const html = await app.htmlFromContent(content);
  if (typeof html !== "string" || !html) {
    logIfEnabled("[NotePeek] htmlFromContent returned no HTML:", html);
    throw new Error(html?.error || "This note's content could not be rendered");
  }
  return html;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the note the user picked for the widget out of a settings snapshot. The selection is
//   persisted as the widget's config array (`[noteUUID, noteName]`) so it travels through the same
//   settings plumbing as every other widget's configuration.
// @param {Object} settings - Settings map, e.g. the embed's pluginSettings() snapshot.
// @returns {{noteName: string, noteUUID: string}|null} The stored selection, or null when unchosen.
export function notePeekSelectionFromSettings(settings) {
  const config = parseWidgetConfig(settings, NOTE_PEEK_WIDGET_ID);
  const [noteUUID, noteName] = Array.isArray(config) ? config : [];
  if (!noteUUID || typeof noteUUID !== "string") return null;
  return { noteName: typeof noteName === "string" ? noteName : "", noteUUID };
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the user which note to display, using the host's own note-selector prompt input. A single
//   input resolves to the chosen noteHandle itself, but an array is tolerated in case a host wraps it.
// @param {Object} app - Amplenote app bridge.
// @param {string|null} currentNoteName - Name of the note currently displayed, mentioned in the prompt
//   message so the user can see what they are replacing; omitted from the message when nothing is set.
// @returns {Promise<{noteName: string, noteUUID: string}|null>} The chosen note, or null when the user
//   cancelled or the host returned something without a UUID.
export async function promptForNotePeekNote(app, currentNoteName = null) {
  const message = currentNoteName
    ? `Note Peek is currently showing "${ currentNoteName }". Choose the note to show instead.`
    : "Choose the note whose contents should be displayed in this Note Peek widget.";
  const result = await app.prompt(message, { inputs: [{ label: "Note", type: "note" }] });
  const noteHandle = Array.isArray(result) ? result[0] : result;
  if (!noteHandle?.uuid) {
    logIfEnabled("[NotePeek] no note chosen from prompt:", result);
    return null;
  }
  return { noteName: noteHandle.name || "", noteUUID: noteHandle.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Persist the chosen note as the widget's config, mirroring the write into the embed-side
//   settings cache so a re-mount before the next init still sees the selection.
// @param {Object} app - Amplenote app bridge.
// @param {{noteName: string, noteUUID: string}} selection - The note the user chose.
export async function storeNotePeekSelection(app, { noteName, noteUUID }) {
  const config = [noteUUID, noteName || ""];
  await app.setSetting(widgetConfigKey(NOTE_PEEK_WIDGET_ID), JSON.stringify(config));
  updatePluginSetting(widgetConfigKey(NOTE_PEEK_WIDGET_ID), config);
  logIfEnabled("[NotePeek] stored note selection:", config);
}
