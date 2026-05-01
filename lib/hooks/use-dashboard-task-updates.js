/**
 * [OpenAI GPT-5.5-authored file]
 * Prompt summary: "extract dashboard task-update event handling into a standalone hook"
 */
import { useEffect } from "react";
import { logIfEnabled } from "util/log";

export const DASHBOARD_TASKS_UPDATED_EVENT = "dashboard:tasks-updated";

// ------------------------------------------------------------------------------------------
// @description Merges a newly scheduled task event into the current open-task snapshot for immediate widget refresh.
// @param {Object<string, Array<Object>>} openTasks - Current grouped open tasks.
// @param {Object} eventDetail - DASHBOARD_TASKS_UPDATED_EVENT detail.
// @returns {Array<Object>} Flat open-task list with the scheduled task upserted.
// [OpenAI GPT-5.5] Task: refresh scheduled widgets after DreamTask creates a task
// Prompt: "make the new task handler a standalone hook"
function openTasksWithScheduledTask(openTasks, eventDetail) {
  const existingTasks = Object.values(openTasks || {}).flat();
  if (!eventDetail?.taskUuid) return existingTasks;
  const scheduledTask = {
    content: eventDetail.content || "Untitled task",
    noteUUID: eventDetail.noteUUID || null,
    startAt: eventDetail.startAt,
    uuid: eventDetail.taskUuid,
  };
  return [...existingTasks.filter(task => task.uuid !== scheduledTask.uuid), scheduledTask];
}

// ------------------------------------------------------------------------------------------
// @description Listens for dashboard task update events and refreshes task-domain state.
// @param {Object} params
// @param {string|null} params.activeTaskDomain - Active task domain UUID.
// @param {Object} params.app - Amplenote app bridge.
// @param {Function} params.onDomainChange - useDomainTasks domain/task update callback.
// @param {Object<string, Array<Object>>} params.openTasks - Current grouped open tasks.
// [OpenAI GPT-5.5] Task: refresh scheduled widgets after DreamTask creates a task
// Prompt: "make the new task handler a standalone hook"
export default function useDashboardTaskUpdates({ activeTaskDomain, app, onDomainChange, openTasks }) {
  useEffect(() => {
    const handleTasksUpdated = async (event) => {
      onDomainChange(null, activeTaskDomain, { tasks: openTasksWithScheduledTask(openTasks, event.detail) });
      if (!activeTaskDomain) return;
      try {
        const tasks = await app.getTaskDomainTasks(activeTaskDomain);
        if (Array.isArray(tasks)) onDomainChange(null, activeTaskDomain, { tasks });
      } catch (err) {
        logIfEnabled("[dashboard] failed to refresh task domain tasks after update", err);
      }
    };
    window.addEventListener(DASHBOARD_TASKS_UPDATED_EVENT, handleTasksUpdated);
    return () => window.removeEventListener(DASHBOARD_TASKS_UPDATED_EVENT, handleTasksUpdated);
  }, [activeTaskDomain, app, onDomainChange, openTasks]);
}
