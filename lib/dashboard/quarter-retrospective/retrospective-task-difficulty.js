// Rate how difficult each of a quarter's project tasks must have been to pull off, and build the retrospective's
// "Aw no you di'nt" slide from the ratings. Every completed task of a project with at least
// MINIMUM_DIFFICULTY_PROJECT_TASKS completions is asked one 1–10 score question of a decisions model, in batches that
// each hold one project's tasks so the model weighs them against one another. A project's three hardest tasks rated
// above MINIMUM_SHOWN_DIFFICULTY are shown. Ratings are recorded in the retrospective's data note, and a task rated by
// an earlier generation keeps that rating rather than being asked about again.
import { RETROSPECTIVE_SECTIONS } from "dashboard/quarter-retrospective/retrospective-data-note";
import { SLIDE_KINDS } from "dashboard/quarter-retrospective/retrospective-slides";
import { scoreQuestion } from "providers/decisions-endpoint";
import { forEachWithConcurrency } from "util/concurrency";
import { logIfEnabled } from "util/log";

export const HARDEST_TASKS_SLIDE_ID = "hardest-tasks";
export const MINIMUM_DIFFICULTY_PROJECT_TASKS = 5;
// A task is shown only when its difficulty is above this, so a project of routine work is left off the slide.
export const MINIMUM_SHOWN_DIFFICULTY = 5;
export const LISTED_HARDEST_TASKS = 3;
export const DIFFICULTY_BATCH_SIZE = 20;
const DIFFICULTY_REQUEST_CONCURRENCY = 3;
// The footnote text sent with a task is clipped to this, enough to tell what the task involved.
const DIFFICULTY_DETAIL_CHARACTERS = 300;
// The task text recorded with a rating in the data note is clipped to this.
const RECORDED_TASK_CHARACTERS = 80;
// The slide holds longer for each project it lists past the first, up to MAXIMUM_HARDEST_TASKS_DURATION_FACTOR.
const HARDEST_TASKS_DURATION_STEP = 0.35;
const MAXIMUM_HARDEST_TASKS_DURATION_FACTOR = 2.5;
const DIFFICULTY_LOG_LABEL = "[retrospective-task-difficulty]";
export const DIFFICULTY_QUESTION = "Which of these must have been most difficult to pull off, requiring either 10+ hours of "
  + "work, impeccable consistency, or undertaking actions that very few people could?";
export const DIFFICULTY_CRITERIA = Object.freeze([
  "As difficult as: Sent a brief email to an acquaintance.",
  "As difficult as: Paid a bill online or booked a routine appointment.",
  "As difficult as: Did my daily exercise routine.",
  "As difficult as: Tidied a shared document or answered a few involved emails.",
  "As difficult as: An hour of research on a tricky problem.",
  "As difficult as: Drafted a detailed proposal over an afternoon of focused work.",
  "As difficult as: Submit my college application to the best state school.",
  "As difficult as: Shipped a significant feature after several days of work, or kept a demanding habit for a month.",
  "As difficult as: Message 10 industry leaders a personalized pitch to keynote this year's conference.",
  "As difficult as: Clear out 500 emails to reach inbox 0.",
]);

