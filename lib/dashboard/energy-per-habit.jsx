/**
 * [Claude-authored file]
 * Created: 2026-07-17 | Model: claude-opus-4-8 (1M context)
 * Task: Energy Per Habit widget — mood delta per habit over the trailing ~365 days
 * Prompt summary: "new energy-per-habit component styled like the 'Mood delta per habit' mockup"
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdBedtime, MdCampaign, MdCheckCircle, MdCleaningServices, MdDirectionsBike, MdDirectionsRun,
  MdDirectionsWalk, MdEdit, MdEditNote, MdFavorite, MdFitnessCenter, MdFlight, MdHandshake, MdHiking, MdInbox,
  MdLocalLaundryService, MdMenuBook, MdMovie, MdMusicNote, MdPalette, MdPeople, MdPhonelinkOff, MdPsychology,
  MdRemoveCircleOutline, MdRepeat, MdRestaurant, MdSavings, MdSelfImprovement, MdSpa, MdSportsEsports,
  MdTranslate, MdTrendingDown, MdTrendingUp, MdVolunteerActivism, MdWaterDrop,
  MdWaves } from "react-icons/md";
import WidgetWrapper from "widget-wrapper";
import { noteUrlFromUUID } from "app-util";
import { EmptyState, LoadingState } from "dashboard/controls";
import { useWidgetLoadedEvent } from "dashboard-load-tracking";
import { logIfEnabled } from "util/log";
import { formatDelta, HABIT_ANALYSIS_WINDOW_DAYS, leadingEmoji, stripLeadingEmoji } from "energy-per-habit-analysis";
import { StatsChartTooltipContent, StatsChartTooltipRow, useStatsChartTooltip } from "dashboard/charts/stats-chart-tooltip";
import { loadEnergyPerHabit } from "energy-per-habit-service";
import { amplenoteMarkdownRender, attachFootnotePopups } from "util/amplenote-markdown-render";
import "styles/energy-per-habit.scss";

const WIDGET_ID = 'energy-per-habit';

// Number of habits to render (mockup shows the strongest handful; keeps the tile readable).
const MAX_HABIT_ROWS = 8;
const ROUND_UP_TO_YEAR_ABOVE = 330;
// Below this many rows the data note link would crowd a short list, so it is left out.
const MIN_ROWS_FOR_DATA_NOTE_LINK = 4;

// Fallback icon plus keyword hints so common habits get a recognizable Material icon.
const HABIT_ICON_FALLBACK = MdRepeat;
const HABIT_ICON_HINTS = [
  { pattern: /exercise|workout|gym/, Icon: MdFitnessCenter },
  { pattern: /bike|cycling|cycle/, Icon: MdDirectionsBike },
  { pattern: /lift/, Icon: MdFitnessCenter },
  { pattern: /jog|run/, Icon: MdDirectionsRun },
  { pattern: /hike|trail/, Icon: MdHiking },
  { pattern: /walk|outside|outdoor|steps/, Icon: MdDirectionsWalk },
  { pattern: /inbox|email/, Icon: MdInbox },
  { pattern: /read|book|study|homework/, Icon: MdMenuBook },
  { pattern: /deep work|focus|review|reflect/, Icon: MdPsychology },
  { pattern: /screen|phone|social|digital/, Icon: MdPhonelinkOff },
  { pattern: /late.?night|night|midnight/, Icon: MdBedtime },
  { pattern: /meditat|breath|mindful|yoga/, Icon: MdSelfImprovement },
  { pattern: /sleep|bed|rest/, Icon: MdBedtime },
  { pattern: /water|hydrat|drink/, Icon: MdWaterDrop },
  { pattern: /plan|review|journal/, Icon: MdEditNote },
  { pattern: /contact|email|journal|message|text|write|writing/, Icon: MdEdit },
  { pattern: /outreach|broadcast|advertise|distribution/, Icon: MdCampaign },
  { pattern: /gratitude|thank/, Icon: MdVolunteerActivism },
  { pattern: /clean|tidy|organize/, Icon: MdCleaningServices },
  { pattern: /cook|meal|recipe/, Icon: MdRestaurant },
  { pattern: /music|song|sing/, Icon: MdMusicNote },
  { pattern: /art|draw|paint/, Icon: MdPalette },
  { pattern: /game|play|fun/, Icon: MdSportsEsports },
  { pattern: /family|friend|social/, Icon: MdPeople },
  { pattern: /volunteer|help|charity/, Icon: MdFavorite },
  { pattern: /finance|budget|money/, Icon: MdSavings },
  { pattern: /language|learn|study/, Icon: MdTranslate },
  { pattern: /travel|trip|vacation/, Icon: MdFlight },
  { pattern: /garden|plant|nature/, Icon: MdSpa },
  { pattern: /movie|film|cinema/, Icon: MdMovie },
  { pattern: /cleaning|laundry|housework/, Icon: MdLocalLaundryService },
  { pattern: /swim|pool|water/, Icon: MdWaves },
  { pattern: /networking|bizdev/, Icon: MdHandshake },
];

// ------------------------------------------------------------------------------------------
// @desc Pick a habit's icon. When the habit's own text begins with an emoji, that emoji IS the canonical
//   icon (checked on the label, then the full task text as a fallback for habits last completed in a cached
//   month whose stored label predates emoji retention): it is the user's content, so it is kept. Only when the
//   habit carries no leading emoji do we fall back to a keyword-hint Material icon, then a generic default.
// @param {Object} habit - Habit with { label, fullText }.
// @returns {Object} Either { emoji } from the habit's own text, or { Icon }, a Material icon component.
function habitIcon(habit) {
  const ownEmoji = leadingEmoji(habit.label) || leadingEmoji(habit.fullText);
  if (ownEmoji) return { emoji: ownEmoji };
  const lower = stripLeadingEmoji(habit.label).toLowerCase();
  for (const { Icon, pattern } of HABIT_ICON_HINTS) {
    if (pattern.test(lower)) return { Icon };
  }
  return { Icon: HABIT_ICON_FALLBACK };
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
// @returns {JSX.Element} Tooltip content.
function habitTooltipContent(habit) {
  const days = count => `${ count } rated ${ count === 1 ? 'day' : 'days' }`;
  const positive = habit.delta >= 0;
  return (
    <StatsChartTooltipContent title={stripLeadingEmoji(habit.label)} TitleIcon={MdRepeat}>
      <StatsChartTooltipRow className={positive ? 'habit-tooltip-stat--positive' : 'habit-tooltip-stat--negative'}
        Icon={positive ? MdTrendingUp : MdTrendingDown} text={`${ formatDelta(habit.delta) } energy delta`} />
      <StatsChartTooltipRow Icon={MdCheckCircle}
        text={`When completed: ${ formatDelta(habit.avgMoodOnDone) } avg over ${ days(habit.doneWithMood) }`} />
      <StatsChartTooltipRow Icon={MdRemoveCircleOutline}
        text={`When not completed: ${ formatDelta(habit.avgMoodOnOff) } avg over ${ days(habit.offWithMood) }`} />
    </StatsChartTooltipContent>
  );
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
          {rowIcon.emoji ? rowIcon.emoji : <rowIcon.Icon />}
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
  const tooltip = useStatsChartTooltip();

  // Render as soon as the cache note yields habits, then replace them with the refreshed analysis. A failed
  //   refresh keeps the cached rows on screen rather than replacing them with the empty state.
  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    let showingCachedResult = false;
    setLoadError(false);
    setLoading(true);
    const onCachedResult = cachedResult => {
      if (cancelled) return;
      showingCachedResult = true;
      setAnalysis(cachedResult);
      setLoading(false);
    };
    loadEnergyPerHabit(app, { onCachedResult }).then(result => {
      if (cancelled) return;
      setAnalysis(result);
      setLoading(false);
    }).catch(err => {
      logIfEnabled(`[${WIDGET_ID}] failed to load habit data`, err);
      if (cancelled || showingCachedResult) return;
      setAnalysis({ habits: [], windowDays: HABIT_ANALYSIS_WINDOW_DAYS });
      setLoadError(true);
      setLoading(false);
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
    tooltip.show(habitTooltipContent(habit), rowBox.left, rowBox.top, { placement: 'left-start' });
  }, []);
  const onHabitHoverEnd = useCallback(() => tooltip.scheduleHide(150), []);

  // Open the archived note that stores each month's Energy Delta inputs.
  const onOpenDataNote = useCallback((event) => {
    event.preventDefault();
    if (!app || !analysis?.cacheNoteUUID) return;
    app.navigate(noteUrlFromUUID(analysis.cacheNoteUUID));
  }, [analysis, app]);

  let windowDays = analysis?.windowDays || HABIT_ANALYSIS_WINDOW_DAYS;
  windowDays = windowDays >= ROUND_UP_TO_YEAR_ABOVE ? 365 : windowDays;

  if (loading) {
    return (
      <WidgetWrapper widgetId={WIDGET_ID}>
        <LoadingState className="habit-loading">Analyzing your habits…</LoadingState>
      </WidgetWrapper>
    );
  }

  if (!rows.length) {
    return (
      <WidgetWrapper widgetId={WIDGET_ID}>
        <EmptyState className="habit-empty"
          title="No recurring-task habits with enough mood history to correlate yet.">
          Set tasks to repeat and log your mood over time to see which habits lift your days.
        </EmptyState>
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
      {
        rows.length >= MIN_ROWS_FOR_DATA_NOTE_LINK && analysis.cacheNoteUUID && (
        <a className="habit-data-link" href={noteUrlFromUUID(analysis.cacheNoteUUID)} onClick={onOpenDataNote}>
          View Energy Delta data note
        </a>)
      }
    </WidgetWrapper>
  );
}
