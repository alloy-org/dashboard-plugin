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
import { DASHBOARD_COMPONENTS, DEFAULT_DASHBOARD_COMPONENTS } from 'constants/settings';
import useDomainTasks from 'hooks/use-domain-tasks';

/**
 * Builds dashboard widget cells from the persisted component layout setting.
 *
 * @param {typeof createElement} createElementFunction - React element factory used to build widget and container elements.
 * @param {object} widgetData - Individual state values sourced from DashboardApp and useDomainTasks.
 * @param {object} widgetData.settings - Parsed plugin settings payload, including `DASHBOARD_COMPONENTS`.
 * @param {Array<object>} widgetData.dailyVictoryValues - Per-day victory value data for the victory value widget.
 * @param {number} widgetData.weeklyVictoryValue - Aggregate weekly victory value total.
 * @param {Array<object>} widgetData.moodRatings - Mood rating series used by mood and victory value widgets.
 * @param {object} widgetData.openTasks - Open tasks grouped by date key (`YYYY-MM-DD`).
 * @param {object} widgetData.completedTasks - Completed tasks grouped by date key (`YYYY-MM-DD`).
 * @param {string} widgetData.currentDate - ISO date string used by the calendar widget.
 * @param {object} widgetData.quarterlyPlans - Current and next quarter planning metadata used by planning/quotes widgets.
 * @param {Function} widgetData.buildAgendaTasksByDate - Function from useDomainTasks to build agenda-ordered tasks.
 * @param {object} options - Additional interaction props.
 * @param {string|null} options.selectedDate - Currently selected date key from calendar click.
 * @param {Function} options.onDateSelect - Callback to set selectedDate.
 * @returns {Array<React.ReactElement>} Ordered grid cell elements for all configured dashboard widgets.
 */
// [Claude] Task: remove abbreviations and fully document renderActiveComponents
// Prompt: "Revise the function not to use abbreviations, and to have a full JSDoc"
// Date: 2026-02-21 | Model: claude-sonnet-4-6
// [Claude] Task: pass cross-widget interaction props (selectedDate, onDateSelect) to calendar and agenda
// Prompt: "clicking a date on calendar changes the date shown by the Agenda widget"
// Date: 2026-02-21 | Model: claude-opus-4-6
// [Claude] Task: accept individual state values instead of monolithic data object
// Prompt: "split DashboardApp state and extract useDomainTasks hook"
// Date: 2026-02-22 | Model: claude-opus-4-6
function renderActiveComponents(createElementFunction, widgetData, { selectedDate, onDateSelect } = {}) {
  const configuredComponents = widgetData?.settings?.[DASHBOARD_COMPONENTS];
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
          currentDate: widgetData.currentDate,
          tasks: widgetData.buildAgendaTasksByDate(widgetData.currentDate),
          selectedDate
        });
        break;
      case 'ai-plugins':
        renderedComponent = createElementFunction(AIPluginsWidget, { taskCount: 0, flashcardsDue: 0 });
        break;
      case 'calendar':
        renderedComponent = createElementFunction(CalendarWidget, {
          openTasks: widgetData.openTasks,
          completedTasks: widgetData.completedTasks,
          currentDate: widgetData.currentDate,
          settings: { ...widgetData.settings, [widgetIdentifier]: componentSettings },
          selectedDate,
          onDateSelect
        });
        break;
      case 'mood':
        renderedComponent = createElementFunction(MoodWidget, { moodRatings: widgetData.moodRatings });
        break;
      case 'planning':
        renderedComponent = createElementFunction(PlanningWidget, { quarterlyPlans: widgetData.quarterlyPlans });
        break;
      case 'quick-actions':
        renderedComponent = createElementFunction(QuickActionsWidget, {});
        break;
      case 'quotes':
        renderedComponent = createElementFunction(QuotesWidget, {
          quotes: null,
          planContent: widgetData.quarterlyPlans?.current?.noteUUID ? null : null,
          settings: { ...widgetData.settings, [widgetIdentifier]: componentSettings }
        });
        break;
      case 'victory-value':
        renderedComponent = createElementFunction(VictoryValueWidget, {
          dailyValues: widgetData.dailyVictoryValues,
          weeklyTotal: widgetData.weeklyVictoryValue,
          moodRatings: widgetData.moodRatings,
          completedTasks: widgetData.completedTasks,
          settings: { ...widgetData.settings, [widgetIdentifier]: componentSettings }
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

// [Claude] Task: root component with split state and useDomainTasks hook
// Prompt: "split DashboardApp state and extract useDomainTasks hook"
// Date: 2026-02-22 | Model: claude-opus-4-6
export default function DashboardApp() {
  const h = createElement;
  const { activeTaskDomain, buildAgendaTasksByDate, completedTasks, initializeDomainTasks,
    onDomainChange, openTasks, taskDomains } = useDomainTasks();

  const [moodRatings, setMoodRatings] = useState(null);
  const [quarterlyPlans, setQuarterlyPlans] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dailyVictoryValues, setDailyVictoryValues] = useState(null);
  const [weeklyVictoryValue, setWeeklyVictoryValue] = useState(null);
  const [currentDate, setCurrentDate] = useState(null);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    callPlugin('init').then(result => {
      if (result?.error) {
        setError(result.error);
      } else {
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

  const handleDomainChange = useCallback((newDomains, newActiveDomain, taskData) => {
    onDomainChange(newDomains, newActiveDomain, taskData);
    if (taskData) {
      setDailyVictoryValues(taskData.dailyVictoryValues);
      setWeeklyVictoryValue(taskData.weeklyVictoryValue);
    }
  }, [onDomainChange]);

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!settings) return h('div', { className: 'dashboard-loading' },
    h('div', { className: 'spinner' }),
    h('p', null, 'Loading dashboard...')
  );

  const widgetData = { buildAgendaTasksByDate, completedTasks, currentDate, dailyVictoryValues,
    moodRatings, openTasks, quarterlyPlans, settings, weeklyVictoryValue };

  return h('div', { className: 'dashboard' },
    h(TaskDomains, {
      domains: taskDomains,
      activeTaskDomain: activeTaskDomain,
      onDomainChange: handleDomainChange,
    }),
    h('div', { className: 'dashboard-grid' },
      ...renderActiveComponents(h, widgetData, { selectedDate, onDateSelect: setSelectedDate })
    )
  );
}
