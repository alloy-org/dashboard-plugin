// The queued job that rates one project's open ideas for actionability and relevance, independently of their
// generation. It reads the project fresh, picks the ideas awaiting a rating (never rated, or rated before their text
// changed), and asks Jev when a Jev key or Ample Agent Pro can answer, otherwise the generative provider's fast model,
// each request taking its own provider permit. Ratings are written onto the ideas as the store holds them at the moment
// of writing, through setSuggestedTasks with no generation time, so rating never makes ideas look newly generated. Its
// revision names the ideas it rated, so an attempt interrupted after writing completes without asking again. A failed
// request fails the attempt for the queue to retry; with nothing able to rate, it waits for a settings change.
import { projectIntentTexts } from "dashboard/project-collection-steps";
import { ideaRatingPrompt, ideaRatingsRevision, ideasAwaitingRating, rateProjectIdeas,
  ratedIdeaRecords } from "dashboard/project-task-idea-ratings";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { jobPriorityContext, projectJobScope, readProjectJobInputs,
  validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { RATE_PROJECT_IDEAS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { generativeScoreRequester } from "plan-wizard/stack-rank/generative-task-scores";
import { jevAnswerRequester, projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";

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
// @desc Write ratings onto the project's ideas as the store holds them, and record the rating's success.
// @param {QuarterProject} project - Project to update in place.
// @param {object} options - { inputRevision, now, ratedIdeas, raterEm, ratingsById }.
function _applyRatings(project, { inputRevision, now, ratedIdeas, raterEm, ratingsById }) {
  const ratedAt = now.toISOString();
  project.setSuggestedTasks(ratedIdeaRecords(project.suggestedTasks, ratingsById, { ratedAt, ratedIdeas, raterEm }));
  project.recordRefreshSuccess("ideaRatings", { inputRevision, succeededAt: ratedAt });
}

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the project, choose the ideas awaiting a rating, ask the rater, and write the ratings.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { ratedCount, revision }, or { status: "superseded" } when the project left the plan or
//   no idea awaits a rating.
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
  const requestAnswers = raterEm ? await _ratingRequester(context, { raterEm, requestAnswers: dependencies.requestAnswers, signal }) : null;
  if (!requestAnswers) {
    const error = new Error("Nothing is configured to rate ideas");
    error.workFailure = "configuration";
    throw error;
  }
  const { failureReason, ratingsById } = await rateProjectIdeas({ ideas: ratedIdeas,
    intentTexts: projectIntentTexts(guide, project), project, requestAnswers });
  if (!ratingsById) throw new Error(`Rating ideas for "${ project.summary }" failed: ${ failureReason }`);
  if (signal?.aborted) return { status: "superseded" };
  const inputRevision = ideaRatingsRevision(project.suggestedTasks, now);
  await repository.applyResult(scope, { apply: target => _applyRatings(target, { inputRevision, now, ratedIdeas, raterEm,
    ratingsById }), sourceProject: liveProject });
  return { ratedCount: ratedIdeas.length, revision: inputRevision };
}

// ----------------------------------------------------------------------------------------------
// @desc The rating request for this attempt, sent through the runtime's permit for the rater's resource: Jev through
//   its key or Ample Agent Pro, or the generative fast model.
// @param {object} context - The job's context, carrying app and providerDispatch.
// @param {object} options - { raterEm, requestAnswers, signal }: requestAnswers, when given, replaces the rater's own
//   request.
// @returns {Promise<function|null>} async ({ questions, state }) => { answers }, or null when Jev cannot be asked.
async function _ratingRequester(context, { raterEm, requestAnswers, signal }) {
  const { app, providerDispatch } = context;
  let request = requestAnswers;
  if (!request && raterEm === "jev") {
    const requester = await jevAnswerRequester(app);
    if (!requester) return null;
    request = options => requester.requestAnswers({ ...options, accessToken: requester.accessToken });
  }
  if (!request) request = generativeScoreRequester(app, { promptBuilder: ideaRatingPrompt });
  if (!providerDispatch) return request;
  return options => providerDispatch[raterEm](() => request(options), { signal });
}
