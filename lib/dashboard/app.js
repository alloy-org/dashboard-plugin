/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Root dashboard component — fetches data and renders widget grid
 * Prompt summary: "main React component that calls init, shows loading/error, and lays out widgets"
 */
import { createElement, useEffect, useState, useCallback } from "react";
import PlanningWidget from 'planning';
import VictoryValueWidget from 'victory-value';
import MoodWidget from 'mood';
import CalendarWidget from 'calendar';
import AgendaWidget from 'agenda';
import QuotesWidget from 'quotes';
import AIPluginsWidget from 'ai-plugins';
import QuickActionsWidget from 'quick-actions';
import TaskDomains from 'task-domains';
import DashboardConfigPopup from 'dashboard-config-popup';
import DashboardSettingsPopup from 'dashboard-settings-popup';
import { DASHBOARD_COMPONENTS, DASHBOARD_FOCUS, DEFAULT_DASHBOARD_COMPONENTS, SETTING_KEYS, WIDGET_REGISTRY } from 'constants/settings';
import useCompletedTasks from 'hooks/use-completed-tasks';
import useDomainTasks from 'hooks/use-domain-tasks';

// ------------------------------------------------------------------------------------------
// Builds dashboard widget cells from the persisted component layout setting.
//
// @param {typeof createElement} createElementFunction - React element factory used to build widget and container elements.
// @param {Function} buildAgendaTasksByDate - Function from useDomainTasks to build agenda-ordered tasks.
// @param {object} completedTasksByDate - Completed tasks grouped by date key (`YYYY-MM-DD`).
// @param {string} currentDate - ISO date string used by the calendar widget.
// @param {Array<object>} dailyVictoryValues - Per-day victory value data for the victory value widget.
// @param {Array<object>} moodRatings - Mood rating series used by mood and victory value widgets.
// @param {object} openTasks - Open tasks grouped by date key (`YYYY-MM-DD`).
// @param {object} quarterlyPlans - Current and next quarter planning metadata used by planning/quotes widgets.
// @param {object} settings - Parsed plugin settings payload, including `DASHBOARD_COMPONENTS`.
// @param {number} weeklyVictoryValue - Aggregate weekly victory value total.
// @param {object} options - Additional interaction props.
// @param {string|null} options.selectedDate - Currently selected date key from calendar click.
// @param {Function} options.onDateSelect - Callback to set selectedDate.
// @returns {Array<React.ReactElement>} Ordered grid cell elements for all configured dashboard widgets.
//
function renderActiveComponents(createElementFunction, buildAgendaTasksByDate, completedTasksByDate,
    currentDate, dailyVictoryValues, moodRatings, openTasks,
    quarterlyPlans, settings, weeklyVictoryValue, { selectedDate, onDateSelect, victoryReferenceDate } = {}) {
  const configuredComponents = settings?.[DASHBOARD_COMPONENTS];
  const activeComponents = Array.isArray(configuredComponents) && configuredComponents.length > 0
    ? configuredComponents
    : DEFAULT_DASHBOARD_COMPONENTS;

  return activeComponents.map((componentConfig, index) => {
    const startRender = new Date();
    const fallbackWidget = DEFAULT_DASHBOARD_COMPONENTS[index] || {};
    const widgetIdentifier = componentConfig?.widgetId || componentConfig?.component || fallbackWidget.widgetId;
    const gridWidthSize = Number(componentConfig?.gridWidthSize) > 0 ? Number(componentConfig.gridWidthSize) : 1;
    const gridHeightSize = Number(componentConfig?.gridHeightSize) > 0 ? Number(componentConfig.gridHeightSize) : 1;
    const componentSettings = componentConfig?.settings || {};

    let renderedComponent = null;
    switch (widgetIdentifier) {
      case 'agenda':
        renderedComponent = createElementFunction(AgendaWidget, {
          currentDate: currentDate,
          tasks: buildAgendaTasksByDate(currentDate),
          selectedDate
        });
        break;
      case 'ai-plugins':
        renderedComponent = createElementFunction(AIPluginsWidget, { taskCount: 0, flashcardsDue: 0 });
        break;
      case 'calendar':
        renderedComponent = createElementFunction(CalendarWidget, { completedTasksByDate, currentDate, openTasks,
          onDateSelect, settings: { ...settings, [widgetIdentifier]: componentSettings },
          selectedDate });
        break;
      case 'mood':
        renderedComponent = createElementFunction(MoodWidget, { moodRatings });
        break;
      case 'planning':
        renderedComponent = createElementFunction(PlanningWidget, { quarterlyPlans });
        break;
      case 'quick-actions':
        renderedComponent = createElementFunction(QuickActionsWidget, {});
        break;
      case 'quotes':
        renderedComponent = createElementFunction(QuotesWidget, {
          quotes: null,
          planContent: quarterlyPlans?.current?.noteUUID ? null : null,
          settings: { ...settings, [widgetIdentifier]: componentSettings }
        });
        break;
      case 'victory-value':
        renderedComponent = createElementFunction(VictoryValueWidget, {
          completedTasksByDate,
          dailyValues: dailyVictoryValues,
          weeklyTotal: weeklyVictoryValue,
          moodRatings,
          referenceDate: victoryReferenceDate,
          settings: { ...settings, [widgetIdentifier]: componentSettings }
        });
        break;
      default:
        return null;
    }

    const finalElement = createElementFunction('div', {
      key: `${widgetIdentifier || 'widget'}-${index}`,
      className: 'grid-cell',
      style: {
        gridColumn: `span ${gridWidthSize}`,
        gridRow: `span ${gridHeightSize}`
      }
    }, renderedComponent);

    console.log(`Rendered widget "${ widgetIdentifier }" in ${ new Date() - startRender }ms with config:`, componentConfig);
    return finalElement;
  }).filter(Boolean);
}

