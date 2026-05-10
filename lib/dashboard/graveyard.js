/**
 * [Claude-authored file]
 * Created: 2026-05-09 | Model: claude-sonnet-4-6
 * Task: Graveyard widget — suggest aged tasks for dismissal to keep the task domain tidy
 * Prompt summary: "add graveyard.js component that shows tasks eligible for retirement and lets users send them to an archived graveyard note"
 */

import confetti from "canvas-confetti";
import { widgetTitleFromId } from "constants/settings";
import { appendTaskToRetiredNote, loadGraveyardCandidates } from "graveyard-service";
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import "styles/graveyard.scss";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { graveyardMeadowUrl } from "util/background-splash-images";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";

const TASKS_PER_HEIGHT_CELL = 5;
const TOOLTIP_HOVER_DELAY_MS = 500;
const WIDGET_ID = 'graveyard';

// =============================================================================
// Render helpers
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Empty state shown when no old task candidates are found.
// @param {Function} h - React.createElement.
// @param {React.ReactNode} headerActions - Header action links.
function renderEmptyState(h, headerActions) {
  return h(WidgetWrapper, { headerActions, icon: '👵', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('p', { className: 'graveyard-empty' }, 'No neglected tasks found — everything looks current!')
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Error state with retry action.
// @param {Function} h - React.createElement.
// @param {string} errorMessage - Human-readable error description.
// @param {React.ReactNode} headerActions - Header action links.
// @param {Function} onRetry - Click handler to retry loading.
function renderErrorState(h, errorMessage, headerActions, onRetry) {
  return h(WidgetWrapper, { headerActions, icon: '👵', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('div', { className: 'graveyard-error' },
      h('p', null, errorMessage || 'Failed to load tasks.'),
      h('button', { className: 'graveyard-retry', onClick: onRetry, type: 'button' }, 'Retry')
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Loading placeholder while candidates are being fetched.
// @param {Function} h - React.createElement.
// @param {React.ReactNode} headerActions - Header action links.
function renderLoadingState(h, headerActions) {
  return h(WidgetWrapper, { headerActions, icon: '👵', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('p', { className: 'graveyard-loading' }, 'Searching for forgotten tasks…')
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Header link that forces a fresh graveyard candidate discovery and repopulates visible slots.
// @param {Function} h - React.createElement.
// @param {boolean} isRefreshing - True while a refresh request is in flight.
// @param {Function} onRefresh - Click handler.
// [OpenAI gpt-5.4] Task: add graveyard header refresh control that repopulates task slots
// Prompt: "update graveyard.js so that its title bar includes a refresh link that will repopulate the five task slots in the component"
function renderRefreshLink(h, isRefreshing, onRefresh) {
  return h('a', {
    'aria-disabled': isRefreshing ? 'true' : 'false',
    className: 'widget-header-action',
    href: '#',
    onClick: onRefresh,
    tabIndex: isRefreshing ? -1 : 0,
    title: isRefreshing ? 'Refreshing graveyard candidates' : 'Find a new set of graveyard candidates',
  }, isRefreshing ? '↻ Refreshing…' : '↻ Refresh');
}

// [OpenAI gpt-5.4] Task: normalize graveyard task timestamps for compact row and tooltip metadata
// Prompt: "When hovering on task text for 500ms, pop a styled tooltip..."
function taskCreatedAtDate(task) {
  if (!task?.createdAt) return null;
  const rawTimestamp = Number(task.createdAt);
  if (!Number.isFinite(rawTimestamp)) return null;
  const millis = rawTimestamp < 1e10 ? rawTimestamp * 1000 : rawTimestamp;
  const createdAt = new Date(millis);
  return Number.isNaN(createdAt.getTime()) ? null : createdAt;
}

// [OpenAI gpt-5.4] Task: format graveyard row timestamp differently for compact 1-column cards
// Prompt: "When the component is only 1-wide, do not show the word Created in the date stamp"
function compactCreatedDateLabel(task, isSingleColumn) {
  const createdAt = taskCreatedAtDate(task);
  if (!createdAt) return null;
  const monthYear = createdAt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return isSingleColumn ? monthYear : `Created ${ monthYear }`;
}

// [OpenAI gpt-5.4] Task: normalize graveyard task score for color-coded tooltip badge
// Prompt: "A colored dot corresponding to the task score..."
function graveyardTaskScore(task) {
  const score = Number(task?.score ?? task?.victoryValue ?? 0);
  return Number.isFinite(score) ? score : 0;
}

// [OpenAI gpt-5.4] Task: map graveyard task score ranges to tooltip badge colors
// Prompt: "0-3 gray, 3.01 to 5 blue, >5 <10 yellow, >=10 red"
function graveyardTaskScoreTone(task) {
  const score = graveyardTaskScore(task);
  if (score <= 3) return 'muted';
  if (score <= 5) return 'cool';
  if (score < 10) return 'warm';
  return 'hot';
}

// [OpenAI gpt-5.4] Task: escape plain-text graveyard tooltip metadata before HTML interpolation
// Prompt: "Use @lib/dashboard/dashboard-tooltip-tippy.js in @lib/dashboard/graveyard.js instead of the bespoke tooltip implementation"
function escapeTooltipHtml(text) {
  return `${ text ?? '' }`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// [OpenAI gpt-5.4] Task: choose stable graveyard prompt indexes by hour and input parameter
// Prompt: "Create a utility method that will generally accept an parameter value, a max value, and produce a consistent per-hour return value"
function stableHourIndex(parameter, maxValue) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 0;
  const now = new Date();
  const hourKey = `${ now.getFullYear() }:${ now.getMonth() }:${ now.getDate() }:${ now.getHours() }`;
  const source = `${ hourKey }:${ parameter ?? '' }`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash % maxValue;
}

// [OpenAI gpt-5.4] Task: render graveyard hover tooltip content through shared DashboardTippy
// Prompt: "Use @lib/dashboard/dashboard-tooltip-tippy.js in @lib/dashboard/graveyard.js instead of the bespoke tooltip implementation"
function renderTaskTooltipContent(task) {
  const createdAt = taskCreatedAtDate(task);
  const score = graveyardTaskScore(task);
  const displayScore = Number.isInteger(score) ? `${ score }` : score.toFixed(2).replace(/\.?0+$/, '');
  const noteLabel = task?.noteName || task?.noteTitle || task?.note?.name || 'Unknown note';
  const scoreTone = graveyardTaskScoreTone(task);
  const createdLabel = createdAt ? createdAt.toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Unknown';
  return `
    <div class="graveyard-task-tooltip" role="tooltip">
      <div class="graveyard-task-tooltip-meta">
        <span class="graveyard-task-tooltip-note">${ escapeTooltipHtml(noteLabel) }</span>
        <span class="graveyard-task-tooltip-created">Created ${ escapeTooltipHtml(createdLabel) }</span>
      </div>
      <div class="graveyard-task-tooltip-content">
        ${ amplenoteMarkdownRender(task.content || task.title || 'Untitled task') }
      </div>
      <div class="graveyard-task-tooltip-footer">
        <span class="graveyard-task-score graveyard-task-score--${ scoreTone }">
          <span class="graveyard-task-score-dot" aria-hidden="true"></span>
          <span>Score ${ escapeTooltipHtml(displayScore) }</span>
        </span>
      </div>
    </div>
  `;
}

// ----------------------------------------------------------------------------------------------
// @desc Fire confetti from the center of the nearest .graveyard-task-item ancestor element.
// @param {MouseEvent} event - Click event from the action link.
// [Claude claude-sonnet-4-6] Task: confetti celebration on graveyard dismissal
// Prompt: "expand graveyard with confetti + retired note"
function fireConfettiFromCard(event) {
  const cardEl = event.currentTarget?.closest?.('.graveyard-task-item');
  if (!cardEl || typeof window === 'undefined') return;
  const rect = cardEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  confetti({
    origin: {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    },
    particleCount: 80, spread: 70, startVelocity: 38,
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Single task card with "Send to graveyard", "Keep", and note-navigation actions.
// @param {Function} h - React.createElement.
// @param {boolean} isDismissing - True when CSS fade-out transition is in progress.
// @param {boolean} isSingleColumn - Whether the widget is only one grid cell wide.
// @param {number} taskIndex - Zero-based task position in the rendered list.
// @param {Function} onOpenNote - Handler to navigate to the task's note.
// @param {Function} onGraveyard - Handler to dismiss and archive the task.
// @param {Function} onKeep - Handler to skip the task for today.
// @param {object} task - Task object with uuid, title/content, and createdAt.
// [OpenAI gpt-5.4] Task: render graveyard cards with stable per-hour dismiss prompts
// Prompt: "within a given hour and position index, a consistent dismiss prompt will be generated"
function renderTaskCard(h, isDismissing, isSingleColumn, taskIndex, onOpenNote, onGraveyard, onKeep, task) {
  const title = task.title || task.content || 'Untitled task';
  const createdDate = compactCreatedDateLabel(task, isSingleColumn);
  const className = `graveyard-task-item${ isDismissing ? ' graveyard-task-item--dismissing' : '' }`;
  const dismissPrompts = [ "Dismiss", "Send to a farm upstate", "Retire", "Let go", "Exile",
    "Bury", "Send off", "Release into the wild", "Put out to pasture", "Lay to rest", "Decommission",
    "Release to the great beyond", "Send to the eternal rest", "A solemn farewell", "Pay a final tribute",
    "Send to the hereafter" ];
  const dismissPrompt = dismissPrompts[stableHourIndex(taskIndex, dismissPrompts.length)];

  return h('li', { key: task.uuid, className },
    h('div', { className: 'graveyard-task-header' },
      h('div', { className: 'graveyard-task-title-wrap' },
        h(DashboardTippy, {
          content: renderTaskTooltipContent(task),
          delay: [TOOLTIP_HOVER_DELAY_MS, 0],
          interactive: true,
          maxWidth: isSingleColumn ? 280 : 340,
          onShown: (instance) => attachFootnotePopups(instance?.popper),
          placement: 'bottom-start',
        },
        h('span', { className: 'graveyard-task-title', id: `graveyard-title-${ task.uuid }`, tabIndex: 0 }, title))),
      createdDate ? h('span', { className: 'graveyard-task-age' }, createdDate) : null
    ),
    h('div', { className: 'graveyard-task-actions' },
      h('a', {
        className: 'graveyard-task-action graveyard-task-action--send',
        href: '#',
        onClick: (e) => { e.preventDefault(); onGraveyard(e, task); },
        title: 'Dismiss this task — removes it from your task domain and places it in an archived note you can revisit later if desired',
      }, `🗑️ ${ dismissPrompt }`),
      h('a', {
        className: 'graveyard-task-action graveyard-task-action--keep',
        href: '#',
        onClick: (e) => { e.preventDefault(); onKeep(task); },
        title: 'Preserve this task — remove it from this list without dismissing it',
      }, '🧲 Keep'),
      h('a', {
        className: 'graveyard-task-action graveyard-task-action--note',
        href: '#',
        onClick: (e) => { e.preventDefault(); onOpenNote(task); },
        title: 'Open the note where this task lives',
      }, '📓 Note')
    )
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Task list wrapped in WidgetWrapper with green meadow background that reveals as tasks are dismissed.
// @param {Set<string>} dismissingUuids - UUIDs of tasks currently in fade-out transition.
// @param {Function} h - React.createElement.
// @param {number} meadowOpacity - 0→1 opacity for the background meadow image.
// @param {string} meadowUrl - Unsplash URL for the meadow background image.
// @param {boolean} isSingleColumn - Whether the widget is only one grid cell wide.
// @param {React.ReactNode} headerActions - Header action links.
// @param {Function} onOpenNote - Navigate to the task's note.
// @param {Function} onGraveyard - Send-to-graveyard handler.
// @param {Function} onKeep - Keep handler.
// @param {Array<object>} tasks - Candidate task objects to render.
// [OpenAI gpt-5.4] Task: render graveyard task list with stable per-hour subtitle and dismiss prompts
// Prompt: "This should also be used to choose from among the subtitleCandidates array"
function renderTaskList(dismissingUuids, h, headerActions, isSingleColumn, meadowOpacity, meadowUrl, onOpenNote,
    onGraveyard, onKeep, tasks) {
  return h(WidgetWrapper, { headerActions, icon: '👵', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    h('div', { className: 'graveyard-meadow-wrapper' },
      h('img', {
        alt: '',
        className: 'graveyard-meadow-bg',
        src: meadowUrl,
        style: { opacity: meadowOpacity },
      }),
      h('ul', { className: 'graveyard-task-list' },
        ...tasks.map((task, taskIndex) => renderTaskCard(h, dismissingUuids.has(task.uuid), isSingleColumn,
          taskIndex, onOpenNote, onGraveyard, onKeep, task))
      )
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
// @param {number} gridWidthSize - Horizontal cell count; used for compact date labels in narrow cards.
// @param {string|null} taskDomainUUID - Active task domain for note filtering.
// [OpenAI gpt-5.4] Task: add delayed graveyard hover tooltip with markdown metadata and narrow-card timestamp labels
// Prompt: "When hovering on task text for 500ms, pop a styled tooltip..."
// [OpenAI gpt-5.4] Task: add title-bar refresh link that repopulates the current graveyard slots
// Prompt: "update graveyard.js so that its title bar includes a refresh link that will repopulate the five task slots in the component"
export default function GraveyardWidget({ app, gridHeightSize = 1, gridWidthSize = 2, taskDomainUUID }) {
  const h = createElement;
  const maxTasks = (gridHeightSize || 1) * TASKS_PER_HEIGHT_CELL;
  const isSingleColumn = Number(gridWidthSize) === 1;
  const [dismissingUuids, setDismissingUuids] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState(null);
  const meadowUrl = useMemo(() => graveyardMeadowUrl('small', new Date().toDateString()), []);
  const meadowOpacity = dismissingUuids.size > 0 ? 1 : 0;

  // [Claude claude-sonnet-4-6] Task: load graveyard candidates on mount and on retry
  // Prompt: "add a new graveyard.js component..."
  // [OpenAI gpt-5.4] Task: support force-refresh candidate reloads from the graveyard header link
  // Prompt: "update graveyard.js so that its title bar includes a refresh link that will repopulate the five task slots in the component"
  const loadCandidates = useCallback(async (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    logIfEnabled('[Graveyard] loadCandidates fired, taskDomainUUID:', taskDomainUUID, 'forceRefresh:', forceRefresh);
    setError(null);
    if (forceRefresh) setDismissingUuids(new Set());
    setLoading(true);
    try {
      const { candidates } = await loadGraveyardCandidates(app, maxTasks, taskDomainUUID, { forceRefresh });
      const sliced = candidates.slice(0, maxTasks);
      setTasks(sliced);
    } catch (err) {
      logIfEnabled('[Graveyard] load failed:', err);
      setError(err.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [app, maxTasks, taskDomainUUID]);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  // [OpenAI gpt-5.4] Task: wire graveyard header refresh link to forced candidate discovery
  // Prompt: "update graveyard.js so that its title bar includes a refresh link that will repopulate the five task slots in the component"
  const onRefresh = useCallback((event) => {
    event.preventDefault();
    if (loading) return;
    loadCandidates({ forceRefresh: true });
  }, [loadCandidates, loading]);

  // [Claude claude-sonnet-4-6] Task: dismiss task — hide in place, reveal meadow, fire confetti, update task
  // Prompt: "continue rendering it, but change its visibility to hidden"
  const onGraveyardTask = useCallback(async (event, task) => {
    fireConfettiFromCard(event);
    setDismissingUuids(prev => { const next = new Set(prev); next.add(task.uuid); return next; });
    app.updateTask(task.uuid, { dismissedAt: Math.floor(Date.now() / 1000) }).catch(
      err => logIfEnabled('[Graveyard] updateTask failed:', err)
    );
    appendTaskToRetiredNote(app, task).catch(
      err => logIfEnabled('[Graveyard] appendTaskToRetiredNote failed:', err)
    );
  }, [app]);

  // [Claude claude-sonnet-4-6] Task: keep task — hide in place, also reveals meadow
  // Prompt: "continue rendering it, but change its visibility to hidden"
  const onKeepTask = useCallback((task) => {
    setDismissingUuids(prev => { const next = new Set(prev); next.add(task.uuid); return next; });
  }, []);

  // [OpenAI gpt-5.4] Task: navigate from graveyard action row to the source note for a task
  // Prompt: "add a third option to the second row, '📓 Note' which navigates to the task's note"
  const onOpenTaskNote = useCallback(async (task) => {
    if (!task?.noteUUID) return;
    await app.navigate(`https://www.amplenote.com/notes/${ task.noteUUID }`);
  }, [app]);

  const headerActions = renderRefreshLink(h, loading, onRefresh);

  if (loading) return renderLoadingState(h, headerActions);
  if (error) return renderErrorState(h, error, headerActions, loadCandidates);
  if (tasks === null || (tasks.length === 0 && dismissingUuids.size === 0)) return renderEmptyState(h, headerActions);
  return renderTaskList(dismissingUuids, h, headerActions, isSingleColumn, meadowOpacity, meadowUrl, onOpenTaskNote,
    onGraveyardTask, onKeepTask, tasks);
}
