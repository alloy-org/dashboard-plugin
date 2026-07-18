/**
 * [Claude-authored file]
 * Created: 2026-07-17 | Model: claude-opus-4-8 (1M context)
 * Task: Energy Per Habit widget — mood delta per habit over the trailing ~365 days
 * Prompt summary: "new energy-per-habit component styled like the 'Mood delta per habit' mockup"
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import WidgetWrapper from "widget-wrapper";
import { noteUrlFromUUID } from "app-util";
import { widgetTitleFromId } from "constants/settings";
import { logIfEnabled } from "util/log";
import { formatDelta, HABIT_ANALYSIS_WINDOW_DAYS } from "energy-per-habit-analysis";
import { loadEnergyPerHabit } from "energy-per-habit-service";
import "styles/energy-per-habit.scss";

const WIDGET_ID = 'energy-per-habit';

// Number of habits to render (mockup shows the strongest handful; keeps the tile readable).
const MAX_HABIT_ROWS = 8;

// Fallback icon plus keyword→emoji hints so common habits get a recognizable glyph like the mockup.
const HABIT_ICON_FALLBACK = '🔁';
const HABIT_ICON_HINTS = [
  { pattern: /exercise|workout|gym|jog|run|lift/, icon: '⚡' },
  { pattern: /walk|outside|outdoor|steps/, icon: '☀️' },
  { pattern: /inbox|email|zero/, icon: '📥' },
  { pattern: /read|book|study/, icon: '📖' },
  { pattern: /deep work|focus|write|writing/, icon: '🎯' },
  { pattern: /screen|phone|social|digital/, icon: '🌙' },
  { pattern: /late.?night|night|midnight/, icon: '🌜' },
  { pattern: /meditat|breath|mindful|yoga/, icon: '🧘' },
  { pattern: /sleep|bed|rest/, icon: '😴' },
  { pattern: /water|hydrat|drink/, icon: '💧' },
  { pattern: /plan|review|journal/, icon: '📝' },
];

// ------------------------------------------------------------------------------------------
// @desc Pick a habit icon from its label using keyword hints, defaulting to a generic glyph.
// @param {string} label - Habit display label.
// @returns {string} Emoji icon.
function habitIcon(label) {
  const lower = (label || '').toLowerCase();
  for (const { pattern, icon } of HABIT_ICON_HINTS) {
    if (pattern.test(lower)) return icon;
  }
  return HABIT_ICON_FALLBACK;
}

// ------------------------------------------------------------------------------------------
// @desc Human "ongoing weeks completed" streak label. A live streak reads "N-week streak"; zero reads as no
//   active streak so a stale row isn't mislabeled as a fresh one.
// @param {number} weeks - Consecutive weeks the habit was completed at least once (ending now).
// @returns {string}
function weekStreakLabel(weeks) {
  const count = Number(weeks) || 0;
  if (count <= 0) return 'no active streak';
  return `${count}-week streak`;
}

// ------------------------------------------------------------------------------------------
// @desc Format one side of the bar's hover tooltip: the average mood and how many rated days it averages over.
// @param {string} sideLabel - "completed" or "not completed".
// @param {number} avg - Average mood rating on that side.
// @param {number} count - Number of rated days on that side.
// @returns {string}
function barTooltipSide(sideLabel, avg, count) {
  const days = count === 1 ? 'day' : 'days';
  return `${sideLabel}: ${formatDelta(avg)} avg over ${count} rated ${days}`;
}

// ------------------------------------------------------------------------------------------
// @desc Build the hover tooltip for a habit's mood-delta bar: the average and rating count on days the habit
//   was completed vs. days it was not.
// @param {Object} habit - Habit with avgMoodOnDone, avgMoodOnOff, doneWithMood, offWithMood.
// @returns {string}
function barTooltip(habit) {
  return `${barTooltipSide('When completed', habit.avgMoodOnDone, habit.doneWithMood)}\n`
    + `${barTooltipSide('When not completed', habit.avgMoodOnOff, habit.offWithMood)}`;
}

// ------------------------------------------------------------------------------------------
// @desc Render a single habit row: icon, label, "N/window days · X-week streak" meta, a diverging bar (right
//   of the zero axis for positive delta, left + magenta for negative), and the value. When the habit carries
//   a note reference the label is a click-through that opens the task's note, and its title shows the full
//   task text on hover. Hovering the bar shows the avg + count of mood ratings on completed vs. off days.
// @param {Object} props - { habit, windowDays, maxAbsDelta, onOpen }
// @returns {JSX.Element}
function HabitRow({ habit, windowDays, maxAbsDelta, onOpen }) {
  const positive = habit.delta >= 0;
  const widthPct = maxAbsDelta > 0 ? Math.min(100, (Math.abs(habit.delta) / maxAbsDelta) * 100) : 0;
  const clickable = Boolean(habit.noteUUID);
  const fullText = habit.fullText || habit.label;
  const labelClass = `eph-row-label${clickable ? ' eph-row-label--link' : ''}`;
  const barTitle = barTooltip(habit);
  return (
    <div className="eph-row">
      <div className="eph-row-lead">
        <span className="eph-row-icon" aria-hidden="true">{habitIcon(habit.label)}</span>
        <div className="eph-row-text">
          <div
            className={labelClass}
            title={fullText}
            role={clickable ? 'link' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => onOpen(habit) : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(habit); } } : undefined}
          >{habit.label}</div>
          <div className="eph-row-meta">{`${habit.daysDone}/${windowDays} days · ${weekStreakLabel(habit.weekStreak)}`}</div>
        </div>
      </div>
      <div className="eph-row-track">
        <div className="eph-row-axis" />
        <div className="eph-row-bar-half eph-row-bar-half--neg" title={barTitle}>
          {!positive && (
            <div
              className="eph-row-bar eph-row-bar--neg"
              style={{ width: `${widthPct}%` }}
            />
          )}
        </div>
        <div className="eph-row-bar-half eph-row-bar-half--pos" title={barTitle}>
          {positive && (
            <div
              className="eph-row-bar eph-row-bar--pos"
              style={{ width: `${widthPct}%` }}
            />
          )}
        </div>
      </div>
      <div className={`eph-row-value ${positive ? 'eph-row-value--pos' : 'eph-row-value--neg'}`}>
        {formatDelta(habit.delta)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Energy Per Habit widget. Loads its analysis via the cache-backed service (per-month completion
//   tables in an archived note, only the current + un-cached months re-fetched), groups completed tasks
//   into habits by text, and charts each habit's mood delta (avg mood on days done vs. days not done) as
//   a diverging bar list.
// @param {Object} props - { app }
// @returns {JSX.Element}
export default function EnergyPerHabitWidget({ app }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    setLoading(true);
    loadEnergyPerHabit(app).then(result => {
      if (cancelled) return;
      setAnalysis(result);
      setLoading(false);
    }).catch(err => {
      logIfEnabled(`[${WIDGET_ID}] failed to load habit data`, err);
      if (!cancelled) {
        setAnalysis({ habits: [], windowDays: HABIT_ANALYSIS_WINDOW_DAYS });
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [app]);

  const rows = useMemo(() => (analysis?.habits || []).slice(0, MAX_HABIT_ROWS), [analysis]);
  const maxAbsDelta = useMemo(
    () => rows.reduce((max, h) => Math.max(max, Math.abs(h.delta)), 0),
    [rows]
  );

  // Open the note containing the habit's most-recent completed task (matches graveyard's note navigation).
  const onOpenHabit = useCallback((habit) => {
    if (!app || !habit?.noteUUID) return;
    app.navigate(noteUrlFromUUID(habit.noteUUID));
  }, [app]);

  const windowDays = analysis?.windowDays || HABIT_ANALYSIS_WINDOW_DAYS;

  if (loading) {
    return (
      <WidgetWrapper title={widgetTitleFromId(WIDGET_ID)} icon="⚡" widgetId={WIDGET_ID}>
        <div className="eph-empty">Analyzing your habits…</div>
      </WidgetWrapper>
    );
  }

  if (!rows.length) {
    return (
      <WidgetWrapper title={widgetTitleFromId(WIDGET_ID)} icon="⚡" widgetId={WIDGET_ID}>
        <div className="eph-empty">
          <p>No recurring-task habits with enough mood history to correlate yet.</p>
          <p className="eph-empty-hint">Set tasks to repeat and log your mood over time to see which habits lift your days.</p>
        </div>
      </WidgetWrapper>
    );
  }

  return (
    <WidgetWrapper title={widgetTitleFromId(WIDGET_ID)} icon="⚡" widgetId={WIDGET_ID}>
      <div className="eph-header">
        <div className="eph-eyebrow">{`${windowDays} DAYS ANALYZED`}</div>
      </div>
      <div className="eph-chart">
        <div className="eph-zero-line"><span className="eph-zero-label">0</span></div>
        <div className="eph-rows">
          {rows.map(habit => (
            <HabitRow key={habit.key} habit={habit} windowDays={windowDays} maxAbsDelta={maxAbsDelta} onOpen={onOpenHabit} />
          ))}
        </div>
      </div>
    </WidgetWrapper>
  );
}
