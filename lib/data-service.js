/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Data fetching and shaping layer for the dashboard
 * Prompt summary: "fetch tasks, mood, quarterly plans from Amplenote app and shape for widgets"
 */
import { getCurrentQuarter, getNextQuarter, quarterLabel } from "./constants/quarters"
import {
  DASHBOARD_NOTE_TAG,
  DEFAULT_PLANNING_TAG,
  PLANNING_NOTE_TAG_LABEL,
  TASK_DOMAIN_SETTING,
  TASK_DOMAIN_STALE_MS,
  DASHBOARD_COMPONENTS,
  DEFAULT_DASHBOARD_COMPONENTS,
  SETTING_KEYS,
} from "./constants/settings"
import { weekEndFromDateInput, weekStartFromDateInput } from "./util/date-utility"

// --------------------------------------------------------------------------------------
// [Claude] Task: fetch all dashboard data with task domain filtering
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
export async function fetchDashboardData(app) {
  const now = new Date();
  const weekStart = weekStartFromDateInput(now);
  const weekEnd = weekEndFromDateInput(now);

  // Resolve task domains (cached in settings, refreshed if stale)
  const taskDomainInfo = await _resolveTaskDomains(app);

  // Parallel fetch: mood, quarterly plans, settings, and tasks for the active domain
  // [Claude] Task: fix getMoodRatings timestamp unit and extend range to two weeks
  // Prompt: "Is our current mood rating lookup going to retrieve all ratings from the past two weeks?"
  // Date: 2026-02-28 | Model: claude-sonnet-4-6
  const twoWeeksAgoUnixSeconds = Math.floor(Date.now() / 1000) - (60 * 60 * 24 * 14);
  const [ moodRatings, quarterlyPlans, settings, domainTasks ] = await Promise.all([
    _safeMoodRatings(app, twoWeeksAgoUnixSeconds),
    _findQuarterlyPlans(app),
    _readDashboardSettings(app),
    _fetchTasksForDomain(app, taskDomainInfo.selectedDomainUuid)
  ]);

  return {
    tasks: domainTasks,
    todayTasks: _filterTodayTasks(domainTasks, now),
    completedThisWeek: _filterCompletedInRange(domainTasks, weekStart, weekEnd),
    weeklyVictoryValue: _calculateWeeklyVictoryValue(domainTasks, weekStart, weekEnd),
    dailyVictoryValues: _calculateDailyVictoryValues(domainTasks, weekStart),
    moodRatings,
    quarterlyPlans,
    currentDate: now.toISOString(),
    settings,
    taskDomains: taskDomainInfo.domains,
    activeTaskDomain: taskDomainInfo.selectedDomainUuid
  };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: switch active task domain and return its tasks
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
export async function switchTaskDomain(app, domainUuid) {
  const now = new Date();
  const weekStart = weekStartFromDateInput(now);
  const weekEnd = weekEndFromDateInput(now);

  // Update the stored setting with the new selection
  const raw = app.settings[TASK_DOMAIN_SETTING];
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
  stored.selectedDomainUuid = domainUuid;
  await app.setSetting(TASK_DOMAIN_SETTING, JSON.stringify(stored));

  // Fetch tasks for the newly selected domain
  const domainTasks = await _fetchTasksForDomain(app, domainUuid);

  return {
    tasks: domainTasks,
    todayTasks: _filterTodayTasks(domainTasks, now),
    completedThisWeek: _filterCompletedInRange(domainTasks, weekStart, weekEnd),
    weeklyVictoryValue: _calculateWeeklyVictoryValue(domainTasks, weekStart, weekEnd),
    dailyVictoryValues: _calculateDailyVictoryValues(domainTasks, weekStart),
    activeTaskDomain: domainUuid
  };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: force refresh of cached task domain list
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
export async function refreshTaskDomains(app) {
  const domains = await app.getTaskDomains();
  const raw = app.settings[TASK_DOMAIN_SETTING];
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }

  stored.domains = domains.map(d => ({ name: d.name, uuid: d.uuid }));
  stored.lastRetrieved = Date.now();

  // Keep selected domain if it still exists, otherwise default to "Work" or first
  const selectedStillExists = stored.selectedDomainUuid &&
    stored.domains.some(d => d.uuid === stored.selectedDomainUuid);
  if (!selectedStillExists) {
    stored.selectedDomainUuid = _pickDefaultDomain(stored.domains);
  }

  await app.setSetting(TASK_DOMAIN_SETTING, JSON.stringify(stored));
  return { domains: stored.domains, activeTaskDomain: stored.selectedDomainUuid };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: create or navigate to a quarterly plan note
// Prompt: "create quarterly plan notes with template inheritance from previous quarter"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export async function createQuarterlyPlan(app, quarterInfo) {
  const { label, year, quarter } = quarterInfo; // e.g., { label: "Q1 2026", year: 2026, quarter: 1 }
  const noteName = `${ label } Plan`;
  const planningTag = app.settings[PLANNING_NOTE_TAG_LABEL] || DEFAULT_PLANNING_TAG;
  const tags = [DASHBOARD_NOTE_TAG, planningTag];

  // Check if it already exists
  const existing = await app.filterNotes({ query: noteName });
  const match = existing.find(n => n.name === noteName);
  if (match) {
    await app.navigate(`https://www.amplenote.com/notes/${match.uuid}`);
    return { uuid: match.uuid, existed: true };
  }

  // Look for previous quarter's plan to copy headings
  const prevLabel = _previousQuarterLabel(year, quarter);
  const prevNotes = await app.filterNotes({ query: `${prevLabel} Plan` });
  let template = _defaultQuarterlyTemplate(label);

  if (prevNotes.length > 0) {
    const prevContent = await app.getNoteContent({ uuid: prevNotes[0].uuid });
    const headings = _extractHeadings(prevContent);
    if (headings.length > 0) {
      template = `# ${label} Plan\n\n` + headings.map(h => `${h}\n\n`).join("");
    }
  }

  const uuid = await app.createNote(noteName, tags);
  await app.insertNoteContent({ uuid }, template);
  await app.navigate(`https://www.amplenote.com/notes/${uuid}`);
  return { uuid, existed: false };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: generate inspirational quotes via OpenAI or Anthropic API, falling back to local pool
// Prompt: "add a set of 100 inspirational quotes randomly picked for the Inspiration component"
// Date: 2026-03-05 | Model: claude-sonnet-4-6
export async function fetchQuotes(app, planContent) {
  const apiKey = app.settings["LLM API Key"];
  const provider = app.settings["LLM Provider"] || "openai";

  if (!apiKey) {
    // No LLM key — surface the local quote pool rather than a static stub
    const { getRandomQuotes } = await import('./dashboard/quotes-data.js');
    return getRandomQuotes(2);
  }

  const prompt = planContent
    ? `Based on these quarterly goals, generate 2 short inspirational quotes (1-2 sentences each) that motivate progress toward these goals. Return as JSON array [{text, author}]. Goals: ${planContent.substring(0, 500)}`
    : `Generate 2 short inspirational quotes about productivity and personal growth. Return as JSON array [{text, author}].`;

  const endpoint = provider === "anthropic"
    ? "https://api.anthropic.com/v1/messages"
    : "https://api.openai.com/v1/chat/completions";

  const headers = provider === "anthropic"
    ? { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };

  const body = provider === "anthropic"
    ? { model: "claude-sonnet-4-20250514", max_tokens: 300, messages: [{ role: "user", content: prompt }] }
    : { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 300 };

  try {
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const json = await response.json();
    const text = provider === "anthropic"
      ? json?.content?.[0]?.text
      : json?.choices?.[0]?.message?.content;
    return JSON.parse(text);
  } catch (error) {
    console.error("Quote fetch error:", error);
    return [
      { text: "What gets measured gets managed.", author: "Peter Drucker" },
      { text: "Small daily improvements lead to stunning results.", author: "Robin Sharma" }
    ];
  }
}

// --------------------------------------------------------------------------------------
// [Claude] Task: navigate to a note by UUID
// Prompt: "fetch tasks, mood, quarterly plans from Amplenote app and shape for widgets"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
export async function navigateToNote(app, noteUUID) {
  await app.navigate(`https://www.amplenote.com/notes/${noteUUID}`);
}

// --------------------------------------------------------------------------------------
// [Claude] Task: navigate directly to task context inside a note
// Prompt: "agenda task click should jump to task within its note"
// Date: 2026-02-21 | Model: claude-sonnet-4-6
export async function navigateToTask(app, noteUUID, taskUUID) {
  if (!noteUUID) return;
  if (!taskUUID) {
    await app.navigate(`https://www.amplenote.com/notes/${noteUUID}`);
    return;
  }

  await app.navigate(`https://www.amplenote.com/notes/${noteUUID}?highlightTaskUUID=${taskUUID}`);
}

// --------------------------------------------------------------------------------------
// [Claude] Task: navigate to an arbitrary Amplenote notes URL
// Prompt: "ensure links to notes/sections go through app.navigate"
// Date: 2026-02-21 | Model: claude-sonnet-4-6
export async function navigateToUrl(app, url) {
  if (!url) return false;
  return await app.navigate(url);
}

// --------------------------------------------------------------------------------------
// [Claude] Task: map quick action identifiers to Amplenote URLs and navigate
// Prompt: "fix amplenoteBlog and visitPlugin not opening new tab — open synchronously on click"
// Date: 2026-03-05 | Model: claude-4.6-sonnet-medium-thinking
export async function runQuickAction(app, action) {
  const actionToUrl = {
    dailyJot: "https://www.amplenote.com/notes/jots",
    journal: "https://www.amplenote.com/notes/jots"
  };

  const url = actionToUrl[action] || "https://www.amplenote.com/notes";
  return await app.navigate(url);
}

// --------------------------------------------------------------------------------------
// Private helpers
// --------------------------------------------------------------------------------------

// --------------------------------------------------------------------------------------
// [Claude] Task: resolve task domains from cache or fresh API call
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
async function _resolveTaskDomains(app) {
  const raw = app.settings[TASK_DOMAIN_SETTING];
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }

  const isStale = !stored.lastRetrieved || (Date.now() - stored.lastRetrieved > TASK_DOMAIN_STALE_MS);
  const hasDomains = Array.isArray(stored.domains) && stored.domains.length > 0;

  if (!hasDomains || isStale) {
    const freshDomains = await app.getTaskDomains();
    stored.domains = freshDomains.map(d => ({ name: d.name, uuid: d.uuid }));
    stored.lastRetrieved = Date.now();

    // Validate current selection still exists
    const selectedStillExists = stored.selectedDomainUuid &&
      stored.domains.some(d => d.uuid === stored.selectedDomainUuid);
    if (!selectedStillExists) {
      stored.selectedDomainUuid = _pickDefaultDomain(stored.domains);
    }

    await app.setSetting(TASK_DOMAIN_SETTING, JSON.stringify(stored));
  }

  // Ensure a domain is always selected
  if (!stored.selectedDomainUuid && stored.domains.length > 0) {
    stored.selectedDomainUuid = _pickDefaultDomain(stored.domains);
    await app.setSetting(TASK_DOMAIN_SETTING, JSON.stringify(stored));
  }

  return stored;
}

// --------------------------------------------------------------------------------------
function _pickDefaultDomain(domains) {
  if (!domains || domains.length === 0) return null;
  const work = domains.find(d => d.name === "Work");
  return work ? work.uuid : domains[0].uuid;
}

// --------------------------------------------------------------------------------------
async function _fetchTasksForDomain(app, domainUuid) {
  if (!domainUuid) return [];
  return await app.getTaskDomainTasks(domainUuid);
}

function _filterTodayTasks(tasks, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 86400000;
  return tasks.filter(t =>
    !t.completedAt &&
    !t.dismissedAt &&
    _millisFromTimestamp(t.startAt) &&
    _millisFromTimestamp(t.startAt) >= dayStart &&
    _millisFromTimestamp(t.startAt) < dayEnd
  ).sort((a, b) => (_millisFromTimestamp(a.startAt) || 0) - (_millisFromTimestamp(b.startAt) || 0));
}

// --------------------------------------------------------------------------------------
function _filterCompletedInRange(tasks, start, end) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return tasks.filter(t =>
    _millisFromTimestamp(t.completedAt) &&
    _millisFromTimestamp(t.completedAt) >= startMs &&
    _millisFromTimestamp(t.completedAt) <= endMs
  );
}

