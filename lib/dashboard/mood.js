/**
 * [Claude-authored file]
 * Created: 2026-02-17 | Model: claude-sonnet-4-5-20250929
 * Task: Mood widget — emoji selector, average, and sparkline visualization
 * Prompt summary: "widget displaying mood buttons, 7-day average, and sparkline visualization"
 */
import { createElement, useEffect, useRef, useState } from "react";
import ConfigPopup from "config-popup";
import WidgetWrapper from "widget-wrapper";
import { widgetTitleFromId } from "constants/settings";

const CONFIRMATION_DISPLAY_MS = 5000;

const MOODS = [
  { value: -2, emoji: '\u{1F622}', label: 'Awful' },
  { value: -1, emoji: '\u{1F61F}', label: 'Bad' },
  { value: 0, emoji: '\u{1F610}', label: 'Okay' },
  { value: 1, emoji: '\u{1F642}', label: 'Good' },
  { value: 2, emoji: '\u{1F604}', label: 'Great' }
];

// Plugin mood values run -2..+2; canvas viz expects 1..5
// [Claude] Task: map plugin mood scale (-2..+2) to canvas viz scale (1..5)
// Prompt: "implement separate functions to render moods as either radial ring or wave graph"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
function toVizScale(pluginValue) {
  return pluginValue + 3;
}

const VIZ_MOOD_COLORS = {
  1: '#E8453C',
  2: '#F2994A',
  3: '#F2C94C',
  4: '#6FCF97',
  5: '#27AE60',
};

const VIZ_MOOD_EMOJIS = {
  1: '\u{1F622}',
  2: '\u{1F61F}',
  3: '\u{1F610}',
  4: '\u{1F642}',
  5: '\u{1F604}',
};

function vizMoodColor(val) {
  return VIZ_MOOD_COLORS[val] || '#ccc';
}

function vizMoodEmoji(val) {
  return VIZ_MOOD_EMOJIS[val] || '❓';
}

// ---------------------------------------------------------------------------------------------------------
function handleMoodClick(mood, submitting, submitted, setSelectedMood) {
  if (submitting || submitted) return;
  setSelectedMood(mood);
}

// ---------------------------------------------------------------------------------------------------------
function handleTextareaKeyDown(event, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSubmit(selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded);
  }
}

// ---------------------------------------------------------------------------------------------------------
async function handleSubmit(selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded) {
  setSubmitting(true);
  try {
    await callPlugin('recordMoodRating', selectedMood.value);
    await callPlugin('saveMoodNote', selectedMood.value, selectedMood.label, notes.trim());
    setSubmitted(true);
    if (onMoodRecorded) {
      onMoodRecorded({ rating: selectedMood.value, timestamp: Math.floor(Date.now() / 1000) });
    }
  } catch (error) {
    console.error('Failed to record mood:', error);
  } finally {
    setSubmitting(false);
  }
}

