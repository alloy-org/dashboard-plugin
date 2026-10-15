// Brainstorm preparation tasks for a day's meetings that none of the user's tasks or project ideas pertain to, and keep
// them in an archived "Dashboard Meeting Preparation" note so each meeting is brainstormed once and later rankings of
// the day ask about the same ideas. A meeting's ideas are offered as idea candidates under that meeting's group;
// accepting one inserts it as a task. An idea restating an open task, as one the user already accepted does, is not
// offered again.
import { readJsonNote, writeJsonNote } from "dashboard/work-queue/dashboard-json-note";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { meetingClock, meetingGroup } from "dashboard/proposed-agenda/meeting-preparation";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { ideaComparisonKey } from "dashboard/project-tasks/project-idea-records";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { textDigest } from "util/text-digest";

export const MEETING_PREPARATION_SCHEMA_VERSION = 1;
// The actionability a brainstormed preparation task is offered at: written to fit one block before the call.
const PREPARATION_IDEA_ACTIONABILITY = 8;
const PREPARATION_IDEA_MINUTES = 30;
const MAXIMUM_IDEAS_PER_MEETING = 3;
const ALL_NOTES_DOMAIN_KEY = "all-notes";
const PREPARATION_LOG_LABEL = "[meeting-preparation-ideas]";
const PREPARATION_NOTE_DESCRIPTION = "This archived note is maintained by the dashboard plugin. It keeps the preparation "
  + "tasks brainstormed for upcoming meetings, so the Proposed Agenda can suggest them in the hours before each call.";

