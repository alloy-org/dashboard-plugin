// Tests for the elapsed-time progress curve the wizard shows while a provider request is in flight. The behavior
// that matters is what a plain linear bar could not do: it must not reach full before the request has either
// answered or given up, because a bar sitting at 100% while the request is still running says it finished.

import { progressFractionAtElapsed } from "hooks/use-elapsing-progress";

const CURVE = { decelerateAtSeconds: 30, targetSeconds: 40, timeoutSeconds: 60 };

// ----------------------------------------------------------------------------------------------
// @desc Read the fill at one elapsed moment on the wizard's own curve.
// @param {number} elapsedSeconds - Seconds since the request went in flight.
// @returns {number} Fill fraction between 0 and 1.
function fillAt(elapsedSeconds) {
  return progressFractionAtElapsed(elapsedSeconds, CURVE);
}

// ----------------------------------------------------------------------------------------------
// @desc Confirm the fill advances at the undecelerated rate until the deceleration point, so a request answering in
//   the usual time is tracked against the forty seconds it was paced for rather than the timeout.
test("advances toward the target rate before decelerating", () => {
  expect(fillAt(0)).toBe(0);
  expect(fillAt(10)).toBeCloseTo(0.25, 5);
  expect(fillAt(20)).toBeCloseTo(0.5, 5);
  // Just short of the deceleration point the bar is still on the initial rate: 30 of the 40 paced seconds.
  expect(fillAt(29.9)).toBeCloseTo(0.7475, 4);
});

// ----------------------------------------------------------------------------------------------
// @desc Confirm the curve is continuous where the rate changes. A jump at the deceleration point would read as the
//   bar stalling or lurching, which is the visible symptom of the two segments disagreeing.
test("changes rate without jumping at the deceleration point", () => {
  const justBefore = fillAt(29.999);
  const atPoint = fillAt(30);
  expect(atPoint).toBeCloseTo(0.75, 5);
  expect(Math.abs(atPoint - justBefore)).toBeLessThan(0.001);
});

// ----------------------------------------------------------------------------------------------
// @desc Confirm the decelerated segment runs at a third of the initial rate and lands at full exactly when the
//   request's own budget expires, so the bar and the timeout agree on when there is nothing left to wait for.
test("stretches the remaining fill across the rest of the timeout", () => {
  // A third of 1/40 per second, so the last quarter of the bar takes the full thirty seconds that remain.
  expect(fillAt(45)).toBeCloseTo(0.875, 5);
  expect(fillAt(60)).toBeCloseTo(1, 5);
});

// ----------------------------------------------------------------------------------------------
// @desc Confirm the fill never exceeds full, so a request outliving its own timeout cannot overrun the bar.
test("clamps at full rather than overrunning a request that outlives its timeout", () => {
  expect(fillAt(75)).toBe(1);
  expect(fillAt(600)).toBe(1);
});
