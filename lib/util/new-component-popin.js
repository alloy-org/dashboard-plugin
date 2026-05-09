/**
 * [gpt-5.4-authored file]
 * Prompt summary: "track seen dashboard components and auto-pop in newly introduced widgets"
 */

import { SETTING_KEYS } from "constants/settings";

const NEW_WIDGET_POPIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Build a default widget config for a registry entry so newly popped-in widgets inherit
//   their normal default dashboard dimensions.
// @param {Array<object>} defaultComponents - Default dashboard layout config entries.
// @param {string} widgetId - Widget id to resolve.
// @returns {object|null} Default widget config or null when no matching widget exists.
// [OpenAI gpt-5.4] Task: create default config resolver for newly popped-in widgets
// Prompt: "derive new widget pop-in behavior in a standalone utility"
export function componentConfigFromRegistry(defaultComponents, widgetId) {
  const defaultConfig = (defaultComponents || []).find(component => component?.widgetId === widgetId);
  return defaultConfig ? { ...defaultConfig } : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Derive the effective visible dashboard layout and seen-widget list. If a widget was
//   introduced within the last week, is hidden, and has never been seen, append it to the
//   bottom of the visible layout and mark it as seen.
// @param {object} params - Derivation inputs.
// @param {Array<string>|string|null|undefined} params.componentsSeen - Stored seen-widget setting.
// @param {Array<object>} params.defaultComponents - Default dashboard layout config entries.
// @param {Date} [params.now] - Clock override for tests.
// @param {Array<object>|null|undefined} params.visibleComponents - Current stored visible layout.
// @param {Array<object>} params.widgetRegistry - Widget registry entries, optionally with introducedAt.
// @returns {{componentsSeen: Array<string>, poppedInWidgetId: string|null, visibleComponents: Array<object>}}
// [OpenAI gpt-5.4] Task: derive visible layout plus recent-widget pop-in behavior
// Prompt: "derive new widget pop-in behavior in a standalone utility"
export function deriveDashboardComponentsWithPopIn({ componentsSeen, defaultComponents, now, visibleComponents, widgetRegistry }) {
  const normalizedSeen = parseComponentsSeen(componentsSeen);
  const safeVisibleComponents = Array.isArray(visibleComponents) && visibleComponents.length
    ? visibleComponents.map(component => ({ ...component }))
    : (defaultComponents || []).map(component => ({ ...component }));
  const visibleWidgetIds = safeVisibleComponents.map(component => component?.widgetId).filter(Boolean);
  const visibleWidgetIdSet = new Set(visibleWidgetIds);
  const seenWidgetIdSet = new Set(normalizedSeen);
  const popInWidget = (widgetRegistry || []).find(widget =>
    isRecentlyIntroducedWidget(now || new Date(), widget)
      && !seenWidgetIdSet.has(widget?.widgetId)
      && !visibleWidgetIdSet.has(widget?.widgetId)
  );
  const nextVisibleComponents = popInWidget
    ? [...safeVisibleComponents, componentConfigFromRegistry(defaultComponents, popInWidget.widgetId)]
    : safeVisibleComponents;
  return {
    componentsSeen: mergeComponentsSeen(normalizedSeen, nextVisibleComponents.map(component => component?.widgetId)),
    poppedInWidgetId: popInWidget?.widgetId || null,
    visibleComponents: nextVisibleComponents.filter(Boolean),
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Return whether a widget was introduced within the last seven days.
// @param {Date} now - Current time used for the recency check.
// @param {object} widget - Registry entry that may include an introducedAt ISO date.
// @returns {boolean} True when the widget is within the pop-in window.
// [OpenAI gpt-5.4] Task: detect widgets introduced within the pop-in window
// Prompt: "derive new widget pop-in behavior in a standalone utility"
export function isRecentlyIntroducedWidget(now, widget) {
  if (!widget?.introducedAt || !(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  const introducedAt = new Date(widget.introducedAt);
  if (Number.isNaN(introducedAt.getTime()) || introducedAt.getTime() > now.getTime()) return false;
  return now.getTime() - introducedAt.getTime() <= NEW_WIDGET_POPIN_WINDOW_MS;
}

// ----------------------------------------------------------------------------------------------
// @desc Merge seen widget ids with additional widget ids, remove duplicates, and sort them so
//   COMPONENTS_SEEN remains stable across init and layout-save flows.
// @param {Array<string>|string|null|undefined} componentsSeen - Stored seen-widget setting.
// @param {Array<string>} widgetIds - Widget ids that should now be considered seen.
// @returns {Array<string>} Sorted unique widget ids.
// [OpenAI gpt-5.4] Task: normalize and sort seen widget ids
// Prompt: "derive new widget pop-in behavior in a standalone utility"
export function mergeComponentsSeen(componentsSeen, widgetIds) {
  const seen = Array.isArray(componentsSeen) ? componentsSeen : parseComponentsSeen(componentsSeen);
  return Array.from(new Set([...(seen || []), ...(widgetIds || [])].filter(id => typeof id === "string" && id)))
    .sort((left, right) => left.localeCompare(right));
}

// ----------------------------------------------------------------------------------------------
// @desc Parse the COMPONENTS_SEEN setting, accepting either an already-materialized array or a
//   JSON-encoded string for backward compatibility.
// @param {Array<string>|string|null|undefined} settingValue - Raw persisted setting value.
// @returns {Array<string>} Sorted unique widget ids.
// [OpenAI gpt-5.4] Task: parse seen widget ids from mixed setting formats
// Prompt: "derive new widget pop-in behavior in a standalone utility"
export function parseComponentsSeen(settingValue) {
  if (Array.isArray(settingValue)) return mergeComponentsSeen([], settingValue);
  if (typeof settingValue !== "string" || !settingValue.trim()) return [];
  try {
    const parsed = JSON.parse(settingValue);
    return Array.isArray(parsed) ? mergeComponentsSeen([], parsed) : [];
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Persist dashboard layout plus seen widget ids, only writing COMPONENTS_SEEN when the
//   normalized array has actually changed.
// @param {object} app - Amplenote app object with setSetting.
// @param {Array<string>|string|null|undefined} currentComponentsSeen - Existing seen widget ids.
// @param {Array<object>} newLayout - Fully materialized dashboard layout to persist.
// @param {Array<string>} newRenderedWidgetIds - Visible widget ids that should count as seen.
// @returns {Promise<Array<string>>} Persisted sorted seen widget ids.
// [OpenAI gpt-5.4] Task: extract dashboard layout plus seen-setting persistence into shared utility
// Prompt: "move the new code block out of saveLayout and into its own method, outside the clutter of dashboard.js"
export async function saveDashboardLayoutAndSeen(app, currentComponentsSeen, newLayout, newRenderedWidgetIds) {
  const parsedComponentsSeen = parseComponentsSeen(currentComponentsSeen);
  const nextComponentsSeen = mergeComponentsSeen(parsedComponentsSeen, newRenderedWidgetIds);
  const saves = [app.setSetting(SETTING_KEYS.DASHBOARD_COMPONENTS, JSON.stringify(newLayout))];
  if (parsedComponentsSeen.join('|') !== nextComponentsSeen.join('|')) {
    saves.push(app.setSetting(SETTING_KEYS.COMPONENTS_SEEN, nextComponentsSeen));
  }
  await Promise.all(saves);
  return nextComponentsSeen;
}
