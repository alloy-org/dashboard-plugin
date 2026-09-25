// Locate and rewrite the parts of a quarterly plan note that Plan Builder owns, leaving everything the user
// wrote byte for byte alone. Ownership is carried by a visible [builder] marker on the heading or line rather
// than by position, so a re-publication can find its own previous output no matter what the user added around
// it, and anything without the marker is never removed.
//
// Heading enumeration reuses guideHeadingRanges from vision-guide-markdown: it is the project's fence-aware ATX
// parser, and a second implementation would be a second set of bugs. Unlike the Vision Guide, a duplicate
// heading here is tolerated rather than rejected, because a plan note is hand-edited and its author may well
// have two sections with the same name; the first match wins.

import { guideHeadingRanges } from "plan-wizard/vision-guide-markdown";

export const BUILDER_MARKER = "[builder]";
// A finished project keeps its block so the note records what the quarter delivered; the marker tells every
// suggestion surface that reads the note to leave it alone.
export const COMPLETE_MARKER = "[builder: complete]";
export const KEEP_WARM_MARKER = "[builder: keep warm]";
// Amplenote escapes literal brackets when it returns saved markdown; accept both saved and freshly rendered markers.
const BUILDER_MARKER_PATTERN = /\s*\\?\[builder(?::[^\]]*)?\\?\]\s*$/;
const COMPLETE_MARKER_PATTERN = /\\?\[builder:\s*complete\\?\]\s*$/;
const PLACEHOLDER_HEADING_PATTERN = /^\\?\[.*\\?\]$/;

