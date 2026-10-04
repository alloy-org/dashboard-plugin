// The queued job that refreshes one project's task associations: it matches the project's tasks locally, ranks the
// tasks it might own, and writes its similarity hash, accepted tasks, completions, and kept ideas, exactly as the
// background collection pass does before it asks for ideas. A large pool is rated one round of batches per turn, so
// the queue can run other work between rounds; each pause saves the similar and cited tasks rated so far into the
// project's hash, where a later ranking reads them instead of rating them again. The ranking in progress is kept in
// memory for the session that began it. A session that resumes a job another session began starts the ranking over,
// and the saved ratings make the restart cheap. The ranking time and the similarity refresh's success move forward
// only when every batch succeeded; a ranking that failed outright or missed batches still saves what it has, then
// fails the attempt so the queue retries it with backoff. The ranking also scores the tasks the sources page cites
// that have no score yet, as the Plan Builder's ranking pass does, and a finished ranking asks for the project's ideas
// as follow-up maintenance when they are due.
import { applyCollectedTaskResult, associationResult, projectTaskMatches, reconciledTaskSnapshot,
  similarityChanges } from "dashboard/project-collection-steps";
import { refreshRevision } from "dashboard/quarter-project-refresh-state";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import DashboardTaskSnapshotStore from "dashboard/work-queue/dashboard-task-snapshot-store";

