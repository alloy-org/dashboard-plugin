/**
 * [Claude-authored file]
 * Created: 2026-02-28 | Model: claude-sonnet-4-6
 * Task: Custom hook to fetch completed tasks for the past 7 days via app.getCompletedTasks
 * Prompt summary: "add use-completed-tasks hook that fetches completed tasks in parallel for each of the past 7 days and groups them by date for VictoryValue"
 */
import { useState, useCallback } from "react";

// ------------------------------------------------------------------------------------------
// Returns Unix-second day boundary objects for each of the past `days` days, today first.
// Each entry has: from (inclusive), to (non-inclusive), and dateKey (YYYY-MM-DD).
// [Claude] Task: compute per-day Unix-second boundaries for the past N days
// Date: 2026-02-28 | Model: claude-sonnet-4-6
function buildDayBoundaries(days = 7) {
  const now = new Date();
  const boundaries = [];
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
    boundaries.push({
      from:    Math.floor(dayStart.getTime() / 1000),
      to:      Math.floor(dayEnd.getTime()   / 1000),
      dateKey: dayStart.toISOString().split('T')[0]
    });
  }
  return boundaries;
}

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
// Fetches completed tasks for each of the past 7 days in parallel via the callPlugin bridge
// (app.getCompletedTasks), then groups them by ISO date key for VictoryValueWidget.
//
// Returns:
//   completedTasksByDate - tasks grouped by date { 'YYYY-MM-DD': [task, ...] }
//   loading              - true while any fetches are in flight
//   error                - error from the last failed fetch, or null
//   fetchCompletedTasks  - call with no arguments to trigger a (re-)fetch
//
// [Claude] Task: custom hook for fetching and grouping completed tasks per day
// Prompt: "add use-completed-tasks hook that fetches completed tasks in parallel for each of the past 7 days"
// Date: 2026-02-28 | Model: claude-sonnet-4-6
export default function useCompletedTasks() {
  const [completedTasksByDate, setCompletedTasksByDate] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // [Claude] Task: fetch completed tasks in parallel for each day and group by date
  // Date: 2026-02-28 | Model: claude-sonnet-4-6
  const fetchCompletedTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const boundaries = buildDayBoundaries(7);

      // One getCompletedTasks call per day, all in parallel
      const results = await Promise.all(
        boundaries.map(async ({ from, to, dateKey }) => {
          const tasks = await callPlugin('getCompletedTasks', from, to);
          return { dateKey, tasks: tasks || [] };
        })
      );

      const grouped = groupResultsByDate(results);
      setCompletedTasksByDate(grouped);
      return grouped;
    } catch (err) {
      console.error("useCompletedTasks: failed to fetch completed tasks", err);
      setError(err);
      return {};
    } finally {
      setLoading(false);
    }
  }, []);

  return { completedTasksByDate, loading, error, fetchCompletedTasks };
}
