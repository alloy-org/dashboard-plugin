// Peak Hours chart: a pair of bars per hour for the victory value of tasks created and completed in it, as a
// ColumnChart in the host's Task Stats look, with a Task Stats style tooltip.
import ColumnChart from "dashboard/charts/column-chart";
import { StatsChartTooltipContent, StatsChartTooltipRow } from "dashboard/charts/stats-chart-tooltip";
import { MdAddCircle, MdCheckCircle, MdSchedule } from "react-icons/md";

const BAR_RADIUS = 2;
const BAR_SHARE_OF_COLUMN = 0.7;
// Hour label steps that divide the day evenly, and the room one label needs
const HOUR_LABEL_STEPS = [ 1, 2, 3, 4, 6, 8, 12 ];
const HOUR_LABEL_MINIMUM_SPACING = 44;
const PLOT_PADDING = { bottom: 24, left: 32, right: 4, top: 8 };

// ------------------------------------------------------------------------------------------
// @desc Hourly created and completed victory value bars with grid, hour labels, and hover details.
// @param {Object} props - { completedByHour, createdByHour, hourLabels }: 24 values each, and the hour labels.
// @returns {JSX.Element} The chart.
export default function PeakHoursChart({ completedByHour, createdByHour, hourLabels }) {
  const columns = hourLabels.map((label, index) => ({ key: String(index), label }));
  const series = [
    { className: "peak-hours-bar peak-hours-bar--created", key: "created", values: createdByHour },
    { className: "peak-hours-bar peak-hours-bar--completed", key: "completed", values: completedByHour },
  ];
  const renderTooltip = index => (
    <StatsChartTooltipContent title={ hourLabels[index] } TitleIcon={ MdSchedule }>
      <StatsChartTooltipRow className="peak-hours-tooltip-stat--created" Icon={ MdAddCircle }
        text={ `${ createdByHour[index] } pts created` } />
      <StatsChartTooltipRow className="peak-hours-tooltip-stat--completed" Icon={ MdCheckCircle }
        text={ `${ completedByHour[index] } pts completed` } />
    </StatsChartTooltipContent>
  );
  return (
    <ColumnChart barRadius={ BAR_RADIUS } barShareOfColumn={ BAR_SHARE_OF_COLUMN } className="peak-hours-chart-container"
      columns={ columns } labelMinimumSpacing={ HOUR_LABEL_MINIMUM_SPACING } labelSteps={ HOUR_LABEL_STEPS }
      padding={ PLOT_PADDING } renderTooltip={ renderTooltip } series={ series } />
  );
}
