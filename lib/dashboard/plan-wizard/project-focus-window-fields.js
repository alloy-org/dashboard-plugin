// Pure interaction helpers for placing, resizing, moving, and removing a project's optional quarter focus window.

import { dayOffsetFromDateKey, lastDateFromMonthKey, updatedWindowDraft } from "dashboard/plan-wizard/quarter-name-step-fields";
import { dateFromMonthKey, formatDateKey } from "util/date-utility";

export const FOCUS_WINDOW_EDGE_HIT_PIXELS = 25;

// ----------------------------------------------------------------------------------------------
// @desc Convert a pointer's horizontal position in the track into a bounded day offset.
// @param {number} clientX - Pointer viewport x coordinate.
// @param {number} maxDay - Last zero-based day offset in the quarter.
// @param {DOMRect} trackBounds - Current timeline track bounds.
// @returns {number} Rounded day offset in the quarter.
export function dayOffsetFromPointer(clientX, maxDay, trackBounds) {
  if (!trackBounds.width || !maxDay) return 0;
  const ratio = Math.max(0, Math.min(1, (clientX - trackBounds.left) / trackBounds.width));
  return Math.round(ratio * maxDay);
}

// ----------------------------------------------------------------------------------------------
// @desc Identify which equal-width month column contains a pointer.
// @param {number} clientX - Pointer viewport x coordinate.
// @param {number} monthCount - Number of month columns in the track.
// @param {DOMRect} trackBounds - Current timeline track bounds.
// @returns {number} Zero-based month index.
export function monthIndexFromPointer(clientX, monthCount, trackBounds) {
  const clickRatio = trackBounds.width
    ? Math.max(0, Math.min(0.999999, (clientX - trackBounds.left) / trackBounds.width)) : 0;
  return Math.floor(clickRatio * monthCount);
}

// ----------------------------------------------------------------------------------------------
// @desc Shift a project's existing window by whole days without changing its duration or letting either edge
//   leave the quarter or pass a sprint deadline.
// @param {object} draft - Current per-project window draft.
// @param {object} params - { dayDelta, quarterEndOn, quarterMonths, quarterStartOn }.
// @returns {object} Shifted window draft.
export function movedWindowDraft(draft, { dayDelta, quarterEndOn, quarterMonths, quarterStartOn }) {
  const startDay = dayOffsetFromDateKey(draft.startOn, quarterStartOn);
  const endDay = dayOffsetFromDateKey(draft.endOn, quarterStartOn);
  const maxDay = dayOffsetFromDateKey(quarterEndOn, quarterStartOn);
  const deadlineOffset = draft.deadlineOn ? dayOffsetFromDateKey(draft.deadlineOn, quarterStartOn) : maxDay;
  const deadlineDay = deadlineOffset >= 0 && deadlineOffset <= maxDay ? deadlineOffset : maxDay;
  const minimumDelta = -startDay;
  const maximumDelta = Math.min(maxDay, deadlineDay) - endDay;
  const clampedDelta = Math.max(minimumDelta, Math.min(maximumDelta, dayDelta));
  return updatedWindowDraft(draft, { endDay: endDay + clampedDelta, quarterEndOn, quarterMonths, quarterStartOn,
    startDay: startDay + clampedDelta });
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a pointer starts a left-edge resize, right-edge resize, or whole-bar move.
// @param {object} params - Bar day offsets, pointer position, track bounds, and edge hit width.
// @returns {string|null} resize-start, resize-end, move, or null when the pointer is outside the bar.
export function pointerOperationFromPosition({ clientX, edgeHitPixels, endDay, maxDay, startDay, trackBounds }) {
  const pointerPixels = clientX - trackBounds.left;
  const startPixels = startDay / maxDay * trackBounds.width;
  const endPixels = endDay / maxDay * trackBounds.width;
  const startDistance = Math.abs(pointerPixels - startPixels);
  const endDistance = Math.abs(pointerPixels - endPixels);
  if (Math.min(startDistance, endDistance) <= edgeHitPixels) {
    return startDistance <= endDistance ? "resize-start" : "resize-end";
  }
  if (pointerPixels > startPixels && pointerPixels < endPixels) return "move";
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Clear a project's optional focus window while retaining every other prospect field needed for saving.
// @param {object} draft - Current per-project window draft.
// @returns {object} Draft with no dates or focus months.
export function removedWindowDraft(draft) {
  return { ...draft, endOn: null, focusMonths: [], startOn: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Instantiate a full-month focus window from the month column clicked in an unplaced project row.
// @param {object} draft - Current per-project window draft.
// @param {object} params - { monthIndex, quarterEndOn, quarterMonths, quarterStartOn }.
// @returns {object} Draft spanning the clicked month, clamped for a sprint deadline when necessary.
export function windowDraftFromMonthIndex(draft, { monthIndex, quarterEndOn, quarterMonths, quarterStartOn }) {
  const boundedIndex = Math.max(0, Math.min(quarterMonths.length - 1, monthIndex));
  const monthKey = quarterMonths[boundedIndex];
  const startDay = dayOffsetFromDateKey(formatDateKey(dateFromMonthKey(monthKey)), quarterStartOn);
  const endDay = dayOffsetFromDateKey(lastDateFromMonthKey(monthKey), quarterStartOn);
  return updatedWindowDraft(draft, { endDay, quarterEndOn, quarterMonths, quarterStartOn, startDay });
}
