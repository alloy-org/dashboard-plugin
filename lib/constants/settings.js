
export const DASHBOARD_FOCUS = {
  DEFAULT:         'default',
  LAYOUT_CONFIG:   'layoutConfig',
  SETTINGS_CONFIG: 'settingsConfig',
};

export const ADD_PROVIDER_API_KEY_LABEL = "Add Provider API key";
export const CORS_PROXY = "https://wispy-darkness-7716.amplenote.workers.dev"; // Only proxies whitelisted image generation domain & folder
export const IS_TEST_ENVIRONMENT = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
// [Claude] Task: remove typeof guard so esbuild's define replacement works in browser bundles
// Prompt: "IS_DEV_ENVIRONMENT was false in browser because typeof process guard short-circuited"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export const IS_DEV_ENVIRONMENT = process.env.NODE_ENV === "development";
export const MAX_SPACES_ABORT_RESPONSE = 30;
export const DASHBOARD_NOTE_TAG = "plugins/dashboard";
export const DEFAULT_PLANNING_TAG = "planning/quarterly";
export const PROVIDER_SETTING_KEY_LABELS = {
  anthropic: "Anthropic API Key",
  deepseek: "DeepSeek API Key",
  gemini: "Gemini API Key",
  grok: "Grok API Key",
  openai: "OpenAI API Key",
  // perplexity: "Perplexity API Key",
};

export const PLUGIN_NAME = "amplenote-dashboard";

// -------------------------------------------------------------------------------------
export function settingKeyLabel(providerEm) {
  return PROVIDER_SETTING_KEY_LABELS[providerEm];
}

export const SETTING_KEYS = {
  BACKGROUND_IMAGE_URL: "Background Image URL",
  BACKGROUND_IMAGE_MODE: "Background Image Mode",
  CONSOLE_LOGGING: "Console logging",
  DASHBOARD_COMPONENTS: "dashboard_elements",
  LLM_API_KEY_ANTHROPIC: "Anthropic API Key",
  LLM_API_KEY_GEMINI: "Gemini API Key",
  LLM_API_KEY_GROK: "Grok API Key",
  LLM_API_KEY_OPENAI: "OpenAI API Key",
  LLM_PROVIDER_MODEL: "LLM Provider",
  TASK_DOMAINS: "dashboard_task_domains",
  PLANNING_NOTE_TAG: "Tag to apply to planning notes",
};

const API_KEY_FROM_PROVIDER = {
  anthropic: SETTING_KEYS.LLM_API_KEY_ANTHROPIC,
  gemini: SETTING_KEYS.LLM_API_KEY_GEMINI,
  grok: SETTING_KEYS.LLM_API_KEY_GROK,
  openai: SETTING_KEYS.LLM_API_KEY_OPENAI,
}

// Maps SETTING_KEYS.LLM_PROVIDER_MODEL values (Dashboard Settings dropdown) to the provider bucket
// used in API_KEY_FROM_PROVIDER. Must stay aligned with LLM_OPTIONS in dashboard-settings-popup.js
// (e.g. anthropic-sonnet stores the key under the same setting as anthropic).
const DASHBOARD_LLM_VALUE_TO_API_KEY_PROVIDER = {
  none: null,
  openai: 'openai',
  anthropic: 'anthropic',
  'anthropic-sonnet': 'anthropic',
  gemini: 'gemini',
  grok: 'grok',
};

// ----------------------------------------------------------------------------------------------
// @desc Map a dashboard LLM Provider setting value to the API-key bucket id used by apiKeyFromProvider.
// @param {string|null|undefined} providerEm - Raw value from SETTING_KEYS.LLM_PROVIDER_MODEL (dropdown id, e.g. anthropic-sonnet).
// @returns {string|null} - Bucket id e.g. 'anthropic', or null when none/disabled/unknown.
// [Claude claude-opus-4-6] Task: align dashboard LLM dropdown values with apiKeyFromProvider buckets
export function apiKeyBucketFromLlmProvider(providerEm) {
  if (!providerEm || providerEm === 'none') return null;
  if (Object.prototype.hasOwnProperty.call(DASHBOARD_LLM_VALUE_TO_API_KEY_PROVIDER, providerEm)) {
    return DASHBOARD_LLM_VALUE_TO_API_KEY_PROVIDER[providerEm];
  }
  if (API_KEY_FROM_PROVIDER[providerEm]) return providerEm;
  return null;
}

// ---------------------------------------------------------------------------------------------
export function apiKeyFromProvider(providerEm) {
  return API_KEY_FROM_PROVIDER[providerEm] || null;
}

