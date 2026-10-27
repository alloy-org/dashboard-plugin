// Write a Quarter Retrospective's takeaways note: `{domain} Q{q} {year} Retrospective`, one note per domain and quarter
// whatever style the story played in. One AI call over the quarter's statistics, month digests, projects, and payoff
// ranking writes the prose: a summary, a paragraph per month, the calendar's shape, and what paid off. Every number in
// the note's tables comes from the statistics rather than from that prose, and without an AI, or when its reply holds
// nothing usable, the prose is built from the statistics and digests instead. The note's UUID is recorded in the data
// note's Takeaways section, so saving again opens the same note rather than writing another.
import { quarterLabel } from "constants/quarters";
import { readRetrospectiveDataNote, RETROSPECTIVE_SECTIONS, retrospectiveMonthSection,
  writeRetrospectiveDataSection } from "dashboard/quarter-retrospective/retrospective-data-note";
import { retrospectiveNoteTags } from "dashboard/quarter-retrospective/retrospective-note-tag";
import { formattedMinutes } from "dashboard/quarter-retrospective/retrospective-slides";
import { checkedAppResult, resolvedNoteHandle } from "plan-wizard/vision-guide-notes";
import { logIfEnabled } from "util/log";

// The most characters each part of the AI's prose keeps; a longer part is cut at its last full sentence.
export const TAKEAWAYS_TEXT_LIMITS = Object.freeze({ calendar: 900, month: 1100, paidOff: 1100, summary: 2200 });
const PROMPT_LISTED_HIGHLIGHTS = 5;
// A paragraph holding only a backslash is how Amplenote markdown writes an empty paragraph, which shows as a blank line.
const BLANK_LINE_PARAGRAPH = "\\";
// The header and body colors of each month's table, January first: a dark shade of the month's color behind white
//   text for the month's name, and a light hue of it behind dark text for what the month held. Both text colors are
//   set so each cell stays readable whether the note is viewed in light or dark mode.
const MONTH_CELL_COLORS = Object.freeze([
  { dark: "#1F3A5F", light: "#E3ECF7" }, { dark: "#5B2A4E", light: "#F5E4EF" }, { dark: "#2E5A3A", light: "#E3F2E6" },
  { dark: "#2F6B5E", light: "#E0F2EE" }, { dark: "#5A3E85", light: "#EEE6F7" }, { dark: "#7A5200", light: "#FBF0D9" },
  { dark: "#22374F", light: "#DDEBFA" }, { dark: "#8A3519", light: "#FBE7DE" }, { dark: "#5C4A1E", light: "#F4EEDD" },
  { dark: "#7A2E0E", light: "#FCE6D6" }, { dark: "#4A3B32", light: "#EFE8E2" }, { dark: "#1E4D47", light: "#E1F0EE" },
]);
const MONTH_HEADER_TEXT_COLOR = "#FFFFFF";
const MONTH_BODY_TEXT_COLOR = "#1F2933";
const MONTH_TABLE_WIDTH = 700;
const TAKEAWAYS_LOG_LABEL = "[retrospective-takeaways]";

// ----------------------------------------------------------------------------------------------
// @desc Name the takeaways note for one domain and quarter.
// @param {object} options - { domainName, quarter, year }.
// @returns {string} Such as "Work Q3 2026 Retrospective".
export function retrospectiveTakeawaysNoteName({ domainName, quarter, year }) {
  return `${ domainName } ${ quarterLabel(year, quarter) } Retrospective`;
}

