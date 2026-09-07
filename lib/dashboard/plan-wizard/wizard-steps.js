// The ordered pages a user passes through to populate a Quarterly Plan. Declaring the sequence in one place lets
// the shell show real progress ("2 of 5") and keeps each page's identity, copy, and implementing file together.
//
// Every step carries an implementationFile naming the component that owns its screen, so a reader can go from a
// step to its code without searching.

export const WIZARD_STEPS = [
  { key: "intent", title: "the highest level, this quarter will be a success if...",
    summary: "Name 3-6 outcomes that deserve your best hours.",
    implementationFile: "lib/dashboard/plan-wizard/intent-step.jsx" },
  { key: "projects", title: "Which projects carry those intents?",
    summary: "Name the concrete work behind each intent.",
    implementationFile: "lib/dashboard/plan-wizard/projects-step.jsx" },
  { key: "pace-cards", title: "What pace can you realistically protect?",
    summary: "Choose a rhythm per project, then the days that rhythm occupies.",
    implementationFile: "lib/dashboard/plan-wizard/pace-cards-step.jsx" },
  { key: "quarter-name", title: "Name the quarter",
    summary: "Give this stretch of months a name you will recognize later.",
    implementationFile: "lib/dashboard/plan-wizard/quarter-answer-step.jsx" },
  { key: "enough-for-today", title: "When have you done enough for today?",
    summary: "Set the daily bar that tells you the day's work is complete.",
    implementationFile: "lib/dashboard/plan-wizard/quarter-answer-step.jsx" },
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
