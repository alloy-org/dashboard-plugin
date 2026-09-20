// Turn the wizard's stored planning context into the one-line summaries the progress sidebar shows beneath each
// step name, plus the completion flag that decides whether a step is drawn as answered.
//
// Kept apart from the sidebar component so the counting rules can be exercised without rendering, and so the
// sidebar stays a presentational list. Each step's summary reads the same stored fields its own page writes, so
// a row can never claim progress the user has not actually saved.
//
// A step with nothing stored yields a null summary rather than a zero count ("0 projects" reads as a failure
// where "not yet answered" is the truth), and the sidebar renders the step name alone in that case.

import { answerTextFromRecord } from "dashboard/plan-wizard/quarter-answer-fields";
import { PACE_OPTIONS } from "dashboard/plan-wizard/pace-cards-step-fields";
import { isDeclinedActionProspect } from "plan-wizard/plan-models";

// The short sidebar label for each step, which is not the page's own question-length title: "At the highest
// level, this quarter will be a success if..." is the right prompt on the page and far too long for a rail.
const STEP_SIDEBAR_LABEL = { "enough-for-today": "Define “done enough”", intent: "High-level intent",
  "pace-cards": "Project cadence", projects: "Project list", "quarter-name": "Quarter name" };

// ----------------------------------------------------------------------------------------------
// @desc Read the sidebar's short label for a step, falling back to the step's own title where a step has been
//   added to the sequence without a label of its own.
// @param {object} wizardStep - A WIZARD_STEPS entry.
// @returns {string} Label to show in the sidebar rail.
export function sidebarLabelFromStep(wizardStep) {
  return STEP_SIDEBAR_LABEL[wizardStep.key] ?? wizardStep.title;
}

// ----------------------------------------------------------------------------------------------
// @desc Count the quarter's saved goals by category, as "3 professional · 2 personal". Personal is optional, so
//   it is named only when the user actually recorded one.
// @param {object} planningContext - Context returned by usePlanWizard.
// @returns {string|null} Summary line, or null when no goal has been saved yet.
function intentSummary(planningContext) {
  const savedGoals = planningContext.goals.filter(goal => goal.goalText?.trim());
  if (savedGoals.length === 0) return null;
  const professionalGoals = savedGoals.filter(goal => goal.userCategoryEm === "work");
  const personalGoals = savedGoals.filter(goal => goal.userCategoryEm === "personal");
  const summaryParts = [`${ professionalGoals.length } professional`];
  if (personalGoals.length > 0) summaryParts.push(`${ personalGoals.length } personal`);
  return summaryParts.join(" · ");
}

// ----------------------------------------------------------------------------------------------
// @desc Count the projects the user is carrying into the quarter, excluding the ones they declined with Not now
//   or Remove, since a declined project is not part of the plan the sidebar is reporting.
// @param {object} planningContext - Context returned by usePlanWizard.
// @returns {Array<object>} Live, named ActionProspect records.
function liveProspects(planningContext) {
  const namedProspects = planningContext.prospects.filter(prospect => prospect.summary?.trim());
  const keptProspects = namedProspects.filter(prospect => !isDeclinedActionProspect(prospect));
  return keptProspects;
}

