/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Victory value widget — weekly total and canvas bar chart with mood overlay
 * Prompt summary: "widget with bar chart of daily victory values and optional mood trend line"
 */
import { createElement, useEffect, useRef, useState, useCallback } from "react"
import WidgetWrapper from "./widget-wrapper"
import ConfigPopup from "./config-popup"
import DashboardTooltip from "./tooltip"

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

// [Claude] Task: render victory value bar chart on canvas with mood trend overlay
// Prompt: "widget with bar chart of daily victory values and optional mood trend line"
// Date: 2026-02-17 | Model: claude-sonnet-4-5-20250929
// [Claude] Task: add inline config popup for Victory Value settings
// Prompt: "popup component that pops up setting options upon clicking Configure"
// Date: 2026-02-22 | Model: claude-opus-4-6
// [Claude] Task: add hover tooltip showing completed tasks and mood for each day
// Prompt: "show a tippy tooltip listing tasks finished, sorted by victoryValue, with mood rating"
// Date: 2026-02-22 | Model: claude-opus-4-6
export default function VictoryValueWidget({ dailyValues, weeklyTotal, moodRatings, completedTasks, settings }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const maxValue = Math.max(...dailyValues.map(d => d.value), 1);

  const [configOpen, setConfigOpen] = useState(false);
  const [hoveredBar, setHoveredBar] = useState(null);
  const currentConfig = settings?.['dashboard_victory-value_config'] || [];
  const [timeRange, setTimeRange] = useState(currentConfig[0] || 'week');
  const [showMood, setShowMood] = useState(currentConfig[1] === 'true' || currentConfig[1] === true);

  const handleConfigSubmit = async () => {
    const result = [timeRange, String(showMood)];
    await callPlugin('saveSetting', 'victory-value', result);
    setConfigOpen(false);
  };

  const handleConfigCancel = () => {
    setTimeRange(currentConfig[0] || 'week');
    setShowMood(currentConfig[1] === 'true' || currentConfig[1] === true);
    setConfigOpen(false);
  };

  const handleCanvasMouseMove = useCallback((e) => {
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
  }, []);

  const handleCanvasMouseLeave = useCallback(() => {
    setHoveredBar(null);
  }, []);

  const getTooltipLeft = (index) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const w = canvas.offsetWidth;
    const barW = (w - 80) / 7;
    return 40 + index * barW + barW * 0.5;
  };

  const getHoveredDayTasks = (index) => {
    if (!completedTasks || !dailyValues[index]) return [];
    const dateKey = dateIsoToKey(dailyValues[index].date);
    return (completedTasks[dateKey] || [])
      .slice()
      .sort((a, b) => (b.victoryValue || 0) - (a.victoryValue || 0));
  };

  const getHoveredDayMood = (index) => {
    if (!moodRatings || !moodRatings[index]) return null;
    const rating = moodRatings[index].rating;
    return MOODS.find(m => m.value === rating) || null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth * 2;
    const H = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2); // Retina
    const w = W / 2, ht = H / 2;
    const barW = (w - 80) / 7;
    const chartH = ht - 50;

    ctx.clearRect(0, 0, w, ht);

    // Bars
    dailyValues.forEach((d, i) => {
      const barH = (d.value / maxValue) * chartH * 0.85;
      const x = 40 + i * barW + barW * 0.15;
      const y = chartH - barH + 10;
      ctx.fillStyle = d.value > 0 ? '#6366f1' : '#e5e7eb';
      ctx.beginPath();
      ctx.roundRect(x, y, barW * 0.7, barH, [4, 4, 0, 0]);
      ctx.fill();

      // Day label
      ctx.fillStyle = '#6b7280';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(d.day, x + barW * 0.35, ht - 12);

      // Value on bar
      if (d.value > 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px system-ui';
        ctx.fillText(d.value, x + barW * 0.35, y + 14);
      }
    });

    // Mood trend line overlay (if showMoodOverlay setting is on)
    if (moodRatings && moodRatings.length > 0) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      moodRatings.forEach((m, i) => {
        // Normalize mood from [-2,2] to chart height
        const normalizedY = chartH - ((m.rating + 2) / 4) * chartH + 10;
        const x = 40 + i * barW + barW * 0.5;
        i === 0 ? ctx.moveTo(x, normalizedY) : ctx.lineTo(x, normalizedY);
      });
      ctx.stroke();

      // Mood dots
      moodRatings.forEach((m, i) => {
        const normalizedY = chartH - ((m.rating + 2) / 4) * chartH + 10;
        const x = 40 + i * barW + barW * 0.5;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, normalizedY, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, [dailyValues, moodRatings]);

  const renderTooltip = () => {
    const tasks = hoveredBar !== null ? getHoveredDayTasks(hoveredBar) : [];
    const mood = hoveredBar !== null ? getHoveredDayMood(hoveredBar) : null;
    const dateLabel = hoveredBar !== null && dailyValues[hoveredBar]
      ? formatTooltipDate(dailyValues[hoveredBar].date)
      : '';

    return h(DashboardTooltip, {
        left: hoveredBar !== null ? getTooltipLeft(hoveredBar) : 0,
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
        ? tasks.map((task, i) =>
            h('div', { key: task.uuid || i, className: 'dashboard-tooltip-row' },
              h('span', { className: 'dashboard-tooltip-row-label' }, task.content),
              h('span', { className: 'dashboard-tooltip-row-value' },
                (task.victoryValue || 0) + ' pts'
              )
            )
          )
        : h('div', { className: 'dashboard-tooltip-empty' }, 'No completed tasks')
    );
  };

  return h(WidgetWrapper, {
    title: 'Victory Value', icon: '\u{1F3C6}', widgetId: 'victory-value', configurable: true,
    onConfigure: () => setConfigOpen(true)
  },
    configOpen
      ? h(ConfigPopup, {
          title: 'Configure Victory Value',
          onSubmit: handleConfigSubmit,
          onCancel: handleConfigCancel
        },
          h('div', { className: 'config-field' },
            h('div', { className: 'config-field-label' }, 'Time range'),
            ['week', 'month', '30days'].map(value =>
              h('label', { key: value },
                h('input', {
                  type: 'radio', name: 'vv-time-range', value,
                  checked: timeRange === value,
                  onChange: () => setTimeRange(value)
                }),
                value === 'week' ? 'This week' : value === 'month' ? 'This month' : 'Last 30 days'
              )
            )
          ),
          h('div', { className: 'config-field' },
            h('div', { className: 'config-field-label' }, 'Mood overlay'),
            h('label', null,
              h('input', {
                type: 'checkbox', checked: showMood,
                onChange: (e) => setShowMood(e.target.checked)
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
        onMouseMove: handleCanvasMouseMove,
        onMouseLeave: handleCanvasMouseLeave
      }),
      renderTooltip()
    )
  );
}
