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
  DEBUG_CONSOLE: "debug_console",
  LLM_API_KEY_ANTHROPIC: "Anthropic API Key",
  LLM_API_KEY_GEMINI: "Gemini API Key",
  LLM_API_KEY_GROK: "Grok API Key",
  LLM_API_KEY_OPENAI: "OpenAI API Key",
  LLM_PROVIDER_MODEL: "LLM Provider",
  FIRST_INSTALLED_AT: "dashboard_first_installed_at",
  SELECTED_LAYOUT_PROFILE: "dashboard_selected_layout_profile",
  TASK_DOMAINS: "dashboard_task_domains",
  PLANNING_NOTE_TAG: "Tag to apply to planning notes",
  PROPOSED_AGENDA_PRIORITY: "dashboard_proposed_agenda_priority",
  PROPOSED_AGENDA_LLM: "dashboard_proposed_agenda_llm",
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

// ----------------------------------------------------------------------------------------------
// @desc List the LLM provider buckets that currently have a non-empty API key stored in dashboard settings.
//   Used by the in-widget provider chooser to hide providers the user has no key for (unless an Ample Agent
//   Pro fallback, which can run any provider, is available).
// @param {Object} settings - Settings map (e.g. embed pluginSettings() or plugin-side app.settings).
// @returns {Array<string>} Provider bucket ids (e.g. ["anthropic", "openai"]) that have a usable key.
// [Claude claude-opus-4-8 (1M context)] Task: surface which providers have keys so selectors can hide keyless ones
export function configuredProviderEms(settings) {
  return Object.keys(API_KEY_FROM_PROVIDER).filter(providerEm => {
    const value = settings?.[API_KEY_FROM_PROVIDER[providerEm]];
    return typeof value === "string" && value.trim().length > 0;
  });
}

// Dev-only env token names esbuild injects in development, used to keep dev/dev-server.js's define
// block in sync. Token VALUES must be read through literal process.env.X accesses (see
// devTokenFromProvider) — esbuild's define only substitutes literal member expressions, not
// process.env[dynamicKey], so a computed lookup would read undefined in the browser bundle.
export const DEV_ENV_TOKEN_VAR_NAMES = ["OPEN_AI_ACCESS_TOKEN", "ANTHROPIC_AI_ACCESS_TOKEN",
  "GROK_AI_ACCESS_TOKEN", "GEMINI_AI_ACCESS_TOKEN"];

