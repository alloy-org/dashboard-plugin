// Find the meetings on a planned day, the calendar events with someone other than the user invited, and gather the
// existing tasks and project ideas that pertain to the people or company being met. Each meeting becomes a candidate
// group of its own whose rationale names the meeting, so the ranker weighs it, and whose candidates carry the
// meeting's start so the agenda places them in the hours before the call. Matching is by whole words: an attendee's
// full name and the words of it, the company an email address names, and the distinctive words of the event title.
// A word that matches a large share of the user's open tasks, such as the user's own company name, is not
// distinctive and is dropped.
import { calendarEventDateFromValue } from "util/calendar-utility";
import { dateKeyFromDateInput } from "util/date-utility";
import { textDigest } from "util/text-digest";

// How long before a meeting its preparation is placed, as the earliest start of the preparation window.
export const MEETING_PREPARATION_LEAD_MINUTES = 3 * 60;
// Most candidates one meeting offers the ranker before salience narrows them.
const MAXIMUM_MEETING_CANDIDATES = 6;
// A term matching more open tasks than this share of them, or than the floor, names nothing in particular.
const OVERUSED_TERM_SHARE = 0.1;
const OVERUSED_TERM_FLOOR = 5;
const MINIMUM_TERM_LENGTH = 3;
// Matches the length the agenda cuts task text to, so both task shapes read the same text.
const MAXIMUM_TASK_TEXT_CHARACTERS = 200;
// Attendee statuses as Amplenote stores them: true accepted or tentative, false declined, null unanswered.
const DECLINED_STATUS = false;
const FREE_EMAIL_DOMAINS = new Set(["aol", "gmail", "googlemail", "hey", "hotmail", "icloud", "live", "mac", "me", "msn",
  "outlook", "proton", "protonmail", "yahoo"]);
const TITLE_STOPWORDS = new Set(["and", "call", "catch", "chat", "check", "demo", "discussion", "for", "follow", "from",
  "intro", "introduction", "meet", "meeting", "monthly", "onboarding", "review", "session", "sync", "the",
  "touch", "touchbase", "weekly", "with", "zoom"]);

// ----------------------------------------------------------------------------------------------
// @desc "14:00" for minutes since midnight.
// @param {number} startMinutes - Minutes since midnight.
// @returns {string} Zero-padded 24-hour clock.
export function meetingClock(startMinutes) {
  const hours = String(Math.floor(startMinutes / 60)).padStart(2, "0");
  const minutes = String(startMinutes % 60).padStart(2, "0");
  return `${ hours }:${ minutes }`;
}

// ----------------------------------------------------------------------------------------------
// @desc A meeting's candidate group, in dayProjectGroups' shape, whose rationale tells the ranker who is being met
//   and when.
// @param {object} meeting - From meetingsFromCalendarEvents.
// @param {object} options - { projectUuid, taskCandidates }.
// @returns {object} Group with meetingKey and meetingStartMinutes.
export function meetingGroup(meeting, { projectUuid = null, taskCandidates }) {
  const clock = meetingClock(meeting.startMinutes);
  const attendees = meeting.attendeeNames.slice(0, 4).join(", ");
  const rationale = `The user meets with ${ attendees } at ${ clock } on this day ("${ meeting.title }"). This candidate `
    + "pertains to that meeting, and the hours before the meeting are the time to prepare for it.";
  const summary = `Prepare for ${ clock } "${ meeting.title }"`;
  return { emphasizedWeekday: null, meetingKey: meeting.meetingKey, meetingStartMinutes: meeting.startMinutes, projectUuid,
    rationale, summary, taskCandidates };
}

// ----------------------------------------------------------------------------------------------
// @desc The lowercase words and phrases that identify what a meeting is about: each attendee's full name and its
//   words, the person and company an email-address attendee names, and the title's words that are not generic
//   meeting vocabulary.
// @param {object} meeting - { attendeeNames, title }.
// @returns {Array<string>} Distinct terms, at least three characters each.
export function meetingMatchTerms({ attendeeNames, title }) {
  const terms = new Set();
  for (const name of attendeeNames || []) {
    for (const term of _attendeeTerms(name)) terms.add(term);
  }
  for (const word of _words(title)) {
    if (!TITLE_STOPWORDS.has(word)) terms.add(word);
  }
  const usable = [...terms].filter(term => term.length >= MINIMUM_TERM_LENGTH && !/^\d+$/.test(term));
  return usable;
}

