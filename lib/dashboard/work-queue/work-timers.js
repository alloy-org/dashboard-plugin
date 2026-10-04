// Default timer functions for the work queue's classes. The classes keep their timer functions as properties so tests
// can supply fake ones, and call them as methods. Browsers throw "Illegal invocation" when the native setTimeout or
// clearTimeout is called with any receiver other than the window, so these wrappers call the globals without one.

// ----------------------------------------------------------------------------------------------
// @desc Cancel a timer started by startWorkTimer.
// @param {*} timer - The handle startWorkTimer returned.
export function cancelWorkTimer(timer) {
  clearTimeout(timer);
}

// ----------------------------------------------------------------------------------------------
// @desc Start a timer, safe to call as a method of any object.
// @param {function} callback - Runs when the timer fires.
// @param {number} milliseconds - Delay before it fires.
// @returns {*} A handle cancelWorkTimer accepts.
export function startWorkTimer(callback, milliseconds) {
  return setTimeout(callback, milliseconds);
}
