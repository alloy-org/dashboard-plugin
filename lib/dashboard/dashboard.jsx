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
  IS_DEV_ENVIRONMENT, SETTING_KEYS } from 'constants/settings';
import { reportPriorCrashIfAny, stampBreadcrumbSettled, writeRenderBreadcrumb } from "crash-breadcrumb";
import { DashboardLoadContext, useDashboardLoadTracker, useReportWidgetLoaded, useWidgetLoadedEvent } from 'dashboard-load-tracking';
import DashboardLayoutPopup from 'dashboard-layout-popup';
import DashboardSettingNote from "dashboard-setting-note";
import DashboardSettingsPopup from 'dashboard-settings-popup';
import DaySketchWidget from 'day-sketch';
import DebugConsoleWidget from 'debug-console';
import { useDashboardDrag } from 'draggable-heading';
import DreamTaskWidget from 'dream-task';
import EnergyPerHabitWidget from 'energy-per-habit';
import { gridCellFocusProps, useDashboardWidgetFocus, widgetConfigForFocus } from 'focus-widget';
import GraveyardWidget from 'graveyard';
import useBackgroundSwap, { BACKGROUND_FADE_ANIMATION_NAME, BACKGROUND_FADE_DURATION_MS } from 'hooks/use-background-swap';
import useCompletedTasks from 'hooks/use-completed-tasks';
import useDashboardLayout from 'hooks/use-dashboard-layout';
import useDashboardTaskUpdates from 'hooks/use-dashboard-task-updates';
import useDomainTasks from 'hooks/use-domain-tasks';
import useExternalCalendarEvents from 'hooks/use-external-calendar-events';
import LayoutPickerWidget, { saveLayoutWithProfile } from 'layout-picker';
import { WIDGET_REGISTRY } from 'layout-profiles';
import LazyWidgetMount from "lazy-widget-mount";
import MoodWidget from 'mood';
import NotePeekWidget from 'note-peek';
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
import WidgetMemoryMeasurementPopup from "widget-memory-measurement-popup";
import VictoryValueWidget from 'victory-value';
import { deviceProfile as readDeviceProfile, isMemoryConstrainedDevice } from "util/device-profile";
import { logMemorySample, startMemorySampling } from "util/memory-instrumentation";

import "styles/dashboard.scss"

// ------------------------------------------------------------------------------------------
// @desc Build the inline background properties for one background layer. Shared by the dashboard's
//   base background and by the overlay that cross-fades in a swapped background, so both layers crop,
//   tile, and anchor identically and the fade reads as one image dissolving into another.
// @param {string} url - Image URL to paint; an empty value means this layer paints nothing
// @param {string} backgroundMode - A BACKGROUND_MODE_OPTIONS value: 'cover', 'contain', or a 'repeat*' variant
// @returns {Object|undefined} React style object for the layer, or undefined when there is no image
function backgroundLayerStyle(url, backgroundMode) {
  if (!url) return undefined;
  const isTiling = backgroundMode.startsWith('repeat');

  return { backgroundAttachment: 'fixed', backgroundImage: `url(${ url })`, backgroundPosition: 'center',
    backgroundRepeat: isTiling ? backgroundMode : 'no-repeat', backgroundSize: isTiling ? 'auto' : backgroundMode };
}

// ----------------------------------------------------------------------------------------------
function gridCellClassName(config) {
  const w = Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1;
  const h = Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1;
  return `grid-cell horizontal-${w}-cell vertical-${h}-cell`;
}

// ----------------------------------------------------------------------------------------------
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

function WidgetLoadedEventReporter({ hasError = false, isReady, widgetId }) {
  useWidgetLoadedEvent(widgetId, isReady, hasError);
  return null;
}

