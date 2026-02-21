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
/**
 * Renders the dashboard agenda card showing today's scheduled tasks.
 *
 * @param {object} props
 * @param {Array<object>} props.todayTasks - Ordered tasks scheduled for today.
 * @param {string} [props.todayTasks[].uuid] - Stable task identifier used as React key.
 * @param {string} [props.todayTasks[].content] - Task title/body text (markdown characters are stripped for display).
 * @param {number} [props.todayTasks[].startAt] - Task start timestamp in milliseconds since epoch.
 * @param {number} [props.todayTasks[].endAt] - Task end timestamp in milliseconds since epoch.
 * @param {boolean} [props.todayTasks[].important] - Whether the task is marked important.
 * @param {boolean} [props.todayTasks[].urgent] - Whether the task is marked urgent.
 * @returns {React.ReactElement} Agenda widget with empty state or task list rows.
 */
export default function AgendaWidget({ todayTasks }) {
  const h = createElement;

  const priorityClassName = (task) => {
    if (task.important && task.urgent) return 'priority-critical';
    if (task.important) return 'priority-important';
    if (task.urgent) return 'priority-urgent';
    return 'priority-normal';
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
            h('div', { className: `agenda-indicator ${priorityClassName(task)}` }),
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
