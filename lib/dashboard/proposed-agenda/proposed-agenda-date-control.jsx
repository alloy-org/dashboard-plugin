// Navigate agenda days and choose dates from an anchored month calendar.
import { Button, IconButton, PlainButton, TextField } from "dashboard/controls";
import ProposedAgendaPopover from "dashboard/proposed-agenda/proposed-agenda-popover";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MdChevronLeft, MdChevronRight, MdExpandMore } from "react-icons/md";
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
        <Button dense key={ label } onClick={ () => onSelectDate(dateKeyFromDateInput(date)) } variant="outlined">{ label }</Button>) }
    </div>
    <div className="agenda-calendar-heading">
      <strong aria-live="polite">{ month.toLocaleDateString([], { month: "long", year: "numeric" }) }</strong>
      <IconButton className="agenda-calendar-month-arrow" Icon={ MdChevronLeft } label="Previous month"
        onClick={ () => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)) } size="small" />
      <IconButton className="agenda-calendar-month-arrow" Icon={ MdChevronRight } label="Next month"
        onClick={ () => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)) } size="small" />
    </div>
    <div className="agenda-calendar-grid">
      { ["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span className="agenda-calendar-weekday" key={ index }>{ day }</span>) }
      { monthGridCellsFromDateInput(month).map((date, index) => {
        if (!date) return <span key={ `blank-${ index }` } />;
        const key = dateKeyFromDateInput(date);
        return <PlainButton aria-current={ key === todayKey ? "date" : undefined }
          aria-label={ date.toLocaleDateString([], { day: "numeric", month: "long", weekday: "long", year: "numeric" }) }
          aria-pressed={ key === dateValue } className="agenda-calendar-day" key={ key } onClick={ () => onSelectDate(key) }>
          { date.getDate() }<span className="agenda-calendar-markers">
            { savedDates.includes(key) ? <i className="agenda-calendar-saved" /> : null }
            { eventCounts[key] >= 3 ? <i className="agenda-calendar-busy" /> : null }
          </span>
        </PlainButton>;
      }) }
    </div>
    <div className="agenda-calendar-legend"><span><i className="agenda-calendar-saved" />agenda saved</span>
      <span><i className="agenda-calendar-busy" />3+ meetings</span></div>
    <div className="agenda-calendar-summary">
      <strong>{ selected.toLocaleDateString([], { day: "numeric", month: "long", weekday: "long" }) }</strong>
      <p>{ meetings ? `${ meetings } ${ meetings === 1 ? "meeting" : "meetings" } already booked. Suggestions will fit around them.`
        : "Choose a day to plan your agenda." }</p>
      <form onSubmit={ onSubmit }>
        <TextField className="agenda-calendar-jump" label="Jump to date" onChange={ setDraftDate } required type="date"
          value={ draftDate } />
        <Button dense type="submit" variant="outlined">Open agenda</Button>
      </form>
    </div>
  </>;
}

// Progressively shorter date formats, tried in order until the label fits beside its arrows on one line.
const DATE_LABEL_FORMATS = [
  { day: "numeric", month: "long", weekday: "long" },
  { day: "numeric", month: "long", weekday: "short" },
  { day: "numeric", month: "long" },
  { day: "numeric", month: "short" },
];

// ----------------------------------------------------------------------------------------------
// @desc Choose the longest date label that fits its button without wrapping. Each width change of the surrounding
//   row restarts at the full label, then layout effects step down one format per pass before the browser paints.
// @param {string[]} labels - Candidate labels ordered longest first.
// @param {object} labelRef - Ref to the nowrap label text, whose overflow signals that a label is too long.
// @param {object} controlRef - Ref to the date control; its parent row is watched for width changes.
// @returns {string} The label to render.
function useFittingDateLabel(labels, labelRef, controlRef) {
  const [labelIndex, setLabelIndex] = useState(0);
  const labelsKey = labels.join("|");
  useLayoutEffect(() => setLabelIndex(0), [labelsKey]);
  useLayoutEffect(() => {
    const labelElement = labelRef.current;
    if (!labelElement || labelIndex >= labels.length - 1) return;
    if (labelElement.scrollWidth > labelElement.clientWidth) setLabelIndex(labelIndex + 1);
  });
  useEffect(() => {
    const rowElement = controlRef.current?.parentElement;
    if (!rowElement || typeof ResizeObserver === "undefined") return undefined;
    let observedWidth = rowElement.clientWidth;
    const rowObserver = new ResizeObserver(() => {
      if (rowElement.clientWidth === observedWidth) return;
      observedWidth = rowElement.clientWidth;
      setLabelIndex(0);
    });
    rowObserver.observe(rowElement);
    return () => rowObserver.disconnect();
  }, [controlRef]);
  return labels[Math.min(labelIndex, labels.length - 1)];
}

// ----------------------------------------------------------------------------------------------
// @desc Show the selected agenda day, previous/next navigation, relative date, and a calendar popout.
// @param {object} props - { calendarEvents, dateLabel, dateValue, onSelectDate, savedDates }.
// @returns {JSX.Element} Date controls available in loaded, loading, and error states, followed by a "Back to today"
//   button that the overview places on its own line beneath the date and priority row.
export default function ProposedAgendaDateControl({ calendarEvents = [], dateLabel, dateValue, onSelectDate, savedDates = [] }) {
  const [editing, setEditing] = useState(false);
  const anchorRef = useRef(null);
  const controlRef = useRef(null);
  const labelTextRef = useRef(null);
  const close = useCallback(() => setEditing(false), []);
  const date = dateFromDateInput(dateValue);
  const today = new Date();
  const offset = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  const relativeLabel = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : offset === -1 ? "Yesterday"
    : offset > 0 ? `in ${ offset } days` : `${ -offset } days ago`;
  const candidateLabels = dateLabel?.includes(" – ") ? [dateLabel] : DATE_LABEL_FORMATS.map(format => date.toLocaleDateString([], format));
  const label = useFittingDateLabel(candidateLabels, labelTextRef, controlRef);
  // ------------------------------------------------------------------------------------------
  // @desc Close the popout before asking the widget to load the chosen date.
  const selectDate = value => { setEditing(false); onSelectDate(value); };
  // ------------------------------------------------------------------------------------------
  // @desc Move by local calendar days, preserving midnight across daylight-saving transitions.
  const shiftDate = amount => selectDate(dateKeyFromDateInput(new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)));
  return (
    <>
      <div className="proposed-agenda-date-control" ref={ controlRef }>
        <div className="proposed-agenda-day-stepper">
          <IconButton className="proposed-agenda-day-arrow" Icon={ MdChevronLeft } label="Previous agenda day"
            onClick={ () => shiftDate(-1) } />
          <PlainButton aria-expanded={ editing } aria-haspopup="dialog" aria-label="Change agenda date"
            className="proposed-agenda-date-edit" onClick={ () => setEditing(value => !value) } ref={ anchorRef }
            title={ candidateLabels[0] }>
            <span className="proposed-agenda-date-text" ref={ labelTextRef }>{ label }</span>
            <MdExpandMore aria-hidden="true" className="proposed-agenda-date-caret" />
          </PlainButton>
          <IconButton className="proposed-agenda-day-arrow" Icon={ MdChevronRight } label="Next agenda day"
            onClick={ () => shiftDate(1) } />
        </div>
        <span className="proposed-agenda-relative-date">{ relativeLabel }</span>
        {
          editing ? (
            <ProposedAgendaPopover anchorRef={ anchorRef } label="Choose agenda date" onClose={ close }>
              <AgendaCalendar calendarEvents={ calendarEvents } dateValue={ dateValue } onSelectDate={ selectDate }
                savedDates={ savedDates } />
            </ProposedAgendaPopover>
          ) : null
        }
      </div>
      {
        offset !== 0 ? (
          <Button className="proposed-agenda-today" dense onClick={ () => selectDate(dateKeyFromDateInput(today)) }>
            Back to today
          </Button>
        ) : null
      }
    </>
  );
}
