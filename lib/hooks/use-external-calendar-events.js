// =============================================================================
// [Claude-authored file]
// Created: 2026-04-15 | Model: claude-sonnet-4-6
// Task: Hook to fetch and refresh external calendar events on load and refocus
// Prompt summary: "call app.getExternalCalendarEvents on mount and on every new refocus"
// =============================================================================
import { useState, useEffect } from "react";

// [Claude] Task: fetch external calendar events on load and re-fetch on window refocus
// Prompt: "call app.getExternalCalendarEvents({ days: 1, taskDomainUUID }) on load and every new refocus"
// Date: 2026-04-15 | Model: claude-sonnet-4-6
export default function useExternalCalendarEvents(app, taskDomainUUID) {
  const [calendarEvents, setCalendarEvents] = useState(null);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const result = await app.getExternalCalendarEvents({ days: 1, taskDomainUUID });
        setCalendarEvents(Array.isArray(result) ? result : []);
      } catch {
        setCalendarEvents([]);
      }
    }

    fetchEvents();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        fetchEvents();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [app, taskDomainUUID]);

  return { calendarEvents };
}
