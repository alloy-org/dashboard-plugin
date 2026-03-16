/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Peak Hours widget — hourly distribution chart of task creation and completion
 * Prompt summary: "rewrite peak-hours as a project-native widget consuming completed tasks from dashboard"
 */
import { createElement, useEffect, useRef, useMemo, useCallback, useState } from "react";
import { widgetTitleFromId } from "constants/settings";
import { dateFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import WidgetWrapper from "widget-wrapper";
import "styles/peak-hours.scss";

const WIDGET_ID = 'peak-hours';

// ---------------------------------------------------------------------------
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "12 AM";
  if (i < 12) return `${i} AM`;
  if (i === 12) return "12 PM";
  return `${i - 12} PM`;
});

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
    createdByHour: created,
    completedByHour: completed,
    totalTasks: count,
    peakCreateHour: HOUR_LABELS[peakC],
    peakCompleteHour: HOUR_LABELS[peakD],
  };
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

function getThemeColors(el) {
  const s = getComputedStyle(el);
  return {
    barCreated: s.getPropertyValue('--dashboard-color-blue').trim() || '#5b7bbf',
    barCompleted: s.getPropertyValue('--dashboard-color-accent').trim() || '#e8853d',
    axisText: s.getPropertyValue('--dashboard-color-text-secondary').trim() || '#7a8699',
    gridLine: s.getPropertyValue('--dashboard-color-border').trim() || '#d8dde6',
  };
}

