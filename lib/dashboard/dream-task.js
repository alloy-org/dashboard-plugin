/**
 * [Claude-claude-4.6-opus-high-thinking file]
 * Task: DreamTask widget — AI-suggested tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget that uses an agentic loop to suggest goal-aligned tasks"
 */
import { widgetDataFromId, widgetTitleFromId } from "constants/settings";
import { _loadSeenUuidsMap, _maxTasksFromGrid, _recordSeenUuids, _todayProposedTasksNoteName,
  applyDreamTaskAnalysisResult, fetchDreamTaskSuggestions, handleOpenSettings, handleTaskClick,
  requestDreamTaskRefreshExcludingRecent, shouldFetchMoreTasksAfterGridGrowth,
} from "dream-task-internals";
import { createElement, useEffect, useState, useCallback, useRef } from "react";
import { providerNameFromProviderEm } from "providers/ai-provider-settings";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import WidgetWrapper from "widget-wrapper";
import "styles/dream-task.scss";

const MIN_TEXT_OVERFLOW_SIZE = 230; // Ballparked by eye on example text. Used to determine when to apply visible title.
const WIDGET_ID = 'dream-task';

// =============================================================================
// Render helpers — markup, loading/error/empty states, task cards
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Sort tasks by rating descending and take up to maxTasks entries.
// [Claude claude-4.6-sonnet-medium-thinking] Task: (helper for task list display)
function _selectDisplayTasks(tasks, maxTasks) {
  const sorted = [...tasks].sort((a, b) => b.rating - a.rating);
  return sorted.slice(0, maxTasks);
}

// ----------------------------------------------------------------------------------------------
// @desc Map numeric rating to CSS tier name for the relevance badge.
// [Claude claude-4.6-sonnet-medium-thinking] Task: rating tier helper for dream-task cards
function _ratingTier(rating) {
  if (rating >= 8) return 'high';
  if (rating >= 5) return 'medium';
  return 'low';
}

// ----------------------------------------------------------------------------------------------
// @desc Widget icon from centralized widget metadata.
function widgetIcon() {
  return widgetDataFromId(WIDGET_ID).icon;
}

// ----------------------------------------------------------------------------------------------
// @desc Header link to open today's proposed-tasks note when noteUUID is known.
// @param {Function} h - React createElement.
// @param {string|null} noteUUID - Target note UUID.
// @param {Function} onOpenNote - Click handler.
function renderNoteLink(h, noteUUID, onOpenNote) {
  if (!noteUUID) return null;
  return h('a', {
    href: '#', className: 'widget-header-action', onClick: onOpenNote,
    title: 'Open today\'s proposed tasks note',
  }, '\uD83D\uDDD2\uFE0F Note');
}

// ----------------------------------------------------------------------------------------------
// @desc Header control to force new LLM suggestions excluding tasks already shown today.
// @param {Function} h - React createElement.
// @param {Function} onReseed - Click handler.
// [Claude claude-4.6-sonnet-medium-thinking] Task: render reseed link in the widget header
// Prompt: "add a link to the top of Dream Task module to reseed the tasks"
function renderReseedLink(h, onReseed) {
  return h('a', {
    href: '#', className: 'widget-header-action', onClick: onReseed,
    title: 'Get new task suggestions (excludes tasks shown today)',
  }, '\uD83D\uDD04 Reseed');
}

