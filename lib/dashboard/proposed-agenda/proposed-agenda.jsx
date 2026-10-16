// Render the proposed agenda with date navigation, priority choices, and scheduling actions.
import { calendarSuggestionExplanation } from "dashboard/suggestions/calendar-suggestion-explanation";
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers";
import { configuredProviderEms, SETTING_KEYS } from "constants/settings";
import { useWidgetLoadedEvent } from "dashboard/dashboard-load-tracking";
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { preparedDayRankingAwaiter } from "dashboard/work-queue/prepared-day-ranking";
import LlmProviderSelector from "dashboard/llm-provider-selector";
import NoConfigUpsell from "dashboard/no-config-upsell";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { PROPOSED_TASK_STATUS, saveAgendaReplacement } from "dashboard/proposed-agenda/proposed-agenda-archive";
import ProposedAgendaDateControl from "dashboard/proposed-agenda/proposed-agenda-date-control";
import { activityKey, approveAllProposed, mergedAgendaRows, pendingCount, recordProposedRowStatuses,
  runProposedAgendaGeneration, scheduleProposedRow } from "dashboard/proposed-agenda/proposed-agenda-llm-generator";
import ProposedAgendaMessage from "dashboard/proposed-agenda/proposed-agenda-message";
import { populateAgendaNote, prepareAgendaNote } from "dashboard/proposed-agenda/proposed-agenda-note";
import { DEFAULT_PRIORITY_KEY } from "dashboard/proposed-agenda/proposed-agenda-priority";
import ProposedAgendaPriorityControl from "dashboard/proposed-agenda/proposed-agenda-priority-control";
import { agendaRowsGroupedByDay } from "dashboard/proposed-agenda/proposed-agenda-range";
import { resolveProposedAgendaDate } from "dashboard/proposed-agenda/proposed-agenda-service";
import { isAmpleAgentProInstalled } from "providers/ai-provider-settings";
import { refillAndRecordSuggestion } from "dashboard/suggestions/ranked-task-suggestions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logIfEnabled } from "util/log";
import "dashboard/styles/dashboard-tippy.scss";
import "dashboard/styles/proposed-agenda.scss";
import tippy from "tippy.js";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { calendarEventDateFromValue } from "util/calendar-utility";
import { dateFromDateInput, dateKeyFromDateInput, formatClockLabel } from "util/date-utility";
import { snapDashboardAction } from "util/plausible";
import WidgetWrapper from "dashboard/widget-wrapper";

const WIDGET_ID = "proposed-agenda";
// How long the first generation waits for the Dashboard's calendar events before planning the day without them.
const CALENDAR_EVENTS_WAIT_MILLISECONDS = 5000;

// Error codes that mean generation failed for want of a reachable LLM (no API key + no working Ample Agent Pro).
// When there is also no configured key, the Ample Agent Pro upsell shows if Agent Pro is not installed, and
// AGENT_PRO_FAILED_MESSAGE with a retry shows if it is, matching how DreamTask degrades.
const NO_CONFIG_ERROR_CODES = new Set(["invalid_api_key", "llm_error", "no_provider_configured", "parse_error"]);
const AGENT_PRO_FAILED_MESSAGE = "Ample Agent Pro didn't return a schedule. Please try again in a moment.";

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
// @desc Attach a tooltip holding the full rationale to the one-line reason element. The tooltip waits 500ms of
//   hover before appearing, and only appears when the line is truncated, since otherwise it would repeat what
//   is already visible. Content is set as plain text because the rationale is LLM-written.
// @param {string|null} reason - The full rationale text, or null when the row has none.
// @returns {object} A ref to place on the reason element.
function useReasonTooltip(reason) {
  const reasonRef = useRef(null);
  useEffect(() => {
    if (!reason || !reasonRef.current) return undefined;
    const reasonElement = reasonRef.current;
    const instance = tippy(reasonElement, { arrow: true, content: reason, delay: [500, 0], duration: [120, 80],
      maxWidth: 360, offset: [0, 8], onShow: () => reasonElement.scrollWidth > reasonElement.clientWidth,
      placement: "bottom-start", theme: "dashboard" });
    return () => instance.destroy();
  }, [reason]);
  return reasonRef;
}

