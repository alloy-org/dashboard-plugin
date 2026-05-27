/**
 * [Claude claude-sonnet-4-6-authored file]
 * Created: 2026-05-10 | Model: claude-sonnet-4-6
 * Task: Layout Picker widget — one-click dashboard profile presets
 * Prompt summary: "add layout-picker widget with three clickable profile buttons that immediately rearrange all dashboard components"
 */

import { SETTING_KEYS, widgetTitleFromId } from "constants/settings";
import { LAYOUT_PROFILES, layoutMatchesProfile, sizingFromProfile } from "layout-profiles";
import { useState } from "react";
import "styles/layout-picker.scss";
import WidgetWrapper from "widget-wrapper";

const WIDGET_ID = 'layout-picker';

// ----------------------------------------------------------------------------------------------
// @desc Persist a new widget layout and optionally record the selected profile id in settings and React state.
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
// [Claude claude-4.7-opus] Task: convert profile card render fn to JSX component
// Prompt: "translate this project to render components with JSX instead"
function ProfileCard({ profile, onApply, applyingId, isMatch }) {
  const isApplying = applyingId === profile.id;
  const isDisabled = !!applyingId;
  const actionLabel = isApplying ? 'Applying…' : isMatch ? 'Apply' : 'Apply — replaces all widgets →';
  const className = `layout-picker-profile-button${ isApplying ? ' layout-picker-profile-button--applying' : '' }${ isMatch ? ' layout-picker-profile-button--current' : '' }`;
  const actionClassName = `layout-picker-profile-action${ isMatch ? ' layout-picker-profile-action--current' : '' }`;
  return (
    <div className="layout-picker-profile">
      <button
        className={className}
        disabled={isDisabled}
        onClick={() => onApply(profile)}
        type="button"
      >
        <div className="layout-picker-profile-header">
          <span className="layout-picker-profile-icon" aria-hidden="true">{profile.icon}</span>
          <span className="layout-picker-profile-name">{profile.name}</span>
          <span className={actionClassName}>{actionLabel}</span>
        </div>
        <p className="layout-picker-profile-description">{profile.description}</p>
      </button>
    </div>
  );
}

// [Claude claude-sonnet-4-6] Task: Layout Picker widget component
// Prompt: "add layout-picker widget with three clickable profile buttons that immediately rearrange all dashboard components"
// [Claude claude-4.7-opus] Task: migrate LayoutPickerWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function LayoutPickerWidget({ app, currentLayout, onLayoutApply, onSelectedProfileChange }) {
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

  const headerActions = (
    <span className="widget-header-action" onClick={handleDismiss}>✕ Dismiss</span>
  );

  return (
    <WidgetWrapper headerActions={headerActions} icon="🗂️" title={widgetTitleFromId(WIDGET_ID)} widgetId={WIDGET_ID}>
      {anyMatch ? null : (
        <p className="layout-picker-warning">⚠️ Clicking a profile reorders all dashboard widgets.</p>
      )}
      <div className="layout-picker-profiles">
        {LAYOUT_PROFILES.map((profile, index) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            onApply={handleApply}
            applyingId={applyingId}
            isMatch={profileMatches[index]}
          />
        ))}
      </div>
    </WidgetWrapper>
  );
}
