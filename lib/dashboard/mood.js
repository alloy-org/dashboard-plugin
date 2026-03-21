/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Mood widget — emoji selector, average, and sparkline visualization
 * Prompt summary: "widget displaying mood buttons, 7-day average, and sparkline visualization"
 */
import { createElement, useEffect, useRef, useState } from "react";
import ConfigPopup from "config-popup";
import { useCanvasTippy } from "./dashboard-tippy";
import WidgetWrapper from "widget-wrapper";
import { DASHBOARD_NOTE_TAG, widgetTitleFromId, parseWidgetConfig, widgetConfigKey } from "constants/settings";
import { logIfEnabled } from "util/log";
import "styles/mood.scss"

const CONFIRMATION_DISPLAY_MS = 5000;
const AVERAGE_MOOD_WINDOW    = 7;   // number of recent ratings used for the 7-day average
const MOOD_TEXTAREA_ROWS     = 3;

// Canvas shared
const CANVAS_SIZE           = 220;
const CANVAS_CORNER_RADIUS  = 14;
const PIXEL_RATIO_FALLBACK  = 2;

// Radial ring layout
const RING_CENTER_Y_OFFSET  = 4;   // shift ring center slightly downward to leave room for title
const RING_OUTER_RADIUS     = 78;
const RING_INNER_RADIUS     = 40;
const RING_INNER_HOLE_INSET = 4;   // center hole = innerRadius - this
const RING_GUIDE_START      = 48;  // first decorative guide ring radius
const RING_GUIDE_END        = 95;  // last decorative guide ring radius
const RING_GUIDE_STEP       = 16;
const RING_GAP_ANGLE        = 0.04; // radian gap between segments
const RING_SHADOW_BLUR_SCALE = 12;  // shadow = RING_SHADOW_BLUR_SCALE * progress
const RING_LABEL_RADIUS_OFFSET = 12; // outward distance beyond outerRadius for text
const RING_LABEL_PROGRESS_THRESHOLD = 0.5;
const RING_LABEL_FADE_SCALE = 1.8;  // (progress - threshold) * scale -> alpha
const RING_DAY_LABEL_Y_OFFSET  = -4; // day-of-week nudged above label mid-point
const RING_DATE_LABEL_Y_OFFSET = 5;  // date nudged below label mid-point
const RING_EMOJI_PROGRESS_THRESHOLD = 0.7;
const RING_EMOJI_FADE_SCALE  = 3.3;
const RING_HOVER_OUTER_MARGIN = 18;  // px beyond outerRadius still considered "on segment"
const RING_AVG_FONT_SIZE     = 22;
const RING_AVG_NUMBER_Y_OFFSET = -5; // average value nudged up from center
const RING_AVG_LABEL_Y_OFFSET  = 11; // "7-DAY AVG" nudged down from center
const RING_TITLE_Y           = 13;

// Wave graph layout
const WAVE_PADDING_LEFT     = 26;
const WAVE_PADDING_RIGHT    = 10;
const WAVE_PADDING_TOP      = 30;
const WAVE_PADDING_BOTTOM   = 44;
const WAVE_AXIS_LABEL_X_GAP = 5;   // gap left of axis line for the numeric label
const WAVE_BEZIER_FRACTION  = 1 / 3; // control-point fraction for smooth bezier curves
const WAVE_ANIM_SCALE       = 1.3;  // progress multiplier for the upward "grow" animation
const WAVE_FILL_GRADIENT    = [     // [stop, color] pairs for the area-fill gradient
  [0,   '#27AE6050'],
  [0.5, '#F2C94C20'],
  [1,   '#E8453C08'],
];
const WAVE_LINE_WIDTH        = 2;
const WAVE_DOT_OUTER_RADIUS  = 3.5;
const WAVE_DOT_INNER_RADIUS  = 1.2;
const WAVE_DOT_SHADOW_BLUR   = 8;
const WAVE_DOT_PROGRESS_THRESHOLD = 0.3;
const WAVE_DOT_FADE_SCALE    = 2;    // (progress - threshold) * scale -> opacity
const WAVE_LABEL_OPACITY_SCALE = 1;
const WAVE_DAY_LABEL_Y_OFFSET  = 16; // px below graphHeight baseline
const WAVE_DATE_LABEL_Y_OFFSET = 28; // px below graphHeight baseline
const WAVE_EMOJI_PROGRESS_THRESHOLD = 0.7;
const WAVE_EMOJI_FADE_SCALE  = 3;
const WAVE_EMOJI_Y_OFFSET    = -11;  // px above the data point dot
const WAVE_TITLE_Y           = 14;
const WAVE_AVG_BADGE_RIGHT_MARGIN = 56;  // distance from right edge to badge left
const WAVE_AVG_BADGE_WIDTH   = 46;
const WAVE_AVG_BADGE_HEIGHT  = 16;
const WAVE_AVG_BADGE_RADIUS  = 8;
const WAVE_AVG_BADGE_TEXT_X_FROM_RIGHT = 33; // distance from right edge to badge text center
const WAVE_AVG_BADGE_TEXT_Y  = 12;
const WAVE_TWO_POINT_LEFT_X  = 0.25; // x-fraction for first of two points
const WAVE_TWO_POINT_RIGHT_X = 0.75; // x-fraction for second of two points
const WAVE_TOOLTIP_HIT_RADIUS = 25;  // max px from data point to trigger tooltip

