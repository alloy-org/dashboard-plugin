// Merge a Plan Builder publication into an existing quarterly plan note, section by section, so the note ends up
// holding the sum of what the user wrote by hand and what they decided in the wizard.
//
// Two rules govern every section. Anything carrying the [builder] marker is the wizard's to replace or delete;
// anything without it is the user's and survives untouched. And where the wizard has something to add to a line
// the user also writes on -- the day-of-week bullets, a month's Focus -- their text stays first and the builder's
// project names are appended after it, so publishing repeatedly never disturbs the words they typed.
//
// The quarter's name is written once, as the note's leading heading, rather than also into Quarter Theme: the
// wizard captures a single name and repeating it two lines later would say the same thing twice.
//
// The one place scaffolding is cleared rather than preserved is a project block still holding its bracketed
// "[Project 2]" placeholder name and no filled-in bullets: leaving three empty stubs beside the real projects
// would be noise, and an untouched placeholder is template output rather than anything the user wrote.

import { FULL_MONTH_NAMES } from "constants/quarters";
import { BUILDER_MARKER, KEEP_WARM_MARKER, bulletValueFromBody, contentWithSectionBody, isBuilderMarkedText,
  isEmptyProjectPlaceholder, lineWithBuilderSegments, planHeadingRanges, planSectionRange, projectBlocksFromBody,
  textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";

export const DAY_OF_WEEK_HEADING = "Day-of-Week Breakdown";
export const MONTH_BREAKDOWN_HEADING = "Month-by-Month Breakdown";
export const NOT_THIS_QUARTER_HEADING = "Not This Quarter";
export const PROJECTS_HEADING = "Projects";
export const QUARTER_THEME_HEADING = "Quarter Theme";
export const SUCCESS_HEADING = "Success Looks Like";
// Bullets the wizard never learns and therefore never overwrites; their values ride across a block rewrite.
const USER_OWNED_PROJECT_BULLETS = ["Outcome", "Constraints", "Done enough when"];

// ----------------------------------------------------------------------------------------------
// @desc Rewrite the day-of-week bullets so each day names the projects whose preferred weekdays include it.
// @param {string} body - Existing Day-of-Week Breakdown body.
// @param {Array<object>} projects - Published project records.
// @returns {string} Updated body.
function dayOfWeekBody(body, projects) {
  const lines = body.split("\n").map(line => {
    const dayMatch = line.match(/^\s*-\s*([A-Za-z]+)s\s*:/);
    if (!dayMatch) return line;
    const weekday = dayMatch[1].toLowerCase();
    const dayProjects = projects.filter(project => project.preferredWeekdays.includes(weekday));
    return lineWithBuilderSegments(line, dayProjects.map(project => project.summary));
  });
  return lines.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Render one project as the note's six-bullet block, carrying the bullets the wizard never asks about
//   forward from the block it is replacing so a rewrite cannot erase the user's own Outcome wording.
// @param {object} project - Published project record.
// @param {string} previousBody - Body of this project's previous builder block, or empty on first publication.
// @returns {string} Markdown block including its heading line.
function projectBlockMarkdown(project, previousBody) {
  const marker = project.isKeptWarm ? KEEP_WARM_MARKER : BUILDER_MARKER;
  const weekdayLabels = project.preferredWeekdays.map(weekday => `${ weekday.charAt(0).toUpperCase() }${ weekday.slice(1) }`);
  const rhythmSuffix = weekdayLabels.length ? ` (${ weekdayLabels.join(", ") })` : "";
  const carried = Object.fromEntries(USER_OWNED_PROJECT_BULLETS.map(label => [label, bulletValueFromBody(previousBody, label)]));
  const bullets = [`- Outcome: ${ carried.Outcome }`, `- Why now: ${ project.substantiations.join("; ") }`,
    `- Weekly rhythm: ${ project.paceLabel }${ rhythmSuffix }`, `- Deadline: ${ project.deadlineOn ?? "" }`,
    `- Constraints: ${ carried.Constraints }`, `- Done enough when: ${ carried["Done enough when"] }`];
  const trimmedBullets = bullets.map(bullet => bullet.replace(/\s+$/, ""));
  return `## ${ project.summary } ${ marker }\n${ trimmedBullets.join("\n") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Rewrite the Month-by-Month Focus bullets so each month names the projects placed in it on the timeline.
//   Both heading depths the codebase produces are recognized, since the quarterly template writes months at
//   level two while an appended month section writes them at level three.
// @param {string} body - Existing Month-by-Month Breakdown body.
// @param {Array<object>} projects - Published project records.
// @param {Array<string>} quarterMonthKeys - The quarter's YYYY-MM keys.
// @returns {string} Updated body.
function monthBreakdownBody(body, projects, quarterMonthKeys) {
  const monthKeyByName = new Map(quarterMonthKeys.map(monthKey => [FULL_MONTH_NAMES[Number(monthKey.slice(5)) - 1], monthKey]));
  let currentMonthKey = null;
  const lines = body.split("\n").map(line => {
    const headingMatch = line.match(/^\s*#{2,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      currentMonthKey = monthKeyByName.get(headingMatch[1].split(" ")[0]) ?? null;
      return line;
    }
    if (!currentMonthKey || !/^\s*-\s*Focus\s*:/.test(line)) return line;
    const monthProjects = projects.filter(project => project.focusMonths.includes(currentMonthKey));
    return lineWithBuilderSegments(line, monthProjects.map(project => project.summary));
  });
  return lines.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Replace the builder's project blocks while keeping every block the user wrote, and clear untouched
//   template placeholders once real projects exist to take their place.
// @param {string} body - Existing Projects section body.
// @param {Array<object>} projects - Published project records, already in note order.
// @returns {string} Updated body.
function projectsSectionBody(body, projects) {
  const { blocks, leadingText } = projectBlocksFromBody(body);
  const previousBodyBySummary = new Map();
  for (const block of blocks) {
    if (isBuilderMarkedText(block.headingText)) previousBodyBySummary.set(textWithoutBuilderMarker(block.headingText), block.body);
  }
  const retainedBlocks = blocks.filter(block => !isBuilderMarkedText(block.headingText)
    && !(projects.length && isEmptyProjectPlaceholder(block)));
  const retainedMarkdown = retainedBlocks.map(block => `## ${ block.headingText }\n${ block.body.replace(/^\n+|\s+$/g, "") }`);
  const builderMarkdown = projects.map(project => projectBlockMarkdown(project, previousBodyBySummary.get(project.summary) ?? ""));
  const sections = [...retainedMarkdown, ...builderMarkdown].filter(Boolean);
  return [leadingText.replace(/\s+$/, "").replace(/^\n{2,}/, "\n"), ...sections].join("\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Replace the builder's Not This Quarter lines with the projects the user sorted into Not now, leaving the
//   template's own suggestions and anything the user added in place.
// @param {string} body - Existing Not This Quarter body.
// @param {Array<string>} summaries - Declined project summaries.
// @returns {string} Updated body.
function notThisQuarterBody(body, summaries) {
  const keptLines = body.split("\n").filter(line => !isBuilderMarkedText(line));
  const retainedLines = trimmedTrailingBlankLines(keptLines);
  const builderLines = summaries.map(summary => `- ${ summary } ${ BUILDER_MARKER }`);
  const lines = [...retainedLines, ...builderLines].map(line => line.replace(/\s+$/, ""));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Record the day's sufficiency bar beneath the quarter's outcomes, leaving the theme sentence itself to
//   the user. The quarter's name already leads the note as its own heading, and the wizard captures only that
//   one string, so writing it here as well would state the same words twice in consecutive lines.
// @param {string} body - Existing Quarter Theme body, including its nested Success Looks Like section.
// @param {object} publication - Publication carrying dailySufficiencyText.
// @returns {string} Updated body.
function quarterThemeBody(body, publication) {
  const successRange = planSectionRange(body, SUCCESS_HEADING);
  if (!successRange) return body.replace(/^\n+|\s+$/g, "");
  const themeText = body.slice(0, successRange.start).replace(/^\n+|\s+$/g, "");
  const successBody = successLooksLikeBody(body.slice(successRange.bodyStart, successRange.end), publication);
  return `${ themeText }\n\n## ${ SUCCESS_HEADING }\n${ successBody }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Restate the day's sufficiency bar as a plain bullet under the quarter's outcomes. It is deliberately not
//   a checkbox: a standing criterion is not a task, and writing it as one would put a task into the user's lists.
// @param {string} body - Existing Success Looks Like body.
// @param {object} publication - Publication carrying dailySufficiencyText.
// @returns {string} Updated body.
function successLooksLikeBody(body, publication) {
  const keptLines = body.split("\n").filter(line => !isBuilderMarkedText(line));
  const retainedLines = trimmedTrailingBlankLines(keptLines);
  const builderLines = publication.dailySufficiencyText
    ? [`- Done for today when: ${ publication.dailySufficiencyText } ${ BUILDER_MARKER }`] : [];
  const lines = [...retainedLines, ...builderLines].map(line => line.replace(/\s+$/, ""));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

// ----------------------------------------------------------------------------------------------
// @desc Lead the note with the name the user gave the quarter, replacing a title published earlier rather than
//   accumulating one per run. A note whose first heading carries no builder marker keeps that heading, and the
//   title is inserted above it.
// @param {string} content - Full note markdown.
// @param {string|null} quarterNameText - The chosen quarter name, or null when none has been saved.
// @returns {string} Updated markdown.
export function contentWithPlanTitle(content, quarterNameText) {
  const firstHeading = planHeadingRanges(content)[0] ?? null;
  const hasBuilderTitle = firstHeading?.level === 1 && isBuilderMarkedText(firstHeading.text);
  const titledContent = hasBuilderTitle ? content.slice(firstHeading.bodyStart) : content;
  const remainder = titledContent.replace(/^\n+/, "");
  if (!quarterNameText) return remainder;
  return `# ${ quarterNameText } ${ BUILDER_MARKER }\n\n${ remainder }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Drop the blank lines closing a section body, so a bullet appended after them joins the list above
//   instead of floating below a gap.
// @param {Array<string>} lines - Body lines.
// @returns {Array<string>} Lines with trailing blank ones removed.
function trimmedTrailingBlankLines(lines) {
  const trimmedLines = lines.slice();
  while (trimmedLines.length && !trimmedLines[trimmedLines.length - 1].trim()) trimmedLines.pop();
  return trimmedLines;
}

// ----------------------------------------------------------------------------------------------
// @desc Apply a whole publication to a note's markdown, touching only the sections Plan Builder owns.
// @param {string} content - Existing quarterly plan note markdown.
// @param {object} publication - Result of quarterlyPlanPublication.
// @returns {string} Updated markdown; a section the note does not have is skipped rather than created.
export function mergedQuarterlyPlanContent(content, publication) {
  const sectionBodies = [[QUARTER_THEME_HEADING, body => quarterThemeBody(body, publication)],
    [PROJECTS_HEADING, body => projectsSectionBody(body, publication.projects)],
    [NOT_THIS_QUARTER_HEADING, body => notThisQuarterBody(body, publication.notThisQuarter)],
    [DAY_OF_WEEK_HEADING, body => dayOfWeekBody(body, publication.projects)],
    [MONTH_BREAKDOWN_HEADING, body => monthBreakdownBody(body, publication.projects, publication.quarterMonthKeys)]];
  let merged = content;
  for (const [headingText, renderBody] of sectionBodies) {
    const range = planSectionRange(merged, headingText);
    if (!range) continue;
    merged = contentWithSectionBody(merged, headingText, renderBody(merged.slice(range.bodyStart, range.end)));
  }
  return contentWithPlanTitle(merged, publication.quarterNameText);
}
