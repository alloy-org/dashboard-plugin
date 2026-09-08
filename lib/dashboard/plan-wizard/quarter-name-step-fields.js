// Translate the Name the quarter page into stored records: three name ideas drawn from Focus projects, and an
// optional start/end window per active project that becomes ActionProspect.focusMonths. Suggested and clicked
// windows stay on or before a sprint deadline so a bar cannot land after the date the work has to be done.

import { FULL_MONTH_NAMES } from "constants/quarters";
import { isDeclinedActionProspect } from "plan-wizard/plan-models";
import { monthLabelsForQuarter } from "plan-wizard/prospect-evidence";
import { dateFromDateInput, dateFromMonthKey, formatDateKey, monthKeyFromDateInput } from "util/date-utility";

export const CUSTOM_QUARTER_NAME = "custom";
export const FOCUS_WINDOW_COLOR_COUNT = 3;
export const MINIMUM_FOCUS_WINDOW_DAYS = 14;
export const QUARTER_NAME_FALLBACKS = ["The Shipping Quarter", "Rebuild the Foundations", "Fewer, Bigger Things"];
export const QUARTER_NAME_STEP_FORM_ID = "plan-wizard-quarter-name-form";
export const TIMELINE_HEADING = "Roughly when?";
export const TIMELINE_SUMMARY = "Drag the edges. Even spread is fine.";

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Keep named projects that are still in play, so Not now and removed work never appear on the timeline.
// @param {Array<object>} prospects - Stored ActionProspect records for the quarter.
// @returns {Array<object>} Live named prospects.
export function activeProspectsFromList(prospects = []) {
  const namedProspects = prospects.filter(prospect => prospect.summary?.trim());
  const liveProspects = namedProspects.filter(prospect => !isDeclinedActionProspect(prospect));
  return liveProspects;
}

// ----------------------------------------------------------------------------------------------
// @desc Shift a YYYY-MM-DD date by a whole number of local calendar days.
// @param {string} dateKey - Starting calendar date.
// @param {number} dayCount - Days to add; negative moves backward.
// @returns {string} Shifted YYYY-MM-DD date.
function addDaysToDateKey(dateKey, dayCount) {
  const date = dateFromDateInput(dateKey);
  return formatDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayCount));
}

// ----------------------------------------------------------------------------------------------
// @desc Keep a window inside the quarter, on or before a deadline, and at least as long as the minimum span
//   unless the deadline leaves fewer days than that from the quarter's start.
// @param {object} params - { deadlineOn, endOn, quarterEndOn, quarterStartOn, startOn }.
// @returns {object} { endOn, startOn } as YYYY-MM-DD dates.
export function clampFocusWindow({ deadlineOn, endOn, quarterEndOn, quarterStartOn, startOn }) {
  const deadlineCap = deadlineOn && deadlineOn >= quarterStartOn && deadlineOn <= quarterEndOn ? deadlineOn : null;
  const endCandidates = [endOn, quarterEndOn, deadlineCap].filter(Boolean);
  const sortedEnds = [...endCandidates].sort();
  const latestEndOn = sortedEnds[0] || quarterEndOn;
  let nextEndOn = latestEndOn < quarterStartOn ? quarterStartOn : latestEndOn;
  let nextStartOn = startOn < quarterStartOn ? quarterStartOn : startOn;
  if (nextStartOn > nextEndOn) nextStartOn = nextEndOn;
  const spanDays = dayOffsetFromDateKey(nextEndOn, nextStartOn) + 1;
  if (spanDays >= MINIMUM_FOCUS_WINDOW_DAYS || (deadlineCap && nextEndOn === deadlineCap)) {
    return { endOn: nextEndOn, startOn: nextStartOn };
  }
  nextStartOn = addDaysToDateKey(nextEndOn, 1 - MINIMUM_FOCUS_WINDOW_DAYS);
  if (nextStartOn < quarterStartOn) nextStartOn = quarterStartOn;
  return { endOn: nextEndOn, startOn: nextStartOn };
}

// ----------------------------------------------------------------------------------------------
// @desc Count whole local days from the quarter's first morning to a calendar date.
// @param {string} dateKey - Date inside or beside the quarter.
// @param {string} quarterStartOn - First day of the quarter.
// @returns {number} Zero-based day offset.
export function dayOffsetFromDateKey(dateKey, quarterStartOn) {
  const startDate = dateFromDateInput(quarterStartOn);
  const date = dateFromDateInput(dateKey);
  const startUtc = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const dateUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((dateUtc - startUtc) / MILLIS_PER_DAY);
}

