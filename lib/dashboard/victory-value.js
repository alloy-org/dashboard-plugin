/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Victory value widget — weekly total and canvas bar chart with mood overlay
 * Prompt summary: "widget with bar chart of daily victory values and optional mood trend line"
 */
import { createElement, useEffect, useRef, useState } from "react"
import WidgetWrapper from "./widget-wrapper"
import { widgetTitleFromId } from "../constants/settings"
import ConfigPopup from "./config-popup"
import { useCanvasTippy } from "./dashboard-tippy"
import { renderMarkdown } from "util/utility"
import "./styles/_victory-value.scss"
import { logIfEnabled } from "util/log"
import {
  dateFromDateInput,
  dateKeyFromDateInput,
  tooltipLabelFromDateInput,
  weekDateSlotsFromDateInput,
  weekStartFromDateInput
} from "util/date-utility"

const MOODS = [
  { value: -2, emoji: '\u{1F622}', label: 'Awful' },
  { value: -1, emoji: '\u{1F61F}', label: 'Bad' },
  { value: 0, emoji: '\u{1F610}', label: 'Okay' },
  { value: 1, emoji: '\u{1F642}', label: 'Good' },
  { value: 2, emoji: '\u{1F604}', label: 'Great' }
];

// [Claude] Task: format week date range for display in widget header
// Prompt: "print the date range shown in a lighter shade after the Victory Value title"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
function formatWeekDateRange(chartDailyValues) {
  if (!chartDailyValues || chartDailyValues.length < 7) return '';
  const start = dateFromDateInput(chartDailyValues[0].date);
  const end = dateFromDateInput(chartDailyValues[6].date);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)} \u2013 ${fmt(end)}`;
}

// [Claude] Task: shift reference date by N weeks for chart navigation arrows
// Prompt: "add left arrow to choose selected date minus one week, right arrow to advance by one week"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
function shiftWeekDate(referenceDate, deltaWeeks) {
  const date = dateFromDateInput(referenceDate);
  date.setDate(date.getDate() + deltaWeeks * 7);
  return dateKeyFromDateInput(date);
}

// [Claude] Task: determine whether referenceDate is in the current week or later (disables right arrow)
// Prompt: "right arrow is disabled unless the currently selected date is earlier than the current week"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
function isCurrentWeekOrLater(referenceDate) {
  const refWeekStart = weekStartFromDateInput(referenceDate);
  const todayWeekStart = weekStartFromDateInput(new Date());
  return refWeekStart >= todayWeekStart;
}

// [Claude] Task: derive chart values from completed tasks keyed by date
// Prompt: "VictoryValue receives completedTasksByDate but graph stays blank"
// Date: 2026-02-28 | Model: gpt-5.3-codex
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
// Prompt: "clicking calendar date should change VictoryValue week and completed-task fetch window"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function buildDailyValuesForWeek(referenceDate, dailyValues, completedTasksByDate) {
  const weekSlots = weekDateSlotsFromDateInput(referenceDate);
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

// [Claude] Task: submit widget configuration to plugin settings
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
async function handleConfigSubmit(app, timeRange, showMood, setConfigOpen) {
  const result = [timeRange, String(showMood)];
  await app.saveSetting('victory-value', result);
  setConfigOpen(false);
}

// [Claude] Task: parse showMood boolean setting, defaulting to true when unset
// Prompt: "ensure that the daily mood line + dot is visible in VictoryValue component"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
function parseShowMoodSetting(value) {
  if (value === undefined || value === null) return true;
  return value === 'true' || value === true;
}

// [Claude] Task: reset popup state to persisted values
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function handleConfigCancel(currentConfig, setTimeRange, setShowMood, setConfigOpen) {
  setTimeRange(currentConfig[0] || 'week');
  setShowMood(parseShowMoodSetting(currentConfig[1]));
  setConfigOpen(false);
}

// [Claude] Task: resolve hovered bar from mouse coordinates
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
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

// [Claude] Task: compute tooltip x-position for hovered bar
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function getTooltipLeft(canvasRef, index) {
  const canvas = canvasRef.current;
  if (!canvas) return 0;
  const w = canvas.offsetWidth;
  const barW = (w - 80) / 7;
  return 40 + index * barW + barW * 0.5;
}

// [Claude] Task: compute bar-top Y in screen coordinates for above/below tooltip placement
// Prompt: "evaluate whether to pop tooltip above or below the date bar"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
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

// [Claude] Task: collect sorted completed tasks for hovered day
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function getHoveredDayTasks(index, dailyValues, completedTasksByDate) {
  if (!completedTasksByDate || !dailyValues[index]) return [];
  const dateKey = dateKeyFromDateInput(dailyValues[index].date);
  return (completedTasksByDate[dateKey] || [])
    .slice()
    .sort((a, b) => (b.victoryValue || 0) - (a.victoryValue || 0));
}

// [Claude] Task: align raw mood ratings (chronological, arbitrary date range) to the 7 chart day slots
// Prompt: "mood ratings received by Victory Value do not include the date on which the mood was submitted"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
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

// [Claude] Task: map hovered day mood rating to mood metadata, guarding against future dates
// Prompt: "showing mood rating data for dates that have not yet occurred"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
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

// [Claude] Task: draw victory bars for each day with day-of-week and month/day labels
// Prompt: "underneath each day-of-week label, print [short month] [day of month]"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
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

// [Claude] Task: format per-day bar labels to one decimal place
// Prompt: "point values shown on each date need to be rounded to nearest tenth"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function formatBarPointValue(value) {
  return (Math.round((value || 0) * 10) / 10).toFixed(1);
}

// [Claude] Task: draw optional mood trend line and points; dashed across missing days, skipping future dates
// Prompt: "mood ratings received by Victory Value do not include the date on which the mood was submitted"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
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

// [Claude] Task: render canvas chart for victory value widget
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function drawChart(canvasRef, dailyValues, maxValue, moodByDay, showMood) {
  const canvas = canvasRef.current;
  logIfEnabled("Drawing chart in VictoryValue with dailyValues", dailyValues, "and moodByDay", moodByDay);
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

// --------------------------------------------------------------------------------------------------
// [Claude] Task: construct debug payload of expected tooltip tasks by day
// Prompt: "output debug console information about what tasks are expected to be shown by the VictoryValue component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function buildExpectedTasksDebugInfo(dailyValues, completedTasksByDate) {
  return dailyValues.map((dailyEntry, index) => {
    const tasks = getHoveredDayTasks(index, dailyValues, completedTasksByDate);
    return {
      day: dailyEntry.day,
      date: dailyEntry.date,
      dateKey: dateKeyFromDateInput(dailyEntry.date),
      expectedTaskCount: tasks.length,
      expectedTasks: tasks.map((task) => ({
        uuid: task.uuid || null,
        content: task.content || '',
        victoryValue: task.victoryValue || 0
      }))
    };
  });
}

// --------------------------------------------------------------------------------------------------
// [Claude] Task: log expected tooltip task data for debugging
// Prompt: "output debug console information about what tasks are expected to be shown by the VictoryValue component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function logExpectedTasksDebugInfo(dailyValues, completedTasksByDate) {
  const expectedTasksByDay = buildExpectedTasksDebugInfo(dailyValues, completedTasksByDate);
  logIfEnabled('[VictoryValue] expected tooltip tasks by day', expectedTasksByDay);
}

// [Claude] Task: build tooltip HTML string for a hovered victory-value bar
// Prompt: "replace hand-rolled tooltips with tippy.js"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
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
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function renderTimeRangeOptions(h, timeRange, setTimeRange) {
  return ['week', 'month', '30days'].map((value) => h('label', { key: value },
    h('input', {
      type: 'radio',
      name: 'vv-time-range',
      value,
      checked: timeRange === value,
      onChange: setTimeRange.bind(null, value)
    }),
    value === 'week' ? 'This week' : value === 'month' ? 'This month' : 'Last 30 days'
  ));
}

// --------------------------------------------------------------------------------------------------
// [Claude] Task: victory-value widget using useCanvasTippy for bar hover tooltips
// Prompt: "replace hand-rolled tooltips with tippy.js"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
export default function VictoryValueWidget({ app, completedTasksByDate, dailyValues, moodRatings, onReferenceDateChange, referenceDate, settings, weeklyTotal }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const chartDailyValues = buildDailyValuesForWeek(referenceDate, dailyValues, completedTasksByDate);
  const maxValue = Math.max(...chartDailyValues.map((entry) => entry.value), 1);
  const chartWeeklyTotal = chartDailyValues.reduce((sum, entry) => sum + (entry.value || 0), 0);
  const roundedWeeklyTotal = Math.round(chartWeeklyTotal || weeklyTotal || 0);
  const moodByDay = buildMoodByDay(moodRatings, chartDailyValues);

  const [configOpen, setConfigOpen] = useState(false);
  const [hoveredBar, setHoveredBar] = useState(null);
  const currentConfig = settings?.['dashboard_victory-value_config'] || [];
  const [timeRange, setTimeRange] = useState(currentConfig[0] || 'week');
  const [showMood, setShowMood] = useState(parseShowMoodSetting(currentConfig[1]));
  const onConfigure = setConfigOpen.bind(null, true);
  const onConfigSubmit = handleConfigSubmit.bind(null, app, timeRange, showMood, setConfigOpen);
  const onConfigCancel = handleConfigCancel.bind(null, currentConfig, setTimeRange, setShowMood, setConfigOpen);
  const onCanvasMouseMove = handleCanvasMouseMove.bind(null, canvasRef, setHoveredBar);
  const onCanvasMouseLeave = setHoveredBar.bind(null, null);
  const weekDateRange = formatWeekDateRange(chartDailyValues);
  const tip = useCanvasTippy();
  logIfEnabled("Fixin to render VV widget with completedTasksByDate", completedTasksByDate)

  useEffect(() => {
    drawChart(canvasRef, chartDailyValues, maxValue, moodByDay, showMood);
  }, [chartDailyValues, maxValue, moodByDay, showMood]);

  useEffect(() => {
    logExpectedTasksDebugInfo(chartDailyValues, completedTasksByDate);
  }, [chartDailyValues, completedTasksByDate]);

  // [Claude] Task: choose above-bar or below-chart tooltip placement based on available viewport space
  // Prompt: "evaluate whether to pop tooltip above or below the date bar"
  // Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
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

  return h(WidgetWrapper, {
    title: widgetTitleFromId('victory-value'), icon: '\u{1F3C6}', widgetId: 'victory-value', configurable: true,
    onConfigure
  },
    configOpen
      ? h(ConfigPopup, {
          title: 'Configure Victory Value',
          onSubmit: onConfigSubmit,
          onCancel: onConfigCancel
        },
          h('div', { className: 'config-field' },
            h('div', { className: 'config-field-label' }, 'Time range'),
            renderTimeRangeOptions(h, timeRange, setTimeRange)
          ),
          h('div', { className: 'config-field' },
            h('div', { className: 'config-field-label' }, 'Mood overlay'),
            h('label', null,
              h('input', {
                type: 'checkbox', checked: showMood,
                onChange: (event) => setShowMood(event.target.checked)
              }),
              'Show mood overlay'
            )
          )
        )
      : null,
    h('div', { className: 'vv-header' },
      h('span', { className: 'vv-total' }, roundedWeeklyTotal),
      h('span', { className: 'vv-label' }, `points ${ weekDateRange }`)
    ),
    h('div', { className: 'vv-chart-container' },
      h('button', {
        className: 'vv-nav-arrow',
        type: 'button',
        onClick: () => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(referenceDate, -1)),
        title: 'Previous week',
        'aria-label': 'Previous week'
      }, '\u2039'),
      h('div', { className: 'vv-chart-wrap' },
        h('canvas', {
          ref: canvasRef,
          className: 'vv-chart',
          onMouseMove: onCanvasMouseMove,
          onMouseLeave: onCanvasMouseLeave
        })
      ),
      h('button', {
        className: 'vv-nav-arrow',
        type: 'button',
        disabled: isCurrentWeekOrLater(referenceDate),
        onClick: () => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(referenceDate, 1)),
        title: 'Next week',
        'aria-label': 'Next week'
      }, '\u203a')
    )
  );
}
