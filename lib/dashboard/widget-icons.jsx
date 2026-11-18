// Material icons for each dashboard widget and layout profile, plus a component drawing a widget's icon by id. Kept
// apart from WIDGET_REGISTRY and LAYOUT_PROFILES (layout-profiles.js), which the plugin's host code reads, because host
// code may not import external packages.
import { MdAutoAwesome, MdBatteryChargingFull, MdBolt, MdBugReport, MdDateRange, MdDescription,
  MdEditCalendar, MdEmojiEmotions, MdEmojiEvents, MdFlag, MdFormatQuote, MdGroup, MdHistory, MdInsights,
  MdInventory2, MdLibraryAddCheck, MdSchedule, MdSpa, MdToday, MdWebAsset } from "react-icons/md";

// Header icon by widget id; a widget missing here shows no icon.
export const WIDGET_ICON_BY_ID = {
  "agenda": MdLibraryAddCheck,
  "calendar": MdDateRange,
  "day-sketch": MdEditCalendar,
  "debug-console": MdBugReport,
  "dream-task": MdAutoAwesome,
  "energy-per-habit": MdBatteryChargingFull,
  "graveyard": MdInventory2,
  "layout-picker": MdWebAsset,
  "mood": MdEmojiEmotions,
  "note-peek": MdDescription,
  "peak-hours": MdInsights,
  "planning": MdFlag,
  "proposed-agenda": MdSchedule,
  "quick-actions": MdBolt,
  "quotes": MdFormatQuote,
  "recent-notes": MdHistory,
  "shared-notes": MdGroup,
  "victory-value": MdEmojiEvents,
};

// Icon by layout profile id, shown on the Layout Picker's profile options.
export const LAYOUT_PROFILE_ICON_BY_ID = {
  "day-to-day": MdToday,
  "goal-oriented": MdFlag,
  "mindful-achiever": MdSpa,
};

// ----------------------------------------------------------------------------------------------
// @desc Draw a widget's Material icon by widget id, for lists of widgets such as the Layout popup.
// @param {Object} props - { size, widgetId }: icon size in pixels (defaults to the dashboard's icon size) and widget id.
// @returns {JSX.Element|null} The icon, or nothing for a widget without one.
export function WidgetIcon({ size, widgetId }) {
  const Icon = WIDGET_ICON_BY_ID[widgetId];
  return Icon ? <Icon size={ size } /> : null;
}
