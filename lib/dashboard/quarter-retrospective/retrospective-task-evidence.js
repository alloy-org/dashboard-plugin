// Pure helpers that turn a quarter's raw tasks, project records, and calendar journal into the evidence a Quarter
// Retrospective tells its story from: each task's Rich Footnote text and images, how many of each project's tasks were
// still open when the quarter ended, and how the quarter's meeting time divides by kind of meeting.
import { millisecondsFromTaskTimestamp } from "plan-wizard/intent-evidence";
import { parsedRichFootnotes, resolvedFootnotesForPassage } from "util/amplenote-rich-footnotes";

// The most footnote text kept per task; enough for a prompt to know what the footnote was about.
export const FOOTNOTE_TEXT_CHARACTERS = 600;
export const MEETING_CATEGORIES = Object.freeze({ largeMeeting: "Large meetings", oneOnOne: "1:1s", smallMeeting: "Small meetings",
  solo: "Solo blocks" });
const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LARGE_MEETING_ATTENDEES = 6;
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const VIDEO_URL_PATTERN = /\.(mp4|webm|ogg|mov)(\?|$)/i;

// ----------------------------------------------------------------------------------------------
// @desc The images a passage of markdown shows, leaving out videos and anything not served over http(s).
// @param {string} markdown - Markdown that may hold `![alt](url)` images.
// @returns {Array<object>} { alt, url } per image, in the order they appear, each URL once.
export function markdownImages(markdown) {
  const images = [];
  const seenUrls = new Set();
  for (const match of String(markdown || "").matchAll(IMAGE_PATTERN)) {
    const url = match[2];
    if (!/^https?:\/\//i.test(url) || VIDEO_URL_PATTERN.test(url) || seenUrls.has(url)) continue;
    seenUrls.add(url);
    images.push({ alt: match[1].trim(), url });
  }
  return images;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the Rich Footnotes a task cites. A definition is looked for in the task's own content first, then in
//   its note's content when given, since a task's footnote definitions may sit in the note rather than the task.
// @param {string} taskContent - The task's markdown.
// @param {string|null} [noteContent] - The markdown of the note the task belongs to, when it has been read.
// @returns {object} An object with the following properties:
//   - {string} footnoteText - The resolved definitions' labels and bodies, cut to FOOTNOTE_TEXT_CHARACTERS
//   - {Array<object>} images - { alt, url } images in the task or its footnotes
//   - {Array<string>} missingIdentifiers - Cited footnotes neither source defines
export function taskFootnoteEvidence(taskContent, noteContent = null) {
  const parsedTask = parsedRichFootnotes(taskContent);
  const definitions = new Map(parsedTask.definitions);
  if (noteContent) {
    for (const [identifier, definition] of parsedRichFootnotes(noteContent).definitions) {
      if (!definitions.has(identifier)) definitions.set(identifier, definition);
    }
  }
  const { missingIdentifiers, resolved } = resolvedFootnotesForPassage(parsedTask.body, definitions);
  const footnoteBlocks = resolved.map(definition => [definition.label, definition.body].filter(Boolean).join("\n"));
  const fullText = footnoteBlocks.filter(Boolean).join("\n\n");
  const footnoteText = fullText.length > FOOTNOTE_TEXT_CHARACTERS ? `${ fullText.slice(0, FOOTNOTE_TEXT_CHARACTERS - 1).trimEnd() }…` : fullText;
  const images = markdownImages(`${ parsedTask.body }\n${ fullText }`);
  return { footnoteText, images, missingIdentifiers };
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a task cites a footnote its own content doesn't define, so its note has to be read to resolve it.
// @param {string} taskContent - The task's markdown.
// @returns {boolean} True when a cited footnote is missing from the task.
export function taskNeedsNoteFootnotes(taskContent) {
  return taskFootnoteEvidence(taskContent).missingIdentifiers.length > 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Count, per project, the tasks known to belong to it that were still open when the quarter ended: tasks open
//   now, and tasks completed since, that were created before the quarter ended. Only tasks the project task store
//   associated with the project are known, so the counts are a floor, not a census.
// @param {object} options - An object with the following properties:
//   - {Array<object>} laterCompletedTasks - Tasks completed after the quarter ended
//   - {Array<object>} openTasks - The domain's open tasks now
//   - {Array<object>} projects - Store records as { relatedTaskRecords, relatedTasks, summary, uuid }
//   - {number} quarterEndMillis - When the quarter ended
// @returns {Map<string, number>} Open-at-quarter-end count by project UUID, for every project given.
export function openAtQuarterEndByProject({ laterCompletedTasks, openTasks, projects, quarterEndMillis }) {
  const createdBeforeEnd = task => {
    const createdMillis = millisecondsFromTaskTimestamp(task?.createdAt);
    return createdMillis !== null && createdMillis < quarterEndMillis;
  };
  const openAtEndUuids = new Set();
  for (const task of [...(openTasks || []), ...(laterCompletedTasks || [])]) {
    if (task?.uuid && createdBeforeEnd(task)) openAtEndUuids.add(task.uuid);
  }
  const openCountByProject = new Map();
  for (const project of projects || []) {
    const recordUuids = (project.relatedTaskRecords || []).map(record => record.taskUuid);
    const knownUuids = new Set([...(project.relatedTasks || []), ...recordUuids].filter(Boolean));
    const openKnownUuids = [...knownUuids].filter(uuid => openAtEndUuids.has(uuid));
    openCountByProject.set(project.uuid, openKnownUuids.length);
  }
  return openCountByProject;
}

// ----------------------------------------------------------------------------------------------
// @desc Total the quarter's timed calendar events by kind of meeting, read from how many attendees each had. All-day
//   events are left out, since they mark days rather than spend hours.
// @param {Map<string, object>} daysByDate - Calendar journal days, each { events }.
// @returns {Array<object>} { category, eventCount, minutes } per category that had any events, most minutes first.
export function meetingMinutesByCategory(daysByDate) {
  const totalsByCategory = new Map();
  for (const day of daysByDate?.values() || []) {
    for (const event of day.events || []) {
      if (event.allDay || !event.end) continue;
      const minutes = Math.round((Date.parse(event.end) - Date.parse(event.start)) / MILLISECONDS_PER_MINUTE);
      if (!Number.isFinite(minutes) || minutes <= 0) continue;
      const category = _meetingCategory(event.attendeeCount);
      const totals = totalsByCategory.get(category) || { category, eventCount: 0, minutes: 0 };
      totals.eventCount += 1;
      totals.minutes += minutes;
      totalsByCategory.set(category, totals);
    }
  }
  const categories = [...totalsByCategory.values()];
  const rankedCategories = categories.sort((first, second) => second.minutes - first.minutes);
  return rankedCategories;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The kind of meeting an attendee count suggests. Amplenote leaves the user out of the attendees.
// @param {number} attendeeCount - Attendees other than the user who didn't decline.
// @returns {string} A MEETING_CATEGORIES value.
function _meetingCategory(attendeeCount) {
  if (!attendeeCount) return MEETING_CATEGORIES.solo;
  if (attendeeCount === 1) return MEETING_CATEGORIES.oneOnOne;
  if (attendeeCount < LARGE_MEETING_ATTENDEES) return MEETING_CATEGORIES.smallMeeting;
  return MEETING_CATEGORIES.largeMeeting;
}
