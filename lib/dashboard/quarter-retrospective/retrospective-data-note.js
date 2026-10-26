// Read and write a Quarter Retrospective's archived data note: one note per domain, quarter, and style, such as
// "Work Q3 2026 Roast Retrospective Data". Each `##` section holds one JSON fence: the request that generated it, the
// statistics, the projects, each month's digest, the calendar, the media, the story's slides, and the takeaways note.
// A payload too large for one write continues in sections named "Month 1 (continued 2)" and so on, each written by
// its own call, so no write passes the note write limit. Sections are appended in the order a generation produces
// them; "Generate new" for a style starts its note over rather than rewriting sections in place.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { RETROSPECTIVE_STYLES } from "dashboard/quarter-retrospective/retrospective-slides";
import { guideHeadingRanges, guideSectionRange } from "plan-wizard/vision-guide-markdown";
import { checkedAppResult, MAXIMUM_GUIDE_SECTION_CHARACTERS, replaceGuideSection, resolvedNoteHandle } from "plan-wizard/vision-guide-notes";
import { logIfEnabled } from "util/log";

export const RETROSPECTIVE_DATA_VERSION = 1;
export const RETROSPECTIVE_DATA_INTRODUCTION = "Written by the Dashboard. This note holds what a Quarter Retrospective "
  + "was generated from and what it shows. Each JSON block is read by the Dashboard; edit the retrospective from the "
  + "Dashboard rather than here.";
export const RETROSPECTIVE_SECTIONS = Object.freeze({ calendar: "Calendar", media: "Media", projects: "Projects",
  request: "Request", statistics: "Statistics", story: "Story", takeaways: "Takeaways" });
// Appending a section rewrites the section before it together with the new one, so each chunk keeps under half the
// write limit, less room for headings and fences.
export const RETROSPECTIVE_CHUNK_CHARACTERS = Math.floor(MAXIMUM_GUIDE_SECTION_CHARACTERS / 2) - 2000;
const CONTINUATION_PATTERN = /^(.+) \(continued (\d+)\)$/;
const DATA_NOTE_LOG_LABEL = "[retrospective-data-note]";
const STYLE_LABELS = Object.freeze({ data: "Data", roast: "Roast", spotify: "Spotify" });

// ----------------------------------------------------------------------------------------------
// @desc The display label of a retrospective style.
// @param {string} style - A RETROSPECTIVE_STYLES value.
// @returns {string} Such as "Roast".
export function retrospectiveStyleLabel(style) {
  return STYLE_LABELS[style] || style;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the data note for one domain, quarter, and style.
// @param {object} options - { domainName, quarter, style, year }.
// @returns {string} Such as "Work Q3 2026 Roast Retrospective Data".
export function retrospectiveDataNoteName({ domainName, quarter, style, year }) {
  return `${ domainName } Q${ quarter } ${ year } ${ retrospectiveStyleLabel(style) } Retrospective Data`;
}

// ----------------------------------------------------------------------------------------------
// @desc The section heading for one month of the quarter.
// @param {number} monthNumber - 1 through 3, the month's place in the quarter.
// @returns {string} Such as "Month 2".
export function retrospectiveMonthSection(monthNumber) {
  return `Month ${ monthNumber }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render a payload as one or more sections. The JSON is written compact, with backticks escaped so no text
//   inside it can close the fence, and cut into chunks that each fit one write.
// @param {string} heading - The section's heading text.
// @param {object} payload - JSON-serializable payload.
// @param {object} [options] - { chunkCharacters }: the most JSON characters one section holds.
// @returns {Array<object>} { body, heading } per section, the first under the heading itself and each later one under
//   "heading (continued N)", starting at 2.
export function retrospectiveSectionChunks(heading, payload, { chunkCharacters = RETROSPECTIVE_CHUNK_CHARACTERS } = {}) {
  const json = JSON.stringify(payload).replace(/`/g, "\\u0060");
  const chunks = [];
  for (let offset = 0; offset < json.length || !chunks.length; offset += chunkCharacters) {
    const chunkText = json.slice(offset, offset + chunkCharacters);
    const chunkHeading = chunks.length ? `${ heading } (continued ${ chunks.length + 1 })` : heading;
    chunks.push({ body: `\`\`\`json\n${ chunkText }\n\`\`\`\n`, heading: chunkHeading });
  }
  return chunks;
}

