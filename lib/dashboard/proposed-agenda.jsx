// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "redesign the proposed-agenda widget: a Today's-priority selector + changeable AI model, an
//   hour-by-hour list that interleaves already-scheduled obligations with LLM proposals (Add to schedule /
//   dismiss), and an Approve schedule / Dismiss all footer with a pending count"
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers";
import { configuredProviderEms, SETTING_KEYS, widgetTitleFromId } from "constants/settings";
import LlmProviderSelector from "llm-provider-selector";
import NoConfigUpsell from "no-config-upsell";
import { pluginSettings, updatePluginSetting } from "plugin-data";
import { PROPOSED_TASK_STATUS } from "proposed-agenda-archive";
import { DEFAULT_PRIORITY_KEY, PROPOSED_AGENDA_PRIORITY_OPTIONS } from "proposed-agenda-priority";
import { activityKey, approveAllProposed, mergedAgendaRows, pendingCount, recordProposedTaskStatus,
  runProposedAgendaGeneration, scheduleProposedRow } from "proposed-agenda-llm-generator";
import { AMPLE_AGENT_PRO_NOTE_NAME } from "providers/ai-provider-settings";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { formatClockLabel } from "util/date-utility";
import { snapDashboardAction } from "util/plausible";
import WidgetWrapper from "widget-wrapper";

import "styles/proposed-agenda.scss";

const WIDGET_ID = "proposed-agenda";

// Error codes that mean generation failed for want of a reachable LLM (no API key + no working Ample Agent Pro).
// When there is also no configured key, we show the Ample Agent Pro upsell instead of a bare error, matching
// how DreamTask degrades.
const NO_CONFIG_ERROR_CODES = new Set(["invalid_api_key", "llm_error", "no_provider_configured", "parse_error"]);

// [Claude claude-opus-4-8 (1M context)] Task: scheduling-focused features highlighted in the no-config upsell
// Prompt: "we will highlight different features" (vs. DreamTask's goal-coach features)
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
// [Claude claude-opus-4-8 (1M context)] Task: derive the displayed model name from the provider
function _modelName(providerEm) {
  return PROVIDER_DEFAULT_MODEL[providerEm] || providerEm || "default model";
}