// ----------------------------------------------------------------------------------------------
// @desc The candidate groups the day's meetings offer: for each meeting, the open tasks and project candidates whose
//   text mentions someone or something the meeting is about. A candidate keeps the project it
//   came from, so a meeting matching candidates of several projects yields one group per project.
// @param {object} options - An object with the following properties:
//   - {Set<string>|null} [excludeIds] - Task UUIDs or candidate IDs already on screen or dismissed this pass
//   - {Array<object>} meetings - From meetingsFromCalendarEvents
//   - {Array<object>|null} [openTasks] - Open native tasks of the domain, or the agenda's compact task records
//   - {Array<object>} [projectCandidates] - { candidate, projectUuid } for every project, as everyProjectCandidate builds them
//   - {Date} targetDate - The day being planned
// @returns {Array<object>} Groups in dayProjectGroups' shape, plus meetingStartMinutes and meetingKey.
export function meetingPreparationGroups({ excludeIds = null, meetings, openTasks = null, projectCandidates = [], targetDate }) {
  if (!meetings?.length) return [];
  const sources = _candidateSources({ excludeIds, openTasks, projectCandidates, targetDate });
  const distinctiveTerm = _distinctiveTermTest(openTasks);
  const claimed = new Set();
  const groups = [];
  for (const meeting of meetings) {
    const terms = meeting.matchTerms.filter(distinctiveTerm);
    const matching = sources.filter(source => !claimed.has(source.candidate.candidateId) && _mentionsAny(source.searchText, terms));
    const kept = matching.slice(0, MAXIMUM_MEETING_CANDIDATES);
    for (const source of kept) claimed.add(source.candidate.candidateId);
    groups.push(..._meetingGroups(meeting, kept));
  }
  return groups;
}

// ----------------------------------------------------------------------------------------------
// @desc The meetings on a day: timed events with at least one attendee who has not declined. Amplenote leaves the
//   user out of an event's attendees, so any attendee is someone being met.
// @param {Array<object>} events - External calendar events, start/end as Date or raw timestamps, attendees as
//   [{ name, status }].
// @param {Date} targetDate - The day being planned.
// @returns {Array<object>} { attendeeNames, durationMinutes, matchTerms, meetingKey, startMinutes, title }, earliest first.
export function meetingsFromCalendarEvents(events, targetDate) {
  const dateKey = dateKeyFromDateInput(targetDate);
  const meetings = [];
  for (const event of events || []) {
    if (!event || event.allDay) continue;
    const start = calendarEventDateFromValue(event.start);
    if (!start || dateKeyFromDateInput(start) !== dateKey) continue;
    const attendeeNames = _attendeeNames(event.attendees);
    if (!attendeeNames.length) continue;
    const end = calendarEventDateFromValue(event.end);
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const durationMinutes = end && end > start ? Math.round((end - start) / 60_000) : null;
    const title = String(event.title || "").replace(/\s+/g, " ").trim() || "Meeting";
    const matchTerms = meetingMatchTerms({ attendeeNames, title });
    meetings.push({ attendeeNames, durationMinutes, matchTerms, meetingKey: textDigest(`${ dateKey }|${ startMinutes }|${ title }`),
      startMinutes, title });
  }
  const earliestFirst = meetings.sort((first, second) => first.startMinutes - second.startMinutes);
  return earliestFirst;
}

// ----------------------------------------------------------------------------------------------
// @desc A digest of the meetings a ranking was asked about, so a meeting added, moved, or renamed asks again.
// @param {Array<object>} meetings - From meetingsFromCalendarEvents.
// @returns {string|null} Digest, or null on a day without meetings.
export function meetingsRevision(meetings) {
  if (!meetings?.length) return null;
  const described = meetings.map(meeting => `${ meeting.meetingKey }:${ meeting.attendeeNames.join(",") }`);
  return textDigest(described.join("|"));
}

