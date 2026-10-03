// Drive the Dashboard work scheduler from the browser. Admission passes run in an animation frame, so at most one
// pass runs per frame however many changes ask for one; while the page is hidden, frame callbacks are paused, so the
// pass runs on a short timer instead and foreground data still advances. The driver also reports page visibility to
// whoever subscribes. It is browser-only: host services never import it.

// Delay for an admission pass when animation frames are unavailable or paused, roughly one frame.
const FALLBACK_PASS_DELAY_MILLISECONDS = 16;

// ----------------------------------------------------------------------------------------------
// @desc Create a browser work driver.
// @param {object} options - An object with the following properties:
//   - {function} runReady - Runs one admission pass, normally the scheduler's runReady
//   - {function} [cancelFrame] - Cancels a frame request; defaults to window.cancelAnimationFrame
//   - {function} [clearTimer] - Cancels a timer; defaults to clearTimeout
//   - {object|null} [documentObject] - Document whose visibility is reported; defaults to the global document
//   - {function|null} [requestFrame] - Requests a frame callback; defaults to window.requestAnimationFrame
//   - {function} [setTimer] - Starts a timer; defaults to setTimeout
// @returns {object} An object with the following properties:
//   - {function} dispose - Cancels a queued pass and removes visibility listeners
//   - {function} hidden - Returns whether the page is hidden
//   - {function} requestRun - Queues one admission pass, if none is queued
//   - {function} subscribeVisibility - Takes a listener called with hidden as a boolean; returns an unsubscribe
export function createBrowserWorkDriver({ cancelFrame = _globalFunction("cancelAnimationFrame"), clearTimer = clearTimeout,
    documentObject = _globalDocument(), requestFrame = _globalFunction("requestAnimationFrame"), runReady,
    setTimer = setTimeout }) {
  let disposed = false;
  let queuedPass = null;
  const visibilityListeners = new Set();
  const hidden = () => Boolean(documentObject?.hidden);

  const runPass = () => {
    queuedPass = null;
    if (!disposed) runReady();
  };
  const requestRun = () => {
    if (disposed || queuedPass) return;
    if (requestFrame && !hidden()) queuedPass = { frame: requestFrame(runPass) };
    else queuedPass = { timer: setTimer(runPass, FALLBACK_PASS_DELAY_MILLISECONDS) };
  };
  const handleVisibilityChange = () => {
    for (const listener of [...visibilityListeners]) listener(hidden());
    // A pass queued as a frame before the page was hidden would wait until it is shown again.
    if (hidden() && queuedPass?.frame !== undefined) {
      cancelFrame?.(queuedPass.frame);
      queuedPass = null;
      requestRun();
    }
  };
  documentObject?.addEventListener?.("visibilitychange", handleVisibilityChange);

  const subscribeVisibility = listener => {
    visibilityListeners.add(listener);
    return () => visibilityListeners.delete(listener);
  };
  const dispose = () => {
    disposed = true;
    if (queuedPass?.frame !== undefined) cancelFrame?.(queuedPass.frame);
    if (queuedPass?.timer !== undefined) clearTimer(queuedPass.timer);
    queuedPass = null;
    visibilityListeners.clear();
    documentObject?.removeEventListener?.("visibilitychange", handleVisibilityChange);
  };
  return { dispose, hidden, requestRun, subscribeVisibility };
}

// ----------------------------------------------------------------------------------------------
// @desc The global document, or null outside a browser.
// @returns {object|null} The document.
function _globalDocument() {
  return typeof document === "undefined" ? null : document;
}

// ----------------------------------------------------------------------------------------------
// @desc A window function bound to the window, or null when the runtime lacks it.
// @param {string} name - Function name, such as "requestAnimationFrame".
// @returns {function|null} The bound function.
function _globalFunction(name) {
  if (typeof window === "undefined" || typeof window[name] !== "function") return null;
  return window[name].bind(window);
}
