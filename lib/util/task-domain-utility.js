// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Shared task-domain lookup helpers.
// Prompt summary: "Move generic task-domain UUID lookup helpers out of recommendation-context."

// ----------------------------------------------------------------------------------------------
// @desc Return task UUIDs visible in the given task domain for callers that need to scope task-derived data.
// @param {object} app - Amplenote app bridge.
// @param {string|null} domainUuid - Task domain UUID.
// @returns {Promise<Set<string>|null>} Task UUID set, or null when no domain/list is available.
// [OpenAI GPT-5.5] Task: share task-domain UUID filtering for completed-task analysis
export async function domainTaskUuidSet(app, domainUuid) {
  if (!domainUuid || typeof app.getTaskDomainTasks !== "function") return null;
  const tasks = await app.getTaskDomainTasks(domainUuid).catch(() => null);
  if (!Array.isArray(tasks)) return null;
  return new Set(tasks.map(task => task?.uuid).filter(Boolean));
}
