import { GUIDE_SCHEMA_VERSION, copyJsonValue, requireRecord } from "plan-wizard/plan-models";

export const GUIDE_METADATA_HEADING = "Guide metadata";
export const GUIDE_ROOT_HEADING = "Top-line intent";

// ----------------------------------------------------------------------------------------------
// @desc Enumerate ATX headings outside fenced code, preserving offsets into the original markdown.
// @param {string} markdown - Complete note or subtree body.
// @returns {Array<object>} Heading ranges with text, level, start, bodyStart, and end.
export function guideHeadingRanges(markdown) {
  if (typeof markdown !== "string") throw new Error("Expected note markdown");
  const headings = [];
  let fence = null;
  for (const match of markdown.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0].replace(/\r?\n$/, "");
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.character && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) fence = null;
      continue;
    }
    if (fenceMatch) { fence = { character: fenceMatch[1][0], length: fenceMatch[1].length }; continue; }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*$/);
    if (!heading) continue;
    const text = heading[2].replace(/\s*<!--.*?-->\s*$/, "").replace(/\s+#+$/, "").trim();
    headings.push({ bodyStart: match.index + match[0].length, end: markdown.length, level: heading[1].length, start: match.index, text });
  }
  if (fence) throw new Error("Unclosed markdown fence in Vision Guide");
  for (let index = 0; index < headings.length; index += 1) {
    const nextSibling = headings.slice(index + 1).find(heading => heading.level <= headings[index].level);
    if (nextSibling) headings[index].end = nextSibling.start;
  }
  return headings;
}

// ----------------------------------------------------------------------------------------------
// @desc Locate a unique owned heading, rejecting duplicate names even if their levels differ.
// @param {string} markdown - Full markdown.
// @param {string} text - Exact unformatted heading text.
// @returns {object|null} Subtree range or null when missing.
// Ambiguous section targets must never silently overwrite the first match.
export function guideSectionRange(markdown, text) {
  const matches = guideHeadingRanges(markdown).filter(heading => heading.text === text);
  if (matches.length > 1) throw new Error(`Duplicate Vision Guide heading: ${ text }`);
  return matches[0] ?? null;
}

// ----------------------------------------------------------------------------------------------
// @desc Build every owned intent heading for all four quarters, so ordinary writes only touch leaves.
// @param {object} scope - Resolved domain/quarter/year identity.
// @returns {string} Initial archived guide markdown.
// Precreate children and reserve the two project categories for later milestones.
export function initialVisionGuideMarkdown(scope) {
  const metadata = { domainName: scope.domainName, domainUuid: scope.domainUuid, schemaVersion: GUIDE_SCHEMA_VERSION, year: scope.year };
  const root = intentRootMarkdown(scope.year);
  return `Maintained by the Dashboard plan wizard. Suggestions are separate from your chosen goals.\n\n# ${ GUIDE_METADATA_HEADING }\n\n`
    + `${ jsonPayloadMarkdown(metadata) }\n# ${ GUIDE_ROOT_HEADING }\n\n${ root }\n# Professional projects and goals\n\n`
    + "## Professional ideas & prospects\n\n```json\n[]\n```\n\n# Personal projects and goals\n\n## Personal ideas & prospects\n\n```json\n[]\n```\n";
}

// ----------------------------------------------------------------------------------------------
// @desc Render the complete fixed intent subtree used for initialization and missing-ancestor recovery.
// @returns {string} Both parents with all quarterly leaves.
// Keep future/current quarter writes independent within the same annual note.
export function intentRootMarkdown(year) {
  const suggestionLeaves = [];
  const goalLeaves = [];
  for (let quarter = 1; quarter <= 4; quarter += 1) {
    const scope = { quarter, year };
    for (const category of ["work", "personal"]) {
      const leaf = intentSectionDefinition(category, scope);
      suggestionLeaves.push(`### ${ leaf.text }\n\n${ jsonPayloadMarkdown(leaf.empty) }`);
    }
    const leaf = intentSectionDefinition("goals", scope);
    goalLeaves.push(`### ${ leaf.text }\n\n${ jsonPayloadMarkdown(leaf.empty) }`);
  }
  return `## Intents prophesized\n\n${ suggestionLeaves.join("\n") }\n## Intents picked\n\n${ goalLeaves.join("\n") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe a fixed writable leaf and its ancestor chain.
// @param {string} kind - goals, work, or personal.
// @param {object} scope - Explicit quarter and year.
// @returns {object} { empty, parent, text }.
// Centralize section names instead of deriving them from user text.
export function intentSectionDefinition(kind, scope) {
  const label = `Q${ scope.quarter } ${ scope.year }`;
  if (kind === "goals") return { empty: { goals: [] }, parent: "Intents picked", text: `${ label } Picked intents` };
  if (!["work", "personal"].includes(kind)) throw new Error("Unknown intent section kind");
  const categoryLabel = kind === "work" ? "Professional" : "Personal";
  return { empty: { generatedAt: null, possibilities: [] }, parent: "Intents prophesized", text: `${ label } ${ categoryLabel } possibilities` };
}

// ----------------------------------------------------------------------------------------------
// @desc Serialize a detached JSON payload in a code fence, preserving markdown-like strings literally.
// @param {object} payload - Strict JSON object.
// @returns {string} Fenced payload with a trailing newline.
// No tables, embedded executable code, or lossy text escaping.
export function jsonPayloadMarkdown(payload) {
  return `\`\`\`json\n${ JSON.stringify(copyJsonValue(payload), null, 2) }\n\`\`\`\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read exactly one JSON fence from a leaf, preserving prose outside it for subsequent writes.
// @param {string} body - Body of an owned leaf section.
// @returns {object} { end, payload, start } identifying the JSON fence and its decoded object.
// A corrupt or missing payload is an error, never an empty collection.
export function parseJsonPayload(body) {
  const matches = [];
  let opening = null;
  for (const line of body.matchAll(/[^\n]*(?:\n|$)/g)) {
    const fence = line[0].match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/);
    if (!fence) continue;
    if (!opening) {
      opening = { bodyStart: line.index + line[0].length, delimiter: fence[1], language: fence[2].trim(), start: line.index };
    } else if (fence[1][0] === opening.delimiter[0] && fence[1].length >= opening.delimiter.length && !fence[2].trim()) {
      if (opening.language === "json") matches.push({ end: line.index + line[0].length, start: opening.start,
        text: body.slice(opening.bodyStart, line.index) });
      opening = null;
    }
  }
  if (opening) throw new Error("Unclosed markdown fence in Vision Guide section");
  if (matches.length !== 1) throw new Error("Expected exactly one JSON payload in Vision Guide section");
  const match = matches[0];
  const payload = JSON.parse(match.text);
  requireRecord(payload);
  return { end: match.end, payload, start: match.start };
}

// ----------------------------------------------------------------------------------------------
// @desc Replace only the owned JSON fence, leaving user prose and footnote definitions intact.
// @returns {string} Updated leaf body.
// Note prose is not a generated projection to discard on each save.
export function replaceJsonPayload(body, payload) {
  const range = parseJsonPayload(body);
  return `${ body.slice(0, range.start) }${ jsonPayloadMarkdown(payload) }${ body.slice(range.end) }`;
}
