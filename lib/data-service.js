import { getCurrentQuarter, getNextQuarter, quarterLabel } from "./constants/quarters"

// --------------------------------------------------------------------------------------
export async function fetchDashboardData(app) {
  const now = new Date();
  const weekStart = _getWeekStart(now);
  const weekEnd = _getWeekEnd(now);

  // Parallel fetch: tasks, mood, quarterly plans, settings
  const [domains, moodRatings, quarterlyPlans, settings] = await Promise.all([
    app.getTaskDomains(),
    _safeMoodRatings(app, weekStart.getTime(), weekEnd.getTime()),
    _findQuarterlyPlans(app),
    _readDashboardSettings(app)
  ]);

  // Fetch tasks from all domains in parallel
  const tasksByDomain = await Promise.all(
    domains.map(async (domain) => ({
      domain: domain.name,
      tasks: await app.getTaskDomainTasks(domain.handle || domain)
    }))
  );

  const allTasks = tasksByDomain.flatMap(d => d.tasks);

  return {
    tasks: allTasks,
    todayTasks: _filterTodayTasks(allTasks, now),
    completedThisWeek: _filterCompletedInRange(allTasks, weekStart, weekEnd),
    weeklyVictoryValue: _calculateWeeklyVictoryValue(allTasks, weekStart, weekEnd),
    dailyVictoryValues: _calculateDailyVictoryValues(allTasks, weekStart),
    moodRatings,
    quarterlyPlans,
    currentDate: now.toISOString(),
    settings
  };
}

// --------------------------------------------------------------------------------------
export async function createQuarterlyPlan(app, quarterInfo) {
  const { label, year, quarter } = quarterInfo; // e.g., { label: "Q1 2026", year: 2026, quarter: 1 }
  const noteName = `${label} Plan`;
  const tags = ["planning/quarterly"];

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
export async function fetchQuotes(app, planContent) {
  const apiKey = app.settings["LLM API Key"];
  const provider = app.settings["LLM Provider"] || "openai";

  if (!apiKey) {
    return [
      { text: "Set an LLM API key in plugin settings to generate personalized quotes.", author: "" },
      { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" }
    ];
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
export async function navigateToNote(app, noteUUID) {
  await app.navigate(`https://www.amplenote.com/notes/${noteUUID}`);
}

// --------------------------------------------------------------------------------------
// Private helpers
// --------------------------------------------------------------------------------------
function _filterTodayTasks(tasks, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayEnd = dayStart + 86400000;
  return tasks.filter(t =>
    !t.completedAt && !t.dismissedAt && t.startAt && t.startAt >= dayStart && t.startAt < dayEnd
  ).sort((a, b) => a.startAt - b.startAt);
}

function _filterCompletedInRange(tasks, start, end) {
  return tasks.filter(t =>
    t.completedAt && t.completedAt >= start.getTime() && t.completedAt <= end.getTime()
  );
}

function _calculateWeeklyVictoryValue(tasks, weekStart, weekEnd) {
  return _filterCompletedInRange(tasks, weekStart, weekEnd)
    .reduce((sum, t) => sum + (t.victoryValue || 0), 0);
}

function _calculateDailyVictoryValues(tasks, weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(weekStart);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayTasks = tasks.filter(t =>
      t.completedAt && t.completedAt >= dayStart.getTime() && t.completedAt < dayEnd.getTime()
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

async function _safeMoodRatings(app, startTimestamp, endTimestamp) {
  try {
    return await app.getMoodRatings(startTimestamp, endTimestamp);
  } catch (e) {
    console.error("getMoodRatings not available or failed:", e);
    return [];
  }
}

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

async function _readDashboardSettings(app) {
  const keys = ["dashboard_victory-value_config", "dashboard_calendar_config", "dashboard_quotes_config"];
  const settings = {};
  for (const key of keys) {
    try {
      const val = app.settings[key];
      settings[key] = val ? JSON.parse(val) : null;
    } catch { settings[key] = null; }
  }
  return settings;
}

function _getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff); d.setHours(0, 0, 0, 0);
  return d;
}

function _getWeekEnd(date) {
  const start = _getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

function _previousQuarterLabel(year, quarter) {
  if (quarter === 1) return `Q4 ${year - 1}`;
  return `Q${quarter - 1} ${year}`;
}

function _extractHeadings(markdownContent) {
  return (markdownContent.match(/^#{1,3}\s+.+$/gm) || []).filter(h => !h.startsWith("# "));
}

function _defaultQuarterlyTemplate(label) {
  return `# ${label} Plan\n\n## Goals\n\n## Key Results\n\n## Projects\n\n## Reflections\n\n`;
}
