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
  IS_DEV_ENVIRONMENT,
  SETTING_KEYS,
  TASK_DOMAIN_STALE_MS,
  widgetConfigKey,
} from "constants/settings"
// pluginSettings() is the embed-side settings cache. This module is dual-purpose:
//   - fetchDashboardData (and its `_helper` callees) run plugin-side with the real app.settings.
//   - Exported functions called from embed widgets (switchTaskDomain, fetchQuotes, etc.) read
//     settings via pluginSettings() because the embed's app Proxy doesn't carry settings.
import { pluginSettings, updatePluginSetting } from "plugin-data"
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks"
import { weekEndFromDateInput, weekStartFromDateInput } from "util/date-utility"
import { logIfEnabled, setLoggingEnabled } from "util/log"
import { snapDashboardAction } from "util/plausible";
import { quarterlyPlanNoteName, resolveQuarterlyPlanNote } from "util/quarterly-plan-notes"
import { activeTaskDomainInfo, defaultDomainUuid, migrationDomainNameFromDomains } from "util/task-domain-utility"

// ------------------------------------------------------------------------------------------
// @desc Normalize a soft-failed init branch into a serializable record the embed can forward to Sentry. This code runs
//   plugin-side, in the host app's JavaScript context, where the embed's Sentry client does not exist — so failures
//   ride back across the bridge on the init payload rather than being logged and forgotten. The stack travels with
//   them because it is the only way the resulting Sentry event can point at the Amplenote call that actually threw.
// @param {Error|*} error - Thrown value from a soft-failed init branch
// @param {string} source - Stable label for the branch that failed, e.g. "init-domains" or "init-mood"
// @returns {Object} A record with the following properties:
// - {string} message - Failure message, falling back to the source label for non-Error throws
// - {string} source - The label passed in, used as the Sentry action tag so prevalence per branch is countable
// - {string|null} stack - Plugin-side stack when the thrown value carried one
function _initFailureRecord(error, source) {
  return { message: error?.message || String(error) || source, source, stack: error?.stack || null };
}

