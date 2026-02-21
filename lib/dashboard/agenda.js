/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Agenda widget — today's tasks with priority colors and durations
 * Prompt summary: "widget listing today's scheduled tasks with time, priority indicator, and duration"
 */
import WidgetWrapper from "./widget-wrapper"
import { createElement } from "react"

// [Claude] Task: render today's task list with priority colors and time/duration
// Prompt: "widget listing today's scheduled tasks with time, priority indicator, and duration"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export default function AgendaWidget({ todayTasks }) {
  const h = createElement;

  const priorityColor = (task) => {
    if (task.important && task.urgent) return '#ef4444';
    if (task.important) return '#f59e0b';
    if (task.urgent) return '#3b82f6';
    return '#6b7280';
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return h(WidgetWrapper, { title: "Today's Agenda", icon: '📋', widgetId: 'agenda' },
    todayTasks.length === 0
      ? h('div', { className: 'agenda-empty' }, 'No scheduled tasks today ✨')
      : h('div', { className: 'agenda-list' },
          todayTasks.map(task => h('div', { key: task.uuid, className: 'agenda-item' },
            h('div', { className: 'agenda-indicator', style: { backgroundColor: priorityColor(task) } }),
            h('div', { className: 'agenda-content' },
              h('span', { className: 'agenda-time' }, formatTime(task.startAt)),
              h('span', { className: 'agenda-text' }, task.content?.replace(/[\\[\\]#*_`]/g, '') || 'Untitled task')
          ),
        task.endAt ? h('span', { className: 'agenda-duration' },
          Math.round((task.endAt - task.startAt) / 60000) + 'm'
        ) : null
      ))
    )
  );
}
