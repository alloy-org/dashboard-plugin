// Render the proposed agenda with date navigation, priority choices, and scheduling actions.
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers";
import { configuredProviderEms, SETTING_KEYS } from "constants/settings";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import LlmProviderSelector from "llm-provider-selector";
import NoConfigUpsell from "no-config-upsell";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { PROPOSED_TASK_STATUS } from "proposed-agenda-archive";
import ProposedAgendaDateControl from "proposed-agenda-date-control";
import { activityKey, approveAllProposed, mergedAgendaRows, pendingCount, recordProposedRowStatuses,
  runProposedAgendaGeneration, scheduleProposedRow } from "proposed-agenda-llm-generator";
import ProposedAgendaMessage from "proposed-agenda-message";
import { populateAgendaNote, prepareAgendaNote } from "proposed-agenda-note";
import { DEFAULT_PRIORITY_KEY } from "proposed-agenda-priority";
import ProposedAgendaPriorityControl from "proposed-agenda-priority-control";
import { agendaRowsGroupedByDay } from "proposed-agenda-range";
import { resolveProposedAgendaDate } from "proposed-agenda-service";
import { AMPLE_AGENT_PRO_NOTE_NAME } from "providers/ai-provider-settings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "styles/proposed-agenda.scss";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { calendarEventDateFromValue } from "util/calendar-utility";
import { dateFromDateInput, dateKeyFromDateInput, formatClockLabel } from "util/date-utility";
import { snapDashboardAction } from "util/plausible";
import WidgetWrapper from "widget-wrapper";

const WIDGET_ID = "proposed-agenda";

// Error codes that mean generation failed for want of a reachable LLM (no API key + no working Ample Agent Pro).
// When there is also no configured key, we show the Ample Agent Pro upsell instead of a bare error, matching
// how DreamTask degrades.
const NO_CONFIG_ERROR_CODES = new Set(["invalid_api_key", "llm_error", "no_provider_configured", "parse_error"]);

const NO_CONFIG_FEATURES = [
  { icon: "🗓️", label: "Auto-draft your day" },
  { icon: "⚖️", label: "Balance work by priority" },
  { icon: "🎯", label: "Align the day to goals" },
  { icon: "⏰", label: "Schedule around obligations" },
  { icon: "🔄", label: "Reseed with any model" },
  { icon: "🧠", label: "Frontier models, no key" },
];

// ----------------------------------------------------------------------------------------------
// @desc Resolve the model name shown in the model pill from the selected provider enum.
// @param {string|null} providerEm
// @returns {string}
function _modelName(providerEm) {
  return PROVIDER_DEFAULT_MODEL[providerEm] || providerEm || "default model";
}

