// The payoff ranking a Quarter Retrospective asks for once the quarter's projects are known. The projects start in an
// "unranked" area, and the user moves them up into the ranked list, by dragging or with a chip's Rank button, then
// reorders that list by dragging or with Move up and Move down, to answer whether the work on each really paid off.
// Keeping the two apart means only an order the user chose is saved, never the order the projects happened to arrive
// in. While a chip is dragged, holding it near the top or bottom of the scrolling screen scrolls it, so a long list
// can still reach the ranked area. It appears on the processing screen while the story is written, and as a slide
// before the story's summary when the quarter is still unranked. Saving hands the ranked projects to the caller. When
// the story is ready, the processing screen locks the ranking and says the user's progress was saved before moving on.
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import { payoffRankingGroups } from "dashboard/quarter-retrospective/project-payoff-rankings";
import { useEffect, useRef, useState } from "react";
import { logIfEnabled } from "util/log";

export const PAYOFF_RANKING_PROMPT = "Now that time has passed, rank projects by: Did my work on this really pay off?";
export const PAYOFF_RANKING_TOOLTIP = "We'll use this to help build future plans: Plan Builder will remind you which "
  + "projects paid off and weigh them when suggesting new ones.";
export const PAYOFF_SAVE_STATES = Object.freeze({ failed: "failed", saved: "saved", saving: "saving", unsaved: "unsaved" });
export const PAYOFF_RANKING_ZONES = Object.freeze({ ranked: "ranked", unranked: "unranked" });
export const PAYOFF_PROGRESS_SAVED_MESSAGE = "Progress saved!";
// How close to a scrolling screen's top or bottom edge, in pixels, a dragged chip scrolls it, and by how much per
// dragover event, which browsers repeat every 50ms or so while the pointer is held still.
const DRAG_SCROLL_EDGE_PIXELS = 56;
const DRAG_SCROLL_STEP_PIXELS = 14;

