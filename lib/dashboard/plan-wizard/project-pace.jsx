// One project's pace card: which rhythm to protect, which weekdays that rhythm occupies, and a deadline when
// the chosen rhythm is a sprint.

import { PACE_OPTIONS, PACE_WORKDAYS, paceHintText, weekdayLabel } from "dashboard/plan-wizard/pace-cards-step-fields";
import { memo } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Render one project's pace choices without forcing sibling cards to redraw.
// @param {object} params - An object with the following properties:
//   - {object} draft - Per-project pace draft.
//   - {boolean} isDisabled - Whether a page-level save prevents editing.
//   - {Function} onChangeDeadline - Receives the project UUID and YYYY-MM-DD deadline.
//   - {Function} onSelectPace - Receives the project UUID and selected paceEm.
//   - {Function} onToggleWeekday - Receives the project UUID and weekday enum.
// @returns {JSX.Element} The project's pace card.
function ProjectPace({ draft, isDisabled, onChangeDeadline, onSelectPace, onToggleWeekday }) {
  const hintText = paceHintText(draft);
  return (
    <article className="project-pace">
      <h3 className="project-pace-title">{ draft.summary }</h3>
      <div aria-label={ `Pace for ${ draft.summary }` } className="project-pace-options">
        { PACE_OPTIONS.map(option => (
          <button aria-pressed={ draft.paceEm === option.value }
            className={ `project-pace-choice${ draft.paceEm === option.value ? " project-pace-choice--selected" : "" }` }
            disabled={ isDisabled } key={ option.value } onClick={ () => onSelectPace(draft.uuid, option.value) }
            type="button">
            { option.label }
          </button>
        )) }
      </div>
      { draft.paceEm === "deadlineSprint" ? (
        <label className="project-pace-deadline">
          Deadline
          <input className="project-pace-deadline-input" disabled={ isDisabled }
            onChange={ event => onChangeDeadline(draft.uuid, event.target.value || null) } type="date"
            value={ draft.deadlineOn ?? "" } />
        </label>
      ) : null }
      <div aria-label={ `Preferred days for ${ draft.summary }` } className="project-pace-days">
        { PACE_WORKDAYS.map(weekday => {
          const isSelected = draft.preferredWeekdays.includes(weekday);
          return (
            <button aria-pressed={ isSelected } className="project-pace-day" disabled={ isDisabled } key={ weekday }
              onClick={ () => onToggleWeekday(draft.uuid, weekday) } type="button">
              { weekdayLabel(weekday).slice(0, 3) }
            </button>
          );
        }) }
      </div>
      <p className="project-pace-hint">{ hintText }</p>
    </article>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Compare only props capable of changing a rendered card, allowing sibling projects to retain their render.
// @param {object} previous - Previous ProjectPace props.
// @param {object} next - Next ProjectPace props.
// @returns {boolean} Whether React can skip rendering this card.
export function projectPacePropsEqual(previous, next) {
  const previousDraft = previous.draft;
  const nextDraft = next.draft;
  return previous.isDisabled === next.isDisabled && previous.onChangeDeadline === next.onChangeDeadline
    && previous.onSelectPace === next.onSelectPace && previous.onToggleWeekday === next.onToggleWeekday
    && previousDraft.deadlineOn === nextDraft.deadlineOn && previousDraft.paceEm === nextDraft.paceEm
    && previousDraft.summary === nextDraft.summary && previousDraft.uuid === nextDraft.uuid
    && previousDraft.preferredWeekdays.join(" ") === nextDraft.preferredWeekdays.join(" ");
}

export default memo(ProjectPace, projectPacePropsEqual);
