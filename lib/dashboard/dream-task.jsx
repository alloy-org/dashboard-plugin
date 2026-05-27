import confetti from "canvas-confetti";
import { apiKeyFromProvider, SETTING_KEYS, widgetDataFromId, widgetTitleFromId } from "constants/settings";
import { _loadSeenUuidsMap, _maxTasksFromGrid, _recordSeenUuids, _taskGenerateCount, _todayProposedTasksNoteName,
  applyDreamTaskAnalysisResult, fetchDreamTaskSuggestions, handleOpenSettings, handleTaskClick,
  requestDreamTaskRefreshExcludingRecent, shouldFetchMoreTasksAfterGridGrowth, updateDreamTaskTaskMetadata,
} from "dream-task-internals";
import { chooseReseedProvider, configuredProvidersFromSettings } from "dream-task-provider-selection";
import { buildAvailableTimeSlots, fetchSchedulingOccupancy, scheduledDreamTaskResultFromStartAt,
  startAtSecondsFromDateAndMinutes } from "dream-task-schedule";
import { pluginSettings } from "plugin-data";
import { providerNameFromProviderEm } from "providers/ai-provider-settings";
import { useEffect, useState, useCallback, useRef } from "react";
import { DASHBOARD_TASKS_UPDATED_EVENT } from "hooks/use-dashboard-task-updates";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { logIfEnabled } from "util/log";
import { dailyJotNoteUuidFromToday, markTaskComplete } from "util/task-util";
import CopyLink from "copy-link";
import WidgetWrapper from "widget-wrapper";

import "styles/dream-task.scss";

const MIN_TEXT_OVERFLOW_SIZE = 230;
const WIDGET_ID = 'dream-task';
const CARD_REMOVE_FADE_MS = 280;
const NO_CONFIG_ERROR_CODES = new Set(['llm_error', 'no_provider_configured', 'parse_error', 'invalid_api_key']);

// ----------------------------------------------------------------------------------------------
// @desc Build a single diagnostic object capturing every input that influences whether the widget
//   can reach paths 1 (cached note), 2 (Ample Agent Pro callPlugin), or 3 (direct llmPrompt).
function _describeDreamTaskConfigSnapshot(app, providerEm, providerApiKey, envApiKey) {
  const settings = app?.settings || {};
  const rawLlmProvider = settings[SETTING_KEYS.LLM_PROVIDER_MODEL] ?? null;
  const providerSettingKey = providerEm ? apiKeyFromProvider(providerEm) : null;
  const settingsKeyLength = (settingKey) => {
    const value = settingKey ? settings[settingKey] : null;
    return typeof value === 'string' ? value.trim().length : 0;
  };
  const apiKeyLengthByProvider = {
    anthropic: settingsKeyLength(SETTING_KEYS.LLM_API_KEY_ANTHROPIC),
    gemini: settingsKeyLength(SETTING_KEYS.LLM_API_KEY_GEMINI),
    grok: settingsKeyLength(SETTING_KEYS.LLM_API_KEY_GROK),
    openai: settingsKeyLength(SETTING_KEYS.LLM_API_KEY_OPENAI),
  };
  const configuredProviderBuckets = Object.entries(apiKeyLengthByProvider)
    .filter(([, length]) => length > 0).map(([bucket]) => bucket);
  return {
    propProviderEm: providerEm ?? null,
    propProviderApiKeyLength: typeof providerApiKey === 'string' ? providerApiKey.trim().length : 0,
    envApiKeyLength: typeof envApiKey === 'string' ? envApiKey.length : 0,
    settingsLlmProvider: rawLlmProvider,
    propProviderSettingKey: providerSettingKey,
    settingsKeyLengthForProp: settingsKeyLength(providerSettingKey),
    apiKeyLengthByProvider,
    configuredProviderBuckets,
    hasCallPlugin: typeof app?.callPlugin === 'function',
  };
}

// =============================================================================
// Render helpers — markup, loading/error/empty states, task cards
// =============================================================================

function _selectDisplayTasks(tasks, maxTasks) {
  const sorted = [...tasks].sort((a, b) => b.rating - a.rating);
  return sorted.slice(0, maxTasks);
}

