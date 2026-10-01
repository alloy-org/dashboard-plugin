// Stack rank each current project's prospective tasks with Jev. This picks up where the background project-task
// collection pass leaves off: that pass stores, per project, the open tasks already associated with it, and offers
// its provider a pool of other open tasks the project might own. The same pool is rebuilt here by the same rule,
// described in full — note, note tags, outline position — and rated against the project, with the user's terms
// dictionary supplying the meaning of notebook-specific names.
import { SETTING_KEYS } from "constants/settings";
import { buildProjectTaskContext } from "plan-wizard/stack-rank/build-project-task-context";
import { prospectiveTaskDetails } from "plan-wizard/stack-rank/prospective-task-details";
import { rankProspectiveTasks } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { pluginSettings } from "plugin-data";
import { _candidateTaskRecords } from "project-task-collection";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";

// ----------------------------------------------------------------------------------------------
// @desc Rank every current project's prospective tasks. Task details are gathered once for the union of all
//   projects' pools, since the pools overlap heavily and each note read costs a bridge round trip. The pool holds
//   only open tasks not already associated with the project, capped at the most recently updated.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} [accessToken] - Jev key; defaults to the Jev Access Token plugin setting
//   - {string|null} domainName - Active task domain display name
//   - {string|null} domainUuid - Active task domain UUID
//   - {Date} [now=new Date()] - Selects the quarter and the dictionary's year
//   - {function} [promptRunner] - Injected into term discovery for tests
//   - {boolean} [refineDictionary=true] - False skips term discovery
//   - {function} [requestAnswers] - Injected Jev request for tests
// @returns {Promise<object>} An object with the following properties:
//   - {object} dictionaryChanges - { addedTerms, failureReason, refinedTerms }
//   - {Array<object>} projectRankings - { failures, inputTokens, projectSummary, projectUuid, rankedTasks } per project
export async function stackRankProjectTasks(app, { accessToken, domainName, domainUuid, now = new Date(), promptRunner,
    refineDictionary = true, requestAnswers }) {
  const jevAccessToken = accessToken || pluginSettings()?.[SETTING_KEYS.JEV_ACCESS_TOKEN];
  if (!jevAccessToken) throw new Error(`Set "${ SETTING_KEYS.JEV_ACCESS_TOKEN }" to stack rank project tasks`);
  const context = await buildProjectTaskContext(app, { domainName, domainUuid, now, promptRunner, refineDictionary });
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  if (!Array.isArray(tasks)) throw new Error("Could not read tasks for stack ranking");
  const identifiedTasks = tasks.filter(task => task?.uuid);
  const taskByUuid = new Map(identifiedTasks.map(task => [task.uuid, task]));
  const candidateUuidsByProject = new Map();
  for (const project of context.projects) {
    const candidateRecords = _candidateTaskRecords(project, identifiedTasks, project.relatedTaskRecords || []);
    candidateUuidsByProject.set(project.uuid, candidateRecords.map(record => record.taskUuid));
  }
  const pooledUuids = new Set([...candidateUuidsByProject.values()].flat());
  const pooledTasks = [...pooledUuids].map(taskUuid => taskByUuid.get(taskUuid));
  const pooledDetails = await prospectiveTaskDetails(app, pooledTasks);
  const detailByUuid = new Map(pooledDetails.map(detail => [detail.taskUuid, detail]));
  const projectRankings = [];
  for (const project of context.projects) {
    const candidateUuids = candidateUuidsByProject.get(project.uuid);
    const taskDetails = candidateUuids.map(taskUuid => detailByUuid.get(taskUuid));
    const ranking = await rankProspectiveTasks({ accessToken: jevAccessToken, dictionary: context.dictionary,
      project, taskDetails, ...(requestAnswers ? { requestAnswers } : {}) });
    projectRankings.push({ ...ranking, projectSummary: project.summary, projectUuid: project.uuid });
  }
  return { dictionaryChanges: context.dictionaryChanges, projectRankings };
}
