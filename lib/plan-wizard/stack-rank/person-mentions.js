// Find the people a task names on purpose, and who the account owner is, so term discovery can tell a collaborator from
// the owner and know which names are people before any provider is asked. Amplenote writes three kinds of deliberate
// mention into task markdown:
//
//   - `@@Name`, completed from the people menu, becomes `[@Lucian Ruscanu](https://www.amplenote.com/notes/people/{personUUID})`,
//     naming an Amplenote user whom app.getPeople also lists, with the notes and tags shared with them.
//   - `@Name`, completed from the note menu, becomes a note link; when its text keeps the "@" it names a person whose
//     note can be read directly for what the user knows about them.
//   - `@Name` or `@@Name` left as typed text names a person with no link.
//
// The owner's names come from the host's app.getCurrentPerson where it exists, together with the dictionary's
// OWNER_TERM bullet, which is how a user on an older host says who they are.
import { ownerNamesFromEntries } from "plan-wizard/stack-rank/dictionary-people";
import { checkedAppResult } from "plan-wizard/vision-guide-notes";
import { logIfEnabled } from "util/log";

// A markdown link to an Amplenote person or note: link text, then "people/" when it names a person, then the UUID.
const AMPLENOTE_LINK_PATTERN = /\[([^\]\n]+)\]\(https:\/\/www\.amplenote\.com\/notes\/(people\/)?([\w-]+)[^)\s]*\)/g;
// Typed "@Name" or "@@Name": one or two capitalized words after an "@" that does not follow a word character. Typed
// text has no link to say where a name ends, so "@Lucian Review" may over-reach; callers treat these as hints.
const TYPED_MENTION_PATTERN = /(^|[^\p{L}\p{N}@])@@?(\p{Lu}[\p{L}'’-]*(?:\s\p{Lu}[\p{L}'’-]*)?)/gu;

// ----------------------------------------------------------------------------------------------
// @desc The account owner's names and UUID. A host without app.getCurrentPerson, or one that fails to answer, leaves
//   the dictionary's OWNER_TERM bullet as the only source.
// @param {object} app - Host-compatible Amplenote API.
// @param {Array<object>} dictionaryEntries - From dictionaryEntriesFromContent.
// @returns {Promise<object>} { names, uuid }: names deduplicated without case, the host's first; uuid null when unknown.
export async function accountOwner(app, dictionaryEntries) {
  let hostPerson = null;
  if (typeof app?.getCurrentPerson === "function") {
    try {
      hostPerson = checkedAppResult(await app.getCurrentPerson());
    } catch (error) {
      logIfEnabled("[person-mentions] getCurrentPerson failed", error?.message);
    }
  }
  const candidateNames = [hostPerson?.name, ...ownerNamesFromEntries(dictionaryEntries)];
  const names = [];
  for (const name of candidateNames) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed && !names.some(existing => existing.toLowerCase() === trimmed.toLowerCase())) names.push(trimmed);
  }
  return { names, uuid: typeof hostPerson?.uuid === "string" ? hostPerson.uuid : null };
}

// ----------------------------------------------------------------------------------------------
// @desc Gather the people a set of tasks mention deliberately, one record per name, leaving out the owner.
// @param {Array<object>} tasks - Tasks as read, each with content and uuid.
// @param {object} [options] - { owner }: from accountOwner, whose names and UUID are left out.
// @returns {Array<object>} { name, noteUuids, personUuids, taskUuids } in order of first mention, the lists deduplicated.
export function mentionedPeopleFromTasks(tasks, { owner = { names: [], uuid: null } } = {}) {
  const ownerNameKeys = new Set(owner.names.map(name => name.toLowerCase()));
  const peopleByNameKey = new Map();
  for (const task of tasks || []) {
    for (const mention of personMentionsFromMarkdown(task?.content || "")) {
      const nameKey = mention.name.toLowerCase();
      if (ownerNameKeys.has(nameKey) || (owner.uuid && mention.personUuid === owner.uuid)) continue;
      if (!peopleByNameKey.has(nameKey)) peopleByNameKey.set(nameKey, { name: mention.name, noteUuids: [], personUuids: [], taskUuids: [] });
      const person = peopleByNameKey.get(nameKey);
      _pushUnique(person.noteUuids, mention.noteUuid);
      _pushUnique(person.personUuids, mention.personUuid);
      _pushUnique(person.taskUuids, task.uuid);
    }
  }
  return [...peopleByNameKey.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Find the deliberate person mentions in one piece of markdown: person links, note links whose text begins with
//   "@", and typed "@Name" outside any link.
// @param {string} markdown - Task or note markdown.
// @returns {Array<object>} { name, noteUuid, personUuid } in text order; noteUuid and personUuid are null when absent.
export function personMentionsFromMarkdown(markdown) {
  const mentions = [];
  const text = String(markdown || "");
  for (const match of text.matchAll(AMPLENOTE_LINK_PATTERN)) {
    const [, linkText, peoplePath, uuid] = match;
    const isPersonLink = Boolean(peoplePath);
    if (!isPersonLink && !linkText.trim().startsWith("@")) continue;
    const name = linkText.replace(/^\s*@+/, "").trim();
    if (name) mentions.push({ index: match.index, name, noteUuid: isPersonLink ? null : uuid, personUuid: isPersonLink ? uuid : null });
  }
  const textOutsideLinks = text.replace(AMPLENOTE_LINK_PATTERN, linkMatch => " ".repeat(linkMatch.length));
  for (const match of textOutsideLinks.matchAll(TYPED_MENTION_PATTERN)) {
    mentions.push({ index: match.index + match[1].length, name: match[2].trim(), noteUuid: null, personUuid: null });
  }
  const orderedMentions = mentions.sort((first, second) => first.index - second.index);
  const mentionsWithoutIndex = orderedMentions.map(({ name, noteUuid, personUuid }) => ({ name, noteUuid, personUuid }));
  return mentionsWithoutIndex;
}

// ----------------------------------------------------------------------------------------------
// @desc Task markdown as a reader sees it: each Amplenote link reduced to its text, so a prompt spends no tokens on URLs
//   and a person link still reads as "@Lucian Ruscanu".
// @param {string} markdown - Task markdown.
// @returns {string} The text with links flattened and whitespace collapsed.
export function readableTaskText(markdown) {
  const flattened = String(markdown || "").replace(AMPLENOTE_LINK_PATTERN, (_linkMatch, linkText, peoplePath) => {
    const trimmedText = linkText.trim();
    return peoplePath && !trimmedText.startsWith("@") ? `@${ trimmedText }` : trimmedText;
  });
  return flattened.replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------
// @desc Append a value to a list unless it is empty or already present.
// @param {Array<string>} list - The list; mutated.
// @param {string|null} value - The value.
function _pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}
