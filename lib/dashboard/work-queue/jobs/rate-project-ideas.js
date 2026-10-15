// The queued job that rates one project's open ideas for actionability and relevance, independently of their
// generation. It reads the project fresh, picks the ideas awaiting a rating (never rated, or rated before their text
// changed), and asks the DecisionsEndpoint decisionsEndpointForApp chooses: Jev or OpenAI's Decisions API when either
// can answer, otherwise the generative provider's fast model, each request taking its own provider permit. Ratings are written onto the ideas as the store holds them at the moment
// of writing, through setSuggestedTasks with no generation time, so rating never makes ideas look newly generated. Its
// revision names the ideas it rated, so an attempt interrupted after writing completes without asking again. A failed
// request fails the attempt for the queue to retry; with nothing able to rate, it waits for a settings change. When the
// new ratings leave the project saturated with well-rated ideas, the ideas rated below the keeping average, or already
// done, are dropped in the same write.
import { pluralize } from "app-util";
import { projectIntentTexts } from "dashboard/project-collection-steps";
import { ideaRatingPrompt, ideaRatingsRevision, ideasAwaitingRating, ideasSaturated, keptIdeaRecords, rateProjectIdeas,
  ratedIdeaRecords } from "dashboard/project-task-idea-ratings";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { jobPriorityContext, projectJobScope, readProjectJobInputs,
  validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { RATE_PROJECT_IDEAS_JOB_TYPE, taskDurationEstimatesRequestIfAvailable } from "dashboard/work-queue/jobs/project-job-requests";
import { projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";
import { DecisionsEndpoint } from "providers/decisions-endpoint";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";

export { RATE_PROJECT_IDEAS_JOB_TYPE };

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, projectUuid, quarter, year }.
// @param {object} [options] - An object with the following properties:
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
//   - {function} [requestAnswers] - Injected rating request in requestJevAnswers' shape, still sent through a permit
//   - {function} [taskScorer=projectTaskScorer] - (app) => "jev", "generative", or null when nothing can rate
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createRateProjectIdeasHandler({ quarterlyContentReader, repositoryFactory = app => new QuarterProjectRepository({ app }),
  requestAnswers = null, taskScorer = projectTaskScorer } = {}) {
  const dependencies = { quarterlyContentReader, repositoryFactory, requestAnswers, taskScorer };
  return {
    appliedRevision: ({ context, job }) => _appliedRevision({ context, job, repositoryFactory }),
    run: ({ context, job, signal }) => _ratingAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: RATE_PROJECT_IDEAS_JOB_TYPE,
    validateInput: input => validateProjectJobInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The ideas a stored project's last rating judged, so an attempt interrupted after writing completes without
//   asking again. A job with no desired revision is not checked.
// @param {object} options - { context, job, repositoryFactory }.
// @returns {Promise<string|null>} The stored revision, or null.
async function _appliedRevision({ context, job, repositoryFactory }) {
  if (job.desiredRevision === null) return null;
  const stored = await repositoryFactory(context.app).readOne(projectJobScope(job.input), job.input.projectUuid);
  return stored?.refreshState.ideaRatings?.inputRevision || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Write ratings onto the project's ideas as the store holds them, drop the ideas a saturated project no longer
//   keeps, and record the rating's success.
// @param {QuarterProject} project - Project to update in place.
// @param {object} options - { inputRevision, now, ratedIdeas, raterEm, ratingsById }.
function _applyRatings(project, { inputRevision, now, ratedIdeas, raterEm, ratingsById }) {
  const ratedAt = now.toISOString();
  const ratedRecords = ratedIdeaRecords(project.suggestedTasks, ratingsById, { ratedAt, ratedIdeas, raterEm });
  const saturated = ideasSaturated(ratedRecords);
  const keptRecords = saturated ? keptIdeaRecords(ratedRecords, { completedTasks: project.completedTasks }) : ratedRecords;
  project.setSuggestedTasks(keptRecords);
  project.recordRefreshSuccess("ideaRatings", { inputRevision, succeededAt: ratedAt });
}

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the project, choose the ideas awaiting a rating, ask the rater, and write the ratings.
//   Any available decision-provider route schedules duration estimation so newly recommendable ideas receive realistic blocks.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { outcomeDetail, outcomeSubject, ratedCount, revision }: outcomeDetail and outcomeSubject
//   say for the queue inspector how many ideas were rated for which project. Or { status: "superseded" } when the
//   project left the plan or no idea awaits a rating.
// @throws When the rating request failed, or as a configuration failure when nothing can rate.
async function _ratingAttempt({ context, dependencies, job, signal }) {
  const { app } = context;
  const now = new Date(context.clock());
  const repository = dependencies.repositoryFactory(app);
  const { guide, liveProject, scope, stored } = await readProjectJobInputs(app, job.input,
    { quarterlyContentReader: dependencies.quarterlyContentReader, repository });
  if (!liveProject || !stored) return { status: "superseded" };
  const project = liveProject.detachedCopy();
  project.adoptStoreFields(stored);
  const ratedIdeas = ideasAwaitingRating(project.suggestedTasks, now);
  if (!ratedIdeas.length) return { status: "superseded" };
  const raterEm = await dependencies.taskScorer(app);
  const decisionsEndpoint = raterEm ? await _ratingEndpoint(context, { raterEm, requestAnswers: dependencies.requestAnswers,
    signal }) : null;
  if (!decisionsEndpoint) {
    const error = new Error("Nothing is configured to rate ideas");
    error.workFailure = "configuration";
    throw error;
  }
  const { failureReason, ratingsById } = await rateProjectIdeas({ decisionsEndpoint, ideas: ratedIdeas,
    intentTexts: projectIntentTexts(guide, project), project });
  if (!ratingsById) throw new Error(`Rating ideas for "${ project.summary }" failed: ${ failureReason }`);
  if (signal?.aborted) return { status: "superseded" };
  const inputRevision = ideaRatingsRevision(project.suggestedTasks, now);
  await repository.applyResult(scope, { apply: target => _applyRatings(target, { inputRevision, now, ratedIdeas,
    raterEm: decisionsEndpoint.scorerEm, ratingsById }), sourceProject: liveProject });
  const outcomeDetail = `Rated ${ pluralize(ratedIdeas.length, "idea") }`;
  const durationRequest = await taskDurationEstimatesRequestIfAvailable(app, job.input, { requestedAt: context.clock() });
  const followUps = durationRequest ? [durationRequest] : [];
  return { followUps, outcomeDetail, outcomeSubject: project.summary, ratedCount: ratedIdeas.length, revision: inputRevision };
}

// ----------------------------------------------------------------------------------------------
// @desc The endpoint this attempt rates through, sent through the runtime's permit for its scorer: a decision model,
//   or the generative fast model asked with ideaRatingPrompt.
// @param {object} context - The job's context, carrying app and providerDispatch.
// @param {object} options - { raterEm, requestAnswers, signal }: requestAnswers, when given, replaces the selected
//   endpoint and rates as raterEm.
// @returns {Promise<DecisionsEndpoint|null>} The endpoint, or null when nothing can rate.
async function _ratingEndpoint(context, { raterEm, requestAnswers, signal }) {
  const { app, providerDispatch } = context;
  const decisionsEndpoint = requestAnswers ? DecisionsEndpoint.fromRequester(requestAnswers, { scorerEm: raterEm })
    : await decisionsEndpointForApp(app, { fastScorePromptBuilder: ideaRatingPrompt });
  if (!decisionsEndpoint || !providerDispatch) return decisionsEndpoint;
  return decisionsEndpoint.withProviderDispatch({ providerDispatch, signal });
}
