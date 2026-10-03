// Name the Dashboard work scheduler's priority categories, resource limits, and waiting reasons, and decide whether a
// job's category may be admitted under the Dashboard's current conditions. Kept as plain constants and functions so
// the policy can be tuned and tested apart from the scheduler that applies it.

// How long after the Dashboard's initial load settles before maintenance may start, letting the browser finish the
// work the load set in motion.
export const LOAD_GATE_GRACE_MILLISECONDS = 4000;

// Priority categories from most to least urgent. A job's position in this list is its rank.
export const PRIORITY_CATEGORIES = ["visibleRender", "foregroundData", "nearViewportRender", "visibleRefresh", "maintenance"];

// Categories that put the Dashboard under foreground pressure while waiting or running, pausing new maintenance.
export const FOREGROUND_CATEGORIES = ["visibleRender", "foregroundData"];

// Permits available per resource. Each resource is admitted independently, so a pending provider request never
// holds up a mount. The limits are starting points to tune from measurements.
export const RESOURCE_LIMITS = { appRead: 2, generative: 1, jev: 4, mount: 1, write: 1 };

// Why a pending job has not started, as shown to an operator inspecting the queue.
export const WAITING_REASONS = {
  dependency: "Waiting for a job it depends on to finish",
  foregroundDemand: "Paused while more urgent work is waiting or running",
  hidden: "Paused while the Dashboard is hidden",
  loadGate: "Waiting for the Dashboard to finish loading",
  missingConfiguration: "Waiting for a required setting, such as a provider key",
  overlay: "Held while an overlay covers the Dashboard",
  resourceBusy: "Every permit for its resource is in use",
  retryBackoff: "Waiting before retrying a failed attempt",
};

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a job of the given category may start under the Dashboard's current conditions. Visible
//   renders wait only for an overlay to close. Near-viewport renders also wait for every visible render and for the
//   Dashboard to be shown. Foreground data is never held. Maintenance waits for the load gate, visibility, overlays,
//   and any foreground work to clear.
// @param {string} category - One of PRIORITY_CATEGORIES.
// @param {object} state - An object with the following properties:
//   - {object} conditions - { hidden, loadSettled, overlayHeld } as the scheduler last heard them
//   - {boolean} foregroundPressure - Whether foreground work is demanded, waiting, or running
//   - {boolean} visibleRenderWaiting - Whether a visible render could not start in this admission pass
// @returns {string|null} A WAITING_REASONS key, or null when the category may start.
export function admissionWaitingReason(category, { conditions, foregroundPressure, visibleRenderWaiting }) {
  if (category === "foregroundData") return null;
  if (conditions.overlayHeld) return "overlay";
  if (category === "visibleRender") return null;
  if (conditions.hidden) return "hidden";
  if (category === "nearViewportRender") return visibleRenderWaiting ? "foregroundDemand" : null;
  if (category === "visibleRefresh") return null;
  if (!conditions.loadSettled) return "loadGate";
  if (foregroundPressure) return "foregroundDemand";
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc The more urgent of two categories.
// @param {string} first - One of PRIORITY_CATEGORIES.
// @param {string} second - One of PRIORITY_CATEGORIES.
// @returns {string} Whichever ranks first.
export function moreUrgentCategory(first, second) {
  return priorityRank(first) <= priorityRank(second) ? first : second;
}

// ----------------------------------------------------------------------------------------------
// @desc Rank a priority category, lower being more urgent.
// @param {string} category - One of PRIORITY_CATEGORIES.
// @returns {number} The category's index.
export function priorityRank(category) {
  const rank = PRIORITY_CATEGORIES.indexOf(category);
  if (rank === -1) throw new Error(`Unknown work priority category "${ category }"`);
  return rank;
}
