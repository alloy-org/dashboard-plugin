// Credit a past quarter's completed tasks to its projects after the fact, so a quarter whose ledger missed most of its
// completions still has project groups to tell its story with. Every project is asked about the same tasks, in
// parallel, one decisions request per project per batch, how applicable each task was to it on the 1–10 scale the
// project ranker uses. A task is credited to whichever project rated it highest, when that rating reaches the
// similarity cutoff. Tasks the ledger never classified are asked about first; tasks it recorded as advancing no
// project fill whatever room is left in the last batch. Each verdict, project or none, is written to the quarter's
// completed task ledger, which is named by quarter and year, so a later retrospective reads it rather than asking
// again. Projects inferred from the months' themes are saved to the quarter's project task store as past projects,
// and the tasks their themes held are written to the ledger as theirs.
import { CLASSIFIED_BY, completedTaskEntry } from "dashboard/projects/completed-task-project-classification";
import { ledgerEntryKey, mergedLedgerEntries } from "dashboard/projects/completed-task-project-ledger";
import QuarterProjectRepository from "dashboard/quarter-project-repository";
import { recordLedgerEntries } from "dashboard/work-queue/jobs/completed-task-job-steps";
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { DEFAULT_MINIMUM_MATCH_SCORE } from "plan-wizard/stack-rank/project-match-scores";
import { APPLICABILITY_CRITERIA } from "plan-wizard/stack-rank/rank-prospective-tasks";
import { dictionaryEntriesFromContent, dictionaryObjectFromEntries, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { scoreQuestion } from "providers/decisions-endpoint";
import { forEachWithConcurrency } from "util/concurrency";
import { logIfEnabled } from "util/log";

export const BACKFILL_BATCH_SIZE = 20;
// Requests in flight at once, across every project's batches.
const BACKFILL_REQUEST_CONCURRENCY = 6;
// Tasks already credited to a project show the model what the project's work looked like; a handful is enough.
const EXAMPLE_TASKS_IN_STATE = 8;
// The footnote text sent with a task is clipped to this, enough to tell what the task involved.
const BACKFILL_DETAIL_CHARACTERS = 300;
const BACKFILL_LOG_LABEL = "[retrospective-project-backfill]";

// ----------------------------------------------------------------------------------------------
// @desc Credit the quarter's unassigned completions to its projects and record every verdict in the ledger. Tasks the
//   inferred projects' themes held are credited to those projects without asking. Without an endpoint or projects,
//   only those are recorded. Writing the ledger can fail without failing the backfill: the returned entries still
//   credit this generation's tasks.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {Array<object>} completions - The quarter's completions, as gathered
//   - {DecisionsEndpoint|null} endpoint - Where the ratings are asked; null rates nothing
//   - {Map<string, Array<object>>} entriesByDate - The ledger's entries by date key, as gathered
//   - {Array<object>|null} inferredProjects - Projects inferred from themes, { name, summary, taskUuids, uuid }
//   - {Function} [onProgress] - Receives a short description of the rating step as it starts
//   - {Map<string, Array<string>>} [projectExamples] - Open task texts most like each store project, by project UUID
//   - {Array<object>} projects - Every project of the quarter, { name, summary?, uuid }
//   - {object} scope - Resolved plan scope of the quarter
// @returns {Promise<object>} { entriesByDate, recordedEntryCount }: entriesByDate with the new entries merged in.
export async function backfillQuarterProjects(app, { completions, endpoint, entriesByDate, inferredProjects, onProgress = () => {},
    projectExamples = new Map(), projects, scope }) {
  const classifiedAt = new Date().toISOString();
  const themeEntries = _themeEntries(completions, inferredProjects, classifiedAt);
  const themeTaskUuids = new Set(themeEntries.map(entry => entry.taskUuid));
  const candidateGroups = backfillCandidates(completions, entriesByDate, { excludedTaskUuids: themeTaskUuids });
  let ratedEntries = [];
  if (endpoint && projects.length && candidateGroups.length) {
    onProgress(`Sorting ${ candidateGroups.length } completed tasks into your ${ projects.length } projects…`);
    const ratedProjects = _ratedProjects(projects, { completions, inferredProjects, projectExamples });
    const dictionary = await _quarterDictionary(app, scope.year);
    const ratingsByTaskUuid = await rateBackfillCandidates(candidateGroups, { dictionary, endpoint, projects: ratedProjects });
    ratedEntries = backfilledEntries(candidateGroups, ratingsByTaskUuid, { classifiedAt, projects: ratedProjects });
  }
  const entries = [...themeEntries, ...ratedEntries];
  const creditedEntries = ratedEntries.filter(entry => entry.projectUuid);
  logIfEnabled(`${ BACKFILL_LOG_LABEL } backfilled`, { candidateCount: candidateGroups.length, creditedCount: creditedEntries.length,
    ratedCount: ratedEntries.length, themeCount: themeEntries.length });
  try {
    await recordLedgerEntries({ app }, scope, entries, null);
  } catch (error) {
    logIfEnabled(`${ BACKFILL_LOG_LABEL } could not write the ledger`, error?.message);
  }
  return { entriesByDate: entriesByDateWithEntries(entriesByDate, entries), recordedEntryCount: entries.length };
}

// ----------------------------------------------------------------------------------------------
// @desc The completions to rate, grouped by task so a repeating task is asked about once. Every task the ledger never
//   classified is included. Tasks it recorded as advancing no project, outside a retrospective, then fill the rest of
//   the last batch, those it was least confident about first. A task a retrospective already rated is never included.
// @param {Array<object>} completions - The quarter's completions.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key.
// @param {object} [options] - { batchSize = BACKFILL_BATCH_SIZE, excludedTaskUuids }: tasks credited some other way.
// @returns {Array<object>} { completions, taskUuid, text } per task, unclassified tasks first.
export function backfillCandidates(completions, entriesByDate, { batchSize = BACKFILL_BATCH_SIZE, excludedTaskUuids = new Set() } = {}) {
  const entryByKey = _entryByKey(entriesByDate);
  const unratedGroups = new Map();
  const reconsideredGroups = new Map();
  for (const completion of completions) {
    if (!completion.taskUuid || completion.projectUuid || excludedTaskUuids.has(completion.taskUuid)) continue;
    const entry = entryByKey.get(ledgerEntryKey(completion));
    if (entry?.classifiedBy === CLASSIFIED_BY.retrospective) continue;
    const groups = entry ? reconsideredGroups : unratedGroups;
    const group = groups.get(completion.taskUuid)
      || { completions: [], confidence: entry?.confidence ?? 0, taskUuid: completion.taskUuid, text: completion.text };
    group.completions.push(completion);
    groups.set(completion.taskUuid, group);
  }
  const unrated = [...unratedGroups.values()];
  const reconsidered = [...reconsideredGroups.values()].filter(group => !unratedGroups.has(group.taskUuid));
  const openSlots = unrated.length ? (batchSize - (unrated.length % batchSize)) % batchSize : 0;
  const leastConfident = reconsidered.sort((first, second) => first.confidence - second.confidence);
  const candidateGroups = [...unrated, ...leastConfident.slice(0, openSlots)];
  return candidateGroups.map(group => ({ completions: group.completions, taskUuid: group.taskUuid, text: group.text }));
}

// ----------------------------------------------------------------------------------------------
// @desc Ledger entries for every completion of each task every project rated: credited to the project that rated it
//   highest when that rating reaches DEFAULT_MINIMUM_MATCH_SCORE, otherwise to none. A tie goes to the project listed
//   first. A task some project couldn't rate is left out, so a later retrospective asks again.
// @param {Array<object>} candidateGroups - From backfillCandidates.
// @param {Map<string, Map<string, number>>} ratingsByTaskUuid - Rating by project UUID, by task UUID.
// @param {object} options - { classifiedAt, projects }: projects as rated, { name, uuid }.
// @returns {Array<object>} Ledger entries, classified by CLASSIFIED_BY.retrospective, each carrying its matchScore.
export function backfilledEntries(candidateGroups, ratingsByTaskUuid, { classifiedAt, projects }) {
  const entries = [];
  for (const group of candidateGroups) {
    const ratings = ratingsByTaskUuid.get(group.taskUuid);
    if (!ratings || projects.some(project => !ratings.has(project.uuid))) continue;
    const best = projects.reduce((leader, project) => (ratings.get(project.uuid) > ratings.get(leader.uuid) ? project : leader));
    const matchScore = ratings.get(best.uuid);
    const project = matchScore >= DEFAULT_MINIMUM_MATCH_SCORE ? { summary: best.name, uuid: best.uuid } : null;
    for (const completion of group.completions) {
      const task = { completedAt: new Date(completion.completedMillis), content: completion.text, uuid: completion.taskUuid };
      const entry = completedTaskEntry(task, { classifiedAt, classifiedBy: CLASSIFIED_BY.retrospective, project });
      entries.push({ ...entry, matchScore });
    }
  }
  return entries;
}

// ----------------------------------------------------------------------------------------------
// @desc Backfill a gathered quarter once its projects are known: save the projects inferred from themes when the
//   quarter has ended, then credit its unassigned completions. Never rejects, so it can run beside other generation
//   work; a failure leaves the ledger entries as gathered.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} gathered - From gatherRetrospectiveQuarter.
// @param {object} options - An object with the following properties:
//   - {Function} endpointRequest - async () => DecisionsEndpoint or null
//   - {Array<object>|null} inferredProjects - Projects inferred from themes, or null when the quarter had its own
//   - {Function} [now] - () => epoch milliseconds, injected for tests
//   - {Function} [onProgress] - Receives a short description of the rating step as it starts
// @returns {Promise<object>} { entriesByDate }: the ledger's entries with the backfilled ones merged in.
export async function backfillRetrospectiveQuarter(app, gathered, { endpointRequest, inferredProjects, now = Date.now, onProgress }) {
  const { scope } = gathered;
  const entriesByDate = gathered.statisticsInputs.entriesByDate;
  try {
    const quarterEndMillis = new Date(scope.year, scope.quarter * 3, 1).getTime();
    if (inferredProjects?.length && now() >= quarterEndMillis) await saveInferredProjects(app, scope, inferredProjects);
    const projects = [...gathered.projects, ...(inferredProjects || [])];
    const endpoint = await endpointRequest();
    return await backfillQuarterProjects(app, { completions: gathered.completions, endpoint, entriesByDate, inferredProjects, onProgress,
      projectExamples: gathered.projectExamples, projects, scope });
  } catch (error) {
    logIfEnabled(`${ BACKFILL_LOG_LABEL } could not backfill the quarter`, error?.message);
    return { entriesByDate };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Credit completions to the projects ledger entries name: a completion the ledger left without one takes the
//   project its entry now records.
// @param {Array<object>} completions - The quarter's completions.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key.
// @returns {Array<object>} Every completion, those newly credited carrying classified, projectName, and projectUuid.
export function completionsWithLedgerProjects(completions, entriesByDate) {
  const entryByKey = _entryByKey(entriesByDate);
  const credited = completions.map(completion => {
    const entry = completion.taskUuid && !completion.projectUuid ? entryByKey.get(ledgerEntryKey(completion)) : null;
    if (!entry?.projectUuid) return completion;
    return { ...completion, classified: true, projectName: entry.projectName, projectUuid: entry.projectUuid };
  });
  return credited;
}

// ----------------------------------------------------------------------------------------------
// @desc Ledger entries by date key with more entries merged in, one per task each day, the new replacing the old.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key.
// @param {Array<object>} entries - Entries to add, each carrying its dateKey.
// @returns {Map<string, Array<object>>} A new map; the given one is unchanged.
export function entriesByDateWithEntries(entriesByDate, entries) {
  const merged = new Map(entriesByDate);
  for (const entry of entries) merged.set(entry.dateKey, mergedLedgerEntries(merged.get(entry.dateKey) || [], [entry]));
  return merged;
}

// ----------------------------------------------------------------------------------------------
// @desc The questions and state of one request: how applicable each task of a batch was to one project, the state
//   holding the project, the tasks already credited to it, the batch's tasks, and the dictionary terms they use.
// @param {object} project - { examples, name, summary }.
// @param {Array<object>} batch - Candidate groups, carrying text and their completions' footnoteText and noteName.
// @param {object} dictionary - Definitions keyed by term.
// @returns {object} { questionNames, questions, state }.
export function projectMatchRequest(project, batch, dictionary) {
  const questionNames = batch.map((_group, index) => `task_${ index + 1 }`);
  const completedTasks = Object.fromEntries(batch.map((group, index) => [questionNames[index], _taskState(group)]));
  const passages = [project.name, project.summary, ...project.examples, ...batch.map(group => group.text)];
  const state = { completedTasks, project: { name: project.name, summary: project.summary || null, tasksInProject: project.examples },
    userTermsDictionary: relevantDictionaryTerms(dictionary, passages) };
  const questionEntries = batch.map((group, index) => [questionNames[index], _matchQuestion(project, group, questionNames[index])]);
  return { questionNames, questions: Object.fromEntries(questionEntries), state };
}

// ----------------------------------------------------------------------------------------------
// @desc Rate every candidate against every project, all projects' batches in flight together. A batch whose request
//   fails is logged and its tasks left unrated for that project.
// @param {Array<object>} candidateGroups - From backfillCandidates.
// @param {object} options - { dictionary, endpoint, projects }: projects as _ratedProjects describes them.
// @returns {Promise<Map<string, Map<string, number>>>} Rating by project UUID, by task UUID.
export async function rateBackfillCandidates(candidateGroups, { dictionary, endpoint, projects }) {
  const requests = [];
  for (const project of projects) {
    for (let start = 0; start < candidateGroups.length; start += BACKFILL_BATCH_SIZE) {
      requests.push({ batch: candidateGroups.slice(start, start + BACKFILL_BATCH_SIZE), project });
    }
  }
  const ratingsByTaskUuid = new Map();
  await forEachWithConcurrency(requests, BACKFILL_REQUEST_CONCURRENCY, async ({ batch, project }) => {
    const { questionNames, questions, state } = projectMatchRequest(project, batch, dictionary);
    try {
      const response = await endpoint.rankedResponses({ questions, state });
      batch.forEach((group, index) => {
        const rating = response.ratingFor(questionNames[index], { levelCount: APPLICABILITY_CRITERIA.length });
        if (rating === null) return;
        if (!ratingsByTaskUuid.has(group.taskUuid)) ratingsByTaskUuid.set(group.taskUuid, new Map());
        ratingsByTaskUuid.get(group.taskUuid).set(project.uuid, rating);
      });
    } catch (error) {
      logIfEnabled(`${ BACKFILL_LOG_LABEL } could not rate a batch for ${ project.name }`, error?.message);
    }
  });
  return ratingsByTaskUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Save projects inferred from a past quarter's themes to its project task store, under Past projects, so a
//   later retrospective reads them as the quarter's projects rather than inferring them again. One that can't be
//   written is logged and skipped.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope of the quarter.
// @param {Array<object>} inferredProjects - { name, uuid } per project.
// @returns {Promise<number>} How many were saved.
export async function saveInferredProjects(app, scope, inferredProjects) {
  const repository = new QuarterProjectRepository({ app });
  let savedCount = 0;
  for (const inferred of inferredProjects || []) {
    try {
      await repository.applyResult(scope, { apply: project => project.setActive(false), projectUuid: inferred.uuid, summary: inferred.name });
      savedCount += 1;
    } catch (error) {
      logIfEnabled(`${ BACKFILL_LOG_LABEL } could not save inferred project ${ inferred.name }`, error?.message);
    }
  }
  return savedCount;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Ledger entries keyed as ledgerEntryKey names them.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key.
// @returns {Map<string, object>} Entry by key.
function _entryByKey(entriesByDate) {
  const entryByKey = new Map();
  for (const [dateKey, entries] of entriesByDate) {
    for (const entry of entries) entryByKey.set(ledgerEntryKey({ dateKey, taskUuid: entry.taskUuid }), entry);
  }
  return entryByKey;
}

// ----------------------------------------------------------------------------------------------
// @desc One task's applicability question, repeating the task's words so it is answerable without cross-reference.
// @param {object} project - { name }.
// @param {object} group - { text }.
// @param {string} questionName - Such as "task_1".
// @returns {object} A score question on APPLICABILITY_CRITERIA.
function _matchQuestion(project, group, questionName) {
  return scoreQuestion(`How applicable was completed task ${ questionName } ("${ group.text }") to advancing the project `
    + `"${ project.name }"? Its note and details describe the context it lived in. Use the user terms dictionary to recognize `
    + "names specific to this person's notebook.", [...APPLICABILITY_CRITERIA]);
}

// ----------------------------------------------------------------------------------------------
// @desc The user terms dictionary for the quarter's year, or none when it can't be read.
// @param {object} app - Host-compatible Amplenote API.
// @param {number} year - Calendar year.
// @returns {Promise<object>} Definitions keyed by term.
async function _quarterDictionary(app, year) {
  try {
    const content = await readUserTermsDictionary(app, year);
    return content ? dictionaryObjectFromEntries(dictionaryEntriesFromContent(content)) : {};
  } catch (error) {
    logIfEnabled(`${ BACKFILL_LOG_LABEL } could not read the terms dictionary`, error?.message);
    return {};
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Each project as the model is told of it: its name, its summary when inferred, and up to EXAMPLE_TASKS_IN_STATE
//   tasks showing its work, those already credited to it first, then the open tasks the store found most like it.
// @param {Array<object>} projects - { name, summary?, uuid }.
// @param {object} options - { completions, inferredProjects, projectExamples }.
// @returns {Array<object>} { examples, name, summary, uuid } per project.
function _ratedProjects(projects, { completions, inferredProjects, projectExamples }) {
  const textByTaskUuid = new Map(completions.map(completion => [completion.taskUuid, completion.text]));
  const inferredByUuid = new Map((inferredProjects || []).map(project => [project.uuid, project]));
  return projects.map(project => {
    const inferred = inferredByUuid.get(project.uuid);
    const creditedTexts = completions.filter(completion => completion.projectUuid === project.uuid).map(completion => completion.text);
    const themeTexts = (inferred?.taskUuids || []).map(taskUuid => textByTaskUuid.get(taskUuid));
    const exampleTexts = [...creditedTexts, ...themeTexts, ...(projectExamples.get(project.uuid) || [])].filter(Boolean);
    const examples = [...new Set(exampleTexts)].slice(0, EXAMPLE_TASKS_IN_STATE);
    return { examples, name: project.name, summary: inferred?.summary || project.summary || null, uuid: project.uuid };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc One task within a request's state: its text, its note, and its footnote details.
// @param {object} group - A candidate group.
// @returns {object} { details?, note?, text }.
function _taskState(group) {
  const representative = group.completions[0] || {};
  const described = { text: group.text };
  if (representative.noteName) described.note = representative.noteName;
  const details = String(representative.footnoteText || "").trim();
  if (details) described.details = details.slice(0, BACKFILL_DETAIL_CHARACTERS);
  return described;
}

// ----------------------------------------------------------------------------------------------
// @desc Ledger entries crediting each task an inferred project's themes held to that project, for every completion
//   the ledger left without a project.
// @param {Array<object>} completions - The quarter's completions.
// @param {Array<object>|null} inferredProjects - { name, taskUuids, uuid } per project.
// @param {string} classifiedAt - ISO timestamp.
// @returns {Array<object>} Ledger entries, classified by CLASSIFIED_BY.themes.
function _themeEntries(completions, inferredProjects, classifiedAt) {
  const projectByTaskUuid = new Map();
  for (const project of inferredProjects || []) {
    for (const taskUuid of project.taskUuids || []) projectByTaskUuid.set(taskUuid, project);
  }
  const themeCompletions = completions.filter(completion => !completion.projectUuid && projectByTaskUuid.has(completion.taskUuid));
  return themeCompletions.map(completion => {
    const project = projectByTaskUuid.get(completion.taskUuid);
    const task = { completedAt: new Date(completion.completedMillis), content: completion.text, uuid: completion.taskUuid };
    return completedTaskEntry(task, { classifiedAt, classifiedBy: CLASSIFIED_BY.themes, project: { summary: project.name, uuid: project.uuid } });
  });
}
