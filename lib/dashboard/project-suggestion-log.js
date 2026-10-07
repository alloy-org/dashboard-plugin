// Record, on each project section of the quarterly task store, the task UUIDs that were actually shown to
// the user. The heading is an h3 named "{taskUuid} suggested"; each time that task is suggested, its UUID is
// appended to the bullet list under that heading, with the time, so a later ranking can see how long ago it
// was offered. A generated idea shown before it became a task is logged the same way under its idea ID, in an entry
// that names the idea rather than a task, so an idea ID is never read as a task UUID. The headings are the log itself:
// they close the project's section, so each holds only its own bullets, and a newly shown suggestion can be appended
// by rewriting just the heading it belongs to.
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
// @desc Heading text for one task's suggestion log. The UUID keeps the section stable across renames.
// @param {string} taskUuid - Task that was shown.
// @returns {string} Heading text without the leading hashes.
export function suggestionHeadingText(taskUuid) {
  return `${ taskUuid } suggested`;
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
// @desc Plan the heading-scoped writes that append newly shown suggestions to a project section's log. A suggestion
//   whose heading exists is appended beneath it. One shown for the first time gets a new heading, written into the
//   body of the section's last log heading, since a heading can only be added by rewriting the body before it.
// @param {string} sectionBody - Markdown of the project section as it stands.
// @param {Array<object>} shownEntries - { suggestedAt, taskUuid } or { ideaId, suggestedAt } entries to append.
// @returns {Array<object>|null} { body, headingText } per heading to rewrite, or null when the section has no log
//   heading yet, so the caller must rewrite the whole section.
export function suggestionLogAppends(sectionBody, shownEntries) {
  const headings = _logHeadingBodies(sectionBody);
  if (!headings.length) return null;
  const bodyByHeading = new Map(headings.map(heading => [heading.headingText, heading.body]));
  const lastHeadingText = headings[headings.length - 1].headingText;
  const changedTexts = new Set();
  const addedBulletsByHeading = new Map();
  for (const entry of shownEntries) {
    const identity = entry?.taskUuid || entry?.ideaId;
    if (!identity || !entry.suggestedAt) continue;
    const headingText = suggestionHeadingText(identity);
    const bullet = `- ${ identity } — ${ entry.suggestedAt }`;
    if (!bodyByHeading.has(headingText)) {
      addedBulletsByHeading.set(headingText, [...(addedBulletsByHeading.get(headingText) || []), bullet]);
      continue;
    }
    bodyByHeading.set(headingText, _bodyWithBullet(bodyByHeading.get(headingText), bullet));
    changedTexts.add(headingText);
  }
  if (addedBulletsByHeading.size) {
    const addedSections = [...addedBulletsByHeading].map(([headingText, bullets]) => `### ${ headingText }\n${ bullets.join("\n") }`);
    const lastBody = bodyByHeading.get(lastHeadingText).replace(/\n*$/, "\n");
    bodyByHeading.set(lastHeadingText, `${ lastBody }\n${ addedSections.join("\n\n") }\n`);
    changedTexts.add(lastHeadingText);
  }
  const writes = [...changedTexts].map(headingText => ({ body: bodyByHeading.get(headingText), headingText }));
  return writes;
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
// @desc Append one bullet to a log heading's body, keeping the blank line that separates it from what follows.
// @param {string} body - The heading's body as it stands.
// @param {string} bullet - The bullet to add.
// @returns {string} The body with the bullet after its last bullet.
function _bodyWithBullet(body, bullet) {
  const trailingBreaks = body.match(/\n*$/)[0];
  const bulletsText = body.slice(0, body.length - trailingBreaks.length);
  const separator = bulletsText ? "\n" : "";
  return `${ bulletsText }${ separator }${ bullet }${ trailingBreaks || "\n" }`;
}

// ----------------------------------------------------------------------------------------------
// @desc A log entry for one bullet, naming an idea or a task by its identity's form.
// @param {string} identity - The heading's task UUID or idea ID.
// @param {string} suggestedAt - The bullet's ISO time.
// @returns {object} { ideaId, suggestedAt } or { suggestedAt, taskUuid }.
function _logEntry(identity, suggestedAt) {
  return identity.startsWith(IDEA_ID_PREFIX) ? { ideaId: identity, suggestedAt } : { suggestedAt, taskUuid: identity };
}

// ----------------------------------------------------------------------------------------------
// @desc Find a section's log headings and the body beneath each, which runs to the next heading or the section's end.
// @param {string} sectionBody - Markdown of one project section.
// @returns {Array<object>} { body, headingText } in order.
function _logHeadingBodies(sectionBody) {
  const headings = [];
  let current = null;
  for (const line of (sectionBody || "").split(/(?<=\n)/)) {
    if (/^#/.test(line)) {
      const identity = line.replace(/\n$/, "").match(SUGGESTION_HEADING_PATTERN)?.[1];
      current = identity ? { body: "", headingText: suggestionHeadingText(identity) } : null;
      if (current) headings.push(current);
      continue;
    }
    if (current) current.body += line;
  }
  return headings;
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