// ---------------------------------------------------------------------------------------------------------
function computeAverageMood(moodRatings) {
  const recent = (moodRatings || []).slice(-7);
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
// [Claude] Task: render past-week moods as an animated radial ring on canvas
// Prompt: "utilize standardized theme-dark and theme-light colors; render with 0-2 mood ratings"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
function RadialRing({ moodData }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
    let frame;
    let start = null;
    const duration = 1200;
    const animate = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setProgress(eased);
      if (p < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [moodData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 220;
    const dpr = window.devicePixelRatio || 2;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const theme = readThemeColors();
    const cx = size / 2;
    const cy = size / 2 + 4;
    const outerR = 78;
    const innerR = 40;

    // Background using theme card color
    ctx.fillStyle = theme.bgCard;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, 14);
    ctx.fill();

    // Subtle guide rings using theme border color
    ctx.strokeStyle = colorWithAlpha(theme.border, '28');
    ctx.lineWidth = 1;
    for (let r = 48; r <= 95; r += 16) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const days = moodData.map((r) => ({
      label: r.dayLabel,
      val: toVizScale(r.rating),
    }));

    // With 0 or 1 data points the ring just draws the center info; segments need ≥1
    const n = Math.max(days.length, 1);
    const segAngle = (Math.PI * 2) / n;
    const gapAngle = days.length > 1 ? 0.04 : 0;

    days.forEach(({ label, val }, i) => {
      const startAngle = -Math.PI / 2 + i * segAngle + gapAngle;
      const endAngle = startAngle + (segAngle - gapAngle * 2) * progress;
      const color = vizMoodColor(val);

      ctx.shadowColor = color;
      ctx.shadowBlur = 12 * progress;

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();

      const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
      grad.addColorStop(0, color + '99');
      grad.addColorStop(1, color + 'ff');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (progress > 0.5) {
        const midAngle = startAngle + (segAngle - gapAngle * 2) / 2;
        const lx = cx + Math.cos(midAngle) * (outerR + 11);
        const ly = cy + Math.sin(midAngle) * (outerR + 11);
        ctx.fillStyle = theme.textSecondary;
        ctx.globalAlpha = (progress - 0.5) * 1.8;
        ctx.font = 'bold 8px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx, ly);
        ctx.globalAlpha = 1;
      }

      if (progress > 0.7) {
        const midAngle2 = startAngle + (segAngle - gapAngle * 2) / 2;
        const emojiR = (outerR + innerR) / 2;
        const ex = cx + Math.cos(midAngle2) * emojiR;
        const ey = cy + Math.sin(midAngle2) * emojiR;
        ctx.font = '13px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = Math.min((progress - 0.7) * 3.3, 1);
        ctx.fillText(vizMoodEmoji(val), ex, ey);
        ctx.globalAlpha = 1;
      }
    });

    // Center circle using theme page background
    ctx.beginPath();
    ctx.arc(cx, cy, innerR - 4, 0, Math.PI * 2);
    ctx.fillStyle = theme.bgPage;
    ctx.fill();

    if (days.length > 0) {
      const avg = (days.reduce((s, d) => s + d.val, 0) / days.length).toFixed(1);
      ctx.fillStyle = vizMoodColor(Math.round(Number(avg)));
      ctx.font = 'bold 22px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = progress;
      ctx.fillText(avg, cx, cy - 5);

      ctx.fillStyle = theme.textMuted;
      ctx.font = 'bold 7px -apple-system, sans-serif';
      ctx.fillText('7-DAY AVG', cx, cy + 11);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = theme.textMuted;
    ctx.font = 'bold 8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('W E E K   R I N G', cx, 13);
  }, [moodData, progress]);

  return h('canvas', {
    ref: canvasRef,
    className: 'mood-viz-canvas',
  });
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: render past-week moods as an animated wave graph on canvas
// Prompt: "utilize standardized theme-dark and theme-light colors; render with 0-2 mood ratings"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
function WaveGraph({ moodData }) {
  const h = createElement;
  const canvasRef = useRef(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
    let frame;
    let start = null;
    const duration = 1000;
    const animate = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [moodData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = 220, H = 220;
    const dpr = window.devicePixelRatio || 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const theme = readThemeColors();

    // Background using theme card color
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 14);
    ctx.fillStyle = theme.bgCard;
    ctx.fill();

    const padL = 26, padR = 10, padT = 30, padB = 30;
    const graphW = W - padL - padR;
    const graphH = H - padT - padB;

    // Grid lines using theme border, axis labels using theme text-muted
    for (let v = 1; v <= 5; v++) {
      const y = padT + graphH - ((v - 1) / 4) * graphH;
      ctx.strokeStyle = colorWithAlpha(theme.border, '50');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = theme.textMuted;
      ctx.font = 'bold 8px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(v, padL - 5, y);
    }

    const days = moodData.map((r) => ({ label: r.dayLabel, val: toVizScale(r.rating) }));

    // Space points evenly; with 1 point center it; with 2 place at 25%/75% to avoid degenerate bezier
    const xForIndex = (i, total) => {
      if (total === 1) return padL + graphW / 2;
      if (total === 2) return padL + graphW * (i === 0 ? 0.25 : 0.75);
      return padL + (i / (total - 1)) * graphW;
    };

    const points = days.map((d, i) => ({
      x: xForIndex(i, days.length),
      y: padT + graphH - ((d.val - 1) / 4) * graphH,
      val: d.val,
      label: d.label,
    }));

    const animPoints = points.map((p) => ({
      ...p,
      y: padT + graphH - ((p.val - 1) / 4) * graphH * Math.min(progress * 1.3, 1),
    }));

    const drawSmoothCurve = (pts, close) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const cp1x = pts[i].x + (pts[i + 1].x - pts[i].x) / 3;
        const cp2x = pts[i + 1].x - (pts[i + 1].x - pts[i].x) / 3;
        ctx.bezierCurveTo(cp1x, pts[i].y, cp2x, pts[i + 1].y, pts[i + 1].x, pts[i + 1].y);
      }
      if (close) {
        ctx.lineTo(pts[pts.length - 1].x, padT + graphH);
        ctx.lineTo(pts[0].x, padT + graphH);
        ctx.closePath();
      }
    };

    // Gradient fill and curve line only when there are ≥2 points
    if (animPoints.length >= 2) {
      const fillGrad = ctx.createLinearGradient(0, padT, 0, padT + graphH);
      fillGrad.addColorStop(0, '#27AE6050');
      fillGrad.addColorStop(0.5, '#F2C94C20');
      fillGrad.addColorStop(1, '#E8453C08');
      drawSmoothCurve(animPoints, true);
      ctx.fillStyle = fillGrad;
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < animPoints.length - 1; i++) {
        const p1 = animPoints[i];
        const p2 = animPoints[i + 1];
        const segGrad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
        segGrad.addColorStop(0, vizMoodColor(p1.val));
        segGrad.addColorStop(1, vizMoodColor(p2.val));
        ctx.strokeStyle = segGrad;
        ctx.beginPath();
        const cp1x = p1.x + (p2.x - p1.x) / 3;
        const cp2x = p2.x - (p2.x - p1.x) / 3;
        ctx.moveTo(p1.x, p1.y);
        ctx.bezierCurveTo(cp1x, p1.y, cp2x, p2.y, p2.x, p2.y);
        ctx.stroke();
      }
    }

    if (progress > 0.3) {
      animPoints.forEach((p) => {
        const opacity = Math.min((progress - 0.3) * 2, 1);
        const color = vizMoodColor(p.val);
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = opacity;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = theme.bgCard;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Day label using theme text-secondary
        ctx.fillStyle = theme.textSecondary;
        ctx.globalAlpha = opacity * 0.85;
        ctx.font = 'bold 8px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(p.label, p.x, padT + graphH + 16);
        ctx.globalAlpha = 1;

        if (progress > 0.7) {
          ctx.globalAlpha = Math.min((progress - 0.7) * 3, 1);
          ctx.font = '11px serif';
          ctx.fillText(vizMoodEmoji(p.val), p.x, p.y - 11);
          ctx.globalAlpha = 1;
        }
      });
    }

    // Title using theme text-muted
    ctx.fillStyle = theme.textMuted;
    ctx.font = 'bold 8px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('M O O D   W A V E', W / 2, 14);

    if (days.length > 0) {
      const avg = (days.reduce((s, d) => s + d.val, 0) / days.length).toFixed(1);
      const avgColor = vizMoodColor(Math.round(Number(avg)));
      ctx.fillStyle = colorWithAlpha(avgColor, '22');
      ctx.beginPath();
      ctx.roundRect(W - 56, 4, 46, 16, 8);
      ctx.fill();
      ctx.fillStyle = avgColor;
      ctx.font = 'bold 8px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Avg ${avg}`, W - 33, 12);
    }
  }, [moodData, progress]);

  return h('canvas', {
    ref: canvasRef,
    className: 'mood-viz-canvas',
  });
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: build mood data array with day labels from recent mood ratings
// Prompt: "implement separate functions to render moods as either radial ring or wave graph"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
function buildMoodData(recentMoods) {
  const dayAbbrevs = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return recentMoods.map((r) => {
    const date = r.timestamp ? new Date(r.timestamp * 1000) : new Date();
    return { rating: r.rating, dayLabel: dayAbbrevs[date.getDay()] };
  });
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: render sparkline section dispatching to ring or wave viz based on active mode
// Prompt: "implement separate functions to render moods as either radial ring or wave graph"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
function renderSparkline(createElement, recentMoods, averageMood, vizMode, vizKey, onConfigure) {
  const h = createElement;

  if (!recentMoods.length) {
    return h('div', { className: 'mood-summary' },
      h('span', null, 'Avg mood (7d): ' + averageMood)
    );
  }

  const moodData = buildMoodData(recentMoods);
  const viz = vizMode === 'wave'
    ? h(WaveGraph, { key: vizKey, moodData })
    : h(RadialRing, { key: vizKey, moodData });

  return h('div', { className: 'mood-viz-section' },
    h('div', { className: 'mood-viz-canvas-wrap' }, viz),
    h('button', { className: 'mood-viz-configure-link', onClick: onConfigure }, '\u2699 Configure')
  );
}

// ---------------------------------------------------------------------------------------------------------
// [Claude] Task: mood widget with ring/wave viz toggle, Cancel button, and viz hidden while details open
// Prompt: "hide mood visualization while details textarea is open; add Cancel button alongside Submit"
// Date: 2026-03-07 | Model: claude-4.6-sonnet-medium-thinking
export default function MoodWidget({ moodRatings, onMoodRecorded, settings }) {
  const h = createElement;
  const [selectedMood, setSelectedMood] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const savedVizMode = settings?.['dashboard_mood_config']?.[0] || 'ring';
  const [vizMode, setVizMode] = useState(savedVizMode);
  const [pendingVizMode, setPendingVizMode] = useState(savedVizMode);
  const [vizKey, setVizKey] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);

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
    setPendingVizMode(vizMode);
    setConfigOpen(true);
  };

  const handleConfigureSubmit = () => {
    setVizMode(pendingVizMode);
    setVizKey((k) => k + 1);
    setConfigOpen(false);
    callPlugin('saveSetting', 'mood', [pendingVizMode]);
  };

  const handleConfigureCancel = () => {
    setPendingVizMode(vizMode);
    setConfigOpen(false);
  };

  const handleCancelMood = () => {
    setSelectedMood(null);
    setNotes('');
  };

  const { recentMoods, averageMood } = computeAverageMood(moodRatings);
  const sparkline = renderSparkline(h, recentMoods, averageMood, vizMode, vizKey, handleConfigureOpen);

  const configPopup = configOpen
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
                checked: pendingVizMode === value,
                onChange: () => setPendingVizMode(value),
              }),
              label
            )
          )
        )
      )
    : null;

  if (submitted) {
    return h(WidgetWrapper, { title: widgetTitleFromId('mood'), icon: '\u{1F3AD}', widgetId: 'mood' },
      configPopup,
      h('div', { className: 'mood-confirmation' },
        h('div', { className: 'mood-confirmation-icon' }, selectedMood.emoji),
        h('p', { className: 'mood-confirmation-text' }, 'Mood rating recorded')
      ),
      sparkline
    );
  }

  return h(WidgetWrapper, { title: widgetTitleFromId('mood'), icon: '\u{1F3AD}', widgetId: 'mood' },
    configPopup,
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
        onChange: (event) => setNotes(event.target.value),
        onKeyDown: (event) => handleTextareaKeyDown(event, selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded),
        placeholder: "What's on your mind?",
        rows: 3,
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
        onClick: () => handleSubmit(selectedMood, notes, setSubmitting, setSubmitted, onMoodRecorded),
        disabled: submitting,
      }, submitting ? 'Recording...' : 'Submit'),
    ),
    selectedMood === null && sparkline
  );
}
