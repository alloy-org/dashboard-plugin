import confetti from "canvas-confetti";
import { apiKeyFromProvider, configuredProviderEms, devTokenPresent, SETTING_KEYS } from "constants/settings";
import { _loadSeenUuidsMap, _maxTasksFromGrid, _recordSeenUuids, _taskGenerateCount, acceptedIdeaCard,
  applyGoalCoachAnalysisResult, fetchGoalCoachSuggestions, handleOpenSettings, handleTaskClick, recordDreamIdeaDecision,
  requestGoalCoachRefreshExcludingRecent, shouldFetchMoreTasksAfterGridGrowth, updateGoalCoachTaskMetadata,
} from "goal-coach-internals";
import { buildAvailableTimeSlots, fetchSchedulingOccupancy, resolveGoalCoachScheduleSelection,
  scheduledGoalCoachResultFromStartAt } from "goal-coach-schedule";
import { promoteGoalCoachReserve } from "goal-coach-service";
import LlmProviderSelector from "llm-provider-selector";
import NoConfigUpsell from "no-config-upsell";
import { pluginSettings } from "plugin-data";
import { IDEA_STATUSES } from "dashboard/project-tasks/project-idea-records";
import { providerNameFromProviderEm } from "providers/ai-provider-settings";
import { isAmplenoteLlmAvailable } from "providers/amplenote-llm";
import { recordShownTaskSuggestions } from "dashboard/suggestions/ranked-task-suggestions";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { preparedDayRankingAwaiter } from "dashboard/work-queue/prepared-day-ranking";
import { DASHBOARD_TASKS_UPDATED_EVENT } from "hooks/use-dashboard-task-updates";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { logIfEnabled } from "util/log";
import { snapDashboardAction } from "util/plausible";
import { navigateToNote } from "util/goal-notes";
import { dailyJotNoteUuidFromToday, markTaskComplete } from "util/task-util";
import WidgetWrapper from "widget-wrapper";

import "styles/goal-coach.scss";

const MIN_TEXT_OVERFLOW_SIZE = 230;
const WIDGET_ID = 'dream-task';
const CARD_REMOVE_FADE_MS = 280;
const NO_CONFIG_ERROR_CODES = new Set(['llm_error', 'no_provider_configured', 'parse_error', 'invalid_api_key']);