// --------------------------------------------------------------------------------------
function _calculateWeeklyVictoryValue(tasks, weekStart, weekEnd) {
  return _filterCompletedInRange(tasks, weekStart, weekEnd)
    .reduce((sum, t) => sum + (t.victoryValue || 0), 0);
}

// --------------------------------------------------------------------------------------
function _calculateDailyVictoryValues(tasks, weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(weekStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayTasks = tasks.filter(t =>
      _millisFromTimestamp(t.completedAt) &&
      _millisFromTimestamp(t.completedAt) >= dayStart.getTime() &&
      _millisFromTimestamp(t.completedAt) < dayEnd.getTime()
    );
    return {
      day: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
      date: dayStart.toISOString(),
      value: dayTasks.reduce((sum, t) => sum + (t.victoryValue || 0), 0),
      taskCount: dayTasks.length
    };
  });
  return days;
}

// --------------------------------------------------------------------------------------
// Argument must be a Unix timestamp in seconds (not milliseconds).
async function _safeMoodRatings(app, fromUnixSeconds) {
  const moodRatings = await app.getMoodRatings(fromUnixSeconds);
  console.log("Mood ratings", moodRatings, "from", fromUnixSeconds);
  return moodRatings;
}

// --------------------------------------------------------------------------------------
async function _findQuarterlyPlans(app) {
  const current = getCurrentQuarter();
  const next = getNextQuarter();
  const [currentPlans, nextPlans] = await Promise.all([
    app.filterNotes({ query: `${current.label} Plan` }),
    app.filterNotes({ query: `${next.label} Plan` })
  ]);
  return {
    current: { ...current, noteUUID: currentPlans.find(n => n.name === `${current.label} Plan`)?.uuid },
    next: { ...next, noteUUID: nextPlans.find(n => n.name === `${next.label} Plan`)?.uuid }
  };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: include persisted dashboard component layout in settings payload
// Prompt: "Break out component rendering into renderActiveComponents driven by app.settings"
// Date: 2026-02-21 | Model: claude-sonnet-4-6
async function _readDashboardSettings(app) {
  const keys = ["dashboard_victory-value_config", "dashboard_calendar_config", "dashboard_quotes_config"];
  const settings = {};

  for (const key of keys) {
    try {
      const val = app.settings[key];
      settings[key] = val ? JSON.parse(val) : null;
    } catch {
      settings[key] = null;
    }
  }

  settings[SETTING_KEYS.BACKGROUND_IMAGE_URL]  = app.settings[SETTING_KEYS.BACKGROUND_IMAGE_URL] || '';
  settings[SETTING_KEYS.BACKGROUND_IMAGE_MODE] = app.settings[SETTING_KEYS.BACKGROUND_IMAGE_MODE] || 'cover';

  let componentLayout = null;
  try {
    componentLayout = app.settings[DASHBOARD_COMPONENTS]
      ? JSON.parse(app.settings[DASHBOARD_COMPONENTS])
      : null;
  } catch {
    componentLayout = null;
  }

  if (!Array.isArray(componentLayout) || componentLayout.length === 0) {
    componentLayout = DEFAULT_DASHBOARD_COMPONENTS.map(component => ({ ...component }));
    await app.setSetting(DASHBOARD_COMPONENTS, JSON.stringify(componentLayout));
  }

  settings[DASHBOARD_COMPONENTS] = componentLayout;
  return settings;
}

// --------------------------------------------------------------------------------------
// [Claude] Task: normalize task timestamps to milliseconds for range comparisons
// Prompt: "Victory Value shows 0 points while tooltip lists completed tasks"
// Date: 2026-02-28 | Model: claude-sonnet-4-6
function _millisFromTimestamp(timestamp) {
  if (timestamp == null) return null;
  if (typeof timestamp !== "number") {
    const parsed = Number(timestamp);
    if (!Number.isFinite(parsed)) return null;
    return parsed < 1e10 ? parsed * 1000 : parsed;
  }
  return timestamp < 1e10 ? timestamp * 1000 : timestamp;
}

// --------------------------------------------------------------------------------------
function _previousQuarterLabel(year, quarter) {
  if (quarter === 1) return `Q4 ${year - 1}`;
  return `Q${quarter - 1} ${year}`;
}

// --------------------------------------------------------------------------------------
function _extractHeadings(markdownContent) {
  return (markdownContent.match(/^#{1,3}\s+.+$/gm) || []).filter(h => !h.startsWith("# "));
}

// --------------------------------------------------------------------------------------
function _defaultQuarterlyTemplate(label) {
  return `# ${label} Plan\n\n## Goals\n\n## Key Results\n\n## Projects\n\n## Reflections\n\n`;
}
