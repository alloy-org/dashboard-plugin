/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask widget — AI-suggested tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget that uses an agentic loop to suggest goal-aligned tasks"
 */
import { createElement, useEffect, useState, useCallback, useRef } from "react";
import { DASHBOARD_NOTE_TAG, widgetDataFromId, SETTING_KEYS, widgetTitleFromId } from "constants/settings";
import { providerNameFromProviderEm } from "providers/ai-provider-settings";
import { analyzeDreamTasks } from "dream-task-service";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import WidgetWrapper from "widget-wrapper";
import "styles/dream-task.scss"

const MIN_TEXT_OVERFLOW_SIZE = 230; // Ballparked by eye on example text. Used to determine when to apply visible title.
const SEEN_UUIDS_SETTING_KEY = 'dashboard_dream-task_seen_uuids';
const SEEN_UUIDS_RETENTION_DAYS = 7;
const WIDGET_ID = 'dream-task';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// [Claude] Task: compute maxTasks from both grid dimensions (width × height cells)
// Prompt: "show as many tasks as it has cells (1x2 = two tasks, 2x1 = two tasks, 2x2 = four tasks)"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
function _maxTasksFromGrid(gridWidthSize, gridHeightSize) {
  return Math.max(1, (gridWidthSize || 1) * (gridHeightSize || 1));
}

// ---------------------------------------------------------------------------
function _selectDisplayTasks(tasks, maxTasks) {
  const sorted = [...tasks].sort((a, b) => b.rating - a.rating);
  return sorted.slice(0, maxTasks);
}

// [Claude] Task: load and prune seen-UUIDs hash from app.settings, dropping entries older than retention window
// Prompt: "store a hash of { [date] => [uuid_seen_1, ...] }; filter past-7-day UUIDs when submitting to LLM"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
function _loadSeenUuidsMap(app) {
  const raw = app.settings?.[SEEN_UUIDS_SETTING_KEY];
  let map = {};
  if (raw) {
    try {
      map = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      map = {};
    }
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SEEN_UUIDS_RETENTION_DAYS);
  const pruned = {};
  for (const [date, uuids] of Object.entries(map)) {
    if (new Date(date) >= cutoff) pruned[date] = uuids;
  }
  return pruned;
}

// [Claude] Task: collect all seen UUIDs from the past 7 days into a flat set for exclusion
// Prompt: "filter out the tasks with those UUIDs when submitting options to the LLM"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
function _getRecentlySeenUuids(seenUuidsMap) {
  const allUuids = new Set();
  for (const uuids of Object.values(seenUuidsMap)) {
    for (const uuid of uuids) allUuids.add(uuid);
  }
  return allUuids;
}

