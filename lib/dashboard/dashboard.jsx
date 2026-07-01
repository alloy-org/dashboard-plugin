/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Root dashboard component — fetches data and renders widget grid
 * Prompt summary: "main React component that calls init, shows loading/error, and lays out widgets"
 */
import { Component, memo, useEffect, useState, useCallback, useRef, useMemo } from "react";
import PlanningWidget from 'planning';
import AgendaWidget from 'agenda';
import CalendarWidget from 'calendar';
import { apiKeyBucketFromLlmProvider, apiKeyFromProvider, DASHBOARD_FOCUS, DEFAULT_DASHBOARD_COMPONENTS,
  IS_DEV_ENVIRONMENT, SETTING_KEYS, WIDGET_REGISTRY } from 'constants/settings';
import { DashboardLoadContext, useDashboardLoadTracker, useReportWidgetLoaded } from 'dashboard-load-tracking';
import DashboardLayoutPopup from 'dashboard-layout-popup';
import DashboardSettingNote from "dashboard-setting-note";
import DashboardSettingsPopup from 'dashboard-settings-popup';
import DreamTaskWidget from 'dream-task';
import { gridCellFocusProps, useDashboardWidgetFocus } from 'focus-widget';
import GraveyardWidget from 'graveyard';
import LayoutPickerWidget, { saveLayoutWithProfile } from 'layout-picker';
import { useDashboardDrag } from 'draggable-heading';
import DaySketchWidget from 'day-sketch';
import DebugConsoleWidget from 'debug-console';
import useCompletedTasks from 'hooks/use-completed-tasks';
import useDashboardLayout from 'hooks/use-dashboard-layout';
import useDashboardTaskUpdates from 'hooks/use-dashboard-task-updates';
import useDomainTasks from 'hooks/use-domain-tasks';
import useExternalCalendarEvents from 'hooks/use-external-calendar-events';
import MoodWidget from 'mood';
import PeakHoursWidget from 'peak-hours';
import ProposedAgendaWidget from 'proposed-agenda';
import { pluginContext, setPluginData, updatePluginSetting } from "plugin-data";
import QuotesWidget from 'quotes';
import QuickActionsWidget from 'quick-actions';
import RecentNotesWidget from 'recent-notes';
import SharedNotesWidget from 'shared-notes';
import TaskDomains from 'task-domains';
import { backgroundSplashUrl } from 'util/background-splash-images';
import { dateKeyFromDateInput, weekStartDayFromFormat, weekStartFromDateInput } from 'util/date-utility';
import { logIfEnabled, setLoggingEnabled } from "util/log";
import { useWidgetLoadTiming } from "util/widget-timing";
import { WidgetSizeContext } from "widget-wrapper";
import VictoryValueWidget from 'victory-value';
import "styles/dashboard.scss"

function gridCellClassName(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return `grid-cell horizontal-${w}-cell vertical-${h}-cell`;
}

