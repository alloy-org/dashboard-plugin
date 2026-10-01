// Ask the configured provider which words in the user's projects a stranger would misread, and what they mean in
// this notebook. Jev rates; it cannot write a definition, so the dictionary is grown by the same generative
// provider race the wizard uses, and Jev only ever reads the result.
//
// A proposed term must occur in the wording of a project it was proposed for. That is the rule that keeps the
// dictionary about this user's vocabulary: a model asked to define "terms" will otherwise define the nouns it finds
// interesting, and every invented entry is context Jev then has to read past on every batch.
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";

const DISCOVERY_LOG_LABEL = "[dictionary-term-discovery]";
const MAXIMUM_DEFINITION_LENGTH = 500;
const MAXIMUM_TERM_LENGTH = 60;
const MAXIMUM_TERMS_PER_PASS = 8;
const MINIMUM_DEFINITION_LENGTH = 20;
// Enough of a project's own tasks to show what its vocabulary refers to, bounded so ten projects fit one prompt.
const TASKS_DESCRIBED_PER_PROJECT = 8;

// ----------------------------------------------------------------------------------------------
// @desc Keep the proposals that define a term actually used in a project's wording, with a definition of useful
//   length, that the user has not already defined by hand and that changes a plugin-owned definition rather than
//   restating it.
// @param {object|null} response - Parsed provider response shaped { terms: [{ term, definition }] }.
// @param {object} context - { dictionaryEntries, projects }.
// @returns {Array<object>} Up to MAXIMUM_TERMS_PER_PASS { definition, term }.
export function acceptedDictionaryTerms(response, { dictionaryEntries, projects }) {
  const proposals = Array.isArray(response?.terms) ? response.terms : [];
  const entryByTermKey = new Map(dictionaryEntries.map(entry => [entry.term.toLowerCase(), entry]));
  const projectTexts = projects.map(_projectWording);
  const accepted = [];
  const acceptedKeys = new Set();
  for (const proposal of proposals) {
    const term = String(proposal?.term || "").trim();
    const definition = String(proposal?.definition || "").replace(/\s+/g, " ").trim();
    const termKey = term.toLowerCase();
    if (!term || term.length > MAXIMUM_TERM_LENGTH || acceptedKeys.has(termKey)) continue;
    if (definition.length < MINIMUM_DEFINITION_LENGTH || definition.length > MAXIMUM_DEFINITION_LENGTH) continue;
    const existing = entryByTermKey.get(termKey);
    if (existing && (!existing.isBuilderOwned || existing.definition === definition)) continue;
    if (!projectTexts.some(text => textContainsTerm(text, term))) continue;
    acceptedKeys.add(termKey);
    accepted.push({ definition, term });
    if (accepted.length >= MAXIMUM_TERMS_PER_PASS) break;
  }
  return accepted;
}

// ----------------------------------------------------------------------------------------------
// @desc Propose new or sharper definitions for terms in the given projects. A provider failure or an unusable
//   response yields no terms and a stated reason rather than throwing, since a dictionary that did not grow this
//   pass still serves the ranking that follows.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {Array<object>} dictionaryEntries - Current entries as { definition, isBuilderOwned, term }
//   - {Array<object>} projects - Stored project records carrying summary, nextAction, relatedTaskRecords
//   - {function} [promptRunner=raceWizardPrompt] - Injected for tests
// @returns {Promise<object>} { failureReason, terms: [{ definition, term }] }.
export async function discoverDictionaryTerms(app, { dictionaryEntries, projects, promptRunner = raceWizardPrompt }) {
  if (!projects.length) return { failureReason: null, terms: [] };
  const prompt = discoveryPrompt(dictionaryEntries, projects);
  let response = null;
  try {
    response = await promptRunner(app, prompt, wizardLlmOptions(pluginSettings()));
  } catch (error) {
    logIfEnabled(`${ DISCOVERY_LOG_LABEL } provider call failed`, error?.message);
    return { failureReason: error?.message || "Dictionary term request failed", terms: [] };
  }
  const terms = acceptedDictionaryTerms(response, { dictionaryEntries, projects });
  logIfEnabled(`${ DISCOVERY_LOG_LABEL } proposals accepted`, { acceptedCount: terms.length,
    proposedCount: Array.isArray(response?.terms) ? response.terms.length : 0 });
  return { failureReason: null, terms };
}

// ----------------------------------------------------------------------------------------------
// @desc Render the discovery prompt: the dictionary as it stands, then each project's wording and a sample of its
//   tasks, so the model can tell from the tasks what a project's shorthand refers to.
// @param {Array<object>} dictionaryEntries - Current entries.
// @param {Array<object>} projects - Stored project records.
// @returns {string} Prompt requesting JSON.
export function discoveryPrompt(dictionaryEntries, projects) {
  const dictionaryLines = dictionaryEntries.map(entry => `- ${ entry.term }${ entry.isBuilderOwned ? "" : " (user-written)" }: `
    + entry.definition);
  const projectBlocks = projects.map(project => {
    const taskRecords = (project.relatedTaskRecords || []).slice(0, TASKS_DESCRIBED_PER_PROJECT);
    const taskLines = taskRecords.map(task => `  - ${ task.taskText }`);
    const nextAction = project.nextAction ? `\n  Next action: ${ project.nextAction }` : "";
    return `- Project: ${ project.summary }${ nextAction }\n  Its tasks:\n${ taskLines.join("\n") || "  - (none yet)" }`;
  });
  return "You maintain a dictionary of terms specific to one person's notebook. Another model reads it to judge "
    + "whether a task advances a project, and it has never seen this notebook.\n\n"
    + `Current dictionary:\n${ dictionaryLines.join("\n") || "- (empty)" }\n\n`
    + `The person's current projects:\n${ projectBlocks.join("\n") }\n\n`
    + "Find words or phrases in the project names, next actions, and tasks that an outsider would misread or not "
    + "recognize: product names, internal codenames, people, abbreviations, and ordinary words used with a narrower "
    + "meaning here. For each, write one or two sentences saying what it is in this notebook and which goals or "
    + "projects it connects to. Use only what the projects and tasks show; do not guess at facts they do not support.\n"
    + "Rules:\n"
    + "- Copy each term exactly as it appears in the project wording above.\n"
    + "- Do not redefine a term marked (user-written).\n"
    + "- Redefine another existing term only if the projects show a more specific meaning than its definition gives.\n"
    + "- Skip common words whose ordinary meaning is the one intended.\n"
    + `- Return at most ${ MAXIMUM_TERMS_PER_PASS } terms, most misreadable first. Return none if nothing qualifies.\n\n`
    + 'Respond with JSON only, shaped: { "terms": [{ "term": "...", "definition": "..." }] }';
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a term occurs in text as a whole word or phrase, ignoring case.
// @param {string} text - Text to search.
// @param {string} term - Term to find.
// @returns {boolean} True when present.
export function textContainsTerm(text, term) {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${ escapedTerm }(?:$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

// ----------------------------------------------------------------------------------------------
// @desc Join the wording a term may be drawn from for one project.
// @param {object} project - Stored project record.
// @returns {string} Summary, next action, and task texts.
function _projectWording(project) {
  const taskTexts = (project.relatedTaskRecords || []).slice(0, TASKS_DESCRIBED_PER_PROJECT).map(task => task.taskText);
  const wordingParts = [project.summary, project.nextAction, ...taskTexts];
  return wordingParts.filter(Boolean).join("\n");
}
