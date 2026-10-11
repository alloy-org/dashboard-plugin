// Find the task identities discovery cites inside a project's reasons, such as "writing the memo [e010af78-…]", so
// the projects page can draw each one as the task it names rather than as a raw UUID. Reasons stay stored with their
// identities, which the ranking prompts read; only what a person sees is rewritten here.

import { plainTaskText } from "plan-wizard/stack-rank/prospective-task-details";
import { taskReferencePattern, UUID_SOURCE } from "plan-wizard/task-reference-pattern";
import { stripMarkdown } from "util/utility";

const UUID_PATTERN = new RegExp(UUID_SOURCE, "gi");
// How many characters of a task's text its chip shows before the rest is left to the hover.
export const TASK_CHIP_CHARACTER_COUNT = 25;

// ----------------------------------------------------------------------------------------------
// @desc Close the gaps a removed citation leaves: doubled spaces, a space before punctuation, and empty brackets.
// @param {string} text - Reason text with citations already removed.
// @returns {string} Reason text that reads as though the citations were never there.
function tidiedReasonText(text) {
  const withoutEmptyBrackets = text.replace(/[\[(]\s*[\])]/g, "");
  const withoutSpaceBeforePunctuation = withoutEmptyBrackets.replace(/\s+([.,;:!?])/g, "$1");
  const collapsedText = withoutSpaceBeforePunctuation.replace(/\s{2,}/g, " ");
  return collapsedText.trim();
}

// ----------------------------------------------------------------------------------------------
// @desc List the distinct task identities cited across a project's reasons, lowercased, in the order they appear.
// @param {Array<string>} substantiations - The project's reasons.
// @returns {Array<string>} Distinct cited task UUIDs.
export function citedTaskUuidsFromSubstantiations(substantiations = []) {
  const joinedReasons = substantiations.filter(Boolean).join(" ");
  const matchedUuids = joinedReasons.match(UUID_PATTERN) ?? [];
  const lowercasedUuids = matchedUuids.map(uuid => uuid.toLowerCase());
  return [...new Set(lowercasedUuids)];
}

// ----------------------------------------------------------------------------------------------
// @desc Remove every task citation from a reason, for places that show it as plain text with no task to draw.
// @param {string} substantiation - A reason as discovery wrote it.
// @returns {string} The reason with its citations removed and its spacing and punctuation repaired.
export function substantiationWithoutTaskReferences(substantiation) {
  const withoutReferences = String(substantiation ?? "").replace(taskReferencePattern(), "");
  return tidiedReasonText(withoutReferences);
}

// ----------------------------------------------------------------------------------------------
// @desc Split a reason into the text around its citations and the tasks they cite, so each task can be drawn in
//   place. A citation whose task is not kept — deleted, or no longer readable — is removed as though never written.
// @param {string} substantiation - A reason as discovery wrote it.
// @param {Function} [isKeptTaskUuid] - Receives a lowercased task UUID and returns whether to keep its citation;
//   every citation is kept when omitted.
// @returns {Array<object>} Segments in reading order, each { kind: "text", text } or { kind: "task", taskUuid }.
export function substantiationSegments(substantiation, isKeptTaskUuid = () => true) {
  const reasonText = String(substantiation ?? "");
  const keptReferenceText = reasonText.replace(taskReferencePattern(), referenceText => {
    const keptUuids = (referenceText.match(UUID_PATTERN) ?? []).filter(uuid => isKeptTaskUuid(uuid.toLowerCase()));
    return keptUuids.length ? `[${ keptUuids.join(", ") }]` : "";
  });
  const tidiedText = tidiedReasonText(keptReferenceText);
  const segments = [];
  let textStart = 0;
  for (const match of tidiedText.matchAll(taskReferencePattern())) {
    const precedingText = tidiedText.slice(textStart, match.index);
    if (precedingText) segments.push({ kind: "text", text: precedingText });
    const citedUuids = match[0].match(UUID_PATTERN);
    citedUuids.forEach((uuid, index) => {
      if (index > 0) segments.push({ kind: "text", text: " " });
      segments.push({ kind: "task", taskUuid: uuid.toLowerCase() });
    });
    textStart = match.index + match[0].length;
  }
  const trailingText = tidiedText.slice(textStart);
  if (trailingText) segments.push({ kind: "text", text: trailingText });
  return segments;
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a task's markdown content to the words a person reads.
// @param {string} content - Task content as the task API returns it.
// @returns {string} Plain task text.
export function readableTaskText(content) {
  return stripMarkdown(plainTaskText(content));
}

// ----------------------------------------------------------------------------------------------
// @desc Shorten a task's text to the whole words that fit its chip's character budget, marking that more follows. A
//   first word longer than the budget is cut mid-word rather than leaving the chip empty.
// @param {string} taskText - Plain task text.
// @param {number} [characterCount=TASK_CHIP_CHARACTER_COUNT] - Characters to keep, not counting the ellipsis.
// @returns {string} The leading text, with an ellipsis when any was left out.
export function taskChipLabel(taskText, characterCount = TASK_CHIP_CHARACTER_COUNT) {
  const words = String(taskText ?? "").split(/\s+/).filter(Boolean);
  const fullText = words.join(" ");
  if (fullText.length <= characterCount) return fullText;
  let leadingText = "";
  for (const word of words) {
    const extendedText = leadingText ? `${ leadingText } ${ word }` : word;
    if (extendedText.length > characterCount) break;
    leadingText = extendedText;
  }
  if (!leadingText) leadingText = fullText.slice(0, characterCount);
  return `${ leadingText.replace(/[.,;:!?-]+$/, "") }…`;
}
