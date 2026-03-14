/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: DreamTask widget — AI-suggested tasks aligned with quarterly/monthly goals
 * Prompt summary: "Create a DreamTask widget that uses an agentic loop to suggest goal-aligned tasks"
 */
import { createElement, useEffect, useState, useCallback } from "react";
import { SETTING_KEYS, IS_DEV_ENVIRONMENT, DASHBOARD_NOTE_TAG, widgetTitleFromId } from "constants/settings";
import NoteEditor from "note-editor";
import { navigateToNote as goalNavigateToNote } from "util/goal-notes";
import WidgetWrapper from "widget-wrapper";
import "styles/dream-task.scss"

const WIDGET_ID = 'dream-task';
const WIDGET_ICON = '\uD83D\uDCA1';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FULL_MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
function _buildNoteName() {
  const now = new Date();
  return `${FULL_MONTH_NAMES[now.getMonth()]} ${now.getFullYear()} Dashboard Task Ideas`;
}

// ---------------------------------------------------------------------------
function _buildDateHeading() {
  const now = new Date();
  return `${DAY_NAMES[now.getDay()]} ${FULL_MONTH_NAMES[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

// ---------------------------------------------------------------------------
function _selectDisplayTasks(tasks, maxTasks) {
  const sorted = [...tasks].sort((a, b) => b.rating - a.rating);
  return sorted.slice(0, maxTasks);
}

// ---------------------------------------------------------------------------
function _ratingTier(rating) {
  if (rating >= 8) return 'high';
  if (rating >= 5) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// [Claude] Task: parse cached task entries from a markdown section
// Prompt: "determine if research has already been done for the current date"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
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
function _formatTasksForNote(tasks) {
  let content = '';
  tasks.forEach((task, i) => {
    content += `### ${i + 1}. ${task.title} (Rating: ${task.rating}/10)\n`;
    content += `${task.explanation}\n\n`;
  });
  content += '---\n';
  return content;
}

// ---------------------------------------------------------------------------
// App-based note lifecycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// [Claude] Task: find or create the monthly note for dream task analysis
// Prompt: "app.findNote to check if a note already exists, app.createNote to create if none exists"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function initializeMonthlyNote(app) {
  const noteName = _buildNoteName();
  let noteHandle = await app.findNote({ name: noteName });
  if (!noteHandle) {
    const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG]);
    noteHandle = { uuid, name: noteName };
    console.log(`[dream-task] Created monthly note "${noteName}" -> ${uuid}`);
  }
  return noteHandle;
}

// ---------------------------------------------------------------------------
// [Claude] Task: check existing note content for today's cached analysis
// Prompt: "app.getNoteContent to determine if research has already been done for the current date"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function checkExistingAnalysis(app, noteHandle) {
  const dateHeading = _buildDateHeading();
  const content = await app.getNoteContent(noteHandle);
  const todaySection = _extractTodaySection(content || '', dateHeading);
  if (todaySection) {
    return { cached: true, tasks: _parseCachedTasks(todaySection) };
  }
  return { cached: false, content: content || '' };
}

// ---------------------------------------------------------------------------
// [Claude] Task: ensure today's heading exists and write/update analysis via section replacement
// Prompt: "prepend a heading for the current date if one doesn't already exist from getNoteSections"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function writeTodayAnalysis(app, noteHandle, tasks) {
  const dateHeading = _buildDateHeading();
  const sections = await app.getNoteSections(noteHandle);
  const todayExists = sections.some(s => s.heading.text === dateHeading);

  if (!todayExists) {
    await app.insertNoteContent(noteHandle, `\n## ${dateHeading}\n\n`);
  }

  const analysisContent = _formatTasksForNote(tasks);
  await app.replaceNoteContent(noteHandle, analysisContent, {
    section: { heading: { text: dateHeading } },
  });
}

// ---------------------------------------------------------------------------
// [Claude] Task: run analysis — uses app for note lifecycle, falls back to callPlugin
// Prompt: "use app-based note lifecycle in all environments, not just dev"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function runDreamTaskAnalysis(app) {
  const noteHandle = await initializeMonthlyNote(app);
  const existing = await checkExistingAnalysis(app, noteHandle);

  if (existing.cached) {
    return { tasks: existing.tasks, cached: true, noteUUID: noteHandle.uuid };
  }

  const result = await app.dreamTaskAnalyze();
  if (result?.tasks?.length) {
    await writeTodayAnalysis(app, noteHandle, result.tasks);
  }
  return {
    tasks: result?.tasks || [],
    error: result?.error || null,
    cached: false,
    noteUUID: noteHandle.uuid,
  };
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleOpenNote(app, noteUUID) {
  if (!noteUUID) return null;
  return await goalNavigateToNote(app, noteUUID);
}

