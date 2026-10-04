// Build today's project-nested candidate list, existing tasks and rated ideas alike, and rank it with Jev, or with the
// generative model when Jev is unavailable. Dream task keeps two candidates that have not been suggested in the past
// three days. The agenda and the calendar suggestion action keep the best fifteen and slot them onto free hours.
// A ranking is kept in the day ranking store under a revision of everything the ranker read, so a later request asking
// the same question, from any of these surfaces or from a queued preparation, reuses it without a provider request.
// Preparing and slotting a ranking records nothing: the surface that shows a suggestion records it through
// recordShownTaskSuggestions, which logs a task's UUID, or an idea's idea ID, on that project's section of the project
// task store. When the user accepts an idea it records the task the idea became, and when they turn one down it is
// dismissed, so a later generation does not offer it again. A null result means neither ranker could answer, and the
// caller keeps its existing generator.
import { dayProjectGroups } from "day-project-candidates";
import DayRankingStore from "day-ranking-store";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { IDEA_STATUSES } from "project-idea-records";
import { quarterlyProgressProjects } from "project-progress-model";
import QuarterProject from "quarter-project";
import QuarterProjectRepository from "quarter-project-repository";
import { projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { dayRankingRevision, rankDayTasks, rankedTasksFromRatings, suggestionQuestions } from "suggestion-task-rank";
import { DREAM_SUGGESTION_COUNT, refillRejectedSuggestion, slotRankedTasks,
  tasksNotRecentlySuggested } from "suggestion-task-slots";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const SUGGESTION_LOG_LABEL = "[ranked-task-suggestions]";

// ----------------------------------------------------------------------------------------------
// @desc Rank tasks for the proposed agenda and place the best fits on free hours. Nothing is recorded as shown; the
//   caller records the activities it presents.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, nowMinutes, obligations, openTasks, projects, targetDate }.
// @returns {Promise<object|null>} { activities, rankerEm, reserveTasks } or null when no ranker is available.
export async function agendaSuggestionsFromProjects(app, { domainName, domainUuid, nowMinutes = null, obligations = [],
    openTasks = null, projects = null, targetDate }) {
  const { ranking } = await prepareDayRanking(app, { domainName, domainUuid, openTasks, projects, targetDate });
  if (!ranking) return null;
  const targetMidnightSeconds = Math.floor(targetDate.getTime() / 1000);
  const slotted = slotRankedTasks(ranking.rankedTasks, { nowMinutes, obligations, targetMidnightSeconds });
  const reserveTasks = slotted.reserveTasks.map(task => ({ ...task, targetMidnightSeconds }));
  logIfEnabled(`${ SUGGESTION_LOG_LABEL } agenda`, { placed: slotted.activities.length, rankerEm: ranking.rankerEm,
    reserves: reserveTasks.length });
  return { activities: slotted.activities, rankerEm: ranking.rankerEm, reserveTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Rank tasks for Goal Coach. Two tasks that were not suggested in the past three days are returned, and
//   the rest of that fresh list is held so a rejection can show the next one. Nothing is recorded as shown; the caller
//   records the cards it presents.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, excludeIds, now, openTasks }: excludeIds holds task UUIDs or
//   candidate IDs already on screen.
// @returns {Promise<object|null>} { rankerEm, reserveTasks, scope, tasks } or null.
export async function dreamSuggestionsFromProjects(app, { domainName, domainUuid, excludeIds = null, now, openTasks }) {
  const { ranking } = await prepareDayRanking(app, { domainName, domainUuid, excludeIds, openTasks, targetDate: now });
  if (!ranking) return null;
  const fresh = tasksNotRecentlySuggested(ranking.rankedTasks);
  const tasks = fresh.slice(0, DREAM_SUGGESTION_COUNT).map((task, index) => _dreamTask(task, 10 - index));
  if (!tasks.length) return null;
  const reserveTasks = fresh.slice(DREAM_SUGGESTION_COUNT).map((task, index) => _dreamTask(task, Math.max(1, 8 - index)));
  logIfEnabled(`${ SUGGESTION_LOG_LABEL } dream tasks`, { rankerEm: ranking.rankerEm, reserves: reserveTasks.length,
    shown: tasks.length });
  return { rankerEm: ranking.rankerEm, reserveTasks, scope: ranking.scope, tasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Find the task an idea already became, so accepting it again, from another surface or a retried click, opens or
//   schedules that task instead of inserting a duplicate. A task that was since deleted or dismissed does not count.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, ideaId, projectUuid, targetDate }.
// @returns {Promise<object|null>} { noteUuid, taskUuid } of the accepted task, or null when the idea has none.
export async function existingTaskForAcceptedIdea(app, { domainName, domainUuid, ideaId, projectUuid, targetDate }) {
  if (!ideaId || !projectUuid) return null;
  try {
    const stored = await new QuarterProjectRepository({ app }).readOne(_scopeFor(domainName, domainUuid, targetDate), projectUuid);
    const idea = (stored?.suggestedTasks || []).find(candidate => candidate.ideaId === ideaId);
    if (idea?.status !== IDEA_STATUSES.accepted || !idea.acceptedTaskUuid) return null;
    const task = typeof app.getTask === "function" ? await app.getTask(idea.acceptedTaskUuid) : null;
    if (!task || task.dismissedAt) return null;
    return { noteUuid: task.noteUUID || task.noteUuid || null, taskUuid: idea.acceptedTaskUuid };
  } catch (error) {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } could not read accepted idea`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Prepare a day's ranking without recording anything as shown: build the day's candidate groups, reuse the
//   ranking stored at their revision, or ask the ranker and store its answer. A store that cannot be read or written
//   costs only the reuse; a fresh ranking is still returned.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Task domain name
//   - {string|null} domainUuid - Task domain UUID
//   - {Set<string>|null} [excludeIds] - Task UUIDs or candidate IDs to leave out of the candidates
//   - {Array<object>|null} [openTasks] - Open tasks, for each candidate's duration and note
//   - {Array<object>|null} [projects] - The caller's live projects; the quarter's are read with its guide when absent
//   - {object|null} [providerDispatch] - The work runtime's dispatcher, through which a queued preparation asks
//   - {function} [requestAnswers] - Injects a Jev response for tests
//   - {AbortSignal|null} [signal] - Abandons a request still waiting for its permit
//   - {Date} targetDate - The day being planned
// @returns {Promise<object>} { outcome, ranking }. outcome is "noCandidates", "noRanker", "unanswered", "ranked" when
//   the ranker was asked, or "stored" when a stored ranking was reused; ranking is { fromStore, rankerEm, rankedTasks,
//   revision, scope } for the last two and null otherwise.
export async function prepareDayRanking(app, { domainName, domainUuid, excludeIds = null, openTasks = null, projects = null,
    providerDispatch = null, requestAnswers = undefined, signal = null, targetDate }) {
  const scope = _scopeFor(domainName, domainUuid, targetDate);
  const groups = await _dayGroups(app, scope, { excludeIds, openTasks, projects, targetDate });
  if (!groups.length) return { outcome: "noCandidates", ranking: null };
  const scorerEm = requestAnswers ? "jev" : await projectTaskScorer(app);
  if (!scorerEm) return { outcome: "noRanker", ranking: null };
  const { listed, state } = suggestionQuestions(groups);
  const revision = dayRankingRevision(state, scorerEm);
  const dateKey = dateKeyFromDateInput(targetDate);
  const store = new DayRankingStore({ app });
  const stored = await store.read(domainUuid || null, { dateKey, revision });
  const storedTasks = stored ? rankedTasksFromRatings(listed, stored.ratings) : [];
  if (storedTasks.length) {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } reused stored ranking`, { dateKey, revision });
    return { outcome: "stored", ranking: { fromStore: true, rankerEm: stored.rankerEm, rankedTasks: storedTasks, revision, scope } };
  }
  const ranked = await rankDayTasks(app, groups, { providerDispatch, requestAnswers, scorerEm, signal });
  if (!ranked?.rankedTasks?.length) return { outcome: "unanswered", ranking: null };
  await store.save(domainUuid || null, { dateKey, rankedTasks: ranked.rankedTasks, rankerEm: ranked.rankerEm, revision })
    .catch(error => logIfEnabled(`${ SUGGESTION_LOG_LABEL } could not store ranking`, error?.message));
  return { outcome: "ranked", ranking: { fromStore: false, rankerEm: ranked.rankerEm, rankedTasks: ranked.rankedTasks,
    revision, scope } };
}

// ----------------------------------------------------------------------------------------------
// @desc Record tasks that were just shown, including one promoted after a rejection.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, suggestions, targetDate }. suggestions carry projectUuid
//   and taskUuid or uuid, or an idea's ideaId.
// @returns {Promise<void>}
export async function recordShownTaskSuggestions(app, { domainName, domainUuid, suggestions, targetDate }) {
  const shownAt = targetDate || new Date();
  await _recordShown(app, _scopeFor(domainName, domainUuid, shownAt), suggestions, shownAt);
}

// ----------------------------------------------------------------------------------------------
// @desc Record what the user did with ideas they were shown: an accepted idea records the task it became, and a turned
//   down one is dismissed. A failed write is logged and does not undo what the user already did.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { decisions, domainName, domainUuid, targetDate }: decisions are { acceptedTaskUuid,
//   ideaId, projectUuid, status }, status one of IDEA_STATUSES' accepted or dismissed; suggestions that are not ideas
//   are ignored. targetDate is the day the ideas were suggested for, which selects the quarter.
// @returns {Promise<number>} How many ideas changed.
export async function recordSuggestedIdeaDecisions(app, { decisions, domainName, domainUuid, targetDate }) {
  const ideaDecisions = (decisions || []).filter(decision => decision?.ideaId && decision.projectUuid);
  if (!ideaDecisions.length) return 0;
  const decidedAt = new Date().toISOString();
  try {
    return await new QuarterProjectRepository({ app }).decideIdeas(_scopeFor(domainName, domainUuid, targetDate || new Date()),
      { decidedAt, decisions: ideaDecisions });
  } catch (error) {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } could not record idea decisions`, error?.message);
    return 0;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Record one task that replaced a rejected suggestion, and return the agenda rows with that task placed.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - Refill inputs plus { domainName, domainUuid, targetDate }.
// @returns {Promise<object>} The refillRejectedSuggestion result. The placement is recorded when one was made.
export async function refillAndRecordSuggestion(app, { activities, domainName, domainUuid, nowMinutes, obligations,
    preferredStartMinutes, reserveTasks, targetDate, targetMidnightSeconds }) {
  const refill = refillRejectedSuggestion({ activities, nowMinutes, obligations, preferredStartMinutes, reserveTasks,
    targetMidnightSeconds });
  if (refill.placed) await _recordShown(app, _scopeFor(domainName, domainUuid, targetDate), [refill.placed], targetDate);
  return refill;
}

// ----------------------------------------------------------------------------------------------
// @desc Load the quarter's projects and their stored tasks, and group the candidates of the ones that qualify today.
//   Each project is this request's own copy, so the day evidence set for this date never reaches a caller's projects
//   or another request planning a different date.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope of the day being planned.
// @param {object} options - { excludeIds, openTasks, projects, targetDate }.
// @returns {Promise<Array<object>>} Groups as dayProjectGroups builds them; empty when no project qualifies.
async function _dayGroups(app, scope, { excludeIds, openTasks, projects, targetDate }) {
  const quarterProjects = await _quarterProjects(app, scope, { includeGuide: !projects });
  const sourceProjects = projects || quarterProjects.projects;
  const evidencedProjects = sourceProjects.map(project => QuarterProject.from(project).detachedCopy());
  for (const project of evidencedProjects) project.setProgressEvidence(targetDate);
  return dayProjectGroups({ excludeIds, now: targetDate, openTasks, projects: evidencedProjects,
    storedRecords: quarterProjects.storedProjects });
}

// ----------------------------------------------------------------------------------------------
// @desc A Goal Coach card for one ranked candidate. Rating follows list order so the widget's sort keeps it. An idea's
//   card is not existing and has no task UUID; it names its idea, which accepting it turns into a task.
// @param {object} task - Ranked candidate.
// @param {number} rating - Display rating from 1 to 10.
// @returns {object} Dream-task suggestion.
function _dreamTask(task, rating) {
  const isExisting = task.isExisting !== false && !task.ideaId;
  return { candidateId: task.candidateId || null, explanation: task.rationale, ideaId: task.ideaId || null, isExisting,
    projectUuid: task.projectUuid, rating, title: task.taskText, uuid: isExisting ? task.taskUuid : null };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the quarter's live projects joined to the project task store, tolerating a missing or unreadable guide
//   or store: either one failing leaves the other to supply what it can.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope.
// @param {object} options - { includeGuide }: false when the caller supplies its own live projects.
// @returns {Promise<object>} { projects, storedProjects }, as QuarterProjectRepository#readMany returns them.
async function _quarterProjects(app, scope, { includeGuide }) {
  let guide = null;
  if (includeGuide) {
    try {
      guide = await readVisionGuide(app, scope);
    } catch (error) {
      logIfEnabled(`${ SUGGESTION_LOG_LABEL } vision guide unavailable`, error?.message);
    }
  }
  try {
    return await new QuarterProjectRepository({ app }).readMany(scope, { guide });
  } catch (error) {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } project task store unavailable`, error?.message);
    const projects = quarterlyProgressProjects({ guide, previousProjects: [], quarterlyContent: "", scope });
    return { projects, storedProjects: [] };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Append the shown task UUIDs and idea IDs to each project's suggestion log. A write failure does not drop the
//   suggestion.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope.
// @param {Array<object>} shown - Tasks, ideas, or activities just returned to the user.
// @param {Date} targetDate - When they were shown.
// @returns {Promise<void>}
async function _recordShown(app, scope, shown, targetDate) {
  const identified = (shown || []).filter(item => item.projectUuid && (item.taskUuid || item.uuid || item.ideaId));
  const suggestions = identified.map(item => ({ ideaId: item.ideaId || null, projectUuid: item.projectUuid,
    summary: item.summary || null, taskUuid: item.taskUuid || item.uuid || null }));
  if (!suggestions.length) return;
  try {
    await new QuarterProjectRepository({ app }).recordShownTasks(scope, { shownAt: targetDate.toISOString(), suggestions });
  } catch (error) {
    logIfEnabled(`${ SUGGESTION_LOG_LABEL } could not record suggestions`, error?.message);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter that contains the day being planned, for the caller's task domain.
// @param {string|null} domainName - Task domain name.
// @param {string|null} domainUuid - Task domain UUID.
// @param {Date} targetDate - The day being planned.
// @returns {object} Resolved plan scope.
function _scopeFor(domainName, domainUuid, targetDate) {
  return resolvePlanScope({ date: targetDate, domainName: domainUuid ? domainName : (domainName || "All Notes"),
    domainUuid: domainUuid || null, quarter: Math.floor(targetDate.getMonth() / 3) + 1, year: targetDate.getFullYear() });
}
