// Record a calendar suggestion pass for the Debug Console: an archived note named for the pass, with one heading per
// evaluated day saying how many tasks were eligible, which the ranker considered and how it rated them, which were
// suggested, which would come next, and, for a day left with open hours, what was checked without finding a task to
// fill them. The note is written only while the Debug Console widget is in the user's layout, and its content is held
// under REPORT_CHARACTER_LIMIT so it stays far from the size a section replacement can carry.
import { DASHBOARD_NOTE_TAG, SETTING_KEYS } from "constants/settings";
import { suggestionCandidateId } from "dashboard/quarter-project-task-candidates";
import { suggestionIdentityKey } from "dashboard/suggestions/suggestion-staleness";
import { firstOpenSuggestionStart } from "dashboard/suggestions/suggestion-task-slots";
import { logIfEnabled } from "util/log";

const DEBUG_CONSOLE_WIDGET_ID = "debug-console";
const MAX_TITLE_CHARACTERS = 44;
const MAX_TRACED_RANKINGS = 15;
const MINUTES_PER_HOUR = 60;
const NEXT_IN_LINE_COUNT = 3;
// Ranking rows shown per day, tried largest first until the whole report fits the character limit.
const RANKING_LIMIT_STEPS = [10, 7, 5, 3, 0];
const REPORT_CHARACTER_LIMIT = 3000;
const TRUNCATION_NOTICE = "\n- …report truncated to stay under 3k characters";

const RANKING_OUTCOME_EXPLANATIONS = {
  noCandidates: "Ranker had no candidates: no live project offered a task or idea",
  noRanker: "No ranker available (no Jev key or Ample Agent Pro), so the LLM generator planned the day",
  unanswered: "Ranker returned no ratings, so the LLM generator planned the day",
};

