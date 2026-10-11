// The queued job that records which quarterly project each task completed in the past week advanced, in the archived
// "Completed Tasks by Project" ledger of the quarter the task was completed in, so a week that spans two quarters
// writes to both. Tasks the ledger already holds are skipped. A task linked to exactly one project is recorded
// without asking anyone; the rest are asked of the DecisionsEndpoint in batches, against each project's summary, goals,
// and most similar open tasks and the terms dictionary. Only a decision model is asked: with none configured, linked
// tasks are still recorded and the rest wait for a later run. Each batch is written as soon as it is answered, so an
// attempt that fails partway keeps what it learned and the retry asks only about the tasks still missing. A quarter
// whose ledger holds project tasks not yet rated for potential is handed to the potential scoring job as a follow-up.
import { classificationBatches, classificationQuestions, classificationState, classifiedEntries, CLASSIFIED_BY,
  completedTaskEntry, linkedProject, projectChoices } from "dashboard/projects/completed-task-project-classification";
import { unscoredProjectEntries } from "dashboard/projects/completed-task-potential";
import { ledgerEntryKey, readCompletedTaskLedger } from "dashboard/projects/completed-task-project-ledger";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { activeQuarterProjects, dictionaryDefinitions, jobDecisionsEndpoint, jobRead,
  recordLedgerEntries } from "dashboard/work-queue/jobs/completed-task-job-steps";
