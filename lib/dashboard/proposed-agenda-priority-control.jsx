// Present agenda priorities with explanations and an optional custom day description.
import { Button, PlainButton, TextField } from "dashboard/controls";
import ProposedAgendaPopover from "proposed-agenda-popover";
import { CUSTOM_PRIORITY_PREFIX, MAX_CUSTOM_PRIORITY_LENGTH, priorityOptionFromKey,
  PROPOSED_AGENDA_PRIORITY_OPTIONS } from "proposed-agenda-priority";
import { useCallback, useRef, useState } from "react";
import { MdCheck, MdExpandMore, MdTrackChanges } from "react-icons/md";
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
      <PlainButton aria-expanded={ open } aria-haspopup="dialog" aria-label="Change agenda priority"
        className="proposed-agenda-priority-select" onClick={ () => setOpen(value => !value) } ref={ anchorRef }>
        <MdTrackChanges />{ selected.displayLabel || selected.label }<MdExpandMore />
      </PlainButton>
      <span className="proposed-agenda-priority-description">{ selected.description }</span>
      { open ? <ProposedAgendaPopover anchorRef={ anchorRef } label="Choose agenda priority" onClose={ close }>
        <h3 className="agenda-priority-heading">What should { weekday } serve?</h3>
        <div className="agenda-priority-options">
          { PROPOSED_AGENDA_PRIORITY_OPTIONS.map(option => <PlainButton aria-pressed={ priorityKey === option.key }
            className="agenda-priority-option" key={ option.key } onClick={ () => selectPriority(option.key) }>
            <span aria-hidden="true" className="agenda-priority-check"><MdCheck size={ 16 } /></span>
            <span><strong>{ option.displayLabel || option.label }</strong><small>{ option.description }</small></span>
          </PlainButton>) }
        </div>
        <form className="agenda-priority-custom" onSubmit={ onSubmit }>
          <div className="agenda-priority-custom-row">
            <TextField className="agenda-priority-custom-field" label="Or describe the day in a sentence"
              maxLength={ MAX_CUSTOM_PRIORITY_LENGTH } onChange={ setDescription } placeholder="Protect the morning, ship the spec"
              value={ description } />
            <Button dense disabled={ !description.trim() } type="submit" variant="raised">Use</Button>
          </div>
          <p>Your priority is remembered for future agendas.</p>
        </form>
      </ProposedAgendaPopover> : null }
    </div>
  );
}
