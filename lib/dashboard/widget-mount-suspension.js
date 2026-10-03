// A dashboard-wide switch that pauses viewport-driven widget mounting while a full-screen overlay (the Plan
// Wizard) covers the dashboard. Lives as a module singleton rather than React context because the overlay is
// rendered deep inside one widget while the lazy mounts it must pause are spread across every other widget,
// so there is no common provider between them that is not the whole dashboard tree. React-free, so services can read
// it; the React hooks over it live in hooks/use-widget-mount-suspension.

// Overlays currently asking for suspension. Counted rather than a boolean so two overlays open at once cannot
// have the first one to close resume mounting underneath the second.
let openOverlayCount = 0;
const suspensionListeners = new Set();

// ------------------------------------------------------------------------------------------
// @desc Whether viewport-driven widget mounting is presently paused.
// @returns {boolean} True while at least one overlay has suspended mounting.
export function widgetMountingSuspended() {
  return openOverlayCount > 0;
}

// ------------------------------------------------------------------------------------------
// @desc Notify every subscriber of the current suspension state.
function notifySuspensionListeners() {
  const suspended = widgetMountingSuspended();
  for (const listener of suspensionListeners) listener(suspended);
}

// ------------------------------------------------------------------------------------------
// @desc Suspend viewport-driven widget mounting for as long as the returned release function has not been
//   called. Scrolling behind the overlay still moves widgets into view, but they stay as placeholders until
//   the overlay releases, at which point every widget that became visible meanwhile mounts at once.
// @returns {Function} Release function; calling it more than once is a no-op so a React cleanup that runs
//   twice (StrictMode double-invoke) cannot drive the count negative.
export function suspendWidgetMounting() {
  openOverlayCount += 1;
  notifySuspensionListeners();
  let released = false;
  return function releaseWidgetMounting() {
    if (released) return;
    released = true;
    openOverlayCount -= 1;
    notifySuspensionListeners();
  };
}

// ------------------------------------------------------------------------------------------
// @desc Subscribe to suspension changes.
// @param {function(boolean): void} listener - Called with the new suspension state on every change.
// @returns {Function} Unsubscribe function.
export function subscribeToWidgetMountSuspension(listener) {
  suspensionListeners.add(listener);
  return () => suspensionListeners.delete(listener);
}
