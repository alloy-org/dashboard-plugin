// React hooks over the dashboard-wide widget mount suspension: one lets an overlay suspend mounting while it is open,
// the other lets a component follow whether mounting is suspended. The counted state itself stays React-free in
// dashboard/widget-mount-suspension.
import { subscribeToWidgetMountSuspension, suspendWidgetMounting, widgetMountingSuspended } from "dashboard/widget-mount-suspension";
import { useEffect, useState } from "react";

// ------------------------------------------------------------------------------------------
// @desc Suspend viewport-driven widget mounting for the lifetime of the calling component. Intended for an
//   overlay component that covers the dashboard: mounting resumes as soon as the overlay unmounts.
export function useSuspendWidgetMounting() {
  useEffect(() => suspendWidgetMounting(), []);
}

// ------------------------------------------------------------------------------------------
// @desc Track whether widget mounting is presently suspended, re-rendering the caller when it changes.
// @returns {boolean} True while an overlay has suspended mounting.
export function useWidgetMountingSuspended() {
  const [suspended, setSuspended] = useState(widgetMountingSuspended);
  useEffect(() => subscribeToWidgetMountSuspension(setSuspended), []);
  return suspended;
}
