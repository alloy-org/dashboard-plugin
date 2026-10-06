// Notify canvas components when host colors or the standalone system theme change.
import { useEffect, useState } from "react";

// ------------------------------------------------------------------------------------------
// @desc Trigger a component render after theme changes so drawing effects can read fresh CSS colors.
// @returns {number} Revision counter for canvas effect dependencies.
export function useThemeRevision() {
  const [revision, setRevision] = useState(0);
  // ------------------------------------------------------------------------------------------
  // @desc Subscribe to host updates and OS changes used by standalone previews.
  // @returns {Function} Remove theme subscriptions.
  useEffect(function subscribeThemeChanges() {
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    // ------------------------------------------------------------------------------------------
    // @desc Advance the revision after colors may have changed.
    // @returns {void}
    function handleThemeChange() { setRevision(previousRevision => previousRevision + 1); }
    window.addEventListener("dashboard-theme-change", handleThemeChange);
    systemTheme?.addEventListener?.("change", handleThemeChange);
    return () => {
      window.removeEventListener("dashboard-theme-change", handleThemeChange);
      systemTheme?.removeEventListener?.("change", handleThemeChange);
    };
  }, []);
  return revision;
}
