// Peak Hours chart: a pair of bars per hour for the victory value of tasks created and completed in it, drawn as SVG
// the way the host app's Task Stats graph draws its charts, with a highlighted hour and a Task Stats style tooltip.
import { ChartGridLines, ChartHighlightLine, ChartHitArea, ChartXAxisLabels, niceChartMaximum,
    useElementSize } from "dashboard/charts/stats-chart";
import { StatsChartTooltipContent, StatsChartTooltipRow, useStatsChartTooltip } from "dashboard/charts/stats-chart-tooltip";
import { useEffect, useState } from "react";
import { MdAddCircle, MdCheckCircle, MdSchedule } from "react-icons/md";

const BAR_GAP = 1;
const BAR_SHARE_OF_COLUMN = 0.7;
const BAR_TOP_RADIUS = 2;
const GRID_LABEL_COUNT = 4;
const HOUR_COUNT = 24;
// Hour label steps that divide the day evenly, and the room one label needs
const HOUR_LABEL_STEPS = [ 1, 2, 3, 4, 6, 8, 12 ];
const HOUR_LABEL_MINIMUM_SPACING = 44;
const PLOT_PADDING = { bottom: 24, left: 32, right: 4, top: 8 };

// ------------------------------------------------------------------------------------------
// @desc Draw one bar standing on the baseline, its top corners rounded.
// @param {Object} props - { className, height, left, plot, width }.
// @returns {JSX.Element|null} The bar, or nothing for a zero value.
function HourBar({ className, height, left, plot, width }) {
  if (height <= 0) return null;
  const top = plot.bottom - height;
  const corner = Math.min(BAR_TOP_RADIUS, width / 2, height);
  const right = left + width;
  const pathData = `M${ left },${ plot.bottom }V${ top + corner }Q${ left },${ top } ${ left + corner },${ top }`
    + `H${ right - corner }Q${ right },${ top } ${ right },${ top + corner }V${ plot.bottom }Z`;
  return <path className={ className } d={ pathData } />;
}

// ------------------------------------------------------------------------------------------
// @desc Hourly created and completed victory value bars with grid, hour labels, and hover details.
// @param {Object} props - { completedByHour, createdByHour, hourLabels }: 24 values each, and the hour labels.
// @returns {JSX.Element} The chart.
export default function PeakHoursChart({ completedByHour, createdByHour, hourLabels }) {
  const [ containerRef, { height, width } ] = useElementSize();
  const [ hoveredIndex, setHoveredIndex ] = useState(null);
  const tooltip = useStatsChartTooltip();
  const plot = { bottom: Math.max(height - PLOT_PADDING.bottom, PLOT_PADDING.top + 1), left: PLOT_PADDING.left,
    right: Math.max(width - PLOT_PADDING.right, PLOT_PADDING.left + 1), top: PLOT_PADDING.top };
  const maximum = niceChartMaximum(Math.max(...createdByHour, ...completedByHour, 0), GRID_LABEL_COUNT);
  const columnWidth = (plot.right - plot.left) / HOUR_COUNT;
  const barWidth = Math.max((columnWidth * BAR_SHARE_OF_COLUMN - BAR_GAP) / 2, 1);
  const columnCenter = index => plot.left + columnWidth * (index + 0.5);
  const barHeight = value => ((plot.bottom - plot.top) * value) / maximum;

  useEffect(() => {
    if (hoveredIndex === null || !containerRef.current) { tooltip.scheduleHide(150); return; }
    const containerBox = containerRef.current.getBoundingClientRect();
    const content = (
      <StatsChartTooltipContent title={ hourLabels[hoveredIndex] } TitleIcon={ MdSchedule }>
        <StatsChartTooltipRow className="peak-hours-tooltip-stat--created" Icon={ MdAddCircle }
          text={ `${ createdByHour[hoveredIndex] } pts created` } />
        <StatsChartTooltipRow className="peak-hours-tooltip-stat--completed" Icon={ MdCheckCircle }
          text={ `${ completedByHour[hoveredIndex] } pts completed` } />
      </StatsChartTooltipContent>
    );
    tooltip.show(content, containerBox.left + columnCenter(hoveredIndex) + columnWidth / 2, containerBox.top + plot.top);
  }, [ hoveredIndex ]);

  const labelStep = HOUR_LABEL_STEPS.find(step => step * columnWidth >= HOUR_LABEL_MINIMUM_SPACING) || HOUR_COUNT / 2;
  const hourIndexes = Array.from({ length: HOUR_COUNT }, (unused, index) => index);
  const labeledHours = hourIndexes.filter(index => index % labelStep === 0);
  const xAxisLabels = labeledHours.map(index => ({ key: String(index), text: hourLabels[index], x: columnCenter(index) }));
  return (
    <div className="peak-hours-chart-container" ref={ containerRef }>
      { width > 0 && height > 0 ? (
        <svg className="stats-chart" height={ height } onMouseLeave={ () => setHoveredIndex(null) } width={ width }>
          <ChartGridLines formatLabel={ value => String(Math.round(value)) } labelCount={ GRID_LABEL_COUNT }
            maximum={ maximum } plot={ plot } />
          { hoveredIndex === null ? null : <ChartHighlightLine plot={ plot } x={ columnCenter(hoveredIndex) } /> }
          { hourIndexes.map(index => {
            const left = columnCenter(index) - barWidth - BAR_GAP / 2;
            return (
              <g key={ index }>
                <HourBar className="peak-hours-bar peak-hours-bar--created" height={ barHeight(createdByHour[index]) }
                  left={ left } plot={ plot } width={ barWidth } />
                <HourBar className="peak-hours-bar peak-hours-bar--completed" height={ barHeight(completedByHour[index]) }
                  left={ left + barWidth + BAR_GAP } plot={ plot } width={ barWidth } />
              </g>
            );
          }) }
          <ChartXAxisLabels labels={ xAxisLabels } plot={ plot } />
          { hourIndexes.map(index => (
            <ChartHitArea index={ index } key={ index } onEnter={ setHoveredIndex } onLeave={ () => {} } plot={ plot }
              width={ columnWidth } x={ plot.left + columnWidth * index } />
          )) }
        </svg>
      ) : null }
    </div>
  );
}
