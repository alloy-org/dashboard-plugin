// Refresh the durations of a quarter's recommendable tasks and ideas under the dashboard's durable maintenance queue.
import { everyProjectCandidate } from "dashboard/day-project-candidates";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { estimateCandidateDurations } from "dashboard/task-duration-service";
import { jobPriorityContext, readProjectJobInputs, readProjectJobTasks, validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { ESTIMATE_TASK_DURATIONS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";

// ----------------------------------------------------------------------------------------------
// @desc Create the quarter-scoped duration pass; each attempt reads current candidates, dictionary, and saved estimates.
// @param {object} [options] - { estimator, quarterlyContentReader, repositoryFactory }, injected for tests.
// @returns {object} Durable work handler.
export function createEstimateTaskDurationsHandler({ estimator = estimateCandidateDurations, quarterlyContentReader,
    repositoryFactory = app => new QuarterProjectRepository({ app }) } = {}) {
  const dependencies = { estimator, quarterlyContentReader, repositoryFactory };
  return { run: ({ context, job, signal }) => _durationAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: ESTIMATE_TASK_DURATIONS_JOB_TYPE, validateInput: input => validateProjectJobInput(input, { requireProject: false }) };
}

// ----------------------------------------------------------------------------------------------
// @desc Estimate every candidate offered by the quarter's projects, irrespective of weekday qualification. Refused or
//   missing answers fail the attempt after successful batches are stored, so queue backoff retries only unanswered work.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} Duration counts and queue inspector detail, or superseded when cancelled.
async function _durationAttempt({ context, dependencies, job, signal }) {
  const { app } = context;
  const repository = dependencies.repositoryFactory(app);
  const { projects, scope, storedProjects } = await readProjectJobInputs(app, job.input, { quarterlyContentReader: dependencies.quarterlyContentReader, repository });
  const openTasks = await readProjectJobTasks(context, { domainUuid: job.input.domainUuid, signal });
  const activeStoredProjects = storedProjects.filter(project => project.isActive !== false);
  const candidates = everyProjectCandidate({ now: new Date(context.clock()), openTasks, projects, storedRecords: activeStoredProjects });
  const groups = [{ taskCandidates: candidates.map(entry => entry.candidate) }];
  if (signal?.aborted) return { status: "superseded" };
  const counts = await dependencies.estimator(app, { groups, openTasks, providerDispatch: context.providerDispatch, scope, signal });
  if (signal?.aborted) return { status: "superseded" };
  if (counts.waitingCount) throw new Error(`${ counts.waitingCount } task durations await a decision-model answer`);
  return { ...counts, outcomeDetail: `Estimated ${ counts.estimatedCount } durations, reused ${ counts.reusedCount }`,
    outcomeSubject: scope.quarterKey, revision: job.desiredRevision };
}