function _ratingTier(rating) {
  if (rating >= 8) return 'high';
  if (rating >= 5) return 'medium';
  return 'low';
}

function _taskKey(task) {
  return task?.suggestionId || task?.uuid || `${task?.title || 'untitled'}::${task?.rating || 0}::${task?.explanation || ''}`;
}

function widgetIcon() {
  return widgetDataFromId(WIDGET_ID).icon;
}

// [Claude claude-4.7-opus] Task: convert kind badge render fn to JSX component
// Prompt: "translate this project to render components with JSX instead"
function DreamTaskKindBadge({ isClickable, task }) {
  if (task.isExisting && task.sourceNoteName) {
    return (
      <span
        className="dream-task-source-note-badge"
        title={task.sourceNoteName ? `Task in note: ${ task.sourceNoteName }` : 'Open this task'}
      >{task.sourceNoteName}</span>
    );
  }
  if (!task.isExisting && isClickable) {
    return <span className="dream-task-new-badge" title="New task — click to create">+new</span>;
  }
  return null;
}

function NoteLink({ noteUUID, onOpenNote }) {
  if (!noteUUID) return null;
  return (
    <a
      href="#"
      className="widget-header-action"
      onClick={onOpenNote}
      title="Open today's proposed tasks note"
    >🗒️ Note</a>
  );
}

function ReseedLink({ onReseed }) {
  return (
    <a
      href="#"
      className="widget-header-action"
      onClick={onReseed}
      title="Get new task suggestions (excludes tasks shown today)"
    >🔄 Reseed</a>
  );
}

function LoadingState() {
  return (
    <WidgetWrapper title={widgetTitleFromId(WIDGET_ID)} icon={widgetIcon()} widgetId={WIDGET_ID}>
      <div className="dream-task-loading">
        <div className="dream-task-spinner" />
        <p>Analyzing the finest tasks …</p>
      </div>
    </WidgetWrapper>
  );
}

// [Claude claude-sonnet-4-6] Task: suggest Amplenote AI plugin when no API key is configured
function NoConfigState({ onSettingsClick, providerName }) {
  const message = providerName
    ? `No API key is available for the currently selected AI provider, ${ providerName }.`
    : `DreamTask uses AI to suggest tasks aligned with your goals (as defined in the dashboard's "${ widgetTitleFromId("planning") }" component). An LLM provider and API key are required`;
  return (
    <WidgetWrapper title={widgetTitleFromId(WIDGET_ID)} icon={widgetIcon()} widgetId={WIDGET_ID}>
      <div className="dream-task-no-config">
        <p className="dream-task-no-config-text">{message}</p>
        <p className="dream-task-no-config-text">
          {'No API key? Install '}
          <CopyLink url="https://www.amplenote.com/plugins/ample_agent_pro" className="dream-task-settings-link">
            Amplenote’s AI integration
          </CopyLink>
          {' to enable suggested tasks and 10+ other AI features — no API key required.'}
        </p>
        <p className="dream-task-no-config-text">
          <a href="#" className="dream-task-settings-link" onClick={onSettingsClick}>Configure AI settings →</a>
        </p>
      </div>
    </WidgetWrapper>
  );
}

// [Claude claude-opus-4-6] Task: render specific error messages based on errorCode from the service
function ErrorState({ errorInfo, noteLink, onRetry, onSettingsClick }) {
  const { error, errorCode, errorDetail, providerName } = errorInfo;
  let content;
  switch (errorCode) {
    case 'invalid_api_key':
      content = (
        <>
          <p>{`The API key for ${ providerName || 'your AI provider' } appears to be invalid or unauthorized.`}</p>
          <p>
            {'Please check your API key in '}
            <a href="#" className="dream-task-settings-link" onClick={onSettingsClick}>AI settings</a>
            .
          </p>
        </>
      );
      break;
    case 'no_planning_data':
      content = (
        <>
          <p>DreamTask needs planning context to generate suggestions.</p>
          <p>Populate your quarterly and/or monthly plan to receive AI-suggested tasks.</p>
        </>
      );
      break;
    case 'parse_error':
      content = (
        <>
          <p>Unable to successfully process the AI provider's response.</p>
          <p className="dream-task-error-detail">
            {'If this persists, please contact support@amplenote.com'}
            {errorDetail ? ` with this detail: ${ errorDetail }` : ''}
          </p>
        </>
      );
      break;
    default:
      content = <p>{error || 'An unexpected error occurred.'}</p>;
  }
  return (
    <WidgetWrapper title={widgetTitleFromId(WIDGET_ID)} icon={widgetIcon()} widgetId={WIDGET_ID} headerActions={noteLink}>
      <div className="dream-task-error">
        {content}
        <button className="dream-task-retry" onClick={onRetry}>Retry</button>
      </div>
    </WidgetWrapper>
  );
}

