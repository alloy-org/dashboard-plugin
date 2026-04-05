/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Data fetching and shaping layer for the dashboard
 * Prompt summary: "fetch tasks, mood, quarterly plans from Amplenote app and shape for widgets"
 */
import { getCurrentQuarter, getNextQuarter, extractMonthSectionContent, defaultMonthTemplate, defaultWeekTemplate, FULL_MONTH_NAMES } from "constants/quarters"
import {
  DASHBOARD_NOTE_TAG,
  DEFAULT_PLANNING_TAG,
  DEFAULT_DASHBOARD_COMPONENTS,
  SETTING_KEYS,
  TASK_DOMAIN_STALE_MS,
  widgetConfigKey,
} from "constants/settings"
import { logIfEnabled, setLoggingEnabled } from "util/log"
import { weekEndFromDateInput, weekStartFromDateInput } from "util/date-utility"

// --------------------------------------------------------------------------------------
// [Claude] Task: fetch all dashboard data with task domain filtering
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
// [Claude] Task: isolate each data fetch so one API failure doesn't block the entire dashboard
// Prompt: "wrap each component load in try...catch so failure to render one widget does not disrupt others"
// Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
export async function fetchDashboardData(app) {
  setLoggingEnabled(app.settings[SETTING_KEYS.CONSOLE_LOGGING]);
  const now = new Date();
  const weekStart = weekStartFromDateInput(now);
  const weekEnd = weekEndFromDateInput(now);

  let taskDomainInfo = { domains: [], selectedDomainUuid: null };
  try {
    taskDomainInfo = await _resolveTaskDomains(app);
  } catch (err) {
    logIfEnabled('[fetchDashboardData] _resolveTaskDomains failed, continuing with empty domains:', err);
  }

  const twoWeeksAgoUnixSeconds = Math.floor(Date.now() / 1000) - (60 * 60 * 24 * 14);
  const results = await Promise.allSettled([
    _safeMoodRatings(app, twoWeeksAgoUnixSeconds),
    _findQuarterlyPlans(app),
    _readDashboardSettings(app),
    _fetchTasksForDomain(app, taskDomainInfo.selectedDomainUuid)
  ]);

  const moodRatings    = _settledValueOr(results[0], [], 'moodRatings');
  const quarterlyPlans = _settledValueOr(results[1], null, 'quarterlyPlans');
  const settings       = _settledValueOr(results[2], {}, 'settings');
  const domainTasks    = _settledValueOr(results[3], [], 'domainTasks');

  return {
    activeTaskDomain: taskDomainInfo.selectedDomainUuid,
    completedThisWeek: _filterCompletedInRange(domainTasks, weekStart, weekEnd),
    currentDate: now.toISOString(),
    dailyVictoryValues: _calculateDailyVictoryValues(domainTasks, weekStart),
    moodRatings,
    pluginNoteUUID: app.context?.noteUUID || null,
    quarterlyPlans,
    settings,
    tasks: domainTasks,
    todayTasks: _filterTodayTasks(domainTasks, now),
    taskDomains: taskDomainInfo.domains,
    weeklyVictoryValue: _calculateWeeklyVictoryValue(domainTasks, weekStart, weekEnd),
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
  const raw = app.settings[SETTING_KEYS.TASK_DOMAINS];
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
  stored.selectedDomainUuid = domainUuid;
  await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));

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
  logIfEnabled('[refreshTaskDomains] Starting domain refresh');
  const domains = await app.getTaskDomains();
  logIfEnabled(`[refreshTaskDomains] Fetched ${ domains?.length ?? 0 } domains from API`, domains);
  const raw = app.settings[SETTING_KEYS.TASK_DOMAINS];
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }

  stored.domains = domains.map(d => ({ name: d.name, uuid: d.uuid }));
  stored.lastRetrieved = Date.now();

  const selectedStillExists = stored.selectedDomainUuid &&
    stored.domains.some(d => d.uuid === stored.selectedDomainUuid);
  if (!selectedStillExists) {
    logIfEnabled(`[refreshTaskDomains] Previous selection ${ stored.selectedDomainUuid } no longer exists, picking default`);
    stored.selectedDomainUuid = _pickDefaultDomain(stored.domains);
  }

  await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));
  logIfEnabled(`[refreshTaskDomains] Refresh complete — ${ stored.domains.length } domains, active: ${ stored.selectedDomainUuid }`);
  return { domains: stored.domains, activeTaskDomain: stored.selectedDomainUuid };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: create or navigate to a quarterly plan note using the default template
