// Render seven days of completed-task victory values with weekly navigation and a mood overlay.
import { parseWidgetConfig, widgetConfigKey } from "../constants/settings";
import ConfigPopup from "./config-popup";
import { escapedHtml, statsChartTooltipHtml } from "dashboard/charts/stats-chart-tooltip";
import VictoryValueChart, { moodColorFromRating } from "dashboard/charts/victory-value-chart";
import { completedTasksWithAppliedValues } from "dashboard/projects/completed-task-potential";
import { completedTaskProjectColor, dailyProjectSegments, projectLegendItems } from "dashboard/projects/completed-task-project-colors";
import WidgetWrapper from "./widget-wrapper";
import { useCompletedTaskProjects } from "hooks/use-completed-task-projects";
import MaterialIcon from "material-icon";
import { pluginSettings } from "plugin-data";
import { useState } from "react";
import "styles/victory-value.scss";
import { dateFromDateInput, dateKeyFromDateInput, tooltipLabelFromDateInput, weekDateSlotsFromDateInput } from "util/date-utility";
import { renderMarkdown } from "util/utility";

// Mood ratings and their labels, as the Mood widget names them
const MOODS = [
  { label: 'Awful', value: -2 },
  { label: 'Bad', value: -1 },
  { label: 'Okay', value: 0 },
  { label: 'Good', value: 1 },
  { label: 'Great', value: 2 },
];

// ------------------------------------------------------------------------------------------
// @desc Build seven daily totals ending on the reference date, using supplied daily values until tasks are available.
//   Each day's total is split into a segment per project the completed task ledger names, so its bar can be stacked.
// @param {Object} completedTasksByDate - Completed tasks grouped by local date key.
// @param {Array} dailyValues - Fallback daily totals.
// @param {Date|string} referenceDate - Last day of the displayed range.
// @param {Object|null} [completedTaskProjects] - Ledger lookups from useCompletedTaskProjects, or null without ledger data.
// @returns {Array} Seven chronological days of { date, day, segments, taskCount, value }. A day known only from the
//   fallback totals has a single "No project" segment.
export function buildDailyValuesForWeek(completedTasksByDate, dailyValues, referenceDate, completedTaskProjects = null) {
  const startDate = dateFromDateInput(referenceDate);
  startDate.setDate(startDate.getDate() - 6);
  const weekSlots = weekDateSlotsFromDateInput(startDate, startDate.getDay());
  const valuesByDate = new Map((dailyValues || []).map(entry => [dateKeyFromDateInput(entry.date), entry]));
  return weekSlots.map((slot) => {
    const tasksForDay = completedTasksByDate?.[slot.dateKey];
    const fallback = valuesByDate.get(slot.dateKey);
    const value = Array.isArray(tasksForDay)
      ? tasksForDay.reduce((sum, task) => sum + (task.victoryValue || 0), 0) : fallback?.value || 0;
    const taskCount = Array.isArray(tasksForDay) ? tasksForDay.length : fallback?.taskCount || 0;
    const fallbackTasks = value > 0 ? [{ victoryValue: value }] : [];
    const segments = dailyProjectSegments(Array.isArray(tasksForDay) ? tasksForDay : fallbackTasks, slot.dateKey, completedTaskProjects);
    return { date: slot.date, day: slot.day, segments, taskCount, value };
  });
}

// ------------------------------------------------------------------------------------------
// @desc Format the first and last displayed dates for the widget header.
// @param {Array} chartDailyValues - Seven chronological daily values.
// @returns {string} Localized date range.
function formatWeekDateRange(chartDailyValues) {
  if (!chartDailyValues || chartDailyValues.length < 7) return '';
  const start = dateFromDateInput(chartDailyValues[0].date);
  const end = dateFromDateInput(chartDailyValues[6].date);
  const options = { day: 'numeric', month: 'short' };
  return `${ start.toLocaleDateString(undefined, options) } – ${ end.toLocaleDateString(undefined, options) }`;
}

// [Claude] Task: persist widget config via app.setSetting (real Amplenote API)
async function handleConfigSubmit(app, timeRange, showMood, setConfigOpen) {
  const result = [timeRange, String(showMood)];
  await app.setSetting(widgetConfigKey('victory-value'), JSON.stringify(result));
  setConfigOpen(false);
}

// [Claude] Task: parse showMood boolean setting, defaulting to true when unset
function parseShowMoodSetting(value) {
  if (value === undefined || value === null) return true;
  return value === 'true' || value === true;
}

function handleConfigCancel(currentConfig, setTimeRange, setShowMood, setConfigOpen) {
  setTimeRange(currentConfig[0] || 'week');
  setShowMood(parseShowMoodSetting(currentConfig[1]));
  setConfigOpen(false);
}

function getHoveredDayTasks(index, dailyValues, completedTasksByDate) {
  if (!completedTasksByDate || !dailyValues[index]) return [];
  const dateKey = dateKeyFromDateInput(dailyValues[index].date);
  return (completedTasksByDate[dateKey] || [])
    .slice()
    .sort((a, b) => (b.victoryValue || 0) - (a.victoryValue || 0));
}

