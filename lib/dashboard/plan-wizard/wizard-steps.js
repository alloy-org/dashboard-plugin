// The ordered pages a user passes through to populate a Quarterly Plan. Declaring the sequence in one place lets
// the shell show real progress ("2 of 5") and keeps each page's identity, copy, and implementing file together.
//
// Every step carries an implementationFile naming the component that owns its screen, so a reader can go from a
// step to its code without searching.

export const WIZARD_STEPS = [
  {
    implementationFile: "lib/dashboard/plan-wizard/intent-step.jsx",
    key: "intent",
    summary: "What's the big picture outcome you want to achieve? Your high-level intent drives suggestions for the rest of the plan.",
    title: "At the highest level, this quarter will be a success if..."
  },
  {
    implementationFile: "lib/dashboard/plan-wizard/projects-step.jsx",
    key: "projects",
    summary: "Choose the right level of effort to apply for each focus area",
    title: "Which projects best implement your intent?"
  },
  { implementationFile: "lib/dashboard/plan-wizard/pace-cards-step.jsx",
    key: "pace-cards",
    summary: "If there are certain days you expect to work on the project, select those. If any day is fine, select all or none of the days",
    title: "What pace can you realistically protect?"
  },
  {
    implementationFile: "lib/dashboard/plan-wizard/quarter-name-step.jsx",
    key: "quarter-name",
    summary: "Drafted from your answers. Pick one or write your own.",
    title: "Name the quarter"
  },
  {
    implementationFile: "lib/dashboard/plan-wizard/quarter-answer-step.jsx",
    key: "enough-for-today",
    summary: "Set the daily bar that tells you the day's work is complete.",
    title: "When have you done enough for today?"
  },
];

// ----------------------------------------------------------------------------------------------
// @desc Find a step's position in the sequence, so the shell can label progress and enable navigation.
// @param {string} stepKey - Key of the step being rendered.
// @returns {number} Zero-based index, or 0 when the key is unknown.
export function wizardStepIndexFromKey(stepKey) {
  const index = WIZARD_STEPS.findIndex(step => step.key === stepKey);
  return index === -1 ? 0 : index;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one step's definition by key.
// @param {string} stepKey - Key of the step being rendered.
// @returns {object} The step definition; the first step when the key is unknown.
export function wizardStepFromKey(stepKey) {
  return WIZARD_STEPS[wizardStepIndexFromKey(stepKey)];
}