// ----------------------------------------------------------------------------------------------
// @desc Move one project within its area or into the other, shifting those after it.
// @param {object} groups - { ranked, unranked }: the projects of each area, in order.
// @param {object} move - An object with the following properties:
//   - {number} fromIndex - Where the project is now within its area
//   - {string} fromZone - A PAYOFF_RANKING_ZONES value
//   - {number|null} toIndex - Where it goes within the destination area; null puts it last
//   - {string} toZone - A PAYOFF_RANKING_ZONES value
// @returns {object} New { ranked, unranked } groups; the same groups when the move changes nothing or is out of range.
export function movedPayoffProject(groups, { fromIndex, fromZone, toIndex, toZone }) {
  const sourceProjects = groups[fromZone];
  if (!sourceProjects || !groups[toZone] || fromIndex < 0 || fromIndex >= sourceProjects.length) return groups;
  if (fromZone === toZone && (toIndex === fromIndex || (toIndex === null && fromIndex === sourceProjects.length - 1))) return groups;
  const remainingProjects = sourceProjects.filter((project, index) => index !== fromIndex);
  const destinationProjects = fromZone === toZone ? remainingProjects : [...groups[toZone]];
  const insertIndex = toIndex === null ? destinationProjects.length : Math.min(Math.max(toIndex, 0), destinationProjects.length);
  destinationProjects.splice(insertIndex, 0, sourceProjects[fromIndex]);
  return { ...groups, [fromZone]: remainingProjects, [toZone]: destinationProjects };
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
// @desc Scroll the nearest scrolling ancestor of an element when a drag is held near its top or bottom edge.
// @param {Element} element - The element under the pointer.
// @param {number} clientY - The pointer's vertical position in the viewport.
function scrollNearDragEdge(element, clientY) {
  let container = element instanceof Element ? element : null;
  while (container && !(container.scrollHeight > container.clientHeight && /(auto|scroll)/.test(getComputedStyle(container).overflowY))) {
    container = container.parentElement;
  }
  if (!container) return;
  const bounds = container.getBoundingClientRect();
  if (clientY < bounds.top + DRAG_SCROLL_EDGE_PIXELS) container.scrollTop -= DRAG_SCROLL_STEP_PIXELS;
  else if (clientY > bounds.bottom - DRAG_SCROLL_EDGE_PIXELS) container.scrollTop += DRAG_SCROLL_STEP_PIXELS;
}

// ----------------------------------------------------------------------------------------------
// @desc The class names of a chip, marking the one being dragged and the one a drag is over.
// @param {object} options - { baseClass, dragState, index, zone }.
// @returns {string} The class names.
function chipClassNames({ baseClass, dragState, index, zone }) {
  const dragging = dragState.dragging?.zone === zone && dragState.dragging.index === index;
  const draggedOver = !dragging && dragState.over?.zone === zone && dragState.over.index === index;
  const classNames = ["retrospective-payoff-chip", baseClass, dragging ? "retrospective-payoff-chip--dragging" : "",
    draggedOver ? "retrospective-payoff-chip--drag-over" : ""];
  return classNames.filter(Boolean).join(" ");
}

// ----------------------------------------------------------------------------------------------
// @desc One ranked project: its rank, its name, and buttons to move it up or down or back out of the ranking. The chip
//   can be dragged onto another to take its place, or back to the unranked area, unless the ranking is locked.
// @param {object} props - { dragHandlers, dragState, index, locked, onMove, project, rankedCount }.
// @returns {JSX.Element} The chip.
function RankedPayoffChip({ dragHandlers, dragState, index, locked, onMove, project, rankedCount }) {
  const zone = PAYOFF_RANKING_ZONES.ranked;
  const moveTo = (toIndex, toZone = zone) => onMove({ fromIndex: index, fromZone: zone, toIndex, toZone });
  return (
    <li className={ chipClassNames({ baseClass: "retrospective-payoff-chip--ranked", dragState, index, zone }) } draggable={ !locked }
      onDragEnd={ dragHandlers.onDragEnd } onDragOver={ event => dragHandlers.onDragOver(event, zone, index) }
      onDragStart={ event => dragHandlers.onDragStart(event, zone, index) } onDrop={ event => dragHandlers.onDrop(event, zone, index) }>
      <span className="retrospective-payoff-chip-rank">{ index + 1 }</span>
      <span className="retrospective-payoff-chip-name">{ project.name }</span>
      <button aria-label={ `Move ${ project.name } up` } className="retrospective-payoff-chip-move" disabled={ locked || index === 0 }
        onClick={ () => moveTo(index - 1) } title="Move up" type="button">↑</button>
      <button aria-label={ `Move ${ project.name } down` } className="retrospective-payoff-chip-move" disabled={ locked || index === rankedCount - 1 }
        onClick={ () => moveTo(index + 1) } title="Move down" type="button">↓</button>
      <button aria-label={ `Unrank ${ project.name }` } className="retrospective-payoff-chip-move" disabled={ locked }
        onClick={ () => moveTo(null, PAYOFF_RANKING_ZONES.unranked) } title="Back to unranked" type="button">×</button>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc One project not ranked yet: a pill with its name and a button that ranks it last. The pill can be dragged up
//   into the ranked list, unless the ranking is locked.
// @param {object} props - { dragHandlers, dragState, index, locked, onMove, project }.
// @returns {JSX.Element} The pill.
function UnrankedPayoffChip({ dragHandlers, dragState, index, locked, onMove, project }) {
  const zone = PAYOFF_RANKING_ZONES.unranked;
  return (
    <li className={ chipClassNames({ baseClass: "retrospective-payoff-chip--unranked", dragState, index, zone }) } draggable={ !locked }
      onDragEnd={ dragHandlers.onDragEnd } onDragOver={ event => dragHandlers.onDragOver(event, zone, index) }
      onDragStart={ event => dragHandlers.onDragStart(event, zone, index) } onDrop={ event => dragHandlers.onDrop(event, zone, index) }>
      <span className="retrospective-payoff-chip-name">{ project.name }</span>
      <button aria-label={ `Rank ${ project.name }` } className="retrospective-payoff-chip-move" disabled={ locked }
        onClick={ () => onMove({ fromIndex: index, fromZone: zone, toIndex: null, toZone: PAYOFF_RANKING_ZONES.ranked }) } title="Rank next"
        type="button">↑</button>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Drag-and-drop state for the two areas, built on HTML5 drag and drop as the dashboard layout popup is. A drop
//   on a chip takes that chip's place; a drop elsewhere in an area puts the project last there. While a chip is
//   dragged, a document-wide dragover listener scrolls the screen when the pointer nears its edge.
// @param {Function} onMove - Receives a movedPayoffProject move when a chip is dropped.
// @returns {object} { dragHandlers, dragState }: dragHandlers being { onDragEnd, onDragOver, onDragStart, onDrop }, each
//   taking (event, zone, index), index null for an area itself.
function usePayoffRankingDrag(onMove) {
  const draggedRef = useRef(null);
  const [dragState, setDragState] = useState({ dragging: null, over: null });
  const dragging = !!dragState.dragging;
  useEffect(() => {
    if (!dragging) return undefined;
    const scrollOnDrag = event => scrollNearDragEdge(event.target, event.clientY);
    document.addEventListener("dragover", scrollOnDrag);
    return () => document.removeEventListener("dragover", scrollOnDrag);
  }, [dragging]);
  const onDragEnd = () => {
    draggedRef.current = null;
    setDragState({ dragging: null, over: null });
  };
  const onDragStart = (event, zone, index) => {
    event.stopPropagation();
    draggedRef.current = { index, zone };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDragState({ dragging: { index, zone }, over: null });
  };
  const onDragOver = (event, zone, index) => {
    if (!draggedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragState(previous => (previous.over?.zone === zone && previous.over.index === index ? previous : { ...previous, over: { index, zone } }));
  };
  const onDrop = (event, zone, index) => {
    event.preventDefault();
    event.stopPropagation();
    const dragged = draggedRef.current;
    onDragEnd();
    if (dragged) onMove({ fromIndex: dragged.index, fromZone: dragged.zone, toIndex: index, toZone: zone });
  };
  return { dragHandlers: { onDragEnd, onDragOver, onDragStart, onDrop }, dragState };
}

// ----------------------------------------------------------------------------------------------
// @desc One area of the ranking, which takes a drop anywhere within it.
// @param {object} props - { children, className, dragHandlers, dragState, label, zone }.
// @returns {JSX.Element} The area.
function PayoffRankingZone({ children, className, dragHandlers, dragState, label, zone }) {
  const draggedOver = dragState.over?.zone === zone && dragState.over.index === null;
  return (
    <section className={ `retrospective-payoff-zone ${ className }${ draggedOver ? " retrospective-payoff-zone--drag-over" : "" }` }
      onDragOver={ event => dragHandlers.onDragOver(event, zone, null) } onDrop={ event => dragHandlers.onDrop(event, zone, null) }>
      <p className="retrospective-payoff-zone-label">{ label }</p>
      { children }
    </section>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The ranking: the prompt with a tooltip on how the ranking is used, the ranked list above the projects not
//   ranked yet, and the save and skip buttons. Saving needs at least one ranked project and stores only those. Any
//   change after a save marks the ranking unsaved again. A locked ranking takes no more changes and shows that the
//   user's progress was saved in place of its buttons.
// @param {object} props - An object with the following properties:
//   - {boolean} [locked] - Freezes the ranking once the caller has stored it
//   - {Function|null} [onRankingChange] - Receives the ranked projects after each move the user makes
//   - {Function} onSave - async (rankedProjects) => void; stores the order, the project that paid off most first
//   - {Function|null} [onSaved] - Called after a save succeeds, such as to move the story on
//   - {Function|null} [onSkip] - Leaves without saving; none hides the Skip button
//   - {Array<object>} projects - { derivedFrom, name, uuid } per project
//   - {object|null} [savedRanking] - The quarter's stored ranking, whose projects start in the ranked list
// @returns {JSX.Element} The ranking.
export default function RetrospectivePayoffRanking({ locked = false, onRankingChange = null, onSave, onSaved = null, onSkip = null, projects,
  savedRanking = null }) {
  const [groups, setGroups] = useState(() => {
    const { rankedProjects, unrankedProjects } = payoffRankingGroups(projects, savedRanking);
    return { ranked: rankedProjects, unranked: unrankedProjects };
  });
  const [saveState, setSaveState] = useState(PAYOFF_SAVE_STATES.unsaved);
  const [savedHere, setSavedHere] = useState(false);
  const movedRef = useRef(false);
  const rankedBefore = !!savedRanking || savedHere;

  useEffect(() => {
    if (movedRef.current && onRankingChange) onRankingChange(groups.ranked);
  }, [groups]);

  // @desc Move a project and mark the ranking as changed since the last save. A locked ranking ignores the move, such
  //   as a drop from a drag begun before it locked.
  const moveProject = move => {
    if (locked) return;
    movedRef.current = true;
    setGroups(previous => movedPayoffProject(previous, move));
    setSaveState(PAYOFF_SAVE_STATES.unsaved);
  };
  const { dragHandlers, dragState } = usePayoffRankingDrag(moveProject);
  // @desc Store the ranked projects, reporting a failure beside the button rather than losing the user's order.
  const handleSave = async () => {
    setSaveState(PAYOFF_SAVE_STATES.saving);
    try {
      await onSave(groups.ranked);
      setSaveState(PAYOFF_SAVE_STATES.saved);
      setSavedHere(true);
      if (onSaved) onSaved();
    } catch (error) {
      logIfEnabled("[retrospective-payoff-ranking] could not save the ranking", error?.message);
      setSaveState(PAYOFF_SAVE_STATES.failed);
    }
  };
  const chipProps = { dragHandlers, dragState, locked, onMove: moveProject };
  const saveBusy = saveState === PAYOFF_SAVE_STATES.saving || saveState === PAYOFF_SAVE_STATES.saved;
  const unrankedLabel = groups.ranked.length ? "Not ranked yet: drag up to rank, or leave out"
    : "Drag each project up, or tap its ↑, in the order it paid off";

  return (
    <div aria-disabled={ locked || undefined } className={ `retrospective-payoff-ranking${ locked ? " retrospective-payoff-ranking--locked" : "" }` }>
      <p className="retrospective-payoff-ranking-prompt">
        { PAYOFF_RANKING_PROMPT }{ " " }
        <DashboardTippy content={ PAYOFF_RANKING_TOOLTIP }>
          <span aria-label={ PAYOFF_RANKING_TOOLTIP } className="retrospective-payoff-ranking-info" role="img" tabIndex={ 0 }>ⓘ</span>
        </DashboardTippy>
      </p>
      <PayoffRankingZone className="retrospective-payoff-zone--ranked" dragHandlers={ dragHandlers } dragState={ dragState }
        label="Paid off most" zone={ PAYOFF_RANKING_ZONES.ranked }>
        { groups.ranked.length ? (
          <ol className="retrospective-payoff-ranking-list">
            { groups.ranked.map((project, index) => (
              <RankedPayoffChip { ...chipProps } index={ index } key={ project.uuid || project.name } project={ project }
                rankedCount={ groups.ranked.length } />
            )) }
          </ol>
        ) : <p className="retrospective-payoff-zone-empty">Drop projects here</p> }
      </PayoffRankingZone>
      { groups.unranked.length ? (
        <PayoffRankingZone className="retrospective-payoff-zone--unranked" dragHandlers={ dragHandlers } dragState={ dragState }
          label={ unrankedLabel } zone={ PAYOFF_RANKING_ZONES.unranked }>
          <ul className="retrospective-payoff-unranked-list">
            { groups.unranked.map((project, index) => (
              <UnrankedPayoffChip { ...chipProps } index={ index } key={ project.uuid || project.name } project={ project } />
            )) }
          </ul>
        </PayoffRankingZone>
      ) : null }
      { locked ? (
        <p className="retrospective-payoff-ranking-saved" role="status">{ PAYOFF_PROGRESS_SAVED_MESSAGE }</p>
      ) : (
        <div className="retrospective-payoff-ranking-actions">
          <button className="retrospective-options-primary" disabled={ saveBusy || !groups.ranked.length } onClick={ handleSave } type="button">
            { saveButtonLabel(saveState, rankedBefore) }
          </button>
          { onSkip ? <button className="retrospective-options-secondary" onClick={ onSkip } type="button">Skip</button> : null }
        </div>
      ) }
      { !locked && saveState === PAYOFF_SAVE_STATES.failed ? (
        <p className="retrospective-payoff-ranking-error" role="alert">Couldn't save the ranking. Try again.</p>
      ) : null }
    </div>
  );
}
