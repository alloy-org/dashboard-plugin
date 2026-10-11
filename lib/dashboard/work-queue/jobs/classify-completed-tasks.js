// The queued job that records which quarterly project each task completed in the past week advanced, in the archived
// "Completed Tasks by Project" ledger of the quarter the task was completed in, so a week that spans two quarters
// writes to both. Tasks the ledger already holds are skipped. A task linked to exactly one project is recorded
// without asking anyone; the rest are asked of the DecisionsEndpoint in batches, against each project's summary, goals,
// and most similar open tasks and the terms dictionary. Only a decision model is asked: with none configured, linked
// tasks are still recorded and the rest wait for a later run. Each batch is written as soon as it is answered, so an
// attempt that fails partway keeps what it learned and the retry asks only about the tasks still missing.
import { classificationBatches, classificationQuestions, classificationState, classifiedEntries, CLASSIFIED_BY,
  completedTaskEntry, linkedProject, projectChoices } from "dashboard/projects/completed-task-project-classification";
import { completedTaskLedgerNoteName, ledgerEntriesFromContent, ledgerEntryKey, mergedLedgerEntries, openCompletedTaskLedger,
  readCompletedTaskLedger, writeLedgerDateSection } from "dashboard/projects/completed-task-project-ledger";
import { projectIntentTexts } from "dashboard/project-collection-steps";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { jobPriorityContext, projectJobScope, readProjectJobInputs, validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { CLASSIFY_COMPLETED_TASKS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { dictionaryEntriesFromContent, dictionaryObjectFromEntries, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
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
export function createClassifyCompletedTasksHandler({ dictionaryReader = _dictionaryDefinitions,
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
//   by their link, and tasks left for a later run; or { status: "superseded" } when the scheduler cancelled it.
// @throws When a classification request failed, after recording everything answered before it.
async function _classificationAttempt({ context, dependencies, job, signal }) {
  const now = new Date(context.clock());
  const tasks = await _completedTasksInWindow(context, { domainUuid: job.input.domainUuid, now, signal });
  const counts = { classifiedCount: 0, linkedCount: 0, waitingCount: 0 };
  const shared = { endpoint: undefined, terms: undefined };
  for (const group of completedTasksByQuarter(tasks)) {
    if (signal?.aborted) return { status: "superseded" };
    const quarterInput = { ...job.input, quarter: group.quarter, year: group.year };
    const quarterCounts = await _classifiedQuarter({ context, dependencies, now, quarterInput, shared, signal, tasks: group.tasks });
    for (const key of Object.keys(counts)) counts[key] += quarterCounts[key];
  }
  logIfEnabled(`${ CLASSIFY_LOG_LABEL } classified`, { ...counts, completedCount: tasks.length });
  return counts;
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
// @returns {Promise<object>} { classifiedCount, linkedCount, waitingCount } for the quarter.
async function _classifiedQuarter({ context, dependencies, now, quarterInput, shared, signal, tasks }) {
  const { app } = context;
  const scope = projectJobScope(quarterInput);
  const ledger = await _read(context, currentApp => readCompletedTaskLedger(currentApp, scope), signal);
  const pendingTasks = _unrecordedTasks(tasks, ledger);
  const counts = { classifiedCount: 0, linkedCount: 0, waitingCount: pendingTasks.length };
  if (!pendingTasks.length) return counts;
  const { intentTextsByProjectUuid, projects } = await _activeProjects(app, quarterInput, dependencies);
  if (!projects.length) return counts;
  const classifiedAt = now.toISOString();
  const linkedEntries = [];
  const unlinkedTasks = [];
  for (const task of pendingTasks) {
    const project = linkedProject(task, projects);
    if (project) linkedEntries.push(completedTaskEntry(task, { classifiedAt, classifiedBy: CLASSIFIED_BY.link, project }));
    else unlinkedTasks.push(task);
  }
  await _recordEntries(context, scope, linkedEntries, signal);
  counts.linkedCount = linkedEntries.length;
  counts.waitingCount = unlinkedTasks.length;
  if (!unlinkedTasks.length) return counts;
  if (shared.endpoint === undefined) shared.endpoint = await _classificationEndpoint(context, dependencies, signal);
  if (!shared.endpoint) return counts;
  if (shared.terms === undefined) shared.terms = await dependencies.dictionaryReader(app, now.getFullYear());
  const choices = projectChoices(projects);
  for (const batch of classificationBatches(unlinkedTasks)) {
    if (signal?.aborted) return counts;
    const state = classificationState({ choices, dictionary: shared.terms, intentTextsByProjectUuid, tasks: batch });
    const response = await shared.endpoint.rankedResponses({ questions: classificationQuestions(batch, choices), state });
    const entries = classifiedEntries(response, batch, { choices, classifiedAt });
    await _recordEntries(context, scope, entries, signal);
    counts.classifiedCount += entries.length;
    counts.waitingCount -= entries.length;
  }
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's active projects as the live plan holds them, each carrying the open tasks the project task store
//   associated with it, and the plan goals each one serves.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} quarterInput - { domainName, domainUuid, quarter, year }.
// @param {object} dependencies - { quarterlyContentReader, repositoryFactory }.
// @returns {Promise<object>} { intentTextsByProjectUuid, projects }.
async function _activeProjects(app, quarterInput, { quarterlyContentReader, repositoryFactory }) {
  const { guide, projects: liveProjects, storedProjects } = await readProjectJobInputs(app, quarterInput,
    { quarterlyContentReader, repository: repositoryFactory(app) });
  const storedByUuid = new Map(storedProjects.map(project => [project.uuid, project]));
  const projects = liveProjects.map(liveProject => {
    const project = liveProject.detachedCopy();
    if (storedByUuid.has(project.uuid)) project.adoptStoreFields(storedByUuid.get(project.uuid));
    return project;
  });
  const intentTextsByProjectUuid = new Map(projects.map(project => [project.uuid, projectIntentTexts(guide, project)]));
  return { intentTextsByProjectUuid, projects };
}

// ----------------------------------------------------------------------------------------------
// @desc The endpoint classifications are asked through, each request taking its own provider permit.
// @param {object} context - The job's context, carrying app and providerDispatch.
// @param {object} dependencies - { endpointFactory }.
// @param {AbortSignal|null} signal - Gives up a request still waiting for its permit.
// @returns {Promise<DecisionsEndpoint|null>} The endpoint, or null when no decision model is configured.
async function _classificationEndpoint(context, { endpointFactory }, signal) {
  const endpoint = await endpointFactory(context.app);
  if (!endpoint || !context.providerDispatch) return endpoint || null;
  return endpoint.withProviderDispatch({ providerDispatch: context.providerDispatch, signal });
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
  const tasks = await _read(context, currentApp => currentApp.getCompletedTasks(fromSeconds, toSeconds, lookupOptions), signal);
  if (!Array.isArray(tasks)) throw new Error("Could not read completed tasks");
  const recordableTasks = tasks.filter(task => task?.uuid && dateFromDateInput(task.completedAt, { throwOnInvalid: false }));
  return recordableTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the year's terms dictionary as definitions keyed by term. A year without one, or one that cannot be read,
//   gives no definitions, since classifying without them beats not classifying.
// @param {object} app - Host-compatible Amplenote API.
// @param {number} year - The dictionary's year.
// @returns {Promise<object>} Definitions keyed by term.
async function _dictionaryDefinitions(app, year) {
  try {
    const content = await readUserTermsDictionary(app, year);
    return content ? dictionaryObjectFromEntries(dictionaryEntriesFromContent(content)) : {};
  } catch (error) {
    logIfEnabled(`${ CLASSIFY_LOG_LABEL } could not read the terms dictionary`, error?.message);
    return {};
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Run an app read through the runtime's app dispatcher, or directly without one.
// @param {object} context - The job's context.
// @param {function} operation - (app) => result.
// @param {AbortSignal|null} signal - Gives up a read still waiting for its permit.
// @returns {Promise<*>} The operation's result.
function _read(context, operation, signal) {
  return context.appDispatch ? context.appDispatch.read(operation, { signal }) : operation(context.app);
}

// ----------------------------------------------------------------------------------------------
// @desc Add entries to the quarter's ledger, creating it when needed, in the ledger's write chain. Each day is re-read
//   and merged inside the write, so entries another writer recorded meanwhile are kept. A day whose JSON cannot be
//   read is left untouched, as is a day that cannot be inserted, each logged.
// @param {object} context - The job's context.
// @param {object} scope - Resolved quarter scope.
// @param {Array<object>} entries - Entries, each carrying its dateKey.
// @param {AbortSignal|null} signal - Gives up a write still waiting for its permit.
// @returns {Promise<void>}
async function _recordEntries(context, scope, entries, signal) {
  if (!entries.length) return;
  const entriesByDate = new Map();
  for (const entry of entries) entriesByDate.set(entry.dateKey, [...(entriesByDate.get(entry.dateKey) || []), entry]);
  const update = async app => {
    const ledger = await openCompletedTaskLedger(app, scope);
    const recorded = ledgerEntriesFromContent(ledger.content);
    let content = ledger.content;
    for (const [dateKey, dayEntries] of entriesByDate) {
      if (recorded.unreadableDates.includes(dateKey)) continue;
      const mergedEntries = mergedLedgerEntries(recorded.entriesByDate.get(dateKey) || [], dayEntries);
      try {
        content = await writeLedgerDateSection(app, { content, dateKey, entries: mergedEntries, noteHandle: ledger.noteHandle });
      } catch (error) {
        logIfEnabled(`${ CLASSIFY_LOG_LABEL } could not write ${ dateKey }`, error?.message);
      }
    }
  };
  const noteName = completedTaskLedgerNoteName(scope);
  if (context.appDispatch) await context.appDispatch.write(noteName, update, { signal });
  else await update(context.app);
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
