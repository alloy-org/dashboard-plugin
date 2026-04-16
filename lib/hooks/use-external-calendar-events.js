// =============================================================================
// [Claude-authored file]
// Created: 2026-04-15 | Model: claude-sonnet-4-6
// Task: Hook to fetch and refresh external calendar events on load and refocus
// Prompt summary: "call app.getExternalCalendarEvents on mount and on every new refocus"
// =============================================================================
import { useState, useEffect } from "react";
import { logIfEnabled } from "util/log.js";

// --------------------------------------------------------------------------
async function fetchEvents(app, setCalendarEvents) {
  try {
    const result = await app.getExternalCalendarEvents({ days: 3, taskDomainUUID });
    logIfEnabled("Received calendar events", result);
    setCalendarEvents(Array.isArray(result) ? result : []);
  } catch {
    setCalendarEvents([]);
  }
}

// --------------------------------------------------------------------------
// [Claude] Task: fetch external calendar events on load and re-fetch on window refocus
// Prompt: "call app.getExternalCalendarEvents({ days: 1, taskDomainUUID }) on load and every new refocus"
// Date: 2026-04-15 | Model: claude-sonnet-4-6
export default function useExternalCalendarEvents(app, taskDomainUUID) {
  const [calendarEvents, setCalendarEvents] = useState(null);

  useEffect(() => {
    fetchEvents(app, setCalendarEvents)

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        fetchEvents(app, setCalendarEvents);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [ app, taskDomainUUID ]);

  return { calendarEvents };
}
