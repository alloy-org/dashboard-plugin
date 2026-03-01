/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Mock callPlugin for local dev — provides sample data for all dashboard actions
 * Prompt summary: "global callPlugin mock returning realistic data for init, fetchQuotes, configure, etc."
 * Modified: 2026-03-01 | Model: claude-sonnet-4-6
 * Modification: replaced hardcoded/generated task data with fetches to /api/tasks so
 *               dev-app.js is the single source of truth for all sample task data
 */

// Persistent settings loaded from the dev server's JSON-backed API.
// Populated asynchronously before the first callPlugin("init") resolves.
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

// [Claude] Task: persist a single setting to the dev server's JSON file
// Prompt: "dev mode should persist settings to a JSON file"
// Date: 2026-03-01 | Model: claude-opus-4-6
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
    console.warn("[mock] failed to persist setting", key, err);
  }
}

// [Claude] Task: fetch all sample tasks from the dev server, with optional unix-second range filter
// Prompt: "consolidate mock-data.js and dev-app.js so dev-app is the single source of task truth"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
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

// ---------------------------------------------------------------------------
// Derived-value helpers — mirror the logic in data-service.js so init and
// setActiveTaskDomain return realistic computed fields from the same task set.
// ---------------------------------------------------------------------------

function _millisFromUnix(unixSec) {
  if (unixSec == null) return null;
  return unixSec < 1e10 ? unixSec * 1000 : unixSec;
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

// Mock callPlugin for local dev — mirrors the actions dispatched by the dashboard app
// eslint-disable-next-line no-unused-vars
async function callPlugin(action, ...args) {
  const app = {
    navigate(url) {
      const isValidAmplenoteNotesUrl = /^https:\/\/www\.amplenote\.com\/notes(?:$|[/?].*)/.test(url);
      if (isValidAmplenoteNotesUrl) {
        console.log("[mock] app.navigate", url);
      } else {
        console.warn("[mock] app.navigate rejected invalid URL", url);
      }
      return isValidAmplenoteNotesUrl;
    }
  };

  switch (action) {

    case "init": {
      const settings = await _loadSettings();
      const now = new Date();
      const weekStart = _getWeekStart(now);
      const tasks = await _fetchAllTasks();
      return {
        tasks,
        todayTasks: _filterTodayTasks(tasks, now),
        completedThisWeek: _filterCompletedInWeek(tasks, weekStart),
        weeklyVictoryValue: _calcWeeklyVictoryValue(tasks, weekStart),
        dailyVictoryValues: _calcDailyVictoryValues(tasks, weekStart),
        moodRatings: [
          { rating: 1 }, { rating: 2 }, { rating: 0 },
          { rating: 1 }, { rating: -1 }, { rating: 2 }, { rating: 1 }
        ],
        quarterlyPlans: {
          current: {
            year: now.getFullYear(),
            quarter: Math.ceil((now.getMonth() + 1) / 3),
            label: `Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}`,
            noteUUID: "mock-quarterly-plan-uuid"
          },
          next: {
            year: now.getFullYear(),
            quarter: Math.ceil((now.getMonth() + 1) / 3) + 1,
            label: `Q${Math.ceil((now.getMonth() + 1) / 3) + 1} ${now.getFullYear()}`,
            noteUUID: null
          }
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
    }

    case "fetchQuotes":
      return [
        { text: "What gets measured gets managed.", author: "Peter Drucker" },
        { text: "Small daily improvements lead to stunning results.", author: "Robin Sharma" }
      ];

    case "configure":
      return null;

    case "saveSetting":
      await _saveSetting(`dashboard_${args[0]}_config`, JSON.stringify(Array.isArray(args[1]) ? args[1] : [args[1]]));
      return true;

    case "saveLayout":
      await _saveSetting("dashboard_elements", JSON.stringify(args[0]));
      return true;

    case "navigateToNote":
      return app.navigate(`https://www.amplenote.com/notes/${args[0]}`);

    case "navigateToTask":
      return app.navigate(`https://www.amplenote.com/notes/${args[0]}?highlightTaskUUID=${args[1]}`);

    case "navigateToUrl":
      return app.navigate(args[0]);

    case "quickAction":
      return app.navigate(_quickActionToUrl(args[0]));

    case "getMoodRatings": {
      // Return 7 deterministic pseudo-random mood ratings (Mon–Sun) for the requested week.
      // The same fromUnixSec always produces the same 7 ratings; different weeks differ.
      // In production this is app.getMoodRatings(fromUnixSec, toUnixSec).
      const fromSec = args[0] || 0;
      return Array.from({ length: 7 }, (_, i) => ({
        rating: _seededMoodRating(fromSec, i),
        score_time: fromSec + i * 86400,
      }));
    }

    case "getCompletedTasks":
      return await _fetchCompletedTasksInRange(args[0], args[1]);

    case "setActiveTaskDomain": {
      const domainUuid = args[0];
      console.log("[mock] setActiveTaskDomain", domainUuid);
      const now = new Date();
      const weekStart = _getWeekStart(now);
      const tasks = await _fetchAllTasks();
      return {
        tasks,
        todayTasks: _filterTodayTasks(tasks, now),
        completedThisWeek: _filterCompletedInWeek(tasks, weekStart),
        weeklyVictoryValue: _calcWeeklyVictoryValue(tasks, weekStart),
        dailyVictoryValues: _calcDailyVictoryValues(tasks, weekStart),
        activeTaskDomain: domainUuid
      };
    }

    case "refreshTaskDomains":
      console.log("[mock] refreshTaskDomains");
      return {
        domains: [
          { name: "Work", uuid: "domain-work-uuid" },
          { name: "Personal", uuid: "domain-personal-uuid" },
          { name: "Side Projects", uuid: "domain-side-uuid" }
        ],
        activeTaskDomain: "domain-work-uuid"
      };

    default:
      console.warn("[mock] unhandled callPlugin action:", action, args);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function _quickActionToUrl(action) {
  const actionToUrl = {
    dailyJot: "https://www.amplenote.com/notes/jots",
    journal: "https://www.amplenote.com/notes/jots",
    addPerson: "https://www.amplenote.com/notes?tag=people",
    browseCRM: "https://www.amplenote.com/notes?tag=crm"
  };
  return actionToUrl[action] || "https://www.amplenote.com/notes";
}

// Returns a deterministic mood rating in [-2, 2] for (weekStartSec, dayIndex).
// Uses a fast integer hash so the same week always yields the same sequence.
function _seededMoodRating(weekStartSec, dayIndex) {
  let h = (weekStartSec ^ (weekStartSec >>> 16)) * 0x45d9f3b | 0;
  h = (h ^ dayIndex * 0x9e3779b9) * 0x119de1f3 | 0;
  h = h ^ (h >>> 16);
  return (((h >>> 0) % 5) | 0) - 2; // maps 0-4 → -2…2
}