// ----------------------------------------------------------------------------------------------
// @desc Read the text following a "- Label:" bullet, so a project block can carry the user's own Outcome and
//   Constraints wording across a rewrite instead of resetting it to blank.
// @param {string} body - Markdown body to search.
// @param {string} label - Bullet label without its dash or colon, e.g. "Outcome".
// @returns {string} Text after the colon, trimmed; empty when the bullet is missing or blank.
export function bulletValueFromBody(body, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^\\s*-\\s*${ escapedLabel }\\s*:(.*)$`, "m"));
  return match ? match[1].trim() : "";
}

// ----------------------------------------------------------------------------------------------
// @desc Drop the project blocks marked Complete from a plan note's Projects section, so a model reading the note to
//   suggest today's work never sees a finished project as something still to advance.
// @param {string} content - Full note markdown.
// @returns {string} Markdown without completed project blocks; unchanged when there are none, or when an unclosed
//   code fence keeps the headings from being read, since a hand-edited note must still reach the prompt.
export function contentWithoutCompletedProjects(content) {
  let section = null;
  let projectHeadings = [];
  try {
    section = planSectionRange(content || "", "Projects");
    if (!section) return content;
    projectHeadings = guideHeadingRanges(content.slice(section.bodyStart, section.end)).filter(heading => heading.level === 2);
  } catch (error) {
    return content;
  }
  const body = content.slice(section.bodyStart, section.end);
  const completedHeadings = projectHeadings.filter(heading => isCompleteMarkedText(heading.text));
  if (!completedHeadings.length) return content;
  let remainingBody = body;
  for (const heading of completedHeadings.reverse()) {
    remainingBody = `${ remainingBody.slice(0, heading.start) }${ remainingBody.slice(heading.end) }`;
  }
  return `${ content.slice(0, section.bodyStart) }${ remainingBody }${ content.slice(section.end) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Replace a section's body while preserving its heading line and everything outside the section.
// @param {string} content - Full note markdown.
// @param {string} headingText - Exact heading text naming the section.
// @param {string} body - Replacement body, without the heading line.
// @returns {string} Updated markdown; unchanged when the section is absent.
export function contentWithSectionBody(content, headingText, body) {
  const range = planSectionRange(content, headingText);
  if (!range) return content;
  const trailing = range.end === content.length ? "" : "\n";
  return `${ content.slice(0, range.bodyStart) }${ body.replace(/\s+$/, "") }\n${ trailing }${ content.slice(range.end) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Recognize raw or Amplenote-escaped ownership markers on headings and lines the builder may replace.
// @param {string} text - Heading text or a single line/segment.
// @returns {boolean} True when the builder marker closes it.
export function isBuilderMarkedText(text) {
  return BUILDER_MARKER_PATTERN.test(String(text ?? ""));
}

// ----------------------------------------------------------------------------------------------
// @desc Recognize a raw or Amplenote-escaped Complete marker on a project heading.
// @param {string} text - Heading text.
// @returns {boolean} True when the heading names a project the user finished.
export function isCompleteMarkedText(text) {
  return COMPLETE_MARKER_PATTERN.test(String(text ?? ""));
}

// ----------------------------------------------------------------------------------------------
// @desc Recognize an untouched template project block, so publishing real projects clears "[Project 2]" and its
//   empty bullets rather than leaving scaffolding beside the user's actual plan.
// @param {object} block - Parsed project block.
// @returns {boolean} True when the heading is still a bracketed placeholder and no bullet carries a value.
export function isEmptyProjectPlaceholder(block) {
  if (!isPlaceholderHeadingText(block.headingText)) return false;
  const bulletLines = block.body.split("\n").filter(line => /^\s*-\s/.test(line));
  return bulletLines.every(line => !line.replace(/^\s*-\s*[^:]*:?/, "").trim());
}

// ----------------------------------------------------------------------------------------------
// @desc Recognize a raw or escaped template fill-in-the-blank heading, e.g. "[Project 2]", so a
//   structural check knows such a heading may legitimately disappear when real projects replace it.
// @param {string} text - Heading text.
// @returns {boolean} True when the whole heading is bracketed.
export function isPlaceholderHeadingText(text) {
  return PLACEHOLDER_HEADING_PATTERN.test(String(text ?? "").trim());
}

// ----------------------------------------------------------------------------------------------
// @desc Rewrite one semicolon-separated bullet so the user's own categories stay first and untouched while the
//   builder's project names are re-derived from scratch. Previously appended builder segments are dropped before
//   the new ones are added, which is what keeps repeated publication from stacking duplicates.
// @param {string} line - The existing line, e.g. "- Tuesdays: deep work; code review; Ship v2 [builder]".
// @param {Array<string>} labels - Project names to append for this line.
// @returns {string} Updated line; returned unchanged when it is not a labelled bullet.
export function lineWithBuilderSegments(line, labels) {
  const match = line.match(/^(\s*-\s*[^:]*:)(.*)$/);
  if (!match) return line;
  const existingSegments = match[2].split(";").map(segment => segment.trim()).filter(Boolean);
  const retainedSegments = existingSegments.filter(segment => !isBuilderMarkedText(segment));
  const builderSegments = labels.map(label => `${ label } ${ BUILDER_MARKER }`);
  const segments = [...retainedSegments, ...builderSegments];
  return segments.length ? `${ match[1] } ${ segments.join("; ") }` : match[1];
}

// ----------------------------------------------------------------------------------------------
// @desc Enumerate the note's headings outside fenced code, with offsets into the original markdown.
// @param {string} content - Full note markdown.
// @returns {Array<object>} Heading ranges carrying bodyStart, end, level, start, and text, in note order.
export function planHeadingRanges(content) {
  return guideHeadingRanges(content);
}

// ----------------------------------------------------------------------------------------------
// @desc Locate a named section's subtree, tolerating a repeated heading by taking the first occurrence.
// @param {string} content - Full note markdown.
// @param {string} headingText - Exact heading text.
// @returns {object|null} Range carrying bodyStart, end, level, start, and text; null when absent.
export function planSectionRange(content, headingText) {
  return planHeadingRanges(content).find(heading => heading.text === headingText) ?? null;
}

// ----------------------------------------------------------------------------------------------
// @desc Split a Projects section body into the prose above the first project and one record per project block.
// @param {string} body - Body of the Projects section, without its own heading line.
// @returns {object} An object with the following properties:
//   - {Array<object>} blocks - One { body, headingText } per level-two project, in note order.
//   - {string} leadingText - Everything before the first project heading, preserved verbatim.
export function projectBlocksFromBody(body) {
  const projectHeadings = guideHeadingRanges(body).filter(heading => heading.level === 2);
  const leadingText = projectHeadings.length ? body.slice(0, projectHeadings[0].start) : body;
  const blocks = projectHeadings.map(heading => ({ body: body.slice(heading.bodyStart, heading.end),
    headingText: heading.text }));
  return { blocks, leadingText };
}

// ----------------------------------------------------------------------------------------------
// @desc Strip a raw or Amplenote-escaped ownership marker, leaving the heading or line's name intact.
// @param {string} text - Heading text or line.
// @returns {string} Text without its trailing builder marker.
export function textWithoutBuilderMarker(text) {
  return String(text ?? "").replace(BUILDER_MARKER_PATTERN, "").trim();
}
