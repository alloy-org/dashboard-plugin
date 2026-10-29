// Ask the configured provider which words in the user's recently added tasks a stranger would misread, and who the
// people those tasks name are to the account owner. Project discovery (dictionary-term-discovery.js) only reads the
// quarter's project wording; this pass reads the tasks themselves, which is where a collaborator's name first shows up.
//
// Each proposal must occur in the text of a task it was drawn from, as in project discovery, and a pass only adds:
// a term or person the dictionary already holds is left to evidence and refinement, which keep it current as new tasks
// name it. A person linked with "@" or "@@" is a person whatever the provider says, so one it leaves out is still added
// with a definition drawn from the tasks that name them, for evidence and refinement to fill in.
import { dictionaryKeyFromEntry, isOwnerTerm, mergedAliases } from "plan-wizard/stack-rank/dictionary-people";
import { textContainsTerm } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { readableTaskText } from "plan-wizard/stack-rank/person-mentions";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";

// The most tasks one scan sends; enough for a few days of new tasks in one bounded prompt.
export const MAXIMUM_TASKS_PER_SCAN = 60;
const LOG_LABEL = "[task-term-discovery]";
const MAXIMUM_DEFINITION_LENGTH = 500;
const MAXIMUM_NAME_LENGTH = 60;
const MAXIMUM_PEOPLE_PER_SCAN = 8;
const MAXIMUM_TERMS_PER_SCAN = 6;
const MAXIMUM_TASK_CHARACTERS = 240;
const MINIMUM_DEFINITION_LENGTH = 20;

// ----------------------------------------------------------------------------------------------
// @desc Keep the proposals that are new to the dictionary and drawn from the tasks, and add every linked person the
//   provider left out.
// @param {object|null} response - Parsed provider response shaped { people: [{ aliases, definition, name }], terms:
//   [{ definition, term }] }.
// @param {object} context - { dictionaryEntries, mentionedPeople, ownerNames, tasks }.
// @returns {Array<object>} Entries for mergedDictionaryContent: { definition, term }, and { aliases, definition,
//   isPerson: true, term } for people.
export function acceptedTaskTermEntries(response, { dictionaryEntries, mentionedPeople, ownerNames, tasks }) {
  const taskTexts = tasks.map(task => readableTaskText(task.content));
  const takenKeys = new Set(dictionaryEntries.flatMap(entry => [entry.term, ...entry.aliases]).map(name => name.toLowerCase()));
  for (const ownerName of ownerNames) takenKeys.add(ownerName.toLowerCase());
  const people = _acceptedPeople(response?.people, { takenKeys, taskTexts });
  for (const linked of _linkedPeopleLeftOut(mentionedPeople, { takenKeys, tasks })) people.push(linked);
  const terms = _acceptedTerms(response?.terms, { takenKeys, taskTexts });
  return [...terms, ...people];
}

// ----------------------------------------------------------------------------------------------
// @desc Propose terms and people from recently added tasks. A provider failure is reported rather than thrown, and the
//   linked people are still returned, since they need no provider to be recognized.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {Array<object>} dictionaryEntries - From dictionaryEntriesFromContent
//   - {Array<object>} mentionedPeople - From mentionedPeopleFromTasks, the owner left out
//   - {Array<string>} ownerNames - The account owner's names, from accountOwner
//   - {function} [promptRunner=raceWizardPrompt] - (app, prompt, llmOptions) => the parsed response
//   - {Array<object>} tasks - The tasks the scan sends, each with content and uuid
// @returns {Promise<object>} { entries, failureReason }.
export async function discoverTaskTerms(app, { dictionaryEntries, mentionedPeople, ownerNames, promptRunner = raceWizardPrompt, tasks }) {
  if (!tasks.length) return { entries: [], failureReason: null };
  const context = { dictionaryEntries, mentionedPeople, ownerNames, tasks };
  let response = null;
  let failureReason = null;
  try {
    response = await promptRunner(app, taskTermDiscoveryPrompt(context), wizardLlmOptions(pluginSettings()));
  } catch (error) {
    logIfEnabled(`${ LOG_LABEL } provider call failed`, error?.message);
    failureReason = error?.message || "Task term request failed";
  }
  const entries = acceptedTaskTermEntries(response, context);
  logIfEnabled(`${ LOG_LABEL } proposals accepted`, { acceptedCount: entries.length, failureReason,
    personCount: entries.filter(entry => entry.isPerson).length, taskCount: tasks.length });
  return { entries, failureReason };
}

