// Compose Rich Footnotes for content this plugin writes back into a note. Amplenote footnote numbers are
// positional within the content being written rather than inherited from wherever the text came from, so text
// carrying an upstream `[^7]` must be re-emitted as the next unused integer for this write, with a matching
// `[^n]:` definition. This is the writing counterpart to `amplenote-rich-footnotes.js`, which reads and resolves
// them; both stay plain host-compatible utilities, so neither may reach browser rendering or React code.
import { referencedFootnoteIdentifiers } from "util/amplenote-rich-footnotes";

// ----------------------------------------------------------------------------------------------
// @desc Open a numbering pass for one write. Identifiers are numbered in first-cited order across everything
//   rendered against the same state, so two passages citing one source share a number and a single definition,
//   and the rendered content reads top to bottom.
// @returns {object} Numbering state with `definitions` to emit and `numberByIdentifier` assigned so far.
export function footnoteNumbering() {
  return { definitions: [], numberByIdentifier: new Map() };
}

// ----------------------------------------------------------------------------------------------
// @desc Render the definitions the references registered during a write depend on. A reference with no
//   definition renders as a literal `[^1]` in the note, so this must be appended to any content whose labels
//   were built against the same numbering state.
// @param {object} numbering - Numbering state after every label has been rendered.
// @returns {string} Definition block, newline-terminated, or an empty string when nothing was cited.
export function footnoteDefinitionsMarkdown(numbering) {
  if (!numbering?.definitions.length) return "";
  const definitionLines = numbering.definitions.map(definition => `[^${ definition.number }]: ${ definition.text }`);
  return `\n${ definitionLines.join("\n") }\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Flatten raw Amplenote markdown into text safe to place inside a markdown link label. Content copied out
//   of a note routinely carries its own links and Rich Footnote references. Nesting those inside `[...](...)`
//   produces brackets the Amplenote parser cannot pair, which leaves the written note showing bare
//   `](https://...)` fragments instead of a single link. Only the constructs that can break the pairing are
//   removed; emphasis and other inline markup are left alone because they render correctly inside a label.
// @param {string} sourceText - Markdown as stored, possibly containing links, footnote references, and images.
// @param {object|null} numbering - Numbering state from `footnoteNumbering()`, or null to drop references
//   entirely, which is what a context that cannot carry definitions (such as a heading) needs.
// @param {string} emptyFallback - Text to use when nothing readable survives the flattening.
// @returns {string} Single-line label text with no unpaired or nested bracket syntax.
export function linkLabelFromMarkdown(sourceText, numbering = null, emptyFallback = "Untitled") {
  const rawText = String(sourceText || "").trim();
  if (!rawText) return emptyFallback;
  const withFootnoteMarkers = _renumberedFootnoteReferences(rawText, numbering);
  const withoutImages = withFootnoteMarkers.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  const withoutInlineLinks = withoutImages.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const singleLineText = _flattenedStrayBrackets(withoutInlineLinks).replace(/[ \t]+/g, " ").trim();
  return singleLineText || emptyFallback;
}

// ----------------------------------------------------------------------------------------------
// @desc Render text as a link to a URL, lifting any footnote markers out of the label so they trail the link.
//   A `[^1]` left inside the label would reintroduce the nested brackets this flattening exists to avoid.
// @param {string} sourceText - Markdown to use as the link's label.
// @param {string} url - Link destination.
// @param {object|null} numbering - Numbering state for this write.
// @param {string} emptyFallback - Label text when nothing readable survives the flattening.
// @returns {string} Markdown link, followed by any footnote markers the text cited.
export function footnoteSafeLinkMarkdown(sourceText, url, numbering = null, emptyFallback = "Untitled") {
  const label = linkLabelFromMarkdown(sourceText, numbering, emptyFallback);
  const markers = label.match(/\[\^\d+\]/g) || [];
  const labelWithoutMarkers = label.replace(/\[\^\d+\]/g, "").replace(/[ \t]+/g, " ").trim();
  const linkText = labelWithoutMarkers || emptyFallback;
  return `[${ linkText }](${ url })${ markers.join("") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Replace each footnote reference in a passage with its number for this write, registering the definition
//   to emit the first time an identifier is seen. Without numbering state the references are dropped, because a
//   reference whose definition is never written renders as a literal `[^7]` in the note.
// @param {string} rawText - Markdown as stored.
// @param {object|null} numbering - Numbering state, or null when references should be dropped.
// @returns {string} Text with references renumbered or removed.
function _renumberedFootnoteReferences(rawText, numbering) {
  const citedIdentifiers = referencedFootnoteIdentifiers(rawText);
  if (!numbering) return rawText.replace(/\[\^[^\]\n]+\]/g, "");
  let renumberedText = rawText;
  for (const identifier of citedIdentifiers) {
    if (!numbering.numberByIdentifier.has(identifier)) {
      const number = numbering.definitions.length + 1;
      numbering.numberByIdentifier.set(identifier, number);
      numbering.definitions.push({ identifier, number, text: _definitionTextForReference(rawText, identifier) });
    }
    const number = numbering.numberByIdentifier.get(identifier);
    renumberedText = renumberedText.split(`[^${ identifier }]`).join(`[^${ number }]`);
  }
  return renumberedText;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe what a carried-forward footnote pointed at. Callers copy a passage without the body of the
//   footnote its source note defined, so the label attached to the reference is the only description of it that
//   travels with the text, and it becomes the definition body.
// @param {string} rawText - Markdown carrying the reference.
// @param {string} identifier - Source footnote identifier.
// @returns {string} Single-line definition body.
function _definitionTextForReference(rawText, identifier) {
  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelMatch = rawText.match(new RegExp(`\\[([^\\]]*)\\]\\[\\^${ escapedIdentifier }\\]`));
  const label = labelMatch ? labelMatch[1].trim() : "";
  return label ? `Referenced from the source task: ${ label }` : "Referenced from the source task";
}

// ----------------------------------------------------------------------------------------------
// @desc Neutralize brackets left over once links and images have been flattened, while leaving the `[^n]`
//   markers that carry the renumbered footnote references intact.
// @param {string} text - Partially flattened markdown.
// @returns {string} Text whose only remaining brackets belong to footnote markers.
function _flattenedStrayBrackets(text) {
  const markerPlaceholders = [];
  const withPlaceholders = text.replace(/\[\^\d+\]/g, marker => {
    markerPlaceholders.push(marker);
    return `\u0000${ markerPlaceholders.length - 1 }\u0000`;
  });
  const withoutBrackets = withPlaceholders.replace(/[[\]]/g, "");
  return withoutBrackets.replace(/\u0000(\d+)\u0000/g, (_match, index) => markerPlaceholders[Number(index)]);
}
