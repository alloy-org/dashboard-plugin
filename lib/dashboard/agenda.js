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
 * Renders the dashboard agenda card grouped by date sections.
 *
 * @param {object} props
 * @param {object} props.tasks - Task collection grouped by date key (`YYYY-MM-DD`), where each value is an array of tasks.
 * @param {Array<object>} [props.tasks.YYYY-MM-DD] - Tasks scheduled for the date key.
 * @param {string} [props.tasks.YYYY-MM-DD[].uuid] - Stable task identifier used as React key and task deep-link target.
 * @param {string} [props.tasks.YYYY-MM-DD[].content] - Task title/body text (markdown characters are stripped for display).
 * @param {number} [props.tasks.YYYY-MM-DD[].startAt] - Task start timestamp in milliseconds since epoch.
 * @param {number} [props.tasks.YYYY-MM-DD[].endAt] - Task end timestamp in milliseconds since epoch.
 * @param {boolean} [props.tasks.YYYY-MM-DD[].important] - Whether the task is marked important.
 * @param {boolean} [props.tasks.YYYY-MM-DD[].urgent] - Whether the task is marked urgent.
 * @param {string} [props.tasks.YYYY-MM-DD[].noteUUID] - Note UUID where the task is located.
 * @param {string} [props.tasks.YYYY-MM-DD[].noteName] - Human-readable note name where the task is located.
 * @param {string} props.currentDate - Current date ISO string used to determine the "today" section.
 * @returns {React.ReactElement} Agenda widget with date-grouped task list and task/note navigation.
 */
// [Claude] Task: redesign agenda rendering to date-grouped tasks with navigation links
// Prompt: "group agenda by date keys, add task/note navigation, and support more than top 4 tasks"
// Date: 2026-02-21 | Model: claude-sonnet-4-6
export default function AgendaWidget({ tasks, currentDate }) {
  const h = createElement;
  const todayDateKey = formatDateKey(currentDate || new Date().toISOString());
  const orderedDateKeys = Object.keys(tasks || {}).sort();

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

  const getTaskNoteUuid = (task) => task.noteUUID || task.noteUuid || task.note?.uuid || null;
  const getTaskNoteLabel = (task) => task.noteName || task.noteTitle || task.note?.name || 'Open note';

  const navigateToTask = async (task) => {
    const noteUuid = getTaskNoteUuid(task);
    if (!noteUuid || !task.uuid) return;
    await callPlugin('navigateToTask', noteUuid, task.uuid);
  };

  const navigateToTaskNote = async (task, event) => {
    event.stopPropagation();
    const noteUuid = getTaskNoteUuid(task);
    if (!noteUuid) return;
    await callPlugin('navigateToNote', noteUuid);
  };

  const renderDateLabel = (dateKey) => {
    const dateForLabel = new Date(`${dateKey}T00:00:00`);
    return dateForLabel.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  return h(WidgetWrapper, { title: "Today's Agenda", icon: '📋', widgetId: 'agenda' },
    h('div', { className: 'agenda-list' },
      orderedDateKeys.map(dateKey => {
        const tasksForDate = tasks[dateKey] || [];
        const isTodaySection = dateKey === todayDateKey;

        return h('section', { key: dateKey, className: 'agenda-day' },
          h('h4', { className: 'agenda-date-label' }, renderDateLabel(dateKey)),
          isTodaySection && tasksForDate.length === 0
            ? h('p', { className: 'agenda-empty-day' }, 'No tasks scheduled for today')
            : tasksForDate.map(task => h('div', {
                key: task.uuid,
                className: 'agenda-item agenda-task-row',
                onClick: () => navigateToTask(task)
              },
              h('div', { className: `agenda-indicator ${priorityClassName(task)}` }),
              h('div', { className: 'agenda-content' },
                h('span', { className: 'agenda-time' }, formatTime(task.startAt)),
                h('span', { className: 'agenda-text' }, task.content?.replace(/[\\[\\]#*_`]/g, '') || 'Untitled task'),
                getTaskNoteUuid(task)
                  ? h('button', {
                      type: 'button',
                      className: 'agenda-note-link',
                      onClick: (event) => navigateToTaskNote(task, event)
                    }, getTaskNoteLabel(task))
                  : null
              ),
              task.endAt ? h('span', { className: 'agenda-duration' },
                Math.round((task.endAt - task.startAt) / 60000) + 'm'
              ) : null
            ))
        );
      })
    )
  );
}

function formatDateKey(dateValue) {
  const date = new Date(dateValue);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
