// Copy an upcoming quarter's plan note onto the current quarter. The copy keeps the plan the user already
// wrote and gives it this quarter's note name. Monthly targets are removed, because they name the upcoming
// quarter's months and do not apply to the days that are left in this one.

import { FULL_MONTH_NAMES } from "constants/quarters";
import { DASHBOARD_NOTE_TAG, DEFAULT_PLANNING_TAG, SETTING_KEYS } from "constants/settings";
import { planHeadingRanges } from "plan-wizard/quarterly-plan-markdown";
import { MONTH_BREAKDOWN_HEADING } from "plan-wizard/quarterly-plan-merge";
import { pluginSettings } from "plugin-data";
import { arrayFromFilterNotesResult } from "util/note-handles";
import { quarterlyPlanNoteName, resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";

// ----------------------------------------------------------------------------------------------
// @desc Remove the Month-by-Month Breakdown and any heading that is only a month name, leaving the rest of
//   the plan byte for byte as it was.
// @param {string} content - Quarterly plan note markdown.
// @returns {string} The same note without monthly targets. A non-string is returned unchanged.
export function contentWithoutMonthlyTargets(content) {
  if (typeof content !== "string" || !content) return content;
  const ranges = monthlyTargetRanges(content).sort((first, second) => second.start - first.start);
  if (!ranges.length) return content;
  let stripped = content;
  for (const range of ranges) stripped = `${ stripped.slice(0, range.start) }${ stripped.slice(range.end) }`;
  return stripped.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
}

// ----------------------------------------------------------------------------------------------
// @desc Write the upcoming quarter's plan note into the current quarter's note, under this quarter's name
//   and without monthly targets. Creates the current-quarter note when it does not exist yet.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} params - An object with the following properties:
//   - {object} sourcePlan - Upcoming plan, carrying domainName, label, and noteUUID when the note is known.
//   - {object} targetPlan - Current plan, carrying domainName and label for the note to create.
// @returns {Promise<object>} An object with the following properties:
//   - {string} noteUuid - UUID of the current quarter's plan note.
// A missing source note, an unreadable source, or a failed create throws, so the caller can keep the user on
//   the action that asked for the copy.
export async function mirrorQuarterPlanNote(app, { sourcePlan, targetPlan }) {
  const sourceUuid = await noteUuidFromPlan(app, sourcePlan);
  if (!sourceUuid) throw new Error("The upcoming quarter has no plan note to copy.");
  const sourceContent = await app.getNoteContent({ uuid: sourceUuid });
  if (typeof sourceContent !== "string") throw new Error("The upcoming quarter's plan note could not be read.");
  const noteUuid = await writeMirroredPlanNote(app, { content: contentWithoutMonthlyTargets(sourceContent), targetPlan });
  if (!noteUuid) throw new Error("The current quarter's plan note could not be created.");
  return { noteUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc List the ranges that hold monthly targets: the breakdown section, which already covers the months
//   nested inside it, and any other heading whose text is exactly a month name.
// @param {string} content - Quarterly plan note markdown.
// @returns {Array<object>} Ranges carrying start and end offsets, in note order, with no range inside another.
function monthlyTargetRanges(content) {
  const headings = planHeadingRanges(content);
  const ranges = [];
  for (const heading of headings) {
    const isMonthBreakdown = heading.text === MONTH_BREAKDOWN_HEADING;
    const isMonthName = FULL_MONTH_NAMES.includes(heading.text);
    if (!isMonthBreakdown && !isMonthName) continue;
    const alreadyCovered = ranges.some(range => heading.start >= range.start && heading.end <= range.end);
    if (alreadyCovered) continue;
    ranges.push({ end: heading.end, start: heading.start });
  }
  return ranges;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the note a plan already points at, or look it up by the name the dashboard gives that quarter.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} plan - Plan carrying domainName, label, and an optional noteUUID.
// @returns {Promise<string|null>} Note UUID, or null when the quarter has no plan note.
async function noteUuidFromPlan(app, plan) {
  if (plan?.noteUUID) return plan.noteUUID;
  if (!plan?.label) return null;
  const note = await resolveQuarterlyPlanNote(app, false, plan.domainName || null, plan.label);
  return note?.uuid ?? null;
}

// ----------------------------------------------------------------------------------------------
// @desc Replace an existing current-quarter plan note, or create one, with the mirrored markdown.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} params - An object with the following properties:
//   - {string} content - Markdown to store.
//   - {object} targetPlan - Current plan whose note name receives the content.
// @returns {Promise<string|null>} UUID of the note that was written, or null when it could not be created.
// The identifier createNote returns is not always the one replaceNoteContent can write, so a new note is
//   looked up by name before the body is stored.
async function writeMirroredPlanNote(app, { content, targetPlan }) {
  const domainName = targetPlan?.domainName || null;
  const noteName = quarterlyPlanNoteName(domainName, targetPlan.label);
  const existing = await resolveQuarterlyPlanNote(app, false, domainName, targetPlan.label);
  const planningTag = pluginSettings()[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const createdUuid = existing?.uuid ? null : await app.createNote(noteName, [DASHBOARD_NOTE_TAG, planningTag]);
  if (!existing?.uuid && !createdUuid) return null;
  const createdNotes = createdUuid
    ? await arrayFromFilterNotesResult(app.filterNotes({ query: noteName })) : [];
  const createdMatch = createdNotes.find(note => note.name === noteName);
  const noteUuid = existing?.uuid ?? createdMatch?.uuid ?? createdUuid;
  await app.replaceNoteContent({ uuid: noteUuid }, content);
  return noteUuid;
}
