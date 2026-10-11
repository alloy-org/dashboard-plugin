// Rate the potential of each completed task the ledger associated with a quarterly project, and decide the victory value
// it earns. Each task is asked two 1–10 score questions of a decisions model: its long-term potential upside for the
// project, and its short-term predicted impact on it. The sum of the two is the task's victory value when that exceeds
// the value it already has; a rating never lowers a value. The ratings, the value before, and the value applied are
// kept on the task's ledger entry, so a task is rated once, and the Victory Value chart can show an applied value even
// when Amplenote kept the task's own.
import { ledgerEntryKey } from "dashboard/projects/completed-task-project-ledger";
import { relevantDictionaryTerms } from "plan-wizard/stack-rank/build-project-task-context";
import { scoreQuestion } from "providers/decisions-endpoint";

export const POTENTIAL_BATCH_SIZE = 10;
// Why a recorded task was marked rated without being asked about: its completion could no longer be found.
export const POTENTIAL_SKIPPED_COMPLETION_MISSING = "completion not found";
export const LONG_TERM_UPSIDE_CRITERIA = Object.freeze([
  "No lasting effect on the project; the work will not matter a month from now.",
  "A trivial lasting effect, such as tidying something that would soon need tidying again.",
  "A minor lasting effect that saves a little time or effort later in the project.",
  "A small lasting improvement that a later step of the project will build on.",
  "A moderate lasting improvement that makes several later steps easier.",
  "A meaningful foundation that much of the project's remaining work depends on.",
  "A significant lasting gain that changes how quickly the project can reach its goal.",
  "A major lasting gain that opens new options or outcomes for the project.",
  "A pivotal step whose payoff is likely to compound for the rest of the year.",
  "A transformative step that could decide whether the project, and the goal it serves, succeeds.",
]);
export const SHORT_TERM_IMPACT_CRITERIA = Object.freeze([
  "Did not move the project forward this week.",
  "Moved the project forward by a barely noticeable amount.",
  "Cleared a small item from the project's way without changing its pace.",
  "Completed a small but real piece of the project's current work.",
  "Completed a moderate piece of the project's current work.",
  "Unblocked or finished a step the project's current work was waiting on.",
  "Delivered a visible result that people involved in the project will notice.",
  "Delivered one of the most important results of the project's current work.",
  "Delivered a milestone of the project, or most of one.",
  "Delivered the project's most important milestone this quarter, or the project itself.",
]);

// ----------------------------------------------------------------------------------------------
// @desc The ledger entries still to be rated: those the ledger associated with a project and that carry no rating time.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key, as readCompletedTaskLedger returns them.
// @returns {Array<object>} Entries, oldest day first, each carrying its dateKey.
export function unscoredProjectEntries(entriesByDate) {
  const unscoredEntries = [];
  const chronologicalDateKeys = [...entriesByDate.keys()].sort();
  for (const dateKey of chronologicalDateKeys) {
    for (const entry of entriesByDate.get(dateKey) || []) {
      if (!entry?.taskUuid || !entry.projectUuid || entry.potentialScoredAt) continue;
      unscoredEntries.push({ ...entry, dateKey: entry.dateKey || dateKey });
    }
  }
  return unscoredEntries;
}

