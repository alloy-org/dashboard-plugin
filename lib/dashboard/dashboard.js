/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Root dashboard component — fetches data and renders widget grid
 * Prompt summary: "main React component that calls init, shows loading/error, and lays out widgets"
 */
import { Component, createElement, memo, useEffect, useState, useCallback, useRef, useMemo } from "react";
import PlanningWidget from 'planning';
import AgendaWidget from 'agenda';
import CalendarWidget from 'calendar';
import { apiKeyBucketFromLlmProvider, apiKeyFromProvider, DASHBOARD_FOCUS, DEFAULT_DASHBOARD_COMPONENTS, SETTING_KEYS, WIDGET_REGISTRY } from 'constants/settings';
import DashboardLayoutPopup from 'dashboard-layout-popup';
import DashboardSettingNote from "dashboard-setting-note";
import DashboardSettingsPopup from 'dashboard-settings-popup';
import { useDashboardDrag } from 'draggable-heading';
import DreamTaskWidget from 'dream-task';
import useCompletedTasks from 'hooks/use-completed-tasks';
import DaySketchWidget from 'day-sketch';
import PeakHoursWidget from 'peak-hours';
import useDomainTasks from 'hooks/use-domain-tasks';
import MoodWidget from 'mood';
import QuotesWidget from 'quotes';
import QuickActionsWidget from 'quick-actions';
import RecentNotesWidget from 'recent-notes';
import TaskDomains from 'task-domains';
import { dateKeyFromDateInput, isCurrentWeekEarly, weekStartFromDateInput, weekEndFromDateInput } from 'util/date-utility';
import { backgroundSplashUrl } from 'util/background-splash-images';
import { logIfEnabled, setLoggingEnabled } from "util/log";
import { useWidgetLoadTiming } from "util/widget-timing";
import VictoryValueWidget from 'victory-value';
import "styles/dashboard.scss"

// ------------------------------------------------------------------------------------------
// @description Generates CSS class names for a grid cell based on its configured dimensions.
//   Grid spanning is handled entirely via these classes (horizontal-N-cell, vertical-N-cell)
//   so that CSS media queries can override them on mobile without needing inline style overrides.
// @param {Object} config - Widget configuration with gridWidthSize and gridHeightSize
// @returns {string} Space-separated class name string
function gridCellClassName(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return `grid-cell horizontal-${w}-cell vertical-${h}-cell`;
}

// ------------------------------------------------------------------------------------------
// @description Builds container props (className, style, data attributes) for a grid cell,
//   including drag-state classes when a widget is being dragged
// @param {Object} config - Widget configuration object
// @param {string|null} draggingWidgetId - ID of the widget currently being dragged, or null
// @returns {Object} Props object suitable for spreading onto a container element
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
    'data-widget-id': widgetId,
  };
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: add error boundary so one widget crash doesn't take down the dashboard
// Prompt: "wrap each component load in try...catch so failure to render one widget does not disrupt others"
// Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
class WidgetErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    logIfEnabled(`[WidgetErrorBoundary] Widget "${ this.props.widgetId }" crashed:`, error, info);
  }
  render() {
    if (this.state.hasError) {
      return createElement('div', { className: 'widget-error-fallback' },
        createElement('p', { className: 'widget-error-fallback-title' }, `⚠ ${ this.props.widgetId }`),
        createElement('p', { className: 'widget-error-fallback-message' },
          this.state.error?.message || 'An unexpected error occurred'
        ),
        createElement('button', {
          className: 'widget-error-fallback-retry',
          onClick: () => this.setState({ hasError: false, error: null }),
        }, 'Retry')
      );
    }
    return this.props.children;
  }
}

// ------------------------------------------------------------------------------------------
// @description Factory that creates a memoized React component for a dashboard widget cell.
//   Each cell tracks load timing, applies grid layout props, and renders the given widget
//   inside an error boundary so that a crash in one widget does not break the rest.
// @param {string} widgetId - Unique identifier for the widget type
// @param {Function} WidgetComponent - The React component to render inside the cell
// @param {Function} buildWidgetProps - Function that maps cell props to widget-specific props
// @returns {React.MemoExoticComponent} Memoized cell component
function createWidgetCell(widgetId, WidgetComponent, buildWidgetProps) {
  return memo(function DashboardWidgetCell(cellProps) {
    useWidgetLoadTiming(widgetId);
    const { config, draggingWidgetId } = cellProps;
    return createElement('div', gridCellContainerProps(config, draggingWidgetId),
      createElement(WidgetErrorBoundary, { widgetId },
        createElement(WidgetComponent, buildWidgetProps(cellProps))
      )
    );
  });
}

