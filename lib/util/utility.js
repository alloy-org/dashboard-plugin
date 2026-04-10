/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Shared utility for rendering markdown/HTML content as safe HTML
 * Prompt summary: "global renderMarkdown function for agenda and victory-value tooltip content"
 */
import { marked, parseInline, TextRenderer } from "marked";

marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : "";
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
    }
  }
});

/**
 * Converts a markdown or HTML string into an HTML string suitable for
 * rendering with `dangerouslySetInnerHTML`. Uses the `marked` library for
 * inline markdown parsing (bold, italic, links, code, strikethrough, etc.).
 *
 * The input is treated as inline content — block-level constructs like
 * headings and lists are not wrapped in extra `<p>` tags.
 *
 * @param {string} text - Raw markdown or HTML string to render.
 * @returns {string} An HTML string ready for use with `dangerouslySetInnerHTML`.
 *
 * @example
 * renderMarkdown("**bold** and *italic*");
 * // => "<strong>bold</strong> and <em>italic</em>"
 *
 * @example
 * renderMarkdown("Visit [site](https://example.com)");
 * // => 'Visit <a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>'
 */
// [Claude] Task: render markdown/HTML text into safe HTML for dangerouslySetInnerHTML
// Prompt: "global renderMarkdown function for agenda and victory-value tooltip content"
// Date: 2026-02-22 | Model: claude-opus-4-6
export function renderMarkdown(text) {
  if (!text) return "";
  return marked.parseInline(text);
}

// [Claude] Task: render block-level markdown (lists, paragraphs) into HTML
// Prompt: "render numeric items as ol list, ensure markdown formatting is applied"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export function renderBlockMarkdown(text) {
  if (!text) return "";
  return marked.parse(text);
}

// ------------------------------------------------------------------------------------------
// [Claude claude-sonnet-4-6] Task: strip inline markdown formatting to produce plain text
// Prompt: "remove any markdown formatting from task text when prefilling DaySketch rows"
// @description Removes inline markdown syntax from a string, returning plain text.
//   Delegates standard GFM (bold, italic, code, strikethrough, links, images) to
//   marked's built-in TextRenderer. Pre-processes the two Amplenote-specific constructs
//   that marked doesn't know about: ==highlight== syntax and [^N] footnote references.
// @param {string} text - Raw markdown string
// @returns {string} Plain text with all inline formatting syntax removed
export function stripMarkdown(text) {
  if (!text) return "";
  const preprocessed = text
    .replace(/\[([^\]]+)\]\[\^?\d+\]/g, "$1")   // footnote ref links [text][^1] → text
    .replace(/\[\^[^\]]*\]/g, "")               // bare footnote markers [^1]
    .replace(/==([^=]+)==/g, "$1");             // Amplenote highlight ==text==
  return parseInline(preprocessed, { renderer: new TextRenderer() }).trim();
}
