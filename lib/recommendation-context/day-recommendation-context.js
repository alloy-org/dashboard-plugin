// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Shared recommendation context for Goal Coach and Proposed Agenda.
// Prompt summary: "Use same-weekday completion patterns, all-day calendar events, and travel research notes when
//   recommending tasks or agenda activities."
import { normalizeExternalCalendarEvents } from "hooks/use-external-calendar-events";
import { eventCoversDate, externalCalendarEventsForTargetDate } from "util/calendar-utility";
import { dateKeyFromDateInput, localMidnightFromDateInput } from "util/date-utility";
import { stableJson } from "util/json-utility";
import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";
import { domainTaskUuidSet } from "util/task-domain-utility";

const COMPLETION_LOOKBACK_WEEKS = 2;
const DATE_LIKE_TITLE_PATTERNS = [
  /^(?:(?:sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?),?\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*)?\d{4}$/i,
  /^\d{4}-\d{1,2}-\d{1,2}$/,
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/,
  /^\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}$/i,
];
const EVENT_KEYWORDS = {
  conference: ["conference", "convention", "expo", "summit", "workshop", "offsite", "retreat"],
  travel: ["airport", "flight", "hotel", "road trip", "trip", "travel"],
  vacation: ["holiday", "ooo", "pto", "vacation"],
};
const MAX_CONTEXT_EVENTS = 5;
const MAX_RESEARCH_NOTES = 4;
const MAX_RESEARCH_SNIPPET_CHARS = 550;
const MAX_RECENT_NOTES_TO_SCAN = 30;
const MIN_TERM_LENGTH = 3;

// ----------------------------------------------------------------------------------------------
// @desc Build every day-level recommendation signal shared by Goal Coach and Proposed Agenda.
// @param {object} app - Amplenote app bridge.
// @param {object} [options={}] - { calendarEvents, domainUuid, targetDate }.
// @returns {Promise<object>} Context with same-weekday completions, all-day events, research notes, and fingerprint.
export async function buildDayRecommendationContext(app, { calendarEvents = null, domainUuid = null,
    targetDate = new Date() } = {}) {
  const normalizedTarget = localMidnightFromDateInput(targetDate);
  const [completionPatterns, allDayEvents] = await Promise.all([
    sameWeekdayCompletionPatterns(app, { domainUuid, targetDate: normalizedTarget }),
    allDayEventsForTargetDate(app, { calendarEvents, domainUuid, targetDate: normalizedTarget }),
  ]);
  const eventContext = eventContextFromAllDayEvents(allDayEvents);
  const researchNotes = eventContext.isTravelLike
    ? await researchNotesForEventTerms(app, eventContext.researchTerms).catch(error => {
        logIfEnabled("[recommendation-context] research note lookup failed", error?.message);
        return [];
      })
    : [];
  const context = { allDayEvents, completionPatterns, eventContext, researchNotes,
    targetDateKey: dateKeyFromDateInput(normalizedTarget) };
  const cacheKey = recommendationContextCacheKey(context);
  return { ...context, cacheKey, fingerprint: recommendationContextFingerprint(context) };
}

// ----------------------------------------------------------------------------------------------
// @desc Return all-day calendar events that apply to the target day, using already-loaded events when supplied.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { calendarEvents, domainUuid, targetDate }.
// @returns {Promise<Array<object>>} Compact all-day event records.
export async function allDayEventsForTargetDate(app, { calendarEvents = null, domainUuid = null,
    targetDate = new Date() } = {}) {
  const rawEvents = Array.isArray(calendarEvents)
    ? calendarEvents
    : await externalCalendarEventsForTargetDate(app, targetDate, domainUuid);
  const normalized = normalizeExternalCalendarEvents(rawEvents);
  const targetAllDayEvents = normalized.filter(event => event?.allDay && eventCoversDate(event, targetDate));
  const boundedAllDayEvents = targetAllDayEvents.slice(0, MAX_CONTEXT_EVENTS);
  const compactAllDayEvents = boundedAllDayEvents.map(event => ({ endKey: event.end ? dateKeyFromDateInput(event.end) : null,
    startKey: event.start ? dateKeyFromDateInput(event.start) : null, title: cleanText(event.title) || "All-day event" }));
  return compactAllDayEvents;
}

