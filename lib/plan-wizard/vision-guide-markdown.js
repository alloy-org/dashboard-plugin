import { GUIDE_SCHEMA_VERSION, copyJsonValue, isDeclinedActionProspect, requireRecord } from "plan-wizard/plan-models";
import { storedLeafPayload } from "plan-wizard/prospect-leaf-storage";
import { monthKeyFromDateInput, monthLabelFromMonthKey } from "util/date-utility";

export const GUIDE_METADATA_HEADING = "Guide metadata";
// Written above the first heading during bootstrap, so a note holding only this line is a partial bootstrap.
export const GUIDE_PREAMBLE_TEXT = "Maintained by the Dashboard plan wizard. Suggestions are separate from your chosen goals.";
export const GUIDE_ROOT_HEADING = "Top-line intent";
// The two project roots, each a level-one sibling of the intent root rather than a child of it.
export const PROSPECT_CATEGORY_LABELS = [{ categoryLabel: "Professional", kind: "workProspects" },
  { categoryLabel: "Personal", kind: "personalProspects" }];
export const PROSPECT_TASK_BUCKET_LABELS = ["Awaiting approval", "Scheduled", "Completed", "Rejected"];
// A bucket says which project currently sits in it, nothing more. It used to hold the project's whole record, a
// second full copy of something the category leaf already stored: 65,982 characters of one note for 19 projects.
const EMPTY_PROSPECT_BUCKET = { prospectTasks: [], prospectUuids: [] };

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
// Precreate children, including both project categories, so ordinary prospect writes only replace a leaf payload.
export function initialVisionGuideMarkdown(scope) {
  const metadata = { domainName: scope.domainName, domainUuid: scope.domainUuid, schemaVersion: GUIDE_SCHEMA_VERSION, year: scope.year };
  const root = intentRootMarkdown(scope.year);
  return `${ GUIDE_PREAMBLE_TEXT }\n\n# ${ GUIDE_METADATA_HEADING }\n\n`
    + `${ jsonPayloadMarkdown(metadata) }\n# ${ GUIDE_ROOT_HEADING }\n\n${ root }\n${ prospectRootMarkdown(scope.year) }`;
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
// @desc Name a category's index leaf for one quarter, which is where that quarter's projects in that category are
//   stored.
// @param {string} categoryLabel - Professional or Personal.
// @param {object} scope - Explicit quarter and year.
// @returns {string} Heading text.
export function prospectIndexHeadingText(categoryLabel, scope) {
  return `Q${ scope.quarter } ${ scope.year } ${ categoryLabel } ideas & prospects`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render both project category subtrees, each precreating one index leaf per quarter of the year.
// @param {number} year - Planning year the guide covers.
// @returns {string} Markdown for the two project roots.
// The index leaf was scoped to a category rather than to a quarter, on the reasoning that a project outlives the
//   quarter that raised it. It does, and each record still names its own quarterKey — but the leaf is rewritten
//   whole on every save, so category scope made the cost of saving one project the size of every project that
//   category had ever held. One such leaf reached 188,890 characters against a 100,000-character write limit.
//   Scoping the leaf to a quarter bounds that cost to a quarter's projects; a project carried forward is written
//   into the new quarter's leaf under the identity it already had.
export function prospectRootMarkdown(year) {
  const sections = PROSPECT_CATEGORY_LABELS.map(({ categoryLabel, kind }) => {
    const quarterLeaves = [];
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const definition = intentSectionDefinition(kind, { quarter, year });
      quarterLeaves.push(`## ${ definition.text }\n\n${ jsonPayloadMarkdown(storedLeafPayload(kind, definition.empty)) }`);
    }
    return `# ${ categoryLabel } projects and goals\n\n${ quarterLeaves.join("\n") }`;
  });
  return sections.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Name the section a new project/month tree is appended to, which is the last month tree the category
//   already holds, or nothing when this is the category's first project.
// @param {Array<string>} indexHeadingTexts - The category's quarterly ideas & prospects headings, which hold the
//   stored records and are therefore never used as the anchor.
// @param {string} parentBody - Body of the Professional or Personal projects root.
// @returns {object|null} Heading range of the anchor within parentBody, or null when no month tree exists yet.
// A section replacement rewrites everything it covers, so placing a project by rewriting the category root costs
//   every project that category holds; a category that had grown to 266,000 characters could no longer accept one.
//   Appending to the last month tree instead costs that one tree. The API offers no insert-before-a-heading
//   primitive: writing into a sibling's section puts the new content under that sibling's heading rather than
//   ahead of it, so trees are ordered by when they were placed rather than alphabetically.
// Every quarter's index leaf is excluded, not only the one being written: they are all level-two siblings of the
//   month trees, and anchoring to one would nest a month tree's markdown inside a leaf whose fence is rewritten
//   by ordinary saves.
export function prospectMonthAnchorHeading(indexHeadingTexts, parentBody) {
  const excludedHeadings = new Set(indexHeadingTexts);
  const headings = guideHeadingRanges(parentBody);
  const monthHeadings = headings.filter(heading => heading.level === 2 && !excludedHeadings.has(heading.text));
  return monthHeadings.length ? monthHeadings[monthHeadings.length - 1] : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Append a project/month tree to the body of the section it is being placed after.
// @param {string} anchorBody - Body of the anchor section, which the caller replaces with this result.
// @param {string} subtree - Complete markdown for the tree being added.
// @returns {string} Updated anchor body.
export function appendProspectMonthSubtree(anchorBody, subtree) {
  return `${ anchorBody.trimEnd() }\n\n${ subtree }\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the month a project's task tree occupies: its first focus month, or the quarter's first month
//   when none has been chosen yet.
// @param {object} prospect - Stored ActionProspect.
// @param {object} scope - Resolved planning scope.
// @returns {string} YYYY-MM label.
export function prospectFocusMonthLabel(prospect, scope) {
  if (prospect.focusMonths?.length) return prospect.focusMonths[0];
  return monthKeyFromDateInput(new Date(scope.year, (scope.quarter - 1) * 3, 1));
}

// ----------------------------------------------------------------------------------------------
// @desc Name the level-two heading that holds one project's task buckets for a month.
// @param {string} monthLabel - YYYY-MM focus month.
// @param {string} summary - Project title.
// @param {string} prospectUuid - Stable ActionProspect identity.
// @returns {string} Heading text.
export function prospectMonthHeadingText(monthLabel, summary, prospectUuid) {
  return `${ monthLabelFromMonthKey(monthLabel) } ${ summary } ${ prospectUuid }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Render a new project/month tree with all four task buckets, so a placement write never creates a lone
//   heading without its siblings.
// @param {string} monthLabel - YYYY-MM focus month.
// @param {string|null} occupiedBucketLabel - Bucket that holds this ActionProspect, or null when none should.
// @param {object} occupiedPayload - JSON stored under the occupied bucket, naming the project's identity only.
// @param {string} prospectUuid - Stable ActionProspect identity.
// @param {string} summary - Project title.
// @returns {string} Markdown for the level-two tree.
export function prospectMonthSubtreeMarkdown(monthLabel, occupiedBucketLabel, occupiedPayload, prospectUuid, summary) {
  const headingText = prospectMonthHeadingText(monthLabel, summary, prospectUuid);
  const buckets = PROSPECT_TASK_BUCKET_LABELS.map(bucketLabel => {
    const payload = bucketLabel === occupiedBucketLabel ? occupiedPayload : EMPTY_PROSPECT_BUCKET;
    return `### ${ prospectTaskBucketHeadingText(bucketLabel, prospectUuid) }\n\n${ jsonPayloadMarkdown(payload) }`;
  });
  return `## ${ headingText }\n\n${ buckets.join("\n") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Choose which task-bucket heading holds this ActionProspect: Awaiting approval until a focus level is
//   chosen, Rejected after Not now or Remove, and none once Focus or Keep warm has been selected.
// @param {object} prospect - Stored ActionProspect.
// @returns {string|null} Bucket label, or null when the record belongs only in the category ideas leaf.
export function prospectPlacementBucketLabel(prospect) {
  if (isDeclinedActionProspect(prospect)) return "Rejected";
  if (!prospect.priorityEm) return "Awaiting approval";
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Name a task-bucket heading, matching the brainstorm's "[prospect uuid] Rejected" form.
// @param {string} bucketLabel - Awaiting approval, Scheduled, Completed, or Rejected.
// @param {string} prospectUuid - Parent ActionProspect identity.
// @returns {string} Heading text.
export function prospectTaskBucketHeadingText(bucketLabel, prospectUuid) {
  return `${ prospectUuid } ${ bucketLabel }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe a fixed writable leaf, its ancestor chain, and the heading depths that chain must occupy.
// @param {string} kind - goals, work, personal, workProspects, or personalProspects.
// @param {object} scope - Explicit quarter and year, which every leaf including the prospect leaves is scoped by.
// @returns {object} { empty, level, parent, parentLevel, root, text }.
// Centralize section names and depths instead of deriving them from user text or asserting them at the call site.
export function intentSectionDefinition(kind, scope) {
  const prospectCategory = PROSPECT_CATEGORY_LABELS.find(category => category.kind === kind);
  if (prospectCategory) {
    const { categoryLabel } = prospectCategory;
    return { empty: { prospects: [], prospectTasks: [] }, level: 2, parent: `${ categoryLabel } projects and goals`,
      parentLevel: 1, root: null, text: `${ prospectIndexHeadingText(categoryLabel, scope) }` };
  }
  const label = `Q${ scope.quarter } ${ scope.year }`;
  const intentLeaf = { level: 3, parentLevel: 2, root: GUIDE_ROOT_HEADING };
  if (kind === "goals") {
    return { ...intentLeaf, empty: { dailySufficiency: null, goals: [], quarterName: null }, parent: "Intents picked",
      text: `${ label } Picked intents` };
  }
  if (!["work", "personal"].includes(kind)) throw new Error("Unknown intent section kind");
  const categoryLabel = kind === "work" ? "Professional" : "Personal";
  return { ...intentLeaf, empty: { generatedAt: null, possibilities: [] }, parent: "Intents prophesized",
    text: `${ label } ${ categoryLabel } possibilities` };
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