// [Claude] Task: centralize widget config key derivation so callers use a constant instead of a template string
// Prompt: "Ensure that any call to app.setSetting uses a member of the SETTING_KEYS object"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export function widgetConfigKey(widgetId) {
  return `dashboard_${widgetId}_config`;
}

// [Claude] Task: parse JSON widget config from app.settings, handling both string and pre-parsed values
// Prompt: "widgets read app.settings[SETTING_KEYS.X] directly instead of receiving parsed settings"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export function parseWidgetConfig(app, widgetId) {
  const raw = app.settings?.[widgetConfigKey(widgetId)];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

export const BACKGROUND_MODE_OPTIONS = [
  { value: 'cover',     label: 'Cover (fill entire background)' },
  { value: 'contain',   label: 'Contain (fit without cropping)' },
  { value: 'repeat',    label: 'Repeat (tile the image)' },
  { value: 'repeat-x',  label: 'Repeat horizontally' },
  { value: 'repeat-y',  label: 'Repeat vertically' },
  { value: 'no-repeat', label: 'No repeat (single centered image)' },
];

// Backward-compatible aliases — prefer SETTING_KEYS members in new code
export const DASHBOARD_COMPONENTS = SETTING_KEYS.DASHBOARD_COMPONENTS;
export const TASK_DOMAIN_SETTING = SETTING_KEYS.TASK_DOMAINS;
export const PLANNING_NOTE_TAG_LABEL = SETTING_KEYS.PLANNING_NOTE_TAG;

// How long before the cached task domain list is considered stale (24 hours)
export const TASK_DOMAIN_STALE_MS = 24 * 60 * 60 * 1000;

// Registry of all available dashboard widgets. Each entry describes the widget's
// display name, one-line description, icon, default horizontal tile width, and the
// maximum tile dimensions it supports. The max tile values are used by individual
// widget config popups; description is shown in the DashboardConfig drag list.
// [Claude] Task: add description field to each WIDGET_REGISTRY entry
// Prompt: "Update WIDGET_REGISTRY to include a one line description for each component that is shown in the DashboardConfig list when dragging the components"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
export const WIDGET_REGISTRY = [
  { widgetId: "planning",      name: "Quarterly Planning", description: "Plan and track your quarterly goals and priorities",
    icon: "📋", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "victory-value", name: "Victory Value",      description: "Celebrate wins and track high-value task completions",
    icon: "🏆", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "mood",          name: "Mood Tracker",       visibleTitle: "How are you feeling?",
    description: "Log your daily mood and visualize trends over time",
    icon: "🎭", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "calendar",      name: "Calendar",           description: "See upcoming events and appointments at a glance",
    icon: "📅", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "agenda",        name: "Task Agenda",        description: "View and manage your prioritized task list",
    icon: "📌", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "quotes",        name: "Inspiration Quotes", description: "Rotating inspirational quotes to keep you motivated",
    icon: "💡", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "recent-notes",  name: "Revisit Candidate",  description: "Notes with open tasks that have not had a new task in over a week",
    icon: "📝", defaultGridWidthSize: 1, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "quick-actions", name: "Quick Actions",      description: "Shortcuts for your most frequently used dashboard actions",
    icon: "⚡", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "dream-task",    name: "Goal Coach",         description: "Get task suggestions that blend quarterly/monthly goals with day-of-week preferences",
    icon: "🔮", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "peak-hours",   name: "Peak Hours",          description: "Hourly distribution of task creation and completion activity",
    icon: "⏰", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "day-sketch",  name: "Day Sketcher",         description: "Notebook-paper day planner with hour-by-hour entries saved to a note",
    icon: "🗒️", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
];

// [Claude] Task: add visibleTitle override and widgetTitleFromId lookup helper
// Prompt: "Update WIDGET_REGISTRY to include visibleTitle that can override name; export widgetTitleFromId"
// Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
export function widgetTitleFromId(widgetId) {
  const entry = WIDGET_REGISTRY.find(w => w.widgetId === widgetId);
  return entry?.visibleTitle || entry?.name || widgetId;
}

// ---------------------------------------------------------------------------------------
export function widgetDataFromId(widgetId) {
  return WIDGET_REGISTRY.find(w => w.widgetId === widgetId) || null;
}

// Default dashboard layout derived from the registry. Consumers should prefer
// looking up sizes via WIDGET_REGISTRY directly; this export exists for
// backwards-compatible initialisation in data-service and renderActiveComponents.
export const DEFAULT_DASHBOARD_COMPONENTS = WIDGET_REGISTRY.map(w => ({
  widgetId: w.widgetId,
  gridWidthSize: w.defaultGridWidthSize,
  gridHeightSize: 1,
  settings: {},
}));