// ----------------------------------------------------------------------------------------------
// @desc Classify all-day events and derive compact search terms for related notes.
// @param {Array<object>} allDayEvents - Compact all-day event records.
// @returns {object} Classification and extracted terms.
export function eventContextFromAllDayEvents(allDayEvents) {
  const titles = (allDayEvents || []).map(event => event.title).filter(Boolean);
  const joined = titles.join(" ").toLowerCase();
  const matchingCategoryEntries = Object.entries(EVENT_KEYWORDS).filter(([, words]) =>
    words.some(word => joined.includes(word)));
  const categories = matchingCategoryEntries.map(([category]) => category);
  const isTravelLike = categories.some(category => category === "travel" || category === "vacation" || category === "conference");
  const researchTerms = uniqueStrings(titles.flatMap(termsFromEventTitle));

  return { categories, isTravelLike, researchTerms, titles };
}

// ----------------------------------------------------------------------------------------------
// @desc True when a note title is itself a calendar date, so its task completions should not imply a project.
// @param {string|null} title - Candidate note title.
// @returns {boolean}
export function isDateNamedNoteTitle(title) {
  const normalized = cleanText(title);
  if (!normalized) return false;
  return DATE_LIKE_TITLE_PATTERNS.some(pattern => pattern.test(normalized));
}

