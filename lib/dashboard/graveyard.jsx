/**
 * [Claude-authored file]
 * Created: 2026-05-09 | Model: claude-sonnet-4-6
 * Task: Graveyard widget — suggest aged tasks for dismissal to keep the task domain tidy
 * Prompt summary: "add graveyard.js component that shows tasks eligible for retirement and lets users send them to an archived graveyard note"
 */

import confetti from "canvas-confetti";
import { appendTaskToRetiredNote, loadGraveyardCandidates } from "graveyard-service";
import { Button, EmptyState, ErrorState, IconButton, LoadingState } from "dashboard/controls";
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import { richTooltipHtml } from "dashboard/tooltip-themes";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MdArchive, MdDescription, MdPushPin, MdRefresh } from "react-icons/md";
import "styles/graveyard.scss";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import { graveyardMeadowUrl } from "util/background-splash-images";
import { millisFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { snapDashboardAction } from "util/plausible";
import WidgetWrapper from "widget-wrapper";

const TASKS_PER_HEIGHT_CELL = 5;
const TOOLTIP_HOVER_DELAY_MS = 500;
const WIDGET_ID = 'graveyard';

// =============================================================================
// Render helpers
// =============================================================================

// ----------------------------------------------------------------------------------------------
// @desc Empty state shown when no old task candidates are found.
// [Claude claude-4.7-opus] Task: convert empty state render fn to JSX component
// Prompt: "translate this project to render components with JSX instead"
function GraveyardEmpty({ headerActions }) {
  return (
    <WidgetWrapper headerActions={headerActions} widgetId={WIDGET_ID}>
      <EmptyState className="graveyard-empty"
        title="No neglected tasks found — everything looks current!" />
    </WidgetWrapper>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Error state with retry action.
function GraveyardError({ errorMessage, headerActions, onRetry }) {
  return (
    <WidgetWrapper headerActions={headerActions} widgetId={WIDGET_ID}>
      <ErrorState className="graveyard-error" onRetry={ onRetry } title={ null }>
        { errorMessage || 'Failed to load tasks.' }
      </ErrorState>
    </WidgetWrapper>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Loading placeholder while candidates are being fetched.
function GraveyardLoading({ headerActions }) {
  return (
    <WidgetWrapper headerActions={headerActions} widgetId={WIDGET_ID}>
      <LoadingState className="graveyard-loading">Searching for forgotten tasks…</LoadingState>
    </WidgetWrapper>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Header link that forces a fresh graveyard candidate discovery and repopulates visible slots.
// [OpenAI gpt-5.4] Task: add graveyard header refresh control that repopulates task slots
function RefreshLink({ isRefreshing, onRefresh }) {
  const label = isRefreshing
    ? 'Refreshing graveyard candidates'
    : 'Refresh: find a new set of graveyard candidates';
  return (
    <IconButton className="graveyard-refresh" disabled={ isRefreshing } Icon={ MdRefresh } label={ label }
      onClick={ onRefresh } size="small" />
  );
}

// [OpenAI gpt-5.4] Task: normalize graveyard task timestamps for compact row and tooltip metadata
function taskCreatedAtDate(task) {
  const createdAtMillis = millisFromDateInput(task?.createdAt);
  return createdAtMillis === null ? null : new Date(createdAtMillis);
}

// [OpenAI gpt-5.4] Task: format graveyard row timestamp differently for compact 1-column cards
function compactCreatedDateLabel(task, isSingleColumn) {
  const createdAt = taskCreatedAtDate(task);
  if (!createdAt) return null;
  const monthYear = createdAt.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return isSingleColumn ? monthYear : `Created ${ monthYear }`;
}

// [OpenAI gpt-5.4] Task: normalize graveyard task score for color-coded tooltip badge
function graveyardTaskScore(task) {
  const score = Number(task?.score ?? task?.victoryValue ?? 0);
  return Number.isFinite(score) ? score : 0;
}

// [OpenAI gpt-5.4] Task: map graveyard task score ranges to tooltip badge colors
function graveyardTaskScoreTone(task) {
  const score = graveyardTaskScore(task);
  if (score <= 3) return 'muted';
  if (score <= 5) return 'cool';
  if (score < 10) return 'warm';
  return 'hot';
}

// [OpenAI gpt-5.4] Task: choose stable graveyard prompt indexes by hour and input parameter
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

// ----------------------------------------------------------------------------------------------
// @desc Rich tooltip for a task: its note as title, the rendered task, when it was created, and its score.
// @param {Object} task - The graveyard task.
// @returns {string} Tooltip HTML.
function renderTaskTooltipContent(task) {
  const createdAt = taskCreatedAtDate(task);
  const score = graveyardTaskScore(task);
  const displayScore = Number.isInteger(score) ? `${ score }` : score.toFixed(2).replace(/\.?0+$/, '');
  const noteLabel = task?.noteName || task?.noteTitle || task?.note?.name || 'Unknown note';
  const createdLabel = createdAt ? createdAt.toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Unknown';
  return richTooltipHtml({ className: "graveyard-task-tooltip", rows: [
    { className: "graveyard-task-tooltip-content", html: amplenoteMarkdownRender(task.content || task.title || 'Untitled task') },
    { className: `graveyard-task-score graveyard-task-score--${ graveyardTaskScoreTone(task) }`,
      text: `Created ${ createdLabel }`, trailing: `Score ${ displayScore }` },
  ], title: noteLabel });
}

// ----------------------------------------------------------------------------------------------
// @desc Fire confetti from the center of the nearest .graveyard-task-item ancestor element.
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
// [Claude claude-4.7-opus] Task: convert task card render fn to JSX component
// Prompt: "translate this project to render components with JSX instead"
function TaskCard({ isDismissing, isSingleColumn, taskIndex, onOpenNote, onGraveyard, onKeep, task }) {
  const title = task.title || task.content || 'Untitled task';
  const createdDate = compactCreatedDateLabel(task, isSingleColumn);
  const className = `graveyard-task-item${ isDismissing ? ' graveyard-task-item--dismissing' : '' }`;
  const dismissPrompts = [ "Dismiss", "Send to a farm upstate", "Retire", "Let go", "Exile",
    "Bury", "Send off", "Release into the wild", "Put out to pasture", "Lay to rest", "Decommission",
    "Release to the great beyond", "Send to the eternal rest", "A solemn farewell", "Pay a final tribute",
    "Send to the hereafter" ];
  const dismissPrompt = dismissPrompts[stableHourIndex(taskIndex, dismissPrompts.length)];

  return (
    <li className={className}>
      <div className="graveyard-task-header">
        <div className="graveyard-task-title-wrap">
          <DashboardTippy
            content={renderTaskTooltipContent(task)}
            delay={[TOOLTIP_HOVER_DELAY_MS, 0]}
            interactive
            maxWidth={isSingleColumn ? 280 : 340}
            onShown={(instance) => attachFootnotePopups(instance?.popper)}
            placement="bottom-start"
            rich
          >
            <span className="graveyard-task-title" id={`graveyard-title-${ task.uuid }`} tabIndex={0}>{title}</span>
          </DashboardTippy>
        </div>
        {createdDate ? <span className="graveyard-task-age">{createdDate}</span> : null}
      </div>
      <div className="graveyard-task-actions">
        <Button className="graveyard-task-action graveyard-task-action--send" dense Icon={ MdArchive }
          iconSize={ 16 } onClick={ event => onGraveyard(event, task) }
          title="Dismiss this task — removes it from your task domain and places it in an archived note you can revisit later if desired"
        >{ dismissPrompt }</Button>
        <Button className="graveyard-task-action graveyard-task-action--keep" dense Icon={ MdPushPin }
          iconSize={ 16 } onClick={ () => onKeep(task) }
          title="Preserve this task — remove it from this list without dismissing it">Keep</Button>
        <Button className="graveyard-task-action graveyard-task-action--note" dense Icon={ MdDescription }
          iconSize={ 16 } onClick={ () => onOpenNote(task) }
          title="Open the note where this task lives">Note</Button>
      </div>
    </li>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Task list wrapped in WidgetWrapper with green meadow background that reveals as tasks are dismissed.
function TaskList({ dismissingUuids, headerActions, isSingleColumn, meadowOpacity, meadowUrl, onOpenNote,
    onGraveyard, onKeep, tasks }) {
  return (
    <WidgetWrapper headerActions={headerActions} widgetId={WIDGET_ID}>
      <div className="graveyard-meadow-wrapper">
        <img
          alt=""
          className="graveyard-meadow-bg"
          src={meadowUrl}
          style={{ opacity: meadowOpacity }}
        />
        <ul className="graveyard-task-list">
          {tasks.map((task, taskIndex) => (
            <TaskCard
              key={task.uuid}
              isDismissing={dismissingUuids.has(task.uuid)}
              isSingleColumn={isSingleColumn}
              taskIndex={taskIndex}
              onOpenNote={onOpenNote}
              onGraveyard={onGraveyard}
              onKeep={onKeep}
              task={task}
            />
          ))}
        </ul>
      </div>
    </WidgetWrapper>
  );
}

// =============================================================================
// GraveyardWidget component
// =============================================================================

// [Claude claude-4.7-opus] Task: migrate GraveyardWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function GraveyardWidget({ app, gridHeightSize = 1, gridWidthSize = 2, taskDomainUUID }) {
  const maxTasks = (gridHeightSize || 1) * TASKS_PER_HEIGHT_CELL;
  const isSingleColumn = Number(gridWidthSize) === 1;
  const [dismissingUuids, setDismissingUuids] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState(null);
  const meadowUrl = useMemo(() => graveyardMeadowUrl('small', new Date().toDateString()), []);
  const meadowOpacity = dismissingUuids.size > 0 ? 1 : 0;

  const loadCandidates = useCallback(async (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    setError(null);
    if (forceRefresh) setDismissingUuids(new Set());
    setLoading(true);
    try {
      const { candidates } = await loadGraveyardCandidates(app, maxTasks, taskDomainUUID, { forceRefresh });
      // Parent tasks own sub-tasks, so dismissing them would orphan their children — never recommend them.
      const sliced = candidates.filter(task => !task.isParent).slice(0, maxTasks);
      setTasks(sliced);
    } catch (err) {
      logIfEnabled('[Graveyard] load failed:', err);
      setError(err.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [app, maxTasks, taskDomainUUID]);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  const onRefresh = useCallback(() => {
    if (loading) return;
    loadCandidates({ forceRefresh: true });
  }, [loadCandidates, loading]);

  const onGraveyardTask = useCallback(async (event, task) => {
    fireConfettiFromCard(event);
    setDismissingUuids(prev => { const next = new Set(prev); next.add(task.uuid); return next; });
    app.updateTask(task.uuid, { dismissedAt: Math.floor(Date.now() / 1000) }).catch(
      err => logIfEnabled('[Graveyard] updateTask failed:', err)
    );
    appendTaskToRetiredNote(app, task).catch(
      err => logIfEnabled('[Graveyard] appendTaskToRetiredNote failed:', err)
    );
    snapDashboardAction("dismissGraveyardTask");
  }, [app]);

  const onKeepTask = useCallback((task) => {
    setDismissingUuids(prev => { const next = new Set(prev); next.add(task.uuid); return next; });
  }, []);

  const onOpenTaskNote = useCallback(async (task) => {
    if (!task?.noteUUID) return;
    await app.navigate(`https://www.amplenote.com/notes/${ task.noteUUID }`);
  }, [app]);

  const headerActions = <RefreshLink isRefreshing={loading} onRefresh={onRefresh} />;
  useWidgetLoadedEvent(WIDGET_ID, !loading && !error, !!error);

  if (loading) return <GraveyardLoading headerActions={headerActions} />;
  if (error) {
    return <GraveyardError errorMessage={error} headerActions={headerActions} onRetry={loadCandidates} />;
  }
  if (tasks === null || (tasks.length === 0 && dismissingUuids.size === 0)) {
    return <GraveyardEmpty headerActions={headerActions} />;
  }
  return (
    <TaskList
      dismissingUuids={dismissingUuids}
      headerActions={headerActions}
      isSingleColumn={isSingleColumn}
      meadowOpacity={meadowOpacity}
      meadowUrl={meadowUrl}
      onOpenNote={onOpenTaskNote}
      onGraveyard={onGraveyardTask}
      onKeep={onKeepTask}
      tasks={tasks}
    />
  );
}
