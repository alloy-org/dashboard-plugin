/**
 * [gpt-5.4-authored file]
 * Prompt summary: "move derivedDashboardLayout and its persistence effect into a standalone hook"
 */
import { useEffect, useMemo } from "react";

import { DEFAULT_DASHBOARD_COMPONENTS, SETTING_KEYS, WIDGET_REGISTRY } from "constants/settings";
import { logIfEnabled } from "util/log";
import { deriveDashboardComponentsWithPopIn, parseComponentsSeen } from "util/new-component-popin";

// ------------------------------------------------------------------------------------------
// @description Builds a stable pipe-delimited widget-id key for comparing dashboard layouts.
// @param {Array<object>|null|undefined} components - Layout config entries to compare.
// @returns {string} Stable widget-order key.
// [OpenAI gpt-5.4] Task: extract dashboard layout derivation into a standalone hook
// Prompt: "move derivedDashboardLayout and its persistence effect into a standalone hook"
function componentLayoutKey(components) {
  return (components || []).map(component => component?.widgetId).filter(Boolean).join('|');
}

// ------------------------------------------------------------------------------------------
// @description Derives the effective visible dashboard layout and persists init-time pop-in
//   changes once config settings have loaded.
// @param {object} params
// @param {object|null} params.configParams - Loaded dashboard settings object.
// @param {Function} params.onLayoutPersist - Callback that persists a widget-id layout ordering.
// @returns {{activeComponents: Array<object>, componentsSeen: Array<string>, poppedInWidgetId: string|null,
//   visibleComponents: Array<object>}} Derived dashboard layout state.
// [OpenAI gpt-5.4] Task: extract dashboard layout derivation into a standalone hook
// Prompt: "move derivedDashboardLayout and its persistence effect into a standalone hook"
export default function useDashboardLayout({ configParams, onLayoutPersist }) {
  const derivedDashboardLayout = useMemo(() => {
    if (!configParams) return { componentsSeen: [], poppedInWidgetId: null, visibleComponents: [] };
    return deriveDashboardComponentsWithPopIn({
      componentsSeen: configParams?.[SETTING_KEYS.COMPONENTS_SEEN],
      defaultComponents: DEFAULT_DASHBOARD_COMPONENTS,
      visibleComponents: configParams?.[SETTING_KEYS.DASHBOARD_COMPONENTS],
      widgetRegistry: WIDGET_REGISTRY,
    });
  }, [configParams]);
  const activeComponents = derivedDashboardLayout.visibleComponents;

  useEffect(() => {
    if (!configParams) return;
    const currentComponentsSeen = parseComponentsSeen(configParams?.[SETTING_KEYS.COMPONENTS_SEEN]);
    const currentLayout = Array.isArray(configParams?.[SETTING_KEYS.DASHBOARD_COMPONENTS]) && configParams[SETTING_KEYS.DASHBOARD_COMPONENTS].length > 0
      ? configParams[SETTING_KEYS.DASHBOARD_COMPONENTS]
      : DEFAULT_DASHBOARD_COMPONENTS;
    const currentLayoutKey = componentLayoutKey(currentLayout);
    const derivedLayoutKey = componentLayoutKey(activeComponents);
    const currentSeenKey = currentComponentsSeen.join('|');
    const derivedSeenKey = derivedDashboardLayout.componentsSeen.join('|');
    if (currentLayoutKey === derivedLayoutKey && currentSeenKey === derivedSeenKey) return;
    onLayoutPersist(activeComponents.map(component => component?.widgetId).filter(Boolean))
      .catch(err => logIfEnabled('[dashboard] failed to persist init-derived layout/seen settings', err));
  }, [activeComponents, configParams, derivedDashboardLayout.componentsSeen, onLayoutPersist]);

  return { activeComponents, ...derivedDashboardLayout };
}
