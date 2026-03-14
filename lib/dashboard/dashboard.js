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
import { DASHBOARD_COMPONENTS, DASHBOARD_FOCUS, DEFAULT_DASHBOARD_COMPONENTS, SETTING_KEYS, WIDGET_REGISTRY } from 'constants/settings';
import DashboardLayoutPopup from 'dashboard-layout-popup';
import DashboardSettingsPopup from 'dashboard-settings-popup';
import { useDashboardDrag } from 'draggable-heading';
import DreamTaskWidget from 'dream-task';
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
import "./styles/dashboard.scss"

// ------------------------------------------------------------------------------------------
function gridCellStyle(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return { gridColumn: `span ${w}`, gridRow: `span ${h}` };
}

function gridCellClassName(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return `grid-cell horizontal-${w}-cell vertical-${h}-cell`;
}

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
// [Claude] Task: factory for memoized widget cells, now passing app to each widget
// Prompt: "each widget receives the app object"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function createWidgetCell(widgetId, WidgetComponent, buildWidgetProps) {
  return memo(function DashboardWidgetCell(cellProps) {
    useWidgetLoadTiming(widgetId);
    const { config, draggingWidgetId } = cellProps;
    return createElement('div', gridCellContainerProps(config, draggingWidgetId),
      createElement(WidgetComponent, buildWidgetProps(cellProps))
    );
  });
}

const PlanningCell = createWidgetCell('planning', PlanningWidget, ({ app, config, quarterlyPlans }) => ({
  quarterlyPlans,
  gridHeightSize: Number(config?.gridHeightSize) || 1,
  app,
}));

const VictoryValueCell = createWidgetCell('victory-value', VictoryValueWidget, ({
  app, config, completedTasksByDate, dailyValues, moodRatings, onReferenceDateChange, referenceDate, settings, weeklyTotal,
}) => ({
  completedTasksByDate,
  dailyValues,
  weeklyTotal,
  moodRatings,
  referenceDate,
  onReferenceDateChange,
  settings: { ...settings, 'victory-value': config?.settings || {} },
  app,
}));

const MoodCell = createWidgetCell('mood', MoodWidget, ({ app, moodRatings, onMoodRecorded, settings }) => ({
  moodRatings,
  onMoodRecorded,
  settings,
  app,
}));

const CalendarCell = createWidgetCell('calendar', CalendarWidget, ({
  app, config, completedTasksByDate, currentDate, onDateSelect, openTasks, selectedDate, settings,
}) => ({
  completedTasksByDate,
  currentDate,
  gridHeightSize: config?.gridHeightSize,
  gridWidthSize: config?.gridWidthSize,
  openTasks,
  onDateSelect,
  selectedDate,
  settings: { ...settings, calendar: config?.settings || {} },
  app,
}));

const AgendaCell = createWidgetCell('agenda', AgendaWidget, ({ agendaTasks, app, currentDate, selectedDate }) => ({
  currentDate,
  tasks: agendaTasks,
  selectedDate,
  app,
}));

const QuotesCell = createWidgetCell('quotes', QuotesWidget, ({ app, config, settings }) => ({
  quotes: null,
  planContent: null,
  gridHeightSize: Number(config?.gridHeightSize) || 1,
  settings: { ...settings, quotes: config?.settings || {} },
  app,
}));

const RecentNotesCell = createWidgetCell('recent-notes', RecentNotesWidget, ({ app, config }) => ({
  gridHeightSize: Number(config?.gridHeightSize) || 1,
  app,
}));

const QuickActionsCell = createWidgetCell('quick-actions', QuickActionsWidget, ({ app }) => ({
  app,
}));

const DreamTaskCell = createWidgetCell('dream-task', DreamTaskWidget, ({ app, config, onOpenSettings, settings }) => ({
  gridHeightSize: Number(config?.gridHeightSize) || 1,
  settings,
  onOpenSettings,
  app,
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
// Extracted handler / response functions — each receives `app` as an explicit argument
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

// [Claude] Task: extract mood-ratings fetch using app.getMoodRatings
// Prompt: "widgets receive the app object instead of using callPlugin"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function fetchMoodRatingsForDate(app, referenceDate, setMoodRatings) {
  let weekStart = weekStartFromDateInput(referenceDate);
  const weekEnd = weekEndFromDateInput(referenceDate);
  if (isCurrentWeekEarly()) {
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() - 7);
  }
  const fromUnixSeconds = Math.floor(weekStart.getTime() / 1000);
  const toUnixSeconds = Math.floor(weekEnd.getTime() / 1000);
  try {
    const ratings = await app.getMoodRatings(fromUnixSeconds, toUnixSeconds);
    if (Array.isArray(ratings)) {
      setMoodRatings(ratings);
    }
  } catch (err) {
    logIfEnabled('fetchMoodRatings: failed to load mood ratings', err);
  }
}

function applyDomainChange(onDomainChange, setDailyVictoryValues, setWeeklyVictoryValue,
    newDomains, newActiveDomain, taskData) {
  onDomainChange(newDomains, newActiveDomain, taskData);
  if (taskData) {
    setDailyVictoryValues(taskData.dailyVictoryValues);
    setWeeklyVictoryValue(taskData.weeklyVictoryValue);
  }
}

// [Claude] Task: extract layout-save handler using app.saveLayout
// Prompt: "widgets receive the app object instead of using callPlugin"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function saveLayout(app, currentSettings, setSettings, setFocusState,
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
  await app.saveLayout(newLayout);
  setSettings(prev => ({ ...prev, [DASHBOARD_COMPONENTS]: newLayout }));
  setFocusState(DASHBOARD_FOCUS.DEFAULT);
}