// ----------------------------------------------------------------------------------------------
// @desc Full-widget loading placeholder with spinner.
// @param {Function} h - React createElement.
function renderLoadingState(h) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID },
    h('div', { className: 'dream-task-loading' },
      h('div', { className: 'dream-task-spinner' }),
      h('p', null, 'Deducing content... \u2026')
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Explain missing LLM configuration and link to AI settings.
// @param {Function} h - React createElement.
// @param {Function} onSettingsClick - Opens AI settings.
// @param {string|null} providerName - Display name for current provider, if known.
// [Claude claude-opus-4-6] Task: show provider-specific message when no API key is configured
// Prompt: "when we can not fetch suggested tasks, the widget explains why: no API key for provider"
function renderNoConfigState(h, onSettingsClick, providerName) {
  const message = providerName
    ? `No API key is available for the currently selected AI provider, ${ providerName }.`
    : 'DreamTask uses AI to suggest tasks aligned with your goals. An LLM provider and API key are required.';
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID },
    h('div', { className: 'dream-task-no-config' },
      h('p', { className: 'dream-task-no-config-text' }, message),
      h('p', { className: 'dream-task-no-config-text' },
        h('a', { href: '#', className: 'dream-task-settings-link', onClick: onSettingsClick },
          'Configure AI settings \u2192'
        )
      )
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render error UI from service errorCode with retry and optional settings link.
// @param {Function} h - React createElement.
// @param {object} errorInfo - { error, errorCode, errorDetail, providerName }.
// @param {ReactNode|null} noteLink - Optional header action.
// @param {Function} onRetry - Retry analysis.
// @param {Function} onSettingsClick - Opens AI settings.
// [Claude claude-opus-4-6] Task: render specific error messages based on errorCode from the service
// Prompt: "when we can not fetch suggested tasks, the widget explains why"
function renderErrorState(h, errorInfo, noteLink, onRetry, onSettingsClick) {
  const { error, errorCode, errorDetail, providerName } = errorInfo;
  let content;
  switch (errorCode) {
    case 'invalid_api_key':
      content = [
        h('p', null, `The API key for ${ providerName || 'your AI provider' } appears to be invalid or unauthorized.`),
        h('p', null, 'Please check your API key in ',
          h('a', { href: '#', className: 'dream-task-settings-link', onClick: onSettingsClick }, 'AI settings'),
          '.'
        ),
      ];
      break;
    case 'no_planning_data':
      content = [
        h('p', null, 'DreamTask needs planning context to generate suggestions.'),
        h('p', null, 'Populate your quarterly and/or monthly plan to receive AI-suggested tasks.'),
      ];
      break;
    case 'parse_error':
      content = [
        h('p', null, 'Unable to successfully process the AI provider\'s response.'),
        h('p', { className: 'dream-task-error-detail' },
          'If this persists, please contact support@amplenote.com',
          errorDetail ? ` with this detail: ${ errorDetail }` : '',
        ),
      ];
      break;
    default:
      content = [h('p', null, error || 'An unexpected error occurred.')];
  }
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-error' },
      ...content,
      h('button', { className: 'dream-task-retry', onClick: onRetry }, 'Retry')
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Empty suggestions state with refresh.
// @param {Function} h - React createElement.
// @param {ReactNode|null} noteLink - Optional header action.
// @param {Function} onRetry - Refresh handler.
function renderEmptyState(h, noteLink, onRetry) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-empty' },
      h('p', null, 'No task suggestions available.'),
      h('button', { className: 'dream-task-retry', onClick: onRetry }, 'Refresh')
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Rated task cards with markdown titles/explanations and invented-task styling.
// @param {Function} h - React createElement.
// @param {Array<object>} tasks - Task objects from the service.
// @param {number} maxTasks - Max cards to show.
// @param {ReactNode} headerActions - Header slot (e.g. reseed + note).
// @param {Function|null} onTaskClick - Handler per task, or null if non-interactive.
// @param {object} listRef - Ref for the scrollable list (footnotes).
// [Claude claude-4.6-opus-high-thinking] Task: render task list with distinction between existing and invented tasks
// Prompt: "at least 50% of suggested tasks should be existing tasks; clicking invented tasks creates them"
function renderTaskList(h, tasks, maxTasks, headerActions, onTaskClick, listRef) {
  const displayTasks = _selectDisplayTasks(tasks, maxTasks);
  return h(WidgetWrapper, {
    headerActions, subtitle: "What if you did it today?",
    title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID,
  },
    h('div', { className: 'dream-task-list', ref: listRef },
      ...displayTasks.map((task, i) => {
        const isClickable = !!onTaskClick;
        return h('div', { key: i, className: `dream-task-card${ task.isExisting ? '' : ' dream-task-card--invented' }` },
          h('div', { className: 'dream-task-card-header' },
            h('span', {
              className: `dream-task-card-title${ isClickable ? ' dream-task-card-title--clickable' : '' }`,
              onClick: isClickable ? () => onTaskClick(task) : undefined,
              role: isClickable ? 'button' : undefined,
              tabIndex: isClickable ? 0 : undefined,
              onKeyDown: isClickable
                ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(task); } }
                : undefined,
              title: task.isExisting ? 'Open this task' : 'Click to create this task',
              dangerouslySetInnerHTML: { __html: amplenoteMarkdownRender(task.title) || task.title },
            }),
            !task.isExisting && isClickable
              ? h('span', { className: 'dream-task-new-badge', title: 'New task \u2014 click to create' }, '+new')
              : null,
            h('span', {
              className: `dream-task-rating dream-task-rating--${ _ratingTier(task.rating) }`,
              title: `Relevance: ${ task.rating }/10`,
            }, `${ task.rating }/10`)
          ),
          h('p', {
            className: 'dream-task-card-explanation',
            title: task.explanation?.length > MIN_TEXT_OVERFLOW_SIZE ? task.explanation : null,
            dangerouslySetInnerHTML: { __html: amplenoteMarkdownRender(task.explanation) || '' },
          })
        );
      })
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Choose loading, error, empty, or task-list view when LLM is configured.
// @param {Function} h - React createElement.
// @param {object} viewProps - loading, error, tasks, maxTasks, noteLink, headerActions, and click/analysis handlers.
// [Claude claude-opus-4-6] Task: branch loading / error / empty / task list for the configured-LLM path
// Prompt: "Break apart DreamTask main component into local functions for maintainability"
function renderDreamTaskConfiguredBody(h, { loading, error, tasks, maxTasks, noteLink, headerActions,
    onSettingsClick, runAnalysis, onTaskClick, listRef }) {
  if (loading) return renderLoadingState(h);
  if (error) {
    return renderErrorState(h, error, noteLink, () => runAnalysis(null), onSettingsClick);
  }
  if (!tasks || tasks.length === 0) {
    return renderEmptyState(h, noteLink, () => runAnalysis(null));
  }
  return renderTaskList(h, tasks, maxTasks, headerActions, onTaskClick, listRef);
}

// ----------------------------------------------------------------------------------------------
// @desc Header actions cluster: reseed plus note link.
// @param {Function} h - React createElement.
// @param {object} actions - noteUUID, onOpenNote, onReseed.
// [Claude claude-opus-4-6] Task: build header row links (reseed + today's note) for list/error/empty chrome
// Prompt: "Break apart DreamTask main component into local functions for maintainability"
function buildDreamTaskHeaderActions(h, { noteUUID, onOpenNote, onReseed }) {
  return h('span', { className: 'dream-task-header-actions' },
    renderReseedLink(h, onReseed),
    renderNoteLink(h, noteUUID, onOpenNote),
  );
}

// =============================================================================
// DreamTask widget — state, effects, and composition
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Dashboard widget: loads AI-ranked task suggestions from planning context and today's cache note.
// @param {object} props - app, grid sizes, settings callback, provider API key and provider enum.
// [Claude claude-4.6-opus-high-thinking] Task: DreamTask widget — providerApiKey prop, no direct app.settings for AI config
// Prompt: "use apiKeyFromProvider to pass a providerApiKey prop; don't mix default and named arguments"
// [Claude claude-opus-4-6] Task: accept providerEm for provider-specific error messages
// Prompt: "when we can not fetch suggested tasks, the widget explains why with provider name"
export default function DreamTaskWidget({ app, gridHeightSize, gridWidthSize, onOpenSettings, providerApiKey,
    providerEm }) {
  const h = createElement;
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [defaultNoteUUID, setDefaultNoteUUID] = useState(null);
  const [, setSeenUuidsMap] = useState(() => _loadSeenUuidsMap(app));
  const listRef = useRef(null);

  const envApiKey = (typeof process !== 'undefined' && process.env?.OPEN_AI_ACCESS_TOKEN) || '';
  const hasLlmConfig = !!(envApiKey || providerApiKey);
  const providerName = providerEm ? providerNameFromProviderEm(providerEm) : null;

  const maxTasks = _maxTasksFromGrid(gridWidthSize, gridHeightSize);
  const proposedTasksNoteName = _todayProposedTasksNoteName();
  const previousMaxTasksRef = useRef(maxTasks);

  // [Claude claude-4.6-sonnet-medium-thinking] Task: record seen UUIDs from returned tasks into daily hash
  const recordTaskUuids = useCallback(async (shownUuids, currentMap) => {
    const uuids = (shownUuids || []).filter(Boolean);
    if (uuids.length === 0) return currentMap;
    const updated = await _recordSeenUuids(app, currentMap, uuids);
    setSeenUuidsMap(updated);
    return updated;
  }, [app]);

  const runAnalysis = useCallback(async (excludeUuids, options = {}) => {
    if (!hasLlmConfig) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDreamTaskSuggestions(app, {
        proposedTasksNoteName,
        excludeUuids,
        options,
        maxTasks,
      });
      await applyDreamTaskAnalysisResult(result, {
        providerName,
        app,
        recordTaskUuids,
        setError,
        setTasks,
        setNoteUUID,
        setDefaultNoteUUID,
      });
    } catch (err) {
      setError({ error: err.message || 'Analysis failed', errorCode: 'llm_error', providerName });
    } finally {
      setLoading(false);
    }
  }, [hasLlmConfig, app, recordTaskUuids, maxTasks, proposedTasksNoteName, providerName]);

  useEffect(() => {
    const initialMap = _loadSeenUuidsMap(app);
    setSeenUuidsMap(initialMap);
    runAnalysis(null, { minimumTaskCount: maxTasks });
  }, []);

  // [Claude gpt-5.3-codex] Task: top up suggestions when widget grid grows
  // Prompt: "if DreamTask size changes, prepend enough new suggestions to fill added space"
  useEffect(() => {
    if (!hasLlmConfig) return;
    const previousMaxTasks = previousMaxTasksRef.current;
    previousMaxTasksRef.current = maxTasks;
    if (!shouldFetchMoreTasksAfterGridGrowth({ maxTasks, previousMaxTasks, tasks })) return;
    requestDreamTaskRefreshExcludingRecent(app, runAnalysis, maxTasks);
  }, [app, hasLlmConfig, maxTasks, runAnalysis, tasks]);

  // [Claude claude-4.6-opus-high-thinking] Task: retry when API key becomes available and tasks are empty
  // Prompt: "update the input props for dream-task.js such that it will retry its query if it does not already have suggestions"
  const prevHasConfigRef = useRef(hasLlmConfig);
  useEffect(() => {
    const hadConfig = prevHasConfigRef.current;
    prevHasConfigRef.current = hasLlmConfig;
    if (!hadConfig && hasLlmConfig && !tasks) {
      runAnalysis(null, { minimumTaskCount: maxTasks });
    }
  }, [hasLlmConfig, tasks, runAnalysis, maxTasks]);

  // [Claude claude-4.6-opus-high-thinking] Task: wire up tippy popups for Amplenote Rich Footnote links after render
  // Prompt: "Update dream-task.js to print Amplenote markdown when printing tasks"
  useEffect(() => {
    attachFootnotePopups(listRef.current);
  });

  const onOpenNote = async (e) => {
    e.preventDefault();
    if (noteUUID) await app.navigate(`https://www.amplenote.com/notes/${ noteUUID }`);
  };

  const onSettingsClick = (e) => {
    e.preventDefault();
    handleOpenSettings(onOpenSettings);
  };

  // [Claude claude-4.6-opus-high-thinking] Task: reseed — clear tasks then re-prompt with exclusions
  // Prompt: "reseed should clear the current tasks, replacing them with a loading spinner"
  const onReseed = async (e) => {
    e.preventDefault();
    setTasks(null);
    requestDreamTaskRefreshExcludingRecent(app, runAnalysis, maxTasks);
  };

  if (!hasLlmConfig) {
    return renderNoConfigState(h, onSettingsClick, providerName);
  }

  const headerActions = buildDreamTaskHeaderActions(h, { noteUUID, onOpenNote, onReseed });
  const noteLink = renderNoteLink(h, noteUUID, onOpenNote);
  const onTaskClick = (task) => handleTaskClick(app, task, defaultNoteUUID);

  return renderDreamTaskConfiguredBody(h, {
    loading,
    error,
    tasks,
    maxTasks,
    noteLink,
    headerActions,
    onSettingsClick,
    runAnalysis,
    onTaskClick,
    listRef,
  });
}
