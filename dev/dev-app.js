/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-opus-4-6
 * Task: Dev-mode app harness with file-backed settings persistence
 * Prompt summary: "emulate Amplenote app.settings with a local JSON file so dev mode persists state"
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SETTINGS_PATH = path.join(__dirname, "settings.json");

const SAMPLE_DOMAINS = [
  { name: "Work", uuid: "domain-work-uuid" },
  { name: "Personal", uuid: "domain-personal-uuid" },
  { name: "Side Projects", uuid: "domain-side-uuid" },
];

// [Claude] Task: generate sample tasks matching the shape returned by Amplenote's getTaskDomainTasks
// Prompt: "existing tasks completed over past 2 weeks, plus 20 new tasks with/without start times"
// Date: 2026-03-01 | Model: claude-opus-4-6
function _buildSampleTasks() {
  const nowSec = Math.floor(Date.now() / 1000);
  const day = 86400;
  const hour = 3600;

  // Existing tasks — all completed at varying points over the past 14 days
  const completedTasks = [
    {
      uuid: "dev-task-0", content: "Review quarterly goals", important: true, urgent: false,
      dismissedAt: null, deadline: null, victoryValue: 8,
      noteUUID: "note-work-1", startAt: nowSec - 14 * day,
      completedAt: nowSec - 13 * day + 2 * hour,
    },
    {
      uuid: "dev-task-1", content: "Stand-up meeting", important: false, urgent: false,
      dismissedAt: null, deadline: null, victoryValue: 3,
      noteUUID: "note-work-2", startAt: nowSec - 12 * day,
      completedAt: nowSec - 12 * day + hour,
    },
    {
      uuid: "dev-task-2", content: "Deep work: feature implementation", important: true, urgent: true,
      dismissedAt: null, deadline: null, victoryValue: 12,
      noteUUID: "note-work-3", startAt: nowSec - 11 * day,
      completedAt: nowSec - 10 * day + 4 * hour,
    },
    {
      uuid: "dev-task-3", content: "Reply to design feedback", important: false, urgent: true,
      dismissedAt: null, deadline: null, victoryValue: 5,
      noteUUID: "note-work-4", startAt: nowSec - 9 * day,
      completedAt: nowSec - 9 * day + 3 * hour,
    },
    {
      uuid: "dev-task-4", content: "📫 Message one luminary or press", important: false, urgent: false,
      dismissedAt: null, deadline: null, victoryValue: 6,
      noteUUID: "note-personal-1", startAt: nowSec - 8 * day,
      completedAt: nowSec - 7 * day + 5 * hour,
    },
    {
      uuid: "dev-task-5", content: "🏃 Jog", important: false, urgent: false,
      dismissedAt: null, deadline: null, victoryValue: 5,
      noteUUID: "note-personal-2", startAt: nowSec - 6 * day,
      completedAt: nowSec - 6 * day + hour,
    },
    {
      uuid: "dev-task-6", content: "💼 Update budget", important: false, urgent: false,
      dismissedAt: null, deadline: null, victoryValue: 4,
      noteUUID: "note-work-5", startAt: nowSec - 5 * day,
      completedAt: nowSec - 4 * day + 2 * hour,
    },
    {
      uuid: "dev-task-7", content: "Recurring todo for testing offline functionality",
      important: false, urgent: false, victoryValue: 2,
      noteUUID: "note-work-6", startAt: nowSec - 3 * day,
      completedAt: nowSec - 3 * day + hour, dismissedAt: null, deadline: null,
    },
    {
      uuid: "dev-task-8", content: "🎉 Wish Jessica a happy bday",
      important: false, urgent: false, victoryValue: 3,
      noteUUID: "note-personal-3", startAt: nowSec - 2 * day,
      completedAt: nowSec - 2 * day + hour, dismissedAt: null, deadline: null,
    },
    {
      uuid: "dev-task-9", content: "Look up and schedule interesting Kexp performances",
      important: false, urgent: false, victoryValue: 4,
      noteUUID: "note-personal-4", startAt: nowSec - day,
      completedAt: nowSec - day + 2 * hour, dismissedAt: null, deadline: null,
    },
  ];

  // 20 new open tasks — ~half unscheduled, ~half starting within the next 5 days
  const newTasks = [
    {
      uuid: "dev-task-10", content: "Draft blog post outline", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 7,
      noteUUID: "note-side-1", startAt: null,
    },
    {
      uuid: "dev-task-11", content: "Prepare sprint retro notes", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 4,
      noteUUID: "note-work-7", startAt: nowSec + 4 * hour,
    },
    {
      uuid: "dev-task-12", content: "Research caching strategies for API layer", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 9,
      noteUUID: "note-work-8", startAt: null,
    },
    {
      uuid: "dev-task-13", content: "🛒 Order new running shoes", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 3,
      noteUUID: "note-personal-5", startAt: nowSec + day + 10 * hour,
    },
    {
      uuid: "dev-task-14", content: "Fix flaky integration test suite", important: true, urgent: true,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 10,
      noteUUID: "note-work-9", startAt: nowSec + 2 * hour,
    },
    {
      uuid: "dev-task-15", content: "Update project README with setup instructions", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 4,
      noteUUID: "note-side-2", startAt: null,
    },
    {
      uuid: "dev-task-16", content: "Schedule dentist appointment", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 2,
      noteUUID: "note-personal-6", startAt: null,
    },
    {
      uuid: "dev-task-17", content: "Review and merge open pull requests", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 8,
      noteUUID: "note-work-10", startAt: nowSec + 2 * day + 9 * hour,
    },
    {
      uuid: "dev-task-18", content: "📖 Read chapter 5 of distributed systems book", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 5,
      noteUUID: "note-personal-7", startAt: null,
    },
    {
      uuid: "dev-task-19", content: "Write unit tests for settings module", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 7,
      noteUUID: "note-work-11", startAt: nowSec + 3 * day + 14 * hour,
    },
    {
      uuid: "dev-task-20", content: "Clean up unused CSS classes", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 3,
      noteUUID: "note-work-12", startAt: null,
    },
    {
      uuid: "dev-task-21", content: "🎸 Practice guitar for 30 minutes", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 4,
      noteUUID: "note-personal-8", startAt: nowSec + day + 18 * hour,
    },
    {
      uuid: "dev-task-22", content: "Investigate memory leak in dashboard widget", important: true, urgent: true,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 11,
      noteUUID: "note-work-13", startAt: nowSec + 5 * hour,
    },
    {
      uuid: "dev-task-23", content: "Plan weekend hiking trip", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 5,
      noteUUID: "note-personal-9", startAt: null,
    },
    {
      uuid: "dev-task-24", content: "Set up CI pipeline for side project", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 8,
      noteUUID: "note-side-3", startAt: nowSec + 4 * day + 10 * hour,
    },
    {
      uuid: "dev-task-25", content: "Respond to client feedback email", important: false, urgent: true,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 6,
      noteUUID: "note-work-14", startAt: nowSec + 3 * hour,
    },
    {
      uuid: "dev-task-26", content: "Refactor error handling in API routes", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 7,
      noteUUID: "note-work-15", startAt: null,
    },
    {
      uuid: "dev-task-27", content: "🧹 Tidy up home office desk", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 2,
      noteUUID: "note-personal-10", startAt: null,
    },
    {
      uuid: "dev-task-28", content: "Pair-program on auth token refresh logic", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 9,
      noteUUID: "note-work-16", startAt: nowSec + 5 * day + 9 * hour,
    },
    {
      uuid: "dev-task-29", content: "Benchmark database query performance", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 6,
      noteUUID: "note-work-17", startAt: null,
    },
  ];

  return [...completedTasks, ...newTasks];
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

// [Claude] Task: read settings from a JSON file, returning {} if missing or corrupt
// Date: 2026-03-01 | Model: claude-opus-4-6
export function readSettingsFile(settingsPath = DEFAULT_SETTINGS_PATH) {
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// [Claude] Task: atomically write settings object to JSON file
// Date: 2026-03-01 | Model: claude-opus-4-6
export function writeSettingsFile(settings, settingsPath = DEFAULT_SETTINGS_PATH) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Dev App Factory
// ---------------------------------------------------------------------------

// [Claude] Task: create an app object that mirrors the Amplenote plugin app interface for local dev
// Prompt: "dev mode should persist settings to a JSON file and return sample tasks"
// Date: 2026-03-01 | Model: claude-opus-4-6
export function createDevApp(settingsPath = DEFAULT_SETTINGS_PATH) {
  const settings = readSettingsFile(settingsPath);
  const sampleTasks = _buildSampleTasks();

  const app = {
    settings,

    async setSetting(key, value) {
      app.settings[key] = String(value);
      writeSettingsFile(app.settings, settingsPath);
    },

    async getTaskDomains() {
      return SAMPLE_DOMAINS;
    },

    async getTaskDomainTasks(_domainUuid) {
      return sampleTasks;
    },

    async getMoodRatings(_fromUnixSeconds) {
      return [
        { rating: 1 }, { rating: 2 }, { rating: 0 },
        { rating: 1 }, { rating: -1 }, { rating: 2 }, { rating: 1 },
      ];
    },

    async getCompletedTasks(_fromSec, _toSec) {
      return sampleTasks.filter(t => t.completedAt != null);
    },

    async filterNotes(_options) {
      return [];
    },

    async getNoteContent(_noteHandle) {
      return "# Sample Note\n\nThis is dev-mode placeholder content.";
    },

    async createNote(name, _tags) {
      return `dev-note-${Date.now()}`;
    },

    async insertNoteContent(_noteHandle, _content) {
      return true;
    },

    navigate(url) {
      const isValid = /^https:\/\/www\.amplenote\.com\/notes(?:$|[/?].*)/.test(url);
      if (isValid) {
        console.log("[dev-app] navigate", url);
      } else {
        console.warn("[dev-app] navigate rejected invalid URL", url);
      }
      return isValid;
    },

    async openSidebarEmbed() { return true; },
    async openEmbed() { return true; },
    async prompt() { return null; },
  };

  return app;
}

export { SAMPLE_DOMAINS, DEFAULT_SETTINGS_PATH };