// ----------------------------------------------------------------------------------------------
// @desc One score question per task, named by its position in the batch, each asking how difficult the task must have
//   been on the DIFFICULTY_CRITERIA rubric.
// @param {Array<object>} completions - The batch's completions, carrying text.
// @returns {object} Questions keyed by name, such as "difficulty_1".
export function difficultyQuestions(completions) {
  const questionEntries = completions.map((completion, index) => [_difficultyQuestionName(index),
    scoreQuestion(`${ DIFFICULTY_QUESTION } Rate task ${ index + 1 }, "${ completion.text }", by how difficult it must have `
      + "been to complete.", [...DIFFICULTY_CRITERIA])]);
  return Object.fromEntries(questionEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc The projects whose tasks are rated: those credited with at least MINIMUM_DIFFICULTY_PROJECT_TASKS completions.
// @param {Array<object>} completions - Completions, those in a project carrying projectName and projectUuid.
// @returns {Array<object>} { completions, name, projectUuid } per qualifying project, in the order first seen.
export function difficultyRatedProjects(completions) {
  const projectsByUuid = new Map();
  for (const completion of completions || []) {
    if (!completion?.projectUuid || !completion.taskUuid) continue;
    if (!projectsByUuid.has(completion.projectUuid)) {
      projectsByUuid.set(completion.projectUuid, { completions: [], name: completion.projectName || "Unnamed project",
        projectUuid: completion.projectUuid });
    }
    projectsByUuid.get(completion.projectUuid).completions.push(completion);
  }
  const projects = [...projectsByUuid.values()];
  const qualifyingProjects = projects.filter(project => project.completions.length >= MINIMUM_DIFFICULTY_PROJECT_TASKS);
  return qualifyingProjects;
}

// ----------------------------------------------------------------------------------------------
// @desc The state a batch's questions are asked about: the project and its tasks, numbered as the questions are.
// @param {object} options - { completions, projectName }: completions carry text, and optionally footnoteText and
//   noteName.
// @returns {object} { completedTasks, project }, completedTasks as { details?, note?, number, task }.
export function difficultyState({ completions, projectName }) {
  const completedTasks = completions.map((completion, index) => {
    const described = { number: index + 1, task: completion.text };
    if (completion.noteName) described.note = completion.noteName;
    const details = String(completion.footnoteText || "").trim();
    if (details) described.details = details.slice(0, DIFFICULTY_DETAIL_CHARACTERS);
    return described;
  });
  return { completedTasks, project: projectName };
}

// ----------------------------------------------------------------------------------------------
// @desc Each project's three hardest tasks, for projects with at least MINIMUM_DIFFICULTY_PROJECT_TASKS completions and
//   at least one task rated above MINIMUM_SHOWN_DIFFICULTY. Within a project, tasks are ordered by difficulty, then
//   Victory Value; projects are ordered by their hardest task, then by how many tasks they completed.
// @param {Array<object>} completions - Completions credited to projects, carrying projectName, projectUuid, taskUuid,
//   text, and victoryValue.
// @param {Map<string, number>} difficultyByTaskUuid - Ratings, 1–10.
// @returns {Array<object>} { name, taskCount, tasks } per project, tasks as { difficulty, text }.
export function hardestTaskProjects(completions, difficultyByTaskUuid) {
  const hardestProjects = [];
  for (const project of difficultyRatedProjects(completions)) {
    const rated = project.completions.filter(completion => difficultyByTaskUuid.get(completion.taskUuid) > MINIMUM_SHOWN_DIFFICULTY);
    const ratedTasks = rated.map(completion => ({ difficulty: difficultyByTaskUuid.get(completion.taskUuid), text: completion.text,
      victoryValue: completion.victoryValue || 0 }));
    const orderedTasks = ratedTasks.sort((first, second) => second.difficulty - first.difficulty || second.victoryValue - first.victoryValue);
    const listedTasks = orderedTasks.slice(0, LISTED_HARDEST_TASKS).map(task => ({ difficulty: task.difficulty, text: task.text }));
    if (listedTasks.length) hardestProjects.push({ name: project.name, taskCount: project.completions.length, tasks: listedTasks });
  }
  const orderedProjects = hardestProjects.sort((first, second) => second.tasks[0].difficulty - first.tasks[0].difficulty
    || second.taskCount - first.taskCount);
  return orderedProjects;
}

// ----------------------------------------------------------------------------------------------
// @desc The "Aw no you di'nt" slide listing each project's hardest tasks. It holds longer the more projects it lists,
//   since the list scrolls.
// @param {Array<object>} hardestProjects - From hardestTaskProjects.
// @returns {object|null} A slide of kind hardestTasks carrying hardestProjects, or null when no project qualifies.
export function hardestTasksSlide(hardestProjects) {
  if (!hardestProjects?.length) return null;
  const durationFactor = Math.min(MAXIMUM_HARDEST_TASKS_DURATION_FACTOR, 1 + (hardestProjects.length - 1) * HARDEST_TASKS_DURATION_STEP);
  return { caption: `Difficulty out of 10, for projects with at least ${ MINIMUM_DIFFICULTY_PROJECT_TASKS } completed tasks.`, durationFactor,
    figure: null, hardestProjects, headline: "Aw no you di'nt", id: HARDEST_TASKS_SLIDE_ID, items: [], kicker: "Degree of difficulty",
    kind: SLIDE_KINDS.hardestTasks, subheadline: "Which tasks impressed our 'task difficulty' ranker most?", tone: "ember" };
}

// ----------------------------------------------------------------------------------------------
// @desc Rate the difficulty of every task in the qualifying projects that has no recorded rating. A batch whose
//   request fails is logged and left unrated, so one failure costs only its own tasks.
// @param {Array<object>} completions - Completions credited to projects.
// @param {object} options - An object with the following properties:
//   - {DecisionsEndpoint} endpoint - Where the score questions are asked
//   - {Map<string, number>} [recordedDifficulties] - Ratings an earlier generation recorded, by task UUID
// @returns {Promise<Map<string, number>>} Every known rating by task UUID, recorded ones included.
export async function rateTaskDifficulties(completions, { endpoint, recordedDifficulties = new Map() }) {
  const difficultyByTaskUuid = new Map();
  const batches = [];
  for (const project of difficultyRatedProjects(completions)) {
    const unrated = [];
    for (const completion of project.completions) {
      if (recordedDifficulties.has(completion.taskUuid)) difficultyByTaskUuid.set(completion.taskUuid, recordedDifficulties.get(completion.taskUuid));
      else unrated.push(completion);
    }
    for (let start = 0; start < unrated.length; start += DIFFICULTY_BATCH_SIZE) {
      batches.push({ completions: unrated.slice(start, start + DIFFICULTY_BATCH_SIZE), projectName: project.name });
    }
  }
  await forEachWithConcurrency(batches, DIFFICULTY_REQUEST_CONCURRENCY, async batch => {
    try {
      const response = await endpoint.rankedResponses({ questions: difficultyQuestions(batch.completions), state: difficultyState(batch) });
      batch.completions.forEach((completion, index) => {
        const difficulty = response.ratingFor(_difficultyQuestionName(index));
        if (difficulty !== null) difficultyByTaskUuid.set(completion.taskUuid, difficulty);
      });
    } catch (error) {
      logIfEnabled(`${ DIFFICULTY_LOG_LABEL } could not rate ${ batch.projectName }`, error?.message);
    }
  });
  logIfEnabled(`${ DIFFICULTY_LOG_LABEL } rated`, { batchCount: batches.length, ratedCount: difficultyByTaskUuid.size });
  return difficultyByTaskUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc The ratings the quarter's earlier generations recorded, newest note first so its rating wins.
// @param {Array<object>} dataNotes - From findRetrospectiveDataNotes, newest first.
// @returns {Map<string, number>} Difficulty by task UUID.
export function recordedTaskDifficulties(dataNotes) {
  const difficultyByTaskUuid = new Map();
  for (const dataNote of dataNotes || []) {
    const ratings = dataNote.payloads?.get(RETROSPECTIVE_SECTIONS.taskDifficulty)?.ratings;
    for (const rating of Array.isArray(ratings) ? ratings : []) {
      if (!rating?.taskUuid || !Number.isFinite(rating.difficulty) || difficultyByTaskUuid.has(rating.taskUuid)) continue;
      difficultyByTaskUuid.set(rating.taskUuid, rating.difficulty);
    }
  }
  return difficultyByTaskUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Add the hardest tasks slide to a story just before its summary slide, or at its end when it has none.
// @param {Array<object>} slides - The story's slides.
// @param {object|null} slide - From hardestTasksSlide.
// @returns {Array<object>} The slides with the hardest tasks slide placed, or as given when there is none.
export function slidesWithHardestTasks(slides, slide) {
  if (!slide) return slides;
  const summaryIndex = slides.findIndex(existing => existing.id === "summary");
  const insertIndex = summaryIndex === -1 ? slides.length : summaryIndex;
  return [...slides.slice(0, insertIndex), slide, ...slides.slice(insertIndex)];
}

// ----------------------------------------------------------------------------------------------
// @desc The Task Difficulty section a data note records, so a later generation can reuse the ratings.
// @param {Array<object>} completions - The completions that were rated.
// @param {Map<string, number>} difficultyByTaskUuid - Ratings by task UUID.
// @returns {object|null} { ratings } as { difficulty, taskUuid, text }, or null when nothing was rated.
export function taskDifficultyPayload(completions, difficultyByTaskUuid) {
  const ratedCompletions = (completions || []).filter(completion => difficultyByTaskUuid.has(completion.taskUuid));
  if (!ratedCompletions.length) return null;
  const ratings = ratedCompletions.map(completion => ({ difficulty: difficultyByTaskUuid.get(completion.taskUuid), taskUuid: completion.taskUuid,
    text: String(completion.text || "").slice(0, RECORDED_TASK_CHARACTERS) }));
  return { ratings };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Name a batch task's difficulty question by its position.
// @param {number} index - Zero-based position.
// @returns {string} Such as "difficulty_1".
function _difficultyQuestionName(index) {
  return `difficulty_${ index + 1 }`;
}
