// =============================================================================
// [Claude-authored file]
// Created: 2026-04-15 | Model: claude-sonnet-4-6
// Task: Hook to fetch and refresh external calendar events on load and refocus
// Prompt summary: "call app.getExternalCalendarEvents on mount and on every new refocus"
// =============================================================================
import { useEffect, useState } from "react";
import { normalizeExternalCalendarEvents } from "util/calendar-utility";
import { logIfEnabled } from "util/log.js";

// --------------------------------------------------------------------------
// [Claude claude-4.6-opus] Task: use .then() chain so the fetch never blocks render
// Prompt: "modify fetchEvents so that the dashboard doesn't pause its render to await calendar events"
function fetchEvents(app, taskDomainUUID, setCalendarEvents) {
  const options = taskDomainUUID ? { days: 3, taskDomainUUID } : { days: 3 };
  app.getExternalCalendarEvents(options).then(result => {
    logIfEnabled("[useExternalCalendarEvents] Received calendar events", result);
    setCalendarEvents(normalizeExternalCalendarEvents(result));
  }).catch(() => {
    setCalendarEvents([]);
  });
}

// --------------------------------------------------------------------------
// [Claude] Task: fetch external calendar events on load and re-fetch on window refocus
// Prompt: "call app.getExternalCalendarEvents({ days: 1, taskDomainUUID }) on load and every new refocus"
// Date: 2026-04-15 | Model: claude-sonnet-4-6
// [Claude claude-4.6-opus] Task: return calendarEventsLoaded so consumers can distinguish loading from empty
// Prompt: "allow calendarEvents to resolve asynchronously before passing to agenda/day-sketch"
export default function useExternalCalendarEvents(app, taskDomainUUID) {
  const [calendarEvents, setCalendarEvents] = useState(null);

  useEffect(() => {
    setCalendarEvents(null);
    fetchEvents(app, taskDomainUUID, setCalendarEvents);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        fetchEvents(app, taskDomainUUID, setCalendarEvents);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [ app, taskDomainUUID ]);

  return { calendarEvents, calendarEventsLoaded: calendarEvents !== null };
}
