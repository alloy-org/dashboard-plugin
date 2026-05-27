/**
 * [Claude-authored file]
 * Created: 2026-03-16 | Model: claude-4.6-opus-high-thinking
 * Task: DaySketch widget — notebook-paper day planner with hour-by-hour text inputs
 * Prompt summary: "create a DaySketch component that lays out a table with one row per hour,
 *   notebook-paper background, persisted to a Day Sketch note with dashboard tags"
 */
import { useCallback, useEffect, useRef, useState } from "react";
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

const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

function formatDateForNoteName(date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function noteNameForDate(date) {
  return `Day Sketch ${formatDateForNoteName(date)}`;
}

function parseNoteContent(content) {
  const entries = {};
  const humanEditedHours = new Set();
  if (!content) return { entries, humanEditedHours };
  for (const line of content.split("\n")) {
    const humanEditedMatch = line.match(/^human-edited:\s*([\d,\s]*)/i);
    if (humanEditedMatch) {
      humanEditedMatch[1].split(",").forEach(h => {
        const n = parseInt(h.trim(), 10);
        if (!isNaN(n)) humanEditedHours.add(n);
      });
      continue;
    }
    const match = line.match(/^(\d{1,2}(?:am|pm)):\s*(.*)/i);
    if (!match) continue;
    const label = match[1].toLowerCase();
    const text = match[2].replace(/\\+$/, "").trim();
    const hour = hourFromLabel(label);
    if (hour !== null && HOURS.includes(hour)) {
      entries[hour] = text;
    }
  }
  return { entries, humanEditedHours };
}

function hourFromLabel(label) {
  const m = label.match(/^(\d{1,2})(am|pm)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const period = m[2].toLowerCase();
  if (period === "am" && h === 12) h = 0;
  else if (period === "pm" && h !== 12) h += 12;
  return h;
}

function buildNoteBody(entries, humanEditedHours) {
  const lines = HOURS.map(hour => {
    const label = formatHourLabel(hour);
    const text = entries[hour] || "";
    return `${label}: ${text}`;
  });
  if (humanEditedHours.size > 0) {
    const sorted = [...humanEditedHours].sort((a, b) => a - b);
    lines.push(`human-edited: ${sorted.join(",")}`);
  }
  return lines.join("\n");
}

function emptyEntries() {
  const e = {};
  HOURS.forEach(h => { e[h] = ""; });
  return e;
}

function toMillis(timestamp) {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp.getTime();
  if (typeof timestamp === "number") return timestamp < 1e10 ? timestamp * 1000 : timestamp;
  return null;
}

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

function hoursFromCalendarEvent(event) {
  if (!event?.start || !(event.start instanceof Date) || event.allDay) return [];
  const startHour = event.start.getHours();
  if (!event.end || !(event.end instanceof Date) || event.end <= event.start) return [startHour];
  const endHour = event.end.getHours() + (event.end.getMinutes() > 0 ? 1 : 0);
  const hours = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);
  return hours.length > 0 ? hours : [startHour];
}

function prefillTextFromTask(task) {
  const firstLine = (task?.content || "").split("\n")[0];
  return stripMarkdown(firstLine);
}

function entriesAreDirty(entries, savedSnapshot) {
  return savedSnapshot !== null && JSON.stringify(entries) !== JSON.stringify(savedSnapshot);
}

function entriesPrefilledFromTasks(entries, tasks, humanEditedHours) {
  const nextEntries = { ...entries };
  tasks.forEach(task => {
    const taskText = prefillTextFromTask(task);
    if (!taskText) return;
    hoursToPrefillForTask(task).forEach(hour => {
      if (HOURS.includes(hour) && !nextEntries[hour] && !humanEditedHours.has(hour)) {
        nextEntries[hour] = taskText;
      }
    });
  });
  return nextEntries;
}

function entriesPrefilledFromCalendarEvents(entries, calendarEvents, currentDate, humanEditedHours) {
  if (!Array.isArray(calendarEvents) || calendarEvents.length === 0) return entries;
  const todayKey = dateKeyFromDateInput(currentDate);
  const nextEntries = { ...entries };
  calendarEvents.forEach(event => {
    if (!event?.title || event.allDay) return;
    if (!(event.start instanceof Date) || dateKeyFromDateInput(event.start) !== todayKey) return;
    hoursFromCalendarEvent(event).forEach(hour => {
      if (HOURS.includes(hour) && !nextEntries[hour] && !humanEditedHours.has(hour)) nextEntries[hour] = event.title;
    });
  });
  return nextEntries;
}

function useDaySketchEntries({ app, noteName }) {
  const [entries, setEntries] = useState(emptyEntries);
  const [humanEditedHours, setHumanEditedHours] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [noteUUID, setNoteUUID] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const debounceRef = useRef(null);
  const entriesRef = useRef(entries);
  const humanEditedHoursRef = useRef(humanEditedHours);
  entriesRef.current = entries;
  humanEditedHoursRef.current = humanEditedHours;

  const persistEntries = useCallback(async (entriesToSave, hoursToSave) => {
    if (!app) return;
    const body = buildNoteBody(entriesToSave, hoursToSave);
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
      persistEntries(entriesRef.current, humanEditedHoursRef.current);
    }, delayMs);
  }, [persistEntries]);

  const saveNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    persistEntries(entriesRef.current, humanEditedHoursRef.current);
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
          const { entries: parsedEntries, humanEditedHours: parsedHumanEditedHours } = parseNoteContent(content);
          const restoredEntries = emptyEntries();
          parsedHumanEditedHours.forEach(hour => {
            if (parsedEntries[hour] !== undefined) restoredEntries[hour] = parsedEntries[hour];
          });
          setEntries(restoredEntries);
          setHumanEditedHours(parsedHumanEditedHours);
          setSavedSnapshot({ ...restoredEntries });
        } else {
          const empty = emptyEntries();
          setEntries(empty);
          setHumanEditedHours(new Set());
          setSavedSnapshot(empty);
        }
      } catch (err) {
        logIfEnabled("[DaySketch] load failed", err);
        if (!cancelled) {
          const empty = emptyEntries();
          setEntries(empty);
          setHumanEditedHours(new Set());
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

  return { entries, humanEditedHours, isDirty: entriesAreDirty(entries, savedSnapshot), loading, saveNow, scheduleSave, setEntries, setHumanEditedHours };
}

function useDaySketchAgendaPrefill({ agendaTasks, currentDate, humanEditedHours, loading, setEntries }) {
  useEffect(() => {
    if (!agendaTasks || !currentDate || loading) return;
    const todayKey = dateKeyFromDateInput(currentDate);
    const todayTasks = agendaTasks[todayKey] || [];
    if (todayTasks.length === 0) return;
    setEntries(prevEntries => {
      const nextEntries = entriesPrefilledFromTasks(prevEntries, todayTasks, humanEditedHours);
      return JSON.stringify(nextEntries) === JSON.stringify(prevEntries) ? prevEntries : nextEntries;
    });
  }, [agendaTasks, currentDate, humanEditedHours, loading, setEntries]);
}

function useDaySketchCalendarPrefill({ calendarEvents, currentDate, humanEditedHours, loading, setEntries }) {
  useEffect(() => {
    if (!calendarEvents || !currentDate || loading) return;
    setEntries(prevEntries => {
      const nextEntries = entriesPrefilledFromCalendarEvents(prevEntries, calendarEvents, currentDate, humanEditedHours);
      return JSON.stringify(nextEntries) === JSON.stringify(prevEntries) ? prevEntries : nextEntries;
    });
  }, [calendarEvents, currentDate, humanEditedHours, loading, setEntries]);
}

function scrollTopFromHourLine(notebookElement, hour) {
  if (!notebookElement) return 0;
  const targetLine = notebookElement.querySelector(`[data-hour="${ hour }"]`);
  if (!targetLine) return 0;
  return Math.max(0, targetLine.offsetTop - (notebookElement.clientHeight - targetLine.clientHeight) / 2);
}

function useDaySketchCurrentHourScroll({ currentDate, loading, notebookRef }) {
  const pendingDateKeyRef = useRef(null);
  const scrolledDateKeyRef = useRef(null);

  useEffect(() => {
    const currentDateKey = dateKeyFromDateInput(currentDate);
    if (!currentDateKey) return;
    if (loading) {
      pendingDateKeyRef.current = currentDateKey;
      return;
    }
    if (pendingDateKeyRef.current !== currentDateKey || scrolledDateKeyRef.current === currentDateKey) return;
    const timeoutId = setTimeout(() => {
      const notebookElement = notebookRef.current;
      if (!notebookElement) return;
      const scrollHour = Math.min(HOUR_END, Math.max(HOUR_START, new Date().getHours()));
      notebookElement.scrollTop = scrollTopFromHourLine(notebookElement, scrollHour);
      pendingDateKeyRef.current = null;
      scrolledDateKeyRef.current = currentDateKey;
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [currentDate, loading, notebookRef]);
}

function useDaySketchInputNavigation() {
  const inputRefs = useRef({});

  const setInputRef = useCallback((hour, element) => {
    if (element) inputRefs.current[hour] = element;
    else delete inputRefs.current[hour];
  }, []);

  const handleInputKeyDown = useCallback((hour, event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (event.shiftKey) {
      const input = event.currentTarget;
      const len = input.value.length;
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

// [Claude claude-4.7-opus] Task: convert hour-line render fn to JSX component
// Prompt: "translate this project to render components with JSX instead"
function HourLine({ entries, handleBlur, handleInputChange, handleInputKeyDown, hour, setInputRef, timeFormat }) {
  return (
    <div className="day-sketch-line" data-hour={hour}>
      <span className="day-sketch-hour-label">{formatHourLabel(hour, timeFormat)}</span>
      <input
        type="text"
        className="day-sketch-input"
        value={entries[hour] || ""}
        ref={(element) => setInputRef(hour, element)}
        onChange={(event) => handleInputChange(hour, event.target.value)}
        onKeyDown={(event) => handleInputKeyDown(hour, event)}
        onBlur={handleBlur}
        placeholder=""
        aria-label={`${ formatHourLabel(hour, timeFormat) } entry`}
      />
    </div>
  );
}

function SaveButton({ isDirty, onSaveClick }) {
  return (
    <button
      className={`day-sketch-save-btn${isDirty ? "" : " day-sketch-save-btn--disabled"}`}
      disabled={!isDirty}
      onClick={onSaveClick}
      title={isDirty ? "Save changes" : "No unsaved changes"}
    >{isDirty ? "Save" : "Saved"}</button>
  );
}

// [Claude claude-sonnet-4-6] Task: track human-edited vs auto-populated lines in DaySketch
// [Claude claude-4.7-opus] Task: migrate DaySketchWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function DaySketchWidget({ agendaTasks, app, calendarEvents, currentDate, timeFormat }) {
  const notebookRef = useRef(null);
  const today = dateFromDateInput(currentDate);
  const noteName = noteNameForDate(today);
  const { handleInputKeyDown, setInputRef } = useDaySketchInputNavigation();
  const { entries, humanEditedHours, isDirty, loading, saveNow, scheduleSave, setEntries, setHumanEditedHours } = useDaySketchEntries({ app, noteName });

  useDaySketchAgendaPrefill({ agendaTasks, currentDate, humanEditedHours, loading, setEntries });
  useDaySketchCalendarPrefill({ calendarEvents, currentDate, humanEditedHours, loading, setEntries });
  useDaySketchCurrentHourScroll({ currentDate, loading, notebookRef });

  const handleBlur = useCallback(() => {
    scheduleSave(BLUR_SAVE_DELAY_MS);
  }, [scheduleSave]);

  const handleInputChange = useCallback((hour, value) => {
    setEntries(prevEntries => ({ ...prevEntries, [hour]: value }));
    setHumanEditedHours(prev => new Set([...prev, hour]));
    scheduleSave();
  }, [scheduleSave, setEntries, setHumanEditedHours]);

  return (
    <WidgetWrapper
      title={widgetTitleFromId(WIDGET_ID)}
      subtitle={formatDateForNoteName(today)}
      icon="🗒️"
      widgetId={WIDGET_ID}
      headerActions={<SaveButton isDirty={isDirty} onSaveClick={saveNow} />}
    >
      <div className="day-sketch-notebook" ref={notebookRef}>
        {loading ? (
          <div className="day-sketch-loading">Loading…</div>
        ) : (
          HOURS.map(hour => (
            <HourLine
              key={hour}
              entries={entries}
              handleBlur={handleBlur}
              handleInputChange={handleInputChange}
              handleInputKeyDown={handleInputKeyDown}
              hour={hour}
              setInputRef={setInputRef}
              timeFormat={timeFormat}
            />
          ))
        )}
      </div>
    </WidgetWrapper>
  );
}
