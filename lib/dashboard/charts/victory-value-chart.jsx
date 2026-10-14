// Victory Value bar chart, drawn as SVG the way the host app's Task Stats graph draws its victory values: bars filled
// with the host's victory value scale, faint grid lines, and a hovered day marked by a highlight line, a value pill, and
// a Task Stats style tooltip.
import { ChartGridLines, ChartHighlightLine, ChartHitArea, ChartValuePill, ChartXAxisLabels, niceChartMaximum,
    useElementSize } from "dashboard/charts/stats-chart";
import { useStatsChartTooltip } from "dashboard/charts/stats-chart-tooltip";
import { NO_PROJECT_KEY } from "dashboard/projects/completed-task-project-colors";
import { useEffect, useState } from "react";
import { dateFromDateInput } from "util/date-utility";

const BAR_MAXIMUM_WIDTH = 36;
const BAR_SHARE_OF_COLUMN = 0.5;
const BAR_TOP_RADIUS = 4;
const GRADIENT_ID = "victory-value-bar-gradient";
const GRID_LABEL_COUNT = 4;
const MOOD_GRADIENT_ID = "victory-value-mood-gradient";
const MOOD_INDICATOR_RADIUS = 7;
// The host app's mood meter colors, worst (index 0) to best, matching the mood ratings -2 through 2
// The host's mood rating scale, rating -2 to +2, as data colors from data-colors.scss
export const MOOD_RATING_COLORS = [ "ugh", "meh", "ok", "good", "fantastic" ]
  .map(rating => `var(--dashboard-color-mood-rating-${ rating })`);
const PLOT_PADDING = { bottom: 36, left: 32, right: 4, top: 12 };
const VALUE_BUCKET_COUNT = 5;