// [Claude] Task: compute today's ISO date string (YYYY-MM-DD) for keying the seen-UUIDs map
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
function _todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// [Claude] Task: derive the date-specific DreamTask note name for today's suggestions
// Prompt: "persist suggested tasks in a date-specific dashboard note instead of plugin settings"
// Date: 2026-03-24 | Model: gpt-5.3-codex
function _todayProposedTasksNoteName() {
  const todayLabel = (new Date()).toLocaleString([], {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `Dashboard proposed tasks for ${todayLabel}`;
}

// [Claude] Task: merge new task UUIDs into today's seen-UUIDs entry and persist via app.setSetting
// Prompt: "store a hash of { [date] => [uuid_seen_1, ...] }"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
async function _recordSeenUuids(app, currentMap, taskUuids) {
  const today = _todayKey();
  const existing = currentMap[today] || [];
  const merged = Array.from(new Set([...existing, ...taskUuids]));
  const updated = { ...currentMap, [today]: merged };
  await app.setSetting(SEEN_UUIDS_SETTING_KEY, JSON.stringify(updated));
  return updated;
}

// ---------------------------------------------------------------------------
function _ratingTier(rating) {
  if (rating >= 8) return 'high';
  if (rating >= 5) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

// [Claude] Task: navigate to existing task in its note, or create invented task in busiest note
// Prompt: "clicking on an existing task navigates to it; clicking on an invented task creates it via app.insertTask"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
async function handleTaskClick(app, task, defaultNoteUUID) {
  if (task.isExisting && task.uuid && task.noteUUID) {
    await app.navigate(`https://www.amplenote.com/notes/${task.noteUUID}?highlightTaskUUID=${task.uuid}`);
  } else if (defaultNoteUUID) {
    const newTaskUUID = await app.insertTask({ uuid: defaultNoteUUID }, { content: task.title });
    if (newTaskUUID) {
      await app.navigate(`https://www.amplenote.com/notes/${defaultNoteUUID}?highlightTaskUUID=${newTaskUUID}`);
    }
  }
}

function handleOpenSettings(onOpenSettings) {
  if (onOpenSettings) onOpenSettings();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
function renderNoteLink(h, noteUUID, onOpenNote) {
  if (!noteUUID) return null;
  return h('a', {
    href: '#', className: 'widget-header-action', onClick: onOpenNote,
    title: 'Open today\'s proposed tasks note',
  }, '\uD83D\uDDD2\uFE0F Note');
}

// ---------------------------------------------------------------------------
function widgetIcon() {
  return widgetDataFromId(WIDGET_ID).icon;
}

// [Claude] Task: render reseed link in the widget header to re-prompt LLM with exclusions
// Prompt: "add a link to the top of Dream Task module to reseed the tasks"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
function renderReseedLink(h, onReseed) {
  return h('a', {
    href: '#', className: 'widget-header-action', onClick: onReseed,
    title: 'Get new task suggestions (excludes tasks shown today)',
  }, '\uD83D\uDD04 Reseed');
}

function renderLoadingState(h) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID },
    h('div', { className: 'dream-task-loading' },
      h('div', { className: 'dream-task-spinner' }),
      h('p', null, 'Deducing content... \u2026')
    )
  );
}

// ---------------------------------------------------------------------------------------------
// [Claude] Task: show provider-specific message when no API key is configured
// Prompt: "when we can not fetch suggested tasks, the widget explains why: no API key for provider"
// Date: 2026-04-04 | Model: claude-opus-4-6
function renderNoConfigState(h, onSettingsClick, providerName) {
  const message = providerName
    ? `No API key is available for the currently selected AI provider, ${providerName}.`
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

// ---------------------------------------------------------------------------------------------
// [Claude] Task: render specific error messages based on errorCode from the service
// Prompt: "when we can not fetch suggested tasks, the widget explains why"
// Date: 2026-04-04 | Model: claude-opus-4-6
function renderErrorState(h, errorInfo, noteLink, onRetry, onSettingsClick) {
  const { error, errorCode, errorDetail, providerName } = errorInfo;
  let content;
  switch (errorCode) {
    case 'invalid_api_key':
      content = [
        h('p', null, `The API key for ${providerName || 'your AI provider'} appears to be invalid or unauthorized.`),
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
          errorDetail ? ` with this detail: ${errorDetail}` : '',
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

function renderEmptyState(h, noteLink, onRetry) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-empty' },
      h('p', null, 'No task suggestions available.'),
      h('button', { className: 'dream-task-retry', onClick: onRetry }, 'Refresh')
    )
  );
}

// [Claude] Task: render task list with visual distinction between existing and invented tasks
// Prompt: "at least 50% of suggested tasks should be existing tasks; clicking invented tasks creates them"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
function renderTaskList(h, tasks, maxTasks, headerActions, onTaskClick, listRef) {
  const displayTasks = _selectDisplayTasks(tasks, maxTasks);
  return h(WidgetWrapper, {
    headerActions, subtitle: "What if you did it today?",
    title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID,
  },
    h('div', { className: 'dream-task-list', ref: listRef },
      ...displayTasks.map((task, i) => {
        const isClickable = !!onTaskClick;
        return h('div', { key: i, className: `dream-task-card${task.isExisting ? '' : ' dream-task-card--invented'}` },
          h('div', { className: 'dream-task-card-header' },
            h('span', {
              className: `dream-task-card-title${isClickable ? ' dream-task-card-title--clickable' : ''}`,
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
              className: `dream-task-rating dream-task-rating--${_ratingTier(task.rating)}`,
              title: `Relevance: ${task.rating}/10`,
            }, `${task.rating}/10`)
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// [Claude] Task: DreamTask widget — receives providerApiKey prop, no direct app.settings reads for AI config
// Prompt: "use apiKeyFromProvider to pass a providerApiKey prop; don't mix default and named arguments"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
// [Claude] Task: accept providerEm prop for provider-specific error messages
// Prompt: "when we can not fetch suggested tasks, the widget explains why with provider name"
// Date: 2026-04-04 | Model: claude-opus-4-6
export default function DreamTaskWidget({ app, gridHeightSize, gridWidthSize, onOpenSettings, providerApiKey, providerEm }) {
  const h = createElement;
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [defaultNoteUUID, setDefaultNoteUUID] = useState(null);
  const [seenUuidsMap, setSeenUuidsMap] = useState(() => _loadSeenUuidsMap(app));
  const listRef = useRef(null);

  const envApiKey = (typeof process !== 'undefined' && process.env?.OPEN_AI_ACCESS_TOKEN) || '';
  const hasLlmConfig = !!(envApiKey || providerApiKey);
  const providerName = providerEm ? providerNameFromProviderEm(providerEm) : null;

  const maxTasks = _maxTasksFromGrid(gridWidthSize, gridHeightSize);
  const proposedTasksNoteName = _todayProposedTasksNoteName();
  const previousMaxTasksRef = useRef(maxTasks);

  // [Claude] Task: record seen UUIDs from returned tasks into daily hash
  // Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
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
      // Query the date-specific note before attempting any LLM generation.
      const existingNoteHandle = await app.findNote({ name: proposedTasksNoteName, tags: [DASHBOARD_NOTE_TAG] });
      const result = await analyzeDreamTasks(app, {
        excludeUuids,
        forceRefresh: !!options.forceRefresh,
        minimumTaskCount: options.minimumTaskCount || maxTasks,
        noteName: proposedTasksNoteName,
        existingNoteHandle,
      });

      if (result?.error) setError({ error: result.error, errorCode: result.errorCode, errorDetail: result.errorDetail, providerName });
      else if (result?.tasks) {
        setTasks(result.tasks);
        const currentMap = _loadSeenUuidsMap(app);
        await recordTaskUuids(result.shownUuids || [], currentMap);
      }
      if (result?.noteUUID) setNoteUUID(result.noteUUID);
      if (result?.defaultNoteUUID) setDefaultNoteUUID(result.defaultNoteUUID);
      setLoading(false);
    } catch (err) {
      setError({ error: err.message || 'Analysis failed', errorCode: 'llm_error', providerName });
      setLoading(false);
    }
  }, [hasLlmConfig, app, recordTaskUuids, maxTasks, proposedTasksNoteName]);

  useEffect(() => {
    const initialMap = _loadSeenUuidsMap(app);
    setSeenUuidsMap(initialMap);
    runAnalysis(null, { minimumTaskCount: maxTasks });
  }, []);

  // [Claude] Task: top up and prepend suggestions when widget size increases
  // Prompt: "if DreamTask size changes, prepend enough new suggestions to fill added space"
  // Date: 2026-03-24 | Model: gpt-5.3-codex
  useEffect(() => {
    if (!hasLlmConfig) return;
    const previousMaxTasks = previousMaxTasksRef.current;
    previousMaxTasksRef.current = maxTasks;
    if (maxTasks <= previousMaxTasks) return;
    if (!tasks) return;
    if (tasks.length >= maxTasks) return;

    const freshMap = _loadSeenUuidsMap(app);
    const excludeUuids = _getRecentlySeenUuids(freshMap);
    runAnalysis(excludeUuids, { forceRefresh: true, minimumTaskCount: maxTasks });
  }, [app, hasLlmConfig, maxTasks, runAnalysis, tasks]);

  // [Claude] Task: retry analysis when API key transitions from absent to present and no suggestions exist
  // Prompt: "update the input props for dream-task.js such that it will retry its query if it does not already have suggestions"
  // Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
  const prevHasConfigRef = useRef(hasLlmConfig);
  useEffect(() => {
    const hadConfig = prevHasConfigRef.current;
    prevHasConfigRef.current = hasLlmConfig;
    if (!hadConfig && hasLlmConfig && !tasks) {
      runAnalysis(null, { minimumTaskCount: maxTasks });
    }
  }, [hasLlmConfig, tasks, runAnalysis, maxTasks]);

  // [Claude] Task: wire up tippy popups for Amplenote Rich Footnote links after render
  // Prompt: "Update dream-task.js to print Amplenote markdown when printing tasks"
  // Date: 2026-03-15 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    attachFootnotePopups(listRef.current);
  });

  const onOpenNote = async (e) => {
    e.preventDefault();
    if (noteUUID) await app.navigate(`https://www.amplenote.com/notes/${noteUUID}`);
  };

  const onSettingsClick = (e) => {
    e.preventDefault();
    handleOpenSettings(onOpenSettings);
  };

  // [Claude] Task: reseed handler — clear tasks, show loading, then re-prompt LLM with exclusions
  // Prompt: "reseed should clear the current tasks, replacing them with a loading spinner"
  // Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
  const onReseed = async (e) => {
    e.preventDefault();
    setTasks(null);
    const freshMap = _loadSeenUuidsMap(app);
    const excludeUuids = _getRecentlySeenUuids(freshMap);
    runAnalysis(excludeUuids, { forceRefresh: true, minimumTaskCount: maxTasks });
  };

  if (!hasLlmConfig) {
    return renderNoConfigState(h, onSettingsClick, providerName);
  }

  const noteLink = renderNoteLink(h, noteUUID, onOpenNote);
  const reseedLink = renderReseedLink(h, onReseed);
  const headerActions = h('span', { className: 'dream-task-header-actions' },
    reseedLink,
    noteLink,
  );

  const onTaskClick = (task) => handleTaskClick(app, task, defaultNoteUUID);

  if (loading) return renderLoadingState(h);
  if (error) return renderErrorState(h, error, noteLink, () => runAnalysis(null), onSettingsClick);
  if (!tasks || tasks.length === 0) return renderEmptyState(h, noteLink, () => runAnalysis(null));

  return renderTaskList(h, tasks, maxTasks, headerActions, onTaskClick, listRef);
}
