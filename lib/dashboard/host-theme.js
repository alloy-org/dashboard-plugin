// Refresh the embed's host theme without remounting the dashboard or losing widget state.

// ------------------------------------------------------------------------------------------
// @desc Refresh host CSS on focus or visibility restoration, preserving the previous theme on bridge failures.
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
  const systemTheme = watchSystemTheme ? window.matchMedia?.("(prefers-color-scheme: dark)") : null;
  systemTheme?.addEventListener?.("change", refreshHostTheme);
  if (refreshImmediately) void refreshHostTheme();
  window.addEventListener("focus", refreshHostTheme);
  document.addEventListener("visibilitychange", refreshHostTheme);
  // ------------------------------------------------------------------------------------------
  // @desc Stop theme refresh listeners and prevent late responses from modifying the document.
  // @returns {void}
  return function disposeHostThemeRefresh() {
    disposed = true;
    systemTheme?.removeEventListener?.("change", refreshHostTheme);
    window.removeEventListener("focus", refreshHostTheme);
    document.removeEventListener("visibilitychange", refreshHostTheme);
  };
}
