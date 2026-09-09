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
// reach the rest when the viewport cannot show it all at once. A nested fixed layer keeps the dim covering the
// rest of the screen, since the overlay box itself only wraps the dialog.
//
// The navigation's left slot carries Back on every page but the first, where there is nowhere to go back to. The
// first page fills that slot with Cancel, so leaving the wizard is a visible control on the page a user is most
// likely to have opened by accident, rather than only Escape and a backdrop click.

import NoteEditor from "dashboard/note-editor";
import DoneEnoughStep from "dashboard/plan-wizard/done-enough-step";
import IntentStep from "dashboard/plan-wizard/intent-step";
import PaceCardsStep from "dashboard/plan-wizard/pace-cards-step";
import PlanSaveError from "dashboard/plan-wizard/plan-save-error";
import ProjectsStep from "dashboard/plan-wizard/projects-step";
import QuarterNameStep from "dashboard/plan-wizard/quarter-name-step";
import { WIZARD_STEPS, wizardStepIndexFromKey } from "dashboard/plan-wizard/wizard-steps";
import usePlanWizard, { planScopeKey } from "hooks/use-plan-wizard";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "dashboard/styles/plan-wizard.scss";

const SAVE_ERROR_PREFIX = { "enough-for-today": "Your answer was not saved.", intent: "Your answers were not saved.",
  "pace-cards": "Your project paces were not saved.", projects: "Your projects were not saved.",
  "quarter-name": "Your quarter name was not saved." };

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
    planningContext, reload, saveError, saveGoals, saveProspectDecision, saveProspects,
    saveQuarterAnswer } = usePlanWizard({ app, domainName, domainUuid, quarter, year });
  const [stepKey, setStepKey] = useState(WIZARD_STEPS[0].key);
  const [hasIntentAnswer, setHasIntentAnswer] = useState(false);
  const [inspectingNoteUuid, setInspectingNoteUuid] = useState(null);
  const [overlayTop] = useState(currentDocumentScrollTop);
  const overlayRef = useRef(null);
  const projectNavigationDirectionRef = useRef(1);
  const stepNavigateRef = useRef(null);
  const scopeKey = planScopeKey({ domainName, domainUuid, quarter, year });
  const quarterLabel = planningContext.scope ? planningContext.scope.quarterKey : `${ year }-Q${ quarter }`;
  const domainLabel = domainName ?? "All Notes";
  const stepIndex = wizardStepIndexFromKey(stepKey);
  const step = WIZARD_STEPS[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const isNavigatingSaveStep = ["pace-cards", "projects", "quarter-name"].includes(step.key);
  const hasPersistedIntent = planningContext.goals.length > 0;

  // ----------------------------------------------------------------------------------------------
  // @desc Hold the current step's save-then-navigate handler so the shared Back and Next buttons can run it.
  //   The buttons live outside the step they act on, and the sandboxed embed forbids the native <form> submission
  //   that used to bridge that gap, so each step hands its handler up here instead.
  // @param {Function|null} handleNavigate - The mounted step's handler, or null as that step unmounts.
  const handleRegisterNavigate = useCallback(handleNavigate => {
    stepNavigateRef.current = handleNavigate;
  }, []);

  // ----------------------------------------------------------------------------------------------
  // @desc Run the current step's registered handler, which navigates only once its pending edits saved.
  // @param {number} stepDelta - Positive for Next, negative for Back; read by the step's navigation callback.
  const handleNavigateStep = stepDelta => {
    projectNavigationDirectionRef.current = stepDelta;
    if (stepNavigateRef.current) stepNavigateRef.current();
  };

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

  // ----------------------------------------------------------------------------------------------
  // @desc Show the Vision Guide in the inline editor after the data-note link is followed in the dev environment.
  // @param {string} noteUuid - Vision Guide UUID to load.
  const handleOpenDataNote = noteUuid => {
    setInspectingNoteUuid(noteUuid);
  };

  const wizardModal = (
    <div className="plan-wizard-overlay" onClick={ handleBackdropClick } ref={ overlayRef }
      style={ { top: overlayTop } }>
      <div aria-hidden="true" className="plan-wizard-backdrop" onClick={ onClose } />
      <div aria-label="Plan your quarter" aria-modal="true" className="plan-wizard-page" role="dialog">
        <header className="plan-wizard-header">
          <div className="plan-wizard-title-group" title={ `${ quarterLabel } · ${ domainLabel }` }>
            <svg aria-hidden="true" className="plan-wizard-title-icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="4" />
              <circle className="plan-wizard-title-icon-center" cx="12" cy="12" r="1.5" />
            </svg>
            <h1 className="plan-wizard-title">Plan Builder - Beta</h1>
          </div>
          <div aria-label={ `Step ${ stepIndex + 1 } of ${ WIZARD_STEPS.length }` } className="plan-wizard-step-track">
            { WIZARD_STEPS.map((wizardStep, wizardStepIndex) => (
              <span aria-hidden="true"
                className={ `plan-wizard-step-dot${ wizardStepIndex === stepIndex ? " plan-wizard-step-dot--current" : "" }` }
                key={ wizardStep.key } />
            )) }
          </div>
          <span className="plan-wizard-progress">{ `${ stepIndex + 1 } of ${ WIZARD_STEPS.length }` }</span>
        </header>
        { isLoading ? <p className="plan-wizard-status">Loading your plan…</p> : null }
        { error && !isLoading ? (
          <div className="plan-wizard-error" role="alert">
            <p className="plan-wizard-error-title">Plan Builder could not read its saved Vision Guide.</p>
            <p className="plan-wizard-error-message">{ error.message }</p>
            <p className="plan-wizard-error-guidance">No planning data was changed. Correct the named record or
              retry after a temporary connection problem.</p>
            <button className="plan-wizard-retry" onClick={ reload } type="button">Try again</button>
          </div>
        ) : null }
        { inspectingNoteUuid ? (
          <NoteEditor app={ app } noteUUID={ inspectingNoteUuid } onBack={ () => setInspectingNoteUuid(null) } />
        ) : null }
        { !inspectingNoteUuid && !isLoading && !error && step.key === "intent" ? (
          <IntentStep { ...{ isRefreshing, isSaving, planningContext, scopeKey } }
            onAnswerStateChange={ setHasIntentAnswer } onFindProjects={ handleFindProjects }
            onRegisterNavigate={ handleRegisterNavigate } onSave={ saveGoals } />
        ) : null }
        { !inspectingNoteUuid && !isLoading && !error && step.key === "projects" ? (
          <ProjectsStep { ...{ discoveryFailureReason, isDiscovering, isSaving, planningContext, scopeKey } }
            onDiscover={ discoverProspects } onNavigate={ handleProjectNavigation }
            onRegisterNavigate={ handleRegisterNavigate } onSave={ saveProspects }
            onSaveDecision={ saveProspectDecision } />
        ) : null }
        { !inspectingNoteUuid && !isLoading && !error && step.key === "pace-cards" ? (
          <PaceCardsStep { ...{ isSaving, planningContext, scopeKey } }
            onNavigate={ handleProjectNavigation } onRegisterNavigate={ handleRegisterNavigate }
            onSave={ records => saveProspects(records, { updatePlacement: false }) } />
        ) : null }
        { !inspectingNoteUuid && !isLoading && !error && step.key === "quarter-name" ? (
          <QuarterNameStep { ...{ isSaving, planningContext, scopeKey } }
            onNavigate={ handleProjectNavigation } onRegisterNavigate={ handleRegisterNavigate }
            onSaveName={ saveQuarterAnswer } onSaveProspects={ saveProspects } />
        ) : null }
        { !inspectingNoteUuid && !isLoading && !error && step.key === "enough-for-today" ? (
          <DoneEnoughStep { ...{ isSaving, saveError, scopeKey } } answer={ planningContext.dailySufficiency }
            onSave={ saveQuarterAnswer } />
        ) : null }
        { !inspectingNoteUuid && saveError && !isLoading && !error ? (
          <PlanSaveError app={ app } noteUuid={ saveError.noteUuid ?? planningContext.noteUuid }
            onOpenDataNote={ handleOpenDataNote } prefix={ SAVE_ERROR_PREFIX[step.key] } saveError={ saveError } />
        ) : null }
        { !inspectingNoteUuid && !isLoading && !error ? (
          <nav className="plan-wizard-navigation">
            { isFirstStep ? (
              <button className="plan-wizard-cancel" onClick={ onClose } type="button">Cancel</button>
            ) : (
              <button className="plan-wizard-back" disabled={ isNavigatingSaveStep && isSaving }
                form={ isNavigatingSaveStep ? handleNavigateStep(-1) : undefined }
                onClick={ isNavigatingSaveStep ? () => { projectNavigationDirectionRef.current = -1; } : () => handleStepChange(-1) }
                type={ isNavigatingSaveStep ? "submit" : "button" } value="-1">Back</button>
            ) }
            <button className="plan-wizard-next"
              disabled={ isLastStep || (isFirstStep && ((!hasIntentAnswer && !hasPersistedIntent) || isSaving))
                || (isNavigatingSaveStep && isSaving) }
              onClick={ isFirstStep || isNavigatingSaveStep ? () => handleNavigateStep(1) : () => handleStepChange(1) }
              type="button">
              { (isFirstStep || isNavigatingSaveStep) && isSaving ? "Saving…" : "Next" }
            </button>
          </nav>
        ) : null }
      </div>
    </div>
  );

  return typeof document !== "undefined" && document.body ? createPortal(wizardModal, document.body) : wizardModal;
}
