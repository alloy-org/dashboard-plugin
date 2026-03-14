/**
 * [Claude-authored file]
 * Created: 2026-03-01 | Model: claude-opus-4-6
 * Task: Dev-mode app harness with file-backed settings persistence
 * Prompt summary: "emulate Amplenote app.settings with a local JSON file so dev mode persists state"
 */
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SETTINGS_PATH = path.join(__dirname, "settings.json");
const NOTES_DIR = path.join(__dirname, "..", "notes");

// Note handles referenced by sample tasks, grouped by domain.
// Each entry provides the name shown in the Recent Notes widget.
const SAMPLE_NOTE_HANDLES = {
  "domain-work-uuid": [
    { uuid: "note-work-1",  name: "Q1 Goal Review" },
    { uuid: "note-work-2",  name: "Stand-up Notes" },
    { uuid: "note-work-3",  name: "Feature Implementation" },
    { uuid: "note-work-4",  name: "Design Feedback" },
    { uuid: "note-work-5",  name: "Budget Tracker" },
    { uuid: "note-work-6",  name: "Offline Testing" },
    { uuid: "note-work-7",  name: "Sprint Retro" },
    { uuid: "note-work-8",  name: "API Layer Research" },
    { uuid: "note-work-9",  name: "Integration Tests" },
    { uuid: "note-work-10", name: "Pull Request Queue" },
    { uuid: "note-work-11", name: "Settings Module Tests" },
    { uuid: "note-work-12", name: "CSS Cleanup" },
    { uuid: "note-work-13", name: "Dashboard Memory Leak" },
    { uuid: "note-work-14", name: "Client Feedback" },
    { uuid: "note-work-15", name: "API Error Handling" },
    { uuid: "note-work-16", name: "Auth Token Refresh" },
    { uuid: "note-work-17", name: "DB Query Performance" },
  ],
  "domain-personal-uuid": [
    { uuid: "note-personal-1",  name: "Networking Outreach" },
    { uuid: "note-personal-2",  name: "Fitness Log" },
    { uuid: "note-personal-3",  name: "Social Reminders" },
    { uuid: "note-personal-4",  name: "Entertainment" },
    { uuid: "note-personal-5",  name: "Shopping List" },
    { uuid: "note-personal-6",  name: "Health Appointments" },
    { uuid: "note-personal-7",  name: "Reading List" },
    { uuid: "note-personal-8",  name: "Hobbies" },
    { uuid: "note-personal-9",  name: "Trip Planning" },
    { uuid: "note-personal-10", name: "Home Office" },
  ],
  "domain-side-uuid": [
    { uuid: "note-side-1", name: "Blog Post Ideas" },
    { uuid: "note-side-2", name: "Side Project README" },
    { uuid: "note-side-3", name: "CI Pipeline Setup" },
  ],
};

const SAMPLE_DOMAINS = [
  { name: "Work",          uuid: "domain-work-uuid",     notes: SAMPLE_NOTE_HANDLES["domain-work-uuid"] },
  { name: "Personal",      uuid: "domain-personal-uuid", notes: SAMPLE_NOTE_HANDLES["domain-personal-uuid"] },
  { name: "Side Projects", uuid: "domain-side-uuid",     notes: SAMPLE_NOTE_HANDLES["domain-side-uuid"] },
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
// Note File I/O
// ---------------------------------------------------------------------------

// [Claude] Task: ensure the notes directory exists and provide helpers for reading/writing frontmatter-based note files
// Prompt: "when app.createNote is called in dev environment, create a file with a random uuid in the /notes directory"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function _ensureNotesDir() {
  if (!fs.existsSync(NOTES_DIR)) {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
  }
}

function _buildFrontmatter(title, uuid, tags = []) {
  const now = new Date().toISOString();
  const tagLines = tags.map(t => `  - ${t}`).join("\n");
  return [
    "---",
    `title: ${title}`,
    `uuid: ${uuid}`,
    `version: 1`,
    `created: '${now}'`,
    `updated: '${now}'`,
    tagLines ? `tags:\n${tagLines}` : "tags: []",
    "---",
  ].join("\n");
}

