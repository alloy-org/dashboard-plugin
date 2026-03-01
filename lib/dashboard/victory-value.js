/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Victory value widget — weekly total and canvas bar chart with mood overlay
 * Prompt summary: "widget with bar chart of daily victory values and optional mood trend line"
 */
import { createElement, useEffect, useRef, useState } from "react"
import WidgetWrapper from "./widget-wrapper"
import ConfigPopup from "./config-popup"
import DashboardTooltip from "./tooltip"
import { renderMarkdown } from "util/utility"
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
async function handleConfigSubmit(timeRange, showMood, setConfigOpen) {
  const result = [timeRange, String(showMood)];
  await callPlugin('saveSetting', 'victory-value', result);
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

// [Claude] Task: map hovered day mood rating to mood metadata
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function getHoveredDayMood(index, moodRatings) {
  if (!moodRatings || !moodRatings[index]) return null;
  const rating = moodRatings[index].rating;
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

// [Claude] Task: draw optional mood trend line and points
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function drawMoodOverlay(ctx, moodRatings, barW, chartH) {
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.beginPath();

  moodRatings.forEach((m, i) => {
    const normalizedY = chartH - ((m.rating + 2) / 4) * chartH + 10;
    const x = 40 + i * barW + barW * 0.5;
    if (i === 0) {
      ctx.moveTo(x, normalizedY);
      return;
    }
    ctx.lineTo(x, normalizedY);
  });

  ctx.stroke();

  moodRatings.forEach((m, i) => {
    const normalizedY = chartH - ((m.rating + 2) / 4) * chartH + 10;
    const x = 40 + i * barW + barW * 0.5;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(x, normalizedY, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

// [Claude] Task: render canvas chart for victory value widget
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function drawChart(canvasRef, dailyValues, maxValue, moodRatings, showMood) {
  const canvas = canvasRef.current;
  console.log("Drawing chart in VictoryValue with dailyValues", dailyValues, "and moodRatings", moodRatings);
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

  if (showMood && moodRatings && moodRatings.length > 0) {
    drawMoodOverlay(ctx, moodRatings, barW, chartH);
  }
}

// [Claude] Task: animate bar heights and mood-line positions from old values to new
// Prompt: "When Victory Value canvas bar & line change, animate the transition from the old value to the new"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
function animateChart(canvasRef, fromValues, toValues, fromMood, toMood, maxValue, showMood, animRef) {
  const DURATION = 400;
  const start = performance.now();

  function frame(now) {
    const t = Math.min((now - start) / DURATION, 1);
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    const interpolated = toValues.map((d, i) => ({
      ...d,
      value: (fromValues[i]?.value ?? 0) + (d.value - (fromValues[i]?.value ?? 0)) * eased
    }));

    const interpolatedMood = toMood
      ? toMood.map((m, i) => {
          const fromRating = fromMood?.[i]?.rating ?? 0;
          return { ...m, rating: fromRating + (m.rating - fromRating) * eased };
        })
      : toMood;

    drawChart(canvasRef, interpolated, maxValue, interpolatedMood, showMood);

    if (t < 1) {
      animRef.current = requestAnimationFrame(frame);
    }
  }

  if (animRef.current) cancelAnimationFrame(animRef.current);
  animRef.current = requestAnimationFrame(frame);
}

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

// [Claude] Task: log expected tooltip task data for debugging
// Prompt: "output debug console information about what tasks are expected to be shown by the VictoryValue component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function logExpectedTasksDebugInfo(dailyValues, completedTasksByDate) {
  const expectedTasksByDay = buildExpectedTasksDebugInfo(dailyValues, completedTasksByDate);
  console.debug('[VictoryValue] expected tooltip tasks by day', expectedTasksByDay);
}

// [Claude] Task: build task row nodes for tooltip
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function renderTooltipTaskRows(h, tasks) {
  return tasks.map((task, i) => h('div', { key: task.uuid || i, className: 'dashboard-tooltip-row' },
    h('span', { className: 'dashboard-tooltip-row-label', dangerouslySetInnerHTML: { __html: renderMarkdown(task.content) } }),
    h('span', { className: 'dashboard-tooltip-row-value' },
      (task.victoryValue || 0) + ' pts'
    )
  ));
}

// [Claude] Task: render tooltip element from hovered state
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function renderTooltip(h, hoveredBar, dailyValues, completedTasksByDate, moodRatings, canvasRef) {
  const tasks = hoveredBar !== null ? getHoveredDayTasks(hoveredBar, dailyValues, completedTasksByDate) : [];
  const mood = hoveredBar !== null ? getHoveredDayMood(hoveredBar, moodRatings) : null;
  const dateLabel = hoveredBar !== null && dailyValues[hoveredBar]
    ? tooltipLabelFromDateInput(dailyValues[hoveredBar].date)
    : '';

  return h(DashboardTooltip, {
      left: hoveredBar !== null ? getTooltipLeft(canvasRef, hoveredBar) : 0,
      visible: hoveredBar !== null
    },
    h('div', { className: 'dashboard-tooltip-header' }, dateLabel),
    mood
      ? h('div', { className: 'dashboard-tooltip-section' },
          h('span', null, mood.emoji),
          h('span', null, ' ' + mood.label)
        )
      : null,
    tasks.length > 0
      ? renderTooltipTaskRows(h, tasks)
      : h('div', { className: 'dashboard-tooltip-empty' }, 'No completed tasks')
  );
}

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

// [Claude] Task: render victory value bar chart on canvas with mood trend overlay
// Prompt: "widget with bar chart of daily victory values and optional mood trend line"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
// [Claude] Task: add inline config popup for Victory Value settings
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Claude] Task: add hover tooltip showing completed tasks and mood for each day
// Prompt: "show a tippy tooltip listing tasks finished, sorted by victoryValue, with mood rating"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Claude] Task: show date range after title and month/day under day-of-week labels
// Prompt: "print the date range in a lighter shade after the Victory Value title; underneath each day-of-week label, print [short month] [day of month]"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
// [Claude] Task: add left/right week navigation arrows around the chart
// Prompt: "add left arrow to choose selected date minus one week, right arrow disabled unless date is earlier than current week"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
// [Claude] Task: animate bar heights and mood-line positions on data change
// Prompt: "When Victory Value canvas bar & line change, animate the transition from the old value to the new"
// Date: 2026-03-01 | Model: claude-sonnet-4-6
export default function VictoryValueWidget({ completedTasksByDate, dailyValues, moodRatings, onReferenceDateChange, referenceDate, settings, weeklyTotal }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const prevValuesRef = useRef(null);
  const prevMoodRef = useRef(null);
  const animRef = useRef(null);
  const chartDailyValues = buildDailyValuesForWeek(referenceDate, dailyValues, completedTasksByDate);
  const maxValue = Math.max(...chartDailyValues.map((entry) => entry.value), 1);
  const chartWeeklyTotal = chartDailyValues.reduce((sum, entry) => sum + (entry.value || 0), 0);
  const roundedWeeklyTotal = Math.round(chartWeeklyTotal || weeklyTotal || 0);

  const [configOpen, setConfigOpen] = useState(false);
  const [hoveredBar, setHoveredBar] = useState(null);
  const currentConfig = settings?.['dashboard_victory-value_config'] || [];
  const [timeRange, setTimeRange] = useState(currentConfig[0] || 'week');
  const [showMood, setShowMood] = useState(parseShowMoodSetting(currentConfig[1]));
  const onConfigure = setConfigOpen.bind(null, true);
  const onConfigSubmit = handleConfigSubmit.bind(null, timeRange, showMood, setConfigOpen);
  const onConfigCancel = handleConfigCancel.bind(null, currentConfig, setTimeRange, setShowMood, setConfigOpen);
  const onCanvasMouseMove = handleCanvasMouseMove.bind(null, canvasRef, setHoveredBar);
  const onCanvasMouseLeave = setHoveredBar.bind(null, null);
  const weekDateRange = formatWeekDateRange(chartDailyValues);
  console.log("Fixin to render VV widget with completedTasksByDate", completedTasksByDate)

  useEffect(() => {
    const fromValues = prevValuesRef.current ?? chartDailyValues.map((d) => ({ ...d, value: 0 }));
    const fromMood = prevMoodRef.current ?? null;

    // Only persist non-trivial data as "previous" values. While a new week's data
    // is still loading the chart arrives as all-zeros; if we stored those zeros the
    // next animation (real data → real data) would start from zero instead of from
    // the last meaningful bar heights. Leaving the ref untouched lets any in-progress
    // zeros-animation be cancelled and restarted correctly once data arrives.
    if (chartDailyValues.some((d) => d.value > 0)) {
      prevValuesRef.current = chartDailyValues;
    }
    if (moodRatings && moodRatings.length > 0) {
      prevMoodRef.current = moodRatings;
    }

    animateChart(canvasRef, fromValues, chartDailyValues, fromMood, moodRatings, maxValue, showMood, animRef);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [chartDailyValues, maxValue, moodRatings, showMood]);

  useEffect(() => {
    logExpectedTasksDebugInfo(chartDailyValues, completedTasksByDate);
  }, [chartDailyValues, completedTasksByDate]);

  return h(WidgetWrapper, {
    title: 'Victory Value', icon: '\u{1F3C6}', widgetId: 'victory-value', configurable: true,
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
          style: { width: '100%', height: '180px' },
          onMouseMove: onCanvasMouseMove,
          onMouseLeave: onCanvasMouseLeave
        }),
        renderTooltip(h, hoveredBar, chartDailyValues, completedTasksByDate, moodRatings, canvasRef)
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
