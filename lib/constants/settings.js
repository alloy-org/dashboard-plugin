/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Plugin constants and setting key definitions
 * Prompt summary: "define plugin name and setting key constants"
 */
export const PLUGIN_NAME = "amplenote-dashboard";

export const SETTING_KEYS = {
  LLM_API_KEY: "LLM API Key",
  LLM_PROVIDER: "LLM Provider"
};

// [Claude] Task: constant key for persisting task domain selection and cached domain list
// Prompt: "allow user to choose which Task Domain their dashboard focuses on"
// Date: 2026-02-21 | Model: claude-opus-4-6
export const TASK_DOMAIN_SETTING = "dashboard_task_domains";

// How long before the cached task domain list is considered stale (24 hours)
export const TASK_DOMAIN_STALE_MS = 24 * 60 * 60 * 1000;

export const DASHBOARD_COMPONENTS = "dashboard_elements";

// Default dashboard layout used when no component layout has been saved yet.
export const DEFAULT_DASHBOARD_COMPONENTS = [
  { widgetId: "planning", gridHeightSize: 1, gridWidthSize: 2, settings: {} },
  { widgetId: "victory-value", gridHeightSize: 1, gridWidthSize: 2, settings: {} },
  { widgetId: "mood", gridHeightSize: 1, gridWidthSize: 1, settings: {} },
  { widgetId: "calendar", gridHeightSize: 1, gridWidthSize: 1, settings: {} },
  { widgetId: "agenda", gridHeightSize: 1, gridWidthSize: 2, settings: {} },
  { widgetId: "quotes", gridHeightSize: 1, gridWidthSize: 2, settings: {} },
  { widgetId: "ai-plugins", gridHeightSize: 1, gridWidthSize: 1, settings: {} },
  { widgetId: "quick-actions", gridHeightSize: 1, gridWidthSize: 1, settings: {} }
];
