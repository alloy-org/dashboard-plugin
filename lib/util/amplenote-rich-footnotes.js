// Rich Footnotes carry substantive specifications in Bill's notes: a `[label][^1]` reference in the prose and a
// `[^1]:` definition, often far below it, holding multiline prose and fenced code. Evidence collection and any
// other host service that reads a note needs those bodies resolved before it interprets the note, so this parser
// stays a plain host-compatible utility. `lib/util/amplenote-markdown-render.js` handles browser display and
// imports tooltip/style code; it must not be imported here or by anything the host plugin reaches.

const DEFINITION_PATTERN = /^\[\^([^\]\n]+)\]:[ \t]*(.*)$/;
const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/;
const REFERENCE_PATTERN = /\[\^([^\]\n]+)\]/g;
const MAX_RESOLUTION_DEPTH = 8;

// ----------------------------------------------------------------------------------------------
// @desc Strip the common indentation Amplenote writes under a footnote definition without flattening the
//   relative indentation that makes fenced code readable, and drop the backslash-only lines that represent
//   Amplenote blank paragraphs.
// @param {Array<string>} lines - Continuation lines belonging to one definition, in document order.
// @returns {string} Dedented body, trailing blank lines removed.
function dedentedBody(lines) {
  const contentLines = lines.filter(line => line.trim() && line.trim() !== "\\");
  const indents = contentLines.map(line => line.length - line.trimStart().length);
  const commonIndent = indents.length ? Math.min(...indents) : 0;
  const dedented = lines.map(line => (line.trim() === "\\" ? "" : line.slice(commonIndent)));
  while (dedented.length && !dedented[dedented.length - 1].trim()) dedented.pop();
  while (dedented.length && !dedented[0].trim()) dedented.shift();
  return dedented.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a line ends the definition that is currently being collected. A definition continues
//   through blank lines and indented content, and through everything inside a fence, so a `[^2]:` line or an
//   apparent heading inside a code block does not truncate the body.
// @param {string} line - The candidate line.
// @param {boolean} isInsideFence - Whether the collector is currently inside a fenced block.
// @returns {boolean} True when the line belongs to the surrounding document rather than the definition.
function endsDefinition(line, isInsideFence) {
  if (isInsideFence || !line.trim()) return false;
  const isIndented = line.startsWith("  ") || line.startsWith("\t");
  return !isIndented;
}

// ----------------------------------------------------------------------------------------------
// @desc Track fence state across a line so structure detection can ignore fenced content. Fences close only on
//   a marker of the same character that is at least as long as the one that opened them.
// @param {string} line - The line being scanned.
// @param {object|null} openFence - Current fence state, or null when outside a fence.
// @returns {object|null} The updated fence state.
function fenceStateFromLine(line, openFence) {
  const match = line.match(FENCE_PATTERN);
  if (!match) return openFence;
  const [, , marker, trailing] = match;
  if (!openFence) return { character: marker[0], length: marker.length };
  const isClosing = marker[0] === openFence.character && marker.length >= openFence.length && !trailing.trim();
  return isClosing ? null : openFence;
}

// ----------------------------------------------------------------------------------------------
// @desc Split a note into the markdown that remains once footnote definitions are removed, and the definitions
//   themselves. Definitions keep their identifier, their description-link label (the `[label]()` on the first
//   line, which is commonly empty and does not mean the footnote is empty), and their full multiline body.
// @param {string} markdown - Raw note markdown.
// @returns {object} { body, definitions } where definitions is a Map of identifier to
//   { body, identifier, label, references } and `references` lists identifiers cited inside that body.
export function parsedRichFootnotes(markdown) {
  const definitions = new Map();
  const bodyLines = [];
  const lines = typeof markdown === "string" ? markdown.split("\n") : [];
  let openFence = null;
  let current = null;
  for (const line of lines) {
    if (current) {
      openFence = fenceStateFromLine(line, openFence);
      if (!endsDefinition(line, Boolean(openFence))) {
        current.lines.push(line); continue;
      }
      _storeDefinition(definitions, current);
      current = null;
      openFence = null;
    }
    const definitionMatch = openFence ? null : line.match(DEFINITION_PATTERN);
    openFence = fenceStateFromLine(line, openFence);
    if (definitionMatch) {
      current = { firstLine: definitionMatch[2], identifier: definitionMatch[1], lines: [] };
      openFence = null;
      continue;
    }
    bodyLines.push(line);
  }
  if (current) _storeDefinition(definitions, current);
  return { body: bodyLines.join("\n"), definitions };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve every footnote referenced from a passage, following nested references with cycle protection so
//   a definition that cites another definition contributes its content too. Missing identifiers are reported
//   rather than guessed at, letting a caller decide whether the evidence is usable.
// @param {string} passage - Prose to resolve references from, such as one section of a note.
// @param {Map<string, object>} definitions - Definitions from parsedRichFootnotes.
// @returns {object} { missingIdentifiers, resolved } where resolved holds definitions in first-cited order.
export function resolvedFootnotesForPassage(passage, definitions) {
  const missingIdentifiers = [];
  const resolved = [];
  const seenIdentifiers = new Set();
  let pending = referencedFootnoteIdentifiers(passage).map(identifier => ({ depth: 0, identifier }));
  while (pending.length) {
    const { depth, identifier } = pending.shift();
    if (seenIdentifiers.has(identifier)) continue;
    seenIdentifiers.add(identifier);
    const definition = definitions.get(identifier);
    if (!definition) { missingIdentifiers.push(identifier); continue; }
    resolved.push(definition);
    if (depth >= MAX_RESOLUTION_DEPTH) continue;
    const nested = definition.references.map(nestedIdentifier => ({ depth: depth + 1, identifier: nestedIdentifier }));
    pending = pending.concat(nested);
  }
  return { missingIdentifiers, resolved };
}

// ----------------------------------------------------------------------------------------------
// @desc List the footnote identifiers cited in a passage, in the order they appear, ignoring citations that sit
//   inside a code fence because a marker written in an example is not a document reference.
// @param {string} passage - Markdown prose.
// @returns {Array<string>} Distinct identifiers, in first-cited order.
export function referencedFootnoteIdentifiers(passage) {
  const identifiers = [];
  const lines = typeof passage === "string" ? passage.split("\n") : [];
  let openFence = null;
  for (const line of lines) {
    const wasInsideFence = Boolean(openFence);
    openFence = fenceStateFromLine(line, openFence);
    if (wasInsideFence || openFence) continue;
    if (DEFINITION_PATTERN.test(line)) continue;
    for (const match of line.matchAll(REFERENCE_PATTERN)) {
      if (!identifiers.includes(match[1])) identifiers.push(match[1]);
    }
  }
  return identifiers;
}

// ----------------------------------------------------------------------------------------------
// @desc Render a passage together with the footnote bodies it depends on, as the compact evidence text an
//   inference prompt can consume. Missing definitions are named instead of silently dropped.
// @param {string} passage - Markdown prose to resolve.
// @param {Map<string, object>} definitions - Definitions from parsedRichFootnotes.
// @returns {string} The passage, followed by one labeled block per resolved definition.
export function passageWithResolvedFootnotes(passage, definitions) {
  const { missingIdentifiers, resolved } = resolvedFootnotesForPassage(passage, definitions);
  const resolvedBlocks = resolved.map(definition => {
    const heading = definition.label ? `[^${ definition.identifier }] ${ definition.label }` : `[^${ definition.identifier }]`;
    return definition.body ? `${ heading }\n${ definition.body }` : heading;
  });
  const missingBlocks = missingIdentifiers.map(identifier => `[^${ identifier }] (definition not found in note)`);
  const allBlocks = [String(passage ?? "").trim(), ...resolvedBlocks, ...missingBlocks];
  return allBlocks.filter(block => block).join("\n\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Finish one collected definition and record it, separating the description link's label from the body.
// @param {Map<string, object>} definitions - Accumulating definitions; a repeated identifier keeps the first.
// @param {object} current - { firstLine, identifier, lines } gathered by parsedRichFootnotes.
function _storeDefinition(definitions, current) {
  const labelMatch = current.firstLine.match(/^\[([^\]]*)\]\([^)]*\)\s*$/);
  const leadingContent = labelMatch ? [] : [current.firstLine];
  const body = dedentedBody(leadingContent.concat(current.lines));
  const label = labelMatch ? labelMatch[1] : "";
  const references = referencedFootnoteIdentifiers(body).filter(identifier => identifier !== current.identifier);
  if (!definitions.has(current.identifier)) definitions.set(current.identifier, { body, identifier: current.identifier, label, references });
}
