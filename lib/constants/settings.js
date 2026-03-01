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

export const DASHBOARD_FOCUS = {
  DEFAULT:         'default',
  LAYOUT_CONFIG:   'layoutConfig',
  SETTINGS_CONFIG: 'settingsConfig',
};

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
  { widgetId: "ai-plugins",    name: "AI Plugins",         description: "One-tap access to your installed AI-powered note plugins",   
    icon: "🤖", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
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