// ------------------------------------------------------------------------------------------
// @desc Builds a prop-picker callback for createWidgetCell when the widget just receives a
//   subset of cellProps with no transformation. Avoids verbose destructure-and-reassemble.
// @param {...string} keys - Prop names to forward from cellProps to the widget
// @returns {Function} buildWidgetProps callback
// [Claude claude-4.6-opus-high-thinking] Task: DRY pure pass-through cell definitions
// Prompt: "eliminate repeated destructure-and-reassemble pattern in widget cell definitions"
function pickProps(...keys) {
  return (cellProps) => {
    const result = {};
    for (const key of keys) result[key] = cellProps[key];
    return result;
  };
}

const AgendaCell = createWidgetCell('agenda', AgendaWidget, (props) => ({
  app: props.app, currentDate: props.currentDate, selectedDate: props.selectedDate,
  tasks: props.agendaTasks, timeFormat: props.timeFormat,
}));
const DaySketchCell = createWidgetCell('day-sketch', DaySketchWidget,
  pickProps('agendaTasks', 'app', 'currentDate', 'timeFormat'));
const DreamTaskCell = createWidgetCell('dream-task', DreamTaskWidget, ({ app, config, onOpenSettings, providerApiKey, providerEm }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, gridWidthSize: Number(config?.gridWidthSize) || 2,
  onOpenSettings, providerApiKey, providerEm,
}));
const CalendarCell = createWidgetCell('calendar', CalendarWidget, ({ app, completedTasksByDate, config, currentDate,
    onDateSelect, onOpenSettings, openTasks, selectedDate, weekFormat }) => ({
  app, completedTasksByDate, currentDate, gridHeightSize: config?.gridHeightSize, gridWidthSize: config?.gridWidthSize,
  onDateSelect, onOpenSettings, openTasks, selectedDate, weekFormat,
}));
const MoodCell = createWidgetCell('mood', MoodWidget, pickProps('app', 'moodRatings', 'onMoodRecorded'));
const PeakHoursCell = createWidgetCell('peak-hours', PeakHoursWidget,
  pickProps('app', 'currentDate', 'selectedDate', 'timeFormat'));
const PlanningCell = createWidgetCell('planning', PlanningWidget, ({ app, config, quarterlyPlans }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, quarterlyPlans,
}));
const QuickActionsCell = createWidgetCell('quick-actions', QuickActionsWidget, pickProps('app'));
const QuotesCell = createWidgetCell('quotes', QuotesWidget, ({ app, config, providerApiKey }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, planContent: null, providerApiKey, quotes: null,
}));
const RecentNotesCell = createWidgetCell('recent-notes', RecentNotesWidget, ({ app, config }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1,
}));
const VictoryValueCell = createWidgetCell('victory-value', VictoryValueWidget,
  pickProps('app', 'completedTasksByDate', 'dailyValues', 'moodRatings', 'onReferenceDateChange', 'referenceDate',
    'weekFormat', 'weeklyTotal'));

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
  'peak-hours': PeakHoursCell,
  'day-sketch': DaySketchCell,
};

// ------------------------------------------------------------------------------------------
// Extracted handler / response functions — each receives `app` as an explicit argument
// ------------------------------------------------------------------------------------------

// ------------------------------------------------------------------------------------------
// @description Processes the initialization response from app.init(), distributing data
//   to the appropriate state setters (mood ratings, plans, config, victory values, etc.)
// @param {Object} result - The init response object containing settings and dashboard data
// @param {Object} setters - Destructured state setter functions and refs
function handleInitResult(result, { initDataFreshRef, initializeDomainTasks, setConfigParams,
    setCurrentDate, setDailyVictoryValues, setMoodRatings, setPluginNoteUUID,
    setQuarterlyPlans, setWeeklyVictoryValue }) {
  setLoggingEnabled(result.settings?.[SETTING_KEYS.CONSOLE_LOGGING]);
  logIfEnabled(`Init returns`, result, `including moodRatings`, result.moodRatings);
  initializeDomainTasks(result);
  setMoodRatings(result.moodRatings);
  setQuarterlyPlans(result.quarterlyPlans);
  setConfigParams(result.settings);
  setDailyVictoryValues(result.dailyVictoryValues);
  setWeeklyVictoryValue(result.weeklyVictoryValue);
  setCurrentDate(result.currentDate);
  if (result.pluginNoteUUID) setPluginNoteUUID(result.pluginNoteUUID);
  initDataFreshRef.current = true;
}

