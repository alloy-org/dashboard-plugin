// Offer an accessible date editor for the agenda's calculation day.
import { useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Toggle a native date input from a pencil button and commit a valid local calendar date explicitly.
// @param {object} props - { dateValue, onSelectDate }.
// @returns {JSX.Element} Date edit control usable in the agenda's loaded, empty, and error states.
export default function ProposedAgendaDateControl({ dateValue, onSelectDate }) {
  const [editing, setEditing] = useState(false);
  const [draftDate, setDraftDate] = useState(dateValue);
  // ----------------------------------------------------------------------------------------------
  // @desc Commit the native input's validated value without submitting a parent form.
  // @param {Event} event - Date form submit event.
  const onSubmit = event => {
    event.preventDefault();
    if (!draftDate) return;
    setEditing(false);
    onSelectDate(draftDate);
  };
  return <div className="proposed-agenda-date-control">
    <button aria-expanded={ editing } aria-label="Change agenda date" className="proposed-agenda-date-edit"
      onClick={ () => { setDraftDate(dateValue); setEditing(value => !value); } } title="Change agenda date" type="button">✎</button>
    { editing ? <form onSubmit={ onSubmit }>
      <label>Agenda date <input autoFocus onChange={ event => setDraftDate(event.target.value) } required type="date" value={ draftDate } /></label>
      <button type="submit">Open agenda</button>
      <button onClick={ () => setEditing(false) } type="button">Cancel</button>
    </form> : null }
  </div>;
}
