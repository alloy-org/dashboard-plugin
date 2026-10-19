// Render one independently updating project card and persist its priority or completion without disabling sibling
// cards.

import confetti from "canvas-confetti";
import { Button, PlainButton } from "dashboard/controls";
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import ExpandingTextarea from "dashboard/plan-wizard/expanding-textarea";
import { PROJECT_PRIORITY_OPTIONS } from "dashboard/plan-wizard/projects-step-fields";
import { citedTaskUuidsFromSubstantiations, substantiationSegments,
  taskChipLabel } from "dashboard/plan-wizard/substantiation-task-references";
import { memo, useEffect, useRef, useState } from "react";
import { MdCheck } from "react-icons/md";

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
// @desc Escape task text before handing it to DashboardTippy, which renders its content as HTML.
// @param {string} text - Plain task text.
// @returns {string} HTML-safe text.
function htmlEscapedText(text) {
  return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ----------------------------------------------------------------------------------------------
// @desc Draw one cited task as a chip showing its first few words, with the whole task on hover. An open task is
//   marked live, a finished one is checked off, and one still being read shows a placeholder of the same shape.
// @param {object|undefined} citedTask - { completedAt, text } from useCitedTasks, or undefined while it is read.
// @returns {JSX.Element} The chip.
function CitedTaskChip({ citedTask }) {
  if (!citedTask) return <span className="project-row-task-chip project-row-task-chip--pending">task…</span>;
  const isFinished = Boolean(citedTask.completedAt);
  const chipClass = `project-row-task-chip ${ isFinished ? "project-row-task-chip--finished" : "project-row-task-chip--active" }`;
  const tooltipHtml = `${ isFinished ? "Finished task" : "Open task" }: ${ htmlEscapedText(citedTask.text) }`;
  return (
    <DashboardTippy content={ tooltipHtml } delay={ [150, 0] }>
      <span className={ chipClass } tabIndex={ 0 }>
        { isFinished ? <MdCheck className="project-row-task-chip-marker" size={ 12 } />
          : <span aria-hidden="true" className="project-row-task-chip-marker" /> }
        { taskChipLabel(citedTask.text) || "Untitled task" }
      </span>
    </DashboardTippy>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render one reason for a project, drawing each task it cites as a chip in place of the task's UUID and
//   dropping citations of tasks that no longer exist.
// @param {object} params - An object with the following properties:
//   - {object} citedTaskByUuid - { [taskUuid]: { completedAt, text } | null } from useCitedTasks.
//   - {string} reason - One substantiation as discovery wrote it.
// @returns {JSX.Element} The reason paragraph.
function ProjectReason({ citedTaskByUuid, reason }) {
  const segments = substantiationSegments(reason, taskUuid => citedTaskByUuid[taskUuid] !== null);
  return (
    <p>
      { segments.map((segment, index) => (segment.kind === "task"
        ? <CitedTaskChip citedTask={ citedTaskByUuid[segment.taskUuid] } key={ `${ segment.taskUuid }-${ index }` } />
        : <span key={ index }>{ segment.text }</span>)) }
    </p>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render one project proposal or custom project with card-local priority and completion state.
//   Project names wrap and grow to display their full text. Keep emphasis choices visible and disabled
//   until the project has a nonblank name, and while the project is marked Complete. A row marked
//   shouldAutoFocus — one the Add another project button just created — takes the cursor as the card mounts.
// @param {object} params - An object with the following properties:
//   - {object} citedTaskByUuid - Tasks cited by the page's reasons, from useCitedTasks.
//   - {boolean} isDisabled - Whether a page-level save prevents editing.
//   - {Function} onChangeSummary - Receives the row UUID and edited row fields.
//   - {Function} onReject - Receives the stored row to reject.
//   - {Function} onSetCompletion - Persists a row and whether it is complete, resolving to whether it succeeded.
//   - {Function} onSetPriority - Persists a row and priorityEm, resolving to whether it succeeded.
//   - {object} row - Draft project row rendered by this card.
// @returns {JSX.Element} An independently memoized project card.
function ProjectCard({ citedTaskByUuid = {}, isDisabled, onChangeSummary, onReject, onSetCompletion, onSetPriority, row }) {
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
          <Button className="project-row-reject" dense disabled={ isDisabled || isDecisionSaving }
            onClick={ () => onReject(row) } title="Remove this project from the plan" tone="danger">
            Remove
          </Button>
        ) : null }
      </div>
      { wasSuggested ? (
        <div className="project-row-provenance">
          { row.substantiations.map(reason => <ProjectReason { ...{ citedTaskByUuid, reason } } key={ reason } />) }
        </div>
      ) : null }
      <div className="project-row-footer">
        <div className="project-row-emphasis">
          <p className="project-row-emphasis-label" id={ `project-emphasis-${ row.uuid }` }>Project emphasis</p>
          <div aria-labelledby={ `project-emphasis-${ row.uuid }` } className="project-row-priority" role="group">
            { PROJECT_PRIORITY_OPTIONS.map(option => {
              const isSelected = !isCompleted && selectedPriorityEm === option.value;
              return (
                <PlainButton aria-pressed={ isSelected }
                  className={ `project-row-priority-button${ isSelected ? " project-row-priority-button--selected" : "" }` }
                  disabled={ isDisabled || isDecisionSaving || isCompleted || !hasSummary } key={ option.value }
                  onClick={ () => handleSetPriority(option.value) }>
                  { option.label }
                </PlainButton>
              );
            }) }
          </div>
        </div>
        <div className="project-row-status">
          <p className="project-row-emphasis-label">Status</p>
          <PlainButton aria-pressed={ isCompleted }
            className={ `project-row-status-button${ isCompleted ? " project-row-status-button--done" : "" }` }
            disabled={ isDisabled || isDecisionSaving || !row.isStored || !hasSummary }
            onClick={ handleToggleCompletion }
            title={ isCompleted
              ? "Reopen this project so it is suggested again"
              : "Mark this project finished" }>
            <MdCheck size={ 16 } />{ isCompleted ? "Done" : "Complete" }
          </PlainButton>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Compare only props capable of changing a rendered card, allowing sibling rows to retain their render. A
//   lookup of cited tasks re-renders only the cards whose reasons cite a task it changed.
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
    && stringValuesEqual(previousRow.substantiations, nextRow.substantiations)
    && citedTasksEqual(nextRow.substantiations, previous.citedTaskByUuid, next.citedTaskByUuid);
}

// ----------------------------------------------------------------------------------------------
// @desc Compare the cited-task lookups for only the tasks a card's reasons cite.
// @param {Array<string>} substantiations - The card's reasons.
// @param {object} [previous] - Previous cited-task lookup.
// @param {object} [next] - Next cited-task lookup.
// @returns {boolean} Whether every task the card cites resolves to the same record in both.
function citedTasksEqual(substantiations, previous = {}, next = {}) {
  if (previous === next) return true;
  const citedTaskUuids = citedTaskUuidsFromSubstantiations(substantiations);
  return citedTaskUuids.every(taskUuid => previous[taskUuid] === next[taskUuid]);
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
