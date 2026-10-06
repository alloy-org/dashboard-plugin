// Advance the quarterly project task store in the background, after the dashboard has finished loading every
// component. While any project has gone unrefreshed past the staleness window the pass walks all of them, oldest
// first; once none has, one load refreshes the oldest project and keeps going until its time budget is spent, so
// the store stays current without ever competing with the dashboard's own load for bandwidth. With a Jev Access
// Token, or with Ample Agent Pro installed, Jev's ratings decide which unassociated tasks a project takes on, and
// the generative provider is left to suggest ideas. With only a provider key, that provider attributes tasks too.
// Each pass compares the tasks it reads with the domain's task snapshot, so a ranking also rates older tasks edited
// since the project's last complete ranking, which the ranker's creation-time cutoff would otherwise pass over.
import DashboardTaskSnapshotStore from "dashboard/work-queue/dashboard-task-snapshot-store";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { readVisionGuide } from "plan-wizard/vision-guide-repository";
import { applyCollectedTaskResult, associationResult, generatedIdeas, ideaCandidateTasks, projectIntentTexts,
  projectTaskMatches, reconciledTaskSnapshot, similarityChanges, withGeneratedIdeas } from "project-collection-steps";
import { projectsToRefresh, shouldRefreshAnotherProject } from "project-refresh-schedule";
import { generateProjectTaskIdeas } from "project-task-ideas";
import QuarterProjectRepository from "quarter-project-repository";
import { recentTaskDestinationNotes } from "task-destination-notes";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { logIfEnabled } from "util/log";

const COLLECTION_LOG_LABEL = "[project-task-collection]";

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
//   - {function} [rankerFactory=prepareProjectTaskRanker] - Injected for tests; resolves to null when neither Jev nor a
//     generative provider can rate
//   - {function} [shouldContinue=() => true] - Consulted before each project so an unmounting dashboard can stop
//   - {DashboardTaskSnapshotStore|null} [taskSnapshotStore] - Injected for tests; null ranks without change tracking
// @returns {Promise<object>} An object with the following properties:
//   - {number} attempted - Projects refreshed and written
//   - {number} failures - Projects whose refresh threw
//   - {string} regimeEm - Which regime selected the projects, "catchUp" or "cycle"
//   - {number} skipped - Projects the pass did not reach
export async function collectProjectTasks(app, { domainName, domainUuid, elapsedMilliseconds = _elapsedSince(Date.now()),
    ideaGenerator = generateProjectTaskIdeas, now = new Date(), quarterlyContent, rankerFactory = prepareProjectTaskRanker,
    shouldContinue = () => true, taskSnapshotStore = new DashboardTaskSnapshotStore({ app }) }) {
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: Math.floor(now.getMonth() / 3) + 1,
    year: now.getFullYear() });
  const guide = await readVisionGuide(app, scope).catch(error => {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } guide unavailable, using quarterly plan alone`, error?.message);
    return null;
  });
  const repository = new QuarterProjectRepository({ app });
  const { projects, storedProjects } = await repository.readMany(scope, { guide, includeInactive: true, quarterlyContent });
  const recordsByUuid = new Map(storedProjects.map(project => [project.uuid, project]));
  if (!projects.length) return { attempted: 0, failures: 0, regimeEm: "catchUp", skipped: 0 };
  const { orderedProjects, regimeEm } = projectsToRefresh({ now, projects, recordsByUuid });
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass starting`, { candidateCount: orderedProjects.length,
    projectCount: projects.length, regimeEm });
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for project association");
  const ranker = await _passRanker(app, { domainName, domainUuid, now, projects: orderedProjects, rankerFactory, tasks });
  const taskSnapshot = ranker ? await reconciledTaskSnapshot(taskSnapshotStore, { domainUuid, tasks }) : null;
  const destinationNotes = await recentTaskDestinationNotes(app, { domainUuid, now });
  let attempted = 0;
  let failures = 0;
  for (const project of orderedProjects) {
    if (!shouldContinue()) break;
    if (!shouldRefreshAnotherProject({ elapsedMilliseconds: elapsedMilliseconds(), refreshedCount: attempted, regimeEm })) break;
    try {
      const result = await _collectedTaskResult(app, { destinationNotes, ideaGenerator,
        intentTexts: projectIntentTexts(guide, project), now, project, quarterlyContent, ranker,
        stored: recordsByUuid.get(project.uuid), tasks, taskSnapshot });
      await repository.applyResult(scope, { apply: target => applyCollectedTaskResult(target, result),
        sourceProject: project });
      attempted += 1;
    } catch (error) {
      failures += 1;
      logIfEnabled(`${ COLLECTION_LOG_LABEL } project failed`, { error: error?.message, project: project.summary });
    }
  }
  const retired = storedProjects.filter(record => record.isActive && !projects.some(project => project.uuid === record.uuid));
  for (const record of retired) {
    if (!shouldContinue()) break;
    try {
      await repository.applyResult(scope, { apply: project => project.setActive(false), projectUuid: record.uuid,
        summary: record.summary });
    } catch (error) {
      logIfEnabled(`${ COLLECTION_LOG_LABEL } could not retire project`, error?.message);
    }
  }
  logIfEnabled(`${ COLLECTION_LOG_LABEL } pass complete`, { attempted, failures, regimeEm, retired: retired.length });
  return { attempted, failures, regimeEm, skipped: projects.length - attempted };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve one project's lists: the open tasks that match it locally, the tasks the provider attributes to
