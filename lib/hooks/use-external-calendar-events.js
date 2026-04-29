// =============================================================================
// [Claude-authored file]
// Created: 2026-04-15 | Model: claude-sonnet-4-6
// Task: Hook to fetch and refresh external calendar events on load and refocus
// Prompt summary: "call app.getExternalCalendarEvents on mount and on every new refocus"
// =============================================================================
import { useState, useEffect } from "react";
import { logIfEnabled } from "util/log.js";

// --------------------------------------------------------------------------
// @description Parses date-like calendar event values returned by Amplenote.
// @param {Date|number|string|null|undefined} value - Raw event timestamp value
// @returns {Date|null} Parsed Date, or null when absent/invalid
export function calendarEventDateFromValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value !== "number" && typeof value !== "string") return null;
  const date = typeof value === "number" && value < 1e10 ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// --------------------------------------------------------------------------
// @description Normalizes raw external calendar events so consumers always get Date values.
// @param {Array<object>} events - Raw external calendar events from the app API
// @returns {Array<object>} Events with start/end converted to Date instances when parseable
export function normalizeExternalCalendarEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter(event => event && typeof event === "object").map(event => ({
    ...event,
    end: calendarEventDateFromValue(event.end),
    start: calendarEventDateFromValue(event.start),
  }));
}

// --------------------------------------------------------------------------
// [Claude claude-4.6-opus] Task: use .then() chain so the fetch never blocks render
// Prompt: "modify fetchEvents so that the dashboard doesn't pause its render to await calendar events"
function fetchEvents(app, taskDomainUUID, setCalendarEvents) {
  app.getExternalCalendarEvents({ days: 3, taskDomainUUID }).then(result => {
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
