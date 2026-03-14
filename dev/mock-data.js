/**
 * [Claude-authored file]
 * Created: 2026-02-21 | Model: claude-opus-4-6
 * Task: Mock callPlugin for local dev — provides sample data for all dashboard actions
 * Prompt summary: "global callPlugin mock returning realistic data for init, fetchQuotes, configure, etc."
 * Modified: 2026-03-01 | Model: claude-sonnet-4-6
 * Modification: replaced hardcoded/generated task data with fetches to /api/tasks so
 *               dev-app.js is the single source of truth for all sample task data
 */

const CONSOLE_LOGGING_KEY = "Console logging";

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

// [Claude] Task: fetch mood ratings from dev server so dev-app.js is the single source of truth
// Prompt: "DRY up mock mood ratings — single source in dev-app.js, mock-data.js fetches via /api/moods"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
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

// ---------------------------------------------------------------------------
// Sample data for getTaskDomains / getNoteTasks (Recent Notes widget)
// ---------------------------------------------------------------------------

// Note handles keyed by domain UUID — mirrors SAMPLE_NOTE_HANDLES in dev-app.js
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

// Mock callPlugin for local dev — mirrors the actions dispatched by the dashboard app
// eslint-disable-next-line no-unused-vars
async function callPlugin(action, ...args) {
  console.log("[mock] callPlugin:", action, args.length > 0 ? "(+" + args.length + " args)" : "");
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

    // [Claude] Task: resolve real quarterly plan UUIDs from /notes directory for init
    // Prompt: "use logIfEnabled to output more debug information so we can understand which part of the process is failing"
    // Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
    case "init": {
      const settings = await _loadSettings();
      if (!settings[CONSOLE_LOGGING_KEY]) settings[CONSOLE_LOGGING_KEY] = "true";

      // Amplenote's app.setSetting coerces values to strings, so the real plugin's
      // _readDashboardSettings JSON.parses them back. Mirror that here for parity.
      if (typeof settings.dashboard_elements === "string") {
        try { settings.dashboard_elements = JSON.parse(settings.dashboard_elements); }
        catch { settings.dashboard_elements = null; }
      }
      for (const key of ["dashboard_victory-value_config", "dashboard_calendar_config", "dashboard_mood_config", "dashboard_quotes_config"]) {
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
      console.log(`[mock] init quarterly plans — current "${currentLabel} Plan": ${currentFound?.uuid ?? "not found"}, next "${nextLabel} Plan": ${nextFound?.uuid ?? "not found"}`);

      const [currentSections, nextSections] = await Promise.all([
        currentFound?.uuid ? _fetchNoteSections(currentFound.uuid) : Promise.resolve([]),
        nextFound?.uuid    ? _fetchNoteSections(nextFound.uuid)    : Promise.resolve([]),
      ]);
      const currentMonths = _quarterMonthNames(currentQuarter);
      const nextMonths    = _quarterMonthNames(nextQuarter);
      const currentHasAll = currentMonths.every(m => currentSections.some(s => s.heading?.text?.trim().toLowerCase() === m.toLowerCase()));
      const nextHasAll    = nextMonths.every(m => nextSections.some(s => s.heading?.text?.trim().toLowerCase() === m.toLowerCase()));

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
      return _fetchMoodRatings(args[0]);
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

    // [Claude] Task: mock uploadBackgroundImage via dev server endpoint
    // Prompt: "add background image upload option to DashboardSettings"
    // Date: 2026-03-01 | Model: claude-4.6-opus-high-thinking
    case "uploadBackgroundImage": {
      const dataURL = args[0];
      console.log("[mock] uploadBackgroundImage: sending", (dataURL?.length || 0), "chars to /api/attach-media");
      try {
        const res = await fetch("/api/attach-media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataURL }),
        });
        console.log("[mock] uploadBackgroundImage: server responded with status", res.status);
        const result = await res.json();
        console.log("[mock] uploadBackgroundImage: result =", JSON.stringify(result));
        if (result.url) {
          console.log("[mock] uploadBackgroundImage: returning URL (persist on Save)");
          return result.url;
        }
        console.warn("[mock] uploadBackgroundImage: no URL in response");
      } catch (err) {
        console.error("[mock] uploadBackgroundImage FAILED:", err);
      }
      return null;
    }

    case "saveBackgroundImageUrl": {
      const url = args[0];
      await _saveSetting("Background Image URL", url || "");
      if (!url) await _saveSetting("Background Image Mode", "");
      return true;
    }

    case "removeBackgroundImage":
      console.log("[mock] removeBackgroundImage");
      await _saveSetting("Background Image URL", "");
      await _saveSetting("Background Image Mode", "");
      console.log("[mock] removeBackgroundImage: settings cleared");
      return true;

    case "saveBackgroundMode":
      await _saveSetting("Background Image Mode", args[0]);
      return true;

    // [Claude] Task: mock getTaskDomains and getNoteTasks for the Recent Notes widget
    // Prompt: "Recent Notes component shows no note names in dev"
    // Date: 2026-03-04 | Model: claude-4.6-sonnet-medium-thinking
    case "getTaskDomains":
      return _SAMPLE_DOMAINS_WITH_NOTES;

    // [Claude] Task: mock randomNote — pick a random note from all sample task-domain notes
    // Prompt: "Random Note button: retrieve notes in task domain updated within last month, pick one randomly"
    // Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
    case "randomNote": {
      const allNotes = Object.values(_SAMPLE_NOTE_HANDLES).flat();
      const pick = allNotes[Math.floor(Math.random() * allNotes.length)];
      if (pick?.uuid) {
        app.navigate(`https://www.amplenote.com/notes/${pick.uuid}`);
      }
      return null;
    }

    case "getNoteTasks": {
      const noteUUID = args[0];
      const tasks = await _fetchAllTasks();
      return tasks.filter(t => t.noteUUID === noteUUID && t.completedAt == null && t.dismissedAt == null);
    }

    case "getNoteContent": {
      const uuid = args[0];
      try {
        const res = await fetch(`/api/note-content?uuid=${encodeURIComponent(uuid)}`);
        const data = await res.json();
        return data.content;
      } catch {
        return "";
      }
    }

    case "replaceContent": {
      try {
        await fetch('/api/note-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: args[0], content: args[1] }),
        });
        return true;
      } catch {
        return false;
      }
    }

    case "getNoteSections": {
      const uuid = args[0];
      try {
        const content = await callPlugin('getNoteContent', uuid);
        const sections = _parseHeadingsFromMarkdown(content || '');
        console.log(`[mock] getNoteSections uuid=${uuid} → ${sections.length} sections:`, sections.map(s => s.heading.text));
        return sections;
      } catch {
        return [];
      }
    }

    case "getMonthlyPlanContent": {
      const noteUUID = args[0];
      const sectionName = args[1];
      try {
        const content = await callPlugin('getNoteContent', noteUUID);
        if (!content) {
          console.log(`[mock] getMonthlyPlanContent uuid=${noteUUID} section="${sectionName}" → no content`);
          return { found: false, content: null };
        }
        const sectionContent = _extractSectionContent(content, sectionName);
        console.log(`[mock] getMonthlyPlanContent uuid=${noteUUID} section="${sectionName}" → found=${!!sectionContent}`);
        return sectionContent
          ? { found: true, content: sectionContent }
          : { found: false, content: null };
      } catch {
        return { found: false, content: null };
      }
    }

    case "createQuarterlyPlan": {
      const { label, year, quarter } = args[0];
      const noteName = `${label} Plan`;
      try {
        const findRes = await fetch(`/api/note-find?name=${encodeURIComponent(noteName)}`);
        const found = await findRes.json();
        if (found?.uuid) {
          app.navigate(`https://www.amplenote.com/notes/${found.uuid}`);
          return { uuid: found.uuid, existed: true };
        }
        const createRes = await fetch('/api/note-create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: noteName, tags: ['plugins/dashboard', 'planning/quarterly'] }),
        });
        const created = await createRes.json();
        await fetch('/api/note-append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid: created.uuid, content: _defaultQuarterlyPlanTemplate(label, quarter) }),
        });
        app.navigate(`https://www.amplenote.com/notes/${created.uuid}`);
        return { uuid: created.uuid, existed: false };
      } catch {
        return null;
      }
    }

    case "createOrAppendMonthlyPlan": {
      const planInfo = args[0];
      const monthName = args[1];
      try {
        const result = await callPlugin('createQuarterlyPlan', planInfo);
        if (!result?.uuid) return null;
        const existing = await callPlugin('getMonthlyPlanContent', result.uuid, monthName);
        if (!existing.found) {
          await fetch('/api/note-append', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid: result.uuid, content: `\n### ${monthName}\n- Focus:\n- Key move:\n` }),
          });
        }
        const content = await callPlugin('getNoteContent', result.uuid);
        const sectionContent = _extractSectionContent(content || '', monthName);
        return { noteUUID: result.uuid, content: sectionContent || '', created: !result.existed };
      } catch {
        return null;
      }
    }

    case "createOrAppendWeeklyPlan": {
      const planInfo = args[0];
      const weekLabel = args[1];
      try {
        const result = await callPlugin('createQuarterlyPlan', planInfo);
        if (!result?.uuid) return null;
        const existing = await callPlugin('getMonthlyPlanContent', result.uuid, weekLabel);
        if (!existing.found) {
          await fetch('/api/note-append', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid: result.uuid, content: `\n### ${weekLabel}\n- Primary focus:\n- Key tasks:\n- Commitments:\n` }),
          });
        }
        const content = await callPlugin('getNoteContent', result.uuid);
        const sectionContent = _extractSectionContent(content || '', weekLabel);
        return { noteUUID: result.uuid, content: sectionContent || '' };
      } catch {
        return null;
      }
    }

    default:
      console.warn("[mock] unhandled callPlugin action:", action, args);
      return null;
  }
}

