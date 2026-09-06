// Placeholder for a wizard step whose milestone has not been implemented. It states that the step is unbuilt
// instead of showing empty inputs, so a user is never led to believe an answer was recorded or that work the next
// milestone will do has already run.

// ----------------------------------------------------------------------------------------------
// @desc Render an unbuilt step's heading and the reason it cannot be answered yet.
// @param {object} params - An object with the following properties:
//   - {object} step - Step definition from WIZARD_STEPS, carrying title, summary, and pendingMilestone.
// @returns {JSX.Element} The placeholder page.
export default function PendingStep({ step }) {
  return (
    <div className="pending-step-page">
      <h2 className="pending-step-heading">{ step.title }</h2>
      <p className="pending-step-summary">{ step.summary }</p>
      <p className="pending-step-notice" role="note">
        { step.pendingMilestone } Your answers from earlier steps are already saved.
      </p>
    </div>
  );
}
