// [Claude claude-sonnet-4-6-authored file]
// Prompt summary: "extract layout profile definitions and helpers into a standalone module shared by layout-picker and dashboard-layout-popup"

const LAYOUT_PICKER_WIDGET_ID = 'layout-picker';

// [Claude claude-sonnet-4-6] Task: define layout profile presets for one-click application
// Prompt: "three profile buttons that rearrange all dashboard components"
export const LAYOUT_PROFILES = [
  {
    id: 'goal-oriented',
    name: 'Goal-Oriented (Recommended)',
    icon: '🎯',
    description: 'Quarterly planning, victory tracking, and AI coaching alongside your daily task list. Best for users actively working toward long-horizon goals.',
    widgets: [
      { widgetId: 'planning',         gridWidthSize: 2 },
      { widgetId: 'victory-value',    gridWidthSize: 2 }, // Row 1
      { widgetId: 'dream-task',       gridWidthSize: 2 },
      { widgetId: 'day-sketch',       gridWidthSize: 2 }, // Row 2
      { widgetId: 'agenda',           gridWidthSize: 2 },
      { widgetId: 'proposed-agenda',  gridWidthSize: 2 }, // Row 3
      { widgetId: 'shared-notes',     gridWidthSize: 2 },
      { widgetId: 'recent-notes',     gridWidthSize: 2 }, // Row 4
      { widgetId: 'mood',             gridWidthSize: 1 },
      { widgetId: 'quotes',           gridWidthSize: 2 },
      { widgetId: 'quick-actions',    gridWidthSize: 1 }, // Row 5
      { widgetId: 'energy-per-habit', gridWidthSize: 2 }, // Row 6
    ],
  },
  {
    id: 'day-to-day',
    name: 'Day-to-Day',
    icon: '📅',
    description: 'Executing today\'s work — tasks, schedule, and daily planning without longer-horizon noise. No mood tracking or goal widgets.',
    widgets: [
      { widgetId: 'agenda',           gridWidthSize: 2 },
      { widgetId: 'proposed-agenda',  gridWidthSize: 2 }, // Row 1
      { widgetId: 'day-sketch',       gridWidthSize: 2 },
      { widgetId: 'calendar',         gridWidthSize: 2 }, // Row 2
      { widgetId: 'dream-task',       gridWidthSize: 2 },
      { widgetId: 'shared-notes',     gridWidthSize: 2 }, // Row 3
      { widgetId: 'graveyard',        gridWidthSize: 2 },
      { widgetId: 'quotes',           gridWidthSize: 2 }, // Row 4
      { widgetId: 'recent-notes',     gridWidthSize: 2 },
      { widgetId: 'peak-hours',       gridWidthSize: 2 }, // Row 5
    ],
  },
  {
    id: 'mindful-achiever',
    name: 'Mindful Achiever',
    icon: '🌱',
    description: 'For those who track wellbeing alongside tasks. Balances mood, inspiration, and task hygiene — without overwhelming the view with planning widgets.',
    widgets: [
      { widgetId: 'agenda',        gridWidthSize: 2 },
      { widgetId: 'planning',      gridWidthSize: 2 }, // Row 1
      { widgetId: 'mood',          gridWidthSize: 1 },
      { widgetId: 'day-sketch',    gridWidthSize: 2 },
      { widgetId: 'graveyard',     gridWidthSize: 1 }, // Row 2
      { widgetId: 'quotes',        gridWidthSize: 2 },
      { widgetId: 'shared-notes',  gridWidthSize: 2 }, // Row 3
      { widgetId: 'energy-per-habit', gridWidthSize: 2 },
      { widgetId: 'dream-task',    gridWidthSize: 2 }, // Row 4
      { widgetId: 'calendar',      gridWidthSize: 2 },
      { widgetId: 'victory-value', gridWidthSize: 2 }, // Row 5
    ],
  },
];

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
  { widgetId: "note-peek",      name: "Note Peek",         description: "Display the contents of any note you choose, clipped to the widget's size",
    icon: "📘", defaultGridWidthSize: 2, introducedAt: "2026-08-03", maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "mood",          name: "Energy (Mood) Tracker",       visibleTitle: "How goes it?",
    description: "Log your daily energy level and visualize trends over time",
    icon: "🎭", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "calendar",      name: "Calendar",           description: "See upcoming events and appointments at a glance",
    icon: "📅", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "quick-actions",  name: "Quick Actions",   description: "Shortcuts for your most frequently used dashboard actions",
    icon: "⚡", defaultGridWidthSize: 1, maxHorizontalTiles: 2, maxVerticalTiles: 2 },
  { widgetId: "peak-hours",   name: "Peak Hours",          description: "Hourly distribution of task creation and completion activity",
    icon: "⏰", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "energy-per-habit", name: "Energy Per Habit", visibleTitle: "Energy delta per habit",
    description: "Correlate each recurring-task habit with how you felt: average energy on days you do it vs. don't",
    icon: "🔋", defaultGridWidthSize: 2, introducedAt: "2026-07-17", maxHorizontalTiles: 4, maxVerticalTiles: 2 },
  { widgetId: "debug-console", name: "Debug Console",       description: "Scrollable log viewer showing all logIfEnabled messages (developer tool)",
    icon: "🐛", defaultGridWidthSize: 2, maxHorizontalTiles: 4, maxVerticalTiles: 2, debugOnly: true },
];

