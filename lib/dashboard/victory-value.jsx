/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Victory value widget — weekly total and canvas bar chart with mood overlay
 * Prompt summary: "widget with bar chart of daily victory values and optional mood trend line"
 */
import { useEffect, useRef, useState } from "react"
import WidgetWrapper from "./widget-wrapper"
import { widgetTitleFromId, parseWidgetConfig, widgetConfigKey } from "../constants/settings"
import { pluginSettings } from "plugin-data"
import ConfigPopup from "./config-popup"
import { useCanvasTippy } from "./dashboard-tooltip-tippy.jsx"
import { renderMarkdown } from "util/utility"
import "styles/victory-value.scss"
import {
  dateFromDateInput,
  dateKeyFromDateInput,
  tooltipLabelFromDateInput,
  weekDateSlotsFromDateInput,
  weekStartDayFromFormat,
  weekStartFromDateInput,
} from "util/date-utility"

const MOODS = [
  { value: -2, emoji: '\u{1F622}', label: 'Awful' },
  { value: -1, emoji: '\u{1F61F}', label: 'Bad' },
  { value: 0, emoji: '\u{1F610}', label: 'Okay' },
  { value: 1, emoji: '\u{1F642}', label: 'Good' },
  { value: 2, emoji: '\u{1F604}', label: 'Great' }
];

