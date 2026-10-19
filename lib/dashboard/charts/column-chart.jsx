// A column chart in the host app's Task Stats look, configured rather than copied: give it columns, one or more
// series of values, and what to show on hover. It owns the layout (plot box, grid, column centers, bar widths), the
// hover state (highlight line, hit areas), the axis labels, and anchoring the Task Stats tooltip.
import { ChartGridLines, ChartHighlightLine, ChartHitArea, ChartValuePill, ChartXAxisLabels, niceChartMaximum,
  useElementSize } from "dashboard/charts/stats-chart";
import { useStatsChartTooltip } from "dashboard/charts/stats-chart-tooltip";
import { useEffect, useState } from "react";

const DEFAULT_BAR_GAP = 1;
const DEFAULT_BAR_RADIUS = 4;
const DEFAULT_BAR_SHARE_OF_COLUMN = 0.5;
const DEFAULT_PLOT_PADDING = { bottom: 24, left: 32, right: 4, top: 8 };
const GRID_LABEL_COUNT = 4;
const TOOLTIP_HIDE_DELAY = 150;

// ------------------------------------------------------------------------------------------
// @desc A column chart. Each series draws one bar per column, side by side when there are several; a series value
//   may instead be stacked segments, each with its own fill.
// @param {Object} props - An object with the following properties:
//   - {number} [barGap] - Pixels between a column's bars (default 1).
//   - {number} [barMaximumWidth] - Widest a column's group of bars may get.
//   - {number} [barRadius] - Corner radius on a bar's top (default 4).
//   - {number} [barShareOfColumn] - Share of the column width the bars fill together (default 0.5).
//   - {string} className - The chart's own class, on the measured container (sizing lives in the widget's scss).
//   - {Array<Object>} columns - [{ key, label, sublabel }]; a column without a label shows none.
//   - {Function} [formatGridLabel] - Formats a grid value (default: rounded number).
//   - {number} [labelMinimumSpacing] - When set, labels only every Nth column, N the smallest of labelSteps that
//     leaves this many pixels between labels.
//   - {Array<number>} [labelSteps] - Candidate label steps for labelMinimumSpacing.
//   - {Object} [padding] - { bottom, left, right, top } around the plot.
//   - {Function} [renderDefinitions] - (plot) => <defs> for gradients the bars or overlay use.
//   - {Function} [renderOverlay] - ({ columnCenter, hoveredIndex, maximum, plot }) => SVG drawn over the bars.
//   - {Function} renderTooltip - (index) => tooltip content (StatsChartTooltipContent) for the hovered column.
//   - {*} [resetHoverKey] - Clears the hovered column when it changes, e.g. the first displayed date.
//   - {Array<Object>} series - [{ className, key, values }]: `values[index]` is a number, or an array of stacked
//     segments [{ className, fill, key, value }] whose sum is the column's value.
//   - {number} [tooltipAnchorInset] - Pixels the tooltip anchor moves left from the column's right edge.
//   - {boolean} [tooltipWide] - Use the wide rich tooltip, for tooltips that list whole task rows.
//   - {Function} [valuePillFromIndex] - (index, maximum) => { className, text } for a pill on the hovered column's
//     tallest bar, or null.
// @returns {JSX.Element} The chart.
export default function ColumnChart(props) {
  const { className, columns, padding = DEFAULT_PLOT_PADDING, renderTooltip, resetHoverKey, series,
    tooltipAnchorInset = 0, tooltipWide } = props;
  const [ containerRef, { height, width } ] = useElementSize();
  const [ hoveredIndex, setHoveredIndex ] = useState(null);
  const tooltip = useStatsChartTooltip({ wide: tooltipWide });
  const layout = chartLayoutFromSize({ ...props, columns, height, padding, series, width });

  useEffect(() => { setHoveredIndex(null); }, [ resetHoverKey ]);
  useEffect(() => {
    if (hoveredIndex === null || !containerRef.current) { tooltip.scheduleHide(TOOLTIP_HIDE_DELAY); return; }
    const containerBox = containerRef.current.getBoundingClientRect();
    const anchorX = containerBox.left + layout.columnCenter(hoveredIndex) + layout.columnWidth / 2 - tooltipAnchorInset;
    tooltip.show(renderTooltip(hoveredIndex), anchorX, containerBox.top + layout.plot.top);
  }, [ hoveredIndex ]);

  return (
    <div className={ className } ref={ containerRef }>
      {
        width > 0 && height > 0 ? (
          <ChartSvg { ...props } height={ height } hoveredIndex={ hoveredIndex } layout={ layout }
            onHover={ setHoveredIndex } width={ width } />
        ) : null
      }
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Draw one bar standing on the baseline: a single fill, or stacked segments with only the top one rounded.
// @param {Object} props - { className, left, maximum, plot, radius, value, width }.
// @returns {JSX.Element|null} The bar, or nothing for an empty value.
function ChartBar({ className, left, maximum, plot, radius, value, width }) {
  const segments = Array.isArray(value) ? value : [ { key: "value", value } ];
  const total = segments.reduce((sum, segment) => sum + (segment.value || 0), 0);
  if (!total) return null;
  let segmentBottom = plot.bottom;
  return (
    <g className={ className }>
      {
        segments.map((segment, index) => {
          const segmentHeight = ((plot.bottom - plot.top) * (segment.value || 0)) / maximum;
          segmentBottom -= segmentHeight;
          const isTop = index === segments.length - 1;
          return (
            <path className={ segment.className } d={ topRoundedRectPath(left, segmentBottom, width, segmentHeight,
              isTop ? radius : 0) } fill={ segment.fill } key={ segment.key } />
          );
        })
      }
    </g>
  );
}

// ------------------------------------------------------------------------------------------
// @desc The SVG: definitions, grid, highlight line, bars, overlay, axis labels, value pill, then the hit areas on top.
// @param {Object} props - ColumnChart's props plus { height, hoveredIndex, layout, onHover, width }.
// @returns {JSX.Element} The SVG.
function ChartSvg({ barRadius = DEFAULT_BAR_RADIUS, columns, formatGridLabel, height, hoveredIndex, layout, onHover,
    renderDefinitions, renderOverlay, series, valuePillFromIndex, width }) {
  const { barLeft, barWidth, columnCenter, columnWidth, labelStep, maximum, plot } = layout;
  const xAxisLabels = columns.map((column, index) => ({ ...column, index, text: column.label, x: columnCenter(index) }))
    .filter(label => label.text && label.index % labelStep === 0);
  const pill = hoveredIndex === null || !valuePillFromIndex ? null : valuePillFromIndex(hoveredIndex, maximum);
  const hoveredValue = hoveredIndex === null ? 0 : Math.max(...series.map(item => valueTotal(item.values[hoveredIndex])));
  return (
    <svg className="stats-chart" height={ height } onMouseLeave={ () => onHover(null) } width={ width }>
      { renderDefinitions ? renderDefinitions(plot) : null }
      <ChartGridLines formatLabel={ formatGridLabel || (value => String(Math.round(value))) } labelCount={ GRID_LABEL_COUNT }
        maximum={ maximum } plot={ plot } />
      { hoveredIndex === null ? null : <ChartHighlightLine plot={ plot } x={ columnCenter(hoveredIndex) } /> }
      {
        columns.map((column, index) => (
          <g key={ column.key }>
            {
              series.map((item, seriesIndex) => (
                <ChartBar className={ item.className } key={ item.key } left={ barLeft(index, seriesIndex) }
                  maximum={ maximum } plot={ plot } radius={ barRadius } value={ item.values[index] } width={ barWidth } />
              ))
            }
          </g>
        ))
      }
      { renderOverlay ? renderOverlay({ columnCenter, hoveredIndex, maximum, plot }) : null }
      <ChartXAxisLabels labels={ xAxisLabels } plot={ plot } />
      {
        pill ? (
          <ChartValuePill className={ pill.className } text={ pill.text } x={ columnCenter(hoveredIndex) }
            y={ plot.bottom - ((plot.bottom - plot.top) * hoveredValue) / maximum } />
        ) : null
      }
      {
        columns.map((column, index) => (
          <ChartHitArea index={ index } key={ column.key } onEnter={ onHover } onLeave={ () => {} } plot={ plot }
            width={ columnWidth } x={ plot.left + columnWidth * index } />
        ))
      }
    </svg>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Where everything goes for the measured size: the plot box, the grid's top value, column centers, each
//   series' bar position and width, and which columns are labeled.
// @param {Object} options - ColumnChart's props plus the measured { height, width }.
// @returns {Object} { barLeft(index, seriesIndex), barWidth, columnCenter(index), columnWidth, labelStep, maximum,
//   plot }.
function chartLayoutFromSize({ barGap = DEFAULT_BAR_GAP, barMaximumWidth = Infinity,
    barShareOfColumn = DEFAULT_BAR_SHARE_OF_COLUMN, columns, height, labelMinimumSpacing, labelSteps = [ 1 ], padding,
    series, width }) {
  const plot = { bottom: Math.max(height - padding.bottom, padding.top + 1), left: padding.left,
    right: Math.max(width - padding.right, padding.left + 1), top: padding.top };
  const allValues = series.flatMap(item => item.values.map(valueTotal));
  const maximum = niceChartMaximum(Math.max(...allValues, 0), GRID_LABEL_COUNT);
  const columnWidth = (plot.right - plot.left) / Math.max(columns.length, 1);
  const groupWidth = Math.min(columnWidth * barShareOfColumn, barMaximumWidth);
  const barWidth = Math.max((groupWidth - barGap * (series.length - 1)) / series.length, 1);
  const columnCenter = index => plot.left + columnWidth * (index + 0.5);
  const barLeft = (index, seriesIndex) => columnCenter(index) - groupWidth / 2 + seriesIndex * (barWidth + barGap);
  const labelStep = labelMinimumSpacing
    ? labelSteps.find(step => step * columnWidth >= labelMinimumSpacing) || labelSteps.at(-1) : 1;
  return { barLeft, barWidth, columnCenter, columnWidth, labelStep, maximum, plot };
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
// @desc A column value's total: the number itself, or the sum of its stacked segments.
// @param {number|Array<Object>} value - A series value.
// @returns {number} The total.
function valueTotal(value) {
  if (Array.isArray(value)) return value.reduce((sum, segment) => sum + (segment.value || 0), 0);
  return value || 0;
}
