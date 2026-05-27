import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export const DASHBOARD_WIDGET_FOCUS_EVENT = "dashboard:widget-focus-request";
export const MIN_MS_TO_BEGIN_DRAG = 2000;
const DRAG_READY_EVENT = "dashboard:widget-drag-ready";
const REORDER_FLIP_MS = 220;

function isInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, input, select, textarea, [role='button']"));
}

// ---------------------------------------------------------------------------
// @description Returns whether the current client should expose desktop-only widget-focus mode.
// [OpenAI gpt-5.4] Task: gate widget icon focus mode to desktop-like clients only
// Prompt: "Implement a new widget behavior via a new behavior only available on desktop clients"
export function isDesktopDashboardFocusClient() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isTouchMac = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
  return !isMobileUserAgent && !isTouchMac && window.innerWidth > 800;
}

// ---------------------------------------------------------------------------
// Drag-reorder pure helpers
// ---------------------------------------------------------------------------

// [Claude] Task: reorder helper used while dragging dashboard widgets
function moveWidgetBefore(layoutConfig, draggedWidgetId, targetWidgetId) {
  if (!Array.isArray(layoutConfig)) return layoutConfig;
  if (!draggedWidgetId || !targetWidgetId || draggedWidgetId === targetWidgetId) return layoutConfig;
  const fromIndex = layoutConfig.findIndex(c => c?.widgetId === draggedWidgetId);
  const toIndex = layoutConfig.findIndex(c => c?.widgetId === targetWidgetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return layoutConfig;
  const next = [...layoutConfig];
  const [moved] = next.splice(fromIndex, 1);
  const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
  next.splice(adjustedToIndex, 0, moved);
  return next;
}

// [Claude] Task: capture pre-reorder widget positions for FLIP animation
function widgetRectsById() {
  if (typeof document === 'undefined') return new Map();
  const rects = new Map();
  const cells = document.querySelectorAll('.dashboard-grid .grid-cell[data-widget-id]');
  cells.forEach(cell => {
    const widgetId = cell.getAttribute('data-widget-id');
    if (!widgetId) return;
    rects.set(widgetId, cell.getBoundingClientRect());
  });
  return rects;
}

// [Claude] Task: animate grid-cell movement between drag reorder states
function animateReorderedWidgets(previousRects, excludeWidgetId) {
  if (!(previousRects instanceof Map) || previousRects.size === 0) return;
  if (typeof document === 'undefined') return;

  const animatedCells = [];
  const cells = document.querySelectorAll('.dashboard-grid .grid-cell[data-widget-id]');
  cells.forEach(cell => {
    const widgetId = cell.getAttribute('data-widget-id');
    if (!widgetId || widgetId === excludeWidgetId) return;
    const previousRect = previousRects.get(widgetId);
    if (!previousRect) return;
    const nextRect = cell.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
    cell.style.transition = 'none';
    cell.style.setProperty('--flip-x', `${deltaX}px`);
    cell.style.setProperty('--flip-y', `${deltaY}px`);
    animatedCells.push(cell);
  });

  if (animatedCells.length === 0) return;

  window.requestAnimationFrame(() => {
    animatedCells.forEach(cell => {
      cell.style.transition = `transform ${REORDER_FLIP_MS}ms ease`;
      cell.style.setProperty('--flip-x', '0px');
      cell.style.setProperty('--flip-y', '0px');
    });
    window.setTimeout(() => {
      animatedCells.forEach(cell => cell.style.removeProperty('transition'));
    }, REORDER_FLIP_MS + 40);
  });
}

function widgetOrder(layoutConfig) {
  return (layoutConfig || []).map(config => config?.widgetId).filter(Boolean).join("|");
}

// ---------------------------------------------------------------------------
// useDashboardDrag — encapsulates all drag-reorder state and effects
// ---------------------------------------------------------------------------

// [Claude] Task: custom hook encapsulating all dashboard drag-reorder state and effects
export function useDashboardDrag(activeComponents, onReorder) {
  const [draggingWidgetId, setDraggingWidgetId] = useState(null);
  const [displayedComponents, setDisplayedComponents] = useState(activeComponents);
  const displayedComponentsRef = useRef(activeComponents);
  const previousRectsRef = useRef(null);

  useEffect(() => {
    if (draggingWidgetId) return;
    setDisplayedComponents(activeComponents);
  }, [activeComponents, draggingWidgetId]);

  useEffect(() => {
    displayedComponentsRef.current = displayedComponents;
  }, [displayedComponents]);

  useLayoutEffect(() => {
    const previousRects = previousRectsRef.current;
    if (!draggingWidgetId || !previousRects) return;
    previousRectsRef.current = null;
    animateReorderedWidgets(previousRects, draggingWidgetId);
  }, [displayedComponents, draggingWidgetId]);

  useEffect(() => {
    const onDragReady = (event) => {
      const readyWidgetId = event?.detail?.widgetId;
      if (!readyWidgetId) return;
      setDraggingWidgetId(readyWidgetId);
      setDisplayedComponents(prev => Array.isArray(prev) && prev.length ? prev : activeComponents);
    };
    window.addEventListener(DRAG_READY_EVENT, onDragReady);
    return () => window.removeEventListener(DRAG_READY_EVENT, onDragReady);
  }, [activeComponents]);

  const finalizeDrag = useCallback(() => {
    if (!draggingWidgetId) return;
    const previousOrder = widgetOrder(activeComponents);
    const nextOrder = widgetOrder(displayedComponentsRef.current);
    setDraggingWidgetId(null);
    if (nextOrder && previousOrder !== nextOrder) {
      onReorder(displayedComponentsRef.current.map(c => c.widgetId));
    }
  }, [activeComponents, draggingWidgetId, onReorder]);

  useEffect(() => {
    if (!draggingWidgetId) return;

    const onMouseMove = (event) => {
      if ((event.buttons & 1) !== 1) {
        finalizeDrag();
        return;
      }
      const hoveredElement = document.elementFromPoint(event.clientX, event.clientY);
      const hoveredCell = hoveredElement?.closest?.('.dashboard-grid .grid-cell[data-widget-id]');
      const targetWidgetId = hoveredCell?.getAttribute?.('data-widget-id');
      if (!targetWidgetId || targetWidgetId === draggingWidgetId) return;
      const beforeRects = widgetRectsById();
      setDisplayedComponents(prev => {
        const next = moveWidgetBefore(prev, draggingWidgetId, targetWidgetId);
        if (next !== prev) previousRectsRef.current = beforeRects;
        return next;
      });
    };

    const onMouseUp = () => finalizeDrag();
    const onBlur = () => finalizeDrag();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [draggingWidgetId, finalizeDrag]);

  return { draggingWidgetId, displayedComponents };
}

// ---------------------------------------------------------------------------
// DraggableHeading — widget header that emits long-press drag-ready events
// ---------------------------------------------------------------------------

// [Claude] Task: widget header component that emits long-press drag-ready events
// [Claude claude-4.7-opus] Task: migrate DraggableHeading from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DraggableHeading({
  configurable,
  headerActions,
  icon,
  onConfigure,
  subtitle,
  title,
  widgetId,
}) {
  const [desktopFocusAvailable, setDesktopFocusAvailable] = useState(() => isDesktopDashboardFocusClient());
  const headerRef = useRef(null);
  const dragTimerRef = useRef(null);
  const dragReadyRef = useRef(false);

  const dragEventDetail = useMemo(() => ({ widgetId }), [widgetId]);

  useEffect(() => {
    const syncDesktopFocusAvailability = () => setDesktopFocusAvailable(isDesktopDashboardFocusClient());
    syncDesktopFocusAvailability();
    window.addEventListener('resize', syncDesktopFocusAvailability);
    return () => window.removeEventListener('resize', syncDesktopFocusAvailability);
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const clearDragTimer = () => {
      if (dragTimerRef.current != null) {
        window.clearTimeout(dragTimerRef.current);
        dragTimerRef.current = null;
      }
    };

    const setDragReadyVisualState = (isReady) => {
      header.classList.toggle("widget-heading-bar--drag-ready", Boolean(isReady));
    };

    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;
      dragReadyRef.current = false;
      setDragReadyVisualState(false);
      clearDragTimer();
      dragTimerRef.current = window.setTimeout(() => {
        dragReadyRef.current = true;
        setDragReadyVisualState(true);
        window.dispatchEvent(new CustomEvent(DRAG_READY_EVENT, { detail: dragEventDetail }));
      }, MIN_MS_TO_BEGIN_DRAG);
    };

    const onMouseEnd = () => {
      clearDragTimer();
      dragReadyRef.current = false;
      setDragReadyVisualState(false);
    };

    header.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseEnd);
    window.addEventListener("mouseleave", onMouseEnd);

    return () => {
      clearDragTimer();
      setDragReadyVisualState(false);
      header.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseEnd);
      window.removeEventListener("mouseleave", onMouseEnd);
    };
  }, [dragEventDetail]);

  return (
    <div
      ref={headerRef}
      className={`widget-header widget-heading-bar${desktopFocusAvailable ? ' widget-heading-bar--focusable' : ''}`}
    >
      {desktopFocusAvailable ? (
        <button
          className="widget-icon widget-icon-button"
          type="button"
          title={`Focus ${title}`}
          aria-label={`Focus ${title}`}
          onClick={() => window.dispatchEvent(new CustomEvent(DASHBOARD_WIDGET_FOCUS_EVENT, { detail: dragEventDetail }))}
        >{icon}</button>
      ) : (
        <span className="widget-icon">{icon}</span>
      )}
      <h3 className="widget-title">
        <span className="widget-title__label">{title}</span>
        {subtitle ? <span className="widget-title__subtitle">{subtitle}</span> : null}
      </h3>
      {headerActions || null}
      {configurable ? (
        <button className="widget-configure" onClick={onConfigure}>⚙ Configure</button>
      ) : null}
    </div>
  );
}
