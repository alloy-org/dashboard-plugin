/**
 * [Claude-authored file]
 * Created: 2026-03-16 | Model: claude-4.6-opus-high-thinking
 * Task: DaySketch widget — notebook-paper day planner with hour-by-hour text inputs
 * Prompt summary: "create a DaySketch component that lays out a table with one row per hour,
 *   notebook-paper background, persisted to a Day Sketch note with dashboard tags"
 */
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { DASHBOARD_NOTE_TAG, widgetTitleFromId } from "constants/settings";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";
import WidgetWrapper from "widget-wrapper";
import { logIfEnabled } from "util/log";
import "styles/day-sketch.scss";

const WIDGET_ID = "day-sketch";
const HOUR_START = 6;
const HOUR_END = 21;
const SAVE_DEBOUNCE_MS = 10_000;

// [Claude] Task: build the ordered list of hours for DaySketch rows (6am–9pm)
// Prompt: "the day should have a line for every hour between 6am and 9pm"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

// ------------------------------------------------------------------------------------------
// @description Formats a 24-hour integer as a 12-hour label (e.g. 9 → "9am", 13 → "1pm")
// @param {number} hour - Hour of day in 0–23 range
// @returns {string} Human-readable hour label
function formatHourLabel(hour) {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

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
// [Claude] Task: DaySketch widget — renders notebook-paper hour grid with persistence
// Prompt: "create a DaySketch component with notebook paper background, persisted to note"
// Date: 2026-03-16 | Model: claude-4.6-opus-high-thinking
// @description Root DaySketch widget component. Renders a notebook-paper-style planner with
//   one text input per hour (6am–9pm). Loads/creates a "Day Sketch [date]" note for
//   persistence and pre-fills empty hours from agenda tasks.
// @param {Object} props
// @param {Object} props.app - Amplenote app interface (findNote, createNote, replaceNoteContent, etc.)
// @param {Object} props.agendaTasks - Tasks grouped by date key (YYYY-MM-DD), each with startAt timestamps
// @param {string|Date} props.currentDate - The current date used to derive the note name
// @returns {React.ReactElement} The rendered DaySketch widget
export default function DaySketchWidget({ app, agendaTasks, currentDate }) {
  const h = createElement;
  const [entries, setEntries] = useState(emptyEntries);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [noteUUID, setNoteUUID] = useState(null);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const today = dateFromDateInput(currentDate);
  const noteName = noteNameForDate(today);

  const isDirty = savedSnapshot !== null &&
    JSON.stringify(entries) !== JSON.stringify(savedSnapshot);

  const persistNote = useCallback(async (entriesToSave) => {
    if (!app) return;
    const body = buildNoteBody(entriesToSave);
    try {
      let uuid = noteUUID;
      if (!uuid) {
        const existing = await app.findNote({ name: noteName });
        if (existing?.uuid) {
          uuid = existing.uuid;
        } else {
          uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG]);
        }
        setNoteUUID(uuid);
      }
      await app.replaceNoteContent({ uuid }, body);
      setSavedSnapshot({ ...entriesToSave });
      logIfEnabled(`[DaySketch] persisted ${noteName}`);
    } catch (err) {
      logIfEnabled("[DaySketch] save failed", err);
    }
  }, [app, noteName, noteUUID]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistNote(entriesRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, [persistNote]);

  const handleInputChange = useCallback((hour, value) => {
    setEntries(prev => ({ ...prev, [hour]: value }));
    scheduleSave();
  }, [scheduleSave]);

  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      persistNote(entriesRef.current);
    }, 300);
  }, [persistNote]);

  const handleSaveClick = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    persistNote(entriesRef.current);
  }, [persistNote]);

  // Load existing note on mount / date change
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
          const parsed = parseNoteContent(content);
          const merged = { ...emptyEntries(), ...parsed };
          setEntries(merged);
          setSavedSnapshot(merged);
        } else {
          setEntries(emptyEntries());
          setSavedSnapshot(emptyEntries());
        }
      } catch (err) {
        logIfEnabled("[DaySketch] load failed", err);
        if (!cancelled) {
          setEntries(emptyEntries());
          setSavedSnapshot(emptyEntries());
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [app, noteName]);

  // Pre-fill empty hours from agenda tasks
  useEffect(() => {
    if (!agendaTasks || !currentDate || loading) return;
    const todayKey = dateKeyFromDateInput(currentDate);
    const todayTasks = agendaTasks[todayKey] || [];
    if (todayTasks.length === 0) return;
    setEntries(prev => {
      const next = { ...prev };
      let changed = false;
      todayTasks.forEach(task => {
        const ms = toMillis(task.startAt);
        if (!ms) return;
        const hour = new Date(ms).getHours();
        if (HOURS.includes(hour) && !next[hour]) {
          next[hour] = (task.content || "")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/\[\^[^\]]*\]/g, "")
            .split("\n")[0]
            .trim();
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [agendaTasks, currentDate, loading]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const saveButton = h("button", {
    className: `day-sketch-save-btn${isDirty ? "" : " day-sketch-save-btn--disabled"}`,
    disabled: !isDirty,
    onClick: handleSaveClick,
    title: isDirty ? "Save changes" : "No unsaved changes",
  }, isDirty ? "Save" : "Saved");

  return h(WidgetWrapper, {
    title: widgetTitleFromId(WIDGET_ID),
    subtitle: formatDateForNoteName(today),
    icon: "\uD83D\uDDD2\uFE0F",
    widgetId: WIDGET_ID,
    headerActions: saveButton,
  },
    h("div", { className: "day-sketch-notebook" },
      loading
        ? h("div", { className: "day-sketch-loading" }, "Loading\u2026")
        : HOURS.map(hour =>
            h("div", { key: hour, className: "day-sketch-line" },
              h("span", { className: "day-sketch-hour-label" }, formatHourLabel(hour)),
              h("input", {
                type: "text",
                className: "day-sketch-input",
                value: entries[hour] || "",
                onChange: (e) => handleInputChange(hour, e.target.value),
                onBlur: handleBlur,
                placeholder: "",
                "aria-label": `${formatHourLabel(hour)} entry`,
              })
            )
          )
    )
  );
}