import { jobPriorityContext, projectJobScope, readProjectJobInputs, readProjectJobTasks,
  validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { RANK_PROJECT_TASKS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { ideasRequestIfDue } from "dashboard/work-queue/quarter-project-work-planner";
import { guideProspects, tasksCoveringRecords, unscoredCitedTaskRecords } from "plan-wizard/stack-rank/cited-task-records";
import { prepareProjectTaskRanker } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { logIfEnabled } from "util/log";

export { RANK_PROJECT_TASKS_JOB_TYPE };
// Rankings one session holds between turns. A ranking abandoned past this many is dropped; its job restarts it.
const MAXIMUM_RANKINGS_IN_PROGRESS = 4;
const RANKING_LOG_LABEL = "[rank-project-tasks]";

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, projectUuid, quarter, year }. A completed
//   attempt reports the revision refreshRevision gives the project's similarity refresh, with an ideas request as its
//   follow-up when the project's ideas are due; a project that has left the live plan retires its job.
// @param {object} [options] - An object with the following properties:
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [rankerFactory=prepareProjectTaskRanker] - Injected for tests; resolves to null when nothing can rate
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
//   - {function} [taskSnapshotStoreFactory] - (app) => DashboardTaskSnapshotStore, or null to rank without change tracking
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createRankProjectTasksHandler({ quarterlyContentReader, rankerFactory = prepareProjectTaskRanker,
  repositoryFactory = app => new QuarterProjectRepository({ app }),
  taskSnapshotStoreFactory = app => new DashboardTaskSnapshotStore({ app }) } = {}) {
  const rankingsInProgress = new Map();
  const factories = { quarterlyContentReader, rankerFactory, repositoryFactory, taskSnapshotStoreFactory };
  return {
    appliedRevision: ({ context, job }) => _appliedRevision({ context, job, repositoryFactory }),
    run: ({ context, job, signal }) => _rankingAttempt({ context: jobPriorityContext(context, job), factories, job, rankingsInProgress, signal }),
    type: RANK_PROJECT_TASKS_JOB_TYPE,
    validateInput: input => validateProjectJobInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The revision the project's stored similarity refresh reflects, so an attempt interrupted after writing its
//   result completes without ranking again. A resumed attempt, or a job with no desired revision, is not checked.
// @param {object} options - { context, job, repositoryFactory }.
// @returns {Promise<string|null>} The stored revision, or null.
async function _appliedRevision({ context, job, repositoryFactory }) {
  if (job.desiredRevision === null || job.cursor) return null;
  const stored = await repositoryFactory(context.app).readOne(projectJobScope(job.input), job.input.projectUuid);
  return stored ? refreshRevision(stored.refreshState, "similarity") : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Read a ranking's inputs and draw its pool: the live project, the domain's tasks, the task snapshot, the cited
//   tasks with no score, and the ranker. The ranker reads the dictionary as it stands; growing it is a separate job.
// @param {object} options - { context, factories, job, signal }.
// @returns {Promise<object|null>} The ranking state, or null when the project has left the live plan.
async function _beganRanking({ context, factories, job, signal }) {
  const { app } = context;
  const { domainName, domainUuid } = job.input;
  const now = new Date(context.clock());
  const repository = factories.repositoryFactory(app);
  const inputs = await readProjectJobInputs(app, job.input, { quarterlyContentReader: factories.quarterlyContentReader,
    repository });
  if (!inputs.liveProject) return null;
  const project = inputs.liveProject;
  const tasks = await readProjectJobTasks(context, { domainUuid, signal });
  const requiredTaskRecords = unscoredCitedTaskRecords(guideProspects(inputs.guide), { project: inputs.stored,
    projectUuid: project.uuid, quarterKey: inputs.scope.quarterKey, tasks });
  const ranker = await factories.rankerFactory(app, { domainName, domainUuid, now, projects: [project],
    providerDispatch: context.providerDispatch || null, refineDictionary: false, signal,
    tasks: tasksCoveringRecords(tasks, requiredTaskRecords) });
  const taskSnapshotStore = ranker && factories.taskSnapshotStoreFactory ? factories.taskSnapshotStoreFactory(app) : null;
  const taskSnapshot = await reconciledTaskSnapshot(taskSnapshotStore, { domainUuid, tasks });
  const matches = projectTaskMatches(project, tasks);
  const storedRatings = inputs.stored?.taskSimilarityScores || project.taskSimilarityScores;
  const { changedTaskRecords, watermark } = similarityChanges(taskSnapshot, { project, stored: inputs.stored, tasks });
  const progress = ranker ? ranker.beginRanking(project, matches.matchedTaskRecords, { changedTaskRecords, requiredTaskRecords,
    storedRatings }) : null;
  const progressId = Math.random().toString(36).slice(2, 10);
  return { input: job.input, matches, now, progress, progressId, project, ranker, repository, scope: inputs.scope,
    stored: inputs.stored, watermark };
}

// ----------------------------------------------------------------------------------------------
// @desc Write a finished ranking: the association result through the project's setters, onto the project as the store
//   holds it when written. A ranking that failed or missed batches then fails the attempt, so the queue retries it.
//   One that succeeded asks for the project's ideas when they are due.
// @param {object} ranking - Ranking state from _beganRanking.
// @param {object} [options] - { thrownError = null }: an error rating threw, recorded as the ranking's failure.
// @returns {Promise<object>} { followUps, revision }: the ideas request, if due, and the stored similarity refresh's
//   revision, undefined when it has none.
// @throws When the ranking failed outright or some batches failed.
async function _finishedRanking(ranking, { thrownError = null } = {}) {
  const { input, matches, now, progress, project, ranker, repository, scope, stored, watermark } = ranking;
  const finished = progress && !thrownError ? await progress.finish() : null;
  const failureReason = thrownError ? thrownError.message || "Ranking failed" : finished?.failureReason;
  const rankingResult = failureReason ? { failureReason } : finished;
  const { result } = associationResult({ matches, now, project, ranking: rankingResult, scorerEm: ranker?.scorerEm, stored,
    watermark });
  const written = await repository.applyResult(scope, { apply: target => applyCollectedTaskResult(target, result),
    sourceProject: project });
  if (failureReason) {
    logIfEnabled(`${ RANKING_LOG_LABEL } ranking failed`, { project: project.summary, reason: failureReason });
    throw new Error(`Ranking "${ project.summary }" failed: ${ failureReason }`);
  }
  if (finished?.rankingIncomplete) throw new Error(`Ranking "${ project.summary }" missed ${ progress.failures.length } batches`);
  const ideasRequest = ideasRequestIfDue(input, written, now);
  const followUps = ideasRequest ? [ideasRequest] : [];
  return { followUps, revision: refreshRevision(written.refreshState, "similarity") ?? undefined };
}

// ----------------------------------------------------------------------------------------------
// @desc Run one turn of a ranking: begin it, or resume the one this session holds for the job, rate the next round
//   of batches, and either pause with its progress saved or finish it. A turn the scheduler cancelled writes nothing.
// @param {object} options - { context, factories, job, rankingsInProgress, signal }.
// @returns {Promise<object>} A handler result: yielded with a checkpoint, superseded, or completed with a revision.
async function _rankingAttempt({ context, factories, job, rankingsInProgress, signal }) {
  const resumed = job.cursor?.progressId ? rankingsInProgress.get(job.cursor.progressId) : null;
  const ranking = resumed || await _beganRanking({ context, factories, job, signal });
  if (!ranking) return { status: "superseded" };
  rankingsInProgress.delete(ranking.progressId);
  const { progress } = ranking;
  if (!progress) return _finishedRanking(ranking);
  try {
    await progress.rateNext(ranking.ranker.sliceSize);
  } catch (error) {
    return _finishedRanking(ranking, { thrownError: error });
  }
  if (signal?.aborted) return { status: "superseded" };
  if (progress.remainingCount <= 0) return _finishedRanking(ranking);
  await _savePartialScores(ranking);
  _rememberRanking(rankingsInProgress, ranking);
  const checkpoint = { progressId: ranking.progressId, ratedCount: progress.ratedThrough,
    totalCount: progress.uncachedRecords.length };
  return { checkpoint, status: "yielded" };
}

// ----------------------------------------------------------------------------------------------
// @desc Hold a paused ranking for the job's next turn, dropping the oldest held ranking past the limit.
// @param {Map<string, object>} rankingsInProgress - Held rankings by progress ID.
// @param {object} ranking - Ranking state from _beganRanking.
function _rememberRanking(rankingsInProgress, ranking) {
  rankingsInProgress.set(ranking.progressId, ranking);
  if (rankingsInProgress.size <= MAXIMUM_RANKINGS_IN_PROGRESS) return;
  const [oldestProgressId] = rankingsInProgress.keys();
  rankingsInProgress.delete(oldestProgressId);
}

// ----------------------------------------------------------------------------------------------
// @desc Save the similar and cited tasks a paused ranking has rated into the project's hash, folded over the hash the
//   store holds when written. Nothing else changes until the ranking finishes.
// @param {object} ranking - Ranking state from _beganRanking.
// @returns {Promise<void>}
async function _savePartialScores({ progress, project, repository, scope }) {
  const apply = target => target.setSimilarityScores(progress.partialSimilarityScores(target.taskSimilarityScores));
  await repository.applyResult(scope, { apply, sourceProject: project });
}
