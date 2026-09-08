// One project's optional focus window on the Name the quarter timeline: click an empty month to place it, drag
// near either edge to resize it, or drag its middle to move the whole range.

import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import { FOCUS_WINDOW_EDGE_HIT_PIXELS, dayOffsetFromPointer, monthIndexFromPointer, movedWindowDraft,
  pointerOperationFromPosition, projectTooltipHtmlFromDraft, removedWindowDraft,
  windowDraftFromMonthIndex } from "dashboard/plan-wizard/project-focus-window-fields";
import { dayOffsetFromDateKey, deadlineNoteFromDraft,
  updatedWindowDraft } from "dashboard/plan-wizard/quarter-name-step-fields";
import { memo, useRef, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Render one project's bar on the shared month axis, converting thumb movement into a clamped window.
// @param {object} params - An object with the following properties:
//   - {object} draft - Per-project window draft.
//   - {boolean} isDisabled - Whether a page-level save prevents editing.
//   - {Function} onChangeWindow - Receives the updated draft after a thumb moves.
//   - {string} quarterEndOn - Last YYYY-MM-DD day of the quarter.
//   - {Array<string>} quarterMonths - YYYY-MM labels shown as the axis.
//   - {string} quarterStartOn - First YYYY-MM-DD day of the quarter.
// @returns {JSX.Element} The project's timeline row.
function ProjectFocusWindow({ draft, isDisabled, onChangeWindow, quarterEndOn, quarterMonths, quarterStartOn }) {
  const maxDay = dayOffsetFromDateKey(quarterEndOn, quarterStartOn);
  const hasWindow = Boolean(draft.startOn && draft.endOn);
  const startDay = hasWindow ? dayOffsetFromDateKey(draft.startOn, quarterStartOn) : 0;
  const endDay = hasWindow ? dayOffsetFromDateKey(draft.endOn, quarterStartOn) : maxDay;
  const startPercent = maxDay === 0 ? 0 : startDay * 100 / maxDay;
  const endPercent = maxDay === 0 ? 100 : endDay * 100 / maxDay;
  const deadlineNote = hasWindow ? deadlineNoteFromDraft(draft) : null;
  const axis = { quarterEndOn, quarterMonths, quarterStartOn };
  const dragOperationRef = useRef(null);
  const [pulseVersion, setPulseVersion] = useState(0);
  const tooltipHtml = projectTooltipHtmlFromDraft(draft);

  // ----------------------------------------------------------------------------------------------
  // @desc Apply a keyboard-operated range thumb while keeping the opposite edge and the deadline clamp.
  // @param {string} edge - "start" or "end".
  // @param {string} value - Range input value, a day offset along the quarter.
  const handleEdgeChange = (edge, value) => {
    const nextDay = Number(value);
    const nextStartDay = edge === "start" ? nextDay : startDay;
    const nextEndDay = edge === "end" ? nextDay : endDay;
    onChangeWindow(updatedWindowDraft(draft, { ...axis, endDay: nextEndDay, startDay: nextStartDay }));
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Begin a resize or whole-bar move, or place an absent window across the clicked month.
  // @param {object} event - React pointer event from the shared track.
  const handlePointerDown = event => {
    if (isDisabled) return;
    const trackBounds = event.currentTarget.getBoundingClientRect();
    const pointerDay = dayOffsetFromPointer(event.clientX, maxDay, trackBounds);
    if (!hasWindow) {
      const monthIndex = monthIndexFromPointer(event.clientX, quarterMonths.length, trackBounds);
      onChangeWindow(windowDraftFromMonthIndex(draft, { ...axis, monthIndex }));
      dragOperationRef.current = { didChange: true, kind: "create", pointerId: event.pointerId };
    } else {
      const kind = pointerOperationFromPosition({ clientX: event.clientX,
        edgeHitPixels: FOCUS_WINDOW_EDGE_HIT_PIXELS, endDay, maxDay, startDay, trackBounds });
      if (!kind) return;
      dragOperationRef.current = { didChange: false, draft, kind, pointerDay, pointerId: event.pointerId };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Update the active resize or move from pointer travel while preserving the drag's original dimensions.
  // @param {object} event - React pointer event from the shared track.
  const handlePointerMove = event => {
    const operation = dragOperationRef.current;
    if (!operation || operation.kind === "create") return;
    const pointerDay = dayOffsetFromPointer(event.clientX, maxDay, event.currentTarget.getBoundingClientRect());
    let nextDraft = null;
    if (operation.kind === "move") {
      nextDraft = movedWindowDraft(operation.draft, { ...axis, dayDelta: pointerDay - operation.pointerDay });
    } else {
      const originalStartDay = dayOffsetFromDateKey(operation.draft.startOn, quarterStartOn);
      const originalEndDay = dayOffsetFromDateKey(operation.draft.endOn, quarterStartOn);
      const startDayValue = operation.kind === "resize-start" ? pointerDay : originalStartDay;
      const endDayValue = operation.kind === "resize-end" ? pointerDay : originalEndDay;
      nextDraft = updatedWindowDraft(operation.draft, { ...axis, endDay: endDayValue, startDay: startDayValue });
    }
    operation.didChange = true;
    onChangeWindow(nextDraft);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc End a pointer edit and restart the applied-result pulse on the resulting bar.
  // @param {object} event - React pointer event from the shared track.
  const handlePointerUp = event => {
    const operation = dragOperationRef.current;
    if (!operation) return;
    event.currentTarget.releasePointerCapture?.(operation.pointerId);
    dragOperationRef.current = null;
    if (operation.didChange) setPulseVersion(version => version + 1);
  };

  const barStyle = { left: startPercent + "%", width: Math.max(endPercent - startPercent, 2) + "%" };

  return (
    <div className="quarter-name-window">
      <div className="quarter-name-window-label-cell">
        <DashboardTippy content={ tooltipHtml } delay={ 0 } placement="right">
          <span className="quarter-name-window-label" tabIndex={ 0 }>{ draft.summary }</span>
        </DashboardTippy>
      </div>
      <div aria-label={ hasWindow ? `Focus window for ${ draft.summary }` : `Place ${ draft.summary } in a month` }
        className={ `quarter-name-window-track${ hasWindow ? "" : " quarter-name-window-track--empty" }` }
        onPointerCancel={ handlePointerUp } onPointerDown={ handlePointerDown } onPointerMove={ handlePointerMove }
        onPointerUp={ handlePointerUp }>
        { hasWindow ? (
          <>
            <div className={ `quarter-name-bar quarter-name-bar--${ draft.colorIndex }${ pulseVersion
              ? " quarter-name-bar--pulse" : "" }` } key={ pulseVersion } style={ barStyle }>
              <span aria-hidden="true" className="quarter-name-bar-handle">‹</span>
              <span aria-hidden="true" className="quarter-name-bar-handle">›</span>
              <span aria-hidden="true" className="quarter-name-bar-end-hit" />
            </div>
            <input aria-label={ `Start of ${ draft.summary }` } className="quarter-name-window-start"
              disabled={ isDisabled } max={ maxDay } min={ 0 }
              onChange={ event => handleEdgeChange("start", event.target.value) }
              onKeyUp={ () => setPulseVersion(version => version + 1) } type="range" value={ startDay } />
            <input aria-label={ `End of ${ draft.summary }` } className="quarter-name-window-end"
              disabled={ isDisabled } max={ maxDay } min={ 0 }
              onChange={ event => handleEdgeChange("end", event.target.value) }
              onKeyUp={ () => setPulseVersion(version => version + 1) } type="range" value={ endDay } />
          </>
        ) : null }
      </div>
      { hasWindow ? (
        <button aria-label={ `Remove focus window for ${ draft.summary }` } className="quarter-name-window-remove"
          disabled={ isDisabled } onClick={ () => onChangeWindow(removedWindowDraft(draft)) }
          title="Remove this date range" type="button">×</button>
      ) : <span aria-hidden="true" className="quarter-name-window-remove-spacer" /> }
      { deadlineNote ? <p className="quarter-name-deadline-note">{ deadlineNote }</p> : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Compare only props capable of changing a rendered row, allowing sibling projects to retain their render.
// @param {object} previous - Previous ProjectFocusWindow props.
// @param {object} next - Next ProjectFocusWindow props.
// @returns {boolean} Whether React can skip rendering this row.
export function projectFocusWindowPropsEqual(previous, next) {
  const previousDraft = previous.draft;
  const nextDraft = next.draft;
  return previous.isDisabled === next.isDisabled && previous.onChangeWindow === next.onChangeWindow
    && previous.quarterEndOn === next.quarterEndOn && previous.quarterStartOn === next.quarterStartOn
    && previousDraft.colorIndex === nextDraft.colorIndex && previousDraft.deadlineOn === nextDraft.deadlineOn
    && previousDraft.endOn === nextDraft.endOn && previousDraft.startOn === nextDraft.startOn
    && previousDraft.paceEm === nextDraft.paceEm
    && (previousDraft.preferredWeekdays ?? []).join(",") === (nextDraft.preferredWeekdays ?? []).join(",")
    && previousDraft.priorityEm === nextDraft.priorityEm
    && (previousDraft.substantiations ?? []).join("\n") === (nextDraft.substantiations ?? []).join("\n")
    && previousDraft.summary === nextDraft.summary && previousDraft.userCategoryEm === nextDraft.userCategoryEm
    && previousDraft.uuid === nextDraft.uuid;
}

export default memo(ProjectFocusWindow, projectFocusWindowPropsEqual);