// ------------------------------------------------------------------------------------------
// @description Fetches all data needed to render the dashboard. Domain resolution runs in
//   parallel with mood/plans/settings; domain-task fetch is chained immediately off domain
//   resolution so it starts as soon as the domain UUID is known rather than waiting for all
//   other fetches to complete. This eliminates the prior sequential bottleneck where
//   _resolveTaskDomains blocked the start of every other fetch.
// @param {Object} app - Amplenote app interface
// @returns {Promise<Object>} Dashboard data object
export async function fetchDashboardData(app) {
  setLoggingEnabled(app.settings?.[SETTING_KEYS.CONSOLE_LOGGING]);
  const t0 = Date.now();
  const initFailures = [];
  logIfEnabled('[fetchDashboardData] starting — launching domain + mood/plans/settings in parallel');
  const now = new Date();
  const weekStart = weekStartFromDateInput(now);
  const weekEnd = weekEndFromDateInput(now);
  const twoWeeksAgoUnixSeconds = Math.floor(Date.now() / 1000) - (60 * 60 * 24 * 14);

  const domainPromise = _resolveTaskDomains(app).catch(err => {
    logIfEnabled('[fetchDashboardData] _resolveTaskDomains failed:', err);
    initFailures.push(_initFailureRecord(err, "init-domains"));
    return { domains: [], selectedDomainUuid: null };
  });

  // Chain tasks and quarterly plans off domain resolution so both are scoped to the active Task Domain. Each branch
  // soft-fails to a usable default so one unavailable Amplenote API degrades a single widget rather than blocking the
  // whole load — which on mobile showed up as a dashboard stuck on "Loading…" rather than as an error. Every default
  // taken is recorded on initFailures so the embed can report it and we can see how often each branch fails.
  const tasksPromise = domainPromise.then(info => {
    logIfEnabled(`[fetchDashboardData] domain resolved in ${ Date.now() - t0 }ms, uuid=${ info.selectedDomainUuid } — fetching tasks`);
    return _fetchTasksForDomain(app, info.selectedDomainUuid).catch(err => {
      logIfEnabled('[fetchDashboardData] _fetchTasksForDomain failed:', err);
      initFailures.push(_initFailureRecord(err, "init-tasks"));
      return [];
    });
  });
  const plansPromise = domainPromise.then(info => _findQuarterlyPlans(app, info).catch(err => {
    logIfEnabled('[fetchDashboardData] _findQuarterlyPlans failed:', err);
    initFailures.push(_initFailureRecord(err, "init-plans"));
    return _emptyQuarterlyPlans(info);
  }));

  const [taskDomainInfo, moodRatings, quarterlyPlans, settings, domainTasks] = await Promise.all([
    domainPromise,
    _safeMoodRatings(app, twoWeeksAgoUnixSeconds, initFailures),
    plansPromise,
    _readDashboardSettings(app).catch(err => {
      logIfEnabled('[fetchDashboardData] _readDashboardSettings failed:', err);
      initFailures.push(_initFailureRecord(err, "init-settings"));
      return {};
    }),
    tasksPromise,
  ]);
  logIfEnabled(`[fetchDashboardData] all resolved in ${ Date.now() - t0 }ms — ${ domainTasks.length } tasks, ${ moodRatings?.length ?? 0 } mood ratings`);

  return {
    activeTaskDomain: taskDomainInfo.selectedDomainUuid,
    completedThisWeek: _filterCompletedInRange(domainTasks, weekStart, weekEnd),
    context: { noteUUID: app.context?.noteUUID || null, pluginUUID: app.context?.pluginUUID || null },
    currentDate: now.toISOString(),
    dailyVictoryValues: _calculateDailyVictoryValues(domainTasks, weekStart),
    initFailures,
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
  const raw = pluginSettings()[SETTING_KEYS.TASK_DOMAINS];
  let stored = {};
  try { stored = raw ? JSON.parse(raw) : {}; } catch { stored = {}; }
  stored.selectedDomainUuid = domainUuid;
  await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));
  updatePluginSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));

  // Fetch tasks and domain-scoped quarterly plans for the newly selected domain
  const domainTasks = await _fetchTasksForDomain(app, domainUuid);
  const quarterlyPlans = await _findQuarterlyPlans(app, { domains: stored.domains || [],
    selectedDomainUuid: domainUuid });

  return {
    activeTaskDomain: domainUuid,
    completedThisWeek: _filterCompletedInRange(domainTasks, weekStart, weekEnd),
    dailyVictoryValues: _calculateDailyVictoryValues(domainTasks, weekStart),
    quarterlyPlans,
    tasks: domainTasks,
    todayTasks: _filterTodayTasks(domainTasks, now),
    weeklyVictoryValue: _calculateWeeklyVictoryValue(domainTasks, weekStart, weekEnd),
  };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: force refresh of cached task domain list
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
// --------------------------------------------------------------------------------------
// @desc Log the raw value returned by app.getTaskDomains() in full detail so a host-side
//   failure (e.g. an error object instead of an array) can be diagnosed from the console.
// @param {string} prefix - Log prefix identifying the caller, e.g. "[refreshTaskDomains]"
// @param {*} response - The exact value app.getTaskDomains() resolved to (array, object, etc.)
// [Claude claude-opus-4-8] Task: log the full raw getTaskDomains() response for diagnosis
// Prompt: "Can we ensure we are logging what the API returns from getTaskDomains"
function _logTaskDomainsResponse(prefix, response) {
  const isArray = Array.isArray(response);
  const count = isArray ? response.length : 0;
  const type = response === null ? 'null' : Array.isArray(response) ? 'array' : typeof response;
  const keys = response && typeof response === 'object' && !isArray ? Object.keys(response) : null;
  let serialized;
  try { serialized = JSON.stringify(response); } catch { serialized = String(response); }
  logIfEnabled(`${prefix} getTaskDomains() returned ${count} domains (type=${type}${keys ? `, keys=[${keys.join(',')}]` : ''})`,
    { raw: response, serialized });
}

