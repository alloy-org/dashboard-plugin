// Navigate agenda days and choose dates from an anchored month calendar.
import ProposedAgendaPopover from "proposed-agenda-popover";
import { useCallback, useRef, useState } from "react";
import { calendarEventDateFromValue } from "util/calendar-utility";
import { dateFromDateInput, dateKeyFromDateInput, monthGridCellsFromDateInput } from "util/date-utility";

// ----------------------------------------------------------------------------------------------
// @desc Render a month grid, quick dates, real calendar event markers, and an exact-date entry form.
// @param {object} props - { calendarEvents, dateValue, onSelectDate, savedDates }.
// @returns {JSX.Element} Calendar contents for the date popout.
function AgendaCalendar({ calendarEvents, dateValue, onSelectDate, savedDates }) {
  const selected = dateFromDateInput(dateValue);
  const [month, setMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const [draftDate, setDraftDate] = useState(dateValue);
  const today = new Date();
  const todayKey = dateKeyFromDateInput(today);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((8 - today.getDay()) % 7 || 7));
  const eventCounts = {};
  for (const event of calendarEvents || []) {
    const start = calendarEventDateFromValue(event?.start);
    if (!start || event.allDay) continue;
    const key = dateKeyFromDateInput(start);
    eventCounts[key] = (eventCounts[key] || 0) + 1;
  }
  const meetings = eventCounts[dateValue] || 0;
  // ------------------------------------------------------------------------------------------
  // @desc Submit a validated local date without submitting a surrounding form.
  const onSubmit = event => {
    event.preventDefault();
    if (draftDate) onSelectDate(draftDate);
  };
  return <>
    <div className="agenda-calendar-shortcuts">
      { [["Today", today], ["Tomorrow", tomorrow], ["Monday", monday]].map(([label, date]) =>
        <button key={ label } onClick={ () => onSelectDate(dateKeyFromDateInput(date)) } type="button">{ label }</button>) }
    </div>
    <div className="agenda-calendar-heading">
      <strong aria-live="polite">{ month.toLocaleDateString([], { month: "long", year: "numeric" }) }</strong>
      <button aria-label="Previous month" className="agenda-calendar-month-arrow"
        onClick={ () => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)) } type="button">‹</button>
      <button aria-label="Next month" className="agenda-calendar-month-arrow"
        onClick={ () => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)) } type="button">›</button>
    </div>
    <div className="agenda-calendar-grid">
      { ["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span className="agenda-calendar-weekday" key={ index }>{ day }</span>) }
      { monthGridCellsFromDateInput(month).map((date, index) => {
        if (!date) return <span key={ `blank-${ index }` } />;
        const key = dateKeyFromDateInput(date);
        return <button aria-current={ key === todayKey ? "date" : undefined }
          aria-label={ date.toLocaleDateString([], { day: "numeric", month: "long", weekday: "long", year: "numeric" }) }
          aria-pressed={ key === dateValue } className="agenda-calendar-day" key={ key } onClick={ () => onSelectDate(key) } type="button">
          { date.getDate() }<span className="agenda-calendar-markers">
            { savedDates.includes(key) ? <i className="agenda-calendar-saved" /> : null }
            { eventCounts[key] >= 3 ? <i className="agenda-calendar-busy" /> : null }
          </span>
        </button>;
      }) }
    </div>
    <div className="agenda-calendar-legend"><span><i className="agenda-calendar-saved" />agenda saved</span>
      <span><i className="agenda-calendar-busy" />3+ meetings</span></div>
    <div className="agenda-calendar-summary">
      <strong>{ selected.toLocaleDateString([], { day: "numeric", month: "long", weekday: "long" }) }</strong>
      <p>{ meetings ? `${ meetings } ${ meetings === 1 ? "meeting" : "meetings" } already booked. Suggestions will fit around them.`
        : "Choose a day to plan your agenda." }</p>
      <form onSubmit={ onSubmit }><label>Jump to date <input onChange={ event => setDraftDate(event.target.value) }
        required type="date" value={ draftDate } /></label><button type="submit">Open agenda</button></form>
    </div>
  </>;
}

// ----------------------------------------------------------------------------------------------
// @desc Show the selected agenda day, previous/next navigation, relative date, and a calendar popout.
// @param {object} props - { calendarEvents, dateLabel, dateValue, onSelectDate, savedDates }.
// @returns {JSX.Element} Date controls available in loaded, loading, and error states.
export default function ProposedAgendaDateControl({ calendarEvents = [], dateLabel, dateValue, onSelectDate, savedDates = [] }) {
  const [editing, setEditing] = useState(false);
  const anchorRef = useRef(null);
  const close = useCallback(() => setEditing(false), []);
  const date = dateFromDateInput(dateValue);
  const today = new Date();
  const offset = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const relativeLabel = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday"
    : offset > 0 ? `in ${ offset } days` : `${ -offset } days ago`;
  const label = dateLabel?.includes(" – ") ? dateLabel : date.toLocaleDateString([], { day: "numeric", month: "long", weekday: "long" });
  // ------------------------------------------------------------------------------------------
  // @desc Close the popout before asking the widget to load the chosen date.
  const selectDate = value => { setEditing(false); onSelectDate(value); };
  // ------------------------------------------------------------------------------------------
  // @desc Move by local calendar days, preserving midnight across daylight-saving transitions.
  const shiftDate = amount => selectDate(dateKeyFromDateInput(new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)));
  return <div className="proposed-agenda-date-control">
    <button aria-label="Previous agenda day" className="proposed-agenda-day-arrow" onClick={ () => shiftDate(-1) } type="button">‹</button>
    <button aria-expanded={ editing } aria-haspopup="dialog" aria-label="Change agenda date" className="proposed-agenda-date-edit"
      onClick={ () => setEditing(value => !value) } ref={ anchorRef } type="button">{ label }<span aria-hidden="true">⌄</span></button>
    <button aria-label="Next agenda day" className="proposed-agenda-day-arrow" onClick={ () => shiftDate(1) } type="button">›</button>
    <span className="proposed-agenda-relative-date">{ relativeLabel }</span>
    { offset !== 0 ? <button className="proposed-agenda-today" onClick={ () => selectDate(dateKeyFromDateInput(today)) }
      type="button">Back to today</button> : null }
    { editing ? <ProposedAgendaPopover anchorRef={ anchorRef } label="Choose agenda date" onClose={ close }>
      <AgendaCalendar calendarEvents={ calendarEvents } dateValue={ dateValue } onSelectDate={ selectDate } savedDates={ savedDates } />
    </ProposedAgendaPopover> : null }
  </div>;
}