// [Claude] Task: extract settings-save handler using app methods
// Prompt: "widgets receive the app object instead of using callPlugin"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function saveSettings(app, setSettings, setFocusState,
    { llmProvider, apiKey, backgroundMode, backgroundImageUrl }) {
  logIfEnabled('[dashboard] handleSettingsSave called with:', {
    llmProvider, backgroundMode,
    backgroundImageUrl: backgroundImageUrl != null ? '(set)' : '(unchanged)',
  });
  const saves = [
    app.saveSetting(SETTING_KEYS.LLM_PROVIDER, llmProvider),
    app.saveSetting(SETTING_KEYS.LLM_API_KEY, apiKey),
    app.saveBackgroundImageUrl(backgroundImageUrl || ''),
  ];
  if (backgroundImageUrl && backgroundMode) {
    saves.push(app.saveBackgroundMode(backgroundMode));
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

function appendMoodRating(setMoodRatings, newRating) {
  setMoodRatings(prev => [...(prev || []), newRating]);
}

// [Claude] Task: root component — accepts app prop, passes to all widgets
// Prompt: "each widget receives the app object"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function DashboardApp({ app }) {
  const h = createElement;
  const { activeTaskDomain, buildAgendaTasksByDate, initializeDomainTasks,
    onDomainChange, openTasks, taskDomains } = useDomainTasks();
  const { completedTasksByDate, fetchCompletedTasks } = useCompletedTasks(app);

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
    app.init().then(result => {
      if (result?.error) {
        setError(result.error);
      } else {
        handleInitResult(result, { initializeDomainTasks, setMoodRatings, setQuarterlyPlans,
          setSettings, setDailyVictoryValues, setWeeklyVictoryValue, setCurrentDate, initDataFreshRef });
      }
    }).catch(err => setError(err.message));
  }, []);

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
    (referenceDate) => fetchMoodRatingsForDate(app, referenceDate, setMoodRatings),
    [app]
  );

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
      saveLayout(app, settings, setSettings, setFocusState, newRenderedWidgetIds, options),
    [app, settings]
  );

  const handleSettingsSave = useCallback(
    (params) => saveSettings(app, setSettings, setFocusState, params),
    [app]
  );

  const handleMoodRecorded = useCallback(
    (newRating) => appendMoodRating(setMoodRatings, newRating),
    []
  );

  const agendaTasks = useMemo(
    () => currentDate ? buildAgendaTasksByDate(currentDate) : {},
    [buildAgendaTasksByDate, currentDate]
  );

  const activeComponents = useMemo(() => {
    const configured = settings?.[DASHBOARD_COMPONENTS];
    return Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_DASHBOARD_COMPONENTS;
  }, [settings]);

  const { draggingWidgetId, displayedComponents } = useDashboardDrag(activeComponents, handleLayoutSave);
  const onOpenDreamTaskSettings = useCallback(
    () => setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG),
    []
  );

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!settings) return h('div', { className: 'dashboard-loading' },
    h('div', { className: 'spinner' }),
    h('p', null, 'Loading dashboard...')
  );

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
            app,
            currentApiKey: settings?.[SETTING_KEYS.LLM_API_KEY],
            currentBackgroundImageUrl: settings?.[SETTING_KEYS.BACKGROUND_IMAGE_URL],
            currentBackgroundMode: settings?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE],
            currentLlmProvider: settings?.[SETTING_KEYS.LLM_PROVIDER],
            onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
            onSave: handleSettingsSave,
          });
        })()
      : null,
    h('div', { className: 'dashboard-content' },
      h('div', { className: 'dashboard-toolbar' },
        h(TaskDomains, {
          activeTaskDomain: activeTaskDomain,
          app,
          domains: taskDomains,
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
            agendaTasks,
            app,
            completedTasksByDate,
            config,
            currentDate,
            dailyValues: dailyVictoryValues,
            draggingWidgetId,
            moodRatings,
            onDateSelect: setSelectedDate,
            onMoodRecorded: handleMoodRecorded,
            onOpenSettings: onOpenDreamTaskSettings,
            onReferenceDateChange: setSelectedDate,
            openTasks,
            quarterlyPlans,
            referenceDate: victoryReferenceDate,
            selectedDate,
            settings,
            weeklyTotal: weeklyVictoryValue,
          });
        }).filter(Boolean)
      )
    )
  );
}