// Animation durations
const RING_ANIM_DURATION_MS  = 1200;
const WAVE_ANIM_DURATION_MS  = 1000;
const ANIM_EASE_EXPONENT     = 3;    // cubic ease-out: 1 - (1-t)^3

const MOODS = [
  { value: -2, emoji: '😵‍💫', label: 'Awful' },
  { value: -1, emoji: '🫤', label: 'Bad' },
  { value: 0, emoji: '🙂', label: 'Okay' },
  { value: 1, emoji: '😀', label: 'Good' },
  { value: 2, emoji: '🤩', label: 'Great' },
];

// [Claude] Task: update viz color/emoji maps to use native -2..+2 scale
// Prompt: "update the mood wave visualization to be on a scale from -2 to +2 instead of 1 to 5"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
const VISUALIZATION_MOOD_COLORS = {
  '-2': '#E8453C',
  '-1': '#F2994A',
  '0': '#F2C94C',
  '1': '#6FCF97',
  '2': '#27AE60',
};

const VISUALIZATION_MOOD_EMOJIS = Object.fromEntries(
  MOODS.map((mood) => [mood.value, mood.emoji])
);

function visualizationMoodColor(vizValue) {
  return VISUALIZATION_MOOD_COLORS[Math.round(vizValue)] || '#ccc';
}

function visualizationMoodEmoji(vizValue) {
  return VISUALIZATION_MOOD_EMOJIS[Math.round(vizValue)] || '❓';
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: tooltip helpers for mood viz hover
// Prompt: "hovering on a date should show full date, ratings, times, and notes"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
function pluginMoodLabel(pluginValue) {
  const mood = MOODS.find(m => m.value === pluginValue);
  return mood ? mood.label : '';
}

// [Claude] Task: build tooltip HTML string for mood viz hover
// Prompt: "replace hand-rolled tooltips with tippy.js"
// Date: 2026-03-09 | Model: claude-4.6-opus-high-thinking
function buildMoodTooltipHTML(data) {
  if (!data) return '';
  const { fullDate, entries } = data;
  const parts = [`<div class="mood-viz-tooltip-date">${fullDate}</div>`];
  for (const entry of entries) {
    const emoji = MOODS.find(m => m.value === entry.rating)?.emoji || '❓';
    const label = pluginMoodLabel(entry.rating);
    let html = `<div class="mood-viz-tooltip-entry">` +
      `<span class="mood-viz-tooltip-time">${entry.time}</span>` +
      `<span class="mood-viz-tooltip-mood">${emoji} ${label}</span>`;
    if (entry.notes) {
      html += `<div class="mood-viz-tooltip-note">${entry.notes}</div>`;
    }
    html += '</div>';
    parts.push(html);
  }
  return parts.join('');
}

// [Claude] Task: standalone mood note persistence using real Amplenote API methods
// Prompt: "non-API saveMoodNote should be a standalone function using findNote/createNote/insertNoteContent"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
async function saveMoodNote(app, moodValue, moodLabel, moodNotes) {
  const historyNoteName = "Mood rating history";
  let noteHandle = await app.findNote({ name: historyNoteName });
  if (!noteHandle) {
    const uuid = await app.createNote(historyNoteName, [DASHBOARD_NOTE_TAG]);
    noteHandle = { uuid };
  }
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toTimeString().split(' ')[0];
  let entry = `\n## ${dateStr} ${timeStr}\n**Mood:** ${moodLabel} (${moodValue})\n`;
  if (moodNotes) entry += `**Notes:** ${moodNotes}\n`;
  await app.insertNoteContent(noteHandle, entry, { atEnd: true });
  return true;
}

// ---------------------------------------------------------------------------------------------------------
function handleMoodClick(mood, submitting, submitted, setSelectedMood) {
  if (submitting || submitted) return;
  setSelectedMood(mood);
}

// ---------------------------------------------------------------------------------------------------------
function handleTextareaKeyDown(app, event, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSubmit(app, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded);
  }
}

