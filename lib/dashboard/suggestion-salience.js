// Narrow a large day's pool of candidate tasks and ideas to the ones the day itself calls for, before the ranker weighs
// each candidate's project. Jev scores each candidate's salience from 1 to 10 against what is happening that day: a
// candidate that prepares for one of the day's meetings is most salient, then candidates of projects the user chose to
// focus on that weekday, and on a weekend, personal projects and pursuits. The most salient candidates go on to be
// ranked. A meeting candidate Jev finds not salient matched the meeting by a shared word only, and is dropped. A pool
// small enough to rank whole, or a day without Jev, is passed through unchanged.
import { meetingClock } from "meeting-preparation";
import { DecisionsEndpoint, scoreQuestion } from "providers/decisions-endpoint";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// Most candidates passed on to the ranker; a pool this size or smaller is not scored for salience.
export const SALIENCE_POOL_LIMIT = 30;
// The salience a meeting candidate needs to stay under its meeting.
const MEETING_SALIENCE_MINIMUM = 5;
// The salience assumed for a candidate Jev did not answer about.
const UNANSWERED_SALIENCE = 5;
const SALIENCE_LOG_LABEL = "[suggestion-salience]";
const SALIENCE_CRITERIA = ["1: nothing about this day calls for it", "2", "3: only loosely related to this day", "4",
  "5: as salient as any ordinary open task", "6",
  "7: belongs to a project the user chose to focus on this day, or is a personal pursuit suited to a weekend", "8", "9",
  "10: directly prepares for a meeting on this day"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ----------------------------------------------------------------------------------------------
// @desc Keep the day's most salient candidates, scored by Jev, at most SALIENCE_POOL_LIMIT of them. Candidates of a
//   pool already within the limit, or of a day Jev cannot score, are all kept.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<object>} groups - Candidate groups, meeting groups carrying meetingStartMinutes.
// @param {object} options - An object with the following properties:
//   - {Array<object>} meetings - The day's meetings, from meetingsFromCalendarEvents
//   - {object|null} [providerDispatch] - The work runtime's dispatcher; the request then waits for a Jev permit
//   - {function} [requestSalience] - Injects a Jev response for tests
//   - {AbortSignal|null} [signal] - Abandons a request still waiting for its permit
//   - {Date} targetDate - The day being planned
// @returns {Promise<Array<object>>} Groups holding only the kept candidates; a group left empty is dropped.
export async function salientCandidateGroups(app, groups, { meetings = [], providerDispatch = null, requestSalience = null,
    signal = null, targetDate }) {
  const listed = groups.flatMap(group => group.taskCandidates.map(candidate => ({ candidate, group })));
  if (listed.length <= SALIENCE_POOL_LIMIT) return groups;
  const endpoint = requestSalience ? DecisionsEndpoint.fromRequester(requestSalience)
    : await decisionsEndpointForApp(app, { includeFastScore: false });
  if (!endpoint) return groups;
  const dispatchedEndpoint = providerDispatch ? endpoint.withProviderDispatch({ providerDispatch, signal }) : endpoint;
  let response;
  try {
    response = await dispatchedEndpoint.rankedResponses({ questions: salienceQuestions(listed, targetDate),
      state: salienceState(groups, { meetings, targetDate }) });
  } catch (error) {
    logIfEnabled(`${ SALIENCE_LOG_LABEL } salience scoring failed`, error?.message);
    return groups;
  }
  const scored = listed.map((entry, index) => ({ ...entry, salience: response.ratingFor(`task_${ index + 1 }`,
    { levelCount: SALIENCE_CRITERIA.length }) ?? UNANSWERED_SALIENCE }));
  const kept = _mostSalient(scored);
  logIfEnabled(`${ SALIENCE_LOG_LABEL } narrowed the pool`, { keptCount: kept.size, poolCount: listed.length });
  const narrowedGroups = groups.map(group => ({ ...group,
    taskCandidates: group.taskCandidates.filter(candidate => kept.has(candidate.candidateId)) }));
  const nonEmptyGroups = narrowedGroups.filter(group => group.taskCandidates.length);
  return nonEmptyGroups;
}

// ----------------------------------------------------------------------------------------------
// @desc One salience question per listed candidate, named task_1 onward in list order.
// @param {Array<object>} listed - { candidate, group } entries.
// @param {Date} targetDate - The day being planned.
// @returns {object} Score questions by name.
export function salienceQuestions(listed, targetDate) {
  const isWeekend = [0, 6].includes(targetDate.getDay());
  const dayGuidance = isWeekend
    ? "This day is a weekend: personal projects and pursuits are highly salient, and work tasks are not unless one of the "
      + "day's meetings needs them."
    : "This day is a workday: work tasks are generally more salient than personal pursuits.";
  const questions = {};
  listed.forEach(({ candidate, group }, index) => {
    const name = `task_${ index + 1 }`;
    const instructions = `How salient is ${ name } ("${ candidate.text }"), listed under "${ group.summary }", on `
      + `${ WEEKDAY_NAMES[targetDate.getDay()] } ${ dateKeyFromDateInput(targetDate) }? Salience is how much this day `
      + "itself calls for the task. A task that prepares for one of the day's meetings is most salient, above all a "
      + "meeting with a customer or prospect; a task that only shares a word with a meeting is not about it. Next come "
      + `tasks of projects the user chose to focus on this weekday. ${ dayGuidance }`;
    questions[name] = scoreQuestion(instructions, SALIENCE_CRITERIA);
  });
  return questions;
}

// ----------------------------------------------------------------------------------------------
// @desc The day and its candidates as Jev is shown them.
// @param {Array<object>} groups - Candidate groups.
// @param {object} options - { meetings, targetDate }.
// @returns {object} { day, groups }.
export function salienceState(groups, { meetings = [], targetDate }) {
  const day = { date: dateKeyFromDateInput(targetDate), isWeekend: [0, 6].includes(targetDate.getDay()),
    meetings: meetings.map(meeting => ({ attendees: meeting.attendeeNames, startTime: meetingClock(meeting.startMinutes),
      title: meeting.title })), weekday: WEEKDAY_NAMES[targetDate.getDay()] };
  const describedGroups = groups.map(group => ({ candidates: group.taskCandidates.map(candidate => candidate.text),
    focusedToday: Boolean(group.emphasizedWeekday), rationale: group.rationale, summary: group.summary }));
  return { day, groups: describedGroups };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The candidate IDs kept: meeting candidates salient enough to stay with their meeting, then the most salient
//   of the rest, up to SALIENCE_POOL_LIMIT in all. Equal salience keeps the listed order.
// @param {Array<object>} scored - { candidate, group, salience } entries in list order.
// @returns {Set<string>} Kept candidate IDs.
function _mostSalient(scored) {
  const isMeetingEntry = entry => Number.isFinite(entry.group.meetingStartMinutes);
  const meetingEntries = scored.filter(entry => isMeetingEntry(entry) && entry.salience >= MEETING_SALIENCE_MINIMUM);
  const otherEntries = scored.filter(entry => !isMeetingEntry(entry));
  const bySalience = [...otherEntries].sort((first, second) => second.salience - first.salience);
  const keptEntries = [...meetingEntries, ...bySalience].slice(0, SALIENCE_POOL_LIMIT);
  const keptIds = new Set(keptEntries.map(entry => entry.candidate.candidateId));
  return keptIds;
}
