/**
 * [Claude claude-sonnet-4-6-authored file]
 * Created: 2026-05-10 | Model: claude-sonnet-4-6
 * Task: Layout Picker widget — one-click dashboard profile presets
 * Prompt summary: "add layout-picker widget with three clickable profile buttons that immediately rearrange all dashboard components"
 */

import { WIDGET_REGISTRY, widgetTitleFromId } from "constants/settings";
import { createElement, useState } from "react";
import "styles/layout-picker.scss";
import WidgetWrapper from "widget-wrapper";

const WIDGET_ID = 'layout-picker';

// "Goal Oriented" mirrors the canonical WIDGET_REGISTRY order (minus the picker itself) so it
// always reflects the current default layout without needing manual updates.
function goalOrientedWidgets() {
  return WIDGET_REGISTRY
    .filter(widget => widget.widgetId !== WIDGET_ID)
    .map(widget => ({ widgetId: widget.widgetId, gridWidthSize: widget.defaultGridWidthSize }));
}

// [Claude claude-sonnet-4-6] Task: define layout profile presets for one-click application
// Prompt: "three profile buttons that rearrange all dashboard components"
const LAYOUT_PROFILES = [
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
function layoutMatchesProfile(currentLayout, profile) {
  const filteredComponents = (currentLayout || []).filter(component => component.widgetId !== WIDGET_ID);
  const profileWidgets = profile.widgets;
  if (filteredComponents.length !== profileWidgets.length) return false;
  return profileWidgets.every((profileWidget, index) =>
    filteredComponents[index]?.widgetId === profileWidget.widgetId &&
    Number(filteredComponents[index]?.gridWidthSize) === profileWidget.gridWidthSize
  );
}

// [Claude claude-sonnet-4-6] Task: render a single layout profile card
// Prompt: "each button should be very clear that clicking will rearrange all components"
function renderProfileCard(h, profile, onApply, applyingId, isMatch) {
  const isApplying = applyingId === profile.id;
  const isDisabled = !!applyingId;
  const actionLabel = isApplying ? 'Applying…' : isMatch ? 'Apply' : 'Apply — replaces all widgets →';
  return h('div', { key: profile.id, className: 'layout-picker-profile' },
    h('button', {
      className: `layout-picker-profile-button${ isApplying ? ' layout-picker-profile-button--applying' : '' }${ isMatch ? ' layout-picker-profile-button--current' : '' }`,
      disabled: isDisabled,
      onClick: () => onApply(profile),
      type: 'button',
    },
      h('div', { className: 'layout-picker-profile-header' },
        h('span', { className: 'layout-picker-profile-icon', 'aria-hidden': 'true' }, profile.icon),
        h('span', { className: 'layout-picker-profile-name' }, profile.name),
        h('span', { className: `layout-picker-profile-action${ isMatch ? ' layout-picker-profile-action--current' : '' }` }, actionLabel)
      ),
      h('p', { className: 'layout-picker-profile-description' }, profile.description)
    )
  );
}

// [Claude claude-sonnet-4-6] Task: Layout Picker widget component
// Prompt: "add layout-picker widget with three clickable profile buttons that immediately rearrange all dashboard components"
export default function LayoutPickerWidget({ currentLayout, onLayoutApply }) {
  const h = createElement;
  const [applyingId, setApplyingId] = useState(null);

  const profileMatches = LAYOUT_PROFILES.map(profile => layoutMatchesProfile(currentLayout, profile));
  const anyMatch = profileMatches.some(Boolean);

  const handleApply = async (profile) => {
    if (applyingId) return;
    setApplyingId(profile.id);
    try {
      const widgetIds = profile.widgets.map(widget => widget.widgetId);
      const sizing = Object.fromEntries(
        profile.widgets.map(widget => [widget.widgetId, { gridWidthSize: widget.gridWidthSize }])
      );
      await onLayoutApply(widgetIds, true, sizing);
    } finally {
      setApplyingId(null);
    }
  };

  return h(WidgetWrapper, { icon: '🗂️', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    anyMatch ? null : h('p', { className: 'layout-picker-warning' },
      '⚠️ Clicking a profile immediately replaces every widget on your dashboard.'
    ),
    h('div', { className: 'layout-picker-profiles' },
      ...LAYOUT_PROFILES.map((profile, index) =>
        renderProfileCard(h, profile, handleApply, applyingId, profileMatches[index])
      )
    )
  );
}
