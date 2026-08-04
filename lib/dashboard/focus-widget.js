/**
 * [GPT-5.4-authored file]
 * Prompt summary: "move the desktop widget-focus behavior out of dashboard.js into a standalone utility"
 */
import { useCallback, useEffect, useRef, useState } from "react";

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

// ------------------------------------------------------------------------------------------
// @description Returns the multiplier required to move a point past a viewport edge on one axis.
// @param {number} distance - Signed distance from viewport center to the current rect center
// @param {number} requiredDistance - Distance needed to place the rect beyond the visible edge
// @returns {number} Scalar multiplier relative to the current distance vector
function axisScaleFromDistance(distance, requiredDistance) {
  return Math.abs(distance) < 1 ? 0 : requiredDistance / Math.abs(distance);
}

// ------------------------------------------------------------------------------------------
// @description Clears widget-focus state when the dashboard exits its normal interactive mode.
// @param {boolean} draggingWidgetId - Whether a widget drag is in progress
// @param {string} focusState - Current dashboard popup/focus mode identifier
// @param {string|null} focusedWidgetId - Widget currently centered in focus mode
// @returns {boolean} Whether focus mode should be cancelled
function focusModeShouldClear(draggingWidgetId, focusState, focusedWidgetId) {
  if (!focusedWidgetId) return false;
  return Boolean(draggingWidgetId || focusState !== DASHBOARD_FOCUS.DEFAULT || !isDesktopDashboardFocusClient());
}

// ------------------------------------------------------------------------------------------
// @description Converts a measured transform snapshot into CSS custom properties for a grid cell.
// @param {Object|null} widgetFocusTransform - Per-cell focus animation values
// @returns {Object|undefined} Inline style object or undefined when no focus transform applies
// [OpenAI gpt-5.4] Task: feed per-widget focus transforms into CSS variables
// Prompt: "when the user clicks on the icon for a particular component, animate the others out and center it"
function gridCellFocusStyle(widgetFocusTransform) {
  if (!widgetFocusTransform) return undefined;
  return {
    '--focus-blur': widgetFocusTransform.blur,
    '--focus-opacity': `${widgetFocusTransform.opacity}`,
    '--focus-scale-x': `${widgetFocusTransform.scaleX}`,
    '--focus-scale-y': `${widgetFocusTransform.scaleY}`,
    '--focus-x': widgetFocusTransform.x,
    '--focus-y': widgetFocusTransform.y,
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
    x: `${deltaX * (scale - 1)}px`,
    y: `${deltaY * (scale - 1)}px`,
  };
}

// ------------------------------------------------------------------------------------------
// @description Returns an identity transform for a widget settling into its natural grid position.
// @returns {Object} CSS-ready focus transform descriptor
function settledFocusTransform() {
  return { blur: '0px', opacity: 1, scaleX: 1, scaleY: 1, x: '0px', y: '0px' };
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
    if (currentWidgetId !== widgetId) {
      transforms[currentWidgetId] = offscreenFocusTransformFromRect(rect, viewportCenter);
    } else {
      transforms[currentWidgetId] = settledFocusTransform();
    }
  });
  return transforms;
}

// ------------------------------------------------------------------------------------------
// @description Returns focus-mode class/style fragments for a given dashboard widget cell.
// @param {string|null} focusedWidgetId - Widget currently centered in focus mode
// @param {Object|null} widgetFocusTransform - Measured transform values for the cell
// @param {string} widgetId - Widget id for the cell being rendered
// @returns {{ classNames: string[], style: Object|undefined }} Focus-related props fragment
// [OpenAI gpt-5.4] Task: centralize focus-mode grid cell props outside dashboard.js
// Prompt: "locate its logic in 1-2 exported functions that call various local functions in a standalone utility file"
export function gridCellFocusProps(focusedWidgetId, widgetFocusTransform, widgetId) {
  return {
    classNames: [
      focusedWidgetId ? 'grid-cell--focus-mode' : '',
      focusedWidgetId && focusedWidgetId === widgetId ? 'grid-cell--focused' : '',
      focusedWidgetId && focusedWidgetId !== widgetId ? 'grid-cell--focus-hidden' : '',
    ].filter(Boolean),
    style: gridCellFocusStyle(widgetFocusTransform),
  };
}