// ---------------------------------------------------------------------------------------------------------
async function handleSubmit(app, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded) {
  setSubmitting(true);
  try {
    await app.recordMoodRating(selectedMood.value);
    await saveMoodNote(app, selectedMood.value, selectedMood.label, notes.trim());
    setSubmitted(true);
    if (onMoodRecorded) {
      onMoodRecorded({ rating: selectedMood.value, timestamp: Math.floor(Date.now() / 1000) });
    }
  } catch (error) {
    logIfEnabled('Failed to record mood:', error);
  } finally {
    setSubmitting(false);
  }
}

// ---------------------------------------------------------------------------------------------------------
function computeAverageMood(moodRatings) {
  const recent = (moodRatings || []).slice(-AVERAGE_MOOD_WINDOW);
  if (!recent.length) return { recentMoods: recent, averageMood: '\u2014' };
  const average = (recent.reduce((sum, rating) => sum + rating.rating, 0) / recent.length).toFixed(1);
  return { recentMoods: recent, averageMood: average };
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: read dashboard CSS custom property theme colors at canvas draw-time
// Prompt: "utilize standardized theme-dark and theme-light colors for canvas visualizations"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
function readThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const get = (v) => style.getPropertyValue(v).trim();
  return {
    bgCard:        get('--dashboard-color-bg-card'),
    bgPage:        get('--dashboard-color-bg-page'),
    border:        get('--dashboard-color-border'),
    textSecondary: get('--dashboard-color-text-secondary'),
    textMuted:     get('--dashboard-color-text-muted'),
  };
}