// ----------------------------------------------------------------------------------------------
// @desc Build a single diagnostic object capturing every input that influences whether the widget
//   can reach paths 1 (cached note), 2 (app.callLLM on the plugin LLM license), or 3 (direct llmPrompt).
// [Claude claude-opus-4-8 (1M context)] Task: report any-provider dev token presence instead of OpenAI-only env key
function _describeGoalCoachConfigSnapshot(app, providerEm, providerApiKey, hasDevToken) {
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
    hasDevToken: !!hasDevToken,
    settingsLlmProvider: rawLlmProvider,
    propProviderSettingKey: providerSettingKey,
    settingsKeyLengthForProp: settingsKeyLength(providerSettingKey),
    apiKeyLengthByProvider,
    configuredProviderBuckets,
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

// [Claude claude-4.7-opus] Task: convert kind badge render fn to JSX component
// Prompt: "translate this project to render components with JSX instead"
// ------------------------------------------------------------------------------------------
// @desc Badge beside a suggestion's title: the name of the note holding an existing task, rendered as a link that opens
//   that note, or a "+new" marker for a suggestion that would create a task when clicked.
// @param {boolean} isClickable - Whether the suggestion's title can be clicked to open or create the task.
// @param {Function} onOpenTaskNote - Called with (event, task) when the note name is clicked.
// @param {object} task - Goal Coach suggestion, with isExisting, noteUUID and sourceNoteName.
// @returns {JSX.Element|null} The badge, or null when the suggestion has neither a source note nor a create action.
function GoalCoachKindBadge({ isClickable, onOpenTaskNote, task }) {
  if (task.isExisting && task.sourceNoteName) {
    return (
      <a
        href="#"
        className="goal-coach-source-note-badge"
        onClick={(event) => onOpenTaskNote(event, task)}
        title={`Open note: ${ task.sourceNoteName }`}
      >{task.sourceNoteName}</a>
    );
  }
  if (!task.isExisting && isClickable) {
    return <span className="goal-coach-new-badge" title="New task — click to create">+new</span>;
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
    <WidgetWrapper widgetId={WIDGET_ID}>
      <div className="goal-coach-loading">
        <div className="goal-coach-spinner" />
        <p>Analyzing the finest tasks …</p>
      </div>
    </WidgetWrapper>
  );
}

// [Claude claude-opus-4-8] Task: list of highlighted Ample Agent Pro features rendered as pills
// [Claude claude-opus-4-8 (1M context)] Task: features now feed the shared NoConfigUpsell card
const NO_CONFIG_FEATURES = [
  { icon: '🎯', label: 'Highlight goal-matched tasks' },
  { icon: '⚖️', label: 'Sort tasks (fun, fast, etc)' },
  { icon: '🕵', label: 'Deep note search' },
  { icon: '💪', label: 'Task completion agent' },
  { icon: '🔬', label: 'Multi-agent deep research' },
  { icon: '✏️', label: 'Finish a note in progress' },
];

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
            <a href="#" className="goal-coach-settings-link" onClick={onSettingsClick}>AI settings</a>
            .
          </p>
        </>
      );
      break;
    case 'no_planning_data':
      content = (
        <>
          <p>Goal Coach needs planning context to generate suggestions.</p>
          <p>Populate your quarterly and/or monthly plan to receive AI-suggested tasks.</p>
        </>
      );
      break;
    case 'parse_error':
      content = (
        <>
          <p>Unable to successfully process the AI provider's response.</p>
          <p className="goal-coach-error-detail">
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
    <WidgetWrapper widgetId={WIDGET_ID} headerActions={noteLink}>
      <div className="goal-coach-error">
        {content}
        <button className="goal-coach-retry" onClick={onRetry}>Retry</button>
      </div>
    </WidgetWrapper>
  );
}

function EmptyState({ noteLink, onRetry }) {
  return (
    <WidgetWrapper widgetId={WIDGET_ID} headerActions={noteLink}>
      <div className="goal-coach-empty">
        <p>No task suggestions available.</p>
        <button className="goal-coach-retry" onClick={onRetry}>Refresh</button>
      </div>
    </WidgetWrapper>
  );
}