// ----------------------------------------------------------------------------------------------
// @desc One agenda row. Already-scheduled obligations and just-scheduled proposals retain readable titles with a
//   "Scheduled" badge; pending proposals show their reason plus Add-to-schedule and dismiss controls. A "Note"
//   link beneath the timestamp opens the note backing the row's task (when one is linkable).
// @param {object} props - { onDismiss, onOpenNote, onSchedule, row, scheduledKeys, timeFormat }.
function ActivityRow({ onDismiss, onOpenNote, onSchedule, row, scheduledKeys, timeFormat }) {
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const isScheduled = row.isObligation || scheduledKeys.has(activityKey(row));
  const titleHtml = amplenoteMarkdownRender(row.title) || row.title;
  const hasNote = !!(row.noteUuid || row.taskUuid);
  const hasReason = !row.isObligation && !!row.reason;
  return (
    <div className={ `proposed-agenda-item${ isScheduled ? " proposed-agenda-item--scheduled" : "" }` }>
      <div className="proposed-agenda-item-main">
        <span className="proposed-agenda-time-col">
          <span className={ `proposed-agenda-time${ isScheduled ? " proposed-agenda-time--muted" : "" }` }>
            { formatClockLabel(row.startMinutes, timeFormat) }</span>
          {
            hasNote
            ? <a href="#" className="proposed-agenda-note-link" title="Open the note for this task"
                onClick={ (event) => onOpenNote(event, row) }>Note</a>
            : <span className="proposed-agenda-note-link">{ row.source === "event" ? "Event" : "Task" }</span>
          }
        </span>
        <div className="proposed-agenda-content">
          <span className="proposed-agenda-title-line">
            <span className="proposed-agenda-text" dangerouslySetInnerHTML={ { __html: titleHtml } } />
            { hasReason
              ? <button aria-expanded={ reasonExpanded }
                  aria-label={ `${ reasonExpanded ? "Hide" : "Show" } why this task was proposed` }
                  className="proposed-agenda-reason-toggle" onClick={ () => setReasonExpanded(expanded => !expanded) }
                  title={ `${ reasonExpanded ? "Hide" : "Show" } why this task was proposed` }
                  type="button">ⓘ</button>
              : null }
          </span>
          { hasReason ? <span className="proposed-agenda-reason proposed-agenda-reason--desktop">{ row.reason }</span> : null }
          { row.projectUuid ? <span className="proposed-agenda-goal-badge">☆ Quarterly goal</span> : null }
        </div>
        { isScheduled
          ? <span className="proposed-agenda-scheduled-meta">
              <span className="proposed-agenda-scheduled-badge" title="Already scheduled on this date">Scheduled</span>
            </span>
          : <>
              <span className="proposed-agenda-actions">
                <button className="proposed-agenda-add" title={ `Schedule for ${ row.startTime } on the agenda date` }
                  onClick={ (event) => onSchedule(event, row) }>
                  <span><span aria-hidden="true" className="proposed-agenda-schedule-icon">▦</span> Add to schedule</span>
                  { row.durationMinutes
                    ? <span className="proposed-agenda-add-duration">{ `${ row.durationMinutes }m` } duration</span> : null }
                </button>
                <button aria-label="Dismiss this suggestion" className="proposed-agenda-dismiss" title="Dismiss this suggestion"
                  onClick={ (event) => onDismiss(event, row) }>×</button>
              </span>
            </>
        }
      </div>
      { hasReason && reasonExpanded
        ? <div className="proposed-agenda-reason proposed-agenda-reason--mobile">{ row.reason }</div> : null }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Show a naturally sized activity indicator while obligations and the proposed schedule load.
function LoadingState({ dateControl }) {
  return (
    <WidgetWrapper widgetId={ WIDGET_ID }>
      { dateControl }
      <div className="proposed-agenda-loading">
        <span aria-hidden="true" className="proposed-agenda-spinner">⟳</span>
        <p>Drafting your hour-by-hour schedule …</p>
      </div>
    </WidgetWrapper>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render obligations and LLM proposals for one day or an optional calendar range.
// @param {object} props - { app, calendarEvents, currentDate, dateRange, defaultNoteUuid, providerApiKey,
//   providerEm, taskDomainName, taskDomainUUID, timeFormat }.
//   - {object|null} dateRange - Optional { endAt, startAt } unix-second window.
export default function ProposedAgendaWidget({ app, calendarEvents, currentDate, dateRange = null, defaultNoteUuid,
    providerApiKey, providerEm, taskDomainName, taskDomainUUID, timeFormat }) {
  // The widget's persisted "Today's priority" and AI-provider choices, seeded from the same SETTING_KEYS
  const persistedPriorityKey = pluginSettings()[SETTING_KEYS.PROPOSED_AGENDA_PRIORITY] || null;
  const persistedProviderEm = pluginSettings()[SETTING_KEYS.PROPOSED_AGENDA_LLM] || null;

  // Key the range by value so equivalent object literals do not regenerate.
  const dateRangeKey = dateRange ? `${ dateRange.startAt }-${ dateRange.endAt }` : null;

  // ------------------------------------------------------------------------------------------
  // @desc Keys the calendar events by value for the same reason dateRangeKey exists: useExternalCalendarEvents
  //   re-fetches on every visibilitychange and normalizeExternalCalendarEvents always rebuilds the array via
  //   .map, so the reference changes on each return to the dashboard even when the events are unchanged. Keying
  //   on the fields that can alter a proposal (timing, title, all-day) means navigating away and back no longer
  //   re-runs the LLM; a genuine calendar change still does.
  const calendarEventsKey = useMemo(() => {
    if (!Array.isArray(calendarEvents)) return null;
    const eventIdentities = calendarEvents.map(event => [ calendarEventDateFromValue(event?.start)?.getTime() ?? "",
      calendarEventDateFromValue(event?.end)?.getTime() ?? "", event?.title || "", event?.allDay ? "1" : "0" ].join("|"));
    return eventIdentities.join("~");
  }, [calendarEvents]);

  const [approving, setApproving] = useState(false);
  const [ampleAgentProAvailable, setAmpleAgentProAvailable] = useState(false);
  const [attribution, setAttribution] = useState(null);
  const [dateLabel, setDateLabel] = useState(null);
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [isFutureDay, setIsFutureDay] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modelProviderEm, setModelProviderEm] = useState(persistedProviderEm || providerEm || null);
  const [obligations, setObligations] = useState([]);
  const [priorityKey, setPriorityKey] = useState(persistedPriorityKey || DEFAULT_PRIORITY_KEY);
  const [projectNotice, setProjectNotice] = useState(null);
  const [proposed, setProposed] = useState([]);
  const [providerPopupOpen, setProviderPopupOpen] = useState(false);
  const [recordDomainName, setRecordDomainName] = useState(taskDomainName || "All Notes");
  const [recordDomainUuid, setRecordDomainUuid] = useState(taskDomainUUID || null);
  const [recordProviderEm, setRecordProviderEm] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const generationRef = useRef(0);
  const [scheduledKeys, setScheduledKeys] = useState(() => new Set());
  const listRef = useRef(null);

  // Identifies the domain-specific stored monthly line currently on screen so status changes cannot mutate
  // another Task Domain's cache record.
  const llmDateRecord = useMemo(() => ({ date: selectedDate || currentDate, domainName: recordDomainName,
    domainUuid: recordDomainUuid, priorityKey, providerEm: recordProviderEm }),
    [currentDate, priorityKey, recordDomainName, recordDomainUuid, recordProviderEm, selectedDate]);

  // providerApiKey is included so that adding an API key in Dashboard Settings (which leaves providerEm
  // unchanged) still re-triggers generation, letting the widget recover from the no-provider state.
  // ------------------------------------------------------------------------------------------
  // @desc Generate the selected day and discard stale responses after another date or provider is chosen.
  // @param {object} options - Whether to bypass the normal agenda cache.
  const runGeneration = useCallback(({ forceRegenerate = false } = {}) => {
    const generation = ++generationRef.current;
    const setters = { setApproving, setAttribution, setDateLabel, setDismissedKeys, setError, setIsFutureDay,
      setLoading, setObligations, setProjectNotice, setProposed, setRecordDomainName, setRecordDomainUuid, setRecordProviderEm, setScheduledKeys };
    const guardedSetters = Object.fromEntries(Object.entries(setters).map(([name, setter]) =>
      [name, value => { if (generation === generationRef.current) setter(value); }]));
    return runProposedAgendaGeneration(app, { calendarEvents, currentDate, dateRange, domainName: taskDomainName,
      domainUuid: taskDomainUUID, explicitDate: selectedDate, forceRegenerate,
      isCurrentGeneration: () => generation === generationRef.current, priorityKey,
      providerEm: modelProviderEm, ...guardedSetters }).catch(error => {
      guardedSetters.setError({ error: error?.message || "Could not prepare the agenda. Please try again.",
        errorCode: "agenda_error", noteUuid: error?.noteUuid || null });
      guardedSetters.setProposed([]);
    });
  }, [app, calendarEventsKey, currentDate, dateRangeKey, modelProviderEm, priorityKey, providerApiKey, selectedDate,
    taskDomainName, taskDomainUUID]);

  const onChangeModel = useCallback(() => setProviderPopupOpen(true), []);

  const onSelectProvider = useCallback((selectedProviderEm) => {
    setProviderPopupOpen(false);
    if (selectedProviderEm && selectedProviderEm !== modelProviderEm) {
      setModelProviderEm(selectedProviderEm);
      app.setSetting(SETTING_KEYS.PROPOSED_AGENDA_LLM, selectedProviderEm);
      updatePluginSetting(SETTING_KEYS.PROPOSED_AGENDA_LLM, selectedProviderEm);
    }
  }, [app, modelProviderEm]);

  // ------------------------------------------------------------------------------------------
  // @desc Persist the chosen priority and regenerate using its built-in or custom instruction.
  // @param {object} event - Selected priority key in target.value.
  const onPriorityChange = useCallback(event => {
    const nextKey = event.target.value;
    setPriorityKey(nextKey);
    app.setSetting(SETTING_KEYS.PROPOSED_AGENDA_PRIORITY, nextKey);
    updatePluginSetting(SETTING_KEYS.PROPOSED_AGENDA_PRIORITY, nextKey);
  }, [app]);

  const onDismiss = useCallback((event, row) => {
    event.preventDefault();
    setDismissedKeys(previous => new Set(previous).add(activityKey(row)));
    recordProposedRowStatuses(app, llmDateRecord, [row], PROPOSED_TASK_STATUS.DISMISSED);
  }, [app, llmDateRecord]);

  const onDismissAll = useCallback(() => {
    const dismissing = proposed.filter(a => !scheduledKeys.has(activityKey(a)));
    const dismissingKeys = dismissing.map(activityKey);
    setDismissedKeys(previous => new Set([...previous, ...dismissingKeys]));
    recordProposedRowStatuses(app, llmDateRecord, dismissing, PROPOSED_TASK_STATUS.DISMISSED);
  }, [app, llmDateRecord, proposed, scheduledKeys]);

  const onSchedule = useCallback((event, row) => {
    event.preventDefault();
    snapDashboardAction("scheduleProposedAgendaRow", { hasTask: !!row.taskUuid });
    return scheduleProposedRow(app, row, defaultNoteUuid, setScheduledKeys, llmDateRecord);
  }, [app, defaultNoteUuid, llmDateRecord]);

  // Proposed existing-task rows carry noteUuid directly; obligations carry only taskUuid, so resolve the
  // owning note via getTask before navigating. Invented/calendar rows with neither are not linkable.
  const onOpenNote = useCallback(async (event, row) => {
    event.preventDefault();
    const noteUuid = row.noteUuid || (await app.getTask(row.taskUuid)).noteUUID;
    await app.navigate(`https://www.amplenote.com/notes/${ noteUuid }`);
  }, [app]);

  const onApprove = useCallback(() => {
    snapDashboardAction("scheduleAllProposedAgenda", { count: pendingCount(proposed, scheduledKeys, dismissedKeys) });
    return approveAllProposed(app, { defaultNoteUuid, dismissedKeys, llmDateRecord, proposed, scheduledKeys,
      setApproving, setScheduledKeys });
  }, [app, defaultNoteUuid, dismissedKeys, llmDateRecord, proposed, scheduledKeys]);

  useEffect(() => { runGeneration(); return () => { generationRef.current += 1; }; }, [runGeneration]);
  useEffect(() => { attachFootnotePopups(listRef.current); }, [obligations, proposed]);

  // Adopt the dashboard-configured provider when it changes and the user has not picked one inside the widget,
  // so configuring an AI provider in Dashboard Settings flows through here (re-triggering generation) instead of
  // the widget staying stuck on the "No AI provider configured" state.
  useEffect(() => {
    if (persistedProviderEm) return;
    if (providerEm && providerEm !== modelProviderEm) setModelProviderEm(providerEm);
  }, [providerEm, persistedProviderEm]);

  // Detect whether the Ample Agent Pro plugin is installed. When it is, the provider chooser may offer providers
  // the user has no local key for, because the chosen provider is passed to Agent Pro as an argument.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(app.findNote({ name: AMPLE_AGENT_PRO_NOTE_NAME }))
      .then(note => { if (!cancelled) setAmpleAgentProAvailable(!!note); });
    return () => { cancelled = true; };
  }, [app]);

  useWidgetLoadedEvent(WIDGET_ID, !loading && !error, !!error);

  const fallbackDate = resolveProposedAgendaDate(dateFromDateInput(currentDate || new Date()));
  const dateValue = selectedDate || dateKeyFromDateInput(proposed[0]?.targetMidnightSeconds || fallbackDate);
  const datedRows = proposed.filter(row => row.targetMidnightSeconds);
  const savedDates = [...new Set(datedRows.map(row => dateKeyFromDateInput(row.targetMidnightSeconds)))];
  const dateControl = <ProposedAgendaDateControl calendarEvents={ calendarEvents } dateLabel={ dateLabel }
    dateValue={ dateValue } onSelectDate={ setSelectedDate } savedDates={ savedDates } />;
  if (loading) return <LoadingState dateControl={ dateControl } />;
  if (error) {
    const envApiKey = (typeof process !== "undefined" && process.env?.OPEN_AI_ACCESS_TOKEN) || "";
    const hasLlmConfig = !!(envApiKey || providerApiKey);
    if (!hasLlmConfig && NO_CONFIG_ERROR_CODES.has(error.errorCode)) {
      return (
        <NoConfigUpsell app={ app } features={ NO_CONFIG_FEATURES }
          moreFeaturesLabel="+ 15 more features included" widgetId={ WIDGET_ID } />
      );
    }
    return <ProposedAgendaMessage app={ app } dateControl={ dateControl } message={ error.error } noteUuid={ error.noteUuid }
      onRetry={ () => runGeneration() } />;
  }

  // Hide elapsed proposals only on today; the midnight value also orders legacy rows without a day stamp.
  const now = new Date();
  const todayMidnightSeconds = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
  const hidePastBeforeMinutes = isFutureDay ? null : now.getHours() * 60 + now.getMinutes();
  const rows = mergedAgendaRows(obligations, proposed, dismissedKeys, { fallbackMidnightSeconds: todayMidnightSeconds,
    hidePastBeforeMinutes, hidePastOnMidnightSeconds: todayMidnightSeconds });
  const dayGroups = agendaRowsGroupedByDay(rows);
  if (rows.length === 0) {
    return <ProposedAgendaMessage dateControl={ dateControl } message={ projectNotice || "No schedule could be proposed yet." }
      onRetry={ () => runGeneration() } />;
  }
  const pending = pendingCount(proposed, scheduledKeys, dismissedKeys);
  const calendarCount = obligations.filter(row => row.source === "event").length;
  const headerActions = <div className="proposed-agenda-header-actions">
    <button className="proposed-agenda-model" onClick={ onChangeModel } title="Change AI provider" type="button">
      <span aria-hidden="true">◎</span>{ _modelName(modelProviderEm) }<span aria-hidden="true">⌄</span></button>
    <button className="proposed-agenda-regenerate" onClick={ () => runGeneration({ forceRegenerate: true }) } type="button">
      <span aria-hidden="true">⟳</span> Regenerate</button>
  </div>;

  // ------------------------------------------------------------------------------------------
  // @desc Save the visible agenda into dated notes for review without scheduling its suggestions.
  // @returns {Promise<void>} Opens the final saved note or reports a failure without hiding the agenda.
  const onAccept = async () => {
    setApproving(true);
    try {
      let savedNote;
      for (const group of dayGroups) {
        const targetDate = group.targetMidnightSeconds || dateValue;
        const { note } = await prepareAgendaNote(app, { domainName: recordDomainName, domainUuid: recordDomainUuid, targetDate });
        await populateAgendaNote(app, note, group.rows);
        savedNote = note;
      }
      if (savedNote) await app.navigate(`https://www.amplenote.com/notes/${ savedNote.uuid }`);
    } catch (error) {
      await app.alert(error?.message || "Could not save this agenda. Please try again.");
    } finally {
      setApproving(false);
    }
  };

  return (
    <>
      <WidgetWrapper headerActions={ headerActions } subtitle="" widgetId={ WIDGET_ID }>
        <div className="proposed-agenda-overview">
          { dateControl }
          <p className="proposed-agenda-day-summary">{ calendarCount } calendar { calendarCount === 1 ? "event" : "events" }
            { " · " }{ rows.length } { dayGroups.length > 1 ? "items across this range" : "items on the day" }</p>
        </div>
        <ProposedAgendaPriorityControl dateValue={ dateValue } onPriorityChange={ onPriorityChange } priorityKey={ priorityKey } />
        <div className="proposed-agenda-list" ref={ listRef }>
          { dayGroups.map(dayGroup => (
            <div className="proposed-agenda-day-group" key={ dayGroup.targetMidnightSeconds ?? "undated" }>
              { dayGroups.length > 1 && dayGroup.dayHeading
                ? <h4 className="proposed-agenda-day-heading">{ dayGroup.dayHeading }</h4> : null }
              { dayGroup.rows.map(row => (
                <ActivityRow key={ activityKey(row) } onDismiss={ onDismiss } onOpenNote={ onOpenNote }
                  onSchedule={ onSchedule } row={ row } scheduledKeys={ scheduledKeys } timeFormat={ timeFormat } />
              )) }
            </div>
          )) }
        </div>
        <div className="proposed-agenda-footer">
          <span className="proposed-agenda-pending">{ pending } { pending === 1 ? "suggestion" : "suggestions" } unscheduled
            { " · " }{ rows.length } on the { dayGroups.length > 1 ? "agenda" : "day" }</span>
          <button className="proposed-agenda-schedule-all" disabled={ approving || pending === 0 } onClick={ onApprove } type="button">
            Schedule all</button>
          <button className="proposed-agenda-approve" disabled={ approving }
            onClick={ onAccept } title="Save this agenda to its dated note" type="button">
            { approving ? "Saving …" : "Accept agenda" }</button>
        </div>
        <div className="proposed-agenda-secondary-footer">
          { attribution ? <span className="proposed-agenda-attribution">{ attribution }</span> : null }
          <button className="proposed-agenda-dismiss-all" disabled={ approving || pending === 0 } onClick={ onDismissAll } type="button">
            Dismiss all suggestions</button>
        </div>
      </WidgetWrapper>
      { providerPopupOpen
        ? <LlmProviderSelector allowKeylessProviders={ ampleAgentProAvailable }
            configuredProviderEms={ configuredProviderEms(pluginSettings()) } currentProviderEm={ modelProviderEm }
            onCancel={ () => setProviderPopupOpen(false) } onSelect={ onSelectProvider } submitLabel="Submit"
            title="Generate the agenda with which AI provider?" />
        : null }
    </>
  );
}
