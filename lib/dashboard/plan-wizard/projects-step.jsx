// The wizard's second page: name the projects that carry the intents saved on the first page, and tie each one to
// the intents it advances. Projects the user names are stored as human-provided prospects; discovery's proposals
// arrive in the same list awaiting judgement, drawn as provisional so an inference is never mistaken for a
// decision the user made.
//
// Discovery runs only when asked. It reads the intents from the first page, so it has nothing to work from until
// those are saved, and it costs a provider call — so the page offers it as an action and reports what a pass
// found, rather than firing on mount and presenting an empty list as though a search had already run.

import { draftRowsFromProspects, emptyProjectRow, prospectRecordsFromDraftRows,
  rejectionRecordFromRow } from "dashboard/plan-wizard/projects-step-fields";
import { useEffect, useRef, useState } from "react";

const CATEGORY_HEADINGS = { personal: "Personal projects (optional)", work: "Professional projects" };

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
// @desc One editable project row: its name, the intents it advances, and the control that drops it.
// @param {object} params - An object with the following properties:
//   - {Array<object>} goals - The quarter's saved goals for this row's category, offered as links.
//   - {boolean} isDisabled - True while a save is in flight.
//   - {Function} onChangeSummary - Receives the row's new name.
//   - {Function} onReject - Removes a stored project from the plan.
//   - {Function} onToggleGoal - Receives a goal UUID to link or unlink.
//   - {object} row - Draft row being edited.
// @returns {JSX.Element} A project row.
function ProjectRow({ goals, isDisabled, onChangeSummary, onReject, onToggleGoal, row }) {
  const wasProposed = row.approvalStatus === "awaitingJudgement";
  const rowClass = `project-row ${ wasProposed ? "project-row--proposed" : "project-row--chosen" }`;
  return (
    <div className={ rowClass }>
      <div className="project-row-header">
        <input className="project-row-name" disabled={ isDisabled } onChange={ event => onChangeSummary(event.target.value) }
          placeholder="Name a project that moves an intent forward" type="text" value={ row.summary } />
        { row.isStored ? (
          <button className="project-row-reject" disabled={ isDisabled } onClick={ onReject }
            title="Remove this project from the plan" type="button">
            Remove
          </button>
        ) : null }
      </div>
      { wasProposed ? (
        <p className="project-row-provenance">
          { row.substantiation || "Suggested from your notes" } — edit or remove it.
        </p>
      ) : null }
      { goals.length && row.summary.trim() ? (
        <div className="project-row-goal-list">
          { goals.map(goal => (
            <label className="project-row-goal" key={ goal.uuid }>
              <input checked={ row.linkedGoalUuids.includes(goal.uuid) } disabled={ isDisabled }
                onChange={ () => onToggleGoal(goal.uuid) } type="checkbox" />
              { goal.goalText }
            </label>
          )) }
        </div>
      ) : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render and save the projects page. Draft rows are local state seeded from stored prospects and reseeded
//   only when the plan scope changes or a save succeeds, so a project the user is naming survives a refresh.
// @param {object} params - An object with the following properties:
//   - {string|null} discoveryFailureReason - Why the last discovery pass proposed nothing, when it proposed none.
//   - {boolean} isDiscovering - True while a discovery pass is in flight.
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onDiscover - Runs a discovery pass for the current scope.
//   - {Function} onSave - Receives prospect records and resolves true when the write succeeded.
//   - {object} planningContext - Stored goals and prospects for the scope.
//   - {Error|null} saveError - Last save failure; its presence turns the action into a retry.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The projects page.
export default function ProjectsStep({ discoveryFailureReason = null, isDiscovering = false, isSaving, onDiscover,
    planningContext, saveError, onSave, scopeKey }) {
  const [draftRows, setDraftRows] = useState(() => draftRowsFromProspects(planningContext.prospects));
  const [hasSaved, setHasSaved] = useState(false);
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && !capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    setDraftRows(draftRowsFromProspects(planningContext.prospects));
    setHasSaved(false);
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setDraftRows(draftRowsFromProspects(planningContext.prospects));
  }, [planningContext.prospects]);

  // ----------------------------------------------------------------------------------------------
  // @desc Record an edit and stamp the capture time this edit will be saved under.
  // @param {string} rowUuid - Row being edited.
  // @param {object} rowChanges - Fields to merge into that row.
  const handleChangeRow = (rowUuid, rowChanges) => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setHasSaved(false);
    setDraftRows(previous => previous.map(row => (row.uuid === rowUuid ? { ...row, ...rowChanges } : row)));
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Link or unlink one intent from a project, so the plan records which outcome the work serves.
  // @param {string} rowUuid - Row being edited.
  // @param {string} goalUuid - Intent being toggled.
  const handleToggleGoal = (rowUuid, goalUuid) => {
    const row = draftRows.find(candidate => candidate.uuid === rowUuid);
    if (!row) return;
    const isLinked = row.linkedGoalUuids.includes(goalUuid);
    const remainingGoalUuids = row.linkedGoalUuids.filter(uuid => uuid !== goalUuid);
    const linkedGoalUuids = isLinked ? remainingGoalUuids : row.linkedGoalUuids.concat(goalUuid);
    handleChangeRow(rowUuid, { linkedGoalUuids });
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Remove a stored project from the plan, recording the rejection so it is not proposed again.
  // @param {object} row - Row being rejected.
  const handleReject = async row => {
    const capturedAt = new Date().toISOString();
    const didSave = await onSave([rejectionRecordFromRow(row, capturedAt)]);
    if (!didSave) return;
    setDraftRows(previous => previous.filter(candidate => candidate.uuid !== row.uuid));
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save every row that carries a name, keeping the draft intact on failure so a retry reuses its timestamp.
  const handleSave = async () => {
    const capturedAt = capturedAtRef.current ?? new Date().toISOString();
    capturedAtRef.current = capturedAt;
    const prospectRecords = prospectRecordsFromDraftRows(draftRows, capturedAt);
    if (!prospectRecords.length) return;
    const didSave = await onSave(prospectRecords);
    if (!didSave) return;
    capturedAtRef.current = null;
    setHasSaved(true);
  };

  const hasNamedProject = draftRows.some(row => row.summary.trim());
  const saveLabel = saveError ? "Retry saving" : "Save projects";
  const hasChosenIntent = planningContext.goals.length > 0;
  const proposedCount = draftRows.filter(row => row.approvalStatus === "awaitingJudgement").length;

  return (
    <div className="projects-step-page">
      <h2 className="projects-step-heading">Which projects carry those intents?</h2>
      <p className="projects-step-summary">
        Name the concrete work behind each intent, then tie it to the outcomes it moves forward.
      </p>
      <div className="projects-step-discovery">
        <button className="projects-step-discover" disabled={ isDiscovering || isSaving || !hasChosenIntent }
          onClick={ onDiscover }
          title={ hasChosenIntent ? "Read your recent tasks for projects that would carry these intents"
            : "Save an intent on the previous page first, so there is something for a project to advance" }
          type="button">
          { isDiscovering ? "Reading your tasks…" : "Suggest projects from my tasks" }
        </button>
        <p className="projects-step-discovery-notice" role="status">
          { discoveryNoticeText({ discoveryFailureReason, hasChosenIntent, isDiscovering, proposedCount }) }
        </p>
      </div>
      { ["work", "personal"].map(userCategoryEm => {
        const categoryRows = draftRows.filter(row => row.userCategoryEm === userCategoryEm);
        const categoryGoals = planningContext.goals.filter(goal => goal.userCategoryEm === userCategoryEm);
        return (
          <section className={ `projects-step-category projects-step-category--${ userCategoryEm }` } key={ userCategoryEm }>
            <h3 className="projects-step-category-heading">{ CATEGORY_HEADINGS[userCategoryEm] }</h3>
            { categoryGoals.length ? null : (
              <p className="projects-step-empty-goals">
                You have not saved an intent in this category, so there is nothing here to tie a project to yet.
              </p>
            ) }
            { categoryRows.map(row => (
              <ProjectRow goals={ categoryGoals } isDisabled={ isSaving } key={ row.uuid }
                onChangeSummary={ summary => handleChangeRow(row.uuid, { summary }) }
                onReject={ () => handleReject(row) } onToggleGoal={ goalUuid => handleToggleGoal(row.uuid, goalUuid) }
                row={ row } />
            )) }
            <button className="projects-step-add" disabled={ isSaving }
              onClick={ () => setDraftRows(previous => previous.concat(emptyProjectRow(userCategoryEm))) } type="button">
              Add another project
            </button>
          </section>
        );
      }) }
      { saveError ? (
        <p className="projects-step-error" role="alert">Your projects were not saved. { saveError.message }</p>
      ) : null }
      { hasSaved ? <p className="projects-step-saved">Saved.</p> : null }
      <div className="projects-step-actions">
        <button className="projects-step-save" disabled={ isSaving || !hasNamedProject } onClick={ handleSave } type="button">
          { isSaving ? "Saving…" : saveLabel }
        </button>
      </div>
    </div>
  );
}
