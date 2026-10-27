// Gather everything a past quarter's retrospective is told from: the quarter's completed tasks with their Rich Footnote
// text, images, and note names and tags; the completed task ledger that records which project each one advanced; the
// quarter's projects and how many of their tasks were still open when it ended; the intents chosen in Plan Builder;
// the calendar journal's days; and the quarter before's totals, to compare against. Only the completed tasks are required. Every other source is optional, so a
// quarter that had no plan, no ledger, or no calendar still gets the facts its completed tasks alone can tell.
import { quarterBefore } from "constants/quarters";
import { projectExampleTasks } from "dashboard/projects/completed-task-project-classification";
import { readCompletedTaskLedger } from "dashboard/projects/completed-task-project-ledger";
import { readCollectedProjectTasks } from "dashboard/project-tasks/project-task-store";
import { readCalendarHistory } from "dashboard/quarter-retrospective/calendar-history-journal";
import { INFERRED_PROJECT_UUID_PREFIX } from "dashboard/quarter-retrospective/retrospective-month-digests";
import { quarterCompletions, quarterTotals, retrospectiveStatistics } from "dashboard/quarter-retrospective/retrospective-statistics";
import { openAtQuarterEndByProject, taskFootnoteEvidence,
  taskNeedsNoteFootnotes } from "dashboard/quarter-retrospective/retrospective-task-evidence";
import { isGenuinelyCompleted } from "plan-wizard/intent-evidence";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { forEachWithConcurrency } from "util/concurrency";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const RETROSPECTIVE_LOG_LABEL = "[quarter-retrospective]";
// How many notes are looked up at once while reading the quarter's note names, tags, and footnotes.
const NOTE_LOOKUP_CONCURRENCY = 6;
// How many of the completed tasks read are logged in full, so a count that looks wrong can be checked against them.
const LOGGED_TASK_SAMPLE_COUNT = 20;
// How many of a store project's open tasks are kept to show what its work looks like.
const PROJECT_EXAMPLE_TASK_COUNT = 5;

