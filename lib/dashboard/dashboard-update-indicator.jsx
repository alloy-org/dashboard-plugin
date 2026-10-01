// Check for a published Dashboard update without delaying the dashboard, and explain how to install it.
import DashboardTippy from "dashboard-tooltip-tippy";
import { useEffect, useState } from "react";
import { logIfEnabled } from "util/log";

const UPDATE_MESSAGE = 'A newer version of Dashboard is available. Click to visit Jots, then click the "Update Mission Control Dashboard plugin" to retrieve the latest. No restart necessary.';

// ----------------------------------------------------------------------------------------------
// @desc Show an update icon beside Settings after the host confirms a newer version, and open Jots when clicked.
// @param {Object} props - { app } with the dashboard bridge's optional checkForUpdates method and navigate method.
// @returns {JSX.Element|null} A hover, focus, or tap tooltip; nothing while checking or when no update is confirmed.
export default function DashboardUpdateIndicator({ app }) {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // ----------------------------------------------------------------------------------------------
  // @desc Check once per app instance, ignoring results after unmount and keeping failures out of dashboard loading.
  useEffect(() => {
    let cancelled = false;
    setUpdateAvailable(false);

    // ----------------------------------------------------------------------------------------------
    // @desc Only an explicit true confirms availability; missing APIs, error envelopes, and unknown results stay hidden.
    // @returns {Promise<void>}
    async function checkForUpdates() {
      try {
        const result = await app?.checkForUpdates?.();
        if (!cancelled) setUpdateAvailable(result === true);
      } catch (error) {
        logIfEnabled("[dashboard] Update check failed:", error);
      }
    }

    void checkForUpdates();
    return () => { cancelled = true; };
  }, [app]);

  if (!updateAvailable) return null;
  return (
    <DashboardTippy allowHTML={false} content={UPDATE_MESSAGE} placement="bottom" trigger="mouseenter focusin click">
      <button aria-label={UPDATE_MESSAGE} className="dashboard-configure-button dashboard-update-button"
        onClick={() => app.navigate("https://www.amplenote.com/notes/jots")} type="button">
        <span aria-hidden="true">🔄</span>
      </button>
    </DashboardTippy>
  );
}
