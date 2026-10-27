// Turn a quarter's retrospective statistics into the ordered slides the story plays. Each slide carries a headline,
// an optional large figure that counts up, an optional ranked list, and a caption, and its kind says how it is drawn:
// a figure, project bars, the progress heap, a month timeline, or a photo. The data style uses the words written here;
// the roast and Spotify styles replace them with ones the AI wrote from the same numbers.
import { quarterLabel, quarterStartDate } from "constants/quarters";
import { dateFromDateInput } from "util/date-utility";

export const RETROSPECTIVE_STYLES = Object.freeze({ data: "data", roast: "roast", spotify: "spotify" });
// The end card and payoff ranking slides are interactive: the story waits on them rather than advancing on its own.
export const SLIDE_KINDS = Object.freeze({ bars: "bars", endCard: "end-card", figure: "figure", hardestTasks: "hardest-tasks", heap: "heap",
  image: "image", payoffRanking: "payoff-ranking", timeline: "timeline" });
export const END_CARD_SLIDE_ID = "end-card";
export const PAYOFF_RANKING_SLIDE_ID = "payoff-ranking";
// A ranking needs at least two projects to compare; a quarter with one has nothing to order.
export const MINIMUM_PAYOFF_RANKING_PROJECTS = 2;
// The heap keeps its slide longer than others, so the pile has time to land before the story moves on.
const HEAP_DURATION_FACTOR = 1.5;
// A slide whose words number fewer than this reads at a glance, so it holds for SHORT_SLIDE_DURATION_FACTOR of the usual
// time: about 7 seconds where a data-rich slide holds 12.
export const SHORT_SLIDE_WORD_LIMIT = 10;
export const SHORT_SLIDE_DURATION_FACTOR = 7 / 12;
const LISTED_BAR_PROJECTS = 5;
// A quarter that fell behind the one before by more than this share of tasks or Victory Value skips the comparison,
// since the story is there to show progress, and a smaller dip is framed as a lighter quarter rather than a decline.
export const SHOWN_DECLINE_PERCENT_LIMIT = 10;
// What the Victory Value slide says Victory Value is, and the detail behind its "How do we calculate it?" prompt.
export const VICTORY_VALUE_EXPLANATION = "Victory Value is a score assigned to each of your completed tasks. The harder the task, the more "
  + "valuable, the more aligned with your Projects - the higher the Victory Value.";
export const VICTORY_VALUE_CALCULATION = Object.freeze({ label: "How do we calculate it?", paragraphs: Object.freeze([
  "Victory Value is initially calculated when your task is completed, based on its duration, whether it was marked as Important, and related factors.",
  "When you have an Agent Pro subscription, we take Victory Value a step further, by designating more Victory Value for tasks that align with your prioritized goals for the quarter."]) });

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
// @param {object} [options] - { monthDigests }: the months' digests, whose highlights the month timeline shows when the
//   AI wrote them.
// @returns {Array<object>} Slides as { caption, figure, headline, id, items, kicker, kind, tone }, where figure is
//   { prefix, suffix, value } or null, items are { label, value } rows, and kind is a SLIDE_KINDS value. Some kinds carry
//   more: bars has bars, { done, label, open } per project; heap has heap, { blocks, legend } from progressHeap, and
//   durationFactor; timeline has columns, { label, note, value } per month.
export function slidesFromStatistics(statistics, { monthDigests = null } = {}) {
  const quarterLabel = `Q${ statistics.quarter } ${ statistics.year }`;
  if (!statistics.totalTaskCount) {
    return [{ caption: "Nothing was checked off in this quarter, so there's nothing to look back on yet.", figure: null,
      headline: `${ quarterLabel } was quiet`, id: "empty", items: [], kicker: "Your quarter in review", kind: SLIDE_KINDS.figure, tone: "intro" }];
  }
  const slides = [_introSlide(statistics, quarterLabel), _victoryTotalSlide(statistics), _previousQuarterSlide(statistics), _heapSlide(statistics),
    _monthTimelineSlide(statistics, monthDigests), ..._projectSlides(statistics),
    _doneAndOpenSlide(statistics), _importantTasksSlide(statistics), _outsideProjectsSlide(statistics), _intentSlide(statistics),
    _busiestDaySlide(statistics), _streakSlide(statistics), _meetingsSlide(statistics), _summarySlide(statistics, quarterLabel)];
  const presentSlides = slides.filter(Boolean);
  const kindedSlides = presentSlides.map(slide => ({ kind: SLIDE_KINDS.figure, ...slide }));
  return kindedSlides;
}