function EmptyState({ noteLink, onRetry }) {
  return (
    <WidgetWrapper title={widgetTitleFromId(WIDGET_ID)} icon={widgetIcon()} widgetId={WIDGET_ID} headerActions={noteLink}>
      <div className="dream-task-empty">
        <p>No task suggestions available.</p>
        <button className="dream-task-retry" onClick={onRetry}>Refresh</button>
      </div>
    </WidgetWrapper>
  );
}

// [Claude claude-4.7-opus] Task: convert renderTaskList to JSX TaskList component
// Prompt: "translate this project to render components with JSX instead"
function TaskList({ dreamTasks, maxTasks, headerActions, onTaskClick, listRef, llmAttributionFooter, actionHandlers }) {
  const t0 = performance.now();
  const displayDreamTasks = _selectDisplayTasks(dreamTasks, maxTasks);
  logIfEnabled(`[DreamTask] _selectDisplayTasks: ${(performance.now() - t0).toFixed(1)}ms (${dreamTasks.length} → ${displayDreamTasks.length} tasks)`);

  const {
    dismissingTaskKeys, expandedExplanationKeys, onComplete, onPreserve, onRemove, onSchedule, onToggleExplanation,
  } = actionHandlers;

  return (
    <WidgetWrapper
      headerActions={headerActions}
      subtitle="What if you did it today?"
      title={widgetTitleFromId(WIDGET_ID)}
      icon={widgetIcon()}
      widgetId={WIDGET_ID}
    >
      <div className="dream-task-list" ref={listRef}>
        {displayDreamTasks.map((dreamTask, i) => {
          const isClickable = !!onTaskClick;
          const task = dreamTask.nativeTask || null;
          const isScheduled = task?.startAt != null || dreamTask.startAt != null;
          const taskKey = _taskKey(dreamTask);
          const isDismissing = dismissingTaskKeys.has(taskKey);
          const titleHtml = amplenoteMarkdownRender(dreamTask.title) || dreamTask.title;
          const explanationHtml = amplenoteMarkdownRender(dreamTask.explanation) || '';
          const cardClassName = `dream-task-card${ dreamTask.isExisting ? '' : ' dream-task-card--invented' }${ isDismissing ? ' dream-task-card--dismissing' : '' }`;
          const titleClassName = `dream-task-card-title${ isClickable ? ' dream-task-card-title--clickable' : '' }`;
          const explanationClassName = `dream-task-card-explanation${ expandedExplanationKeys.has(taskKey) ? ' dream-task-card-explanation--expanded' : '' }`;

          return (
            <div key={taskKey || i} className={cardClassName}>
              <div className="dream-task-card-header">
                <span
                  className={titleClassName}
                  onClick={isClickable ? () => onTaskClick(dreamTask) : undefined}
                  role={isClickable ? 'button' : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  onKeyDown={isClickable
                    ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(dreamTask); } }
                    : undefined}
                  title={dreamTask.isExisting ? 'Open this task' : 'Click to create this task'}
                  dangerouslySetInnerHTML={{ __html: titleHtml }}
                />
                <DreamTaskKindBadge isClickable={isClickable} task={dreamTask} />
                <span
                  className={`dream-task-rating dream-task-rating--${ _ratingTier(dreamTask.rating) }`}
                  title={`Relevance: ${ dreamTask.rating }/10`}
                >{`${ dreamTask.rating }/10`}</span>
              </div>
              <p
                className={explanationClassName}
                title={dreamTask.explanation?.length > MIN_TEXT_OVERFLOW_SIZE ? dreamTask.explanation : null}
                onClick={() => onToggleExplanation(dreamTask)}
                dangerouslySetInnerHTML={{ __html: explanationHtml }}
              />
              <div className="dream-task-card-actions">
                <a
                  href="#"
                  className="dream-task-card-action"
                  onClick={(event) => onPreserve(event, dreamTask)}
                  title={dreamTask.preserveThroughTomorrow
                    ? 'Clicking this will remove preserve status so the task can reseed normally'
                    : 'Clicking this will ensure that the task remains present in your Dream Task list through tomorrow (normally tasks reseed daily)'}
                >{dreamTask.preserveThroughTomorrow ? '🚫 Remove preserve status' : '📎 Preserve a day'}</a>
                <a
                  href="#"
                  className="dream-task-card-action"
                  onClick={(event) => onComplete(event, dreamTask)}
                  title="Mark this task complete and replace it with another suggestion when available"
                >✅ Completed</a>
                {isScheduled ? null : (
                  <a
                    href="#"
                    className="dream-task-card-action"
                    onClick={(event) => onSchedule(event, dreamTask)}
                    title="Schedule this task for a specific date and time"
                  >📅 Schedule</a>
                )}
                <a
                  href="#"
                  className="dream-task-card-action"
                  onClick={(event) => onRemove(event, dreamTask)}
                  title="Remove this task and replace it with another suggestion when available"
                >❌ Remove</a>
              </div>
            </div>
          );
        })}
        {llmAttributionFooter
          ? <p className="dream-task-llm-attribution">{llmAttributionFooter}</p>
          : null}
      </div>
    </WidgetWrapper>
  );
}