// ----------------------------------------------------------------------------------------------
// @desc Read every section's payload from data note markdown, joining continued sections to the one they continue.
//   A section whose JSON cannot be read is reported rather than treated as empty.
// @param {string} content - Data note markdown.
// @returns {object} An object with the following properties:
//   - {Map<string, object>} payloads - Payloads by section heading, such as "Story"
//   - {Array<string>} unreadableHeadings - Headings whose payload could not be read
export function retrospectiveSectionsFromContent(content) {
  const chunksByHeading = new Map();
  for (const heading of guideHeadingRanges(content)) {
    if (heading.level !== 2) continue;
    const continuation = heading.text.match(CONTINUATION_PATTERN);
    const baseHeading = continuation ? continuation[1] : heading.text;
    const chunkNumber = continuation ? Number(continuation[2]) : 1;
    if (!chunksByHeading.has(baseHeading)) chunksByHeading.set(baseHeading, []);
    chunksByHeading.get(baseHeading).push({ chunkNumber, text: _fenceText(content.slice(heading.bodyStart, heading.end)) });
  }
  const payloads = new Map();
  const unreadableHeadings = [];
  for (const [heading, chunks] of chunksByHeading) {
    try {
      const orderedChunks = [...chunks].sort((first, second) => first.chunkNumber - second.chunkNumber);
      if (orderedChunks.some((chunk, index) => chunk.chunkNumber !== index + 1 || chunk.text === null)) {
        throw new Error("Section is missing a part");
      }
      const json = orderedChunks.map(chunk => chunk.text).join("");
      payloads.set(heading, JSON.parse(json));
    } catch (error) {
      unreadableHeadings.push(heading);
      logIfEnabled(`${ DATA_NOTE_LOG_LABEL } unreadable section`, { heading, message: error?.message });
    }
  }
  return { payloads, unreadableHeadings };
}

// ----------------------------------------------------------------------------------------------
// @desc Find the retrospectives generated for a domain's quarter, one per style at most, newest first.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, quarter, year }.
// @returns {Promise<Array<object>>} { generatedAt, noteUuid, payloads, style } per style that has a data note whose
//   request can be read; generatedAt is an ISO timestamp.
export async function findRetrospectiveDataNotes(app, { domainName, quarter, year }) {
  const styles = Object.values(RETROSPECTIVE_STYLES);
  const lookups = styles.map(async style => {
    const found = checkedAppResult(await app.findNote({ name: retrospectiveDataNoteName({ domainName, quarter, style, year }) }));
    if (!found?.uuid) return null;
    const { payloads } = await readRetrospectiveDataNote(app, found.uuid);
    const request = payloads.get(RETROSPECTIVE_SECTIONS.request);
    if (!request) return null;
    return { generatedAt: request.generatedAt || "", noteUuid: found.uuid, payloads, style };
  });
  const foundNotes = await Promise.all(lookups);
  const presentNotes = foundNotes.filter(Boolean);
  const newestFirst = presentNotes.sort((first, second) => second.generatedAt.localeCompare(first.generatedAt));
  return newestFirst;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one data note's sections.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} noteUuid - The data note's UUID.
// @returns {Promise<object>} { content, payloads, unreadableHeadings }; empty when the note has no content.
export async function readRetrospectiveDataNote(app, noteUuid) {
  const content = checkedAppResult(await app.getNoteContent({ uuid: noteUuid }));
  if (typeof content !== "string") return { content: "", payloads: new Map(), unreadableHeadings: [] };
  return { content, ...retrospectiveSectionsFromContent(content) };
}

// ----------------------------------------------------------------------------------------------
// @desc Start a generation's data note: create it archived and tagged, or empty the style's existing note, and write
//   its request. The handle is a bare { uuid } literal, since a write through a bridge-produced handle can silently
//   report success.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} request - An object with the following properties:
//   - {string} domainName - Task domain display name
//   - {string|null} domainUuid - Task domain UUID
//   - {object} options - The choices made on the options screen
//   - {number} quarter - 1 through 4
//   - {string} style - A RETROSPECTIVE_STYLES value
//   - {number} year - Calendar year
// @returns {Promise<object>} { content, noteHandle }, content being the note's markdown as written.
export async function startRetrospectiveDataNote(app, request) {
  const name = retrospectiveDataNoteName(request);
  const found = checkedAppResult(await app.findNote({ name }));
  let uuid = found?.uuid || null;
  if (!uuid) {
    const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG], { archive: true }));
    uuid = typeof created === "string" ? created : created?.uuid;
    if (!uuid) throw new Error(`Could not create retrospective data note "${ name }"`);
    // createNote can hand back a local identifier the host stops resolving once the note reaches the server, and a
    // write through it reports success without writing. Looking the note up exchanges it for the current one.
    uuid = (await resolvedNoteHandle(app, uuid)).uuid;
  }
  const payload = { ...request, generatedAt: new Date().toISOString(), version: RETROSPECTIVE_DATA_VERSION };
  const [requestChunk] = retrospectiveSectionChunks(RETROSPECTIVE_SECTIONS.request, payload);
  const content = `${ RETROSPECTIVE_DATA_INTRODUCTION }\n\n## ${ requestChunk.heading }\n\n${ requestChunk.body }`;
  const noteHandle = { uuid };
  await replaceGuideSection(app, content, noteHandle, null);
  return { content, noteHandle };
}