// ------------------------------------------------------------------------------------------
// @async
// @description Fetches mood ratings for the week surrounding a given reference date.
//   Extends the range back one week if the current week is early (few days in).
// @param {Object} app - Application instance with getMoodRatings method
// @param {string|Date} referenceDate - The date to center the mood rating query around
// @param {Function} setMoodRatings - State setter for mood ratings array
// @returns {Promise<void>}
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

// @function applyDomainChange
// @description Applies a domain change and updates victory value state if new task data is provided
// @param {Function} onDomainChange - Callback to process the domain switch
// @param {Function} setDailyVictoryValues - State setter for daily victory values
// @param {Function} setWeeklyVictoryValue - State setter for weekly victory value
// @param {Array} newDomains - Updated list of task domains
// @param {Object} newActiveDomain - The newly selected active domain
// @param {Object|null} taskData - Optional task data containing updated victory values
function applyDomainChange(onDomainChange, setDailyVictoryValues, setWeeklyVictoryValue,
    newDomains, newActiveDomain, taskData) {
  onDomainChange(newDomains, newActiveDomain, taskData);
  if (taskData) {
    setDailyVictoryValues(taskData.dailyVictoryValues);
    setWeeklyVictoryValue(taskData.weeklyVictoryValue);
  }
}

// @async
// @function saveLayout
// @description Persists the dashboard widget layout to settings. Merges existing widget
//   configurations with new widget ordering, applying optional size overrides.
// @param {Object} app - Application instance with setSetting method
// @param {Object} currentConfigParams - Current configuration parameters
// @param {Function} setConfigParams - State setter for config parameters
// @param {Function} setFocusState - State setter for dashboard focus/popup state
// @param {string[]} newRenderedWidgetIds - Ordered array of widget IDs to display
// @param {Object} [options] - Optional: isReset to ignore existing config, sizing for size overrides
// @returns {Promise<void>}
async function saveLayout(app, currentConfigParams, setConfigParams, setFocusState,
    newRenderedWidgetIds, { isReset, sizing } = {}) {
  const existingLayout = Array.isArray(currentConfigParams?.[SETTING_KEYS.DASHBOARD_COMPONENTS])
    ? currentConfigParams[SETTING_KEYS.DASHBOARD_COMPONENTS] : DEFAULT_DASHBOARD_COMPONENTS;
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
  await app.setSetting(SETTING_KEYS.DASHBOARD_COMPONENTS, JSON.stringify(newLayout));
  setConfigParams(prev => ({ ...prev, [SETTING_KEYS.DASHBOARD_COMPONENTS]: newLayout }));
  setFocusState(DASHBOARD_FOCUS.DEFAULT);
}

