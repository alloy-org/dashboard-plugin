/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Root dashboard component — fetches data and renders widget grid
 * Prompt summary: "main React component that calls init, shows loading/error, and lays out widgets"
 */
import { createElement, useEffect, useState, useCallback } from "react";
import WidgetWrapper from './widget-wrapper';
import PlanningWidget from './planning';
import VictoryValueWidget from './victory-value';
import MoodWidget from './mood';
import CalendarWidget from './calendar';
import AgendaWidget from './agenda';
import QuotesWidget from './quotes';
import AIPluginsWidget from './ai-plugins';
import QuickActionsWidget from './quick-actions';
import TaskDomains from './task-domains';

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
      h('div', { className: 'grid-cell span-2' },
        h(PlanningWidget, { quarterlyPlans: data.quarterlyPlans })
      ),
      h('div', { className: 'grid-cell span-2' },
        h(VictoryValueWidget, {
          dailyValues: data.dailyVictoryValues,
          weeklyTotal: data.weeklyVictoryValue,
          moodRatings: data.moodRatings,
          settings: data.settings
        })
      ),
      h('div', { className: 'grid-cell' },
        h(MoodWidget, { moodRatings: data.moodRatings })
      ),
      h('div', { className: 'grid-cell' },
        h(CalendarWidget, {
          tasks: data.tasks,
          currentDate: data.currentDate,
          settings: data.settings
        })
      ),
      h('div', { className: 'grid-cell' },
        h(AgendaWidget, { todayTasks: data.todayTasks })
      ),
      h('div', { className: 'grid-cell span-2' },
        h(QuotesWidget, {
          quotes: null,
          planContent: data.quarterlyPlans?.current?.noteUUID ? null : null
        })
      ),
      h('div', { className: 'grid-cell' },
        h(AIPluginsWidget, { taskCount: 0, flashcardsDue: 0 })
      ),
      h('div', { className: 'grid-cell' },
        h(QuickActionsWidget, {})
      )
    )
  );
}
