/**
 * [Claude-authored file]
 * Created: 2026-02-22 | Model: claude-opus-4-6
 * Task: Custom hook managing task domain state and task grouping logic
 * Prompt summary: "extract task/domain state and grouping logic from DashboardApp into useDomainTasks hook"
 */
import { useState, useCallback } from "react";

// ------------------------------------------------------------------------------------------
// Date formatting utilities
// ------------------------------------------------------------------------------------------

/**
 * Converts a date value to an ISO date key (YYYY-MM-DD format).
 *
 * @param {Date|string|number} dateValue - The date to format
 * @returns {string} ISO date string in YYYY-MM-DD format
 *
 * @example
 * formatDateKey(new Date('2026-02-23T10:30:00')) // '2026-02-23'
 */
// [Claude] Task: format date values to ISO date keys
// Date: 2026-02-23 | Model: claude-sonnet-4-5
function formatDateKey(dateValue) {
  return new Date(dateValue).toISOString().split('T')[0];
}

// ------------------------------------------------------------------------------------------
// Task filtering utilities
// ------------------------------------------------------------------------------------------

/**
 * Extracts the primary date to use for an open task (startAt or deadline).
 *
 * @param {Object} task - The task object
 * @param {Date|null} task.startAt - Task start date
 * @param {Date|null} task.deadline - Task deadline
 * @returns {Date|null} The primary date for the task, or null if none exists
 */
// [Claude] Task: extract primary date from open task
// Date: 2026-02-23 | Model: claude-sonnet-4-5
function getOpenTaskDate(task) {
  return task.startAt || task.deadline;
}

// ------------------------------------------------------------------------------------------
// Task grouping utilities
// ------------------------------------------------------------------------------------------

/**
 * Groups an array of tasks by date into an object keyed by ISO date strings.
 *
 * @param {Array<Object>} tasks - Array of tasks to group
 * @param {function(Object): Date|null} getDateFn - Function to extract date from task
 * @param {function(Object): boolean} filterFn - Function to filter tasks
 * @returns {Object<string, Array<Object>>} Object mapping date keys to task arrays
 */
// [Claude] Task: generic task grouping by date
// Date: 2026-02-23 | Model: claude-sonnet-4-5
function groupTasksByDate(tasks, getDateFn, filterFn = () => true) {
  const grouped = {};
  tasks.forEach(task => {
    if (!filterFn(task)) return;
    const dateValue = getDateFn(task);
    if (!dateValue) return;
    const key = formatDateKey(dateValue);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(task);
  });
  return grouped;
}

/**
 * Groups open tasks by their start date or deadline.
 * Tasks that are completed or dismissed are excluded.
 *
 * @param {Array<Object>} tasks - Array of all tasks
 * @returns {Object<string, Array<Object>>} Object mapping date keys to open task arrays
 *
 * @example
 * groupOpenTasksByDate([
 *   { id: 1, startAt: new Date('2026-02-23'), completedAt: null },
 *   { id: 2, deadline: new Date('2026-02-24'), completedAt: null }
 * ])
 * // Returns: { '2026-02-23': [task1], '2026-02-24': [task2] }
 */
// [Claude] Task: group open tasks by date
// Date: 2026-02-23 | Model: claude-sonnet-4-5
function groupOpenTasksByDate(tasks) {
  return groupTasksByDate(tasks, getOpenTaskDate, task => !task.completedAt && !task.dismissedAt);
}

/**
 * Groups completed tasks by their completion date.
 * Only tasks with a completedAt timestamp are included.
 *
 * @param {Array<Object>} tasks - Array of all tasks
 * @returns {Object<string, Array<Object>>} Object mapping date keys to completed task arrays
 *
 * @example
 * groupCompletedTasksByDate([
 *   { id: 1, completedAt: new Date('2026-02-23') },
 *   { id: 2, completedAt: null }
 * ])
 * // Returns: { '2026-02-23': [task1] }
 */
