// Refresh the embed's host theme without remounting the dashboard or losing widget state.

// The host does not notify embeds of theme changes, so the dashboard re-reads the theme whenever the user comes back
// to it: window focus, the tab becoming visible, or the pointer re-entering the dashboard after the user changed the
// theme or light/dark mode elsewhere in the app. Pointer re-entry is throttled to one request per interval.
const POINTER_REFRESH_MINIMUM_INTERVAL_MILLISECONDS = 1000;

// ------------------------------------------------------------------------------------------
// @desc Refresh host CSS on focus, visibility restoration, or pointer re-entry, preserving the previous theme on
//   bridge failures.
// @param {object} app - Dashboard bridge with getDashboardTheme().
// @param {object} options - Optional immediate refresh and system-mode subscription for development.
// @returns {Function} Remove the listeners and ignore outstanding requests.
export function installHostThemeRefresh(app, { refreshImmediately = false, watchSystemTheme = false } = {}) {
  let disposed = false;
  let pending = false;
  // ------------------------------------------------------------------------------------------
  // @desc Fetch and apply a fresh host theme, coalescing simultaneous focus and visibility events.
  // @returns {Promise<void>} Completion of the optional refresh.
  async function refreshHostTheme() {
    if (disposed || pending || document.visibilityState === "hidden") return;
    pending = true;
    try {
      const theme = await app.getDashboardTheme();
      if (disposed || !theme || theme.embedCallFailed || typeof theme.styleProperties !== "string") return;
      let styleElement = document.getElementById("dashboard-host-theme");
      if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = "dashboard-host-theme";
        document.head.appendChild(styleElement);
      }
      const rootElement = document.documentElement;
      const mode = ["light", "dark"].includes(theme.lightDarkMode) ? theme.lightDarkMode : "";
      const changed = (theme.styleProperties && styleElement?.textContent !== theme.styleProperties)
        || (mode && rootElement.dataset.theme !== mode);
      if (!changed) return;
      if (styleElement && theme.styleProperties) styleElement.textContent = theme.styleProperties;
      if (mode) rootElement.dataset.theme = mode;
      window.dispatchEvent(new Event("dashboard-theme-change"));
    } catch (error) {
      console.warn("Dashboard theme refresh failed:", error);
    } finally {
      pending = false;
    }
  }
  let lastPointerRefreshTime = 0;
  // ------------------------------------------------------------------------------------------
  // @desc Refresh when the pointer comes back over the dashboard, at most once per throttle interval.
  // @returns {void}
  function refreshHostThemeOnPointerEnter() {
    const now = Date.now();
    if (now - lastPointerRefreshTime < POINTER_REFRESH_MINIMUM_INTERVAL_MILLISECONDS) return;
    lastPointerRefreshTime = now;
    void refreshHostTheme();
  }
  const systemTheme = watchSystemTheme ? window.matchMedia?.("(prefers-color-scheme: dark)") : null;
  systemTheme?.addEventListener?.("change", refreshHostTheme);
  if (refreshImmediately) void refreshHostTheme();
  window.addEventListener("focus", refreshHostTheme);
  document.addEventListener("visibilitychange", refreshHostTheme);
  document.documentElement.addEventListener("pointerenter", refreshHostThemeOnPointerEnter);
  // ------------------------------------------------------------------------------------------
  // @desc Stop theme refresh listeners and prevent late responses from modifying the document.
  // @returns {void}
  return function disposeHostThemeRefresh() {
    disposed = true;
    systemTheme?.removeEventListener?.("change", refreshHostTheme);
    window.removeEventListener("focus", refreshHostTheme);
    document.removeEventListener("visibilitychange", refreshHostTheme);
    document.documentElement.removeEventListener("pointerenter", refreshHostThemeOnPointerEnter);
  };
}