// [Claude claude-4.7-opus] Task: convert renderTaskList to JSX TaskList component
// Prompt: "translate this project to render components with JSX instead"
function TaskList({ goalCoachTasks, maxTasks, headerActions, onTaskClick, listRef, llmAttributionFooter, actionHandlers }) {
  const displayGoalCoachTasks = _selectDisplayTasks(goalCoachTasks, maxTasks);

  const {
    dismissingTaskKeys, expandedExplanationKeys, onComplete, onOpenTaskNote, onPreserve, onRemove, onSchedule,
    onToggleExplanation } = actionHandlers;

  return (
    <WidgetWrapper headerActions={headerActions} widgetId={WIDGET_ID}>
      <div className="goal-coach-list" ref={listRef}>
        {displayGoalCoachTasks.map((goalCoachTask, i) => {
          const isClickable = !!onTaskClick;
          const task = goalCoachTask.nativeTask || null;
          const isScheduled = task?.startAt != null || goalCoachTask.startAt != null;
          const taskKey = _taskKey(goalCoachTask);
          const isDismissing = dismissingTaskKeys.has(taskKey);
          const titleHtml = amplenoteMarkdownRender(goalCoachTask.title) || goalCoachTask.title;
          const explanationHtml = amplenoteMarkdownRender(goalCoachTask.explanation) || '';
          const cardClassName = `goal-coach-card${ goalCoachTask.isExisting ? '' : ' goal-coach-card--invented' }${ isDismissing ? ' goal-coach-card--dismissing' : '' }`;
          const titleClassName = `goal-coach-card-title${ isClickable ? ' goal-coach-card-title--clickable' : '' }`;
          const explanationClassName = `goal-coach-card-explanation${ expandedExplanationKeys.has(taskKey) ? ' goal-coach-card-explanation--expanded' : '' }`;

          return (
            <div key={taskKey || i} className={cardClassName}>
              <div className="goal-coach-card-header">
                <span
                  className={titleClassName}
                  onClick={isClickable ? () => onTaskClick(goalCoachTask) : undefined}
                  role={isClickable ? 'button' : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  onKeyDown={isClickable
                    ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(goalCoachTask); } }
                    : undefined}
                  title={goalCoachTask.isExisting ? 'Open this task' : 'Click to create this task'}
                  dangerouslySetInnerHTML={{ __html: titleHtml }}
                />
                <GoalCoachKindBadge isClickable={isClickable} onOpenTaskNote={onOpenTaskNote} task={goalCoachTask} />
                <span
                  className={`goal-coach-rating goal-coach-rating--${ _ratingTier(goalCoachTask.rating) }`}
                  title={`Relevance: ${ goalCoachTask.rating }/10`}
                >{`${ goalCoachTask.rating }/10`}</span>
              </div>
              <p
                className={explanationClassName}
                title={goalCoachTask.explanation?.length > MIN_TEXT_OVERFLOW_SIZE ? goalCoachTask.explanation : null}
                onClick={() => onToggleExplanation(goalCoachTask)}
                dangerouslySetInnerHTML={{ __html: explanationHtml }}
              />
              <div className="goal-coach-card-actions">
                <a
                  href="#"
                  className="goal-coach-card-action"
                  onClick={(event) => onPreserve(event, goalCoachTask)}
                  title={goalCoachTask.preserveThroughTomorrow
                    ? 'Clicking this will remove preserve status so the task can reseed normally'
                    : 'Clicking this will ensure that the task remains present in your Goal Coach list through tomorrow (normally tasks reseed daily)'}
                >{goalCoachTask.preserveThroughTomorrow ? '🚫 Remove preserve' : '📎 Preserve'}</a>
                <a
                  href="#"
                  className="goal-coach-card-action"
                  onClick={(event) => onComplete(event, goalCoachTask)}
                  title="Mark this task complete and replace it with another suggestion when available"
                >✅ Completed</a>
                {isScheduled ? null : (
                  <a
                    href="#"
                    className="goal-coach-card-action"
                    onClick={(event) => onSchedule(event, goalCoachTask)}
                    title="Schedule this task for a specific date and time"
                  >📅 Schedule</a>
                )}
                <a
                  href="#"
                  className="goal-coach-card-action"
                  onClick={(event) => onRemove(event, goalCoachTask)}
                  title="Remove this task and replace it with another suggestion when available"
                >❌ Remove</a>
              </div>
            </div>
          );
        })}
        {llmAttributionFooter
          ? <p className="goal-coach-llm-attribution">{llmAttributionFooter}</p>
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
      goalCoachTasks={tasks}
      maxTasks={maxTasks}
      headerActions={headerActions}
      onTaskClick={onTaskClick}
      listRef={listRef}
      llmAttributionFooter={llmAttributionFooter}
      actionHandlers={actionHandlers}
    />
  );
}

function GoalCoachHeaderActions({ noteUUID, onOpenNote, onReseed }) {
  return (
    <span className="goal-coach-header-actions">
      <ReseedLink onReseed={onReseed} />
      <NoteLink noteUUID={noteUUID} onOpenNote={onOpenNote} />
    </span>
  );
}

// =============================================================================
// Goal Coach widget — custom hooks, state, effects, and composition
// =============================================================================

