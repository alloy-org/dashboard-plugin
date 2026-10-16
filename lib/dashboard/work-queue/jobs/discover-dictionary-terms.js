// Grow the user terms dictionary from a quarter's projects before ranking. Only projects the dictionary has not
// yet examined are sent, and
// the dictionary note records the ones that were, so running the job again once they are all examined makes no
// provider call. Ranking jobs read the dictionary as it stands, so while it has projects to examine the planner holds
// their requests inside this job's input, and the job submits them once it finishes. It submits them when it fails,
// too, so a failed discovery never holds up similarity work; the failure still fails the attempt for the queue to
// retry, and a retry that succeeds submits them again to rank with the grown dictionary.
import { pluralize } from "app-util";
import QuarterProjectRepository from "dashboard/quarter-project-repository";

import { dispatchedPromptRunner, jobPriorityContext, readProjectJobInputs,
  validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { DISCOVER_DICTIONARY_TERMS_JOB_TYPE, heldRankingRequests } from "dashboard/work-queue/jobs/project-job-requests";
import { buildProjectTaskContext } from "plan-wizard/stack-rank/build-project-task-context";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";

export { DISCOVER_DICTIONARY_TERMS_JOB_TYPE };

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, heldRankingCategory, heldRankings, heldRequests,
//   quarter, year }: heldRankings ({ projectUuid, desiredRevision? }) and heldRequests (full requests, as earlier
//   versions wrote them) are optional work to submit as follow-ups once the attempt finishes, successfully or not.
// @param {object} [options] - An object with the following properties:
//   - {function} [contextBuilder=buildProjectTaskContext] - Injected for tests; refines and reads the dictionary
//   - {function} [promptRunner=raceWizardPrompt] - Injected for tests; the request each generative permit admits
//   - {function} [quarterlyContentReader] - Injected for tests; reads the quarterly plan note's markdown
//   - {function} [repositoryFactory] - (app) => QuarterProjectRepository; injected for tests
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createDiscoverDictionaryTermsHandler({ contextBuilder = buildProjectTaskContext, promptRunner = raceWizardPrompt,
  quarterlyContentReader, repositoryFactory = app => new QuarterProjectRepository({ app }) } = {}) {
  const dependencies = { contextBuilder, promptRunner, quarterlyContentReader, repositoryFactory };
  return {
    run: ({ context, job, signal }) => _discoveryAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal })
      .catch(error => { throw _failureReleasingHeldRequests(error, heldRankingRequests(job.input)); }),
    type: DISCOVER_DICTIONARY_TERMS_JOB_TYPE,
    validateInput: input => _validateDiscoveryInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the quarter's live projects and send those the dictionary has not examined through
//   discovery, each request taking the runtime's generative permit.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { addedTerms, followUps, outcomeDetail, outcomeFacts, refinedTerms }: followUps are the
//   requests the input held; outcomeFacts repeats the added and refined terms for an outcome listener.
// @throws When the provider call failed.
async function _discoveryAttempt({ context, dependencies, job, signal }) {
  const { app } = context;
  const { domainName, domainUuid } = job.input;
  const heldRequests = heldRankingRequests(job.input);
  const repository = dependencies.repositoryFactory(app);
  const { projects } = await readProjectJobInputs(app, job.input, { quarterlyContentReader: dependencies.quarterlyContentReader,
    repository });
  if (!projects.length) return _discoveryResult({ addedTerms: [], followUps: heldRequests, refinedTerms: [] });
  const promptRunner = dispatchedPromptRunner(context, { promptRunner: dependencies.promptRunner, signal });
  const { dictionaryChanges } = await dependencies.contextBuilder(app, { domainName, domainUuid, now: new Date(context.clock()),
    projects, promptRunner, refineDictionary: true });
  if (dictionaryChanges.failureReason) throw new Error(`Dictionary discovery failed: ${ dictionaryChanges.failureReason }`);
  return _discoveryResult({ addedTerms: dictionaryChanges.addedTerms, followUps: heldRequests, refinedTerms: dictionaryChanges.refinedTerms });
}

// ----------------------------------------------------------------------------------------------
// @desc A discovery attempt's result, saying for the queue inspector and outcome listeners which terms it added and
//   refined.
// @param {object} result - { addedTerms, followUps, refinedTerms }: term lists as strings.
// @returns {object} The result with outcomeDetail and outcomeFacts.
function _discoveryResult({ addedTerms, followUps, refinedTerms }) {
  const outcomeDetail = `Added ${ pluralize(addedTerms.length, "term") }, refined ${ refinedTerms.length }`;
  return { addedTerms, followUps, outcomeDetail, outcomeFacts: { addedTerms, refinedTerms }, refinedTerms };
}

// ----------------------------------------------------------------------------------------------
// @desc Attach the held requests to a failed attempt's error, which the runner submits as follow-up work after it
//   records the failure, so rankings never wait on a provider discovery cannot reach.
// @param {*} error - What the attempt threw.
// @param {Array<object>} heldRequests - The requests the job input held, from heldRankingRequests.
// @returns {Error} The error to throw, with followUps set when requests were held.
function _failureReleasingHeldRequests(error, heldRequests) {
  const failure = error instanceof Error ? error : new Error(String(error));
  if (heldRequests?.length) failure.followUps = heldRequests;
  return failure;
}

// ----------------------------------------------------------------------------------------------
// @desc Check a discovery input: the quarter fields every project job needs, held rankings, when present, as a list
//   each naming a project, and held requests, when present, as a list of requests each naming a key and type.
// @param {object} input - The job input.
// @throws When the input is unusable.
function _validateDiscoveryInput(input) {
  validateProjectJobInput(input, { requireProject: false });
  const { heldRankingCategory, heldRankings, heldRequests } = input;
  if (heldRankingCategory !== undefined && typeof heldRankingCategory !== "string") throw new Error("A discovery job's heldRankingCategory must be a string");
  if (heldRankings !== undefined && !Array.isArray(heldRankings)) throw new Error("A discovery job's heldRankings must be a list");
  if (heldRankings?.some(ranking => typeof ranking?.projectUuid !== "string" || !ranking.projectUuid)) {
    throw new Error("Each held ranking needs a projectUuid");
  }
  if (heldRequests === undefined) return;
  if (!Array.isArray(heldRequests)) throw new Error("A discovery job's heldRequests must be a list");
  if (heldRequests.some(request => !request?.key || !request?.type)) throw new Error("Each held request needs a key and type");
}