// ----------------------------------------------------------------------------------------------
// @desc Render the scan prompt: who the owner is, the names the dictionary already holds, the linked people, and the
//   tasks, links flattened to their text.
// @param {object} context - { dictionaryEntries, mentionedPeople, ownerNames, tasks }.
// @returns {string} Prompt requesting JSON.
export function taskTermDiscoveryPrompt({ dictionaryEntries, mentionedPeople, ownerNames, tasks }) {
  const ownerLine = ownerNames.length ? `The notebook belongs to ${ ownerNames.join(", also called ") }.`
    : "The notebook owner's name is not known.";
  const knownNames = dictionaryEntries.filter(entry => !isOwnerTerm(entry.term)).map(dictionaryKeyFromEntry);
  const linkedNames = mentionedPeople.map(person => person.name);
  const taskLines = tasks.map(task => `- ${ readableTaskText(task.content).slice(0, MAXIMUM_TASK_CHARACTERS) }`);
  return "You maintain a dictionary of terms and people specific to one person's notebook. Another model reads it to "
    + "judge whether a task advances a project, and it has never seen this notebook.\n\n"
    + `${ ownerLine }\n`
    + `Already defined (skip these): ${ knownNames.join("; ") || "(nothing yet)" }\n`
    + `Names the tasks link to as people: ${ linkedNames.join("; ") || "(none)" }\n\n`
    + `Tasks the owner added recently:\n${ taskLines.join("\n") }\n\n`
    + "1. Terms: find product names, codenames, abbreviations, and ordinary words used with a narrower meaning that an "
    + "outsider would misread. Define each in one or two sentences: what it is here and which work it connects to.\n"
    + "2. People: find every person the tasks name, other than the owner, including each linked name above. For each, "
    + "say who they most likely are to the owner (collaborator, client, manager, report, vendor, friend, family) and "
    + "which kinds of work they come up in, such as \"video scripts\" or \"customer onboarding\". List other names the "
    + "tasks use for the same person, such as a first name alone.\n"
    + "Rules:\n"
    + "- Copy every term and name exactly as the tasks write it, without any leading @.\n"
    + "- Use only what the tasks show; say \"likely\" where you infer, and do not invent facts.\n"
    + "- Skip anything already defined, and common words whose ordinary meaning is the one intended.\n"
    + `- Return at most ${ MAXIMUM_TERMS_PER_SCAN } terms and ${ MAXIMUM_PEOPLE_PER_SCAN } people. Return none if nothing qualifies.\n\n`
    + 'Respond with JSON only, shaped: { "terms": [{ "term": "...", "definition": "..." }], '
    + '"people": [{ "name": "...", "aliases": ["..."], "definition": "..." }] }';
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Keep the proposed people with a usable name and definition, named in some task by one of their names, and new
//   to the dictionary by every name. Accepted names are added to takenKeys.
// @param {Array<object>|undefined} proposals - The response's people.
// @param {object} options - { takenKeys, taskTexts }.
// @returns {Array<object>} Up to MAXIMUM_PEOPLE_PER_SCAN { aliases, definition, isPerson, term }.
function _acceptedPeople(proposals, { takenKeys, taskTexts }) {
  const accepted = [];
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    const term = String(proposal?.name || "").replace(/^@+/, "").trim();
    const definition = _definition(proposal?.definition);
    if (!term || term.length > MAXIMUM_NAME_LENGTH || !definition) continue;
    const aliases = mergedAliases(term, [], Array.isArray(proposal?.aliases) ? proposal.aliases : []);
    const names = [term, ...aliases];
    if (names.some(name => takenKeys.has(name.toLowerCase()))) continue;
    if (!taskTexts.some(text => names.some(name => textContainsTerm(text, name)))) continue;
    for (const name of names) takenKeys.add(name.toLowerCase());
    accepted.push({ aliases, definition, isPerson: true, term });
    if (accepted.length >= MAXIMUM_PEOPLE_PER_SCAN) break;
  }
  return accepted;
}

// ----------------------------------------------------------------------------------------------
// @desc Keep the proposed terms with a usable definition that occur in some task and are new to the dictionary.
//   Accepted terms are added to takenKeys.
// @param {Array<object>|undefined} proposals - The response's terms.
// @param {object} options - { takenKeys, taskTexts }.
// @returns {Array<object>} Up to MAXIMUM_TERMS_PER_SCAN { definition, term }.
function _acceptedTerms(proposals, { takenKeys, taskTexts }) {
  const accepted = [];
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    const term = String(proposal?.term || "").trim();
    const definition = _definition(proposal?.definition);
    if (!term || term.length > MAXIMUM_NAME_LENGTH || !definition || takenKeys.has(term.toLowerCase()) || isOwnerTerm(term)) continue;
    if (!taskTexts.some(text => textContainsTerm(text, term))) continue;
    takenKeys.add(term.toLowerCase());
    accepted.push({ definition, term });
    if (accepted.length >= MAXIMUM_TERMS_PER_SCAN) break;
  }
  return accepted;
}

// ----------------------------------------------------------------------------------------------
// @desc A definition collapsed to one line, or null when it is too short or too long to keep.
// @param {*} definition - The proposed definition.
// @returns {string|null} The definition, or null.
function _definition(definition) {
  const collapsed = String(definition || "").replace(/\s+/g, " ").trim();
  if (collapsed.length < MINIMUM_DEFINITION_LENGTH || collapsed.length > MAXIMUM_DEFINITION_LENGTH) return null;
  return collapsed;
}

// ----------------------------------------------------------------------------------------------
// @desc The linked people neither the dictionary nor the accepted proposals hold, each defined from the tasks that
//   link to them. A typed "@Name" with no link is only a hint to the provider and is not added here.
// @param {Array<object>} mentionedPeople - From mentionedPeopleFromTasks.
// @param {object} options - { takenKeys, tasks }.
// @returns {Array<object>} { aliases, definition, isPerson, term }.
function _linkedPeopleLeftOut(mentionedPeople, { takenKeys, tasks }) {
  const taskTextByUuid = new Map(tasks.map(task => [task.uuid, readableTaskText(task.content)]));
  const added = [];
  for (const person of mentionedPeople) {
    const isLinked = person.noteUuids.length || person.personUuids.length;
    if (!isLinked || takenKeys.has(person.name.toLowerCase()) || person.name.length > MAXIMUM_NAME_LENGTH) continue;
    const linkingTexts = person.taskUuids.map(uuid => taskTextByUuid.get(uuid)).filter(Boolean);
    const example = linkingTexts[0] ? ` such as "${ linkingTexts[0].slice(0, 120) }"` : "";
    const definition = `A person the owner links to in ${ linkingTexts.length || 1 } recent task${ linkingTexts.length === 1 ? "" : "s" }${ example }.`;
    takenKeys.add(person.name.toLowerCase());
    added.push({ aliases: [], definition, isPerson: true, term: person.name });
  }
  return added;
}
