import WidgetWrapper from "./widget-wrapper"
import { createElement } from "react"

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