function handleOpenSettings(onOpenSettings) {
  if (onOpenSettings) onOpenSettings();
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderNoteLink(h, noteUUID, onOpenNote) {
  if (!noteUUID) return null;
  return h('a', {
    href: '#', className: 'widget-header-action', onClick: onOpenNote,
    title: 'Open this month\'s task ideas note',
  }, '\uD83D\uDDD2\uFE0F Note');
}

function renderLoadingState(h) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID },
    h('div', { className: 'dream-task-loading' },
      h('div', { className: 'dream-task-spinner' }),
      h('p', null, 'Analyzing your goals and tasks\u2026')
    )
  );
}

function renderNoConfigState(h, onSettingsClick) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID },
    h('div', { className: 'dream-task-no-config' },
      h('p', { className: 'dream-task-no-config-text' },
        'DreamTask uses AI to suggest tasks aligned with your goals.'
      ),
      h('p', { className: 'dream-task-no-config-text' },
        'An LLM provider and API key are required. ',
        h('a', { href: '#', className: 'dream-task-settings-link', onClick: onSettingsClick },
          'Configure AI settings \u2192'
        )
      )
    )
  );
}

function renderErrorState(h, error, noteLink, onRetry) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-error' },
      h('p', null, error),
      h('button', { className: 'dream-task-retry', onClick: onRetry }, 'Retry')
    )
  );
}

function renderEmptyState(h, noteLink, onRetry) {
  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID, headerActions: noteLink },
    h('div', { className: 'dream-task-empty' },
      h('p', null, 'No task suggestions available.'),
      h('button', { className: 'dream-task-retry', onClick: onRetry }, 'Refresh')
    )
  );
}

function renderTaskList(h, tasks, maxTasks, noteLink) {
  const displayTasks = _selectDisplayTasks(tasks, maxTasks);
  return h(WidgetWrapper, {
    title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID,
    headerActions: noteLink,
  },
    h('div', { className: 'dream-task-list' },
      ...displayTasks.map((task, i) =>
        h('div', { key: i, className: 'dream-task-card' },
          h('div', { className: 'dream-task-card-header' },
            h('span', { className: 'dream-task-card-title' }, task.title),
            h('span', {
              className: `dream-task-rating dream-task-rating--${_ratingTier(task.rating)}`,
              title: `Relevance: ${task.rating}/10`,
            }, `${task.rating}/10`)
          ),
          h('p', { className: 'dream-task-card-explanation' }, task.explanation)
        )
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// [Claude] Task: DreamTask widget with extracted functions and dev-mode app initialization
// Prompt: "extract all possible functionality to local functions, initialize with app object in dev"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export default function DreamTaskWidget({ app, gridHeightSize = 1, onOpenSettings }) {
  const h = createElement;
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [editingNoteUUID, setEditingNoteUUID] = useState(null);

  const llmProvider = app.settings?.[SETTING_KEYS.LLM_PROVIDER];
  const llmApiKey = app.settings?.[SETTING_KEYS.LLM_API_KEY];
  const envApiKey = (typeof process !== 'undefined' && process.env?.OPEN_AI_ACCESS_TOKEN) || '';
  const hasLlmConfig = envApiKey || (llmProvider && llmProvider !== 'none' && llmApiKey);

  const maxTasks = gridHeightSize >= 2 ? 2 : 1;

  const runAnalysis = useCallback(() => {
    if (!hasLlmConfig) return;
    setLoading(true);
    setError(null);
    runDreamTaskAnalysis(app)
      .then(result => {
        if (result?.error) setError(result.error);
        else if (result?.tasks) setTasks(result.tasks);
        if (result?.noteUUID) setNoteUUID(result.noteUUID);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Analysis failed');
        setLoading(false);
      });
  }, [hasLlmConfig, app]);

  useEffect(() => { runAnalysis(); }, [runAnalysis]);

  const onOpenNote = async (e) => {
    e.preventDefault();
    const result = await handleOpenNote(app, noteUUID);
    if (result?.devEdit) setEditingNoteUUID(result.noteUUID);
  };

  const onSettingsClick = (e) => {
    e.preventDefault();
    handleOpenSettings(onOpenSettings);
  };

  if (editingNoteUUID && IS_DEV_ENVIRONMENT) {
    return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: WIDGET_ICON, widgetId: WIDGET_ID },
      h(NoteEditor, {
        app,
        noteUUID: editingNoteUUID,
        onBack: () => setEditingNoteUUID(null),
      })
    );
  }

  if (!hasLlmConfig) {
    return renderNoConfigState(h, onSettingsClick);
  }

  const noteLink = renderNoteLink(h, noteUUID, onOpenNote);

  if (loading) return renderLoadingState(h);
  if (error) return renderErrorState(h, error, noteLink, runAnalysis);
  if (!tasks || tasks.length === 0) return renderEmptyState(h, noteLink, runAnalysis);

  return renderTaskList(h, tasks, maxTasks, noteLink);
}
