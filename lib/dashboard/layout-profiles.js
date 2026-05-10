// [Claude claude-sonnet-4-6-authored file]
// Prompt summary: "extract layout profile definitions and helpers into a standalone module shared by layout-picker and dashboard-layout-popup"

import { WIDGET_REGISTRY } from "constants/settings";

const LAYOUT_PICKER_WIDGET_ID = 'layout-picker';

// [Claude claude-sonnet-4-6] Task: export goalOrientedWidgets as standalone helper
// Prompt: "extract layout profile definitions out of layout-picker.js"
export function goalOrientedWidgets() {
  return WIDGET_REGISTRY
    .filter(widget => widget.widgetId !== LAYOUT_PICKER_WIDGET_ID)
    .map(widget => ({ widgetId: widget.widgetId, gridWidthSize: widget.defaultGridWidthSize }));
}

// [Claude claude-sonnet-4-6] Task: define layout profile presets for one-click application
// Prompt: "three profile buttons that rearrange all dashboard components"
export const LAYOUT_PROFILES = [
  {
    id: 'goal-oriented',
    name: 'Goal Oriented',
    icon: '🎯',
    description: 'Quarterly planning, victory tracking, and AI coaching alongside your daily task list. Best for users actively working toward long-horizon goals.',
    widgets: goalOrientedWidgets(),
  },
  {
    id: 'day-to-day',
    name: 'Day-to-Day',
    icon: '📅',
    description: 'Executing today\'s work — tasks, schedule, and daily planning without longer-horizon noise. No mood tracking or goal widgets.',
    widgets: [
      { widgetId: 'agenda',        gridWidthSize: 2 },
      { widgetId: 'calendar',      gridWidthSize: 2 },
      { widgetId: 'dream-task',    gridWidthSize: 2 },
      { widgetId: 'day-sketch',    gridWidthSize: 2 },
      { widgetId: 'graveyard',     gridWidthSize: 2 },
      { widgetId: 'quick-actions', gridWidthSize: 1 },
    ],
  },
  {
    id: 'mindful-achiever',
    name: 'Mindful Achiever',
    icon: '🌱',
    description: 'For those who track wellbeing alongside tasks. Balances mood, inspiration, and task hygiene — without overwhelming the view with planning widgets.',
    widgets: [
      { widgetId: 'quotes',     gridWidthSize: 2 },
      { widgetId: 'mood',       gridWidthSize: 2 },
      { widgetId: 'agenda',     gridWidthSize: 2 },
      { widgetId: 'calendar',   gridWidthSize: 2 },
      { widgetId: 'graveyard',  gridWidthSize: 2 },
      { widgetId: 'peak-hours', gridWidthSize: 2 },
    ],
  },
];

// [Claude claude-sonnet-4-6] Task: detect if current layout matches a profile (ignoring layout-picker itself)
// Prompt: "don't show 'replaces all widgets' when current layout matches one of the existing profiles"
export function layoutMatchesProfile(currentLayout, profile) {
  const layoutArray = Array.isArray(currentLayout) ? currentLayout : [];
  const filteredComponents = layoutArray.filter(component => component.widgetId !== LAYOUT_PICKER_WIDGET_ID);
  const profileWidgets = profile.widgets;
  if (filteredComponents.length !== profileWidgets.length) return false;
  return profileWidgets.every((profileWidget, index) =>
    filteredComponents[index]?.widgetId === profileWidget.widgetId &&
    Number(filteredComponents[index]?.gridWidthSize) === profileWidget.gridWidthSize
  );
}

// [Claude claude-sonnet-4-6] Task: look up a profile by id for use in reset and popup logic
// Prompt: "extract layout profile definitions out of layout-picker.js"
export function getProfileById(profileId) {
  return LAYOUT_PROFILES.find(profile => profile.id === profileId) || null;
}