// [Claude] Task: persist per-provider API keys and sync app.settings for downstream code
// Prompt: "store the API key in a settings key that corresponds to the provider"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
// ------------------------------------------------------------------------------------------
// @async
// @description Persists LLM provider, per-provider API key, and background image settings
//   via app.setSetting, then syncs app.settings and configParams for immediate widget use.
// @param {Object} app - Application instance with setSetting method
// @param {Function} setConfigParams - State setter for config parameters
// @param {Function} setFocusState - State setter for dashboard focus/popup state
// @param {Object} settings - Settings to save
// @param {string} settings.llmProvider - Selected LLM provider identifier
// @param {string} settings.apiKey - API key for the selected provider
// @param {string} settings.apiKeyProvider - Base provider name for per-provider key storage
// @param {string} settings.backgroundMode - Background image display mode
// @param {string} settings.backgroundImageUrl - URL for the background image
// @returns {Promise<void>}
// [Claude claude-4.6-opus-high-thinking] Task: persist time/week format via DashboardSettingNote alongside LLM/background settings
// Prompt: "when Save Settings is clicked, update DashboardSettingNote with new time/week values"
async function saveSettings(app, dashboardSettingNoteRef, setConfigParams, setFocusState, setTimeFormat, setWeekFormat,
    { apiKey, apiKeyProvider, backgroundImageUrl, backgroundMode, llmProvider, timeFormat, weekFormat }) {
  logIfEnabled('[dashboard] handleSettingsSave called with:', { llmProvider, apiKeyProvider, backgroundMode, backgroundImageUrl: backgroundImageUrl != null ? '(set)' : '(unchanged)', timeFormat, weekFormat });
  const providerSettingKey = apiKeyFromProvider(apiKeyProvider || llmProvider);
  const saves = [
    app.setSetting(SETTING_KEYS.LLM_PROVIDER_MODEL, llmProvider),
    app.setSetting(SETTING_KEYS.BACKGROUND_IMAGE_URL, backgroundImageUrl || ''),
  ];
  if (providerSettingKey && apiKey) {
    saves.push(app.setSetting(providerSettingKey, apiKey));
  }
  if (backgroundImageUrl && backgroundMode) {
    saves.push(app.setSetting(SETTING_KEYS.BACKGROUND_IMAGE_MODE, backgroundMode));
  }
  if (dashboardSettingNoteRef.current && (timeFormat || weekFormat)) {
    saves.push(dashboardSettingNoteRef.current.save({ timeFormat, weekFormat }));
  }
  try {
    await Promise.all(saves);
    logIfEnabled('[dashboard] settings save completed successfully');
  } catch (err) {
    logIfEnabled('[dashboard] settings save FAILED:', err);
  }
  app.settings[SETTING_KEYS.LLM_PROVIDER_MODEL] = llmProvider;
  if (providerSettingKey) app.settings[providerSettingKey] = apiKey;
  const configUpdate = {
    [SETTING_KEYS.LLM_PROVIDER_MODEL]: llmProvider,
    [SETTING_KEYS.BACKGROUND_IMAGE_URL]: backgroundImageUrl || '',
    [SETTING_KEYS.BACKGROUND_IMAGE_MODE]: backgroundImageUrl ? (backgroundMode || 'cover') : '',
  };
  if (providerSettingKey) configUpdate[providerSettingKey] = apiKey;
  setConfigParams(prev => ({ ...prev, ...configUpdate }));
  if (timeFormat) setTimeFormat(timeFormat);
  if (weekFormat) setWeekFormat(weekFormat);
  setFocusState(DASHBOARD_FOCUS.DEFAULT);
}

// ------------------------------------------------------------------------------------------
// @description Appends a new mood rating entry to the existing mood ratings array
// @param {Function} setMoodRatings - State setter for mood ratings
// @param {Object} newRating - The mood rating object to append
function appendMoodRating(setMoodRatings, newRating) {
  setMoodRatings(prev => [...(prev || []), newRating]);
}

