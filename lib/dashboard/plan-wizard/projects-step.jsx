// The wizard's second page: name the projects that carry the intents saved on the first page, and tie each one to
// the intents it advances. Projects the user names are stored as human-provided prospects; discovery's proposals
// arrive in the same list awaiting judgement, drawn as provisional so an inference is never mistaken for a
// decision the user made.
//
// Discovery runs only when asked. It reads the intents from the first page, so it has nothing to work from until
// those are saved, and it costs a provider call — so the page offers it as an action and reports what a pass
// found, rather than firing on mount and presenting an empty list as though a search had already run.

import ProjectCard from "dashboard/plan-wizard/project-card";
import { draftRowsFromProspects, emptyProjectRow, priorityRecordFromRow, prospectRecordsFromDraftRows,
  rejectionRecordFromRow } from "dashboard/plan-wizard/projects-step-fields";
import { wizardStepFromKey } from "dashboard/plan-wizard/wizard-steps";
import { useCallback, useEffect, useRef, useState } from "react";

const CATEGORY_HEADINGS = { personal: "Personal projects (optional)", work: "Professional projects" };
export const PROJECTS_STEP_FORM_ID = "plan-wizard-projects-form";
const PROJECTS_STEP_COPY = wizardStepFromKey("projects");

// ----------------------------------------------------------------------------------------------
// @desc Say what discovery is doing or has done, so the page never leaves the user guessing why the list holds
//   only what they typed. Each state is distinct: nothing asked for yet, nothing to work from, a pass running, a
//   pass that proposed nothing and why, and a pass that produced candidates awaiting judgement.
// @param {object} params - An object with the following properties:
//   - {string|null} discoveryFailureReason - Why the last pass proposed nothing, when it proposed nothing.
//   - {boolean} hasChosenIntent - Whether the quarter has a saved intent for a project to advance.
//   - {boolean} isDiscovering - Whether a pass is in flight.
//   - {number} proposedCount - Proposals currently awaiting the user's judgement.
// @returns {string} The notice to render.
function discoveryNoticeText({ discoveryFailureReason, hasChosenIntent, isDiscovering, proposedCount }) {
  if (isDiscovering) return "Looking through your important, recent, and recently completed tasks for themes…";
  if (!hasChosenIntent) return "Save an intent on the previous page and these can be suggested from your own tasks.";
  if (discoveryFailureReason) return `Nothing was suggested: ${ discoveryFailureReason }.`;
  if (proposedCount) return `${ proposedCount } project(s) below were suggested from your tasks and are waiting on you.`;
  return "Nothing has been suggested yet. Everything below is what you named.";
}

