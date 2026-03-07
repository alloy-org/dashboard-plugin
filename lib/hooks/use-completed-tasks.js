/**
 * [Claude-authored file]
 * Created: 2026-02-28 | Model: claude-sonnet-4-6
 * Task: Custom hook to fetch completed tasks for the past 7 days via app.getCompletedTasks
 * Prompt summary: "add use-completed-tasks hook that fetches completed tasks in parallel for each of the past 7 days and groups them by date for VictoryValue"
 */
import { useState, useCallback, useRef } from "react";
import { weekBoundariesFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

// ------------------------------------------------------------------------------------------
// Converts an array of { dateKey, tasks } results into an object keyed by ISO date string,
// matching the shape expected by VictoryValueWidget's `completedTasks` prop.
// [Claude] Task: group per-day fetch results into a date-keyed object
// Date: 2026-02-28 | Model: claude-sonnet-4-6
function groupResultsByDate(fetchResults) {
  const grouped = {};
  for (const { dateKey, tasks } of fetchResults) {
    grouped[dateKey] = tasks;
  }
  return grouped;
}

// ------------------------------------------------------------------------------------------
// Fetches completed tasks for each day of the selected week in parallel via callPlugin
// (app.getCompletedTasks), then groups them by ISO date key for VictoryValueWidget.
//
// Returns:
//   completedTasksByDate - tasks grouped by date { 'YYYY-MM-DD': [task, ...] }
//   loading              - true while any fetches are in flight
//   error                - error from the last failed fetch, or null
//   fetchCompletedTasks  - call with (referenceDate, activeTaskDomain) to trigger a (re-)fetch
//
// [Claude] Task: custom hook for fetching and grouping completed tasks per day
// Prompt: "reduce re-renders: loading/error as refs since they aren't consumed by the render tree"
// Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
export default function useCompletedTasks() {
  const [completedTasksByDate, setCompletedTasksByDate] = useState({});
  const loadingRef = useRef(false);
  const errorRef = useRef(null);
  const lastFetchKeyRef = useRef(null);
  const completedTasksByDateRef = useRef({});

  // [Claude] Task: fetch completed tasks for selected week and avoid redundant same-week fetches
  // Prompt: "calendar-selected date should drive week fetches for VictoryValue"
  // Date: 2026-02-28 | Model: gpt-5.3-codex
  const fetchCompletedTasks = useCallback(async (referenceDate, activeTaskDomain) => {
    const { boundaries, weekStartKey } = weekBoundariesFromDateInput(referenceDate);
    const fetchKey = `${weekStartKey}::${activeTaskDomain || ''}`;
    if (lastFetchKeyRef.current === fetchKey) {
      return completedTasksByDateRef.current;
    }

    loadingRef.current = true;
    errorRef.current = null;
    try {
      const results = await Promise.all(
        boundaries.map(async ({ from, to, dateKey }) => {
          const tasks = await callPlugin('getCompletedTasks', from, to);
          return { dateKey, tasks: tasks || [] };
        })
      );

      const grouped = groupResultsByDate(results);
      setCompletedTasksByDate(grouped);
      completedTasksByDateRef.current = grouped;
      lastFetchKeyRef.current = fetchKey;
      return grouped;
    } catch (err) {
      logIfEnabled("useCompletedTasks: failed to fetch completed tasks", err);
      errorRef.current = err;
      return {};
    } finally {
      loadingRef.current = false;
    }
  }, []);

  return {
    completedTasksByDate,
    get loading() { return loadingRef.current; },
    get error() { return errorRef.current; },
    fetchCompletedTasks,
  };
}