// [Claude claude-opus-4-8] Task: guard refresh against non-array API responses
// Prompt: "Refresh fails with 't.map is not a function' when getTaskDomains errors"
export async function refreshTaskDomains(app) {
  logIfEnabled('[refreshTaskDomains] Starting domain refresh');
  const raw = pluginSettings()[SETTING_KEYS.TASK_DOMAINS];
  logIfEnabled(`[refreshTaskDomains] Stored ${SETTING_KEYS.TASK_DOMAINS} setting`, raw);
  let stored = {};
  try {
    stored = raw ? JSON.parse(raw) : {};
  } catch (err) {
    logIfEnabled('[refreshTaskDomains] Failed to parse stored task-domains setting; starting fresh', { raw, err });
    stored = {};
  }

  // app.getTaskDomains() can throw or resolve to an error object (e.g. { error: ... })
  // instead of an array when the host fails. Normalize to an array and, on failure,
  // preserve any previously stored domains rather than wiping them.
  let domains;
  try {
    domains = await app.getTaskDomains();
  } catch (err) {
    logIfEnabled('[refreshTaskDomains] getTaskDomains() threw', err);
    domains = null;
  }
  _logTaskDomainsResponse('[refreshTaskDomains]', domains);

  if (Array.isArray(domains)) {
    stored.domains = domains.filter(d => d && d.uuid).map(d => ({ name: d.name, uuid: d.uuid }));
    stored.lastRetrieved = Date.now();
  } else {
    logIfEnabled('[refreshTaskDomains] API returned no usable domains; keeping previously stored domains');
    stored.domains = Array.isArray(stored.domains) ? stored.domains : [];
  }

  const selectedStillExists = stored.selectedDomainUuid &&
    stored.domains.some(d => d.uuid === stored.selectedDomainUuid);
  if (!selectedStillExists) {
    logIfEnabled(`[refreshTaskDomains] Previous selection ${ stored.selectedDomainUuid } no longer exists, picking default`);
    stored.selectedDomainUuid = defaultDomainUuid(stored.domains);
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
  const domainName = quarterInfo.domainName || (await activeTaskDomainInfo(app)).domainName;
  const noteName = quarterlyPlanNoteName(domainName, label);
  const planningTag = pluginSettings()[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const tags = [DASHBOARD_NOTE_TAG, planningTag];

  // Check if it already exists (including a legacy note migrated onto this domain)
  const { migrationDomainName } = await activeTaskDomainInfo(app);
  const allowLegacyMigration = domainName && migrationDomainName && domainName === migrationDomainName;
  const match = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, label);
  if (match) {
    await app.navigate(`https://www.amplenote.com/notes/${ match.uuid }`);
    return { uuid: match.uuid, existed: true };
  }

  snapDashboardAction("createQuarterlyPlan");
  const template = _defaultQuarterlyTemplate(label, quarter);
  const uuid = await app.createNote(noteName, tags);
  await app.insertNoteContent({ uuid }, template);
  await app.navigate(`https://www.amplenote.com/notes/${ uuid }`);

  if (IS_DEV_ENVIRONMENT && uuid) {
    return { devEdit: true, existed: false, noteUUID: uuid };
  } else {
    return { uuid, existed: false };
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
  const domainName = quarterInfo.domainName || (await activeTaskDomainInfo(app)).domainName;
  const noteName = quarterlyPlanNoteName(domainName, label);
  const planningTag = pluginSettings()[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const tags = [DASHBOARD_NOTE_TAG, planningTag];

  const { migrationDomainName } = await activeTaskDomainInfo(app);
  const allowLegacyMigration = domainName && migrationDomainName && domainName === migrationDomainName;
  const match = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, label);

  let noteUUID;
  if (match) {
    noteUUID = match.uuid;
    await app.insertNoteContent({ uuid: noteUUID }, defaultMonthTemplate(monthName), { atEnd: true });
  } else {
    const template = _defaultQuarterlyTemplate(label, quarter);
    snapDashboardAction("createQuarterlyPlan");
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
  const domainName = quarterInfo.domainName || (await activeTaskDomainInfo(app)).domainName;
  const noteName = quarterlyPlanNoteName(domainName, label);
  const planningTag = pluginSettings()[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const tags = [DASHBOARD_NOTE_TAG, planningTag];

  const { migrationDomainName } = await activeTaskDomainInfo(app);
  const allowLegacyMigration = domainName && migrationDomainName && domainName === migrationDomainName;
  const match = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, label);

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
    logIfEnabled(`[_resolveTaskDomains] cache ${hasDomains ? 'stale' : 'empty'} — calling getTaskDomains()`);
    const t0 = Date.now();
    const freshDomains = await app.getTaskDomains();
    _logTaskDomainsResponse(`[_resolveTaskDomains] (${Date.now() - t0}ms)`, freshDomains);
    stored.domains = (Array.isArray(freshDomains) ? freshDomains : [])
      .filter(d => d && d.uuid)
      .map(d => ({ name: d.name, uuid: d.uuid }));
    stored.lastRetrieved = Date.now();

    // Validate current selection still exists
    const selectedStillExists = stored.selectedDomainUuid &&
      stored.domains.some(d => d.uuid === stored.selectedDomainUuid);
    if (!selectedStillExists) {
      stored.selectedDomainUuid = defaultDomainUuid(stored.domains);
    }

    await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));
  }

  // Ensure a domain is always selected
  if (!stored.selectedDomainUuid && stored.domains.length > 0) {
    stored.selectedDomainUuid = defaultDomainUuid(stored.domains);
    await app.setSetting(SETTING_KEYS.TASK_DOMAINS, JSON.stringify(stored));
  }

  return stored;
}

