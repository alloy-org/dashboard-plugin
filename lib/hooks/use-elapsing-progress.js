// Drive the progress bar the wizard shows while a provider request is in flight. A request has no progress to
// report — even a streamed answer does not say how much of it is left — so the bar reports elapsed time against the
// budget instead, and
// the only honest thing it can do is never claim to be finished before the request is.

import { useEffect, useRef, useState } from "react";

// The fill is recomputed on a timer rather than a CSS transition because its rate changes partway through, and a
// transition whose duration changes mid-flight restarts rather than bending.
const PROGRESS_TICK_MS = 100;
// An eased bar is this far from full when the budget runs out, so it keeps visibly creeping without ever arriving.
const EASED_REMAINING_AT_TIMEOUT = 0.02;

// ----------------------------------------------------------------------------------------------
// @desc Report how full an elapsed-time progress bar should be, from the moment a request went in flight. The fill
//   advances at a steady rate toward completion at targetSeconds; once decelerateAtSeconds has passed it advances at
//   a third of that rate, which carries the remaining fill to full at timeoutSeconds rather than before it.
// @param {boolean} isRunning - True while the request is in flight; false resets the bar for the next request.
// @param {Object} [params] - An object with the following properties:
//   - {number} decelerateAtSeconds - Elapsed seconds after which the fill slows to a third of its rate
//   - {boolean} easesOut - True slows the fill continuously after decelerateAtSeconds instead of at a fixed third,
//     so it never reaches full before the request finishes
//   - {number} targetSeconds - Elapsed seconds the undecelerated fill would reach full at
//   - {number} timeoutSeconds - The request's own budget, where the decelerated fill reaches full
// @returns {number} Fill fraction between 0 and 1.
export function useElapsingProgress(isRunning, { decelerateAtSeconds = 30, easesOut = false, targetSeconds = 40,
  timeoutSeconds = 60 } = {}) {
  const [progressFraction, setProgressFraction] = useState(0);
  const startedAtRef = useRef(null);

  useEffect(() => {
    if (!isRunning) {
      startedAtRef.current = null;
      setProgressFraction(0);
      return undefined;
    }
    startedAtRef.current = performance.now();
    setProgressFraction(0);
    const intervalId = setInterval(() => {
      const elapsedSeconds = (performance.now() - startedAtRef.current) / 1000;
      setProgressFraction(progressFractionAtElapsed(elapsedSeconds,
        { decelerateAtSeconds, easesOut, targetSeconds, timeoutSeconds }));
    }, PROGRESS_TICK_MS);
    return () => clearInterval(intervalId);
  }, [decelerateAtSeconds, easesOut, isRunning, targetSeconds, timeoutSeconds]);

  return progressFraction;
}

// ----------------------------------------------------------------------------------------------
// @desc Compute the fill for one elapsed duration. Kept separate from the timer so the curve can be asserted at
//   chosen instants rather than waited out in real time.
//
//   The decelerated rate is a third of the initial one, and the remaining fill is what is left at the moment of
//   deceleration. Where those two agree — the third-speed fill arriving at full exactly at timeoutSeconds — the
//   curve is continuous; where a caller's numbers disagree, the fill is clamped rather than overrunning.
//
//   An eased curve instead shrinks the remaining fill by a constant proportion each second, chosen so that only
//   EASED_REMAINING_AT_TIMEOUT of it is left at timeoutSeconds. The bar slows the nearer it gets to full and never
//   gets there, which suits a request whose real duration can run past the moment a linear bar would have filled.
// @param {number} elapsedSeconds - Seconds since the request went in flight.
// @param {Object} params - An object with the following properties:
//   - {number} decelerateAtSeconds - Elapsed seconds after which the fill slows
//   - {boolean} easesOut - True for the eased curve after decelerateAtSeconds
//   - {number} targetSeconds - Elapsed seconds the undecelerated fill would reach full at
//   - {number} timeoutSeconds - The request's budget, where the decelerated fill reaches full
// @returns {number} Fill fraction between 0 and 1.
export function progressFractionAtElapsed(elapsedSeconds, { decelerateAtSeconds, easesOut = false, targetSeconds,
  timeoutSeconds }) {
  if (elapsedSeconds <= 0) return 0;
  const initialRatePerSecond = 1 / targetSeconds;
  if (elapsedSeconds < decelerateAtSeconds) return Math.min(1, elapsedSeconds * initialRatePerSecond);
  const fractionAtDeceleration = Math.min(1, decelerateAtSeconds * initialRatePerSecond);
  const deceleratedSeconds = elapsedSeconds - decelerateAtSeconds;
  if (easesOut) {
    const remainingAtDeceleration = 1 - fractionAtDeceleration;
    if (remainingAtDeceleration <= EASED_REMAINING_AT_TIMEOUT) return fractionAtDeceleration;
    const easingSeconds = Math.max(timeoutSeconds - decelerateAtSeconds, 1);
    const decayPerSecond = Math.log(remainingAtDeceleration / EASED_REMAINING_AT_TIMEOUT) / easingSeconds;
    const remainingFill = remainingAtDeceleration * Math.exp(-decayPerSecond * deceleratedSeconds);
    return 1 - remainingFill;
  }
  const deceleratedRatePerSecond = initialRatePerSecond / 3;
  const decelerationFill = deceleratedSeconds * deceleratedRatePerSecond;
  const cappedElapsedFill = fractionAtDeceleration + decelerationFill;
  return Math.min(1, cappedElapsedFill);
}
