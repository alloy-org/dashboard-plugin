// The payoff ranking a Quarter Retrospective asks for once the quarter's projects are known: the projects as a list
// of chips the user reorders, by dragging a chip or with its Move up and Move down buttons, to answer whether the
// work on each really paid off. It appears on the processing screen while the story is written, and as a slide
// before the story's summary when the quarter is still unranked. Saving hands the order to the caller to store.
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import { projectsInPayoffOrder } from "dashboard/quarter-retrospective/project-payoff-rankings";
import { useRef, useState } from "react";
import { logIfEnabled } from "util/log";

export const PAYOFF_RANKING_PROMPT = "Now that time has passed, rank projects by: Did my work on this really pay off?";
export const PAYOFF_RANKING_TOOLTIP = "We'll use this to help build future plans: Plan Builder will remind you which "
  + "projects paid off and weigh them when suggesting new ones.";
export const PAYOFF_SAVE_STATES = Object.freeze({ failed: "failed", saved: "saved", saving: "saving", unsaved: "unsaved" });

// ----------------------------------------------------------------------------------------------
// @desc Move one project to another's place in the list, shifting those between.
// @param {Array<object>} projects - Projects in their current order.
// @param {number} fromIndex - Where the moved project is now.
// @param {number} toIndex - Where it goes.
// @returns {Array<object>} A new list; the same order when either index is out of range.
export function reorderedProjects(projects, fromIndex, toIndex) {
  const outOfRange = index => index < 0 || index >= projects.length;
  if (fromIndex === toIndex || outOfRange(fromIndex) || outOfRange(toIndex)) return projects;
  const remainingProjects = projects.filter((project, index) => index !== fromIndex);
  remainingProjects.splice(toIndex, 0, projects[fromIndex]);
  return remainingProjects;
}

// ----------------------------------------------------------------------------------------------
// @desc The label of the save button for where the ranking stands.
// @param {string} saveState - A PAYOFF_SAVE_STATES value.
// @param {boolean} rankedBefore - Whether the quarter has a stored ranking, from before or from this list.
// @returns {string} The label.
function saveButtonLabel(saveState, rankedBefore) {
  if (saveState === PAYOFF_SAVE_STATES.saving) return "Saving…";
  if (saveState === PAYOFF_SAVE_STATES.saved) return "Saved ✓";
  return rankedBefore ? "Update ranking" : "Save ranking";
}