function ConfiguredBody({ loading, error, tasks, maxTasks, noteLink, headerActions,
    onSettingsClick, runAnalysis, onTaskClick, listRef, llmAttributionFooter, actionHandlers }) {
  if (loading) return <LoadingState />;
  if (error) {
    return <ErrorState errorInfo={error} noteLink={noteLink} onRetry={() => runAnalysis(null)} onSettingsClick={onSettingsClick} />;
  }
  if (!tasks || tasks.length === 0) {
    return <EmptyState noteLink={noteLink} onRetry={() => runAnalysis(null)} />;
  }
  return (
    <TaskList
      dreamTasks={tasks}
      maxTasks={maxTasks}
      headerActions={headerActions}
      onTaskClick={onTaskClick}
      listRef={listRef}
      llmAttributionFooter={llmAttributionFooter}
      actionHandlers={actionHandlers}
    />
  );
}

function DreamTaskHeaderActions({ noteUUID, onOpenNote, onReseed }) {
  return (
    <span className="dream-task-header-actions">
      <ReseedLink onReseed={onReseed} />
      <NoteLink noteUUID={noteUUID} onOpenNote={onOpenNote} />
    </span>
  );
}

// =============================================================================
// DreamTask widget — custom hooks, state, effects, and composition
// =============================================================================