// ----------------------------------------------------------------------------------------------
// @desc Gather a quarter, reporting each step as it starts so a processing screen can say what is happening.
// @param {object} app - Amplenote API.
// @param {object} request - An object with the following properties:
//   - {string|null} domainName - Display name of the task domain, or null for All Notes
//   - {string|null} domainUuid - Task domain UUID, or null for All Notes
//   - {boolean} [includeCalendar] - Whether to read the calendar journal
//   - {number} quarter - 1 through 4
//   - {number} year - Calendar year
// @param {object} [options] - { onProgress }: receives a short description of each step as it starts.
// @returns {Promise<object>} An object with the following properties:
//   - {object|null} calendar - { coverage, eventsByDate } from the journal, eventsByDate keyed by YYYY-MM-DD, or null
//     when not included
//   - {Array<object>} completions - The quarter's completions, as quarterCompletions returns them, each also carrying
//     { footnoteText, images, noteName, noteTags }, images being { alt, url }
//   - {Array<object>} media - Image candidates as { alt, footnoteText, taskUuid, url }, each URL once
//   - {Map<string, Array<string>>} projectExamples - The open task texts most like each store project, by project UUID
//   - {Array<object>} projects - { derivedFrom, name, uuid } per project the plan or the ledger named
//   - {object} scope - The resolved plan scope of the quarter
//   - {object} statistics - As retrospectiveStatistics returns them
//   - {object} statisticsInputs - What the statistics were computed from, so they can be computed again once projects
//     have been inferred
// @throws When the completed tasks could not be read.
export async function gatherRetrospectiveQuarter(app, request, { onProgress = () => {} } = {}) {
  const { includeCalendar = false, quarter, year } = request;
  const scope = resolvePlanScope({ domainName: request.domainName || "All Notes", domainUuid: request.domainUuid || null, quarter, year });
  const quarterLabel = `Q${ quarter } ${ year }`;
  onProgress(`Reading ${ quarterLabel }'s completed tasks…`);
  const [completedTasks, entriesByDate, intents, storeProjects, previousQuarterTotals] = await Promise.all([_quarterCompletedTasks(app, scope),
    _ledgerEntriesByDate(app, scope), _quarterIntents(app, scope), _storeProjects(app, scope), _previousQuarterTotals(app, scope)]);
  const projects = _quarterProjects(storeProjects, entriesByDate);

  onProgress(`Checking which project tasks were still open when ${ quarterLabel } ended…`);
  const openCountByProject = storeProjects.length ? await _openCountByProject(app, scope, storeProjects) : null;

  let calendar = null;
  if (includeCalendar) {
    onProgress("Reading your calendar…");
    calendar = await _quarterCalendar(app, scope);
  }

  const completions = quarterCompletions({ completedTasks, entriesByDate, quarter, year });
  logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } quarter completions counted`, { completedTaskCount: completedTasks.length,
    genuinelyCompletedCount: completedTasks.filter(isGenuinelyCompleted).length, quarterCompletionCount: completions.length });
  onProgress(`Reading the notes behind ${ completions.length } completed tasks…`);
  const contentByTaskUuid = new Map(completedTasks.map(task => [task.uuid, task.content || ""]));
  const enrichedCompletions = await _enrichedCompletions(app, completions, contentByTaskUuid);
  const media = _mediaCandidates(enrichedCompletions);

  const calendarDays = calendar ? new Map(Object.entries(calendar.eventsByDate).map(([dateKey, events]) => [dateKey, { events }])) : null;
  const statisticsInputs = { calendarCoverage: calendar?.coverage || null, calendarDays, completedTasks, entriesByDate,
    intentTexts: intents.intentTexts, openCountByProject, previousQuarterTotals, projects, quarter, quarterName: intents.quarterName, year };
  const statistics = retrospectiveStatistics(statisticsInputs);
  const projectExamples = new Map(storeProjects.map(project => [project.uuid, projectExampleTasks(project, PROJECT_EXAMPLE_TASK_COUNT)]));
  return { calendar, completions: enrichedCompletions, media, projectExamples, projects, scope, statistics, statisticsInputs };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Add each completion's footnote text, image URLs, and note name and tags. Each note is looked up once; its
//   content is read only when one of its tasks cites a footnote the task itself doesn't define.
// @param {object} app - Amplenote API.
// @param {Array<object>} completions - From quarterCompletions.
// @param {Map<string, string>} contentByTaskUuid - Each completed task's full markdown.
// @returns {Promise<Array<object>>} The completions, each with { footnoteText, images, noteName, noteTags }.
async function _enrichedCompletions(app, completions, contentByTaskUuid) {
  const noteUuids = [...new Set(completions.map(completion => completion.noteUuid).filter(Boolean))];
  const contentNeededNoteUuids = new Set(completions.filter(completion => completion.noteUuid
    && taskNeedsNoteFootnotes(contentByTaskUuid.get(completion.taskUuid))).map(completion => completion.noteUuid));
  const noteByUuid = new Map();
  await forEachWithConcurrency(noteUuids, NOTE_LOOKUP_CONCURRENCY, async noteUuid => {
    noteByUuid.set(noteUuid, await _noteDetails(app, noteUuid, { readContent: contentNeededNoteUuids.has(noteUuid) }));
  });
  const enrichedCompletions = completions.map(completion => {
    const note = noteByUuid.get(completion.noteUuid) || null;
    const evidence = taskFootnoteEvidence(contentByTaskUuid.get(completion.taskUuid), note?.content || null);
    return { ...completion, footnoteText: evidence.footnoteText, images: evidence.images, noteName: note?.name || null,
      noteTags: note?.tags || [] };
  });
  return enrichedCompletions;
}

// ----------------------------------------------------------------------------------------------
// @desc How many tasks were completed in a window across every task domain, for diagnosing a domain that returned none.
// @param {object} app - Amplenote API.
// @param {number} fromSeconds - Window start, in seconds.
// @param {number} toSeconds - Window end, in seconds.
// @returns {Promise<number|string>} The count, or the error message when it couldn't be read.
async function _everyDomainCompletedTaskCount(app, fromSeconds, toSeconds) {
  try {
    const tasks = await app.getCompletedTasks(fromSeconds, toSeconds, {});
    return Array.isArray(tasks) ? tasks.length : `not a list: ${ typeof tasks }`;
  } catch (error) {
    return error?.message || "unknown error";
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's ledger entries, or none when the ledger is missing or cannot be read.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<Map<string, Array<object>>>} Entries by date key.
async function _ledgerEntriesByDate(app, scope) {
  try {
    const ledger = await readCompletedTaskLedger(app, scope);
    return ledger.entriesByDate;
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read the completed task ledger`, error?.message);
    return new Map();
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Every image in the quarter's completed tasks and their footnotes, each URL once, with the text around it so
//   a model that can't see images can still choose among them.
// @param {Array<object>} completions - Enriched completions.
// @returns {Array<object>} { alt, footnoteText, taskUuid, url } per image.
function _mediaCandidates(completions) {
  const candidatesByUrl = new Map();
  for (const completion of completions) {
    for (const image of completion.images) {
      if (candidatesByUrl.has(image.url)) continue;
      candidatesByUrl.set(image.url, { alt: image.alt, footnoteText: completion.footnoteText || completion.text,
        taskUuid: completion.taskUuid, url: image.url });
    }
  }
  return [...candidatesByUrl.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc A note's name and tags, and its content when asked for, or nothing when it can't be found.
// @param {object} app - Amplenote API.
// @param {string} noteUuid - The note's UUID.
// @param {object} options - { readContent }.
// @returns {Promise<object|null>} { content, name, tags }, content null unless read.
async function _noteDetails(app, noteUuid, { readContent }) {
  try {
    const handle = await app.findNote({ uuid: noteUuid });
    if (!handle) return null;
    const content = readContent ? await app.getNoteContent({ uuid: noteUuid }) : null;
    const tags = Array.isArray(handle.tags) ? handle.tags.map(String) : [];
    return { content: typeof content === "string" ? content : null, name: handle.name || null, tags };
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read a task's note`, { message: error?.message, noteUuid });
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Count each project's tasks that were still open when the quarter ended, from the domain's open tasks now and
//   the tasks completed since the quarter ended.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @param {Array<object>} storeProjects - Project task store records for the quarter.
// @returns {Promise<Map<string, number>|null>} Counts by project UUID, or null when the tasks couldn't be read.
async function _openCountByProject(app, scope, storeProjects) {
  try {
    const quarterEndMillis = new Date(scope.year, scope.quarter * 3, 1).getTime();
    const lookupOptions = scope.domainUuid ? { taskDomainUUID: scope.domainUuid } : {};
    const fromSeconds = Math.floor(quarterEndMillis / 1000);
    const toSeconds = Math.floor(Date.now() / 1000);
    const [openTasks, laterCompletedTasks] = await Promise.all([app.getTaskDomainTasks(scope.domainUuid || null),
      toSeconds > fromSeconds ? app.getCompletedTasks(fromSeconds, toSeconds, lookupOptions) : []]);
    if (!Array.isArray(openTasks)) return null;
    return openAtQuarterEndByProject({ laterCompletedTasks: Array.isArray(laterCompletedTasks) ? laterCompletedTasks : [], openTasks,
      projects: storeProjects, quarterEndMillis });
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not count open project tasks`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter before's completed task count and Victory Value, in the same task domain and counted with its own
//   ledger, so the retrospective can say how this quarter compares.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope of the quarter being looked back on.
// @returns {Promise<object|null>} { quarter, totalTaskCount, totalVictoryValue, year }, or null when its completed tasks
//   couldn't be read.
async function _previousQuarterTotals(app, scope) {
  try {
    const previous = quarterBefore(scope);
    const previousScope = resolvePlanScope({ ...previous, domainName: scope.domainName, domainUuid: scope.domainUuid });
    const [completedTasks, entriesByDate] = await Promise.all([_quarterCompletedTasks(app, previousScope), _ledgerEntriesByDate(app, previousScope)]);
    return quarterTotals({ completedTasks, entriesByDate, quarter: previous.quarter, year: previous.year });
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read the quarter before's completed tasks`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The calendar journal's days for the quarter.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<object|null>} { coverage, eventsByDate }, or null when the journal couldn't be read.
async function _quarterCalendar(app, scope) {
  try {
    const startDateKey = dateKeyFromDateInput(new Date(scope.year, (scope.quarter - 1) * 3, 1));
    const endDateKey = dateKeyFromDateInput(new Date(scope.year, scope.quarter * 3, 0));
    const history = await readCalendarHistory(app, { domainName: scope.domainName, endDateKey, startDateKey });
    const eventsByDate = Object.fromEntries([...history.daysByDate].map(([dateKey, day]) => [dateKey, day.events]));
    return { coverage: history.coverage, eventsByDate };
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read the calendar journal`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Every task completed during the quarter, in the scope's task domain. The count read is logged, and when the
//   domain returns none, so is the count across every domain, which tells a host-side domain filter that dropped the
//   quarter's tasks apart from a quarter that had none.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<Array<object>>} Completed tasks.
// @throws When getCompletedTasks is unavailable or does not return a list.
async function _quarterCompletedTasks(app, scope) {
  if (typeof app?.getCompletedTasks !== "function") throw new Error("Completed tasks cannot be read here");
  const fromSeconds = Math.floor(new Date(scope.year, (scope.quarter - 1) * 3, 1).getTime() / 1000);
  const toSeconds = Math.floor(Math.min(Date.now(), new Date(scope.year, scope.quarter * 3, 1).getTime()) / 1000);
  const lookupOptions = scope.domainUuid ? { taskDomainUUID: scope.domainUuid } : {};
  const tasks = await app.getCompletedTasks(fromSeconds, toSeconds, lookupOptions);
  if (!Array.isArray(tasks)) throw new Error("Could not read the quarter's completed tasks");
  const taskObjects = tasks.filter(task => task && typeof task === "object");
  const sampleTasks = taskObjects.slice(0, LOGGED_TASK_SAMPLE_COUNT).map(task => ({ completedAt: task.completedAt, crossedOutAt: task.crossedOutAt,
    dismissedAt: task.dismissedAt, noteUUID: task.noteUUID, text: String(task.content || "").slice(0, 60), uuid: task.uuid }));
  const lookup = { domainName: scope.domainName, domainUuid: scope.domainUuid, from: new Date(fromSeconds * 1000).toISOString(), fromSeconds,
    quarter: scope.quarter, rawResultType: Array.isArray(tasks) ? `array of ${ tasks.length }` : typeof tasks, sampleTasks,
    taskCount: taskObjects.length, to: new Date(toSeconds * 1000).toISOString(), toSeconds, year: scope.year };
  if (!taskObjects.length && scope.domainUuid) lookup.everyDomainTaskCount = await _everyDomainCompletedTaskCount(app, fromSeconds, toSeconds);
  logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } completed tasks read`, lookup);
  return taskObjects;
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's chosen intents, highest ranked first, and the name the user gave the quarter.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<object>} { intentTexts, quarterName }; empty when no Vision Guide holds the quarter.
async function _quarterIntents(app, scope) {
  try {
    const guide = await readVisionGuide(app, scope);
    const goals = guide?.goals?.goals || [];
    const liveGoals = goals.filter(goal => !goal.isDeleted && goal.goalText);
    const rankedGoals = [...liveGoals].sort((first, second) => first.goalRank - second.goalRank);
    const intentTexts = rankedGoals.map(goal => goal.goalText);
    return { intentTexts, quarterName: guide?.goals?.quarterName?.text || null };
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read the quarter's intents`, error?.message);
    return { intentTexts: [], quarterName: null };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's projects: those the project task store held, active or retired, then any the ledger credited
//   that the store didn't hold. A store project an earlier retrospective inferred from themes is still named as such.
// @param {Array<object>} storeProjects - Project task store records.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key.
// @returns {Array<object>} { derivedFrom, name, uuid } per project; derivedFrom is "plan", "themes", or "ledger".
function _quarterProjects(storeProjects, entriesByDate) {
  const projectsByUuid = new Map(storeProjects.map(project => [project.uuid, { derivedFrom: project.uuid.startsWith(INFERRED_PROJECT_UUID_PREFIX)
    ? "themes" : "plan", name: project.summary, uuid: project.uuid }]));
  for (const entries of entriesByDate.values()) {
    for (const entry of entries) {
      if (entry.projectUuid && !projectsByUuid.has(entry.projectUuid)) {
        projectsByUuid.set(entry.projectUuid, { derivedFrom: "ledger", name: entry.projectName || "Unnamed project", uuid: entry.projectUuid });
      }
    }
  }
  return [...projectsByUuid.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's project task store records, active and retired, or none when the store can't be read.
// @param {object} app - Amplenote API.
// @param {object} scope - Resolved plan scope.
// @returns {Promise<Array<object>>} Store records.
async function _storeProjects(app, scope) {
  try {
    return await readCollectedProjectTasks(app, scope, { includeInactive: true });
  } catch (error) {
    logIfEnabled(`${ RETROSPECTIVE_LOG_LABEL } could not read the project task store`, error?.message);
    return [];
  }
}
