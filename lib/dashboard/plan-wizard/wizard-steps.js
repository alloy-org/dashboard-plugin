// The ordered pages a user passes through to populate a Quarterly Plan. Only the intent page is built; the rest
// are declared here so the shell can show real progress ("2 of 5") and so each milestone has one obvious place to
// attach its component. A step without a component renders the placeholder, which states plainly that the step is
// not built rather than implying its work already happened.

export const WIZARD_STEPS = [
  { key: "intent", title: "This quarter will be a success if…",
    summary: "Name the one to three outcomes that deserve your best hours." },
  { key: "projects", title: "Which projects carry those intents?",
    summary: "Derive concrete projects from your notes and tasks.",
    pendingMilestone: "Project discovery is not built yet." },
  { key: "quarter-name", title: "Name the quarter",
    summary: "Give this stretch of months a name you will recognize later.",
    pendingMilestone: "Quarter naming is not built yet." },
  { key: "themed-weekdays", title: "Would themed weekdays make choosing tasks easier?",
    summary: "Assign a recurring emphasis to each weekday.",
    pendingMilestone: "Weekday theming is not built yet." },
  { key: "enough-for-today", title: "When have you done enough for today?",
    summary: "Set the daily bar that tells you the day's work is complete.",
    pendingMilestone: "Daily sufficiency is not built yet." },
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
