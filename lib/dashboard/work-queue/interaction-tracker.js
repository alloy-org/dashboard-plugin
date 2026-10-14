// Notice when the user is scrolling, touching, clicking, or typing in the Dashboard, and treat them as interacting
// until input has been quiet for a second. The main-thread lag monitor tags each stall with it, so an export can show
// how much lag landed while someone was using the Dashboard. Listeners are passive and capture at the document, which
// also catches scrolling inside a widget, since scroll events do not bubble. Browser-only: host services never import it.

// How long after the last input the user still counts as interacting.
export const INTERACTION_QUIET_MILLISECONDS = 1000;
// The input events that mark the user as interacting.
const INTERACTION_EVENT_TYPES = ["keydown", "pointerdown", "scroll", "touchmove", "touchstart", "wheel"];

// ----------------------------------------------------------------------------------------------
// @desc Create an interaction tracker listening to a document.
// @param {object} [options] - An object with the following properties:
//   - {function} [clock=Date.now] - Returns epoch milliseconds
//   - {object|null} [documentObject] - Document to listen to; defaults to the global document, and none listens to nothing
//   - {number} [quietMilliseconds=INTERACTION_QUIET_MILLISECONDS] - Quiet time that ends an interaction
// @returns {object} An object with the following properties:
//   - {function} dispose - Removes the listeners
//   - {function} interacting - (atEpochMilliseconds = now) => whether the user was interacting at that moment, judged
//     from the last input before it
//   - {function} snapshot - () => { interacting, interactionMilliseconds, interactions }: whether the user is
//     interacting now, the total time spent interacting, and how many separate interactions there were
export function createInteractionTracker({ clock = Date.now, documentObject = _globalDocument(),
    quietMilliseconds = INTERACTION_QUIET_MILLISECONDS } = {}) {
  let completedMilliseconds = 0;
  let interactions = 0;
  let lastInputAt = null;
  let startedAt = null;

  const interacting = (atEpochMilliseconds = clock()) => lastInputAt !== null && atEpochMilliseconds - lastInputAt < quietMilliseconds;
  const handleInput = () => {
    const now = clock();
    if (!interacting(now)) {
      if (startedAt !== null) completedMilliseconds += lastInputAt + quietMilliseconds - startedAt;
      startedAt = now;
      interactions += 1;
    }
    lastInputAt = now;
  };
  const listenerOptions = { capture: true, passive: true };
  for (const type of INTERACTION_EVENT_TYPES) documentObject?.addEventListener?.(type, handleInput, listenerOptions);

  const dispose = () => {
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