// [Claude] Task: draw grouped bar chart on canvas using theme-aware colors from CSS custom properties
// Prompt: "rewrite peak-hours chart to use project theme tokens for light/dark mode support"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
function drawChart(canvas, createdData, completedData) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;
  if (W <= 0 || H <= 0) return;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.scale(dpr, dpr);

  const colors = getThemeColors(canvas);
  const padLeft = 48;
  const padRight = 12;
  const padTop = 12;
  const padBottom = 40;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  const maxVal = Math.max(...createdData, ...completedData, 1);
  const niceMax = Math.ceil(maxVal / 10) * 10 || 10;

  ctx.clearRect(0, 0, W, H);

  const yTicks = 5;
  ctx.font = "11px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= yTicks; i++) {
    const val = Math.round((niceMax / yTicks) * i);
    const y = padTop + chartH - (chartH * i) / yTicks;
    ctx.fillStyle = colors.axisText;
    ctx.fillText(`${val}`, padLeft - 8, y);
    if (i > 0) {
      ctx.strokeStyle = colors.gridLine;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + chartW, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  const n = 24;
  const groupW = chartW / n;
  const barW = groupW * 0.32;
  const gap = groupW * 0.04;

  for (let i = 0; i < n; i++) {
    const x = padLeft + i * groupW + (groupW - barW * 2 - gap) / 2;
    const hCreated = (createdData[i] / niceMax) * chartH;
    const hCompleted = (completedData[i] / niceMax) * chartH;

    ctx.fillStyle = colors.barCreated;
    roundRect(ctx, x, padTop + chartH - hCreated, barW, hCreated, 2);

    ctx.fillStyle = colors.barCompleted;
    roundRect(ctx, x + barW + gap, padTop + chartH - hCompleted, barW, hCompleted, 2);
  }

  ctx.fillStyle = colors.axisText;
  ctx.font = "10px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelStep = chartW < 300 ? 4 : 2;
  for (let i = 0; i < n; i += labelStep) {
    const x = padLeft + i * groupW + groupW / 2;
    ctx.fillText(HOUR_LABELS[i], x, padTop + chartH + 8);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  if (h < 1) return;
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
}

function getBarIndex(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const W = rect.width;
  const padLeft = 48;
  const padRight = 12;
  const chartW = W - padLeft - padRight;
  const rel = x - padLeft;
  if (rel < 0 || rel > chartW) return -1;
  return Math.floor((rel / chartW) * 24);
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderMetricCard(h, label, value) {
  return h('div', { className: 'peak-hours-metric-card', key: label },
    h('div', { className: 'peak-hours-metric-label' }, label),
    h('div', { className: 'peak-hours-metric-value' }, value)
  );
}

function renderLegendItem(h, modifierClass, label) {
  return h('span', { className: 'peak-hours-legend-item', key: label },
    h('span', { className: `peak-hours-legend-swatch ${modifierClass}` }),
    label
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// [Claude] Task: Peak Hours widget that fetches ALL completed tasks for the selected month
// Prompt: "peak-hours should retrieve ALL tasks completed during the currently selected month"
// Date: 2026-03-15 | Model: claude-4.6-opus-high-thinking
export default function PeakHoursWidget({ app, selectedDate, currentDate }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [tasks, setTasks] = useState([]);
  const fetchedMonthRef = useRef(null);

  const referenceDate = selectedDate || currentDate;

  // [Claude] Task: fetch all completed tasks for the full month when month changes
  // Prompt: "peak-hours should retrieve ALL tasks completed during the currently selected month"
  // Date: 2026-03-15 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    if (!referenceDate || !app) return;
    const { from, to, monthKey } = monthBoundaries(referenceDate);
    if (fetchedMonthRef.current === monthKey) return;
    fetchedMonthRef.current = monthKey;
    let cancelled = false;

    app.getCompletedTasks(from, to).then(result => {
      if (!cancelled) setTasks(Array.isArray(result) ? result : []);
    }).catch(err => {
      logIfEnabled('[peak-hours] failed to fetch month tasks', err);
      if (!cancelled) setTasks([]);
    });

    return () => { cancelled = true; };
  }, [app, referenceDate]);

  const { createdByHour, completedByHour, totalTasks, peakCreateHour, peakCompleteHour } =
    useMemo(() => buildHourlyData(tasks), [tasks]);

  const { monthSubtitle, dateRange } = useMemo(() => {
    if (!referenceDate) return { monthSubtitle: null, dateRange: null };
    const d = dateFromDateInput(referenceDate);
    const year = d.getFullYear();
    const month = d.getMonth();
    return {
      monthSubtitle: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      dateRange: {
        start: new Date(year, month, 1),
        end: new Date(year, month + 1, 0),
      },
    };
  }, [referenceDate]);

  useEffect(() => {
    if (!canvasRef.current) return;
    drawChart(canvasRef.current, createdByHour, completedByHour);
    const handleResize = () => {
      if (canvasRef.current) drawChart(canvasRef.current, createdByHour, completedByHour);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [createdByHour, completedByHour]);

  const handleMouseMove = useCallback((e) => {
    const idx = getBarIndex(canvasRef.current, e);
    if (idx < 0 || idx > 23) { setTooltip(null); return; }
    const rect = canvasRef.current.getBoundingClientRect();
    setTooltip({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top - 60,
      hour: HOUR_LABELS[idx],
      created: createdByHour[idx],
      completed: completedByHour[idx],
    });
  }, [createdByHour, completedByHour]);

  const handleMouseLeave = useCallback(() => setTooltip(null), []);

  if (totalTasks === 0) {
    return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: '\u23F0', widgetId: WIDGET_ID, subtitle: monthSubtitle },
      h('div', { className: 'peak-hours-empty' },
        h('p', null, 'No completed task data available yet.')
      )
    );
  }

  return h(WidgetWrapper, { title: widgetTitleFromId(WIDGET_ID), icon: '\u23F0', widgetId: WIDGET_ID, subtitle: monthSubtitle },
    h('div', { className: 'peak-hours-metrics-grid' },
      renderMetricCard(h, 'Tasks analyzed', totalTasks),
      renderMetricCard(h, 'Peak create hour', peakCreateHour),
      renderMetricCard(h, 'Peak complete hour', peakCompleteHour)
    ),
    h('div', { className: 'peak-hours-legend' },
      renderLegendItem(h, 'peak-hours-legend-swatch--created', 'Created value'),
      renderLegendItem(h, 'peak-hours-legend-swatch--completed', 'Completed value')
    ),
    h('div', { className: 'peak-hours-chart-container' },
      h('canvas', {
        ref: canvasRef,
        className: 'peak-hours-canvas',
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
      }),
      tooltip && h('div', {
        className: 'peak-hours-tooltip',
        style: { left: tooltip.x, top: tooltip.y, transform: 'translateX(-50%)' },
      },
        h('div', { className: 'peak-hours-tooltip-header' }, tooltip.hour),
        h('div', { className: 'peak-hours-tooltip-row' },
          h('span', { className: 'peak-hours-tooltip-label peak-hours-tooltip-label--created' }, 'Created:'),
          ` ${tooltip.created} pts`
        ),
        h('div', { className: 'peak-hours-tooltip-row' },
          h('span', { className: 'peak-hours-tooltip-label peak-hours-tooltip-label--completed' }, 'Completed:'),
          ` ${tooltip.completed} pts`
        )
      )
    ),
    dateRange && h('div', { className: 'peak-hours-footer' }, monthSubtitle)
  );
}
