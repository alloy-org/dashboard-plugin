// Keep a note's `## YYYY-MM-DD` sections in date order while writing one day at a time. Archived notes that grow by
// the day, such as the completed task ledger and the calendar history journal, would outgrow the note write limit
// long before any single day does, so every write here touches one day's section, or the section just before it.
import { guideHeadingRanges, guideSectionRange } from "plan-wizard/vision-guide-markdown";
import { MAXIMUM_GUIDE_SECTION_CHARACTERS, replaceGuideSection } from "plan-wizard/vision-guide-notes";

export const DATE_HEADING_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ----------------------------------------------------------------------------------------------
// @desc The note's day headings, in the order the note holds them.
// @param {string} content - Note markdown.
// @returns {Array<object>} Heading ranges, as guideHeadingRanges reads them, whose level is 2 and whose text is a
//   date key.
export function datedNoteHeadings(content) {
  const headings = guideHeadingRanges(content);
  const dateHeadings = headings.filter(heading => heading.level === 2 && DATE_HEADING_PATTERN.test(heading.text));
  return dateHeadings;
}

// ----------------------------------------------------------------------------------------------
// @desc Write one day's section. A day the note holds is replaced in place. A new day is inserted after the latest
//   earlier day by rewriting only that day's section with the new one after it; a day earlier than every other needs
//   a whole-note write, and throws when the note has grown too large for one.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} body - The day's section body, without its heading
//   - {string} content - Note markdown as last read or written
//   - {string} dateKey - The day, as YYYY-MM-DD
//   - {object} noteHandle - Bare { uuid } handle for the note
//   - {string} noteLabel - What the note is, such as "Completed task ledger", for error messages
// @returns {Promise<string>} Note markdown as it now stands.
export async function writeDatedNoteSection(app, { body, content, dateKey, noteHandle, noteLabel }) {
  if (!DATE_HEADING_PATTERN.test(dateKey)) throw new Error(`"${ dateKey }" is not a date heading for ${ noteLabel }`);
  const existing = guideSectionRange(content, dateKey);
  if (existing) {
    await replaceGuideSection(app, body, noteHandle, { heading: { level: existing.level, text: dateKey } });
    return `${ content.slice(0, existing.bodyStart) }${ body }${ content.slice(existing.end) }`;
  }
  const dateHeadings = datedNoteHeadings(content);
  const earlierHeadings = dateHeadings.filter(heading => heading.text < dateKey);
  const section = `## ${ dateKey }\n\n${ body }`;
  if (earlierHeadings.length) {
    const previous = earlierHeadings[earlierHeadings.length - 1];
    const previousBody = content.slice(previous.bodyStart, previous.end);
    const replacement = `${ previousBody }${ previousBody.endsWith("\n") ? "" : "\n" }${ section }`;
    await replaceGuideSection(app, replacement, noteHandle, { heading: { level: previous.level, text: previous.text } });
    return `${ content.slice(0, previous.bodyStart) }${ replacement }${ content.slice(previous.end) }`;
  }
  const insertAt = dateHeadings.length ? dateHeadings[0].start : content.length;
  const leading = content.slice(0, insertAt);
  const separator = leading.endsWith("\n\n") || !leading ? "" : leading.endsWith("\n") ? "\n" : "\n\n";
  const trailing = content.slice(insertAt);
  const wholeContent = `${ leading }${ separator }${ section }${ trailing ? "\n" : "" }${ trailing }`;
  if (wholeContent.length > MAXIMUM_GUIDE_SECTION_CHARACTERS) {
    throw new Error(`${ noteLabel } is too large to insert ${ dateKey } before its earliest day`);
  }
  await replaceGuideSection(app, wholeContent, noteHandle, null);
  return wholeContent;
}
