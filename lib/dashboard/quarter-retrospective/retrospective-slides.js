// Turn a quarter's retrospective statistics into the ordered slides the story plays. Each slide carries a headline,
// an optional large figure that counts up, an optional ranked list, and a caption. The data style uses the captions
// written here; the roast and Spotify styles replace them with ones the AI wrote from the same numbers.
import { quarterStartDate } from "constants/quarters";
import { dateFromDateInput } from "util/date-utility";

export const RETROSPECTIVE_STYLES = Object.freeze({ data: "data", roast: "roast", spotify: "spotify" });

// ----------------------------------------------------------------------------------------------
// @desc Format a count of minutes as hours and minutes.
// @param {number} minutes - Whole minutes.
// @returns {string} Such as "14h 30m", "45m", or "0m".
export function formattedMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${ remainder }m`;
  return remainder ? `${ hours }h ${ remainder }m` : `${ hours }h`;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the story's slides. A slide whose facts the quarter lacks is left out, such as project slides for a
//   quarter whose completions were never sorted into projects; a quarter with no completions gets one slide.
// @param {object} statistics - From retrospectiveStatistics.
// @returns {Array<object>} Slides as { caption, figure, headline, id, items, kicker, tone }, where figure is
//   { prefix, suffix, value } or null, and items are { label, value } rows.
export function slidesFromStatistics(statistics) {
  const quarterLabel = `Q${ statistics.quarter } ${ statistics.year }`;
  if (!statistics.totalTaskCount) {
    return [{ caption: "Nothing was checked off in this quarter, so there's nothing to look back on yet.", figure: null,
      headline: `${ quarterLabel } was quiet`, id: "empty", items: [], kicker: "Your quarter in review", tone: "intro" }];
  }
  const slides = [_introSlide(statistics, quarterLabel), _victoryTotalSlide(statistics), ..._projectSlides(statistics),
    _doneAndOpenSlide(statistics), _importantTasksSlide(statistics), _outsideProjectsSlide(statistics), _intentSlide(statistics),
    _busiestDaySlide(statistics), _streakSlide(statistics), _meetingsSlide(statistics), _summarySlide(statistics, quarterLabel)];
  const presentSlides = slides.filter(Boolean);
  return presentSlides;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
function _busiestDaySlide({ busiestDay }) {
  if (!busiestDay?.victoryValue) return null;
  const dayLabel = dateFromDateInput(busiestDay.dateKey).toLocaleDateString("en-US", { day: "numeric", month: "long", weekday: "long" });
  const taskWord = busiestDay.taskCount === 1 ? "task" : "tasks";
  return { caption: `${ busiestDay.taskCount } ${ taskWord } done in a single day.`, figure: { prefix: "", suffix: " VV",
    value: busiestDay.victoryValue }, headline: dayLabel, id: "busiest-day", items: [], kicker: "Your biggest day", tone: "sunrise" };
}

// ----------------------------------------------------------------------------------------------
// @desc Each project's done tasks beside those still open when the quarter ended, shown only when open tasks were
//   counted for at least one project.
function _doneAndOpenSlide({ doneAndOpenByProject, quarter, year }) {
  const countedProjects = (doneAndOpenByProject || []).filter(project => project.openCount !== null);
  if (!countedProjects.length) return null;
  const listedProjects = countedProjects.slice(0, 5);
  const items = listedProjects.map(project => ({ label: project.name, value: `${ project.doneCount } done · ${ project.openCount } open` }));
  const endLabel = new Date(year, quarter * 3, 0).toLocaleDateString("en-US", { day: "numeric", month: "long" });
  return { caption: `Open counts are the tasks we know of that were still open on ${ endLabel }.`, figure: null,
    headline: "Done vs. still open", id: "done-and-open", items, kicker: "Where each project stood", tone: "forest" };
}

// ----------------------------------------------------------------------------------------------
function _importantTasksSlide({ importantTasks }) {
  if (!importantTasks.count) return null;
  const items = importantTasks.listed.map(task => ({ label: task.text,
    value: task.elapsedDays === null ? `${ task.victoryValue } VV` : `${ task.elapsedDays }d to done` }));
  const caption = importantTasks.averageElapsedDays === null ? "Every one of them marked important, and every one finished."
    : `On average, an important task took ${ importantTasks.averageElapsedDays } days from created to completed.`;
  return { caption, figure: { prefix: "", suffix: "", value: importantTasks.count }, headline: "Important tasks completed",
    id: "important-tasks", items, kicker: "The ones that mattered", tone: "ember" };
}

// ----------------------------------------------------------------------------------------------
function _intentSlide({ intentAlignmentPercent, intentTexts, projectTaskCount, unclassifiedTaskCount }) {
  if (intentAlignmentPercent === null) {
    if (!intentTexts.length) return null;
    return { caption: "Your completed tasks were never sorted into projects, so how well they served these intents is unknown.",
      figure: null, headline: "What you set out to do", id: "intent", items: intentTexts.map(text => ({ label: text, value: "" })),
      kicker: "Intent vs. reality", tone: "ocean" };
  }
  const unsortedNote = unclassifiedTaskCount ? ` ${ unclassifiedTaskCount } more were never sorted.` : "";
  const items = intentTexts.map(text => ({ label: text, value: "" }));
  return { caption: `${ projectTaskCount } completed tasks advanced a project serving your intents.${ unsortedNote }`,
    figure: { prefix: "", suffix: "%", value: intentAlignmentPercent }, headline: "of your work served your intent", id: "intent",
    items, kicker: "Intent vs. reality", tone: "ocean" };
}

// ----------------------------------------------------------------------------------------------
function _introSlide({ quarterName, quarter, totalTaskCount, year }, quarterLabel) {
  const start = quarterStartDate(year, quarter);
  const end = new Date(year, quarter * 3, 0);
  const range = `${ start.toLocaleDateString("en-US", { day: "numeric", month: "short" }) } – ${ end.toLocaleDateString("en-US",
    { day: "numeric", month: "short" }) }`;
  const headline = quarterName ? `“${ quarterName }”` : `${ quarterLabel }, wrapped`;
  return { caption: `tasks completed, ${ range }.`, figure: { prefix: "", suffix: "", value: totalTaskCount }, headline,
    id: "intro", items: [], kicker: quarterName ? `${ quarterLabel }, wrapped` : "Your quarter in review", tone: "intro" };
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's meeting time by kind of meeting, shown only when the calendar was included and held meetings.
function _meetingsSlide({ calendarCoverage, meetingMinutesByCategory }) {
  if (!meetingMinutesByCategory?.length) return null;
  const totalMinutes = meetingMinutesByCategory.reduce((total, category) => total + category.minutes, 0);
  const items = meetingMinutesByCategory.map(category => ({ label: category.category, value: formattedMinutes(category.minutes) }));
  const coverageNote = calendarCoverage ? ` Your calendar was recorded on ${ calendarCoverage.coveredDays } of ${ calendarCoverage.totalDays } days.` : "";
  return { caption: `Time on your calendar, by kind of meeting.${ coverageNote }`, figure: { prefix: "", suffix: "h",
    value: Math.round(totalMinutes / 60) }, headline: "in meetings and blocks", id: "meetings", items, kicker: "On the calendar", tone: "ocean" };
}

// ----------------------------------------------------------------------------------------------
function _outsideProjectsSlide({ classifiedTaskCount, outsideProjectTaskCount, unclassifiedTaskCount }) {
  if (!classifiedTaskCount) return null;
  const share = Math.round((outsideProjectTaskCount / classifiedTaskCount) * 100);
  const unsortedNote = unclassifiedTaskCount ? ` Another ${ unclassifiedTaskCount } were never sorted at all.` : "";
  return { caption: `${ share }% of your sorted tasks belonged to no recognized project.${ unsortedNote }`,
    figure: { prefix: "", suffix: "", value: outsideProjectTaskCount }, headline: "tasks done outside any project",
    id: "outside-projects", items: [], kicker: "Off the map", tone: "dusk" };
}

// ----------------------------------------------------------------------------------------------
// @desc The three project rankings, each as its own slide, leaving out a ranking with no projects.
// @param {object} statistics - From retrospectiveStatistics.
// @returns {Array<object>} Zero to three slides.
function _projectSlides({ defaultedDurationCount, leaders }) {
  const slides = [];
  const [victoryLeader] = leaders.byVictoryValue;
  if (victoryLeader) {
    slides.push({ caption: `${ victoryLeader.victoryValue } Victory Value across ${ victoryLeader.taskCount } tasks.`, figure: null,
      headline: victoryLeader.name, id: "project-victory", items: leaders.byVictoryValue.map(project => ({ label: project.name,
        value: `${ project.victoryValue } VV` })), kicker: "Your most victorious project", tone: "forest" });
  }
  const [taskLeader] = leaders.byTaskCount;
  if (taskLeader) {
    slides.push({ caption: `${ taskLeader.taskCount } tasks checked off.`, figure: null, headline: taskLeader.name,
      id: "project-tasks", items: leaders.byTaskCount.map(project => ({ label: project.name, value: `${ project.taskCount } tasks` })),
      kicker: "Your busiest project", tone: "violet" });
  }
  const [timeLeader] = leaders.byMinutes;
  if (timeLeader) {
    const defaultedNote = defaultedDurationCount ? ` ${ defaultedDurationCount } tasks had no length set, so each counted as an hour.` : "";
    slides.push({ caption: `${ formattedMinutes(timeLeader.minutes) } of time on its tasks.${ defaultedNote }`, figure: null,
      headline: timeLeader.name, id: "project-time", items: leaders.byMinutes.map(project => ({ label: project.name,
        value: formattedMinutes(project.minutes) })), kicker: "Where your time went", tone: "teal" });
  }
  return slides;
}

// ----------------------------------------------------------------------------------------------
// @desc The most consecutive days with a completion, shown when the streak ran at least three days.
function _streakSlide({ longestStreak }) {
  if (!longestStreak || longestStreak.days < 3) return null;
  const dayLabel = dateKey => dateFromDateInput(dateKey).toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return { caption: `Something got done every day from ${ dayLabel(longestStreak.startDateKey) } to ${ dayLabel(longestStreak.endDateKey) }.`,
    figure: { prefix: "", suffix: " days", value: longestStreak.days }, headline: "Your longest streak", id: "streak", items: [],
    kicker: "Consistency", tone: "violet" };
}

// ----------------------------------------------------------------------------------------------
function _summarySlide(statistics, quarterLabel) {
  const items = [{ label: "Tasks completed", value: String(statistics.totalTaskCount) },
    { label: "Victory Value", value: String(statistics.totalVictoryValue) }];
  if (statistics.totalMinutes) items.push({ label: "Scheduled time", value: formattedMinutes(statistics.totalMinutes) });
  if (statistics.leaders.byVictoryValue[0]) items.push({ label: "Top project", value: statistics.leaders.byVictoryValue[0].name });
  if (statistics.importantTasks.count) items.push({ label: "Important tasks", value: String(statistics.importantTasks.count) });
  if (statistics.intentAlignmentPercent !== null) items.push({ label: "Served your intent", value: `${ statistics.intentAlignmentPercent }%` });
  return { caption: "On to the next one.", figure: null, headline: `That was ${ quarterLabel }`, id: "summary", items,
    kicker: "The whole quarter", tone: "intro" };
}

// ----------------------------------------------------------------------------------------------
function _victoryTotalSlide({ totalTaskCount, totalVictoryValue }) {
  const perTask = totalTaskCount ? (totalVictoryValue / totalTaskCount).toFixed(1) : "0";
  return { caption: `That's ${ perTask } per completed task.`, figure: { prefix: "", suffix: "", value: totalVictoryValue },
    headline: "Victory Value earned", id: "victory-total", items: [], kicker: "Total victory", tone: "gold" };
}