// [Claude] Task: root component with calendar-selected week propagation to VictoryValue
// Prompt: "clicking calendar date should change VictoryValue week and completed-task fetch window"
// Date: 2026-02-28 | Model: gpt-5.3-codex
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

  useEffect(() => {
    callPlugin('init').then(result => {
      if (result?.error) {
        setError(result.error);
      } else {
        console.log(`Init returns`, result, `including moodRatinsgs`, result.moodRatings);
        initializeDomainTasks(result);
        setMoodRatings(result.moodRatings);
        setQuarterlyPlans(result.quarterlyPlans);
        setSettings(result.settings);
        setDailyVictoryValues(result.dailyVictoryValues);
        setWeeklyVictoryValue(result.weeklyVictoryValue);
        setCurrentDate(result.currentDate);
      }
    }).catch(err => setError(err.message));
  }, []);

  // [Claude] Task: refetch completed tasks for selected date's week or active domain changes
  // Prompt: "clicking calendar date should change VictoryValue week and completed-task fetch window"
  // Date: 2026-02-28 | Model: gpt-5.3-codex
  useEffect(() => {
    const referenceDate = selectedDate || currentDate;
    if (activeTaskDomain && referenceDate) {
      fetchCompletedTasks(referenceDate, activeTaskDomain);
    }
  }, [activeTaskDomain, currentDate, fetchCompletedTasks, selectedDate]);

  const handleDomainChange = useCallback((newDomains, newActiveDomain, taskData) => {
    onDomainChange(newDomains, newActiveDomain, taskData);
    if (taskData) {
      setDailyVictoryValues(taskData.dailyVictoryValues);
      setWeeklyVictoryValue(taskData.weeklyVictoryValue);
    }
  }, [onDomainChange]);

  // [Claude] Task: use registry-default sizes when the user resets their dashboard layout
  // Prompt: "consolidate DEFAULT_DASHBOARD_COMPONENTS and WIDGET_REGISTRY"
  // Date: 2026-03-01 | Model: claude-sonnet-4-6
  // Persists the new ordered widget list and updates local settings so the grid re-renders.
  // When isReset is true, sizes are taken from WIDGET_REGISTRY defaults rather than
  // from the user's existing per-widget configuration.
  const handleLayoutSave = useCallback(async (newRenderedWidgetIds, { isReset } = {}) => {
    const existingLayout = settings?.[DASHBOARD_COMPONENTS] || DEFAULT_DASHBOARD_COMPONENTS;
    const configByWidgetId = {};
    if (!isReset) {
      existingLayout.forEach(c => { configByWidgetId[c.widgetId] = c; });
    }

    const newLayout = newRenderedWidgetIds.map(widgetId => {
      if (configByWidgetId[widgetId]) return configByWidgetId[widgetId];
      const registryEntry = WIDGET_REGISTRY.find(w => w.widgetId === widgetId);
      return {
        widgetId,
        gridWidthSize: registryEntry?.defaultGridWidthSize ?? 1,
        gridHeightSize: 1,
        settings: {},
      };
    });

    await callPlugin('saveLayout', newLayout);
    setSettings(prev => ({ ...prev, [DASHBOARD_COMPONENTS]: newLayout }));
    setFocusState(DASHBOARD_FOCUS.DEFAULT);
  }, [settings]);

  // [Claude] Task: persist LLM provider and API key selections from the Dashboard Settings popup
  // Prompt: "create a dashboard settings popup linked next to the Layout button, with LLM provider dropdown and API key input persisted to app.settings"
  // Date: 2026-03-01 | Model: claude-sonnet-4-6
  const handleSettingsSave = useCallback(async ({ llmProvider, apiKey }) => {
    await Promise.all([
      callPlugin('saveSetting', SETTING_KEYS.LLM_PROVIDER, llmProvider),
      callPlugin('saveSetting', SETTING_KEYS.LLM_API_KEY, apiKey),
    ]);
    setSettings(prev => ({
      ...prev,
      [SETTING_KEYS.LLM_PROVIDER]: llmProvider,
      [SETTING_KEYS.LLM_API_KEY]: apiKey,
    }));
    setFocusState(DASHBOARD_FOCUS.DEFAULT);
  }, []);

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!settings) return h('div', { className: 'dashboard-loading' },
    h('div', { className: 'spinner' }),
    h('p', null, 'Loading dashboard...')
  );

  return h('div', { className: 'dashboard' },
    focusState === DASHBOARD_FOCUS.LAYOUT_CONFIG
      ? h(DashboardConfigPopup, {
          currentLayout: settings?.[DASHBOARD_COMPONENTS] || DEFAULT_DASHBOARD_COMPONENTS,
          onSave: handleLayoutSave,
          onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
        })
      : null,
    focusState === DASHBOARD_FOCUS.SETTINGS_CONFIG
      ? h(DashboardSettingsPopup, {
          currentLlmProvider: settings?.[SETTING_KEYS.LLM_PROVIDER],
          currentApiKey: settings?.[SETTING_KEYS.LLM_API_KEY],
          onSave: handleSettingsSave,
          onCancel: () => setFocusState(DASHBOARD_FOCUS.DEFAULT),
        })
      : null,
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
          onClick: () => setFocusState(DASHBOARD_FOCUS.SETTINGS_CONFIG),
          title: 'Configure LLM provider and API key for AI-powered features',
        }, '\u2699\uFE0F Settings'),
        h('button', {
          className: 'dashboard-configure-button',
          type: 'button',
          onClick: () => setFocusState(DASHBOARD_FOCUS.LAYOUT_CONFIG),
          title: 'Configure which widgets are shown and in what order',
        }, '\u2699\uFE0F Layout')
      )
    ),
    h('div', { className: 'dashboard-grid' },
      ...renderActiveComponents(h, buildAgendaTasksByDate,
        completedTasksByDate, currentDate, dailyVictoryValues,
        moodRatings, openTasks, quarterlyPlans,
        settings, weeklyVictoryValue,
        { selectedDate, onDateSelect: setSelectedDate, victoryReferenceDate: selectedDate || currentDate }
      )
    )
  );
}
