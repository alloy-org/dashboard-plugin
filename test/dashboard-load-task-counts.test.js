// Covers the task counts the dashboard's load event carries: open tasks, tasks completed in the past week, and the
// ranges each count is reported in.
import { jest } from "@jest/globals";

const { COMPLETED_TASK_COUNT_TIMEOUT_MILLISECONDS, countOpenTasks, fetchCompletedTaskCount, taskCountBucket,
  taskCountEventProps } = await import("dashboard/dashboard-load-task-counts");

test("names the range each count falls in", () => {
  const bucketsByCount = { 0: "0", 1: "1-9", 9: "1-9", 10: "10-49", 99: "50-99", 100: "100-249", 999: "500-999",
    1000: "1000-2499", 2500: "2500+", 40000: "2500+" };
  for (const [count, bucket] of Object.entries(bucketsByCount)) expect(taskCountBucket(Number(count))).toBe(bucket);
});

test("counts only tasks that are neither completed nor dismissed", () => {
  const tasks = [{ uuid: "a" }, { completedAt: 1700000000, uuid: "b" }, { dismissedAt: 1700000000, uuid: "c" }, null];
  expect(countOpenTasks(tasks)).toBe(1);
  expect(countOpenTasks(null)).toBe(0);
});

test("looks up the past seven days of completions in the Task Domain", async () => {
  const app = { getCompletedTasks: jest.fn(async () => [{ uuid: "a" }, { uuid: "b" }]) };
  const now = new Date("2026-10-27T12:00:00Z");
  const count = await fetchCompletedTaskCount(app, "domain-uuid", now);
  const toSeconds = Math.floor(now.getTime() / 1000);
  expect(count).toBe(2);
  expect(app.getCompletedTasks).toHaveBeenCalledWith(toSeconds - 7 * 24 * 60 * 60, toSeconds, { taskDomainUUID: "domain-uuid" });
});

test("reports an unknown completed count when the lookup fails, is missing, or times out", async () => {
  expect(await fetchCompletedTaskCount({ getCompletedTasks: async () => { throw new Error("offline"); } }, null)).toBeNull();
  expect(await fetchCompletedTaskCount({}, null)).toBeNull();
  jest.useFakeTimers();
  const pending = fetchCompletedTaskCount({ getCompletedTasks: () => new Promise(() => {}) }, null);
  jest.advanceTimersByTime(COMPLETED_TASK_COUNT_TIMEOUT_MILLISECONDS);
  expect(await pending).toBeNull();
  jest.useRealTimers();
});

test("sends each count exactly and as a range, leaving out an unknown completed count", () => {
  expect(taskCountEventProps({ completedTaskCount: 12, openTaskCount: 143 })).toEqual({ completedTaskBucket7Days: "10-49",
    completedTaskCount7Days: "12", openTaskBucket: "100-249", openTaskCount: "143" });
  expect(taskCountEventProps({ completedTaskCount: null, openTaskCount: 0 })).toEqual({ openTaskBucket: "0", openTaskCount: "0" });
});