// Prompt: "when there is not yet a plan for the quarter, use the default quarterly template"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
export async function createQuarterlyPlan(app, quarterInfo) {
  const { label, year, quarter } = quarterInfo; // e.g., { label: "Q1 2026", year: 2026, quarter: 1 }
  const noteName = `${ label } Plan`;
  const planningTag = app.settings[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const tags = [DASHBOARD_NOTE_TAG, planningTag];

  // Check if it already exists
  const existing = await app.filterNotes({ query: noteName });
  const match = existing.find(n => n.name === noteName);
  if (match) {
    await app.navigate(`https://www.amplenote.com/notes/${match.uuid}`);
    return { uuid: match.uuid, existed: true };
  }

  const template = _defaultQuarterlyTemplate(label, quarter);
  const uuid = await app.createNote(noteName, tags);
  await app.insertNoteContent({ uuid }, template);
  await app.navigate(`https://www.amplenote.com/notes/${uuid}`);
  return { uuid, existed: false };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: generate inspirational quotes via OpenAI or Anthropic API, falling back to local pool
// Prompt: "add a set of 100 inspirational quotes randomly picked for the Inspiration component"
// Date: 2026-03-05 | Model: claude-sonnet-4-6
// [Claude] Task: accept explicit apiKey/provider instead of reading app.settings directly
// Prompt: "for each widget that needs to call AI, use apiKeyFromProvider to pass a providerApiKey prop"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
export async function fetchQuotes(app, planContent, { apiKey, provider } = {}) {
  if (!apiKey) apiKey = app.settings?.["LLM API Key"];
  if (!provider) provider = app.settings?.[SETTING_KEYS.LLM_PROVIDER_MODEL] || "openai";

  if (!apiKey) return [];

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
    logIfEnabled("Quote fetch error:", error);
    return [
      { text: "What gets measured gets managed.", author: "Peter Drucker" },
      { text: "Small daily improvements lead to stunning results.", author: "Robin Sharma" }
    ];
  }
}

// --------------------------------------------------------------------------------------
// [Claude] Task: check quarterly plan note sections for a month heading, return its content
// Prompt: "when a month is clicked, check the quarterly plan note for a section that corresponds with the month"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export async function getMonthlyPlanContent(app, noteUUID, monthName) {
  if (!noteUUID) return { found: false, content: null };

  const sections = await app.getNoteSections({ uuid: noteUUID });
  logIfEnabled(`[getMonthlyPlanContent] noteUUID=${noteUUID} monthName="${monthName}" sections:`, sections?.map(s => s.heading?.text));
  const monthSection = sections.find(s =>
    s.heading && s.heading.text &&
    s.heading.text.trim().toLowerCase() === monthName.toLowerCase()
  );
  logIfEnabled(`[getMonthlyPlanContent] monthSection found:`, !!monthSection);

  if (!monthSection) return { found: false, content: null };

  const fullContent = await app.getNoteContent({ uuid: noteUUID });
  const content = extractMonthSectionContent(fullContent, monthName);
  logIfEnabled(`[getMonthlyPlanContent] extracted content length: ${content?.length ?? 0}`);
  return { found: true, content: content || '' };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: create a quarterly plan note or append a month section to an existing one
// Prompt: "create a quarterly plan note for the month or append to the existing quarterly plan note"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export async function createOrAppendMonthlyPlan(app, quarterInfo, monthName) {
  const { label, year, quarter } = quarterInfo;
  const noteName = `${ label } Plan`;
  const planningTag = app.settings[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const tags = [DASHBOARD_NOTE_TAG, planningTag];

  const existing = await app.filterNotes({ query: noteName });
  const match = existing.find(n => n.name === noteName);

  let noteUUID;
  if (match) {
    noteUUID = match.uuid;
    await app.insertNoteContent({ uuid: noteUUID }, defaultMonthTemplate(monthName), { atEnd: true });
  } else {
    const template = _defaultQuarterlyTemplate(label, quarter);
    noteUUID = await app.createNote(noteName, tags);
    await app.insertNoteContent({ uuid: noteUUID }, template);
  }

  const content = await _readMonthContentWithRetry(app, noteUUID, monthName);
  return { noteUUID, content, created: !match };
}

// --------------------------------------------------------------------------------------
/**
 * Creates or appends a weekly plan section in a quarterly note.
 * If the quarterly plan note does not exist, it is created first.
 * @param {Object} app - Amplenote app interface.
 * @param {Object} quarterInfo - { label, year, quarter }.
 * @param {string} weekLabel - Heading text, e.g. "Week of March 16".
 * @returns {Promise<{ noteUUID: string }>}
 */
export async function createOrAppendWeeklyPlan(app, quarterInfo, weekLabel) {
  const { label, year, quarter } = quarterInfo;
  const noteName = `${ label } Plan`;
  const planningTag = app.settings[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const tags = [DASHBOARD_NOTE_TAG, planningTag];

  const existing = await app.filterNotes({ query: noteName });
  const match = existing.find(n => n.name === noteName);

  let noteUUID;
  if (match) {
    noteUUID = match.uuid;
    const weekContent = await getMonthlyPlanContent(app, noteUUID, weekLabel);
    if (!weekContent.found) {
      await app.insertNoteContent({ uuid: noteUUID }, defaultWeekTemplate(weekLabel), { atEnd: true });
    }
  } else {
    const template = _defaultQuarterlyTemplate(label, quarter);
    noteUUID = await app.createNote(noteName, tags);
    await app.insertNoteContent({ uuid: noteUUID }, template);
    await app.insertNoteContent({ uuid: noteUUID }, defaultWeekTemplate(weekLabel), { atEnd: true });
  }

  const content = await _readMonthContentWithRetry(app, noteUUID, weekLabel);
  return { noteUUID, content };
}

// --------------------------------------------------------------------------------------
// Private helpers
// --------------------------------------------------------------------------------------

// [Claude] Task: retry reading month content after insert to handle API eventual consistency
// Prompt: "after appending month content, need a sleep timer because the initial read doesn't find the new content"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
async function _readMonthContentWithRetry(app, noteUUID, monthName, { attempts = 3, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    const fullContent = await app.getNoteContent({ uuid: noteUUID });
    const content = extractMonthSectionContent(fullContent, monthName);
    if (content) return content;
  }
  return defaultMonthTemplate(monthName).split('\n').filter(l => l && !l.startsWith('#')).join('\n');
}

// --------------------------------------------------------------------------------------
// [Claude] Task: resolve task domains from cache or fresh API call
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
async function _resolveTaskDomains(app) {
  const raw = app.settings[SETTING_KEYS.TASK_DOMAINS];
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }

  const isStale = !stored.lastRetrieved || (Date.now() - stored.lastRetrieved > TASK_DOMAIN_STALE_MS);
  const hasDomains = Array.isArray(stored.domains) && stored.domains.length > 0;

  if (!hasDomains || isStale) {
    const freshDomains = await app.getTaskDomains();
    stored.domains = (Array.isArray(freshDomains) ? freshDomains : [])
      .filter(d => d && d.uuid)
      .map(d => ({ name: d.name, uuid: d.uuid }));
    stored.lastRetrieved = Date.now();

    // Validate current selection still exists
    const selectedStillExists = stored.selectedDomainUuid &&
      stored.domains.some(d => d.uuid === stored.selectedDomainUuid);
    if (!selectedStillExists) {
      stored.selectedDomainUuid = _pickDefaultDomain(stored.domains);
    }

    await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));
  }

  // Ensure a domain is always selected
  if (!stored.selectedDomainUuid && stored.domains.length > 0) {
    stored.selectedDomainUuid = _pickDefaultDomain(stored.domains);
    await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));
  }

  return stored;
}

