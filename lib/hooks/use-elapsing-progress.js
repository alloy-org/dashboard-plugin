// Drive the progress bar the wizard shows while a provider request is in flight. A request has no progress to
// report — nothing streams back until it is done — so the bar reports elapsed time against the budget instead, and
// the only honest thing it can do is never claim to be finished before the request is.

import { useEffect, useRef, useState } from "react";

// The fill is recomputed on a timer rather than a CSS transition because its rate changes partway through, and a
// transition whose duration changes mid-flight restarts rather than bending.
const PROGRESS_TICK_MS = 100;

// ----------------------------------------------------------------------------------------------
// @desc Report how full an elapsed-time progress bar should be, from the moment a request went in flight. The fill
//   advances at a steady rate toward completion at targetSeconds; once decelerateAtSeconds has passed it advances at
//   a third of that rate, which carries the remaining fill to full at timeoutSeconds rather than before it.
// @param {boolean} isRunning - True while the request is in flight; false resets the bar for the next request.
// @param {Object} [params] - An object with the following properties:
//   - {number} decelerateAtSeconds - Elapsed seconds after which the fill slows to a third of its rate
//   - {number} targetSeconds - Elapsed seconds the undecelerated fill would reach full at
//   - {number} timeoutSeconds - The request's own budget, where the decelerated fill reaches full
// @returns {number} Fill fraction between 0 and 1.
export function useElapsingProgress(isRunning, { decelerateAtSeconds = 30, targetSeconds = 40,
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
        { decelerateAtSeconds, targetSeconds, timeoutSeconds }));
    }, PROGRESS_TICK_MS);
    return () => clearInterval(intervalId);
  }, [decelerateAtSeconds, isRunning, targetSeconds, timeoutSeconds]);

  return progressFraction;
}

// ----------------------------------------------------------------------------------------------
// @desc Compute the fill for one elapsed duration. Kept separate from the timer so the curve can be asserted at
//   chosen instants rather than waited out in real time.
//
//   The decelerated rate is a third of the initial one, and the remaining fill is what is left at the moment of
//   deceleration. Where those two agree — the third-speed fill arriving at full exactly at timeoutSeconds — the
//   curve is continuous; where a caller's numbers disagree, the fill is clamped rather than overrunning.
// @param {number} elapsedSeconds - Seconds since the request went in flight.
// @param {Object} params - An object with the following properties:
//   - {number} decelerateAtSeconds - Elapsed seconds after which the fill slows
//   - {number} targetSeconds - Elapsed seconds the undecelerated fill would reach full at
//   - {number} timeoutSeconds - The request's budget, where the decelerated fill reaches full
// @returns {number} Fill fraction between 0 and 1.
export function progressFractionAtElapsed(elapsedSeconds, { decelerateAtSeconds, targetSeconds, timeoutSeconds }) {
  if (elapsedSeconds <= 0) return 0;
  const initialRatePerSecond = 1 / targetSeconds;
  if (elapsedSeconds < decelerateAtSeconds) return Math.min(1, elapsedSeconds * initialRatePerSecond);
  const fractionAtDeceleration = Math.min(1, decelerateAtSeconds * initialRatePerSecond);
  const deceleratedSeconds = elapsedSeconds - decelerateAtSeconds;
  const deceleratedRatePerSecond = initialRatePerSecond / 3;
  const decelerationFill = deceleratedSeconds * deceleratedRatePerSecond;
  const cappedElapsedFill = fractionAtDeceleration + decelerationFill;
  return Math.min(1, cappedElapsedFill);
}
