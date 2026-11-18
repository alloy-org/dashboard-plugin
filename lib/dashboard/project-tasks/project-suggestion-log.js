// Measure how long ago a task or generated idea was last shown as a suggestion, from a project record's suggestion log.
// The log's entries come from the domain's shown suggestions note (see SuggestionShownStore), plus any an earlier
// version appended to a project's store section as h3 headings named "{taskUuid} suggested", one bullet per showing,
// which are read until that section is next rewritten without them. A generated idea shown before it became a task is
// logged under its idea ID, in an entry that names the idea rather than a task, so an idea ID is never read as a task
// UUID.
const MILLISECONDS_PER_MINUTE = 60 * 1000;
// Idea IDs carry this prefix (see ideaIdFor), which is how a heading's identity is told from a task UUID.
const IDEA_ID_PREFIX = "idea-";
const SUGGESTION_HEADING_PATTERN = /^### (\S+) suggested\s*$/;
const SUGGESTION_BULLET_PATTERN = /^- (\S+) — (\S+)\s*$/;

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
// @desc Read a project section's suggestion log back from its headings: one entry per bullet beneath each
//   "{identity} suggested" heading.
// @param {string} sectionBody - Markdown of one project section.
// @returns {Array<object>} { suggestedAt, taskUuid } or { ideaId, suggestedAt } entries, in the order written.
export function suggestionLogFromSection(sectionBody) {
  const entries = [];
  let identity = null;
  for (const line of (sectionBody || "").split("\n")) {
    if (/^#/.test(line)) {
      identity = line.match(SUGGESTION_HEADING_PATTERN)?.[1] || null;
      continue;
    }
    const bulletMatch = identity ? line.match(SUGGESTION_BULLET_PATTERN) : null;
    if (!bulletMatch || bulletMatch[1] !== identity) continue;
    entries.push(_logEntry(identity, bulletMatch[2]));
  }
  return entries;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc A log entry for one bullet, naming an idea or a task by its identity's form.
// @param {string} identity - The heading's task UUID or idea ID.
// @param {string} suggestedAt - The bullet's ISO time.
// @returns {object} { ideaId, suggestedAt } or { suggestedAt, taskUuid }.
function _logEntry(identity, suggestedAt) {
  return identity.startsWith(IDEA_ID_PREFIX) ? { ideaId: identity, suggestedAt } : { suggestedAt, taskUuid: identity };
}

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