// [Claude] Task: group completed tasks by date
// Date: 2026-02-23 | Model: claude-sonnet-4-5
function groupCompletedTasksByDate(tasks) {
  return groupTasksByDate(tasks, task => task.completedAt, task => !!task.completedAt);
}

// ------------------------------------------------------------------------------------------
// Agenda-specific utilities
// ------------------------------------------------------------------------------------------

/**
 * Partitions sorted date keys into today, upcoming, and older categories.
 *
 * @param {Array<string>} sortedDateKeys - Date keys sorted alphabetically
 * @param {string} todayKey - ISO date key for today
 * @returns {Object} Object with upcomingDateKeys and olderDateKeys arrays
 */
// [Claude] Task: partition date keys into temporal categories
// Date: 2026-02-23 | Model: claude-sonnet-4-5
function partitionDateKeys(sortedDateKeys, todayKey) {
  const upcomingDateKeys = sortedDateKeys.filter(dateKey => dateKey > todayKey);
  const olderDateKeys = sortedDateKeys.filter(dateKey => dateKey < todayKey);
  return { upcomingDateKeys, olderDateKeys };
}

/**
 * Rebuilds a grouped tasks object with keys in a specific order.
 *
 * @param {Object<string, Array<Object>>} groupedTasks - Original grouped tasks
 * @param {Array<string>} orderedKeys - Keys in desired order
 * @returns {Object<string, Array<Object>>} New object with ordered keys
 */
// [Claude] Task: rebuild grouped object with ordered keys
// Date: 2026-02-23 | Model: claude-sonnet-4-5
function reorderGroupedTasks(groupedTasks, orderedKeys) {
  const reordered = {};
  orderedKeys.forEach(dateKey => {
    reordered[dateKey] = groupedTasks[dateKey] || [];
  });
  return reordered;
}

// ------------------------------------------------------------------------------------------
// Main hook
// ------------------------------------------------------------------------------------------

/**
 * Custom React hook for managing task domain state and task grouping logic.
 * Provides state management for task domains and utilities for organizing tasks by date.
 *
 * @returns {Object} Hook state and methods
 * @returns {Array<Object>} return.taskDomains - Available task domains
 * @returns {Object|null} return.activeTaskDomain - Currently active task domain
 * @returns {number|null} return.tasksFetchedAt - Timestamp of last task fetch
 * @returns {Object<string, Array<Object>>} return.openTasks - Open tasks grouped by date
 * @returns {Object<string, Array<Object>>} return.completedTasks - Completed tasks grouped by date
 * @returns {Function} return.initializeDomainTasks - Initialize hook with fetched data
 * @returns {Function} return.onDomainChange - Handle domain or task data changes
 * @returns {Function} return.buildAgendaTasksByDate - Build agenda view of tasks by date
 *
 * @example
 * const { taskDomains, activeTaskDomain, openTasks, initializeDomainTasks, buildAgendaTasksByDate } = useDomainTasks();
 */
