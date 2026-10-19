// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Shared recommendation context for Goal Coach and Proposed Agenda.
// Prompt summary: "Use same-weekday completion patterns, all-day calendar events, and travel research notes when
//   recommending tasks or agenda activities."
import { eventCoversDate, externalCalendarEventsForTargetDate, normalizeExternalCalendarEvents } from "util/calendar-utility";
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
// How many note contents the research scan asks the host for at once.
const RESEARCH_NOTE_READ_CONCURRENCY = 6;

// ----------------------------------------------------------------------------------------------
// @desc Build every day-level recommendation signal shared by Goal Coach and Proposed Agenda. All-day events shape
//   the day's tone, but only a travel-like event with its own start time, such as a flight, sends the research-note
//   scan looking for notes about where it goes: an all-day event is as often someone else's trip or conference as it
//   is the user's.
// @param {object} app - Amplenote app bridge.
// @param {object} [options={}] - { calendarEvents, domainUuid, targetDate }.
// @returns {Promise<object>} Context with same-weekday completions, all-day events, timed events, research notes, and
//   fingerprint.
export async function buildDayRecommendationContext(app, { calendarEvents = null, domainUuid = null,
    targetDate = new Date() } = {}) {
  const normalizedTarget = localMidnightFromDateInput(targetDate);
  const [completionPatterns, targetDayEvents] = await Promise.all([
    sameWeekdayCompletionPatterns(app, { domainUuid, targetDate: normalizedTarget }),
    _normalizedCalendarEvents(app, { calendarEvents, domainUuid, targetDate: normalizedTarget }),
  ]);
  const allDayEvents = _compactAllDayEvents(targetDayEvents, normalizedTarget);
  const timedEvents = _compactTimedEvents(targetDayEvents, normalizedTarget);
  const eventContext = eventContextFromAllDayEvents(allDayEvents);
  const timedEventContext = eventContextFromAllDayEvents(timedEvents);
  const researchNotes = timedEventContext.isTravelLike
    ? await researchNotesForEventTerms(app, timedEventContext.researchTerms).catch(error => {
        logIfEnabled("[recommendation-context] research note lookup failed", error?.message);
        return [];
      })
    : [];
  const context = { allDayEvents, completionPatterns, eventContext, researchNotes,
    targetDateKey: dateKeyFromDateInput(normalizedTarget), timedEventContext, timedEvents };
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
  const normalized = await _normalizedCalendarEvents(app, { calendarEvents, domainUuid, targetDate });
  return _compactAllDayEvents(normalized, targetDate);
}

