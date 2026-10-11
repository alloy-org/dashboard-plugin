// Color the Victory Value chart by the project each completed task advanced, as the completed task ledger recorded it.
// Projects take a color slot in the order the ledger first records them, so a project keeps its color for the rest of
// the quarter. Six slots are available; when a quarter's ledger names more than six projects, the sixth slot is shared
// by every project past the fifth and labeled "Other projects". A completion the ledger holds no project for keeps the
// chart's accent color, so a week with no ledger data draws exactly as it did before.
import { ledgerEntryKey } from "dashboard/projects/completed-task-project-ledger";

export const PROJECT_COLOR_SLOT_COUNT = 6;
export const NO_PROJECT_COLOR_TOKEN = "--dashboard-color-background-accent";
export const NO_PROJECT_LABEL = "No project";
export const OTHER_PROJECTS_LABEL = "Other projects";
// Segment key of the completions no project claimed.
export const NO_PROJECT_KEY = "none";

// ----------------------------------------------------------------------------------------------
// @desc Give each project the ledger names a color slot, in the order the ledger first records it.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key, as readCompletedTaskLedger returns them;
//   dates are read oldest first whatever order the map holds them in.
// @returns {Map<string, object>} By project UUID: { colorToken, key, label, slot }. Projects sharing the last slot share its
//   key ("slot-6") and the "Other projects" label, so they draw as one segment.
export function projectColorAssignments(entriesByDate) {
  const projectNamesByUuid = new Map();
  const chronologicalDateKeys = [...entriesByDate.keys()].sort();
  for (const dateKey of chronologicalDateKeys) {
    for (const entry of entriesByDate.get(dateKey) || []) {
      if (entry?.projectUuid && !projectNamesByUuid.has(entry.projectUuid)) projectNamesByUuid.set(entry.projectUuid, entry.projectName || "");
    }
  }
  const overflowing = projectNamesByUuid.size > PROJECT_COLOR_SLOT_COUNT;
  const assignments = new Map();
  [...projectNamesByUuid.entries()].forEach(([projectUuid, projectName], index) => {
    const slot = Math.min(index + 1, PROJECT_COLOR_SLOT_COUNT);
    const shared = overflowing && slot === PROJECT_COLOR_SLOT_COUNT;
    assignments.set(projectUuid, { colorToken: `--dashboard-color-category-${ slot }`, key: shared ? `slot-${ slot }` : projectUuid,
      label: shared ? OTHER_PROJECTS_LABEL : projectName, slot });
  });
  return assignments;
}

// ----------------------------------------------------------------------------------------------
// @desc Index the ledger's entries by completion, the task on the day it was completed, as the chart groups tasks.
// @param {Map<string, Array<object>>} entriesByDate - Ledger entries by date key.
// @returns {Map<string, string|null>} Project UUID, or null for "no project", by ledgerEntryKey.
export function projectUuidsByCompletion(entriesByDate) {
  const projectUuids = new Map();
  for (const [dateKey, entries] of entriesByDate) {
    for (const entry of entries || []) {
      if (!entry?.taskUuid) continue;
      projectUuids.set(ledgerEntryKey({ dateKey: entry.dateKey || dateKey, taskUuid: entry.taskUuid }), entry.projectUuid || null);
    }
  }
  return projectUuids;
}

// ----------------------------------------------------------------------------------------------
// @desc The color and label a completed task is drawn with.
// @param {object} task - A completed task carrying uuid.
// @param {string} dateKey - The day the chart lists it under.
// @param {object|null} completedTaskProjects - { colorAssignments, projectUuidsByCompletion }, or null without ledger data.
// @returns {object|null} The project's { colorToken, key, label, slot }, or null when no project claims the task.
export function completedTaskProjectColor(task, dateKey, completedTaskProjects) {
  if (!completedTaskProjects || !task?.uuid) return null;
  const projectUuid = completedTaskProjects.projectUuidsByCompletion.get(ledgerEntryKey({ dateKey, taskUuid: task.uuid }));
  return (projectUuid && completedTaskProjects.colorAssignments.get(projectUuid)) || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Split one day's victory value into a segment per project, so the day's bar can be drawn stacked.
// @param {Array<object>} tasksForDay - The day's completed tasks, carrying uuid and victoryValue.
// @param {string} dateKey - The day.
// @param {object|null} completedTaskProjects - { colorAssignments, projectUuidsByCompletion }, or null without ledger data.
// @returns {Array<object>} { colorToken, key, label, slot, value }: "No project" first, as slot 0, so it sits at the
//   bar's base, then the projects by color slot. Segments with no value are left out.
export function dailyProjectSegments(tasksForDay, dateKey, completedTaskProjects) {
  const segmentsByKey = new Map();
  for (const task of tasksForDay || []) {
    const color = completedTaskProjectColor(task, dateKey, completedTaskProjects);
    const key = color ? color.key : NO_PROJECT_KEY;
    if (!segmentsByKey.has(key)) segmentsByKey.set(key, { colorToken: color ? color.colorToken : NO_PROJECT_COLOR_TOKEN, key,
      label: color ? color.label : NO_PROJECT_LABEL, slot: color ? color.slot : 0, value: 0 });
    segmentsByKey.get(key).value += task.victoryValue || 0;
  }
  const valuedSegments = [...segmentsByKey.values()].filter(segment => segment.value > 0);
  const orderedSegments = valuedSegments.sort((first, second) => first.slot - second.slot);
  return orderedSegments;
}

// ----------------------------------------------------------------------------------------------
// @desc The legend for the displayed days: each project with value in them, in slot order, and "No project" last when
//   the days also hold unclaimed value. Empty when no displayed day has a project segment.
// @param {Array<object>} dailyValues - The displayed days, each carrying segments.
// @returns {Array<object>} { colorToken, key, label, slot }.
export function projectLegendItems(dailyValues) {
  const itemsByKey = new Map();
  for (const day of dailyValues || []) {
    for (const segment of day.segments || []) {
      if (itemsByKey.has(segment.key)) continue;
      itemsByKey.set(segment.key, { colorToken: segment.colorToken, key: segment.key, label: segment.label, slot: segment.slot });
    }
  }
  const noProjectItem = itemsByKey.get(NO_PROJECT_KEY);
  itemsByKey.delete(NO_PROJECT_KEY);
  if (!itemsByKey.size) return [];
  const projectItems = [...itemsByKey.values()].sort((first, second) => first.slot - second.slot);
  return noProjectItem ? [...projectItems, noProjectItem] : projectItems;
}