// Produce a CSS color string with appended hex alpha (e.g. colorWithAlpha('#1f2937', '18'))
function colorWithAlpha(cssColor, hexAlpha) {
  // For hex colors append alpha; for rgb/rgba pass through with opacity via canvas globalAlpha instead
  if (cssColor.startsWith('#') && cssColor.length === 7) return cssColor + hexAlpha;
  return cssColor;
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: render past-week moods as animated radial ring with hover tooltip
// Prompt: "show dates, only animate on viz change, add hover tooltip with ratings/times/notes"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
function RadialRing({ moodData }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const geometryRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const tip = useCanvasTippy();
  const moodDataJson = JSON.stringify(moodData);

  useEffect(() => {
    setProgress(0);
    let frame;
    let start = null;
    const duration = RING_ANIM_DURATION_MS;
    const animate = (timestamp) => {
      if (!start) start = timestamp;
      const ratio = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - ratio, ANIM_EASE_EXPONENT);
      setProgress(eased);
      if (ratio < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [moodDataJson]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pixelRatio = window.devicePixelRatio || PIXEL_RATIO_FALLBACK;
    canvas.width = CANVAS_SIZE * pixelRatio;
    canvas.height = CANVAS_SIZE * pixelRatio;
    ctx.scale(pixelRatio, pixelRatio);
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const theme = readThemeColors();
    const centerX = CANVAS_SIZE / 2;
    const centerY = CANVAS_SIZE / 2 + RING_CENTER_Y_OFFSET;
    const outerRadius = RING_OUTER_RADIUS;
    const innerRadius = RING_INNER_RADIUS;

    ctx.fillStyle = theme.bgCard;
    ctx.beginPath();
    ctx.roundRect(0, 0, CANVAS_SIZE, CANVAS_SIZE, CANVAS_CORNER_RADIUS);
    ctx.fill();

    ctx.strokeStyle = colorWithAlpha(theme.border, '28');
    ctx.lineWidth = 1;
    for (let r = RING_GUIDE_START; r <= RING_GUIDE_END; r += RING_GUIDE_STEP) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const days = moodData.map((r) => ({
      label: r.dayLabel,
      dateLabel: r.dateLabel,
      val: r.rating,
    }));

    const segmentCount = Math.max(days.length, 1);
    const segmentAngle = (Math.PI * 2) / segmentCount;
    const gapAngle = days.length > 1 ? RING_GAP_ANGLE : 0;

    geometryRef.current = { centerX, centerY, innerRadius, outerRadius, segmentCount: days.length, segmentAngle, gapAngle };

    days.forEach(({ label, dateLabel, val }, i) => {
      const startAngle = -Math.PI / 2 + i * segmentAngle + gapAngle;
      const endAngle = startAngle + (segmentAngle - gapAngle * 2) * progress;
      const color = visualizationMoodColor(val);

      ctx.shadowColor = color;
      ctx.shadowBlur = RING_SHADOW_BLUR_SCALE * progress;

      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRadius, startAngle, endAngle);
      ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
      ctx.closePath();

      const grad = ctx.createRadialGradient(centerX, centerY, innerRadius, centerX, centerY, outerRadius);
      grad.addColorStop(0, color + '99');
      grad.addColorStop(1, color + 'ff');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (progress > RING_LABEL_PROGRESS_THRESHOLD) {
        const midAngle = startAngle + (segmentAngle - gapAngle * 2) / 2;
        const labelRadius = outerRadius + RING_LABEL_RADIUS_OFFSET;
        const labelX = centerX + Math.cos(midAngle) * labelRadius;
        const labelY = centerY + Math.sin(midAngle) * labelRadius;
        ctx.fillStyle = theme.textSecondary;
        ctx.globalAlpha = (progress - RING_LABEL_PROGRESS_THRESHOLD) * RING_LABEL_FADE_SCALE;
        ctx.font = 'bold 8px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, labelX, labelY + RING_DAY_LABEL_Y_OFFSET);
        ctx.font = '7px -apple-system, sans-serif';
        ctx.fillStyle = theme.textMuted;
        ctx.fillText(dateLabel, labelX, labelY + RING_DATE_LABEL_Y_OFFSET);
        ctx.globalAlpha = 1;
      }

      if (progress > RING_EMOJI_PROGRESS_THRESHOLD) {
        const midAngle2 = startAngle + (segmentAngle - gapAngle * 2) / 2;
        const emojiRadius = (outerRadius + innerRadius) / 2;
        const emojiX = centerX + Math.cos(midAngle2) * emojiRadius;
        const emojiY = centerY + Math.sin(midAngle2) * emojiRadius;
        ctx.font = '13px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = Math.min((progress - RING_EMOJI_PROGRESS_THRESHOLD) * RING_EMOJI_FADE_SCALE, 1);
        ctx.fillText(visualizationMoodEmoji(val), emojiX, emojiY);
        ctx.globalAlpha = 1;
      }
    });

    ctx.beginPath();
    ctx.arc(centerX, centerY, innerRadius - RING_INNER_HOLE_INSET, 0, Math.PI * 2);
    ctx.fillStyle = theme.bgPage;
    ctx.fill();

    if (days.length > 0) {
      const avg = (days.reduce((s, d) => s + d.val, 0) / days.length).toFixed(1);
      ctx.fillStyle = visualizationMoodColor(Math.round(Number(avg)));
      ctx.font = `bold ${RING_AVG_FONT_SIZE}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = progress;
      ctx.fillText(avg, centerX, centerY + RING_AVG_NUMBER_Y_OFFSET);

      ctx.fillStyle = theme.textMuted;
      ctx.font = 'bold 7px -apple-system, sans-serif';
      ctx.fillText('7-DAY AVG', centerX, centerY + RING_AVG_LABEL_Y_OFFSET);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = theme.textMuted;
    ctx.font = 'bold 8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('W E E K   R I N G', centerX, RING_TITLE_Y);
  }, [moodDataJson, progress]);

  const handleCanvasMouseMove = (e) => {
    const geo = geometryRef.current;
    const canvas = canvasRef.current;
    if (!geo || !geo.segmentCount || !canvas) { tip.hide(); return; }
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_SIZE / rect.height);
    const dx = mx - geo.centerX;
    const dy = my - geo.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < geo.innerRadius - RING_INNER_HOLE_INSET || dist > geo.outerRadius + RING_HOVER_OUTER_MARGIN) {
      tip.hide();
      return;
    }
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    const index = Math.floor(angle / geo.segmentAngle);
    if (index >= 0 && index < geo.segmentCount) {
      const entry = moodData[index];
      const screenX = rect.left + (mx / CANVAS_SIZE) * rect.width;
      const screenY = rect.top + (my / CANVAS_SIZE) * rect.height;
      tip.show(buildMoodTooltipHTML({ fullDate: entry.fullDate, entries: entry.entries || [entry] }), screenX, screenY);
    } else {
      tip.hide();
    }
  };

  const handleCanvasMouseLeave = () => tip.hide();

  return h('div', { style: { position: 'relative', lineHeight: 0 } },
    h('canvas', {
      ref: canvasRef,
      className: 'mood-viz-canvas',
      onMouseMove: handleCanvasMouseMove,
      onMouseLeave: handleCanvasMouseLeave,
    })
  );
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: render past-week moods as animated wave graph with hover tooltip
// Prompt: "show dates, only animate on viz change, add hover tooltip with ratings/times/notes"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
function WaveGraph({ moodData }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const pointsRef = useRef([]);
  const [progress, setProgress] = useState(0);
  const tip = useCanvasTippy();
  const moodDataJson = JSON.stringify(moodData);

  useEffect(() => {
    setProgress(0);
    let frame;
    let start = null;
    const duration = WAVE_ANIM_DURATION_MS;
    const animate = (timestamp) => {
      if (!start) start = timestamp;
      const ratio = Math.min((timestamp - start) / duration, 1);
      setProgress(1 - Math.pow(1 - ratio, ANIM_EASE_EXPONENT));
      if (ratio < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [moodDataJson]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pixelRatio = window.devicePixelRatio || PIXEL_RATIO_FALLBACK;
    canvas.width = CANVAS_SIZE * pixelRatio;
    canvas.height = CANVAS_SIZE * pixelRatio;
    ctx.scale(pixelRatio, pixelRatio);
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const theme = readThemeColors();

    ctx.beginPath();
    ctx.roundRect(0, 0, CANVAS_SIZE, CANVAS_SIZE, CANVAS_CORNER_RADIUS);
    ctx.fillStyle = theme.bgCard;
    ctx.fill();

    const paddingLeft   = WAVE_PADDING_LEFT;
    const paddingRight  = WAVE_PADDING_RIGHT;
    const paddingTop    = WAVE_PADDING_TOP;
    const paddingBottom = WAVE_PADDING_BOTTOM;
    const graphWidth  = CANVAS_SIZE - paddingLeft - paddingRight;
    const graphHeight = CANVAS_SIZE - paddingTop - paddingBottom;
    const graphBottom = paddingTop + graphHeight;

    for (let v = -2; v <= 2; v++) {
      const y = paddingTop + graphHeight - ((v + 2) / 4) * graphHeight;
      ctx.strokeStyle = colorWithAlpha(theme.border, '50');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(CANVAS_SIZE - paddingRight, y);
      ctx.stroke();
      ctx.fillStyle = theme.textMuted;
      ctx.font = 'bold 8px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(v > 0 ? `+${v}` : v, paddingLeft - WAVE_AXIS_LABEL_X_GAP, y);
    }

    const days = moodData.map((r) => ({
      label: r.dayLabel,
      dateLabel: r.dateLabel,
      val: r.rating,
    }));

    const xForIndex = (i, total) => {
      if (total === 1) return paddingLeft + graphWidth / 2;
      if (total === 2) return paddingLeft + graphWidth * (i === 0 ? WAVE_TWO_POINT_LEFT_X : WAVE_TWO_POINT_RIGHT_X);
      return paddingLeft + (i / (total - 1)) * graphWidth;
    };

    const points = days.map((d, i) => ({
      x: xForIndex(i, days.length),
      y: paddingTop + graphHeight - ((d.val + 2) / 4) * graphHeight,
      val: d.val,
      label: d.label,
      dateLabel: d.dateLabel,
    }));

    pointsRef.current = points;

    const animatedPoints = points.map((point) => ({
      ...point,
      y: paddingTop + graphHeight - ((point.val + 2) / 4) * graphHeight * Math.min(progress * WAVE_ANIM_SCALE, 1),
    }));

    const drawSmoothCurve = (curvePoints, closePath) => {
      ctx.beginPath();
      ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
      for (let i = 0; i < curvePoints.length - 1; i++) {
        const span = curvePoints[i + 1].x - curvePoints[i].x;
        const cp1x = curvePoints[i].x + span * WAVE_BEZIER_FRACTION;
        const cp2x = curvePoints[i + 1].x - span * WAVE_BEZIER_FRACTION;
        ctx.bezierCurveTo(cp1x, curvePoints[i].y, cp2x, curvePoints[i + 1].y, curvePoints[i + 1].x, curvePoints[i + 1].y);
      }
      if (closePath) {
        ctx.lineTo(curvePoints[curvePoints.length - 1].x, graphBottom);
        ctx.lineTo(curvePoints[0].x, graphBottom);
        ctx.closePath();
      }
    };

    if (animatedPoints.length >= 2) {
      const fillGradient = ctx.createLinearGradient(0, paddingTop, 0, graphBottom);
      for (const [stop, color] of WAVE_FILL_GRADIENT) {
        fillGradient.addColorStop(stop, color);
      }
      drawSmoothCurve(animatedPoints, true);
      ctx.fillStyle = fillGradient;
      ctx.fill();

      ctx.lineWidth = WAVE_LINE_WIDTH;
      ctx.lineCap = 'round';
      for (let i = 0; i < animatedPoints.length - 1; i++) {
        const p1 = animatedPoints[i];
        const p2 = animatedPoints[i + 1];
        const segmentGradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
        segmentGradient.addColorStop(0, visualizationMoodColor(p1.val));
        segmentGradient.addColorStop(1, visualizationMoodColor(p2.val));
        ctx.strokeStyle = segmentGradient;
        ctx.beginPath();
        const span = p2.x - p1.x;
        const cp1x = p1.x + span * WAVE_BEZIER_FRACTION;
        const cp2x = p2.x - span * WAVE_BEZIER_FRACTION;
        ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(cp1x, p1.y, cp2x, p2.y, p2.x, p2.y);
        ctx.stroke();
      }
    }

    if (progress > WAVE_DOT_PROGRESS_THRESHOLD) {
      animatedPoints.forEach((point) => {
        const opacity = Math.min((progress - WAVE_DOT_PROGRESS_THRESHOLD) * WAVE_DOT_FADE_SCALE, 1);
        const color = visualizationMoodColor(point.val);
        ctx.shadowColor = color;
        ctx.shadowBlur = WAVE_DOT_SHADOW_BLUR;
        ctx.beginPath();
        ctx.arc(point.x, point.y, WAVE_DOT_OUTER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(point.x, point.y, WAVE_DOT_INNER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = theme.bgCard;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = theme.textSecondary;
        ctx.globalAlpha = opacity * WAVE_LABEL_OPACITY_SCALE;
        ctx.font = 'bold 10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(point.label, point.x, graphBottom + WAVE_DAY_LABEL_Y_OFFSET);
        ctx.font = '9px -apple-system, sans-serif';
        ctx.fillText(point.dateLabel, point.x, graphBottom + WAVE_DATE_LABEL_Y_OFFSET);
        ctx.globalAlpha = 1;

        if (progress > WAVE_EMOJI_PROGRESS_THRESHOLD) {
          ctx.globalAlpha = Math.min((progress - WAVE_EMOJI_PROGRESS_THRESHOLD) * WAVE_EMOJI_FADE_SCALE, 1);
          ctx.font = '11px serif';
          ctx.fillText(visualizationMoodEmoji(point.val), point.x, point.y + WAVE_EMOJI_Y_OFFSET);
          ctx.globalAlpha = 1;
        }
      });
    }

    ctx.fillStyle = theme.textMuted;
    ctx.font = 'bold 8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('M O O D   W A V E', CANVAS_SIZE / 2, WAVE_TITLE_Y);

    if (days.length > 0) {
      const avg = (days.reduce((s, d) => s + d.val, 0) / days.length).toFixed(1);
      const avgColor = visualizationMoodColor(Math.round(Number(avg)));
      ctx.fillStyle = colorWithAlpha(avgColor, '22');
      ctx.beginPath();
      ctx.roundRect(CANVAS_SIZE - WAVE_AVG_BADGE_RIGHT_MARGIN, 4, WAVE_AVG_BADGE_WIDTH, WAVE_AVG_BADGE_HEIGHT, WAVE_AVG_BADGE_RADIUS);
      ctx.fill();
      ctx.fillStyle = avgColor;
      ctx.font = 'bold 8px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Avg ${avg}`, CANVAS_SIZE - WAVE_AVG_BADGE_TEXT_X_FROM_RIGHT, WAVE_AVG_BADGE_TEXT_Y);
    }
  }, [moodDataJson, progress]);

  const handleCanvasMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CANVAS_SIZE / rect.width);
    const my = (e.clientY - rect.top) * (CANVAS_SIZE / rect.height);
    const pts = pointsRef.current;
    if (!pts || !pts.length) { tip.hide(); return; }
    let closestIdx = -1;
    let minDist = WAVE_TOOLTIP_HIT_RADIUS;
    for (let i = 0; i < pts.length; i++) {
      const dx = mx - pts[i].x;
      const dy = my - pts[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) { minDist = dist; closestIdx = i; }
    }
    if (closestIdx >= 0) {
      const pt = pts[closestIdx];
      const entry = moodData[closestIdx];
      const screenX = rect.left + (pt.x / CANVAS_SIZE) * rect.width;
      const screenY = rect.top + (pt.y / CANVAS_SIZE) * rect.height;
      tip.show(buildMoodTooltipHTML({ fullDate: entry.fullDate, entries: entry.entries || [entry] }), screenX, screenY);
    } else {
      tip.hide();
    }
  };

  const handleCanvasMouseLeave = () => tip.hide();

  return h('div', { style: { position: 'relative', lineHeight: 0 } },
    h('canvas', {
      ref: canvasRef,
      className: 'mood-viz-canvas',
      onMouseMove: handleCanvasMouseMove,
      onMouseLeave: handleCanvasMouseLeave,
    })
  );
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: build mood data array grouped by day, sorted oldest-first, last 7 days
// Prompt: "wave graph is not ordering ratings by recency — show previous 7 days oldest-left newest-right"
// Date: 2026-03-08 | Model: claude-4.6-opus-high-thinking
function buildMoodData(moodRatings) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sorted = [...(moodRatings || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (sorted.length) {
    console.log("Found existing ratings")
  } else {
    console.log("No ratings found, returning []")
    return [];
  }

  const dayMap = new Map();
  for (const r of sorted) {
    const date = r.timestamp ? new Date(r.timestamp * 1000) : new Date();
    const dateKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, {
        dayLabel: dayNames[date.getDay()],
        dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
        dateKey,
        fullDate: date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        entries: [],
        ratingSum: 0,
        ratingCount: 0,
      });
    }
    const day = dayMap.get(dateKey);
    day.entries.push({
      rating: r.rating,
      time: (r.timestamp ? new Date(r.timestamp * 1000) : new Date())
        .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      notes: r.notes || r.note || null,
      timestamp: r.timestamp,
    });
    day.ratingSum += r.rating;
    day.ratingCount += 1;
  }

  const days = [...dayMap.values()].slice(-AVERAGE_MOOD_WINDOW);

  return days.map((d) => ({
    rating: d.ratingSum / d.ratingCount,
    dayLabel: d.dayLabel,
    dateLabel: d.dateLabel,
    dateKey: d.dateKey,
    fullDate: d.fullDate,
    time: d.entries[d.entries.length - 1].time,
    timestamp: d.entries[d.entries.length - 1].timestamp,
    notes: d.entries[d.entries.length - 1].notes,
    entries: d.entries,
  }));
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: render sparkline section dispatching to ring or wave viz based on active mode
// Prompt: "implement separate functions to render moods as either radial ring or wave graph"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
function renderSparkline(createElement, moodRatings, averageMood, visualizationMode, visualizationKey, onConfigure) {
  const h = createElement;

  if (!(moodRatings || []).length) {
    return h('div', { className: 'mood-summary' },
      h('span', null, 'Avg mood (7d): ' + averageMood)
    );
  }

  const moodData = buildMoodData(moodRatings);
  const visualization = visualizationMode === 'wave'
    ? h(WaveGraph, { key: visualizationKey, moodData })
    : h(RadialRing, { key: visualizationKey, moodData });

  return h('div', { className: 'mood-viz-section' },
    h('div', { className: 'mood-viz-canvas-wrap' }, visualization),
    h('button', { className: 'mood-viz-configure-link', onClick: onConfigure }, '⚙ Configure')
  );
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: mood widget with ring/wave viz toggle, Cancel button, and viz hidden while details open
// Prompt: "hide mood visualization while details textarea is open; add Cancel button alongside Submit"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
export default function MoodWidget({ app, moodRatings, onMoodRecorded }) {
  const h = createElement;
  const [selectedMood, setSelectedMood] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const moodConfig = parseWidgetConfig(app, 'mood');
  const savedVisualizationMode = moodConfig[0] || 'ring';
  const [visualizationMode, setVisualizationMode] = useState(savedVisualizationMode);
  const [pendingVisualizationMode, setPendingVisualizationMode] = useState(savedVisualizationMode);
  const [visualizationKey, setVisualizationKey] = useState(0);
  const [isConfigurationOpen, setIsConfigurationOpen] = useState(false);

  // [Claude] Task: auto-dismiss mood confirmation after 5s and return to selection UI
  // Prompt: "Update the 'Mood rating recorded' confirmation to fade out after 5 seconds and return to the original UI"
  // Date: 2026-03-07 | Model: claude-4.6-opus-high-thinking
  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => {
      setSubmitted(false);
      setSelectedMood(null);
      setNotes('');
    }, CONFIRMATION_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [submitted]);

  const handleConfigureOpen = () => {
    setPendingVisualizationMode(visualizationMode);
    setIsConfigurationOpen(true);
  };

  const handleConfigureSubmit = () => {
    setVisualizationMode(pendingVisualizationMode);
    setVisualizationKey((k) => k + 1);
    setIsConfigurationOpen(false);
    app.setSetting(widgetConfigKey('mood'), JSON.stringify([pendingVisualizationMode]));
  };

  const handleConfigureCancel = () => {
    setPendingVisualizationMode(visualizationMode);
    setIsConfigurationOpen(false);
  };

  const handleCancelMood = () => {
    setSelectedMood(null);
    setNotes('');
  };

  const { averageMood } = computeAverageMood(moodRatings);
  const sparkline = renderSparkline(h, moodRatings, averageMood, visualizationMode, visualizationKey, handleConfigureOpen);

  const configurationPopup = isConfigurationOpen
    ? h(ConfigPopup, {
        title: 'Mood Visualization',
        onSubmit: handleConfigureSubmit,
        onCancel: handleConfigureCancel,
        submitLabel: 'Apply',
      },
        h('div', { className: 'config-field' },
          h('div', { className: 'config-field-label' }, 'Display style'),
          [['ring', 'Ring'], ['wave', 'Wave']].map(([value, label]) =>
            h('label', { key: value, className: 'mood-viz-config-option' },
              h('input', {
                type: 'radio',
                name: 'mood-viz-mode',
                value,
                checked: pendingVisualizationMode === value,
                onChange: () => setPendingVisualizationMode(value),
              }),
              label
            )
          )
        )
      )
    : null;

  if (submitted) {
    return h(WidgetWrapper, { title: widgetTitleFromId('mood'), icon: '🎭', widgetId: 'mood' },
      configurationPopup,
      h('div', { className: 'mood-confirmation' },
        h('div', { className: 'mood-confirmation-icon' }, selectedMood.emoji),
        h('p', { className: 'mood-confirmation-text' }, 'Mood rating recorded')
      ),
      sparkline
    );
  }

  return h(WidgetWrapper, { title: widgetTitleFromId('mood'), icon: '🎭', widgetId: 'mood' },
    configurationPopup,
    h('div', { className: 'mood-selector' },
      MOODS.map(mood => h('button', {
        key: mood.value,
        className: 'mood-btn' + (selectedMood?.value === mood.value ? ' mood-btn--selected' : ''),
        title: mood.label,
        onClick: () => handleMoodClick(mood, submitting, submitted, setSelectedMood),
      }, h('span', { className: 'mood-emoji' }, mood.emoji)))
    ),
    selectedMood !== null && h('div', { className: 'mood-details' },
      h('label', { className: 'mood-details-label' }, 'More details (optional)'),
      h('textarea', {
        className: 'mood-details-textarea',
        value: notes,
        onChange: event => setNotes(event.target.value),
        onKeyDown: event => handleTextareaKeyDown(app, event, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded),
        placeholder: "What's on your mind?",
        rows: MOOD_TEXTAREA_ROWS,
      })
    ),
    selectedMood !== null && h('div', { className: 'mood-submit-row' },
      h('button', {
        className: 'mood-cancel-btn',
        onClick: handleCancelMood,
        disabled: submitting,
      }, 'Cancel'),
      h('button', {
        className: 'mood-submit-btn',
        onClick: () => handleSubmit(app, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded),
        disabled: submitting,
      }, submitting ? 'Recording...' : 'Submit'),
    ),
    selectedMood === null && sparkline
  );
}