// ------------------------------------------------------------------------------------------
// @desc Create a standard dashboard cell around one widget. Production grid cells defer work via
//   LazyWidgetMount, while the memory-measurement panel can opt into an immediate mount so its heap
//   sample includes the selected widget without a viewport-triggered delay.
// @param {string} widgetId - Stable registry id for the widget.
// @param {React.ComponentType} WidgetComponent - Concrete component rendered by the cell.
// @param {function(Object): Object} buildWidgetProps - Selects widget-specific props from cell props.
function createWidgetCell(widgetId, WidgetComponent, buildWidgetProps) {
  return memo(function DashboardWidgetCell(cellProps) {
    useWidgetLoadTiming(widgetId);
    const { config, draggingWidgetId, focusedWidgetId, focusedWidgetSurfaceStyle, layoutConfig, loadedEventError,
      loadedEventReady, mountImmediately, widgetFocusTransform } = cellProps;
    const widgetSizeValue = {
      gridHeightSize: Number(config?.gridHeightSize) > 0 ? Number(config.gridHeightSize) : 1,
      gridWidthSize: Number(config?.gridWidthSize) > 0 ? Number(config.gridWidthSize) : 1,
    };
    const containerProps = gridCellContainerProps(layoutConfig || config, draggingWidgetId, focusedWidgetId, widgetFocusTransform);
    if (focusedWidgetSurfaceStyle) containerProps.className += ' grid-cell--focus-overlay-host';
    const surfaceClassName = focusedWidgetSurfaceStyle ? 'grid-cell-surface grid-cell-surface--focused' : 'grid-cell-surface';
    const widgetContents = (
      <>
        <WidgetLoadReporter widgetId={widgetId} />
        {loadedEventReady !== undefined || loadedEventError
          ? <WidgetLoadedEventReporter hasError={!!loadedEventError} isReady={!!loadedEventReady} widgetId={widgetId} />
          : null}
        <WidgetComponent {...buildWidgetProps(cellProps)} />
      </>
    );
    return (
      <div {...containerProps}>
        <div className={surfaceClassName} style={focusedWidgetSurfaceStyle || undefined}>
          <WidgetErrorBoundary widgetId={widgetId}>
            <WidgetSizeContext.Provider value={widgetSizeValue}>
              {mountImmediately ? widgetContents : <LazyWidgetMount widgetId={widgetId}>{widgetContents}</LazyWidgetMount>}
            </WidgetSizeContext.Provider>
          </WidgetErrorBoundary>
        </div>
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
const EnergyPerHabitCell = createWidgetCell('energy-per-habit', EnergyPerHabitWidget, pickProps('app'));
const DreamTaskCell = createWidgetCell('dream-task', DreamTaskWidget, ({ app, config, onOpenSettings, providerApiKey, providerEm }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, gridWidthSize: Number(config?.gridWidthSize) || 2,
  onOpenSettings, providerApiKey, providerEm,
}));
const MoodCell = createWidgetCell('mood', MoodWidget, pickProps('app', 'moodRatings', 'onMoodRecorded'));
const NotePeekCell = createWidgetCell('note-peek', NotePeekWidget, pickProps('app'));
const PeakHoursCell = createWidgetCell('peak-hours', PeakHoursWidget,
  pickProps('app', 'currentDate', 'selectedDate', 'timeFormat'));
const ProposedAgendaCell = createWidgetCell('proposed-agenda', ProposedAgendaWidget, ({ app, calendarEvents,
    calendarEventsLoaded, currentDate, providerApiKey, providerEm, taskDomainUUID, timeFormat }) => ({
  app, calendarEvents: calendarEventsLoaded ? calendarEvents : null, currentDate, defaultNoteUuid: null,
  providerApiKey, providerEm, taskDomainUUID, timeFormat,
}));
const PlanningCell = createWidgetCell('planning', PlanningWidget, ({ app, config, quarterlyPlans }) => ({
  app, gridHeightSize: Number(config?.gridHeightSize) || 1, quarterlyPlans,
}));
const QuickActionsCell = createWidgetCell('quick-actions', QuickActionsWidget, pickProps('app', 'onSwapBackground'));
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
  'energy-per-habit': EnergyPerHabitCell,
  graveyard: GraveyardCell,
  'layout-picker': LayoutPickerCell,
  mood: MoodCell,
  'note-peek': NotePeekCell,
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
// @desc Resolve the widget ids the dashboard is about to render, from the persisted layout in the
//   init settings snapshot, filtered to widgets that have a real cell component. Used to fingerprint
//   the render in the crash breadcrumb before React mounts the (heavy) widget grid. Mirrors the
//   filtering the render loop applies to displayedComponents.
// @param {Object} settingsSnapshot - The settings map from the init payload.
// @returns {string[]} Ordered widget ids that will be rendered.
// [Claude claude-opus-4-8 (1M context)] Task: fingerprint the intended render for crash breadcrumbs
function intendedWidgetIds(settingsSnapshot) {
  const rawLayout = settingsSnapshot?.[SETTING_KEYS.DASHBOARD_COMPONENTS];
  let layout = rawLayout;
  if (typeof rawLayout === 'string') {
    try { layout = JSON.parse(rawLayout); } catch { layout = null; }
  }
  if (!Array.isArray(layout)) layout = DEFAULT_DASHBOARD_COMPONENTS;
  return layout.map(entry => entry?.widgetId).filter(widgetId => CELL_COMPONENTS[widgetId]);
}

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

// ------------------------------------------------------------------------------------------
function isCurrentWeekEarlyForWeekStart(weekStartDay) {
  const now = new Date();
  const weekStart = weekStartFromDateInput(now, weekStartDay);
  return now.getTime() - weekStart.getTime() < 3 * 24 * 60 * 60 * 1000;
}

// ------------------------------------------------------------------------------------------
function mergeMoodRatingsByIdentity(currentRatings, fetchedRatings) {
  const ratingsByKey = new Map();
  for (const rating of [...(currentRatings || []), ...(fetchedRatings || [])]) {
    if (!rating || rating.timestamp == null) continue;
    const key = rating.uuid || `${rating.timestamp}:${rating.rating}:${rating.note || ''}`;
    ratingsByKey.set(key, rating);
  }
  return Array.from(ratingsByKey.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

// ------------------------------------------------------------------------------------------
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

// ------------------------------------------------------------------------------------------
function applyDomainChange(onDomainChange, setDailyVictoryValues, setQuarterlyPlans, setWeeklyVictoryValue, newDomains,
    newActiveDomain, taskData) {
  onDomainChange(newDomains, newActiveDomain, taskData);
  if (taskData) {
    setDailyVictoryValues(taskData.dailyVictoryValues);
    setWeeklyVictoryValue(taskData.weeklyVictoryValue);
    if (taskData.quarterlyPlans) setQuarterlyPlans(taskData.quarterlyPlans);
  }
}

// ------------------------------------------------------------------------------------------
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

// ------------------------------------------------------------------------------------------
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
export default function DashboardApp({ app, initPromise }) {
  const { activeTaskDomain, buildAgendaTasksByDate, initializeDomainTasks,
    onDomainChange, openTasks, taskDomains } = useDomainTasks();
  const { completedTasksByDate, completedTasksLoaded, fetchCompletedTasks } = useCompletedTasks(app);

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
  // Crash-breadcrumb session state: a stable device profile + start time for this dashboard load,
  // the pending breadcrumb write promise (so the settle-stamp can be chained after it, avoiding a
  // last-write-wins race), and a flag so we stamp at most once.
  const deviceProfileRef = useRef(null);
  if (deviceProfileRef.current === null) deviceProfileRef.current = readDeviceProfile();
  const breadcrumbStartedAtRef = useRef(Date.now());
  const breadcrumbWriteRef = useRef(null);
  const breadcrumbStampedRef = useRef(false);
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
        // Instrumentation: surface a prior OOM crash (if the last session never settled), record a
        // baseline heap sample, and — on memory-constrained devices only — persist a render
        // breadcrumb BEFORE the heavy widget grid mounts so a crash this session is detectable next
        // launch. The write promise is retained so the settle-stamp can be chained after it.
        reportPriorCrashIfAny(data.settings);
        logMemorySample('init');
        if (isMemoryConstrainedDevice()) {
          breadcrumbWriteRef.current = writeRenderBreadcrumb(app, { deviceProfile: deviceProfileRef.current,
            startedAt: breadcrumbStartedAtRef.current, widgetIds: intendedWidgetIds(data.settings) });
        }
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

  // Periodic heap sampling, active only when console logging is enabled (the DebugConsole is the
  // surface for the samples). startMemorySampling no-ops on runtimes without performance.memory
  // (e.g. iOS WKWebView), so this never spins uselessly there.
  useEffect(() => {
    const loggingEnabled = ['true', 'yes', '1', 'on', 'enabled'].includes(
      String(configParams?.[SETTING_KEYS.CONSOLE_LOGGING] || '').trim().toLowerCase());
    if (!loggingEnabled) return undefined;
    return startMemorySampling();
  }, [configParams]);

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
      applyDomainChange(onDomainChange, setDailyVictoryValues, setQuarterlyPlans, setWeeklyVictoryValue,
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

  // ------------------------------------------------------------------------------------------
  // @desc Once the dashboard reaches a clean settle, stamp the crash breadcrumb as settled so the
  //   next launch does not misread this session as an out-of-memory crash. Reaching settle at all
  //   means the render survived (even if an individual widget's error boundary tripped), so we stamp
  //   regardless of per-widget errors. Chained after the pending write to avoid a last-write-wins
  //   race, and guarded to run at most once.
  const handleDashboardSettled = useCallback(() => {
    if (breadcrumbStampedRef.current || !breadcrumbWriteRef.current) return;
    breadcrumbStampedRef.current = true;
    logMemorySample('load-settle');
    breadcrumbWriteRef.current.then(written => {
      if (!written) return;
      stampBreadcrumbSettled(app, { deviceProfile: deviceProfileRef.current, settledAt: Date.now(),
        startedAt: breadcrumbStartedAtRef.current, widgetIds: written.widgetIds });
    });
  }, [app]);

  useDashboardTaskUpdates({ activeTaskDomain, app, onDomainChange, openTasks });

  const agendaTasks = useMemo(
    () => currentDate ? buildAgendaTasksByDate(currentDate) : {},
    [buildAgendaTasksByDate, currentDate]
  );

  const { activeComponents } = useDashboardLayout({ configParams });

  const { draggingWidgetId, displayedComponents } = useDashboardDrag(activeComponents, handleLayoutPersist);
  const { clearFocusedWidget, expandedWidgetId, focusedWidgetId, focusedWidgetSurfaceStyle, isWidgetFocusMode,
    widgetFocusTransforms } = useDashboardWidgetFocus(draggingWidgetId, focusState);
  const { incomingBackgroundUrl, swapBackground, swappedBackgroundUrl } = useBackgroundSwap();
  const onOpenDreamTaskSettings = useCallback(
    () => setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG),
    []
  );

  // ------------------------------------------------------------------------------------------
  // @desc Resolve parent-fed widget readiness for the one-shot widget-loaded CustomEvent. Widgets
  //   with their own async loaders report from inside the widget instead, so this returns undefined.
  // @param {string} widgetId - Dashboard widget id.
  // @returns {boolean|undefined} Readiness for parent-fed/sync widgets, or undefined for self-reporters.
  const loadedEventReadyFromWidgetId = (widgetId) => {
    switch (widgetId) {
      case 'agenda': return calendarEventsLoaded;
      case 'calendar': return completedTasksLoaded;
      case 'debug-console': return true;
      case 'layout-picker': return true;
      case 'mood': return moodRatings !== null;
      case 'quick-actions': return true;
      case 'quotes': return true;
      case 'victory-value': return completedTasksLoaded && dailyVictoryValues !== null && moodRatings !== null;
      default: return undefined;
    }
  };

  // ------------------------------------------------------------------------------------------
  // @desc Render one selected widget with the same providers, shared data, and default grid size
  //   it receives in the dashboard. The measurement popup passes mountImmediately through the cell
  //   factory so LazyWidgetMount cannot postpone the measured work.
  // @param {string} widgetId - Id of the registry widget chosen by the administrator.
  // @returns {React.ReactNode|null} The immediately mounted cell, or null for an unknown id.
  const renderMemoryMeasurementWidget = (widgetId) => {
    const CellComponent = CELL_COMPONENTS[widgetId];
    const registryEntry = WIDGET_REGISTRY.find(widget => widget.widgetId === widgetId);
    if (!CellComponent || !registryEntry) return null;
    const providerEm = configParams?.[SETTING_KEYS.LLM_PROVIDER_MODEL];
    const apiKeyBucket = apiKeyBucketFromLlmProvider(providerEm);
    const providerSettingKey = apiKeyBucket ? apiKeyFromProvider(apiKeyBucket) : null;
    const providerApiKey = providerSettingKey ? (configParams?.[providerSettingKey] || '') : '';
    const providerEmForWidgets = apiKeyBucket || providerEm || null;
    const config = { gridHeightSize: 1, gridWidthSize: registryEntry.defaultGridWidthSize || 1, settings: {}, widgetId };
    return (
      <CellComponent
        agendaTasks={agendaTasks}
        app={app}
        calendarEvents={calendarEvents}
        calendarEventsLoaded={calendarEventsLoaded}
        completedTasksByDate={completedTasksByDate}
        config={config}
        currentDate={currentDate}
        currentLayout={currentLayoutArray}
        dailyValues={dailyVictoryValues}
        loadedEventReady={loadedEventReadyFromWidgetId(widgetId)}
        mountImmediately
        moodRatings={moodRatings}
        onDateSelect={setSelectedDate}
        onLayoutApply={handleLayoutPersist}
        onMoodRecorded={handleMoodRecorded}
        onOpenSettings={onOpenDreamTaskSettings}
        onReferenceDateChange={setSelectedDate}
        onSelectedProfileChange={handleSelectedProfileChange}
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
      />
    );
  };

  // Ids of the widget cells actually rendered this pass (unknown widgetIds render nothing and so
  // never settle); the tracker fires one aggregate Plausible event once all of these have settled.
  const renderedWidgetIds = displayedComponents
    .map((config, index) => config?.widgetId || DEFAULT_DASHBOARD_COMPONENTS[index]?.widgetId)
    .filter(id => CELL_COMPONENTS[id]);
  const loadTracker = useDashboardLoadTracker(renderedWidgetIds, { onSettle: handleDashboardSettled });

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
  const configuredBackgroundUrl = backgroundUrl || backgroundSplashUrl('large', dateKeyFromDateInput(currentDate || new Date()));
  if (backgroundUrl) {
    logIfEnabled('[dashboard] background image URL from settings:', backgroundUrl, 'mode:', backgroundMode);
  }
  // A swapped background wins for the rest of the session; it is never persisted, so reloading the dashboard returns to the configured (or date-seeded) image.
  const backgroundStyle = backgroundLayerStyle(swappedBackgroundUrl || configuredBackgroundUrl, backgroundMode);
  // The animation shorthand is inline so the fade length has exactly one definition (the hook's BACKGROUND_FADE_DURATION_MS), which the commit timer reuses; only the keyframes live in SCSS.
  const backgroundFadeStyle = incomingBackgroundUrl
    ? { ...backgroundLayerStyle(incomingBackgroundUrl, backgroundMode),
        animation: `${ BACKGROUND_FADE_ANIMATION_NAME } ${ BACKGROUND_FADE_DURATION_MS }ms ease-in-out forwards` }
    : null;

  const debugToolsEnabled = String(configParams[SETTING_KEYS.DEBUG_CONSOLE] || '').trim() === 'true';
  const debugConsoleEnabled = debugToolsEnabled || IS_DEV_ENVIRONMENT || pluginContext().pluginUUID === "6da03574-0f4b-11f1-ba9e-11ba9c716f59";
  const memoryMeasurementEnabled = debugConsoleEnabled;
  if (debugConsoleEnabled) {
    logIfEnabled(`[dashboard] Debug console enabled (configParams "${ configParams[SETTING_KEYS.DEBUG_CONSOLE] || "(empty)" }" app setting keys "${ Object.keys(app.settings) || "(empty)" }", ${ pluginContext().pluginUUID }), including in layout popup`);
  } else {
    logIfEnabled(`[dashboard] Debug console disabled (${ SETTING_KEYS.DEBUG_CONSOLE } is '${ configParams?.[SETTING_KEYS.DEBUG_CONSOLE] }', pluginUUID ${ pluginContext().pluginUUID }, context ${ JSON.stringify(pluginContext()) }), excluding from layout popup`);
  }
  const layoutPopupExcludeWidgetIds = debugConsoleEnabled ? [] : ['debug-console'];

  const currentLayoutArray = Array.isArray(configParams?.[SETTING_KEYS.DASHBOARD_COMPONENTS])
    ? configParams[SETTING_KEYS.DASHBOARD_COMPONENTS]
    : DEFAULT_DASHBOARD_COMPONENTS;

  return (
    <div className="dashboard-outer-container" style={backgroundStyle}>
      {backgroundFadeStyle ? <div className="dashboard-background-fade" style={backgroundFadeStyle} /> : null}
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
            onOpenMemoryMeasurement={memoryMeasurementEnabled ? () => setFocusState(DASHBOARD_FOCUS.MEMORY_MEASUREMENT) : null}
            onSave={handleSettingsSave}
            pluginNoteUUID={pluginNoteUUID}
            timeFormat={timeFormat}
            weekFormat={weekFormat}
          />
        );
      })() : null}
      {focusState === DASHBOARD_FOCUS.MEMORY_MEASUREMENT ? (
        <WidgetMemoryMeasurementPopup
          onClose={() => setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG)}
          renderWidget={renderMemoryMeasurementWidget}
        />
      ) : null}
      {focusState !== DASHBOARD_FOCUS.MEMORY_MEASUREMENT ? (
      <div className={`dashboard-content${isWidgetFocusMode ? ' dashboard-content--widget-focused' : ''}`}>
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
              const renderedConfig = widgetConfigForFocus(config, expandedWidgetId);
              return (
                <CellComponent
                  key={widgetId}
                  agendaTasks={agendaTasks}
                  app={app}
                  calendarEvents={calendarEvents}
                  calendarEventsLoaded={calendarEventsLoaded}
                  completedTasksByDate={completedTasksByDate}
                  config={renderedConfig}
                  currentDate={currentDate}
                  dailyValues={dailyVictoryValues}
                  draggingWidgetId={draggingWidgetId}
                  focusedWidgetId={focusedWidgetId}
                  focusedWidgetSurfaceStyle={focusedWidgetId === widgetId ? focusedWidgetSurfaceStyle : null}
                  layoutConfig={config}
                  loadedEventReady={loadedEventReadyFromWidgetId(widgetId)}
                  moodRatings={moodRatings}
                  onDateSelect={setSelectedDate}
                  currentLayout={currentLayoutArray}
                  onLayoutApply={handleLayoutPersist}
                  onSelectedProfileChange={handleSelectedProfileChange}
                  onMoodRecorded={handleMoodRecorded}
                  onOpenSettings={onOpenDreamTaskSettings}
                  onReferenceDateChange={setSelectedDate}
                  onSwapBackground={swapBackground}
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
      </div>) : null}
    </div>
  );
}