function gridCellContainerProps(config, draggingWidgetId, focusedWidgetId, widgetFocusTransform) {
  const widgetId = config?.widgetId;
  const { classNames: focusClassNames, style } = gridCellFocusProps(focusedWidgetId, widgetFocusTransform, widgetId);
  const className = [
    gridCellClassName(config),
    draggingWidgetId ? 'grid-cell--drag-active' : '',
    draggingWidgetId && draggingWidgetId === widgetId ? 'grid-cell--dragging-ready' : '',
    draggingWidgetId && draggingWidgetId !== widgetId ? 'grid-cell--drag-shift' : '',
    ...focusClassNames,
  ].filter(Boolean).join(' ');
  return {
    className,
    'data-widget-id': widgetId,
    style,
  };
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: add error boundary so one widget crash doesn't take down the dashboard
// Prompt: "wrap each component load in try...catch so failure to render one widget does not disrupt others"
// Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.7-opus] Task: migrate WidgetErrorBoundary.render from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
class WidgetErrorBoundary extends Component {
  static contextType = DashboardLoadContext;
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    logIfEnabled(`[WidgetErrorBoundary] Widget "${ this.props.widgetId }" crashed:`, error, info);
    this.context?.reportError(this.props.widgetId);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="widget-error-fallback">
          <p className="widget-error-fallback-title">{`⚠ ${ this.props.widgetId }`}</p>
          <p className="widget-error-fallback-message">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            className="widget-error-fallback-retry"
            onClick={() => this.setState({ hasError: false, error: null })}
          >Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function WidgetLoadReporter({ widgetId }) {
  useReportWidgetLoaded(widgetId);
  return null;
}

// [Claude claude-4.7-opus] Task: convert createWidgetCell factory to JSX
// Prompt: "translate this project to render components with JSX instead"
function createWidgetCell(widgetId, WidgetComponent, buildWidgetProps) {
  return memo(function DashboardWidgetCell(cellProps) {
    useWidgetLoadTiming(widgetId);
    const { config, draggingWidgetId, focusedWidgetId, widgetFocusTransform } = cellProps;
    const widgetSizeValue = {
      gridHeightSize: Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1,
      gridWidthSize: Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1,
    };
    return (
      <div {...gridCellContainerProps(config, draggingWidgetId, focusedWidgetId, widgetFocusTransform)}>
        <WidgetErrorBoundary widgetId={widgetId}>
          <WidgetSizeContext.Provider value={widgetSizeValue}>
            <WidgetLoadReporter widgetId={widgetId} />
            <WidgetComponent {...buildWidgetProps(cellProps)} />
          </WidgetSizeContext.Provider>
        </WidgetErrorBoundary>
      </div>
    );
  });
}

function pickProps(...keys) {
  return (cellProps) => {
    const result = {};
    for (const key of keys) result[key] = cellProps[key];
    return result;
  };
}

const AgendaCell = createWidgetCell('agenda', AgendaWidget, ({ agendaTasks, app, calendarEvents, calendarEventsLoaded, currentDate, selectedDate, timeFormat }) => ({
  app, calendarEvents: calendarEventsLoaded ? calendarEvents : null, currentDate, selectedDate, tasks: agendaTasks, timeFormat,
}));
const DaySketchCell = createWidgetCell('day-sketch', DaySketchWidget, ({ agendaTasks, app, calendarEvents, calendarEventsLoaded, currentDate, timeFormat }) => ({
  agendaTasks, app, calendarEvents: calendarEventsLoaded ? calendarEvents : null, currentDate, timeFormat,
}));
const CalendarCell = createWidgetCell('calendar', CalendarWidget, ({ app, completedTasksByDate, config, currentDate,
    onDateSelect, onOpenSettings, openTasks, selectedDate, weekFormat }) => ({
  app, completedTasksByDate, currentDate, gridHeightSize: config?.gridHeightSize, gridWidthSize: config?.gridWidthSize,
  onDateSelect, onOpenSettings, openTasks, selectedDate, weekFormat,
}));
const DebugConsoleCell = createWidgetCell('debug-console', DebugConsoleWidget, () => ({}));
const DreamTaskCell = createWidgetCell('dream-task', DreamTaskWidget, ({ app, config, onOpenSettings, providerApiKey, providerEm }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, gridWidthSize: Number(config?.gridWidthSize) || 2,
  onOpenSettings, providerApiKey, providerEm,
}));
const MoodCell = createWidgetCell('mood', MoodWidget, pickProps('app', 'moodRatings', 'onMoodRecorded'));
const PeakHoursCell = createWidgetCell('peak-hours', PeakHoursWidget,
  pickProps('app', 'currentDate', 'selectedDate', 'timeFormat'));
const ProposedAgendaCell = createWidgetCell('proposed-agenda', ProposedAgendaWidget, ({ app, currentDate, providerApiKey, providerEm, taskDomainUUID, timeFormat }) => ({
  app, currentDate, defaultNoteUuid: null, providerApiKey, providerEm, taskDomainUUID, timeFormat,
}));
const PlanningCell = createWidgetCell('planning', PlanningWidget, ({ app, config, quarterlyPlans }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, quarterlyPlans,
}));
const QuickActionsCell = createWidgetCell('quick-actions', QuickActionsWidget, pickProps('app'));
const QuotesCell = createWidgetCell('quotes', QuotesWidget, ({ app, config }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, planContent: null, quotes: null,
}));
const RecentNotesCell = createWidgetCell('recent-notes', RecentNotesWidget, ({ app, config, taskDomainUUID }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, taskDomainUUID,
}));
const SharedNotesCell = createWidgetCell('shared-notes', SharedNotesWidget, ({ app, config, taskDomainUUID }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, taskDomainUUID,
}));
const GraveyardCell = createWidgetCell('graveyard', GraveyardWidget, ({ app, config, taskDomainUUID }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, gridWidthSize: Number(config?.gridWidthSize) || 2, taskDomainUUID,
}));
const VictoryValueCell = createWidgetCell('victory-value', VictoryValueWidget,
  pickProps('app', 'completedTasksByDate', 'dailyValues', 'moodRatings', 'onReferenceDateChange', 'referenceDate',
    'weekFormat', 'weeklyTotal'));
