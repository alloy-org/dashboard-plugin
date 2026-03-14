/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Root dashboard component — fetches data and renders widget grid
 * Prompt summary: "main React component that calls init, shows loading/error, and lays out widgets"
 */
import { createElement, memo, useEffect, useState, useCallback, useRef, useMemo } from "react";
import PlanningWidget from 'planning';
import AgendaWidget from 'agenda';
import CalendarWidget from 'calendar';
import { DASHBOARD_COMPONENTS, DASHBOARD_FOCUS, DEFAULT_DASHBOARD_COMPONENTS, IS_DEV_ENVIRONMENT, SETTING_KEYS, WIDGET_REGISTRY } from 'constants/settings';
import DashboardLayoutPopup from 'dashboard-layout-popup';
import DashboardSettingsPopup from 'dashboard-settings-popup';
import DreamTaskWidget from 'dream-task';
import { createBrowserDevApp } from 'util/browser-dev-app';
import useCompletedTasks from 'hooks/use-completed-tasks';
import useDomainTasks from 'hooks/use-domain-tasks';
import MoodWidget from 'mood';
import QuotesWidget from 'quotes';
import QuickActionsWidget from 'quick-actions';
import RecentNotesWidget from 'recent-notes';
import TaskDomains from 'task-domains';
import { dateKeyFromDateInput, isCurrentWeekEarly, weekStartFromDateInput, weekEndFromDateInput } from 'util/date-utility';
import { logIfEnabled, setLoggingEnabled } from "util/log";
import { useWidgetLoadTiming } from "util/widget-timing";
import VictoryValueWidget from 'victory-value';

// ------------------------------------------------------------------------------------------
// Computes the CSS grid span style for a widget cell from its layout config.
//
// [Claude] Task: shared grid cell style helper for memoized widget cells
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
function gridCellStyle(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return { gridColumn: `span ${w}`, gridRow: `span ${h}` };
}

