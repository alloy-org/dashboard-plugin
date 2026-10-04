// The queued job that collects one dictionary term's evidence from the notebook: the passages in the user's notes that
// show what the term means to them, which a later refinement reasons over. It makes no provider call. The term is
// checked against the dictionary as it stands first, so a term the user removed while the job waited retires it
// rather than collecting for nothing. Its app reads take one read permit for the whole bounded collection, and the
// record it saves replaces the term's previous one in the year's evidence note. Finding no passage is a valid outcome,
// saved like any other, rather than a failure to retry.
import { jobPriorityContext } from "dashboard/work-queue/jobs/project-job-inputs";
import { COLLECT_TERM_EVIDENCE_JOB_TYPE } from "dashboard/work-queue/jobs/project-job-requests";
import { collectTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence";
import { savedTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence-store";
import { dictionaryEntriesFromContent, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";

export { COLLECT_TERM_EVIDENCE_JOB_TYPE };

// The longest term a job accepts; a dictionary term is a name, not a sentence.
const MAXIMUM_TERM_CHARACTERS = 100;

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { term, year }.
// @param {object} [options] - An object with the following properties:
//   - {function} [dictionaryReader=readUserTermsDictionary] - (app, year) => the dictionary's markdown, or null
//   - {function} [evidenceCollector=collectTermEvidence] - (app, { now, term }) => an evidence record
//   - {function} [evidenceSaver=savedTermEvidence] - (app, { evidence, year }) => the record as saved
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createCollectTermEvidenceHandler({ dictionaryReader = readUserTermsDictionary, evidenceCollector = collectTermEvidence,
  evidenceSaver = savedTermEvidence } = {}) {
  const dependencies = { dictionaryReader, evidenceCollector, evidenceSaver };
  return {
    run: ({ context, job, signal }) => _collectionAttempt({ context: jobPriorityContext(context, job), dependencies, job, signal }),
    type: COLLECT_TERM_EVIDENCE_JOB_TYPE,
    validateInput: input => _validateEvidenceInput(input),
  };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run one attempt: confirm the dictionary still defines the term, collect its evidence, and save it.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { outcome, passageCount, sourceCount, term }, or { status: "superseded" } when the
//   dictionary no longer defines the term.
// @throws When the dictionary or a search cannot be read, or the evidence cannot be saved.
async function _collectionAttempt({ context, dependencies, job, signal }) {
  const { term, year } = job.input;
  const now = new Date(context.clock());
  const read = operation => (context.appDispatch ? context.appDispatch.read(operation, { signal }) : operation(context.app));
  const content = await read(app => dependencies.dictionaryReader(app, year));
  const termKey = term.toLowerCase();
  const defined = content !== null && dictionaryEntriesFromContent(content).some(entry => entry.term.toLowerCase() === termKey);
  if (!defined) return { status: "superseded" };
  const evidence = await read(app => dependencies.evidenceCollector(app, { now, term }));
  const saved = await dependencies.evidenceSaver(context.app, { evidence, year });
  return { outcome: saved.outcome, passageCount: saved.passages.length, sourceCount: saved.sources.length, term };
}

// ----------------------------------------------------------------------------------------------
// @desc Check an evidence job's input before it is queued.
// @param {object} input - { term, year }.
// @throws When the term is missing or too long, or the year is not a whole number.
function _validateEvidenceInput(input) {
  if (!input || typeof input !== "object") throw new Error("An evidence job needs an input");
  const { term, year } = input;
  if (typeof term !== "string" || !term.trim()) throw new Error("An evidence job needs a term");
  if (term.length > MAXIMUM_TERM_CHARACTERS) throw new Error(`An evidence job's term must be at most ${ MAXIMUM_TERM_CHARACTERS } characters`);
  if (!Number.isInteger(year)) throw new Error("An evidence job needs a year");
}
