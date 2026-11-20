// The queued job that asks the generative provider for one project's next-action ideas, and for tasks scattered across
// the user's notes that belong to it. The prompt leads
// with the Plan Builder intents the project advances, read from the same guide that defines the live project. It reads the
// project as the store holds it after its association refresh, so the prompt shows the tasks already associated, and
// merges the returned ideas into the kept ones. Each idea names the recently updated task note it should be created in. A project no rater can judge offers the provider its pool of open tasks
// to attribute; one a rater judges offers none, so a task is never claimed by two judges. A provider call that fails
// fails the attempt for the queue to retry, or, with no provider configured at all, waits for a settings change; an
// answer with nothing usable completes it. When new ideas were added and something can rate them, their actionability
// rating is asked for as a follow-up job at the ideas job's own priority, so a rating never delays the ideas being saved. A project that already holds
// enough well-rated ideas (see ideasSaturated) asks the provider nothing: the attempt drops the ideas it no longer
// keeps and asks for ratings of any still unrated. When the user asked for ideas (exceedBestIdeas), such a project
// instead asks for IDEAS_TO_EXCEED_BEST_COUNT ideas that would outscore its strongest ones, which compete for a place
// once rated. A project its ratings judged too abstract (see projectTooAbstract) asks the provider nothing either,
// until its summary changes. Either prompt carries the user's definitions of the dictionary terms the project's
// summary or intents use.
import { pluralize } from "app-util";
import { generatedIdeas, ideaCandidateTasks, projectIntentTexts } from "dashboard/project-tasks/project-collection-steps";
import { TASK_LINK_REASONS } from "dashboard/project-tasks/project-task-evidence";
import { IDEA_KEEPING_AVERAGE_MINIMUM, ideaRatingsRevision, ideasSaturated, keptIdeaRecords, projectTooAbstract, strongestRatedIdeas } from "dashboard/project-tasks/project-task-idea-ratings";
import { generateProjectTaskIdeas } from "dashboard/project-tasks/project-task-ideas";
import { ideasInputRevision } from "dashboard/quarter-project-refresh-state";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { dictionaryDefinitions } from "dashboard/work-queue/jobs/completed-task-job-steps";
import { dispatchedPromptRunner, generativeProviderAvailable, jobPriorityContext, projectJobScope,
  readProjectJobDestinationNotes, readProjectJobInputs, readProjectJobTasks, validateProjectJobInput,
} from "dashboard/work-queue/jobs/project-job-inputs";
import { GENERATE_PROJECT_IDEAS_JOB_TYPE, projectIdeaRatingsRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { projectTaskScorer } from "plan-wizard/stack-rank/stack-rank-project-tasks";

export { GENERATE_PROJECT_IDEAS_JOB_TYPE };

// How many ideas a saturated project is asked for when the user asks it to beat its strongest ideas.
export const IDEAS_TO_EXCEED_BEST_COUNT = 3;

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, exceedBestIdeas?, ideaCount?, projectUuid, quarter,
//   year }, ideaCount asking for more ideas than the background pass's DEFAULT_IDEAS_PER_PROJECT, and exceedBestIdeas
//   asking a saturated project for ideas to beat its strongest. A completed attempt reports the ideas input revision it
//   recorded; a project that has left the live plan retires its job.
// @param {object} [options] - An object with the following properties:
//   - {function} [dictionaryReader=dictionaryDefinitions] - (app, year) => definitions keyed by term
//   - {function} [ideaGenerator=generateProjectTaskIdeas] - Injected for tests; receives promptRunner among its options
//   - {function} [providerAvailable=generativeProviderAvailable] - (app) => whether any generative provider is configured
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
//   - {function} [taskScorer=projectTaskScorer] - (app) => "jev", "generative", or null when nothing can rate
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createGenerateProjectIdeasHandler({ dictionaryReader = dictionaryDefinitions, ideaGenerator = generateProjectTaskIdeas,
  providerAvailable = generativeProviderAvailable, quarterlyContentReader, repositoryFactory = app => new QuarterProjectRepository({ app }),
  taskScorer = projectTaskScorer } = {}) {
  const dependencies = { dictionaryReader, ideaGenerator, providerAvailable, quarterlyContentReader, repositoryFactory, taskScorer };
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
//   write the result. A saturated project the user asked to beat its strongest ideas is offered no pool, is asked for
//   IDEAS_TO_EXCEED_BEST_COUNT ideas against those ideas and their ratings, and first drops the ideas it no longer keeps.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { followUps, outcomeDetail, outcomeSubject, revision }, followUps holding the rating of new
//   ideas when there are some and a rater exists, and outcomeDetail and outcomeSubject saying for the queue inspector
//   how many ideas were generated and kept for which project; or { status: "superseded" } when the project has left
//   the live plan or is too abstract to suggest anything for.
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
  if (projectTooAbstract(project)) return { status: "superseded" };
  const scorerEm = await dependencies.taskScorer(app);
  const saturated = ideasSaturated(project.suggestedTasks);
  if (saturated && !job.input.exceedBestIdeas) {
    return _saturatedAttempt({ category: job.category, input: job.input, liveProject, now, project, repository, scope, scorerEm });
  }
  const offerPool = !scorerEm && !saturated;
  const tasks = offerPool ? await readProjectJobTasks(context, { domainUuid: job.input.domainUuid, signal }) : [];
  project.setCandidateTasks(ideaCandidateTasks(tasks, { offerPool, relatedTaskRecords: project.relatedTaskRecords }));
  const destinationNotes = await readProjectJobDestinationNotes(context, { domainUuid: job.input.domainUuid, signal });
  const promptRunner = dispatchedPromptRunner(context, { signal });
  const ideaGenerator = (currentApp, options) => dependencies.ideaGenerator(currentApp, { ...options, promptRunner });
  const intentTexts = projectIntentTexts(guide, project);
  const dictionaryTerms = await _projectDictionaryTerms(app, { dictionaryReader: dependencies.dictionaryReader, intentTexts,
    project, year: job.input.year });
  const ideasToBeat = saturated ? strongestRatedIdeas(project.suggestedTasks) : [];
  const keptIdeas = saturated ? keptIdeaRecords(project.suggestedTasks, { completedTasks: project.completedTasks }) : project.suggestedTasks;
  const ideaCount = saturated ? IDEAS_TO_EXCEED_BEST_COUNT : job.input.ideaCount;
  const ideas = await generatedIdeas(app, { destinationNotes, dictionaryTerms, ideaCount, ideaGenerator, ideasToBeat, intentTexts,
    keptIdeas, now, project, quarterlyContent });
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
  const followUps = ratingsRevision ? [projectIdeaRatingsRequest(job.input, { category: job.category, desiredRevision: ratingsRevision,
    projectUuid: project.uuid })] : [];
  const outcomeDetail = _ideasOutcomeDetail(ideas, { ideasToBeatCount: ideasToBeat.length });
  return { followUps, outcomeDetail, outcomeSubject: project.summary, revision: inputRevision };
}

// ----------------------------------------------------------------------------------------------
// @desc The user's definitions of the dictionary terms the project's summary, next action, or intents use. A dictionary
//   that cannot be read defines none, since ideas without definitions beat no ideas.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { dictionaryReader, intentTexts, project, year }: dictionaryReader is (app, year) =>
//   definitions keyed by term.
// @returns {Promise<object>} Definitions keyed by term.
async function _projectDictionaryTerms(app, { dictionaryReader, intentTexts, project, year }) {
  const dictionary = await dictionaryReader(app, year);
  const passages = [project.summary, project.nextAction, ...intentTexts];
  return relevantDictionaryTerms(dictionary || {}, passages);
}

// ----------------------------------------------------------------------------------------------
// @desc Finish an attempt for a project that already holds enough well-rated ideas, without asking the provider: drop
//   the ideas keptIdeaRecords no longer keeps from the ideas as the store holds them, record the refresh, and ask for
//   ratings of any ideas still unrated, so each idea left either earns its place or is dropped by a later attempt.
// @param {object} options - { category, input, liveProject, now, project, repository, scope, scorerEm }: project is the
//   live project with the store's fields adopted; category is the job's, which its rating follow-up keeps.
// @returns {Promise<object>} { followUps, outcomeDetail, outcomeSubject, revision }, as _ideasAttempt returns them.
async function _saturatedAttempt({ category, input, liveProject, now, project, repository, scope, scorerEm }) {
  const inputRevision = ideasInputRevision(project);
  let removedCount = 0;
  const written = await repository.applyResult(scope, { apply: target => {
    const keptIdeas = keptIdeaRecords(target.suggestedTasks, { completedTasks: target.completedTasks });
    removedCount = target.suggestedTasks.length - keptIdeas.length;
    target.setSuggestedTasks(keptIdeas);
    target.recordRefreshSuccess("ideas", { inputRevision, succeededAt: now.toISOString() });
  }, sourceProject: liveProject });
  const ratingsRevision = scorerEm ? ideaRatingsRevision(written.suggestedTasks, now) : null;
  const followUps = ratingsRevision ? [projectIdeaRatingsRequest(input, { category, desiredRevision: ratingsRevision,
    projectUuid: project.uuid })] : [];
  const outcomeDetail = `Skipped generation: enough ideas rated ${ IDEA_KEEPING_AVERAGE_MINIMUM }+; removed ${ pluralize(removedCount, "idea") }`;
  return { followUps, outcomeDetail, outcomeSubject: project.summary, revision: inputRevision };
}

// ----------------------------------------------------------------------------------------------
// @desc Describe what an attempt's provider answer contributed, for the queue inspector and the run summary.
// @param {object} ideas - From generatedIdeas.
// @param {object} options - { ideasToBeatCount }: how many rated ideas the new ones were asked to outscore, 0 for none.
// @returns {string} Such as "Generated 5 ideas, kept 3; attributed 2 tasks", or "Generated 3 ideas to beat the 12
//   best, kept 3" when the attempt challenged the project's strongest ideas.
function _ideasOutcomeDetail({ addedCount, foundRecords, generatedCount }, { ideasToBeatCount }) {
  const challenge = ideasToBeatCount ? ` to beat the ${ ideasToBeatCount } best` : "";
  const ideaText = `Generated ${ pluralize(generatedCount, "idea") }${ challenge }, kept ${ addedCount }`;
  return foundRecords.length ? `${ ideaText }; attributed ${ pluralize(foundRecords.length, "task") }` : ideaText;
}
