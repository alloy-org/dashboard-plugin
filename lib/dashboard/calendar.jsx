/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Calendar widget — month grid with task-density dots
 * Prompt summary: "monthly calendar grid with navigation and colored dots indicating task density"
 */
import { useState } from "react";
import WidgetWrapper from "widget-wrapper";
import { widgetTitleFromId } from "constants/settings";
import "styles/calendar.scss"

// [Claude] Task: accept openTasks + completedTasks grouped objects instead of flat tasks array
// Prompt: "split DashboardApp state and extract useDomainTasks hook"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Claude claude-4.6-opus-high-thinking] Task: remove local week-start config; use weekFormat prop from dashboard
// Prompt: "calendar should use weekFormat prop; Configure link opens global Dashboard Settings popup"
// [Claude claude-4.7-opus] Task: migrate CalendarWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function CalendarWidget({ app, completedTasksByDate, currentDate, gridHeightSize, gridWidthSize,
    onDateSelect, onOpenSettings, openTasks, selectedDate, weekFormat }) {
  const today = new Date(currentDate);
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const weekStartsOn = weekFormat === 'monday' ? 1 : 0;

  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = (new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay() - weekStartsOn + 7) % 7;

  const DAY_LABELS = weekStartsOn === 1
    ? ['Mo','Tu','We','Th','Fr','Sa','Su']
    : ['Su','Mo','Tu','We','Th','Fr','Sa'];

  const taskCountByDay = {};
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-`;

  [openTasks, completedTasksByDate].forEach(grouped => {
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
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push(<div key={'empty-' + i} className="cal-cell empty" />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const count = taskCountByDay[day] || 0;
    const dotColor = count === 0 ? 'none' : count <= 2 ? '#86efac' : count <= 5 ? '#fbbf24' : '#f87171';
    let cellClass = 'cal-cell';
    if (isToday(day)) cellClass += ' today';
    if (isSelected(day)) cellClass += ' selected';
    cells.push(
      <div key={day} className={cellClass} onClick={() => handleDayClick(day)}>
        <span className="cal-day">{day}</span>
        {dotColor !== 'none' ? <span className="cal-dot" style={{ backgroundColor: dotColor }} /> : null}
      </div>
    );
  }

  return (
    <WidgetWrapper
      configurable={true}
      gridHeightSize={gridHeightSize}
      gridWidthSize={gridWidthSize}
      icon="📅"
      onConfigure={onOpenSettings}
      title={widgetTitleFromId('calendar')}
      widgetId="calendar"
    >
      <div className="cal-nav">
        <button onClick={prevMonth} className="cal-arrow">◀</button>
        <span className="cal-month">{monthName}</span>
        <button onClick={nextMonth} className="cal-arrow">▶</button>
      </div>
      <div className="cal-grid">
        {DAY_LABELS.map(d => <div key={d} className="cal-header">{d}</div>)}
        {cells}
      </div>
    </WidgetWrapper>
  );
}