// ----------------------------------------------------------------------------------------------
// @desc The idea groups for meetings no task or project idea pertains to. A meeting brainstormed before reuses its
//   stored ideas; the rest are brainstormed together in one request and stored, unless storedOnly. A failed request
//   or write costs only the ideas: the meetings are brainstormed again on a later preparation.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainUuid - Task domain UUID, or null for All Notes
//   - {Array<object>} meetings - Meetings from meetingsFromCalendarEvents that no candidate matched
//   - {Array<object>|null} [openTasks] - Open tasks, native or compact, whose text an idea must not restate
//   - {object|null} [providerDispatch] - The work runtime's dispatcher; the request then waits for a generative permit
//   - {function} [requestIdeas] - Injects the brainstorm for tests: (prompt) => { meetings: [{ meetingKey, tasks }] }
//   - {AbortSignal|null} [signal] - Abandons a request still waiting for its permit
//   - {boolean} [storedOnly=false] - Read stored ideas only, never asking a provider
//   - {Date} targetDate - The day being planned
// @returns {Promise<Array<object>>} Meeting groups whose candidates are the meeting's ideas.
export async function meetingPreparationIdeaGroups(app, { domainUuid, meetings, openTasks = null, providerDispatch = null,
    requestIdeas = null, signal = null, storedOnly = false, targetDate }) {
  if (!meetings?.length) return [];
  const dateKey = dateKeyFromDateInput(targetDate);
  const { payload } = await _readNote(app, domainUuid);
  const storedByKey = new Map((payload?.meetings || []).map(record => [record.meetingKey, record]));
  let ideasByKey = new Map([...storedByKey].map(([meetingKey, record]) => [meetingKey, record.ideas || []]));
  const unbrainstormed = meetings.filter(meeting => !storedByKey.has(meeting.meetingKey));
  if (unbrainstormed.length && !storedOnly) {
    const brainstormed = await _brainstormedIdeas(app, { dateKey, meetings: unbrainstormed, providerDispatch, requestIdeas, signal });
    if (brainstormed.size) {
      ideasByKey = new Map([...ideasByKey, ...brainstormed]);
      await _storeIdeas(app, { brainstormed, dateKey, domainUuid })
        .catch(error => logIfEnabled(`${ PREPARATION_LOG_LABEL } could not store ideas`, error?.message));
    }
  }
  const openTaskKeys = new Set((openTasks || []).map(task => ideaComparisonKey(task?.content || task?.taskText)).filter(Boolean));
  const groups = [];
  for (const meeting of meetings) {
    const ideas = (ideasByKey.get(meeting.meetingKey) || []).filter(idea => !openTaskKeys.has(ideaComparisonKey(idea.text)));
    if (ideas.length) groups.push(meetingGroup(meeting, { projectUuid: null, taskCandidates: ideas.map(_ideaCandidate) }));
  }
  return groups;
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt asking for preparation tasks for each meeting.
// @param {Array<object>} meetings - Meetings to brainstorm for.
// @param {string} dateKey - The planned day, YYYY-MM-DD.
// @returns {string} Prompt answered with { meetings: [{ meetingKey, tasks }] }.
export function meetingPreparationPrompt(meetings, dateKey) {
  const described = meetings.map(meeting => ({ attendees: meeting.attendeeNames, meetingKey: meeting.meetingKey,
    startTime: meetingClock(meeting.startMinutes), title: meeting.title }));
  return [`The user has the following meetings on ${ dateKey }. None of their existing tasks mention who or what each is about.`,
    `For each meeting, propose up to ${ MAXIMUM_IDEAS_PER_MEETING } concrete tasks the user could do in the two to three hours `
      + "before it to arrive prepared, each finishable within one 30 to 60 minute block. Name the person or company in "
      + "each task. Prefer research, reviewing prior correspondence or notes, drafting an agenda or questions, and "
      + "preparing materials the meeting will need. A meeting that needs no preparation, such as a social call, gets no tasks.",
    "", "Meetings:", JSON.stringify(described, null, 2),
    "", 'Reply with JSON only: { "meetings": [{ "meetingKey": "...", "tasks": ["...", "..."] }] }'].join("\n");
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Ask the generative model for the meetings' preparation tasks.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { dateKey, meetings, providerDispatch, requestIdeas, signal }.
// @returns {Promise<Map<string, Array<object>>>} Ideas ({ ideaId, text }) by meeting key; empty when nothing answered.
async function _brainstormedIdeas(app, { dateKey, meetings, providerDispatch, requestIdeas, signal }) {
  const prompt = meetingPreparationPrompt(meetings, dateKey);
  let response = null;
  try {
    if (requestIdeas) {
      response = await requestIdeas(prompt);
    } else {
      const settings = pluginSettings();
      if (!fastModelOptions(settings) && !(await findAmpleAgentProNote(app))) return new Map();
      const request = () => raceWizardPrompt(app, prompt, wizardLlmOptions(settings));
      response = providerDispatch ? await providerDispatch.generative(request, { signal }) : await request();
    }
  } catch (error) {
    logIfEnabled(`${ PREPARATION_LOG_LABEL } brainstorm failed`, error?.message);
    return new Map();
  }
  const knownKeys = new Set(meetings.map(meeting => meeting.meetingKey));
  const ideasByKey = new Map();
  for (const answer of Array.isArray(response?.meetings) ? response.meetings : []) {
    if (!knownKeys.has(answer?.meetingKey) || !Array.isArray(answer.tasks)) continue;
    const texts = answer.tasks.map(task => String(task || "").replace(/\s+/g, " ").trim()).filter(Boolean);
    const ideas = texts.slice(0, MAXIMUM_IDEAS_PER_MEETING).map(text => ({ ideaId: `meeting-${ textDigest(`${ answer.meetingKey }|${ text }`) }`, text }));
    ideasByKey.set(answer.meetingKey, ideas);
  }
  logIfEnabled(`${ PREPARATION_LOG_LABEL } brainstormed`, { answeredCount: ideasByKey.size, meetingCount: meetings.length });
  return ideasByKey;
}

// ----------------------------------------------------------------------------------------------
// @desc An idea candidate, in the shape projectTaskCandidates gives one.
// @param {object} idea - { ideaId, text }.
// @returns {object} Idea candidate.
function _ideaCandidate(idea) {
  return { actionability: PREPARATION_IDEA_ACTIONABILITY, candidateId: `idea:${ idea.ideaId }`,
    durationMinutes: PREPARATION_IDEA_MINUTES, ideaId: idea.ideaId, isExisting: false, minutesSinceRecommended: null,
    noteUuid: null, score: null, text: idea.text, uuid: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Name a domain's preparation note.
// @param {string|null} domainUuid - Task domain UUID, or null for All Notes.
// @returns {string} Note name.
function _noteName(domainUuid) {
  return `Dashboard Meeting Preparation ${ domainUuid || ALL_NOTES_DOMAIN_KEY }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read a domain's preparation note. A note this version cannot read reads as empty, and throws when strict, so
//   a write never overwrites it.
// @param {object} app - Host-compatible Amplenote API.
// @param {string|null} domainUuid - Task domain UUID.
// @param {object} [options] - { strict = false }.
// @returns {Promise<object>} { noteHandle, payload }.
async function _readNote(app, domainUuid, { strict = false } = {}) {
  try {
    const { noteHandle, payload } = await readJsonNote(app, _noteName(domainUuid));
    if (payload && Number(payload.schemaVersion) > MEETING_PREPARATION_SCHEMA_VERSION) {
      throw new Error("The meeting preparation note was written by a newer version of the plugin");
    }
    return { noteHandle, payload };
  } catch (error) {
    if (strict) throw error;
    return { noteHandle: null, payload: null };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Add newly brainstormed meetings to the note, dropping meetings of days before the one planned or today.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { brainstormed, dateKey, domainUuid }: brainstormed maps meeting keys to ideas.
// @returns {Promise<void>}
// @throws When the note cannot be read or written.
function _storeIdeas(app, { brainstormed, dateKey, domainUuid }) {
  const name = _noteName(domainUuid);
  return DashboardNoteWriter.forApp(app).update(name, async () => {
    const { noteHandle, payload } = await _readNote(app, domainUuid, { strict: true });
    const todayKey = dateKeyFromDateInput(new Date());
    const earliestKey = dateKey < todayKey ? dateKey : todayKey;
    const added = [...brainstormed].map(([meetingKey, ideas]) => ({ dateKey, generatedAt: new Date().toISOString(), ideas, meetingKey }));
    const retained = (payload?.meetings || []).filter(record => record.dateKey >= earliestKey && !brainstormed.has(record.meetingKey));
    await writeJsonNote(app, { description: PREPARATION_NOTE_DESCRIPTION, name, noteHandle,
      payload: { meetings: [...retained, ...added], schemaVersion: MEETING_PREPARATION_SCHEMA_VERSION }, title: "Dashboard meeting preparation" });
  });
}
