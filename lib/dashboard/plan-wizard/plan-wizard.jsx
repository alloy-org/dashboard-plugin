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
//
// The right slot reads Next until the final page, where it reads Done and closes the wizard. It used to read Next
// there and sit permanently disabled, which left a finished plan with no way out but Escape or the backdrop, and
// read as an unmet requirement rather than as the end of the sequence.
//
// The final page puts a View Quarterly Plan link beside Done. It publishes before it navigates, so the note shown
// is the plan including the answer just given on that page, and it hands off to Amplenote through app.navigate
// rather than rendering the markdown inline: the plan note is a real note the user goes on to work in, and the
// inline editor would show a copy of it that no longer reflects what they did there.

import { quarterLabel as displayQuarterLabel } from "constants/quarters";
import NoteEditor from "dashboard/note-editor";
import DoneEnoughStep from "dashboard/plan-wizard/done-enough-step";
import IntentStep from "dashboard/plan-wizard/intent-step";
import PaceCardsStep from "dashboard/plan-wizard/pace-cards-step";
import PlanSaveError from "dashboard/plan-wizard/plan-save-error";
import ProjectsStep from "dashboard/plan-wizard/projects-step";
import QuarterNameStep from "dashboard/plan-wizard/quarter-name-step";
import { hasCompletedPlanCore, progressRowsFromContext, sidebarLabelFromStep } from "dashboard/plan-wizard/wizard-progress-fields";
import WizardProgressBar from "dashboard/plan-wizard/wizard-progress-bar";
import WizardProgressSidebar from "dashboard/plan-wizard/wizard-progress-sidebar";
import { WIZARD_STEPS, wizardStepIndexFromKey } from "dashboard/plan-wizard/wizard-steps";
import { useSuspendWidgetMounting } from "dashboard/widget-mount-suspension";
import usePlanWizard, { planScopeKey } from "hooks/use-plan-wizard";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navigateToNote } from "util/goal-notes";
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
  const { consolidateProspects, discoverProspects, discoveryFailureReason, error, isConsolidating, isDiscovering,
    isLoading, isRefreshing, isSaving, planningContext, reload, saveError, saveGoals, saveProspectDecision,
    saveProspects, saveQuarterAnswer, viewQuarterlyPlan } = usePlanWizard({ app, domainName, domainUuid, quarter,
    year });
  const [stepKey, setStepKey] = useState(WIZARD_STEPS[0].key);
  const [hasIntentAnswer, setHasIntentAnswer] = useState(false);
  const [hasDoneEnoughSelection, setHasDoneEnoughSelection] = useState(false);
  const [inspectingNoteUuid, setInspectingNoteUuid] = useState(null);
  const [isOpeningPlanNote, setIsOpeningPlanNote] = useState(false);
  const [planNoteError, setPlanNoteError] = useState(null);
  const [overlayTop] = useState(currentDocumentScrollTop);
  useSuspendWidgetMounting(); // The wizard covers the dashboard, so scrolling behind it must not mount widgets the user cannot see
  const overlayRef = useRef(null);
  const projectNavigationDirectionRef = useRef(1);
  const stepNavigateRef = useRef(null);
  const planNoteRequestRef = useRef(false);
  const pendingStepKeyRef = useRef(null);
  const scopeKey = planScopeKey({ domainName, domainUuid, quarter, year });
  const quarterLabel = planningContext.scope ? planningContext.scope.quarterKey : `${ year }-Q${ quarter }`;
  const domainLabel = domainName ?? "All Notes";
  // The header states the quarter in the reading order a person says it in, while quarterLabel stays the storage
  // key form the progress bar and tooltip already use, so the two are not conflated.
  const headerQuarterLabel = displayQuarterLabel(year, quarter);
  const stepIndex = wizardStepIndexFromKey(stepKey);
  const step = WIZARD_STEPS[stepIndex];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === WIZARD_STEPS.length - 1;
  const isNavigatingSaveStep = ["enough-for-today", "pace-cards", "projects", "quarter-name"].includes(step.key);
  const hasPersistedIntent = planningContext.goals.length > 0;
  const advanceLabel = isLastStep ? "Done" : "Next";
  const progressRows = progressRowsFromContext({ currentStepKey: step.key, planningContext, wizardSteps: WIZARD_STEPS });
  // The grid column and the rail itself are gated on one flag, so the body never reserves a column for a sidebar
  // it is not rendering: loading, a load failure, and the inline note editor each take the whole width. The same
  // flag gates the narrow-width bar, which is the same navigation in the one place a rail does not fit, so the
  // two appear and disappear together and the container query decides which of them the user actually sees.
  const rendersProgressSidebar = hasCompletedPlanCore(progressRows) && !inspectingNoteUuid && !isLoading && !error;

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
    planNoteRequestRef.current = false;
    pendingStepKeyRef.current = null; // Back and Next name their own destination, superseding any jump that failed to save

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
  // @desc Open the step a sidebar jump is waiting on, if one is, and clear that request either way.
  // @returns {boolean} True when a pending jump was applied, so the caller leaves its own navigation alone.
  const consumePendingStepKey = () => {
    const targetStepKey = pendingStepKeyRef.current;
    pendingStepKeyRef.current = null;
    if (!targetStepKey) return false;
    setStepKey(targetStepKey);
    return true;
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Jump to an already-answered step the user picked from the progress sidebar, saving whatever is pending
  //   on the page they are leaving first. The save runs through that page's own registered handler, the same path
  //   Back and Next take, so an edit made and not yet submitted is carried along rather than silently dropped,
  //   and a failed write keeps the user where they are with its retry.
  //
  //   The intent page is deliberately not routed that way: its registered handler always continues to the projects
  //   page and runs discovery, so putting a jump through it would land the user somewhere they did not choose. That
  //   page saves on its own Next, and the sidebar only appears once it has been answered.
  // @param {string} targetStepKey - Key of the step to open.
  const handleSelectStep = targetStepKey => {
    if (targetStepKey === step.key) return;
    planNoteRequestRef.current = false;
    pendingStepKeyRef.current = targetStepKey;
    if (isNavigatingSaveStep && stepNavigateRef.current) {
      stepNavigateRef.current();
      return;
    }
    pendingStepKeyRef.current = null;
    setStepKey(targetStepKey);
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
  // @desc Apply the project page direction selected by Back or Next after that page confirms its draft saved. A
  //   sidebar jump waiting on that same save takes precedence, since it names the step to open outright rather
  //   than a direction to step in.
  const handleProjectNavigation = () => {
    if (consumePendingStepKey()) return;
    handleStepChange(projectNavigationDirectionRef.current);
  };


  // ----------------------------------------------------------------------------------------------
  // @desc Leave the final page once it has saved whatever the user selected: Back returns to the page before it,
  //   View Quarterly Plan opens the plan note over the page, and Done has nowhere further to go, so it closes the
  //   wizard.
  const handleDoneEnoughNavigation = () => {
    if (planNoteRequestRef.current) {
      planNoteRequestRef.current = false;
      openQuarterlyPlanNote();
      return;
    }
    if (consumePendingStepKey()) return;
    if (projectNavigationDirectionRef.current < 0) {
      handleStepChange(-1);
      return;
    }
    onClose();
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

  // ----------------------------------------------------------------------------------------------
  // @desc Publish everything stored for this quarter and then hand the user off to the plan note in Amplenote.
  // @returns {Promise<void>} Resolves once the navigation is underway or the failure has been reported.
  // The wizard closes on the way out, because navigating replaces the note the dashboard is embedded in: a modal
  //   left open would otherwise be waiting over whatever the user came back to.
  const openQuarterlyPlanNote = async () => {
    setIsOpeningPlanNote(true);
    setPlanNoteError(null);
    try {
      const noteUuid = await viewQuarterlyPlan();
      if (!noteUuid) {
        setPlanNoteError(new Error("This quarter has no plan note yet, and one could not be created."));
        return;
      }
      await navigateToNote(app, noteUuid);
      onClose();
    } catch (publishError) {
      setPlanNoteError(publishError);
    } finally {
      setIsOpeningPlanNote(false);
    }
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Show the quarter's plan note, saving the page's pending selection first so the plan the user reads
  //   includes the answer they just gave rather than only the ones they had already saved. The save runs through
  //   the page's own registered handler, the same path Back and Done take, so a failed write keeps the user on
  //   the page with its retry rather than opening a note that contradicts what they chose.
  const handleViewQuarterlyPlan = () => {
    if (!isNavigatingSaveStep || !stepNavigateRef.current) {
      openQuarterlyPlanNote();
      return;
    }
    planNoteRequestRef.current = true;
    stepNavigateRef.current();
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
            <span className="plan-wizard-title-quarter">{ headerQuarterLabel }</span>
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
        { rendersProgressSidebar ? (
          <WizardProgressBar { ...{ isOpeningPlanNote, progressRows, quarterLabel } }
            onOpenPlanNote={ handleViewQuarterlyPlan } onSelectStep={ handleSelectStep }
            stepCount={ WIZARD_STEPS.length } stepNumber={ stepIndex + 1 } stepTitle={ sidebarLabelFromStep(step) } />
        ) : null }
        <div className={ `plan-wizard-body${ rendersProgressSidebar ? " plan-wizard-body--with-sidebar" : "" }` }>
        { rendersProgressSidebar ? (
          <WizardProgressSidebar { ...{ isOpeningPlanNote, progressRows, quarterLabel } }
            onOpenPlanNote={ handleViewQuarterlyPlan } onSelectStep={ handleSelectStep } />
        ) : null }
        <div className="plan-wizard-body-main">
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
            <ProjectsStep { ...{ discoveryFailureReason, isConsolidating, isDiscovering, isSaving, planningContext, scopeKey } }
              onConsolidate={ consolidateProspects } onDiscover={ discoverProspects } onNavigate={ handleProjectNavigation }
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
              onAnswerStateChange={ setHasDoneEnoughSelection } onNavigate={ handleDoneEnoughNavigation }
              onRegisterNavigate={ handleRegisterNavigate } onSave={ saveQuarterAnswer } />
          ) : null }
          { !inspectingNoteUuid && planNoteError && !isLoading && !error ? (
            <p className="plan-wizard-plan-note-error" role="alert">
              { `The quarterly plan note could not be opened. ${ planNoteError.message }` }
            </p>
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
                  onClick={ isNavigatingSaveStep ? () => handleNavigateStep(-1) : () => handleStepChange(-1) }
                  type="button">Back</button>
              ) }
              <div className="plan-wizard-advance-group">
                { isLastStep ? (
                  <button className="plan-wizard-view-plan" disabled={ isOpeningPlanNote || isSaving }
                    onClick={ handleViewQuarterlyPlan } type="button">
                    { isOpeningPlanNote ? "Opening…" : "View Quarterly Plan" }
                  </button>
                ) : null }
                <button className="plan-wizard-next"
                  disabled={ (isLastStep && !hasDoneEnoughSelection)
                    || (isFirstStep && ((!hasIntentAnswer && !hasPersistedIntent) || isSaving))
                    || (isNavigatingSaveStep && isSaving) }
                  onClick={ isFirstStep || isNavigatingSaveStep ? () => handleNavigateStep(1) : () => handleStepChange(1) }
                  type="button">
                  { (isFirstStep || isNavigatingSaveStep) && isSaving ? "Saving…" : advanceLabel }
                </button>
              </div>
            </nav>
          ) : null }
        </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" && document.body ? createPortal(wizardModal, document.body) : wizardModal;
}
