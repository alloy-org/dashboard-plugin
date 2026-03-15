/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask widget — AI-suggested tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget that uses an agentic loop to suggest goal-aligned tasks"
 */
import { createElement, useEffect, useState, useCallback } from "react";
import { widgetDataFromId, SETTING_KEYS, IS_DEV_ENVIRONMENT, widgetTitleFromId } from "constants/settings";
import { analyzeDreamTasks } from "dream-task-service";
import NoteEditor from "note-editor";
import { navigateToNote as goalNavigateToNote } from "util/goal-notes";
import WidgetWrapper from "widget-wrapper";
import "styles/dream-task.scss"

const WIDGET_ID = 'dream-task';
const SEEN_UUIDS_SETTING_KEY = 'dashboard_dream-task_seen_uuids';
const SEEN_UUIDS_RETENTION_DAYS = 7;

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

// [Claude] Task: derive section anchor for task heading to enable deep-link navigation
// Prompt: "clicking on the task text should navigate to the task in its note"
// Date: 2026-03-14 | Model: claude-sonnet-4-6
function _headingToAnchor(index, task) {
  const headingText = `${index + 1}. ${task.title} (Rating: ${task.rating}/10)`;
  return headingText.replace(/\s+/g, '_');
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleOpenNote(app, noteUUID) {
  if (!noteUUID) return null;
  return await goalNavigateToNote(app, noteUUID);
}

// [Claude] Task: navigate to task in its note (with section anchor in production)
// Prompt: "clicking on the task text should navigate to the task in its note"
// Date: 2026-03-14 | Model: claude-sonnet-4-6
async function handleTaskClick(app, noteUUID, task, index) {
  if (!noteUUID) return;
  const anchor = _headingToAnchor(index, task);
  if (IS_DEV_ENVIRONMENT) {
    const result = await goalNavigateToNote(app, noteUUID);
    if (result?.devEdit) return result;
  }
  await app.navigate(`https://www.amplenote.com/notes/${noteUUID}#${anchor}`);
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
    title: 'Open this month\'s task ideas note',
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
      h('p', null, 'Analyzing your goals and tasks\u2026')
    )
  );
}

function renderNoConfigState(h, onSettingsClick) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID },
    h('div', { className: 'dream-task-no-config' },
      h('p', { className: 'dream-task-no-config-text' },
        'DreamTask uses AI to suggest tasks aligned with your goals.'
      ),
      h('p', { className: 'dream-task-no-config-text' },
        'An LLM provider and API key are required. ',
        h('a', { href: '#', className: 'dream-task-settings-link', onClick: onSettingsClick },
          'Configure AI settings \u2192'
        )
      )
    )
  );
}

function renderErrorState(h, error, noteLink, onRetry) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-error' },
      h('p', null, error),
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