// ----------------------------------------------------------------------------------------------
// @desc How long a slide holds relative to the story's usual slide length. A slide that sets its own durationFactor,
//   such as the heap, keeps it; otherwise a slide with fewer than SHORT_SLIDE_WORD_LIMIT words of main content moves on
//   sooner. Counted at play time, so slides whose words the AI rewrote are judged by the words actually shown.
// @param {object} slide - From slidesFromStatistics or the story writer.
// @returns {number} The factor to multiply the usual slide length by.
export function slideDurationFactor(slide) {
  const explicitFactor = Number(slide?.durationFactor);
  if (explicitFactor) return explicitFactor;
  return slideWordCount(slide) < SHORT_SLIDE_WORD_LIMIT ? SHORT_SLIDE_DURATION_FACTOR : 1;
}

// ----------------------------------------------------------------------------------------------
// @desc Count the words of a slide's main content: its headline, caption, explanation, list rows, bar labels, and month
//   columns. The kicker above and the large figure are left out, since both are taken in at a glance, and a token with no
//   letter or digit, such as a dash, is not a word.
// @param {object} slide - A slide.
// @returns {number} The word count.
export function slideWordCount(slide) {
  const itemTexts = (slide?.items || []).flatMap(item => [item.label, item.value]);
  const barTexts = (slide?.bars || []).map(bar => bar.label);
  const columnTexts = (slide?.columns || []).flatMap(column => [column.label, column.note]);
  const texts = [slide?.headline, slide?.caption, slide?.explanation, ...itemTexts, ...barTexts, ...columnTexts];
  const tokens = texts.flatMap(text => String(text || "").split(/\s+/));
  const words = tokens.filter(token => /[\p{L}\p{N}]/u.test(token));
  return words.length;
}

// ----------------------------------------------------------------------------------------------
// @desc Add the end card to a story: the last slide, where the user replays the story, goes back to generate another,
//   or saves the quarter's takeaways in a note. It is built at play time rather than saved with the story, so stories
//   saved before it existed end on it too.
// @param {Array<object>} slides - The story's slides.
// @param {string} quarterName - Such as "Q3 2026".
// @returns {Array<object>} The slides with the end card last, or the slides as given when they already end on one.
export function slidesWithEndCard(slides, quarterName) {
  if (slides.some(slide => slide.id === END_CARD_SLIDE_ID)) return slides;
  const endCard = { caption: "", figure: null, headline: "What next?", id: END_CARD_SLIDE_ID, items: [], kicker: `That was ${ quarterName }`,
    kind: SLIDE_KINDS.endCard, tone: "intro" };
  return [...slides, endCard];
}