// ----------------------------------------------------------------------------------------------
// @desc Read the dev token for a single provider bucket via a literal process.env access (so esbuild's
//   define substitution applies in the browser bundle). Returns "" when unset.
// @param {string} provider - Provider bucket id (openai/anthropic/grok/gemini).
// @returns {string} Trimmed token, or "" when not provided.
// [Claude claude-opus-4-8 (1M context)] Task: read each dev token via a literal env access
// Prompt: "GROK_AI_ACCESS_TOKEN not surfacing suggestions in dev"
function devTokenFromProvider(provider) {
  switch (provider) {
    case "openai": return (process.env.OPEN_AI_ACCESS_TOKEN || "").trim();
    case "anthropic": return (process.env.ANTHROPIC_AI_ACCESS_TOKEN || "").trim();
    case "grok": return (process.env.GROK_AI_ACCESS_TOKEN || "").trim();
    case "gemini": return (process.env.GEMINI_AI_ACCESS_TOKEN || "").trim();
    default: return "";
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Whether any dev LLM token is present (development only). Lets UI gate "is a provider configured"
//   on the dev token regardless of which provider's token it is.
// @returns {boolean}
// [Claude claude-opus-4-8 (1M context)] Task: detect any dev token so DreamTask doesn't short-circuit to no-config
// Prompt: "dev environment isn't showing suggestions in spite of having GROK_AI_ACCESS_TOKEN present"
export function devTokenPresent() {
  if (!IS_DEV_ENVIRONMENT) return false;
  return ["openai", "anthropic", "grok", "gemini"].some(provider => !!devTokenFromProvider(provider));
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve a dev-only LLM override from the first available process.env token, independent of the
//   dashboard's selected provider. Preference order: openai, anthropic, grok, gemini. Returns null
//   outside development or when no token is present.
// @param {Object} providerDefaultModel - Map of provider bucket → default model id (PROVIDER_DEFAULT_MODEL).
// @returns {{ provider: string, model: string, apiKey: string }|null} Override, or null when unavailable.
// [Claude claude-opus-4-8 (1M context)] Task: generalize dev token override beyond OpenAI to all providers
// Prompt: "dev environment isn't showing suggestions in spite of having GROK_AI_ACCESS_TOKEN present"
export function devLlmOverride(providerDefaultModel) {
  if (!IS_DEV_ENVIRONMENT) return null;
  for (const provider of ["openai", "anthropic", "grok", "gemini"]) {
    const apiKey = devTokenFromProvider(provider);
    const model = providerDefaultModel[provider] || null;
    if (apiKey && model) return { provider, model, apiKey };
  }
  return null;
}

// [Claude] Task: centralize widget config key derivation so callers use a constant instead of a template string
// Prompt: "Ensure that any call to app.setSetting uses a member of the SETTING_KEYS object"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export function widgetConfigKey(widgetId) {
  return `dashboard_${widgetId}_config`;
}

// ------------------------------------------------------------------------------------------
// @desc Parse a widget's JSON config from a settings map, tolerating string or pre-parsed input.
// @param {Object} settings - Settings map (e.g. embed pluginSettings() or plugin-side app.settings).
// @param {string} widgetId - Widget id whose config key should be read.
// @returns {Array} Parsed config array, or [] when missing/unparseable.
export function parseWidgetConfig(settings, widgetId) {
  const raw = settings?.[widgetConfigKey(widgetId)];
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

// How long before the cached task domain list is considered stale (24 hours)
export const TASK_DOMAIN_STALE_MS = 24 * 60 * 60 * 1000;

// Registry of all available dashboard widgets. To see the order they'll be inserted in, look up layout-profiles.js or LAYOUT_PROFILES
export const WIDGET_REGISTRY = [
  { widgetId: "layout-picker", name: "Layout Picker",   description: "One-click presets that rearrange your entire dashboard into a curated profile",
    icon: "🗂️", defaultGridWidthSize: 2, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "planning",      name: "Quarterly Planning", description: "Plan and track your quarterly goals and priorities",
    icon: "📋", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "victory-value", name: "Victory Value",      description: "Celebrate wins and track high-value task completions",
    icon: "🏆", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "dream-task",    name: "Goal Coach",         description: "Get task suggestions that blend quarterly/monthly goals with day-of-week preferences",
    icon: "🔮", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "day-sketch",  name: "Day Sketcher",         description: "Notebook-paper day planner with hour-by-hour entries saved to a note",
    icon: "🗒️", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "agenda",        name: "Task Agenda",        description: "View and manage your prioritized task list",
    icon: "📌", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "proposed-agenda", name: "Proposed Agenda",  description: "AI-proposed hour-by-hour schedule built from your recent tasks and quarterly plan",
    icon: "🗓️", defaultGridWidthSize: 2, introducedAt: "2026-06-27", maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "quotes",        name: "Inspiration Quotes", description: "Rotating inspirational quotes to keep you motivated",
    icon: "💡", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "graveyard",   name: "Task Retirement Center",   description: "Surface neglected tasks and retire them to an archived note",
    icon: "👵️", defaultGridWidthSize: 2, introducedAt: "2026-05-09", maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "recent-notes",   name: "Revisit Candidate", description: "Notes with open tasks that have not had a new task in over a week",
    icon: "📌", defaultGridWidthSize: 1, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "shared-notes",   name: "Shared Notes",      description: "Shared notes recently updated by a collaborator after your own changes",
    icon: "🤝", defaultGridWidthSize: 2, introducedAt: "2026-06-26", maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "mood",          name: "Mood Tracker",       visibleTitle: "How are you feeling?",
    description: "Log your daily mood and visualize trends over time",
    icon: "🎭", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "calendar",      name: "Calendar",           description: "See upcoming events and appointments at a glance",
    icon: "📅", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "quick-actions",  name: "Quick Actions",   description: "Shortcuts for your most frequently used dashboard actions",
    icon: "⚡", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "peak-hours",   name: "Peak Hours",          description: "Hourly distribution of task creation and completion activity",
    icon: "⏰", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "debug-console", name: "Debug Console",       description: "Scrollable log viewer showing all logIfEnabled messages (developer tool)",
    icon: "🐛", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2, debugOnly: true },
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
// Widgets marked debugOnly are intentionally excluded from all default layouts.
export const DEFAULT_DASHBOARD_COMPONENTS = WIDGET_REGISTRY.filter(w => !w.debugOnly).map(w => ({
  widgetId: w.widgetId,
  gridWidthSize: w.defaultGridWidthSize,
  gridHeightSize: 1,
  settings: {},
}));