// [Claude] Task: derive grid-cell class names including horizontal-N-cell and vertical-N-cell
// Prompt: "apply a class for the number of horizontal and vertical cells that it has been assigned"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
function gridCellClassName(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return `grid-cell horizontal-${w}-cell vertical-${h}-cell`;
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: reorder helper used while dragging dashboard widgets
// Prompt: "long-press a widget heading to drag and persist the new dashboard order on release"
// Date: 2026-03-14 | Model: gpt-5.3-codex
function moveWidgetBefore(layoutConfig, draggedWidgetId, targetWidgetId) {
  if (!Array.isArray(layoutConfig)) return layoutConfig;
  if (!draggedWidgetId || !targetWidgetId || draggedWidgetId === targetWidgetId) return layoutConfig;
  const fromIndex = layoutConfig.findIndex(c => c?.widgetId === draggedWidgetId);
  const toIndex = layoutConfig.findIndex(c => c?.widgetId === targetWidgetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return layoutConfig;
  const next = [...layoutConfig];
  const [moved] = next.splice(fromIndex, 1);
  const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(adjustedToIndex, 0, moved);
  return next;
}

// ------------------------------------------------------------------------------------------
function widgetOrder(layoutConfig) {
  return (layoutConfig || []).map(config => config?.widgetId).filter(Boolean).join("|");
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: compose shared grid-cell wrapper props used by all widget cells
// Prompt: "DRY all repeated widget cell createElement and drag class code in dashboard.js"
// Date: 2026-03-14 | Model: gpt-5.3-codex
function gridCellContainerProps(config, draggingWidgetId) {
  const widgetId = config?.widgetId;
  const className = [
    gridCellClassName(config),
    draggingWidgetId ? 'grid-cell--drag-active' : '',
    draggingWidgetId && draggingWidgetId === widgetId ? 'grid-cell--dragging-ready' : '',
    draggingWidgetId && draggingWidgetId !== widgetId ? 'grid-cell--drag-shift' : '',
  ].filter(Boolean).join(' ');
  return {
    className,
    style: gridCellStyle(config),
    'data-widget-id': widgetId,
  };
}

// ------------------------------------------------------------------------------------------
// Memoized widget cell components
//
// Each component is defined at module scope and wrapped in React.memo so it only
// re-renders when its own props change — unrelated state updates in DashboardApp
// (e.g. completedTasksByDate arriving while planning/mood data is unchanged) are
// invisible to cells that don't depend on those values.
//
// Props are intentionally minimal: each cell receives only the slice of app state
// it actually needs, rather than the full parent state bag.
// ------------------------------------------------------------------------------------------

// [Claude] Task: factory for memoized widget cells to remove repeated wrappers
// Prompt: "DRY all repeated widget cell createElement and drag class code in dashboard.js"
// Date: 2026-03-14 | Model: gpt-5.3-codex
function createWidgetCell(widgetId, WidgetComponent, buildWidgetProps) {
  return memo(function DashboardWidgetCell(cellProps) {
    useWidgetLoadTiming(widgetId);
    const { config, draggingWidgetId } = cellProps;
    return createElement('div', gridCellContainerProps(config, draggingWidgetId),
      createElement(WidgetComponent, buildWidgetProps(cellProps))
    );
  });
}

const PlanningCell = createWidgetCell('planning', PlanningWidget, ({ config, quarterlyPlans }) => ({
  quarterlyPlans,
  gridHeightSize: Number(config?.gridHeightSize) || 1,
}));

const VictoryValueCell = createWidgetCell('victory-value', VictoryValueWidget, ({
  config, completedTasksByDate, dailyValues, weeklyTotal, moodRatings, referenceDate, onReferenceDateChange, settings,
}) => ({
  completedTasksByDate,
  dailyValues,
  weeklyTotal,
  moodRatings,
  referenceDate,
  onReferenceDateChange,
  settings: { ...settings, 'victory-value': config?.settings || {} },
}));

const MoodCell = createWidgetCell('mood', MoodWidget, ({ moodRatings, onMoodRecorded, settings }) => ({
  moodRatings,
  onMoodRecorded,
  settings,
}));

const CalendarCell = createWidgetCell('calendar', CalendarWidget, ({
  config, completedTasksByDate, currentDate, openTasks, onDateSelect, selectedDate, settings,
}) => ({
  completedTasksByDate,
  currentDate,
  openTasks,
  onDateSelect,
  selectedDate,
  settings: { ...settings, calendar: config?.settings || {} },
}));

const AgendaCell = createWidgetCell('agenda', AgendaWidget, ({ agendaTasks, currentDate, selectedDate }) => ({
  currentDate,
  tasks: agendaTasks,
  selectedDate,
}));

const QuotesCell = createWidgetCell('quotes', QuotesWidget, ({ config, settings }) => ({
  quotes: null,
  planContent: null,
  gridHeightSize: Number(config?.gridHeightSize) || 1,
  settings: { ...settings, quotes: config?.settings || {} },
}));

const RecentNotesCell = createWidgetCell('recent-notes', RecentNotesWidget, ({ config }) => ({
  gridHeightSize: Number(config?.gridHeightSize) || 1,
}));

const QuickActionsCell = createWidgetCell('quick-actions', QuickActionsWidget, () => ({}));

const _dreamTaskDevApp = IS_DEV_ENVIRONMENT ? createBrowserDevApp() : null;
const DreamTaskCell = createWidgetCell('dream-task', DreamTaskWidget, ({ config, settings, onOpenSettings }) => ({
  gridHeightSize: Number(config?.gridHeightSize) || 1,
  settings,
  onOpenSettings,
  app: _dreamTaskDevApp,
}));

const CELL_COMPONENTS = {
  agenda: AgendaCell,
  calendar: CalendarCell,
  mood: MoodCell,
  planning: PlanningCell,
  'quick-actions': QuickActionsCell,
  quotes: QuotesCell,
  'recent-notes': RecentNotesCell,
  'victory-value': VictoryValueCell,
  'dream-task': DreamTaskCell,
};

// ------------------------------------------------------------------------------------------
// Extracted handler / response functions
//
// These live at module scope so the component body stays thin. Each receives only the
// setters and values it needs as explicit arguments from the caller inside DashboardApp.
// ------------------------------------------------------------------------------------------

// [Claude] Task: extract init response handler to module scope
// Prompt: "move response/handler functions outside main component to be local functions that receive arguments"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
function handleInitResult(result, { initializeDomainTasks, setMoodRatings, setQuarterlyPlans,
    setSettings, setDailyVictoryValues, setWeeklyVictoryValue, setCurrentDate, initDataFreshRef }) {
  setLoggingEnabled(result.settings?.[SETTING_KEYS.CONSOLE_LOGGING]);
  logIfEnabled(`Init returns`, result, `including moodRatings`, result.moodRatings);
  initializeDomainTasks(result);
  setMoodRatings(result.moodRatings);
  setQuarterlyPlans(result.quarterlyPlans);
  setSettings(result.settings);
  setDailyVictoryValues(result.dailyVictoryValues);
  setWeeklyVictoryValue(result.weeklyVictoryValue);
  setCurrentDate(result.currentDate);
  initDataFreshRef.current = true;
}

// [Claude] Task: extract mood-ratings fetch to module scope
// Prompt: "move response/handler functions outside main component to be local functions that receive arguments"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
async function fetchMoodRatingsForDate(referenceDate, setMoodRatings) {
  let weekStart = weekStartFromDateInput(referenceDate);
  const weekEnd = weekEndFromDateInput(referenceDate);
  if (isCurrentWeekEarly()) {
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() - 7);
  }
  const fromUnixSeconds = Math.floor(weekStart.getTime() / 1000);
  const toUnixSeconds = Math.floor(weekEnd.getTime() / 1000);
  try {
    const ratings = await callPlugin('getMoodRatings', fromUnixSeconds, toUnixSeconds);
    if (Array.isArray(ratings)) {
      setMoodRatings(ratings);
    }
  } catch (err) {
    logIfEnabled('fetchMoodRatings: failed to load mood ratings', err);
  }
}

// [Claude] Task: extract domain-change handler to module scope
// Prompt: "move response/handler functions outside main component to be local functions that receive arguments"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
function applyDomainChange(onDomainChange, setDailyVictoryValues, setWeeklyVictoryValue,
    newDomains, newActiveDomain, taskData) {
  onDomainChange(newDomains, newActiveDomain, taskData);
  if (taskData) {
    setDailyVictoryValues(taskData.dailyVictoryValues);
    setWeeklyVictoryValue(taskData.weeklyVictoryValue);
  }
}

// [Claude] Task: extract layout-save handler to module scope
// Prompt: "move response/handler functions outside main component to be local functions that receive arguments"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
async function saveLayout(currentSettings, setSettings, setFocusState,
    newRenderedWidgetIds, { isReset, sizing } = {}) {
  const existingLayout = Array.isArray(currentSettings?.[DASHBOARD_COMPONENTS])
    ? currentSettings[DASHBOARD_COMPONENTS] : DEFAULT_DASHBOARD_COMPONENTS;
  const configByWidgetId = {};
  if (!isReset) {
    existingLayout.forEach(c => { configByWidgetId[c.widgetId] = c; });
  }
  const newLayout = newRenderedWidgetIds.map(widgetId => {
    const existing = configByWidgetId[widgetId];
    const registryEntry = WIDGET_REGISTRY.find(w => w.widgetId === widgetId);
    const sizeOverride = sizing?.[widgetId];
    return {
      widgetId,
      gridWidthSize: sizeOverride?.gridWidthSize ?? existing?.gridWidthSize ?? registryEntry?.defaultGridWidthSize ?? 1,
      gridHeightSize: sizeOverride?.gridHeightSize ?? existing?.gridHeightSize ?? 1,
      settings: existing?.settings || {},
    };
  });
  await callPlugin('saveLayout', newLayout);
  setSettings(prev => ({ ...prev, [DASHBOARD_COMPONENTS]: newLayout }));
  setFocusState(DASHBOARD_FOCUS.DEFAULT);
}

// [Claude] Task: extract settings-save handler to module scope
// Prompt: "move response/handler functions outside main component to be local functions that receive arguments"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
async function saveSettings(setSettings, setFocusState,
    { llmProvider, apiKey, backgroundMode, backgroundImageUrl }) {
  logIfEnabled('[dashboard] handleSettingsSave called with:', {
    llmProvider, backgroundMode,
    backgroundImageUrl: backgroundImageUrl != null ? '(set)' : '(unchanged)',
  });
  const saves = [
    callPlugin('saveSetting', SETTING_KEYS.LLM_PROVIDER, llmProvider),
    callPlugin('saveSetting', SETTING_KEYS.LLM_API_KEY, apiKey),
    callPlugin('saveBackgroundImageUrl', backgroundImageUrl || ''),
  ];
  if (backgroundImageUrl && backgroundMode) {
    saves.push(callPlugin('saveBackgroundMode', backgroundMode));
  }
  try {
    await Promise.all(saves);
    logIfEnabled('[dashboard] settings save completed successfully');
  } catch (err) {
    logIfEnabled('[dashboard] settings save FAILED:', err);
  }
  setSettings(prev => ({
    ...prev,
    [SETTING_KEYS.LLM_PROVIDER]: llmProvider,
    [SETTING_KEYS.LLM_API_KEY]: apiKey,
    [SETTING_KEYS.BACKGROUND_IMAGE_URL]: backgroundImageUrl || '',
    [SETTING_KEYS.BACKGROUND_IMAGE_MODE]: backgroundImageUrl ? (backgroundMode || 'cover') : '',
  }));
  setFocusState(DASHBOARD_FOCUS.DEFAULT);
}

// [Claude] Task: extract mood-recorded handler to module scope
// Prompt: "move response/handler functions outside main component to be local functions that receive arguments"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
function appendMoodRating(setMoodRatings, newRating) {
  setMoodRatings(prev => [...(prev || []), newRating]);
}

// [Claude] Task: root component — owns all data state, renders memoized widget cells
// Prompt: "re-render only components whose data changed"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
export default function DashboardApp() {
  const h = createElement;
  const { activeTaskDomain, buildAgendaTasksByDate, initializeDomainTasks,
    onDomainChange, openTasks, taskDomains } = useDomainTasks();
  const { completedTasksByDate, fetchCompletedTasks } = useCompletedTasks();

  const [moodRatings, setMoodRatings] = useState(null);
  const [quarterlyPlans, setQuarterlyPlans] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dailyVictoryValues, setDailyVictoryValues] = useState(null);
  const [weeklyVictoryValue, setWeeklyVictoryValue] = useState(null);
  const [currentDate, setCurrentDate] = useState(null);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [focusState, setFocusState] = useState(DASHBOARD_FOCUS.DEFAULT);
  const initDataFreshRef = useRef(false);

  useEffect(() => {
    callPlugin('init').then(result => {
      if (result?.error) {
        setError(result.error);
      } else {
        handleInitResult(result, { initializeDomainTasks, setMoodRatings, setQuarterlyPlans,
          setSettings, setDailyVictoryValues, setWeeklyVictoryValue, setCurrentDate, initDataFreshRef });
      }
    }).catch(err => setError(err.message));
  }, []);

  // [Claude] Task: fall back to previous week for VictoryValue when current week has < 3 elapsed days
  // Prompt: "when beginning of new week with less than 3 full days of stats, show previous week"
  // Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
  const victoryReferenceDate = useMemo(() => {
    if (selectedDate) return selectedDate;
    if (!currentDate) return null;
    if (isCurrentWeekEarly()) {
      const weekStart = weekStartFromDateInput(currentDate);
      const prevWeekDay = new Date(weekStart);
      prevWeekDay.setDate(prevWeekDay.getDate() - 1);
      return dateKeyFromDateInput(prevWeekDay);
    }
    return currentDate;
  }, [currentDate, selectedDate]);

  const fetchMoodRatings = useCallback(
    (referenceDate) => fetchMoodRatingsForDate(referenceDate, setMoodRatings),
    []
  );

  // [Claude] Task: refetch completed tasks (including previous week for VictoryValue) and mood ratings
  // Prompt: "when beginning of new week with less than 3 full days of stats, show previous week"
  // Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    const referenceDate = selectedDate || currentDate;
    if (!referenceDate) return;
    if (initDataFreshRef.current) {
      initDataFreshRef.current = false;
    } else {
      fetchMoodRatings(referenceDate);
    }
    if (activeTaskDomain) {
      fetchCompletedTasks(referenceDate, activeTaskDomain);
      if (victoryReferenceDate && victoryReferenceDate !== referenceDate) {
        fetchCompletedTasks(victoryReferenceDate, activeTaskDomain);
      }
    }
  }, [activeTaskDomain, currentDate, fetchCompletedTasks, fetchMoodRatings, selectedDate, victoryReferenceDate]);

  const handleDomainChange = useCallback(
    (newDomains, newActiveDomain, taskData) =>
      applyDomainChange(onDomainChange, setDailyVictoryValues, setWeeklyVictoryValue,
        newDomains, newActiveDomain, taskData),
    [onDomainChange]
  );

  const handleLayoutSave = useCallback(
    (newRenderedWidgetIds, options) =>
      saveLayout(settings, setSettings, setFocusState, newRenderedWidgetIds, options),
    [settings]
  );

  const handleSettingsSave = useCallback(
    (params) => saveSettings(setSettings, setFocusState, params),
    []
  );

  const handleMoodRecorded = useCallback(
    (newRating) => appendMoodRating(setMoodRatings, newRating),
    []
  );

  // Pre-compute agenda tasks so AgendaCell's memo can skip re-rendering when only
  // completedTasksByDate or moodRatings change (neither affects open task ordering).
  const agendaTasks = useMemo(
    () => currentDate ? buildAgendaTasksByDate(currentDate) : {},
    [buildAgendaTasksByDate, currentDate]
  );

  // Derive the ordered layout config once per settings change.
  const activeComponents = useMemo(() => {
    const configured = settings?.[DASHBOARD_COMPONENTS];
    return Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_DASHBOARD_COMPONENTS;
  }, [settings]);

  const [draggingWidgetId, setDraggingWidgetId] = useState(null);
  const [displayedComponents, setDisplayedComponents] = useState(activeComponents);
  const displayedComponentsRef = useRef(activeComponents);
  const onOpenDreamTaskSettings = useCallback(
    () => setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG),
    []
  );

  useEffect(() => {
    if (draggingWidgetId) return;
    setDisplayedComponents(activeComponents);
  }, [activeComponents, draggingWidgetId]);

  useEffect(() => {
    displayedComponentsRef.current = displayedComponents;
  }, [displayedComponents]);

  // [Claude] Task: activate dashboard drag mode when a widget heading dispatches drag-ready after long press
  // Prompt: "Create DraggableHeading with useEffect monitoring mousedown >= 2000ms for drag mode"
  // Date: 2026-03-14 | Model: gpt-5.3-codex
  useEffect(() => {
    const onDragReady = (event) => {
      const readyWidgetId = event?.detail?.widgetId;
      if (!readyWidgetId) return;
      setDraggingWidgetId(readyWidgetId);
      setDisplayedComponents(prev => Array.isArray(prev) && prev.length ? prev : activeComponents);
    };
    window.addEventListener('dashboard:widget-drag-ready', onDragReady);
    return () => window.removeEventListener('dashboard:widget-drag-ready', onDragReady);
  }, [activeComponents]);

  const finalizeDrag = useCallback(() => {
    if (!draggingWidgetId) return;
    const previousOrder = widgetOrder(activeComponents);
    const nextOrder = widgetOrder(displayedComponentsRef.current);
    setDraggingWidgetId(null);
    if (nextOrder && previousOrder !== nextOrder) {
      handleLayoutSave(displayedComponentsRef.current.map(c => c.widgetId));
    }
  }, [activeComponents, draggingWidgetId, handleLayoutSave]);

  // [Claude] Task: live-reorder dashboard widgets while mouse is held after long-press drag activation
  // Prompt: "other widgets should slide out of the way and layout should persist on release"
  // Date: 2026-03-14 | Model: gpt-5.3-codex
  useEffect(() => {
    if (!draggingWidgetId) return;

    const onMouseMove = (event) => {
      if ((event.buttons & 1) !== 1) {
        finalizeDrag();
        return;
      }
      const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
      const hoveredCell = hoveredElement?.closest?.('.dashboard-grid .grid-cell[data-widget-id]');
      const targetWidgetId = hoveredCell?.getAttribute?.('data-widget-id');
      if (!targetWidgetId || targetWidgetId === draggingWidgetId) return;
      setDisplayedComponents(prev => moveWidgetBefore(prev, draggingWidgetId, targetWidgetId));
    };

    const onMouseUp = () => finalizeDrag();
    const onBlur = () => finalizeDrag();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [draggingWidgetId, finalizeDrag]);

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!settings) return h('div', { className: 'dashboard-loading' },
    h('div', { className: 'spinner' }),
    h('p', null, 'Loading dashboard...')
  );

  // [Claude] Task: compute inline background image style from persisted settings
  // Prompt: "add background image upload option to DashboardSettings"
  // Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
  const backgroundUrl = settings?.[SETTING_KEYS.BACKGROUND_IMAGE_URL];
  const backgroundMode = settings?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE] || 'cover';
  if (backgroundUrl) {
    logIfEnabled('[dashboard] background image URL from settings:', backgroundUrl, 'mode:', backgroundMode);
  }
  const backgroundStyle = backgroundUrl ? (() => {
    const isTiling = backgroundMode.startsWith('repeat');
    return {
      backgroundImage: `url(${ backgroundUrl })`,
      backgroundSize: isTiling ? 'auto' : backgroundMode,
      backgroundRepeat: isTiling ? backgroundMode : 'no-repeat',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    };
  })() : undefined;

  // [Claude] Task: split into full-width background wrapper and max-width content area
  // Prompt: "background wrapper consumes 100% of window, widget area maxes out at 1200px"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  return h('div', { className: 'dashboard-outer-container', style: backgroundStyle },
    focusState === DASHBOARD_FOCUS.LAYOUT_CONFIG
      ? h(DashboardLayoutPopup, {
          currentLayout: Array.isArray(settings?.[DASHBOARD_COMPONENTS]) ? settings[DASHBOARD_COMPONENTS] : DEFAULT_DASHBOARD_COMPONENTS,
          onSave: handleLayoutSave,
          onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
        })
      : null,
    focusState === DASHBOARD_FOCUS.SETTINGS_CONFIG
      ? (() => {
          logIfEnabled('[dashboard] rendering DashboardSettingsPopup, bgUrl:', settings?.[SETTING_KEYS.BACKGROUND_IMAGE_URL]);
          return h(DashboardSettingsPopup, {
            currentLlmProvider: settings?.[SETTING_KEYS.LLM_PROVIDER],
            currentApiKey: settings?.[SETTING_KEYS.LLM_API_KEY],
            currentBackgroundImageUrl: settings?.[SETTING_KEYS.BACKGROUND_IMAGE_URL],
            currentBackgroundMode: settings?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE],
            onSave: handleSettingsSave,
            onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
          });
        })()
      : null,
    h('div', { className: 'dashboard-content' },
      h('div', { className: 'dashboard-toolbar' },
        h(TaskDomains, {
          domains: taskDomains,
          activeTaskDomain: activeTaskDomain,
          onDomainChange: handleDomainChange,
        }),
        h('div', { className: 'dashboard-toolbar-actions' },
          h('button', {
            className: 'dashboard-configure-button',
            type: 'button',
            onClick: () => { logIfEnabled('[dashboard] opening Settings popup'); setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG); },
            title: 'Configure LLM provider and API key for AI-powered features',
          }, '\u2699\uFE0F Settings'),
          h('button', {
            className: 'dashboard-configure-button',
            type: 'button',
            onClick: () => setFocusState(DASHBOARD_FOCUS.LAYOUT_CONFIG),
            title: 'Configure which widgets are shown and in what order',
          }, '\u2630 Layout')
        )
      ),
      h('div', { className: `dashboard-grid${draggingWidgetId ? ' dashboard-grid--dragging' : ''}` },
        ...displayedComponents.map((config, index) => {
          const widgetId = config?.widgetId || DEFAULT_DASHBOARD_COMPONENTS[index]?.widgetId;
          const CellComponent = CELL_COMPONENTS[widgetId];
          if (!CellComponent) return null;
          return h(CellComponent, {
            key: widgetId,
            config,
            draggingWidgetId,
            agendaTasks,
            currentDate,
            selectedDate,
            completedTasksByDate,
            openTasks,
            onDateSelect: setSelectedDate,
            moodRatings,
            onMoodRecorded: handleMoodRecorded,
            quarterlyPlans,
            dailyValues: dailyVictoryValues,
            weeklyTotal: weeklyVictoryValue,
            referenceDate: victoryReferenceDate,
            onReferenceDateChange: setSelectedDate,
            settings,
            onOpenSettings: onOpenDreamTaskSettings,
          });
        }).filter(Boolean)
      )
    )
  );
}