// --------------------------------------------------------------------------------------
// [Claude claude-opus-4-8 (1M context)] Task: fall back to all-notes tasks when no task domain can be found
// Prompt: "fall back to not specifying any task domain UUID when no domain can be found"
async function _fetchTasksForDomain(app, domainUuid, includeDone = false) {
  const t0 = Date.now();
  const list = await fetchDomainOrAllNotesTasks(app, domainUuid, { includeDone });
  logIfEnabled(`[_fetchTasksForDomain] ${ domainUuid ? `getTaskDomainTasks(${ domainUuid })` : "all-notes fallback" } returned ${ list.length } tasks in ${ Date.now() - t0 }ms`);
  return list;
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
// @desc Read recent mood ratings, soft-failing to an empty list so an unavailable getMoodRatings degrades the Mood
//   widget alone instead of failing the whole dashboard load. A non-array result is treated as empty for the same
//   reason: every consumer indexes into this list.
// @param {Object} app - Amplenote app interface
// @param {number} fromUnixSeconds - Start of the ratings window, in Unix seconds (not milliseconds)
// @param {Array<Object>} initFailures - Collector of _initFailureRecord entries the embed forwards to Sentry
// @returns {Promise<Array<Object>>} Mood rating objects, or an empty array when the call failed
async function _safeMoodRatings(app, fromUnixSeconds, initFailures) {
  try {
    const moodRatings = await app.getMoodRatings(fromUnixSeconds);
    logIfEnabled("Mood ratings", moodRatings, "from", fromUnixSeconds);
    return Array.isArray(moodRatings) ? moodRatings : [];
  } catch (error) {
    logIfEnabled('[fetchDashboardData] getMoodRatings failed:', error);
    initFailures.push(_initFailureRecord(error, "init-mood"));
    return [];
  }
}

// --------------------------------------------------------------------------------------
// @desc Build a quarterly-plans stub that preserves the shape PlanningWidget expects when plan note lookup fails, so
//   init still completes and the widget offers to create a plan rather than the whole dashboard refusing to load.
// @param {Object} domainInfo - Resolved domain payload carrying domains[] and selectedDomainUuid
// @returns {{ current: Object, next: Object }} Empty plan entries for the current and next quarter
function _emptyQuarterlyPlans(domainInfo) {
  const current = getCurrentQuarter();
  const next = getNextQuarter();
  const domains = Array.isArray(domainInfo?.domains) ? domainInfo.domains : [];
  const selectedDomainUuid = domainInfo?.selectedDomainUuid || null;
  const domainName = domains.find(domain => domain.uuid === selectedDomainUuid)?.name || null;
  return {
    current: { ...current, domainName, hasAllMonthlyDetails: false, noteUUID: null },
    next: { ...next, domainName, hasAllMonthlyDetails: false, noteUUID: null },
  };
}

// --------------------------------------------------------------------------------------
// [Claude] Task: enrich quarterly plan objects with hasAllMonthlyDetails flag
// Prompt: "show a checkmark or WIP icon based on whether each month of the quarter has been planned"
// Date: 2026-03-09 | Model: claude-4.6-sonnet-medium-thinking
// [Cursor Grok 4.5] Task: resolve domain-scoped plan notes; migrate legacy "${label} Plan" once
// Prompt: "Quarterly Goals module name must include the Task Domain; migrate legacy plans"
async function _findQuarterlyPlans(app, domainInfo) {
  const t0 = Date.now();
  const current = getCurrentQuarter();
  const next = getNextQuarter();
  const domains = Array.isArray(domainInfo?.domains) ? domainInfo.domains : [];
  const selectedDomainUuid = domainInfo?.selectedDomainUuid || null;
  const domainName = domains.find(domain => domain.uuid === selectedDomainUuid)?.name || null;
  const migrationDomainName = migrationDomainNameFromDomains(domains);
  const allowLegacyMigration = domainName && migrationDomainName && domainName === migrationDomainName;
  const currentPlanName = quarterlyPlanNoteName(domainName, current.label);
  const nextPlanName = quarterlyPlanNoteName(domainName, next.label);
  logIfEnabled(`[_findQuarterlyPlans] querying: "${ currentPlanName }", "${ nextPlanName }" (legacyMigration=${ allowLegacyMigration })`);

  const [currentNote, nextNote] = await Promise.all([
    resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, current.label),
    resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, next.label),
  ]);
  const currentNoteUUID = currentNote?.uuid || null;
  const nextNoteUUID = nextNote?.uuid || null;
  logIfEnabled(`[_findQuarterlyPlans] resolved UUIDs — current: ${ currentNoteUUID }, next: ${ nextNoteUUID }`);

  const currentMonths = _quarterMonthNames(current.quarter);
  const nextMonths = _quarterMonthNames(next.quarter);

  const [currentHasAll, nextHasAll] = await Promise.all([
    currentNoteUUID ? _hasAllMonthSections(app, currentNoteUUID, currentMonths) : Promise.resolve(false),
    nextNoteUUID ? _hasAllMonthSections(app, nextNoteUUID, nextMonths) : Promise.resolve(false),
  ]);
  logIfEnabled(`[_findQuarterlyPlans] hasAllMonthlyDetails — current: ${ currentHasAll }, next: ${ nextHasAll } (${ Date.now() - t0 }ms total)`);

  return {
    current: { ...current, domainName, noteUUID: currentNoteUUID, hasAllMonthlyDetails: currentHasAll },
    next: { ...next, domainName, noteUUID: nextNoteUUID, hasAllMonthlyDetails: nextHasAll },
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
    widgetConfigKey("note-peek"),
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

  return `# Quarter Theme
[One sentence describing the main focus of this quarter.]

## Success Looks Like
- [ ] [Top outcome]
- [ ] [Top outcome]
- [ ] [Top outcome]

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
