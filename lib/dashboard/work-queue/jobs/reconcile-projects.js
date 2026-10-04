// The queued job that starts a quarter's project maintenance. It brings the project task store into line with the live
// plan: a project the plan holds but the store does not is written, so it keeps one UUID from then on (a project drawn
// only from the quarterly plan note is otherwise given a new one on every read), and a stored project that has left
// the plan moves beneath "Past projects", as the background collection pass does. With a rater, it then reads the
// domain's tasks into the task snapshot so changes since each project's last ranking can be found, checks whether
// the terms dictionary has projects to examine, and records which definitions changed, counting for each project the
// open tasks that mention a term changed since its last ranking. Finally it asks the planner which projects are due
// and returns their dictionary, ranking, and ideas jobs as follow-up work.
import { reconciledTaskSnapshot } from "dashboard/project-collection-steps";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import DashboardTaskSnapshotStore from "dashboard/work-queue/dashboard-task-snapshot-store";
import { jobPriorityContext, readProjectJobInputs, readProjectJobTasks, validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { RECONCILE_PROJECTS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { unexaminedDictionaryProjects } from "plan-wizard/stack-rank/build-project-task-context";
import { storedDictionaryTermRevisions, termChangedTaskRecords, termsChangedSince } from "plan-wizard/stack-rank/dictionary-term-revisions";
import { guideProspects, unscoredCitedTaskRecords } from "plan-wizard/stack-rank/cited-task-records";
import { projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { logIfEnabled } from "util/log";

export { RECONCILE_PROJECTS_JOB_TYPE };
const RECONCILE_LOG_LABEL = "[reconcile-projects]";

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, quarter, year }; each request names a new
//   revision, so every reconciliation runs.
// @param {object} options - An object with the following properties:
//   - {QuarterProjectWorkPlanner} planner - Decides the follow-up jobs and keeps the visit's coverage
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
//   - {function} [taskScorer=projectTaskScorer] - (app) => "jev", "generative", or null when nothing can rate
//   - {function} [taskSnapshotStoreFactory] - (app) => DashboardTaskSnapshotStore, or null to plan without change tracking
//   - {function} [termRevisionsReader=storedDictionaryTermRevisions] - (app, { year }) => the term revisions record after
//     recording the dictionary's changes, or null when the year has no dictionary
//   - {function} [unexaminedProjectReader=unexaminedDictionaryProjects] - (app, { now, projects }) => the projects the
//     terms dictionary has not examined
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createReconcileProjectsHandler({ planner, quarterlyContentReader,
  repositoryFactory = app => new QuarterProjectRepository({ app }), taskScorer = projectTaskScorer,
  taskSnapshotStoreFactory = app => new DashboardTaskSnapshotStore({ app }), termRevisionsReader = storedDictionaryTermRevisions,
  unexaminedProjectReader = unexaminedDictionaryProjects }) {
  const dependencies = { planner, quarterlyContentReader, repositoryFactory, taskScorer, taskSnapshotStoreFactory,
    termRevisionsReader, unexaminedProjectReader };
  return {
    run: ({ context, job, signal }) => _reconciliationAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: RECONCILE_PROJECTS_JOB_TYPE,
    validateInput: input => validateProjectJobInput(input, { requireProject: false }),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Write each live project the store does not hold, and retire each stored active project the plan no longer
//   holds. A project that cannot be written is logged and left for the next reconciliation.
// @param {QuarterProjectRepository} repository - Writes the project task store.
// @param {object} options - { projects, scope, storedProjects }.
// @returns {Promise<boolean>} Whether anything was written.
async function _alignedStore(repository, { projects, scope, storedProjects }) {
  const storedUuids = new Set(storedProjects.map(project => project.uuid));
  const liveUuids = new Set(projects.map(project => project.uuid));
  const unstoredProjects = projects.filter(project => !storedUuids.has(project.uuid));
  const departedProjects = storedProjects.filter(project => project.isActive && !liveUuids.has(project.uuid));
  const writes = [
    ...unstoredProjects.map(project => ({ apply: target => target.setActive(true), sourceProject: project })),
    ...departedProjects.map(project => ({ apply: target => target.setActive(false), projectUuid: project.uuid,
      summary: project.summary })),
  ];
  for (const write of writes) {
    await repository.applyResult(scope, write)
      .catch(error => logIfEnabled(`${ RECONCILE_LOG_LABEL } could not write project`, error?.message));
  }
  return writes.length > 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether the terms dictionary has projects to examine. A dictionary that cannot be read counts as having some,
//   since the discovery job that then runs submits any rankings it holds even when it fails.
// @param {function} unexaminedProjectReader - (app, { now, projects }) => the unexamined projects.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { now, projects }.
// @returns {Promise<boolean>} True when discovery has projects to send.
async function _dictionaryDiscoveryDue(unexaminedProjectReader, app, { now, projects }) {
  try {
    const unexaminedProjects = await unexaminedProjectReader(app, { now, projects });
    return unexaminedProjects.length > 0;
  } catch (error) {
    logIfEnabled(`${ RECONCILE_LOG_LABEL } could not read the terms dictionary`, error?.message);
    return true;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Count, for each ranked project, the open tasks that mention a term whose definition changed since its last
//   complete ranking, which its next ranking rates again. Revisions that cannot be read or saved count none, so the
//   changes wait for a later reconciliation rather than holding up this one.
// @param {function|null} termRevisionsReader - (app, { year }) => the term revisions record, or null.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { now, projects, storedProjects, tasks }.
// @returns {Promise<Map<string, number>>} Counts by project UUID, leaving out projects with none.
async function _termChangedCounts(termRevisionsReader, app, { now, projects, storedProjects, tasks }) {
  const counts = new Map();
  let revisions = null;
  try {
    revisions = termRevisionsReader ? await termRevisionsReader(app, { year: now.getFullYear() }) : null;
  } catch (error) {
    logIfEnabled(`${ RECONCILE_LOG_LABEL } could not record term revisions`, error?.message);
  }
  if (!revisions) return counts;
  for (const project of projects) {
    const stored = storedProjects.find(candidate => candidate.uuid === project.uuid);
    if (!stored?.lastRankedAt) continue;
    const changedTerms = termsChangedSince(revisions, stored.refreshState.similarity?.dictionaryPosition);
    const records = termChangedTaskRecords(tasks, changedTerms);
    if (records.length) counts.set(project.uuid, records.length);
  }
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Count, for each project, the cited tasks the sources page shows that have no score yet.
// @param {object|null} guide - The quarter's Vision Guide.
// @param {object} options - { projects, scope, storedProjects, tasks }.
// @returns {Map<string, number>} Counts by project UUID, leaving out projects with none.
function _unscoredCitedCounts(guide, { projects, scope, storedProjects, tasks }) {
  const prospects = guideProspects(guide);
  const counts = new Map();
  if (!prospects.length) return counts;
  for (const project of projects) {
    const stored = storedProjects.find(candidate => candidate.uuid === project.uuid);
    const records = unscoredCitedTaskRecords(prospects, { project: stored, projectUuid: project.uuid,
      quarterKey: scope.quarterKey, tasks });
    if (records.length) counts.set(project.uuid, records.length);
  }
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Run one reconciliation: align the store with the live plan, read the domain's tasks fresh, bring the task
//   snapshot up to date and check the terms dictionary and its changed definitions when a rater exists, and plan the
//   quarter's maintenance.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { followUps }, or { status: "superseded" } when the scheduler cancelled the attempt.
async function _reconciliationAttempt({ context, dependencies, job, signal }) {
  const { app } = context;
  const repository = dependencies.repositoryFactory(app);
  const inputs = await readProjectJobInputs(app, job.input, { quarterlyContentReader: dependencies.quarterlyContentReader,
    repository });
  const { guide, projects, scope } = inputs;
  const wrote = await _alignedStore(repository, { projects, scope, storedProjects: inputs.storedProjects });
  const storedProjects = wrote ? await repository.readStored(scope, { includeInactive: true }) : inputs.storedProjects;
  if (signal?.aborted) return { status: "superseded" };
  const scorerEm = projects.length ? await dependencies.taskScorer(app) : null;
  const tasks = projects.length ? await readProjectJobTasks(context, { domainUuid: job.input.domainUuid, fresh: true, signal }) : [];
  const taskSnapshotStore = scorerEm && dependencies.taskSnapshotStoreFactory ? dependencies.taskSnapshotStoreFactory(app) : null;
  const taskSnapshot = await reconciledTaskSnapshot(taskSnapshotStore, { domainUuid: job.input.domainUuid, tasks });
  const unscoredCitedCounts = scorerEm ? _unscoredCitedCounts(guide, { projects, scope, storedProjects, tasks }) : new Map();
  const now = new Date(context.clock());
  const dictionaryDiscoveryDue = scorerEm ? await _dictionaryDiscoveryDue(dependencies.unexaminedProjectReader, app,
    { now, projects }) : false;
  const termChangedCounts = scorerEm ? await _termChangedCounts(dependencies.termRevisionsReader, app,
    { now, projects, storedProjects, tasks }) : new Map();
  const followUps = dependencies.planner.plan({ dictionaryDiscoveryDue, input: job.input, now, projects, scopeKey: job.scopeKey,
    scorerEm, storedProjects, taskWatermark: taskSnapshot ? taskSnapshot.watermark() : null, termChangedCounts,
    unscoredCitedCounts });
  logIfEnabled(`${ RECONCILE_LOG_LABEL } planned`, { coverage: dependencies.planner.coverage(job.scopeKey), dictionaryDiscoveryDue,
    projectCount: projects.length, requestCount: followUps.length, scorerEm, termChangedProjectCount: termChangedCounts.size });
  return { followUps };
}