// ----------------------------------------------------------------------------------------------
// @desc Take the meeting candidates out of the project groups, so each candidate is ranked once, under its meeting.
// @param {Array<object>} projectGroups - From dayProjectGroups.
// @param {Array<object>} meetingGroups - From meetingPreparationGroups.
// @returns {Array<object>} Project groups without the meeting candidates; a group left empty is dropped.
export function projectGroupsWithoutMeetingCandidates(projectGroups, meetingGroups) {
  const meetingCandidateIds = new Set(meetingGroups.flatMap(group => group.taskCandidates.map(candidate => candidate.candidateId)));
  if (!meetingCandidateIds.size) return projectGroups;
  const trimmedGroups = projectGroups.map(group => ({ ...group,
    taskCandidates: group.taskCandidates.filter(candidate => !meetingCandidateIds.has(candidate.candidateId)) }));
  const nonEmptyGroups = trimmedGroups.filter(group => group.taskCandidates.length);
  return nonEmptyGroups;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The names of the attendees who have not declined.
// @param {Array<object>|undefined} attendees - [{ name, status }] as Amplenote stores them.
// @returns {Array<string>} Trimmed names.
function _attendeeNames(attendees) {
  if (!Array.isArray(attendees)) return [];
  const attending = attendees.filter(attendee => attendee && attendee.status !== DECLINED_STATUS);
  const names = attending.map(attendee => String(attendee.name || attendee.email || "").trim());
  const meaningfulNames = names.filter(name => name && name.toLowerCase() !== "someone");
  return meaningfulNames;
}

// ----------------------------------------------------------------------------------------------
// @desc The terms one attendee contributes. An email address gives the words of its local part and, unless it is a
//   personal mail provider, the company its domain names.
// @param {string} name - Attendee display name or email address.
// @returns {Array<string>} Lowercase terms.
function _attendeeTerms(name) {
  const lowered = name.toLowerCase();
  if (lowered.includes("@")) {
    const [localPart, domain = ""] = lowered.split("@");
    const company = domain.split(".")[0];
    const localWords = localPart.split(/[._+-]+/).filter(word => /^[a-z]+$/.test(word));
    return FREE_EMAIL_DOMAINS.has(company) || !company ? localWords : [...localWords, company];
  }
  const words = _words(lowered);
  return words.length > 1 ? [words.join(" "), ...words] : words;
}

// ----------------------------------------------------------------------------------------------
// @desc Every task and project candidate the day could prepare a meeting with, each with the lowercase text it is
//   matched by. A project candidate keeps its project; an open task no project lists is offered on its own. A task
//   already scheduled on the day is left out.
// @param {object} options - { excludeIds, openTasks, projectCandidates, targetDate }.
// @returns {Array<object>} { candidate, projectUuid, searchText }.
function _candidateSources({ excludeIds, openTasks, projectCandidates, targetDate }) {
  const dateKey = dateKeyFromDateInput(targetDate);
  const sources = (projectCandidates || []).map(({ candidate, projectUuid }) => ({ candidate, projectUuid,
    searchText: String(candidate.text || "").toLowerCase() }));
  const listedIds = new Set(sources.map(source => source.candidate.candidateId));
  for (const task of openTasks || []) {
    const fields = _taskFields(task, dateKey);
    const candidateId = `task:${ fields.uuid }`;
    if (!fields.uuid || !fields.text || fields.closed || fields.scheduledOnDay || listedIds.has(candidateId)) continue;
    if (excludeIds?.has(candidateId) || excludeIds?.has(fields.uuid)) continue;
    listedIds.add(candidateId);
    sources.push({ candidate: _looseTaskCandidate(fields), projectUuid: null, searchText: fields.text.toLowerCase() });
  }
  return sources;
}

// ----------------------------------------------------------------------------------------------
// @desc A test that keeps the terms naming something in particular: a term matching more than OVERUSED_TERM_SHARE of
//   the open tasks, and more than OVERUSED_TERM_FLOOR of them, is too common to say a task is about this meeting.
// @param {Array<object>|null} openTasks - Open native tasks or compact agenda task records.
// @returns {function} (term) => boolean.
function _distinctiveTermTest(openTasks) {
  const taskTexts = (openTasks || []).map(task => String(task?.content || task?.taskText || "").toLowerCase());
  const limit = Math.max(OVERUSED_TERM_FLOOR, Math.floor(taskTexts.length * OVERUSED_TERM_SHARE));
  const verdicts = new Map();
  return term => {
    if (!verdicts.has(term)) {
      const matchCount = taskTexts.filter(text => _mentionsAny(text, [term])).length;
      verdicts.set(term, matchCount <= limit);
    }
    return verdicts.get(term);
  };
}

// ----------------------------------------------------------------------------------------------
// @desc A task candidate for an open task that no qualifying project lists, in the shape projectTaskCandidates gives.
// @param {object} fields - From _taskFields.
// @returns {object} Task candidate.
function _looseTaskCandidate({ durationSeconds, important, noteUuid, text, uuid }) {
  const durationMinutes = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.max(1, Math.ceil(durationSeconds / 60)) : 30;
  return { actionability: null, candidateId: `task:${ uuid }`, durationMinutes, ideaId: null, important, isExisting: true,
    minutesSinceRecommended: null, noteUuid, score: null, text, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc One group per project among a meeting's candidates, each explaining the meeting to the ranker.
// @param {object} meeting - From meetingsFromCalendarEvents.
// @param {Array<object>} sources - The meeting's matched sources.
// @returns {Array<object>} Meeting groups; empty when nothing matched.
function _meetingGroups(meeting, sources) {
  const byProject = new Map();
  for (const source of sources) {
    const projectKey = source.projectUuid || "";
    byProject.set(projectKey, [...(byProject.get(projectKey) || []), source.candidate]);
  }
  const groups = [...byProject.entries()].map(([projectKey, taskCandidates]) => meetingGroup(meeting, {
    projectUuid: projectKey || null, taskCandidates }));
  return groups;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether lowercase text mentions any term as a whole word or phrase.
// @param {string} text - Lowercase text.
// @param {Array<string>} terms - Lowercase terms.
// @returns {boolean} True on the first whole-word mention.
function _mentionsAny(text, terms) {
  return terms.some(term => {
    let index = text.indexOf(term);
    while (index !== -1) {
      const before = index === 0 ? "" : text[index - 1];
      const after = text[index + term.length] || "";
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
      index = text.indexOf(term, index + 1);
    }
    return false;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Read a native task and a compact agenda task record alike, so the background preparation and the agenda,
//   which load tasks in those two shapes, build the same candidates. Text is cut to the length the agenda keeps.
// @param {object} task - Native task ({ content, noteUUID, startAt, uuid }) or compact record ({ noteUuid,
//   scheduledOnTarget, taskText, taskUuid }).
// @param {string} dateKey - The planned day, YYYY-MM-DD.
// @returns {object} { closed, durationSeconds, important, noteUuid, scheduledOnDay, text, uuid }.
function _taskFields(task, dateKey) {
  const text = String(task?.content || task?.taskText || "").replace(/\s+/g, " ").trim().substring(0, MAXIMUM_TASK_TEXT_CHARACTERS);
  const startDate = calendarEventDateFromValue(task?.startAt);
  const scheduledOnDay = Boolean(task?.scheduledOnTarget) || Boolean(startDate && dateKeyFromDateInput(startDate) === dateKey);
  return { closed: Boolean(task?.completedAt || task?.dismissedAt), durationSeconds: Number(task?.duration),
    important: Boolean(task?.important), noteUuid: task?.noteUUID || task?.noteUuid || null, scheduledOnDay, text,
    uuid: task?.uuid || task?.taskUuid || null };
}

// ----------------------------------------------------------------------------------------------
// @desc The lowercase alphanumeric words of some text.
// @param {string} text - Any text.
// @returns {Array<string>} Words.
function _words(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
