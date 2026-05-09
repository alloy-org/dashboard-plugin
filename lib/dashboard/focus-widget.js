/**
 * [GPT-5.4-authored file]
 * Prompt summary: "move the desktop widget-focus behavior out of dashboard.js into a standalone utility"
 */
import { useCallback, useEffect, useState } from "react";

import { DASHBOARD_FOCUS } from "constants/settings";
import { DASHBOARD_WIDGET_FOCUS_EVENT, isDesktopDashboardFocusClient } from "draggable-heading";

const FOCUS_CENTER_SCALE = 1.02;
const FOCUS_HIDE_SCALE = 0.9;
const FOCUS_OFFSCREEN_MARGIN_PX = 96;

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
    '--focus-scale': `${widgetFocusTransform.scale}`,
    '--focus-x': widgetFocusTransform.x,
    '--focus-y': widgetFocusTransform.y,
  };
}

// ------------------------------------------------------------------------------------------
// @description Computes the transform that moves a clicked widget cell to viewport center.
// @param {DOMRect} rect - Current grid-cell bounding rect
// @param {Object} viewportCenter - Viewport center point with x/y numbers
// @returns {Object} Transform descriptor with CSS-ready strings and scalar values
function centeredFocusTransformFromRect(rect, viewportCenter) {
  const currentCenterX = rect.left + rect.width / 2;
  const currentCenterY = rect.top + rect.height / 2;
  return {
    blur: '0px',
    opacity: 1,
    scale: FOCUS_CENTER_SCALE,
    x: `${viewportCenter.x - currentCenterX}px`,
    y: `${viewportCenter.y - currentCenterY}px`,
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
  const scale = Math.max(axisScaleFromDistance(deltaX, xDistance), axisScaleFromDistance(deltaY, yDistance), 1.35);
  return {
    blur: '2px',
    opacity: 0,
    scale: FOCUS_HIDE_SCALE,
    x: `${deltaX * (scale - 1)}px`,
    y: `${deltaY * (scale - 1)}px`,
  };
}

// ------------------------------------------------------------------------------------------
// @description Measures all rendered widget cells and returns the transforms needed to center
//   one target cell while pushing the rest beyond the current viewport bounds.
// @param {string} widgetId - Widget id to keep visible in focus mode
// @returns {Object|null} Per-widget transform map keyed by widget id, or null when unavailable
function widgetFocusTransformsFromId(widgetId) {
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
      ? centeredFocusTransformFromRect(rect, viewportCenter)
      : offscreenFocusTransformFromRect(rect, viewportCenter);
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
// @description Manages desktop-only widget-focus mode for the dashboard grid, including
//   responding to icon-click events, measuring widget positions, and clearing focus when
//   the dashboard changes mode, resizes, or the user presses Escape.
// @param {boolean} draggingWidgetId - Whether a widget drag is currently active
// @param {string} focusState - Current dashboard popup/focus mode identifier
// @returns {Object} Focus-mode state and controls used by DashboardApp
// [OpenAI gpt-5.4] Task: move desktop widget-focus behavior behind a reusable hook
// Prompt: "locate its logic in 1-2 exported functions that call various local functions in a standalone utility file"
export function useDashboardWidgetFocus(draggingWidgetId, focusState) {
  const [focusedWidgetId, setFocusedWidgetId] = useState(null);
  const [widgetFocusTransforms, setWidgetFocusTransforms] = useState({});

  const clearFocusedWidget = useCallback(() => {
    setFocusedWidgetId(null);
    setWidgetFocusTransforms({});
  }, []);

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
      const nextTransforms = widgetFocusTransformsFromId(requestedWidgetId);
      if (!nextTransforms) return;
      setWidgetFocusTransforms(nextTransforms);
      setFocusedWidgetId(requestedWidgetId);
    };
    window.addEventListener(DASHBOARD_WIDGET_FOCUS_EVENT, onWidgetFocusRequest);
    return () => window.removeEventListener(DASHBOARD_WIDGET_FOCUS_EVENT, onWidgetFocusRequest);
  }, [clearFocusedWidget, draggingWidgetId, focusedWidgetId, focusState]);

  useEffect(() => {
    if (focusModeShouldClear(draggingWidgetId, focusState, focusedWidgetId)) clearFocusedWidget();
  }, [clearFocusedWidget, draggingWidgetId, focusedWidgetId, focusState]);

  useEffect(() => {
    if (!focusedWidgetId) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') clearFocusedWidget();
    };
    const onResize = () => clearFocusedWidget();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [clearFocusedWidget, focusedWidgetId]);

  return {
    clearFocusedWidget,
    focusedWidgetId,
    isWidgetFocusMode: Boolean(focusedWidgetId && focusState === DASHBOARD_FOCUS.DEFAULT && !draggingWidgetId),
    widgetFocusTransforms,
  };
}