function useGoalCoachActions(app, defaultNoteUUID, noteUUID, setTasks, { reserveTasks, setReserveTasks, taskDomainName,
    taskDomainUUID }) {
  const [dismissingTaskKeys, setDismissingTaskKeys] = useState(() => new Set());
  const [expandedExplanationKeys, setExpandedExplanationKeys] = useState(() => new Set());

  const resetActionState = useCallback(() => {
    setDismissingTaskKeys(new Set());
    setExpandedExplanationKeys(new Set());
  }, []);

  const patchTaskMetadata = useCallback(async (goalCoachTask, metadataPatch) => {
    await updateGoalCoachTaskMetadata(app, noteUUID, goalCoachTask, metadataPatch);
  }, [app, noteUUID]);

  const removeTaskAfterFade = useCallback((goalCoachTask) => {
    const key = _taskKey(goalCoachTask);
    setDismissingTaskKeys(previous => { const next = new Set(previous); next.add(key); return next; });
    setTimeout(() => {
      setTasks(previous => (previous || []).filter(candidate => _taskKey(candidate) !== key));
      setDismissingTaskKeys(previous => { const next = new Set(previous); next.delete(key); return next; });
      setExpandedExplanationKeys(previous => { const next = new Set(previous); next.delete(key); return next; });
    }, CARD_REMOVE_FADE_MS);
  }, [setTasks]);

  const fireConfettiForTask = useCallback((event) => {
    const cardElement = event.currentTarget?.closest?.(".goal-coach-card");
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

  const onCompleteTask = useCallback(async (event, goalCoachTask) => {
    event.preventDefault();
    snapDashboardAction("approveDreamTask", { via: "complete" });
    fireConfettiForTask(event);
    const completedNoteUUID = goalCoachTask.uuid ? null : await dailyJotNoteUuidFromToday(app);
    const completedAt = await markTaskComplete(app, completedNoteUUID, goalCoachTask);
    if (completedAt) {
      await patchTaskMetadata(goalCoachTask, { completedAt, removedAt: null });
      await recordDreamIdeaDecision(app, goalCoachTask, { domainName: taskDomainName, domainUuid: taskDomainUUID,
        status: IDEA_STATUSES.accepted });
    }
    removeTaskAfterFade(goalCoachTask);
  }, [app, fireConfettiForTask, patchTaskMetadata, removeTaskAfterFade, taskDomainName, taskDomainUUID]);

  const onPreserveTask = useCallback(async (event, goalCoachTask) => {
    event.preventDefault();
    const key = _taskKey(goalCoachTask);
    const nextPreserveState = !goalCoachTask.preserveThroughTomorrow;
    setTasks(previous => (previous || []).map(candidate => (
      _taskKey(candidate) === key ? { ...candidate, preserveThroughTomorrow: nextPreserveState } : candidate
    )));
    await patchTaskMetadata(goalCoachTask, { preserveThroughTomorrow: nextPreserveState });
  }, [patchTaskMetadata, setTasks]);

  const onRemoveTask = useCallback(async (event, goalCoachTask) => {
    event.preventDefault();
    const removedAt = new Date().toISOString();
    await patchTaskMetadata(goalCoachTask, { completedAt: null, removedAt });
    await recordDreamIdeaDecision(app, goalCoachTask, { domainName: taskDomainName, domainUuid: taskDomainUUID,
      status: IDEA_STATUSES.dismissed });
    const replacement = reserveTasks[0];
    if (replacement) {
      const remaining = reserveTasks.slice(1);
      setReserveTasks(remaining);
      setTasks(previous => [...(previous || []), replacement]);
      await promoteGoalCoachReserve(app, noteUUID, remaining, replacement);
      await recordShownTaskSuggestions(app, { domainName: taskDomainName, domainUuid: taskDomainUUID,
        suggestions: [replacement], targetDate: new Date() });
    }
    removeTaskAfterFade(goalCoachTask);
  }, [app, noteUUID, patchTaskMetadata, removeTaskAfterFade, reserveTasks, taskDomainName, taskDomainUUID]);

  const onScheduleTask = useCallback(async (event, goalCoachTask) => {
    event.preventDefault();
    const { events, tasks: scheduledTasks } = await fetchSchedulingOccupancy(app);
    const now = new Date();
    const todaySlots = buildAvailableTimeSlots(now, events, scheduledTasks);
    const card = await acceptedIdeaCard(app, goalCoachTask, { domainName: taskDomainName, domainUuid: taskDomainUUID });
    const selection = await resolveGoalCoachScheduleSelection(app, { defaultNoteUUID, now, task: card, todaySlots });
    if (!selection) return;
    const taskToSchedule = selection.noteUUID ? { ...card, noteUUID: selection.noteUUID } : card;
    const result = await scheduledGoalCoachResultFromStartAt(app, defaultNoteUUID, selection.startAt, taskToSchedule);
    if (!result.taskUuid) {
      logIfEnabled('[goal-coach] Schedule failed', result);
      const message = result.reason === 'missing_note' ? 'Could not schedule: no target note is available for this suggestion.' : 'Could not schedule this task. Please try again or schedule it manually.';
      await app.alert(message);
      return;
    }
    snapDashboardAction("approveDreamTask", { via: "schedule" });
    await patchTaskMetadata(goalCoachTask, { taskUuid: result.taskUuid });
    await recordDreamIdeaDecision(app, goalCoachTask, { acceptedTaskUuid: result.taskUuid, domainName: taskDomainName,
      domainUuid: taskDomainUUID, status: IDEA_STATUSES.accepted });
    const key = _taskKey(goalCoachTask);
    setTasks(previous => (previous || []).map(candidate => (
      _taskKey(candidate) === key
        ? { ...candidate, isExisting: true, noteUUID: result.noteUUID || candidate.noteUUID || defaultNoteUUID,
            startAt: result.startAt || selection.startAt, uuid: result.taskUuid }
        : candidate
    )));

    if (typeof window !== "undefined") {
      const taskUpdateEvent = new CustomEvent(DASHBOARD_TASKS_UPDATED_EVENT, {
        content: goalCoachTask.title, noteUUID: result.noteUUID || goalCoachTask.noteUUID || defaultNoteUUID,
        startAt: selection.startAt, taskUuid: result.taskUuid,
      });
      window.dispatchEvent(taskUpdateEvent);
    }
  }, [app, defaultNoteUUID, patchTaskMetadata, setTasks, taskDomainName, taskDomainUUID]);

  // ------------------------------------------------------------------------------------------
  // @desc Open a card's task, or create it from an invented or idea card. A card that now points at a task is
  //   recorded on the daily note and becomes an existing-task card, so clicking it again opens that task.
  // @param {object} goalCoachTask - The clicked card.
  const onTaskClick = useCallback(async (goalCoachTask) => {
    const accepted = await handleTaskClick(app, goalCoachTask, defaultNoteUUID, { domainName: taskDomainName,
      domainUuid: taskDomainUUID });
    if (!accepted) return;
    await patchTaskMetadata(goalCoachTask, { taskUuid: accepted.taskUuid });
    const key = _taskKey(goalCoachTask);
    setTasks(previous => (previous || []).map(candidate => (_taskKey(candidate) === key
      ? { ...candidate, isExisting: true, noteUUID: accepted.noteUUID, uuid: accepted.taskUuid } : candidate)));
  }, [app, defaultNoteUUID, patchTaskMetadata, setTasks, taskDomainName, taskDomainUUID]);

  // ------------------------------------------------------------------------------------------
  // @desc Open the note that contains an existing suggestion's task, without triggering the card's own click handlers.
  // @param {Event} event - Click event from the source note badge.
  // @param {object} goalCoachTask - Suggestion whose noteUUID names the note to open.
  const onOpenTaskNote = useCallback(async (event, goalCoachTask) => {
    event.preventDefault();
    event.stopPropagation();
    if (!goalCoachTask?.noteUUID) return;
    snapDashboardAction("openGoalCoachTaskNote");
    await navigateToNote(app, goalCoachTask.noteUUID);
  }, [app]);

  const onToggleExplanation = useCallback((goalCoachTask) => {
    const key = _taskKey(goalCoachTask);
    setExpandedExplanationKeys(previous => {
      const next = new Set(previous);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }, []);

  return { dismissingTaskKeys, expandedExplanationKeys, onCompleteTask, onOpenTaskNote, onPreserveTask, onRemoveTask,
    onScheduleTask, onTaskClick, onToggleExplanation, resetActionState };
}

// ------------------------------------------------------------------------------------------
export default function GoalCoachWidget({ app, gridHeightSize, gridWidthSize, onOpenSettings, providerApiKey,
    providerEm, taskDomainName, taskDomainUUID }) {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [defaultNoteUUID, setDefaultNoteUUID] = useState(null);
  const [llmAttributionFooter, setLlmAttributionFooter] = useState(null);
  const [providerPopupOpen, setProviderPopupOpen] = useState(false);
  const [reserveTasks, setReserveTasks] = useState([]);
  // Null until the plugin LLM license's quota check answers, so the upsell never shows to a subscriber while it is in flight
  const [amplenoteLlmAvailable, setAmplenoteLlmAvailable] = useState(null);
  const [, setSeenUuidsMap] = useState(() => _loadSeenUuidsMap());
  const analysisRunIdRef = useRef(0);
  const listRef = useRef(null);
  // A cold generation has the Dashboard's work queue prepare the day's shared ranking first; read through a ref so the
  // runtime arriving after mount does not re-create runAnalysis.
  const work = useDashboardWork();
  const rankingPreparer = useMemo(() => preparedDayRankingAwaiter(work?.runtime?.durable || null), [work]);
  const rankingPreparerRef = useRef(rankingPreparer);
  rankingPreparerRef.current = rankingPreparer;
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  // [Claude claude-opus-4-8 (1M context)] Task: treat any dev provider token (not just OpenAI) as a configured LLM
  // Prompt: "dev environment isn't showing suggestions in spite of having GROK_AI_ACCESS_TOKEN present"
  const hasDevToken = devTokenPresent();
  // A boolean, never the key itself: it is written to the Debug Console by the analysis and config-snapshot logs.
  const hasLlmConfig = Boolean(hasDevToken || providerApiKey);
  const providerName = providerEm ? providerNameFromProviderEm(providerEm) : null;

  const maxTasks = _maxTasksFromGrid(gridWidthSize, gridHeightSize);
  const taskGenerateCount = _taskGenerateCount(gridWidthSize, gridHeightSize);
  const domainName = taskDomainName || "All Notes";
  const todayLabel = (new Date()).toLocaleString([], { day: "numeric", month: "long", year: "numeric" });
  const proposedTasksNoteName = `Dashboard proposed tasks for ${ domainName } on ${ todayLabel }`;
  const previousTaskGenerateCountRef = useRef(taskGenerateCount);

  const { dismissingTaskKeys, expandedExplanationKeys, onCompleteTask, onOpenTaskNote, onPreserveTask, onRemoveTask,
    onScheduleTask, onTaskClick, onToggleExplanation, resetActionState } = useGoalCoachActions(app, defaultNoteUUID, noteUUID, setTasks,
    { reserveTasks, setReserveTasks, taskDomainName, taskDomainUUID });

  const recordTaskUuids = useCallback(async (shownUuids, currentMap) => {
    const uuids = (shownUuids || []).filter(Boolean);
    if (uuids.length === 0) return currentMap;
    const updated = await _recordSeenUuids(app, currentMap, uuids);
    setSeenUuidsMap(updated);
    return updated;
  }, [app]);

  const runAnalysis = useCallback(async (excludeUuids, options = {}) => {
    const analysisRunId = analysisRunIdRef.current + 1;
    analysisRunIdRef.current = analysisRunId;
    const providerNameForRun = options.providerEmOverride
      ? providerNameFromProviderEm(options.providerEmOverride)
      : providerName;
    logIfEnabled('[goal-coach] runAnalysis entry', { hasLlmConfig, providerName: providerNameForRun,
      excludeUuidsSize: excludeUuids?.size ?? 0, options, taskGenerateCount, proposedTasksNoteName });
    setLoading(true);
    setError(null);
    setLlmAttributionFooter(null);
    try {
      const fetchStart = performance.now();
      const result = await fetchGoalCoachSuggestions(app, {
        excludeUuids, options, proposedTasksNoteName, maxTasks: taskGenerateCount, rankingPreparer: rankingPreparerRef.current
      });
      logIfEnabled(`[goal-coach] fetchGoalCoachSuggestions took ${(performance.now() - fetchStart).toFixed(1)}ms`,
        { cached: result?.cached, taskCount: result?.tasks?.length ?? 0, errorCode: result?.errorCode ?? null, noteUUID: result?.noteUUID ?? null });
      if (!result?.cached && !result?.errorCode && result?.tasks?.length) {
        snapDashboardAction("generateDreamTasks", { count: result.tasks.length });
      }
      if (analysisRunId !== analysisRunIdRef.current) return;
      await applyGoalCoachAnalysisResult(result, { app, providerName: providerNameForRun, recordTaskUuids,
        setDefaultNoteUUID, setError, setLlmAttributionFooter, setNoteUUID, setReserveTasks, setTasks });
    } catch (err) {
      if (analysisRunId !== analysisRunIdRef.current) return;
      logIfEnabled('[goal-coach] runAnalysis caught unexpected error', err);
      setError({ error: err.message || 'Analysis failed', errorCode: 'llm_error', providerName: providerNameForRun });
    } finally {
      if (analysisRunId === analysisRunIdRef.current) setLoading(false);
    }
  }, [recordTaskUuids, taskGenerateCount, proposedTasksNoteName, providerName, hasLlmConfig]);

  useEffect(() => {
    setSeenUuidsMap(_loadSeenUuidsMap());
  }, []);

  useEffect(() => {
    resetActionState();
    setDefaultNoteUUID(null);
    setNoteUUID(null);
    setTasks(null);
    runAnalysis(null, { minimumTaskCount: taskGenerateCount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLlmConfig, proposedTasksNoteName, taskDomainUUID]);

  useEffect(() => {
    const snapshot = _describeGoalCoachConfigSnapshot(app, providerEm, providerApiKey, hasDevToken);
    logIfEnabled('[goal-coach] config snapshot', {
      hasLlmConfig, providerName, renderCount: renderCountRef.current, ...snapshot,
    });
  }, [hasLlmConfig, providerEm, providerApiKey, hasDevToken, providerName]);

  // Check the plugin LLM license so the reseed chooser may offer providers the user has no key for, since app.callLLM
  // serves them on the license. The same answer decides whether a keyless failure is a missing provider (the upsell)
  // or a callLLM request that did not answer.
  useEffect(() => {
    let cancelled = false;
    isAmplenoteLlmAvailable(app).then(isAvailable => { if (!cancelled) setAmplenoteLlmAvailable(isAvailable); });
    return () => { cancelled = true; };
  }, [app]);

  useEffect(() => {
    if (!hasLlmConfig) return;
    const previousMaxTasks = previousTaskGenerateCountRef.current;
    previousTaskGenerateCountRef.current = taskGenerateCount;
    if (!shouldFetchMoreTasksAfterGridGrowth({ maxTasks: taskGenerateCount, previousMaxTasks, tasks })) return;
    requestGoalCoachRefreshExcludingRecent(runAnalysis, taskGenerateCount);
  }, [hasLlmConfig, taskGenerateCount, tasks]);

  useEffect(() => {
    attachFootnotePopups(listRef.current);
  }, [tasks, error, loading]);

  const onOpenNote = async (e) => {
    e.preventDefault();
    if (noteUUID) await app.navigate(`https://www.amplenote.com/notes/${ noteUUID }`);
  };

  const onSettingsClick = (e) => {
    e.preventDefault();
    handleOpenSettings(onOpenSettings);
  };

  // [Claude claude-opus-4-8 (1M context)] Task: open the shared AI-provider chooser before reseeding
  // Prompt: "use this selector in [DreamTask] as well"
  const onReseed = (e) => {
    e.preventDefault();
    setProviderPopupOpen(true);
  };

  // [Claude claude-opus-4-8 (1M context)] Task: reseed suggestions with the provider chosen in the popup
  const onSelectReseedProvider = (providerEmOverride) => {
    setProviderPopupOpen(false);
    setTasks(null);
    resetActionState();
    setLlmAttributionFooter(null);
    // A reseed always generates a new batch, even when today's note already holds enough cards.
    const reseedOptions = providerEmOverride ? { forceRefresh: true, providerEmOverride } : { forceRefresh: true };
    requestGoalCoachRefreshExcludingRecent(runAnalysis, taskGenerateCount, reseedOptions);
  };

  const isInitialPreFetch = !loading && !tasks && !error;
  const isLlmFallbackFailure = !!error && NO_CONFIG_ERROR_CODES.has(error.errorCode);
  const isKeylessWithoutTasks = !hasLlmConfig && !loading && (!tasks || tasks.length === 0)
    && (isInitialPreFetch || isLlmFallbackFailure);
  // Only a confirmed absence of a plugin LLM license shows the upsell; with one, a failure shows its error and a retry
  const shouldRenderNoConfig = isKeylessWithoutTasks && amplenoteLlmAvailable === false;
  const isCheckingAmplenoteLlm = isKeylessWithoutTasks && amplenoteLlmAvailable === null;
  useWidgetLoadedEvent(WIDGET_ID, !loading && !isCheckingAmplenoteLlm && (shouldRenderNoConfig || !!tasks || !!error), !!error);

  if (shouldRenderNoConfig) {
    logIfEnabled('[goal-coach] rendering no-config state', { providerName, hasError: !!error,
      errorCode: error?.errorCode ?? null, taskCount: tasks?.length ?? 0 });
    return <NoConfigUpsell app={ app } features={ NO_CONFIG_FEATURES }
      moreFeaturesLabel="+ 15 more features included" widgetId={ WIDGET_ID } />;
  }

  const headerActions = <GoalCoachHeaderActions noteUUID={noteUUID} onOpenNote={onOpenNote} onReseed={onReseed} />;
  const noteLink = <NoteLink noteUUID={noteUUID} onOpenNote={onOpenNote} />;
  return (
    <>
      <ConfiguredBody
        error={error}
        headerActions={headerActions}
        listRef={listRef}
        loading={loading || isCheckingAmplenoteLlm}
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
          onOpenTaskNote,
          onPreserve: onPreserveTask,
          onRemove: onRemoveTask,
          onSchedule: onScheduleTask,
          onToggleExplanation,
        }}
      />
      {
        providerPopupOpen
        ? <LlmProviderSelector
            allowKeylessProviders={amplenoteLlmAvailable === true}
            configuredProviderEms={configuredProviderEms(pluginSettings())}
            currentProviderEm={providerEm}
            onCancel={() => setProviderPopupOpen(false)}
            onSelect={onSelectReseedProvider}
            submitLabel="Reseed"
            title="Reseed suggestions with which AI provider?"
          />
        : null
      }
    </>
  );
}