// ----------------------------------------------------------------------------------------------
// @desc Open the quarter's takeaways note, writing it first when it doesn't exist yet. A note already recorded in the
//   data note, or one by the takeaways name that another style saved, is reused as it stands; its UUID is recorded in
//   this data note when missing.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} request - An object with the following properties:
//   - {string} dataNoteUuid - The playing retrospective's data note, which holds its statistics and month digests
//   - {string} domainName - Task domain display name
//   - {object|null} [payoffRanking] - The quarter's stored payoff ranking, from readProjectPayoffRanking
//   - {number} quarter - 1 through 4
//   - {number} year - Calendar year
// @param {object} options - { requestPrompt }: async (prompt) => parsed JSON reply, or null when no AI can answer.
// @returns {Promise<object>} { created, noteUuid }: created is false when an existing note was found.
// @throws When the data note's statistics can't be read, or the note couldn't be created or written.
export async function saveRetrospectiveTakeaways(app, request, { requestPrompt }) {
  const { dataNoteUuid, domainName, payoffRanking = null, quarter, year } = request;
  if (!dataNoteUuid) throw new Error("This retrospective wasn't saved, so its takeaways can't be written");
  const dataNote = await readRetrospectiveDataNote(app, dataNoteUuid);
  const statistics = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.statistics);
  if (!statistics) throw new Error("This retrospective's statistics couldn't be read");
  const recordedNoteUuid = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.takeaways)?.noteUuid || null;
  const noteName = retrospectiveTakeawaysNoteName({ domainName, quarter, year });
  const existingNoteUuid = await _existingTakeawaysNoteUuid(app, { noteName, recordedNoteUuid });
  if (existingNoteUuid) {
    if (existingNoteUuid !== recordedNoteUuid) await _recordTakeawaysNote(app, { dataNote, dataNoteUuid, noteUuid: existingNoteUuid });
    return { created: false, noteUuid: existingNoteUuid };
  }

  const monthDigests = [1, 2, 3].map(monthNumber => dataNote.payloads.get(retrospectiveMonthSection(monthNumber))).filter(Boolean);
  const projectRows = takeawaysProjectRows(statistics);
  const takeawaysInput = { monthDigests, payoffRanking, projectRows, statistics };
  let reply = null;
  if (requestPrompt) {
    try {
      reply = await requestPrompt(takeawaysPrompt(takeawaysInput));
    } catch (error) {
      logIfEnabled(`${ TAKEAWAYS_LOG_LABEL } the takeaways prompt failed`, error?.message);
    }
  }
  const written = writtenTakeaways(reply) || fallbackTakeaways(takeawaysInput);
  const markdown = takeawaysMarkdown({ ...takeawaysInput, domainName, written });
  const created = checkedAppResult(await app.createNote(noteName, retrospectiveNoteTags()));
  const createdUuid = typeof created === "string" ? created : created?.uuid;
  if (!createdUuid) throw new Error(`Could not create the note "${ noteName }"`);
  // createNote can hand back a local identifier that a later write silently misses; looking it up exchanges it.
  const noteUuid = (await resolvedNoteHandle(app, createdUuid)).uuid;
  const replaced = checkedAppResult(await app.replaceNoteContent({ uuid: noteUuid }, markdown));
  if (replaced === false) throw new Error(`Could not write the note "${ noteName }"`);
  await _recordTakeawaysNote(app, { dataNote, dataNoteUuid, noteUuid });
  return { created: true, noteUuid };
}

// ----------------------------------------------------------------------------------------------
// @desc The prose the note uses when the AI wrote none: a summary from the totals, and the months' calendar
//   sentences. Months and what paid off get no paragraph, since their highlights and ranking still appear as lists.
// @param {object} takeawaysInput - { monthDigests, payoffRanking, projectRows, statistics }.
// @returns {object} { calendar, months, paidOff, summary }, shaped as writtenTakeaways returns them.
export function fallbackTakeaways({ monthDigests, projectRows, statistics }) {
  const label = quarterLabel(statistics.year, statistics.quarter);
  const sentences = [`You completed ${ _number(statistics.totalTaskCount) } tasks in ${ label }, earning ${ _number(statistics.totalVictoryValue) } `
    + `Victory Value over ${ formattedMinutes(statistics.totalMinutes || 0) } of scheduled time.`];
  if (projectRows[0]?.victoryValue) sentences.push(`${ projectRows[0].name } led the quarter's projects in Victory Value.`);
  if (statistics.intentAlignmentPercent !== null && statistics.intentAlignmentPercent !== undefined) {
    sentences.push(`${ statistics.intentAlignmentPercent }% of the work the Dashboard sorted advanced one of your projects.`);
  }
  if (statistics.longestStreak?.days > 1) sentences.push(`Your longest streak ran ${ statistics.longestStreak.days } days.`);
  const calendarSentences = monthDigests.map(digest => digest.calendar?.narrative).filter(Boolean);
  return { calendar: calendarSentences.join(" ") || null, months: new Map(), paidOff: null, summary: sentences.join(" ") };
}

