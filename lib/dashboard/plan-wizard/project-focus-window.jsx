// One project's focus window on the Name the quarter timeline: a labeled range along the quarter's months, with
// two thumbs so the user can drag when that work should concentrate.

import { deadlineNoteFromDraft, dayOffsetFromDateKey, updatedWindowDraft } from "dashboard/plan-wizard/quarter-name-step-fields";
import { memo } from "react";

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
  const startDay = dayOffsetFromDateKey(draft.startOn, quarterStartOn);
  const endDay = dayOffsetFromDateKey(draft.endOn, quarterStartOn);
  const startPercent = maxDay === 0 ? 0 : startDay * 100 / maxDay;
  const endPercent = maxDay === 0 ? 100 : endDay * 100 / maxDay;
  const deadlineNote = deadlineNoteFromDraft(draft);
  const axis = { quarterEndOn, quarterMonths, quarterStartOn };

  // ----------------------------------------------------------------------------------------------
  // @desc Apply a thumb's new day offset while keeping the opposite edge and the deadline clamp.
  // @param {string} edge - "start" or "end".
  // @param {string} value - Range input value, a day offset along the quarter.
  const handleEdgeChange = (edge, value) => {
    const nextDay = Number(value);
    const nextStartDay = edge === "start" ? nextDay : startDay;
    const nextEndDay = edge === "end" ? nextDay : endDay;
    onChangeWindow(updatedWindowDraft(draft, { ...axis, endDay: nextEndDay, startDay: nextStartDay }));
  };

  const barStyle = { left: startPercent + "%", width: Math.max(endPercent - startPercent, 2) + "%" };

  return (
    <div className="quarter-name-window">
      <p className="quarter-name-window-label">{ draft.summary }</p>
      <div className="quarter-name-window-track">
        <div className={ `quarter-name-bar quarter-name-bar--${ draft.colorIndex }` } style={ barStyle }>
          <span aria-hidden="true" className="quarter-name-bar-handle">‹</span>
          <span aria-hidden="true" className="quarter-name-bar-handle">›</span>
        </div>
        <input aria-label={ `Start of ${ draft.summary }` } className="quarter-name-window-start" disabled={ isDisabled }
          max={ maxDay } min={ 0 } onChange={ event => handleEdgeChange("start", event.target.value) } type="range"
          value={ startDay } />
        <input aria-label={ `End of ${ draft.summary }` } className="quarter-name-window-end" disabled={ isDisabled }
          max={ maxDay } min={ 0 } onChange={ event => handleEdgeChange("end", event.target.value) } type="range"
          value={ endDay } />
      </div>
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
    && previousDraft.summary === nextDraft.summary && previousDraft.uuid === nextDraft.uuid;
}

export default memo(ProjectFocusWindow, projectFocusWindowPropsEqual);
