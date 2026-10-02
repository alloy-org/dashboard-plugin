// Ask Jev how applicable each prospective task is to one project, on a 1–10 scale, and order the tasks by it.
// Tasks are rated in batches: every task in a batch is a separate question about one shared state holding the
// project, the tasks it already owns, and the dictionary terms the batch mentions. A live check rated three tasks
// against a Diff Digest project at 9.9, 1.1, and 1.7 in one 631-token request, so batching costs no discrimination
// while sending the project and dictionary once per batch instead of once per task.
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { requestJevAnswers, scoreQuestion } from "providers/jev-client";
import { logIfEnabled } from "util/log";

// A live check of 20 tasks in one request rated all seven Diff Digest tasks 6.3–9.8 and all thirteen errands 1.1, at
// about 320 input tokens a task, so a batch this size keeps its discrimination while a 500-task pool needs 25 requests.
export const DEFAULT_BATCH_SIZE = 20;
// Batches in flight at once. A pool of several hundred tasks is dozens of requests, which one at a time would take
// minutes; a few at once keeps a project's ranking near the length of the background pass's other work.
export const DEFAULT_CONCURRENT_BATCHES = 4;
// Jev indexes a rubric from zero; entry N describes a rating of N + 1. Unanchored levels carry only their number,
// so the model interpolates between the anchors rather than reading ten slightly different sentences. They cannot be
// null: although the SDK's types allow a null criterion, the live API rejects one with a 422.
export const APPLICABILITY_CRITERIA = ["1: unrelated to the project; doing it would not move the project at all", "2",
  "3: shares a topic or a note with the project, but only incidentally", "4",
  "5: supports the project indirectly, such as tooling, upkeep, or learning it depends on", "6",
  "7: a real piece of the project's work, though not on its critical path", "8", "9",
  "10: directly advances the project's outcome or its stated next action"];
const RANK_LOG_LABEL = "[rank-prospective-tasks]";
// The project's own tasks show Jev what the project means in practice; a handful is enough to do that.
const PROJECT_TASKS_IN_STATE = 8;

// ----------------------------------------------------------------------------------------------
// @desc Render the Jev state and questions for one batch. Question names are positional (`task_1`…) because a
//   question name is echoed back as an answer key, and positions map back to tasks without trusting the reply to
//   preserve an identifier. Each question repeats the task's own words so it is answerable without cross-reference.
// @param {object} project - Stored project record with summary, nextAction, relatedTaskRecords.
// @param {Array<object>} batch - Task details from prospectiveTaskDetails.
// @param {object} dictionary - Definitions keyed by term.
// @returns {object} { questionNames, questions, state }.
export function jevRequestForBatch(project, batch, dictionary) {
  const projectTaskTexts = (project.relatedTaskRecords || []).slice(0, PROJECT_TASKS_IN_STATE).map(task => task.taskText);
  const questionNames = batch.map((_detail, index) => `task_${ index + 1 }`);
  const prospectiveTasks = Object.fromEntries(batch.map((detail, index) => [questionNames[index], _taskState(detail)]));
  const passages = [project.summary, project.nextAction, ...projectTaskTexts, ...batch.flatMap(_detailPassages)];
  const state = { project: { nextAction: project.nextAction || null, summary: project.summary,
    tasksAlreadyInProject: projectTaskTexts }, prospectiveTasks,
  userTermsDictionary: relevantDictionaryTerms(dictionary, passages) };
  const questionEntries = batch.map((detail, index) => [questionNames[index], scoreQuestion(`How applicable is `
    + `prospective task ${ questionNames[index] } ("${ detail.taskText }") to advancing the project "${ project.summary }"? `
    + "Its note, tags, and parent task describe the context it lives in. Use the user terms dictionary to recognize "
    + "names specific to this person's notebook.", APPLICABILITY_CRITERIA)]);
  return { questionNames, questions: Object.fromEntries(questionEntries), state };
}