// ----------------------------------------------------------------------------------------------
// @desc The note's markdown: an introduction, then Summary with a totals table, Projects with a table per project,
//   Month by month with each month's prose and highlights, Calendar when the quarter's calendar was recorded, and
//   What paid off when the quarter was ranked. A section with nothing to say is left out. Each month's content lives in
//   a footnote its table cell points to, since a cell holds only one line of markdown, so the definitions close the note.
// @param {object} options - An object with the following properties:
//   - {string} domainName - Task domain display name
//   - {Array<object>} monthDigests - The quarter's stored month digests
//   - {object|null} payoffRanking - The quarter's stored payoff ranking
//   - {Array<object>} projectRows - From takeawaysProjectRows
//   - {object} statistics - From retrospectiveStatistics
//   - {object} written - { calendar, months, paidOff, summary } from writtenTakeaways or fallbackTakeaways
// @returns {string} Note markdown.
export function takeawaysMarkdown({ domainName, monthDigests, payoffRanking, projectRows, statistics, written }) {
  const label = quarterLabel(statistics.year, statistics.quarter);
  const writtenOn = new Date().toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  const introduction = `Takeaways from ${ label } in ${ domainName }, written by the Dashboard's Quarter Retrospective on ${ writtenOn }.`;
  const monthsSection = _monthsSection(statistics, monthDigests, written.months);
  const sections = [introduction, _summarySection(statistics, written.summary), _projectsSection(statistics, projectRows),
    monthsSection?.markdown, _calendarSection(statistics, monthDigests, written.calendar), _paidOffSection(payoffRanking, written.paidOff),
    monthsSection?.footnoteDefinitions];
  const presentSections = sections.filter(Boolean);
  return `${ presentSections.join("\n\n") }\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc One row per project for the Projects table: its completed tasks, scheduled minutes, and Victory Value from the
//   project totals, joined with its done and still-open counts. Statistics saved before project totals existed fall
//   back to the projects that led any ranking.
// @param {object} statistics - From retrospectiveStatistics.
// @returns {Array<object>} { doneCount, minutes, name, openCount, taskCount, victoryValue } per project, most Victory
//   Value first, then most done; openCount is null when open tasks weren't counted.
export function takeawaysProjectRows(statistics) {
  const leaders = statistics.leaders || {};
  const totals = statistics.projectTotals || [...(leaders.byVictoryValue || []), ...(leaders.byTaskCount || []), ...(leaders.byMinutes || [])];
  const rowsByKey = new Map();
  const rowKey = project => project.projectUuid || project.name;
  for (const total of totals) {
    if (rowsByKey.has(rowKey(total))) continue;
    rowsByKey.set(rowKey(total), { doneCount: total.taskCount, minutes: total.minutes, name: total.name, openCount: null,
      taskCount: total.taskCount, victoryValue: total.victoryValue });
  }
  for (const project of statistics.doneAndOpenByProject || []) {
    const existing = rowsByKey.get(rowKey(project)) || [...rowsByKey.values()].find(row => row.name === project.name);
    if (existing) {
      existing.doneCount = project.doneCount;
      existing.openCount = project.openCount;
    } else {
      rowsByKey.set(rowKey(project), { doneCount: project.doneCount, minutes: null, name: project.name, openCount: project.openCount,
        taskCount: project.doneCount, victoryValue: null });
    }
  }
  const rows = [...rowsByKey.values()];
  const rankedRows = rows.sort((first, second) => (second.victoryValue || 0) - (first.victoryValue || 0) || second.doneCount - first.doneCount);
  return rankedRows;
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt asking for the takeaways' prose.
// @param {object} takeawaysInput - { monthDigests, payoffRanking, projectRows, statistics }.
// @returns {string} Prompt answered with { calendar, months, paidOff, summary }.
export function takeawaysPrompt({ monthDigests, payoffRanking, projectRows, statistics }) {
  const label = quarterLabel(statistics.year, statistics.quarter);
  const totals = { importantTasks: statistics.importantTasks?.count || 0, intentAlignmentPercent: statistics.intentAlignmentPercent ?? null,
    longestStreakDays: statistics.longestStreak?.days || null, scheduledTime: formattedMinutes(statistics.totalMinutes || 0),
    tasksCompleted: statistics.totalTaskCount, tasksOutsideProjects: statistics.outsideProjectTaskCount,
    victoryValue: statistics.totalVictoryValue };
  const projectLines = projectRows.map(row => JSON.stringify({ done: row.doneCount, name: row.name, open: row.openCount,
    time: row.minutes === null ? null : formattedMinutes(row.minutes), victoryValue: row.victoryValue }));
  const monthLines = monthDigests.map(digest => JSON.stringify(_monthFacts(digest, statistics)));
  const hasCalendar = _hasCalendar(statistics, monthDigests);
  const calendarLines = hasCalendar ? ["", "How the quarter's calendar time divided:",
    ...(statistics.meetingMinutesByCategory || []).map(category => JSON.stringify({ category: category.category, events: category.eventCount,
      time: formattedMinutes(category.minutes) }))] : [];
  const rankedNames = (payoffRanking?.rankings || []).map(entry => `${ entry.rank }. ${ entry.projectName }`);
  const rankingLines = rankedNames.length ? ["", "Looking back, the person ranked the quarter's projects by whether the work really paid off "
    + "(1 paid off most):", ...rankedNames] : [];
  const comparisonJson = statistics.quarterOverQuarter ? JSON.stringify(statistics.quarterOverQuarter) : null;
  const comparison = comparisonJson ? ["", `Compared with the quarter before: ${ comparisonJson }`] : [];
  const intentTextLines = (statistics.intentTexts || []).map(text => `- ${ text }`);
  const intentLines = intentTextLines.length ? ["", "What they set out to do this quarter:", ...intentTextLines] : [];
  const lines = [`Write the takeaways from ${ label }: a note the person keeps to remember what their quarter amounted to and what to `
      + "carry into the next one.",
    statistics.quarterName ? `The person named the quarter "${ statistics.quarterName }".` : null,
    ...intentLines,
    "",
    `Quarter totals: ${ JSON.stringify(totals) }`,
    ...comparison,
    "",
    "Projects, most Victory Value first:",
    ...(projectLines.length ? projectLines : ["(none recorded)"]),
    "",
    "Each month, summarized from its completed tasks:",
    ...monthLines,
    ...calendarLines,
    ...rankingLines,
    "",
    "Reply with JSON only, in this shape:",
    '{ "summary": "...", "months": [{ "monthNumber": 1, "text": "..." }], "calendar": "...", "paidOff": "..." }',
    "",
    "Rules:",
    "- Write to the person in the second person, warmly and plainly, crediting real progress and naming what was left undone "
      + "without scolding. Altogether, 500 to 1000 words.",
    "- summary: 150 to 250 words in two or three paragraphs: what the quarter amounted to, measured against what they set out to do, "
      + "and the one or two things most worth carrying forward.",
    "- months: one entry per month given, by monthNumber, each 60 to 120 words on what that month was about and how it moved the "
      + "quarter forward.",
    hasCalendar ? "- calendar: 40 to 80 words on how the calendar shaped the quarter's work." : "- calendar: an empty string.",
    rankedNames.length ? "- paidOff: 60 to 120 words on why the top-ranked projects paid off and what the lowest-ranked teach about "
      + "choosing next quarter's work." : "- paidOff: an empty string.",
    "- Plain paragraphs only, separated by a blank line: no headings, tables, or lists. The note adds its own tables.",
    "- Use only numbers given above. Never invent counts, percentages, dates, or rankings.",
    "- Mention projects and tasks by the names given, without renaming them."];
  const promptLines = lines.filter(line => line !== null);
  return promptLines.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Check a takeaways reply, keeping each part that is text. Headings are dropped from the prose so it can't
//   break the note's sections, and a part past its limit is cut at its last full sentence.
// @param {*} reply - The parsed reply.
// @returns {object|null} { calendar, months, paidOff, summary }: months maps a month number to its paragraph, and an
//   absent part is null. Null when the reply has no summary.
export function writtenTakeaways(reply) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return null;
  const summary = _prose(reply.summary, TAKEAWAYS_TEXT_LIMITS.summary);
  if (!summary) return null;
  const months = new Map();
  for (const month of Array.isArray(reply.months) ? reply.months : []) {
    const monthNumber = Number(month?.monthNumber);
    const text = _prose(month?.text, TAKEAWAYS_TEXT_LIMITS.month);
    if ([1, 2, 3].includes(monthNumber) && text && !months.has(monthNumber)) months.set(monthNumber, text);
  }
  return { calendar: _prose(reply.calendar, TAKEAWAYS_TEXT_LIMITS.calendar), months, paidOff: _prose(reply.paidOff, TAKEAWAYS_TEXT_LIMITS.paidOff),
    summary };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The Calendar section: the prose, then a table of time by kind of meeting.
// @param {object} statistics - From retrospectiveStatistics.
// @param {Array<object>} monthDigests - Stored month digests.
// @param {string|null} calendarText - The prose about the calendar.
// @returns {string|null} The section, or null when the quarter's calendar wasn't recorded.
function _calendarSection(statistics, monthDigests, calendarText) {
  if (!_hasCalendar(statistics, monthDigests)) return null;
  const categories = statistics.meetingMinutesByCategory || [];
  const tableRows = categories.map(category => [category.category, _number(category.eventCount), formattedMinutes(category.minutes)]);
  const parts = ["## Calendar", _spacedProse(calendarText), tableRows.length ? _markdownTable(["Kind of time", "Events", "Time"], tableRows) : null];
  const presentParts = parts.filter(Boolean);
  return presentParts.length > 1 ? presentParts.join("\n\n") : null;
}

// ----------------------------------------------------------------------------------------------
// @desc A table cell's text: pipes escaped and line breaks flattened, so a project name can't break the table.
// @param {*} value - The cell's value.
// @returns {string} Cell text.
function _cellText(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------
// @desc Find the takeaways note to reuse: the one recorded in the data note while it still exists, else one by name.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { noteName, recordedNoteUuid }.
// @returns {Promise<string|null>} The note's UUID, or null when there is none.
async function _existingTakeawaysNoteUuid(app, { noteName, recordedNoteUuid }) {
  if (recordedNoteUuid) {
    const recorded = checkedAppResult(await app.findNote({ uuid: recordedNoteUuid }));
    if (recorded?.uuid) return recorded.uuid;
  }
  const named = checkedAppResult(await app.findNote({ name: noteName }));
  return named?.uuid || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether the quarter's calendar was recorded, in the statistics or the month digests.
// @param {object} statistics - From retrospectiveStatistics.
// @param {Array<object>} monthDigests - Stored month digests.
// @returns {boolean} True when there is calendar time to describe.
function _hasCalendar(statistics, monthDigests) {
  return !!statistics.meetingMinutesByCategory?.length || monthDigests.some(digest => digest.calendar?.narrative);
}

// ----------------------------------------------------------------------------------------------
// @desc A markdown table.
// @param {Array<string>} headers - Column headings.
// @param {Array<Array<*>>} rows - Cell values per row.
// @returns {string} The table.
function _markdownTable(headers, rows) {
  const headerLine = `| ${ headers.map(_cellText).join(" | ") } |`;
  const dividerLine = `| ${ headers.map(() => "---").join(" | ") } |`;
  const rowLines = rows.map(row => `| ${ row.map(_cellText).join(" | ") } |`);
  return [headerLine, dividerLine, ...rowLines].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc One month's facts as the prompt shows them.
// @param {object} digest - A stored month digest.
// @param {object} statistics - From retrospectiveStatistics, for the month's task count.
// @returns {object} { highlights, monthName, monthNumber, mood, notableMoments, tasksCompleted, themes }.
function _monthFacts(digest, statistics) {
  const highlights = (digest.highlights || []).slice(0, PROMPT_LISTED_HIGHLIGHTS).map(highlight => highlight.summary);
  const themes = (digest.themes || []).map(theme => theme.name);
  return { highlights, monthName: digest.monthName, monthNumber: digest.monthNumber, mood: digest.mood || null,
    notableMoments: digest.notableMoments || [], tasksCompleted: statistics.monthlyTaskCounts?.[digest.monthNumber - 1] ?? digest.taskCount, themes };
}

// ----------------------------------------------------------------------------------------------
// @desc One month's table: its name in a header cell of the month's dark shade, above a body cell of its light hue that
//   points to the footnote holding the month's task count and mood, its prose, and its highlights.
// @param {object} digest - A stored month digest.
// @param {object} options - An object with the following properties:
//   - {number} footnoteNumber - The footnote the body cell points to, unique within the note
//   - {string|null} monthText - The month's prose
//   - {object} statistics - From retrospectiveStatistics, for the month's task count
// @returns {object} { footnoteDefinition, table }: the footnote's markdown, and the table's.
function _monthTable(digest, { footnoteNumber, monthText, statistics }) {
  const taskCount = statistics.monthlyTaskCounts?.[digest.monthNumber - 1] ?? digest.taskCount ?? 0;
  const factLine = [`${ _number(taskCount) } tasks completed`, digest.mood ? `mood: ${ digest.mood }` : null].filter(Boolean).join(" · ");
  const highlightLines = (digest.highlights || []).map(highlight => `- ${ _cellText(highlight.summary) }`);
  const bodyBlocks = [`*${ factLine }*`, _spacedProse(monthText), highlightLines.length ? highlightLines.join("\n") : null];
  const presentBlocks = bodyBlocks.filter(Boolean);
  const bodyMarkdown = presentBlocks.join(`\n\n${ BLANK_LINE_PARAGRAPH }\n\n`);
  const indentedLines = bodyMarkdown.split("\n").map(line => (line ? `    ${ line }` : ""));
  const footnoteDefinition = `[^${ footnoteNumber }]: \n${ indentedLines.join("\n") }`;

  // A digest's monthNumber counts within the quarter, so the quarter places it in the calendar year.
  const calendarMonthIndex = ((statistics.quarter || 1) - 1) * 3 + digest.monthNumber - 1;
  const colors = MONTH_CELL_COLORS[calendarMonthIndex] || MONTH_CELL_COLORS[0];
  const headerAttributes = { backgroundColor: colors.dark, color: MONTH_HEADER_TEXT_COLOR, colwidth: MONTH_TABLE_WIDTH };
  const bodyAttributes = { backgroundColor: colors.light, color: MONTH_BODY_TEXT_COLOR };
  const headerCell = `**${ _cellText(digest.monthName) }**<!-- ${ JSON.stringify({ cell: headerAttributes }) } -->`;
  const bodyCell = `[^${ footnoteNumber }]<!-- ${ JSON.stringify({ cell: bodyAttributes }) } -->`;
  const table = ["| |", "|-|", `|${ headerCell }|`, `|${ bodyCell }|`].join("\n");
  return { footnoteDefinition, table };
}

// ----------------------------------------------------------------------------------------------
// @desc The Month by month section: a colored table per month, separated by a blank line, with the footnotes holding
//   each month's content returned apart so they can close the note.
// @param {object} statistics - From retrospectiveStatistics.
// @param {Array<object>} monthDigests - Stored month digests.
// @param {Map<number, string>} monthTexts - Prose by month number.
// @returns {object|null} { footnoteDefinitions, markdown }, or null without digests.
function _monthsSection(statistics, monthDigests, monthTexts) {
  if (!monthDigests.length) return null;
  const monthTables = monthDigests.map((digest, index) => _monthTable(digest, { footnoteNumber: index + 1,
    monthText: monthTexts.get(digest.monthNumber) || null, statistics }));
  const tables = monthTables.map(monthTable => monthTable.table);
  const footnoteDefinitions = monthTables.map(monthTable => monthTable.footnoteDefinition);
  const markdown = `## Month by month\n\n${ tables.join(`\n\n${ BLANK_LINE_PARAGRAPH }\n\n`) }`;
  return { footnoteDefinitions: footnoteDefinitions.join("\n\n"), markdown };
}

