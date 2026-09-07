// Render one independently updating project card and persist its priority without disabling sibling cards.

import { PROJECT_PRIORITY_OPTIONS } from "dashboard/plan-wizard/projects-step-fields";
import { memo, useEffect, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Render one project proposal or custom project with card-local priority selection state.
// @param {object} params - An object with the following properties:
//   - {boolean} isDisabled - Whether a page-level save prevents editing.
//   - {Function} onChangeSummary - Receives the row UUID and edited row fields.
//   - {Function} onReject - Receives the stored row to reject.
//   - {Function} onSetPriority - Persists a row and priorityEm, resolving to whether it succeeded.
//   - {object} row - Draft project row rendered by this card.
// @returns {JSX.Element} An independently memoized project card.
function ProjectCard({ isDisabled, onChangeSummary, onReject, onSetPriority, row }) {
  const [isPrioritySaving, setIsPrioritySaving] = useState(false);
  const [selectedPriorityEm, setSelectedPriorityEm] = useState(row.priorityEm);
  const wasProposed = row.approvalStatusEm === "awaitingJudgement";
  const wasSuggested = row.approvalStatusEm !== "humanProvided";
  const rowClass = `project-row ${ wasProposed ? "project-row--proposed" : "project-row--chosen" }`;

  useEffect(() => {
    setSelectedPriorityEm(row.priorityEm);
  }, [row.priorityEm]);

  // ----------------------------------------------------------------------------------------------
  // @desc Optimistically select and persist one priority while only this card shows a pending state.
  // @param {string} priorityEm - quarterFocus, stayWarm, or notNow.
  const handleSetPriority = async priorityEm => {
    const previousPriorityEm = selectedPriorityEm;
    setSelectedPriorityEm(priorityEm);
    setIsPrioritySaving(true);
    const didSave = await onSetPriority(row, priorityEm);
    if (!didSave) setSelectedPriorityEm(previousPriorityEm);
    setIsPrioritySaving(false);
  };

  return (
    <div aria-busy={ isPrioritySaving } className={ rowClass }>
      <div className="project-row-header">
        <input className="project-row-name" disabled={ isDisabled || isPrioritySaving }
          onChange={ event => onChangeSummary(row.uuid, { summary: event.target.value }) }
          placeholder="Name a project that moves an intent forward" type="text" value={ row.summary } />
        { row.isStored ? (
          <button className="project-row-reject" disabled={ isDisabled || isPrioritySaving }
            onClick={ () => onReject(row) } title="Remove this project from the plan" type="button">
            Remove
          </button>
        ) : null }
      </div>
      { wasSuggested ? (
        <div className="project-row-provenance">
          { row.substantiations.map(reason => <p key={ reason }>{ reason }</p>) }
        </div>
      ) : null }
      { row.summary.trim() ? (
        <div aria-label={ `Priority for ${ row.summary }` } className="project-row-priority">
          { PROJECT_PRIORITY_OPTIONS.map(option => (
            <button aria-pressed={ selectedPriorityEm === option.value }
              className={ `project-row-priority-button${ selectedPriorityEm === option.value ? " project-row-priority-button--selected" : "" }` }
              disabled={ isDisabled || isPrioritySaving } key={ option.value }
              onClick={ () => handleSetPriority(option.value) } type="button">
              { option.label }
            </button>
          )) }
        </div>
      ) : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Compare only props capable of changing a rendered card, allowing sibling rows to retain their render.
// @param {object} previous - Previous ProjectCard props.
// @param {object} next - Next ProjectCard props.
// @returns {boolean} Whether React can skip rendering this card.
export function projectCardPropsEqual(previous, next) {
  const previousRow = previous.row;
  const nextRow = next.row;
  return previous.isDisabled === next.isDisabled && previous.onChangeSummary === next.onChangeSummary
    && previous.onReject === next.onReject && previous.onSetPriority === next.onSetPriority
    && previousRow.approvalStatusEm === nextRow.approvalStatusEm && previousRow.isStored === nextRow.isStored
    && previousRow.priorityEm === nextRow.priorityEm && previousRow.summary === nextRow.summary
    && previousRow.uuid === nextRow.uuid
    && stringValuesEqual(previousRow.substantiations, nextRow.substantiations);
}

// ----------------------------------------------------------------------------------------------
// @desc Compare ordered strings without requiring draft-row object identity to survive context refreshes.
// @param {Array<string>} previous - Previous values.
// @param {Array<string>} next - Next values.
// @returns {boolean} Whether both arrays contain the same ordered strings.
function stringValuesEqual(previous = [], next = []) {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

export default memo(ProjectCard, projectCardPropsEqual);
