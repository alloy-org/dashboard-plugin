// Present agenda priorities with explanations and an optional custom day description.
import ProposedAgendaPopover from "proposed-agenda-popover";
import { CUSTOM_PRIORITY_PREFIX, MAX_CUSTOM_PRIORITY_LENGTH, priorityOptionFromKey,
  PROPOSED_AGENDA_PRIORITY_OPTIONS } from "proposed-agenda-priority";
import { useCallback, useRef, useState } from "react";
import { dateFromDateInput } from "util/date-utility";

// ----------------------------------------------------------------------------------------------
// @desc Render the priority pill and choice dialog, reserving intrinsic checkmark space for aligned options.
// @param {object} props - { dateValue, onPriorityChange, priorityKey }.
// @returns {JSX.Element} Priority control and explanation.
export default function ProposedAgendaPriorityControl({ dateValue, onPriorityChange, priorityKey }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const initialDescription = priorityKey.startsWith(CUSTOM_PRIORITY_PREFIX) ? priorityKey.slice(CUSTOM_PRIORITY_PREFIX.length) : "";
  const [description, setDescription] = useState(initialDescription);
  const close = useCallback(() => setOpen(false), []);
  const selected = priorityOptionFromKey(priorityKey);
  const weekday = dateFromDateInput(dateValue).toLocaleDateString([], { weekday: "long" });
  // ------------------------------------------------------------------------------------------
  // @desc Commit a built-in or custom priority using the widget's existing persistence callback.
  const selectPriority = key => { setOpen(false); onPriorityChange({ target: { value: key } }); };
  // ------------------------------------------------------------------------------------------
  // @desc Ignore whitespace-only custom priorities and submit the bounded description.
  const onSubmit = event => {
    event.preventDefault();
    if (description.trim()) selectPriority(`${ CUSTOM_PRIORITY_PREFIX }${ description.trim() }`);
  };
  return (
    <div className="proposed-agenda-controls">
      <span className="proposed-agenda-priority-label">Priority</span>
      <button aria-expanded={ open } aria-haspopup="dialog" aria-label="Change agenda priority" className="proposed-agenda-priority-select"
        onClick={ () => setOpen(value => !value) } ref={ anchorRef } type="button">
        <span aria-hidden="true">◎</span>{ selected.displayLabel || selected.label }<span aria-hidden="true">⌄</span>
      </button>
      <span className="proposed-agenda-priority-description">{ selected.description }</span>
      { open ? <ProposedAgendaPopover anchorRef={ anchorRef } label="Choose agenda priority" onClose={ close }>
        <h3 className="agenda-priority-heading">What should { weekday } serve?</h3>
        <div className="agenda-priority-options">
          { PROPOSED_AGENDA_PRIORITY_OPTIONS.map(option => <button aria-pressed={ priorityKey === option.key }
            className="agenda-priority-option" key={ option.key } onClick={ () => selectPriority(option.key) } type="button">
            <span aria-hidden="true" className="agenda-priority-check">✓</span>
            <span><strong>{ option.displayLabel || option.label }</strong><small>{ option.description }</small></span>
          </button>) }
        </div>
        <form className="agenda-priority-custom" onSubmit={ onSubmit }>
          <label htmlFor="agenda-priority-description">Or describe the day in a sentence</label>
          <div><input id="agenda-priority-description" maxLength={ MAX_CUSTOM_PRIORITY_LENGTH }
            onChange={ event => setDescription(event.target.value) }
            placeholder="Protect the morning, ship the spec" value={ description } />
            <button disabled={ !description.trim() } type="submit">Use</button></div>
          <p>Your priority is remembered for future agendas.</p>
        </form>
      </ProposedAgendaPopover> : null }
    </div>
  );
}
