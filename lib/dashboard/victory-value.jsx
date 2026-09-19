// Render seven days of completed-task victory values with weekly navigation and a mood overlay.
import { parseWidgetConfig, widgetConfigKey } from "../constants/settings";
import ConfigPopup from "./config-popup";
import { useCanvasTippy } from "./dashboard-tooltip-tippy.jsx";
import WidgetWrapper from "./widget-wrapper";
import { pluginSettings } from "plugin-data";
import { useEffect, useRef, useState } from "react";
import "styles/victory-value.scss";
import { dateFromDateInput, dateKeyFromDateInput, tooltipLabelFromDateInput, weekDateSlotsFromDateInput } from "util/date-utility";
import { renderMarkdown } from "util/utility";

const MOODS = [
  { value: -2, emoji: '\u{1F622}', label: 'Awful' },
  { value: -1, emoji: '\u{1F61F}', label: 'Bad' },
  { value: 0, emoji: '\u{1F610}', label: 'Okay' },
  { value: 1, emoji: '\u{1F642}', label: 'Good' },
  { value: 2, emoji: '\u{1F604}', label: 'Great' }
];

// ------------------------------------------------------------------------------------------
// @desc Build seven daily totals ending on the reference date, using supplied daily values until tasks are available.
// @param {Object} completedTasksByDate - Completed tasks grouped by local date key.
// @param {Array} dailyValues - Fallback daily totals.
// @param {Date|string} referenceDate - Last day of the displayed range.
// @returns {Array} Seven chronological daily totals and task counts.
function buildDailyValuesForWeek(completedTasksByDate, dailyValues, referenceDate) {
  const startDate = dateFromDateInput(referenceDate);
  startDate.setDate(startDate.getDate() - 6);
  const weekSlots = weekDateSlotsFromDateInput(startDate, startDate.getDay());
  const valuesByDate = new Map((dailyValues || []).map(entry => [dateKeyFromDateInput(entry.date), entry]));
  return weekSlots.map((slot) => {
    const tasksForDay = completedTasksByDate?.[slot.dateKey];
    const fallback = valuesByDate.get(slot.dateKey);
    const value = Array.isArray(tasksForDay)
      ? tasksForDay.reduce((sum, task) => sum + (task.victoryValue || 0), 0) : fallback?.value || 0;
    const taskCount = Array.isArray(tasksForDay) ? tasksForDay.length : fallback?.taskCount || 0;
    return { date: slot.date, day: slot.day, taskCount, value };
  });
}

// ------------------------------------------------------------------------------------------
// @desc Format the first and last displayed dates for the widget header.
// @param {Array} chartDailyValues - Seven chronological daily values.
// @returns {string} Localized date range.
function formatWeekDateRange(chartDailyValues) {
  if (!chartDailyValues || chartDailyValues.length < 7) return '';
  const start = dateFromDateInput(chartDailyValues[0].date);
  const end = dateFromDateInput(chartDailyValues[6].date);
  const options = { day: 'numeric', month: 'short' };
  return `${ start.toLocaleDateString(undefined, options) } – ${ end.toLocaleDateString(undefined, options) }`;
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

// ------------------------------------------------------------------------------------------
// @desc Shift the displayed range by whole calendar weeks, stopping at today when navigating forward.
// @param {number} deltaWeeks - Number of weeks to move backward or forward.
// @param {Date|string} referenceDate - Last displayed date.
// @returns {string} Local date key for the new range end.
function shiftWeekDate(deltaWeeks, referenceDate) {
  const date = dateFromDateInput(referenceDate);
  date.setDate(date.getDate() + deltaWeeks * 7);
  const shiftedKey = dateKeyFromDateInput(date);
  const todayKey = dateKeyFromDateInput(new Date());
  return shiftedKey > todayKey ? todayKey : shiftedKey;
}

// ------------------------------------------------------------------------------------------
// @desc Render the saved time range options with a seven-day default.
// @param {Object} props - Time range selection and its state setter.
function TimeRangeOptions({ setTimeRange, timeRange }) {
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
          {value === 'week' ? 'Last 7 days' : value === 'month' ? 'This month' : 'Last 30 days'}
        </label>
      ))}
    </>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Render the seven days ending on the selected date, with arrows that move the range by one week.
// @param {Object} props - Completed tasks, mood ratings, fallback totals, and date navigation callback.
// @returns {JSX.Element} Configurable Victory Value chart.
export default function VictoryValueWidget({ app, completedTasksByDate, dailyValues, moodRatings,
    onReferenceDateChange, referenceDate }) {
  const canvasRef = useRef(null);
  const redrawChartRef = useRef(null);
  const rangeEndDate = referenceDate || dateKeyFromDateInput(new Date());
  const chartDailyValues = buildDailyValuesForWeek(completedTasksByDate, dailyValues, rangeEndDate);
  const maxValue = Math.max(...chartDailyValues.map((entry) => entry.value), 1);
  const chartWeeklyTotal = chartDailyValues.reduce((sum, entry) => sum + (entry.value || 0), 0);
  const roundedWeeklyTotal = Math.round(chartWeeklyTotal);
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

  // ------------------------------------------------------------------------------------------
  // @desc Draw the selected dates and clear any tooltip left over from the previous range.
  useEffect(() => {
    setHoveredBar(null);
  }, [rangeEndDate]);

  useEffect(() => {
    redrawChartRef.current = () => drawChart(canvasRef, chartDailyValues, maxValue, moodByDay, showMood);
    redrawChartRef.current();
  }, [chartDailyValues, maxValue, moodByDay, showMood]);

  // ------------------------------------------------------------------------------------------
  // @desc Redraw whenever the canvas box changes size. drawChart sizes the bitmap from the element's
  //   own pixel dimensions, so a resize with no accompanying data change (the layout popup, or the
  //   widget-focus animation that grows the widget to four cells wide) would otherwise leave the
  //   previous bitmap stretched across the new box until something unrelated triggered a redraw.
  // [OpenAI GPT-5.6 Sol] Task: keep the chart bitmap in step with the canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
    const sizeObserver = new ResizeObserver(() => redrawChartRef.current?.());
    sizeObserver.observe(canvas);
    return () => sizeObserver.disconnect();
  }, []);

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
    <WidgetWrapper configurable={true} onConfigure={onConfigure} widgetId="victory-value">
      {configOpen ? (
        <ConfigPopup
          title="Configure Victory Value"
          onSubmit={onConfigSubmit}
          onCancel={onConfigCancel}
        >
          <div className="config-field">
            <div className="config-field-label">Time range</div>
            <TimeRangeOptions setTimeRange={setTimeRange} timeRange={timeRange} />
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
          onClick={() => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(-1, rangeEndDate))}
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
          disabled={dateKeyFromDateInput(rangeEndDate) >= dateKeyFromDateInput(new Date())}
          onClick={() => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(1, rangeEndDate))}
          title="Next week"
          aria-label="Next week"
        >›</button>
      </div>
    </WidgetWrapper>
  );
}
