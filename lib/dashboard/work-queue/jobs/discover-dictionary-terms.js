// The queued job that grows the user terms dictionary from a quarter's projects, with the discovery prompt the
// background collection pass sends before it ranks. Only projects the dictionary has not yet examined are sent, and
// the dictionary note records the ones that were, so running the job again once they are all examined makes no
// provider call. Ranking jobs read the dictionary as it stands rather than waiting for this one, so a slow or failed
// discovery never holds up similarity work; a provider failure fails the attempt for the queue to retry.
import QuarterProjectRepository from "dashboard/quarter-project-repository";

import { dispatchedPromptRunner, jobPriorityContext, readProjectJobInputs,
  validateProjectJobInput } from "dashboard/work-queue/jobs/project-job-inputs";
import { DISCOVER_DICTIONARY_TERMS_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { buildProjectTaskContext } from "plan-wizard/stack-rank/build-project-task-context";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";

export { DISCOVER_DICTIONARY_TERMS_JOB_TYPE };

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainName, domainUuid, quarter, year }.
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
    run: ({ context, job, signal }) => _discoveryAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: DISCOVER_DICTIONARY_TERMS_JOB_TYPE,
    validateInput: input => validateProjectJobInput(input, { requireProject: false }),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the quarter's live projects and send those the dictionary has not examined through
//   discovery, each request taking the runtime's generative permit.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { addedTerms, refinedTerms }.
// @throws When the provider call failed.
async function _discoveryAttempt({ context, dependencies, job, signal }) {
  const { app } = context;
  const { domainName, domainUuid } = job.input;
  const repository = dependencies.repositoryFactory(app);
  const { projects } = await readProjectJobInputs(app, job.input, { quarterlyContentReader: dependencies.quarterlyContentReader,
    repository });
  if (!projects.length) return { addedTerms: [], refinedTerms: [] };
  const promptRunner = dispatchedPromptRunner(context, { promptRunner: dependencies.promptRunner, signal });
  const { dictionaryChanges } = await dependencies.contextBuilder(app, { domainName, domainUuid, now: new Date(context.clock()),
    projects, promptRunner, refineDictionary: true });
  if (dictionaryChanges.failureReason) throw new Error(`Dictionary discovery failed: ${ dictionaryChanges.failureReason }`);
  return { addedTerms: dictionaryChanges.addedTerms, refinedTerms: dictionaryChanges.refinedTerms };
}