// --------------------------------------------------------------------------------------
// [Claude] Task: extract value from Promise.allSettled result with fallback on rejection
// Prompt: "wrap each component load in try...catch so failure to render one widget does not disrupt others"
// Date: 2026-03-21 | Model: claude-4.6-opus-high-thinking
function _settledValueOr(result, fallback, label) {
  if (result.status === 'fulfilled') return result.value;
  logIfEnabled(`[fetchDashboardData] ${label} fetch failed, using fallback:`, result.reason);
  return fallback;
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
  try {
    const tasks = await app.getTaskDomainTasks(domainUuid);
    return Array.isArray(tasks) ? tasks : [];
  } catch (err) {
    logIfEnabled(`[_fetchTasksForDomain] getTaskDomainTasks failed for domain ${domainUuid}:`, err);
    return [];
  }
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
  logIfEnabled("Mood ratings", moodRatings, "from", fromUnixSeconds);
  return moodRatings;
}

// --------------------------------------------------------------------------------------
// [Claude] Task: enrich quarterly plan objects with hasAllMonthlyDetails flag
// Prompt: "show a checkmark or WIP icon based on whether each month of the quarter has been planned"
// Date: 2026-03-09 | Model: claude-4.6-sonnet-medium-thinking
async function _findQuarterlyPlans(app) {
  const current = getCurrentQuarter();
  const next = getNextQuarter();
  logIfEnabled(`[_findQuarterlyPlans] querying: "${current.label} Plan", "${next.label} Plan"`);

  const [currentPlans, nextPlans] = await Promise.all([
    app.filterNotes({ query: `${current.label} Plan` }),
    app.filterNotes({ query: `${next.label} Plan` })
  ]);
  logIfEnabled(`[_findQuarterlyPlans] filterNotes results — current:`, currentPlans, `next:`, nextPlans);

  const currentNoteUUID = currentPlans.find(n => n.name === `${current.label} Plan`)?.uuid;
  const nextNoteUUID    = nextPlans.find(n => n.name === `${next.label} Plan`)?.uuid;
  logIfEnabled(`[_findQuarterlyPlans] resolved UUIDs — current: ${currentNoteUUID}, next: ${nextNoteUUID}`);

  const currentMonths = _quarterMonthNames(current.quarter);
  const nextMonths    = _quarterMonthNames(next.quarter);

  const [currentHasAll, nextHasAll] = await Promise.all([
    currentNoteUUID ? _hasAllMonthSections(app, currentNoteUUID, currentMonths) : Promise.resolve(false),
    nextNoteUUID    ? _hasAllMonthSections(app, nextNoteUUID,    nextMonths)    : Promise.resolve(false),
  ]);
  logIfEnabled(`[_findQuarterlyPlans] hasAllMonthlyDetails — current: ${currentHasAll}, next: ${nextHasAll}`);

  return {
    current: { ...current, noteUUID: currentNoteUUID, hasAllMonthlyDetails: currentHasAll },
    next:    { ...next,    noteUUID: nextNoteUUID,    hasAllMonthlyDetails: nextHasAll },
  };
}

