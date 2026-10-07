// The queued job that asks the generative provider for one project's next-action ideas, and for tasks scattered across
// the user's notes that belong to it. The prompt leads
// with the Plan Builder intents the project advances, read from the same guide that defines the live project. It reads the
// project as the store holds it after its association refresh, so the prompt shows the tasks already associated, and
// merges the returned ideas into the kept ones. Each idea names the recently updated task note it should be created in. A project no rater can judge offers the provider its pool of open tasks
// to attribute; one a rater judges offers none, so a task is never claimed by two judges. A provider call that fails
// fails the attempt for the queue to retry, or, with no provider configured at all, waits for a settings change; an
// answer with nothing usable completes it. When new ideas were added and something can rate them, their actionability
// rating is asked for as a follow-up job, so a rating never delays the ideas being saved.
import { generatedIdeas, ideaCandidateTasks, projectIntentTexts } from "dashboard/project-collection-steps";
import { TASK_LINK_REASONS } from "dashboard/project-task-evidence";
import { ideaRatingsRevision } from "dashboard/project-task-idea-ratings";
import { generateProjectTaskIdeas } from "dashboard/project-task-ideas";
import { ideasInputRevision } from "dashboard/quarter-project-refresh-state";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { dispatchedPromptRunner, generativeProviderAvailable, jobPriorityContext, projectJobScope,
  readProjectJobDestinationNotes, readProjectJobInputs, readProjectJobTasks, validateProjectJobInput,
} from "dashboard/work-queue/jobs/project-job-inputs";
import { GENERATE_PROJECT_IDEAS_JOB_TYPE, projectIdeaRatingsRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";

export { GENERATE_PROJECT_IDEAS_JOB_TYPE };

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, projectUuid, quarter, year }. A completed
//   attempt reports the ideas input revision it recorded; a project that has left the live plan retires its job.
// @param {object} [options] - An object with the following properties:
//   - {function} [ideaGenerator=generateProjectTaskIdeas] - Injected for tests; receives promptRunner among its options
//   - {function} [providerAvailable=generativeProviderAvailable] - (app) => whether any generative provider is configured
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
//   - {function} [taskScorer=projectTaskScorer] - (app) => "jev", "generative", or null when nothing can rate
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createGenerateProjectIdeasHandler({ ideaGenerator = generateProjectTaskIdeas,
  providerAvailable = generativeProviderAvailable, quarterlyContentReader, repositoryFactory = app => new QuarterProjectRepository({ app }),
  taskScorer = projectTaskScorer } = {}) {
  const dependencies = { ideaGenerator, providerAvailable, quarterlyContentReader, repositoryFactory, taskScorer };
  return {
    appliedRevision: ({ context, job }) => _appliedRevision({ context, job, repositoryFactory }),
    run: ({ context, job, signal }) => _ideasAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: GENERATE_PROJECT_IDEAS_JOB_TYPE,
    validateInput: input => validateProjectJobInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The ideas input revision the stored project last recorded, so an attempt interrupted after writing its
//   result completes without asking again. A job with no desired revision is not checked.
// @param {object} options - { context, job, repositoryFactory }.
// @returns {Promise<string|null>} The stored revision, or null.
async function _appliedRevision({ context, job, repositoryFactory }) {
  if (job.desiredRevision === null) return null;
  const stored = await repositoryFactory(context.app).readOne(projectJobScope(job.input), job.input.projectUuid);
  return stored?.refreshState.ideas?.inputRevision || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Write what the provider returned through the project's setters, onto the project as the store holds it: the
//   tasks it attributed join the associations as assigned tasks, the merged ideas replace the kept ones, and the refresh is recorded.
// @param {QuarterProject} project - Project to update in place.
// @param {object} options - { ideas, inputRevision, now }: ideas from generatedIdeas.
function _applyGeneratedIdeas(project, { ideas, inputRevision, now }) {
  const relatedTaskUuids = new Set(project.relatedTaskRecords.map(record => record.taskUuid));
  const unlistedRecords = ideas.foundRecords.filter(record => !relatedTaskUuids.has(record.taskUuid));
  const addedRecords = unlistedRecords.map(record => ({ ...record, linkedBy: TASK_LINK_REASONS.assigned }));
  project.addRelatedTaskUuids(ideas.foundRecords.map(record => record.taskUuid));
  project.setRelatedTaskRecords([...project.relatedTaskRecords, ...addedRecords]);
  project.setSuggestedTasks(ideas.mergedIdeas, { generatedAt: ideas.generatedAt });
  project.setAttemptedAt(now.toISOString());
  project.recordRefreshSuccess("ideas", { inputRevision, succeededAt: now.toISOString() });
}

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the project, offer the provider a pool when no rater can judge the project, offer it the
//   recently updated task notes an idea may be filed in, ask for ideas through the runtime's generative permit, and
//   write the result.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { followUps, revision }, followUps holding the rating of new ideas when there are some and
//   a rater exists, or { status: "superseded" } when the project has left the live plan.
// @throws When the provider call failed, marked as a configuration failure when no provider is configured.
async function _ideasAttempt({ context, dependencies, job, signal }) {
  const { app } = context;
  const now = new Date(context.clock());
  const repository = dependencies.repositoryFactory(app);
  const { guide, liveProject, quarterlyContent, scope, stored } = await readProjectJobInputs(app, job.input,
    { quarterlyContentReader: dependencies.quarterlyContentReader, repository });
  if (!liveProject) return { status: "superseded" };
  const project = liveProject.detachedCopy();
  if (stored) project.adoptStoreFields(stored);
  const scorerEm = await dependencies.taskScorer(app);
  const offerPool = !scorerEm;
  const tasks = offerPool ? await readProjectJobTasks(context, { domainUuid: job.input.domainUuid, signal }) : [];
  project.setCandidateTasks(ideaCandidateTasks(tasks, { offerPool, relatedTaskRecords: project.relatedTaskRecords }));
  const destinationNotes = await readProjectJobDestinationNotes(context, { domainUuid: job.input.domainUuid, signal });
  const promptRunner = dispatchedPromptRunner(context, { signal });
  const ideaGenerator = (currentApp, options) => dependencies.ideaGenerator(currentApp, { ...options, promptRunner });
  const ideas = await generatedIdeas(app, { destinationNotes, ideaGenerator, intentTexts: projectIntentTexts(guide, project),
    keptIdeas: project.suggestedTasks, now, project, quarterlyContent });
  if (ideas.requestFailed) {
    const error = new Error(`Ideas for "${ project.summary }" failed: ${ ideas.failureReason }`);
    if (!(await dependencies.providerAvailable(app))) error.workFailure = "configuration";
    throw error;
  }
  if (signal?.aborted) return { status: "superseded" };
  const inputRevision = ideasInputRevision(project);
  const written = await repository.applyResult(scope, { apply: target => _applyGeneratedIdeas(target, { ideas, inputRevision,
    now }), sourceProject: liveProject });
  const ratingsRevision = ideas.generatedAt && scorerEm ? ideaRatingsRevision(written.suggestedTasks, now) : null;
  const followUps = ratingsRevision ? [projectIdeaRatingsRequest(job.input, { desiredRevision: ratingsRevision,
    projectUuid: project.uuid })] : [];
  return { followUps, revision: inputRevision };
}
