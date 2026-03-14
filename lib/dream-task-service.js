/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask agentic analysis — suggests tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget with an agentic loop that analyzes tasks and suggests goal-aligned work"
 */
import { getCurrentQuarter, extractMonthSectionContent, getUpcomingWeekMonday, formatWeekLabel, FULL_MONTH_NAMES } from "constants/quarters"
import { DASHBOARD_NOTE_TAG, IS_DEV_ENVIRONMENT, SETTING_KEYS } from "constants/settings"
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers"
import { llmPrompt } from "providers/fetch-ai-provider"
import { logIfEnabled } from "util/log"

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_TASKS_IN_PROMPT = 50;
const MAX_PREVIOUS_ANALYSIS_CHARS = 2000;
const MAX_QUARTERLY_CONTENT_CHARS = 3000;
const MAX_MONTHLY_CONTENT_CHARS = 1000;
const MAX_WEEKLY_CONTENT_CHARS = 1000;
const MAX_GOALS_SUMMARY_CHARS = 500;

// [Claude] Task: agentic loop that gathers context, calls LLM, writes suggestions to a monthly note
// Prompt: "Create a DreamTask widget with an agentic loop that analyzes tasks and suggests goal-aligned work"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude] Task: remove plugin param — llmPrompt does not use it
// Prompt: "dreamTaskAnalyze is not a method of app; call analyzeDreamTasks directly from widget"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude] Task: accept excludeUuids set to filter candidate tasks for reseed calls
// Prompt: "re-prompt LLM with tasks that excludes the UUIDs of the tasks visible when user clicked reseed"
// Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
export async function analyzeDreamTasks(app, excludeUuids) {
  const now = new Date();
  const dayName = DAY_NAMES[now.getDay()];
  const monthName = FULL_MONTH_NAMES[now.getMonth()];
  const year = now.getFullYear();
  const day = now.getDate();
  const dateHeading = `${dayName} ${monthName} ${day}, ${year}`;
  const noteName = `${monthName} ${year} Dashboard Task Ideas`;
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  let noteHandle = await app.findNote({ name: noteName });
  if (!noteHandle) {
    const uniqueIdentifier = await app.createNote(noteName, [DASHBOARD_NOTE_TAG]);
    noteHandle = { uuid: uniqueIdentifier };
    logIfEnabled(`[dream-task] Created monthly note "${noteName}" with uuid ${uniqueIdentifier}`);
  }

  const existingContent = await app.getNoteContent(noteHandle) || '';

  // Skip cache when the caller provides exclusions (i.e. a reseed request)
  const isReseed = excludeUuids && excludeUuids.size > 0;
  if (!isReseed) {
    const todaySection = _extractTodaySection(existingContent, dateHeading);
    if (todaySection) {
      logIfEnabled('[dream-task] Found cached analysis for today, returning parsed results');
      const cached = _parseCachedTasks(todaySection);
      return { tasks: cached.tasks, goalsSummary: cached.goalsSummary, cached: true, noteUUID: noteHandle.uuid };
    }
  }

  const domainUuid = _getActiveDomainUuid(app);
  const allTasks = domainUuid ? await app.getTaskDomainTasks(domainUuid) : [];
  const openTasks = allTasks.filter(task => !task.completedAt && !task.dismissedAt);
  logIfEnabled(`[dream-task] Found ${openTasks.length} open tasks from domain ${domainUuid}`);

  // [Claude] Task: filter out previously-seen task UUIDs when reseeding
  // Prompt: "re-prompt LLM with tasks that excludes the UUIDs of the tasks visible when user clicked reseed"
  // Date: 2026-03-14 | Model: claude-4.6-sonnet-medium-thinking
  const candidateTasks = isReseed && excludeUuids
    ? openTasks.filter(task => !excludeUuids.has(task.uuid))
    : openTasks;
  logIfEnabled(`[dream-task] After exclusion: ${candidateTasks.length} candidate tasks (${openTasks.length - candidateTasks.length} excluded)`);

  const quarter = getCurrentQuarter();
  const planName = `${quarter.label} Plan`;
  const planNotes = await app.filterNotes({ query: planName });
  const planNote = planNotes.find(note => note.name === planName);

  let quarterlyContent = null;
  let monthlyContent = null;
  let weeklyContent = null;
  if (planNote) {
    const fullPlanContent = await app.getNoteContent({ uuid: planNote.uuid });
    if (fullPlanContent) {
      quarterlyContent = fullPlanContent;
      monthlyContent = extractMonthSectionContent(fullPlanContent, monthName);
      const weekMonday = getUpcomingWeekMonday();
      const weekLabel = formatWeekLabel(weekMonday);
      weeklyContent = extractMonthSectionContent(fullPlanContent, weekLabel);
    }
  }

  const previousAnalyses = existingContent
    ? existingContent.substring(0, MAX_PREVIOUS_ANALYSIS_CHARS)
    : null;

  // [Claude] Task: rank tasks by attributes and send top candidates as JSON to LLM
  // Prompt: "consider all task attributes, send top 10% or 50 tasks as JSON to the LLM"
  // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
  const topTasks = _rankAndSelectTopTasks(candidateTasks);
  const taskJsonObjects = topTasks.map(task => _buildTaskJsonObject(task));
  logIfEnabled(`[dream-task] Selected ${taskJsonObjects.length} top tasks from ${candidateTasks.length} candidate tasks for LLM analysis`);

  const prompt = _buildPrompt({
    dateHeading, dayName, isWeekend, taskJsonObjects,
    quarterlyContent, monthlyContent, weeklyContent, previousAnalyses,
    openTaskCount: candidateTasks.length,
  });

  logIfEnabled('[dream-task] Sending prompt to LLM, length:', prompt.length);
  // [Claude] Task: use OPEN_AI_ACCESS_TOKEN env var to query openai provider in dev
  // Prompt: "use the OPEN_AI_ACCESS_TOKEN environment variable to query openai in dev"
  // Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
  const llmOptions = { jsonResponse: true, timeoutSeconds: 60 };
  if (IS_DEV_ENVIRONMENT && process.env.OPEN_AI_ACCESS_TOKEN) {
    llmOptions.aiModel = PROVIDER_DEFAULT_MODEL.openai;
    llmOptions.apiKey = process.env.OPEN_AI_ACCESS_TOKEN;
    logIfEnabled('[dream-task] Dev mode: using OPEN_AI_ACCESS_TOKEN with openai provider');
  }
  let result;
  try {
    result = await llmPrompt(app, null, prompt, llmOptions);
  } catch (error) {
    logIfEnabled('[dream-task] LLM call failed:', error);
    return { tasks: [], error: 'LLM request failed. Please try again later.', noteUUID: noteHandle.uuid };
  }

  if (!result || !result.tasks) {
    logIfEnabled('[dream-task] LLM returned invalid response:', result);
    return { tasks: [], error: 'Could not parse AI response.', noteUUID: noteHandle.uuid };
  }

  const tasks = _validateTasks(result.tasks);
  const goalsSummary = _validateGoalsSummary(result.goalsSummary);
  logIfEnabled(`[dream-task] Received ${tasks.length} validated task suggestions, goals summary: ${goalsSummary ? goalsSummary.length + ' chars' : 'none'}`);

  const noteContent = _formatTasksForNote(dateHeading, tasks, goalsSummary);
  try {
    await app.insertNoteContent(noteHandle, noteContent);
    logIfEnabled('[dream-task] Wrote analysis to monthly note');
  } catch (error) {
    logIfEnabled('[dream-task] Failed to write to monthly note:', error);
  }

  const shownUuids = topTasks.map(t => t.uuid).filter(Boolean);
  return { tasks, goalsSummary, cached: false, noteUUID: noteHandle.uuid, shownUuids };
}