// --------------------------------------------------------------------------------------
// Returns the three full month names for the given 1-based quarter number.
function _quarterMonthNames(quarter) {
  const start = (quarter - 1) * 3;
  return [0, 1, 2].map(i => FULL_MONTH_NAMES[(start + i) % 12]);
}

// --------------------------------------------------------------------------------------
// Returns true when every month name in monthNames has a matching heading section in the note.
async function _hasAllMonthSections(app, noteUUID, monthNames) {
  try {
    const sections = await app.getNoteSections({ uuid: noteUUID });
    return monthNames.every(name =>
      sections.some(s => s.heading?.text?.trim().toLowerCase() === name.toLowerCase())
    );
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------------------
// [Claude] Task: include dashboard_mood_config key in settings fetch so viz mode persists across reload
// Prompt: "mood visualization not persisted through page reload"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
async function _readDashboardSettings(app) {
  const keys = [
    widgetConfigKey("victory-value"),
    widgetConfigKey("calendar"),
    widgetConfigKey("quotes"),
    widgetConfigKey("mood"),
    widgetConfigKey("recent-notes"),
  ];
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
  settings[SETTING_KEYS.CONSOLE_LOGGING]       = app.settings[SETTING_KEYS.CONSOLE_LOGGING] || '';

  settings[SETTING_KEYS.LLM_PROVIDER_MODEL]    = app.settings[SETTING_KEYS.LLM_PROVIDER_MODEL] || '';
  settings[SETTING_KEYS.LLM_API_KEY_ANTHROPIC] = app.settings[SETTING_KEYS.LLM_API_KEY_ANTHROPIC] || '';
  settings[SETTING_KEYS.LLM_API_KEY_GEMINI]    = app.settings[SETTING_KEYS.LLM_API_KEY_GEMINI] || '';
  settings[SETTING_KEYS.LLM_API_KEY_GROK]      = app.settings[SETTING_KEYS.LLM_API_KEY_GROK] || '';
  settings[SETTING_KEYS.LLM_API_KEY_OPENAI]    = app.settings[SETTING_KEYS.LLM_API_KEY_OPENAI] || '';

  let componentLayout = null;
  try {
    componentLayout = app.settings[SETTING_KEYS.DASHBOARD_COMPONENTS]
      ? JSON.parse(app.settings[SETTING_KEYS.DASHBOARD_COMPONENTS])
      : null;
  } catch {
    componentLayout = null;
  }

  if (!Array.isArray(componentLayout) || componentLayout.length === 0) {
    componentLayout = DEFAULT_DASHBOARD_COMPONENTS.map(component => ({ ...component }));
    await app.setSetting(SETTING_KEYS.DASHBOARD_COMPONENTS, JSON.stringify(componentLayout));
  }

  settings[SETTING_KEYS.DASHBOARD_COMPONENTS] = componentLayout;
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

// [Claude] Task: substitute actual quarter label and month names into the default template
// Prompt: "Update _defaultQuarterlyTemplate to substitute proper month names for whatever quarter was clicked"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
function _defaultQuarterlyTemplate(label, quarter) {
  const quarterMonths = {
    1: ["January", "February", "March"],
    2: ["April", "May", "June"],
    3: ["July", "August", "September"],
    4: ["October", "November", "December"],
  };
  const months = quarterMonths[quarter] || ["Month 1", "Month 2", "Month 3"];

  return `Quarterly Plan — ${label}

# Quarter Theme
[One sentence describing the main focus of this quarter.]

## Success Looks Like
1. [ ] [Top outcome]
2. [ ] [Top outcome]
3. [ ] [Top outcome]

# Projects

## [Project 1]
- Outcome:
- Why now:
- Weekly rhythm:
- Deadline:
- Constraints:
- Done enough when:

## [Project 2]
- Outcome:
- Why now:
- Weekly rhythm:
- Deadline:
- Constraints:
- Done enough when:

## [Project 3]
- Outcome:
- Why now:
- Weekly rhythm:
- Deadline:
- Constraints:
- Done enough when:

# Not This Quarter
- [ ] [Lower-priority project]
- [ ] [Commitment to decline]
- [ ] [Area to intentionally ignore]

# Day-of-Week Breakdown
Any category of task you would like to have be the focus for different days-of-week (sometimes called "day striping")?
Separate your task categories with a semicolon (i.e., ";"). We will consider them when proposing possible 
daily agendas from your existing tasks.  

- Mondays: 
- Tuesdays: 
- Wednesdays: 
- Thursdays: 
- Fridays: 

[Amplenote message]
You can also add Saturday and Sunday if you like; they're not in the list since by default because we suspect 
you're best off preserving your weekend for unplanned family & restoration activities.   

# Month-by-Month Breakdown

## ${months[0]}
- Focus:
- Key move:

## ${months[1]}
- Focus:
- Key move:

## ${months[2]}
- Focus:
- Key move:

# Weekly Planning Prompt
Which projects need time on my calendar this week?

# Quarterly Review
- Finished:
- Progress made:
- Lessons learned:
- Carry forward:`;
}
