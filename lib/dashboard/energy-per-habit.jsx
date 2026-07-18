/**
 * [Claude-authored file]
 * Created: 2026-07-17 | Model: claude-opus-4-8 (1M context)
 * Task: Energy Per Habit widget — mood delta per recurring-task habit over the trailing ~365 days
 * Prompt summary: "new energy-per-habit component styled like the 'Mood delta per habit' mockup;
 *   fetch all completed tasks + 6 months of mood ratings with timing logs"
 */
import { useEffect, useMemo, useState } from "react";
import WidgetWrapper from "widget-wrapper";
import { widgetTitleFromId } from "constants/settings";
import { logIfEnabled } from "util/log";
import { analyzeHabitMoodDeltas, formatDelta, HABIT_ANALYSIS_WINDOW_DAYS } from "energy-per-habit-analysis";
import "styles/energy-per-habit.scss";

const WIDGET_ID = 'energy-per-habit';

// Six months of trailing mood history, expressed in seconds, for the getMoodRatings `from` bound.
const MOOD_WINDOW_DAYS = 183;
const SECONDS_PER_DAY = 86400;

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
// @desc Fetch all completed tasks over the analysis window and six months of mood ratings,
//   logging the wall-clock timing of each retrieval so the two fetches can be evaluated.
// @param {Object} app - Amplenote app interface.
// @returns {Promise<{completedTasks: Array, moodRatings: Array}>}
async function fetchHabitData(app) {
  const nowSec = Math.floor(Date.now() / 1000);
  const tasksFrom = nowSec - HABIT_ANALYSIS_WINDOW_DAYS * SECONDS_PER_DAY;
  const moodFrom = nowSec - MOOD_WINDOW_DAYS * SECONDS_PER_DAY;

  const tasksStart = performance.now();
  logIfEnabled(`[${WIDGET_ID}] fetching completed tasks from ${new Date(tasksFrom * 1000).toISOString()} to now`);
  const completedTasks = await app.getCompletedTasks(tasksFrom, nowSec).then(r => Array.isArray(r) ? r : []);
  logIfEnabled(`[${WIDGET_ID}] completed tasks: ${completedTasks.length} in ${(performance.now() - tasksStart).toFixed(1)}ms`);

  const moodStart = performance.now();
  logIfEnabled(`[${WIDGET_ID}] fetching mood ratings from ${new Date(moodFrom * 1000).toISOString()} (${MOOD_WINDOW_DAYS} days)`);
  const moodRatings = await app.getMoodRatings(moodFrom).then(r => Array.isArray(r) ? r : []);
  logIfEnabled(`[${WIDGET_ID}] mood ratings: ${moodRatings.length} in ${(performance.now() - moodStart).toFixed(1)}ms`);

  return { completedTasks, moodRatings };
}

// ------------------------------------------------------------------------------------------
// @desc Render a single habit row: icon, label, "N/window days · X-day streak" meta, a diverging
//   bar (right of the zero axis for positive delta, left + magenta for negative), and the value.
// @param {Object} props - { habit, windowDays, maxAbsDelta }
// @returns {JSX.Element}
function HabitRow({ habit, windowDays, maxAbsDelta }) {
  const positive = habit.delta >= 0;
  const widthPct = maxAbsDelta > 0 ? Math.min(100, (Math.abs(habit.delta) / maxAbsDelta) * 100) : 0;
  const streakLabel = `${habit.streak}-day streak`;
  return (
    <div className="eph-row">
      <div className="eph-row-lead">
        <span className="eph-row-icon" aria-hidden="true">{habitIcon(habit.label)}</span>
        <div className="eph-row-text">
          <div className="eph-row-label" title={habit.label}>{habit.label}</div>
          <div className="eph-row-meta">{`${habit.daysDone}/${windowDays} days · ${streakLabel}`}</div>
        </div>
      </div>
      <div className="eph-row-track">
        <div className="eph-row-axis" />
        <div className="eph-row-bar-half eph-row-bar-half--neg">
          {!positive && (
            <div
              className="eph-row-bar eph-row-bar--neg"
              style={{ width: `${widthPct}%` }}
            />
          )}
        </div>
        <div className="eph-row-bar-half eph-row-bar-half--pos">
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
// @desc Energy Per Habit widget. Self-fetches every completed task over the trailing analysis
//   window plus six months of mood ratings, groups recurring tasks into habits, and charts each
//   habit's mood delta (avg mood on days done vs. days not done) as a diverging bar list.
// @param {Object} props - { app }
// @returns {JSX.Element}
export default function EnergyPerHabitWidget({ app }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    setLoading(true);
    const start = performance.now();
    fetchHabitData(app).then(result => {
      if (cancelled) return;
      logIfEnabled(`[${WIDGET_ID}] total data retrieval in ${(performance.now() - start).toFixed(1)}ms`);
      setData(result);
      setLoading(false);
    }).catch(err => {
      logIfEnabled(`[${WIDGET_ID}] failed to load habit data`, err);
      if (!cancelled) { setData({ completedTasks: [], moodRatings: [] }); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [app]);

  const analysis = useMemo(() => {
    if (!data) return null;
    return analyzeHabitMoodDeltas({ completedTasks: data.completedTasks, moodRatings: data.moodRatings });
  }, [data]);

  const rows = useMemo(() => (analysis?.habits || []).slice(0, MAX_HABIT_ROWS), [analysis]);
  const maxAbsDelta = useMemo(
    () => rows.reduce((max, h) => Math.max(max, Math.abs(h.delta)), 0),
    [rows]
  );

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
        <div className="eph-title">Mood delta per habit</div>
      </div>
      <div className="eph-chart">
        <div className="eph-zero-line"><span className="eph-zero-label">0</span></div>
        <div className="eph-rows">
          {rows.map(habit => (
            <HabitRow key={habit.key} habit={habit} windowDays={windowDays} maxAbsDelta={maxAbsDelta} />
          ))}
        </div>
      </div>
      <div className="eph-footnote">
        <strong>Read with care.</strong> Correlation isn't causation. A large sustained delta over
        hundreds of days is a strong nudge — but a habit may be a <em>correlate</em> of already-good
        days rather than a cause of them.
      </div>
    </WidgetWrapper>
  );
}
