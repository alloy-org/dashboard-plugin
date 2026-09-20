// Advance the quarterly project task store in the background, after the dashboard has finished loading every
// component. One pass walks each project whose associations have gone stale, oldest attempt first, so the store
// fills in over time without ever competing with the dashboard's own load for bandwidth.
import { resolvePlanScope } from "plan-wizard/plan-models";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { projectMatchesTask, quarterlyProgressProjects } from "project-progress-model";
import { generateProjectTaskIdeas } from "project-task-ideas";
import { openProjectTaskStore, storedProjectRecords, writeProjectSection } from "project-task-store";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const COLLECTION_LOG_LABEL = "[project-task-collection]";
// A project whose associations were refreshed within this window is left alone, so a user opening the dashboard
// several times in one day does not spend a provider call per project per load.
export const PROJECT_STALENESS_HOURS = 20;

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a project is due for another association attempt.
// @param {object} record - Stored project record, or undefined when the project is new to the store.
// @param {Date} now - Current time.
// @returns {boolean} True when the project has never been attempted or its last attempt has aged out.
export function projectNeedsAttempt(record, now) {
  if (!record?.lastAttemptedAt) return true;
  const lastAttempt = dateFromDateInput(record.lastAttemptedAt, { throwOnInvalid: false });
  if (!lastAttempt) return true;
  return now.getTime() - lastAttempt.getTime() >= PROJECT_STALENESS_HOURS * 60 * 60 * 1000;
}

// ----------------------------------------------------------------------------------------------
// @desc Run one background collection pass over every stale project in a quarter, serially. Each project is
//   written as soon as it is resolved, so a pass interrupted partway (the user closing the dashboard) still
//   leaves every project it finished durably stored.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {string|null} quarterlyContent - The quarterly plan note's markdown
//   - {Date} [now=new Date()] - Injected for tests
//   - {function} [ideaGenerator=generateProjectTaskIdeas] - Injected for tests
//   - {function} [shouldContinue=() => true] - Consulted before each project so an unmounting dashboard can stop
// @returns {Promise<object>} { attempted, failures, skipped } counts describing the pass.
export async function collectProjectTasks(app, { domainName, domainUuid, ideaGenerator = generateProjectTaskIdeas,
    now = new Date(), quarterlyContent, shouldContinue = () => true }) {
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
  if (!projects.length) return { attempted: 0, failures: 0, skipped: 0 };
  const staleProjects = projects.filter(project => projectNeedsAttempt(recordsByUuid.get(project.uuid), now));
  const orderedProjects = _oldestAttemptFirst(staleProjects, recordsByUuid);
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass starting`, { projectCount: projects.length, staleCount: orderedProjects.length });
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project association");
  let content = store.content;
  let attempted = 0;
  let failures = 0;
  for (const project of orderedProjects) {
    if (!shouldContinue()) break;
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
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass complete`, { attempted, failures, retired: retired.length });
  return { attempted, failures, skipped: projects.length - orderedProjects.length };
}

// ----------------------------------------------------------------------------------------------
// @desc Order stale projects so the least recently attempted is advanced first, which keeps a pass that is
//   cut short from repeatedly refreshing the same few projects while others are never reached.
// @param {Array<object>} staleProjects - Projects due for an attempt.
// @param {Map<string, object>} recordsByUuid - Stored records keyed by project UUID.
// @returns {Array<object>} Projects, never-attempted ones first, then oldest attempt first.
function _oldestAttemptFirst(staleProjects, recordsByUuid) {
  const withAttemptTime = staleProjects.map(project => {
    const storedAttempt = recordsByUuid.get(project.uuid)?.lastAttemptedAt;
    const attemptDate = storedAttempt ? dateFromDateInput(storedAttempt, { throwOnInvalid: false }) : null;
    return { attemptedAt: attemptDate ? attemptDate.getTime() : 0, project };
  });
  const sortedByAttempt = withAttemptTime.sort((left, right) => left.attemptedAt - right.attemptedAt);
  return sortedByAttempt.map(entry => entry.project);
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve one project's three lists: the open tasks that match it, the completions moved out of that
//   list, and the generated ideas. Ideas are only regenerated when the project has none left after pruning,
//   so a project holding usable suggestions costs an association refresh but no provider call.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { ideaGenerator, now, project, quarterlyContent, stored, tasks }.
// @returns {Promise<object>} Project record ready to be written to the store.
async function _projectWithCollectedTasks(app, { ideaGenerator, now, project, quarterlyContent, stored, tasks }) {
  const matchingTasks = tasks.filter(task => task.uuid && projectMatchesTask(project, task));
  const openTasks = matchingTasks.filter(task => !task.completedAt && !task.dismissedAt);
  const relatedTaskRecords = openTasks.map(task => ({ taskText: task.content || "", taskUuid: task.uuid }));
  const completedTasks = _completedTaskRecords(matchingTasks, stored);
  const openTaskTexts = new Set(relatedTaskRecords.map(task => (task.taskText || "").trim().toLowerCase()));
  const keptIdeas = (stored?.suggestedTasks || []).filter(idea => !openTaskTexts.has((idea.taskText || "").trim().toLowerCase()));
  const base = { ...project, completedTasks, lastAttemptedAt: now.toISOString(), relatedTaskRecords,
    relatedTasks: [...new Set([...(project.relatedTasks || []), ...matchingTasks.map(task => task.uuid)])],
    suggestedTasks: keptIdeas };
  if (keptIdeas.length) return base;
  const { suggestedTasks } = await ideaGenerator(app, { project: base, quarterlyContext: quarterlyContent });
  if (!suggestedTasks.length) return base;
  return { ...base, lastSuggestedAt: now.toISOString(), suggestedTasks };
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
