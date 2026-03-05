
export const DASHBOARD_COMPONENTS = "dashboard_elements";

export const DASHBOARD_FOCUS = {
  DEFAULT:         'default',
  LAYOUT_CONFIG:   'layoutConfig',
  SETTINGS_CONFIG: 'settingsConfig',
};

export const ADD_PROVIDER_API_KEY_LABEL = "Add Provider API key";
export const CORS_PROXY = "https://wispy-darkness-7716.amplenote.workers.dev"; // Only proxies whitelisted image generation domain & folder
export const IS_TEST_ENVIRONMENT = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
export const MAX_SPACES_ABORT_RESPONSE = 30;
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
  LLM_API_KEY: "LLM API Key",
  LLM_PROVIDER: "LLM Provider",
  BACKGROUND_IMAGE_URL: "Background Image URL",
  BACKGROUND_IMAGE_MODE: "Background Image Mode",
};

export const BACKGROUND_MODE_OPTIONS = [
  { value: 'cover',     label: 'Cover (fill entire background)' },
  { value: 'contain',   label: 'Contain (fit without cropping)' },
  { value: 'repeat',    label: 'Repeat (tile the image)' },
  { value: 'repeat-x',  label: 'Repeat horizontally' },
  { value: 'repeat-y',  label: 'Repeat vertically' },
  { value: 'no-repeat', label: 'No repeat (single centered image)' },
];

// [Claude] Task: constant key for persisting task domain selection and cached domain list
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
export const TASK_DOMAIN_SETTING = "dashboard_task_domains";

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
  { widgetId: "mood",          name: "Mood Tracker",       description: "Log your daily mood and visualize trends over time",
    icon: "🎭", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "calendar",      name: "Calendar",           description: "See upcoming events and appointments at a glance",
    icon: "📅", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "agenda",        name: "Task Agenda",        description: "View and manage your prioritized task list",
    icon: "📌", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "quotes",        name: "Quotes",             description: "Rotating inspirational quotes to keep you motivated",
    icon: "💡", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "recent-notes",  name: "Revisit Candidates",       description: "Notes with open tasks that have not had a new task in over a week",
    icon: "📝", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "quick-actions", name: "Quick Actions",      description: "Shortcuts for your most frequently used dashboard actions",
    icon: "⚡", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
];

// Default dashboard layout derived from the registry. Consumers should prefer
// looking up sizes via WIDGET_REGISTRY directly; this export exists for
// backwards-compatible initialisation in data-service and renderActiveComponents.
export const DEFAULT_DASHBOARD_COMPONENTS = WIDGET_REGISTRY.map(w => ({
  widgetId: w.widgetId,
  gridWidthSize: w.defaultGridWidthSize,
  gridHeightSize: 1,
  settings: {},
}));
