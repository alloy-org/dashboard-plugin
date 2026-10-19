// Record a calendar suggestion pass for the Debug Console: an archived note named for the pass, with one heading per
// evaluated day saying how many tasks were eligible, which the ranker considered and how it rated them, which were
// suggested and which would come next, each with the scores that put it forward, and, for a day left with open hours,
// what was checked without finding a task to fill them. The note is written only while the Debug Console widget is in
// the user's layout, and its content is held under REPORT_CHARACTERS_PER_DAY for each evaluated day so it stays far from
// the size a note write can carry. A pass the user asked to re-roll is named as one, and opens with the focus and
// projects the user chose.
import { DASHBOARD_NOTE_TAG, SETTING_KEYS } from "constants/settings";
import { suggestionCandidateId } from "dashboard/quarter-project-task-candidates";
import { missingSuggestionDetails, storedDetailsByCandidateId } from "dashboard/suggestions/calendar-report-stored-details";
import { suggestionIdentityKey } from "dashboard/suggestions/suggestion-staleness";
import { firstOpenSuggestionStart } from "dashboard/suggestions/suggestion-task-slots";
import { logIfEnabled } from "util/log";

const DEBUG_CONSOLE_WIDGET_ID = "debug-console";
const MAX_SUGGESTION_TITLE_CHARACTERS = 50;
const MAX_TITLE_CHARACTERS = 44;
const MAX_TRACED_RANKINGS = 15;
const MINUTES_PER_HOUR = 60;
const NEXT_IN_LINE_COUNT = 3;
const NOTE_URL_PREFIX = "https://www.amplenote.com/notes/";
// Ranking rows shown per day, tried largest first until the whole report fits the character limit.
const RANKING_LIMIT_STEPS = [10, 7, 5, 3, 0];
const REPORT_CHARACTERS_PER_DAY = 3000;
const TRUNCATION_NOTICE = "\n- …report truncated to stay under its character limit";

const RANKING_OUTCOME_EXPLANATIONS = {
  noCandidates: "Ranker had no candidates: no live project offered a task or idea",
  noRanker: "No ranker available (no Jev key or Ample Agent Pro), so the LLM generator planned the day",
  unanswered: "Ranker returned no ratings, so the LLM generator planned the day",
};
// A re-roll has no generator to fall back on, so its outcomes say what was left unanswered instead.
const REROLL_OUTCOME_EXPLANATIONS = {
  noCandidates: "Re-roll had no candidates left once the earlier suggestions were left out",
  noRanker: "No ranker available (no Jev key or Ample Agent Pro) to re-roll the day",
  unanswered: "Ranker returned no ratings for the re-roll",
};

