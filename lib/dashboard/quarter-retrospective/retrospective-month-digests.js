// Ask the AI to digest each month of a past quarter: its highlights, the themes its tasks grouped into, its notable
// moments and mood, the images most worth showing, and a sentence about its calendar. When the quarter has no projects,
// one more call merges the months' themes into the projects the user was evidently pursuing. A month too large for one
// prompt is split by week and its parts merged here. Every reply is checked against the tasks and images it was given,
// so an invented task or image never reaches the story, and a month the AI couldn't digest gets a plain digest built
// from its most valuable tasks instead.
import { meetingMinutesByCategory } from "dashboard/quarter-retrospective/retrospective-calendar-categories";
import { forEachWithConcurrency } from "util/concurrency";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { textDigest } from "util/text-digest";

export const MONTH_DIGEST_VERSION = 1;
// The most task data one prompt carries. Three months of a busy quarter split into a handful of prompts at most.
export const MONTH_PROMPT_CHARACTERS = 40000;
export const MAXIMUM_BATCHES_PER_MONTH = 4;
export const PROMPT_FOOTNOTE_CHARACTERS = 240;
export const INFERRED_PROJECT_LIMITS = Object.freeze({ maximum: 7, minimum: 3 });
const DIGEST_CONCURRENCY = 4;
const DIGEST_LOG_LABEL = "[retrospective-month-digests]";
const FALLBACK_HIGHLIGHT_COUNT = 3;
const LIMITS = Object.freeze({ calendarNarrative: 300, highlights: 5, highlightSummary: 140, images: 3, mood: 80, notableMoment: 200,
  notableMoments: 3, themeName: 60, themes: 6 });
const MERGED_LIMITS = Object.freeze({ highlights: 6, images: 6, notableMoments: 5, themes: 8 });
const THEME_EXAMPLE_COUNT = 3;