function buildMoodByDay(moodRatings, chartDailyValues) {
  if (!moodRatings || !Array.isArray(moodRatings) || !chartDailyValues) return [];

  const moodByDateKey = {};
  for (const mood of moodRatings) {
    if (!mood || mood.timestamp == null) continue;
    const date = new Date(mood.timestamp * 1000);
    const key = dateKeyFromDateInput(date);
    if (!moodByDateKey[key] || mood.timestamp > moodByDateKey[key].timestamp) {
      moodByDateKey[key] = mood;
    }
  }

  return chartDailyValues.map((dayEntry) => {
    const key = dateKeyFromDateInput(dayEntry.date);
    return moodByDateKey[key] || null;
  });
}

function getHoveredDayMood(index, moodByDay, dailyValues) {
  if (!moodByDay || !moodByDay[index]) return null;
  if (dailyValues && dailyValues[index]) {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const date = dateFromDateInput(dailyValues[index].date);
    if (date > today) return null;
  }
  const rating = moodByDay[index].rating;
  return MOODS.find((m) => m.value === rating) || null;
}

// ------------------------------------------------------------------------------------------
// @desc The swatch and name of the project a tooltip row's task advanced.
// @param {Object|null} projectColor - From completedTaskProjectColor, or null when no project claims the task.
// @returns {string} HTML, empty when no project claims the task.
function tooltipProjectHtml(projectColor) {
  if (!projectColor) return '';
  return `<span class="dashboard-tooltip-row-project"><span class="dashboard-tooltip-row-swatch" `
    + `style="background: var(${ projectColor.colorToken })"></span>${ escapedHtml(projectColor.label) }</span>`;
}

// ------------------------------------------------------------------------------------------
// @desc Build the tooltip for a hovered bar in the layout of the host's Task Stats tooltip: the date, the day's victory
//   value and task count, its mood, then each completed task with its victory value and, when the completed task ledger
//   names one, the project it advanced.
// @param {number} hoveredBar - Index of the hovered day.
// @param {Array} dailyValues - The displayed days.
// @param {Object} completedTasksByDate - Completed tasks grouped by local date key.
// @param {Array} moodByDay - The mood recorded on each displayed day, or null.
// @param {Object|null} [completedTaskProjects] - Ledger lookups from useCompletedTaskProjects.
// @returns {string} Tooltip HTML.
export function buildTooltipHTML(hoveredBar, dailyValues, completedTasksByDate, moodByDay, completedTaskProjects = null) {
  const day = dailyValues[hoveredBar];
  const tasks = getHoveredDayTasks(hoveredBar, dailyValues, completedTasksByDate);
  const mood = getHoveredDayMood(hoveredBar, moodByDay, dailyValues);
  const victoryValue = Math.round((day?.value || 0) * 10) / 10;
  const noDataClassName = tasks.length ? '' : ' stats-chart-tooltip-stat--no-data';
  const rows = [
    { className: `stats-chart-tooltip-stat--victory-value${ noDataClassName }`, iconName: 'equalizer',
      text: `${ victoryValue } Victory Value` },
    { className: noDataClassName, iconName: 'checklist',
      text: `${ tasks.length } completed task${ tasks.length === 1 ? '' : 's' }` },
  ];
  if (mood) rows.push({ iconName: 'emoji_emotions', iconStyle: `color: ${ moodColorFromRating(mood.value) }`, text: mood.label });
  const dateKey = day ? dateKeyFromDateInput(day.date) : null;
  for (const task of tasks) {
    const projectColor = completedTaskProjectColor(task, dateKey, completedTaskProjects);
    rows.push({ className: 'stats-chart-tooltip-stat--task', html: renderMarkdown(task.content) + tooltipProjectHtml(projectColor),
      iconName: 'check_circle', trailing: `${ task.victoryValue || 0 } pts` });
  }
  const title = day ? tooltipLabelFromDateInput(day.date) : '';
  return statsChartTooltipHtml({ rows, title, titleIconName: 'event' });
}

// ------------------------------------------------------------------------------------------
// @desc Shift the displayed range by whole calendar weeks, stopping at today when navigating forward.
// @param {number} deltaWeeks - Number of weeks to move backward or forward.
// @param {Date|string} referenceDate - Last displayed date.
// @returns {string} Local date key for the new range end.
function shiftWeekDate(deltaWeeks, referenceDate) {
  const date = dateFromDateInput(referenceDate);
  date.setDate(date.getDate() + deltaWeeks * 7);
  const shiftedKey = dateKeyFromDateInput(date);
  const todayKey = dateKeyFromDateInput(new Date());
  return shiftedKey > todayKey ? todayKey : shiftedKey;
}