// ----------------------------------------------------------------------------------------------
// @desc A whole number with thousands separators.
// @param {number} value - The number.
// @returns {string} Such as "1,240".
function _number(value) {
  return Number(value || 0).toLocaleString("en-US");
}

// ----------------------------------------------------------------------------------------------
// @desc The What paid off section: the quarter's payoff ranking, then the prose about it.
// @param {object|null} payoffRanking - The quarter's stored payoff ranking.
// @param {string|null} paidOffText - The prose about the ranking.
// @returns {string|null} The section, or null when the quarter wasn't ranked.
function _paidOffSection(payoffRanking, paidOffText) {
  const rankings = payoffRanking?.rankings || [];
  if (!rankings.length) return null;
  const rankedLines = rankings.map(entry => `${ entry.rank }. ${ entry.projectName }`);
  const parts = ["## What paid off", "Looking back, you ranked the quarter's projects by whether the work really paid off:",
    rankedLines.join("\n"), _spacedProse(paidOffText)];
  return parts.filter(Boolean).join("\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc The Projects section: a table of each project's work, with notes on inferred projects and work outside them.
// @param {object} statistics - From retrospectiveStatistics.
// @param {Array<object>} projectRows - From takeawaysProjectRows.
// @returns {string|null} The section, or null when the quarter has no projects.
function _projectsSection(statistics, projectRows) {
  if (!projectRows.length) return null;
  const tableRows = projectRows.map(row => {
    const doneAndOpen = `${ _number(row.doneCount) } / ${ row.openCount === null ? "—" : _number(row.openCount) }`;
    return [row.name, _number(row.taskCount), row.minutes === null ? null : formattedMinutes(row.minutes),
      row.victoryValue === null ? null : _number(row.victoryValue), doneAndOpen];
  });
  const notes = [];
  if (statistics.projectsInferred) notes.push("The quarter had no projects, so these were inferred from the themes of its tasks.");
  if (statistics.outsideProjectTaskCount) notes.push(`${ _number(statistics.outsideProjectTaskCount) } completed tasks advanced no project.`);
  const table = _markdownTable(["Project", "Tasks", "Time", "Victory Value", "Done / open"], tableRows);
  const parts = ["## Projects", table, notes.join(" ") || null];
  return parts.filter(Boolean).join("\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Clean AI prose: headings removed, runs of blank lines collapsed, and text past its limit cut at its last full
//   sentence.
// @param {*} value - Candidate text.
// @param {number} characters - The limit.
// @returns {string|null} The prose, or null when it isn't text or holds nothing.
function _prose(value, characters) {
  if (typeof value !== "string") return null;
  const lines = value.replace(/\r\n?/g, "\n").split("\n").filter(line => !/^\s*#/.test(line));
  const collapsed = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!collapsed) return null;
  if (collapsed.length <= characters) return collapsed;
  const shortened = collapsed.slice(0, characters);
  const lastSentenceEnd = Math.max(shortened.lastIndexOf(". "), shortened.lastIndexOf(".\n"));
  return lastSentenceEnd > 0 ? shortened.slice(0, lastSentenceEnd + 1) : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Record the takeaways note's UUID in the data note. A failure is logged rather than thrown, since the note itself
//   was written; a later save would find it by name.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { dataNote, dataNoteUuid, noteUuid }: dataNote as readRetrospectiveDataNote returned it.
async function _recordTakeawaysNote(app, { dataNote, dataNoteUuid, noteUuid }) {
  try {
    const payload = { noteUuid, savedAt: new Date().toISOString() };
    await writeRetrospectiveDataSection(app, { content: dataNote.content, heading: RETROSPECTIVE_SECTIONS.takeaways,
      noteHandle: { uuid: dataNoteUuid }, payload });
  } catch (error) {
    logIfEnabled(`${ TAKEAWAYS_LOG_LABEL } could not record the takeaways note`, error?.message);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Prose with a blank line shown between its paragraphs. Amplenote draws consecutive paragraphs with no space
//   between them, so an empty paragraph is placed between each pair. Each line of the prose counts as a paragraph,
//   except that consecutive list items stay together as one list.
// @param {string|null} text - Prose from _prose or the fallback.
// @returns {string|null} The spaced prose, or null when there is none.
function _spacedProse(text) {
  if (!text) return null;
  const lines = text.split("\n").filter(line => line.trim());
  const blocks = [];
  lines.forEach((line, index) => {
    const isListItem = /^\s*([-*+]|\d+\.)\s/.test(line);
    const continuesList = isListItem && index > 0 && /^\s*([-*+]|\d+\.)\s/.test(lines[index - 1]);
    if (continuesList) blocks[blocks.length - 1] += `\n${ line }`;
    else blocks.push(line);
  });
  return blocks.join(`\n\n${ BLANK_LINE_PARAGRAPH }\n\n`) || null;
}

// ----------------------------------------------------------------------------------------------
// @desc The Summary section: the prose, then the quarter's totals as a one-row table.
// @param {object} statistics - From retrospectiveStatistics.
// @param {string} summaryText - The summary prose.
// @returns {string} The section.
function _summarySection(statistics, summaryText) {
  const headers = ["Tasks completed", "Victory Value", "Scheduled time"];
  const values = [_number(statistics.totalTaskCount), _number(statistics.totalVictoryValue), formattedMinutes(statistics.totalMinutes || 0)];
  if (statistics.importantTasks?.count) {
    headers.push("Important tasks");
    values.push(_number(statistics.importantTasks.count));
  }
  if (statistics.intentAlignmentPercent !== null && statistics.intentAlignmentPercent !== undefined) {
    headers.push("Served your intent");
    values.push(`${ statistics.intentAlignmentPercent }%`);
  }
  if (statistics.longestStreak?.days) {
    headers.push("Longest streak");
    values.push(`${ statistics.longestStreak.days } days`);
  }
  return ["## Summary", _spacedProse(summaryText), _markdownTable(headers, [values])].filter(Boolean).join("\n\n");
}
