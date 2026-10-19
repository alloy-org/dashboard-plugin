// The queued job that rates the potential of each completed task a quarter's ledger associated with a project, and
// raises the task's victory value when the rating earns more than it has. The classification job submits it as a
// follow-up. Each task's current victory value is read fresh from Amplenote before deciding, a raise is written with
// app.updateTask in the write chain of the task's note, and Amplenote is read again afterward to confirm the raise
// took. The ratings and the values before and after are recorded on the task's ledger entry as each batch finishes, so
// a retry asks only about the tasks still unrated and never raises a task twice. Only a decision model is asked: with
// none configured, the tasks wait for a later run.
import { pluralize } from "app-util";
import { POTENTIAL_BATCH_SIZE, POTENTIAL_SKIPPED_COMPLETION_MISSING, potentialEntry, potentialQuestions, potentialRatings,
  potentialState, raisedVictoryValue, skippedPotentialEntry, unscoredProjectEntries } from "dashboard/projects/completed-task-potential";
import { classificationBatches } from "dashboard/projects/completed-task-project-classification";
import { completedTaskLedgerNoteName, ledgerEntryKey, readCompletedTaskLedger } from "dashboard/projects/completed-task-project-ledger";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { activeQuarterProjects, dictionaryDefinitions, jobDecisionsEndpoint, jobRead, jobWrite,
  recordLedgerEntries } from "dashboard/work-queue/jobs/completed-task-job-steps";
