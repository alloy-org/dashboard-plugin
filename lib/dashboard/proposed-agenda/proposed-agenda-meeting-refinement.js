// Refine a stored agenda once the day's calendar events arrive. The host can take most of a minute to return them, so
// the agenda is first planned without them and stored with the meetings it knew of. When the events later name a
// meeting the agenda was not planned for, the day is ranked again with it, and that meeting's preparation tasks are
// placed in the hours before it, moving aside any pending suggestion that held those hours.
import { meetingsFromCalendarEvents } from "dashboard/proposed-agenda/meeting-preparation";
import { PROPOSED_TASK_STATUS } from "dashboard/proposed-agenda/proposed-agenda-archive";
import { logIfEnabled } from "util/log";

const REFINEMENT_LOG_LABEL = "[proposed-agenda-meeting-refinement]";

// ----------------------------------------------------------------------------------------------
// @desc Add preparation for the day's meetings an agenda was not planned for. Nothing changes when the agenda's meetings
//   are not known, as for a record stored before they were kept, or when every meeting on the day was already known.
// @param {object} options - An object with the following properties:
//   - {Array<object>} activities - The agenda's activities, in any status
//   - {Array<object>|null} calendarEvents - The day's calendar events, or null while they have not arrived
//   - {function} freshSchedule - async (unavailableKeys) => a freshly ranked schedule that leaves out those
//     suggestionIdentityKey values; its activities carry meetingStartMinutes
//   - {Array<string>|null} knownMeetingKeys - Meetings the agenda was planned for, or null when not known
//   - {function} [publishProvisional] - (activities) => void, called before the day waits on a fresh schedule
//   - {Array<object>} reserveTasks - The day's ranked reserves
//   - {Date} targetDate - Local midnight of the day
//   - {Set<string>} unavailableKeys - Suggestions the day already holds or may not offer
// @returns {Promise<object>} { activities, changed, meetingKeys, placed, reserveTasks }: changed is true when the agenda
//   learned of new meetings, meetingKeys then names every meeting on the day, and placed holds the preparation activities
//   added, for the caller to record as shown.
export async function agendaWithNewMeetingPreparation({ activities, calendarEvents, freshSchedule, knownMeetingKeys,
    publishProvisional = () => {}, reserveTasks, targetDate, unavailableKeys }) {
  const unchanged = { activities, changed: false, meetingKeys: knownMeetingKeys, placed: [], reserveTasks };
  if (!Array.isArray(knownMeetingKeys) || !Array.isArray(calendarEvents)) return unchanged;
  const meetings = meetingsFromCalendarEvents(calendarEvents, targetDate);
  const knownKeys = new Set(knownMeetingKeys);
  const newMeetings = meetings.filter(meeting => !knownKeys.has(meeting.meetingKey));
  if (!newMeetings.length) return unchanged;
  const meetingKeys = meetings.map(meeting => meeting.meetingKey);
  publishProvisional(activities);
  const fresh = await freshSchedule(unavailableKeys);
  const newMeetingStarts = new Set(newMeetings.map(meeting => meeting.startMinutes));
  const freshActivities = fresh?.error ? [] : fresh?.activities || [];
  const preparation = freshActivities.filter(activity => newMeetingStarts.has(activity.meetingStartMinutes));
  const displaced = activities.filter(activity => _isPendingActivity(activity)
    && preparation.some(preparationActivity => _overlaps(activity, preparationActivity)));
  const keptActivities = activities.filter(activity => !displaced.includes(activity));
  const mergedActivities = [...keptActivities, ...preparation].sort((first, second) => first.startMinutes - second.startMinutes);
  const displacedReserves = displaced.map(activity => ({ ...activity, rationale: activity.rationale || activity.reason || "",
    taskText: activity.taskText || activity.title }));
  logIfEnabled(`${ REFINEMENT_LOG_LABEL } prepared for meetings that arrived after the agenda was planned`, {
    displacedCount: displaced.length, newMeetingCount: newMeetings.length, preparationCount: preparation.length });
  return { activities: mergedActivities, changed: true, meetingKeys, placed: preparation,
    reserveTasks: [...displacedReserves, ...reserveTasks] };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Whether an activity still awaits the user's decision; an activity without a status is pending.
// @param {object} activity - Agenda activity.
// @returns {boolean}
function _isPendingActivity(activity) {
  return (activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING) === PROPOSED_TASK_STATUS.PENDING;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether two activities' times overlap.
// @param {object} first - Activity with startMinutes and durationMinutes.
// @param {object} second - Activity with startMinutes and durationMinutes.
// @returns {boolean}
function _overlaps(first, second) {
  const firstEnd = first.startMinutes + (first.durationMinutes || 0);
  const secondEnd = second.startMinutes + (second.durationMinutes || 0);
  return first.startMinutes < secondEnd && second.startMinutes < firstEnd;
}