// ----------------------------------------------------------------------------------------------
// @desc Digest the quarter's three months, reusing any digest given for a month whose tasks haven't changed, and infer
//   projects from the months' themes when the quarter had none. Months are asked in parallel. Nothing here throws for
//   a failed or missing answer: such a month gets a fallback digest, and failed inference gets themes merged by name.
// @param {object} quarterData - An object with the following properties:
//   - {object|null} calendar - { eventsByDate } from the calendar journal, or null when not included
//   - {Array<object>} completions - Enriched completions from gatherRetrospectiveQuarter
//   - {boolean} inferProjects - Whether to merge the months' themes into projects
//   - {Array<object>} media - Image candidates, { alt, url }
//   - {number} quarter - 1 through 4
//   - {Array<object>} [reusableDigests] - Digests from an earlier generation of the quarter, by any style
//   - {Array<object>|null} [reusableInferredProjects] - Projects that generation inferred, reused when every month's
//     digest was
//   - {number} year - Calendar year
// @param {object} options - An object with the following properties:
//   - {Function} [onProgress] - Receives a short description of each step as it starts
//   - {Function|null} requestPrompt - async (prompt) => parsed JSON reply or null; null when no AI can be asked
// @returns {Promise<object>} { inferredProjects, monthDigests }: inferredProjects is null unless asked for and found;
//   monthDigests holds three digests, the quarter's first month first.
export async function digestRetrospectiveMonths(quarterData, { onProgress = () => {}, requestPrompt }) {
  const { calendar, completions, inferProjects, media, quarter, reusableDigests = [], reusableInferredProjects = null, year } = quarterData;
  const identifiers = _promptIdentifiers(completions, media);
  const months = [1, 2, 3].map(monthNumber => _monthInput({ calendar, completions, identifiers, monthNumber, quarter, year }));
  const reusableByMonth = new Map(reusableDigests.map(digest => [digest?.monthNumber, digest]));
  const monthDigests = new Array(3);
  const pendingMonths = [];
  for (const month of months) {
    const reusable = reusableByMonth.get(month.monthNumber);
    if (isReusableMonthDigest(reusable, month)) monthDigests[month.monthNumber - 1] = reusable;
    else pendingMonths.push(month);
  }

  if (pendingMonths.length) {
    const monthNames = pendingMonths.map(month => month.monthName);
    onProgress(requestPrompt ? `Summarizing ${ _spokenList(monthNames) }…` : `Collecting the highlights of ${ _spokenList(monthNames) }…`);
    const batchJobs = pendingMonths.flatMap(month => month.batches.map((batch, batchIndex) => ({ batch, batchIndex, month })));
    const batchDigestsByMonth = new Map(pendingMonths.map(month => [month.monthNumber, new Array(month.batches.length).fill(null)]));
    if (requestPrompt) {
      await forEachWithConcurrency(batchJobs, DIGEST_CONCURRENCY, async ({ batch, batchIndex, month }) => {
        const prompt = monthDigestPrompt({ batch, batchCount: month.batches.length, batchIndex, calendarCategories: batchIndex ? null : month.calendarCategories,
          monthName: month.monthName, monthNumber: month.monthNumber, quarter, year });
        const reply = await _askSafely(requestPrompt, prompt, `month ${ month.monthNumber } part ${ batchIndex + 1 }`);
        batchDigestsByMonth.get(month.monthNumber)[batchIndex] = validatedMonthDigest(reply, { imageIds: batch.imageIds,
          includeCalendar: !batchIndex && !!month.calendarCategories, taskIds: new Set(batch.records.map(record => record.id)) });
      });
    }
    for (const month of pendingMonths) {
      monthDigests[month.monthNumber - 1] = _storedMonthDigest(month, batchDigestsByMonth.get(month.monthNumber), identifiers);
    }
  }

  let inferredProjects = null;
  if (inferProjects && !pendingMonths.length && reusableInferredProjects?.length) {
    inferredProjects = reusableInferredProjects;
  } else if (inferProjects) {
    onProgress("Finding the projects your tasks added up to…");
    inferredProjects = await _inferredProjects(monthDigests, { completions, requestPrompt });
  }
  return { inferredProjects, monthDigests };
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a digest from an earlier generation can stand in for a month: the AI wrote it, from the same number
//   of tasks, with the calendar included or left out the same way.
// @param {object|null} digest - A stored month digest.
// @param {object} month - { calendarCategories, taskCount }.
// @returns {boolean} True when it can be reused.
export function isReusableMonthDigest(digest, { calendarCategories, taskCount }) {
  if (!digest || digest.version !== MONTH_DIGEST_VERSION || digest.generatedBy !== "ai") return false;
  return digest.taskCount === taskCount && !!digest.calendar === !!calendarCategories;
}

// ----------------------------------------------------------------------------------------------
// @desc Divide a month's task records into prompts no larger than the character limit. Whole weeks stay together
//   when they fit, so each prompt reads as a stretch of the month; a week too large for one prompt is split by task.
// @param {Array<object>} records - Prompt records in completion order, each carrying a dateKey.
// @param {number} [characterLimit] - The most record characters one prompt carries.
// @returns {Array<Array<object>>} The records of each prompt, in order.
export function weekPackedBatches(records, characterLimit = MONTH_PROMPT_CHARACTERS) {
  const weeks = [];
  for (const record of records) {
    const weekKey = _weekStartKey(record.dateKey);
    if (weeks[weeks.length - 1]?.weekKey !== weekKey) weeks.push({ records: [], size: 0, weekKey });
    const week = weeks[weeks.length - 1];
    week.records.push(record);
    week.size += _recordLine(record).length + 1;
  }
  const batches = [];
  let current = { records: [], size: 0 };
  const closeCurrent = () => {
    if (current.records.length) batches.push(current.records);
    current = { records: [], size: 0 };
  };
  for (const week of weeks) {
    if (current.size + week.size <= characterLimit) {
      current.records.push(...week.records);
      current.size += week.size;
      continue;
    }
    closeCurrent();
    if (week.size <= characterLimit) {
      current = { records: [...week.records], size: week.size };
      continue;
    }
    for (const record of week.records) {
      const size = _recordLine(record).length + 1;
      if (current.size + size > characterLimit) closeCurrent();
      current.records.push(record);
      current.size += size;
    }
  }
  closeCurrent();
  return batches;
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt asking for one month's digest, or one part of it.
// @param {object} options - An object with the following properties:
//   - {object} batch - { imageIds, records }: the part's task records
//   - {number} batchCount - How many parts the month was split into
//   - {number} batchIndex - This part's place, from 0
//   - {Array<object>|null} calendarCategories - The month's meeting categories, or null
//   - {string} monthName - Such as "July"
//   - {number} monthNumber - 1 through 3
//   - {number} quarter - 1 through 4
//   - {number} year - Calendar year
// @returns {string} Prompt answered with { calendarNarrative, highlights, imageIds, mood, notableMoments, themes }.
export function monthDigestPrompt({ batch, batchCount, batchIndex, calendarCategories, monthName, monthNumber, quarter, year }) {
  const records = batch.records;
  const partLine = batchCount > 1 ? `This is part ${ batchIndex + 1 } of ${ batchCount } of the month: tasks from `
    + `${ _shortDate(records[0].dateKey) } to ${ _shortDate(records[records.length - 1].dateKey) }.` : "";
  const calendarLines = calendarCategories?.length ? ["", "The month's calendar, sorted by kind of meeting:",
    ...calendarCategories.map(category => JSON.stringify({ category: category.category, events: category.eventCount,
      hours: Math.round(category.minutes / 6) / 10, recurringEvents: category.recurringEventCount, sampleTitles: category.sampleTitles }))] : [];
  return [`Summarize ${ monthName } ${ year }, month ${ monthNumber } of Q${ quarter } ${ year }, from the tasks a person completed in it. `
      + "The summary feeds a retrospective that helps them see how much forward progress the quarter amounted to.",
    partLine,
    "",
    "Each task is one JSON line: id, day (MM-DD), text, note (the note it was in), tags, project, minutes (its scheduled length), "
      + "vv (Victory Value, how much the task was worth), important, footnote (details attached to the task), and images "
      + "(pictures attached to it, by id and alt text). Fields a task lacks are left out.",
    ...calendarLines,
    "",
    "Reply with JSON only, in this shape:",
    '{ "highlights": [{ "summary": "...", "taskIds": ["t1"] }], "themes": [{ "name": "...", "taskIds": ["t1", "t2"] }], '
      + '"notableMoments": ["..."], "mood": "...", "imageIds": ["i1"], "calendarNarrative": "..." }',
    "",
    "Rules:",
    `- highlights: up to ${ LIMITS.highlights } accomplishments that moved things forward most, each under 15 words, citing the tasks it comes from. `
      + "Name the specific thing finished, in words from the task or footnote, and prefer finished work over routines; when a month "
      + "is mostly routines, say which held up.",
    `- themes: up to ${ LIMITS.themes } groups of related tasks, named in two to four words for the outcome they served, not the activity. `
      + "A task belongs to at most one theme; routine chores that serve no shared outcome can be left out.",
    `- notableMoments: up to ${ LIMITS.notableMoments } specific, memorable things from the tasks or footnotes, in plain words.`,
    "- mood: a few words for how the month felt from its work, such as \"heads-down shipping\".",
    `- imageIds: up to ${ LIMITS.images } images whose alt text, task, or footnote suggests they show the month's work. Empty when none fit.`,
    calendarLines.length ? "- calendarNarrative: one sentence on how the month's calendar shaped the work." : "- calendarNarrative: an empty string.",
    "- Use only the task ids and image ids given. Don't state counts or totals; the retrospective adds its own numbers.",
    "",
    "Tasks:",
    ...records.map(_recordLine)].filter(line => line !== null).join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Check one month digest reply against the tasks and images its prompt held, keeping only what cites them.
// @param {*} reply - The parsed reply.
// @param {object} options - { imageIds, includeCalendar, taskIds }: the ids the prompt offered.
// @returns {object|null} { calendarNarrative, highlights, imageIds, mood, notableMoments, themes } with each list cut
//   to its limit, or null when the reply holds no usable highlight or theme.
export function validatedMonthDigest(reply, { imageIds, includeCalendar, taskIds }) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return null;
  const knownTaskIds = list => _uniqueStrings(list).filter(taskId => taskIds.has(taskId));
  const highlights = _objects(reply.highlights).map(highlight => ({ summary: _cleanText(highlight.summary, LIMITS.highlightSummary),
    taskIds: knownTaskIds(highlight.taskIds) })).filter(highlight => highlight.summary && highlight.taskIds.length);
  const claimedTaskIds = new Set();
  const themes = [];
  for (const theme of _objects(reply.themes)) {
    const name = _cleanText(theme.name, LIMITS.themeName);
    const themeTaskIds = knownTaskIds(theme.taskIds).filter(taskId => !claimedTaskIds.has(taskId));
    if (!name || !themeTaskIds.length) continue;
    themeTaskIds.forEach(taskId => claimedTaskIds.add(taskId));
    themes.push({ name, taskIds: themeTaskIds });
  }
  if (!highlights.length && !themes.length) return null;
  const notableMoments = _uniqueStrings(reply.notableMoments).map(moment => _cleanText(moment, LIMITS.notableMoment)).filter(Boolean);
  const chosenImageIds = _uniqueStrings(reply.imageIds).filter(imageId => imageIds.has(imageId));
  return { calendarNarrative: includeCalendar ? _cleanText(reply.calendarNarrative, LIMITS.calendarNarrative) || null : null,
    highlights: highlights.slice(0, LIMITS.highlights), imageIds: chosenImageIds.slice(0, LIMITS.images), mood: _cleanText(reply.mood, LIMITS.mood) || null,
    notableMoments: notableMoments.slice(0, LIMITS.notableMoments), themes: themes.slice(0, LIMITS.themes) };
}

// ----------------------------------------------------------------------------------------------
// @desc Merge the digests of a month's parts into one: highlights, moments, and images in part order, and themes of
//   the same name joined, each task kept in the first theme that claimed it.
// @param {Array<object>} partDigests - Validated part digests, in part order.
// @returns {object} A digest shaped as validatedMonthDigest returns one, with merged limits.
export function mergedMonthDigest(partDigests) {
  const themesByName = new Map();
  const claimedTaskIds = new Set();
  for (const theme of partDigests.flatMap(digest => digest.themes)) {
    const nameKey = theme.name.toLowerCase();
    const merged = themesByName.get(nameKey) || { name: theme.name, taskIds: [] };
    const unclaimedTaskIds = theme.taskIds.filter(taskId => !claimedTaskIds.has(taskId));
    unclaimedTaskIds.forEach(taskId => claimedTaskIds.add(taskId));
    merged.taskIds.push(...unclaimedTaskIds);
    themesByName.set(nameKey, merged);
  }
  const themes = [...themesByName.values()].filter(theme => theme.taskIds.length);
  const rankedThemes = themes.sort((first, second) => second.taskIds.length - first.taskIds.length);
  const moods = _uniqueStrings(partDigests.map(digest => digest.mood));
  return { calendarNarrative: partDigests.map(digest => digest.calendarNarrative).find(Boolean) || null,
    highlights: partDigests.flatMap(digest => digest.highlights).slice(0, MERGED_LIMITS.highlights),
    imageIds: _uniqueStrings(partDigests.flatMap(digest => digest.imageIds)).slice(0, MERGED_LIMITS.images), mood: moods.join(" · ") || null,
    notableMoments: partDigests.flatMap(digest => digest.notableMoments).slice(0, MERGED_LIMITS.notableMoments),
    themes: rankedThemes.slice(0, MERGED_LIMITS.themes) };
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt asking the AI to merge the months' themes into the projects the user was pursuing.
// @param {Array<object>} themeEntries - { examples, monthName, name, taskCount, themeId } per month theme.
// @returns {string} Prompt answered with { projects: [{ name, summary, themeIds }] }.
export function themeMergePrompt(themeEntries) {
  return [`Over one quarter, a person's completed tasks grouped into the monthly themes below. Merge them into `
      + `${ INFERRED_PROJECT_LIMITS.minimum } to ${ INFERRED_PROJECT_LIMITS.maximum } projects: the larger outcomes the person was evidently pursuing.`,
    "A theme that recurs across months belongs to one project. Each theme belongs to at most one project; leave out themes that serve no larger outcome.",
    "Name each project in two to five words, the way the person might name it themselves, and summarize it in one sentence.",
    "",
    "Reply with JSON only, in this shape:",
    '{ "projects": [{ "name": "...", "summary": "...", "themeIds": ["th1", "th4"] }] }',
    "",
    "Themes, one JSON line each:",
    ...themeEntries.map(entry => JSON.stringify({ id: entry.themeId, month: entry.monthName, name: entry.name, tasks: entry.taskCount,
      examples: entry.examples }))].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Turn a theme merge reply into projects, each task in exactly one: a task whose themes two projects claim goes
//   to the project listed first. A reply naming no usable project yields an empty list.
// @param {*} reply - The parsed reply.
// @param {Array<object>} themeEntries - { name, taskUuids, themeId } per month theme the prompt offered.
// @returns {Array<object>} { derivedFrom: "themes", name, summary, taskUuids, uuid } per project, at most
//   INFERRED_PROJECT_LIMITS.maximum, most tasks first.
export function inferredProjectsFromReply(reply, themeEntries) {
  const themeById = new Map(themeEntries.map(entry => [entry.themeId, entry]));
  const claimedThemeIds = new Set();
  const groups = [];
  for (const project of _objects(reply?.projects)) {
    const name = _cleanText(project.name, LIMITS.themeName);
    const themeIds = _uniqueStrings(project.themeIds).filter(themeId => themeById.has(themeId) && !claimedThemeIds.has(themeId));
    if (!name || !themeIds.length) continue;
    themeIds.forEach(themeId => claimedThemeIds.add(themeId));
    groups.push({ name, summary: _cleanText(project.summary, LIMITS.notableMoment) || null, themes: themeIds.map(themeId => themeById.get(themeId)) });
  }
  return _projectsFromThemeGroups(groups);
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Ask for a reply, treating a thrown request as no reply so one failed part never fails the month.
// @param {Function} requestPrompt - async (prompt) => parsed JSON or null.
// @param {string} prompt - The prompt.
// @param {string} label - What is being asked, for the log.
// @returns {Promise<*|null>} The reply, or null.
async function _askSafely(requestPrompt, prompt, label) {
  try {
    return await requestPrompt(prompt);
  } catch (error) {
    logIfEnabled(`${ DIGEST_LOG_LABEL } ${ label } failed`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Text trimmed to one line and cut to a length, or an empty string when it isn't text.
// @param {*} value - Candidate text.
// @param {number} characters - Most characters kept.
// @returns {string} Clean text.
function _cleanText(value, characters) {
  if (typeof value !== "string") return "";
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > characters ? `${ singleLine.slice(0, characters - 1).trimEnd() }…` : singleLine;
}

// ----------------------------------------------------------------------------------------------
// @desc A digest built without the AI: the month's most valuable tasks as its highlights, its projects as its themes,
//   and the first images its tasks hold.
// @param {object} month - From _monthInput.
// @returns {object} A digest shaped as validatedMonthDigest returns one.
function _fallbackMonthDigest(month) {
  const allRecords = month.allRecords;
  const rankedRecords = [...allRecords].sort((first, second) => Number(!!second.important) - Number(!!first.important) || (second.vv || 0) - (first.vv || 0));
  const highlights = rankedRecords.slice(0, FALLBACK_HIGHLIGHT_COUNT).map(record => ({ summary: record.text, taskIds: [record.id] }));
  const taskIdsByProject = new Map();
  for (const record of allRecords) {
    if (!record.project) continue;
    taskIdsByProject.set(record.project, [...(taskIdsByProject.get(record.project) || []), record.id]);
  }
  const themes = [...taskIdsByProject].map(([name, taskIds]) => ({ name, taskIds }));
  const imageIds = _uniqueStrings(allRecords.flatMap(record => (record.images || []).map(image => image.id)));
  return { calendarNarrative: null, highlights, imageIds: imageIds.slice(0, LIMITS.images), mood: null, notableMoments: [], themes };
}

// ----------------------------------------------------------------------------------------------
// @desc Infer the quarter's projects from its month themes, falling back to themes merged by name when the AI can't
//   be asked or names nothing usable.
// @param {Array<object>} monthDigests - Stored month digests.
// @param {object} options - { completions, requestPrompt }.
// @returns {Promise<Array<object>|null>} Inferred projects, or null when the months had no themes.
async function _inferredProjects(monthDigests, { completions, requestPrompt }) {
  const textByTaskUuid = new Map(completions.map(completion => [completion.taskUuid, completion.text]));
  const monthThemes = monthDigests.flatMap(digest => digest.themes.map(theme => ({ ...theme, monthName: digest.monthName })));
  if (!monthThemes.length) return null;
  const themeEntries = monthThemes.map((theme, index) => ({ examples: theme.taskUuids.slice(0, THEME_EXAMPLE_COUNT).map(uuid => textByTaskUuid.get(uuid)).filter(Boolean),
    monthName: theme.monthName, name: theme.name, taskCount: theme.taskUuids.length, taskUuids: theme.taskUuids, themeId: `th${ index + 1 }` }));
  if (requestPrompt) {
    const reply = await _askSafely(requestPrompt, themeMergePrompt(themeEntries), "theme merge");
    const projects = inferredProjectsFromReply(reply, themeEntries);
    if (projects.length) return projects;
  }
  const groupsByName = new Map();
  for (const entry of themeEntries) {
    const nameKey = entry.name.toLowerCase();
    const group = groupsByName.get(nameKey) || { name: entry.name, summary: null, themes: [] };
    group.themes.push(entry);
    groupsByName.set(nameKey, group);
  }
  const projects = _projectsFromThemeGroups([...groupsByName.values()]);
  return projects.length ? projects : null;
}

// ----------------------------------------------------------------------------------------------
// @desc The month's task records and prompt parts, and its calendar categories when the calendar is included.
// @param {object} options - { calendar, completions, identifiers, monthNumber, quarter, year }.
// @returns {object} { allRecords, batches, calendarCategories, monthName, monthNumber, omittedTaskCount, taskCount }:
//   each batch { imageIds, records }.
function _monthInput({ calendar, completions, identifiers, monthNumber, quarter, year }) {
  const monthIndex = (quarter - 1) * 3 + monthNumber - 1;
  const monthPrefix = dateKeyFromDateInput(new Date(year, monthIndex, 1)).slice(0, 7);
  const monthName = new Date(year, monthIndex, 1).toLocaleDateString("en-US", { month: "long" });
  const monthCompletions = completions.filter(completion => completion.dateKey.startsWith(monthPrefix));
  const chronological = [...monthCompletions].sort((first, second) => first.completedMillis - second.completedMillis);
  const recordsWith = footnoteCharacters => chronological.map(completion => _taskRecord(completion, identifiers, footnoteCharacters));
  const allRecords = recordsWith(PROMPT_FOOTNOTE_CHARACTERS);
  let packed = weekPackedBatches(allRecords);
  let omittedTaskCount = 0;
  if (packed.length > MAXIMUM_BATCHES_PER_MONTH) packed = weekPackedBatches(recordsWith(0));
  if (packed.length > MAXIMUM_BATCHES_PER_MONTH) {
    const kept = _mostValuableRecords(recordsWith(0), MONTH_PROMPT_CHARACTERS * MAXIMUM_BATCHES_PER_MONTH * 0.9);
    omittedTaskCount = chronological.length - kept.length;
    packed = weekPackedBatches(kept).slice(0, MAXIMUM_BATCHES_PER_MONTH);
  }
  const batches = packed.map(records => ({ imageIds: new Set(records.flatMap(record => (record.images || []).map(image => image.id))), records }));
  let calendarCategories = null;
  if (calendar?.eventsByDate) {
    const monthDays = Object.entries(calendar.eventsByDate).filter(([dateKey]) => dateKey.startsWith(monthPrefix));
    calendarCategories = meetingMinutesByCategory(new Map(monthDays.map(([dateKey, events]) => [dateKey, { events }])));
  }
  return { allRecords, batches, calendarCategories, monthName, monthNumber, omittedTaskCount, taskCount: chronological.length };
}

// ----------------------------------------------------------------------------------------------
// @desc The records that fit a character budget, important tasks first and then by Victory Value, back in completion
//   order.
// @param {Array<object>} records - Prompt records in completion order.
// @param {number} characterBudget - Most record characters kept.
// @returns {Array<object>} The kept records, in completion order.
function _mostValuableRecords(records, characterBudget) {
  const ranked = records.map((record, index) => ({ index, record }));
  ranked.sort((first, second) => Number(!!second.record.important) - Number(!!first.record.important) || (second.record.vv || 0) - (first.record.vv || 0));
  const keptIndexes = new Set();
  let size = 0;
  for (const { index, record } of ranked) {
    const recordSize = _recordLine(record).length + 1;
    if (size + recordSize > characterBudget) continue;
    size += recordSize;
    keptIndexes.add(index);
  }
  const keptRecords = records.filter((record, index) => keptIndexes.has(index));
  return keptRecords;
}

// ----------------------------------------------------------------------------------------------
// @desc Plain array of objects from a reply field, ignoring anything else.
function _objects(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
}

// ----------------------------------------------------------------------------------------------
// @desc Projects from groups of month themes, each task in the first project whose themes hold it. A project left
//   with no tasks is dropped, and two projects of the same name become one.
// @param {Array<object>} groups - { name, summary, themes } in priority order, each theme carrying taskUuids.
// @returns {Array<object>} { derivedFrom, name, summary, taskUuids, uuid }, most tasks first, at most
//   INFERRED_PROJECT_LIMITS.maximum.
function _projectsFromThemeGroups(groups) {
  const claimedTaskUuids = new Set();
  const projectsByUuid = new Map();
  for (const group of groups) {
    const uuid = `theme-${ textDigest(group.name.toLowerCase()) }`;
    const project = projectsByUuid.get(uuid) || { derivedFrom: "themes", name: group.name, summary: group.summary, taskUuids: [], uuid };
    for (const taskUuid of group.themes.flatMap(theme => theme.taskUuids)) {
      if (claimedTaskUuids.has(taskUuid)) continue;
      claimedTaskUuids.add(taskUuid);
      project.taskUuids.push(taskUuid);
    }
    projectsByUuid.set(uuid, project);
  }
  const projects = [...projectsByUuid.values()].filter(project => project.taskUuids.length);
  const rankedProjects = projects.sort((first, second) => second.taskUuids.length - first.taskUuids.length);
  return rankedProjects.slice(0, INFERRED_PROJECT_LIMITS.maximum);
}

// ----------------------------------------------------------------------------------------------
// @desc Short identifiers for the quarter's tasks and images, so prompts carry "t12" and "i3" instead of UUIDs and
//   URLs, and a reply's identifiers map back to them.
// @param {Array<object>} completions - Enriched completions.
// @param {Array<object>} media - Image candidates.
// @returns {object} { imageIdByUrl, taskIdByUuid, taskUuidById, urlByImageId }.
function _promptIdentifiers(completions, media) {
  const chronological = [...completions].sort((first, second) => first.completedMillis - second.completedMillis);
  const taskIdByUuid = new Map(chronological.map((completion, index) => [completion.taskUuid, `t${ index + 1 }`]));
  const taskUuidById = new Map([...taskIdByUuid].map(([taskUuid, taskId]) => [taskId, taskUuid]));
  const imageIdByUrl = new Map((media || []).map((image, index) => [image.url, `i${ index + 1 }`]));
  const urlByImageId = new Map([...imageIdByUrl].map(([url, imageId]) => [imageId, url]));
  return { imageIdByUrl, taskIdByUuid, taskUuidById, urlByImageId };
}

// ----------------------------------------------------------------------------------------------
// @desc A task record as one compact JSON line, without the dateKey it carries for batching.
function _recordLine({ dateKey, ...record }) {
  return JSON.stringify(record);
}

// ----------------------------------------------------------------------------------------------
// @desc A date key as "Jul 14".
function _shortDate(dateKey) {
  return dateFromDateInput(dateKey).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

// ----------------------------------------------------------------------------------------------
// @desc "July", "July and August", or "July, August, and September".
function _spokenList(words) {
  if (words.length < 3) return words.join(" and ");
  return `${ words.slice(0, -1).join(", ") }, and ${ words[words.length - 1] }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The digest stored for a month: the merged parts the AI answered, or a fallback when none did, with task and
//   image identifiers turned back into UUIDs and URLs.
// @param {object} month - From _monthInput.
// @param {Array<object|null>} partDigests - Validated part digests; null for a part that failed or wasn't asked.
// @param {object} identifiers - From _promptIdentifiers.
// @returns {object} An object with the following properties:
//   - {object|null} calendar - { categories, narrative }, or null when the calendar wasn't included
//   - {number} failedPartCount - Parts the AI didn't answer usably
//   - {string} generatedBy - "ai" when any part was answered, otherwise "fallback"
//   - {Array<object>} highlights - { summary, taskUuids }
//   - {Array<string>} imageUrls - Images worth showing
//   - {string} monthName - Such as "July"
//   - {number} monthNumber - 1 through 3
//   - {string|null} mood - How the month felt
//   - {Array<string>} notableMoments - Memorable things
//   - {number} omittedTaskCount - Tasks left out of the prompts to keep them bounded
//   - {number} partCount - Prompts the month was split into
//   - {number} taskCount - Completions in the month
//   - {Array<object>} themes - { name, taskUuids }
//   - {number} version - MONTH_DIGEST_VERSION
function _storedMonthDigest(month, partDigests, identifiers) {
  const answeredDigests = partDigests.filter(Boolean);
  const digest = answeredDigests.length ? mergedMonthDigest(answeredDigests) : _fallbackMonthDigest(month);
  const taskUuids = taskIds => taskIds.map(taskId => identifiers.taskUuidById.get(taskId)).filter(Boolean);
  const calendar = month.calendarCategories ? { categories: month.calendarCategories, narrative: digest.calendarNarrative } : null;
  return { calendar, failedPartCount: partDigests.length - answeredDigests.length, generatedBy: answeredDigests.length ? "ai" : "fallback",
    highlights: digest.highlights.map(highlight => ({ summary: highlight.summary, taskUuids: taskUuids(highlight.taskIds) })),
    imageUrls: digest.imageIds.map(imageId => identifiers.urlByImageId.get(imageId)).filter(Boolean), monthName: month.monthName,
    monthNumber: month.monthNumber, mood: digest.mood, notableMoments: digest.notableMoments, omittedTaskCount: month.omittedTaskCount,
    partCount: month.batches.length, taskCount: month.taskCount,
    themes: digest.themes.map(theme => ({ name: theme.name, taskUuids: taskUuids(theme.taskIds) })), version: MONTH_DIGEST_VERSION };
}

// ----------------------------------------------------------------------------------------------
// @desc One completion as the record a prompt shows, leaving out fields it lacks.
// @param {object} completion - An enriched completion.
// @param {object} identifiers - From _promptIdentifiers.
// @param {number} footnoteCharacters - Most footnote characters kept; 0 leaves footnotes out.
// @returns {object} { dateKey, day, id, text, ... }.
function _taskRecord(completion, identifiers, footnoteCharacters) {
  const record = { dateKey: completion.dateKey, id: identifiers.taskIdByUuid.get(completion.taskUuid), day: completion.dateKey.slice(5),
    text: completion.text };
  if (completion.noteName) record.note = completion.noteName;
  if (completion.noteTags?.length) record.tags = completion.noteTags;
  if (completion.projectName) record.project = completion.projectName;
  if (!completion.durationDefaulted) record.minutes = completion.minutes;
  if (completion.victoryValue) record.vv = completion.victoryValue;
  if (completion.important) record.important = true;
  const footnote = _cleanText(String(completion.footnoteText || "").replace(/!\[[^\]]*\]\([^)]*\)/g, ""), footnoteCharacters);
  if (footnoteCharacters && footnote) record.footnote = footnote;
  const images = (completion.images || []).map(image => ({ alt: image.alt || "", id: identifiers.imageIdByUrl.get(image.url) })).filter(image => image.id);
  if (images.length) record.images = images;
  return record;
}

// ----------------------------------------------------------------------------------------------
// @desc Distinct non-empty strings from a reply field, in order.
function _uniqueStrings(value) {
  const strings = Array.isArray(value) ? value.filter(item => typeof item === "string" && item.trim()).map(item => item.trim()) : [];
  return [...new Set(strings)];
}

// ----------------------------------------------------------------------------------------------
// @desc The Monday that starts a date key's week, as a date key.
function _weekStartKey(dateKey) {
  const date = dateFromDateInput(dateKey);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceMonday);
  return dateKeyFromDateInput(monday);
}
