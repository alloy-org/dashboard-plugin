// Style guide sections for the composed pieces: both tooltip looks, the column charts with sample data, the widget
// frame, and a configure dialog.
import PeakHoursChart from "dashboard/charts/peak-hours-chart";
import { StatsChartTooltipContent, StatsChartTooltipRow } from "dashboard/charts/stats-chart-tooltip";
import VictoryValueChart from "dashboard/charts/victory-value-chart";
import ConfigPopup from "dashboard/config-popup";
import { Button, CheckboxField, EmptyState, IconButton, LoadingState, RadioGroup } from "dashboard/controls";
import DashboardTippy from "dashboard/dashboard-tooltip-tippy";
import { NO_PROJECT_KEY } from "dashboard/projects/completed-task-project-colors";
import { richTooltipHtml } from "dashboard/tooltip-themes";
import WidgetWrapper from "dashboard/widget-wrapper";
import { useState } from "react";
import { MdCheckCircle, MdEmojiEmotions, MdRefresh, MdToday } from "react-icons/md";
// The widgets' own stylesheets, which hold the chart colors their widget classes scope
import "dashboard/styles/peak-hours.scss";
import "dashboard/styles/victory-value.scss";

const HOUR_COUNT = 24;
const SAMPLE_DAYS = [ "Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed" ];
const SAMPLE_MOODS = [ 1, 0, -1, 1, 2, 0, 1 ];
const SAMPLE_VICTORY_VALUES = [ 14, 7, 19, 20, 28, 4, 9 ];

// ------------------------------------------------------------------------------------------
// @desc Victory Value and Peak Hours charts drawn from sample data; hover a column for its tooltip.
// @returns {JSX.Element} The section body.
export function ChartsSection() {
  const dailyValues = SAMPLE_DAYS.map((day, index) => ({ date: sampleDateKey(index), day, value: SAMPLE_VICTORY_VALUES[index],
    segments: [ { colorToken: "--dashboard-victory-value-color-2", key: NO_PROJECT_KEY, value: SAMPLE_VICTORY_VALUES[index] } ] }));
  const hourLabels = Array.from({ length: HOUR_COUNT }, (unused, hour) => `${ hour % 12 || 12 }${ hour < 12 ? "AM" : "PM" }`);
  const createdByHour = hourLabels.map((label, hour) => Math.max(0, Math.round(30 * Math.sin((hour - 7) / 4))));
  const completedByHour = hourLabels.map((label, hour) => Math.max(0, Math.round(20 * Math.cos((hour - 15) / 3))));
  const tooltipContentFromIndex = index => (
    <StatsChartTooltipContent title={ `${ SAMPLE_DAYS[index] } ${ sampleDateKey(index) }` } TitleIcon={ MdToday }>
      <StatsChartTooltipRow className="stats-chart-tooltip-stat--victory-value" Icon={ MdCheckCircle }
        text={ `${ SAMPLE_VICTORY_VALUES[index] } victory value` } />
      <StatsChartTooltipRow Icon={ MdEmojiEmotions } text={ `Mood ${ SAMPLE_MOODS[index] }` } />
    </StatsChartTooltipContent>
  );
  return (
    <div className="styleguide-chart-grid">
      <div className="styleguide-panel styleguide-chart-panel">
        <h3 className="styleguide-subtitle">Victory Value (stacked bars, gradient, value pill, mood line)</h3>
        <div className="widget-victory-value styleguide-chart-scope">
          <VictoryValueChart dailyValues={ dailyValues } hasProjectLegend={ false }
            moodByDay={ SAMPLE_MOODS.map(rating => ({ rating })) } showMood
            tooltipContentFromIndex={ tooltipContentFromIndex } />
        </div>
      </div>
      <div className="styleguide-panel styleguide-chart-panel">
        <h3 className="styleguide-subtitle">Peak Hours (two series, thinned labels)</h3>
        <div className="widget-peak-hours styleguide-chart-scope">
          <PeakHoursChart completedByHour={ completedByHour } createdByHour={ createdByHour } hourLabels={ hourLabels } />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc A button that opens a ConfigPopup filled with settings controls, as a widget's configure dialog.
// @returns {JSX.Element} The section body.
export function DialogSection() {
  const [ open, setOpen ] = useState(false);
  const [ range, setRange ] = useState("week");
  const [ showMood, setShowMood ] = useState(true);
  return (
    <div>
      <Button onClick={ () => setOpen(true) } variant="outlined">Open a configure dialog</Button>
      {
        open ? (
          <ConfigPopup onCancel={ () => setOpen(false) } onSubmit={ () => setOpen(false) } title="Configure Victory Value">
            <RadioGroup label="Time range" onChange={ setRange } options={ [ { label: "Last 7 days", value: "week" },
              { label: "This month", value: "month" }, { label: "Last 30 days", value: "30days" } ] } value={ range } />
            <CheckboxField checked={ showMood } label="Show mood overlay" onChange={ setShowMood } />
          </ConfigPopup>
        ) : null
      }
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc A hint tooltip and a rich tooltip on hover targets.
// @returns {JSX.Element} The section body.
export function TooltipsSection() {
  const richContent = richTooltipHtml({ rows: [ { text: "Category", trailing: "Professional" },
    { text: "Pace", trailing: "Two focused blocks per week" }, { className: "stats-chart-tooltip-stat--section",
      text: "Why this project" }, { className: "stats-chart-tooltip-stat--detail", text: "It moves the quarter's goal." } ],
    title: "Launch the new onboarding" });
  return (
    <div className="styleguide-sample-row">
      <DashboardTippy content="A hint: one or two plain sentences about a control.">
        <span className="styleguide-hover-target" tabIndex={ 0 }>Hover for a hint</span>
      </DashboardTippy>
      <DashboardTippy content={ richContent } rich>
        <span className="styleguide-hover-target" tabIndex={ 0 }>Hover for a rich tooltip</span>
      </DashboardTippy>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Two widget cards in their real frame: one with a header action and an empty state, one loading.
// @returns {JSX.Element} The section body.
export function WidgetFrameSection() {
  const reseedButton = <IconButton Icon={ MdRefresh } label="Reseed" size="small" />;
  return (
    // The dashboard's own wrapper, so the widget cards get the dashboard's card and header styles
    <div className="dashboard-outer-container styleguide-dashboard-scope">
      <div className="styleguide-widget-grid">
        <WidgetWrapper gridHeightSize={ 1 } gridWidthSize={ 1 } headerActions={ reseedButton } widgetId="recent-notes">
          <EmptyState title="Nothing to revisit">Notes you have not opened in a while appear here.</EmptyState>
        </WidgetWrapper>
        <WidgetWrapper configurable gridHeightSize={ 1 } gridWidthSize={ 1 } onConfigure={ () => {} } widgetId="calendar">
          <LoadingState>Loading…</LoadingState>
        </WidgetWrapper>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc A date key a few days back from a fixed start, for the sample week.
// @param {number} index - Day of the sample week.
// @returns {string} YYYY-MM-DD.
function sampleDateKey(index) {
  return `2026-10-${ String(8 + index).padStart(2, "0") }`;
}
