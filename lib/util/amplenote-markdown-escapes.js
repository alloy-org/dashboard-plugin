// Undo the backslashes Amplenote adds before markdown punctuation when it saves a note, so text the plugin wrote,
// such as "(examined 2026-10-15)", reads back as written even after the editor stored it as "\(examined 2026-10-15)".
// Host-compatible: plain string handling only.

// A backslash before one of the punctuation characters markdown allows to be escaped.
const MARKDOWN_ESCAPE_PATTERN = /\\([\\`*_{}[\]()#+\-.!|<>])/g;

// ----------------------------------------------------------------------------------------------
// @desc Remove markdown backslash escapes from a line or passage, leaving the punctuation each one protected.
// @param {string} text - Markdown as Amplenote saved it.
// @returns {string} The text with "\(" read as "(", "\[" as "[", and so on.
export function unescapedMarkdownText(text) {
  return String(text ?? "").replace(MARKDOWN_ESCAPE_PATTERN, "$1");
}