// ----------------------------------------------------------------------------------------------
// @desc One agenda row. Already-scheduled obligations and just-scheduled proposals retain readable titles with a
//   "Scheduled" badge; proposals explain their project, completion benefit, and applicable preferred weekday using
//   the calendar's formatter. Pending proposals also show Add-to-schedule and dismiss controls. A "Note" link
//   beneath the timestamp opens the note backing the row's task (when one is linkable).
// @param {object} props - { onDismiss, onOpenNote, onSchedule, row, scheduledKeys, timeFormat }.
// @returns {JSX.Element} Agenda row with the same explanation in desktop, tooltip, and expanded mobile views.
function ActivityRow({ onDismiss, onOpenNote, onSchedule, row, scheduledKeys, timeFormat }) {
  const [reasonExpanded, setReasonExpanded] = useState(false);
  const isScheduled = row.isObligation || scheduledKeys.has(activityKey(row));
  const titleHtml = amplenoteMarkdownRender(row.title) || row.title;
  const hasNote = !!(row.noteUuid || row.taskUuid);
  const reason = row.isObligation ? "" : calendarSuggestionExplanation(row);
  const hasReason = !!reason;
  const reasonRef = useReasonTooltip(hasReason ? reason : null);
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
          { hasReason
            ? <span className="proposed-agenda-reason proposed-agenda-reason--desktop" ref={ reasonRef }>{ reason }</span>
            : null }
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
        ? <div className="proposed-agenda-reason proposed-agenda-reason--mobile">{ reason }</div> : null }
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
        <div className="proposed-agenda-spinner" />
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
  // The Dashboard passes null while it is still fetching calendar events, which the host can take most of a minute to
  // return. The first generation waits a few seconds for them, then plans the day provisionally without them; their
  // arrival generates again, refining that day with the meetings it did not know of. Undefined means no calendar source
  // was given at all, and generation proceeds.
  const [calendarWaitExpired, setCalendarWaitExpired] = useState(false);
  const calendarPending = calendarEvents === null && calendarWaitExpired;
  const awaitingCalendarEvents = calendarEvents === null && !calendarWaitExpired;
  const pendingGenerationRanRef = useRef(false);
  useEffect(() => {
    if (!awaitingCalendarEvents) return undefined;
    const timer = setTimeout(() => setCalendarWaitExpired(true), CALENDAR_EVENTS_WAIT_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [awaitingCalendarEvents]);

  const calendarEventsKey = useMemo(() => {
    if (calendarPending) return "pending";
    if (!Array.isArray(calendarEvents)) return null;
    const eventIdentities = calendarEvents.map(event => [ calendarEventDateFromValue(event?.start)?.getTime() ?? "",
      calendarEventDateFromValue(event?.end)?.getTime() ?? "", event?.title || "", event?.allDay ? "1" : "0" ].join("|"));
    return eventIdentities.join("~");
  }, [calendarEvents, calendarPending]);

  const [approving, setApproving] = useState(false);
  // Null until the Agent Pro lookup answers, so the upsell never shows to a subscriber while it is in flight
  const [ampleAgentProAvailable, setAmpleAgentProAvailable] = useState(null);
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
  const [reserveTasks, setReserveTasks] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const generationRef = useRef(0);
  const [scheduledKeys, setScheduledKeys] = useState(() => new Set());
  // A cache miss has the Dashboard's work queue prepare the day's shared ranking first; read through a ref so the
  // runtime arriving after mount does not regenerate the agenda.
  const work = useDashboardWork();
  const rankingPreparer = useMemo(() => preparedDayRankingAwaiter(work?.runtime?.durable || null), [work]);
  const rankingPreparerRef = useRef(rankingPreparer);
  rankingPreparerRef.current = rankingPreparer;
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
  const runGeneration = useCallback(() => {
    const generation = ++generationRef.current;
    const setters = { setApproving, setAttribution, setDateLabel, setDismissedKeys, setError, setIsFutureDay,
      setLoading, setObligations, setProjectNotice, setProposed, setRecordDomainName, setRecordDomainUuid,
      setRecordProviderEm, setReserveTasks, setScheduledKeys };
    const guardedSetters = Object.fromEntries(Object.entries(setters).map(([name, setter]) =>
      [name, value => { if (generation === generationRef.current) setter(value); }]));
    const refining = !calendarPending && pendingGenerationRanRef.current;
    pendingGenerationRanRef.current = calendarPending;
    return runProposedAgendaGeneration(app, { calendarEvents: calendarPending ? [] : calendarEvents, calendarPending,
      currentDate, dateRange, domainName: taskDomainName, domainUuid: taskDomainUUID, explicitDate: selectedDate,
      isCurrentGeneration: () => generation === generationRef.current, priorityKey,
      providerEm: modelProviderEm, rankingPreparer: rankingPreparerRef.current, refining, ...guardedSetters }).catch(error => {
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
    const sameDay = activity => activity.targetMidnightSeconds === row.targetMidnightSeconds;
    const sameDayActivities = proposed.filter(activity => sameDay(activity) && !dismissedKeys.has(activityKey(activity))
      && activityKey(activity) !== activityKey(row));
    const nowMinutes = isFutureDay ? null : new Date().getHours() * 60 + new Date().getMinutes();
    const targetDate = row.targetMidnightSeconds ? new Date(row.targetMidnightSeconds * 1000) : llmDateRecord.date;
    refillAndRecordSuggestion(app, { activities: sameDayActivities, domainName: recordDomainName,
      domainUuid: recordDomainUuid, nowMinutes, obligations: obligations.filter(sameDay),
      preferredStartMinutes: row.startMinutes, reserveTasks: reserveTasks.filter(sameDay), targetDate,
      targetMidnightSeconds: row.targetMidnightSeconds }).then(refill => {
      if (!refill.placed) return;
      setProposed(previous => [...previous, refill.placed]);
      setReserveTasks(previous => [...previous.filter(task => !sameDay(task)), ...refill.reserveTasks]);
      saveAgendaReplacement(app, { activity: refill.placed, date: targetDate, domainName: recordDomainName,
        domainUuid: recordDomainUuid, priorityKey, providerEm: recordProviderEm, reserveTasks: refill.reserveTasks })
        .catch(error => logIfEnabled("[proposed-agenda] failed to store replacement suggestion", error?.message));
    });
  }, [app, dismissedKeys, isFutureDay, llmDateRecord, obligations, priorityKey, proposed, recordDomainName,
    recordDomainUuid, recordProviderEm, reserveTasks]);

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

  // The first run waits for the calendar events, or for CALENDAR_EVENTS_WAIT_MILLISECONDS to pass without them.
  useEffect(() => {
    if (awaitingCalendarEvents) return undefined;
    runGeneration();
    return () => { generationRef.current += 1; };
  }, [awaitingCalendarEvents, runGeneration]);
  useEffect(() => { attachFootnotePopups(listRef.current); }, [obligations, proposed]);

  // Adopt the dashboard-configured provider when it changes and the user has not picked one inside the widget,
  // so configuring an AI provider in Dashboard Settings flows through here (re-triggering generation) instead of
  // the widget staying stuck on the "No AI provider configured" state.
  useEffect(() => {
    if (persistedProviderEm) return;
    if (providerEm && providerEm !== modelProviderEm) setModelProviderEm(providerEm);
  }, [providerEm, persistedProviderEm]);

  // Detect whether the Ample Agent Pro plugin is installed. When it is, the provider chooser may offer providers
  // the user has no local key for, because the chosen provider is passed to Agent Pro as an argument. It also decides
  // whether a keyless failure is a missing provider (the upsell) or an Agent Pro request that failed (a retry).
  useEffect(() => {
    let cancelled = false;
    isAmpleAgentProInstalled(app).then(installed => { if (!cancelled) setAmpleAgentProAvailable(installed); });
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
    const isKeylessFailure = !hasLlmConfig && NO_CONFIG_ERROR_CODES.has(error.errorCode);
    if (isKeylessFailure && ampleAgentProAvailable === null) return <LoadingState dateControl={ dateControl } />;
    // Only a confirmed absence of Agent Pro shows the upsell. With it installed, a keyless failure means Agent Pro
    // did not answer, which a retry may fix.
    if (isKeylessFailure && ampleAgentProAvailable === false) {
      return (
        <NoConfigUpsell app={ app } features={ NO_CONFIG_FEATURES }
          moreFeaturesLabel="+ 15 more features included" widgetId={ WIDGET_ID } />
      );
    }
    const message = isKeylessFailure ? AGENT_PRO_FAILED_MESSAGE : error.error;
    return <ProposedAgendaMessage app={ app } dateControl={ dateControl } message={ message } noteUuid={ error.noteUuid }
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
          <ProposedAgendaPriorityControl dateValue={ dateValue } onPriorityChange={ onPriorityChange } priorityKey={ priorityKey } />
        </div>
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
        ? <LlmProviderSelector allowKeylessProviders={ ampleAgentProAvailable === true }
            configuredProviderEms={ configuredProviderEms(pluginSettings()) } currentProviderEm={ modelProviderEm }
            onCancel={ () => setProviderPopupOpen(false) } onSelect={ onSelectProvider } submitLabel="Submit"
            title="Generate the agenda with which AI provider?" />
        : null }
    </>
  );
}