// ------------------------------------------------------------------------------------------
// @description Returns whether the registry permits a widget to use the desktop 4-by-2 focus size.
// @param {string} widgetId - Widget id to inspect
// @returns {boolean} Whether the expanded focus size is allowed
function widgetAllowsExpandedFocus(widgetId) {
  const registryEntry = WIDGET_REGISTRY.find(widget => widget.widgetId === widgetId);
  if (!registryEntry) return false;
  const horizontalSizeAllowed = registryEntry.maxHorizontalTiles == null || registryEntry.maxHorizontalTiles >= DESKTOP_FOCUS_WIDTH_SIZE;
  const verticalSizeAllowed = registryEntry.maxVerticalTiles == null || registryEntry.maxVerticalTiles >= DESKTOP_FOCUS_HEIGHT_SIZE;
  return horizontalSizeAllowed && verticalSizeAllowed;
}

// ------------------------------------------------------------------------------------------
// @description Converts a viewport rectangle into fixed-position style values.
// @param {Object} rect - Target viewport bounds
// @returns {Object} React style values for the focused widget surface
// [OpenAI GPT-5.6 Sol] Task: use one viewport coordinate system for focus entry and exit
function widgetSurfaceStyleFromRect(rect) {
  return {
    height: `${rect.height}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
  };
}

// ------------------------------------------------------------------------------------------
// @description Finds the detachable surface wrapping one widget's rendered content.
// @param {string} widgetId - Widget id whose surface should be located
// @returns {HTMLElement|null} The surface element, or null when the dashboard is not rendered
// [OpenAI GPT-5.6 Sol] Task: measure and animate the focused surface directly
function surfaceElementFromId(widgetId) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`.dashboard-grid .grid-cell[data-widget-id="${ widgetId }"] .grid-cell-surface`);
}

// ------------------------------------------------------------------------------------------
// @description Animates a surface from an explicitly measured rectangle to the geometry it already
//   holds. Keyframing the start rather than relying on a CSS transition means the browser never has
//   to infer where the surface came from, which is what previously threw widgets offscreen when the
//   surface changed from a grid item into a viewport-positioned element in the same frame.
// @param {HTMLElement|null} surface - Surface element carrying the widget's rendered content
// @param {Object} fromRect - Viewport rectangle the animation should start from
// @returns {Animation|null} The running animation, or null when the runtime cannot animate
// [OpenAI GPT-5.6 Sol] Task: give the focus animation a measured, deterministic starting rectangle
function animateSurfaceFromRect(surface, fromRect) {
  if (typeof surface?.animate !== 'function') return null;
  const fromKeyframe = widgetSurfaceStyleFromRect(fromRect);
  return surface.animate([fromKeyframe, {}], { duration: FOCUS_RESIZE_TRANSITION_MS, easing: FOCUS_RESIZE_EASING });
}

// ------------------------------------------------------------------------------------------
// @description Calculates the centered overlay rectangle for a focused widget.
// @param {DOMRect} gridRect - Dashboard grid viewport bounds
// @param {DOMRect} originalRect - Widget bounds before focus
// @param {string} widgetId - Focused widget id
// @returns {Object} Target viewport rectangle
function focusedSurfaceTargetRect(gridRect, originalRect, widgetId) {
  const expandsForFocus = widgetAllowsExpandedFocus(widgetId);
  const width = expandsForFocus ? gridRect.width : originalRect.width;
  const height = expandsForFocus ? DESKTOP_FOCUS_MIN_HEIGHT_PX : originalRect.height;
  return {
    height,
    left: gridRect.left,
    top: window.innerHeight * FOCUS_VIEWPORT_TOP_RATIO,
    width,
  };
}

// ------------------------------------------------------------------------------------------
// @description Returns a transient 4-by-2 configuration for a focused widget when its registry
//   limits permit that size, without changing or persisting the widget's usual configuration.
// @param {Object} config - Persisted dashboard widget configuration
// @param {string|null} expandedWidgetId - Widget currently expanded in focus mode
// @returns {Object} Original configuration or a focus-sized copy
// [OpenAI GPT-5.6 Sol] Task: separate focus selection from delayed expansion
export function widgetConfigForFocus(config, expandedWidgetId) {
  if (!config?.widgetId || config.widgetId !== expandedWidgetId) return config;
  if (!widgetAllowsExpandedFocus(expandedWidgetId)) return config;
  return { ...config, gridHeightSize: DESKTOP_FOCUS_HEIGHT_SIZE, gridWidthSize: DESKTOP_FOCUS_WIDTH_SIZE };
}

// ------------------------------------------------------------------------------------------
// @description Manages desktop-only widget-focus mode for the dashboard grid, including
//   responding to icon-click events, measuring widget positions, and clearing focus when
//   the dashboard changes mode, resizes, or the user presses Escape.
// @param {boolean} draggingWidgetId - Whether a widget drag is currently active
// @param {string} focusState - Current dashboard popup/focus mode identifier
// @returns {Object} Focus-mode state and controls used by DashboardApp
// [OpenAI gpt-5.4] Task: move desktop widget-focus behavior behind a reusable hook
// Prompt: "locate its logic in 1-2 exported functions that call various local functions in a standalone utility file"
export function useDashboardWidgetFocus(draggingWidgetId, focusState) {
  const [expandedWidgetId, setExpandedWidgetId] = useState(null);
  const [focusedWidgetId, setFocusedWidgetId] = useState(null);
  const [focusedWidgetSurfaceStyle, setFocusedWidgetSurfaceStyle] = useState(null);
  const [widgetFocusTransforms, setWidgetFocusTransforms] = useState({});
  const animationFrameRef = useRef(null);
  const clearTimerRef = useRef(null);
  const expansionTimerRef = useRef(null);
  const originalWidgetRectRef = useRef(null);
  const surfaceAnimationRef = useRef(null);

  const stopPendingSurfaceWork = useCallback(() => {
    window.cancelAnimationFrame(animationFrameRef.current);
    window.clearTimeout(expansionTimerRef.current);
    surfaceAnimationRef.current?.cancel();
    surfaceAnimationRef.current = null;
  }, []);

  const finishClearingFocusedWidget = useCallback(() => {
    stopPendingSurfaceWork();
    window.clearTimeout(clearTimerRef.current);
    originalWidgetRectRef.current = null;
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
    const settledTransforms = Object.fromEntries(Object.keys(widgetFocusTransforms).map(widgetId => [widgetId, settledFocusTransform()]));
    const expandedRect = surface.getBoundingClientRect();
    setWidgetFocusTransforms(settledTransforms);
    setFocusedWidgetSurfaceStyle(widgetSurfaceStyleFromRect(originalRect));
    animationFrameRef.current = window.requestAnimationFrame(() => {
      surfaceAnimationRef.current = animateSurfaceFromRect(surfaceElementFromId(focusedWidgetId), expandedRect);
    });
    clearTimerRef.current = window.setTimeout(finishClearingFocusedWidget, FOCUS_RESIZE_TRANSITION_MS);
  }, [finishClearingFocusedWidget, focusedWidgetId, focusedWidgetSurfaceStyle, stopPendingSurfaceWork,
    widgetFocusTransforms]);

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
      // The surface is measured here rather than at click time so the rectangle reflects where the
      // widget actually sits once its neighbours have animated away, which is the rectangle the
      // growth animation has to start from.
      expansionTimerRef.current = window.setTimeout(() => {
        const grid = document.querySelector('.dashboard-grid');
        const surface = surfaceElementFromId(requestedWidgetId);
        if (!grid || !surface) return;
        const originalRect = surface.getBoundingClientRect();
        originalWidgetRectRef.current = originalRect;
        const targetRect = focusedSurfaceTargetRect(grid.getBoundingClientRect(), originalRect, requestedWidgetId);
        setExpandedWidgetId(requestedWidgetId);
        setFocusedWidgetSurfaceStyle(widgetSurfaceStyleFromRect(targetRect));
        animationFrameRef.current = window.requestAnimationFrame(() => {
          surfaceAnimationRef.current = animateSurfaceFromRect(surfaceElementFromId(requestedWidgetId), originalRect);
        });
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
    if (focusModeShouldClear(draggingWidgetId, focusState, focusedWidgetId)) finishClearingFocusedWidget();
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