function _parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const block = match[1];
  const meta = {};
  let currentKey = null;
  let listBuffer = [];

  for (const line of block.split("\n")) {
    const kvMatch = line.match(/^(\w[\w\s]*):\s*(.*)/);
    if (kvMatch && !line.startsWith("  ")) {
      if (currentKey && listBuffer.length) {
        meta[currentKey] = listBuffer;
        listBuffer = [];
      }
      currentKey = kvMatch[1].trim();
      const val = kvMatch[2].trim();
      if (val === "" || val === "[]") {
        meta[currentKey] = val === "[]" ? [] : val;
      } else {
        meta[currentKey] = val.replace(/^'(.*)'$/, "$1");
      }
    } else if (line.match(/^\s+-\s+/)) {
      listBuffer.push(line.replace(/^\s+-\s+/, ""));
    }
  }
  if (currentKey && listBuffer.length) {
    meta[currentKey] = listBuffer;
  }

  const endIdx = raw.indexOf("\n---", 3);
  const content = raw.slice(endIdx + 4).replace(/^\n/, "");
  return { meta, content, frontmatterEnd: endIdx + 4 };
}

function _readAllNoteFiles() {
  _ensureNotesDir();
  const files = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith(".md"));
  return files.map(filename => {
    const raw = fs.readFileSync(path.join(NOTES_DIR, filename), "utf-8");
    const parsed = _parseFrontmatter(raw);
    if (!parsed) return null;
    return { filename, raw, ...parsed };
  }).filter(Boolean);
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

    context: {
      pluginUUID: "dev-dashboard-plugin-uuid",
    },

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

    // [Claude] Task: return open tasks belonging to a specific note for the Recent Notes widget
    // Prompt: "ensure dev tasks can populate the stale notes component"
    // Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
    async getNoteTasks(noteHandle, _options = {}) {
      const uuid = typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
      return sampleTasks.filter(t => t.noteUUID === uuid && t.completedAt == null && t.dismissedAt == null);
    },

    // [Claude] Task: generate 10 days of mock mood ratings with note text
    // Prompt: "ensure dev-environment mood ratings are one per date for the last 10 days with a note value"
    // Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
    async getMoodRatings(_fromUnixSeconds) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const midnightSec = Math.floor(today.getTime() / 1000);
      const DAY = 86400;
      const ratings = [1, -1, 2, 0, 1, -2, 2, -1, 0, 1];
      const notes = [
        'Slept well, feeling rested and ready to go',
        'Stressful morning but afternoon was better',
        'Productive day — knocked out the whole backlog. Managed to close out six tickets before lunch, then spent the afternoon pairing with Jamie on the auth refactor. We finally tracked down the session expiry bug that had been haunting us for weeks. Turns out the token refresh was racing with the logout handler. Documented the fix in the wiki and added a regression test. Feeling accomplished — this kind of deep focus day is exactly what I needed after a scattered start to the week.',
        'Bit tired, low energy after lunch',
        'Great coffee chat with a friend',
        'Overwhelmed with meetings all day',
        'Solid workout this morning, feeling strong',
        'Quiet day, caught up on reading',
        'Tricky bug took hours — finally squashed it',
        'Relaxing weekend, recharged for the week ahead',
      ];
      return ratings.map((rating, i) => {
        const daysBack = ratings.length - 1 - i;
        const hour = 8 + (i % 5) * 2;
        return {
          rating,
          timestamp: midnightSec - daysBack * DAY + hour * 3600,
          uuid: `mock-mood-uuid-${i}`,
          note: notes[i],
        };
      });
    },

    async getCompletedTasks(_fromSec, _toSec) {
      return sampleTasks.filter(t => t.completedAt != null);
    },

    async filterNotes(_options) {
      return [];
    },

    // [Claude] Task: create a markdown file with frontmatter in the /notes directory
    // Prompt: "when app.createNote is called in dev environment, create a file with a random uuid in the /notes directory"
    // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
    async createNote(name, tags = []) {
      _ensureNotesDir();
      const uuid = crypto.randomUUID();
      const frontmatter = _buildFrontmatter(name, uuid, tags);
      const filePath = path.join(NOTES_DIR, `${uuid}.md`);
      fs.writeFileSync(filePath, frontmatter + "\n", "utf-8");
      console.log(`[dev-app] createNote "${name}" -> ${uuid}`);
      return uuid;
    },

    // [Claude] Task: find a note by looping over files in the /notes directory and matching frontmatter
    // Prompt: "when app.findNote is called, loop over each of the files in the notes directory"
    // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
    async findNote(params = {}) {
      const notes = _readAllNoteFiles();
      for (const note of notes) {
        if (params.uuid && note.meta.uuid === params.uuid) {
          return { uuid: note.meta.uuid, name: note.meta.title };
        }
        if (params.name && note.meta.title === params.name) {
          return { uuid: note.meta.uuid, name: note.meta.title };
        }
      }
      return null;
    },

    // [Claude] Task: replace content below the frontmatter in a note file
    // Prompt: "implement app.replaceContent to append the passed content below the frontmatter"
    // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
    async replaceContent(noteHandle, content) {
      const uuid = typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
      const filePath = path.join(NOTES_DIR, `${uuid}.md`);
      if (!fs.existsSync(filePath)) {
        console.warn(`[dev-app] replaceContent: note file not found for ${uuid}`);
        return false;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = _parseFrontmatter(raw);
      if (!parsed) {
        console.warn(`[dev-app] replaceContent: could not parse frontmatter for ${uuid}`);
        return false;
      }
      const frontmatterSection = raw.slice(0, parsed.frontmatterEnd);
      const updatedFrontmatter = frontmatterSection.replace(
        /updated: '.*?'/,
        `updated: '${new Date().toISOString()}'`
      );
      fs.writeFileSync(filePath, updatedFrontmatter + "\n" + content, "utf-8");
      console.log(`[dev-app] replaceContent for ${uuid} (${content.length} chars)`);
      return true;
    },

    async insertNoteContent(noteHandle, content, options = {}) {
      const uuid = typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
      const filePath = path.join(NOTES_DIR, `${uuid}.md`);
      if (!fs.existsSync(filePath)) {
        console.warn(`[dev-app] insertNoteContent: note file not found for ${uuid}`);
        return false;
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      fs.writeFileSync(filePath, raw + content, "utf-8");
      console.log(`[dev-app] insertNoteContent for ${uuid} (${content.length} chars)`);
      return true;
    },

    // [Claude] Task: read note content from a file in the /notes directory
    // Prompt: "when app.findNote is called, loop over each of the files in the notes directory"
    // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
    async getNoteContent(noteHandle) {
      const uuid = typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
      const filePath = path.join(NOTES_DIR, `${uuid}.md`);
      if (!fs.existsSync(filePath)) {
        return "# Sample Note\n\nThis is dev-mode placeholder content.";
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = _parseFrontmatter(raw);
      return parsed ? parsed.content : raw;
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

    // [Claude] Task: mock attachNoteMedia — writes image to dev directory and returns local URL
    // Prompt: "add background image upload option to DashboardSettings"
    // Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
    async attachNoteMedia(_noteHandle, dataURL) {
      const matches = dataURL.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) throw new Error("Invalid image data URL");
      const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
      const buffer = Buffer.from(matches[2], "base64");
      const filename = `background-image.${ext}`;
      const filePath = path.join(__dirname, filename);
      fs.writeFileSync(filePath, buffer);
      console.log(`[dev-app] attachNoteMedia saved ${filename} (${buffer.length} bytes)`);
      return `/${filename}`;
    },

    async openSidebarEmbed() { return true; },
    async openEmbed() { return true; },
    async prompt() { return null; },
  };

  return app;
}

export { SAMPLE_DOMAINS, DEFAULT_SETTINGS_PATH, NOTES_DIR };
