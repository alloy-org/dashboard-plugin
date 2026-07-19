import { useEffect, useRef, useState } from "react";
import { useReportWidgetDeferred } from "dashboard-load-tracking";

// Widgets within this distance of the viewport mount ahead of scrolling so they are ready by the time
// they scroll in, trading a little eagerness for no visible pop-in. Kept modest so a tall mobile
// (single-column) layout still defers most below-the-fold widgets.
const MOUNT_AHEAD_ROOT_MARGIN = "400px 0px";

// ------------------------------------------------------------------------------------------
// @desc Whether IntersectionObserver exists in this runtime. When it does not (very old WebView), we
//   mount eagerly so a widget can never be permanently stuck as a placeholder.
// @returns {boolean}
function intersectionObserverSupported() {
  return typeof IntersectionObserver !== "undefined";
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

// ------------------------------------------------------------------------------------------
// @desc Gate its children behind viewport proximity: render a placeholder until it scrolls within
//   MOUNT_AHEAD_ROOT_MARGIN of the viewport, then render the real children and stop observing
//   (mount-once). Because the initial IntersectionObserver callback fires asynchronously even for
//   elements already on screen, above-the-fold widgets mount a frame after first paint — which also
//   staggers the initial mount burst that spikes memory.
// @param {{ widgetId: string, children: React.ReactNode }} props
// @returns {React.ReactNode} The children once mounted, otherwise the placeholder.
export default function LazyWidgetMount({ children, widgetId }) {
  const [mounted, setMounted] = useState(() => !intersectionObserverSupported());
  const placeholderRef = useRef(null);

  useEffect(() => {
    if (mounted) return undefined;
    const node = placeholderRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setMounted(true);
        observer.disconnect();
      }
    }, { rootMargin: MOUNT_AHEAD_ROOT_MARGIN });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  if (mounted) return children;
  return <WidgetMountPlaceholder placeholderRef={placeholderRef} widgetId={widgetId} />;
}