function useDreamTaskActions(app, defaultNoteUUID, noteUUID, setTasks) {
  const [dismissingTaskKeys, setDismissingTaskKeys] = useState(() => new Set());
  const [expandedExplanationKeys, setExpandedExplanationKeys] = useState(() => new Set());

  const resetActionState = useCallback(() => {
    setDismissingTaskKeys(new Set());
    setExpandedExplanationKeys(new Set());
  }, []);

  const patchTaskMetadata = useCallback(async (dreamTask, metadataPatch) => {
    await updateDreamTaskTaskMetadata(app, noteUUID, dreamTask, metadataPatch);
  }, [app, noteUUID]);

  const removeTaskAfterFade = useCallback((dreamTask) => {
    const key = _taskKey(dreamTask);
    setDismissingTaskKeys(previous => { const next = new Set(previous); next.add(key); return next; });
    setTimeout(() => {
      setTasks(previous => (previous || []).filter(candidate => _taskKey(candidate) !== key));
      setDismissingTaskKeys(previous => { const next = new Set(previous); next.delete(key); return next; });
      setExpandedExplanationKeys(previous => { const next = new Set(previous); next.delete(key); return next; });
    }, CARD_REMOVE_FADE_MS);
  }, [setTasks]);

  const fireConfettiForTask = useCallback((event) => {
    const cardElement = event.currentTarget?.closest?.(".dream-task-card");
    if (!cardElement || typeof window === "undefined") return;
    const rect = cardElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    confetti({
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height / 2) / window.innerHeight,
      },
      particleCount: 90, spread: 75, startVelocity: 42,
    });
  }, []);

  const onCompleteTask = useCallback(async (event, dreamTask) => {
    event.preventDefault();
    fireConfettiForTask(event);
    const completedNoteUUID = dreamTask.uuid ? null : await dailyJotNoteUuidFromToday(app);
    const completedAt = await markTaskComplete(app, completedNoteUUID, dreamTask);
    if (completedAt) await patchTaskMetadata(dreamTask, { completedAt, removedAt: null });
    removeTaskAfterFade(dreamTask);
  }, [app, fireConfettiForTask, patchTaskMetadata, removeTaskAfterFade]);

  const onPreserveTask = useCallback(async (event, dreamTask) => {
    event.preventDefault();
    const key = _taskKey(dreamTask);
    const nextPreserveState = !dreamTask.preserveThroughTomorrow;
    setTasks(previous => (previous || []).map(candidate => (
      _taskKey(candidate) === key ? { ...candidate, preserveThroughTomorrow: nextPreserveState } : candidate
    )));
    await patchTaskMetadata(dreamTask, { preserveThroughTomorrow: nextPreserveState });
  }, [patchTaskMetadata, setTasks]);

  const onRemoveTask = useCallback(async (event, dreamTask) => {
    event.preventDefault();
    const removedAt = new Date().toISOString();
    await patchTaskMetadata(dreamTask, { completedAt: null, removedAt });
    removeTaskAfterFade(dreamTask);
  }, [patchTaskMetadata, removeTaskAfterFade]);

  const onScheduleTask = useCallback(async (event, dreamTask) => {
    event.preventDefault();
    const { events, tasks: scheduledTasks } = await fetchSchedulingOccupancy(app);
    const now = new Date();
    const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const defaultDateSec = Math.floor(localMidnight.getTime() / 1000);
    const slots = buildAvailableTimeSlots(now, events, scheduledTasks);
    if (slots.length === 0) {
      await app.alert('No available 30-minute slots today. Please schedule manually.');
      return;
    }
    const promptResult = await app.prompt('Pick when to schedule this task. Times listed are free today; '
      + 'choose a different date only if those conflicts are acceptable.', {
      inputs: [
        { label: 'Date', type: 'date', value: defaultDateSec },
        { label: 'Time', options: slots, type: 'select', value: slots[0].value },
      ],
    });
    if (!promptResult) return;
    const [dateSec, timeMinutes] = promptResult;
    if (dateSec == null || timeMinutes == null) return;
    const startAt = startAtSecondsFromDateAndMinutes(dateSec, timeMinutes);
    if (startAt == null) {
      logIfEnabled('[DreamTask] Schedule: invalid date/time returned by prompt', { dateSec, timeMinutes });
      await app.alert('Could not schedule: the selected date or time was invalid.');
      return;
    }
    const result = await scheduledDreamTaskResultFromStartAt(app, defaultNoteUUID, startAt, dreamTask);
    if (!result.taskUuid) {
      logIfEnabled('[DreamTask] Schedule failed', result);
      const message = result.reason === 'missing_note' ? 'Could not schedule: no target note is available for this suggestion.' : 'Could not schedule this task. Please try again or schedule it manually.';
      await app.alert(message);
      return;
    }
    await patchTaskMetadata(dreamTask, { taskUuid: result.taskUuid });
    const key = _taskKey(dreamTask);
    setTasks(previous => (previous || []).map(candidate => (
      _taskKey(candidate) === key
        ? { ...candidate, isExisting: true, noteUUID: result.noteUUID || candidate.noteUUID || defaultNoteUUID,
            startAt: result.startAt || startAt, uuid: result.taskUuid }
        : candidate
    )));

    if (typeof window !== "undefined") {
      const taskUpdateEvent = new CustomEvent(DASHBOARD_TASKS_UPDATED_EVENT, {
        content: dreamTask.title, noteUUID: result.noteUUID || dreamTask.noteUUID || defaultNoteUUID, startAt,
        taskUuid: result.taskUuid,
      });
      window.dispatchEvent(taskUpdateEvent);
    }
  }, [app, defaultNoteUUID, patchTaskMetadata, setTasks]);

  const onToggleExplanation = useCallback((dreamTask) => {
    const key = _taskKey(dreamTask);
    setExpandedExplanationKeys(previous => {
      const next = new Set(previous);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }, []);

  return { dismissingTaskKeys, expandedExplanationKeys, onCompleteTask, onPreserveTask, onRemoveTask,
    onScheduleTask, onToggleExplanation, resetActionState };
}

// [Claude claude-4.7-opus] Task: migrate DreamTaskWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DreamTaskWidget({ app, gridHeightSize, gridWidthSize, onOpenSettings, providerApiKey,
    providerEm }) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [defaultNoteUUID, setDefaultNoteUUID] = useState(null);
  const [llmAttributionFooter, setLlmAttributionFooter] = useState(null);
  const [, setSeenUuidsMap] = useState(() => _loadSeenUuidsMap());
  const listRef = useRef(null);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  const envApiKey = (typeof process !== 'undefined' && process.env?.OPEN_AI_ACCESS_TOKEN) || '';
  const hasLlmConfig = !!(envApiKey || providerApiKey);
  const providerName = providerEm ? providerNameFromProviderEm(providerEm) : null;

  const maxTasks = _maxTasksFromGrid(gridWidthSize, gridHeightSize);
  const taskGenerateCount = _taskGenerateCount(gridWidthSize, gridHeightSize);
  const proposedTasksNoteName = _todayProposedTasksNoteName();
  const previousTaskGenerateCountRef = useRef(taskGenerateCount);

  const { dismissingTaskKeys, expandedExplanationKeys, onCompleteTask, onPreserveTask, onRemoveTask,
    onScheduleTask, onToggleExplanation, resetActionState } = useDreamTaskActions(app, defaultNoteUUID, noteUUID, setTasks);

  const recordTaskUuids = useCallback(async (shownUuids, currentMap) => {
    const uuids = (shownUuids || []).filter(Boolean);
    if (uuids.length === 0) return currentMap;
    const updated = await _recordSeenUuids(app, currentMap, uuids);
    setSeenUuidsMap(updated);
    return updated;
  }, [app]);

  const runAnalysis = useCallback(async (excludeUuids, options = {}) => {
    const providerNameForRun = options.providerEmOverride
      ? providerNameFromProviderEm(options.providerEmOverride)
      : providerName;
    logIfEnabled('[DreamTask] runAnalysis entry', { hasLlmConfig, providerName: providerNameForRun,
      excludeUuidsSize: excludeUuids?.size ?? 0, options, taskGenerateCount, proposedTasksNoteName });
    setLoading(true);
    setError(null);
    setLlmAttributionFooter(null);
    try {
      const fetchStart = performance.now();
      const result = await fetchDreamTaskSuggestions(app, {
        excludeUuids, options, proposedTasksNoteName, maxTasks: taskGenerateCount
      });
      logIfEnabled(`[DreamTask] fetchDreamTaskSuggestions took ${(performance.now() - fetchStart).toFixed(1)}ms`,
        { cached: result?.cached, taskCount: result?.tasks?.length ?? 0, errorCode: result?.errorCode ?? null, noteUUID: result?.noteUUID ?? null });
      const applyStart = performance.now();
      await applyDreamTaskAnalysisResult(result, {
        providerName: providerNameForRun,
        app, recordTaskUuids, setError, setTasks, setNoteUUID, setDefaultNoteUUID, setLlmAttributionFooter,
      });
      logIfEnabled(`[DreamTask] applyDreamTaskAnalysisResult took ${(performance.now() - applyStart).toFixed(1)}ms`);
    } catch (err) {
      logIfEnabled('[DreamTask] runAnalysis caught unexpected error', err);
      setError({ error: err.message || 'Analysis failed', errorCode: 'llm_error', providerName: providerNameForRun });
    } finally {
      setLoading(false);
    }
  }, [recordTaskUuids, taskGenerateCount, proposedTasksNoteName, providerName, hasLlmConfig]);

  useEffect(() => {
    setSeenUuidsMap(_loadSeenUuidsMap());
  }, []);

  useEffect(() => {
    if (loading || tasks?.length) return;
    runAnalysis(null, { minimumTaskCount: taskGenerateCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLlmConfig]);

  useEffect(() => {
    const snapshot = _describeDreamTaskConfigSnapshot(app, providerEm, providerApiKey, envApiKey);
    logIfEnabled('[DreamTask] config snapshot', {
      hasLlmConfig, providerName, renderCount: renderCountRef.current, ...snapshot,
    });
  }, [hasLlmConfig, providerEm, providerApiKey, envApiKey, providerName]);

  useEffect(() => {
    if (!hasLlmConfig) return;
    const previousMaxTasks = previousTaskGenerateCountRef.current;
    previousTaskGenerateCountRef.current = taskGenerateCount;
    if (!shouldFetchMoreTasksAfterGridGrowth({ maxTasks: taskGenerateCount, previousMaxTasks, tasks })) return;
    requestDreamTaskRefreshExcludingRecent(runAnalysis, taskGenerateCount);
  }, [hasLlmConfig, taskGenerateCount, tasks]);

  useEffect(() => {
    const start = performance.now();
    attachFootnotePopups(listRef.current);
    logIfEnabled(`[DreamTask] attachFootnotePopups: ${(performance.now() - start).toFixed(1)}ms`);
  }, [tasks, error, loading]);

  const onOpenNote = async (e) => {
    e.preventDefault();
    if (noteUUID) await app.navigate(`https://www.amplenote.com/notes/${ noteUUID }`);
  };

  const onSettingsClick = (e) => {
    e.preventDefault();
    handleOpenSettings(onOpenSettings);
  };

  const onReseed = async (e) => {
    e.preventDefault();
    const configuredProviders = configuredProvidersFromSettings(pluginSettings());
    let reseedOptions = {};
    if (configuredProviders.length > 1) {
      const selectedProvider = await chooseReseedProvider(app, providerEm);
      if (!selectedProvider) return;
      reseedOptions = { providerEmOverride: selectedProvider.providerEm };
    } else if (configuredProviders.length === 1) {
      reseedOptions = { providerEmOverride: configuredProviders[0].providerEm };
    }
    setTasks(null);
    resetActionState();
    setLlmAttributionFooter(null);
    requestDreamTaskRefreshExcludingRecent(runAnalysis, taskGenerateCount, reseedOptions);
  };

  const isInitialPreFetch = !loading && !tasks && !error;
  const isLlmFallbackFailure = !!error && NO_CONFIG_ERROR_CODES.has(error.errorCode);
  const shouldRenderNoConfig = !hasLlmConfig && !loading && (!tasks || tasks.length === 0)
    && (isInitialPreFetch || isLlmFallbackFailure);

  if (shouldRenderNoConfig) {
    logIfEnabled('[DreamTask] rendering no-config state', { providerName, hasError: !!error,
      errorCode: error?.errorCode ?? null, taskCount: tasks?.length ?? 0 });
    return <NoConfigState onSettingsClick={onSettingsClick} providerName={providerName} />;
  }

  const headerActions = <DreamTaskHeaderActions noteUUID={noteUUID} onOpenNote={onOpenNote} onReseed={onReseed} />;
  const noteLink = <NoteLink noteUUID={noteUUID} onOpenNote={onOpenNote} />;
  const onTaskClick = (task) => handleTaskClick(app, task, defaultNoteUUID);

  return (
    <ConfiguredBody
      error={error}
      headerActions={headerActions}
      listRef={listRef}
      loading={loading}
      llmAttributionFooter={llmAttributionFooter}
      maxTasks={maxTasks}
      noteLink={noteLink}
      onTaskClick={onTaskClick}
      tasks={tasks}
      onSettingsClick={onSettingsClick}
      runAnalysis={runAnalysis}
      actionHandlers={{
        dismissingTaskKeys,
        expandedExplanationKeys,
        onComplete: onCompleteTask,
        onPreserve: onPreserveTask,
        onRemove: onRemoveTask,
        onSchedule: onScheduleTask,
        onToggleExplanation,
      }}
    />
  );
}
