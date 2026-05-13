import { useMemo } from "react";

import { DEFAULT_DASHBOARD_COMPONENTS, SETTING_KEYS } from "constants/settings";

// [Claude claude-sonnet-4-6] Task: remove pop-in tracking, return plain visible components from config
// Prompt: "remove parseComponentsSeen and related logic"
export default function useDashboardLayout({ configParams }) {
  const activeComponents = useMemo(() => {
    if (!configParams) return [];
    const stored = configParams[SETTING_KEYS.DASHBOARD_COMPONENTS];
    return Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_DASHBOARD_COMPONENTS;
  }, [configParams]);

  return { activeComponents };
}
