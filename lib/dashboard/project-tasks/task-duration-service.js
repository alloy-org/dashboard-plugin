// Estimate missing task and idea durations before recommendations, reusing the quarterly note's context-keyed index.
import { DURATION_BATCH_SIZE, DURATION_MINUTE_CHOICES, durationInputRevision, durationQuestions,
  readDurationEstimates, writeDurationEstimates } from "dashboard/project-tasks/task-duration-estimates";
import { prospectiveTaskDetails } from "plan-wizard/stack-rank/prospective-task-details";
import { dictionaryEntriesFromContent, dictionaryObjectFromEntries, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { DecisionsEndpoint } from "providers/decisions-endpoint";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";

// ----------------------------------------------------------------------------------------------
// @desc Enrich candidate groups in place with conservative estimates, preserving explicit task durations. Only missing
//   or changed estimates cost a provider request. Successful batches are saved before moving on, so a failed later
//   batch can be retried cheaply. With storedOnly, apply saved estimates matching candidate text without app context
//   lookups, provider requests, or writes. A missing decision model leaves the existing default duration in place.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { groups, openTasks, providerDispatch, requestAnswers, scope, signal, storedOnly }.
//   requestAnswers injects a duration-specific DecisionsEndpoint request; groups are dayProjectGroups-shaped records.
// @returns {Promise<object>} { estimatedCount, reusedCount, waitingCount }.
export async function estimateCandidateDurations(app, { groups, openTasks = null, providerDispatch = null,
    requestAnswers = null, scope, signal = null, storedOnly = false }) {
  const candidates = _uniqueCandidates(groups);
  const counts = { estimatedCount: 0, reusedCount: 0, waitingCount: 0 };
  if (!candidates.length) return counts;
  const estimates = await readDurationEstimates(app, scope);
  if (storedOnly) {
    const knownTasks = new Map((openTasks || []).map(task => [task.uuid || task.taskUuid, task]));
    for (const entry of candidates) _applyExplicitDuration(entry, knownTasks.get(entry.candidate.uuid));
    _applyStoredEstimates(candidates, estimates);
    return counts;
  }
  const nativeTasks = await _nativeCandidateTasks(app, candidates, openTasks);
  const contexts = await _durationContexts(app, candidates, nativeTasks, openTasks);
  if (!contexts.length) return counts;
  const dictionaryContent = await readUserTermsDictionary(app, scope.year);
  const dictionary = dictionaryObjectFromEntries(dictionaryEntriesFromContent(dictionaryContent || ""));
  const pending = _pendingContexts(candidates, contexts, counts, dictionary, estimates);
  if (!pending.length || signal?.aborted) return counts;
  let endpoint = requestAnswers ? DecisionsEndpoint.fromRequester(requestAnswers)
    : await decisionsEndpointForApp(app, { includeFastScore: false });
  if (!endpoint) return { ...counts, waitingCount: pending.length };
  if (providerDispatch) endpoint = endpoint.withProviderDispatch({ providerDispatch, signal });
  for (let offset = 0; offset < pending.length; offset += DURATION_BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = pending.slice(offset, offset + DURATION_BATCH_SIZE);
    const response = await endpoint.rankedResponses(durationQuestions(batch, dictionary));
    const additions = _answeredEstimates(batch, response);
    await writeDurationEstimates(app, scope, additions);
    Object.assign(estimates, additions);
    counts.estimatedCount += Object.keys(additions).length;
    _applyStoredEstimates(candidates, additions);
  }
  counts.waitingCount = pending.length - counts.estimatedCount;
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Accept only exact allowed choice answers. Refusals, scores, and arbitrary values remain pending for a retry.
// @param {Array<object>} contexts - Batch contexts carrying inputRevision and indexKey.
// @param {DecisionsResponse} response - The provider's answers.
// @returns {object} New estimate records keyed by task UUID or idea:<ideaId>.
function _answeredEstimates(contexts, response) {
  const additions = {};
  contexts.forEach((context, index) => {
    const answer = response.answerFor(`duration_${ index + 1 }`);
    const chosenMinutes = DURATION_MINUTE_CHOICES.find(minutes => answer?.choice === minutes || answer?.choice === String(minutes));
    const durationMinutes = answer?.type === "choice" ? chosenMinutes : null;
    if (!durationMinutes) return;
    additions[context.indexKey] = { durationMinutes, estimatedAt: new Date().toISOString(), inputRevision: context.inputRevision,
      noteUuid: context.noteUuid, taskText: context.candidateText };
  });
  return additions;
}

// ----------------------------------------------------------------------------------------------
// @desc Apply a task's positive duration in seconds before any cached or estimated duration can be considered.
// @param {object} entry - Unique candidate entry with references to all its copies.
// @param {object|undefined} task - Native or compact task record.
function _applyExplicitDuration(entry, task) {
  const seconds = Number(task?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  entry.explicitMinutes = Math.max(1, Math.ceil(seconds / 60));
  for (const copy of entry.copies) copy.durationMinutes = entry.explicitMinutes;
}

// ----------------------------------------------------------------------------------------------
// @desc Apply saved durations to all occurrences of a candidate. A positive explicit duration always wins.
// @param {Array<object>} entries - Unique candidate entries with all group occurrences in copies.
// @param {object} estimates - Estimate index.
function _applyStoredEstimates(entries, estimates) {
  for (const entry of entries) {
    const estimate = estimates[entry.indexKey];
    if (entry.explicitMinutes || !estimate || estimate.taskText !== entry.candidate.text
      || estimate.noteUuid !== (entry.candidate.noteUuid || null)) continue;
    for (const candidate of entry.copies) candidate.durationMinutes = estimate.durationMinutes;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve note context once per note, and prefer a supplied parentUUID over the outline's inferred parent.
// @param {object} app - Amplenote API.
// @param {Array<object>} entries - Unique candidates.
// @param {Map<string,object>} nativeTasks - Task/idea records keyed by candidate ID.
// @param {Array<object>|null} openTasks - All known tasks, including potential parents.
// @returns {Promise<Array<object>>} Contexts only for candidates lacking a positive duration.
async function _durationContexts(app, entries, nativeTasks, openTasks) {
  const missing = entries.filter(entry => !entry.explicitMinutes);
  const tasks = missing.map(entry => nativeTasks.get(entry.candidate.candidateId));
  const details = await prospectiveTaskDetails(app, tasks);
  const parentByUuid = new Map((openTasks || []).map(task => [task.uuid || task.taskUuid, task]));
  const contexts = [];
  for (let index = 0; index < missing.length; index += 1) {
    const entry = missing[index];
    const task = tasks[index];
    const detail = details[index];
    let parentTaskText = detail.parentTask?.taskText || null;
    if (task.parentUUID) {
      if (!parentByUuid.has(task.parentUUID)) parentByUuid.set(task.parentUUID, await _readTask(app, task.parentUUID));
      const parent = parentByUuid.get(task.parentUUID);
      parentTaskText = parent?.content || parent?.taskText || null;
    }
    contexts.push({ candidateId: entry.candidate.candidateId, candidateText: entry.candidate.text,
      hierarchicalTags: [...detail.noteTags].sort(), indexKey: entry.indexKey, noteName: detail.noteName,
      noteUuid: task.noteUUID || null, parentTaskText, taskText: task.content });
  }
  return contexts;
}

// ----------------------------------------------------------------------------------------------
// @desc Join candidates to native task records, hydrating compact agenda records when possible. Explicit seconds are
//   converted into minutes before any estimation and applied to every occurrence of that task.
// @param {object} app - Amplenote API.
// @param {Array<object>} entries - Unique candidates.
// @param {Array<object>|null} openTasks - Known native or compact records.
// @returns {Promise<Map<string,object>>} Native-shaped records for existing tasks and proposed ideas.
async function _nativeCandidateTasks(app, entries, openTasks) {
  const knownTasks = new Map((openTasks || []).map(task => [task.uuid || task.taskUuid, task]));
  const nativeTasks = new Map();
  for (const entry of entries) {
    const { candidate } = entry;
    let task = candidate.uuid ? knownTasks.get(candidate.uuid) : null;
    if (candidate.uuid && (!task || !task.content || !task.noteUUID)) {
      task = { ...task, ...await _readTask(app, candidate.uuid) };
    }
    task = { ...task, content: task?.content || task?.taskText || candidate.text,
      noteUUID: task?.noteUUID || task?.noteUuid || candidate.noteUuid || null, uuid: candidate.uuid || candidate.candidateId };
    if (task.noteUUID) for (const copy of entry.copies) copy.noteUuid = task.noteUUID;
    _applyExplicitDuration(entry, task);
    nativeTasks.set(candidate.candidateId, task);
  }
  return nativeTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Reuse estimates only when their full input revision matches, applying them to every candidate occurrence.
// @param {Array<object>} candidates - Unique candidates.
// @param {Array<object>} contexts - Contexts for candidates without durations.
// @param {object} counts - Updated in place with reusedCount.
// @param {object} dictionary - User terms.
// @param {object} estimates - Saved estimate index.
// @returns {Array<object>} Contexts needing a provider answer.
function _pendingContexts(candidates, contexts, counts, dictionary, estimates) {
  const entryById = new Map(candidates.map(entry => [entry.candidate.candidateId, entry]));
  const pending = [];
  for (const context of contexts) {
    const inputRevision = durationInputRevision(context, dictionary);
    const estimate = estimates[context.indexKey];
    if (estimate?.inputRevision === inputRevision) {
      for (const candidate of entryById.get(context.candidateId).copies) candidate.durationMinutes = estimate.durationMinutes;
      counts.reusedCount += 1;
    } else pending.push({ ...context, inputRevision });
  }
  return pending;
}

// ----------------------------------------------------------------------------------------------
// @desc Look up a native task. app.getTask resolves null for a deleted task, which leaves its context to the candidate.
// @param {object} app - Amplenote API.
// @param {string} uuid - Task UUID.
// @returns {Promise<object|null>} Task record, or null when it no longer exists.
async function _readTask(app, uuid) {
  return checkedAppResult(await app.getTask(uuid)) || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Deduplicate tasks/ideas across project and meeting groups, retaining references to every occurrence.
// @param {Array<object>} groups - Candidate groups.
// @returns {Array<object>} { candidate, copies, indexKey } entries.
function _uniqueCandidates(groups) {
  const byId = new Map();
  for (const group of groups || []) {
    for (const candidate of group.taskCandidates || []) {
      if (!candidate.candidateId) continue;
      const entry = byId.get(candidate.candidateId) || { candidate, copies: [],
        indexKey: candidate.uuid || candidate.candidateId };
      entry.copies.push(candidate);
      byId.set(candidate.candidateId, entry);
    }
  }
  return [...byId.values()];
}
