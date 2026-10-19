// Dev-only page that clicks Amplenote's calendar "Suggest" on the dashboard's behalf: it runs the suggestScheduledTasks
// action against the browser dev app for a one-day, three-day, or one-week view and lists, per date, every task the
// action publishes through setScheduledTasks along with the rationale Amplenote would show for it.
import { useEffect, useState } from "react";
import { CALENDAR_SUGGESTION_RANGES, calendarSuggestionWindow, runCalendarSuggestionPass,
  suggestionDaysFromPublication } from "dashboard/calendar-suggestions-dev-session";
import { MAX_SUGGESTION_DAYS } from "dashboard/proposed-agenda/proposed-agenda-suggest-action";
import "styles/calendar-suggestions-dev-page.scss";

const DASHBOARD_PATH = "/";

// ----------------------------------------------------------------------------------------------
// @desc One date's suggestions, or why the date has none.
// @param {object} day - { dayKey, isPlanned, label, rows } from suggestionDaysFromPublication.
function SuggestionDay({ day }) {
  const emptyReason = day.isPlanned ? "No suggestions published for this date yet."
    : `Not planned: the action skips weekends and plans at most ${ MAX_SUGGESTION_DAYS } days.`;
  return (
    <section className="suggestion-day-section">
      <h2 className="suggestion-day-heading">{day.label}</h2>
      {day.rows.length === 0 ? <p className="suggestion-day-empty">{emptyReason}</p> : (
        <ul className="suggestion-day-list">
          {day.rows.map(row => (
            <li className="suggestion-row-item" key={`${ row.startAt }:${ row.taskUuid || row.title }`}>
              <div className="suggestion-row-header">
                <span className="suggestion-row-time">{row.startClock}–{row.endClock}</span>
                <span className="suggestion-row-title">{row.title}</span>
                <span className="suggestion-row-badge">{row.isNewTask ? "New task" : "Existing task"}</span>
                <span className="suggestion-row-duration">{row.durationMinutes} min</span>
              </div>
              <p className="suggestion-row-rationale">{row.explanation || "(no explanation provided)"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc The dev Calendar Suggestions page: pick a Task Domain and a view length, press Suggest, and watch each
//   progressive publish replace the per-date list until the action returns its final set.
// @param {object} app - The browser dev app.
// @param {Promise<object>} initPromise - The dev app's init(), which loads the settings the action reads.
export default function CalendarSuggestionsDevPage({ app, initPromise }) {
  const [domainUuid, setDomainUuid] = useState(null);
  const [domains, setDomains] = useState([]);
  const [publication, setPublication] = useState(null);
  const [rangeKey, setRangeKey] = useState(CALENDAR_SUGGESTION_RANGES[1].key);
  const [run, setRun] = useState({ status: "loading" });

  useEffect(() => {
    initPromise.then(async initResult => {
      const taskDomains = await app.getTaskDomains();
      setDomains(taskDomains);
      setDomainUuid(initResult?.activeTaskDomain || taskDomains[0]?.uuid || null);
      setRun({ status: "idle" });
    }).catch(error => setRun({ error: error?.message || String(error), status: "error" }));
  }, [app, initPromise]);

  const range = CALENDAR_SUGGESTION_RANGES.find(option => option.key === rangeKey);
  const handleSuggest = async () => {
    const startedAt = Date.now();
    const taskDomain = domains.find(domain => domain.uuid === domainUuid) || null;
    const suggestionWindow = calendarSuggestionWindow(range.dayCount);
    setPublication({ publishCount: 0, suggestions: [], taskByUuid: new Map(), suggestionWindow });
    setRun({ startedAt, status: "running" });
    const onPublish = (suggestions, { taskByUuid }) => setPublication(previous => ({ publishCount: previous.publishCount + 1,
      suggestionWindow, suggestions, taskByUuid }));
    try {
      const result = await runCalendarSuggestionPass(app, { dayCount: range.dayCount, onPublish, taskDomain });
      setPublication(previous => ({ ...previous, suggestions: result.suggestions, taskByUuid: result.taskByUuid }));
      setRun({ elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), status: "done" });
    } catch (error) {
      console.error("[calendar-suggestions-dev] pass failed", error);
      setRun({ error: error?.message || String(error), status: "error" });
    }
  };

  const days = publication ? suggestionDaysFromPublication(publication.suggestions, publication.suggestionWindow,
    publication.taskByUuid) : [];
  const statusText = { done: `Done in ${ run.elapsedSeconds }s — showing the suggestions the action returned.`,
    error: `Failed: ${ run.error }`, idle: "Choose a view and press Suggest.", loading: "Loading dev app…",
    running: "Generating… each publish through setScheduledTasks replaces the list below." }[run.status];
  return (
    <div className="calendar-suggestions-dev-page">
      <a className="calendar-suggestions-back-link" href={DASHBOARD_PATH}>← Dashboard</a>
      <h1 className="calendar-suggestions-title">Calendar suggestions (dev)</h1>
      <div className="calendar-suggestions-controls">
        <select className="calendar-suggestions-domain" disabled={run.status === "running"} value={domainUuid || ""}
          onChange={event => setDomainUuid(event.target.value)}>
          {domains.map(domain => <option key={domain.uuid} value={domain.uuid}>{domain.name}</option>)}
        </select>
        <div className="calendar-suggestions-range" role="group" aria-label="Calendar view length">
          {CALENDAR_SUGGESTION_RANGES.map(option => (
            <button className={`calendar-suggestions-range-button${ option.key === rangeKey ? " is-selected" : "" }`}
              disabled={run.status === "running"} key={option.key} onClick={() => setRangeKey(option.key)} type="button">
              {option.label}
            </button>
          ))}
        </div>
        <button className="calendar-suggestions-suggest-button" disabled={run.status === "running" || run.status === "loading"}
          onClick={handleSuggest} type="button">Suggest</button>
      </div>
      <p className={`calendar-suggestions-status is-${ run.status }`}>
        {statusText}
        {publication ? ` Publishes received: ${ publication.publishCount }.` : null}
      </p>
      {days.map(day => <SuggestionDay day={day} key={day.dayKey} />)}
    </div>
  );
}
