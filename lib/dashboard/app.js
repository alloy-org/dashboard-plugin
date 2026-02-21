/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Root dashboard component — fetches data and renders widget grid
 * Prompt summary: "main React component that calls init, shows loading/error, and lays out widgets"
 */
import { createElement, useEffect, useState, useCallback } from "react";
import PlanningWidget from './planning';
import VictoryValueWidget from './victory-value';
import MoodWidget from './mood';
import CalendarWidget from './calendar';
import AgendaWidget from './agenda';
import QuotesWidget from './quotes';
import AIPluginsWidget from './ai-plugins';
import QuickActionsWidget from './quick-actions';
import TaskDomains from './task-domains';
import { DASHBOARD_COMPONENTS, DEFAULT_DASHBOARD_COMPONENTS } from '../constants/settings';

function formatDateKey(dateValue) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildAgendaTasksByDate(tasks, currentDateIso) {
  const currentDate = currentDateIso ? new Date(currentDateIso) : new Date();
  const todayKey = formatDateKey(currentDate);
  const pendingTasks = (tasks || [])
    .filter(task => !task.completedAt && !task.dismissedAt && task.startAt)
    .sort((firstTask, secondTask) => firstTask.startAt - secondTask.startAt);

  const groupedByDate = {};
  pendingTasks.forEach(task => {
    const dateKey = formatDateKey(task.startAt);
    if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
    groupedByDate[dateKey].push(task);
  });

  const orderedDateKeys = [todayKey];
  const sortedDateKeys = Object.keys(groupedByDate).sort();
  const upcomingDateKeys = sortedDateKeys.filter(dateKey => dateKey > todayKey);
  const olderDateKeys = sortedDateKeys.filter(dateKey => dateKey < todayKey);
  [...upcomingDateKeys, ...olderDateKeys].forEach(dateKey => {
    if (dateKey !== todayKey && orderedDateKeys.length < 3) {
      orderedDateKeys.push(dateKey);
    }
  });

  const agendaTasksByDate = {};
  orderedDateKeys.forEach(dateKey => {
    agendaTasksByDate[dateKey] = groupedByDate[dateKey] || [];
  });
  return agendaTasksByDate;
}

/**
 * Builds dashboard widget cells from the persisted component layout setting.
 *
 * @param {typeof createElement} createElementFunction - React element factory used to build widget and container elements.
 * @param {object} dashboardData - Fully resolved dashboard payload returned by the plugin `init` call.
 * @param {object} dashboardData.settings - Parsed plugin settings payload, including `DASHBOARD_COMPONENTS`.
 * @param {Array<object>} [dashboardData.settings.dashboard_components] - Ordered list of widget configurations to render.
 * @param {Array<object>} dashboardData.dailyVictoryValues - Per-day victory value data for the victory value widget.
 * @param {number} dashboardData.weeklyVictoryValue - Aggregate weekly victory value total.
 * @param {Array<object>} dashboardData.moodRatings - Mood rating series used by mood and victory value widgets.
 * @param {Array<object>} dashboardData.tasks - Task list used by the calendar widget.
 * @param {string} dashboardData.currentDate - ISO date string used by the calendar widget.
 * @param {Array<object>} dashboardData.tasks - Task list used by both calendar and agenda widgets.
 * @param {object} dashboardData.quarterlyPlans - Current and next quarter planning metadata used by planning/quotes widgets.
 * @returns {Array<React.ReactElement>} Ordered grid cell elements for all configured dashboard widgets.
 */
