// The wizard's second page: name the projects that carry the intents saved on the first page, and tie each one to
// the intents it advances. Projects the user names are stored as human-provided prospects; when the discovery
// milestone lands, its proposals arrive in this same list awaiting judgement, and the page already distinguishes
// them. Until then the page says plainly that nothing has been derived from the user's notes, rather than
// presenting an empty list as though a search had run and found nothing.

import { draftRowsFromProspects, emptyProjectRow, prospectRecordsFromDraftRows,
  rejectionRecordFromRow } from "dashboard/plan-wizard/projects-step-fields";
import { useEffect, useRef, useState } from "react";

const CATEGORY_HEADINGS = { personal: "Personal projects (optional)", work: "Professional projects" };

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
      { wasProposed ? <p className="project-row-provenance">Suggested from your notes — edit or remove it.</p> : null }
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
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onSave - Receives prospect records and resolves true when the write succeeded.
//   - {object} planningContext - Stored goals and prospects for the scope.
//   - {Error|null} saveError - Last save failure; its presence turns the action into a retry.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The projects page.
export default function ProjectsStep({ isSaving, onSave, planningContext, saveError, scopeKey }) {
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

  return (
    <div className="projects-step-page">
      <h2 className="projects-step-heading">Which projects carry those intents?</h2>
      <p className="projects-step-summary">
        Name the concrete work behind each intent, then tie it to the outcomes it moves forward.
      </p>
      <p className="projects-step-discovery-notice" role="note">
        Deriving projects from your notes and tasks is not built yet, so nothing below was suggested for you.
      </p>
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