// ----------------------------------------------------------------------------------------------
// @desc Add the payoff ranking slide to a story, just before its end card, or at its end when it has none. The slide
//   is built at play time rather than saved with the story, so it appears only while the quarter is still unranked.
// @param {Array<object>} slides - The story's slides.
// @param {Array<object>} projects - { derivedFrom, name, uuid } per project to rank.
// @returns {Array<object>} The slides with the ranking slide added, or the slides as given when there are fewer than
//   MINIMUM_PAYOFF_RANKING_PROJECTS projects.
export function slidesWithPayoffRanking(slides, projects) {
  if ((projects?.length || 0) < MINIMUM_PAYOFF_RANKING_PROJECTS || slides.some(slide => slide.id === PAYOFF_RANKING_SLIDE_ID)) return slides;
  const rankingSlide = { caption: "", figure: null, headline: "Rank your quarter's projects", id: PAYOFF_RANKING_SLIDE_ID,
    items: [], kicker: "In hindsight", kind: SLIDE_KINDS.payoffRanking, projects, tone: "teal" };
  const endCardIndex = slides.findIndex(slide => slide.id === END_CARD_SLIDE_ID);
  const insertIndex = endCardIndex === -1 ? slides.length : endCardIndex;
  return [...slides.slice(0, insertIndex), rankingSlide, ...slides.slice(insertIndex)];
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
// @desc Each project's done tasks beside those still open when the quarter ended, as bars, shown only when open tasks
//   were counted for at least one project.
function _doneAndOpenSlide({ doneAndOpenByProject, quarter, year }) {
  const countedProjects = (doneAndOpenByProject || []).filter(project => project.openCount !== null);
  if (!countedProjects.length) return null;
  const listedProjects = countedProjects.slice(0, LISTED_BAR_PROJECTS);
  const bars = listedProjects.map(project => ({ done: project.doneCount, label: project.name, open: project.openCount }));
  const endLabel = new Date(year, quarter * 3, 0).toLocaleDateString("en-US", { day: "numeric", month: "long" });
  return { bars, caption: `Open counts are the tasks we know of that were still open on ${ endLabel }.`, figure: null,
    headline: "Done vs. still open", id: "done-and-open", items: [], kicker: "Where each project stood", kind: SLIDE_KINDS.bars, tone: "forest" };
}

// ----------------------------------------------------------------------------------------------
// @desc The progress heap: every completed task as a block on a growing pile, colored by project, ending on the total.
function _heapSlide({ progressHeap, totalTaskCount }) {
  if (!progressHeap?.blocks?.length) return null;
  const colored = progressHeap.legend.length ? "colored by project and " : "";
  return { caption: `Every block is one completed task, ${ colored }sized by its Victory Value.`, durationFactor: HEAP_DURATION_FACTOR,
    figure: { prefix: "", suffix: "", value: totalTaskCount }, headline: "tasks, piled up", heap: progressHeap, id: "progress-heap", items: [],
    kicker: "Your progress mountain", kind: SLIDE_KINDS.heap, tone: "violet" };
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
// @desc The quarter's completed tasks by month as a timeline, each month noted with its leading highlight when the AI
//   digested at least one month. The counts come from the statistics; only the words come from the digests.
function _monthTimelineSlide({ monthlyTaskCounts, quarter, year }, monthDigests) {
  const highlighted = !!monthDigests?.some(digest => digest?.generatedBy === "ai" && digest.highlights?.length);
  const columns = monthlyTaskCounts.map((taskCount, index) => {
    const monthName = new Date(year, (quarter - 1) * 3 + index, 1).toLocaleDateString("en-US", { month: "long" });
    const digest = monthDigests?.[index];
    const note = highlighted ? digest?.highlights?.[0]?.summary || digest?.mood || "A quieter month" : "";
    return { label: monthName, note, value: taskCount };
  });
  const caption = highlighted ? "Tasks completed each month, with the highlight of each, summarized from your tasks."
    : "Tasks completed in each month of the quarter.";
  return { caption, columns, figure: null, headline: "How the quarter unfolded", id: "month-by-month", items: [], kicker: "Month by month",
    kind: SLIDE_KINDS.timeline, tone: "dusk" };
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
// @desc This quarter's totals beside the quarter before's. When tasks or Victory Value grew, the larger growth leads as
//   the figure. When neither grew and neither fell by more than SHOWN_DECLINE_PERCENT_LIMIT, the quarter is framed as a
//   lighter one. When either fell by more, or the quarter before can't be compared, the slide is left out.
// @param {object} statistics - From retrospectiveStatistics.
// @returns {object|null} A figure slide with id "previous-quarter", or null.
function _previousQuarterSlide({ quarterOverQuarter, totalTaskCount, totalVictoryValue }) {
  if (!quarterOverQuarter) return null;
  const { previousQuarter, previousTaskCount, previousVictoryValue, taskCountChangePercent, victoryValueChangePercent } = quarterOverQuarter;
  const changes = [{ headline: "more tasks completed", lighterCaption: "More checked off, each a lighter lift.", percent: taskCountChangePercent },
    { headline: "more Victory Value earned", lighterCaption: "Fewer checkmarks, bigger wins.", percent: victoryValueChangePercent }];
  const comparableChanges = changes.filter(change => change.percent !== null);
  if (comparableChanges.some(change => change.percent < -SHOWN_DECLINE_PERCENT_LIMIT)) return null;
  const previousLabel = quarterLabel(previousQuarter.year, previousQuarter.quarter);
  const items = [];
  if (taskCountChangePercent !== null) items.push({ label: "Tasks completed", value: `${ totalTaskCount } vs. ${ previousTaskCount }` });
  if (victoryValueChangePercent !== null) items.push({ label: "Victory Value", value: `${ totalVictoryValue } vs. ${ previousVictoryValue }` });
  const rankedChanges = [...comparableChanges].sort((first, second) => second.percent - first.percent);
  const [leadingChange] = rankedChanges;
  const kicker = `Compared with ${ previousLabel }`;
  if (leadingChange.percent > 0) {
    const otherFellOrHeld = rankedChanges.length > 1 && rankedChanges[1].percent <= 0;
    const caption = otherFellOrHeld ? leadingChange.lighterCaption : `Up on ${ previousLabel }${ rankedChanges.length > 1 ? " across the board" : "" }.`;
    return { caption, figure: { prefix: "+", suffix: "%", value: leadingChange.percent }, headline: `${ leadingChange.headline } than ${ previousLabel }`,
      id: "previous-quarter", items, kicker, tone: "sunrise" };
  }
  const matched = comparableChanges.every(change => change.percent === 0);
  const headline = matched ? `Right on ${ previousLabel }'s pace` : "Less intense, more room to breathe";
  const caption = matched ? "Steady as it goes: the same output, quarter over quarter." : `A lighter quarter than ${ previousLabel }, `
    + "and close enough that the momentum carried through.";
  return { caption, figure: null, headline, id: "previous-quarter", items, kicker, tone: "teal" };
}

// ----------------------------------------------------------------------------------------------
// @desc The three project rankings, each as its own slide, leaving out a ranking with no projects.
// @param {object} statistics - From retrospectiveStatistics; projectsInferred adds a note to the captions.
// @returns {Array<object>} Zero to three slides.
function _projectSlides({ defaultedDurationCount, leaders, projectsInferred }) {
  const slides = [];
  const inferredNote = projectsInferred ? " Projects inferred from your tasks." : "";
  const [victoryLeader] = leaders.byVictoryValue;
  if (victoryLeader) {
    slides.push({ caption: `${ victoryLeader.victoryValue } Victory Value across ${ victoryLeader.taskCount } tasks.${ inferredNote }`, figure: null,
      headline: victoryLeader.name, id: "project-victory", items: leaders.byVictoryValue.map(project => ({ label: project.name,
        value: `${ project.victoryValue } VV` })), kicker: "Your most victorious project", tone: "forest" });
  }
  const [taskLeader] = leaders.byTaskCount;
  if (taskLeader) {
    slides.push({ caption: `${ taskLeader.taskCount } tasks checked off.${ inferredNote }`, figure: null, headline: taskLeader.name,
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
// @desc The quarter's total Victory Value, what it averages per task, what Victory Value is, and a "How do we calculate
//   it?" detail the slide shows on hover or tap.
// @param {object} statistics - { totalTaskCount, totalVictoryValue }.
// @returns {object} The slide.
function _victoryTotalSlide({ totalTaskCount, totalVictoryValue }) {
  const perTask = totalTaskCount ? (totalVictoryValue / totalTaskCount).toFixed(1) : "0";
  return { caption: `That's ${ perTask } per completed task.`, explanation: VICTORY_VALUE_EXPLANATION, explanationDetail: VICTORY_VALUE_CALCULATION,
    figure: { prefix: "", suffix: "", value: totalVictoryValue }, headline: "Victory Value earned", id: "victory-total", items: [],
    kicker: "Completed Task Record", tone: "gold" };
}
