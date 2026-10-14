// Notice when the user is scrolling, touching, clicking, or typing in the Dashboard, and treat them as interacting
// until input has been quiet for a second. The work scheduler holds new maintenance while the user interacts, told of
// each start and end through a listener, and the main-thread lag monitor tags each stall with it, so an export can
// show how much lag landed while someone was using the Dashboard. A single timer, re-armed only when it fires, notices
// the quiet second, so a stream of scroll events costs one comparison each. Listeners are passive and capture at the document, which
// also catches scrolling inside a widget, since scroll events do not bubble. Browser-only: host services never import it.

// How long after the last input the user still counts as interacting.
export const INTERACTION_QUIET_MILLISECONDS = 1000;
// The input events that mark the user as interacting.
const INTERACTION_EVENT_TYPES = ["keydown", "pointerdown", "scroll", "touchmove", "touchstart", "wheel"];

// ----------------------------------------------------------------------------------------------
// @desc Create an interaction tracker listening to a document.
// @param {object} [options] - An object with the following properties:
//   - {function} [clock=Date.now] - Returns epoch milliseconds
//   - {function} [clearTimer=clearTimeout] - Cancels a timer from setTimer
//   - {object|null} [documentObject] - Document to listen to; defaults to the global document, and none listens to nothing
//   - {function|null} [onInteractingChange=null] - (interacting) => called when an interaction starts and once it has
//     been quiet for quietMilliseconds
//   - {number} [quietMilliseconds=INTERACTION_QUIET_MILLISECONDS] - Quiet time that ends an interaction
//   - {function} [setTimer=setTimeout] - (callback, milliseconds) => timer
// @returns {object} An object with the following properties:
//   - {function} dispose - Removes the listeners
//   - {function} interacting - (atEpochMilliseconds = now) => whether the user was interacting at that moment, judged
//     from the last input before it
//   - {function} snapshot - () => { interacting, interactionMilliseconds, interactions }: whether the user is
//     interacting now, the total time spent interacting, and how many separate interactions there were
export function createInteractionTracker({ clearTimer = clearTimeout, clock = Date.now, documentObject = _globalDocument(),
    onInteractingChange = null, quietMilliseconds = INTERACTION_QUIET_MILLISECONDS, setTimer = setTimeout } = {}) {
  let completedMilliseconds = 0;
  let interactions = 0;
  let lastInputAt = null;
  let quietTimer = null;
  let startedAt = null;

  const interacting = (atEpochMilliseconds = clock()) => lastInputAt !== null && atEpochMilliseconds - lastInputAt < quietMilliseconds;
  const watchForQuiet = () => {
    const remainingMilliseconds = lastInputAt + quietMilliseconds - clock();
    if (remainingMilliseconds > 0) {
      quietTimer = setTimer(watchForQuiet, remainingMilliseconds);
      return;
    }
    quietTimer = null;
    onInteractingChange?.(false);
  };
  const handleInput = () => {
    const now = clock();
    const starting = !interacting(now);
    if (starting) {
      if (startedAt !== null) completedMilliseconds += lastInputAt + quietMilliseconds - startedAt;
      startedAt = now;
      interactions += 1;
    }
    lastInputAt = now;
    if (!onInteractingChange || quietTimer !== null) return;
    if (starting) onInteractingChange(true);
    quietTimer = setTimer(watchForQuiet, quietMilliseconds);
  };
  const listenerOptions = { capture: true, passive: true };
  for (const type of INTERACTION_EVENT_TYPES) documentObject?.addEventListener?.(type, handleInput, listenerOptions);

  const dispose = () => {
    if (quietTimer !== null) clearTimer(quietTimer);
    quietTimer = null;
    for (const type of INTERACTION_EVENT_TYPES) documentObject?.removeEventListener?.(type, handleInput, listenerOptions);
  };
  const snapshot = () => {
    const now = clock();
    const currentMilliseconds = startedAt === null ? 0 : Math.min(now, lastInputAt + quietMilliseconds) - startedAt;
    return { interacting: interacting(now), interactionMilliseconds: completedMilliseconds + currentMilliseconds, interactions };
  };
  return { dispose, interacting, snapshot };
}

// ----------------------------------------------------------------------------------------------
// @desc The global document, or null outside a browser.
// @returns {object|null} The document.
function _globalDocument() {
  return typeof document === "undefined" ? null : document;
}
