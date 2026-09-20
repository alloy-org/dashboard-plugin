// Advance the quarterly project task store in the background, after the dashboard has finished loading every
// component. While any project has gone unrefreshed past the staleness window the pass walks all of them, oldest
// first; once none has, one load refreshes the oldest project and keeps going until its time budget is spent, so
// the store stays current without ever competing with the dashboard's own load for bandwidth.
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { projectMatchesTask, quarterlyProgressProjects } from "project-progress-model";
import { projectsToRefresh, shouldRefreshAnotherProject } from "project-refresh-schedule";
import { generateProjectTaskIdeas } from "project-task-ideas";
import { openProjectTaskStore, storedProjectRecords, writeProjectSection } from "project-task-store";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const COLLECTION_LOG_LABEL = "[project-task-collection]";
// How many unassociated open tasks one project's prompt may cite. The pool exists so the model can attribute a
// task the local name match missed; sending the user's whole backlog would crowd out the project's own context.
const MAXIMUM_CANDIDATE_TASKS = 40;

// ----------------------------------------------------------------------------------------------
// @desc Run one background refresh pass over a quarter's projects, serially. Each project is written as soon as
//   it is resolved, so a pass interrupted partway (the user closing the dashboard, or the time budget running
//   out) still leaves every project it finished durably stored.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {string|null} quarterlyContent - The quarterly plan note's markdown
//   - {Date} [now=new Date()] - Injected for tests
//   - {function} [elapsedMilliseconds] - Injected for tests; how long the pass has spent refreshing
//   - {function} [ideaGenerator=generateProjectTaskIdeas] - Injected for tests
//   - {function} [shouldContinue=() => true] - Consulted before each project so an unmounting dashboard can stop
// @returns {Promise<object>} An object with the following properties:
//   - {number} attempted - Projects refreshed and written
//   - {number} failures - Projects whose refresh threw
//   - {string} regimeEm - Which regime selected the projects, "catchUp" or "cycle"
//   - {number} skipped - Projects the pass did not reach
export async function collectProjectTasks(app, { domainName, domainUuid, elapsedMilliseconds = _elapsedSince(Date.now()),
    ideaGenerator = generateProjectTaskIdeas, now = new Date(), quarterlyContent, shouldContinue = () => true }) {
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: Math.floor(now.getMonth() / 3) + 1,
    year: now.getFullYear() });
  const guide = await readVisionGuide(app, scope).catch(error => {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } guide unavailable, using quarterly plan alone`, error?.message);
    return null;
  });
  const store = await openProjectTaskStore(app, scope);
  const { recordsByUuid, unreadableHeadings } = storedProjectRecords(store.content);
  if (unreadableHeadings.length) logIfEnabled(`${ COLLECTION_LOG_LABEL } unreadable sections`, unreadableHeadings);
  const previousProjects = [...recordsByUuid.values()];
  const projects = quarterlyProgressProjects({ guide, previousProjects, quarterlyContent, scope });
  if (!projects.length) return { attempted: 0, failures: 0, regimeEm: "catchUp", skipped: 0 };
  const { orderedProjects, regimeEm } = projectsToRefresh({ now, projects, recordsByUuid });
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass starting`, { candidateCount: orderedProjects.length,
    projectCount: projects.length, regimeEm });
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project association");
  let content = store.content;
  let attempted = 0;
  let failures = 0;
  for (const project of orderedProjects) {
    if (!shouldContinue()) break;
    if (!shouldRefreshAnotherProject({ elapsedMilliseconds: elapsedMilliseconds(), refreshedCount: attempted, regimeEm })) break;
    try {
      const resolved = await _projectWithCollectedTasks(app, { ideaGenerator, now, project,
        quarterlyContent, stored: recordsByUuid.get(project.uuid), tasks });
      content = await writeProjectSection(app, { content, isActive: true, noteHandle: store.noteHandle, project: resolved });
      attempted += 1;
    } catch (error) {
      failures += 1;
      logIfEnabled(`${ COLLECTION_LOG_LABEL } project failed`, { error: error?.message, project: project.summary });
    }
  }
  const retired = previousProjects.filter(record => record.isActive && !projects.some(project => project.uuid === record.uuid));
  for (const record of retired) {
    if (!shouldContinue()) break;
    try { content = await writeProjectSection(app, { content, isActive: false, noteHandle: store.noteHandle, project: record }); }
    catch (error) { logIfEnabled(`${ COLLECTION_LOG_LABEL } could not retire project`, error?.message); }
  }
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass complete`, { attempted, failures, regimeEm, retired: retired.length });
  return { attempted, failures, regimeEm, skipped: projects.length - attempted };
}

// ----------------------------------------------------------------------------------------------
// @desc Offer the model the open tasks that were not matched to this project locally, so it can attribute one
//   whose wording never names the project. Tasks already associated are left out, and the pool is capped at the
//   most recently touched candidates so a large backlog cannot crowd the project's own context out of a prompt.
// @param {object} project - Project the prompt is being built for.
// @param {Array<object>} tasks - Every task read for this pass.
// @param {Array<object>} relatedTaskRecords - The project's locally matched open tasks.
// @returns {Array<object>} Candidate tasks as { taskText, taskUuid }.
function _candidateTaskRecords(project, tasks, relatedTaskRecords) {
  const associatedUuids = new Set(relatedTaskRecords.map(task => task.taskUuid));
  const openTasks = tasks.filter(task => task.uuid && !task.completedAt && !task.dismissedAt
    && !associatedUuids.has(task.uuid) && (task.content || "").trim());
  const recentFirst = openTasks.sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  const cappedTasks = recentFirst.slice(0, MAXIMUM_CANDIDATE_TASKS);
  return cappedTasks.map(task => ({ taskText: task.content, taskUuid: task.uuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Move completions into their own list without discarding evidence of a completion that has since
//   aged out of what the task API returns, which is what keeps a project's history from shrinking over a
//   quarter. A task that was reopened or dismissed stops counting as a completion.
// @param {Array<object>} matchingTasks - Tasks matched to this project on this pass.
// @param {object|undefined} stored - The project's previously stored record.
// @returns {Array<object>} Completion records as { completedAt, taskUuid }.
function _completedTaskRecords(matchingTasks, stored) {
  const completedByUuid = new Map((stored?.completedTasks || []).map(task => [task.taskUuid, task]));
  for (const task of matchingTasks) {
    if (task.completedAt && !task.dismissedAt) {
      const completedDate = dateFromDateInput(task.completedAt, { throwOnInvalid: false });
      if (completedDate) completedByUuid.set(task.uuid, { completedAt: completedDate.toISOString(), taskUuid: task.uuid });
    } else completedByUuid.delete(task.uuid);
  }
  return [...completedByUuid.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Build the clock the pass measures its budget against, as a function so tests can hand the pass a clock
//   they control rather than waiting out a real twenty seconds.
// @param {number} startedAt - Epoch milliseconds the pass began refreshing.
// @returns {function} Returns milliseconds elapsed since the pass began.
function _elapsedSince(startedAt) {
  return () => Date.now() - startedAt;
}

// ----------------------------------------------------------------------------------------------
// @desc Fold the model's returned ideas into the ones the project already holds. An idea naming an earlier one
//   in `beforeTask` replaces it at its original position, so a refinement reads as the same suggestion improved
//   rather than as a second nearly-identical entry the user has to judge twice.
// @param {Array<object>} keptIdeas - Ideas the project holds after pruning ones that became open tasks.
// @param {Array<object>} returnedIdeas - Ideas from the provider as { beforeTask, generatedAt, taskText }.
// @returns {Array<object>} Merged ideas as { generatedAt, taskText }.
function _mergedSuggestedTasks(keptIdeas, returnedIdeas) {
  const mergedIdeas = keptIdeas.map(idea => ({ generatedAt: idea.generatedAt, taskText: idea.taskText }));
  for (const returned of returnedIdeas) {
    const newIdea = { generatedAt: returned.generatedAt, taskText: returned.taskText };
    const supersededIndex = returned.beforeTask
      ? mergedIdeas.findIndex(idea => idea.taskText === returned.beforeTask) : -1;
    if (supersededIndex >= 0) mergedIdeas[supersededIndex] = newIdea;
    else mergedIdeas.push(newIdea);
  }
  return mergedIdeas;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve one project's lists: the open tasks that match it locally, the tasks the provider attributes to
//   it that the local match missed, the completions moved out of that list, and the merged ideas. Unlike the
//   earlier ideas-only pass, the provider is consulted on every refresh, because finding scattered tasks is
//   work the local name match cannot do and a project holding usable ideas still accumulates new tasks.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { ideaGenerator, now, project, quarterlyContent, stored, tasks }.
// @returns {Promise<object>} Project record ready to be written to the store.
async function _projectWithCollectedTasks(app, { ideaGenerator, now, project, quarterlyContent, stored, tasks }) {
  const matchingTasks = tasks.filter(task => task.uuid && projectMatchesTask(project, task));
  const openTasks = matchingTasks.filter(task => !task.completedAt && !task.dismissedAt);
  const matchedTaskRecords = openTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  const completedTasks = _completedTaskRecords(matchingTasks, stored);
  const openTaskTexts = new Set(matchedTaskRecords.map(task => (task.taskText || "").trim().toLowerCase()));
  const keptIdeas = (stored?.suggestedTasks || []).filter(idea => !openTaskTexts.has((idea.taskText || "").trim().toLowerCase()));
  const candidateTaskRecords = _candidateTaskRecords(project, tasks, matchedTaskRecords);
  const base = { ...project, candidateTaskRecords, completedTasks, lastAttemptedAt: now.toISOString(),
    relatedTaskRecords: matchedTaskRecords, relatedTasks: [...new Set([...(project.relatedTasks || []),
      ...matchingTasks.map(task => task.uuid)])], suggestedTasks: keptIdeas };
  const { foundTasks, suggestedTasks } = await ideaGenerator(app, { project: base, quarterlyContext: quarterlyContent });
  const relatedTaskRecords = [...matchedTaskRecords, ...(foundTasks || [])];
  const mergedIdeas = _mergedSuggestedTasks(keptIdeas, suggestedTasks || []);
  const refreshed = { ...base, relatedTaskRecords, relatedTasks: [...new Set([...base.relatedTasks,
    ...(foundTasks || []).map(task => task.taskUuid)])], suggestedTasks: mergedIdeas };
  if (mergedIdeas.length > keptIdeas.length) refreshed.lastSuggestedAt = now.toISOString();
  return refreshed;
}