const LayoutPickerCell = createWidgetCell('layout-picker', LayoutPickerWidget,
  pickProps('app', 'currentLayout', 'onLayoutApply', 'onSelectedProfileChange'));

const CELL_COMPONENTS = {
  agenda: AgendaCell,
  calendar: CalendarCell,
  'day-sketch': DaySketchCell,
  'debug-console': DebugConsoleCell,
  'dream-task': DreamTaskCell,
  graveyard: GraveyardCell,
  'layout-picker': LayoutPickerCell,
  mood: MoodCell,
  'peak-hours': PeakHoursCell,
  planning: PlanningCell,
  'proposed-agenda': ProposedAgendaCell,
  'quick-actions': QuickActionsCell,
  quotes: QuotesCell,
  'recent-notes': RecentNotesCell,
  'shared-notes': SharedNotesCell,
  'victory-value': VictoryValueCell,
};

// ------------------------------------------------------------------------------------------
// @desc Push the plugin's initial payload into the dashboard's React state, hydrating every
//   widget and flagging the data as freshly loaded
// @param {Object} initialPayload - The init data resolved from the plugin, with properties:
//   - {Object} settings - Plugin settings keyed by SETTING_KEYS (drives logging + config params)
//   - {Array} tasks - Domain tasks consumed by initializeDomainTasks
//   - {Array} moodRatings - Mood rating entries for the week
//   - {Array} quarterlyPlans - Quarterly planning entries
//   - {Array} dailyVictoryValues - Per-day victory values
//   - {number} weeklyVictoryValue - Aggregate victory value for the week
//   - {string} currentDate - The reference "today" for the dashboard
//   - {string} [pluginNoteUUID] - UUID of the plugin's backing note, when available
// @param {Object} setters - React state setters and refs used to apply the payload
// [Claude claude-opus-4-8] Task: document and rename the applyDashboardData payload parameter
function applyDashboardData(initialPayload, { initDataFreshRef, initializeDomainTasks, setConfigParams,
    setCurrentDate, setDailyVictoryValues, setMoodRatings, setPluginNoteUUID,
    setQuarterlyPlans, setWeeklyVictoryValue }) {
  setLoggingEnabled(initialPayload.settings?.[SETTING_KEYS.CONSOLE_LOGGING]);
  logIfEnabled(`[dashboard] applyDashboardData — tasks:${ initialPayload.tasks?.length ?? 0 } moodRatings: ${ initialPayload.moodRatings?.length ?? 0 }`);
  // [Claude claude-opus-4-8] Task: surface captured device width metrics to the on-device DebugConsole
  if (window.__dashboardViewportDiag) logIfEnabled(`[viewport] ${ JSON.stringify(window.__dashboardViewportDiag) }`);
  initializeDomainTasks(initialPayload);
  setMoodRatings(initialPayload.moodRatings);
  setQuarterlyPlans(initialPayload.quarterlyPlans);
  setConfigParams(initialPayload.settings);
  setDailyVictoryValues(initialPayload.dailyVictoryValues);
  setWeeklyVictoryValue(initialPayload.weeklyVictoryValue);
  setCurrentDate(initialPayload.currentDate);
  if (initialPayload.pluginNoteUUID) setPluginNoteUUID(initialPayload.pluginNoteUUID);
  initDataFreshRef.current = true;
}

