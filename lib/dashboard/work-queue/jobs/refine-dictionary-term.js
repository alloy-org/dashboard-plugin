// The queued job that refines one plugin-owned dictionary definition from the evidence its collection saved. It reads
// the dictionary and the evidence note fresh, retiring when the term is gone, the user has adopted its definition, or
// its saved passages were already refined from or given up; otherwise it asks the generative provider through the
// runtime's permit, commits an accepted rewrite after rechecking ownership, and records how the refinement ended on the
// evidence record. Its revision is the evidence's source digest, recorded with the refinement, so an attempt that
// stopped after recording completes without asking again. A changed definition is noticed by the next ranking through
// the dictionary's revisions note, which re-rates only the tasks that name the term. A provider failure fails the
// attempt for the queue to retry, or, with no provider configured, waits for a settings change; keeping the old
// definition completes it.
import { dispatchedPromptRunner, generativeProviderAvailable, jobPriorityContext } from "dashboard/work-queue/jobs/project-job-inputs";
import { REFINE_DICTIONARY_TERM_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { recordedTermRefinement, storedTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence-store";
import { COMMIT_STATUSES, committedTermDefinition, REFINEMENT_OUTCOMES,
  refineDictionaryTerm } from "plan-wizard/stack-rank/dictionary-term-refinement";
import { termRefinementDue } from "plan-wizard/stack-rank/dictionary-term-schedule";
import { dictionaryEntriesFromContent, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";

export { REFINE_DICTIONARY_TERM_JOB_TYPE };

// The longest term a job accepts, matching the evidence job.
const MAXIMUM_TERM_CHARACTERS = 100;

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { term, year }.
// @param {object} [options] - An object with the following properties:
//   - {function} [definitionCommitter=committedTermDefinition] - (app, { definition, expectedDefinition, term, year })
//     => one of COMMIT_STATUSES
//   - {function} [dictionaryReader=readUserTermsDictionary] - (app, year) => the dictionary's markdown, or null
//   - {function} [evidenceReader=storedTermEvidence] - (app, { year }) => records keyed by lowercased term
//   - {function} [promptRunner=raceWizardPrompt] - The request each generative permit admits; injected for tests
//   - {function} [providerAvailable=generativeProviderAvailable] - (app) => whether any generative provider is configured
//   - {function} [refinementRecorder=recordedTermRefinement] - (app, { consumedPassages, refinement, term, year })
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createRefineDictionaryTermHandler({ definitionCommitter = committedTermDefinition, dictionaryReader = readUserTermsDictionary,
  evidenceReader = storedTermEvidence, promptRunner = raceWizardPrompt, providerAvailable = generativeProviderAvailable,
  refinementRecorder = recordedTermRefinement } = {}) {
  const dependencies = { definitionCommitter, dictionaryReader, evidenceReader, promptRunner, providerAvailable, refinementRecorder };
  return {
    appliedRevision: ({ context, job }) => _appliedRevision({ context, evidenceReader, job }),
    run: ({ context, job, signal }) => _refinementAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: REFINE_DICTIONARY_TERM_JOB_TYPE,
    validateInput: input => _validateRefinementInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The source digest the term was last refined from, so an attempt interrupted after recording its refinement
//   completes without asking again.
// @param {object} options - { context, evidenceReader, job }.
// @returns {Promise<string|null>} The digest, or null.
async function _appliedRevision({ context, evidenceReader, job }) {
  const evidenceByTermKey = await evidenceReader(context.app, { year: job.input.year });
  return evidenceByTermKey[job.input.term.toLowerCase()]?.refinement?.sourceDigest || null;
}

// ----------------------------------------------------------------------------------------------
// @desc The refinement outcome recorded for a rewrite that could not be committed, by why it could not.
// @param {string} commitStatus - One of COMMIT_STATUSES.
// @returns {string} The outcome recorded.
function _commitOutcome(commitStatus) {
  if (commitStatus === COMMIT_STATUSES.written) return REFINEMENT_OUTCOMES.refined;
  return commitStatus;
}

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: read the term's definition and evidence, ask for a refinement, commit an accepted rewrite,
//   and record the outcome.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { evidenceQuality, outcome, revision, term }, or { status: "superseded" } when there is
//   nothing to refine or the definition was rewritten while the provider answered.
// @throws When a note cannot be read or written, or the provider call failed, marked as a configuration failure when
//   no provider is configured.
async function _refinementAttempt({ context, dependencies, job, signal }) {
  const { term, year } = job.input;
  const termKey = term.toLowerCase();
  const read = operation => (context.appDispatch ? context.appDispatch.read(operation, { signal }) : operation(context.app));
  const content = await read(app => dependencies.dictionaryReader(app, year));
  const entry = content === null ? null : dictionaryEntriesFromContent(content).find(candidate => candidate.term.toLowerCase() === termKey);
  if (!entry?.isBuilderOwned) return { status: "superseded" };
  const evidenceByTermKey = await read(app => dependencies.evidenceReader(app, { year }));
  const evidence = evidenceByTermKey[termKey];
  if (!termRefinementDue(evidence)) return { status: "superseded" };
  const promptRunner = dispatchedPromptRunner(context, { promptRunner: dependencies.promptRunner, signal });
  const refinement = await refineDictionaryTerm(context.app, { definition: entry.definition, evidence, promptRunner });
  if (refinement.outcome === REFINEMENT_OUTCOMES.failed) {
    const error = new Error(`Refining "${ term }" failed: ${ refinement.failureReason }`);
    if (!(await dependencies.providerAvailable(context.app))) error.workFailure = "configuration";
    throw error;
  }
  if (signal?.aborted) return { status: "superseded" };
  const now = new Date(context.clock()).toISOString();
  let outcome = refinement.outcome;
  if (outcome === REFINEMENT_OUTCOMES.refined) {
    const commitStatus = await dependencies.definitionCommitter(context.app, { definition: refinement.definition,
      expectedDefinition: entry.definition, term: entry.term, year });
    outcome = _commitOutcome(commitStatus);
  }
  // A definition rewritten by someone else meanwhile keeps its passages and no digest, and the job retires rather than
  // completing at this revision, so the next request for the same evidence refines the new definition.
  const rewrittenMeanwhile = outcome === COMMIT_STATUSES.changed;
  const sourceDigest = rewrittenMeanwhile ? null : evidence.sourceDigest;
  await dependencies.refinementRecorder(context.app, { consumedPassages: !rewrittenMeanwhile, refinement: { attemptedAt: now,
    citedNoteUuids: refinement.citedNoteUuids, evidenceQuality: refinement.evidenceQuality, keptReason: refinement.keptReason, outcome,
    refinedAt: outcome === REFINEMENT_OUTCOMES.refined ? now : undefined, sourceDigest, uncertainty: refinement.uncertainty }, term, year });
  if (rewrittenMeanwhile) return { status: "superseded" };
  return { evidenceQuality: refinement.evidenceQuality, outcome, revision: evidence.sourceDigest, term: entry.term };
}

// ----------------------------------------------------------------------------------------------
// @desc Check a refinement job's input before it is queued.
// @param {object} input - { term, year }.
// @throws When the term is missing or too long, or the year is not a whole number.
function _validateRefinementInput(input) {
  if (!input || typeof input !== "object") throw new Error("A refinement job needs an input");
  const { term, year } = input;
  if (typeof term !== "string" || !term.trim()) throw new Error("A refinement job needs a term");
  if (term.length > MAXIMUM_TERM_CHARACTERS) throw new Error(`A refinement job's term must be at most ${ MAXIMUM_TERM_CHARACTERS } characters`);
  if (!Number.isInteger(year)) throw new Error("A refinement job needs a year");
}
