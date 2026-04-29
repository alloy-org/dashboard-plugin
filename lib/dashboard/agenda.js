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

// ------------------------------------------------------------------------------------------
// [Claude claude-4.6-opus] Task: filter calendar events to those starting on a given date
// Prompt: "filter calendar events by date so non-today events don't appear in today's schedule"
// @description Returns only events whose start Date falls on the given date key.
// @param {Array} events - Calendar event objects
// @param {string} dateKey - YYYY-MM-DD date key to match
// @returns {Array} Filtered events for the given date
function calendarEventsForDateKey(events, dateKey) {
  if (!Array.isArray(events) || !dateKey) return [];
  return events.filter(event => event?.start && formatDateKey(event.start) === dateKey);
}

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
  const todayCalendarEvents = hasCalendarEvents ? calendarEventsForDateKey(calendarEvents, todayDateKey) : [];
  const baseKeys = Array.from(new Set([
    ...taskDateKeys,
    ...(todayCalendarEvents.length > 0 ? [todayDateKey] : []),
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

  // [OpenAI GPT-5.5] Task: sort mixed agenda tasks and events by actual timestamp
  // Prompt: "Task Agenda is not correctly interspersing events and tasks by time of day"
  const sortTimeFromAgendaItem = (dateKey, item) => {
    if (item.type === 'event' && item.event.allDay) return new Date(`${ dateKey }T00:00:00`).getTime();
    const timestamp = item.type === 'event' ? item.event.start : (item.task.startAt || item.task.deadline);
    const sortTime = toMillis(timestamp);
    return sortTime == null ? Number.POSITIVE_INFINITY : sortTime;
  };

  // [OpenAI GPT-5.5] Task: merge tasks and events before rendering agenda rows
  // Prompt: "Update lib/dashboard/agenda.js so it sorts tasks and events within a day within ascending order"
  const agendaItemsForDate = (dateKey, eventsForDate, visibleTasks) => {
    return [
      ...visibleTasks.map((task, index) => ({ index, sortMs: sortTimeFromAgendaItem(dateKey, { task, type: 'task' }),
        task, type: 'task' })),
      ...eventsForDate.map((event, index) => ({ event, index, sortMs: sortTimeFromAgendaItem(dateKey, { event,
        type: 'event' }), sourceOrder: visibleTasks.length + index, type: 'event' }))
    ].map((item, sourceOrder) => ({ ...item, sourceOrder: item.sourceOrder ?? sourceOrder }))
      .sort((a, b) => (a.sortMs - b.sortMs) || (a.sourceOrder - b.sourceOrder));
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
    // [Claude claude-4.6-opus] Task: render calendar events with same formatting as tasks, filtered by date
    // Prompt: "calendar events use same formatting as other events; don't show non-today events on today"
    h('div', { className: 'agenda-list', ref: listRef },
      visibleDateKeys.map(dateKey => {
        const tasksForDate = tasks[dateKey] || [];
        const visibleTasks = visibleTasksForDate(tasksForDate);
        const eventsForDate = calendarEventsForDateKey(calendarEvents, dateKey);
        const agendaItems = agendaItemsForDate(dateKey, eventsForDate, visibleTasks);

      return h('section', { key: dateKey, className: 'agenda-day' },
          h('h4', { className: 'agenda-date-label' }, renderDateLabel(dateKey)),
          visibleTasks.length === 0 && eventsForDate.length === 0
            ? h('p', { className: 'agenda-empty-day' },
                dateKey === todayDateKey ? 'No tasks scheduled for today' : 'No tasks scheduled')
            : agendaItems.map(item => item.type === 'task'
              ? h('div', {
                    key: item.task.uuid, className: 'agenda-item agenda-task-row',
                    onClick: (e) => { if (!e.target.closest('a')) navigateToTask(item.task); }
                  },
                  h('div', { className: `agenda-indicator ${ priorityClassName(item.task) }` }),
                  h('div', { className: 'agenda-content' },
                    h('span', { className: 'agenda-time',
                      title: `${ item.task.startAt ? "Start" : "Deadline" } time for task` },
                      formatTime(item.task.startAt || item.task.deadline)),
                    h('span', { className: 'agenda-text',
                      dangerouslySetInnerHTML: { __html: amplenoteMarkdownRender(item.task.content) ||
                        'Untitled task' } }),
                    getTaskNoteUuid(item.task)
                      ? h('button', { type: 'button', className: 'agenda-note-link',
                          onClick: (event) => navigateToTaskNote(item.task, event) }, getTaskNoteLabel(item.task))
                      : null
                  ),
                  toMillis(item.task.endAt) && toMillis(item.task.startAt) &&
                    toMillis(item.task.endAt) > toMillis(item.task.startAt)
                    ? h('span', { className: 'agenda-duration' },
                        Math.round((toMillis(item.task.endAt) - toMillis(item.task.startAt)) / 60000) + 'm')
                    : null
                )
              : h('div', {
                    key: `cal-${ item.index }`, className: 'agenda-item agenda-task-row',
                  },
                  h('div', { className: 'agenda-indicator priority-normal' }),
                  h('div', { className: 'agenda-content' },
                    item.event.allDay
                      ? h('span', { className: 'agenda-time' }, 'All day')
                      : item.event.start ? h('span', { className: 'agenda-time' }, formatTime(item.event.start)) : null,
                    h('span', { className: 'agenda-text' }, item.event.title || 'Calendar event'),
                    item.event.calendar?.name
                      ? h('span', { className: 'agenda-note-link' }, item.event.calendar.name) : null
                  ),
                  item.event.end && item.event.start && item.event.end > item.event.start
                    ? h('span', { className: 'agenda-duration' },
                        Math.round((item.event.end.getTime() - item.event.start.getTime()) / 60000) + 'm')
                    : null
                ))
        );
      })
    )
  );
}