// [Claude] Task: make task title clickable to navigate to task in note; pointer cursor on hover
// Prompt: "hovering on the task text should show a pointer cursor, and clicking on the task text should navigate to the task in its note"
// Date: 2026-03-14 | Model: claude-sonnet-4-6
function renderTaskList(h, tasks, maxTasks, headerActions, noteUUID, onTaskClick) {
  const displayTasks = _selectDisplayTasks(tasks, maxTasks);
  return h(WidgetWrapper, {
    headerActions, subtitle: "What if you did it today?",
    title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID,
  },
    h('div', { className: 'dream-task-list' },
      ...displayTasks.map((task, i) => {
        const noteIndex = tasks.indexOf(task);
        return h('div', { key: i, className: 'dream-task-card' },
          h('div', { className: 'dream-task-card-header' },
            h('span', {
              className: 'dream-task-card-title dream-task-card-title--clickable',
              onClick: noteUUID && onTaskClick && noteIndex >= 0 ? () => onTaskClick(task, noteIndex) : undefined,
              role: noteUUID && onTaskClick ? 'button' : undefined,
              tabIndex: noteUUID && onTaskClick ? 0 : undefined,
              onKeyDown: noteUUID && onTaskClick && noteIndex >= 0
                ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTaskClick(task, noteIndex); } }
                : undefined,
            }, task.title),
            h('span', {
              className: `dream-task-rating dream-task-rating--${_ratingTier(task.rating)}`,
              title: `Relevance: ${task.rating}/10`,
            }, `${task.rating}/10`)
          ),
          h('p', { className: 'dream-task-card-explanation' }, task.explanation)
        );
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// [Claude] Task: DreamTask widget with grid-sized task count, reseed link, and seen-UUIDs exclusion
// Prompt: "show tasks equal to grid cells; add reseed link; track seen UUIDs per day and exclude over 7 days"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
export default function DreamTaskWidget({ app, gridHeightSize = 1, gridWidthSize = 1, onOpenSettings }) {
  const h = createElement;
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);
  const [seenUuidsMap, setSeenUuidsMap] = useState(() => _loadSeenUuidsMap(app));

  const llmProvider = app.settings?.[SETTING_KEYS.LLM_PROVIDER];
  const llmApiKey = app.settings?.[SETTING_KEYS.LLM_API_KEY];
  const envApiKey = (typeof process !== 'undefined' && process.env?.OPEN_AI_ACCESS_TOKEN) || '';
  const hasLlmConfig = envApiKey || (llmProvider && llmProvider !== 'none' && llmApiKey);

  const maxTasks = _maxTasksFromGrid(gridWidthSize, gridHeightSize);

  // [Claude] Task: record seen UUIDs from returned tasks into daily hash
  // Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
  const recordTaskUuids = useCallback(async (shownUuids, currentMap) => {
    const uuids = (shownUuids || []).filter(Boolean);
    if (uuids.length === 0) return currentMap;
    const updated = await _recordSeenUuids(app, currentMap, uuids);
    setSeenUuidsMap(updated);
    return updated;
  }, [app]);

  const runAnalysis = useCallback((excludeUuids) => {
    if (!hasLlmConfig) return;
    setLoading(true);
    setError(null);
    analyzeDreamTasks(app, excludeUuids)
      .then(async result => {
        if (result?.error) setError(result.error);
        else if (result?.tasks) {
          setTasks(result.tasks);
          const currentMap = _loadSeenUuidsMap(app);
          await recordTaskUuids(result.shownUuids || [], currentMap);
        }
        if (result?.noteUUID) setNoteUUID(result.noteUUID);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Analysis failed');
        setLoading(false);
      });
  }, [hasLlmConfig, app, recordTaskUuids]);

  useEffect(() => {
    const initialMap = _loadSeenUuidsMap(app);
    setSeenUuidsMap(initialMap);
    runAnalysis(null);
  }, []);

  const onOpenNote = async (e) => {
    e.preventDefault();
    const result = await handleOpenNote(app, noteUUID);
    if (result?.devEdit) setEditingNoteUUID(result.noteUUID);
  };

  const onSettingsClick = (e) => {
    e.preventDefault();
    handleOpenSettings(onOpenSettings);
  };

  // [Claude] Task: reseed handler — exclude currently visible task UUIDs before re-prompting LLM
  // Prompt: "re-prompt LLM with a set of potential tasks that excludes the UUIDs of the tasks that were visible when the user clicked reseed"
  // Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
  const onReseed = async (e) => {
    e.preventDefault();
    const freshMap = _loadSeenUuidsMap(app);
    const excludeUuids = _getRecentlySeenUuids(freshMap);
    runAnalysis(excludeUuids);
  };

  if (editingNoteUUID && IS_DEV_ENVIRONMENT) {
    return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: widgetIcon(), widgetId: WIDGET_ID },
      h(NoteEditor, {
        app,
        noteUUID: editingNoteUUID,
        onBack: () => setEditingNoteUUID(null),
      })
    );
  }

  if (!hasLlmConfig) {
    return renderNoConfigState(h, onSettingsClick);
  }

  const noteLink = renderNoteLink(h, noteUUID, onOpenNote);
  const reseedLink = renderReseedLink(h, onReseed);
  const headerActions = h('span', { className: 'dream-task-header-actions' },
    reseedLink,
    noteLink,
  );

  const onTaskClick = async (task, index) => {
    const result = await handleTaskClick(app, noteUUID, task, index);
    if (result?.devEdit) setEditingNoteUUID(result.noteUUID);
  };

  if (loading) return renderLoadingState(h);
  if (error) return renderErrorState(h, error, noteLink, () => runAnalysis(null));
  if (!tasks || tasks.length === 0) return renderEmptyState(h, noteLink, () => runAnalysis(null));

  return renderTaskList(h, tasks, maxTasks, headerActions, noteUUID, onTaskClick);
}
