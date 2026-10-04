// Assemble the context every project's stack rank shares: the quarter's current projects, as the background
// project-task collection pass last stored them, and the user's terms dictionary. Before returning, projects that
// have not yet been examined for vocabulary are sent through term discovery, so a project named "Diff Digest
// launch" arrives at Jev alongside a definition of Diff Digest rather than as an opaque phrase.
import { readCollectedProjectTasks } from "dashboard/project-task-store";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { discoverDictionaryTerms, textContainsTerm } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { dictionaryEntriesFromContent, dictionaryObjectFromEntries, examinedProjectSummaries, mergedDictionaryContent,
  openUserTermsDictionary, readUserTermsDictionary, writeUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const CONTEXT_LOG_LABEL = "[build-project-task-context]";

// ----------------------------------------------------------------------------------------------
// @desc Collect the current projects and the dictionary, growing the dictionary first when any project is new
//   to it. A discovery failure leaves those projects unexamined so the next pass retries them, and still returns
//   the dictionary as it stood: ranking with an incomplete dictionary beats not ranking.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {Date} [now=new Date()] - Selects the quarter and the dictionary's year
//   - {Array<object>} [projects] - The quarter's projects; read from the project task store when omitted. The
//     background pass supplies its own, since a project new to the plan is not in the store until the pass writes it
//   - {function} [promptRunner] - Injected into term discovery for tests
//   - {boolean} [refineDictionary=true] - False reads the dictionary without contacting a provider
// @returns {Promise<object>} An object with the following properties:
//   - {object} dictionary - Definitions keyed by term
//   - {object} dictionaryChanges - { addedTerms, failureReason, refinedTerms }
//   - {string} dictionaryNoteUuid - The dictionary note
//   - {Array<object>} projects - The projects supplied, or the active records the store holds
//   - {object} scope - The resolved quarter scope
export async function buildProjectTaskContext(app, { domainName, domainUuid, now = new Date(), projects: suppliedProjects,
    promptRunner, refineDictionary = true }) {
  const scope = resolvePlanScope({ domainName, domainUuid, quarter: Math.floor(now.getMonth() / 3) + 1,
    year: now.getFullYear() });
  const projects = suppliedProjects || await readCollectedProjectTasks(app, scope);
  const { content, noteHandle } = await openUserTermsDictionary(app, now.getFullYear());
  let dictionaryContent = content;
  let dictionaryChanges = { addedTerms: [], failureReason: null, refinedTerms: [] };
  if (refineDictionary) {
    const refinement = await _refinedDictionaryContent(app, { content, noteHandle, now, projects, promptRunner });
    dictionaryContent = refinement.content;
    dictionaryChanges = refinement.dictionaryChanges;
  }
  const dictionary = dictionaryObjectFromEntries(dictionaryEntriesFromContent(dictionaryContent));
  logIfEnabled(`${ CONTEXT_LOG_LABEL } context built`, { ...dictionaryChanges, projectCount: projects.length,
    termCount: Object.keys(dictionary).length });
  return { dictionary, dictionaryChanges, dictionaryNoteUuid: noteHandle.uuid, projects, scope };
}

// ----------------------------------------------------------------------------------------------
// @desc Narrow the dictionary to the terms that occur in the passages a request carries. Sending every term with
//   every batch would grow each request with the dictionary rather than with the work being rated.
// @param {object} dictionary - Definitions keyed by term.
// @param {Array<string>} passages - Project wording, task texts, note names, and tags.
// @returns {object} The subset of definitions whose term appears in some passage.
export function relevantDictionaryTerms(dictionary, passages) {
  const searchableText = passages.filter(Boolean).join("\n");
  const relevantEntries = Object.entries(dictionary).filter(([term]) => textContainsTerm(searchableText, term));
  return Object.fromEntries(relevantEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc The projects the year's dictionary has not yet examined for terms, read without creating or writing the note,
//   so a planner can tell whether discovery has anything to send before rankings read the dictionary. A year with no
//   dictionary note has examined nothing.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { now = new Date(), projects }: now selects the dictionary's year.
// @returns {Promise<Array<object>>} The projects discovery would send, in the order given.
export async function unexaminedDictionaryProjects(app, { now = new Date(), projects }) {
  const content = await readUserTermsDictionary(app, now.getFullYear());
  return _unexaminedProjects(content || "", projects);
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Run discovery over the projects the dictionary has not examined, and write what it found along with the
//   examined summaries. Nothing is written when no project is new.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { content, noteHandle, now, projects, promptRunner }.
// @returns {Promise<object>} { content, dictionaryChanges } with content as it now stands in the note.
async function _refinedDictionaryContent(app, { content, noteHandle, now, projects, promptRunner }) {
  const unexaminedProjects = _unexaminedProjects(content, projects);
  const unchanged = { content, dictionaryChanges: { addedTerms: [], failureReason: null, refinedTerms: [] } };
  if (!unexaminedProjects.length) return unchanged;
  const dictionaryEntries = dictionaryEntriesFromContent(content);
  const discoveryOptions = promptRunner ? { dictionaryEntries, projects: unexaminedProjects, promptRunner }
    : { dictionaryEntries, projects: unexaminedProjects };
  const { failureReason, terms } = await discoverDictionaryTerms(app, discoveryOptions);
  if (failureReason) return { content, dictionaryChanges: { ...unchanged.dictionaryChanges, failureReason } };
  const examinedSummaries = unexaminedProjects.map(project => project.summary);
  const merged = mergedDictionaryContent(content, { examinedOn: dateKeyFromDateInput(now), examinedSummaries,
    incomingEntries: terms });
  if (merged.content !== content) await writeUserTermsDictionary(app, noteHandle, merged.content);
  return { content: merged.content, dictionaryChanges: { addedTerms: merged.addedTerms, failureReason: null,
    refinedTerms: merged.refinedTerms } };
}

// ----------------------------------------------------------------------------------------------
// @desc The projects whose summary the dictionary's examined list does not hold, compared without case.
// @param {string} content - The dictionary note's markdown.
// @param {Array<object>} projects - Projects with a summary.
// @returns {Array<object>} The unexamined projects, in the order given.
function _unexaminedProjects(content, projects) {
  const examined = examinedProjectSummaries(content);
  const unexaminedProjects = projects.filter(project => !examined.has(project.summary.trim().toLowerCase()));
  return unexaminedProjects;
}
