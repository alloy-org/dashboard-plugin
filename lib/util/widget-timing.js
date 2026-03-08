/**
 * [Claude-authored file]
 * Created: 2026-03-08 | Model: claude-4.6-opus-high-thinking
 * Task: React hook for widget load timing — split from util/log to keep plugin bundle React-free
 * Prompt summary: "move useWidgetLoadTiming to its own file so compiled.js does not require react"
 */
import { useEffect, useRef } from "react";
import { logIfEnabled } from "util/log";

// [Claude] Task: DRY hook for widget load timing — logs "loading..." on first render, "finished loading in Xms" after paint
// Prompt: "DRY the identical timing boilerplate repeated in every memoized widget cell"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
export function useWidgetLoadTiming(widgetId) {
  const renderStart = useRef(null);
  if (renderStart.current === null) {
    renderStart.current = performance.now();
    logIfEnabled(`[dashboard] Widget "${widgetId}" loading...`);
  }
  useEffect(() => {
    if (renderStart.current !== null) {
      logIfEnabled(`[dashboard] Widget "${widgetId}" finished loading in ${(performance.now() - renderStart.current).toFixed(1)}ms`);
      renderStart.current = null;
    }
  }, []);
}