// ------------------------------------------------------------------------------------------
// @desc Render the saved time range options with a seven-day default.
// @param {Object} props - Time range selection and its state setter.
function TimeRangeOptions({ setTimeRange, timeRange }) {
  return (
    <>
      {['week', 'month', '30days'].map((value) => (
        <label key={value}>
          <input
            type="radio"
            name="vv-time-range"
            value={value}
            checked={timeRange === value}
            onChange={setTimeRange.bind(null, value)}
          />
          {value === 'week' ? 'Last 7 days' : value === 'month' ? 'This month' : 'Last 30 days'}
        </label>
      ))}
    </>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Render a swatch and name for each project the displayed days' bars are colored by.
// @param {Object} props - { items }: legend items from projectLegendItems.
// @returns {JSX.Element|null} The legend, or nothing when no bar is colored by project.
function ProjectLegend({ items }) {
  if (!items.length) return null;
  return (
    <div className="vv-project-legend">
      {items.map(item => (
        <span className="vv-project-legend-item" key={item.key}>
          <span className="vv-project-legend-swatch" style={{ background: `var(${ item.colorToken })` }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// @desc Render the seven days ending on the selected date, with arrows that move the range by one week. Bars are
//   stacked by the project each completed task advanced, as the active domain's completed task ledger records it, and a
//   task the potential rating raised is shown at its raised victory value.
// @param {Object} props - Completed tasks, mood ratings, fallback totals, date navigation callback, and the active task
//   domain's name, whose ledger colors the bars.
// @returns {JSX.Element} Configurable Victory Value chart.
export default function VictoryValueWidget({ app, completedTasksByDate, dailyValues, moodRatings,
    onReferenceDateChange, referenceDate, taskDomainName }) {
  const rangeEndDate = referenceDate || dateKeyFromDateInput(new Date());
  const completedTaskProjects = useCompletedTaskProjects(app, { domainName: taskDomainName, referenceDate: rangeEndDate });
  const displayedTasksByDate = completedTasksWithAppliedValues(completedTasksByDate, completedTaskProjects);
  const chartDailyValues = buildDailyValuesForWeek(displayedTasksByDate, dailyValues, rangeEndDate, completedTaskProjects);
  const legendItems = projectLegendItems(chartDailyValues);
  const chartWeeklyTotal = chartDailyValues.reduce((sum, entry) => sum + (entry.value || 0), 0);
  const roundedWeeklyTotal = Math.round(chartWeeklyTotal);
  const moodByDay = buildMoodByDay(moodRatings, chartDailyValues);

  const [configOpen, setConfigOpen] = useState(false);
  const currentConfig = parseWidgetConfig(pluginSettings(), 'victory-value');
  const [timeRange, setTimeRange] = useState(currentConfig[0] || 'week');
  const [showMood, setShowMood] = useState(parseShowMoodSetting(currentConfig[1]));
  const onConfigure = setConfigOpen.bind(null, true);
  const onConfigSubmit = handleConfigSubmit.bind(null, app, timeRange, showMood, setConfigOpen);
  const onConfigCancel = handleConfigCancel.bind(null, currentConfig, setTimeRange, setShowMood, setConfigOpen);
  const weekDateRange = formatWeekDateRange(chartDailyValues);
  const tooltipHtmlFromIndex = index => buildTooltipHTML(index, chartDailyValues, displayedTasksByDate, moodByDay,
    completedTaskProjects);

  return (
    <WidgetWrapper configurable={true} onConfigure={onConfigure} widgetId="victory-value">
      {configOpen ? (
        <ConfigPopup
          title="Configure Victory Value"
          onSubmit={onConfigSubmit}
          onCancel={onConfigCancel}
        >
          <div className="config-field">
            <div className="config-field-label">Time range</div>
            <TimeRangeOptions setTimeRange={setTimeRange} timeRange={timeRange} />
          </div>
          <div className="config-field">
            <div className="config-field-label">Mood overlay</div>
            <label>
              <input
                type="checkbox"
                checked={showMood}
                onChange={(event) => setShowMood(event.target.checked)}
              />
              Show mood overlay
            </label>
          </div>
        </ConfigPopup>
      ) : null}
      <div className="vv-header">
        <span className="vv-total">{roundedWeeklyTotal}</span>
        <span className="vv-label">{`points ${ weekDateRange }`}</span>
      </div>
      <ProjectLegend items={legendItems} />
      <div className="vv-chart-container">
        <button
          className="vv-nav-arrow"
          type="button"
          onClick={() => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(-1, rangeEndDate))}
          title="Previous week"
          aria-label="Previous week"
        ><MaterialIcon name="chevron_left" size={ 20 } /></button>
        <div className="vv-chart-wrap">
          <VictoryValueChart dailyValues={chartDailyValues} hasProjectLegend={legendItems.length > 0} moodByDay={moodByDay}
            showMood={showMood} tooltipHtmlFromIndex={tooltipHtmlFromIndex} />
        </div>
        <button
          className="vv-nav-arrow"
          type="button"
          disabled={dateKeyFromDateInput(rangeEndDate) >= dateKeyFromDateInput(new Date())}
          onClick={() => onReferenceDateChange && onReferenceDateChange(shiftWeekDate(1, rangeEndDate))}
          title="Next week"
          aria-label="Next week"
        ><MaterialIcon name="chevron_right" size={ 20 } /></button>
      </div>
    </WidgetWrapper>
  );
}