// [Claude] Task: format week date range for display in widget header
function formatWeekDateRange(chartDailyValues) {
  if (!chartDailyValues || chartDailyValues.length < 7) return '';
  const start = dateFromDateInput(chartDailyValues[0].date);
  const end = dateFromDateInput(chartDailyValues[6].date);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)} \u2013 ${fmt(end)}`;
}

// [Claude] Task: shift reference date by N weeks for chart navigation arrows
function shiftWeekDate(referenceDate, deltaWeeks) {
  const date = dateFromDateInput(referenceDate);
  date.setDate(date.getDate() + deltaWeeks * 7);
  return dateKeyFromDateInput(date);
}

// [Claude] Task: determine whether referenceDate is in the current week or later (disables right arrow)
function isCurrentWeekOrLater(referenceDate, weekStartDay) {
  const refWeekStart = weekStartFromDateInput(referenceDate, weekStartDay);
  const todayWeekStart = weekStartFromDateInput(new Date(), weekStartDay);
  return refWeekStart >= todayWeekStart;
}

// [Claude] Task: derive chart values from completed tasks keyed by date
function buildDailyValuesFromCompletedTasks(dailyValues, completedTasksByDate) {
  if (!Array.isArray(dailyValues) || dailyValues.length === 0) return [];
  if (!completedTasksByDate || typeof completedTasksByDate !== 'object') return dailyValues;

  return dailyValues.map((entry) => {
    const dateKey = dateKeyFromDateInput(entry.date);
    const tasksForDay = Array.isArray(completedTasksByDate[dateKey]) ? completedTasksByDate[dateKey] : [];
    const computedValue = tasksForDay.reduce((sum, task) => sum + (task.victoryValue || 0), 0);

    return {
      ...entry,
      value: computedValue,
      taskCount: tasksForDay.length
    };
  });
}

// [Claude] Task: derive chart values for selected week from completed task map
function buildDailyValuesForWeek(referenceDate, dailyValues, completedTasksByDate, weekStartDay) {
  const weekSlots = weekDateSlotsFromDateInput(referenceDate, weekStartDay);
  if (!completedTasksByDate || typeof completedTasksByDate !== 'object') {
    return buildDailyValuesFromCompletedTasks(dailyValues, completedTasksByDate);
  }

  return weekSlots.map((slot) => {
    const tasksForDay = Array.isArray(completedTasksByDate[slot.dateKey]) ? completedTasksByDate[slot.dateKey] : [];
    const computedValue = tasksForDay.reduce((sum, task) => sum + (task.victoryValue || 0), 0);
    return {
      day: slot.day,
      date: slot.date,
      value: computedValue,
      taskCount: tasksForDay.length
    };
  });
}

// [Claude] Task: persist widget config via app.setSetting (real Amplenote API)
async function handleConfigSubmit(app, timeRange, showMood, setConfigOpen) {
  const result = [timeRange, String(showMood)];
  await app.setSetting(widgetConfigKey('victory-value'), JSON.stringify(result));
  setConfigOpen(false);
}

// [Claude] Task: parse showMood boolean setting, defaulting to true when unset
function parseShowMoodSetting(value) {
  if (value === undefined || value === null) return true;
  return value === 'true' || value === true;
}

function handleConfigCancel(currentConfig, setTimeRange, setShowMood, setConfigOpen) {
  setTimeRange(currentConfig[0] || 'week');
  setShowMood(parseShowMoodSetting(currentConfig[1]));
  setConfigOpen(false);
}

function handleCanvasMouseMove(canvasRef, setHoveredBar, e) {
  const canvas = canvasRef.current;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const w = rect.width;
  const barW = (w - 80) / 7;

  for (let i = 0; i < 7; i++) {
    const zoneStart = 40 + i * barW;
    const zoneEnd = zoneStart + barW;
    if (mouseX >= zoneStart && mouseX < zoneEnd) {
      setHoveredBar(i);
      return;
    }
  }

  setHoveredBar(null);
}

function getTooltipLeft(canvasRef, index) {
  const canvas = canvasRef.current;
  if (!canvas) return 0;
  const w = canvas.offsetWidth;
  const barW = (w - 80) / 7;
  return 40 + index * barW + barW * 0.5;
}

function getBarTopScreenY(canvasRef, index, dailyValues, maxValue) {
  const canvas = canvasRef.current;
  if (!canvas) return 0;
  const rect = canvas.getBoundingClientRect();
  const ht = canvas.offsetHeight;
  const chartH = ht - 50;
  const barValue = dailyValues[index]?.value || 0;
  const barH = (barValue / maxValue) * chartH * 0.85;
  return rect.top + chartH - barH + 10;
}

function getHoveredDayTasks(index, dailyValues, completedTasksByDate) {
  if (!completedTasksByDate || !dailyValues[index]) return [];
  const dateKey = dateKeyFromDateInput(dailyValues[index].date);
  return (completedTasksByDate[dateKey] || [])
    .slice()
    .sort((a, b) => (b.victoryValue || 0) - (a.victoryValue || 0));
}

function buildMoodByDay(moodRatings, chartDailyValues) {
  if (!moodRatings || !Array.isArray(moodRatings) || !chartDailyValues) return [];

  const moodByDateKey = {};
  for (const mood of moodRatings) {
    if (!mood || mood.timestamp == null) continue;
    const date = new Date(mood.timestamp * 1000);
    const key = dateKeyFromDateInput(date);
    if (!moodByDateKey[key] || mood.timestamp > moodByDateKey[key].timestamp) {
      moodByDateKey[key] = mood;
    }
  }

  return chartDailyValues.map((dayEntry) => {
    const key = dateKeyFromDateInput(dayEntry.date);
    return moodByDateKey[key] || null;
  });
}

function getHoveredDayMood(index, moodByDay, dailyValues) {
  if (!moodByDay || !moodByDay[index]) return null;
  if (dailyValues && dailyValues[index]) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const date = dateFromDateInput(dailyValues[index].date);
    if (date > today) return null;
  }
  const rating = moodByDay[index].rating;
  return MOODS.find((m) => m.value === rating) || null;
}

function drawBars(ctx, dailyValues, maxValue, barW, chartH, ht) {
  dailyValues.forEach((d, i) => {
    const barH = (d.value / maxValue) * chartH * 0.85;
    const x = 40 + i * barW + barW * 0.15;
    const y = chartH - barH + 10;
    ctx.fillStyle = d.value > 0 ? '#6366f1' : '#e5e7eb';
    ctx.beginPath();
    ctx.roundRect(x, y, barW * 0.7, barH, [4, 4, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#6b7280';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(d.day, x + barW * 0.35, ht - 15);

    const dateObj = dateFromDateInput(d.date);
    const monthDay = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    ctx.fillStyle = '#9ca3af';
    ctx.font = '9px system-ui';
    ctx.fillText(monthDay, x + barW * 0.35, ht - 3);

    if (d.value > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(formatBarPointValue(d.value), x + barW * 0.35, y + 14);
    }
  });
}

function formatBarPointValue(value) {
  return (Math.round((value || 0) * 10) / 10).toFixed(1);
}

function drawMoodOverlay(ctx, moodByDay, chartDailyValues, barW, chartH) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const points = [];
  moodByDay.forEach((m, i) => {
    if (!m || !chartDailyValues[i]) return;
    const date = dateFromDateInput(chartDailyValues[i].date);
    if (date > today) return;
    const y = chartH - ((m.rating + 2) / 4) * chartH + 10;
    const x = 40 + i * barW + barW * 0.5;
    points.push({ index: i, x, y });
  });

  if (points.length === 0) return;

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;

  for (let p = 1; p < points.length; p++) {
    const prev = points[p - 1];
    const curr = points[p];
    ctx.setLineDash(curr.index === prev.index + 1 ? [] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);

  points.forEach(({ x, y }) => {
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawChart(canvasRef, dailyValues, maxValue, moodByDay, showMood) {
  const canvas = canvasRef.current;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * 2;
  const H = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);

  const w = W / 2;
  const ht = H / 2;
  const barW = (w - 80) / 7;
  const chartH = ht - 50;
  ctx.clearRect(0, 0, w, ht);

  drawBars(ctx, dailyValues, maxValue, barW, chartH, ht);

  if (showMood && moodByDay && moodByDay.some(m => m !== null)) {
    drawMoodOverlay(ctx, moodByDay, dailyValues, barW, chartH);
  }
}

// [Claude] Task: build tooltip HTML string for a hovered victory-value bar
function buildTooltipHTML(hoveredBar, dailyValues, completedTasksByDate, moodByDay) {
  const tasks = getHoveredDayTasks(hoveredBar, dailyValues, completedTasksByDate);
  const mood = getHoveredDayMood(hoveredBar, moodByDay, dailyValues);
  const dateLabel = dailyValues[hoveredBar]
    ? tooltipLabelFromDateInput(dailyValues[hoveredBar].date)
    : '';

  const parts = [`<div class="dashboard-tooltip-header">${dateLabel}</div>`];

  if (mood) {
    parts.push(`<div class="dashboard-tooltip-section">${mood.emoji} ${mood.label}</div>`);
  }

  if (tasks.length > 0) {
    for (const task of tasks) {
      parts.push(
        `<div class="dashboard-tooltip-row">` +
        `<span class="dashboard-tooltip-row-label">${renderMarkdown(task.content)}</span>` +
        `<span class="dashboard-tooltip-row-value">${task.victoryValue || 0} pts</span>` +
        `</div>`
      );
    }
  } else {
    parts.push(`<div class="dashboard-tooltip-empty">No completed tasks</div>`);
  }

  return parts.join('');
}

// --------------------------------------------------------------------------------------------------
// [Claude] Task: render configurable time range radio options
// [Claude claude-4.7-opus] Task: convert TimeRangeOptions render fn to JSX component
// Prompt: "translate this project to render components with JSX instead"
function TimeRangeOptions({ timeRange, setTimeRange }) {
  return (
    <>
      {['week', 'month', '30days'].map((value) => (
        <label key={value}>
          <input
            type="radio"
            name="vv-time-range"
            value={value}
            checked={timeRange === value}
            onChange={setTimeRange.bind(null, value)}
          />
          {value === 'week' ? 'This week' : value === 'month' ? 'This month' : 'Last 30 days'}
        </label>
      ))}
    </>
  );
}

// --------------------------------------------------------------------------------------------------
// [Claude] Task: victory-value widget using useCanvasTippy for bar hover tooltips
// [Claude claude-4.6-opus-high-thinking] Task: accept weekFormat prop for week day ordering
// [Claude claude-4.7-opus] Task: migrate VictoryValueWidget from createElement to JSX
// Prompt: "translate this project to render components with JSX instead"
export default function VictoryValueWidget({ app, completedTasksByDate, dailyValues, moodRatings,
    onReferenceDateChange, referenceDate, weekFormat, weeklyTotal }) {
  const canvasRef = useRef(null);
  const weekStartDay = weekStartDayFromFormat(weekFormat);
  const chartDailyValues = buildDailyValuesForWeek(referenceDate, dailyValues, completedTasksByDate, weekStartDay);
  const maxValue = Math.max(...chartDailyValues.map((entry) => entry.value), 1);
  const chartWeeklyTotal = chartDailyValues.reduce((sum, entry) => sum + (entry.value || 0), 0);
  const roundedWeeklyTotal = Math.round(chartWeeklyTotal || weeklyTotal || 0);
  const moodByDay = buildMoodByDay(moodRatings, chartDailyValues);

  const [configOpen, setConfigOpen] = useState(false);
  const [hoveredBar, setHoveredBar] = useState(null);
  const currentConfig = parseWidgetConfig(pluginSettings(), 'victory-value');
  const [timeRange, setTimeRange] = useState(currentConfig[0] || 'week');
  const [showMood, setShowMood] = useState(parseShowMoodSetting(currentConfig[1]));
  const onConfigure = setConfigOpen.bind(null, true);
  const onConfigSubmit = handleConfigSubmit.bind(null, app, timeRange, showMood, setConfigOpen);
  const onConfigCancel = handleConfigCancel.bind(null, currentConfig, setTimeRange, setShowMood, setConfigOpen);
  const weekDateRange = formatWeekDateRange(chartDailyValues);
  const tip = useCanvasTippy({ interactive: true });
  const onCanvasMouseMove = (e) => { tip.cancelScheduledHide(); handleCanvasMouseMove(canvasRef, setHoveredBar, e); };
  const onCanvasMouseLeave = () => tip.scheduleHide(300, () => setHoveredBar(null));

  useEffect(() => {
    drawChart(canvasRef, chartDailyValues, maxValue, moodByDay, showMood);
  }, [chartDailyValues, maxValue, moodByDay, showMood]);

  useEffect(() => {
    if (hoveredBar === null) { tip.hide(); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const left = getTooltipLeft(canvasRef, hoveredBar);
    const screenX = rect.left + left;
    const barTopScreenY = getBarTopScreenY(canvasRef, hoveredBar, chartDailyValues, maxValue);
    const spaceAbove = barTopScreenY;
    const spaceBelow = window.innerHeight - rect.bottom;
    const html = buildTooltipHTML(hoveredBar, chartDailyValues, completedTasksByDate, moodByDay);

    if (spaceBelow > spaceAbove) {
      tip.show(html, screenX, rect.bottom, { placement: 'bottom', belowChart: true });
    } else {
      tip.show(html, screenX, barTopScreenY, { placement: 'top' });
    }
  }, [hoveredBar]);

  return (
    <WidgetWrapper
      title={widgetTitleFromId('victory-value')}
      icon="🏆"
      widgetId="victory-value"
      configurable={true}
      onConfigure={onConfigure}
    >
      {configOpen ? (
        <ConfigPopup
          title="Configure Victory Value"
          onSubmit={onConfigSubmit}
          onCancel={onConfigCancel}
        >
          <div className="config-field">
            <div className="config-field-label">Time range</div>
            <TimeRangeOptions timeRange={timeRange} setTimeRange={setTimeRange} />
          </div>
          <div className="config-field">
            <div className="config-field-label">Mood overlay</div>
            <label>
              <input
                type="checkbox"
                checked={showMood}
                onChange={(event) => setShowMood(event.target.checked)}
              />
              Show mood overlay
            </label>
          </div>
        </ConfigPopup>
      ) : null}
      <div className="vv-header">
        <span className="vv-total">{roundedWeeklyTotal}</span>
        <span className="vv-label">{`points ${ weekDateRange }`}</span>
      </div>
      <div className="vv-chart-container">
        <button
          className="vv-nav-arrow"
          type="button"
          onClick={() => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(referenceDate, -1))}
          title="Previous week"
          aria-label="Previous week"
        >‹</button>
        <div className="vv-chart-wrap">
          <canvas
            ref={canvasRef}
            className="vv-chart"
            onMouseMove={onCanvasMouseMove}
            onMouseLeave={onCanvasMouseLeave}
          />
        </div>
        <button
          className="vv-nav-arrow"
          type="button"
          disabled={isCurrentWeekOrLater(referenceDate, weekStartDay)}
          onClick={() => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(referenceDate, 1))}
          title="Next week"
          aria-label="Next week"
        >›</button>
      </div>
    </WidgetWrapper>
  );
}
