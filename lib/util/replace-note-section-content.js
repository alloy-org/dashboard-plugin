// [claude-4.6-opus-high-thinking-authored file]
// Prompt summary: "extract section-aware note body replacement into a shared dev-environment utility"

// ----------------------------------------------------------------------------------------------
// @desc Replace the body of a markdown section identified by heading text, or the entire body if no section specified.
// @param {string} noteBody - Full note content.
// @param {string} newContent - Replacement content for the section body (or entire note).
// @param {object|null} sectionOptions - Optional `{ section: { heading: { text, level? } } }`.
// @returns {string} Updated note body.
// [Claude claude-4.6-opus-high-thinking] Task: shared section-replacement utility for mock app and test note objects
// Prompt: "extract section-aware replaceContent into a dev-environment utility consumed by tests and mock apps"
export function replaceSectionContent(noteBody, newContent, sectionOptions) {
  if (!sectionOptions?.section?.heading?.text) return newContent;

  const sectionHeadingText = sectionOptions.section.heading.text;
  const indexes = Array.from(noteBody.matchAll(/^#+\s*([^#\n\r]+)/gm));
  const sectionMatch = indexes.find(m => m[1].trim() === sectionHeadingText.trim());
  if (!sectionMatch) {
    throw new Error(`Could not find section "${ sectionHeadingText }" in note body. This might be expected`);
  }

  const level = sectionMatch[0].match(/^#+/)[0].length;
  const nextMatch = indexes.find(m => m.index > sectionMatch.index && m[0].match(/^#+/)[0].length <= level);
  const endIndex = nextMatch ? nextMatch.index : noteBody.length;
  const startIndex = sectionMatch.index + sectionMatch[0].length + 1;
  return `${ noteBody.slice(0, startIndex) }${ newContent.trim() }\n${ noteBody.slice(endIndex) }`;
}