// ---------------------------------------------------------------------------
function _getActiveDomainUuid(app) {
  const rawValue = app.settings[SETTING_KEYS.TASK_DOMAINS];
  try {
    const parsedSettings = rawValue ? JSON.parse(rawValue) : {};
    return parsedSettings.selectedDomainUuid || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
function _extractTodaySection(content, dateHeading) {
  const marker = `## ${dateHeading}`;
  const headingIndex = content.indexOf(marker);
  if (headingIndex === -1) return null;

  const sectionStart = headingIndex + marker.length;
  const nextHeading = content.indexOf('\n## ', sectionStart);
  const section = nextHeading !== -1
    ? content.substring(sectionStart, nextHeading)
    : content.substring(sectionStart);
  return section.trim() || null;
}

// ---------------------------------------------------------------------------
// [Claude] Task: parse goals summary and task entries from cached note section
// Prompt: "begin the date's content by summarizing quarter/month/week goals before the task list"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function _parseCachedTasks(sectionContent) {
  const tasks = [];
  const taskRegex = /### \d+\.\s+(.+?)\s+\(Rating:\s*(\d+)\/10\)\n([\s\S]*?)(?=\n### |\n---|$)/g;
  let regexMatch;
  while ((regexMatch = taskRegex.exec(sectionContent)) !== null) {
    tasks.push({
      title: regexMatch[1].trim(),
      rating: parseInt(regexMatch[2], 10),
      explanation: regexMatch[3].trim(),
    });
  }

  let goalsSummary = null;
  const firstTaskIndex = sectionContent.search(/### \d+\./);
  if (firstTaskIndex > 0) {
    const preamble = sectionContent.substring(0, firstTaskIndex).trim();
    const summaryMatch = preamble.match(/\*\*Your goals this quarter\/month\/week:\*\*\s*([\s\S]*)/);
    if (summaryMatch) {
      goalsSummary = summaryMatch[1].trim();
    }
  }

  return { tasks, goalsSummary };
}

// ---------------------------------------------------------------------------
function _validateTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(task => task && typeof task.title === 'string' && task.title.trim().length > 0)
    .map(task => ({
      title: String(task.title).trim(),
      explanation: String(task.explanation || '').trim(),
      rating: Math.min(10, Math.max(1, parseInt(task.rating, 10) || 5)),
    }))
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
function _validateGoalsSummary(summary) {
  if (!summary || typeof summary !== 'string') return null;
  const trimmed = summary.trim();
  if (!trimmed) return null;
  return trimmed.substring(0, MAX_GOALS_SUMMARY_CHARS);
}

// ---------------------------------------------------------------------------
// [Claude] Task: rank open tasks by urgency/importance/score/deadline to select top candidates for LLM
// Prompt: "consider all task attributes, send top 10% or 50 (whichever smaller) as JSON to LLM"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function _rankAndSelectTopTasks(openTasks) {
  const scored = openTasks.map(task => {
    let rank = 0;
    const taskScore = task.score ?? task.victoryValue ?? 0;

    if (task.important) rank += 20;
    if (task.urgent) rank += 15;
    if (taskScore > 10) rank += 15;
    else if (taskScore > 5) rank += 8;

    if (task.deadline) {
      const nowSeconds = Date.now() / 1000;
      const deadlineSeconds = task.deadline < 1e10 ? task.deadline : task.deadline / 1000;
      const daysUntil = (deadlineSeconds - nowSeconds) / 86400;
      if (daysUntil < 0) rank += 25;
      else if (daysUntil <= 1) rank += 20;
      else if (daysUntil <= 3) rank += 12;
      else if (daysUntil <= 7) rank += 5;
    }

    if (task.startAt) {
      const nowSeconds = Date.now() / 1000;
      const startSeconds = task.startAt < 1e10 ? task.startAt : task.startAt / 1000;
      if (startSeconds <= nowSeconds) rank += 5;
      else if ((startSeconds - nowSeconds) / 86400 <= 1) rank += 3;
    }

    rank += Math.min(taskScore, 15);

    return { task, rank };
  });

  scored.sort((first, second) => second.rank - first.rank);
  const limit = Math.min(Math.ceil(openTasks.length * 0.1), MAX_TASKS_IN_PROMPT);
  return scored.slice(0, Math.max(limit, 3)).map(scoredEntry => scoredEntry.task);
}

// ---------------------------------------------------------------------------
// [Claude] Task: build a JSON representation of a task for LLM evaluation per Amplenote task type
// Prompt: "send a JSON for each task to the LLM — https://www.amplenote.com/help/developing_amplenote_plugins/appendix_i#task"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// [Claude] Task: expand abbreviated variable/method names for clarity
// Date: 2026-03-14
function _buildTaskJsonObject(task) {
  const taskJsonObject = { content: task.content, uuid: task.uuid };
  if (task.important) taskJsonObject.important = true;
  if (task.urgent) taskJsonObject.urgent = true;
  const score = task.score ?? task.victoryValue;
  if (score != null) taskJsonObject.score = score;
  if (task.deadline) {
    taskJsonObject.deadline = task.deadline;
    taskJsonObject.deadlineFormatted = new Date(task.deadline < 1e10 ? task.deadline * 1000 : task.deadline)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (task.startAt) {
    taskJsonObject.startAt = task.startAt;
    taskJsonObject.startAtFormatted = new Date(task.startAt < 1e10 ? task.startAt * 1000 : task.startAt)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (task.hideUntil) {
    taskJsonObject.hiddenUntilFormatted = new Date(task.hideUntil < 1e10 ? task.hideUntil * 1000 : task.hideUntil)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (task.isRepeating) taskJsonObject.isRepeating = true;
  return taskJsonObject;
}

// ---------------------------------------------------------------------------
function _buildPrompt({ dateHeading, dayName, isWeekend, taskJsonObjects,
    quarterlyContent, monthlyContent, weeklyContent, previousAnalyses, openTaskCount }) {
  let prompt = `You are a productivity coach analyzing a user's task list and goals to suggest the most impactful tasks for today.

Today is ${dateHeading}.`;

  if (isWeekend) {
    prompt += `\nIt is ${dayName} — a weekend day. Lean toward creative, exploratory, or enjoyable tasks that still advance the user's goals. Fun side-projects, learning, and reflection are great weekend picks.`;
  } else {
    prompt += `\nIt is ${dayName} — a weekday. Prioritize high-impact, goal-advancing work that moves important projects forward.`;
  }

  if (quarterlyContent) {
    prompt += `\n\n## User's Quarterly Plan\n${quarterlyContent.substring(0, MAX_QUARTERLY_CONTENT_CHARS)}`;
  } else {
    prompt += `\n\n## User's Quarterly Plan\nNo quarterly plan found.`;
  }

  if (monthlyContent) {
    prompt += `\n\n## User's Monthly Focus\n${monthlyContent.substring(0, MAX_MONTHLY_CONTENT_CHARS)}`;
  }

  if (weeklyContent) {
    prompt += `\n\n## User's Weekly Plan\n${weeklyContent.substring(0, MAX_WEEKLY_CONTENT_CHARS)}`;
  }

  if (previousAnalyses) {
    prompt += `\n\n## Previous Task Suggestions This Month (avoid repeating these verbatim)\n${previousAnalyses}`;
  }

  prompt += `\n\n## Top Candidate Tasks (${openTaskCount} open total, ${taskJsonObjects.length} highest-ranked shown as JSON)\n`;
  if (taskJsonObjects.length > 0) {
    prompt += `Each task object follows the Amplenote task type schema. The "score" field reflects how long the task has been accumulating value — higher scores indicate tasks that have been waiting longer or are overdue. Tasks marked "important" or "urgent" deserve special consideration.\n\n`;
    prompt += taskJsonObjects.map(task => JSON.stringify(task)).join('\n');
  } else {
    prompt += 'No open tasks found.';
  }

  prompt += `

Your response must include two parts:

1. **goalsSummary**: A concise summary of the user's known goals for this quarter, month, and week. Write at least one sentence per time horizon that has content available (quarter, month, week). Maximum 5 sentences and ${MAX_GOALS_SUMMARY_CHARS} characters total. If a time horizon has no plan, note that briefly. This summary captures the essence of what the user is seeking to accomplish in the near term.

2. **tasks**: 3-5 tasks that are especially well-aligned with those goals. Tasks may come from the candidate list above or be entirely new suggestions. For each task provide:
   - A clear, actionable task title
   - A 2-3 sentence explanation of why this task deserves attention today, referencing specific goals and the day of the week
   - A rating from 1-10 for how relevant and impactful this task is right now

Return ONLY valid JSON in this exact format (no markdown fences):
{"goalsSummary":"Summary of quarter/month/week goals...","tasks":[{"title":"Task title","explanation":"Why this task matters today...","rating":8}]}`;

  return prompt;
}

// ---------------------------------------------------------------------------
// [Claude] Task: format note content with goals summary preceding the task list
// Prompt: "begin the date's content by summarizing quarter/month/week goals before the task list"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function _formatTasksForNote(dateHeading, tasks, goalsSummary) {
  let content = `## ${dateHeading}\n\n`;
  if (goalsSummary) {
    content += `**Your goals this quarter/month/week:**\n${goalsSummary}\n\n`;
  }
  tasks.forEach((task, index) => {
    content += `### ${index + 1}. ${task.title} (Rating: ${task.rating}/10)\n`;
    content += `${task.explanation}\n\n`;
  });
  content += '---\n\n';
  return content;
}
