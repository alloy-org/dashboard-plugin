// Decide whether a quarter's plan note already holds writing the user did outside Plan Builder, so the wizard
// can offer a way to open that note. Builder output is marked and is not such writing: a note that differs from
// the default template only by that output, or by the empty project stubs a publication clears, is still the
// template as far as the user is concerned.

import { defaultQuarterlyTemplate, quarterLabel } from "constants/quarters";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { PROJECTS_HEADING } from "plan-wizard/quarterly-plan-merge";
import { contentWithSectionBody, isBuilderMarkedText, isEmptyProjectPlaceholder, planHeadingRanges,
  planSectionRange, projectBlocksFromBody } from "plan-wizard/quarterly-plan-markdown";
import { resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";

// Colon bullets the quarterly template already contains. A publication fills these and leaves the label behind
// when it has nothing of the user's to keep; a builder bullet the template never had (an intent, a day's bar)
// disappears instead, so its absence does not look like an edit.
const TEMPLATE_BULLET_LABELS = new Set(["Carry forward", "Constraints", "Deadline", "Done enough when", "Finished",
  "Focus", "Fridays", "Key move", "Lessons learned", "Mondays", "Outcome", "Progress made", "Thursdays", "Tuesdays",
  "Wednesdays", "Weekly rhythm", "Why now"]);

// ----------------------------------------------------------------------------------------------
// @desc Drop the headings, lines, and semicolon-separated segments Plan Builder owns, leaving the user's own
//   writing in place.
// @param {string} content - Quarterly plan note markdown.
// @returns {string} The same note with builder-owned text removed.
function contentWithoutBuilderOwnedText(content) {
  const builderHeadings = planHeadingRanges(content).filter(heading => isBuilderMarkedText(heading.text));
  let stripped = content;
  for (const heading of builderHeadings.reverse()) {
    stripped = `${ stripped.slice(0, heading.start) }${ stripped.slice(heading.end) }`;
  }
  const keptLines = stripped.split("\n").map(lineWithoutBuilderContribution).filter(line => line !== null);
  return keptLines.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Rewrite the Projects section without untouched "[Project N]" stubs, in one shape, so a publication that
//   cleared those stubs compares equal to the template once both have been rewritten.
// @param {string} content - Quarterly plan note markdown.
// @returns {string} The note with empty placeholder project blocks removed. A note without a Projects section
//   is returned unchanged.
function contentWithoutEmptyProjectPlaceholders(content) {
  const range = planSectionRange(content, PROJECTS_HEADING);
  if (!range) return content;
  const body = content.slice(range.bodyStart, range.end);
  const { blocks, leadingText } = projectBlocksFromBody(body);
  const retainedBlocks = blocks.filter(block => !isEmptyProjectPlaceholder(block));
  const retainedMarkdown = retainedBlocks.map(block => {
    const blockBody = block.body.replace(/^\n+|\s+$/g, "");
    return `## ${ block.headingText }\n${ blockBody }`;
  });
  const leading = leadingText.replace(/^\n+|\s+$/g, "");
  const nextBody = [leading, ...retainedMarkdown].filter(Boolean).join("\n\n");
  return contentWithSectionBody(content, PROJECTS_HEADING, nextBody);
}

// ----------------------------------------------------------------------------------------------
// @desc Remove builder-owned segments from one line. A line that is entirely the builder's is returned as null
//   so the caller can drop it, except a template bullet, which stays as its empty label.
// @param {string} line - One line of note markdown.
// @returns {string|null} The line without builder segments, or null when the line itself should be removed.
function lineWithoutBuilderContribution(line) {
  const match = line.match(/^(\s*-\s*[^:]*:)(.*)$/);
  if (!match) return isBuilderMarkedText(line) ? null : line;
  const existingSegments = match[2].split(";").map(segment => segment.trim()).filter(Boolean);
  if (!existingSegments.length) return line;
  const retainedSegments = existingSegments.filter(segment => !isBuilderMarkedText(segment));
  if (retainedSegments.length) return `${ match[1] } ${ retainedSegments.join("; ") }`;
  const label = match[1].replace(/^\s*-\s*/, "").replace(/:\s*$/, "");
  if (TEMPLATE_BULLET_LABELS.has(label)) return match[1];
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a plan note to the text a comparison can rely on: Amplenote's escaped brackets and blank-paragraph
//   backslashes, trailing whitespace, and runs of blank lines do not by themselves mean the user edited it.
// @param {string} content - Note markdown.
// @returns {string} Comparison text.
function normalizePlanNoteText(content) {
  const unescaped = String(content ?? "").replace(/\\\[/g, "[").replace(/\\\]/g, "]");
  const lines = unescaped.replace(/\r\n/g, "\n").split("\n").map(line => (line.trim() === "\\" ? "" : line.trimEnd()));
  return lines.join("\n").trim().replace(/\n{3,}/g, "\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether a plan note's markdown carries anything the user wrote, as opposed to the default
//   template or that template plus Plan Builder's own marked output.
// @param {string} noteContent - The plan note as it was read.
// @param {string} templateContent - defaultQuarterlyTemplate for the same quarter.
// @returns {boolean} True when the note differs from the template by writing that is not the builder's.
// A note that cannot be parsed is treated as user-edited when it is not the template: an unclosed fence is
//   itself something the user left behind, and hiding the link would strand them with no way to the note.
export function planNoteHasUserEdits(noteContent, templateContent) {
  if (typeof noteContent !== "string") return false;
  const normalizedNote = normalizePlanNoteText(noteContent);
  const normalizedTemplate = normalizePlanNoteText(templateContent);
  if (normalizedNote === normalizedTemplate) return false;
  if (!normalizedNote) return true;
  try {
    const stripped = contentWithoutBuilderOwnedText(noteContent);
    if (normalizePlanNoteText(stripped) === normalizedTemplate) return false;
    // Placeholder stubs disappear only when a publication has real projects to put in their place, which is also
    // when the note carries a builder marker. Without one, a missing stub is the user's own deletion.
    if (!/\\?\[builder(?::[^\]]*)?\\?\]/.test(noteContent)) return true;
    const strippedWithoutPlaceholders = contentWithoutEmptyProjectPlaceholders(stripped);
    const templateWithoutPlaceholders = contentWithoutEmptyProjectPlaceholders(templateContent);
    return normalizePlanNoteText(strippedWithoutPlaceholders) !== normalizePlanNoteText(templateWithoutPlaceholders);
  } catch {
    return true;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Find the quarter's plan note when it already contains writing the user did outside Plan Builder.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Task domain display name, or null for All Notes.
//   - {string|null} domainUuid - Task domain UUID, or null for All Notes.
//   - {number} quarter - Quarter being planned, 1 through 4.
//   - {number} year - Planning year.
// @returns {Promise<string|null>} The plan note's UUID, or null when the quarter has no such note.
// The lookup never creates a note. A missing note, an unreadable one, and one that is still the template (or
//   only the builder's additions to it) all resolve to null, so the wizard simply offers no link.
export async function userEditedPlanNoteUuid(app, { domainName = null, domainUuid = null, quarter, year } = {}) {
  const scope = resolvePlanScope({ domainName, domainUuid, quarter, year });
  const label = quarterLabel(scope.year, scope.quarter);
  const noteDomainName = scope.domainUuid ? scope.domainName : null;
  const note = await resolveQuarterlyPlanNote(app, false, noteDomainName, label);
  if (!note?.uuid) return null;
  const content = await app.getNoteContent({ uuid: note.uuid });
  if (typeof content !== "string") return null;
  const template = defaultQuarterlyTemplate(label, scope.quarter);
  return planNoteHasUserEdits(content, template) ? note.uuid : null;
}
