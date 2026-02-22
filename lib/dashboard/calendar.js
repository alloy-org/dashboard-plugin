/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Calendar widget — month grid with task-density dots
 * Prompt summary: "monthly calendar grid with navigation and colored dots indicating task density"
 */
import { createElement, useState } from "react";
import WidgetWrapper from "./widget-wrapper";
import ConfigPopup from "./config-popup";

// [Claude] Task: render monthly calendar grid with task-density dot indicators
// Prompt: "monthly calendar grid with navigation and colored dots indicating task density"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
// [Claude] Task: make calendar day cells clickable to drive agenda date selection
// Prompt: "clicking a date on calendar changes the date shown by the Agenda widget"
// Date: 2026-02-21 | Model: claude-opus-4-6
// [Claude] Task: add inline config popup for Calendar settings
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Claude] Task: accept openTasks + completedTasks grouped objects instead of flat tasks array
// Prompt: "split DashboardApp state and extract useDomainTasks hook"
// Date: 2026-02-22 | Model: claude-opus-4-6
export default function CalendarWidget({ openTasks, completedTasks, currentDate, settings, selectedDate, onDateSelect }) {
  const h = createElement;
  const today = new Date(currentDate);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const weekStartsOn = settings?.['dashboard_calendar_config']?.[0] === '1' ? 1 : 0;

  const [configOpen, setConfigOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(String(weekStartsOn));

  const handleConfigSubmit = async () => {
    await callPlugin('saveSetting', 'calendar', [weekStart]);
    setConfigOpen(false);
  };

  const handleConfigCancel = () => {
    setWeekStart(String(weekStartsOn));
    setConfigOpen(false);
  };

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = (new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay() - weekStartsOn + 7) % 7;

  const DAY_LABELS = weekStartsOn === 1
    ? ['Mo','Tu','We','Th','Fr','Sa','Su']
    : ['Su','Mo','Tu','We','Th','Fr','Sa'];

  // Count tasks per day for dot coloring from grouped date-key objects
  const taskCountByDay = {};
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-`;

  [openTasks, completedTasks].forEach(grouped => {
    Object.keys(grouped || {}).forEach(dateKey => {
      if (dateKey.startsWith(monthPrefix)) {
        const day = parseInt(dateKey.substring(8), 10);
        taskCountByDay[day] = (taskCountByDay[day] || 0) + (grouped[dateKey]?.length || 0);
      }
    });
  });

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));

  const monthName = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const isToday = (day) => day === today.getDate()
    && viewDate.getMonth() === today.getMonth()
    && viewDate.getFullYear() === today.getFullYear();

  const makeDateKey = (day) => {
    const y = viewDate.getFullYear();
    const m = String(viewDate.getMonth() + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const isSelected = (day) => selectedDate && makeDateKey(day) === selectedDate;

  const handleDayClick = (day) => {
    if (onDateSelect) {
      const dateKey = makeDateKey(day);
      onDateSelect(dateKey === selectedDate ? null : dateKey);
    }
  };

  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(h('div', { key: 'empty-' + i, className: 'cal-cell empty' }));
  for (let day = 1; day <= daysInMonth; day++) {
    const count = taskCountByDay[day] || 0;
    const dotColor = count === 0 ? 'none' : count <= 2 ? '#86efac' : count <= 5 ? '#fbbf24' : '#f87171';
    let cellClass = 'cal-cell';
    if (isToday(day)) cellClass += ' today';
    if (isSelected(day)) cellClass += ' selected';
    cells.push(h('div', {
      key: day,
      className: cellClass,
      onClick: () => handleDayClick(day)
    },
      h('span', { className: 'cal-day' }, day),
      dotColor !== 'none' ? h('span', { className: 'cal-dot', style: { backgroundColor: dotColor } }) : null
    ));
  }

  return h(WidgetWrapper, {
    title: 'Calendar', icon: '📅', widgetId: 'calendar', configurable: true,
    onConfigure: () => setConfigOpen(true)
  },
    configOpen
      ? h(ConfigPopup, {
          title: 'Configure Calendar',
          onSubmit: handleConfigSubmit,
          onCancel: handleConfigCancel
        },
          h('div', { className: 'config-field' },
            h('div', { className: 'config-field-label' }, 'Week starts on'),
            [['0', 'Sunday'], ['1', 'Monday']].map(([value, label]) =>
              h('label', { key: value },
                h('input', {
                  type: 'radio', name: 'cal-week-start', value,
                  checked: weekStart === value,
                  onChange: () => setWeekStart(value)
                }),
                label
              )
            )
          )
        )
      : null,
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
