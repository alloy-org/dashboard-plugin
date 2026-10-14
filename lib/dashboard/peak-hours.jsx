/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Peak Hours widget — hourly distribution chart of task creation and completion
 * Prompt summary: "rewrite peak-hours as a project-native widget consuming completed tasks from dashboard"
 */
import PeakHoursChart from "dashboard/charts/peak-hours-chart";
import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import { dateFromDateInput, dateFromMonthKey, formatHourLabel, monthKeyFromDateInput,
  monthStartFromDateInput } from "util/date-utility";
import { MdChevronLeft, MdChevronRight } from "react-icons/md";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";
import "styles/peak-hours.scss";

const WIDGET_ID = 'peak-hours';

// ---------------------------------------------------------------------------
function hourLabelsFromFormat(timeFormat) {
  return Array.from({ length: 24 }, (_, i) => formatHourLabel(i, timeFormat));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// [Claude] Task: convert unix-seconds timestamp (or Date/string) to a local Date for hour extraction
// Prompt: "receive completed tasks and translate createdAt and completedAt to the user's local time zone"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function toLocalDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === 'number') return new Date(ts < 1e12 ? ts * 1000 : ts);
  return new Date(ts);
}

// [Claude] Task: compute month start/end unix seconds from a reference date for full-month fetching
// Prompt: "peak-hours should retrieve ALL tasks completed during the currently selected month"
// Date: 2026-03-15 | Model: claude-4.6-opus-high-thinking
function monthBoundaries(dateInput) {
  const d = dateFromDateInput(dateInput);
  const year = d.getFullYear();
  const month = d.getMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 1, 0, 0, 0, 0);
  return {
    from: Math.floor(start.getTime() / 1000),
    to: Math.floor(end.getTime() / 1000),
    monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
  };
}