// ----------------------------------------------------------------------------------------------
// @desc Build a per-widget sizing map by starting with registry defaults and overlaying any
//   width overrides defined by a layout profile. This keeps profile application and matching
//   aligned around the same source of width truth.
// @param {Object|null|undefined} profile - Layout profile object containing a widgets array
// @returns {Object<string, {gridHeightSize: number, gridWidthSize: number}>}
// [OpenAI gpt-5.4] Task: centralize profile sizing so profile application uses preset widths
// Prompt: "Update layoutMatchesProfile such that, when a profile is applied, we utilize the gridWidthSize attribute to assign the width of the component for the profile in question"
export function sizingFromProfile(profile) {
  const sizing = Object.fromEntries(
    WIDGET_REGISTRY.map(widget => [
      widget.widgetId,
      { gridHeightSize: 1, gridWidthSize: widget.defaultGridWidthSize || 1 },
    ])
  );
  (profile?.widgets || []).forEach(widget => {
    if (!sizing[widget.widgetId]) return;
    sizing[widget.widgetId] = {
      ...sizing[widget.widgetId],
      gridWidthSize: Number(widget.gridWidthSize) || sizing[widget.widgetId].gridWidthSize,
    };
  });
  return sizing;
}

// [Claude claude-sonnet-4-6] Task: detect if current layout matches a profile (ignoring layout-picker itself)
// Prompt: "don't show 'replaces all widgets' when current layout matches one of the existing profiles"
export function layoutMatchesProfile(currentLayout, profile) {
  const layoutArray = Array.isArray(currentLayout) ? currentLayout : [];
  const filteredComponents = layoutArray.filter(component => component.widgetId !== LAYOUT_PICKER_WIDGET_ID);
  const profileWidgets = profile.widgets;
  const profileSizing = sizingFromProfile(profile);
  if (filteredComponents.length !== profileWidgets.length) return false;
  return profileWidgets.every((profileWidget, index) =>
    filteredComponents[index]?.widgetId === profileWidget.widgetId &&
    Number(filteredComponents[index]?.gridWidthSize) === profileSizing[profileWidget.widgetId]?.gridWidthSize
  );
}

// [Claude claude-sonnet-4-6] Task: look up a profile by id for use in reset and popup logic
// Prompt: "extract layout profile definitions out of layout-picker.js"
export function getProfileById(profileId) {
  return LAYOUT_PROFILES.find(profile => profile.id === profileId) || null;
}
