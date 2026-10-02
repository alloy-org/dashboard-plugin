// Record, on each project section of the quarterly task store, the task UUIDs that were actually shown to
// the user. The heading is an h3 named "{taskUuid} suggested"; each time that task is suggested, its UUID is
// appended to the bullet list under that heading, with the time, so a later ranking can see how long ago it
// was offered.
const MILLISECONDS_PER_MINUTE = 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Minutes from the latest time this task was suggested, or null when it has never been suggested.
// @param {Array<object>} taskSuggestions - { suggestedAt, taskUuid } entries from the project record.
// @param {string} taskUuid - Task being considered.
// @param {Date} now - Instant the ranking is prepared for.
// @returns {number|null} Whole minutes, never negative.
export function minutesSinceRecommended(taskSuggestions, taskUuid, now) {
  const stamps = (taskSuggestions || []).filter(entry => entry?.taskUuid === taskUuid)
    .map(entry => Date.parse(entry.suggestedAt)).filter(Number.isFinite);
  if (!stamps.length) return null;
  return Math.max(0, Math.round((now.getTime() - Math.max(...stamps)) / MILLISECONDS_PER_MINUTE));
}

// ----------------------------------------------------------------------------------------------
// @desc Heading text for one task's suggestion log. The UUID keeps the section stable across renames.
// @param {string} taskUuid - Task that was shown.
// @returns {string} Heading text without the leading hashes.
export function suggestionHeadingText(taskUuid) {
  return `${ taskUuid } suggested`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render one h3 per suggested task. A task suggested again appends another bullet under the same heading.
// @param {Array<object>} taskSuggestions - { suggestedAt, taskUuid } entries, oldest first.
// @returns {string} Markdown, or an empty string when nothing has been suggested.
export function suggestionSectionsMarkdown(taskSuggestions) {
  const timesByUuid = new Map();
  for (const entry of taskSuggestions || []) {
    if (!entry?.taskUuid || !entry?.suggestedAt) continue;
    const times = timesByUuid.get(entry.taskUuid) || [];
    times.push(entry.suggestedAt);
    timesByUuid.set(entry.taskUuid, times);
  }
  const sections = [...timesByUuid.entries()].map(([taskUuid, times]) => {
    const bullets = times.map(suggestedAt => `- ${ taskUuid } — ${ suggestedAt }`).join("\n");
    return `### ${ suggestionHeadingText(taskUuid) }\n${ bullets }`;
  });
  if (!sections.length) return "";
  return `${ sections.join("\n\n") }\n\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Append one suggestion event per task UUID, leaving earlier events in place.
// @param {Array<object>} taskSuggestions - Existing { suggestedAt, taskUuid } entries.
// @param {Array<string>} taskUuids - Tasks just shown to the user.
// @param {string} suggestedAt - ISO timestamp shared by this batch.
// @returns {Array<object>} The log including the new events.
export function taskSuggestionsWithShown(taskSuggestions, taskUuids, suggestedAt) {
  const additions = (taskUuids || []).filter(Boolean).map(taskUuid => ({ suggestedAt, taskUuid }));
  return [...(taskSuggestions || []), ...additions];
}
