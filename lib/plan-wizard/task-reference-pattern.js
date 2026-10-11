// Recognize the task identities a project's reasons cite, such as "the memo [e010af78-…]". Free of dependencies so
// discovery in the host plugin and the projects page can share one definition of a citation.

export const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// One citation: a bracketed or parenthesized list of one or more identities, or a bare identity.
const TASK_REFERENCE_SOURCE = `[\\[(]\\s*${ UUID_SOURCE }(?:\\s*[,;]\\s*${ UUID_SOURCE })*\\s*[\\])]|${ UUID_SOURCE }`;

// ----------------------------------------------------------------------------------------------
// @desc A fresh global pattern matching every citation, since a shared global pattern carries lastIndex between uses.
// @returns {RegExp} Pattern matching one citation per match.
export function taskReferencePattern() {
  return new RegExp(TASK_REFERENCE_SOURCE, "gi");
}

// ----------------------------------------------------------------------------------------------
// @desc Locate every task citation in a reason, so a length limit can leave citations out of what it counts and never
//   cut through one.
// @param {string} substantiation - A reason as discovery wrote it.
// @returns {Array<object>} [{ end, start }] character ranges in order, end exclusive.
export function taskReferenceRanges(substantiation) {
  const referenceMatches = [...String(substantiation ?? "").matchAll(taskReferencePattern())];
  const referenceRanges = referenceMatches.map(match => ({ end: match.index + match[0].length, start: match.index }));
  return referenceRanges;
}