// ------------------------------------------------------------------------------------------
// @description Root dashboard component. Initializes app data, manages shared state
//   (mood ratings, plans, victory values, selected date), and renders the widget grid
//   along with toolbar controls for settings and layout configuration.
// @param {Object} props
// @param {Object} props.app - Application instance providing init, settings, and data methods
// @returns {React.ReactElement} The rendered dashboard UI
export default function DashboardApp({ app }) {
  const h = createElement;
  const { activeTaskDomain, buildAgendaTasksByDate, initializeDomainTasks,
    onDomainChange, openTasks, taskDomains } = useDomainTasks();
  const { completedTasksByDate, fetchCompletedTasks } = useCompletedTasks(app);

  const [configParams, setConfigParams] = useState(null);
  const [currentDate, setCurrentDate] = useState(null);
  const [dailyVictoryValues, setDailyVictoryValues] = useState(null);
  const [error, setError] = useState(null);
  const [focusState, setFocusState] = useState(DASHBOARD_FOCUS.DEFAULT);
  const [moodRatings, setMoodRatings] = useState(null);
  const [pluginNoteUUID, setPluginNoteUUID] = useState(null);
  const [quarterlyPlans, setQuarterlyPlans] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [timeFormat, setTimeFormat] = useState('meridian');
  const [weekFormat, setWeekFormat] = useState('sunday');
  const [weeklyVictoryValue, setWeeklyVictoryValue] = useState(null);
  const dashboardSettingNoteRef = useRef(null);
  const initDataFreshRef = useRef(false);

  // [Claude claude-4.6-opus-high-thinking] Task: load time/week format from DashboardSettingNote on init
  // Prompt: "outer Dashboard component should keep useState for timeFormat and weekFormat"
  useEffect(() => {
    app.init().then(async (result) => {
      if (result?.error) {
        setError(result.error);
      } else {
        if (result?.settings) app.settings = result.settings;
        handleInitResult(result, { initDataFreshRef, initializeDomainTasks, setConfigParams,
          setCurrentDate, setDailyVictoryValues, setMoodRatings, setPluginNoteUUID,
          setQuarterlyPlans, setWeeklyVictoryValue });
        dashboardSettingNoteRef.current = new DashboardSettingNote(app);
        const { timeFormat: loadedTime, weekFormat: loadedWeek } = await dashboardSettingNoteRef.current.load();
        if (loadedTime) setTimeFormat(loadedTime);
        if (loadedWeek) setWeekFormat(loadedWeek);
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
      saveLayout(app, configParams, setConfigParams, setFocusState, newRenderedWidgetIds, options),
    [app, configParams]
  );

  const handleSettingsSave = useCallback(
    (params) => saveSettings(app, dashboardSettingNoteRef, setConfigParams, setFocusState, setTimeFormat, setWeekFormat, params),
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
    const configured = configParams?.[SETTING_KEYS.DASHBOARD_COMPONENTS];
    return Array.isArray(configured) && configured.length > 0 ? configured : DEFAULT_DASHBOARD_COMPONENTS;
  }, [configParams]);

  const { draggingWidgetId, displayedComponents } = useDashboardDrag(activeComponents, handleLayoutSave);
  const onOpenDreamTaskSettings = useCallback(
    () => setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG),
    []
  );

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!configParams) {
    return(
      h('div', { className: 'dashboard-outer-container' },
        h('div', { className: 'dashboard-loading' },
          h('div', { className: 'spinner' }),
          h('p', null, 'Loading dashboard...')
        )
      )
    );
  }

  const backgroundUrl = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_URL];
  const backgroundMode = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE] || 'cover';
  const effectiveBackgroundUrl = backgroundUrl || backgroundSplashUrl(
    'large',
    dateKeyFromDateInput(currentDate || new Date())
  );
  if (backgroundUrl) {
    logIfEnabled('[dashboard] background image URL from settings:', backgroundUrl, 'mode:', backgroundMode);
  }
  const backgroundStyle = effectiveBackgroundUrl ? (() => {
    const isTiling = backgroundMode.startsWith('repeat');
    return {
      backgroundImage: `url(${ effectiveBackgroundUrl })`,
      backgroundSize: isTiling ? 'auto' : backgroundMode,
      backgroundRepeat: isTiling ? backgroundMode : 'no-repeat',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    };
  })() : undefined;

  return h('div', { className: 'dashboard-outer-container', style: backgroundStyle },
    focusState === DASHBOARD_FOCUS.LAYOUT_CONFIG
      ? h(DashboardLayoutPopup, {
          currentLayout: Array.isArray(configParams?.[SETTING_KEYS.DASHBOARD_COMPONENTS]) ? configParams[SETTING_KEYS.DASHBOARD_COMPONENTS] : DEFAULT_DASHBOARD_COMPONENTS,
          onSave: handleLayoutSave,
          onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
        })
      : null,
    focusState === DASHBOARD_FOCUS.SETTINGS_CONFIG
      ? (() => {
          logIfEnabled('[dashboard] rendering DashboardSettingsPopup, bgUrl:', configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_URL]);
          return h(DashboardSettingsPopup, {
            app,
            configParams,
            onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
            onSave: handleSettingsSave,
            pluginNoteUUID,
            timeFormat,
            weekFormat,
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
          const providerEm = configParams?.[SETTING_KEYS.LLM_PROVIDER_MODEL];
          const apiKeyBucket = apiKeyBucketFromLlmProvider(providerEm);
          const providerSettingKey = apiKeyBucket ? apiKeyFromProvider(apiKeyBucket) : null;
          const providerApiKey = providerSettingKey ? (configParams?.[providerSettingKey] || '') : '';
          const providerEmForWidgets = apiKeyBucket || providerEm || null;
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
            providerApiKey,
            providerEm: providerEmForWidgets,
            quarterlyPlans,
            referenceDate: victoryReferenceDate,
            selectedDate,
            timeFormat,
            weekFormat,
            weeklyTotal: weeklyVictoryValue,
          });
        }).filter(Boolean)
      )
    )
  );
}
