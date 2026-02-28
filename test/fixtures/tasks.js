/**
 * [Claude-authored file]
 * Created: 2026-02-28 | Model: claude-sonnet-4-6
 * Task: Shared task fixtures for DashboardApp integration tests
 * Prompt summary: "move SAMPLE_TASKS to test/fixtures so it can be shared across test files"
 */

// All timestamps are expressed relative to suite-startup time so date-based
// assertions stay correct regardless of when the tests run.
export const nowSec = Math.floor(Date.now() / 1000);

// [Claude] Task: Unix-second timestamp helpers relative to now
// Date: 2026-02-28 | Model: claude-sonnet-4-6
export const daysFromNow = n            => nowSec + n * 86400;
export const daysAgo     = (n, plusSecs = 3600) => nowSec - n * 86400 + plusSecs;

// Two task domains used by tests that exercise domain switching.
export const DOMAINS = [
  { uuid: 'dom-work',     name: 'Work' },
  { uuid: 'dom-personal', name: 'Personal' },
];

// [Claude] Task: representative open and completed tasks matching real Amplenote console output
// Date: 2026-02-28 | Model: claude-sonnet-4-6
export const SAMPLE_TASKS = [
  // ---- Open tasks: upcoming dates ----
  {
    uuid: 'task-0', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 5,
    noteUUID: '1644cdd4-b805-11e9-91c2-6248d9d6f59a',
    startAt: daysFromNow(14),
    content: '2 hours every 2 months cleaning garage',
  },
  {
    uuid: 'task-1', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 3,
    noteUUID: '61de8f16-ab4f-11eb-9cdb-36d5f7651cea',
    startAt: daysFromNow(60),
    content: '30 mins progress on Noteapps Amendments',
  },
  {
    uuid: 'task-2', important: true, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 8,
    noteUUID: 'd499b3d8-534d-11ef-95c7-0663d8339c46',
    startAt: daysFromNow(90),
    content: '📫 Message one luminary or press',
  },
  {
    uuid: 'task-3', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 4,
    noteUUID: 'd499b3d8-534d-11ef-95c7-0663d8339c46',
    startAt: daysFromNow(7),
    content: '📫 2 hours inbox triage',
  },
  {
    uuid: 'task-4', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 5,
    noteUUID: 'd66ed30c-18e6-11ee-85a5-96476340c194',
    startAt: daysFromNow(2),
    content: '🏃 Jog',
  },
  {
    uuid: 'task-5', important: true, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 7,
    noteUUID: 'd499b3d8-534d-11ef-95c7-0663d8339c46',
    startAt: daysFromNow(3),
    content: 'LinkedIn networking from Acquisition Target Research',
  },
  {
    uuid: 'task-6', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 3,
    noteUUID: '6a6686fa-cab0-11ea-bb9f-d266dfb7c760',
    startAt: daysFromNow(5),
    content: 'Finish an item from Personal household todos',
  },
  {
    uuid: 'task-7', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 4,
    noteUUID: '2508625c-7931-11ea-a77f-4a9bae68938e',
    startAt: daysFromNow(1),
    content: '💼 Update budget',
  },
  {
    uuid: 'task-9', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 5,
    noteUUID: '2508625c-7931-11ea-a77f-4a9bae68938e',
    startAt: daysFromNow(10),
    content: '💼 Best deals research',
  },
  // ---- Far-future tasks ----
  {
    uuid: 'task-13', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 2,
    noteUUID: '6a6686fa-cab0-11ea-bb9f-d266dfb7c760',
    startAt: daysFromNow(120),
    content: 'Recharge Eufy cams',
  },
  {
    uuid: 'task-14', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 3,
    noteUUID: '61de8f16-ab4f-11eb-9cdb-36d5f7651cea',
    startAt: daysFromNow(150),
    content: 'Document birthday wisdoms',
  },
  {
    uuid: 'task-15', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 3,
    noteUUID: '61de8f16-ab4f-11eb-9cdb-36d5f7651cea',
    startAt: daysFromNow(180),
    content: 'Wish mom happy bday',
  },
  // ---- No-date task (won't appear in agenda or calendar) ----
  {
    uuid: 'task-16', important: false, urgent: false, dismissedAt: null, completedAt: null,
    deadline: null, victoryValue: 7, startAt: null,
    noteUUID: 'f81b5324-9b37-11f0-95dd-951c7017fb5c',
    content: 'Rotate GK azure key',
  },
  // ---- Completed tasks (within the past 7 days) ----
  {
    uuid: 'task-8', important: false, urgent: false, dismissedAt: null,
    deadline: null, victoryValue: 2,
    noteUUID: '99f0aad8-7cc8-11e7-8c0b-927c2b406244',
    startAt:     daysAgo(1),
    completedAt: daysAgo(1),        // completed yesterday
    content: 'Recurring todo for testing offline functionality',
  },
  {
    uuid: 'task-10', important: false, urgent: false, dismissedAt: null,
    deadline: null, victoryValue: 3,
    noteUUID: '61de8f16-ab4f-11eb-9cdb-36d5f7651cea',
    startAt:     daysAgo(3),
    completedAt: daysAgo(3),        // completed 3 days ago
    content: '🎉 Wish Jessica Wagoner a happy bday',
  },
  {
    uuid: 'task-11', important: false, urgent: false, dismissedAt: null,
    deadline: null, victoryValue: 4,
    noteUUID: '61de8f16-ab4f-11eb-9cdb-36d5f7651cea',
    startAt:     daysAgo(5),
    completedAt: daysAgo(5),        // completed 5 days ago
    content: 'Look up and schedule interesting Kexp performances',
  },
  {
    uuid: 'task-12', important: false, urgent: false, dismissedAt: null,
    deadline: null, victoryValue: 6,
    noteUUID: '2b22510c-0c9d-11eb-a9e1-5a87c7b757d5',
    startAt:     daysAgo(6),
    completedAt: daysAgo(6),        // completed 6 days ago
    content: 'Repack code_lines',
  },
];

export const COMPLETED_TASKS = SAMPLE_TASKS.filter(t => t.completedAt != null);
export const OPEN_TASKS      = SAMPLE_TASKS.filter(t => t.completedAt == null && t.dismissedAt == null);