// ----------------------------------------------------------------------------------------------
// @desc Build the structured cache key members that make a Proposed Agenda cache entry valid for this context.
// @param {object} context - Context returned by buildDayRecommendationContext before cache key is attached.
// @returns {object} Context key with targetDateKey, allDayEvents, completionPatterns, eventCategories, and researchNotes.
// [OpenAI GPT-5.5] Task: expose cache identity members instead of passing only an opaque fingerprint
export function recommendationContextCacheKey(context) {
  const allDayEventKeys = (context.allDayEvents || []).map(event => ({ startKey: event.startKey || null,
    title: event.title || "" }));
  const sortedAllDayEventKeys = allDayEventKeys.sort((a, b) =>
    `${ a.startKey }${ a.title }`.localeCompare(`${ b.startKey }${ b.title }`));
  const completionPatternKeys = (context.completionPatterns || []).map(pattern => ({ completedCount: pattern.completedCount,
    noteName: pattern.noteName, noteUuid: pattern.noteUuid }));
  const researchNoteKeys = (context.researchNotes || []).map(note => ({ name: note.name, uuid: note.uuid }));
  return {
    allDayEvents: sortedAllDayEventKeys,
    completionPatterns: completionPatternKeys,
    eventCategories: context.eventContext?.categories || [],
    researchNotes: researchNoteKeys,
    targetDateKey: context.targetDateKey || null,
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Stable string fingerprint for cache invalidation when day recommendation context materially changes.
// @param {object} context - Context returned by buildDayRecommendationContext before fingerprint is attached.
// @returns {string}
export function recommendationContextFingerprint(context) {
  const cacheKey = context.cacheKey || recommendationContextCacheKey(context);
  return stableJson(cacheKey);
}

// ----------------------------------------------------------------------------------------------
// @desc Find relevant research notes from event/place terms using title matches plus a bounded recent-note scan.
// @param {object} app - Amplenote app bridge.
// @param {Array<string>} terms - Search terms extracted from all-day event titles.
// @returns {Promise<Array<object>>} Research-note snippets ranked by relevance.
export async function researchNotesForEventTerms(app, terms) {
  const searchTerms = uniqueStrings((terms || []).map(term => cleanText(term)).filter(term => term.length >= MIN_TERM_LENGTH));
  if (searchTerms.length === 0) return [];
  const byUuid = new Map();
  for (const term of searchTerms.slice(0, MAX_RESEARCH_NOTES)) {
    const handles = await arrayFromFilterNotesResult(app.filterNotes({ query: term }, "relevance")).catch(() => []);
    for (const handle of handles.slice(0, MAX_RESEARCH_NOTES)) addResearchHandle(byUuid, handle, term, 3);
  }
  const recentHandles = await arrayFromFilterNotesResult(app.filterNotes({}, "changed")).catch(() => []);
  for (const handle of recentHandles.slice(0, MAX_RECENT_NOTES_TO_SCAN)) {
    if (!handle?.uuid) continue;
    const titleMatches = searchTerms.filter(term => cleanText(handle.name).toLowerCase().includes(term.toLowerCase()));
    if (titleMatches.length) addResearchHandle(byUuid, handle, titleMatches[0], 2);
    if (byUuid.has(handle.uuid) && byUuid.get(handle.uuid).snippet) continue;
    const content = await app.getNoteContent({ uuid: handle.uuid }).catch(() => "");
    const matchedTerm = searchTerms.find(term => content.toLowerCase().includes(term.toLowerCase()));
    if (matchedTerm) addResearchHandle(byUuid, handle, matchedTerm, 1, snippetAroundTerm(content, matchedTerm));
  }
  const notes = await hydrateResearchSnippets(app, byUuid);
  const rankedNotes = notes.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const boundedNotes = rankedNotes.slice(0, MAX_RESEARCH_NOTES);
  return boundedNotes;
}

// ----------------------------------------------------------------------------------------------
// @desc Count completed tasks from each non-date-named source note on the prior two same weekdays.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { domainUuid, targetDate }.
// @returns {Promise<Array<object>>} Per-note completion counts sorted descending.
export async function sameWeekdayCompletionPatterns(app, { domainUuid = null, targetDate = new Date() } = {}) {
  if (typeof app.getCompletedTasks !== "function") return [];
  const domainTaskUuids = domainUuid ? await domainTaskUuidSet(app, domainUuid) : null;
  const priorDays = [];
  for (let weeksBack = 1; weeksBack <= COMPLETION_LOOKBACK_WEEKS; weeksBack += 1) {
    priorDays.push(new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - weeksBack * 7));
  }
  const completedTaskArrays = await Promise.all(priorDays.map(day => completedTasksForLocalDay(app, day)));
  const counts = new Map();
  for (let index = 0; index < priorDays.length; index += 1) {
    for (const task of completedTaskArrays[index]) {
      if (domainTaskUuids && !domainTaskUuids.has(task.uuid)) continue;
      const noteUuid = task.noteUUID || null;
      if (!noteUuid) continue;
      const noteName = cleanText(task.noteName || task.noteTitle || task.note?.name);
      if (!counts.has(noteUuid)) counts.set(noteUuid, { completedCount: 0, dates: new Set(), noteName, noteUuid });
      const entry = counts.get(noteUuid);
      entry.completedCount += 1;
      entry.dates.add(dateKeyFromDateInput(priorDays[index]));
      if (!entry.noteName && noteName) entry.noteName = noteName;
    }
  }
  await hydrateCompletionNoteNames(app, counts);
  const entriesWithNoteNames = [...counts.values()].filter(entry => entry.noteName);
  const projectLikeEntries = entriesWithNoteNames.filter(entry => !isDateNamedNoteTitle(entry.noteName));
  const completionPatterns = projectLikeEntries.map(entry => ({ completedCount: entry.completedCount,
    dates: [...entry.dates].sort(), noteName: entry.noteName, noteUuid: entry.noteUuid }));
  const sortedCompletionPatterns = completionPatterns.sort((a, b) => b.completedCount - a.completedCount
    || a.noteName.localeCompare(b.noteName));
  return sortedCompletionPatterns;
}

// ----------------------------------------------------------------------------------------------
// @desc Add or update a research-note candidate in the ranked map.
// @param {Map<string, object>} byUuid - Mutable candidate map.
// @param {object} handle - Amplenote note handle.
// @param {string} matchedTerm - Term that made this note relevant.
// @param {number} score - Relevance score increment.
// @param {string} [snippet=""] - Optional content snippet.
function addResearchHandle(byUuid, handle, matchedTerm, score, snippet = "") {
  if (!handle?.uuid) return;
  const previous = byUuid.get(handle.uuid) || { matchedTerms: new Set(), name: cleanText(handle.name) || "Untitled note",
    score: 0, snippet: "", uuid: handle.uuid };
  previous.score += score;
  previous.matchedTerms.add(matchedTerm);
  if (snippet && (!previous.snippet || snippet.length > previous.snippet.length)) previous.snippet = snippet;
  byUuid.set(handle.uuid, previous);
}

// ----------------------------------------------------------------------------------------------
// @desc Clean whitespace in user-facing strings.
// @param {string|null} value - Raw string.
// @returns {string}
function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------
// @desc Load completed tasks for one local calendar day.
// @param {object} app - Amplenote app bridge.
// @param {Date} day - Local day at any time.
// @returns {Promise<Array<object>>}
async function completedTasksForLocalDay(app, day) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0);
  const tasks = await app.getCompletedTasks(Math.floor(dayStart.getTime() / 1000), Math.floor(nextDay.getTime() / 1000))
    .catch(error => { logIfEnabled("[recommendation-context] getCompletedTasks failed", error?.message); return []; });
  if (!Array.isArray(tasks)) return [];
  const completedTasks = tasks.filter(task => task?.completedAt);
  return completedTasks;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve missing note names for completion-count entries.
