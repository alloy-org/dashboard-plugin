// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "render the proposed hour-by-hour agenda: each activity links to schedule it at its time, with a
//   button at the bottom to approve the whole schedule"
import { widgetTitleFromId } from "constants/settings";
import { approveProposedAgenda, generateProposedAgenda, scheduleProposedActivity } from "proposed-agenda-service";
import { useCallback, useEffect, useRef, useState } from "react";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

import "styles/proposed-agenda.scss";

const WIDGET_ID = "proposed-agenda";

// ----------------------------------------------------------------------------------------------
// @desc Format minutes-since-midnight as a friendly clock label honoring the dashboard timeFormat prop.
// @param {number} startMinutes - Minutes since midnight.
// @param {string} timeFormat - '24h' or anything else (defaults to locale 12-hour).
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: format a proposed activity's start time for display
function _formatStartLabel(startMinutes, timeFormat) {
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  if (timeFormat === "24h") return `${ String(hours).padStart(2, "0") }:${ String(minutes).padStart(2, "0") }`;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${ displayHour }:${ String(minutes).padStart(2, "0") } ${ period }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Stable key for an activity row (start time + title are unique enough within one day's schedule).
// @param {object} activity - Validated activity record.
// @returns {string}
function _activityKey(activity) {
  return `${ activity.startTime }::${ activity.taskUuid || activity.title }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Loading placeholder shown while the LLM builds the schedule.
// [Claude claude-opus-4-8 (1M context)] Task: proposed-agenda loading state
function LoadingState() {
  return (
    <WidgetWrapper title={ widgetTitleFromId(WIDGET_ID) } icon="🗓️" widgetId={ WIDGET_ID }>
      <div className="proposed-agenda-loading">
        <div className="proposed-agenda-spinner" />
        <p>Drafting your hour-by-hour schedule …</p>
      </div>
    </WidgetWrapper>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Error/empty state with a retry button.
// @param {object} props - { message, onRetry }.
// [Claude claude-opus-4-8 (1M context)] Task: proposed-agenda error/empty state
function MessageState({ message, onRetry }) {
  return (
    <WidgetWrapper title={ widgetTitleFromId(WIDGET_ID) } icon="🗓️" widgetId={ WIDGET_ID }>
      <div className="proposed-agenda-message">
        <p>{ message }</p>
        <button className="proposed-agenda-retry" onClick={ onRetry }>Try again</button>
      </div>
    </WidgetWrapper>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Single proposed-activity row: time, title, reason, and a per-activity schedule link.
// @param {object} props - { activity, onSchedule, scheduledKeys, timeFormat }.
// [Claude claude-opus-4-8 (1M context)] Task: render an activity row with a schedule-at link
// Prompt: "on each proposed activity, a link to approve scheduling the task at a particular time"
function ActivityRow({ activity, onSchedule, scheduledKeys, timeFormat }) {
  const key = _activityKey(activity);
  const isScheduled = scheduledKeys.has(key);
  const titleHtml = amplenoteMarkdownRender(activity.title) || activity.title;
  return (
    <div className={ `proposed-agenda-item${ isScheduled ? " proposed-agenda-item--scheduled" : "" }` }>
      <span className="proposed-agenda-time">{ _formatStartLabel(activity.startMinutes, timeFormat) }</span>
      <div className="proposed-agenda-content">
        <span className="proposed-agenda-text" dangerouslySetInnerHTML={ { __html: titleHtml } } />
        { activity.reason ? <span className="proposed-agenda-reason">{ activity.reason }</span> : null }
      </div>
      { activity.durationMinutes ? <span className="proposed-agenda-duration">{ `${ activity.durationMinutes }m` }</span> : null }
      { isScheduled
        ? <span className="proposed-agenda-scheduled-badge" title="Scheduled">✅ Scheduled</span>
        : <a href="#" className="proposed-agenda-schedule-link"
            title={ `Schedule this for ${ activity.startTime } today` }
            onClick={ (event) => onSchedule(event, activity) }>📅 Schedule { activity.startTime }</a> }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Proposed Agenda widget — generates an LLM-proposed hour-by-hour schedule from recent task-domain
//   tasks plus the quarterly plan, lets the user schedule each activity individually, and approve the whole
//   schedule at the bottom.
// @param {object} props - { app, defaultNoteUuid, providerEm, timeFormat }.
// [Claude claude-opus-4-8 (1M context)] Task: top-level Proposed Agenda widget
// Prompt: "create a proposed-agenda component ... approve the schedule ... schedule each task at a time"
export default function ProposedAgendaWidget({ app, defaultNoteUuid, providerEm, timeFormat }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activities, setActivities] = useState(null);
  const [dateLabel, setDateLabel] = useState(null);
  const [llmAttributionFooter, setLlmAttributionFooter] = useState(null);
  const [scheduledKeys, setScheduledKeys] = useState(() => new Set());
  const [approving, setApproving] = useState(false);
  const listRef = useRef(null);

  const runGeneration = useCallback(async () => {
    setLoading(true);
    setError(null);
    setScheduledKeys(new Set());
    try {
      const result = await generateProposedAgenda(app, { providerEmOverride: providerEm || null });
      if (result.error) {
        setError(result.error);
        setActivities(null);
      } else {
        setActivities(result.activities);
        setDateLabel(result.dateLabel);
        setLlmAttributionFooter(result.llmAttributionFooter);
      }
    } catch (err) {
      logIfEnabled("[proposed-agenda] runGeneration caught", err);
      setError(err.message || "Failed to build a schedule.");
    } finally {
      setLoading(false);
    }
  }, [app, providerEm]);

  useEffect(() => {
    if (loading || activities) return;
    runGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    attachFootnotePopups(listRef.current);
  }, [activities]);

  const onSchedule = useCallback(async (event, activity) => {
    event.preventDefault();
    const result = await scheduleProposedActivity(app, activity, defaultNoteUuid);
    if (!result.taskUuid) {
      await app.alert("Could not schedule this activity. Please try again or schedule it manually.");
      return;
    }
    setScheduledKeys(previous => { const next = new Set(previous); next.add(_activityKey(activity)); return next; });
  }, [app, defaultNoteUuid]);

  const onApprove = useCallback(async () => {
    if (!activities?.length) return;
    const pending = activities.filter(activity => !scheduledKeys.has(_activityKey(activity)));
    if (pending.length === 0) return;
    setApproving(true);
    try {
      const { failed, scheduled } = await approveProposedAgenda(app, pending, defaultNoteUuid);
      setScheduledKeys(new Set(activities.map(_activityKey)));
      const summary = failed > 0
        ? `Scheduled ${ scheduled } activities; ${ failed } could not be scheduled.`
        : `Scheduled all ${ scheduled } activities.`;
      await app.alert(summary);
    } finally {
      setApproving(false);
    }
  }, [activities, app, defaultNoteUuid, scheduledKeys]);

  if (loading) return <LoadingState />;
  if (error) return <MessageState message={ error } onRetry={ runGeneration } />;
  if (!activities || activities.length === 0) {
    return <MessageState message="No schedule could be proposed yet." onRetry={ runGeneration } />;
  }

  const allScheduled = activities.every(activity => scheduledKeys.has(_activityKey(activity)));
  const reseedAction = (
    <a href="#" className="widget-header-action" title="Propose a fresh schedule"
      onClick={ (event) => { event.preventDefault(); runGeneration(); } }>🔄 Reseed</a>
  );

  return (
    <WidgetWrapper title={ widgetTitleFromId(WIDGET_ID) } subtitle={ dateLabel } icon="🗓️"
        widgetId={ WIDGET_ID } headerActions={ reseedAction }>
      <div className="proposed-agenda-list" ref={ listRef }>
        { activities.map(activity => (
          <ActivityRow key={ _activityKey(activity) } activity={ activity } onSchedule={ onSchedule }
            scheduledKeys={ scheduledKeys } timeFormat={ timeFormat } />
        )) }
      </div>
      <div className="proposed-agenda-footer">
        <button className="proposed-agenda-approve" onClick={ onApprove } disabled={ approving || allScheduled }>
          { allScheduled ? "✅ Schedule approved" : approving ? "Approving …" : "Approve schedule" }
        </button>
        { llmAttributionFooter ? <p className="proposed-agenda-attribution">{ llmAttributionFooter }</p> : null }
      </div>
    </WidgetWrapper>
  );
}
