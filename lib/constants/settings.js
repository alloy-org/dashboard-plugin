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

// Registry of all available dashboard widgets. Each entry describes the widget's
// display name, icon, default horizontal tile width, and the maximum tile dimensions
// it supports. The max tile values are used by individual widget config popups.
// [Claude] Task: incorporate default horizontal tile size into WIDGET_REGISTRY
// Prompt: "consolidate DEFAULT_DASHBOARD_COMPONENTS and WIDGET_REGISTRY"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
export const WIDGET_REGISTRY = [
  { widgetId: "planning",      name: "Quarterly Planning", icon: "📋", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "victory-value", name: "Victory Value",      icon: "🏆", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "mood",          name: "Mood Tracker",       icon: "🎭", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "calendar",      name: "Calendar",           icon: "📅", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "agenda",        name: "Task Agenda",        icon: "📌", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "quotes",        name: "Quotes",             icon: "💡", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "ai-plugins",    name: "AI Plugins",         icon: "🤖", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "quick-actions", name: "Quick Actions",      icon: "⚡", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
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
