/**
 * [Claude claude-sonnet-4-6-authored file]
 * Created: 2026-05-10 | Model: claude-sonnet-4-6
 * Task: Layout Picker widget — one-click dashboard profile presets
 * Prompt summary: "add layout-picker widget with three clickable profile buttons that immediately rearrange all dashboard components"
 */

import { SETTING_KEYS, widgetTitleFromId } from "constants/settings";
import { LAYOUT_PROFILES, layoutMatchesProfile, sizingFromProfile } from "layout-profiles";
import { createElement, useState } from "react";
import "styles/layout-picker.scss";
import WidgetWrapper from "widget-wrapper";

const WIDGET_ID = 'layout-picker';

// ----------------------------------------------------------------------------------------------
// @desc Persist a new widget layout and optionally record the selected profile id in settings and React state.
// @param {Object} app - Amplenote app bridge; used to call setSetting
// @param {boolean} isReset - When true the layout replaces all current widgets rather than merging
// @param {Function} onLayoutPersist - Async fn(widgetIds, isReset, sizing) that writes the layout to settings
// @param {Function} onSelectedProfileChange - Callback(profileId) that syncs the profile id into React state
// @param {string|null|undefined} profileId - Profile id to store; null clears the stored profile; undefined skips
// @param {Object|null} sizing - Map of widgetId → { gridWidthSize } passed through to onLayoutPersist
// @param {Array<string>} widgetIds - Ordered list of widget ids for the new layout
export async function saveLayoutWithProfile({ app, isReset, onLayoutPersist, onSelectedProfileChange, profileId, sizing, widgetIds }) {
  await onLayoutPersist(widgetIds, isReset, sizing);
  if (profileId !== undefined && profileId !== null) {
    app.setSetting(SETTING_KEYS.SELECTED_LAYOUT_PROFILE, profileId);
    onSelectedProfileChange(profileId);
  } else if (profileId === null) {
    app.setSetting(SETTING_KEYS.SELECTED_LAYOUT_PROFILE, '');
    onSelectedProfileChange(null);
  }
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
export default function LayoutPickerWidget({ app, currentLayout, onLayoutApply, onSelectedProfileChange }) {
  const h = createElement;
  const [applyingId, setApplyingId] = useState(null);

  const profileMatches = LAYOUT_PROFILES.map(profile => layoutMatchesProfile(currentLayout, profile));
  const anyMatch = profileMatches.some(Boolean);

  const handleApply = async (profile) => {
    if (applyingId) return;
    setApplyingId(profile.id);
    try {
      const widgetIds = profile.widgets.map(widget => widget.widgetId);
      const sizing = sizingFromProfile(profile);
      await saveLayoutWithProfile({ app, isReset: true, onLayoutPersist: onLayoutApply, onSelectedProfileChange, profileId: profile.id, sizing, widgetIds });
    } finally {
      setApplyingId(null);
    }
  };

  // [Claude claude-sonnet-4-6] Task: dismiss layout-picker widget by removing it from the current layout
  // Prompt: "add a dismiss link in the widget header that removes the layout-picker from the layout"
  const handleDismiss = () => {
    const remaining = (Array.isArray(currentLayout) ? currentLayout : []).filter(entry => entry.widgetId !== WIDGET_ID);
    const remainingWidgetIds = remaining.map(entry => entry.widgetId);
    onLayoutApply(remainingWidgetIds, false, null);
  };

  const headerActions = h('span', { className: 'widget-header-action', onClick: handleDismiss }, '✕ Dismiss');

  return h(WidgetWrapper, { headerActions, icon: '🗂️', title: widgetTitleFromId(WIDGET_ID), widgetId: WIDGET_ID },
    anyMatch ? null : h('p', { className: 'layout-picker-warning' },
      '⚠️ Clicking a profile reorders all dashboard widgets.'
    ),
    h('div', { className: 'layout-picker-profiles' },
      ...LAYOUT_PROFILES.map((profile, index) =>
        renderProfileCard(h, profile, handleApply, applyingId, profileMatches[index])
      )
    )
  );
}
