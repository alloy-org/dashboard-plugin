// Gather the evidence that project discovery reasons over. Where intent evidence answers "what does this person
// work on", this answers the narrower question the planning note's Step 1 poses: which single undertaking, if
// done, would resolve the greatest number of the tasks actually on the list.
//
// The note names four signals, and each maps to a field below: tasks marked important and created in the past
// three months, tasks completed in the past month, the names of the notes those completions happened in, and how
// heavily loaded those notes are. The chosen intents from the wizard's first page come in too, since a project
// exists to carry an intent and a proposal that serves none is not worth showing.
//
// Two limits are deliberate rather than incidental. The note asks for "tasks marked Important in notes created
// by the author"; the plugin API exposes no creator field on a note handle, so domain scoping plus the
// planning-note exclusion is the available approximation and no authorship filter is applied. The note also asks
// for the ten notes opened most often in the past month; view counts are not exposed either, so the number of
// open tasks a note carries stands in as the available measure of an actively-worked note.

import { domainTasks, isGenuinelyCompleted, millisecondsFromTaskTimestamp, planningNoteUuids,
  taskEvidenceReference } from "plan-wizard/intent-evidence";

// "Completed in the past month" and "created in the past three months" come straight from the planning note.
export const COMPLETED_WINDOW_DAYS = 31;
export const IMPORTANT_WINDOW_MONTHS = 3;
// The note asks which ten notes are worked most heavily, and caps a prospect's qualifying evidence at two tasks.
export const MAXIMUM_ACTIVE_NOTES = 10;
export const MINIMUM_TASKS_PER_PROSPECT = 2;
// Prompt budget: enough tasks for a cluster to be visible, bounded so a busy account cannot blow the context.
export const MAXIMUM_EVIDENCE_TASKS = 120;