// ------------------------------------------------------------------------------------------
// @desc Draw one day's bar, stacking its segments from the base. A day with no project segments takes the victory
//   value gradient; project segments keep their legend colors. Only the top segment gets rounded corners.
// @param {Object} props - { barWidth, centerX, hasProjectLegend, maximum, plot, segments, value }.
// @returns {JSX.Element|null} The bar, or nothing for an empty day.
function DayBar({ barWidth, centerX, hasProjectLegend, maximum, plot, segments, value }) {
  if (!value) return null;
  const barHeight = ((plot.bottom - plot.top) * value) / maximum;
  const left = centerX - barWidth / 2;
  let segmentBottom = plot.bottom;
  return (
    <g className="victory-value-chart-bar">
      { segments.map((segment, index) => {
        const segmentHeight = (segment.value / value) * barHeight;
        segmentBottom -= segmentHeight;
        const isTop = index === segments.length - 1;
        const fill = segment.key === NO_PROJECT_KEY && !hasProjectLegend ? `url(#${ GRADIENT_ID })` : `var(${ segment.colorToken })`;
        return (
          <path d={ topRoundedRectPath(left, segmentBottom, barWidth, segmentHeight, isTop ? BAR_TOP_RADIUS : 0) }
            fill={ fill } key={ segment.key } />
        );
      }) }
    </g>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The SVG gradients: the victory value scale for bars, and the mood colors for the mood line, both measured
//   against the plot so a taller bar or a better mood reaches further up the scale.
// @param {Object} props - { plot }: the plot area's edges.
// @returns {JSX.Element} The gradient definitions.
function GradientDefinitions({ plot }) {
  const victoryValueStops = [ 0, 1, 2, 3, 4 ];
  return (
    <defs>
      <linearGradient gradientUnits="userSpaceOnUse" id={ GRADIENT_ID } x1="0" x2="0" y1={ plot.bottom } y2={ plot.top }>
        { victoryValueStops.map(stop => (
          <stop key={ stop } offset={ `${ stop * 25 }%` } stopColor={ `var(--dashboard-victory-value-color-${ stop })` } />
        )) }
      </linearGradient>
      <linearGradient gradientUnits="userSpaceOnUse" id={ MOOD_GRADIENT_ID } x1="0" x2="0" y1={ plot.bottom } y2={ plot.top }>
        {
          MOOD_RATING_COLORS.map((color, index) => (
            <stop key={ color } offset={ `${ index * 25 }%` } style={ { stopColor: color } } />
          ))
        }
      </linearGradient>
    </defs>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The mood line across the displayed days, dashed across days with no rating, drawn faintly like the Task
//   Stats mood line; the hovered day's rating is marked with a dot in its mood color.
// @param {Object} props - { hoveredIndex, moodPoints }: the hovered day and the placed mood ratings.
// @returns {JSX.Element|null} The overlay, or nothing without ratings.
function MoodOverlay({ hoveredIndex, moodPoints }) {
  if (!moodPoints.length) return null;
  const segments = moodPoints.slice(1).map((point, index) => ({ from: moodPoints[index], to: point }));
  const hoveredPoint = moodPoints.find(point => point.index === hoveredIndex);
  return (
    <g className="victory-value-chart-mood">
      { segments.map(({ from, to }) => (
        <line className={ `victory-value-chart-mood-line${ to.index === from.index + 1 ? "" : " victory-value-chart-mood-line--gap" }` }
          key={ `${ from.index }-${ to.index }` } stroke={ `url(#${ MOOD_GRADIENT_ID })` } x1={ from.x } x2={ to.x }
          y1={ from.y } y2={ to.y } />
      )) }
      { moodPoints.length === 1 ? (
        <circle className="victory-value-chart-mood-point" cx={ moodPoints[0].x } cy={ moodPoints[0].y } r="3"
          style={ { fill: moodColorFromRating(moodPoints[0].rating) } } />
      ) : null }
      { hoveredPoint ? (
        <circle className="victory-value-chart-mood-indicator" cx={ hoveredPoint.x } cy={ hoveredPoint.y }
          r={ MOOD_INDICATOR_RADIUS } style={ { fill: moodColorFromRating(hoveredPoint.rating) } } />
      ) : null }
    </g>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Bars for the displayed days with grid, axis labels, the mood line, and hover details.
// @param {Object} props - An object with the following properties:
//   - {Array} dailyValues - Displayed days of { date, day, segments, value }.
//   - {boolean} hasProjectLegend - True when bars are colored by project, so segments keep their legend colors.
//   - {Array} moodByDay - The mood recorded on each displayed day, or null.
//   - {boolean} showMood - Whether to draw the mood line.
//   - {function(number): JSX.Element} tooltipContentFromIndex - Tooltip content for a day's index.
// @returns {JSX.Element} The chart.
export default function VictoryValueChart({ dailyValues, hasProjectLegend, moodByDay, showMood, tooltipContentFromIndex }) {
  const [ containerRef, { height, width } ] = useElementSize();
  const [ hoveredIndex, setHoveredIndex ] = useState(null);
  const tooltip = useStatsChartTooltip();
  const plot = { bottom: Math.max(height - PLOT_PADDING.bottom, PLOT_PADDING.top + 1), left: PLOT_PADDING.left,
    right: Math.max(width - PLOT_PADDING.right, PLOT_PADDING.left + 1), top: PLOT_PADDING.top };
  const maximum = niceChartMaximum(Math.max(...dailyValues.map(day => day.value || 0), 0), GRID_LABEL_COUNT);
  const columnWidth = (plot.right - plot.left) / Math.max(dailyValues.length, 1);
  const barWidth = Math.min(columnWidth * BAR_SHARE_OF_COLUMN, BAR_MAXIMUM_WIDTH);
  const columnCenter = index => plot.left + columnWidth * (index + 0.5);
  const moodPoints = showMood ? moodPointsFromMoodByDay(moodByDay, dailyValues, plot, columnCenter) : [];

  useEffect(() => { setHoveredIndex(null); }, [ dailyValues.length && dateFromDateInput(dailyValues[0].date).getTime() ]);
  useEffect(() => {
    if (hoveredIndex === null || !containerRef.current) { tooltip.scheduleHide(150); return; }
    const containerBox = containerRef.current.getBoundingClientRect();
    const anchorX = containerBox.left + columnCenter(hoveredIndex) + columnWidth / 2 - 8;
    tooltip.show(tooltipContentFromIndex(hoveredIndex), anchorX, containerBox.top + plot.top);
  }, [ hoveredIndex ]);

  const xAxisLabels = dailyValues.map((day, index) => ({ key: String(index), sublabel: dateFromDateInput(day.date)
    .toLocaleDateString(undefined, { day: "numeric", month: "short" }), text: day.day, x: columnCenter(index) }));
  const hoveredDay = hoveredIndex === null ? null : dailyValues[hoveredIndex];
  return (
    <div className="victory-value-chart vv-chart" ref={ containerRef }>
      { width > 0 && height > 0 ? (
        <svg className="stats-chart" height={ height } onMouseLeave={ () => setHoveredIndex(null) } width={ width }>
          <GradientDefinitions plot={ plot } />
          <ChartGridLines formatLabel={ value => String(Math.round(value)) } labelCount={ GRID_LABEL_COUNT }
            maximum={ maximum } plot={ plot } />
          { hoveredIndex === null ? null : <ChartHighlightLine plot={ plot } x={ columnCenter(hoveredIndex) } /> }
          { dailyValues.map((day, index) => (
            <DayBar barWidth={ barWidth } centerX={ columnCenter(index) } hasProjectLegend={ hasProjectLegend } key={ index }
              maximum={ maximum } plot={ plot } segments={ day.segments || [] } value={ day.value || 0 } />
          )) }
          <MoodOverlay hoveredIndex={ hoveredIndex } moodPoints={ moodPoints } />
          <ChartXAxisLabels labels={ xAxisLabels } plot={ plot } />
          { hoveredDay ? (
            <ChartValuePill className={ `stats-chart-value-pill--bucket-${ valueBucket(hoveredDay.value, maximum) }` }
              text={ formatChartValue(hoveredDay.value) } x={ columnCenter(hoveredIndex) }
              y={ plot.bottom - ((plot.bottom - plot.top) * (hoveredDay.value || 0)) / maximum } />
          ) : null }
          { dailyValues.map((day, index) => (
            <ChartHitArea index={ index } key={ index } onEnter={ setHoveredIndex } onLeave={ () => {} } plot={ plot }
              width={ columnWidth } x={ plot.left + columnWidth * index } />
          )) }
        </svg>
      ) : null }
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Format a day's victory value for the pill: whole numbers as is, fractions to one decimal place.
// @param {number} value - The day's total.
// @returns {string} The label.
function formatChartValue(value) {
  const rounded = Math.round((value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// ------------------------------------------------------------------------------------------
// @desc The mood meter color for a rating from -2 to 2, rounding ratings that are averages.
// @param {number} rating - Mood rating.
// @returns {string} A CSS color (a data color custom property).
export function moodColorFromRating(rating) {
  const index = Math.min(MOOD_RATING_COLORS.length - 1, Math.max(0, Math.round(rating) + 2));
  return MOOD_RATING_COLORS[index];
}

// ------------------------------------------------------------------------------------------
// @desc Place each displayed day's mood rating on the plot, leaving out days still in the future.
// @param {Array} moodByDay - Mood entry per displayed day, or null.
// @param {Array} dailyValues - Displayed days.
// @param {Object} plot - The plot area's edges.
// @param {function(number): number} columnCenter - Column center for a day's index.
// @returns {Array} [{ index, rating, x, y }] in day order.
function moodPointsFromMoodByDay(moodByDay, dailyValues, plot, columnCenter) {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const ratedDays = (moodByDay || []).map((mood, index) => ({ index, mood }));
  const pastRatedDays = ratedDays.filter(({ index, mood }) => mood && dailyValues[index]
    && dateFromDateInput(dailyValues[index].date) <= endOfToday);
  const moodPoints = pastRatedDays.map(({ index, mood }) => ({ index, rating: mood.rating, x: columnCenter(index),
    y: plot.bottom - ((mood.rating + 2) / 4) * (plot.bottom - plot.top) }));
  return moodPoints;
}

// ------------------------------------------------------------------------------------------
// @desc SVG path for a rectangle whose top corners alone are rounded, as bars rest on the baseline.
// @param {number} left - Left edge.
// @param {number} top - Top edge.
// @param {number} width - Width.
// @param {number} height - Height.
// @param {number} radius - Corner radius, clamped to fit.
// @returns {string} Path data.
function topRoundedRectPath(left, top, width, height, radius) {
  const corner = Math.min(radius, width / 2, height);
  const right = left + width;
  const bottom = top + height;
  return `M${ left },${ bottom }V${ top + corner }Q${ left },${ top } ${ left + corner },${ top }`
    + `H${ right - corner }Q${ right },${ top } ${ right },${ top + corner }V${ bottom }Z`;
}

// ------------------------------------------------------------------------------------------
// @desc Which of the five victory value colors a day's total takes, relative to the chart's top value.
// @param {number} value - The day's total.
// @param {number} maximum - The chart's top value.
// @returns {number} Bucket from 0 to 4.
function valueBucket(value, maximum) {
  return Math.min(VALUE_BUCKET_COUNT - 1, Math.floor(((value || 0) / maximum) * VALUE_BUCKET_COUNT));
}
