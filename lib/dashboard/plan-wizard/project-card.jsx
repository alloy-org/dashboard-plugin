// Render one independently updating project card and persist its priority or completion without disabling sibling
// cards.

import confetti from "canvas-confetti";
import ExpandingTextarea from "dashboard/plan-wizard/expanding-textarea";
import { PROJECT_PRIORITY_OPTIONS } from "dashboard/plan-wizard/projects-step-fields";
import { memo, useEffect, useRef, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Celebrate a finished project with confetti bursting from the middle of its card.
// @param {HTMLElement|null} cardElement - The project card's root element.
function celebrateFromCard(cardElement) {
  if (!cardElement || typeof window === "undefined") return;
  const rect = cardElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const origin = { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight };
  confetti({ origin, particleCount: 90, spread: 75, startVelocity: 38, zIndex: 2000 });
}

// ----------------------------------------------------------------------------------------------
// @desc Render one project proposal or custom project with card-local priority and completion state.
//   Project names wrap and grow to display their full text. Keep emphasis choices visible and disabled
//   until the project has a nonblank name, and while the project is marked Complete. A row marked
//   shouldAutoFocus — one the Add another project button just created — takes the cursor as the card mounts.
// @param {object} params - An object with the following properties:
//   - {boolean} isDisabled - Whether a page-level save prevents editing.
//   - {Function} onChangeSummary - Receives the row UUID and edited row fields.
//   - {Function} onReject - Receives the stored row to reject.
//   - {Function} onSetCompletion - Persists a row and whether it is complete, resolving to whether it succeeded.
//   - {Function} onSetPriority - Persists a row and priorityEm, resolving to whether it succeeded.
//   - {object} row - Draft project row rendered by this card.
// @returns {JSX.Element} An independently memoized project card.
function ProjectCard({ isDisabled, onChangeSummary, onReject, onSetCompletion, onSetPriority, row }) {
  const cardRef = useRef(null);
  const [isCompleted, setIsCompleted] = useState(Boolean(row.completedAt));
  const [isDecisionSaving, setIsDecisionSaving] = useState(false);
  const [selectedPriorityEm, setSelectedPriorityEm] = useState(row.priorityEm);
  const hasSummary = Boolean(row.summary.trim());
  const wasProposed = row.approvalStatusEm === "awaitingJudgement";
  const wasSuggested = row.approvalStatusEm !== "humanProvided";
  const statusClass = isCompleted ? "project-row--completed" : (wasProposed ? "project-row--proposed" : "project-row--chosen");
  const rowClass = `project-row ${ statusClass }`;

  useEffect(() => {
    setSelectedPriorityEm(row.priorityEm);
  }, [row.priorityEm]);

  useEffect(() => {
    setIsCompleted(Boolean(row.completedAt));
  }, [row.completedAt]);

  // ----------------------------------------------------------------------------------------------
  // @desc Optimistically select and persist one priority while only this card shows a pending state.
  // @param {string} priorityEm - quarterFocus, stayWarm, or notNow.
  const handleSetPriority = async priorityEm => {
    const previousPriorityEm = selectedPriorityEm;
    setSelectedPriorityEm(priorityEm);
    setIsDecisionSaving(true);
    const didSave = await onSetPriority(row, priorityEm);
    if (!didSave) setSelectedPriorityEm(previousPriorityEm);
    setIsDecisionSaving(false);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Optimistically mark the project Complete, or reopen it, and celebrate once a completion has saved.
  const handleToggleCompletion = async () => {
    const shouldComplete = !isCompleted;
    setIsCompleted(shouldComplete);
    setIsDecisionSaving(true);
    const didSave = await onSetCompletion(row, shouldComplete);
    if (!didSave) setIsCompleted(!shouldComplete);
    else if (shouldComplete) celebrateFromCard(cardRef.current);
    setIsDecisionSaving(false);
  };

  return (
    <div aria-busy={ isDecisionSaving } className={ rowClass } ref={ cardRef }>
      <div className="project-row-header">
        <ExpandingTextarea className="project-row-name" disabled={ isDisabled || isDecisionSaving }
          onChange={ event => onChangeSummary(row.uuid, { summary: event.target.value }) }
          placeholder="Name a project that moves an intent forward" shouldAutoFocus={ row.shouldAutoFocus }
          value={ row.summary } />
        { row.isStored ? (
          <button className="project-row-reject" disabled={ isDisabled || isDecisionSaving }
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
      <div className="project-row-footer">
        <div className="project-row-emphasis">
          <p className="project-row-emphasis-label" id={ `project-emphasis-${ row.uuid }` }>Project emphasis</p>
          <div aria-labelledby={ `project-emphasis-${ row.uuid }` } className="project-row-priority" role="group">
            { PROJECT_PRIORITY_OPTIONS.map(option => {
              const isSelected = !isCompleted && selectedPriorityEm === option.value;
              return (
                <button aria-pressed={ isSelected }
                  className={ `project-row-priority-button${ isSelected ? " project-row-priority-button--selected" : "" }` }
                  disabled={ isDisabled || isDecisionSaving || isCompleted || !hasSummary } key={ option.value }
                  onClick={ () => handleSetPriority(option.value) } type="button">
                  { option.label }
                </button>
              );
            }) }
          </div>
        </div>
        <div className="project-row-status">
          <p className="project-row-emphasis-label">Status</p>
          <button aria-pressed={ isCompleted }
            className={ `project-row-status-button${ isCompleted ? " project-row-status-button--done" : "" }` }
            disabled={ isDisabled || isDecisionSaving || !row.isStored || !hasSummary }
            onClick={ handleToggleCompletion }
            title={ isCompleted ? "Reopen this project so it is suggested again" : "Mark this project finished" }
            type="button">
            <span aria-hidden="true">✓</span> { isCompleted ? "Done" : "Complete" }
          </button>
        </div>
      </div>
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
    && previous.onReject === next.onReject && previous.onSetCompletion === next.onSetCompletion
    && previous.onSetPriority === next.onSetPriority && previousRow.approvalStatusEm === nextRow.approvalStatusEm
    && previousRow.completedAt === nextRow.completedAt && previousRow.isStored === nextRow.isStored
    && previousRow.priorityEm === nextRow.priorityEm && previousRow.shouldAutoFocus === nextRow.shouldAutoFocus
    && previousRow.summary === nextRow.summary && previousRow.uuid === nextRow.uuid
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
