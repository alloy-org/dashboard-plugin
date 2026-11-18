// Task counts sent with the dashboard's load event, so analytics can report how many open tasks the Dashboard's Task
// Domain holds, and how many it saw completed in the past week, for a typical user. Each count goes out twice: exact,
// so an average can be computed from an export, and as a range, which reads well in a breakdown of visitors by value.
import { logIfEnabled } from "util/log";

const COMPLETED_TASK_DAYS = 7;
// How long the load event waits for the completed count before it goes out without one.
export const COMPLETED_TASK_COUNT_TIMEOUT_MILLISECONDS = 5000;
// Lower bounds of each range a count is reported in; a count belongs to the last bound it reaches.
const TASK_COUNT_BUCKET_FLOORS = [0, 1, 10, 50, 100, 250, 500, 1000, 2500];

// ----------------------------------------------------------------------------------------------
// @desc Name the range a task count falls in, such as "0", "10-49", or "2500+".
// @param {number} count - A non-negative task count.
// @returns {string} The range's label.
export function taskCountBucket(count) {
  const floorIndex = TASK_COUNT_BUCKET_FLOORS.findLastIndex(floor => count >= floor);
  const floor = TASK_COUNT_BUCKET_FLOORS[floorIndex];
  const nextFloor = TASK_COUNT_BUCKET_FLOORS[floorIndex + 1];
  if (nextFloor === undefined) return `${ floor }+`;
  if (nextFloor - floor === 1) return String(floor);
  return `${ floor }-${ nextFloor - 1 }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Count the tasks in a Task Domain's task list that are neither completed nor dismissed.
// @param {Array<object>|null} tasks - The domain's tasks, as the dashboard's initial payload carries them.
// @returns {number} How many are open.
export function countOpenTasks(tasks) {
  if (!Array.isArray(tasks)) return 0;
  const openTasks = tasks.filter(task => task && !task.completedAt && !task.dismissedAt);
  return openTasks.length;
}

// ----------------------------------------------------------------------------------------------
// @desc Count the tasks completed in a Task Domain over the past seven days, giving up after
//   COMPLETED_TASK_COUNT_TIMEOUT_MILLISECONDS so a slow host never holds back the load event for long.
// @param {object} app - Amplenote app interface (embed-side), with getCompletedTasks.
// @param {string|null} domainUuid - The Dashboard's Task Domain, or null to count completions in every note.
// @param {Date} [now=new Date()] - End of the window.
// @returns {Promise<number|null>} The count, or null when the lookup is unavailable, fails, or times out.
export async function fetchCompletedTaskCount(app, domainUuid, now = new Date()) {
  if (typeof app?.getCompletedTasks !== "function") return null;
  const toSeconds = Math.floor(now.getTime() / 1000);
  const fromSeconds = toSeconds - COMPLETED_TASK_DAYS * 24 * 60 * 60;
  const lookupOptions = domainUuid ? { taskDomainUUID: domainUuid } : {};
  let timeoutId = null;
  const timeout = new Promise(resolve => { timeoutId = setTimeout(() => resolve(null), COMPLETED_TASK_COUNT_TIMEOUT_MILLISECONDS); });
  const lookup = (async () => {
    const tasks = await app.getCompletedTasks(fromSeconds, toSeconds, lookupOptions);
    return Array.isArray(tasks) ? tasks.length : null;
  })();
  try {
    return await Promise.race([lookup, timeout]);
  } catch (error) {
    logIfEnabled("[dashboard-load-task-counts] getCompletedTasks failed", error?.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Build the load event's task count properties. Plausible keeps property values as strings.
// @param {object} counts - An object with the following properties:
//   - {number} openTaskCount - Open tasks in the Task Domain
//   - {number|null} completedTaskCount - Tasks completed in the past seven days, or null when unknown
// @returns {object} { openTaskCount, openTaskBucket } plus { completedTaskCount7Days, completedTaskBucket7Days } when
//   the completed count is known.
export function taskCountEventProps({ completedTaskCount, openTaskCount }) {
  const eventProps = { openTaskBucket: taskCountBucket(openTaskCount), openTaskCount: String(openTaskCount) };
  if (completedTaskCount === null || completedTaskCount === undefined) return eventProps;
  return { ...eventProps, completedTaskBucket7Days: taskCountBucket(completedTaskCount), completedTaskCount7Days: String(completedTaskCount) };
}
