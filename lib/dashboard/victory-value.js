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

const MOODS = [
  { value: -2, emoji: '\u{1F622}', label: 'Awful' },
  { value: -1, emoji: '\u{1F61F}', label: 'Bad' },
  { value: 0, emoji: '\u{1F610}', label: 'Okay' },
  { value: 1, emoji: '\u{1F642}', label: 'Good' },
  { value: 2, emoji: '\u{1F604}', label: 'Great' }
];

function dateIsoToKey(isoString) {
  const d = new Date(isoString);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatTooltipDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// [Claude] Task: submit widget configuration to plugin settings
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
async function handleConfigSubmit(timeRange, showMood, setConfigOpen) {
  const result = [timeRange, String(showMood)];
  await callPlugin('saveSetting', 'victory-value', result);
  setConfigOpen(false);
}

// [Claude] Task: reset popup state to persisted values
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function handleConfigCancel(currentConfig, setTimeRange, setShowMood, setConfigOpen) {
  setTimeRange(currentConfig[0] || 'week');
  setShowMood(currentConfig[1] === 'true' || currentConfig[1] === true);
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
  const dateKey = dateIsoToKey(dailyValues[index].date);
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

// [Claude] Task: draw victory bars for each day
// Prompt: "all possible functions are local functions, not embedded in the component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
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
    ctx.fillText(d.day, x + barW * 0.35, ht - 12);

    if (d.value > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px system-ui';
      ctx.fillText(d.value, x + barW * 0.35, y + 14);
    }
  });
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

// [Claude] Task: construct debug payload of expected tooltip tasks by day
// Prompt: "output debug console information about what tasks are expected to be shown by the VictoryValue component"
// Date: 2026-02-28 | Model: gpt-5.3-codex
function buildExpectedTasksDebugInfo(dailyValues, completedTasksByDate) {
  return dailyValues.map((dailyEntry, index) => {
    const tasks = getHoveredDayTasks(index, dailyValues, completedTasksByDate);
    return {
      day: dailyEntry.day,
      date: dailyEntry.date,
      dateKey: dateIsoToKey(dailyEntry.date),
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
    ? formatTooltipDate(dailyValues[hoveredBar].date)
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
export default function VictoryValueWidget({ dailyValues, weeklyTotal, moodRatings, completedTasksByDate, settings }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const maxValue = Math.max(...dailyValues.map((entry) => entry.value), 1);

  const [configOpen, setConfigOpen] = useState(false);
  const [hoveredBar, setHoveredBar] = useState(null);
  const currentConfig = settings?.['dashboard_victory-value_config'] || [];
  const [timeRange, setTimeRange] = useState(currentConfig[0] || 'week');
  const [showMood, setShowMood] = useState(currentConfig[1] === 'true' || currentConfig[1] === true);
  const onConfigure = setConfigOpen.bind(null, true);
  const onConfigSubmit = handleConfigSubmit.bind(null, timeRange, showMood, setConfigOpen);
  const onConfigCancel = handleConfigCancel.bind(null, currentConfig, setTimeRange, setShowMood, setConfigOpen);
  const onCanvasMouseMove = handleCanvasMouseMove.bind(null, canvasRef, setHoveredBar);
  const onCanvasMouseLeave = setHoveredBar.bind(null, null);

  useEffect(() => {
    drawChart(canvasRef, dailyValues, maxValue, moodRatings, showMood);
  }, [dailyValues, maxValue, moodRatings, showMood]);

  useEffect(() => {
    logExpectedTasksDebugInfo(dailyValues, completedTasksByDate);
  }, [dailyValues, completedTasksByDate]);

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
      h('span', { className: 'vv-total' }, weeklyTotal),
      h('span', { className: 'vv-label' }, 'points this week')
    ),
    h('div', { className: 'vv-chart-container' },
      h('canvas', {
        ref: canvasRef,
        className: 'vv-chart',
        style: { width: '100%', height: '180px' },
        onMouseMove: onCanvasMouseMove,
        onMouseLeave: onCanvasMouseLeave
      }),
      renderTooltip(h, hoveredBar, dailyValues, completedTasksByDate, moodRatings, canvasRef)
    )
  );
}