// ----------------------------------------------------------------------------------------------
// @desc Select the tasks a user flagged as important and created inside the important-task window. The note asks
//   for these separately from completions because an important task still open is a statement of intent, where a
//   completion is only a record of effort.
// @param {Array<object>} tasks - Candidate tasks, already scoped to the domain.
// @param {Date} referenceDate - "Now" for window arithmetic; injectable so tests need no clock control.
// @returns {Array<object>} Important tasks created inside the window, newest first.
export function importantTasksWithinWindow(tasks, referenceDate) {
  const windowStart = new Date(referenceDate.getTime());
  windowStart.setMonth(windowStart.getMonth() - IMPORTANT_WINDOW_MONTHS);
  const startMilliseconds = windowStart.getTime();
  const importantTasks = tasks.filter(task => task?.important);
  const withinWindow = importantTasks.filter(task => {
    const createdMilliseconds = millisecondsFromTaskTimestamp(task.createdAt);
    return createdMilliseconds !== null && createdMilliseconds >= startMilliseconds;
  });
  const sortedTasks = withinWindow.slice().sort((first, second) =>
    millisecondsFromTaskTimestamp(second.createdAt) - millisecondsFromTaskTimestamp(first.createdAt));
  return sortedTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Select genuinely completed tasks from the past month. This window is fixed rather than widening the way
//   intent evidence does: a theme worth building a quarter's project around should be visible in recent work, and
//   widening the window to find one would manufacture a cluster out of unrelated months.
// @param {Array<object>} tasks - Candidate tasks, already scoped to the domain.
// @param {Date} referenceDate - "Now" for window arithmetic.
// @returns {Array<object>} Completed tasks inside the window, newest first.
export function completedTasksWithinMonth(tasks, referenceDate) {
  const startMilliseconds = referenceDate.getTime() - COMPLETED_WINDOW_DAYS * 86400000;
  const genuinelyCompleted = tasks.filter(isGenuinelyCompleted);
  const withinWindow = genuinelyCompleted.filter(task => millisecondsFromTaskTimestamp(task.completedAt) >= startMilliseconds);
  const sortedTasks = withinWindow.slice().sort((first, second) =>
    millisecondsFromTaskTimestamp(second.completedAt) - millisecondsFromTaskTimestamp(first.completedAt));
  return sortedTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Rank the notes that recent work happened in, so the prompt can ask whether a note name describes an
//   active project rather than a generic inbox. Ranking is by completions first and open load second, which puts
//   a note that is both finishing and accumulating work above one that is merely long.
// @param {Array<object>} completedTasks - Completions inside the month window.
// @param {Array<object>} openTasks - Tasks in scope that are not completed.
// @returns {Array<object>} Up to MAXIMUM_ACTIVE_NOTES { completedTaskCount, noteName, noteUuid, openTaskCount }.
export function activeNoteSummaries(completedTasks, openTasks) {
  const summaryByNoteUuid = new Map();
  for (const task of completedTasks) {
    if (!task.noteUUID) continue;
    const summary = summaryByNoteUuid.get(task.noteUUID)
      ?? { completedTaskCount: 0, noteName: task.noteName ?? null, noteUuid: task.noteUUID, openTaskCount: 0 };
    summary.completedTaskCount += 1;
    summary.noteName = summary.noteName ?? task.noteName ?? null;
    summaryByNoteUuid.set(task.noteUUID, summary);
  }
  for (const task of openTasks) {
    const summary = summaryByNoteUuid.get(task.noteUUID);
    if (summary) summary.openTaskCount += 1;
  }
  const summaries = [...summaryByNoteUuid.values()];
  const rankedSummaries = summaries.sort((first, second) =>
    second.completedTaskCount - first.completedTaskCount || second.openTaskCount - first.openTaskCount);
  return rankedSummaries.slice(0, MAXIMUM_ACTIVE_NOTES);
}

// ----------------------------------------------------------------------------------------------
// @desc Collect every signal project discovery needs for one planning scope, alongside the intents the user has
//   already chosen and the summaries they have already turned down. The rejected summaries travel with the
//   evidence so a discovery pass can be told what not to raise again, rather than proposing a rejected idea and
//   relying on the merge to silently drop it.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Resolved plan scope from resolvePlanScope.
// @param {object} planningContext - Context from readPlanGoals; supplies chosen goals and prospect history.
// @param {object} [options] - { referenceDate } for deterministic windows in tests.
// @returns {Promise<object>} { activeNotes, chosenGoals, completedReferences, coverage, importantReferences,
//   quarterMonths, recentReferences, rejectedSummaries } evidence bundle, JSON-serializable.
export async function collectProspectEvidence(app, scope, planningContext, { referenceDate = new Date() } = {}) {
  const excludedNoteUuids = await planningNoteUuids(app);
  const allTasks = await domainTasks(app, scope.domainUuid);
  const candidateTasks = allTasks.filter(task => task?.noteUUID && !excludedNoteUuids.has(task.noteUUID));
  const completedTasks = completedTasksWithinMonth(candidateTasks, referenceDate);
  const openTasks = candidateTasks.filter(task => !isGenuinelyCompleted(task));
  const importantTasks = importantTasksWithinWindow(candidateTasks, referenceDate);
  const importantUuids = new Set(importantTasks.map(task => task.uuid));
  const remainingOpenTasks = openTasks.filter(task => task?.uuid && !importantUuids.has(task.uuid));
  const recentTasks = recentlyCreatedOpenTasks(remainingOpenTasks);
  const activeNotes = activeNoteSummaries(completedTasks, openTasks);
  const coverage = { collectedAt: new Date(referenceDate.getTime()).toISOString(),
    completedTaskCount: completedTasks.length, completedWindowDays: COMPLETED_WINDOW_DAYS,
    importantTaskCount: importantTasks.length, importantWindowMonths: IMPORTANT_WINDOW_MONTHS,
    recentTaskCount: recentTasks.length };
  return { activeNotes, chosenGoals: chosenGoalReferences(planningContext),
    completedReferences: boundedReferences(completedTasks), coverage,
    importantReferences: boundedReferences(importantTasks), quarterMonths: monthLabelsForQuarter(scope),
    recentReferences: boundedReferences(recentTasks), rejectedSummaries: rejectedProspectSummaries(planningContext) };
}

// ----------------------------------------------------------------------------------------------
// @desc List the YYYY-MM labels belonging to a planning quarter, so a proposal can only claim months the quarter
//   actually contains and the ActionProspect focusMonths contract is satisfied by construction.
// @param {object} scope - Resolved plan scope carrying quarter and year.
// @returns {Array<string>} Three YYYY-MM labels in calendar order.
export function monthLabelsForQuarter(scope) {
  const firstMonthIndex = (scope.quarter - 1) * 3;
  return [0, 1, 2].map(offset => `${ scope.year }-${ String(firstMonthIndex + offset + 1).padStart(2, "0") }`);
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce the chosen goals to what a proposal needs in order to tie itself to one: the identity to cite and
//   the text to reason about. Ranks are preserved so the prompt can favor a first-ranked intent.
// @param {object} planningContext - Context from readPlanGoals.
// @returns {Array<object>} { goalRank, goalText, userCategoryEm, uuid } for each live goal.
function chosenGoalReferences(planningContext) {
  const goals = Array.isArray(planningContext?.goals) ? planningContext.goals : [];
  return goals.map(goal => ({ goalRank: goal.goalRank, goalText: goal.goalText, userCategoryEm: goal.userCategoryEm,
    uuid: goal.uuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc Collect the summaries of projects the user has already rejected or retired, so discovery can be told not
//   to raise them again.
// @param {object} planningContext - Context from readPlanGoals; prospectRecords includes judged history.
// @returns {Array<string>} Summaries the user has turned down.
function rejectedProspectSummaries(planningContext) {
  const records = Array.isArray(planningContext?.prospectRecords) ? planningContext.prospectRecords : [];
  const declinedRecords = records.filter(record => ["humanRejected", "humanRetired"]
    .includes(record.approvalStatusEm));
  return declinedRecords.map(record => record.summary);
}

// ----------------------------------------------------------------------------------------------
// @desc Order open tasks by when they were created so the newest intentions reach the prompt. These supplement
//   the important and completed signals: a task created last week is what the user is turning to next, whether or
//   not they marked it important.
// @param {Array<object>} tasks - Open tasks not already selected as important evidence.
// @returns {Array<object>} Tasks carrying a creation time, newest first.
function recentlyCreatedOpenTasks(tasks) {
  const datedTasks = tasks.filter(task => millisecondsFromTaskTimestamp(task.createdAt) !== null);
  const sortedTasks = datedTasks.slice().sort((first, second) =>
    millisecondsFromTaskTimestamp(second.createdAt) - millisecondsFromTaskTimestamp(first.createdAt));
  return sortedTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Convert tasks into the compact references a prompt and a stored citation share, capped so one signal
//   cannot crowd the others out of the prompt budget.
// @param {Array<object>} tasks - Tasks to reference.
// @returns {Array<object>} Up to MAXIMUM_EVIDENCE_TASKS evidence references.
function boundedReferences(tasks) {
  return tasks.slice(0, MAXIMUM_EVIDENCE_TASKS).map(taskEvidenceReference);
}
