/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Browser-side dev app — full simulation of Amplenote plugin app interface
 * Prompt summary: "dev app simulates all app functions, reducing or eliminating callPlugin"
 */

const CONSOLE_LOGGING_KEY = "Console logging";
function _widgetConfigKey(widgetId) { return `dashboard_${widgetId}_config`; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _resolveUUID(noteHandle) {
  return typeof noteHandle === "string" ? noteHandle : noteHandle?.uuid;
}

function _parseHeadingsFromMarkdown(content) {
  const matches = content.match(/^(#{1,6})\s+(.+)$/gm) || [];
  return matches.map((line, i) => ({
    heading: {
      text: line.replace(/^#{1,6}\s+/, '').trim(),
      level: (line.match(/^#+/) || [''])[0].length,
    },
    index: i,
  }));
}

function _millisFromUnix(unixSec) {
  if (unixSec == null) return null;
  return unixSec < 1e10 ? unixSec * 1000 : unixSec;
}

function _getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function _filterTodayTasks(tasks, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 86400000;
  return tasks.filter(t => {
    const ms = _millisFromUnix(t.startAt);
    return !t.completedAt && !t.dismissedAt && ms != null && ms >= dayStart && ms < dayEnd;
  });
}

function _filterCompletedInWeek(tasks, weekStart) {
  const start = weekStart.getTime();
  const end = start + 7 * 86400000;
  return tasks.filter(t => {
    const ms = _millisFromUnix(t.completedAt);
    return ms != null && ms >= start && ms < end;
  });
}

function _calcWeeklyVictoryValue(tasks, weekStart) {
  return _filterCompletedInWeek(tasks, weekStart).reduce((sum, t) => sum + (t.victoryValue || 0), 0);
}

function _calcDailyVictoryValues(tasks, weekStart) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return names.map((day, i) => {
    const dayStart = new Date(weekStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayTasks = tasks.filter(t => {
      const ms = _millisFromUnix(t.completedAt);
      return ms != null && ms >= dayStart.getTime() && ms < dayEnd.getTime();
    });
    return {
      day,
      date: dayStart.toISOString(),
      value: dayTasks.reduce((sum, t) => sum + (t.victoryValue || 0), 0),
      taskCount: dayTasks.length,
    };
  });
}

function _quarterMonthNames(quarter) {
  const allMonths = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const start = (quarter - 1) * 3;
  return [allMonths[start], allMonths[start + 1], allMonths[start + 2]];
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

let _persistedSettings = null;

async function _loadSettings() {
  if (_persistedSettings !== null) return _persistedSettings;
  try {
    const res = await fetch("/api/settings");
    _persistedSettings = await res.json();
  } catch {
    _persistedSettings = {};
  }
  return _persistedSettings;
}

async function _saveSetting(key, value) {
  const settings = await _loadSettings();
  settings[key] = value;
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch (err) {
    console.warn("[dev-app] failed to persist setting", key, err);
  }
}

// ---------------------------------------------------------------------------
// Task fetching
// ---------------------------------------------------------------------------

async function _fetchAllTasks() {
  try {
    const res = await fetch("/api/tasks");
    return await res.json();
  } catch {
    return [];
  }
}

async function _fetchCompletedTasksInRange(fromSec, toSec) {
  try {
    const res = await fetch(`/api/tasks?from=${fromSec}&to=${toSec}`);
    return await res.json();
  } catch {
    return [];
  }
}

async function _fetchMoodRatings(fromSec) {
  try {
    const url = fromSec ? `/api/moods?from=${fromSec}` : '/api/moods';
    const res = await fetch(url);
    return await res.json();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Domain data
// ---------------------------------------------------------------------------

const _SAMPLE_NOTE_HANDLES = {
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

const _SAMPLE_DOMAINS_WITH_NOTES = [
  { name: "Work",          uuid: "domain-work-uuid",     notes: _SAMPLE_NOTE_HANDLES["domain-work-uuid"] },
  { name: "Personal",      uuid: "domain-personal-uuid", notes: _SAMPLE_NOTE_HANDLES["domain-personal-uuid"] },
  { name: "Side Projects", uuid: "domain-side-uuid",     notes: _SAMPLE_NOTE_HANDLES["domain-side-uuid"] },
];

// ---------------------------------------------------------------------------
// Note helpers via dev server API
// ---------------------------------------------------------------------------

async function _findNoteByName(name) {
  try {
    const res = await fetch(`/api/note-find?name=${encodeURIComponent(name)}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function _fetchNoteSections(uuid) {
  try {
    const app = createBrowserDevApp();
    const content = await app.getNoteContent(uuid);
    return _parseHeadingsFromMarkdown(content || '');
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Dev App Factory
// ---------------------------------------------------------------------------

let _instance = null;

// [Claude] Task: full browser-side dev app simulating all Amplenote plugin functionality
// Prompt: "dev app simulates all requisite functionality provided by the plugin environment"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export function createBrowserDevApp() {
  if (_instance) return _instance;

  const _navigate = (url) => {
    const isValid = /^https:\/\/www\.amplenote\.com\/notes(?:$|[/?].*)/.test(url);
    if (isValid) {
      console.log("[dev-app] navigate", url);
    } else {
      console.warn("[dev-app] navigate rejected invalid URL", url);
    }
    return isValid;
  };

  _instance = {
    settings: {},

    // ------------------------------------------------------------------
    // Init
    // ------------------------------------------------------------------
    async init() {
      const settings = await _loadSettings();
      if (!settings[CONSOLE_LOGGING_KEY]) settings[CONSOLE_LOGGING_KEY] = "true";

      if (typeof settings.dashboard_elements === "string") {
        try { settings.dashboard_elements = JSON.parse(settings.dashboard_elements); }
        catch { settings.dashboard_elements = null; }
      }
      for (const key of [_widgetConfigKey("victory-value"), _widgetConfigKey("calendar"), _widgetConfigKey("mood"), _widgetConfigKey("quotes")]) {
        if (typeof settings[key] === "string") {
          try { settings[key] = JSON.parse(settings[key]); }
          catch { settings[key] = null; }
        }
      }

      const now = new Date();
      const weekStart = _getWeekStart(now);
      const tasks = await _fetchAllTasks();
      const moodRatings = await _fetchMoodRatings();

      const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
      const currentLabel = `Q${currentQuarter} ${now.getFullYear()}`;
      const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
      const nextYear = currentQuarter === 4 ? now.getFullYear() + 1 : now.getFullYear();
      const nextLabel = `Q${nextQuarter} ${nextYear}`;

      const [currentFound, nextFound] = await Promise.all([
        _findNoteByName(`${currentLabel} Plan`),
        _findNoteByName(`${nextLabel} Plan`),
      ]);

      const [currentSections, nextSections] = await Promise.all([
        currentFound?.uuid ? _fetchNoteSections(currentFound.uuid) : Promise.resolve([]),
        nextFound?.uuid    ? _fetchNoteSections(nextFound.uuid)    : Promise.resolve([]),
      ]);
      const currentMonths = _quarterMonthNames(currentQuarter);
      const nextMonths    = _quarterMonthNames(nextQuarter);
      const currentHasAll = currentMonths.every(m => currentSections.some(s => s.heading?.text?.trim().toLowerCase() === m.toLowerCase()));
      const nextHasAll    = nextMonths.every(m => nextSections.some(s => s.heading?.text?.trim().toLowerCase() === m.toLowerCase()));

      _instance.settings = settings;

      return {
        tasks,
        todayTasks: _filterTodayTasks(tasks, now),
        completedThisWeek: _filterCompletedInWeek(tasks, weekStart),
        weeklyVictoryValue: _calcWeeklyVictoryValue(tasks, weekStart),
        dailyVictoryValues: _calcDailyVictoryValues(tasks, weekStart),
        moodRatings,
        quarterlyPlans: {
          current: {
            year: now.getFullYear(),
            quarter: currentQuarter,
            label: currentLabel,
            noteUUID: currentFound?.uuid ?? null,
            hasAllMonthlyDetails: currentHasAll,
          },
          next: {
            year: nextYear,
            quarter: nextQuarter,
            label: nextLabel,
            noteUUID: nextFound?.uuid ?? null,
            hasAllMonthlyDetails: nextHasAll,
          },
        },
        currentDate: now.toISOString(),
        settings,
        taskDomains: [
          { name: "Work", uuid: "domain-work-uuid" },
          { name: "Personal", uuid: "domain-personal-uuid" },
          { name: "Side Projects", uuid: "domain-side-uuid" }
        ],
        activeTaskDomain: "domain-work-uuid"
      };
    },

    // ------------------------------------------------------------------
    // Configure (no-op in dev)
    // ------------------------------------------------------------------
    async configure() {
      return null;
    },

    // ------------------------------------------------------------------
    // Data fetching
    // ------------------------------------------------------------------
    async getMoodRatings(fromSec) {
      return _fetchMoodRatings(fromSec);
    },

    async getCompletedTasks(fromSec, toSec) {
      return _fetchCompletedTasksInRange(fromSec, toSec);
    },

    async getTaskDomains() {
      return _SAMPLE_DOMAINS_WITH_NOTES;
    },

    async getTaskDomainTasks() {
      return _fetchAllTasks();
    },

    async getNoteTasks(noteUUID, _options) {
      const tasks = await _fetchAllTasks();
      return tasks.filter(t => t.noteUUID === noteUUID && t.completedAt == null && t.dismissedAt == null);
    },

    // ------------------------------------------------------------------
    // Navigation (app.navigate is the real Amplenote API)
    // ------------------------------------------------------------------
    navigate(url) {
      return _navigate(url);
    },

    // ------------------------------------------------------------------
    // Settings persistence (app.setSetting is the real Amplenote API)
    // ------------------------------------------------------------------
    async setSetting(key, value) {
      const strValue = value == null ? '' : String(value);
      _instance.settings[key] = strValue;
      await _saveSetting(key, strValue);
    },

    // ------------------------------------------------------------------
    // Mood
    // ------------------------------------------------------------------
    async recordMoodRating(_value) {
      return true;
    },

    // ------------------------------------------------------------------
    // Notes
    // ------------------------------------------------------------------
    async getNoteContent(noteHandle) {
      const uuid = _resolveUUID(noteHandle);
      try {
        const res = await fetch(`/api/note-content?uuid=${encodeURIComponent(uuid)}`);
        const data = await res.json();
        return data.content ?? '';
      } catch {
        return '';
      }
    },

    async getNoteSections(noteHandle) {
      const content = await this.getNoteContent(noteHandle);
      return _parseHeadingsFromMarkdown(content);
    },

    async findNote(params = {}) {
      try {
        const qs = params.uuid
          ? `uuid=${encodeURIComponent(params.uuid)}`
          : `name=${encodeURIComponent(params.name)}`;
        const res = await fetch(`/api/note-find?${qs}`);
        const data = await res.json();
        return data?.uuid ? data : null;
      } catch {
        return null;
      }
    },

    async filterNotes(options = {}) {
      if (options.query) {
        try {
          const res = await fetch(`/api/note-find?name=${encodeURIComponent(options.query)}`);
          const data = await res.json();
          return data?.uuid ? [data] : [];
        } catch {
          return [];
        }
      }
      return [];
    },

    async createNote(name, tags = []) {
      try {
        const res = await fetch('/api/note-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, tags }),
        });
        const data = await res.json();
        return data.uuid;
      } catch {
        return null;
      }
    },

    async replaceNoteContent(noteHandle, content, options = {}) {
      const uuid = _resolveUUID(noteHandle);
      try {
        const payload = { uuid, content };
        if (options.section) payload.section = options.section;
        const res = await fetch('/api/note-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        return data.ok || false;
      } catch {
        return false;
      }
    },

    async insertNoteContent(noteHandle, content, options = {}) {
      const uuid = _resolveUUID(noteHandle);
      try {
        await fetch('/api/note-append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid, content, atEnd: !!options.atEnd }),
        });
      } catch {
        // silent failure in dev
      }
    },

    // ------------------------------------------------------------------
    // Media (app.attachNoteMedia is the real Amplenote API)
    // ------------------------------------------------------------------
    async attachNoteMedia(_noteHandle, dataURL) {
      try {
        const res = await fetch("/api/attach-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataURL }),
        });
        const result = await res.json();
        return result.url || null;
      } catch {
        return null;
      }
    },

    // ------------------------------------------------------------------
    // AI / DreamTask
    // ------------------------------------------------------------------
    async dreamTaskAnalyze() {
      return {
        tasks: [
          { title: "Research caching strategies for API layer", rating: 9, explanation: "This aligns with your quarterly goal of improving system performance. The API layer research is high-value work best done with focused attention." },
          { title: "Fix flaky integration test suite", rating: 8, explanation: "Reliability infrastructure pays compound returns. A stable test suite unblocks confident shipping of new features." },
          { title: "Draft blog post outline", rating: 7, explanation: "Content creation advances your side project visibility. Today is a good day to outline while ideas are fresh from recent work." },
        ],
        noteUUID: null,
      };
    },
  };

  return _instance;
}