// ----------------------------------------------------------------------------------------------
// @desc Two score questions per entry, named by the entry's position in the batch: "upside_<n>" for its long-term
//   potential upside and "impact_<n>" for its short-term predicted impact, each on a 1–10 rubric.
// @param {Array<object>} entries - The batch's ledger entries, carrying projectName and taskText.
// @returns {object} Questions keyed by name, positions starting at 1.
export function potentialQuestions(entries) {
  const questionEntries = entries.flatMap((entry, index) => {
    const taskDescription = `The user completed the task "${ entry.taskText }", which advanced their quarterly project `
      + `"${ entry.projectName || "Unnamed project" }".`;
    return [[_upsideQuestionName(index), scoreQuestion(`${ taskDescription } Rate the Long-term Potential Upside of `
      + "completing it: how much it is likely to pay off for the project over the coming months.", [...LONG_TERM_UPSIDE_CRITERIA])],
    [_impactQuestionName(index), scoreQuestion(`${ taskDescription } Rate its Short-term predicted impact: how much `
      + "completing it moved the project forward this week.", [...SHORT_TERM_IMPACT_CRITERIA])]];
  });
  return Object.fromEntries(questionEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc The state every question in a batch is asked about: each completed task with the project it advanced, the
//   goals of each of those projects the plan states, and the terms dictionary's definitions of the words they use.
// @param {object} options - An object with the following properties:
//   - {object} dictionary - The terms dictionary's definitions keyed by term; may be empty
//   - {Array<object>} entries - The batch's ledger entries
//   - {Map<string, Array<string>>} [intentTextsByProjectUuid] - The plan goals each active project serves
// @returns {object} { completedTasks, projects, terms }: completedTasks as { project, task }, projects as
//   { goals, summary } for each project with stated goals.
export function potentialState({ dictionary, entries, intentTextsByProjectUuid = new Map() }) {
  const completedTasks = entries.map(entry => ({ project: entry.projectName || "Unnamed project", task: entry.taskText }));
  const projectsByUuid = new Map();
  for (const entry of entries) {
    const goals = intentTextsByProjectUuid.get(entry.projectUuid) || [];
    if (goals.length && !projectsByUuid.has(entry.projectUuid)) projectsByUuid.set(entry.projectUuid, { goals, summary: entry.projectName });
  }
  const projects = [...projectsByUuid.values()];
  const passages = [...completedTasks.flatMap(({ project, task }) => [project, task]), ...projects.flatMap(project => project.goals)];
  const terms = relevantDictionaryTerms(dictionary || {}, passages);
  return { completedTasks, projects, terms };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a batch's ratings. An entry missing either rating, because the model refused or skipped it, is left out,
//   so a later run asks again.
// @param {DecisionsResponse} response - The batch's answers.
// @param {Array<object>} entries - The batch's ledger entries, in question order.
// @returns {Array<object>} { entry, longTermUpside, shortTermImpact }, ratings on the 1–10 scale.
export function potentialRatings(response, entries) {
  const ratings = [];
  entries.forEach((entry, index) => {
    const longTermUpside = response.ratingFor(_upsideQuestionName(index));
    const shortTermImpact = response.ratingFor(_impactQuestionName(index));
    if (longTermUpside === null || shortTermImpact === null) return;
    ratings.push({ entry, longTermUpside, shortTermImpact });
  });
  return ratings;
}

// ----------------------------------------------------------------------------------------------
// @desc The victory value a rated task earns: the sum of its two ratings, to one decimal place, when that exceeds the
//   value it has. A rating never lowers a value.
// @param {object} ratings - { longTermUpside, shortTermImpact }.
// @param {number|null|undefined} currentVictoryValue - The task's victory value as Amplenote reports it now.
// @returns {number|null} The raised value, or null when the task keeps its own.
export function raisedVictoryValue({ longTermUpside, shortTermImpact }, currentVictoryValue) {
  const earnedValue = Math.round((longTermUpside + shortTermImpact) * 10) / 10;
  const currentValue = Number.isFinite(currentVictoryValue) ? currentVictoryValue : 0;
  return earnedValue > currentValue ? earnedValue : null;
}

// ----------------------------------------------------------------------------------------------
// @desc A ledger entry carrying its rating and what was done with it.
// @param {object} entry - The entry as the ledger held it.
// @param {object} rating - An object with the following properties:
//   - {number|null} appliedVictoryValue - The value the task was raised to, or null when it kept its own
//   - {number} longTermUpside - Its long-term potential upside, 1–10
//   - {string} potentialScoredAt - ISO time of the rating
//   - {number|null} priorVictoryValue - Its victory value when it was rated
//   - {boolean|null} raiseConfirmed - Whether Amplenote reported the raised value afterward; null without a raise
//   - {number} shortTermImpact - Its short-term predicted impact, 1–10
// @returns {object} The entry with those fields.
export function potentialEntry(entry, { appliedVictoryValue, longTermUpside, potentialScoredAt, priorVictoryValue, raiseConfirmed,
    shortTermImpact }) {
  return { ...entry, appliedVictoryValue, longTermUpside, potentialScoredAt, priorVictoryValue, raiseConfirmed, shortTermImpact };
}

// ----------------------------------------------------------------------------------------------
// @desc A ledger entry marked rated without being asked about, so it is never looked for again.
// @param {object} entry - The entry as the ledger held it.
// @param {object} options - { potentialScoredAt, reason }.
// @returns {object} The entry, carrying potentialScoredAt and potentialSkippedReason.
export function skippedPotentialEntry(entry, { potentialScoredAt, reason }) {
  return { ...entry, potentialScoredAt, potentialSkippedReason: reason };
}

// ----------------------------------------------------------------------------------------------
// @desc Index the victory values the rating job applied, by completion.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key.
// @returns {Map<string, number>} Applied victory value by ledgerEntryKey, for each entry that was raised.
export function appliedVictoryValuesByCompletion(entriesByDate) {
  const appliedValues = new Map();
  for (const [dateKey, entries] of entriesByDate) {
    for (const entry of entries || []) {
      if (!entry?.taskUuid || !Number.isFinite(entry.appliedVictoryValue)) continue;
      appliedValues.set(ledgerEntryKey({ dateKey: entry.dateKey || dateKey, taskUuid: entry.taskUuid }), entry.appliedVictoryValue);
    }
  }
  return appliedValues;
}

// ----------------------------------------------------------------------------------------------
// @desc The completed tasks as the chart shows them: a task the rating job raised shows the higher of its own victory
//   value and the applied one, so a raise appears as soon as the ledger records it, and still appears should Amplenote
//   have kept the task's own value.
// @param {object} completedTasksByDate - Completed tasks grouped by local date key.
// @param {object|null} completedTaskProjects - Ledger lookups carrying appliedVictoryValuesByCompletion, or null.
// @returns {object} Completed tasks grouped by date key; the same object when no task was raised.
export function completedTasksWithAppliedValues(completedTasksByDate, completedTaskProjects) {
  const appliedValues = completedTaskProjects?.appliedVictoryValuesByCompletion;
  if (!completedTasksByDate || !appliedValues?.size) return completedTasksByDate;
  const displayedTasksByDate = {};
  for (const [dateKey, tasks] of Object.entries(completedTasksByDate)) {
    displayedTasksByDate[dateKey] = (tasks || []).map(task => {
      const appliedValue = task?.uuid ? appliedValues.get(ledgerEntryKey({ dateKey, taskUuid: task.uuid })) : undefined;
      return Number.isFinite(appliedValue) && appliedValue > (task.victoryValue || 0) ? { ...task, victoryValue: appliedValue } : task;
    });
  }
  return displayedTasksByDate;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Name a batch entry's short-term impact question by its position.
// @param {number} index - Zero-based position.
// @returns {string} Such as "impact_1".
function _impactQuestionName(index) {
  return `impact_${ index + 1 }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Name a batch entry's long-term upside question by its position.
// @param {number} index - Zero-based position.
// @returns {string} Such as "upside_1".
function _upsideQuestionName(index) {
  return `upside_${ index + 1 }`;
}