// @param {object} app - Amplenote app bridge.
// @param {Map<string, object>} counts - Mutable note count map.
// @returns {Promise<void>}
async function hydrateCompletionNoteNames(app, counts) {
  await Promise.all([...counts.values()].map(async entry => {
    if (entry.noteName) return;
    const handle = await app.findNote({ uuid: entry.noteUuid }).catch(() => null);
    entry.noteName = cleanText(handle?.name);
  }));
}

// ----------------------------------------------------------------------------------------------
// @desc Ensure research-note candidates have a bounded content snippet when possible.
// @param {object} app - Amplenote app bridge.
// @param {Map<string, object>} byUuid - Candidate map.
// @returns {Promise<Array<object>>}
async function hydrateResearchSnippets(app, byUuid) {
  const notes = [];
  for (const note of byUuid.values()) {
    if (!note.snippet) {
      const content = await app.getNoteContent({ uuid: note.uuid }).catch(() => "");
      const term = [...note.matchedTerms][0] || "";
      note.snippet = term ? snippetAroundTerm(content, term) : cleanText(content).substring(0, MAX_RESEARCH_SNIPPET_CHARS);
    }
    notes.push({ matchedTerms: [...note.matchedTerms].sort(), name: note.name, score: note.score,
      snippet: note.snippet, uuid: note.uuid });
  }
  return notes;
}

// ----------------------------------------------------------------------------------------------
// @desc Extract likely event/place terms while dropping generic calendar words.
// @param {string} title - Event title.
// @returns {Array<string>} Search terms.
function termsFromEventTitle(title) {
  const cleaned = cleanText(title).replace(/\b(?:ooo|pto|vacation|holiday|travel|trip|conference|summit|flight|hotel|to|in|at|for|the|and)\b/gi, " ");
  const candidateTerms = cleaned.split(/[-:|,()/]+/);
  const normalizedTerms = candidateTerms.map(term => cleanText(term));
  const meaningfulTerms = normalizedTerms.filter(term => term.length >= MIN_TERM_LENGTH);
  return meaningfulTerms;
}

// ----------------------------------------------------------------------------------------------
// @desc Return a bounded snippet around the first matching term.
// @param {string} content - Note content.
// @param {string} term - Search term.
// @returns {string}
function snippetAroundTerm(content, term) {
  const text = cleanText(content);
  if (!text) return "";
  const index = text.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return text.substring(0, MAX_RESEARCH_SNIPPET_CHARS);
  const start = Math.max(0, index - 160);
  return text.substring(start, start + MAX_RESEARCH_SNIPPET_CHARS);
}

// ----------------------------------------------------------------------------------------------
// @desc Unique truthy strings preserving first-seen order.
// @param {Array<string>} values - Candidate strings.
// @returns {Array<string>}
function uniqueStrings(values) {
  const seen = new Set();
  const uniqueValues = (values || []).filter(value => {
    const key = cleanText(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return uniqueValues;
}
