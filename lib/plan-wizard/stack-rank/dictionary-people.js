// The People section of the user terms dictionary: one bullet per person the user's tasks name, saying who that person
// is to the account owner and which kinds of work they come up in. A person is often named more than one way ("Lucian",
// "Lucian Ruscanu"), so a bullet lists the other names it answers to after its bold name, and the dictionary keys the
// person by every name joined with TERM_ALIAS_SEPARATOR, which the term matcher reads as alternatives:
//
//   - **Lucian Ruscanu** (also Lucian): Frequent Amplenote collaborator on video production and onboarding. [builder]
//
// The account owner is the bullet named OWNER_TERM, whose other names are the owner's own. The host's
// `app.getCurrentPerson` names the owner where it exists; the bullet is how a user on an older host says who they are.
import { BUILDER_MARKER, isBuilderMarkedText, textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";
import { unescapedMarkdownText } from "util/amplenote-markdown-escapes";

export const OWNER_TERM = "Me";
export const PEOPLE_HEADING = "People";
// Joins a person's names in the key a dictionary object holds them under; the term matcher splits on it.
export const TERM_ALIAS_SEPARATOR = " / ";
// The most other names one person keeps, so a bullet stays one readable line.
const MAXIMUM_ALIASES = 4;
// A bold name, optionally followed by "(also Other, Names)", a colon, and the definition. Amplenote saves parentheses
// escaped, so the line is unescaped before it is matched.
const PERSON_BULLET_PATTERN = /^[-*]\s+\*\*([^*]+?)\*\*\s*(?:\((?:also\s+)?([^)]*)\))?\s*:\s*(.+)$/i;

// ----------------------------------------------------------------------------------------------
// @desc The key a dictionary object holds an entry under: its term alone, or for a person every name it answers to.
//   The owner's bullet is keyed by the owner's own names only, since "Me" would match every task that says "me".
// @param {object} entry - { aliases, isPerson, term }.
// @returns {string} The key, names joined by TERM_ALIAS_SEPARATOR.
export function dictionaryKeyFromEntry({ aliases = [], isPerson = false, term }) {
  if (!isPerson) return term;
  const names = isOwnerTerm(term) ? aliases : [term, ...aliases];
  return names.length ? names.join(TERM_ALIAS_SEPARATOR) : term;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a term names the account owner's bullet.
// @param {string} term - A dictionary term.
// @returns {boolean} True for OWNER_TERM, ignoring case.
export function isOwnerTerm(term) {
  return String(term || "").trim().toLowerCase() === OWNER_TERM.toLowerCase();
}

// ----------------------------------------------------------------------------------------------
// @desc Combine a person's names: those already listed first, then new ones, never repeating the person's own term or a
//   name already present, compared without case, and keeping at most MAXIMUM_ALIASES.
// @param {string} term - The person's term.
// @param {Array<string>} existingAliases - Names the bullet lists now.
// @param {Array<string>} incomingAliases - Names a pass proposes.
// @returns {Array<string>} The combined names.
export function mergedAliases(term, existingAliases = [], incomingAliases = []) {
  const seenKeys = new Set([String(term).trim().toLowerCase()]);
  const aliases = [];
  for (const alias of [...existingAliases, ...incomingAliases]) {
    const trimmed = String(alias || "").replace(/^@+/, "").trim();
    const aliasKey = trimmed.toLowerCase();
    if (!trimmed || trimmed.includes(TERM_ALIAS_SEPARATOR.trim()) || seenKeys.has(aliasKey)) continue;
    seenKeys.add(aliasKey);
    aliases.push(trimmed);
  }
  const keptAliases = aliases.slice(0, MAXIMUM_ALIASES);
  return keptAliases;
}

// ----------------------------------------------------------------------------------------------
// @desc The account owner's names as the dictionary records them: the other names on the OWNER_TERM bullet.
// @param {Array<object>} entries - From dictionaryEntriesFromContent.
// @returns {Array<string>} The owner's names, empty when the user has not written the bullet.
export function ownerNamesFromEntries(entries) {
  const ownerEntry = (entries || []).find(entry => entry.isPerson && isOwnerTerm(entry.term));
  return ownerEntry ? ownerEntry.aliases : [];
}

// ----------------------------------------------------------------------------------------------
// @desc Render one People bullet, marking it as plugin-owned.
// @param {object} entry - { aliases, definition, term }.
// @returns {string} A markdown bullet line.
export function personBulletMarkdown({ aliases = [], definition, term }) {
  const singleLineDefinition = String(definition).replace(/\s+/g, " ").trim();
  const aliasText = aliases.length ? ` (also ${ aliases.join(", ") })` : "";
  return `- **${ term.trim() }**${ aliasText }: ${ singleLineDefinition } ${ BUILDER_MARKER }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one People line as a person, with the names it lists after its bold name.
// @param {string} line - A line of the People section.
// @returns {object|null} { aliases, isBuilderOwned, rawDefinition, term }, or null when the line is not a person bullet.
export function personFromLine(line) {
  const match = unescapedMarkdownText(line).match(PERSON_BULLET_PATTERN);
  if (!match) return null;
  const term = match[1].trim();
  const listedAliases = (match[2] || "").split(",");
  return { aliases: mergedAliases(term, listedAliases), isBuilderOwned: isBuilderMarkedText(match[3]),
    rawDefinition: textWithoutBuilderMarker(match[3]), term };
}
