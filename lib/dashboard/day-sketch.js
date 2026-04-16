/**
 * [Claude-authored file]
 * Created: 2026-03-16 | Model: claude-4.6-opus-high-thinking
 * Task: DaySketch widget — notebook-paper day planner with hour-by-hour text inputs
 * Prompt summary: "create a DaySketch component that lays out a table with one row per hour,
 *   notebook-paper background, persisted to a Day Sketch note with dashboard tags"
 */
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { DASHBOARD_NOTE_TAG, widgetTitleFromId } from "constants/settings";
import { dateFromDateInput, dateKeyFromDateInput, formatHourLabel } from "util/date-utility";
import WidgetWrapper from "widget-wrapper";
import { logIfEnabled } from "util/log";
import { stripMarkdown } from "util/utility";

import "styles/day-sketch.scss";

const WIDGET_ID = "day-sketch";
const HOUR_START = 6;
const HOUR_END = 21;
const SAVE_DEBOUNCE_MS = 10_000;
const BLUR_SAVE_DELAY_MS = 300;

// [Claude] Task: build the ordered list of hours for DaySketch rows (6am–9pm)
// Prompt: "the day should have a line for every hour between 6am and 9pm"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

// ------------------------------------------------------------------------------------------
// @description Formats a Date as a long human-readable string for the note title
//   (e.g. "Monday, March 16, 2026")
// @param {Date} date - The date to format
// @returns {string} Locale-formatted date string with weekday, month, day, and year
function formatDateForNoteName(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ------------------------------------------------------------------------------------------
// @description Builds the full note name for a given day's sketch
// @param {Date} date - The date whose sketch note name to generate
// @returns {string} Note name like "Day Sketch Monday, March 16, 2026"
function noteNameForDate(date) {
  return `Day Sketch ${formatDateForNoteName(date)}`;
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: parse note content lines in "9am: some text" format back into entries map
// Prompt: "upon loading DaySketch, look for the existence of a Day Sketch note and pre-load content"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
// @description Parses the body of a Day Sketch note into a map of {hour → text}.
//   Each line is expected in the format "9am: some text".
// @param {string|null} content - Raw note body text
// @returns {Object<number, string>} Entries keyed by 24-hour integer
function parseNoteContent(content) {
  const entries = {};
  if (!content) return entries;
  for (const line of content.split("\n")) {
    const match = line.match(/^(\d{1,2}(?:am|pm)):\s*(.*)/i);
    if (!match) continue;
    const label = match[1].toLowerCase();
    const text = match[2].replace(/\\+$/, "").trim();
    const hour = hourFromLabel(label);
    if (hour !== null && HOURS.includes(hour)) {
      entries[hour] = text;
    }
  }
  return entries;
}

// ------------------------------------------------------------------------------------------
// @description Converts a 12-hour label string (e.g. "9am", "1pm") to a 24-hour integer
// @param {string} label - Hour label like "9am" or "12pm"
// @returns {number|null} Hour in 0–23 range, or null if the label is malformed
function hourFromLabel(label) {
  const m = label.match(/^(\d{1,2})(am|pm)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const period = m[2].toLowerCase();
  if (period === "am" && h === 12) h = 0;
  else if (period === "pm" && h !== 12) h += 12;
  return h;
}

// ------------------------------------------------------------------------------------------
// @description Serializes the entries map into note body text, one line per hour
// @param {Object<number, string>} entries - Map of hour → user-entered text
// @returns {string} Note body with lines like "9am: standup meeting"
function buildNoteBody(entries) {
  return HOURS.map(hour => {
    const label = formatHourLabel(hour);
    const text = entries[hour] || "";
    return `${label}: ${text}`;
  }).join("\n");
}

// ------------------------------------------------------------------------------------------
// @description Creates a fresh entries map with an empty string for every hour
// @returns {Object<number, string>} Entries keyed by 24-hour integer, all empty
function emptyEntries() {
  const e = {};
  HOURS.forEach(h => { e[h] = ""; });
  return e;
}

// ------------------------------------------------------------------------------------------
// @description Normalizes a Unix-seconds or milliseconds timestamp to milliseconds.
//   Treats values under 1e10 as seconds.
// @param {number|Date|null|undefined} timestamp - Timestamp to normalize
// @returns {number|null} Milliseconds since epoch, or null
function toMillis(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === "number") return timestamp < 1e10 ? timestamp * 1000 : timestamp;
  return null;
}

// ------------------------------------------------------------------------------------------
// [Claude] Task: map scheduled task duration to DaySketch hour rows
// Prompt: "when a scheduled task spans multiple hours, show it in multiple rows"
// Date: 2026-03-18 | Model: gpt-5.3-codex
// @description Returns all DaySketch row hours a scheduled task should populate.
//   We always include the start hour, then add additional rows for each *full* hour
//   in the task duration (e.g. 10:16am–1:18pm populates 10am, 11am, 12pm).
// @param {Object} task - Agenda task with startAt/endAt timestamps
// @returns {number[]} 24-hour integers for candidate DaySketch rows
function hoursToPrefillForTask(task) {
  const startMs = toMillis(task?.startAt);
  if (!startMs) return [];
  const startHour = new Date(startMs).getHours();
  const hours = [startHour];
  const endMs = toMillis(task?.endAt);
  if (!endMs || endMs <= startMs) return hours;
  const fullHoursInDuration = Math.floor((endMs - startMs) / (60 * 60 * 1000));
  for (let offset = 1; offset < fullHoursInDuration; offset += 1) {
    hours.push(startHour + offset);
  }
  return hours;
}

// ------------------------------------------------------------------------------------------
// [Claude claude-sonnet-4-6] Task: normalize agenda task text for prefilling DaySketch rows
// Prompt: "remove any markdown formatting from task text when prefilling DaySketch rows"
// @description Strips all inline markdown formatting (bold, italic, highlight, links,
//   footnotes, etc.) from task content and returns the first line as plain text.
// @param {Object} task - Agenda task
// @returns {string} Plaintext row value
function prefillTextFromTask(task) {
  const firstLine = (task?.content || "").split("\n")[0];
  return stripMarkdown(firstLine);
}

// ------------------------------------------------------------------------------------------
// @description Determines whether current entries differ from last saved snapshot
// @param {Object<number, string>} entries - Current in-memory rows
// @param {Object<number, string>|null} savedSnapshot - Last persisted rows
// @returns {boolean} True when entries have unsaved changes
function entriesAreDirty(entries, savedSnapshot) {
  return savedSnapshot !== null && JSON.stringify(entries) !== JSON.stringify(savedSnapshot);
}

// ------------------------------------------------------------------------------------------
// @description Fills blank rows in a entries object from agenda task timings/text.
// @param {Object<number, string>} entries - Existing hour-row values
// @param {Object[]} tasks - Agenda tasks for the current day
// @returns {Object<number, string>} New entries object with empty rows prefilled
function entriesPrefilledFromTasks(entries, tasks) {
  const nextEntries = { ...entries };
  tasks.forEach(task => {
    const taskText = prefillTextFromTask(task);
    if (!taskText) return;
    hoursToPrefillForTask(task).forEach(hour => {
      if (HOURS.includes(hour) && !nextEntries[hour]) {
        nextEntries[hour] = taskText;
      }
    });
  });
  return nextEntries;
}

// ------------------------------------------------------------------------------------------
// @description Loads DaySketch entries for a note and handles debounced persistence.
// @param {Object} params
// @param {Object} params.app - Amplenote app interface
// @param {string} params.noteName - Day Sketch note name for current date
// @returns {Object} State + handlers for entries lifecycle and saving
// [Claude] Task: extract DaySketch persistence lifecycle into a dedicated hook
// Prompt: "move as much logic as possible out of component body into hooks/local functions"
// Date: 2026-04-09 | Model: gpt-5.3-codex
function useDaySketchEntries({ app, noteName }) {
  const [entries, setEntries] = useState(emptyEntries);
  const [loading, setLoading] = useState(true);
  const [noteUUID, setNoteUUID] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const debounceRef = useRef(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const persistEntries = useCallback(async (entriesToSave) => {
    if (!app) return;
    const body = buildNoteBody(entriesToSave);
    try {
      let uuid = noteUUID;
      if (!uuid) {
        const existing = await app.findNote({ name: noteName });
        uuid = existing?.uuid || await app.createNote(noteName, [DASHBOARD_NOTE_TAG]);
        setNoteUUID(uuid);
      }
      await app.replaceNoteContent({ uuid }, body);
      setSavedSnapshot({ ...entriesToSave });
      logIfEnabled(`[DaySketch] persisted ${noteName}`);
    } catch (err) {
      logIfEnabled("[DaySketch] save failed", err);
    }
  }, [app, noteName, noteUUID]);

  const scheduleSave = useCallback((delayMs = SAVE_DEBOUNCE_MS) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistEntries(entriesRef.current);
    }, delayMs);
  }, [persistEntries]);

  const saveNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    persistEntries(entriesRef.current);
  }, [persistEntries]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const existing = await app.findNote({ name: noteName });
        if (cancelled) return;
        if (existing?.uuid) {
          setNoteUUID(existing.uuid);
          const content = await app.getNoteContent({ uuid: existing.uuid });
          if (cancelled) return;
          const mergedEntries = { ...emptyEntries(), ...parseNoteContent(content) };
          setEntries(mergedEntries);
          setSavedSnapshot(mergedEntries);
        } else {
          const empty = emptyEntries();
          setEntries(empty);
          setSavedSnapshot(empty);
        }
      } catch (err) {
        logIfEnabled("[DaySketch] load failed", err);
        if (!cancelled) {
          const empty = emptyEntries();
          setEntries(empty);
          setSavedSnapshot(empty);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [app, noteName]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return { entries, isDirty: entriesAreDirty(entries, savedSnapshot), loading, saveNow, scheduleSave, setEntries };
}

// ------------------------------------------------------------------------------------------
// @description Prefills blank DaySketch rows from agenda tasks for the current date.
// @param {Object} params
// @param {Object} params.agendaTasks - Tasks grouped by date key
// @param {string|Date} params.currentDate - Current selected date
// @param {boolean} params.loading - Whether base note load is still in progress
// @param {Function} params.setEntries - State setter for hour-row entries
// @returns {void}
// [Claude] Task: extract agenda prefill effect into focused hook
// Prompt: "move as much logic as possible out of component body into hooks/local functions"
// Date: 2026-04-09 | Model: gpt-5.3-codex
function useDaySketchAgendaPrefill({ agendaTasks, currentDate, loading, setEntries }) {
  useEffect(() => {
    if (!agendaTasks || !currentDate || loading) return;
    const todayKey = dateKeyFromDateInput(currentDate);
    const todayTasks = agendaTasks[todayKey] || [];
    if (todayTasks.length === 0) return;
    setEntries(prevEntries => {
      const nextEntries = entriesPrefilledFromTasks(prevEntries, todayTasks);
      return JSON.stringify(nextEntries) === JSON.stringify(prevEntries) ? prevEntries : nextEntries;
    });
  }, [agendaTasks, currentDate, loading, setEntries]);
}

// ------------------------------------------------------------------------------------------
// @description Tracks input refs and handles ArrowUp/ArrowDown row navigation.
// @returns {Object} Ref writer + keydown handler for hourly DaySketch inputs
// [Claude] Task: isolate DaySketch keyboard navigation behavior
// Prompt: "move as much logic as possible out of component body into hooks/local functions"
// Date: 2026-04-09 | Model: gpt-5.3-codex
function useDaySketchInputNavigation() {
  const inputRefs = useRef({});

  const setInputRef = useCallback((hour, element) => {
    if (element) inputRefs.current[hour] = element;
    else delete inputRefs.current[hour];
  }, []);

  // [Claude claude-sonnet-4-6] Task: Shift+Arrow selects all text on current line instead of navigating rows
  // Prompt: "if the user presses up or down while holding shift, highlight all text on the current line
  //   with cursor at beginning (up) or end (down) instead of moving to the next line"
  const handleInputKeyDown = useCallback((hour, event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (event.shiftKey) {
      const input = event.currentTarget;
      const len = input.value.length;
      // Shift+Up: cursor at start, selection extends to end (backward direction)
      // Shift+Down: cursor at end, selection extends from start (forward direction)
      if (event.key === "ArrowUp") {
        input.setSelectionRange(0, len, "backward");
      } else {
        input.setSelectionRange(0, len, "forward");
      }
      return;
    }
    const currentIndex = HOURS.indexOf(hour);
    if (currentIndex === -1) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const targetHour = HOURS[currentIndex + direction];
    if (!targetHour) return;
    const sourceInput = event.currentTarget;
    const targetInput = inputRefs.current[targetHour];
    if (!targetInput) return;
    const sourceSelectionStart = sourceInput.selectionStart;
    const sourceSelectionEnd = sourceInput.selectionEnd;
    const targetLength = targetInput.value.length;
    const nextSelectionStart = sourceSelectionStart === null ? targetLength :
      Math.min(sourceSelectionStart, targetLength);
    const nextSelectionEnd = sourceSelectionEnd === null ? nextSelectionStart :
      Math.min(sourceSelectionEnd, targetLength);
    targetInput.focus();
    targetInput.setSelectionRange(nextSelectionStart, nextSelectionEnd);
  }, []);

  return { handleInputKeyDown, setInputRef };
}

// ------------------------------------------------------------------------------------------
// @description Renders a single notebook row with hour label and editable input.
// @param {Object} params
// @param {Function} params.h - React.createElement alias
// @param {number} params.hour - Hour key for this row
// @param {Object<number, string>} params.entries - Current hour values
// @param {Function} params.handleBlur - Blur handler for save scheduling
// @param {Function} params.handleInputChange - Change handler by hour
// @param {Function} params.handleInputKeyDown - Keydown handler by hour
// @param {Function} params.setInputRef - Ref writer by hour
// @returns {React.ReactElement} Row markup
function renderHourLine({ entries, h, handleBlur, handleInputChange, handleInputKeyDown, hour, setInputRef, timeFormat }) {
  return h("div", { key: hour, className: "day-sketch-line" },
    h("span", { className: "day-sketch-hour-label" }, formatHourLabel(hour, timeFormat)),
    h("input", {
      type: "text",
      className: "day-sketch-input",
      value: entries[hour] || "",
      ref: (element) => setInputRef(hour, element),
      onChange: (event) => handleInputChange(hour, event.target.value),
      onKeyDown: (event) => handleInputKeyDown(hour, event),
      onBlur: handleBlur,
      placeholder: "",
      "aria-label": `${ formatHourLabel(hour, timeFormat) } entry`,
    })
  );
}

// ------------------------------------------------------------------------------------------
// [Claude claude-sonnet-4-6] Task: format a calendar event start time for display in DaySketch
// Prompt: "Update day-sketch.js to utilize calendarEvents array of objects with start as Date"
// @description Formats a Date object as a locale time string for calendar event display.
// @param {Date} date - Event start time
// @param {string} [timeFormat] - "24h" or "12h"
// @returns {string} Formatted time string
function formatCalendarEventTime(date, timeFormat) {
  if (!(date instanceof Date)) return "";
  const options = timeFormat === "24h"
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { hour: "numeric", minute: "2-digit" };
  return date.toLocaleTimeString([], options);
}

// ------------------------------------------------------------------------------------------
// [Claude claude-sonnet-4-6] Task: render Today's Calendar panel in DaySketch from calendarEvents prop
// Prompt: "Update day-sketch.js to utilize calendarEvents array of objects with allDay, calendar, color, end, start, title"
// @description Renders a "Today's Calendar" panel listing each calendar event with its time
//   (or "All day" indicator), title, and calendar name. Returns null when the array is
//   empty or absent.
// @param {Object} params
// @param {Array} params.calendarEvents - Array of calendar event objects
// @param {Function} params.h - React.createElement alias
// @param {string} [params.timeFormat] - "24h" or "12h"
// @returns {React.ReactElement|null} Panel element or null
function renderCalendarEventsPanel({ calendarEvents, h, timeFormat }) {
  if (!Array.isArray(calendarEvents) || calendarEvents.length === 0) return null;
  return h("div", { className: "day-sketch-calendar-events" },
    h("h4", { className: "day-sketch-calendar-heading" }, "Today's Calendar"),
    calendarEvents.map((event, i) =>
      h("div", { key: `cal-${i}`, className: "day-sketch-calendar-event" },
        h("span", { className: "day-sketch-calendar-time" },
          event.allDay
            ? "All day"
            : event.start instanceof Date
              ? formatCalendarEventTime(event.start, timeFormat)
              : ""
        ),
        h("span", { className: "day-sketch-calendar-title" }, event.title || "Calendar event"),
        event.calendar?.name
          ? h("span", { className: "day-sketch-calendar-name" }, event.calendar.name)
          : null
      )
    )
  );
}

// ------------------------------------------------------------------------------------------
// @description Builds the DaySketch save button based on dirty state.
// @param {Function} h - React.createElement alias
// @param {boolean} isDirty - Whether entries differ from last save
// @param {Function} onSaveClick - Save click callback
// @returns {React.ReactElement} Save button element
function saveButtonFromState(h, isDirty, onSaveClick) {
  return h("button", {
    className: `day-sketch-save-btn${isDirty ? "" : " day-sketch-save-btn--disabled"}`,
    disabled: !isDirty,
    onClick: onSaveClick,
    title: isDirty ? "Save changes" : "No unsaved changes",
  }, isDirty ? "Save" : "Saved");
}

// ------------------------------------------------------------------------------------------
// @description Root DaySketch widget component. Renders a notebook-paper-style planner with
//   one text input per hour (6am–9pm). Loads/creates a "Day Sketch [date]" note for
//   persistence and pre-fills empty hours from agenda tasks.
// @param {Object} props
// @param {Object} props.app - Amplenote app interface (findNote, createNote, replaceNoteContent, etc.)
// @param {Object} props.agendaTasks - Tasks grouped by date key (YYYY-MM-DD), each with startAt timestamps
// @param {string|Date} props.currentDate - The current date used to derive the note name
// @returns {React.ReactElement} The rendered DaySketch widget
// [Claude] Task: refactor DaySketch component to delegate logic to hooks and local helpers
// Prompt: "move as much functionality as possible into standalone hooks or local functions"
// Date: 2026-04-09 | Model: gpt-5.3-codex
export default function DaySketchWidget({ agendaTasks, app, calendarEvents, currentDate, timeFormat }) {
  const h = createElement;
  const today = dateFromDateInput(currentDate);
  const noteName = noteNameForDate(today);
  const { handleInputKeyDown, setInputRef } = useDaySketchInputNavigation();
  const { entries, isDirty, loading, saveNow, scheduleSave, setEntries } = useDaySketchEntries({ app, noteName });

  useDaySketchAgendaPrefill({ agendaTasks, currentDate, loading, setEntries });

  const handleBlur = useCallback(() => {
    scheduleSave(BLUR_SAVE_DELAY_MS);
  }, [scheduleSave]);

  const handleInputChange = useCallback((hour, value) => {
    setEntries(prevEntries => ({ ...prevEntries, [hour]: value }));
    scheduleSave();
  }, [scheduleSave, setEntries]);

  return h(WidgetWrapper, {
    title: widgetTitleFromId(WIDGET_ID),
    subtitle: formatDateForNoteName(today),
    icon: "\uD83D\uDDD2\uFE0F",
    widgetId: WIDGET_ID,
    headerActions: saveButtonFromState(h, isDirty, saveNow),
  },
    h("div", { className: "day-sketch-notebook" },
      loading
        ? h("div", { className: "day-sketch-loading" }, "Loading\u2026")
        : HOURS.map(hour => renderHourLine({
            entries, h, handleBlur, handleInputChange, handleInputKeyDown, hour, setInputRef, timeFormat,
          }))
    ),
    renderCalendarEventsPanel({ calendarEvents, h, timeFormat })
  );
}
