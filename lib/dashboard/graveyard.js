/**
 * [Claude-authored file]
 * Created: 2026-05-09 | Model: claude-sonnet-4-6
 * Task: Graveyard widget — suggest aged tasks for dismissal to keep the task domain tidy
 * Prompt summary: "add graveyard.js component that shows tasks eligible for retirement and lets users send them to an archived graveyard note"
 */

import { widgetTitleFromId } from "constants/settings";
import { loadGraveyardCandidates } from "graveyard-service";
import { createElement, useCallback, useEffect, useState } from "react";
import "styles/graveyard.scss";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

const TASKS_PER_HEIGHT_CELL = 5;
const WIDGET_ID = 'graveyard';

// =============================================================================
// Render helpers
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Empty state shown when no old task candidates are found.
// @param {Function} h - React.createElement.
function renderEmptyState(h) {
  return h(WidgetWrapper, { icon: '⚰️', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('p', { className: 'graveyard-empty' }, 'No neglected tasks found — everything looks current!')
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Error state with retry action.
// @param {Function} h - React.createElement.
// @param {string} errorMessage - Human-readable error description.
// @param {Function} onRetry - Click handler to retry loading.
function renderErrorState(h, errorMessage, onRetry) {
  return h(WidgetWrapper, { icon: '⚰️', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('div', { className: 'graveyard-error' },
      h('p', null, errorMessage || 'Failed to load tasks.'),
      h('button', { className: 'graveyard-retry', onClick: onRetry, type: 'button' }, 'Retry')
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Loading placeholder while candidates are being fetched.
// @param {Function} h - React.createElement.
function renderLoadingState(h) {
  return h(WidgetWrapper, { icon: '⚰️', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('p', { className: 'graveyard-loading' }, 'Searching for forgotten tasks…')
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Single task card with "Send to graveyard" and "Keep" actions.
// @param {Function} h - React.createElement.
// @param {Function} onGraveyard - Handler to dismiss and archive the task.
// @param {Function} onKeep - Handler to skip the task for today.
// @param {object} task - Task object with uuid, title/content, and createdAt.
// [Claude claude-sonnet-4-6] Task: render individual graveyard candidate card with dismiss/keep actions
// Prompt: "add a new graveyard.js component..."
function renderTaskCard(h, onGraveyard, onKeep, task) {
  const title = task.title || task.content || 'Untitled task';
  const createdDate = task.createdAt
    ? new Date(task.createdAt * 1000).toLocaleDateString([], { month: 'short', year: 'numeric' })
    : null;
  return h('li', { key: task.uuid, className: 'graveyard-task-item' },
    h('div', { className: 'graveyard-task-header' },
      h('span', { className: 'graveyard-task-title', title }, title),
      createdDate ? h('span', { className: 'graveyard-task-age' }, `Created ${ createdDate }`) : null
    ),
    h('div', { className: 'graveyard-task-actions' },
      h('a', {
        className: 'graveyard-task-action graveyard-task-action--send',
        href: '#',
        onClick: (e) => { e.preventDefault(); onGraveyard(task); },
        title: 'Dismiss this task — removes it from your task domain',
      }, '⚰️ Send to graveyard'),
      h('a', {
        className: 'graveyard-task-action graveyard-task-action--keep',
        href: '#',
        onClick: (e) => { e.preventDefault(); onKeep(task); },
        title: 'Keep this task — remove from today\'s suggestions without dismissing it',
      }, '✋ Keep')
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Task list wrapped in WidgetWrapper with graveyard subtitle.
// @param {Function} h - React.createElement.
// @param {Function} onGraveyard - Send-to-graveyard handler.
// @param {Function} onKeep - Keep handler.
// @param {Array<object>} tasks - Candidate task objects to render.
// [Claude claude-sonnet-4-6] Task: render graveyard candidate task list
// Prompt: "add a new graveyard.js component..."
function renderTaskList(h, onGraveyard, onKeep, tasks) {
  return h(WidgetWrapper, { icon: '⚰️', subtitle: 'Consider retiring these forgotten tasks',
      title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('ul', { className: 'graveyard-task-list' },
      ...tasks.map(task => renderTaskCard(h, onGraveyard, onKeep, task))
    )
  );
}

// =============================================================================
// GraveyardWidget component
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Dashboard widget that surfaces aged tasks and offers a one-click path to retire them.
//   Candidates are discovered from domain notes (oldest 10% by createdAt) and cached in a
//   monthly archived note keyed by date. "Send to graveyard" dismisses the task via updateTask;
//   "Keep" removes it from today's list without any change to the underlying task.
// @param {object} app - Amplenote app bridge.
// @param {number} gridHeightSize - Vertical cell count; controls how many tasks are shown.
// @param {string|null} taskDomainUUID - Active task domain for note filtering.
// [Claude claude-sonnet-4-6] Task: Graveyard widget component — load and display old task retirement candidates
// Prompt: "add a new graveyard.js component..."
export default function GraveyardWidget({ app, gridHeightSize = 1, taskDomainUUID }) {
  const h = createElement;
  const maxTasks = (gridHeightSize || 1) * TASKS_PER_HEIGHT_CELL;
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState(null);

  // [Claude claude-sonnet-4-6] Task: load graveyard candidates on mount and on retry
  // Prompt: "add a new graveyard.js component..."
  const loadCandidates = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { candidates } = await loadGraveyardCandidates(app, maxTasks, taskDomainUUID);
      setTasks(candidates.slice(0, maxTasks));
    } catch (err) {
      logIfEnabled('[Graveyard] load failed:', err);
      setError(err.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [app, maxTasks, taskDomainUUID]);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  // [Claude claude-sonnet-4-6] Task: dismiss task via updateTask dismissedAt and remove from list
  // Prompt: "add a new graveyard.js component..."
  const onGraveyardTask = useCallback(async (task) => {
    try {
      await app.updateTask(task.uuid, { dismissedAt: Math.floor(Date.now() / 1000) });
    } catch (err) {
      logIfEnabled('[Graveyard] updateTask failed:', err);
    }
    setTasks(prev => (prev || []).filter(t => t.uuid !== task.uuid));
  }, [app]);

  const onKeepTask = useCallback((task) => {
    setTasks(prev => (prev || []).filter(t => t.uuid !== task.uuid));
  }, []);

  if (loading) return renderLoadingState(h);
  if (error) return renderErrorState(h, error, loadCandidates);
  if (!tasks || tasks.length === 0) return renderEmptyState(h);
  return renderTaskList(h, onGraveyardTask, onKeepTask, tasks);
}
