/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask widget — AI-suggested tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget that uses an agentic loop to suggest goal-aligned tasks"
 */
import { createElement, useEffect, useState, useCallback } from "react";
import { SETTING_KEYS, IS_DEV_ENVIRONMENT, widgetTitleFromId } from "constants/settings";
import { analyzeDreamTasks } from "dream-task-service";
import NoteEditor from "note-editor";
import { navigateToNote as goalNavigateToNote } from "util/goal-notes";
import WidgetWrapper from "widget-wrapper";
import "styles/dream-task.scss"

const WIDGET_ID = 'dream-task';
const WIDGET_ICON = '\uD83D\uDCA1';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
function _selectDisplayTasks(tasks, maxTasks) {
  const sorted = [...tasks].sort((a, b) => b.rating - a.rating);
  return sorted.slice(0, maxTasks);
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

async function handleOpenNote(app, noteUUID) {
  if (!noteUUID) return null;
  return await goalNavigateToNote(app, noteUUID);
}

function handleOpenSettings(onOpenSettings) {
  if (onOpenSettings) onOpenSettings();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderNoteLink(h, noteUUID, onOpenNote) {
  if (!noteUUID) return null;
  return h('a', {
    href: '#', className: 'widget-header-action', onClick: onOpenNote,
    title: 'Open this month\'s task ideas note',
  }, '\uD83D\uDDD2\uFE0F Note');
}

function renderLoadingState(h) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID },
    h('div', { className: 'dream-task-loading' },
      h('div', { className: 'dream-task-spinner' }),
      h('p', null, 'Analyzing your goals and tasks\u2026')
    )
  );
}

function renderNoConfigState(h, onSettingsClick) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID },
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
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-error' },
      h('p', null, error),
      h('button', { className: 'dream-task-retry', onClick: onRetry }, 'Retry')
    )
  );
}

function renderEmptyState(h, noteLink, onRetry) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-empty' },
      h('p', null, 'No task suggestions available.'),
      h('button', { className: 'dream-task-retry', onClick: onRetry }, 'Refresh')
    )
  );
}

// [Claude] Task: render goals summary above task cards in the dream task widget
// Prompt: "begin the date's content by summarizing quarter/month/week goals before the task list"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function renderTaskList(h, tasks, maxTasks, noteLink, goalsSummary) {
  const displayTasks = _selectDisplayTasks(tasks, maxTasks);
  return h(WidgetWrapper, {
    title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID,
    headerActions: noteLink,
  },
    h('div', { className: 'dream-task-list' },
      goalsSummary
        ? h('div', { className: 'dream-task-goals-summary' },
            h('p', { className: 'dream-task-goals-text' }, goalsSummary)
          )
        : null,
      ...displayTasks.map((task, i) =>
        h('div', { key: i, className: 'dream-task-card' },
          h('div', { className: 'dream-task-card-header' },
            h('span', { className: 'dream-task-card-title' }, task.title),
            h('span', {
              className: `dream-task-rating dream-task-rating--${_ratingTier(task.rating)}`,
              title: `Relevance: ${task.rating}/10`,
            }, `${task.rating}/10`)
          ),
          h('p', { className: 'dream-task-card-explanation' }, task.explanation)
        )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// [Claude] Task: DreamTask widget with extracted functions and dev-mode app initialization
// Prompt: "extract all possible functionality to local functions, initialize with app object in dev"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function DreamTaskWidget({ app, gridHeightSize = 1, onOpenSettings }) {
  const h = createElement;
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [goalsSummary, setGoalsSummary] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);

  const llmProvider = app.settings?.[SETTING_KEYS.LLM_PROVIDER];
  const llmApiKey = app.settings?.[SETTING_KEYS.LLM_API_KEY];
  const envApiKey = (typeof process !== 'undefined' && process.env?.OPEN_AI_ACCESS_TOKEN) || '';
  const hasLlmConfig = envApiKey || (llmProvider && llmProvider !== 'none' && llmApiKey);

  const maxTasks = gridHeightSize >= 2 ? 2 : 1;

  const runAnalysis = useCallback(() => {
    if (!hasLlmConfig) return;
    setLoading(true);
    setError(null);
    analyzeDreamTasks(app)
      .then(result => {
        if (result?.error) setError(result.error);
        else if (result?.tasks) setTasks(result.tasks);
        if (result?.goalsSummary) setGoalsSummary(result.goalsSummary);
        if (result?.noteUUID) setNoteUUID(result.noteUUID);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Analysis failed');
        setLoading(false);
      });
  }, [hasLlmConfig, app]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const onOpenNote = async (e) => {
    e.preventDefault();
    const result = await handleOpenNote(app, noteUUID);
    if (result?.devEdit) setEditingNoteUUID(result.noteUUID);
  };

  const onSettingsClick = (e) => {
    e.preventDefault();
    handleOpenSettings(onOpenSettings);
  };

  if (editingNoteUUID && IS_DEV_ENVIRONMENT) {
    return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID },
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

  if (loading) return renderLoadingState(h);
  if (error) return renderErrorState(h, error, noteLink, runAnalysis);
  if (!tasks || tasks.length === 0) return renderEmptyState(h, noteLink, runAnalysis);

  return renderTaskList(h, tasks, maxTasks, noteLink, goalsSummary);
}
