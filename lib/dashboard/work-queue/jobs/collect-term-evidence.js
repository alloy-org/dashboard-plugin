// The queued job that collects one dictionary term's evidence from the notebook: the passages in the user's notes that
// show what the term means to them, which a later refinement reasons over. It makes no provider call. The term is
// checked against the dictionary as it stands first, so a term the user removed, or adopted by removing `[builder]`,
// while the job waited retires it rather than collecting for nothing. Its app reads take one read permit for the whole
// bounded collection, and the record it saves replaces the term's previous one in the year's evidence note. Finding no
// passage is a valid outcome, saved like any other, rather than a failure to retry. When the passages differ from the
// evidence the term was last refined from, the job asks for a refinement as its follow-up. A person's evidence adds
// their linked notes, the tasks naming them, and the notes shared with them (person-evidence.js), read from the
// domain's tasks and the recent-task scan's record of their links.
import { jobPriorityContext, readProjectJobTasks } from "dashboard/work-queue/jobs/project-job-inputs";
import { COLLECT_TERM_EVIDENCE_JOB_TYPE, termRefinementRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { collectTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence";
import { savedTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence-store";
import { termRefinementDue } from "plan-wizard/stack-rank/dictionary-term-schedule";
import { personEvidence } from "plan-wizard/stack-rank/person-evidence";
import { accountOwner } from "plan-wizard/stack-rank/person-mentions";
import { personLinksForNames, readTaskTermScan } from "plan-wizard/stack-rank/task-term-scan-store";
import { dictionaryEntriesFromContent, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";

export { COLLECT_TERM_EVIDENCE_JOB_TYPE };

// The longest term a job accepts; a dictionary term is a name, not a sentence.
const MAXIMUM_TERM_CHARACTERS = 100;

// ----------------------------------------------------------------------------------------------
// @desc Create the handler. Its job input is { domainUuid, mentionDigest, term, year }, domainUuid and mentionDigest
//   being optional.
// @param {object} [options] - An object with the following properties:
//   - {function} [dictionaryReader=readUserTermsDictionary] - (app, year) => the dictionary's markdown, or null
//   - {function} [evidenceCollector=collectTermEvidence] - (app, { now, term }) => an evidence record
//   - {function} [evidenceSaver=savedTermEvidence] - (app, { evidence, year }) => the record as saved, with the
//     refinement the term's previous record kept
//   - {function} [taskReader=readProjectJobTasks] - (context, { domainUuid, signal }) => tasks, read for a person
// @returns {object} A work handler, as workHandlerRegistry describes one.
export function createCollectTermEvidenceHandler({ dictionaryReader = readUserTermsDictionary, evidenceCollector = collectTermEvidence,
  evidenceSaver = savedTermEvidence, taskReader = readProjectJobTasks } = {}) {
  const dependencies = { dictionaryReader, evidenceCollector, evidenceSaver, taskReader };
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
// @desc Run one attempt: confirm the dictionary still defines the term as plugin-owned, collect its evidence, save it,
//   and ask for a refinement, at the collection's own priority, when the evidence is new to the term.
// @param {object} options - { context, dependencies, job, signal }.
// @returns {Promise<object>} { followUps, outcome, passageCount, sourceCount, term }, or { status: "superseded" } when
//   the dictionary no longer defines the term or the user has adopted its definition.
// @throws When the dictionary or a search cannot be read, or the evidence cannot be saved.
async function _collectionAttempt({ context, dependencies, job, signal }) {
  const { mentionDigest = null, term, year } = job.input;
  const now = new Date(context.clock());
  const read = operation => (context.appDispatch ? context.appDispatch.read(operation, { signal }) : operation(context.app));
  const content = await read(app => dependencies.dictionaryReader(app, year));
  const termKey = term.toLowerCase();
  const entries = content === null ? [] : dictionaryEntriesFromContent(content);
  const entry = entries.find(candidate => candidate.term.toLowerCase() === termKey);
  if (!entry?.isBuilderOwned) return { status: "superseded" };
  const searched = await read(app => dependencies.evidenceCollector(app, { now, term }));
  const collected = entry.isPerson ? await _personEvidence({ context, dependencies, entries, entry, evidence: searched, job, read, signal })
    : searched;
  const saved = await dependencies.evidenceSaver(context.app, { evidence: { ...collected, mentionDigest }, year });
  const followUps = termRefinementDue(saved) ? [termRefinementRequest({ term, year }, { category: job.category,
    sourceDigest: saved.sourceDigest })] : [];
  return { followUps, outcome: saved.outcome, passageCount: saved.passages.length, sourceCount: saved.sources.length, term };
}

// ----------------------------------------------------------------------------------------------
// @desc Widen a person's searched evidence with their links, tasks, and shared notes.
// @param {object} options - { context, dependencies, entries, entry, evidence, job, read, signal }: entries is the whole
//   dictionary, for the owner's names; read runs an operation under the job's read permit.
// @returns {Promise<object>} The evidence record personEvidence returns.
async function _personEvidence({ context, dependencies, entries, entry, evidence, job, read, signal }) {
  const names = [entry.term, ...entry.aliases];
  const scan = await read(app => readTaskTermScan(app, job.input.year));
  const tasks = await dependencies.taskReader(context, { domainUuid: job.input.domainUuid || null, signal });
  const owner = await accountOwner(context.app, entries);
  return read(app => personEvidence(app, { evidence, links: personLinksForNames(scan, names), names, ownerNames: owner.names, tasks }));
}

// ----------------------------------------------------------------------------------------------
// @desc Check an evidence job's input before it is queued.
// @param {object} input - { domainUuid, mentionDigest, term, year }.
// @throws When the term is missing or too long, the year is not a whole number, or mentionDigest or domainUuid is not a
//   string.
function _validateEvidenceInput(input) {
  if (!input || typeof input !== "object") throw new Error("An evidence job needs an input");
  const { term, year } = input;
  if (typeof term !== "string" || !term.trim()) throw new Error("An evidence job needs a term");
  if (term.length > MAXIMUM_TERM_CHARACTERS) throw new Error(`An evidence job's term must be at most ${ MAXIMUM_TERM_CHARACTERS } characters`);
  if (!Number.isInteger(year)) throw new Error("An evidence job needs a year");
  if (input.mentionDigest !== undefined && input.mentionDigest !== null && typeof input.mentionDigest !== "string") {
    throw new Error("An evidence job's mentionDigest must be a string or null");
  }
  if (input.domainUuid !== undefined && input.domainUuid !== null && typeof input.domainUuid !== "string") {
    throw new Error("An evidence job's domainUuid must be a string or null");
  }
}
