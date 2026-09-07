// Shell for the quarterly plan wizard: names the quarter being planned, loads its stored state through
// usePlanWizard, and routes to the current step. Closing and reopening resumes from what was persisted, so a
// user who leaves mid-answer loses nothing.
//
// The wizard renders as a modal over the whole dashboard rather than inside the planning widget's cell, since
// five pages of questions need far more room than a widget column offers. It is portaled to document.body
// because a positioned overlay is contained by any ancestor carrying a transform, filter, or will-change:
// rendered in place, the modal is trapped in the planning widget's stacking context and neighboring widgets
// paint over it no matter how high its z-index goes.
//
// The overlay is anchored in the document -- absolutely positioned at the scroll offset the wizard opened at --
// rather than pinned to the viewport. A viewport-pinned dialog has to fit the viewport, so on a tall screen the
// shortest page's handful of fields were stretched across the whole height with the navigation stranded at the
// bottom. Anchored in the document the dialog takes the height its questions ask for, and the page scrolls to
// reach the rest when the viewport cannot show it all at once.

import IntentStep, { INTENT_STEP_FORM_ID } from "dashboard/plan-wizard/intent-step";
import ProjectsStep, { PROJECTS_STEP_FORM_ID } from "dashboard/plan-wizard/projects-step";
import QuarterAnswerStep from "dashboard/plan-wizard/quarter-answer-step";
import ThemedWeekdaysStep from "dashboard/plan-wizard/themed-weekdays-step";
import { WIZARD_STEPS, wizardStepIndexFromKey } from "dashboard/plan-wizard/wizard-steps";
import usePlanWizard, { planScopeKey } from "hooks/use-plan-wizard";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import "dashboard/styles/plan-wizard.scss";

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
// @desc Read how far the dashboard document is currently scrolled, so the document-anchored overlay can be
//   placed at the top of what the user is already looking at instead of at the top of the page.
// @returns {number} Pixels the document is scrolled from its top; 0 where there is no window, as under test.
function currentDocumentScrollTop() {
  if (typeof window === "undefined") return 0;
  return window.scrollY ?? document.documentElement.scrollTop ?? 0;
}

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
  const { discoverProspects, discoveryFailureReason, error, isDiscovering, isLoading, isRefreshing, isSaving,
    planningContext, reload, saveError, saveGoals, saveProspects,
    saveQuarterAnswer } = usePlanWizard({ app, domainName, domainUuid, quarter, year });
  const [stepKey, setStepKey] = useState(WIZARD_STEPS[0].key);
  const [hasIntentAnswer, setHasIntentAnswer] = useState(false);
  const [overlayTop] = useState(currentDocumentScrollTop);
  const overlayRef = useRef(null);
  const projectNavigationDirectionRef = useRef(1);
  const scopeKey = planScopeKey({ domainName, domainUuid, quarter, year });
  const quarterLabel = planningContext.scope ? planningContext.scope.quarterKey : `${ year }-Q${ quarter }`;
  const domainLabel = domainName ?? "All Notes";
  const stepIndex = wizardStepIndexFromKey(stepKey);
  const step = WIZARD_STEPS[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const isProjectsStep = step.key === "projects";
  const hasPersistedIntent = planningContext.goals.length > 0;

  // ----------------------------------------------------------------------------------------------
  // @desc Move the given number of steps through the sequence, stopping at either end.
  // @param {number} stepDelta - Positive to advance, negative to go back.
  const handleStepChange = stepDelta => {
    const nextIndex = Math.min(Math.max(stepIndex + stepDelta, 0), WIZARD_STEPS.length - 1);
    setStepKey(WIZARD_STEPS[nextIndex].key);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Move to the projects page and discover the projects that carry the quarter's intents. The step change
  //   comes first so the user watches discovery run on the page whose list it fills, rather than waiting on the
  //   intent page for something to happen elsewhere. Returning while an earlier discovery is still running
  //   reopens that same project page without starting a duplicate request.
  const handleFindProjects = async () => {
    setStepKey("projects");
    if (isDiscovering) return;
    await discoverProspects();
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Apply the project page direction selected by Back or Next after that page confirms its draft saved.
  const handleProjectNavigation = () => {
    handleStepChange(projectNavigationDirectionRef.current);
  };

  useEffect(() => {
    const overlayElement = overlayRef.current;
    if (!overlayElement || typeof overlayElement.scrollIntoView !== "function") return;
    overlayElement.scrollIntoView({ behavior: "auto", block: "start" });
  }, [stepKey]);

  // Escape closes the wizard, as it does for every other dashboard modal. Answers already saved are stored, and
  // an unsaved draft is deliberately not confirmed away here: reopening restores each step from what was saved.
  useEffect(() => {
    const handleKeyDown = event => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ----------------------------------------------------------------------------------------------
  // @desc Close when the backdrop itself is clicked, ignoring clicks that bubble up from inside the dialog.
  // @param {object} event - The click event.
  const handleBackdropClick = event => {
    if (event.target === event.currentTarget) onClose();
  };

  const wizardModal = (
    <div className="plan-wizard-overlay" onClick={ handleBackdropClick } ref={ overlayRef }
      style={ { top: overlayTop } }>
      <div aria-label="Plan your quarter" aria-modal="true" className="plan-wizard-page" role="dialog">
        <header className="plan-wizard-header">
          <div className="plan-wizard-title-group">
            <h1 className="plan-wizard-title">Plan your quarter</h1>
            <p className="plan-wizard-scope">{ `${ quarterLabel } · ${ domainLabel }` }</p>
          </div>
          <span className="plan-wizard-progress">{ `${ stepIndex + 1 } of ${ WIZARD_STEPS.length }` }</span>
          <button className="plan-wizard-close" onClick={ onClose } tabIndex={ isFirstStep ? -1 : 0 }
            type="button">Close</button>
        </header>
        { isLoading ? <p className="plan-wizard-status">Loading your plan…</p> : null }
        { error && !isLoading ? (
          <div className="plan-wizard-error" role="alert">
            <p className="plan-wizard-error-message">Your plan could not be loaded. { error.message }</p>
            <button className="plan-wizard-retry" onClick={ reload } type="button">Try again</button>
          </div>
        ) : null }
        { !isLoading && !error && step.key === "intent" ? (
          <IntentStep isRefreshing={ isRefreshing } isSaving={ isSaving } onAnswerStateChange={ setHasIntentAnswer }
            onFindProjects={ handleFindProjects } onSave={ saveGoals } planningContext={ planningContext }
            saveError={ saveError } scopeKey={ scopeKey } />
        ) : null }
        { !isLoading && !error && step.key === "projects" ? (
          <ProjectsStep discoveryFailureReason={ discoveryFailureReason } isDiscovering={ isDiscovering }
            isSaving={ isSaving } onDiscover={ discoverProspects } onNavigate={ handleProjectNavigation }
            onSave={ saveProspects } planningContext={ planningContext } saveError={ saveError } scopeKey={ scopeKey } />
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
            { isFirstStep ? null : (
              <button className="plan-wizard-back" disabled={ isProjectsStep && isSaving }
                form={ isProjectsStep ? PROJECTS_STEP_FORM_ID : undefined }
                onClick={ isProjectsStep ? () => { projectNavigationDirectionRef.current = -1; }
                  : () => handleStepChange(-1) }
                type={ isProjectsStep ? "submit" : "button" } value="-1">Back</button>
            ) }
            <button className="plan-wizard-next"
              disabled={ isLastStep || (isFirstStep && ((!hasIntentAnswer && !hasPersistedIntent) || isSaving))
                || (isProjectsStep && isSaving) }
              form={ isFirstStep ? INTENT_STEP_FORM_ID : isProjectsStep ? PROJECTS_STEP_FORM_ID : undefined }
              onClick={ isFirstStep ? undefined : isProjectsStep
                ? () => { projectNavigationDirectionRef.current = 1; } : () => handleStepChange(1) }
              type={ isFirstStep || isProjectsStep ? "submit" : "button" } value="1">
              { (isFirstStep || isProjectsStep) && isSaving ? "Saving…" : "Next" }
            </button>
          </nav>
        ) : null }
      </div>
    </div>
  );

  return typeof document !== "undefined" && document.body ? createPortal(wizardModal, document.body) : wizardModal;
}