// [Claude] Task: remove abbreviations and fully document renderActiveComponents
// Prompt: "Revise the function not to use abbreviations, and to have a full JSDoc"
// Date: 2026-02-21 | Model: claude-sonnet-4-6
function renderActiveComponents(createElementFunction, dashboardData) {
  const configuredComponents = dashboardData?.settings?.[DASHBOARD_COMPONENTS];
  const activeComponents = Array.isArray(configuredComponents) && configuredComponents.length > 0
    ? configuredComponents
    : DEFAULT_DASHBOARD_COMPONENTS;

  return activeComponents.map((componentConfig, index) => {
    const fallbackWidget = DEFAULT_DASHBOARD_COMPONENTS[index] || {};
    const widgetIdentifier = componentConfig?.widgetId || componentConfig?.component || fallbackWidget.widgetId;
    const gridWidthSize = Number(componentConfig?.gridWidthSize) > 0 ? Number(componentConfig.gridWidthSize) : 1;
    const gridHeightSize = Number(componentConfig?.gridHeightSize) > 0 ? Number(componentConfig.gridHeightSize) : 1;
    const componentSettings = componentConfig?.settings || {};

    let renderedComponent = null;
    switch (widgetIdentifier) {
      case 'agenda':
        renderedComponent = createElementFunction(AgendaWidget, {
          currentDate: dashboardData.currentDate,
          tasks: buildAgendaTasksByDate(dashboardData.tasks, dashboardData.currentDate)
        });
        break;
      case 'ai-plugins':
        renderedComponent = createElementFunction(AIPluginsWidget, { taskCount: 0, flashcardsDue: 0 });
        break;
      case 'calendar':
        renderedComponent = createElementFunction(CalendarWidget, {
          tasks: dashboardData.tasks,
          currentDate: dashboardData.currentDate,
          settings: { ...dashboardData.settings, [widgetIdentifier]: componentSettings }
        });
        break;
      case 'mood':
        renderedComponent = createElementFunction(MoodWidget, { moodRatings: dashboardData.moodRatings });
        break;
      case 'planning':
        renderedComponent = createElementFunction(PlanningWidget, { quarterlyPlans: dashboardData.quarterlyPlans });
        break;
      case 'quick-actions':
        renderedComponent = createElementFunction(QuickActionsWidget, {});
        break;
      case 'quotes':
        renderedComponent = createElementFunction(QuotesWidget, {
          quotes: null,
          planContent: dashboardData.quarterlyPlans?.current?.noteUUID ? null : null,
          settings: { ...dashboardData.settings, [widgetIdentifier]: componentSettings }
        });
        break;
      case 'victory-value':
        renderedComponent = createElementFunction(VictoryValueWidget, {
          dailyValues: dashboardData.dailyVictoryValues,
          weeklyTotal: dashboardData.weeklyVictoryValue,
          moodRatings: dashboardData.moodRatings,
          settings: { ...dashboardData.settings, [widgetIdentifier]: componentSettings }
        });
        break;
      default:
        return null;
    }

    return createElementFunction('div', {
      key: `${widgetIdentifier || 'widget'}-${index}`,
      className: 'grid-cell',
      style: {
        gridColumn: `span ${gridWidthSize}`,
        gridRow: `span ${gridHeightSize}`
      }
    }, renderedComponent);
  }).filter(Boolean);
}

// [Claude] Task: root component with task domain state management and widget grid
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
export default function DashboardApp() {
  const h = createElement;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    callPlugin('init').then(result => {
      if (result?.error) setError(result.error);
      else setData(result);
    }).catch(err => setError(err.message));
  }, []);

  // [Claude] Task: handle task domain changes — update domains list and/or task data
  // Prompt: "allow user to choose which Task Domain their dashboard focuses on"
  // Date: 2026-02-21 | Model: claude-opus-4-6
  const handleDomainChange = useCallback((newDomains, newActiveDomain, taskData) => {
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev };

      // If domains list was refreshed (from refreshTaskDomains)
      if (newDomains) {
        updated.taskDomains = newDomains;
      }

      // Update active domain
      if (newActiveDomain) {
        updated.activeTaskDomain = newActiveDomain;
      }

      // If task data was returned (from setActiveTaskDomain)
      if (taskData) {
        updated.tasks = taskData.tasks;
        updated.todayTasks = taskData.todayTasks;
        updated.completedThisWeek = taskData.completedThisWeek;
        updated.weeklyVictoryValue = taskData.weeklyVictoryValue;
        updated.dailyVictoryValues = taskData.dailyVictoryValues;
      }

      return updated;
    });
  }, []);

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!data) return h('div', { className: 'dashboard-loading' },
    h('div', { className: 'spinner' }),
    h('p', null, 'Loading dashboard...')
  );

  return h('div', { className: 'dashboard' },
    h(TaskDomains, {
      domains: data.taskDomains,
      activeTaskDomain: data.activeTaskDomain,
      onDomainChange: handleDomainChange
    }),
    h('div', { className: 'dashboard-grid' },
      ...renderActiveComponents(h, data)
    )
  );
}
