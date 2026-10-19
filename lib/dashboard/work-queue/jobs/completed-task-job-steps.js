// The steps the two completed task jobs share: the job that records which project each completed task advanced, and
// the job that rates the potential of the project tasks it recorded. Each reads the quarter's active projects and the
// terms dictionary, asks the DecisionsEndpoint under the job's provider permits, reads Amplenote through the job's app
// dispatcher, and adds entries to the quarter's completed task ledger in that ledger's write chain.
import { completedTaskLedgerNoteName, ledgerEntriesFromContent, mergedLedgerEntries, openCompletedTaskLedger,
  writeLedgerDateSection } from "dashboard/projects/completed-task-project-ledger";
import { projectIntentTexts } from "dashboard/project-tasks/project-collection-steps";
import { readProjectJobInputs } from "dashboard/work-queue/jobs/project-job-inputs";
import { dictionaryEntriesFromContent, dictionaryObjectFromEntries, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { logIfEnabled } from "util/log";

const COMPLETED_TASK_JOB_LOG_LABEL = "[completed-task-jobs]";

// ----------------------------------------------------------------------------------------------
// @desc The quarter's active projects as the live plan holds them, each carrying the open tasks the project task store
//   associated with it, and the plan goals each one serves.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} quarterInput - { domainName, domainUuid, quarter, year }.
// @param {object} dependencies - { quarterlyContentReader, repositoryFactory }.
// @returns {Promise<object>} { intentTextsByProjectUuid, projects }.
export async function activeQuarterProjects(app, quarterInput, { quarterlyContentReader, repositoryFactory }) {
  const { guide, projects: liveProjects, storedProjects } = await readProjectJobInputs(app, quarterInput,
    { quarterlyContentReader, repository: repositoryFactory(app) });
  const storedByUuid = new Map(storedProjects.map(project => [project.uuid, project]));
  const projects = liveProjects.map(liveProject => {
    const project = liveProject.detachedCopy();
    if (storedByUuid.has(project.uuid)) project.adoptStoreFields(storedByUuid.get(project.uuid));
    return project;
  });
  const intentTextsByProjectUuid = new Map(projects.map(project => [project.uuid, projectIntentTexts(guide, project)]));
  return { intentTextsByProjectUuid, projects };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the year's terms dictionary as definitions keyed by term. A year without one, or one that cannot be read,
//   gives no definitions, since deciding without them beats not deciding.
// @param {object} app - Host-compatible Amplenote API.
// @param {number} year - The dictionary's year.
// @returns {Promise<object>} Definitions keyed by term.
export async function dictionaryDefinitions(app, year) {
  try {
    const content = await readUserTermsDictionary(app, year);
    return content ? dictionaryObjectFromEntries(dictionaryEntriesFromContent(content)) : {};
  } catch (error) {
    logIfEnabled(`${ COMPLETED_TASK_JOB_LOG_LABEL } could not read the terms dictionary`, error?.message);
    return {};
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The endpoint a job's decisions are asked through, each request taking its own provider permit.
// @param {object} context - The job's context, carrying app and providerDispatch.
// @param {function} endpointFactory - (app) => DecisionsEndpoint or null.
// @param {AbortSignal|null} signal - Gives up a request still waiting for its permit.
// @returns {Promise<DecisionsEndpoint|null>} The endpoint, or null when no decision model is configured.
export async function jobDecisionsEndpoint(context, endpointFactory, signal) {
  const endpoint = await endpointFactory(context.app);
  if (!endpoint || !context.providerDispatch) return endpoint || null;
  return endpoint.withProviderDispatch({ providerDispatch: context.providerDispatch, signal });
}

// ----------------------------------------------------------------------------------------------
// @desc Run an app read through the runtime's app dispatcher, or directly without one.
// @param {object} context - The job's context.
// @param {function} operation - (app) => result.
// @param {AbortSignal|null} signal - Gives up a read still waiting for its permit.
// @returns {Promise<*>} The operation's result.
export function jobRead(context, operation, signal) {
  return context.appDispatch ? context.appDispatch.read(operation, { signal }) : operation(context.app);
}

// ----------------------------------------------------------------------------------------------
// @desc Run an app write through the runtime's app dispatcher, in the write chain of the note it changes, or directly
//   without one.
// @param {object} context - The job's context.
// @param {string} noteKey - Names the note the write changes, so writes to one note run one at a time.
// @param {function} operation - (app) => result.
// @param {AbortSignal|null} signal - Gives up a write still waiting for its permit.
// @returns {Promise<*>} The operation's result.
export function jobWrite(context, noteKey, operation, signal) {
  return context.appDispatch ? context.appDispatch.write(noteKey, operation, { signal }) : operation(context.app);
}

// ----------------------------------------------------------------------------------------------
// @desc Add entries to the quarter's ledger, creating it when needed, in the ledger's write chain. Each day is re-read
//   and merged inside the write, so entries another writer recorded meanwhile are kept, and an entry for a task the
//   day already holds replaces it. A day whose JSON cannot be read is left untouched, as is a day that cannot be
//   inserted, each logged.
// @param {object} context - The job's context.
// @param {object} scope - Resolved quarter scope.
// @param {Array<object>} entries - Entries, each carrying its dateKey.
// @param {AbortSignal|null} signal - Gives up a write still waiting for its permit.
// @returns {Promise<void>}
export async function recordLedgerEntries(context, scope, entries, signal) {
  if (!entries.length) return;
  const entriesByDate = new Map();
  for (const entry of entries) entriesByDate.set(entry.dateKey, [...(entriesByDate.get(entry.dateKey) || []), entry]);
  const update = async app => {
    const ledger = await openCompletedTaskLedger(app, scope);
    const recorded = ledgerEntriesFromContent(ledger.content);
    let content = ledger.content;
    for (const [dateKey, dayEntries] of entriesByDate) {
      if (recorded.unreadableDates.includes(dateKey)) continue;
      const mergedEntries = mergedLedgerEntries(recorded.entriesByDate.get(dateKey) || [], dayEntries);
      try {
        content = await writeLedgerDateSection(app, { content, dateKey, entries: mergedEntries, noteHandle: ledger.noteHandle });
      } catch (error) {
        logIfEnabled(`${ COMPLETED_TASK_JOB_LOG_LABEL } could not write ${ dateKey }`, error?.message);
      }
    }
  };
  await jobWrite(context, completedTaskLedgerNoteName(scope), update, signal);
}