// ----------------------------------------------------------------------------------------------
// @desc One project in the ranking: its rank, its name, and buttons to move it up or down. The chip can be dragged
//   onto another to take its place.
// @param {object} props - { dragState, index, onDragEnd, onDragOver, onDragStart, onDrop, onMove, project, projectCount }.
// @returns {JSX.Element} The chip.
function PayoffRankingChip({ dragState, index, onDragEnd, onDragOver, onDragStart, onDrop, onMove, project, projectCount }) {
  const chipClasses = ["retrospective-payoff-chip", dragState.draggingIndex === index ? "retrospective-payoff-chip--dragging" : "",
    dragState.dragOverIndex === index && dragState.draggingIndex !== index ? "retrospective-payoff-chip--drag-over" : ""];
  return (
    <li className={ chipClasses.filter(Boolean).join(" ") } draggable onDragEnd={ onDragEnd } onDragOver={ event => onDragOver(event, index) }
      onDragStart={ event => onDragStart(event, index) } onDrop={ event => onDrop(event, index) }>
      <span className="retrospective-payoff-chip-rank">{ index + 1 }</span>
      <span className="retrospective-payoff-chip-name">{ project.name }</span>
      <button aria-label={ `Move ${ project.name } up` } className="retrospective-payoff-chip-move" disabled={ index === 0 }
        onClick={ () => onMove(index, index - 1) } title="Move up" type="button">↑</button>
      <button aria-label={ `Move ${ project.name } down` } className="retrospective-payoff-chip-move" disabled={ index === projectCount - 1 }
        onClick={ () => onMove(index, index + 1) } title="Move down" type="button">↓</button>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Drag-and-drop state for the ranking list, built on HTML5 drag and drop as the dashboard layout popup is.
// @param {Function} onMove - Receives (fromIndex, toIndex) when a chip is dropped on another.
// @returns {object} { dragState, onDragEnd, onDragOver, onDragStart, onDrop }.
function usePayoffRankingDrag(onMove) {
  const draggedIndexRef = useRef(null);
  const [dragState, setDragState] = useState({ dragOverIndex: null, draggingIndex: null });
  const clearDrag = () => {
    draggedIndexRef.current = null;
    setDragState({ dragOverIndex: null, draggingIndex: null });
  };
  const onDragStart = (event, index) => {
    draggedIndexRef.current = index;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDragState({ dragOverIndex: null, draggingIndex: index });
  };
  const onDragOver = (event, index) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragState(previous => (previous.dragOverIndex === index ? previous : { ...previous, dragOverIndex: index }));
  };
  const onDrop = (event, index) => {
    event.preventDefault();
    const draggedIndex = draggedIndexRef.current;
    clearDrag();
    if (draggedIndex !== null) onMove(draggedIndex, index);
  };
  return { dragState, onDragEnd: clearDrag, onDragOver, onDragStart, onDrop };
}

// ----------------------------------------------------------------------------------------------
// @desc The ranking: the prompt with a tooltip on how the ranking is used, the projects to reorder, and the save and
//   skip buttons. Reordering after a save marks the ranking unsaved again.
// @param {object} props - An object with the following properties:
//   - {Function} onSave - async (rankedProjects) => void; stores the order, the project that paid off most first
//   - {Function|null} [onSaved] - Called after a save succeeds, such as to move the story on
//   - {Function|null} [onSkip] - Leaves without saving; none hides the Skip button
//   - {Array<object>} projects - { derivedFrom, name, uuid } per project
//   - {object|null} [savedRanking] - The quarter's stored ranking, which sets the starting order
// @returns {JSX.Element} The ranking.
export default function RetrospectivePayoffRanking({ onSave, onSaved = null, onSkip = null, projects, savedRanking = null }) {
  const [order, setOrder] = useState(() => projectsInPayoffOrder(projects, savedRanking));
  const [saveState, setSaveState] = useState(PAYOFF_SAVE_STATES.unsaved);
  const [savedHere, setSavedHere] = useState(false);
  const rankedBefore = !!savedRanking || savedHere;

  // @desc Move a project and mark the order as changed since the last save.
  const moveProject = (fromIndex, toIndex) => {
    setOrder(previous => reorderedProjects(previous, fromIndex, toIndex));
    setSaveState(PAYOFF_SAVE_STATES.unsaved);
  };
  const { dragState, onDragEnd, onDragOver, onDragStart, onDrop } = usePayoffRankingDrag(moveProject);
  // @desc Store the order, reporting a failure beside the button rather than losing the user's order.
  const handleSave = async () => {
    setSaveState(PAYOFF_SAVE_STATES.saving);
    try {
      await onSave(order);
      setSaveState(PAYOFF_SAVE_STATES.saved);
      setSavedHere(true);
      if (onSaved) onSaved();
    } catch (error) {
      logIfEnabled("[retrospective-payoff-ranking] could not save the ranking", error?.message);
      setSaveState(PAYOFF_SAVE_STATES.failed);
    }
  };
  const chipHandlers = { dragState, onDragEnd, onDragOver, onDragStart, onDrop, onMove: moveProject };
  const saveBusy = saveState === PAYOFF_SAVE_STATES.saving || saveState === PAYOFF_SAVE_STATES.saved;

  return (
    <div className="retrospective-payoff-ranking">
      <p className="retrospective-payoff-ranking-prompt">
        { PAYOFF_RANKING_PROMPT }{ " " }
        <DashboardTippy content={ PAYOFF_RANKING_TOOLTIP }>
          <span aria-label={ PAYOFF_RANKING_TOOLTIP } className="retrospective-payoff-ranking-info" role="img" tabIndex={ 0 }>ⓘ</span>
        </DashboardTippy>
      </p>
      <ol className="retrospective-payoff-ranking-list">
        { order.map((project, index) => (
          <PayoffRankingChip { ...chipHandlers } index={ index } key={ project.uuid || project.name } project={ project }
            projectCount={ order.length } />
        )) }
      </ol>
      <div className="retrospective-payoff-ranking-actions">
        <button className="retrospective-options-primary" disabled={ saveBusy } onClick={ handleSave } type="button">
          { saveButtonLabel(saveState, rankedBefore) }
        </button>
        { onSkip ? <button className="retrospective-options-secondary" onClick={ onSkip } type="button">Skip</button> : null }
      </div>
      { saveState === PAYOFF_SAVE_STATES.failed ? (
        <p className="retrospective-payoff-ranking-error" role="alert">Couldn't save the ranking. Try again.</p>
      ) : null }
    </div>
  );
}