// ----------------------------------------------------------------------------------------------
// @desc Report how many projects the quarter carries, as "6 projects".
// @param {object} planningContext - Context returned by usePlanWizard.
// @returns {string|null} Summary line, or null before any project is kept.
function projectsSummary(planningContext) {
  const keptProspects = liveProspects(planningContext);
  if (keptProspects.length === 0) return null;
  return `${ keptProspects.length } project${ keptProspects.length === 1 ? "" : "s" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Group the paced projects by the rhythm chosen for each, as "2 two focused blocks · 1 deadline sprint".
//   Rhythms are listed in the pace page's own option order so the sidebar reads in the same sequence the user
//   chose from, and a project with no pace selected is left out rather than counted as an unnamed rhythm.
// @param {object} planningContext - Context returned by usePlanWizard.
// @returns {string|null} Summary line, or null before any pace is selected.
function paceSummary(planningContext) {
  const pacedProspects = liveProspects(planningContext).filter(prospect => prospect.paceEm);
  if (pacedProspects.length === 0) return null;
  const summaryParts = [];
  for (const paceOption of PACE_OPTIONS) {
    const optionProspects = pacedProspects.filter(prospect => prospect.paceEm === paceOption.value);
    if (optionProspects.length === 0) continue;
    summaryParts.push(`${ optionProspects.length } ${ paceOption.label.toLowerCase() }`);
  }
  return summaryParts.join(" · ");
}

// ----------------------------------------------------------------------------------------------
// @desc Show the name the user settled on for the quarter, quoted so it reads as their words rather than as a
//   count like the rows above it.
// @param {object} planningContext - Context returned by usePlanWizard.
// @returns {string|null} Summary line, or null before a name is saved.
function quarterNameSummary(planningContext) {
  const storedName = answerTextFromRecord(planningContext.quarterName);
  if (!storedName.trim()) return null;
  return `“${ storedName.trim() }”`;
}

// ----------------------------------------------------------------------------------------------
// @desc Report the final page's state. The page is optional, so an unanswered row says so rather than reading as
//   an outstanding requirement, and an answered one says the bar is set without repeating its whole sentence,
//   which is a paragraph the rail has no room for.
// @param {object} planningContext - Context returned by usePlanWizard.
// @returns {string} Summary line; this row always carries one.
function doneEnoughSummary(planningContext) {
  const storedAnswer = answerTextFromRecord(planningContext.dailySufficiency);
  return storedAnswer.trim() ? "Daily bar set" : "Optional";
}

const STEP_SUMMARY_READER = { "enough-for-today": doneEnoughSummary, intent: intentSummary, "pace-cards": paceSummary,
  projects: projectsSummary, "quarter-name": quarterNameSummary };

// ----------------------------------------------------------------------------------------------
// @desc Build the sidebar's rows from the wizard's steps and what the user has stored against each, so the rail
//   reports real saved progress rather than how far the user has clicked.
// @param {object} params - An object with the following properties:
//   - {string} currentStepKey - Key of the step presently on screen.
//   - {object} planningContext - Context returned by usePlanWizard.
//   - {Array<object>} wizardSteps - The WIZARD_STEPS sequence.
// @returns {Array<object>} One row per step, each with the following properties:
//   - {boolean} isCurrent - True for the step being shown, which the rail marks as the reader's position.
//   - {boolean} isComplete - True once that step has something stored; the optional final step counts as
//     complete only when it was actually answered.
//   - {string} key - The step's key.
//   - {string} label - Short rail label.
//   - {string|null} summary - One line describing what is stored, or null when nothing is.
export function progressRowsFromContext({ currentStepKey, planningContext, wizardSteps }) {
  return wizardSteps.map(wizardStep => {
    const summaryReader = STEP_SUMMARY_READER[wizardStep.key];
    const summary = summaryReader ? summaryReader(planningContext) : null;
    const isOptionalUnanswered = wizardStep.key === "enough-for-today"
      && !answerTextFromRecord(planningContext.dailySufficiency).trim();
    return { isComplete: Boolean(summary) && !isOptionalUnanswered, isCurrent: wizardStep.key === currentStepKey,
      key: wizardStep.key, label: sidebarLabelFromStep(wizardStep), summary };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether the sidebar has anything worth showing. It appears once the first four steps are behind
//   the user, which is where the rail stops being a list of empty rows and starts being a record they can
//   navigate back through.
// @param {Array<object>} progressRows - Rows from progressRowsFromContext.
// @returns {boolean} True when every step but the optional final one has stored progress.
export function hasCompletedPlanCore(progressRows) {
  const requiredRows = progressRows.filter(row => row.key !== "enough-for-today");
  return requiredRows.every(row => row.isComplete);
}