// ----------------------------------------------------------------------------------------------
// @desc Classify calendar events and derive compact search terms for related notes.
// @param {Array<object>} allDayEvents - Compact event records, each with a title: all-day events, or the timed events
//   that may start a research-note scan.
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
// @param {Array<string>} terms - Search terms extracted from the titles of timed travel-like events.
// @returns {Promise<Array<object>>} Research-note snippets ranked by relevance.
export async function researchNotesForEventTerms(app, terms) {
  const searchTerms = uniqueStrings((terms || []).map(term => cleanText(term)).filter(term => term.length >= MIN_TERM_LENGTH));
  if (searchTerms.length === 0) return [];
  const byUuid = new Map();
  const queriedTerms = searchTerms.slice(0, MAX_RESEARCH_NOTES);
  const [handlesByTerm, recentHandles] = await Promise.all([
    Promise.all(queriedTerms.map(term => arrayFromFilterNotesResult(app.filterNotes({ query: term }, "relevance")).catch(() => []))),
    arrayFromFilterNotesResult(app.filterNotes({}, "changed")).catch(() => []),
  ]);
  queriedTerms.forEach((term, index) => {
    for (const handle of handlesByTerm[index].slice(0, MAX_RESEARCH_NOTES)) addResearchHandle(byUuid, handle, term, 3);
  });
  const scannedHandles = recentHandles.slice(0, MAX_RECENT_NOTES_TO_SCAN).filter(handle => handle?.uuid);
  for (const handle of scannedHandles) {
    const titleMatches = searchTerms.filter(term => cleanText(handle.name).toLowerCase().includes(term.toLowerCase()));
    if (titleMatches.length) addResearchHandle(byUuid, handle, titleMatches[0], 2);
  }
  const handlesNeedingContent = scannedHandles.filter(handle => !byUuid.get(handle.uuid)?.snippet);
  const contents = await _noteContentsInBatches(app, handlesNeedingContent);
  handlesNeedingContent.forEach((handle, index) => {
    const content = contents[index];
    const matchedTerm = searchTerms.find(term => content.toLowerCase().includes(term.toLowerCase()));
    if (matchedTerm) addResearchHandle(byUuid, handle, matchedTerm, 1, snippetAroundTerm(content, matchedTerm));
  });
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
  const candidates = [...byUuid.values()];
  const candidatesWithoutSnippet = candidates.filter(note => !note.snippet);
  const contents = await _noteContentsInBatches(app, candidatesWithoutSnippet);
  candidatesWithoutSnippet.forEach((note, index) => {
    const term = [...note.matchedTerms][0] || "";
    note.snippet = term ? snippetAroundTerm(contents[index], term) : cleanText(contents[index]).substring(0, MAX_RESEARCH_SNIPPET_CHARS);
  });
  const notes = candidates.map(note => ({ matchedTerms: [...note.matchedTerms].sort(), name: note.name, score: note.score,
    snippet: note.snippet, uuid: note.uuid }));
  return notes;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the content of each note, RESEARCH_NOTE_READ_CONCURRENCY at a time. The host can answer with something
//   other than a string for a note it cannot read, so every answer is coerced to text, and a failed read yields "".
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} handles - Note handles, each with a uuid.
// @returns {Promise<Array<string>>} Each note's markdown, in the order given.
async function _noteContentsInBatches(app, handles) {
  const contents = [];
  for (let start = 0; start < handles.length; start += RESEARCH_NOTE_READ_CONCURRENCY) {
    const batch = handles.slice(start, start + RESEARCH_NOTE_READ_CONCURRENCY);
    const batchContents = await Promise.all(batch.map(handle => app.getNoteContent({ uuid: handle.uuid }).catch(() => "")));
    contents.push(...batchContents.map(content => (typeof content === "string" ? content : "")));
  }
  return contents;
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize the calendar events to consider for the target day, using already-loaded events when supplied.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { calendarEvents, domainUuid, targetDate }.
// @returns {Promise<Array<object>>} Events with start and end as Dates.
async function _normalizedCalendarEvents(app, { calendarEvents = null, domainUuid = null, targetDate = new Date() } = {}) {
  const rawEvents = Array.isArray(calendarEvents)
    ? calendarEvents
    : await externalCalendarEventsForTargetDate(app, targetDate, domainUuid);
  return normalizeExternalCalendarEvents(rawEvents);
}

// ----------------------------------------------------------------------------------------------
// @desc Compact the all-day events that cover the target day.
// @param {Array<object>} events - Normalized calendar events.
// @param {Date} targetDate - Local day being planned.
// @returns {Array<object>} { endKey, startKey, title } per event, at most MAX_CONTEXT_EVENTS.
function _compactAllDayEvents(events, targetDate) {
  const targetAllDayEvents = events.filter(event => event?.allDay && eventCoversDate(event, targetDate));
  const boundedAllDayEvents = targetAllDayEvents.slice(0, MAX_CONTEXT_EVENTS);
  const compactAllDayEvents = boundedAllDayEvents.map(event => ({ endKey: event.end ? dateKeyFromDateInput(event.end) : null,
    startKey: event.start ? dateKeyFromDateInput(event.start) : null, title: cleanText(event.title) || "All-day event" }));
  return compactAllDayEvents;
}

// ----------------------------------------------------------------------------------------------
// @desc Compact the events that start at a set time on the target day.
// @param {Array<object>} events - Normalized calendar events.
// @param {Date} targetDate - Local day being planned.
// @returns {Array<object>} { startAt, title } per event, earliest first, at most MAX_CONTEXT_EVENTS; startAt is an ISO
//   timestamp.
function _compactTimedEvents(events, targetDate) {
  const targetDateKey = dateKeyFromDateInput(targetDate);
  const timedEvents = events.filter(event => event && !event.allDay && event.start
    && dateKeyFromDateInput(event.start) === targetDateKey);
  const earliestFirst = timedEvents.sort((first, second) => first.start - second.start);
  const boundedTimedEvents = earliestFirst.slice(0, MAX_CONTEXT_EVENTS);
  const compactTimedEvents = boundedTimedEvents.map(event => ({ startAt: event.start.toISOString(),
    title: cleanText(event.title) || "Event" }));
  return compactTimedEvents;
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
