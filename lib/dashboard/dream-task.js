/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask widget — AI-suggested tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget that uses an agentic loop to suggest goal-aligned tasks"
 */
import { createElement, useEffect, useState, useCallback } from "react";
import { SETTING_KEYS, DASHBOARD_FOCUS, IS_DEV_ENVIRONMENT, widgetTitleFromId } from "constants/settings";
import NoteEditor from "note-editor";
import { navigateToNote } from "util/goal-notes";
import WidgetWrapper from "widget-wrapper";

// [Claude] Task: DreamTask widget component with LLM settings gate and async analysis
// Prompt: "Create a DreamTask widget that uses an agentic loop to suggest goal-aligned tasks"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function DreamTaskWidget({ gridHeightSize = 1, settings, onOpenSettings }) {
  const h = createElement;
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);

  const llmProvider = settings?.[SETTING_KEYS.LLM_PROVIDER];
  const llmApiKey = settings?.[SETTING_KEYS.LLM_API_KEY];
  const hasLlmConfig = llmProvider && llmProvider !== 'none' && llmApiKey;
  const maxTasks = gridHeightSize >= 2 ? 2 : 1;

  const runAnalysis = useCallback(() => {
    if (!hasLlmConfig) return;
    setLoading(true);
    setError(null);
    callPlugin('dreamTaskAnalyze').then(result => {
      if (result?.error) {
        setError(result.error);
      } else if (result?.tasks) {
        setTasks(result.tasks);
      }
      if (result?.noteUUID) setNoteUUID(result.noteUUID);
      setLoading(false);
    }).catch(err => {
      setError(err.message || 'Analysis failed');
      setLoading(false);
    });
  }, [hasLlmConfig]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const handleOpenNote = async (e) => {
    e.preventDefault();
    if (!noteUUID) return;
    const result = await navigateToNote(noteUUID);
    if (result?.devEdit) setEditingNoteUUID(result.noteUUID);
  };

  const handleOpenSettings = (e) => {
    e.preventDefault();
    if (onOpenSettings) onOpenSettings();
  };

  if (editingNoteUUID && IS_DEV_ENVIRONMENT) {
    return h(WidgetWrapper, { title: widgetTitleFromId('dream-task'), icon: '\uD83D\uDCA1', widgetId: 'dream-task' },
      h(NoteEditor, {
        noteUUID: editingNoteUUID,
        onBack: () => setEditingNoteUUID(null),
      })
    );
  }

  if (!hasLlmConfig) {
    return h(WidgetWrapper, { title: widgetTitleFromId('dream-task'), icon: '\uD83D\uDCA1', widgetId: 'dream-task' },
      h('div', { className: 'dream-task-no-config' },
        h('p', { className: 'dream-task-no-config-text' },
          'DreamTask uses AI to suggest tasks aligned with your goals.'
        ),
        h('p', { className: 'dream-task-no-config-text' },
          'An LLM provider and API key are required. ',
          h('a', { href: '#', className: 'dream-task-settings-link', onClick: handleOpenSettings },
            'Configure AI settings \u2192'
          )
        )
      )
    );
  }

  const noteLink = noteUUID
    ? h('a', {
        href: '#', className: 'widget-header-action', onClick: handleOpenNote,
        title: 'Open this month\'s task ideas note',
      }, '\uD83D\uDDD2\uFE0F Note')
    : null;

  if (loading) {
    return h(WidgetWrapper, { title: widgetTitleFromId('dream-task'), icon: '\uD83D\uDCA1', widgetId: 'dream-task' },
      h('div', { className: 'dream-task-loading' },
        h('div', { className: 'dream-task-spinner' }),
        h('p', null, 'Analyzing your goals and tasks\u2026')
      )
    );
  }

  if (error) {
    return h(WidgetWrapper, { title: widgetTitleFromId('dream-task'), icon: '\uD83D\uDCA1', widgetId: 'dream-task', headerActions: noteLink },
      h('div', { className: 'dream-task-error' },
        h('p', null, error),
        h('button', { className: 'dream-task-retry', onClick: runAnalysis }, 'Retry')
      )
    );
  }

  if (!tasks || tasks.length === 0) {
    return h(WidgetWrapper, { title: widgetTitleFromId('dream-task'), icon: '\uD83D\uDCA1', widgetId: 'dream-task', headerActions: noteLink },
      h('div', { className: 'dream-task-empty' },
        h('p', null, 'No task suggestions available.'),
        h('button', { className: 'dream-task-retry', onClick: runAnalysis }, 'Refresh')
      )
    );
  }

  const displayTasks = _selectDisplayTasks(tasks, maxTasks);

  return h(WidgetWrapper, {
    title: widgetTitleFromId('dream-task'), icon: '\uD83D\uDCA1', widgetId: 'dream-task',
    headerActions: noteLink,
  },
    h('div', { className: 'dream-task-list' },
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
