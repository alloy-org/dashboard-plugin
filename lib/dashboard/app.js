import { createElement, useEffect, useState } from "react";
import WidgetWrapper from './widget-wrapper';
import PlanningWidget from './planning';
import VictoryValueWidget from './victory-value';
import MoodWidget from './mood';
import CalendarWidget from './calendar';
import AgendaWidget from './agenda';
import QuotesWidget from './quotes';
import AIPluginsWidget from './ai-plugins';
import QuickActionsWidget from './quick-actions';

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

  if (error) return h('div', { className: 'dashboard-error' },
    h('h2', null, 'Dashboard Error'),
    h('p', null, error)
  );

  if (!data) return h('div', { className: 'dashboard-loading' },
    h('div', { className: 'spinner' }),
    h('p', null, 'Loading dashboard...')
  );

  return h('div', { className: 'dashboard' },
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