// [Claude] Task: custom hook for task domain state and grouping logic
// Prompt: "extract task/domain state and grouping logic from DashboardApp into useDomainTasks hook"
// Date: 2026-02-22 | Model: claude-opus-4-6
// Modified: 2026-02-23 | Model: claude-sonnet-4-5
export default function useDomainTasks() {
  const [taskDomains, setTaskDomains] = useState([]);
  const [activeTaskDomain, setActiveTaskDomain] = useState(null);
  const [tasksFetchedAt, setTasksFetchedAt] = useState(null);
  const [openTasksByDate, setOpenTasksByDate] = useState({});
  const [completedTasksByDate, setCompletedTasksByDate ] = useState({});
  const startAt = new Date();

  /**
   * Initializes the hook with task data from initial fetch.
   *
   * @param {Object|null} initResult - Initialization data
   * @param {Array<Object>} initResult.taskDomains - Available domains
   * @param {Object} initResult.activeTaskDomain - Active domain
   * @param {Array<Object>} initResult.tasks - All tasks
   */
  // [Claude] Task: initialize hook with fetched data
  // Date: 2026-02-23 | Model: claude-sonnet-4-5
  const initializeDomainTasks = useCallback(initResult => {
    if (!initResult) return;
    setTaskDomains(initResult.taskDomains || []);
    setActiveTaskDomain(initResult.activeTaskDomain || null);
    const tasks = initResult.tasks || [];
    setOpenTasksByDate(groupOpenTasksByDate(tasks));
    setCompletedTasksByDate(groupCompletedTasksByDate(tasks));
    setTasksFetchedAt(Date.now());
  }, []);

  /**
   * Handles changes to task domains or task data.
   *
   * @param {Array<Object>|null} newDomains - Updated domains array
   * @param {Object|null} newActiveDomain - Updated active domain
   * @param {Object|null} taskData - Updated task data
   * @param {Array<Object>} taskData.tasks - All tasks
   */
  // [Claude] Task: handle domain and task data changes
  // Date: 2026-02-23 | Model: claude-sonnet-4-5
  const onDomainChange = useCallback((newDomains, newActiveDomain, taskData) => {
    if (newDomains) {
      setTaskDomains(newDomains);
    }
    if (newActiveDomain) {
      setActiveTaskDomain(newActiveDomain);
    }
    if (taskData) {
      const tasks = taskData.tasks || [];
      setOpenTasksByDate(groupOpenTasksByDate(tasks));
      setCompletedTasksByDate(groupCompletedTasksByDate(tasks));
      setTasksFetchedAt(Date.now());
    }
  }, []);

  /**
   * Builds an agenda view of tasks grouped by date, ordered by today, upcoming, then older.
   * Flattens the internal openTasksByDate structure, filters to schedulable tasks,
   * and regroups them in agenda order.
   *
   * @param {string|null} currentDateIso - Optional ISO date to use as "today"
   * @returns {Object<string, Array<Object>>} Tasks grouped and ordered for agenda display
   *
   * @example
   * buildAgendaTasksByDate('2026-02-23')
   * // Returns: { '2026-02-23': [...], '2026-02-24': [...], '2026-02-22': [...] }
   */
  // [Claude] Task: build agenda view of tasks by date
  // Date: 2026-02-23 | Model: claude-sonnet-4-5
  const buildAgendaTasksByDate = useCallback((currentDateIso) => {
    const currentDate = currentDateIso ? new Date(currentDateIso) : new Date();
    const todayKey = formatDateKey(currentDate);

    // Step 1: Flatten and filter tasks
    const allOpenTasks = Object.values(openTasksByDate).flat();
    const pendingTasks = allOpenTasks.filter(task => !!(task.startAt || task.deadline)).
      sort((a, b) => getOpenTaskDate(a) - getOpenTaskDate(b));

    console.log(`Agenda: reviewed ${ allOpenTasks.length } open tasks`, allOpenTasks.map(t => ({deadlineText: t.deadline ? formatDateKey(t.deadline) : "N/A", startText: t.startAt ? formatDateKey(t.startAt) : "None", ...t })));
    console.log(`${ pendingTasks.length } relevant (with startAt)`, pendingTasks);

    // Step 2: Group filtered tasks by date
    const groupedByDate = groupTasksByDate(pendingTasks, getOpenTaskDate);

    // Step 3: Order date keys for agenda display
    const sortedDateKeys = Object.keys(groupedByDate).sort();
    const { upcomingDateKeys } = partitionDateKeys(sortedDateKeys, todayKey);
    const orderedDateKeys = [ todayKey, ...upcomingDateKeys ];

    // Step 4: Rebuild grouped tasks in agenda order
    return reorderGroupedTasks(groupedByDate, orderedDateKeys);
  }, [ openTasksByDate ]);

  console.log(`useDomainTasks initialized with active domain ${ activeTaskDomain } in ${ new Date() - startAt }ms`);
  return {
    taskDomains,
    activeTaskDomain,
    tasksFetchedAt,
    openTasks: openTasksByDate,
    completedTasks: completedTasksByDate,
    initializeDomainTasks,
    onDomainChange,
    buildAgendaTasksByDate
  };
}