// ----------------------------------------------------------------------------------------------
// @desc Render a calendar pass's evaluated days as the report's markdown, showing as many ranking rows per day as
//   fit under REPORT_CHARACTER_LIMIT, and cutting the text off with a notice when even the shortest form does not.
// @param {Array<object>} days - { dayOutcome, dayResult } per evaluated day, in day order:
//   - {object} dayResult - generateProposedAgendaRange's day result, carrying selectionTrace when traced
//   - {object|null} dayOutcome - { activities, droppedTitles, refilledCount, reserveTasks, suggestionHours } from the
//     suggest action, or null when the day produced no agenda
// @returns {string} The report markdown.
export function calendarGenerationReportMarkdown(days) {
  for (const rankingLimit of RANKING_LIMIT_STEPS) {
    const markdown = _reportMarkdown(days, rankingLimit);
    if (markdown.length <= REPORT_CHARACTER_LIMIT) return markdown;
  }
  const shortestMarkdown = _reportMarkdown(days, 0);
  return `${ shortestMarkdown.slice(0, REPORT_CHARACTER_LIMIT - TRUNCATION_NOTICE.length) }${ TRUNCATION_NOTICE }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the report note for its pass, e.g. "Calendar Work Generate: 3 days at 13:32".
// @param {object} pass - { dayCount, domainName, startedAt }: startedAt is the Date the pass began.
// @returns {string} The note name.
export function calendarGenerationReportName({ dayCount, domainName, startedAt }) {
  const dayWord = dayCount === 1 ? "day" : "days";
  const clock = _clockFromMinutes(startedAt.getHours() * MINUTES_PER_HOUR + startedAt.getMinutes());
  return `Calendar ${ domainName || "All Notes" } Generate: ${ dayCount } ${ dayWord } at ${ clock }`;
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
//   report can never cost the user their suggestions.
// @param {object} app - Amplenote app bridge.
// @param {object} pass - { days, domainName, startedAt }: days as calendarGenerationReportMarkdown takes them.
// @returns {Promise<string|null>} The new note's UUID, or null when it could not be written.
export async function writeCalendarGenerationReport(app, { days, domainName, startedAt }) {
  try {
    const noteName = calendarGenerationReportName({ dayCount: days.length, domainName, startedAt });
    const markdown = calendarGenerationReportMarkdown(days);
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
//   what was suggested and what would come next, the ranking rows, what the user had already decided, and, when the
//   day still has an open hour, what was checked without filling it.
// @param {object} day - { dayOutcome, dayResult } as calendarGenerationReportMarkdown takes it.
// @param {number} rankingLimit - Most ranking rows to show.
// @returns {string} The day's markdown section, starting with its h1.
function _daySection({ dayOutcome, dayResult }, rankingLimit) {
  const trace = dayResult.selectionTrace || {};
  const offered = dayOutcome?.activities || [];
  const reserveTasks = dayOutcome?.reserveTasks || [];
  const dayLabel = dayResult.day?.toLocaleDateString?.([], { day: "numeric", month: "long", weekday: "long" }) || "Unknown day";
  const heading = `# ${ dayLabel } — ${ offered.length ? `${ offered.length } suggested` : "nothing suggested" }`;
  const suggestedEntries = offered.map(activity => `${ activity.startTime } ${ _shortTitle(activity.title) } (${ activity.durationMinutes }m)`);
  const nextEntries = reserveTasks.slice(0, NEXT_IN_LINE_COUNT).map(_ratedTitle);
  const bullets = [_sourceBullet(trace, dayResult), _eligibleBullet(trace), _consideredBullet(trace),
    suggestedEntries.length ? `Suggested: ${ suggestedEntries.join("; ") }` : null,
    nextEntries.length ? `Next in line: ${ nextEntries.join("; ") }` : "Next in line: none left", _decidedBullet(dayResult, dayOutcome)];
  const lines = bullets.filter(Boolean).map(bullet => `- ${ bullet }`);
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
// @desc "Eligible" bullet: the tasks the day's fresh schedule drew from.
// @param {object} trace - The day's selectionTrace.
// @returns {string|null}
function _eligibleBullet(trace) {
  if (trace.eligibleCount == null) return null;
  return `Eligible: ${ trace.eligibleCount } tasks (${ trace.selectedTaskCount } recent open tasks, `
    + `${ trace.projectCandidateCount } project candidates) across ${ trace.projectCount } projects`;
}

// ----------------------------------------------------------------------------------------------
// @desc "Title (8.1)" for a ranked record, leaving out a rating it does not carry.
// @param {object} record - Ranked task or reserve, with taskText or title and an optional rating.
// @returns {string}
function _ratedTitle(record) {
  const title = _shortTitle(record.taskText || record.title);
  return Number.isFinite(record.rating) ? `${ title } (${ record.rating.toFixed(1) })` : title;
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
// @desc Every evaluated day's section, joined by blank lines.
// @param {Array<object>} days - { dayOutcome, dayResult } per day.
// @param {number} rankingLimit - Most ranking rows per day.
// @returns {string}
function _reportMarkdown(days, rankingLimit) {
  const sections = days.map(day => _daySection(day, rankingLimit));
  return sections.join("\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc A title cut to MAX_TITLE_CHARACTERS with an ellipsis.
// @param {string|null} title - Task, idea, or project title.
// @returns {string}
function _shortTitle(title) {
  const text = String(title || "(untitled)").replace(/\s+/g, " ").trim();
  return text.length > MAX_TITLE_CHARACTERS ? `${ text.slice(0, MAX_TITLE_CHARACTERS - 1) }…` : text;
}

// ----------------------------------------------------------------------------------------------
// @desc "Source" bullet: whether the day came from its cached agenda, a fresh ranking, or the LLM generator.
// @param {object} trace - The day's selectionTrace.
// @param {object} dayResult - The day's generateProposedAgendaRange result.
// @returns {string}
function _sourceBullet(trace, dayResult) {
  if (trace.joinedInFlight) return "Source: joined a generation of this day already running; its selection was not traced";
  if (trace.source === "cache") {
    const refreshed = trace.freshScheduleRuns ? `, ${ trace.freshScheduleRuns } fresh schedule run(s) to refill` : "";
    return `Source: cached agenda (${ trace.cachedActivityCount } cached, ${ trace.replacedCount } replaced as stale${ refreshed })`;
  }
  if (trace.generator === "ranking") return `Source: fresh ranking by ${ trace.rankerEm }${ trace.rankedFromStore ? " (stored ranking reused)" : "" }`;
  if (trace.generator === "llm") return `Source: LLM generator (${ dayResult.providerEm || "default provider" })`;
  return `Source: ${ dayResult.fromCache ? "cached agenda" : "fresh schedule" }`;
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
  if (RANKING_OUTCOME_EXPLANATIONS[trace.rankingOutcome]) reasons.push(RANKING_OUTCOME_EXPLANATIONS[trace.rankingOutcome]);
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