// ---------------------------------------------------------------------------
// Note content helpers (inlined since mock-data.js is a plain script, not a module)
// ---------------------------------------------------------------------------

// [Claude] Task: look up a note by name via the dev server's /api/note-find endpoint
// Prompt: "use logIfEnabled to output more debug information so we can understand which part of the process is failing"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
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
    const content = await callPlugin('getNoteContent', uuid);
    return _parseHeadingsFromMarkdown(content || '');
  } catch {
    return [];
  }
}

function _quarterMonthNames(quarter) {
  const allMonths = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const start = (quarter - 1) * 3;
  return [allMonths[start], allMonths[start + 1], allMonths[start + 2]];
}

function _extractSectionContent(markdown, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`(^|\\n)(#{1,6})\\s+${escaped}\\s*\\n`, 'i');
  const match = markdown.match(headingRe);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = markdown.substring(start);
  const nextHeading = rest.match(/\n#{1,6}\s/);
  return (nextHeading ? rest.substring(0, nextHeading.index) : rest).trim();
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

function _defaultQuarterlyPlanTemplate(label, quarter) {
  const months = {
    1: ['January', 'February', 'March'],
    2: ['April', 'May', 'June'],
    3: ['July', 'August', 'September'],
    4: ['October', 'November', 'December'],
  };
  const m = months[quarter] || ['Month 1', 'Month 2', 'Month 3'];
  return `# ${label} Plan\n\n## ${m[0]}\n- Focus:\n- Key move:\n\n## ${m[1]}\n- Focus:\n- Key move:\n\n## ${m[2]}\n- Focus:\n- Key move:\n`;
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