// ----------------------------------------------------------------------------------------------
// @desc Rate and order one project's prospective tasks. Up to `concurrentBatches` requests run at once; a batch
//   that fails is recorded with its reason and its tasks are left unrated, so one rejected request does not
//   discard the rest.
// @param {object} options - An object with the following properties:
//   - {string} accessToken - TypeSafe or OpenRouter key
//   - {number} [batchSize=DEFAULT_BATCH_SIZE] - Tasks per Jev request
//   - {number} [concurrentBatches=DEFAULT_CONCURRENT_BATCHES] - Requests in flight at once
//   - {object} dictionary - Definitions keyed by term
//   - {object} project - Stored project record
//   - {function} [requestAnswers=requestJevAnswers] - Injected for tests
//   - {Array<object>} taskDetails - From prospectiveTaskDetails
// @returns {Promise<object>} An object with the following properties:
//   - {Array<object>} failures - { reason, taskUuids } per failed batch
//   - {Array<object>} rankedTasks - { confidence, noteName, rating, taskText, taskUuid }, highest rating first
//   - {number} inputTokens - Total input tokens Jev reported
export async function rankProspectiveTasks({ accessToken, batchSize = DEFAULT_BATCH_SIZE,
    concurrentBatches = DEFAULT_CONCURRENT_BATCHES, dictionary, project, requestAnswers = requestJevAnswers, taskDetails }) {
  const batches = [];
  for (let start = 0; start < taskDetails.length; start += batchSize) batches.push(taskDetails.slice(start, start + batchSize));
  const failures = [];
  const ratedTasks = [];
  let inputTokens = 0;
  let nextBatchIndex = 0;
  const rateRemainingBatches = async () => {
    while (nextBatchIndex < batches.length) {
      const batch = batches[nextBatchIndex];
      nextBatchIndex += 1;
      const { questionNames, questions, state } = jevRequestForBatch(project, batch, dictionary);
      try {
        const { answers, usage } = await requestAnswers({ accessToken, questions, state });
        inputTokens += usage?.input_tokens || 0;
        const batchRatings = batch.map((detail, index) => _ratedTask(detail, answers[questionNames[index]]));
        ratedTasks.push(...batchRatings.filter(Boolean));
      } catch (error) {
        failures.push({ reason: error?.message || "Rating request failed", taskUuids: batch.map(detail => detail.taskUuid) });
      }
    }
  };
  const workerCount = Math.max(1, Math.min(concurrentBatches, batches.length));
  await Promise.all(Array.from({ length: workerCount }, rateRemainingBatches));
  const rankedTasks = ratedTasks.sort((first, second) => second.rating - first.rating || second.confidence - first.confidence);
  logIfEnabled(`${ RANK_LOG_LABEL } ranked project`, { failureCount: failures.length,
    failureReasons: failures.map(failure => failure.reason), inputTokens, project: project.summary,
    ratedCount: rankedTasks.length });
  return { failures, inputTokens, rankedTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc List the text in a task detail that dictionary terms may be found in.
// @param {object} detail - Task detail.
// @returns {Array<string>} Passages.
function _detailPassages(detail) {
  const childTexts = detail.childTasks.map(child => child.taskText);
  return [detail.taskText, detail.noteName, detail.parentTask?.taskText, ...detail.noteTags, ...childTexts];
}

// ----------------------------------------------------------------------------------------------
// @desc Convert one score answer to a rating on the 1–10 scale. An answer that is missing or not a score yields
//   null rather than a guessed rating.
// @param {object} detail - Task detail.
// @param {object|undefined} answer - Jev's answer for this task's question.
// @returns {object|null} { confidence, noteName, rating, taskText, taskUuid }.
function _ratedTask(detail, answer) {
  if (answer?.type !== "score" || !Number.isFinite(answer.score)) return null;
  const rating = Math.round((answer.score + 1) * 10) / 10;
  const confidence = Number.isFinite(answer.confidence) ? answer.confidence : 0;
  return { confidence, noteName: detail.noteName, rating, taskText: detail.taskText, taskUuid: detail.taskUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Describe one task inside the Jev state. Identifiers are omitted, since they carry no meaning for a rater
//   and only lengthen the request; the flags the user set are kept because an important task is a stated priority.
//   When its note was last opened stands in for how much attention the note gets, since the API reports no view
//   count.
// @param {object} detail - Task detail.
// @returns {object} The task's entry in state.prospectiveTasks.
function _taskState(detail) {
  return { childTasks: detail.childTasks.map(child => child.taskText), deadlineOn: detail.deadlineOn,
    important: detail.important, isParentTask: detail.isParent, note: { lastOpenedOn: detail.noteLastOpenedOn || null,
      name: detail.noteName, tags: detail.noteTags },
    parentTask: detail.parentTask?.taskText || null, text: detail.taskText, urgent: detail.urgent };
}
