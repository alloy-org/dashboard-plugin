import React, { useEffect, useMemo, useRef } from "react";

export const MIN_MS_TO_BEGIN_DRAG = 2000;
const DRAG_READY_EVENT = "dashboard:widget-drag-ready";

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, input, select, textarea, [role='button']"));
}

// [Claude] Task: widget header component that emits long-press drag-ready events
// Prompt: "Create DraggableHeading with useEffect monitoring mousedown >= 2000ms for drag mode"
// Date: 2026-03-14 | Model: gpt-5.3-codex
export default function DraggableHeading({
  icon,
  title,
  widgetId,
  headerActions,
  configurable,
  onConfigure,
}) {
  const headerRef = useRef(null);
  const dragTimerRef = useRef(null);
  const dragReadyRef = useRef(false);

  const dragEventDetail = useMemo(() => ({ widgetId }), [widgetId]);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const clearDragTimer = () => {
      if (dragTimerRef.current != null) {
        window.clearTimeout(dragTimerRef.current);
        dragTimerRef.current = null;
      }
    };

    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;
      dragReadyRef.current = false;
      clearDragTimer();
      dragTimerRef.current = window.setTimeout(() => {
        dragReadyRef.current = true;
        window.dispatchEvent(new CustomEvent(DRAG_READY_EVENT, { detail: dragEventDetail }));
      }, MIN_MS_TO_BEGIN_DRAG);
    };

    const onMouseEnd = () => {
      clearDragTimer();
      dragReadyRef.current = false;
    };

    header.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseEnd);
    window.addEventListener("mouseleave", onMouseEnd);

    return () => {
      clearDragTimer();
      header.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseEnd);
      window.removeEventListener("mouseleave", onMouseEnd);
    };
  }, [dragEventDetail]);

  return React.createElement("div", { ref: headerRef, className: "widget-header widget-heading-bar" },
    React.createElement("span", { className: "widget-icon" }, icon),
    React.createElement("h3", { className: "widget-title" }, title),
    headerActions || null,
    configurable
      ? React.createElement("button", { className: "widget-configure", onClick: onConfigure }, "\u2699 Configure")
      : null
  );
}
