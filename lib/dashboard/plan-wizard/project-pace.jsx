// One project's pace card: which rhythm to protect, which weekdays that rhythm occupies, and a deadline when
// the chosen rhythm is a sprint.

import { PlainButton, TextField } from "dashboard/controls";
import { PACE_OPTIONS, PACE_WORKDAYS, weekdayLabel } from "dashboard/plan-wizard/pace-cards-step-fields";
import { memo } from "react";

const PREFERRED_DAYS_LABEL = "Preferred days of week (optional)";

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
  return (
    <article className="project-pace">
      <h3 className="project-pace-title">{ draft.summary }</h3>
      <div aria-label={ `Pace for ${ draft.summary }` } className="project-pace-options">
        { PACE_OPTIONS.map(option => (
          <PlainButton aria-pressed={ draft.paceEm === option.value }
            className={ `project-pace-choice${ draft.paceEm === option.value ? " project-pace-choice--selected" : "" }` }
            disabled={ isDisabled } key={ option.value }
            onClick={ () => onSelectPace(draft.uuid, option.value) }>
            { option.label }
          </PlainButton>
        )) }
      </div>
      { draft.paceEm === "deadlineSprint" ? (
        <TextField className="project-pace-deadline" disabled={ isDisabled }
          inputClassName="project-pace-deadline-input" label="Deadline"
          onChange={ text => onChangeDeadline(draft.uuid, text || null) } type="date"
          value={ draft.deadlineOn ?? "" } />
      ) : null }
      <div aria-label={ `${ PREFERRED_DAYS_LABEL } for ${ draft.summary }` } className="project-pace-days">
        <span className="project-pace-days-label">{ PREFERRED_DAYS_LABEL }</span>
        { PACE_WORKDAYS.map(weekday => {
          const isSelected = draft.preferredWeekdays.includes(weekday);
          return (
            <PlainButton aria-pressed={ isSelected } className="project-pace-day" disabled={ isDisabled }
              key={ weekday } onClick={ () => onToggleWeekday(draft.uuid, weekday) }>
              { weekdayLabel(weekday).slice(0, 3) }
            </PlainButton>
          );
        }) }
      </div>
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
