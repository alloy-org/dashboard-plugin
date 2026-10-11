// Decide which quarterly project each completed task advanced. A task linked to exactly one project (in its primary
// note, linking to it, naming it, or assigned to it) is recorded without asking anyone. Every other task becomes one
// choice question for a decisions model, asked against a shared state describing each project by its summary, its
// goals, and the three open tasks most similar to it, along with the terms dictionary's definitions of the words
// those texts use. An answer the model is unsure of is recorded as advancing no project.
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { taskUuidFromRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";

export const CLASSIFICATION_BATCH_SIZE = 25;
export const EXAMPLE_TASK_COUNT = 3;
export const MINIMUM_CLASSIFICATION_CONFIDENCE = 0.5;
export const NO_PROJECT_CHOICE = "None of these projects";
export const CLASSIFIED_BY = Object.freeze({ decisions: "decisions", link: "link" });
// The longest a project's summary is quoted within a choice.
const CHOICE_SUMMARY_CHARACTERS = 100;

// ----------------------------------------------------------------------------------------------
// @desc The choice each project is offered under: its position and summary, so two projects never share a choice and
//   the model reads a name rather than a UUID.
// @param {Array<QuarterProject>} projects - The quarter's active projects, in plan order.
// @returns {Map<string, QuarterProject>} Projects by choice text, in plan order.
export function projectChoices(projects) {
  const choiceEntries = projects.map((project, index) => [`${ index + 1 }. ${ _shortened(project.summary, CHOICE_SUMMARY_CHARACTERS) }`, project]);
  return new Map(choiceEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc The open tasks that best show what a project's work looks like: those the ranker rated most similar, falling
//   back to the similarity hash for a record without its own score, and on a tie preferring a task linked to the
//   project directly.
// @param {QuarterProject} project - The project.
// @param {number} [count=EXAMPLE_TASK_COUNT] - How many to return.
// @returns {Array<string>} Task texts, most similar first.
export function projectExampleTasks(project, count = EXAMPLE_TASK_COUNT) {
  const hashScores = _hashScoresByTaskUuid(project.taskSimilarityScores || {});
  const records = (project.relatedTaskRecords || []).filter(record => record?.taskText);
  const scoredRecords = records.map(record => ({ linked: Boolean(record.linkedBy), score: Number.isFinite(record.matchScore)
    ? record.matchScore : hashScores.get(record.taskUuid) ?? 0, taskText: record.taskText }));
  const rankedRecords = scoredRecords.sort((first, second) => second.score - first.score || second.linked - first.linked);
  const exampleTexts = rankedRecords.slice(0, count).map(record => record.taskText);
  return exampleTexts;
}

// ----------------------------------------------------------------------------------------------
// @desc The project a completed task is linked to without asking a model: the one project that claims it through a
//   link reason. A task two projects claim, or none, is left for the model.
// @param {object} task - A completed task, carrying content, noteUUID, and uuid.
// @param {Array<QuarterProject>} projects - The quarter's active projects.
// @returns {QuarterProject|null} The linked project, or null.
export function linkedProject(task, projects) {
  const claimingProjects = projects.filter(project => project.taskLinkReason(task));
  return claimingProjects.length === 1 ? claimingProjects[0] : null;
}

// ----------------------------------------------------------------------------------------------
// @desc One choice question per completed task, named by the task's position in the batch, since a repeating task may
//   appear twice under one UUID.
// @param {Array<object>} tasks - Completed tasks, carrying content.
// @param {Map<string, QuarterProject>} choices - From projectChoices.
// @returns {object} Questions keyed `task_<position>`, positions starting at 1.
export function classificationQuestions(tasks, choices) {
  const choiceTexts = [...choices.keys(), NO_PROJECT_CHOICE];
  const questionEntries = tasks.map((task, index) => [_questionName(index), { choices: choiceTexts, instructions:
    `The user completed the task "${ _taskText(task) }". Which of the user's quarterly projects did completing it most `
    + `directly advance? Choose "${ NO_PROJECT_CHOICE }" when it advanced none of them, such as an errand or a chore.`,
  type: "choice" }]);
  return Object.fromEntries(questionEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc The state every question in a batch is asked about: each project, the terms the batch's text uses, and the
//   completed tasks being classified.
// @param {object} options - An object with the following properties:
//   - {Map<string, QuarterProject>} choices - From projectChoices
//   - {object} dictionary - The terms dictionary's definitions keyed by term; may be empty
//   - {Map<string, Array<string>>} [intentTextsByProjectUuid] - The plan goals each project serves
//   - {Array<object>} tasks - The batch's completed tasks
// @returns {object} { completedTasks, projects, terms }.
export function classificationState({ choices, dictionary, intentTextsByProjectUuid = new Map(), tasks }) {
  const projects = [...choices.entries()].map(([choice, project]) => {
    const goals = intentTextsByProjectUuid.get(project.uuid) || [];
    return { choice, exampleTasks: projectExampleTasks(project), ...(goals.length ? { goals } : {}), summary: project.summary };
  });
  const completedTasks = tasks.map(_taskText);
  const passages = [...completedTasks, ...projects.flatMap(project => [project.summary, ...project.exampleTasks, ...(project.goals || [])])];
  const terms = relevantDictionaryTerms(dictionary || {}, passages);
  return { completedTasks, projects, terms };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a batch's answers as ledger entries. A choice that names no project, names an unknown one, or was made
//   with less than the minimum confidence records the task as advancing none; an answer that reports no confidence
//   is taken as given. A task the model refused or skipped is left out, so a later run asks again.
// @param {DecisionsResponse} response - The batch's answers.
// @param {Array<object>} tasks - The batch's completed tasks, in question order.
// @param {object} options - { choices, classifiedAt, minimumConfidence = MINIMUM_CLASSIFICATION_CONFIDENCE }:
//   classifiedAt is an ISO timestamp.
// @returns {Array<object>} Ledger entries, as completedTaskEntry builds them.
export function classifiedEntries(response, tasks, { choices, classifiedAt, minimumConfidence = MINIMUM_CLASSIFICATION_CONFIDENCE }) {
  const entries = [];
  tasks.forEach((task, index) => {
    const answer = response.answerFor(_questionName(index));
    if (answer?.type !== "choice" || typeof answer.choice !== "string") return;
    const confident = !Number.isFinite(answer.confidence) || answer.confidence >= minimumConfidence;
    const project = confident ? choices.get(answer.choice) || null : null;
    entries.push(completedTaskEntry(task, { classifiedAt, classifiedBy: CLASSIFIED_BY.decisions, confidence: answer.confidence, project }));
  });
  return entries;
}

// ----------------------------------------------------------------------------------------------
// @desc A completed task as a ledger entry.
// @param {object} task - A completed task, carrying completedAt, content, and uuid.
// @param {object} options - { classifiedAt, classifiedBy, confidence = null, project }: project is null when the task
//   advanced none.
// @returns {object} { classifiedAt, classifiedBy, completedAt, confidence, dateKey, projectName, projectUuid, taskText,
//   taskUuid }: dateKey is the local day it was completed, which names the ledger section it is written to.
export function completedTaskEntry(task, { classifiedAt, classifiedBy, confidence = null, project }) {
  const completedDate = dateFromDateInput(task.completedAt);
  return { classifiedAt, classifiedBy, completedAt: completedDate.toISOString(), confidence: Number.isFinite(confidence) ? confidence : null,
    dateKey: dateKeyFromDateInput(completedDate), projectName: project?.summary || null, projectUuid: project?.uuid || null,
    taskText: _taskText(task), taskUuid: task.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Split tasks into batches of at most the given size.
// @param {Array<object>} tasks - Tasks to split.
// @param {number} [size=CLASSIFICATION_BATCH_SIZE] - Largest batch.
// @returns {Array<Array<object>>} Batches, in order.
export function classificationBatches(tasks, size = CLASSIFICATION_BATCH_SIZE) {
  const batches = [];
  for (let start = 0; start < tasks.length; start += size) batches.push(tasks.slice(start, start + size));
  return batches;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The highest similarity-hash score each task holds, since a task rated under several checksums keeps each.
// @param {object} taskSimilarityScores - Scores keyed `checksum:taskUuid`.
// @returns {Map<string, number>} Scores by task UUID.
function _hashScoresByTaskUuid(taskSimilarityScores) {
  const scores = new Map();
  for (const [ratingKey, score] of Object.entries(taskSimilarityScores)) {
    const taskUuid = taskUuidFromRatingKey(ratingKey);
    if (taskUuid && Number.isFinite(score)) scores.set(taskUuid, Math.max(score, scores.get(taskUuid) ?? -Infinity));
  }
  return scores;
}

// ----------------------------------------------------------------------------------------------
// @desc Name a batch's question by the task's position in it.
// @param {number} index - Zero-based position.
// @returns {string} Such as "task_1".
function _questionName(index) {
  return `task_${ index + 1 }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Cut text to a length, marking the cut.
// @param {string} text - Text to shorten.
// @param {number} characters - Longest result.
// @returns {string} The text, or its start followed by an ellipsis.
function _shortened(text, characters) {
  const singleLine = String(text || "").replace(/\s+/g, " ").trim();
  return singleLine.length <= characters ? singleLine : `${ singleLine.slice(0, characters - 1).trimEnd() }…`;
}

// ----------------------------------------------------------------------------------------------
// @desc A task's text on one line.
// @param {object} task - A task carrying content, or a record carrying taskText.
// @returns {string} The text.
function _taskText(task) {
  return String(task.content || task.taskText || "").replace(/\s+/g, " ").trim();
}