// ----------------------------------------------------------------------------------------------
// @desc Loading placeholder shown while obligations are derived and the LLM builds the schedule.
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
// @desc The Today's-priority selector and the changeable AI-model pill above the agenda list.
// @param {object} props - { modelName, onChangeModel, onPriorityChange, priorityKey }.
// [Claude claude-opus-4-8 (1M context)] Task: render the priority selector + model-change control
function PriorityModelBar({ modelName, onChangeModel, onPriorityChange, priorityKey }) {
  return (
    <div className="proposed-agenda-controls">
      <label className="proposed-agenda-priority-label">Today's priority</label>
      <select className="proposed-agenda-priority-select" value={ priorityKey } onChange={ onPriorityChange }>
        {
          PROPOSED_AGENDA_PRIORITY_OPTIONS.map(option => (
          <option key={ option.key } value={ option.key }>{ option.label }</option>))
        }
      </select>
      <span className="proposed-agenda-model" title="AI model used to generate this agenda">🌐 { modelName }</span>
      <button className="proposed-agenda-model-change" title="Change AI provider" onClick={ onChangeModel }>⇅</button>
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc One agenda row. Already-scheduled obligations and just-scheduled proposals render greyed with a
//   "Scheduled" badge; pending proposals show their reason plus Add-to-schedule and dismiss controls. A "Note"
//   link beneath the timestamp opens the note backing the row's task (when one is linkable).
// @param {object} props - { onDismiss, onOpenNote, onSchedule, row, scheduledKeys, timeFormat }.
// [Claude claude-opus-4-8 (1M context)] Task: render an obligation or proposed-activity row
function ActivityRow({ onDismiss, onOpenNote, onSchedule, row, scheduledKeys, timeFormat }) {
  const isScheduled = row.isObligation || scheduledKeys.has(activityKey(row));
  const titleHtml = amplenoteMarkdownRender(row.title) || row.title;
  const hasNote = !!(row.noteUuid || row.taskUuid);
  return (
    <div className={ `proposed-agenda-item${ isScheduled ? " proposed-agenda-item--scheduled" : "" }` }>
      <span className="proposed-agenda-time-col">
        <span className={ `proposed-agenda-time${ isScheduled ? " proposed-agenda-time--muted" : "" }` }>
          { formatClockLabel(row.startMinutes, timeFormat) }</span>
        {
          hasNote
          ? <a href="#" className="proposed-agenda-note-link" title="Open the note for this task" onClick={ (event) => onOpenNote(event, row) }>Note</a>
          : null
        }
      </span>
      <div className="proposed-agenda-content">
        <span className="proposed-agenda-text" dangerouslySetInnerHTML={ { __html: titleHtml } } />
        { !row.isObligation && row.reason
          ? <span className="proposed-agenda-reason">{ row.reason }</span> : null }
      </div>
      { row.durationMinutes
        ? <span className="proposed-agenda-duration">{ `${ row.durationMinutes }m` }</span> : null }
      { isScheduled
        ? <span className="proposed-agenda-scheduled-badge" title="Already scheduled today">Scheduled</span>
        : <span className="proposed-agenda-actions">
            <button className="proposed-agenda-add" title={ `Schedule for ${ row.startTime } today` }
              onClick={ (event) => onSchedule(event, row) }>📅 Add to schedule</button>
            <button className="proposed-agenda-dismiss" title="Dismiss this suggestion"
              onClick={ (event) => onDismiss(event, row) }>×</button>
          </span>
      }
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Proposed Agenda widget — derives today's immovable obligations, asks the configured LLM to fill the
//   gaps for the selected "Today's priority", and lets the user schedule/dismiss each proposal or the whole set.
// @param {object} props - { app, currentDate, defaultNoteUuid, providerApiKey, providerEm, taskDomainUUID,
//   timeFormat }.
export default function ProposedAgendaWidget({ app, currentDate, defaultNoteUuid, providerApiKey, providerEm,
    taskDomainUUID, timeFormat }) {
  // The widget's persisted "Today's priority" and AI-provider choices, seeded from the same SETTING_KEYS
  const persistedPriorityKey = pluginSettings()[SETTING_KEYS.PROPOSED_AGENDA_PRIORITY] || null;
  const persistedProviderEm = pluginSettings()[SETTING_KEYS.PROPOSED_AGENDA_LLM] || null;

  const [approving, setApproving] = useState(false);
  const [ampleAgentProAvailable, setAmpleAgentProAvailable] = useState(false);
  const [attribution, setAttribution] = useState(null);
  const [dateLabel, setDateLabel] = useState(null);
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modelProviderEm, setModelProviderEm] = useState(persistedProviderEm || providerEm || null);
  const [obligations, setObligations] = useState([]);
  const [priorityKey, setPriorityKey] = useState(persistedPriorityKey || DEFAULT_PRIORITY_KEY);
  const [proposed, setProposed] = useState([]);
  const [providerPopupOpen, setProviderPopupOpen] = useState(false);
  const [recordProviderEm, setRecordProviderEm] = useState(null);
  const [scheduledKeys, setScheduledKeys] = useState(() => new Set());
  const listRef = useRef(null);

  // Identifies the stored monthly line for the agenda currently on screen (the llmDateRecord: which date,
  // priority, and LLM), so schedule/dismiss decisions are written back to the right entry.
  const llmDateRecord = useMemo(() => ({ date: currentDate, priorityKey, providerEm: recordProviderEm }),
    [currentDate, priorityKey, recordProviderEm]);

  // providerApiKey is included so that adding an API key in Dashboard Settings (which leaves providerEm
  // unchanged) still re-triggers generation, letting the widget recover from the no-provider state.
  const runGeneration = useCallback(({ forceRegenerate = false } = {}) => runProposedAgendaGeneration(app,
    { currentDate, domainUuid: taskDomainUUID, forceRegenerate, priorityKey, providerEm: modelProviderEm, setApproving,
    setAttribution, setDateLabel, setDismissedKeys, setError, setLoading, setObligations, setProposed,
    setRecordProviderEm, setScheduledKeys }),
    [app, currentDate, modelProviderEm, priorityKey, providerApiKey, taskDomainUUID]);

  const onChangeModel = useCallback(() => setProviderPopupOpen(true), []);

  // [Claude claude-opus-4-8 (1M context)] Task: persist the chosen provider so it is restored on reload
  // Prompt: "persist it via app.setSetting, using a const key name"
  const onSelectProvider = useCallback((selectedProviderEm) => {
    setProviderPopupOpen(false);
    if (selectedProviderEm && selectedProviderEm !== modelProviderEm) {
      setModelProviderEm(selectedProviderEm);
      app.setSetting(SETTING_KEYS.PROPOSED_AGENDA_LLM, selectedProviderEm);
      updatePluginSetting(SETTING_KEYS.PROPOSED_AGENDA_LLM, selectedProviderEm);
    }
  }, [app, modelProviderEm]);

  // [Claude claude-opus-4-8 (1M context)] Task: persist the chosen "Today's priority" so it is restored on reload
  // Prompt: "persist it via app.setSetting, using a const key name"
  const onPriorityChange = useCallback(event => {
    const nextKey = event.target.value;
    setPriorityKey(nextKey);
    app.setSetting(SETTING_KEYS.PROPOSED_AGENDA_PRIORITY, nextKey);
    updatePluginSetting(SETTING_KEYS.PROPOSED_AGENDA_PRIORITY, nextKey);
  }, [app]);

  const onDismiss = useCallback((event, row) => {
    event.preventDefault();
    setDismissedKeys(previous => new Set(previous).add(activityKey(row)));
    recordProposedTaskStatus(app, llmDateRecord, [activityKey(row)], PROPOSED_TASK_STATUS.DISMISSED);
  }, [app, llmDateRecord]);

  const onDismissAll = useCallback(() => {
    const dismissing = proposed.filter(a => !scheduledKeys.has(activityKey(a))).map(activityKey);
    setDismissedKeys(previous => { const next = new Set(previous); dismissing.forEach(key => next.add(key)); return next; });
    recordProposedTaskStatus(app, llmDateRecord, dismissing, PROPOSED_TASK_STATUS.DISMISSED);
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

  useEffect(() => { runGeneration(); }, [runGeneration]);
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

  if (loading) return <LoadingState />;
  if (error) {
    const envApiKey = (typeof process !== "undefined" && process.env?.OPEN_AI_ACCESS_TOKEN) || "";
    const hasLlmConfig = !!(envApiKey || providerApiKey);
    if (!hasLlmConfig && NO_CONFIG_ERROR_CODES.has(error.errorCode)) {
      return (
        <NoConfigUpsell app={ app } features={ NO_CONFIG_FEATURES } icon="🗓️"
          moreFeaturesLabel="+ 15 more features included" title={ widgetTitleFromId(WIDGET_ID) } widgetId={ WIDGET_ID } />
      );
    }
    return <MessageState message={ error.error } onRetry={ () => runGeneration() } />;
  }

  const rows = mergedAgendaRows(obligations, proposed, dismissedKeys);
  if (rows.length === 0) {
    return <MessageState message="No schedule could be proposed yet." onRetry={ () => runGeneration() } />;
  }
  const pending = pendingCount(proposed, scheduledKeys, dismissedKeys);
  const reseedAction = (
    <a href="#" className="widget-header-action" title="Propose a fresh schedule (replaces today's saved set)"
      onClick={ (event) => { event.preventDefault(); runGeneration({ forceRegenerate: true }); } }>🔄 Reseed</a>
  );

  return (
    <>
      <WidgetWrapper title={ widgetTitleFromId(WIDGET_ID) } subtitle={ dateLabel } icon="🗓️"
          widgetId={ WIDGET_ID } headerActions={ reseedAction }>
        <PriorityModelBar modelName={ _modelName(modelProviderEm) } onChangeModel={ onChangeModel }
          onPriorityChange={ onPriorityChange } priorityKey={ priorityKey } />
        <div className="proposed-agenda-list" ref={ listRef }>
          { rows.map(row => (
            <ActivityRow key={ activityKey(row) } onDismiss={ onDismiss } onOpenNote={ onOpenNote }
              onSchedule={ onSchedule } row={ row } scheduledKeys={ scheduledKeys } timeFormat={ timeFormat } />
          )) }
        </div>
        <div className="proposed-agenda-footer">
          <button className="proposed-agenda-approve" onClick={ onApprove } disabled={ approving || pending === 0 }>
            { approving ? "Approving …" : "Approve schedule" }</button>
          <button className="proposed-agenda-dismiss-all" onClick={ onDismissAll } disabled={ pending === 0 }>
            Dismiss all</button>
        </div>
        <p className="proposed-agenda-pending">{ `${ pending } pending` }</p>
        { attribution ? <p className="proposed-agenda-attribution">{ attribution }</p> : null }
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