// ----------------------------------------------------------------------------------------------
// @desc Render a calendar pass's evaluated days as the report's markdown, showing as many ranking rows per day as
//   fit under REPORT_CHARACTERS_PER_DAY for each day, and cutting the text off with a notice when even the shortest
//   form does not.
// @param {Array<object>} days - { dayOutcome, dayResult } per evaluated day, in day order:
//   - {object} dayResult - generateProposedAgendaRange's day result, carrying selectionTrace when traced
//   - {object|null} dayOutcome - { activities, droppedTitles, refilledCount, reserveTasks, suggestionHours } from the
//     suggest action, or null when the day produced no agenda
// @param {object} [options] - An object with the following properties:
//   - {Map<string, string>|null} [noteNameByUuid] - Names of the notes suggestions live or would be created in, by
//     note UUID
//   - {Map<string, string>|null} [noteUuidByTaskUuid] - The note each existing task lives in now, by task UUID,
//     preferred over the note the suggestion recorded
//   - {object|null} [reroll] - { focusLabel, projectNames, sourceLabel } when the user asked to re-roll the pass's suggestions
//   - {Map<string, object>|null} [storedDetailsByCandidateId] - Project names and scores from the project task store,
//     by candidate ID, shown for a suggestion that arrived without its own, as one served from a cached agenda does
// @returns {string} The report markdown.
export function calendarGenerationReportMarkdown(days, { noteNameByUuid = null, noteUuidByTaskUuid = null, reroll = null,
    storedDetailsByCandidateId = null } = {}) {
  const characterLimit = REPORT_CHARACTERS_PER_DAY * Math.max(1, days.length);
  const renderOptions = { noteNameByUuid, noteUuidByTaskUuid, reroll, storedDetailsByCandidateId };
  for (const rankingLimit of RANKING_LIMIT_STEPS) {
    const markdown = _reportMarkdown(days, { ...renderOptions, rankingLimit });
    if (markdown.length <= characterLimit) return markdown;
  }
  const shortestMarkdown = _reportMarkdown(days, { ...renderOptions, rankingLimit: 0 });
  return `${ shortestMarkdown.slice(0, characterLimit - TRUNCATION_NOTICE.length) }${ TRUNCATION_NOTICE }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the report note for its pass, e.g. "Calendar Work Generate: 3 days at 13:32", or "Calendar Work Re-roll:
//   3 days at 13:34" for a pass the user asked to re-roll.
// @param {object} pass - { dayCount, domainName, isReroll, startedAt }: startedAt is the Date the pass began.
// @returns {string} The note name.
export function calendarGenerationReportName({ dayCount, domainName, isReroll = false, startedAt }) {
  const dayWord = dayCount === 1 ? "day" : "days";
  const clock = _clockFromMinutes(startedAt.getHours() * MINUTES_PER_HOUR + startedAt.getMinutes());
  const passWord = isReroll ? "Re-roll" : "Generate";
  return `Calendar ${ domainName || "All Notes" } ${ passWord }: ${ dayCount } ${ dayWord } at ${ clock }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a note name is one calendarGenerationReportName builds, so a caller watching createNote can tell the
//   pass's report apart from the other notes a pass may create.
// @param {string} noteName - The name a note is being created with.
// @returns {boolean} True for a report note's name.
export function isCalendarGenerationReportName(noteName) {
  return /^Calendar .+ (Generate|Re-roll): \d+ days? at \S+$/.test(String(noteName || ""));
}

// ----------------------------------------------------------------------------------------------
// @desc Whether the user's Dashboard layout includes the Debug Console widget.
// @param {object|null} settings - Plugin settings; the layout is a JSON string on the host and an array in the embed.
// @returns {boolean}
export function debugConsoleInLayout(settings) {
  let layout = settings?.[SETTING_KEYS.DASHBOARD_COMPONENTS];
  if (typeof layout === "string") {
    try { layout = JSON.parse(layout); } catch { layout = null; }
  }
  return Array.isArray(layout) && layout.some(component => component?.widgetId === DEBUG_CONSOLE_WIDGET_ID);
}

// ----------------------------------------------------------------------------------------------
// @desc The selection trace fields a ranked agenda contributes: the ranking's outcome and ranker, how many candidates it
//   rated, how many an earlier day of the range already held, how many were pooled for slotting, and the best
//   MAX_TRACED_RANKINGS rows with their ratings.
// @param {object} options - { excludedSuggestionKeys, outcome, ranking, slotted }: outcome and ranking are as
//   prepareDayRanking returns them, and slotted is slotRankedTasks' { activities, reserveTasks }, absent without a ranking.
// @returns {object} Fields to merge into the day's selectionTrace.
export function rankingSelectionTrace({ excludedSuggestionKeys = null, outcome, ranking, slotted = null }) {
  if (!ranking) return { rankingOutcome: outcome };
  const isClaimed = task => Boolean(excludedSuggestionKeys?.has(suggestionIdentityKey(task)));
  const claimedTasks = ranking.rankedTasks.filter(isClaimed);
  const topRankedTasks = ranking.rankedTasks.slice(0, MAX_TRACED_RANKINGS);
  const rankedTasks = topRankedTasks.map(task => ({ candidateId: suggestionCandidateId(task), claimed: isClaimed(task),
    project: task.projectSummary || null, rating: task.rating, title: task.taskText }));
  const poolCount = (slotted?.activities.length || 0) + (slotted?.reserveTasks.length || 0);
  return { claimedCount: claimedTasks.length, poolCount, rankedCount: ranking.rankedTasks.length,
    rankedFromStore: Boolean(ranking.fromStore), rankedTasks, rankerEm: ranking.rankerEm, rankingOutcome: outcome };
}

// ----------------------------------------------------------------------------------------------
// @desc Create the pass's archived report note and write its content, logging rather than throwing on failure so the
//   report can never cost the user their suggestions. Each existing task's current note is looked up so every task
//   names the note it lives in, and suggestions served from a cached agenda, which carry no scores and sometimes no
//   project, have theirs read back from the project task store before rendering.
// @param {object} app - Amplenote app bridge.
// @param {object} pass - { days, domainName, domainUuid, reroll, startedAt }: days as calendarGenerationReportMarkdown
//   takes them, domainUuid null for All Notes, and reroll { focusLabel, projectNames, sourceLabel } for a re-roll pass, else null.
// @returns {Promise<string|null>} The new note's UUID, or null when it could not be written.
export async function writeCalendarGenerationReport(app, { days, domainName, domainUuid = null, reroll = null, startedAt }) {
  try {
    const noteName = calendarGenerationReportName({ dayCount: days.length, domainName, isReroll: Boolean(reroll), startedAt });
    const reportedRecords = _reportedRecords(days);
    const noteUuidByTaskUuid = await _existingTaskNoteUuids(app, reportedRecords);
    const noteNameByUuid = await _noteNames(app, { noteUuidByTaskUuid, reportedRecords });
    const incompleteRecords = reportedRecords.filter(record => missingSuggestionDetails(record, _isIdeaRecord(record)));
    const storedDetails = await storedDetailsByCandidateId(app, { days, domainName, domainUuid, incompleteRecords });
    const markdown = calendarGenerationReportMarkdown(days, { noteNameByUuid, noteUuidByTaskUuid, reroll,
      storedDetailsByCandidateId: storedDetails });
    const uuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG], { archive: true });
    if (!uuid) throw new Error("createNote returned no UUID");
    await app.insertNoteContent({ uuid }, markdown);
    logIfEnabled("[calendar-generation-report] wrote report", { characters: markdown.length, noteName, uuid });
    return uuid;
  } catch (error) {
    logIfEnabled("[calendar-generation-report] could not write report", error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc How many active projects have a cadence, are in focus for the day's month, and name the day's weekday, with
//   the weekday projects named so the report shows which ones the day leans toward.
// @param {object|null} cadence - projectCadenceCounts' result, or null when the day's projects were not read.
// @returns {string|null} e.g. "active projects: 3 with a cadence, 2 for October, 1 targeting Mondays (Launch)".
function _cadenceText(cadence) {
  if (!cadence) return null;
  const weekdayNames = (cadence.weekdayProjectNames || []).map(name => _shortTitle(name));
  const weekdayNamesText = weekdayNames.length ? ` (${ weekdayNames.join(", ") })` : "";
  return `active projects: ${ cadence.cadenceCount } with a cadence, ${ cadence.monthCount } for ${ cadence.monthLabel }, `
    + `${ cadence.weekdayCount } targeting ${ cadence.weekdayLabel }${ weekdayNamesText }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Zero-padded 24-hour "HH:MM" for minutes since midnight.
// @param {number} totalMinutes - Minutes since midnight.
// @returns {string}
function _clockFromMinutes(totalMinutes) {
  const hours = String(Math.floor(totalMinutes / MINUTES_PER_HOUR)).padStart(2, "0");
  const minutes = String(totalMinutes % MINUTES_PER_HOUR).padStart(2, "0");
  return `${ hours }:${ minutes }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The bullets for one evaluated day: where its agenda came from, how many tasks were eligible and considered,
//   what was suggested and what would come next (one nested bullet each, with the scores that put it forward), the
//   ranking rows, what the user had already decided, and, when the day still has an open hour, what was checked
//   without filling it.
// @param {object} day - { dayOutcome, dayResult } as calendarGenerationReportMarkdown takes it.
// @param {object} options - { noteNameByUuid, noteUuidByTaskUuid, rankingLimit, storedDetailsByCandidateId }:
//   rankingLimit is the most ranking rows to show.
// @returns {string} The day's markdown section, starting with its h1.
function _daySection({ dayOutcome, dayResult }, { rankingLimit, ...renderOptions }) {
  const trace = dayResult.selectionTrace || {};
  const offered = dayOutcome?.activities || [];
  const reserveTasks = dayOutcome?.reserveTasks || [];
  const dayLabel = dayResult.day?.toLocaleDateString?.([], { day: "numeric", month: "long", weekday: "long" }) || "Unknown day";
  const heading = `# ${ dayLabel } — ${ offered.length ? `${ offered.length } suggested` : "nothing suggested" }`;
  const describe = (record, clockText) => `  - ${ _suggestionDescription(record, { ...renderOptions, clockText }) }`;
  const suggestedLines = offered.map(activity => describe(activity, _twelveHourClock(activity.startTime)));
  const nextReserves = reserveTasks.slice(0, NEXT_IN_LINE_COUNT);
  const nextLines = nextReserves.map(reserve => describe(reserve, null));
  const leadBullets = [_sourceBullet(trace, dayResult), _eligibleBullet(trace), _consideredBullet(trace)];
  const lines = leadBullets.filter(Boolean).map(bullet => `- ${ bullet }`);
  if (suggestedLines.length) lines.push("- Suggested:", ...suggestedLines);
  if (nextLines.length) lines.push("- Next in line:", ...nextLines);
  else lines.push("- Next in line: none left");
  const decidedBullet = _decidedBullet(dayResult, dayOutcome);
  if (decidedBullet) lines.push(`- ${ decidedBullet }`);
  const rankingLines = _rankingLines(trace, { offered, rankingLimit, reserveTasks });
  if (rankingLines.length) lines.push(`- Rankings (top ${ rankingLines.length } of ${ trace.rankedCount }):`, ...rankingLines);
  const unfilledLines = _unfilledLines(trace, { dayOutcome, dayResult, offered, reserveTasks });
  if (unfilledLines.length) lines.push("- Not filled because:", ...unfilledLines);
  return [heading, ...lines].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc "Considered" bullet: how many candidates the ranker rated, or that the LLM generator chose from.
// @param {object} trace - The day's selectionTrace.
// @returns {string|null}
function _consideredBullet(trace) {
  if (trace.generator === "llm") return `Considered: the LLM generator chose ${ trace.llmActivityCount ?? 0 } of ${ trace.eligibleCount ?? "?" } eligible tasks`;
  if (trace.rankedCount == null) return null;
  const claimed = trace.claimedCount ? `; ${ trace.claimedCount } already suggested on an earlier day` : "";
  return `Considered: ${ trace.rankedCount } rated by ${ trace.rankerEm }${ claimed }; best ${ trace.poolCount } pooled for slotting`;
}

// ----------------------------------------------------------------------------------------------
// @desc "Already decided" bullet: suggestions the user dismissed or scheduled, dismissed hours refilled from reserves,
//   and ideas dropped for having no note to hold them.
// @param {object} dayResult - The day's generateProposedAgendaRange result.
// @param {object|null} dayOutcome - The suggest action's outcome for the day.
// @returns {string|null}
function _decidedBullet(dayResult, dayOutcome) {
  const parts = [[dayResult.dismissedKeys?.length, "dismissed"], [dayResult.scheduledKeys?.length, "already scheduled"],
    [dayOutcome?.refilledCount, "dismissed hours refilled"], [dayOutcome?.droppedTitles?.length, "ideas without a note dropped"]];
  const presentParts = parts.filter(([count]) => count > 0);
  const descriptions = presentParts.map(([count, label]) => `${ count } ${ label }`);
  return descriptions.length ? `Already decided: ${ descriptions.join(", ") }` : null;
}

// ----------------------------------------------------------------------------------------------
// @desc "Eligible" bullet: the tasks the day's fresh schedule drew from, and how many active projects have a cadence,
//   are in focus for the day's month, and name the day's weekday.
// @param {object} trace - The day's selectionTrace.
// @returns {string|null}
function _eligibleBullet(trace) {
  if (trace.eligibleCount == null) return null;
  const cadenceText = _cadenceText(trace.projectCadence);
  return `Eligible: ${ trace.eligibleCount } tasks (${ trace.selectedTaskCount } recent open tasks, `
    + `${ trace.projectCandidateCount } project candidates) across ${ trace.projectCount } projects`
    + `${ cadenceText ? `; ${ cadenceText }` : "" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Look up the note each suggested and next-in-line existing task lives in now. A suggestion records the note it
//   was offered from, which a cached entry may lack or a task moved since may have left, so the live task is asked.
//   A task that cannot be read is left out, and the suggestion's own note is used instead.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} reportedRecords - The pass's suggested and next-in-line records, from _reportedRecords.
// @returns {Promise<Map<string, string>>} Note UUID by task UUID.
async function _existingTaskNoteUuids(app, reportedRecords) {
  const taskUuids = [...new Set(reportedRecords.filter(record => !_isIdeaRecord(record)).map(_taskUuid).filter(Boolean))];
  const noteUuidByTaskUuid = new Map();
  for (const taskUuid of taskUuids) {
    try {
      const task = await app.getTask(taskUuid);
      if (task?.noteUuid) noteUuidByTaskUuid.set(taskUuid, task.noteUuid);
    } catch (error) {
      logIfEnabled("[calendar-generation-report] could not read task", { error: error?.message, taskUuid });
    }
  }
  return noteUuidByTaskUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a suggested record is a new task (a generated idea) rather than one already in the user's notes.
// @param {object} record - Activity or reserve.
// @returns {boolean}
function _isIdeaRecord(record) {
  return Boolean(record?.ideaId) || record?.isExisting === false;
}

// ----------------------------------------------------------------------------------------------
// @desc Markdown link to a note, by its name when known.
// @param {string} noteUuid - The note's UUID.
// @param {Map<string, string>|null} noteNameByUuid - Known note names.
// @returns {string} "[Note name](https://www.amplenote.com/notes/<uuid>)".
function _noteLink(noteUuid, noteNameByUuid) {
  const name = (noteNameByUuid?.get(noteUuid) || "note").replace(/[[\]]/g, "");
  return `[${ name }](${ NOTE_URL_PREFIX }${ noteUuid })`;
}

// ----------------------------------------------------------------------------------------------
// @desc Look up the names of the notes the pass's suggested and next-in-line records live in, or for an idea would be
//   created in, so the report can link them by name. A note that cannot be found is left out and linked generically.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { noteUuidByTaskUuid, reportedRecords }: reportedRecords from _reportedRecords.
// @returns {Promise<Map<string, string>>} Note name by note UUID.
async function _noteNames(app, { noteUuidByTaskUuid, reportedRecords }) {
  const recordNoteUuids = reportedRecords.map(record => _recordNoteUuid(record, noteUuidByTaskUuid));
  const noteUuids = [...new Set(recordNoteUuids.filter(Boolean))];
  const noteNameByUuid = new Map();
  for (const noteUuid of noteUuids) {
    try {
      const noteHandle = await app.findNote({ uuid: noteUuid });
      if (noteHandle?.name) noteNameByUuid.set(noteUuid, noteHandle.name);
    } catch (error) {
      logIfEnabled("[calendar-generation-report] could not find suggestion note", { error: error?.message, noteUuid });
    }
  }
  return noteNameByUuid;
}

// ----------------------------------------------------------------------------------------------
// @desc Nested ranking rows, each with its rating, project, and what became of it: the hour it was suggested at,
//   reserve, already suggested on an earlier day, or not offered (decided by the user, or past the slotting pool).
// @param {object} trace - The day's selectionTrace.
// @param {object} context - { offered, rankingLimit, reserveTasks }.
// @returns {Array<string>}
function _rankingLines(trace, { offered, rankingLimit, reserveTasks }) {
  const rankedTasks = (trace.rankedTasks || []).slice(0, rankingLimit);
  const startByCandidateId = new Map(offered.map(activity => [suggestionCandidateId(activity), activity.startTime]));
  const reserveIds = new Set(reserveTasks.map(suggestionCandidateId));
  return rankedTasks.map(task => {
    let status = "not offered";
    if (startByCandidateId.has(task.candidateId)) status = `→ ${ startByCandidateId.get(task.candidateId) }`;
    else if (task.claimed) status = "earlier day";
    else if (reserveIds.has(task.candidateId)) status = "reserve";
    const project = task.project ? ` [${ _shortTitle(task.project) }]` : "";
    const rating = Number.isFinite(task.rating) ? task.rating.toFixed(1) : "?";
    return `  - ${ rating } ${ _shortTitle(task.title) }${ project } ${ status }`;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc The note a record lives in: an existing task's current note when it was looked up, else the note the
//   suggestion recorded, which for an idea is the note it would be created in.
// @param {object} record - Activity or reserve.
// @param {Map<string, string>|null} noteUuidByTaskUuid - Existing tasks' current notes.
// @returns {string|null}
function _recordNoteUuid(record, noteUuidByTaskUuid) {
  if (_isIdeaRecord(record)) return record.noteUuid || null;
  return noteUuidByTaskUuid?.get(_taskUuid(record)) || record.noteUuid || null;
}

// ----------------------------------------------------------------------------------------------
// @desc The records the report describes one by one: each day's suggestions and its first few reserves.
// @param {Array<object>} days - { dayOutcome, dayResult } per evaluated day.
// @returns {Array<object>} Activities and reserves.
function _reportedRecords(days) {
  return days.flatMap(({ dayOutcome }) => [...(dayOutcome?.activities || []),
    ...(dayOutcome?.reserveTasks || []).slice(0, NEXT_IN_LINE_COUNT)]);
}

// ----------------------------------------------------------------------------------------------
// @desc Every evaluated day's section, joined by blank lines.
// @param {Array<object>} days - { dayOutcome, dayResult } per day.
// @param {object} options - { noteNameByUuid, noteUuidByTaskUuid, rankingLimit, storedDetailsByCandidateId }:
//   rankingLimit is the most ranking rows per day.
// @returns {string}
function _reportMarkdown(days, { reroll = null, ...options }) {
  const daySections = days.map(day => _daySection(day, options));
  const sections = reroll ? [_rerollSection(reroll), ...daySections] : daySections;
  return sections.join("\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc The section opening a re-roll pass's report: what the user asked for, and what became of the suggestions it
//   replaced.
// @param {object} reroll - { focusLabel, projectNames, sourceLabel }: sourceLabel names where suggestions may come from.
// @returns {string} The section's markdown, starting with its h1.
function _rerollSection({ focusLabel, projectNames, sourceLabel = "New + existing" }) {
  const projectsText = projectNames?.length ? projectNames.map(name => _shortTitle(name)).join(", ")
    : "none, so the projects chosen for each weekday were ranked";
  return ["# Re-roll requested", "- The user clicked Suggest again soon after the previous pass finished",
    `- Focus: ${ focusLabel }`, `- Boosted projects: ${ projectsText }`, `- Suggestions from: ${ sourceLabel }`,
    "- The previous suggestions were discarded, and these are not stored as the days' agendas: the next ordinary pass "
      + "plans each day afresh without either set"].join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc A title cut to a character limit with an ellipsis.
// @param {string|null} title - Task, idea, or project title.
// @param {number} [maxCharacters] - Longest title kept whole.
// @returns {string}
function _shortTitle(title, maxCharacters = MAX_TITLE_CHARACTERS) {
  const text = String(title || "(untitled)").replace(/\s+/g, " ").trim();
  return text.length > maxCharacters ? `${ text.slice(0, maxCharacters - 1) }…` : text;
}

// ----------------------------------------------------------------------------------------------
// @desc The scores that put a suggestion forward: an existing task's similarity to its project, or an idea's
//   actionability and relevance, falling back to the ranker's rating for a record that carries neither. A score the
//   record lacks, as a suggestion from a cached agenda lacks all of them, is taken from the project task store.
// @param {object} record - Activity or reserve.
// @param {object} stored - The record's { actionability, relevance, similarity } from the project task store, or {}.
// @returns {string|null} e.g. "6.9 similarity score" or "8.0 actionability, 9.1 relevance"; null when unscored.
function _suggestionScores(record, stored) {
  const ownOrStored = (value, storedValue) => (Number.isFinite(value) ? value : storedValue);
  if (_isIdeaRecord(record)) {
    const ideaScores = [[ownOrStored(record.actionability, stored.actionability), "actionability"],
      [ownOrStored(record.score, stored.relevance), "relevance"]];
    const presentScores = ideaScores.filter(([value]) => Number.isFinite(value));
    const scoreTexts = presentScores.map(([value, label]) => `${ value.toFixed(1) } ${ label }`);
    if (scoreTexts.length) return scoreTexts.join(", ");
  } else {
    const similarity = ownOrStored(record.score, stored.similarity);
    if (Number.isFinite(similarity)) return `${ similarity.toFixed(1) } similarity score`;
  }
  return Number.isFinite(record.rating) ? `${ record.rating.toFixed(1) } ranker rating` : null;
}

// ----------------------------------------------------------------------------------------------
// @desc One suggestion's line: when it was placed, the scores that put it forward, its title, the note it lives in (or
//   for an idea would be created in), and the project it serves, e.g. '9:30am: 6.9 similarity score for existing task
//   "Draft launch email" in [Launch notes](note url), project "Launch" (task-uuid)' or '10:45am: 8.0 actionability, 9.1
//   relevance for suggested task "Outline pricing page" in [Launch](note url), project "Launch"'.
// @param {object} record - Activity or reserve.
// @param {object} options - { clockText, noteNameByUuid, noteUuidByTaskUuid, storedDetailsByCandidateId }: clockText is
//   null for a reserve, which has no hour yet.
// @returns {string}
function _suggestionDescription(record, { clockText, noteNameByUuid, noteUuidByTaskUuid, storedDetailsByCandidateId }) {
  const stored = storedDetailsByCandidateId?.get(suggestionCandidateId(record)) || {};
  const clockPrefix = clockText ? `${ clockText }: ` : "";
  const scores = _suggestionScores(record, stored);
  const scorePrefix = scores ? `${ scores } for ` : "";
  const kind = _isIdeaRecord(record) ? "suggested task" : "existing task";
  const title = `"${ _shortTitle(record.title || record.taskText, MAX_SUGGESTION_TITLE_CHARACTERS) }"`;
  const noteUuid = _recordNoteUuid(record, noteUuidByTaskUuid);
  const noteSuffix = noteUuid ? ` in ${ _noteLink(noteUuid, noteNameByUuid) }` : "";
  const projectName = record.projectSummary || stored.projectName;
  const projectSuffix = projectName ? `, project "${ _shortTitle(projectName) }"` : "";
  const taskUuid = _isIdeaRecord(record) ? null : _taskUuid(record);
  const uuidSuffix = taskUuid ? ` (${ taskUuid })` : "";
  return `${ clockPrefix }${ scorePrefix }${ kind } ${ title }${ noteSuffix }${ projectSuffix }${ uuidSuffix }`;
}

// ----------------------------------------------------------------------------------------------
// @desc "Source" bullet: whether the day came from its cached agenda, a fresh ranking, or the LLM generator. A cached
//   day that ran no fresh schedule has no "Eligible" bullet, so its Source says which projects fit the day instead.
// @param {object} trace - The day's selectionTrace.
// @param {object} dayResult - The day's generateProposedAgendaRange result.
// @returns {string}
function _sourceBullet(trace, dayResult) {
  if (trace.joinedInFlight) return "Source: joined a generation of this day already running; its selection was not traced";
  if (trace.source === "reroll") {
    return `Source: re-roll ranked by ${ trace.rankerEm || "no ranker" }; ${ trace.discardedCount ?? 0 } earlier suggestions left out`;
  }
  if (trace.source === "rerollReplay") {
    const movedText = trace.movedCount ? `, ${ trace.movedCount } moved off newly scheduled times` : "";
    return `Source: the ${ trace.focusLabel } re-roll chosen earlier today, shown again (${ trace.shownCount } of `
      + `${ trace.storedCount } suggestions still stand${ movedText })`;
  }
  if (trace.source === "cache") {
    const refreshed = trace.freshScheduleRuns ? `, ${ trace.freshScheduleRuns } fresh schedule run(s) to refill` : "";
    const cadenceText = trace.eligibleCount == null ? _cadenceText(trace.projectCadence) : null;
    return `Source: cached agenda (${ trace.cachedActivityCount } cached, ${ trace.replacedCount } replaced as stale`
      + `${ refreshed })${ cadenceText ? `; ${ cadenceText }` : "" }`;
  }
  if (trace.generator === "ranking") return `Source: fresh ranking by ${ trace.rankerEm }${ trace.rankedFromStore ? " (stored ranking reused)" : "" }`;
  if (trace.generator === "llm") return `Source: LLM generator (${ dayResult.providerEm || "default provider" })`;
  return `Source: ${ dayResult.fromCache ? "cached agenda" : "fresh schedule" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc An existing task's UUID, which a record from the calendar may carry as uuid.
// @param {object} record - Activity or reserve.
// @returns {string|null}
function _taskUuid(record) {
  return record?.taskUuid || record?.uuid || null;
}

// ----------------------------------------------------------------------------------------------
// @desc A 24-hour "HH:MM" start as a 12-hour clock, e.g. "09:30" → "9:30am" and "13:00" → "1:00pm".
// @param {string|null} startTime - The activity's start.
// @returns {string|null} The 12-hour clock, the input unchanged when it is not "HH:MM", or null without one.
function _twelveHourClock(startTime) {
  const match = String(startTime || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return startTime || null;
  const hours = Number(match[1]);
  const meridiem = hours < 12 ? "am" : "pm";
  const twelveHour = hours % 12 || 12;
  return `${ twelveHour }:${ match[2] }${ meridiem }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Nested bullets explaining a day that still has an open hour or suggested nothing: which hours were free, what
//   the ranker or generator reported, whether reserves remained, and what earlier days or the user took.
// @param {object} trace - The day's selectionTrace.
// @param {object} context - { dayOutcome, dayResult, offered, reserveTasks }.
// @returns {Array<string>} Empty when the day is full.
function _unfilledLines(trace, { dayOutcome, dayResult, offered, reserveTasks }) {
  const hours = dayOutcome?.suggestionHours || null;
  const openStart = firstOpenSuggestionStart({ activities: offered, nowMinutes: hours?.nowMinutes ?? null,
    obligations: dayResult.obligations || [] });
  if (offered.length && openStart == null) return [];
  const reasons = [];
  if (dayResult.error) reasons.push(`Generation error: ${ dayResult.error }`);
  if (hours) reasons.push(`${ hours.openHours.length } working hours free of obligations, earliest start ${ hours.earliestStart }`);
  if (openStart != null) reasons.push(`${ _clockFromMinutes(openStart) } is still open`);
  if (trace.eligibleCount === 0) reasons.push("No open task in the task domain and no project candidate");
  const outcomeExplanations = trace.source === "reroll" ? REROLL_OUTCOME_EXPLANATIONS : RANKING_OUTCOME_EXPLANATIONS;
  if (outcomeExplanations[trace.rankingOutcome]) reasons.push(outcomeExplanations[trace.rankingOutcome]);
  if (trace.generator === "llm") reasons.push(`LLM generator placed ${ trace.llmActivityCount ?? 0 } activities`);
  if (trace.claimedCount) reasons.push(`${ trace.claimedCount } rated candidates were already suggested on an earlier day`);
  if (trace.rankedCount != null && trace.rankedCount <= trace.poolCount) reasons.push(`Only ${ trace.rankedCount } candidates were rated in all`);
  if (reserveTasks.length) reasons.push(`${ reserveTasks.length } reserves left, none fits the open hours`);
  else reasons.push("No reserves left to place");
  if (dayResult.dismissedKeys?.length) reasons.push(`${ dayResult.dismissedKeys.length } suggestions dismissed by the user`);
  if (dayOutcome?.droppedTitles?.length) reasons.push(`${ dayOutcome.droppedTitles.length } ideas dropped with no note to hold them`);
  if (trace.joinedInFlight) reasons.push("Selection not traced: this day joined a generation already running");
  return reasons.map(reason => `  - ${ reason }`);
}
