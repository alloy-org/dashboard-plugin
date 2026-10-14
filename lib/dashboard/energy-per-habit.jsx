/**
 * [Claude-authored file]
 * Created: 2026-07-17 | Model: claude-opus-4-8 (1M context)
 * Task: Energy Per Habit widget — mood delta per habit over the trailing ~365 days
 * Prompt summary: "new energy-per-habit component styled like the 'Mood delta per habit' mockup"
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import WidgetWrapper from "widget-wrapper";
import { noteUrlFromUUID } from "app-util";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import { logIfEnabled } from "util/log";
import { formatDelta, HABIT_ANALYSIS_WINDOW_DAYS, leadingEmoji, stripLeadingEmoji } from "energy-per-habit-analysis";
import { STATS_CHART_TOOLTIP_OPTIONS, statsChartTooltipHtml } from "dashboard/charts/stats-chart-tooltip";
import { useCanvasTippy } from "dashboard/dashboard-tooltip-tippy";
import { loadEnergyPerHabit } from "energy-per-habit-service";
import MaterialIcon from "material-icon";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import "styles/energy-per-habit.scss";

const WIDGET_ID = 'energy-per-habit';

// Number of habits to render (mockup shows the strongest handful; keeps the tile readable).
const MAX_HABIT_ROWS = 8;
const ROUND_UP_TO_YEAR_ABOVE = 330;

// Fallback icon plus keyword hints so common habits get a recognizable Material icon.
const HABIT_ICON_FALLBACK = 'repeat';
const HABIT_ICON_HINTS = [
  { pattern: /exercise|workout|gym/, iconName: 'fitness_center' },
  { pattern: /bike|cycling|cycle/, iconName: 'directions_bike' },
  { pattern: /lift/, iconName: 'fitness_center' },
  { pattern: /jog|run/, iconName: 'directions_run' },
  { pattern: /hike|trail/, iconName: 'hiking' },
  { pattern: /walk|outside|outdoor|steps/, iconName: 'directions_walk' },
  { pattern: /inbox|email/, iconName: 'inbox' },
  { pattern: /read|book|study|homework/, iconName: 'menu_book' },
  { pattern: /deep work|focus|review|reflect/, iconName: 'psychology' },
  { pattern: /screen|phone|social|digital/, iconName: 'phonelink_off' },
  { pattern: /late.?night|night|midnight/, iconName: 'bedtime' },
  { pattern: /meditat|breath|mindful|yoga/, iconName: 'self_improvement' },
  { pattern: /sleep|bed|rest/, iconName: 'bedtime' },
  { pattern: /water|hydrat|drink/, iconName: 'water_drop' },
  { pattern: /plan|review|journal/, iconName: 'edit_note' },
  { pattern: /contact|email|journal|message|text|write|writing/, iconName: 'edit' },
  { pattern: /outreach|broadcast|advertise|distribution/, iconName: 'campaign' },
  { pattern: /gratitude|thank/, iconName: 'volunteer_activism' },
  { pattern: /clean|tidy|organize/, iconName: 'cleaning_services' },
  { pattern: /cook|meal|recipe/, iconName: 'restaurant' },
  { pattern: /music|song|sing/, iconName: 'music_note' },
  { pattern: /art|draw|paint/, iconName: 'palette' },
  { pattern: /game|play|fun/, iconName: 'sports_esports' },
  { pattern: /family|friend|social/, iconName: 'people' },
  { pattern: /volunteer|help|charity/, iconName: 'favorite' },
  { pattern: /finance|budget|money/, iconName: 'savings' },
  { pattern: /language|learn|study/, iconName: 'translate' },
  { pattern: /travel|trip|vacation/, iconName: 'flight' },
  { pattern: /garden|plant|nature/, iconName: 'spa' },
  { pattern: /movie|film|cinema/, iconName: 'movie' },
  { pattern: /cleaning|laundry|housework/, iconName: 'local_laundry_service' },
  { pattern: /swim|pool|water/, iconName: 'waves' },
  { pattern: /networking|bizdev/, iconName: 'handshake' },
];

// ------------------------------------------------------------------------------------------
// @desc Pick a habit's icon. When the habit's own text begins with an emoji, that emoji IS the canonical
//   icon (checked on the label, then the full task text as a fallback for habits last completed in a cached
//   month whose stored label predates emoji retention): it is the user's content, so it is kept. Only when the
//   habit carries no leading emoji do we fall back to a keyword-hint Material icon, then a generic default.
// @param {Object} habit - Habit with { label, fullText }.
// @returns {Object} Either { emoji } from the habit's own text, or { iconName } naming a Material icon.
function habitIcon(habit) {
  const ownEmoji = leadingEmoji(habit.label) || leadingEmoji(habit.fullText);
  if (ownEmoji) return { emoji: ownEmoji };
  const lower = stripLeadingEmoji(habit.label).toLowerCase();
  for (const { iconName, pattern } of HABIT_ICON_HINTS) {
    if (pattern.test(lower)) return { iconName };
  }
  return { iconName: HABIT_ICON_FALLBACK };
}

// ------------------------------------------------------------------------------------------
// @desc Human "ongoing weeks completed" streak label. A live streak reads "N-week streak" preceded by a
//   colored strength box; zero reads as no active streak so a stale row isn't mislabeled as a fresh one. The
//   returned class drives the box color, which escalates gray → blue → yellow → orange → red as the streak
//   lengthens (see .streak-label in energy-per-habit.scss).
// @param {number} weeks - Consecutive weeks the habit was completed at least once (ending now).
// @returns {string|JSX.Element}
function weekStreakLabel(weeks) {
  const count = Number(weeks) || 0;
  if (count <= 0) return 'no active streak';
  let streakClass = 'streak-week';
  if (count >= 2) streakClass = 'streak-alive';
  if (count >= 4) streakClass = 'streak-month';
  if (count >= 12) streakClass = 'streak-quarter';
  if (count >= 26) streakClass = 'streak-half-year';
  return (<div className={ `streak-label ${ streakClass }` }>{ count }-week streak active</div>);
}

// ------------------------------------------------------------------------------------------
// @desc Build the hover tooltip for a habit's row in the host's Task Stats tooltip layout: the habit, its mood delta,
//   and the average and rating count on days the habit was completed vs. days it was not.
// @param {Object} habit - Habit with label, delta, avgMoodOnDone, avgMoodOnOff, doneWithMood, offWithMood.
// @returns {string} Tooltip HTML.
function habitTooltipHtml(habit) {
  const days = count => `${ count } rated ${ count === 1 ? 'day' : 'days' }`;
  const rows = [
    { className: habit.delta >= 0 ? 'habit-tooltip-stat--positive' : 'habit-tooltip-stat--negative',
      iconName: habit.delta >= 0 ? 'trending_up' : 'trending_down', text: `${ formatDelta(habit.delta) } energy delta` },
    { iconName: 'check_circle', text: `When completed: ${ formatDelta(habit.avgMoodOnDone) } avg over ${ days(habit.doneWithMood) }` },
    { iconName: 'remove_circle_outline',
      text: `When not completed: ${ formatDelta(habit.avgMoodOnOff) } avg over ${ days(habit.offWithMood) }` },
  ];
  return statsChartTooltipHtml({ rows, title: stripLeadingEmoji(habit.label), titleIconName: 'repeat' });
}

// ------------------------------------------------------------------------------------------
// @desc Render a single habit row: icon, label, "N/window days · X-week streak" meta, a diverging bar (right
//   of the zero axis for positive delta, left + magenta for negative), and the value. The icon is the habit's
//   own leading emoji when it has one (else a keyword-derived glyph), and that leading emoji is stripped from
//   the rendered label so it isn't doubled beside the icon. The label is rendered as Amplenote markdown
//   (bold/italic/highlight/rich-footnote links) — matching how the Agenda widget renders task content — so
//   habit text formatting survives. When the habit carries a note reference the label is a
//   click-through that opens the task's note (clicks on an inner link are left to the link), and its title
//   shows the full task text on hover. Hovering the row shows the avg + count of mood ratings on completed
//   vs. off days in a chart tooltip.
// @param {Object} props - { habit, maxAbsDelta, onHover, onHoverEnd, onOpen, windowDays }
// @returns {JSX.Element}
function HabitRow({ habit, maxAbsDelta, onHover, onHoverEnd, onOpen, windowDays }) {
  const positive = habit.delta >= 0;
  const widthPct = maxAbsDelta > 0 ? Math.min(100, (Math.abs(habit.delta) / maxAbsDelta) * 100) : 0;
  const clickable = Boolean(habit.noteUUID);
  const fullText = habit.fullText || habit.label;
  const labelClass = `habit-row-label${clickable ? ' habit-row-label--link' : ''}`;
  const rowIcon = habitIcon(habit);
  return (
    <div className="habit-row" onMouseEnter={(event) => onHover(habit, event.currentTarget)} onMouseLeave={onHoverEnd}>
      <div className="habit-row-lead">
        <span className="habit-row-icon" aria-hidden="true">
          {rowIcon.emoji ? rowIcon.emoji : <MaterialIcon name={ rowIcon.iconName } />}
        </span>
        <div className="habit-row-text">
          <div
            className={labelClass}
            title={fullText}
            role={clickable ? 'link' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? (e) => { if (!e.target.closest('a')) onOpen(habit); } : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(habit); } } : undefined}
            dangerouslySetInnerHTML={{ __html: amplenoteMarkdownRender(stripLeadingEmoji(habit.label)) }}
          />
          <div className="habit-row-meta">Completed { habit.daysDone } of { windowDays } days</div>
          <div className="habit-row-meta">{ weekStreakLabel(habit.weekStreak) }</div>
        </div>
      </div>
      <div className="habit-row-track">
        <div className="habit-row-axis" />
        <div className="habit-row-bar-half habit-row-bar-half--negative">
          {!positive && (
            <div
              className="habit-row-bar habit-row-bar--negative"
              style={{ width: `${widthPct}%` }}
            />
          )}
        </div>
        <div className="habit-row-bar-half habit-row-bar-half--positive">
          {positive && (
            <div
              className="habit-row-bar habit-row-bar--positive"
              style={{ width: `${widthPct}%` }}
            />
          )}
        </div>
      </div>
      <div className={`habit-row-value ${positive ? 'habit-row-value--positive' : 'habit-row-value--negative'}`}>
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
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const rowsRef = useRef(null);
  const tooltip = useCanvasTippy(STATS_CHART_TOOLTIP_OPTIONS);

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    setLoadError(false);
    setLoading(true);
    loadEnergyPerHabit(app).then(result => {
      if (cancelled) return;
      setAnalysis(result);
      setLoading(false);
    }).catch(err => {
      logIfEnabled(`[${WIDGET_ID}] failed to load habit data`, err);
      if (!cancelled) {
        setAnalysis({ habits: [], windowDays: HABIT_ANALYSIS_WINDOW_DAYS });
        setLoadError(true);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [app]);

  const rows = useMemo(() => (analysis?.habits || []).slice(0, MAX_HABIT_ROWS), [analysis]);
  useWidgetLoadedEvent(WIDGET_ID, !loading && !!analysis, loadError);
  const maxAbsDelta = useMemo(
    () => rows.reduce((max, habit) => Math.max(max, Math.abs(habit.delta)), 0),
    [rows]
  );

  // Wire up tippy popups for any Amplenote Rich Footnote links in the rendered habit labels (same as agenda.jsx).
  useEffect(() => {
    attachFootnotePopups(rowsRef.current);
  }, [rows]);

  // Open the note containing the habit's most-recent completed task (matches graveyard's note navigation).
  const onOpenHabit = useCallback((habit) => {
    if (!app || !habit?.noteUUID) return;
    app.navigate(noteUrlFromUUID(habit.noteUUID));
  }, [app]);

  // Show the hovered habit's details beside its row, as the host's Task Stats charts do for a hovered day. The bars and
  // values fill the row's right side, so the tooltip opens to the row's left, or below it where there is no room.
  const onHabitHover = useCallback((habit, rowElement) => {
    const rowBox = rowElement.getBoundingClientRect();
    tooltip.show(habitTooltipHtml(habit), rowBox.left, rowBox.top, { placement: 'left-start' });
  }, []);
  const onHabitHoverEnd = useCallback(() => tooltip.scheduleHide(150), []);

  let windowDays = analysis?.windowDays || HABIT_ANALYSIS_WINDOW_DAYS;
  windowDays = windowDays >= ROUND_UP_TO_YEAR_ABOVE ? 365 : windowDays;

  if (loading) {
    return (
      <WidgetWrapper widgetId={WIDGET_ID}>
        <div className="habit-empty">Analyzing your habits…</div>
      </WidgetWrapper>
    );
  }

  if (!rows.length) {
    return (
      <WidgetWrapper widgetId={WIDGET_ID}>
        <div className="habit-empty">
          <p>No recurring-task habits with enough mood history to correlate yet.</p>
          <p className="habit-empty-hint">Set tasks to repeat and log your mood over time to see which habits lift your days.</p>
        </div>
      </WidgetWrapper>
    );
  }

  return (
    <WidgetWrapper widgetId={WIDGET_ID}>
      <div className="habit-header">
        <div className="habit-eyebrow">{`${windowDays} DAYS ANALYZED`}</div>
      </div>
      <div className="habit-chart">
        <div className="habit-zero-line"><span className="habit-zero-label">0</span></div>
        <div className="habit-rows" ref={rowsRef}>
          {
            rows.map(habit => (
              <HabitRow habit={habit} key={habit.key} maxAbsDelta={maxAbsDelta} onHover={onHabitHover}
                onHoverEnd={onHabitHoverEnd} onOpen={onOpenHabit} windowDays={windowDays} />
            ))
          }
        </div>
      </div>
    </WidgetWrapper>
  );
}