// ----------------------------------------------------------------------------------------------
// @desc Explain where a sprint deadline sits relative to the project's bar.
// @param {object} draft - Per-project window draft carrying deadlineOn, endOn, startOn, and summary.
// @returns {string|null} Footnote text, or null when the project has no deadline.
export function deadlineNoteFromDraft(draft) {
  if (!draft.deadlineOn) return null;
  const date = dateFromDateInput(draft.deadlineOn);
  const deadlineLabel = `${ FULL_MONTH_NAMES[date.getMonth()].slice(0, 3) } ${ date.getDate() }`;
  const title = shortProjectTitle(draft.summary);
  if (draft.deadlineOn < draft.startOn || draft.deadlineOn > draft.endOn) {
    return `Deadline ${ deadlineLabel } sits outside the ${ title } bar.`;
  }
  return `Deadline ${ deadlineLabel } sits inside the ${ title } bar.`;
}

// ----------------------------------------------------------------------------------------------
// @desc Stagger a project's first suggested window across the quarter, then pull its end onto or before a
//   deadline so the default never proposes work after the sprint has to land.
// @param {object} params - { deadlineOn, index, quarterEndOn, quarterStartOn, totalCount }.
// @returns {object} { endOn, startOn }.
export function defaultFocusWindow({ deadlineOn, index, quarterEndOn, quarterStartOn, totalCount }) {
  const spanDays = dayOffsetFromDateKey(quarterEndOn, quarterStartOn) + 1;
  const windowDays = Math.max(MINIMUM_FOCUS_WINDOW_DAYS, Math.round(spanDays * 0.45));
  const maxStartOffset = Math.max(0, spanDays - windowDays);
  const startOffset = totalCount <= 1 ? 0 : Math.round((index / (totalCount - 1)) * maxStartOffset);
  const startOn = addDaysToDateKey(quarterStartOn, startOffset);
  const endOn = addDaysToDateKey(quarterStartOn, startOffset + windowDays - 1);
  return clampFocusWindow({ deadlineOn, endOn, quarterEndOn, quarterStartOn, startOn });
}