import { jobPriorityContext, projectJobScope, validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

export { SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE };
const POTENTIAL_LOG_LABEL = "[score-completed-task-potential]";

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, quarter, year }, naming the ledger it rates.
// @param {object} [options] - An object with the following properties:
//   - {function} [dictionaryReader] - (app, year) => definitions keyed by term; injected for tests
//   - {function} [endpointFactory] - (app) => DecisionsEndpoint or null; decisionsEndpointForApp without the fast
//     model by default, since its ratings change the user's tasks
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createScoreCompletedTaskPotentialHandler({ dictionaryReader = dictionaryDefinitions,
  endpointFactory = app => decisionsEndpointForApp(app, { includeFastScore: false }), quarterlyContentReader,
  repositoryFactory = app => new QuarterProjectRepository({ app }) } = {}) {
  const dependencies = { dictionaryReader, endpointFactory, quarterlyContentReader, repositoryFactory };
  return {
    run: ({ context, job, signal }) => _potentialAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: SCORE_COMPLETED_TASK_POTENTIAL_JOB_TYPE,
    validateInput: input => validateProjectJobInput(input, { requireProject: false }),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt, and describe for the queue inspector how many tasks it scored for victory value in which
//   ledger note.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} The counts from _potentialCounts, with outcomeDetail and outcomeSubject.
// @throws When a rating request failed, after recording everything rated before it.
async function _potentialAttempt({ context, dependencies, job, signal }) {
  const counts = await _potentialCounts({ context, dependencies, job, signal });
  const { raisedCount, scoredCount, skippedCount, waitingCount } = counts;
  const scoredText = `Scored ${ pluralize(scoredCount, "task") } for victory value, raised ${ raisedCount }`;
  const leftoverTexts = [skippedCount ? `${ skippedCount } skipped` : null, waitingCount ? `${ waitingCount } waiting` : null];
  const presentLeftoverTexts = leftoverTexts.filter(Boolean);
  const outcomeDetail = presentLeftoverTexts.length ? `${ scoredText }; ${ presentLeftoverTexts.join(", ") }` : scoredText;
  return { ...counts, outcomeDetail, outcomeSubject: completedTaskLedgerNoteName(projectJobScope(job.input)) };
}

// ----------------------------------------------------------------------------------------------
// @desc Rate the ledger's unrated project tasks in batches, raising and recording as each finishes.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { raisedCount, scoredCount, skippedCount, waitingCount }: tasks raised, tasks rated
//   (raised or not), tasks marked rated because their completion could not be found, and tasks left for a later run.
// @throws When a rating request failed, after recording everything rated before it.
async function _potentialCounts({ context, dependencies, job, signal }) {
  const now = new Date(context.clock());
  const scope = projectJobScope(job.input);
  const ledger = await jobRead(context, app => readCompletedTaskLedger(app, scope), signal);
  const unscoredEntries = unscoredProjectEntries(ledger.entriesByDate);
  const counts = { raisedCount: 0, scoredCount: 0, skippedCount: 0, waitingCount: unscoredEntries.length };
  if (!unscoredEntries.length) return counts;
  const potentialScoredAt = now.toISOString();
  const readOptions = { domainUuid: job.input.domainUuid, fromDateKey: unscoredEntries[0].dateKey, now, signal };
  let completedTasksByKey = await _completedTasksByKey(context, readOptions);
  const missingEntries = unscoredEntries.filter(entry => !completedTasksByKey.has(ledgerEntryKey(entry)));
  const skipOptions = { potentialScoredAt, reason: POTENTIAL_SKIPPED_COMPLETION_MISSING };
  const skippedEntries = missingEntries.map(entry => skippedPotentialEntry(entry, skipOptions));
  await recordLedgerEntries(context, scope, skippedEntries, signal);
  counts.skippedCount = skippedEntries.length;
  counts.waitingCount -= skippedEntries.length;
  const askableEntries = unscoredEntries.filter(entry => completedTasksByKey.has(ledgerEntryKey(entry)));
  if (!askableEntries.length) return counts;
  const endpoint = await jobDecisionsEndpoint(context, dependencies.endpointFactory, signal);
  if (!endpoint) return counts;
  const dictionary = await dependencies.dictionaryReader(context.app, now.getFullYear());
  const intentTextsByProjectUuid = await _projectGoals(context.app, job.input, dependencies);
  for (const batch of classificationBatches(askableEntries, POTENTIAL_BATCH_SIZE)) {
    if (signal?.aborted) return counts;
    const state = potentialState({ dictionary, entries: batch, intentTextsByProjectUuid });
    const response = await endpoint.rankedResponses({ questions: potentialQuestions(batch), state });
    const raises = [];
    for (const rating of potentialRatings(response, batch)) {
      const task = completedTasksByKey.get(ledgerEntryKey(rating.entry));
      const priorVictoryValue = Number.isFinite(task.victoryValue) ? task.victoryValue : null;
      const appliedVictoryValue = raisedVictoryValue(rating, priorVictoryValue);
      const accepted = appliedVictoryValue === null ? null : await _raisedTask(context, task, appliedVictoryValue, signal);
      raises.push({ accepted, appliedVictoryValue, priorVictoryValue, rating });
    }
    if (raises.some(raise => raise.accepted)) completedTasksByKey = await _completedTasksByKey(context, readOptions);
    const entries = raises.map(({ accepted, appliedVictoryValue, priorVictoryValue, rating }) => {
      const reportedValue = completedTasksByKey.get(ledgerEntryKey(rating.entry))?.victoryValue;
      const raiseConfirmed = appliedVictoryValue === null ? null : Boolean(accepted) && reportedValue >= appliedVictoryValue;
      return potentialEntry(rating.entry, { appliedVictoryValue, longTermUpside: rating.longTermUpside, potentialScoredAt,
        priorVictoryValue, raiseConfirmed, shortTermImpact: rating.shortTermImpact });
    });
    await recordLedgerEntries(context, scope, entries, signal);
    counts.scoredCount += entries.length;
    counts.raisedCount += entries.filter(entry => entry.appliedVictoryValue !== null).length;
    counts.waitingCount -= entries.length;
  }
  logIfEnabled(`${ POTENTIAL_LOG_LABEL } rated`, counts);
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the tasks completed from the start of a day until now, indexed the way the ledger names a completion.
// @param {object} context - The job's context.
// @param {object} options - { domainUuid, fromDateKey, now, signal }: fromDateKey is the earliest day to read.
// @returns {Promise<Map<string, object>>} Completed tasks by ledgerEntryKey.
// @throws When the completed tasks could not be read.
async function _completedTasksByKey(context, { domainUuid, fromDateKey, now, signal }) {
  const fromSeconds = Math.floor(dateFromDateInput(fromDateKey).getTime() / 1000);
  const toSeconds = Math.floor(now.getTime() / 1000);
  const lookupOptions = domainUuid ? { taskDomainUUID: domainUuid } : {};
  const tasks = await jobRead(context, app => app.getCompletedTasks(fromSeconds, toSeconds, lookupOptions), signal);
  if (!Array.isArray(tasks)) throw new Error("Could not read completed tasks");
  const tasksByKey = new Map();
  for (const task of tasks) {
    const completedDate = task?.uuid ? dateFromDateInput(task.completedAt, { throwOnInvalid: false }) : null;
    if (completedDate) tasksByKey.set(ledgerEntryKey({ dateKey: dateKeyFromDateInput(completedDate), taskUuid: task.uuid }), task);
  }
  return tasksByKey;
}

// ----------------------------------------------------------------------------------------------
// @desc The plan goals each of the quarter's active projects serves, to describe the projects the tasks advanced. A
//   plan that cannot be read gives none, since the ledger already names each task's project.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} quarterInput - { domainName, domainUuid, quarter, year }.
// @param {object} dependencies - { quarterlyContentReader, repositoryFactory }.
// @returns {Promise<Map<string, Array<string>>>} Goals by project UUID.
async function _projectGoals(app, quarterInput, dependencies) {
  try {
    const { intentTextsByProjectUuid } = await activeQuarterProjects(app, quarterInput, dependencies);
    return intentTextsByProjectUuid;
  } catch (error) {
    logIfEnabled(`${ POTENTIAL_LOG_LABEL } could not read the quarter's projects`, error?.message);
    return new Map();
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Raise a task's victory value, in the write chain of the note holding it. A refusal or failure is logged and
//   reported rather than thrown, so the rating is still recorded and the task is not asked about again.
// @param {object} context - The job's context.
// @param {object} task - The completed task, carrying uuid and noteUUID.
// @param {number} victoryValue - The value to raise it to.
// @param {AbortSignal|null} signal - Gives up a write still waiting for its permit.
// @returns {Promise<boolean>} Whether Amplenote reported the update as made.
async function _raisedTask(context, task, victoryValue, signal) {
  const noteKey = task.noteUUID || `task:${ task.uuid }`;
  try {
    const updated = await jobWrite(context, noteKey, app => app.updateTask(task.uuid, { victoryValue }), signal);
    if (updated !== true) logIfEnabled(`${ POTENTIAL_LOG_LABEL } updateTask did not report success`, { taskUuid: task.uuid, updated });
    return updated === true;
  } catch (error) {
    logIfEnabled(`${ POTENTIAL_LOG_LABEL } could not raise ${ task.uuid }`, error?.message);
    return false;
  }
}
