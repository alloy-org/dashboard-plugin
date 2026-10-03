import { useReportWidgetDeferred } from "dashboard-load-tracking";
import { useWidgetMountingSuspended } from "hooks/use-widget-mount-suspension";
import { useEffect, useRef, useState } from "react";
import { useDashboardWork } from "dashboard/work-queue/dashboard-work-context";
import { MOUNT_AHEAD_ROOT_MARGIN } from "dashboard/work-queue/widget-mount-coordinator";

// ------------------------------------------------------------------------------------------
// @desc Whether IntersectionObserver exists in this runtime. When it does not (very old WebView), we
//   mount eagerly so a widget can never be permanently stuck as a placeholder.
// @returns {boolean}
function intersectionObserverSupported() {
  return typeof IntersectionObserver !== "undefined";
}

// ------------------------------------------------------------------------------------------
// @desc Render a placeholder until the widget's turn to mount, then its children, mounting once. When the Dashboard
//   provides a mount coordinator, the coordinator orders the mounts (visible widgets first, one at a time); otherwise
//   each widget mounts as soon as it comes near the viewport.
// @param {{ widgetId: string, children: React.ReactNode }} props
// @returns {React.ReactNode} The children once mounted, otherwise the placeholder.
export default function LazyWidgetMount({ children, widgetId }) {
  const mountCoordinator = useDashboardWork()?.mountCoordinator;
  if (mountCoordinator) return <ScheduledWidgetMount mountCoordinator={mountCoordinator} widgetId={widgetId}>{children}</ScheduledWidgetMount>;
  return <ObservedWidgetMount widgetId={widgetId}>{children}</ObservedWidgetMount>;
}

// ------------------------------------------------------------------------------------------
// @desc The unscheduled path, used when the Dashboard provides no mount coordinator. Gate its children behind
//   viewport proximity: render a placeholder until it scrolls within MOUNT_AHEAD_ROOT_MARGIN of the viewport, then
//   render the real children and stop observing (mount-once). Because the initial IntersectionObserver callback fires asynchronously even for
//   elements already on screen, above-the-fold widgets mount a frame after first paint — which also
//   staggers the initial mount burst that spikes memory.
//
//   While a full-screen overlay has suspended mounting (see widget-mount-suspension), an intersection
//   is remembered rather than acted on, so scrolling behind the overlay does not mount widgets the user
//   cannot see and cannot spend the overlay's own inference work on widget loads. The moment the overlay
//   closes, every widget that became visible meanwhile mounts.
// @param {{ widgetId: string, children: React.ReactNode }} props
// @returns {React.ReactNode} The children once mounted, otherwise the placeholder.
function ObservedWidgetMount({ children, widgetId }) {
  const [mounted, setMounted] = useState(() => !intersectionObserverSupported());
  const placeholderRef = useRef(null);
  const suspended = useWidgetMountingSuspended();
  const intersectedWhileSuspendedRef = useRef(false);

  useEffect(() => {
    if (mounted) return undefined;
    // A widget that scrolled into view while mounting was suspended mounts as soon as it resumes, without
    // waiting for the observer to report the same intersection a second time (it would not: the element has
    // not moved, so no new entry is delivered).
    if (!suspended && intersectedWhileSuspendedRef.current) {
      setMounted(true);
      return undefined;
    }
    const node = placeholderRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      if (suspended) {
        intersectedWhileSuspendedRef.current = true;
        return;
      }
      setMounted(true);
      observer.disconnect();
    }, { rootMargin: MOUNT_AHEAD_ROOT_MARGIN });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted, suspended]);

  if (mounted) return children;
  return <WidgetMountPlaceholder placeholderRef={placeholderRef} widgetId={widgetId} />;
}


// ------------------------------------------------------------------------------------------
// @desc The scheduled path: register the placeholder with the mount coordinator, mount when the coordinator says it
//   is this widget's turn, and report the commit so the next widget may mount. Mounting is once only: a widget that
//   has mounted is never registered again, even if the coordinator is replaced. Overlay suspension is applied by the
//   scheduler, which holds render jobs while an overlay covers the Dashboard. Unmounting before the commit, as when
//   the widget throws into its error boundary, unregisters it, which releases the mount permit.
// @param {{ children: React.ReactNode, mountCoordinator: WidgetMountCoordinator, widgetId: string }} props
// @returns {React.ReactNode} The children once mounted, otherwise the placeholder.
function ScheduledWidgetMount({ children, mountCoordinator, widgetId }) {
  const [mounted, setMounted] = useState(false);
  const generationRef = useRef(null);
  const mountedRef = useRef(false);
  const placeholderRef = useRef(null);

  useEffect(() => {
    const element = placeholderRef.current;
    if (mountedRef.current || !element) return undefined;
    const mount = () => {
      mountedRef.current = true;
      setMounted(true);
    };
    const generation = mountCoordinator.register(widgetId, { element, mount });
    generationRef.current = generation;
    return () => mountCoordinator.unregister(widgetId, generation);
  }, [mountCoordinator, widgetId]);

  useEffect(() => {
    if (mounted) mountCoordinator.reportCommitted(widgetId, generationRef.current);
  }, [mounted]);

  if (mounted) return children;
  return <WidgetMountPlaceholder placeholderRef={placeholderRef} widgetId={widgetId} />;
}

// ------------------------------------------------------------------------------------------
// @desc Placeholder shown for a not-yet-mounted widget. Reserves height (see dashboard.scss) so it
//   occupies real space — critical on mobile, where grid cells drop their min-height and would
//   otherwise collapse to zero and all intersect the viewport at once, defeating the deferral. Also
//   reports the widget as deferred so the load tracker can settle without it.
// @param {{ widgetId: string, placeholderRef: React.RefObject }} props
function WidgetMountPlaceholder({ placeholderRef, widgetId }) {
  useReportWidgetDeferred(widgetId);
  return (
    <div ref={placeholderRef} className="lazy-widget-placeholder" data-widget-id={widgetId} aria-hidden="true">
      <div className="lazy-widget-placeholder-spinner" />
    </div>
  );
}
