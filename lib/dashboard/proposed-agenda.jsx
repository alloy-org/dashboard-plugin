// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "render the proposed hour-by-hour agenda: each activity links to schedule it at its time, with a
//   button at the bottom to approve the whole schedule"
import { widgetTitleFromId } from "constants/settings";
import { approveProposedAgenda, generateProposedAgenda, scheduleProposedActivity } from "proposed-agenda-service";
import { useCallback, useEffect, useRef, useState } from "react";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { formatClockLabel } from "util/date-utility";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

import "styles/proposed-agenda.scss";

const WIDGET_ID = "proposed-agenda";

// ----------------------------------------------------------------------------------------------
// @desc Stable key for an activity row (start time + title are unique enough within one day's schedule).
// @param {object} activity - Validated activity record.
// @returns {string}
function _activityKey(activity) {
  return `${ activity.startTime }::${ activity.taskUuid || activity.title }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Add an activity's key to a scheduled-keys set immutably (for use in a setState updater).
// @param {Set<string>} previous - Current scheduled-keys set.
// @param {object} activity - Activity whose key should be marked scheduled.
// @returns {Set<string>}
// [Claude claude-opus-4-8 (1M context)] Task: keep set-mutation out of the component body
function _withScheduledKey(previous, activity) {
  const next = new Set(previous);
  next.add(_activityKey(activity));
  return next;
}

// ----------------------------------------------------------------------------------------------
// @desc Label for the approve button given its current state.
// @param {boolean} allScheduled - Whether every activity is already scheduled.
// @param {boolean} approving - Whether an approve-all request is in flight.
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: move approve-button label derivation out of JSX
function _approveButtonLabel(allScheduled, approving) {
  if (allScheduled) return "✅ Schedule approved";
  return approving ? "Approving …" : "Approve schedule";
}

// ----------------------------------------------------------------------------------------------
// @desc Run the generation service and route its result into the widget's state setters.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { providerEm } plus the setters { setActivities, setDateLabel, setError,
//   setLlmAttributionFooter, setLoading, setScheduledKeys }.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: hoist the generation flow out of the component body
async function _runGeneration(app, { providerEm, setActivities, setDateLabel, setError, setLlmAttributionFooter,
    setLoading, setScheduledKeys }) {
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
}

// ----------------------------------------------------------------------------------------------
// @desc Schedule a single activity and mark its key scheduled on success; alerts on failure.
// @param {object} app - Amplenote app bridge.
// @param {object} activity - Activity to schedule.
// @param {string|null} defaultNoteUuid - Fallback note for newly-created activities.
// @param {Function} setScheduledKeys - State setter for scheduled keys.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: hoist single-activity scheduling out of the component body
async function _scheduleOne(app, activity, defaultNoteUuid, setScheduledKeys) {
  const result = await scheduleProposedActivity(app, activity, defaultNoteUuid);
  if (!result.taskUuid) {
    await app.alert("Could not schedule this activity. Please try again or schedule it manually.");
    return;
  }
  setScheduledKeys(previous => _withScheduledKey(previous, activity));
}

// ----------------------------------------------------------------------------------------------
// @desc Approve every not-yet-scheduled activity, mark them all scheduled, and summarize the outcome.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { activities, defaultNoteUuid, scheduledKeys, setApproving, setScheduledKeys }.
// @returns {Promise<void>}
// [Claude claude-opus-4-8 (1M context)] Task: hoist approve-all flow out of the component body
async function _approveAll(app, { activities, defaultNoteUuid, scheduledKeys, setApproving, setScheduledKeys }) {
  const pending = activities.filter(activity => !scheduledKeys.has(_activityKey(activity)));
  if (pending.length === 0) return;
  setApproving(true);
  try {
    const { failed, scheduled } = await approveProposedAgenda(app, pending, defaultNoteUuid);
    setScheduledKeys(new Set(activities.map(_activityKey)));
    await app.alert(failed > 0
      ? `Scheduled ${ scheduled } activities; ${ failed } could not be scheduled.`
      : `Scheduled all ${ scheduled } activities.`);
  } finally {
    setApproving(false);
  }
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
      <span className="proposed-agenda-time">{ formatClockLabel(activity.startMinutes, timeFormat) }</span>
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

  const runGeneration = useCallback(() => _runGeneration(app, { providerEm, setActivities, setDateLabel, setError,
    setLlmAttributionFooter, setLoading, setScheduledKeys }), [app, providerEm]);

  const onSchedule = useCallback((event, activity) => {
    event.preventDefault();
    return _scheduleOne(app, activity, defaultNoteUuid, setScheduledKeys);
  }, [app, defaultNoteUuid]);

  const onApprove = useCallback(() => {
    if (!activities?.length) return;
    return _approveAll(app, { activities, defaultNoteUuid, scheduledKeys, setApproving, setScheduledKeys });
  }, [activities, app, defaultNoteUuid, scheduledKeys]);

  useEffect(() => {
    if (loading || activities) return;
    runGeneration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    attachFootnotePopups(listRef.current);
  }, [activities]);

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
          { _approveButtonLabel(allScheduled, approving) }
        </button>
        { llmAttributionFooter ? <p className="proposed-agenda-attribution">{ llmAttributionFooter }</p> : null }
      </div>
    </WidgetWrapper>
  );
}
