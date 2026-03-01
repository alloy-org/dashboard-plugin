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
// Prompt: "dev mode should return the array of sample tasks when queried for getTaskDomainTasks"
// Date: 2026-03-01 | Model: claude-opus-4-6
function _buildSampleTasks() {
  const nowSec = Math.floor(Date.now() / 1000);
  const day = 86400;

  return [
    {
      uuid: "dev-task-0", content: "Review quarterly goals", important: true, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 8,
      noteUUID: "note-work-1", startAt: nowSec + day,
    },
    {
      uuid: "dev-task-1", content: "Stand-up meeting", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 3,
      noteUUID: "note-work-2", startAt: nowSec + day + 3600,
    },
    {
      uuid: "dev-task-2", content: "Deep work: feature implementation", important: true, urgent: true,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 12,
      noteUUID: "note-work-3", startAt: nowSec + 2 * day,
    },
    {
      uuid: "dev-task-3", content: "Reply to design feedback", important: false, urgent: true,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 5,
      noteUUID: "note-work-4", startAt: nowSec + 3 * day,
    },
    {
      uuid: "dev-task-4", content: "📫 Message one luminary or press", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 6,
      noteUUID: "note-personal-1", startAt: nowSec + 7 * day,
    },
    {
      uuid: "dev-task-5", content: "🏃 Jog", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 5,
      noteUUID: "note-personal-2", startAt: nowSec + 2 * day,
    },
    {
      uuid: "dev-task-6", content: "💼 Update budget", important: false, urgent: false,
      completedAt: null, dismissedAt: null, deadline: null, victoryValue: 4,
      noteUUID: "note-work-5", startAt: nowSec + day,
    },
    {
      uuid: "dev-task-7", content: "Recurring todo for testing offline functionality",
      important: false, urgent: false, victoryValue: 2,
      noteUUID: "note-work-6", startAt: nowSec - day,
      completedAt: nowSec - day + 3600, dismissedAt: null, deadline: null,
    },
    {
      uuid: "dev-task-8", content: "🎉 Wish Jessica a happy bday",
      important: false, urgent: false, victoryValue: 3,
      noteUUID: "note-personal-3", startAt: nowSec - 3 * day,
      completedAt: nowSec - 3 * day + 1800, dismissedAt: null, deadline: null,
    },
    {
      uuid: "dev-task-9", content: "Look up and schedule interesting Kexp performances",
      important: false, urgent: false, victoryValue: 4,
      noteUUID: "note-personal-4", startAt: nowSec - 5 * day,
      completedAt: nowSec - 5 * day + 7200, dismissedAt: null, deadline: null,
    },
  ];
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