function isCurrentWeekEarlyForWeekStart(weekStartDay) {
  const now = new Date();
  const weekStart = weekStartFromDateInput(now, weekStartDay);
  return now.getTime() - weekStart.getTime() < 3 * 24 * 60 * 60 * 1000;
}

function mergeMoodRatingsByIdentity(currentRatings, fetchedRatings) {
  const ratingsByKey = new Map();
  for (const rating of [...(currentRatings || []), ...(fetchedRatings || [])]) {
    if (!rating || rating.timestamp == null) continue;
    const key = rating.uuid || `${rating.timestamp}:${rating.rating}:${rating.note || ''}`;
    ratingsByKey.set(key, rating);
  }
  return Array.from(ratingsByKey.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

async function fetchMoodRatingsForDate(app, referenceDate, setMoodRatings, weekStartDay) {
  let weekStart = weekStartFromDateInput(referenceDate, weekStartDay);
  if (isCurrentWeekEarlyForWeekStart(weekStartDay)) {
    weekStart = new Date(weekStart);
    weekStart.setDate(weekStart.getDate() - 7);
  }
  const fromUnixSeconds = Math.floor(weekStart.getTime() / 1000);
  try {
    const ratings = await app.getMoodRatings(fromUnixSeconds);
    if (Array.isArray(ratings)) {
      setMoodRatings(currentRatings => mergeMoodRatingsByIdentity(currentRatings, ratings));
    }
  } catch (err) {
    logIfEnabled('fetchMoodRatings: failed to load mood ratings', err);
  }
}

function applyDomainChange(onDomainChange, setDailyVictoryValues, setWeeklyVictoryValue, newDomains, newActiveDomain, taskData) {
  onDomainChange(newDomains, newActiveDomain, taskData);
  if (taskData) {
    setDailyVictoryValues(taskData.dailyVictoryValues);
    setWeeklyVictoryValue(taskData.weeklyVictoryValue);
  }
}

async function saveLayout(app, currentConfigParams, setConfigParams, newRenderedWidgetIds, isReset = false,
    sizing = null) {
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
  updatePluginSetting(SETTING_KEYS.DASHBOARD_COMPONENTS, newLayout);
  setConfigParams(prev => ({ ...prev, [SETTING_KEYS.DASHBOARD_COMPONENTS]: newLayout }));
}

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
  updatePluginSetting(SETTING_KEYS.LLM_PROVIDER_MODEL, llmProvider);
  if (providerSettingKey) updatePluginSetting(providerSettingKey, apiKey);
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

function appendMoodRating(setMoodRatings, newRating) {
  setMoodRatings(prev => [...(prev || []), newRating]);
}

// ------------------------------------------------------------------------------------------
// @description Root dashboard component. Manages shared state and renders the widget grid.
// [Claude claude-4.7-opus] Task: migrate DashboardApp from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DashboardApp({ app, initPromise }) {
  const { activeTaskDomain, buildAgendaTasksByDate, initializeDomainTasks,
    onDomainChange, openTasks, taskDomains } = useDomainTasks();
  const { completedTasksByDate, fetchCompletedTasks } = useCompletedTasks(app);

  const { calendarEvents, calendarEventsLoaded } = useExternalCalendarEvents(app, activeTaskDomain);
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
  const weekStartDay = weekStartDayFromFormat(weekFormat);

  useEffect(() => {
    const t0 = Date.now();
    logIfEnabled('[dashboard] awaiting init data');
    initPromise.then(async (data) => {
      logIfEnabled(`[dashboard] init data received in ${Date.now() - t0}ms`);
      if (data?.error) {
        setError(data.error);
      } else {
        setPluginData(data);
        applyDashboardData(data, {
          initDataFreshRef, initializeDomainTasks, setConfigParams,
          setCurrentDate, setDailyVictoryValues, setMoodRatings, setPluginNoteUUID,
          setQuarterlyPlans, setWeeklyVictoryValue });
        dashboardSettingNoteRef.current = new DashboardSettingNote(app);
        const t1 = Date.now();
        logIfEnabled('[dashboard] loading DashboardSettingNote');
        const { timeFormat: loadedTime, weekFormat: loadedWeek } = await dashboardSettingNoteRef.current.load();
        logIfEnabled(`[dashboard] DashboardSettingNote loaded in ${Date.now() - t1}ms`);
        if (loadedTime) setTimeFormat(loadedTime);
        if (loadedWeek) setWeekFormat(loadedWeek);
      }
    }).catch(err => setError(err.message));
  }, []);

  const victoryReferenceDate = useMemo(() => {
    if (selectedDate) return selectedDate;
    if (!currentDate) return null;
    if (isCurrentWeekEarlyForWeekStart(weekStartDay)) {
      const weekStart = weekStartFromDateInput(currentDate, weekStartDay);
      const prevWeekDay = new Date(weekStart);
      prevWeekDay.setDate(prevWeekDay.getDate() - 1);
      return dateKeyFromDateInput(prevWeekDay);
    }
    return currentDate;
  }, [currentDate, selectedDate, weekStartDay]);

  const fetchMoodRatings = useCallback(
    (referenceDate) => fetchMoodRatingsForDate(app, referenceDate, setMoodRatings, weekStartDay),
    [app, weekStartDay]
  );

  useEffect(() => {
    const referenceDate = selectedDate || currentDate;
    if (!referenceDate) return;
    if (initDataFreshRef.current) {
      initDataFreshRef.current = false;
    } else {
      fetchMoodRatings(referenceDate);
    }
    // activeTaskDomain may be null here; getCompletedTasks is not domain-scoped, so an All-Notes dashboard
    // still populates victory-value metrics rather than gating the fetch behind a selected domain.
    fetchCompletedTasks(referenceDate, activeTaskDomain);
    if (victoryReferenceDate && victoryReferenceDate !== referenceDate) {
      fetchCompletedTasks(victoryReferenceDate, activeTaskDomain);
    }
  }, [activeTaskDomain, currentDate, fetchCompletedTasks, fetchMoodRatings, selectedDate, victoryReferenceDate]);

  const handleDomainChange = useCallback(
    (newDomains, newActiveDomain, taskData) =>
      applyDomainChange(onDomainChange, setDailyVictoryValues, setWeeklyVictoryValue,
        newDomains, newActiveDomain, taskData),
    [onDomainChange]
  );

  const handleLayoutPersist = useCallback(
    (newRenderedWidgetIds, isReset = false, sizing = null) =>
      saveLayout(app, configParams, setConfigParams, newRenderedWidgetIds, isReset, sizing),
    [app, configParams]
  );

  const handleSelectedProfileChange = useCallback(
    (profileId) => setConfigParams(prev => ({ ...prev, [SETTING_KEYS.SELECTED_LAYOUT_PROFILE]: profileId })),
    []
  );

  const handleLayoutSave = useCallback(
    async (newRenderedWidgetIds, isReset = false, sizing = null, profileId = undefined) => {
      await saveLayoutWithProfile({ app, isReset, onLayoutPersist: handleLayoutPersist, onSelectedProfileChange: handleSelectedProfileChange, profileId, sizing, widgetIds: newRenderedWidgetIds });
      setFocusState(DASHBOARD_FOCUS.DEFAULT);
    },
    [app, handleLayoutPersist, handleSelectedProfileChange]
  );

  const handleSettingsSave = useCallback(
    (params) => saveSettings(app, dashboardSettingNoteRef, setConfigParams, setFocusState, setTimeFormat, setWeekFormat, params),
    [app]
  );

  const handleMoodRecorded = useCallback(
    (newRating) => appendMoodRating(setMoodRatings, newRating),
    []
  );

  useDashboardTaskUpdates({ activeTaskDomain, app, onDomainChange, openTasks });

  const agendaTasks = useMemo(
    () => currentDate ? buildAgendaTasksByDate(currentDate) : {},
    [buildAgendaTasksByDate, currentDate]
  );

  const { activeComponents } = useDashboardLayout({ configParams });

  const { draggingWidgetId, displayedComponents } = useDashboardDrag(activeComponents, handleLayoutPersist);
  const { clearFocusedWidget, focusedWidgetId, isWidgetFocusMode, widgetFocusTransforms } =
    useDashboardWidgetFocus(draggingWidgetId, focusState);
  const onOpenDreamTaskSettings = useCallback(
    () => setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG),
    []
  );

  // Ids of the widget cells actually rendered this pass (unknown widgetIds render nothing and so
  // never settle); the tracker fires one aggregate Plausible event once all of these have settled.
  const renderedWidgetIds = displayedComponents
    .map((config, index) => config?.widgetId || DEFAULT_DASHBOARD_COMPONENTS[index]?.widgetId)
    .filter(id => CELL_COMPONENTS[id]);
  const loadTracker = useDashboardLoadTracker(renderedWidgetIds);

  if (error) {
    return (
      <div className="dashboard-error">
        <h2>Dashboard Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!configParams) {
    return (
      <div className="dashboard-outer-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const backgroundUrl = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_URL];
  const backgroundMode = configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_MODE] || 'cover';
  const effectiveBackgroundUrl = backgroundUrl || backgroundSplashUrl('large', dateKeyFromDateInput(currentDate || new Date()));
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

  const debugConsoleEnabled = String(configParams[SETTING_KEYS.DEBUG_CONSOLE] || '').trim() === 'true' || IS_DEV_ENVIRONMENT || pluginContext().pluginUUID === "6da03574-0f4b-11f1-ba9e-11ba9c716f59";
  if (debugConsoleEnabled) {
    logIfEnabled(`[dashboard] Debug console enabled (configParams ${ configParams[SETTING_KEYS.DEBUG_CONSOLE] } app setting keys ${ Object.keys(app.settings) }, ${ pluginContext().pluginUUID }), including in layout popup`);
  } else {
    logIfEnabled(`[dashboard] Debug console disabled (${ SETTING_KEYS.DEBUG_CONSOLE } is '${ configParams?.[SETTING_KEYS.DEBUG_CONSOLE] }', pluginUUID ${ pluginContext().pluginUUID }, context ${ JSON.stringify(pluginContext()) }), excluding from layout popup`);
  }
  const layoutPopupExcludeWidgetIds = debugConsoleEnabled ? [] : ['debug-console'];

  const currentLayoutArray = Array.isArray(configParams?.[SETTING_KEYS.DASHBOARD_COMPONENTS])
    ? configParams[SETTING_KEYS.DASHBOARD_COMPONENTS]
    : DEFAULT_DASHBOARD_COMPONENTS;

  return (
    <div className="dashboard-outer-container" style={backgroundStyle}>
      {focusState === DASHBOARD_FOCUS.LAYOUT_CONFIG ? (
        <DashboardLayoutPopup
          currentLayout={currentLayoutArray}
          excludeWidgetIds={layoutPopupExcludeWidgetIds}
          onSave={handleLayoutSave}
          onCancel={() => setFocusState(DASHBOARD_FOCUS.DEFAULT)}
          selectedLayoutProfile={configParams?.[SETTING_KEYS.SELECTED_LAYOUT_PROFILE] || null}
        />
      ) : null}
      {focusState === DASHBOARD_FOCUS.SETTINGS_CONFIG ? (() => {
        logIfEnabled('[dashboard] rendering DashboardSettingsPopup, bgUrl:', configParams?.[SETTING_KEYS.BACKGROUND_IMAGE_URL]);
        return (
          <DashboardSettingsPopup
            app={app}
            configParams={configParams}
            onCancel={() => setFocusState(DASHBOARD_FOCUS.DEFAULT)}
            onSave={handleSettingsSave}
            pluginNoteUUID={pluginNoteUUID}
            timeFormat={timeFormat}
            weekFormat={weekFormat}
          />
        );
      })() : null}
      <div className="dashboard-content">
        <div className="dashboard-toolbar">
          <TaskDomains
            activeTaskDomain={activeTaskDomain}
            app={app}
            domains={taskDomains}
            onDomainChange={handleDomainChange}
          />
          <div className="dashboard-toolbar-actions">
            <button
              className="dashboard-configure-button"
              type="button"
              onClick={() => { logIfEnabled('[dashboard] opening Settings popup'); setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG); }}
              title="Configure LLM provider and API key for AI-powered features"
            >⚙️ Settings</button>
            <button
              className="dashboard-configure-button"
              type="button"
              onClick={() => setFocusState(DASHBOARD_FOCUS.LAYOUT_CONFIG)}
              title="Configure which widgets are shown and in what order"
            >☰ Layout</button>
          </div>
        </div>
        <div className={`dashboard-grid-shell${isWidgetFocusMode ? ' dashboard-grid-shell--focused' : ''}`}>
          {isWidgetFocusMode ? (
            <button
              className="dashboard-grid-focus-backdrop"
              type="button"
              title="Return all widgets to the dashboard grid"
              aria-label="Return all widgets to the dashboard grid"
              onClick={clearFocusedWidget}
            />
          ) : null}
          <DashboardLoadContext.Provider value={loadTracker}>
          <div
            className={`dashboard-grid${draggingWidgetId ? ' dashboard-grid--dragging' : ''}${isWidgetFocusMode ? ' dashboard-grid--focused' : ''}`}
          >
            {displayedComponents.map((config, index) => {
              const widgetId = config?.widgetId || DEFAULT_DASHBOARD_COMPONENTS[index]?.widgetId;
              const CellComponent = CELL_COMPONENTS[widgetId];
              if (!CellComponent) return null;
              const providerEm = configParams?.[SETTING_KEYS.LLM_PROVIDER_MODEL];
              const apiKeyBucket = apiKeyBucketFromLlmProvider(providerEm);
              const providerSettingKey = apiKeyBucket ? apiKeyFromProvider(apiKeyBucket) : null;
              const providerApiKey = providerSettingKey ? (configParams?.[providerSettingKey] || '') : '';
              const providerEmForWidgets = apiKeyBucket || providerEm || null;
              return (
                <CellComponent
                  key={widgetId}
                  agendaTasks={agendaTasks}
                  app={app}
                  calendarEvents={calendarEvents}
                  calendarEventsLoaded={calendarEventsLoaded}
                  completedTasksByDate={completedTasksByDate}
                  config={config}
                  currentDate={currentDate}
                  dailyValues={dailyVictoryValues}
                  draggingWidgetId={draggingWidgetId}
                  focusedWidgetId={focusedWidgetId}
                  moodRatings={moodRatings}
                  onDateSelect={setSelectedDate}
                  currentLayout={currentLayoutArray}
                  onLayoutApply={handleLayoutPersist}
                  onSelectedProfileChange={handleSelectedProfileChange}
                  onMoodRecorded={handleMoodRecorded}
                  onOpenSettings={onOpenDreamTaskSettings}
                  onReferenceDateChange={setSelectedDate}
                  openTasks={openTasks}
                  providerApiKey={providerApiKey}
                  providerEm={providerEmForWidgets}
                  quarterlyPlans={quarterlyPlans}
                  referenceDate={victoryReferenceDate}
                  selectedDate={selectedDate}
                  taskDomainUUID={activeTaskDomain}
                  timeFormat={timeFormat}
                  weekFormat={weekFormat}
                  weeklyTotal={weeklyVictoryValue}
                  widgetFocusTransform={widgetFocusTransforms[widgetId] || null}
                />
              );
            }).filter(Boolean)}
          </div>
          </DashboardLoadContext.Provider>
        </div>
      </div>
    </div>
  );
}