//   it that the local match missed, the completions moved out of that list, and the merged ideas. Unlike the
//   earlier ideas-only pass, the provider is consulted on every refresh, because finding scattered tasks is
//   work the local name match cannot do and a project holding usable ideas still accumulates new tasks.
//
//   When Jev ranked the project, the tasks it accepted join the project before the provider is asked for ideas, and
//   the provider is offered no pool to attribute from, so a task is never claimed twice by two judges. A ranking that
//   failed outright leaves the provider's pool in place, as though no Jev key were set, and keeps the project's stored
//   similarity hash for the next pass.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { destinationNotes, ideaGenerator, intentTexts, now, project, quarterlyContent, ranker, stored,
//   tasks, taskSnapshot }; destinationNotes are the notes an idea may be created in, as { name, uuid }; intentTexts are
//   those of the intents the project advances; project and stored are QuarterProjects,
//   stored undefined for a project the store has never held. project is the pass's own copy and is updated in place, so
//   the idea prompt sees the tasks already associated. taskSnapshot is the domain's reconciled DashboardTaskSnapshot, or
//   null when it could not be read or saved.
// @returns {Promise<object>} The result applyCollectedTaskResult writes.
async function _collectedTaskResult(app, { destinationNotes, ideaGenerator, intentTexts, now, project, quarterlyContent, ranker,
    stored, tasks, taskSnapshot }) {
  const matches = projectTaskMatches(project, tasks);
  const storedRatings = stored?.taskSimilarityScores || project.taskSimilarityScores;
  const { changedTaskRecords, watermark } = similarityChanges(taskSnapshot, { project, stored, tasks });
  const ranking = ranker ? await ranker.rankProject(project, matches.matchedTaskRecords, { changedTaskRecords, storedRatings })
    .catch(error => ({ failureReason: error?.message || "Jev ranking failed" })) : null;
  if (ranking?.failureReason) {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } Jev ranking failed`, { project: project.summary, reason: ranking.failureReason });
  }
  const { rankedTaskRecords, result } = associationResult({ matches, now, project, ranking, scorerEm: ranker?.scorerEm, stored, watermark });
  applyCollectedTaskResult(project, result);
  project.setCandidateTasks(ideaCandidateTasks(tasks, { offerPool: !rankedTaskRecords,
    relatedTaskRecords: matches.matchedTaskRecords }));
  const ideas = await generatedIdeas(app, { destinationNotes, ideaGenerator, intentTexts, keptIdeas: result.suggestedTasks,
    now, project, quarterlyContent });
  return withGeneratedIdeas(result, ideas);
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
// @desc Prepare the pass's task ranker, refreshing the dictionary from the projects about to be walked. The pass runs
//   in the background, so nobody is waiting on the dictionary's provider call. The ranker rates with Jev, or with
//   the fast model when no Jev key is set. A failure is logged and the pass goes on without ranking, attributing
//   tasks through the generative provider's idea prompt as it would with nothing to rate.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, domainUuid, now, projects, rankerFactory, tasks }.
// @returns {Promise<object|null>} The ranker, or null when there is none to use.
async function _passRanker(app, { domainName, domainUuid, now, projects, rankerFactory, tasks }) {
  try {
    return await rankerFactory(app, { domainName, domainUuid, now, projects, refineDictionary: true, tasks });
  } catch (error) {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } task ranking unavailable this pass`, error?.message);
    return null;
  }
}
