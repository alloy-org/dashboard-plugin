// Record, on each project section of the quarterly task store, the task UUIDs that were actually shown to
// the user. The heading is an h3 named "{taskUuid} suggested"; each time that task is suggested, its UUID is
// appended to the bullet list under that heading, with the time, so a later ranking can see how long ago it
// was offered. A generated idea shown before it became a task is logged the same way under its idea ID, in an entry
// that names the idea rather than a task, so an idea ID is never read as a task UUID.
const MILLISECONDS_PER_MINUTE = 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Minutes from the latest time this idea was suggested, or null when it has never been suggested.
// @param {Array<object>} taskSuggestions - Entries from the project record; idea entries are { ideaId, suggestedAt }.
// @param {string} ideaId - Idea being considered.
// @param {Date} now - Instant the ranking is prepared for.
// @returns {number|null} Whole minutes, never negative.
export function minutesSinceIdeaRecommended(taskSuggestions, ideaId, now) {
  const ideaEntries = (taskSuggestions || []).filter(entry => entry?.ideaId === ideaId);
  return _minutesSinceLatest(ideaEntries, now);
}

// ----------------------------------------------------------------------------------------------
// @desc Minutes from the latest time this task was suggested, or null when it has never been suggested.
// @param {Array<object>} taskSuggestions - { suggestedAt, taskUuid } entries from the project record.
// @param {string} taskUuid - Task being considered.
// @param {Date} now - Instant the ranking is prepared for.
// @returns {number|null} Whole minutes, never negative.
export function minutesSinceRecommended(taskSuggestions, taskUuid, now) {
  const taskEntries = (taskSuggestions || []).filter(entry => entry?.taskUuid === taskUuid);
  return _minutesSinceLatest(taskEntries, now);
}

// ----------------------------------------------------------------------------------------------
// @desc Heading text for one task's suggestion log. The UUID keeps the section stable across renames.
// @param {string} taskUuid - Task that was shown.
// @returns {string} Heading text without the leading hashes.
export function suggestionHeadingText(taskUuid) {
  return `${ taskUuid } suggested`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one h3 per suggested task or idea. One suggested again appends another bullet under the same heading.
// @param {Array<object>} taskSuggestions - { suggestedAt, taskUuid } or { ideaId, suggestedAt } entries, oldest first.
// @returns {string} Markdown, or an empty string when nothing has been suggested.
export function suggestionSectionsMarkdown(taskSuggestions) {
  const timesByIdentity = new Map();
  for (const entry of taskSuggestions || []) {
    const identity = entry?.taskUuid || entry?.ideaId;
    if (!identity || !entry.suggestedAt) continue;
    const times = timesByIdentity.get(identity) || [];
    times.push(entry.suggestedAt);
    timesByIdentity.set(identity, times);
  }
  const sections = [...timesByIdentity.entries()].map(([identity, times]) => {
    const bullets = times.map(suggestedAt => `- ${ identity } — ${ suggestedAt }`).join("\n");
    return `### ${ suggestionHeadingText(identity) }\n${ bullets }`;
  });
  if (!sections.length) return "";
  return `${ sections.join("\n\n") }\n\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Append one suggestion event per task UUID and per idea ID, leaving earlier events in place.
// @param {Array<object>} taskSuggestions - Existing entries.
// @param {Array<string>} taskUuids - Tasks just shown to the user.
// @param {string} suggestedAt - ISO timestamp shared by this batch.
// @param {object} [options] - { ideaIds = [] }: ideas just shown, which have not become tasks.
// @returns {Array<object>} The log including the new events.
export function taskSuggestionsWithShown(taskSuggestions, taskUuids, suggestedAt, { ideaIds = [] } = {}) {
  const taskAdditions = (taskUuids || []).filter(Boolean).map(taskUuid => ({ suggestedAt, taskUuid }));
  const ideaAdditions = (ideaIds || []).filter(Boolean).map(ideaId => ({ ideaId, suggestedAt }));
  return [...(taskSuggestions || []), ...taskAdditions, ...ideaAdditions];
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Minutes from the latest of some log entries.
// @param {Array<object>} entries - Entries carrying suggestedAt.
// @param {Date} now - Instant the ranking is prepared for.
// @returns {number|null} Whole minutes, never negative, or null without a readable entry.
function _minutesSinceLatest(entries, now) {
  const stamps = entries.map(entry => Date.parse(entry.suggestedAt)).filter(Number.isFinite);
  if (!stamps.length) return null;
  return Math.max(0, Math.round((now.getTime() - Math.max(...stamps)) / MILLISECONDS_PER_MINUTE));
}
