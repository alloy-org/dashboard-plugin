/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Agenda widget — today's tasks with priority colors and durations
 * Prompt summary: "widget listing today's scheduled tasks with time, priority indicator, and duration"
 */
import { widgetTitleFromId } from "constants/settings"
import { createElement, useState, useEffect, useRef } from "react"
import WidgetWrapper from "widget-wrapper"
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render"
// [Claude] Task: use shared `formatDateKey` from date-utility (single YYYY-MM-DD implementation)
// Prompt: "DRY formatDateKey in date-utility.js; consumed by agenda, tests, use-domain-tasks"
// Date: 2026-03-24 | Model: claude-sonnet-4-6
import { formatDateKey } from "util/date-utility"
import "styles/agenda.scss"

const DATES_PER_PAGE = 3;

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
 * @param {number|Date} [props.tasks.YYYY-MM-DD[].hideUntil] - If set and after "now", the task is omitted from the list.
 * @param {string} props.currentDate - Current date ISO string used to determine the "today" section.
 * @returns {React.ReactElement} Agenda widget with date-grouped task list and task/note navigation.
 */
// [Claude] Task: add pagination with header arrows to navigate through date pages
// Prompt: "implement Agenda pagination, with arrows in header to move forward and backward from page 1"
// [Claude claude-4.6-opus-high-thinking] Task: accept timeFormat prop for time display
// Prompt: "components that render times should utilize timeFormat prop"
export default function AgendaWidget({ app, calendarEvents, currentDate, selectedDate, tasks, timeFormat }) {
  const h = createElement;
  const [page, setPage] = useState(0);
  const listRef = useRef(null);
  const todayDateKey = formatDateKey(currentDate || new Date().toISOString());

  // Build the full ordered date key list, ensuring selectedDate and today (when there are
  // calendar events) are included
  const taskDateKeys = Object.keys(tasks || {}).sort();
  const hasCalendarEvents = Array.isArray(calendarEvents) && calendarEvents.length > 0;
  const baseKeys = Array.from(new Set([
    ...taskDateKeys,
    ...(hasCalendarEvents ? [todayDateKey] : []),
  ])).sort();
  const allDateKeys = selectedDate && !baseKeys.includes(selectedDate)
    ? [...baseKeys, selectedDate].sort()
    : baseKeys;

  const totalPages = Math.max(1, Math.ceil(allDateKeys.length / DATES_PER_PAGE));

  // When selectedDate changes, jump to the page containing it
  useEffect(() => {
    if (!selectedDate) return;
    const dateIndex = allDateKeys.indexOf(selectedDate);
    if (dateIndex >= 0) {
      setPage(Math.floor(dateIndex / DATES_PER_PAGE));
    }
  }, [selectedDate]);

  // [Claude] Task: wire up tippy popups for any Amplenote Rich Footnote links after render
  // Prompt: "update agenda to use amplenoteMarkdownRender for task content"
  // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    attachFootnotePopups(listRef.current);
  });

  const currentPage = Math.min(page, totalPages - 1);
  const visibleDateKeys = allDateKeys.slice(
    currentPage * DATES_PER_PAGE,
    (currentPage + 1) * DATES_PER_PAGE
  );

  const priorityClassName = (task) => {
    if (task.important && task.urgent) return 'priority-critical';
    if (task.important) return 'priority-important';
    if (task.urgent) return 'priority-urgent';
    return 'priority-normal';
  };

  // [Claude] Task: normalize timestamps to ms and format in local timezone
  // Prompt: "ensure agenda times are in the time zone of the local user"
  // Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
  const toMillis = (timestamp) => {
    if (!timestamp) return null;
    if (timestamp instanceof Date) return timestamp.getTime();
    if (typeof timestamp === 'number') return timestamp < 1e10 ? timestamp * 1000 : timestamp;
    return null;
  };

  // [Claude claude-4.6-opus-high-thinking] Task: format times using timeFormat prop
  // Prompt: "components that render times should utilize timeFormat prop"
  const formatTime = (timestamp) => {
    const ms = toMillis(timestamp);
    if (!ms) return '';
    const options = timeFormat === '24h'
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { hour: '2-digit', minute: '2-digit' };
    return new Date(ms).toLocaleTimeString([], options);
  };

  const getTaskNoteUuid = (task) => task.noteUUID || task.noteUuid || task.note?.uuid || null;
  const getTaskNoteLabel = (task) => task.noteName || task.noteTitle || task.note?.name || 'Open note';

  const navigateToTask = async (task) => {
    const noteUuid = getTaskNoteUuid(task);
    if (!noteUuid || !task.uuid) return;
    await app.navigate(`https://www.amplenote.com/notes/${noteUuid}?highlightTaskUUID=${task.uuid}`);
  };

  const navigateToTaskNote = async (task, event) => {
    event.stopPropagation();
    const noteUuid = getTaskNoteUuid(task);
    if (!noteUuid) return;
    await app.navigate(`https://www.amplenote.com/notes/${noteUuid}`);
  };

  const renderDateLabel = (dateKey) => {
    const dateForLabel = new Date(`${dateKey}T00:00:00`);
    return dateForLabel.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const nowMs = Date.now();

  // [Claude] Task: omit tasks whose hideUntil is still in the future
  // Prompt: "When agenda lists tasks, any task with hideUntil timestamp later than the current time should be omitted"
  // Date: 2026-03-24 | Model: claude-sonnet-4-6
  const visibleTasksForDate = (tasksForDate) => {
    return tasksForDate.filter((task) => {
      const hideUntilMs = toMillis(task.hideUntil);
      if (hideUntilMs == null) return true;
      return hideUntilMs <= nowMs;
    });
  };

  const paginationControls = totalPages > 1
    ? h('div', { className: 'agenda-pagination' },
        h('button', {
          className: 'agenda-page-arrow',
          onClick: () => setPage(p => Math.max(0, p - 1)),
          disabled: currentPage === 0
        }, '\u25C0'),
        h('span', { className: 'agenda-page-indicator' }, `${currentPage + 1} / ${totalPages}`),
        h('button', {
          className: 'agenda-page-arrow',
          onClick: () => setPage(p => Math.min(totalPages - 1, p + 1)),
          disabled: currentPage >= totalPages - 1
        }, '\u25B6')
      )
    : null;

  return h(WidgetWrapper, {
    title: widgetTitleFromId('agenda'), icon: '\uD83D\uDCCB', widgetId: 'agenda',
    headerActions: paginationControls
  },
    h('div', { className: 'agenda-list', ref: listRef },
      visibleDateKeys.map(dateKey => {
        const tasksForDate = tasks[dateKey] || [];
        const visibleTasks = visibleTasksForDate(tasksForDate);
        const isTodaySection = dateKey === todayDateKey;

      return h('section', { key: dateKey, className: 'agenda-day' },
          h('h4', { className: 'agenda-date-label' }, renderDateLabel(dateKey)),
          visibleTasks.length === 0 && !(isTodaySection && hasCalendarEvents)
            ? h('p', { className: 'agenda-empty-day' },
                isTodaySection ? 'No tasks scheduled for today' : 'No tasks scheduled')
            : visibleTasks.map(task => h('div', {
                key: task.uuid,
                className: 'agenda-item agenda-task-row',
                onClick: (e) => { if (!e.target.closest('a')) navigateToTask(task); }
              },
              h('div', { className: `agenda-indicator ${priorityClassName(task)}` }),
              h('div', { className: 'agenda-content' },
                h('span', { className: 'agenda-time', title: `${ task.startAt ? "Start" : "Deadline" } time for task` }, formatTime(task.startAt || task.deadline)),
                h('span', { className: 'agenda-text', dangerouslySetInnerHTML: { __html: amplenoteMarkdownRender(task.content) || 'Untitled task' } }),
                getTaskNoteUuid(task)
                  ? h('button', {
                      type: 'button',
                      className: 'agenda-note-link',
                      onClick: (event) => navigateToTaskNote(task, event)
                    }, getTaskNoteLabel(task))
                  : null
              ),
              toMillis(task.endAt) && toMillis(task.startAt) && toMillis(task.endAt) > toMillis(task.startAt) ? h('span', { className: 'agenda-duration' },
                Math.round((toMillis(task.endAt) - toMillis(task.startAt)) / 60000) + 'm'
              ) : null
            )),
          // [Claude claude-sonnet-4-6] Task: render calendar event times using start Date from new event shape
          // Prompt: "Ensure agenda.js utilizes events with allDay, calendar, color, end, start (Date), title shape"
          isTodaySection && hasCalendarEvents
            ? h('div', { className: 'agenda-calendar-events' },
                calendarEvents.map((event, i) =>
                  h('div', { key: `cal-${i}`, className: 'agenda-item agenda-calendar-event-row' },
                    h('div', { className: 'agenda-indicator agenda-calendar-indicator' }),
                    h('div', { className: 'agenda-content' },
                      event.allDay
                        ? h('span', { className: 'agenda-time' }, 'All day')
                        : event.start
                          ? h('span', { className: 'agenda-time' }, formatTime(event.start))
                          : null,
                      h('span', { className: 'agenda-text' }, event.title || 'Calendar event'),
                      event.calendar?.name
                        ? h('span', { className: 'agenda-calendar-name' }, event.calendar.name)
                        : null
                    )
                  )
                )
              )
            : null
        );
      })
    )
  );
}