// ----------------------------------------------------------------------------------------------
// @desc Seed one timeline row per active project. Stored focusMonths become a bar; an empty list remains an
//   unplaced row so removing a range survives reopening the wizard.
// @param {Array<object>} prospects - Stored ActionProspect records.
// @param {object} scope - Planning scope with quarter and year.
// @returns {Array<object>} Window drafts for the timeline.
export function draftWindowsFromProspects(prospects = [], scope) {
  const { quarterEndOn, quarterMonths, quarterStartOn } = quarterBoundsFromScope(scope);
  const activeProspects = activeProspectsFromList(prospects);
  return activeProspects.map((prospect, index) => {
    const storedMonths = prospect.focusMonths ?? [];
    const window = storedMonths.length ? windowFromFocusMonths({ deadlineOn: prospect.deadlineOn,
      focusMonths: storedMonths, quarterEndOn, quarterStartOn }) : { endOn: null, startOn: null };
    return windowDraftFromProspect(prospect, window, quarterMonths, index);
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Cycle bar colors so an unbounded project list reuses the first swatch after the last one.
// @param {number} index - Zero-based row index.
// @returns {number} Color slot in 0 .. FOCUS_WINDOW_COLOR_COUNT - 1.
export function focusWindowColorIndex(index) {
  return ((index % FOCUS_WINDOW_COLOR_COUNT) + FOCUS_WINDOW_COLOR_COUNT) % FOCUS_WINDOW_COLOR_COUNT;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the quarter months a window occupies, so placement trees can follow the dragged bar.
// @param {object} params - { endOn, quarterMonths, startOn }.
// @returns {Array<string>} Contiguous YYYY-MM labels overlapping the window.
export function focusMonthsFromWindow({ endOn, quarterMonths, startOn }) {
  const overlappingMonths = [];
  for (const monthKey of quarterMonths) {
    const monthStartOn = formatDateKey(dateFromMonthKey(monthKey));
    const monthEndOn = lastDateFromMonthKey(monthKey);
    if (monthStartOn <= endOn && monthEndOn >= startOn) overlappingMonths.push(monthKey);
  }
  return overlappingMonths;
}

// ----------------------------------------------------------------------------------------------
// @desc Last calendar day of a YYYY-MM month.
// @param {string} monthKey - Month in YYYY-MM form.
// @returns {string} YYYY-MM-DD date of that month's last morning.
export function lastDateFromMonthKey(monthKey) {
  const monthStart = dateFromMonthKey(monthKey);
  return formatDateKey(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
}

// ----------------------------------------------------------------------------------------------
// @desc Month name with no year, matching the timeline header in the mock ("October").
// @param {string} monthKey - YYYY-MM label.
// @returns {string} Full month name.
export function monthNameFromMonthKey(monthKey) {
  const monthNumber = Number(String(monthKey).split("-")[1]);
  return FULL_MONTH_NAMES[monthNumber - 1] || "";
}

// ----------------------------------------------------------------------------------------------
// @desc Build three quarter-name ideas, preferring Focus project titles and filling from Keep warm, then static
//   fallbacks, so the page always has three chips even when the user has named nothing yet.
// @param {Array<object>} prospects - Stored ActionProspect records.
// @param {object} scope - Planning scope with quarter and year.
// @returns {Array<string>} Exactly three distinct name ideas when fallbacks can fill the list.
export function nameIdeasFromProspects(prospects = [], scope) {
  const activeProspects = activeProspectsFromList(prospects);
  const focusProspects = activeProspects.filter(prospect => prospect.priorityEm === "quarterFocus");
  const ideaSources = focusProspects.length ? focusProspects : activeProspects;
  const titles = [];
  for (const prospect of ideaSources) {
    const title = shortProjectTitle(prospect.summary);
    if (title && !titles.includes(title)) titles.push(title);
  }
  const { quarterMonths } = quarterBoundsFromScope(scope);
  const firstMonthName = monthNameFromMonthKey(quarterMonths[0]);
  const lastMonthName = monthNameFromMonthKey(quarterMonths[quarterMonths.length - 1]);
  const draftedIdeas = [];
  if (titles[0]) draftedIdeas.push(`The ${ titles[0] } quarter`);
  if (titles[0] && titles[1]) draftedIdeas.push(`Finish ${ titles[0] }, then ${ titles[1] }`);
  else if (titles[0]) draftedIdeas.push(`${ titles[0] } by ${ lastMonthName }`);
  draftedIdeas.push(`Fewer open threads by ${ lastMonthName } than ${ firstMonthName }`);
  const uniqueIdeas = [];
  for (const idea of draftedIdeas.concat(QUARTER_NAME_FALLBACKS)) {
    if (!uniqueIdeas.includes(idea)) uniqueIdeas.push(idea);
    if (uniqueIdeas.length === 3) return uniqueIdeas;
  }
  return uniqueIdeas;
}

// ----------------------------------------------------------------------------------------------
// @desc Map timeline drafts onto savePlanProspects records that update focusMonths without touching pace.
// @param {Array<object>} drafts - Current per-project window drafts.
// @param {string} capturedAt - ISO timestamp shared by every record in this edit.
// @returns {Array<object>} Records accepted by savePlanProspects.
export function prospectRecordsFromWindowDrafts(drafts, capturedAt) {
  return drafts.map(draft => ({ approvalStatusEm: draft.approvalStatusEm, capturedAt, focusMonths: draft.focusMonths,
    priorityEm: draft.priorityEm, substantiations: draft.substantiations, summary: draft.summary,
    userCategoryEm: draft.userCategoryEm, uuid: draft.uuid }));
}

// ----------------------------------------------------------------------------------------------
// @desc First and last calendar days of the planning quarter, plus the three YYYY-MM labels between them.
// @param {object} scope - Planning scope with quarter and year.
// @returns {object} { quarterEndOn, quarterMonths, quarterStartOn }.
export function quarterBoundsFromScope(scope) {
  const quarterMonths = monthLabelsForQuarter(scope);
  const quarterStartOn = formatDateKey(dateFromMonthKey(quarterMonths[0]));
  const quarterEndOn = lastDateFromMonthKey(quarterMonths[quarterMonths.length - 1]);
  return { quarterEndOn, quarterMonths, quarterStartOn };
}

// ----------------------------------------------------------------------------------------------
// @desc Choose which name chip is selected when the page opens: a stored name that matches an idea, a custom
//   value the user typed, or the first drafted idea when the question is still unanswered.
// @param {string} storedText - Previously saved quarter name, or empty.
// @param {Array<string>} ideas - The three chips being offered.
// @returns {string} Matching idea, CUSTOM_QUARTER_NAME, or the first idea.
export function selectedNameFromRecord(storedText, ideas) {
  if (storedText && ideas.includes(storedText)) return storedText;
  if (storedText) return CUSTOM_QUARTER_NAME;
  return ideas[0] ?? CUSTOM_QUARTER_NAME;
}

// ----------------------------------------------------------------------------------------------
// @desc Shorten a project summary so it can sit in a name idea or a deadline footnote without wrapping.
// @param {string} summary - Project title.
// @returns {string} At most 36 characters, cut at a word boundary.
export function shortProjectTitle(summary) {
  const normalized = String(summary || "").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  if (normalized.length <= 36) return normalized;
  const clipped = normalized.slice(0, 36);
  const lastSpace = clipped.lastIndexOf(" ");
  const shortened = lastSpace > 12 ? clipped.slice(0, lastSpace) : clipped;
  return shortened.trim().replace(/[.,;:]+$/, "");
}

// ----------------------------------------------------------------------------------------------
// @desc Rebuild a window draft after the user drags a handle, converting day offsets back into dates and months.
// @param {object} draft - Current per-project window draft.
// @param {object} params - { endDay, quarterEndOn, quarterMonths, quarterStartOn, startDay }.
// @returns {object} Updated draft.
export function updatedWindowDraft(draft, { endDay, quarterEndOn, quarterMonths, quarterStartOn, startDay }) {
  const window = windowFromDayOffsets({ deadlineOn: draft.deadlineOn, endDay, quarterEndOn, quarterStartOn, startDay });
  const focusMonths = focusMonthsFromWindow({ endOn: window.endOn, quarterMonths, startOn: window.startOn });
  return { ...draft, endOn: window.endOn, focusMonths, startOn: window.startOn };
}

// ----------------------------------------------------------------------------------------------
// @desc Detect whether any timeline draft's months differ from what is stored, so Next persists edits without
//   rewriting the note when the user only passed through.
// @param {Array<object>} drafts - Current window drafts.
// @param {Array<object>} prospects - Stored ActionProspect records.
// @returns {boolean} True when at least one project's focusMonths would change.
export function windowDraftsNeedSave(drafts, prospects = []) {
  const storedMonthsByUuid = new Map(prospects.map(prospect => [prospect.uuid, (prospect.focusMonths ?? []).join(",")]));
  return drafts.some(draft => (storedMonthsByUuid.get(draft.uuid) ?? "") !== draft.focusMonths.join(","));
}

// ----------------------------------------------------------------------------------------------
// @desc Assemble one timeline row from a prospect and a resolved start/end window.
// @param {object} prospect - Active ActionProspect.
// @param {object} window - { endOn, startOn }.
// @param {Array<string>} quarterMonths - YYYY-MM labels for the quarter.
// @param {number} index - Row index, used to cycle bar color.
// @returns {object} Window draft.
function windowDraftFromProspect(prospect, window, quarterMonths, index) {
  const focusMonths = window.startOn && window.endOn
    ? focusMonthsFromWindow({ endOn: window.endOn, quarterMonths, startOn: window.startOn }) : [];
  const substantiations = prospect.substantiations ?? [prospect.substantiation].filter(Boolean);
  return { approvalStatusEm: prospect.approvalStatusEm, colorIndex: focusWindowColorIndex(index),
    deadlineOn: prospect.deadlineOn ?? null, endOn: window.endOn, focusMonths, priorityEm: prospect.priorityEm,
    startOn: window.startOn, substantiations, summary: prospect.summary, userCategoryEm: prospect.userCategoryEm,
    uuid: prospect.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Convert a pair of day offsets along the quarter axis into a clamped calendar window.
// @param {object} params - { deadlineOn, endDay, quarterEndOn, quarterStartOn, startDay }.
// @returns {object} { endOn, startOn }.
export function windowFromDayOffsets({ deadlineOn, endDay, quarterEndOn, quarterStartOn, startDay }) {
  const startOn = addDaysToDateKey(quarterStartOn, startDay);
  const endOn = addDaysToDateKey(quarterStartOn, endDay);
  return clampFocusWindow({ deadlineOn, endOn, quarterEndOn, quarterStartOn, startOn });
}

// ----------------------------------------------------------------------------------------------
// @desc Restore a window from stored YYYY-MM labels, still clamping to a deadline.
// @param {object} params - { deadlineOn, focusMonths, quarterEndOn, quarterStartOn }.
// @returns {object} { endOn, startOn }.
export function windowFromFocusMonths({ deadlineOn, focusMonths, quarterEndOn, quarterStartOn }) {
  const firstMonthKey = focusMonths[0] || monthKeyFromDateInput(quarterStartOn);
  const lastMonthKey = focusMonths[focusMonths.length - 1] || firstMonthKey;
  const startOn = formatDateKey(dateFromMonthKey(firstMonthKey));
  const endOn = lastDateFromMonthKey(lastMonthKey);
  return clampFocusWindow({ deadlineOn, endOn, quarterEndOn, quarterStartOn, startOn });
}