// ----------------------------------------------------------------------------------------------
// @desc Write one section's payload. A section the note already holds in a single part is replaced in place when the
//   new payload also fits one part, which is how Takeaways is filled in after a story has played. Any other section
//   is appended after the note's last section, one part per write.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} content - Data note markdown as last read or written
//   - {string} heading - The section's heading, such as RETROSPECTIVE_SECTIONS.story
//   - {object} noteHandle - Bare { uuid } handle for the data note
//   - {object} payload - JSON-serializable payload
//   - {number} [chunkCharacters] - The most JSON characters one section holds
// @returns {Promise<string>} Data note markdown as it now stands.
// @throws When the section already exists in several parts, or would need several: start the note over instead.
export async function writeRetrospectiveDataSection(app, { chunkCharacters = RETROSPECTIVE_CHUNK_CHARACTERS, content, heading,
    noteHandle, payload }) {
  const chunks = retrospectiveSectionChunks(heading, payload, { chunkCharacters });
  const existing = guideSectionRange(content, heading);
  if (existing) {
    const continued = guideSectionRange(content, `${ heading } (continued 2)`);
    if (continued || chunks.length > 1) throw new Error(`Retrospective section "${ heading }" can only be replaced while it fits one write`);
    await replaceGuideSection(app, chunks[0].body, noteHandle, { heading: { level: existing.level, text: heading } });
    return `${ content.slice(0, existing.bodyStart) }${ chunks[0].body }${ content.slice(existing.end) }`;
  }
  let updatedContent = content;
  for (const chunk of chunks) updatedContent = await _appendSection(app, { body: chunk.body, content: updatedContent, heading: chunk.heading, noteHandle });
  return updatedContent;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Append a section after the note's last section by rewriting that section with the new one after it.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { body, content, heading, noteHandle }.
// @returns {Promise<string>} Data note markdown as it now stands.
async function _appendSection(app, { body, content, heading, noteHandle }) {
  const headings = guideHeadingRanges(content);
  const sectionHeadings = headings.filter(candidate => candidate.level === 2);
  const section = `## ${ heading }\n\n${ body }`;
  if (!sectionHeadings.length) {
    const wholeContent = `${ content.trimEnd() }\n\n${ section }`;
    await replaceGuideSection(app, wholeContent, noteHandle, null);
    return wholeContent;
  }
  const last = sectionHeadings[sectionHeadings.length - 1];
  const lastBody = content.slice(last.bodyStart, last.end);
  const replacement = `${ lastBody }${ lastBody.endsWith("\n") ? "" : "\n" }\n${ section }`;
  await replaceGuideSection(app, replacement, noteHandle, { heading: { level: last.level, text: last.text } });
  return `${ content.slice(0, last.bodyStart) }${ replacement }${ content.slice(last.end) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The text inside a section's JSON fence.
// @param {string} body - Section body.
// @returns {string|null} The fence's text, or null when the section holds none.
function _fenceText(body) {
  const fence = body.match(/```json\n([\s\S]*?)\n```/);
  return fence ? fence[1] : null;
}
