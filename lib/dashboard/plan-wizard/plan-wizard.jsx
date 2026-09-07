// Shell for the quarterly plan wizard: names the quarter being planned, loads its stored state through
// usePlanWizard, and routes to the current step. Closing and reopening resumes from what was persisted, so a
// user who leaves mid-answer loses nothing.

import IntentStep from "dashboard/plan-wizard/intent-step";
import ProjectsStep from "dashboard/plan-wizard/projects-step";
import QuarterAnswerStep from "dashboard/plan-wizard/quarter-answer-step";
import ThemedWeekdaysStep from "dashboard/plan-wizard/themed-weekdays-step";
import { WIZARD_STEPS, wizardStepIndexFromKey } from "dashboard/plan-wizard/wizard-steps";
import usePlanWizard, { planScopeKey } from "hooks/use-plan-wizard";
import { useState } from "react";

// Copy for the two pages that capture a single quarter-wide answer, kept beside the routing that renders them.
const QUARTER_ANSWER_COPY = {
  "enough-for-today": { answerKey: "dailySufficiency", heading: "When have you done enough for today?",
    hints: ["Two hours of focused project work", "Every task I marked important yesterday", "One thing that moves a quarterly intent"],
    placeholder: "What has to be true before the day counts as a good one?",
    summary: "A day that meets this bar is a day you can stop working with a clear conscience." },
  "quarter-name": { answerKey: "quarterName", heading: "Name the quarter",
    hints: ["The Shipping Quarter", "Rebuild the Foundations", "Fewer, Bigger Things"],
    placeholder: "Give this stretch of months a name you will recognize later.",
    summary: "A name makes the quarter easy to refer to later, when you are looking back at what it was for." },
};

export { WIZARD_STEPS };

// ----------------------------------------------------------------------------------------------
// @desc Render the wizard for one domain and quarter.
// @param {object} params - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {string|null} domainName - Selected task domain's display name; null plans All Notes.
//   - {string|null} domainUuid - Selected task domain's UUID; null plans All Notes.
//   - {Function} onClose - Dismisses the wizard and returns to the planning widget.
//   - {number} quarter - Quarter being planned, 1 through 4.
//   - {number} year - Planning year.
// @returns {JSX.Element} The wizard.
export default function PlanWizard({ app, domainName = null, domainUuid = null, onClose, quarter, year }) {
  const { error, isLoading, isRefreshing, isSaving, planningContext, reload, saveError, saveGoals, saveProspects,
    saveQuarterAnswer } = usePlanWizard({ app, domainName, domainUuid, quarter, year });
  const [stepKey, setStepKey] = useState(WIZARD_STEPS[0].key);
  const scopeKey = planScopeKey({ domainName, domainUuid, quarter, year });
  const quarterLabel = planningContext.scope ? planningContext.scope.quarterKey : `${ year }-Q${ quarter }`;
  const domainLabel = domainName ?? "All Notes";
  const stepIndex = wizardStepIndexFromKey(stepKey);
  const step = WIZARD_STEPS[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;

  // ----------------------------------------------------------------------------------------------
  // @desc Move the given number of steps through the sequence, stopping at either end.
  // @param {number} stepDelta - Positive to advance, negative to go back.
  const handleStepChange = stepDelta => {
    const nextIndex = Math.min(Math.max(stepIndex + stepDelta, 0), WIZARD_STEPS.length - 1);
    setStepKey(WIZARD_STEPS[nextIndex].key);
  };

  return (
    <div className="plan-wizard-page">
      <header className="plan-wizard-header">
        <div className="plan-wizard-title-group">
          <h1 className="plan-wizard-title">Plan your quarter</h1>
          <p className="plan-wizard-scope">{ `${ quarterLabel } · ${ domainLabel }` }</p>
        </div>
        <span className="plan-wizard-progress">{ `${ stepIndex + 1 } of ${ WIZARD_STEPS.length }` }</span>
        <button className="plan-wizard-close" onClick={ onClose } type="button">Close</button>
      </header>
      { isLoading ? <p className="plan-wizard-status">Loading your plan…</p> : null }
      { error && !isLoading ? (
        <div className="plan-wizard-error" role="alert">
          <p className="plan-wizard-error-message">Your plan could not be loaded. { error.message }</p>
          <button className="plan-wizard-retry" onClick={ reload } type="button">Try again</button>
        </div>
      ) : null }
      { !isLoading && !error && step.key === "intent" ? (
        <IntentStep isRefreshing={ isRefreshing } isSaving={ isSaving } onSave={ saveGoals }
          planningContext={ planningContext } saveError={ saveError } scopeKey={ scopeKey } />
      ) : null }
      { !isLoading && !error && step.key === "projects" ? (
        <ProjectsStep isSaving={ isSaving } onSave={ saveProspects } planningContext={ planningContext }
          saveError={ saveError } scopeKey={ scopeKey } />
      ) : null }
      { !isLoading && !error && step.key === "themed-weekdays" ? (
        <ThemedWeekdaysStep isSaving={ isSaving } onSave={ saveProspects } planningContext={ planningContext }
          saveError={ saveError } scopeKey={ scopeKey } />
      ) : null }
      { !isLoading && !error && QUARTER_ANSWER_COPY[step.key] ? (
        <QuarterAnswerStep { ...QUARTER_ANSWER_COPY[step.key] }
          answer={ planningContext[QUARTER_ANSWER_COPY[step.key].answerKey] } isSaving={ isSaving }
          onSave={ saveQuarterAnswer } saveError={ saveError } scopeKey={ scopeKey } />
      ) : null }
      { !isLoading && !error ? (
        <nav className="plan-wizard-navigation">
          <button className="plan-wizard-back" disabled={ isFirstStep } onClick={ () => handleStepChange(-1) }
            type="button">
            Back
          </button>
          <button className="plan-wizard-next" disabled={ isLastStep } onClick={ () => handleStepChange(1) }
            type="button">
            Next
          </button>
        </nav>
      ) : null }
    </div>
  );
}
