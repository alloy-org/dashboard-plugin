import { createElement, useState } from "react";
import WidgetWrapper from "./widget-wrapper";

export default function CalendarWidget({ tasks, currentDate, settings }) {
  const h = createElement;
  const today = new Date(currentDate);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const weekStartsOn = settings?.['dashboard_calendar_config']?.[0] === '1' ? 1 : 0;

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = (new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay() - weekStartsOn + 7) % 7;

  const DAY_LABELS = weekStartsOn === 1
    ? ['Mo','Tu','We','Th','Fr','Sa','Su']
    : ['Su','Mo','Tu','We','Th','Fr','Sa'];

  // Count tasks per day for dot coloring
  const taskCountByDay = {};
  (tasks || []).forEach(t => {
    if (t.startAt) {
      const d = new Date(t.startAt);
      if (d.getMonth() === viewDate.getMonth() && d.getFullYear() === viewDate.getFullYear()) {
        const day = d.getDate();
        taskCountByDay[day] = (taskCountByDay[day] || 0) + 1;
      }
    }
  });

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

  const monthName = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const isToday = (day) => day === today.getDate()
    && viewDate.getMonth() === today.getMonth()
    && viewDate.getFullYear() === today.getFullYear();

  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(h('div', { key: 'empty-' + i, className: 'cal-cell empty' }));
  for (let day = 1; day <= daysInMonth; day++) {
    const count = taskCountByDay[day] || 0;
    const dotColor = count === 0 ? 'none' : count <= 2 ? '#86efac' : count <= 5 ? '#fbbf24' : '#f87171';
    cells.push(h('div', {
      key: day,
      className: 'cal-cell' + (isToday(day) ? ' today' : '')
    },
      h('span', { className: 'cal-day' }, day),
      dotColor !== 'none' ? h('span', { className: 'cal-dot', style: { backgroundColor: dotColor } }) : null
    ));
  }

  return h(WidgetWrapper, { title: 'Calendar', icon: '📅', widgetId: 'calendar', configurable: true },
    h('div', { className: 'cal-nav' },
      h('button', { onClick: prevMonth, className: 'cal-arrow' }, '◀'),
      h('span', { className: 'cal-month' }, monthName),
      h('button', { onClick: nextMonth, className: 'cal-arrow' }, '▶')
    ),
    h('div', { className: 'cal-grid' },
      DAY_LABELS.map(d => h('div', { key: d, className: 'cal-header' }, d)),
      ...cells
    )
  );
}