// [Claude] Task: aggregate task victoryValue by hour-of-day for both creation and completion timestamps
// Prompt: "analysis as to the completed tasks' date of createdAt and completedAt, translated to user's local time zone"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function buildHourlyData(tasks) {
  const created = new Array(24).fill(0);
  const completed = new Array(24).fill(0);
  let count = 0;

  for (const t of tasks) {
    const value = t.victoryValue || 1;

    const createdDate = toLocalDate(t.createdAt || t.startAt);
    if (createdDate && !isNaN(createdDate)) {
      created[createdDate.getHours()] += value;
      count++;
    }

    const completedDate = toLocalDate(t.completedAt);
    if (completedDate && !isNaN(completedDate)) {
      completed[completedDate.getHours()] += value;
    }
  }

  const peakC = created.indexOf(Math.max(...created));
  const peakD = completed.indexOf(Math.max(...completed));

  return {
    completedByHour: completed,
    createdByHour: created,
    peakCompleteHourIndex: peakD,
    peakCreateHourIndex: peakC,
    totalTasks: count,
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

// [Claude claude-4.7-opus] Task: drop createElement `h` parameter; render JSX directly
// Prompt: "translate this project to render components with JSX instead"
function MetricCard({ label, value }) {
  return (
    <div className="peak-hours-metric-card">
      <div className="peak-hours-metric-label">{label}</div>
      <div className="peak-hours-metric-value">{value}</div>
    </div>
  );
}

function LegendItem({ modifierClass, label }) {
  return (
    <span className="peak-hours-legend-item">
      <span className={`peak-hours-legend-swatch ${modifierClass}`} />
      {label}
    </span>
  );
}

// [Claude claude-opus-4-8 (1M context)] Task: month label flanked by prev/next arrows for month-to-month navigation
// Prompt: "month label to have a left arrow and right arrow on each side of it ... the right caret is disabled since
//   the user can't move forward from the present"
// Date: 2026-07-19 | Model: claude-opus-4-8 (1M context)
// @param {string} label - Display label for the currently viewed month (e.g. "July 2026").
// @param {boolean} forwardDisabled - When true, the forward arrow is disabled (viewing the present month).
// @param {function} onNavigate - Called with -1 (previous) or +1 (next) when an arrow is clicked.
// @returns {JSX.Element} The month navigator control.
function MonthNavigator({ label, forwardDisabled, onNavigate }) {
  return (
    <span className="peak-hours-month-nav">
      <button
        type="button"
        className="peak-hours-month-nav-arrow"
        aria-label="Previous month"
        onClick={() => onNavigate(-1)}
      >
        <MdChevronLeft />
      </button>
      <span className="peak-hours-month-nav-label">{label}</span>
      <button
        type="button"
        className="peak-hours-month-nav-arrow"
        aria-label="Next month"
        disabled={forwardDisabled}
        onClick={() => onNavigate(1)}
      >
        <MdChevronRight />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// [Claude] Task: Peak Hours widget that fetches ALL completed tasks for the selected month
// Prompt: "peak-hours should retrieve ALL tasks completed during the currently selected month"
// Date: 2026-03-15 | Model: claude-4.6-opus-high-thinking
// [Claude claude-4.6-opus-high-thinking] Task: accept timeFormat prop for hour label display
// Prompt: "components that render times should utilize timeFormat prop"
// [Claude claude-4.7-opus] Task: migrate PeakHoursWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
// ------------------------------------------------------------------------------------------
// @desc Display hourly task activity, repainting the chart when host theme colors change.
// @param {object} props - App bridge, dates, and time formatting preference.
// @returns {JSX.Element} Hourly activity widget.
export default function PeakHoursWidget({ app, currentDate, selectedDate, timeFormat }) {
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const fetchedMonthRef = useRef(null);

  const referenceDate = selectedDate || currentDate;
  const referenceMonthKey = referenceDate ? monthKeyFromDateInput(referenceDate) : null;
  const currentMonthKey = currentDate ? monthKeyFromDateInput(currentDate) : null;

  // [Claude claude-opus-4-8 (1M context)] Task: track the viewed month as a stable `YYYY-MM` key, seeded from referenceDate
  // Prompt: "clicking an arrow navigates from month to month, loading tasks for the month the user has selected"
  // Date: 2026-07-19 | Model: claude-opus-4-8 (1M context)
  // A primitive key (not a Date object) keeps this state referentially stable across renders so the fetch
  // effect below fires exactly once per month rather than on every re-render.
  const [viewMonthKey, setViewMonthKey] = useState(referenceMonthKey);

  // [Claude claude-opus-4-8 (1M context)] Task: reset navigation to the dashboard's month when its month changes
  // Prompt: "clicking an arrow navigates from month to month, loading tasks for the month the user has selected"
  // Date: 2026-07-19 | Model: claude-opus-4-8 (1M context)
  useEffect(() => {
    if (referenceMonthKey) setViewMonthKey(referenceMonthKey);
  }, [referenceMonthKey]);

  const viewMonthDate = useMemo(() => (viewMonthKey ? dateFromMonthKey(viewMonthKey) : null), [viewMonthKey]);

  // [Claude claude-opus-4-8 (1M context)] Task: forward navigation is disabled once viewing the present (current) month
  // Prompt: "the right caret is disabled since the user can't move forward from the present"
  // Date: 2026-07-19 | Model: claude-opus-4-8 (1M context)
  const forwardDisabled = !viewMonthKey || !currentMonthKey || viewMonthKey >= currentMonthKey;

  // [Claude claude-opus-4-8 (1M context)] Task: step the viewed month backward or forward, clamped to the present
  // Prompt: "clicking an arrow navigates from month to month, loading tasks for the month the user has selected"
  // Date: 2026-07-19 | Model: claude-opus-4-8 (1M context)
  const navigateMonth = useCallback((offset) => {
    setViewMonthKey(prev => {
      const base = prev || referenceMonthKey;
      if (!base) return prev;
      const next = monthKeyFromDateInput(monthStartFromDateInput(dateFromMonthKey(base), offset));
      if (offset > 0 && currentMonthKey && next > currentMonthKey) return prev;
      return next;
    });
  }, [referenceMonthKey, currentMonthKey]);

  // [Claude] Task: fetch all completed tasks for the full month when month changes
  // Prompt: "peak-hours should retrieve ALL tasks completed during the currently selected month"
  // Date: 2026-03-15 | Model: claude-4.6-opus-high-thinking
  // [Claude claude-opus-4-8 (1M context)] Task: fetch against the navigated viewMonthDate rather than referenceDate
  // Prompt: "loading tasks for the month the user has selected"
  useEffect(() => {
    if (!viewMonthDate || !app) return;
    const { from, to, monthKey } = monthBoundaries(viewMonthDate);
    if (fetchedMonthRef.current === monthKey) return;
    fetchedMonthRef.current = monthKey;
    let cancelled = false;
    setError(null);
    setLoading(true);

    app.getCompletedTasks(from, to).then(result => {
      if (!cancelled) setTasks(Array.isArray(result) ? result : []);
    }).catch(err => {
      logIfEnabled('[peak-hours] failed to fetch month tasks', err);
      if (!cancelled) {
        setError(err);
        setTasks([]);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [app, viewMonthDate]);

  const hourLabels = hourLabelsFromFormat(timeFormat);
  const { completedByHour, createdByHour, peakCompleteHourIndex, peakCreateHourIndex, totalTasks } =
    useMemo(() => buildHourlyData(tasks), [tasks]);
  const peakCreateHour = hourLabels[peakCreateHourIndex];
  const peakCompleteHour = hourLabels[peakCompleteHourIndex];

  const monthSubtitle = useMemo(() => {
    if (!viewMonthDate) return null;
    return dateFromDateInput(viewMonthDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }, [viewMonthDate]);

  useWidgetLoadedEvent(WIDGET_ID, !loading && !error, !!error);

  const monthNavigator = (
    <MonthNavigator label={monthSubtitle} forwardDisabled={forwardDisabled} onNavigate={navigateMonth} />
  );

  if (loading) {
    return (
      <WidgetWrapper subtitle={monthNavigator} widgetId={WIDGET_ID}>
        <div className="peak-hours-empty">
          <p>Loading monthly task history…</p>
        </div>
      </WidgetWrapper>
    );
  }

  if (totalTasks === 0) {
    return (
      <WidgetWrapper subtitle={monthNavigator} widgetId={WIDGET_ID}>
        <div className="peak-hours-empty">
          <p>No completed task data available yet.</p>
        </div>
      </WidgetWrapper>
    );
  }

  return (
    <WidgetWrapper subtitle={monthNavigator} widgetId={WIDGET_ID}>
      <div className="peak-hours-metrics-grid">
        <MetricCard label="Tasks analyzed" value={totalTasks} />
        <MetricCard label="Peak create hour" value={peakCreateHour} />
        <MetricCard label="Peak complete hour" value={peakCompleteHour} />
      </div>
      <div className="peak-hours-legend">
        <LegendItem modifierClass="peak-hours-legend-swatch--created" label="Created value" />
        <LegendItem modifierClass="peak-hours-legend-swatch--completed" label="Completed value" />
      </div>
      <PeakHoursChart completedByHour={completedByHour} createdByHour={createdByHour} hourLabels={hourLabels} />
    </WidgetWrapper>
  );
}