// ----------------------------------------------------------------------------------------------
// @desc Render the projects page and save changed custom projects before Back or Next changes the page.
// @param {object} params - An object with the following properties:
//   - {string|null} discoveryFailureReason - Why the last discovery pass proposed nothing, when it proposed none.
//   - {boolean} isDiscovering - True while a discovery pass is in flight.
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onDiscover - Runs a discovery pass for the current scope.
//   - {Function} onNavigate - Changes wizard page after pending project edits save successfully.
//   - {Function} onSave - Receives prospect records and resolves true when the write succeeded.
//   - {Function} onSaveDecision - Persists one card decision without entering page-wide saving state.
//   - {object} planningContext - Stored goals and prospects for the scope.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The projects page.
export default function ProjectsStep({ discoveryFailureReason = null, isDiscovering = false, isSaving, onDiscover,
    onNavigate, onSave, onSaveDecision, planningContext, scopeKey }) {
  const [draftRows, setDraftRows] = useState(() => draftRowsFromProspects(planningContext.prospects,
    planningContext.goals));
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && !capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    setDraftRows(draftRowsFromProspects(planningContext.prospects, planningContext.goals));
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setDraftRows(draftRowsFromProspects(planningContext.prospects, planningContext.goals));
  }, [planningContext.goals, planningContext.prospects]);

  // ----------------------------------------------------------------------------------------------
  // @desc Record an edit and stamp the capture time this edit will be saved under.
  // @param {string} rowUuid - Row being edited.
  // @param {object} rowChanges - Fields to merge into that row.
  const handleChangeRow = useCallback((rowUuid, rowChanges) => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setDraftRows(previous => previous.map(row => (row.uuid === rowUuid ? { ...row, ...rowChanges, isDirty: true } : row)));
  }, []);

  // ----------------------------------------------------------------------------------------------
  // @desc Remove a stored project from the plan, recording the rejection so it is not proposed again.
  // @param {object} row - Row being rejected.
  const handleReject = useCallback(async row => {
    const capturedAt = new Date().toISOString();
    const didSave = await onSave([rejectionRecordFromRow(row, capturedAt)]);
    if (!didSave) return;
    setDraftRows(previous => previous.filter(candidate => candidate.uuid !== row.uuid));
  }, [onSave]);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist one card's Focus, Keep warm, or Not now decision immediately and reflect it on that card.
  // @param {object} row - Stored project being judged.
  // @param {string} priorityEm - ActionProspect priority enum represented by the selected button.
  const handleSetPriority = useCallback(async (row, priorityEm) => {
    const capturedAt = new Date().toISOString();
    const didSave = await onSaveDecision([priorityRecordFromRow(row, priorityEm, capturedAt)]);
    if (!didSave) return false;
    setDraftRows(previous => previous.map(candidate => (candidate.uuid === row.uuid
      ? { ...candidate, approvalStatusEm: candidate.approvalStatusEm === "awaitingJudgement" ? "humanAffirmed"
        : candidate.approvalStatusEm, isDirty: false, isStored: true, priorityEm } : candidate)));
    return true;
  }, [onSaveDecision]);

  // ----------------------------------------------------------------------------------------------
  // @desc Save changed rows carrying names, keeping the draft intact on failure so navigation can retry.
  // @returns {Promise<boolean>} Whether navigation may proceed.
  const handleSave = async () => {
    if (!capturedAtRef.current) return true;
    const capturedAt = capturedAtRef.current ?? new Date().toISOString();
    capturedAtRef.current = capturedAt;
    const prospectRecords = prospectRecordsFromDraftRows(draftRows, capturedAt);
    if (!prospectRecords.length) {
      capturedAtRef.current = null;
      return true;
    }
    const didSave = await onSave(prospectRecords);
    if (!didSave) return false;
    capturedAtRef.current = null;
    return true;
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save pending custom project text before honoring the Back or Next submit button.
  // @param {object} event - Form submission event from the wizard navigation.
  const handleNavigate = async event => {
    event.preventDefault();
    const didSave = await handleSave();
    if (!didSave) return;
    onNavigate();
  };

  return (
    <form className="plan-step-container projects-step-container" id={ PROJECTS_STEP_FORM_ID } onSubmit={ handleNavigate }>
      <h2 className="plan-heading">{ PROJECTS_STEP_COPY.title }</h2>
      <p className="plan-summary">{ PROJECTS_STEP_COPY.summary }</p>
      { ["work", "personal"].map(userCategoryEm => {
        const categoryRows = draftRows.filter(row => row.userCategoryEm === userCategoryEm);
        const categoryGoals = planningContext.goals.filter(goal => goal.userCategoryEm === userCategoryEm);
        const categoryGoalUuids = categoryGoals.map(goal => goal.uuid);
        const hasChosenIntent = categoryGoals.length > 0;
        const proposedCount = categoryRows.filter(row => row.approvalStatusEm === "awaitingJudgement").length;
        return (
          <section className={ `projects-step-category projects-step-category--${ userCategoryEm }` } key={ userCategoryEm }>
            <h3 className="plan-category-heading">{ CATEGORY_HEADINGS[userCategoryEm] }</h3>
            { categoryGoals.length ? null : (
              <p className="plan-empty">
                You have not saved an intent in this category, so there is nothing here to tie a project to yet.
              </p>
            ) }
            <div className="projects-step-card-grid">
              { categoryRows.map(row => (
                <ProjectCard { ...{ row } } isDisabled={ isSaving } key={ row.uuid }
                  onChangeSummary={ handleChangeRow } onReject={ handleReject } onSetPriority={ handleSetPriority } />
              )) }
            </div>
            <div className="plan-actions">
              <button className="plan-button plan-button--dashed projects-step-add" disabled={ isSaving }
                onClick={ () => setDraftRows(previous => previous.concat(emptyProjectRow(userCategoryEm,
                  categoryGoalUuids))) } type="button">
                Add another project
              </button>
              <button className="plan-button plan-button--dashed projects-step-discover"
                disabled={ isDiscovering || isSaving || !hasChosenIntent }
                onClick={ onDiscover }
                title={ hasChosenIntent ? "Read your recent tasks for projects that would carry these intents"
                  : "Save an intent in this category first, so there is something for a project to advance" }
                type="button">
                { isDiscovering ? "Reading your tasks…" : "Suggest projects from my tasks" }
              </button>
              <p className="projects-step-discovery-notice" role="status">
                { discoveryNoticeText({ discoveryFailureReason, hasChosenIntent, isDiscovering, proposedCount }) }
              </p>
            </div>
          </section>
        );
      }) }
    </form>
  );
}