import { jobPriorityContext, projectJobScope, validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { CLASSIFY_COMPLETED_TASKS_JOB_TYPE, completedTaskPotentialRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

export { CLASSIFY_COMPLETED_TASKS_JOB_TYPE };
// How many days of completions each run looks back over, today included.
export const CLASSIFICATION_WINDOW_DAYS = 7;
const CLASSIFY_LOG_LABEL = "[classify-completed-tasks]";

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, quarter, year }, naming the Dashboard's quarter;
//   the quarters actually written are the ones the past week's completions fall in.
// @param {object} [options] - An object with the following properties:
//   - {function} [dictionaryReader] - (app, year) => definitions keyed by term; injected for tests
//   - {function} [endpointFactory] - (app) => DecisionsEndpoint or null; decisionsEndpointForApp without the fast
//     model by default
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createClassifyCompletedTasksHandler({ dictionaryReader = dictionaryDefinitions,
  endpointFactory = app => decisionsEndpointForApp(app, { includeFastScore: false }), quarterlyContentReader,
  repositoryFactory = app => new QuarterProjectRepository({ app }) } = {}) {
  const dependencies = { dictionaryReader, endpointFactory, quarterlyContentReader, repositoryFactory };
  return {
    run: ({ context, job, signal }) => _classificationAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: CLASSIFY_COMPLETED_TASKS_JOB_TYPE,
    validateInput: input => validateProjectJobInput(input, { requireProject: false }),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Group completed tasks by the quarter they were completed in.
// @param {Array<object>} tasks - Completed tasks carrying completedAt.
// @returns {Array<object>} { quarter, tasks, year }, earliest quarter first.
export function completedTasksByQuarter(tasks) {
  const groupsByKey = new Map();
  for (const task of tasks) {
    const completedDate = dateFromDateInput(task.completedAt);
    const quarter = Math.floor(completedDate.getMonth() / 3) + 1;
    const year = completedDate.getFullYear();
    const key = `${ year }-${ quarter }`;
    if (!groupsByKey.has(key)) groupsByKey.set(key, { quarter, tasks: [], year });
    groupsByKey.get(key).tasks.push(task);
  }
  const groups = [...groupsByKey.values()];
  const chronologicalGroups = groups.sort((first, second) => first.year - second.year || first.quarter - second.quarter);
  return chronologicalGroups;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the past week's completions, then classify and record each quarter's unrecorded ones.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { classifiedCount, linkedCount, waitingCount }: tasks recorded by a model, tasks recorded
//   by their link, and tasks left for a later run, with followUps requesting a potential rating of each quarter holding
//   project tasks not yet rated; or { status: "superseded" } when the scheduler cancelled it.
// @throws When a classification request failed, after recording everything answered before it.
async function _classificationAttempt({ context, dependencies, job, signal }) {
  const now = new Date(context.clock());
  const tasks = await _completedTasksInWindow(context, { domainUuid: job.input.domainUuid, now, signal });
  const counts = { classifiedCount: 0, linkedCount: 0, waitingCount: 0 };
  const shared = { endpoint: undefined, terms: undefined };
  const followUps = [];
  for (const group of completedTasksByQuarter(tasks)) {
    if (signal?.aborted) return { status: "superseded" };
    const quarterInput = { ...job.input, quarter: group.quarter, year: group.year };
    const { potentialDue, ...quarterCounts } = await _classifiedQuarter({ context, dependencies, now, quarterInput, shared, signal,
      tasks: group.tasks });
    for (const key of Object.keys(counts)) counts[key] += quarterCounts[key];
    if (potentialDue) followUps.push(completedTaskPotentialRequest(quarterInput, { requestedAt: now.getTime() }));
  }
  logIfEnabled(`${ CLASSIFY_LOG_LABEL } classified`, { ...counts, completedCount: tasks.length, potentialQuarterCount: followUps.length });
  return followUps.length ? { ...counts, followUps } : counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Classify and record one quarter's completions that its ledger does not hold yet. A quarter with no active
//   projects records nothing, leaving its tasks for a run after its projects are known.
// @param {object} options - An object with the following properties:
//   - {object} context - The job's context
//   - {object} dependencies - The handler's dependencies
//   - {Date} now - The attempt's time
//   - {object} quarterInput - { domainName, domainUuid, quarter, year } for the quarter
//   - {object} shared - { endpoint, terms }: the endpoint and dictionary, read once per attempt when first needed
//   - {AbortSignal|null} signal - The scheduler's cancellation
//   - {Array<object>} tasks - The quarter's completed tasks
// @returns {Promise<object>} { classifiedCount, linkedCount, potentialDue, waitingCount } for the quarter: potentialDue
//   is true when its ledger now holds a project task not yet rated for potential.
async function _classifiedQuarter({ context, dependencies, now, quarterInput, shared, signal, tasks }) {
  const { app } = context;
  const scope = projectJobScope(quarterInput);
  const ledger = await jobRead(context, currentApp => readCompletedTaskLedger(currentApp, scope), signal);
  const pendingTasks = _unrecordedTasks(tasks, ledger);
  const counts = { classifiedCount: 0, linkedCount: 0, potentialDue: unscoredProjectEntries(ledger.entriesByDate).length > 0,
    waitingCount: pendingTasks.length };
  if (!pendingTasks.length) return counts;
  const { intentTextsByProjectUuid, projects } = await activeQuarterProjects(app, quarterInput, dependencies);
  if (!projects.length) return counts;
  const classifiedAt = now.toISOString();
  const linkedEntries = [];
  const unlinkedTasks = [];
  for (const task of pendingTasks) {
    const project = linkedProject(task, projects);
    if (project) linkedEntries.push(completedTaskEntry(task, { classifiedAt, classifiedBy: CLASSIFIED_BY.link, project }));
    else unlinkedTasks.push(task);
  }
  await recordLedgerEntries(context, scope, linkedEntries, signal);
  counts.linkedCount = linkedEntries.length;
  counts.potentialDue = counts.potentialDue || linkedEntries.length > 0;
  counts.waitingCount = unlinkedTasks.length;
  if (!unlinkedTasks.length) return counts;
  if (shared.endpoint === undefined) shared.endpoint = await jobDecisionsEndpoint(context, dependencies.endpointFactory, signal);
  if (!shared.endpoint) return counts;
  if (shared.terms === undefined) shared.terms = await dependencies.dictionaryReader(app, now.getFullYear());
  const choices = projectChoices(projects);
  for (const batch of classificationBatches(unlinkedTasks)) {
    if (signal?.aborted) return counts;
    const state = classificationState({ choices, dictionary: shared.terms, intentTextsByProjectUuid, tasks: batch });
    const response = await shared.endpoint.rankedResponses({ questions: classificationQuestions(batch, choices), state });
    const entries = classifiedEntries(response, batch, { choices, classifiedAt });
    await recordLedgerEntries(context, scope, entries, signal);
    counts.classifiedCount += entries.length;
    counts.potentialDue = counts.potentialDue || entries.some(entry => entry.projectUuid);
    counts.waitingCount -= entries.length;
  }
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the tasks completed from the start of the window's first day until now. A task without a UUID or a
//   completion time cannot be recorded and is left out.
// @param {object} context - The job's context.
// @param {object} options - { domainUuid, now, signal }.
// @returns {Promise<Array<object>>} Completed tasks.
// @throws When the completed tasks could not be read.
async function _completedTasksInWindow(context, { domainUuid, now, signal }) {
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (CLASSIFICATION_WINDOW_DAYS - 1));
  const fromSeconds = Math.floor(windowStart.getTime() / 1000);
  const toSeconds = Math.floor(now.getTime() / 1000);
  const lookupOptions = domainUuid ? { taskDomainUUID: domainUuid } : {};
  const tasks = await jobRead(context, currentApp => currentApp.getCompletedTasks(fromSeconds, toSeconds, lookupOptions), signal);
  if (!Array.isArray(tasks)) throw new Error("Could not read completed tasks");
  const recordableTasks = tasks.filter(task => task?.uuid && dateFromDateInput(task.completedAt, { throwOnInvalid: false }));
  return recordableTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc The completions the ledger does not hold yet. A task completed on a day whose section cannot be read is left
//   out, since it could not be recorded without overwriting that day.
// @param {Array<object>} tasks - The quarter's completed tasks.
// @param {object} ledger - { entriesByDate, unreadableDates }, from readCompletedTaskLedger.
// @returns {Array<object>} Unrecorded tasks.
function _unrecordedTasks(tasks, ledger) {
  const recordedKeys = new Set();
  for (const [dateKey, entries] of ledger.entriesByDate) {
    for (const entry of entries) recordedKeys.add(ledgerEntryKey({ dateKey, taskUuid: entry.taskUuid }));
  }
  const unreadableDates = new Set(ledger.unreadableDates);
  const unrecordedTasks = tasks.filter(task => {
    const dateKey = dateKeyFromDateInput(dateFromDateInput(task.completedAt));
    return !unreadableDates.has(dateKey) && !recordedKeys.has(ledgerEntryKey({ dateKey, taskUuid: task.uuid }));
  });
  return unrecordedTasks;
}
