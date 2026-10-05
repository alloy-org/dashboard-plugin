// Read the projects a quarterly plan note schedules for one month from that month's "- Focus:" bullet, gauge how
// demanding that many projects makes the month, and star the one project the user picks as the month's focus.
// The star is written into the Focus bullet itself, in front of the chosen project, so the note stays the record
// of the choice and Plan Builder's re-publication carries it forward. Host-compatible: no React or DOM.
import { MONTH_FOCUS_STAR, isBuilderMarkedText, isStarredSegment, planHeadingRanges, segmentWithoutStar,
  textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";

const FOCUS_LINE_PATTERN = /^(\s*[-*]\s*Focus\s*:)(.*)$/i;
const HEADING_LINE_PATTERN = /^\s*#{1,6}\s/;
// Most projects in each level; anything past the ambitious limit is aggressive.
const FOCUSED_PROJECT_LIMIT = 2;
const AMBITIOUS_PROJECT_LIMIT = 4;
// Segments drawn in the intensity meter. A month with more projects than this fills the meter.
export const MONTH_INTENSITY_SEGMENT_COUNT = 10;
export const MONTH_INTENSITY_LEVELS = [
  { levelEm: "focused", levelLabel: "Focused", firstSegment: 1 },
  { levelEm: "ambitious", levelLabel: "Ambitious", firstSegment: FOCUSED_PROJECT_LIMIT + 1 },
  { levelEm: "aggressive", levelLabel: "Aggressive", firstSegment: AMBITIOUS_PROJECT_LIMIT + 1 },
];

// ----------------------------------------------------------------------------------------------
// @desc Rewrite the first Focus bullet in a quarterly plan note's month section so only the named project is
//   starred. Every other segment loses its star, so the month has at most one focus project.
// @param {string} content - Full note markdown.
// @param {string} monthName - Full month name naming the section, matched case-insensitively, e.g. "October".
// @param {string|null} starredLabel - Project label to star, or null to clear the month's star.
// @returns {string} Updated markdown; unchanged when the month or its Focus bullet is absent.
export function contentWithStarredMonthProject(content, monthName, starredLabel) {
  const monthHeading = planHeadingRanges(content).find(heading =>
    heading.text.trim().toLowerCase() === monthName.toLowerCase());
  if (!monthHeading) return content;
  const bodyLines = content.slice(monthHeading.bodyStart, monthHeading.end).split("\n");
  const focusLineIndex = focusLineIndexFromLines(bodyLines);
  if (focusLineIndex === -1) return content;
  bodyLines[focusLineIndex] = focusLineWithStar(bodyLines[focusLineIndex], starredLabel);
  const updatedBody = bodyLines.join("\n");
  return `${ content.slice(0, monthHeading.bodyStart) }${ updatedBody }${ content.slice(monthHeading.end) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Find the month section's Focus bullet, stopping at the first nested heading so a subsection's own Focus
//   bullet is never mistaken for the month's.
// @param {Array<string>} lines - Section body lines.
// @returns {number} Index of the Focus line, or -1 when the section has none.
function focusLineIndexFromLines(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (HEADING_LINE_PATTERN.test(lines[index])) return -1;
    if (FOCUS_LINE_PATTERN.test(lines[index])) return index;
  }
  return -1;
}

// ----------------------------------------------------------------------------------------------
// @desc Star one segment of a Focus bullet and unstar the rest.
// @param {string} line - The Focus bullet, e.g. "- Focus: hiring; Ship v2 [builder]".
// @param {string|null} starredLabel - Label of the segment to star, or null to star none.
// @returns {string} The rewritten bullet.
function focusLineWithStar(line, starredLabel) {
  const [, prefix, segmentText] = line.match(FOCUS_LINE_PATTERN);
  const segments = segmentsFromFocusText(segmentText);
  const rewrittenSegments = segments.map(segment => {
    const unstarredSegment = segmentWithoutStar(segment);
    return projectLabelFromSegment(segment) === starredLabel ? `${ MONTH_FOCUS_STAR } ${ unstarredSegment }` : unstarredSegment;
  });
  return rewrittenSegments.length ? `${ prefix } ${ rewrittenSegments.join("; ") }` : prefix;
}

// ----------------------------------------------------------------------------------------------
// @desc List the projects a month section's Focus bullet names, and the rest of the section the widget renders
//   as markdown beneath them.
// @param {string|null} sectionContent - Month section body, without its heading, as extractMonthSectionContent
//   returns it.
// @returns {Object} An object with the following properties:
//   - {Array<Object>} projects - One { isBuilder, isStarred, label } per Focus segment, in note order.
//   - {string} remainingContent - The section without its Focus bullet.
export function monthFocusProjects(sectionContent) {
  const lines = String(sectionContent ?? "").split("\n");
  const focusLineIndex = focusLineIndexFromLines(lines);
  if (focusLineIndex === -1) return { projects: [], remainingContent: lines.join("\n").trim() };
  const segments = segmentsFromFocusText(lines[focusLineIndex].match(FOCUS_LINE_PATTERN)[2]);
  const projects = segments.map(segment => ({ isBuilder: isBuilderMarkedText(segment), isStarred: isStarredSegment(segment),
    label: projectLabelFromSegment(segment) }));
  const remainingLines = lines.filter((line, index) => index !== focusLineIndex);
  return { projects, remainingContent: remainingLines.join("\n").trim() };
}

// ----------------------------------------------------------------------------------------------
// @desc Gauge how demanding a month is from how many projects it schedules, for the Planning widget's meter. The
//   first count in the Ambitious and Aggressive levels reads as "Mildly" that level.
// @param {number} projectCount - Projects scheduled for the month.
// @param {string} monthName - Month the count belongs to, used in the hint.
// @returns {Object} An object with the following properties:
//   - {string} hint - One sentence on what would move the month to the neighboring level.
//   - {string} levelEm - focused, ambitious, or aggressive.
//   - {string} levelLabel - Display name of the level, e.g. "Mildly Ambitious" at 3 projects.
//   - {number} projectCount - The count given.
export function monthPlanIntensity(projectCount, monthName) {
  const level = MONTH_INTENSITY_LEVELS.slice().reverse().find(candidate => projectCount >= candidate.firstSegment)
    ?? MONTH_INTENSITY_LEVELS[0];
  let hint = `Room for another project in ${ monthName }.`;
  if (projectCount === 0) hint = `No projects are scheduled for ${ monthName } yet.`;
  if (level.levelEm === "ambitious") {
    const projectsUntilAggressive = AMBITIOUS_PROJECT_LIMIT + 1 - projectCount;
    const projectPhrase = projectsUntilAggressive === 1 ? "One more project tips" : `${ projectsUntilAggressive } more projects tip`;
    hint = `${ projectPhrase } ${ monthName } into Aggressive.`;
  }
  if (level.levelEm === "aggressive") {
    const projectsOverAmbitious = projectCount - AMBITIOUS_PROJECT_LIMIT;
    const projectPhrase = projectsOverAmbitious === 1 ? "1 project" : `${ projectsOverAmbitious } projects`;
    hint = `Move ${ projectPhrase } to another month to ease back to Ambitious.`;
  }
  const isMildLevel = level.levelEm !== "focused" && projectCount === level.firstSegment;
  const levelLabel = isMildLevel ? `Mildly ${ level.levelLabel }` : level.levelLabel;
  return { hint, levelEm: level.levelEm, levelLabel, projectCount };
}

// ----------------------------------------------------------------------------------------------
// @desc The project name a Focus segment carries, without its star or builder marker.
// @param {string} segment - One semicolon-separated segment.
// @returns {string} The project label.
function projectLabelFromSegment(segment) {
  return textWithoutBuilderMarker(segmentWithoutStar(segment));
}

// ----------------------------------------------------------------------------------------------
// @desc Split the text after "Focus:" into its non-empty segments.
// @param {string} focusText - Text following the bullet's colon.
// @returns {Array<string>} Trimmed segments.
function segmentsFromFocusText(focusText) {
  const segments = String(focusText ?? "").split(";").map(segment => segment.trim());
  const namedSegments = segments.filter(segment => segment && segment !== "\\");
  return namedSegments;
}
