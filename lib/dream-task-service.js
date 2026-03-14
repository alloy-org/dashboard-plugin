/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask agentic analysis — suggests tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget with an agentic loop that analyzes tasks and suggests goal-aligned work"
 */
import { getCurrentQuarter, extractMonthSectionContent, FULL_MONTH_NAMES } from "constants/quarters"
import { DASHBOARD_NOTE_TAG, IS_DEV_ENVIRONMENT, TASK_DOMAIN_SETTING } from "constants/settings"
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers"
import { llmPrompt } from "providers/fetch-ai-provider"
import { logIfEnabled } from "util/log"

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_TASKS_IN_PROMPT = 50;
const MAX_PREVIOUS_ANALYSIS_CHARS = 2000;
const MAX_QUARTERLY_CONTENT_CHARS = 3000;
const MAX_MONTHLY_CONTENT_CHARS = 1000;

// [Claude] Task: agentic loop that gathers context, calls LLM, writes suggestions to a monthly note
// Prompt: "Create a DreamTask widget with an agentic loop that analyzes tasks and suggests goal-aligned work"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export async function analyzeDreamTasks(app, plugin) {
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
    const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG]);
    noteHandle = { uuid };
    logIfEnabled(`[dream-task] Created monthly note "${noteName}" with uuid ${uuid}`);
  }

  const existingContent = await app.getNoteContent(noteHandle) || '';

  const todaySection = _extractTodaySection(existingContent, dateHeading);
  if (todaySection) {
    logIfEnabled('[dream-task] Found cached analysis for today, returning parsed results');
    return { tasks: _parseCachedTasks(todaySection), cached: true, noteUUID: noteHandle.uuid };
  }

  const domainUuid = _getActiveDomainUuid(app);
  const allTasks = domainUuid ? await app.getTaskDomainTasks(domainUuid) : [];
  const openTasks = allTasks.filter(t => !t.completedAt && !t.dismissedAt);
  logIfEnabled(`[dream-task] Found ${openTasks.length} open tasks from domain ${domainUuid}`);

  const quarter = getCurrentQuarter();
  const planName = `${quarter.label} Plan`;
  const planNotes = await app.filterNotes({ query: planName });
  const planNote = planNotes.find(n => n.name === planName);

  let quarterlyContent = null;
  let monthlyContent = null;
  if (planNote) {
    const fullPlanContent = await app.getNoteContent({ uuid: planNote.uuid });
    if (fullPlanContent) {
      quarterlyContent = fullPlanContent;
      monthlyContent = extractMonthSectionContent(fullPlanContent, monthName);
    }
  }

  const previousAnalyses = existingContent
    ? existingContent.substring(0, MAX_PREVIOUS_ANALYSIS_CHARS)
    : null;

  const taskSummary = openTasks.slice(0, MAX_TASKS_IN_PROMPT)
    .map(t => {
      let line = `- ${t.content}`;
      if (t.important) line += ' [important]';
      if (t.urgent) line += ' [urgent]';
      if (t.deadline) {
        const dl = new Date(t.deadline < 1e10 ? t.deadline * 1000 : t.deadline);
        line += ` [due: ${dl.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}]`;
      }
      return line;
    })
    .join('\n');

  const prompt = _buildPrompt({
    dateHeading, dayName, isWeekend, taskSummary,
    quarterlyContent, monthlyContent, previousAnalyses,
    openTaskCount: openTasks.length,
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
    result = await llmPrompt(app, plugin, prompt, llmOptions);
  } catch (err) {
    logIfEnabled('[dream-task] LLM call failed:', err);
    return { tasks: [], error: 'LLM request failed. Please try again later.', noteUUID: noteHandle.uuid };
  }

  if (!result || !result.tasks) {
    logIfEnabled('[dream-task] LLM returned invalid response:', result);
    return { tasks: [], error: 'Could not parse AI response.', noteUUID: noteHandle.uuid };
  }

  const tasks = _validateTasks(result.tasks);
  logIfEnabled(`[dream-task] Received ${tasks.length} validated task suggestions`);

  const noteContent = _formatTasksForNote(dateHeading, tasks);
  try {
    await app.insertNoteContent(noteHandle, noteContent);
    logIfEnabled('[dream-task] Wrote analysis to monthly note');
  } catch (err) {
    logIfEnabled('[dream-task] Failed to write to monthly note:', err);
  }

  return { tasks, cached: false, noteUUID: noteHandle.uuid };
}

// ---------------------------------------------------------------------------
function _getActiveDomainUuid(app) {
  const raw = app.settings[TASK_DOMAIN_SETTING];
  try {
    const stored = raw ? JSON.parse(raw) : {};
    return stored.selectedDomainUuid || null;
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
function _parseCachedTasks(sectionContent) {
  const tasks = [];
  const taskRegex = /### \d+\.\s+(.+?)\s+\(Rating:\s*(\d+)\/10\)\n([\s\S]*?)(?=\n### |\n---|$)/g;
  let match;
  while ((match = taskRegex.exec(sectionContent)) !== null) {
    tasks.push({
      title: match[1].trim(),
      rating: parseInt(match[2], 10),
      explanation: match[3].trim(),
    });
  }
  return tasks;
}

// ---------------------------------------------------------------------------
function _validateTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  return tasks
    .filter(t => t && typeof t.title === 'string' && t.title.trim().length > 0)
    .map(t => ({
      title: String(t.title).trim(),
      explanation: String(t.explanation || '').trim(),
      rating: Math.min(10, Math.max(1, parseInt(t.rating, 10) || 5)),
    }))
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
function _buildPrompt({ dateHeading, dayName, isWeekend, taskSummary,
    quarterlyContent, monthlyContent, previousAnalyses, openTaskCount }) {
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
    prompt += `\n\n## User's Quarterly Plan\nNo quarterly plan found — suggest tasks based on the open task list alone.`;
  }

  if (monthlyContent) {
    prompt += `\n\n## User's Monthly Focus\n${monthlyContent.substring(0, MAX_MONTHLY_CONTENT_CHARS)}`;
  }

  if (previousAnalyses) {
    prompt += `\n\n## Previous Task Suggestions This Month (avoid repeating these verbatim)\n${previousAnalyses}`;
  }

  prompt += `\n\n## Current Open Tasks (${openTaskCount} total)\n`;
  prompt += taskSummary || 'No open tasks found.';

  prompt += `

Based on this context, suggest 3-5 tasks that are especially well-aligned with the user's quarterly and monthly goals. Tasks may come from the open task list or be entirely new suggestions.

For each task provide:
1. A clear, actionable task title
2. A 2-3 sentence explanation of why this task deserves the user's attention today, referencing their specific goals and considering the day of the week
3. A rating from 1-10 for how relevant and impactful this task is right now

Return ONLY valid JSON in this exact format (no markdown fences):
{"tasks":[{"title":"Task title","explanation":"Why this task matters today...","rating":8}]}`;

  return prompt;
}

// ---------------------------------------------------------------------------
function _formatTasksForNote(dateHeading, tasks) {
  let content = `## ${dateHeading}\n\n`;
  tasks.forEach((task, i) => {
    content += `### ${i + 1}. ${task.title} (Rating: ${task.rating}/10)\n`;
    content += `${task.explanation}\n\n`;
  });
  content += '---\n\n';
  return content;
}
