/**
 * [GPT-5.4-authored file]
 * Prompt summary: "move the desktop widget-focus behavior out of dashboard.js into a standalone utility"
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { DASHBOARD_FOCUS } from "constants/settings";
import { DASHBOARD_WIDGET_FOCUS_EVENT, isDesktopDashboardFocusClient } from "draggable-heading";
import { WIDGET_REGISTRY } from "layout-profiles";

const DESKTOP_FOCUS_HEIGHT_SIZE = 2;
const DESKTOP_FOCUS_MIN_HEIGHT_PX = 600;
const DESKTOP_FOCUS_WIDTH_SIZE = 4;
const FOCUS_VIEWPORT_TOP_RATIO = 0.2;
const FOCUS_HIDE_SCALE = 0.9;
const FOCUS_OFFSCREEN_MARGIN_PX = 96;
const FOCUS_RESIZE_EASING = 'ease-in-out';
export const FOCUS_EXPANSION_DELAY_MS = 250;
export const FOCUS_RESIZE_TRANSITION_MS = 500;
const SETTLED_FOCUS_TRANSFORM = { blur: '0px', opacity: 1, scaleX: 1, scaleY: 1, x: '0px', y: '0px' };

// ------------------------------------------------------------------------------------------
// @description Returns the multiplier required to move a point past a viewport edge on one axis.
// @param {number} distance - Signed distance from viewport center to the current rect center
// @param {number} requiredDistance - Distance needed to place the rect beyond the visible edge
// @returns {number} Scalar multiplier relative to the current distance vector
function axisScaleFromDistance(distance, requiredDistance) {
  return Math.abs(distance) < 1 ? 0 : requiredDistance / Math.abs(distance);
}

// ------------------------------------------------------------------------------------------
// @description FLIP-animates a surface already laid out at its destination: invert with
//   translate/scale so it looks like fromRect, then play to identity. Invert is applied as an
//   inline style before WAAPI so the first paint never flashes the full destination size.
// @param {Object} fromRect - Viewport rectangle the animation should appear to start from
// @param {HTMLElement|null} surface - Surface already sized/positioned at the destination
// @returns {Animation|null} The running animation, or null when the runtime cannot animate
// [Cursor Grok 4.5] Task: FLIP focused widget surface without destination-size flash
function animateSurfaceFromRect(fromRect, surface) {
  if (typeof surface?.animate !== 'function') return null;
  const toRect = surface.getBoundingClientRect();
  const deltaX = fromRect.left - toRect.left;
  const deltaY = fromRect.top - toRect.top;
  const scaleX = fromRect.width / (toRect.width || 1);
  const scaleY = fromRect.height / (toRect.height || 1);
  const invertTransform = `translate(${ deltaX }px, ${ deltaY }px) scale(${ scaleX }, ${ scaleY })`;
  surface.style.transformOrigin = 'top left';
  surface.style.transform = invertTransform;
  const surfaceAnimation = surface.animate([
    { transform: invertTransform },
    { transform: 'translate(0px, 0px) scale(1, 1)' },
  ], { duration: FOCUS_RESIZE_TRANSITION_MS, easing: FOCUS_RESIZE_EASING });
  surfaceAnimation.finished.catch(() => {}).finally(() => {
    if (!surface.isConnected) return;
    // A superseded animation must not clear invert owned by a newer FLIP on this surface.
    if (surface.getAnimations().some(animation => animation !== surfaceAnimation)) return;
    surface.style.removeProperty('transform');
    surface.style.removeProperty('transform-origin');
  });
  return surfaceAnimation;
}

// ------------------------------------------------------------------------------------------
// @description Overlay rectangle for a focused widget: grid left edge, ~20% of viewport height.
// @param {DOMRect} gridRect - Dashboard grid viewport bounds
// @param {DOMRect} originalRect - Widget bounds before focus
// @param {string} widgetId - Focused widget id
// @returns {Object} Target viewport rectangle
function focusedSurfaceTargetRect(gridRect, originalRect, widgetId) {
  const expandsForFocus = widgetAllowsExpandedFocus(widgetId);
  return {
    height: expandsForFocus ? DESKTOP_FOCUS_MIN_HEIGHT_PX : originalRect.height,
    left: gridRect.left,
    top: window.innerHeight * FOCUS_VIEWPORT_TOP_RATIO,
    width: expandsForFocus ? gridRect.width : originalRect.width,
  };
}

// ------------------------------------------------------------------------------------------
// @description Returns focus-mode class/style fragments for a dashboard widget cell.
// @param {string|null} focusedWidgetId - Widget currently centered in focus mode
// @param {Object|null} widgetFocusTransform - Measured transform values for the cell
// @param {string} widgetId - Widget id for the cell being rendered
// @returns {{ classNames: string[], style: Object|undefined }} Focus-related props fragment
export function gridCellFocusProps(focusedWidgetId, widgetFocusTransform, widgetId) {
  const style = widgetFocusTransform ? {
    '--focus-blur': widgetFocusTransform.blur,
    '--focus-opacity': `${ widgetFocusTransform.opacity }`,
    '--focus-scale-x': `${ widgetFocusTransform.scaleX }`,
    '--focus-scale-y': `${ widgetFocusTransform.scaleY }`,
    '--focus-x': widgetFocusTransform.x,
    '--focus-y': widgetFocusTransform.y,
  } : undefined;
  return {
    classNames: [
      focusedWidgetId ? 'grid-cell--focus-mode' : '',
      focusedWidgetId && focusedWidgetId === widgetId ? 'grid-cell--focused' : '',
      focusedWidgetId && focusedWidgetId !== widgetId ? 'grid-cell--focus-hidden' : '',
    ].filter(Boolean),
    style,
  };
}

// ------------------------------------------------------------------------------------------
// @description Computes the transform that pushes a non-focused widget fully outside the viewport.
// @param {DOMRect} rect - Current grid-cell bounding rect
// @param {Object} viewportCenter - Viewport center point with x/y numbers
// @returns {Object} Transform descriptor with CSS-ready strings and scalar values
function offscreenFocusTransformFromRect(rect, viewportCenter) {
  const currentCenterX = rect.left + rect.width / 2;
  const currentCenterY = rect.top + rect.height / 2;
  let deltaX = currentCenterX - viewportCenter.x;
  let deltaY = currentCenterY - viewportCenter.y;
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) deltaY = -1;
  const xDistance = viewportCenter.x + rect.width / 2 + FOCUS_OFFSCREEN_MARGIN_PX;
  const yDistance = viewportCenter.y + rect.height / 2 + FOCUS_OFFSCREEN_MARGIN_PX;
  const exitScales = [axisScaleFromDistance(deltaX, xDistance), axisScaleFromDistance(deltaY, yDistance)]
    .filter(axisScale => axisScale > 1);
  const scale = Math.max(exitScales.length ? Math.min(...exitScales) : 1, 1.35);
  return {
    blur: '2px',
    opacity: 0,
    scaleX: FOCUS_HIDE_SCALE,
    scaleY: FOCUS_HIDE_SCALE,
    x: `${ deltaX * (scale - 1) }px`,
    y: `${ deltaY * (scale - 1) }px`,
  };
}

// ------------------------------------------------------------------------------------------
// @description Finds the detachable surface wrapping one widget's rendered content.
// @param {string} widgetId - Widget id whose surface should be located
// @returns {HTMLElement|null} The surface element, or null when the dashboard is not rendered
function surfaceElementFromId(widgetId) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`.dashboard-grid .grid-cell[data-widget-id="${ widgetId }"] .grid-cell-surface`);
}

// ------------------------------------------------------------------------------------------
// @description Returns whether the registry permits a widget to use the desktop 4-by-2 focus size.
// @param {string} widgetId - Widget id to inspect
// @returns {boolean} Whether the expanded focus size is allowed
function widgetAllowsExpandedFocus(widgetId) {
  const registryEntry = WIDGET_REGISTRY.find(widget => widget.widgetId === widgetId);
  if (!registryEntry) return false;
  const horizontalSizeAllowed = registryEntry.maxHorizontalTiles == null ||
    registryEntry.maxHorizontalTiles >= DESKTOP_FOCUS_WIDTH_SIZE;
  const verticalSizeAllowed = registryEntry.maxVerticalTiles == null ||
    registryEntry.maxVerticalTiles >= DESKTOP_FOCUS_HEIGHT_SIZE;
  return horizontalSizeAllowed && verticalSizeAllowed;
}

// ------------------------------------------------------------------------------------------
// @description Returns a transient 4-by-2 configuration for a focused widget when its registry
//   limits permit that size, without changing or persisting the widget's usual configuration.
// @param {Object} config - Persisted dashboard widget configuration
// @param {string|null} expandedWidgetId - Widget currently expanded in focus mode
// @returns {Object} Original configuration or a focus-sized copy
export function widgetConfigForFocus(config, expandedWidgetId) {
  if (!config?.widgetId || config.widgetId !== expandedWidgetId) return config;
  if (!widgetAllowsExpandedFocus(expandedWidgetId)) return config;
  return { ...config, gridHeightSize: DESKTOP_FOCUS_HEIGHT_SIZE, gridWidthSize: DESKTOP_FOCUS_WIDTH_SIZE };
}

// ------------------------------------------------------------------------------------------
// @description Measures all rendered widget cells and returns transforms that keep the focused
//   widget in place while pushing the rest beyond the current viewport bounds.
// @param {string} widgetId - Widget id to keep visible in focus mode
// @returns {Object|null} Per-widget transform map keyed by widget id, or null when unavailable
function widgetExitTransformsFromId(widgetId) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const cells = Array.from(document.querySelectorAll('.dashboard-grid .grid-cell[data-widget-id]'));
  if (!cells.length) return null;
  const viewportCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const transforms = {};
  cells.forEach(cell => {
    const currentWidgetId = cell.getAttribute('data-widget-id');
    if (!currentWidgetId) return;
    const rect = cell.getBoundingClientRect();
    transforms[currentWidgetId] = currentWidgetId === widgetId
      ? SETTLED_FOCUS_TRANSFORM
      : offscreenFocusTransformFromRect(rect, viewportCenter);
  });
  return transforms;
}

// ------------------------------------------------------------------------------------------
// @description Converts a viewport rectangle into fixed-position style values.
// @param {Object} rect - Target viewport bounds
// @returns {Object} React style values for the focused widget surface
function widgetSurfaceStyleFromRect(rect) {
  return {
    height: `${ rect.height }px`,
    left: `${ rect.left }px`,
    top: `${ rect.top }px`,
    width: `${ rect.width }px`,
  };
}

// ------------------------------------------------------------------------------------------
// @description Manages desktop-only widget-focus mode: neighbor exit transforms, delayed expand to
//   a fixed overlay, and FLIP animation started in useLayoutEffect so destination styles never paint
//   before invert. Clears on Escape, resize, drag, or leaving the default dashboard focus state.
// @param {boolean} draggingWidgetId - Whether a widget drag is currently active
// @param {string} focusState - Current dashboard popup/focus mode identifier
// @returns {Object} Focus-mode state and controls used by DashboardApp
export function useDashboardWidgetFocus(draggingWidgetId, focusState) {
  const [expandedWidgetId, setExpandedWidgetId] = useState(null);
  const [focusedWidgetId, setFocusedWidgetId] = useState(null);
  const [focusedWidgetSurfaceStyle, setFocusedWidgetSurfaceStyle] = useState(null);
  const [widgetFocusTransforms, setWidgetFocusTransforms] = useState({});
  const clearTimerRef = useRef(null);
  const expansionTimerRef = useRef(null);
  const originalWidgetRectRef = useRef(null);
  const pendingFlipFromRectRef = useRef(null);
  const surfaceAnimationRef = useRef(null);

  const stopPendingSurfaceWork = useCallback(() => {
    window.clearTimeout(expansionTimerRef.current);
    surfaceAnimationRef.current?.cancel();
    surfaceAnimationRef.current = null;
  }, []);

  const finishClearingFocusedWidget = useCallback(() => {
    stopPendingSurfaceWork();
    window.clearTimeout(clearTimerRef.current);
    originalWidgetRectRef.current = null;
    pendingFlipFromRectRef.current = null;
    setExpandedWidgetId(null);
    setFocusedWidgetId(null);
    setFocusedWidgetSurfaceStyle(null);
    setWidgetFocusTransforms({});
  }, [stopPendingSurfaceWork]);

  const clearFocusedWidget = useCallback(() => {
    stopPendingSurfaceWork();
    const originalRect = originalWidgetRectRef.current;
    const surface = surfaceElementFromId(focusedWidgetId);
    if (!focusedWidgetId || !focusedWidgetSurfaceStyle || !originalRect || !surface) {
      finishClearingFocusedWidget();
      return;
    }
    const settledTransforms = Object.fromEntries(
      Object.keys(widgetFocusTransforms).map(widgetId => [widgetId, SETTLED_FOCUS_TRANSFORM]));
    const expandedRect = surface.getBoundingClientRect();
    setWidgetFocusTransforms(settledTransforms);
    pendingFlipFromRectRef.current = { fromRect: expandedRect, widgetId: focusedWidgetId };
    setFocusedWidgetSurfaceStyle(widgetSurfaceStyleFromRect(originalRect));
    clearTimerRef.current = window.setTimeout(finishClearingFocusedWidget, FOCUS_RESIZE_TRANSITION_MS);
  }, [finishClearingFocusedWidget, focusedWidgetId, focusedWidgetSurfaceStyle, stopPendingSurfaceWork,
    widgetFocusTransforms]);

  // After destination geometry commits, invert+animate before paint to avoid a full-size flash.
  useLayoutEffect(() => {
    const pendingFlip = pendingFlipFromRectRef.current;
    if (!pendingFlip?.fromRect || !focusedWidgetId || !focusedWidgetSurfaceStyle) return;
    if (pendingFlip.widgetId !== focusedWidgetId) return;
    pendingFlipFromRectRef.current = null;
    surfaceAnimationRef.current?.cancel();
    surfaceAnimationRef.current = animateSurfaceFromRect(pendingFlip.fromRect, surfaceElementFromId(focusedWidgetId));
  }, [focusedWidgetId, focusedWidgetSurfaceStyle]);

  useEffect(() => {
    const onWidgetFocusRequest = (event) => {
      if (focusState !== DASHBOARD_FOCUS.DEFAULT || draggingWidgetId) return;
      if (!isDesktopDashboardFocusClient()) return;
      const requestedWidgetId = event?.detail?.widgetId;
      if (!requestedWidgetId) return;
      if (requestedWidgetId === focusedWidgetId) {
        clearFocusedWidget();
        return;
      }
      const nextTransforms = widgetExitTransformsFromId(requestedWidgetId);
      if (!surfaceElementFromId(requestedWidgetId) || !nextTransforms) return;
      setWidgetFocusTransforms(nextTransforms);
      setFocusedWidgetId(requestedWidgetId);
      // Measure after neighbors exit so growth starts from the post-exit rectangle.
      expansionTimerRef.current = window.setTimeout(() => {
        const grid = document.querySelector('.dashboard-grid');
        const surface = surfaceElementFromId(requestedWidgetId);
        if (!grid || !surface) return;
        const originalRect = surface.getBoundingClientRect();
        originalWidgetRectRef.current = originalRect;
        const targetRect = focusedSurfaceTargetRect(grid.getBoundingClientRect(), originalRect, requestedWidgetId);
        pendingFlipFromRectRef.current = { fromRect: originalRect, widgetId: requestedWidgetId };
        setExpandedWidgetId(requestedWidgetId);
        setFocusedWidgetSurfaceStyle(widgetSurfaceStyleFromRect(targetRect));
      }, FOCUS_EXPANSION_DELAY_MS);
    };
    window.addEventListener(DASHBOARD_WIDGET_FOCUS_EVENT, onWidgetFocusRequest);
    return () => window.removeEventListener(DASHBOARD_WIDGET_FOCUS_EVENT, onWidgetFocusRequest);
  }, [clearFocusedWidget, draggingWidgetId, focusedWidgetId, focusState]);

  useEffect(() => () => {
    stopPendingSurfaceWork();
    window.clearTimeout(clearTimerRef.current);
  }, [stopPendingSurfaceWork]);

  useEffect(() => {
    if (!focusedWidgetId) return;
    if (draggingWidgetId || focusState !== DASHBOARD_FOCUS.DEFAULT || !isDesktopDashboardFocusClient()) {
      finishClearingFocusedWidget();
    }
  }, [draggingWidgetId, finishClearingFocusedWidget, focusedWidgetId, focusState]);

  useEffect(() => {
    if (!focusedWidgetId) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') clearFocusedWidget();
    };
    const onResize = () => finishClearingFocusedWidget();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [clearFocusedWidget, finishClearingFocusedWidget, focusedWidgetId]);

  return {
    clearFocusedWidget,
    expandedWidgetId,
    focusedWidgetId,
    focusedWidgetSurfaceStyle,
    isWidgetFocusMode: Boolean(focusedWidgetId && focusState === DASHBOARD_FOCUS.DEFAULT && !draggingWidgetId),
    widgetFocusTransforms,
  };
}
