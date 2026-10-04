// Rewrite one plugin-owned dictionary definition from the evidence collected in the user's notes. The provider is shown
// the definition as it stands and the numbered passages, and asked whether the passages support a sharper definition;
// it must cite the passages it relied on, grade the evidence, and say what remains uncertain. A rewrite is accepted
// only when the evidence is graded strong or partial, cites a passage it was shown, and differs from the current
// definition, so weak or conflicting evidence keeps the old definition. The accepted definition is committed through
// the app's note writer after a fresh read of the dictionary: a term the user adopted by removing `[builder]`, removed,
// or rewrote while the provider was answering is left as the user has it.
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { dictionaryEntriesFromContent, dictionaryNoteName, mergedDictionaryContent, openUserTermsDictionary,
  readUserTermsDictionary, writeUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";

// How the provider may grade the evidence; only the first two let a rewrite through.
export const EVIDENCE_QUALITIES = Object.freeze(["strong", "partial", "weak", "conflicting"]);
// How a refinement ended: the definition was rewritten, kept, or the provider could not be reached.
export const REFINEMENT_OUTCOMES = Object.freeze({ failed: "failed", kept: "kept", refined: "refined" });
// How committing a rewritten definition ended.
export const COMMIT_STATUSES = Object.freeze({ changed: "changed", removed: "removed", userOwned: "userOwned", written: "written" });

const LOG_LABEL = "[dictionary-term-refinement]";
const MAXIMUM_DEFINITION_LENGTH = 500;
const MAXIMUM_UNCERTAINTY_LENGTH = 300;
const MINIMUM_DEFINITION_LENGTH = 20;
const SUPPORTING_QUALITIES = ["strong", "partial"];

// ----------------------------------------------------------------------------------------------
// @desc Judge a provider's answer: accept a rewritten definition only when the answer asks to refine, grades the
//   evidence as supporting, cites at least one passage it was shown, and gives a definition of useful length that
//   differs from the current one in more than case and spacing.
// @param {object|null} response - Parsed JSON shaped { decision, definition, evidenceQuality, sourceNumbers, uncertainty }.
// @param {object} context - { definition, passages }: the current definition and the passages shown, numbered from 1.
// @returns {object} { citedNoteUuids, definition, evidenceQuality, keptReason, outcome, uncertainty }: definition is
//   null and keptReason says why when the old definition is kept.
export function acceptedTermRefinement(response, { definition, passages }) {
  const evidenceQuality = EVIDENCE_QUALITIES.includes(response?.evidenceQuality) ? response.evidenceQuality : null;
  const uncertainty = String(response?.uncertainty || "").replace(/\s+/g, " ").trim().slice(0, MAXIMUM_UNCERTAINTY_LENGTH) || null;
  const sourceNumbers = Array.isArray(response?.sourceNumbers) ? response.sourceNumbers : [];
  const citedPassages = sourceNumbers.map(number => passages[Number(number) - 1]).filter(Boolean);
  const citedNoteUuids = [...new Set(citedPassages.map(passage => passage.noteUuid))];
  const proposed = String(response?.definition || "").replace(/\s+/g, " ").trim();
  const kept = keptReason => ({ citedNoteUuids, definition: null, evidenceQuality, keptReason, outcome: REFINEMENT_OUTCOMES.kept,
    uncertainty });
  if (!response || typeof response !== "object") return kept("The provider's answer could not be read");
  if (response.decision !== "refine") return kept("The provider kept the definition");
  if (!SUPPORTING_QUALITIES.includes(evidenceQuality)) return kept(`The evidence was graded ${ evidenceQuality || "ungraded" }`);
  if (!citedNoteUuids.length) return kept("The rewrite cited no passage it was shown");
  if (proposed.length < MINIMUM_DEFINITION_LENGTH || proposed.length > MAXIMUM_DEFINITION_LENGTH) {
    return kept("The rewrite was too short or too long");
  }
  const comparable = text => String(text).replace(/\s+/g, " ").trim().toLowerCase();
  if (comparable(proposed) === comparable(definition)) return kept("The rewrite restated the definition");
  return { citedNoteUuids, definition: proposed, evidenceQuality, keptReason: null, outcome: REFINEMENT_OUTCOMES.refined, uncertainty };
}

// ----------------------------------------------------------------------------------------------
// @desc Write a rewritten definition into the year's dictionary, serialized with every other write to it through the
//   note writer. The note is read fresh first, and nothing is written when the term is gone, no longer ends in
//   `[builder]`, or no longer has the definition the refinement started from.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} definition - The rewritten definition
//   - {string} expectedDefinition - The definition the refinement read, footnotes resolved
//   - {DashboardNoteWriter} [noteWriter] - Serializes updates; the app's shared writer by default
//   - {string} term - The term
//   - {number} year - The dictionary's year
// @returns {Promise<string>} One of COMMIT_STATUSES.
// @throws When the dictionary cannot be read or written.
export function committedTermDefinition(app, { definition, expectedDefinition, noteWriter = DashboardNoteWriter.forApp(app), term, year }) {
  return noteWriter.update(dictionaryNoteName(year), async () => {
    if ((await readUserTermsDictionary(app, year)) === null) return COMMIT_STATUSES.removed;
    const { content, noteHandle } = await openUserTermsDictionary(app, year);
    const entry = dictionaryEntriesFromContent(content).find(candidate => candidate.term.toLowerCase() === term.trim().toLowerCase());
    if (!entry) return COMMIT_STATUSES.removed;
    if (!entry.isBuilderOwned) return COMMIT_STATUSES.userOwned;
    if (entry.definition !== expectedDefinition) return COMMIT_STATUSES.changed;
    const merged = mergedDictionaryContent(content, { incomingEntries: [{ definition, term: entry.term }] });
    await writeUserTermsDictionary(app, noteHandle, merged.content);
    return COMMIT_STATUSES.written;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the provider whether a term's evidence supports a sharper definition. A provider failure is reported as
//   the failed outcome with its reason rather than thrown, so the caller decides how to retry.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - An object with the following properties:
//   - {string} definition - The definition as it stands, footnotes resolved
//   - {object} evidence - A record from collectTermEvidence, with passages
//   - {function} [promptRunner=raceWizardPrompt] - (app, prompt, llmOptions) => the parsed response
// @returns {Promise<object>} As acceptedTermRefinement returns, plus failureReason; a failure has outcome "failed".
export async function refineDictionaryTerm(app, { definition, evidence, promptRunner = raceWizardPrompt }) {
  const prompt = termRefinementPrompt({ definition, evidence });
  let response = null;
  try {
    response = await promptRunner(app, prompt, wizardLlmOptions(pluginSettings()));
  } catch (error) {
    logIfEnabled(`${ LOG_LABEL } provider call failed`, error?.message);
    return { citedNoteUuids: [], definition: null, evidenceQuality: null, failureReason: error?.message || "Refinement request failed",
      keptReason: null, outcome: REFINEMENT_OUTCOMES.failed, uncertainty: null };
  }
  const refinement = acceptedTermRefinement(response, { definition, passages: evidence.passages });
  logIfEnabled(`${ LOG_LABEL } answered`, { evidenceQuality: refinement.evidenceQuality, keptReason: refinement.keptReason,
    outcome: refinement.outcome, term: evidence.term });
  return { ...refinement, failureReason: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Render the refinement prompt: the definition as it stands, then each passage numbered with the note it came from.
// @param {object} options - { definition, evidence }.
// @returns {string} Prompt requesting JSON.
export function termRefinementPrompt({ definition, evidence }) {
  const noteNames = new Map((evidence.sources || []).map(source => [source.noteUuid, source.noteName]));
  const passageBlocks = evidence.passages.map((passage, index) => `[${ index + 1 }] From the note `
    + `"${ noteNames.get(passage.noteUuid) || "Untitled" }":\n${ passage.text }`);
  return "You maintain a dictionary of terms specific to one person's notebook. Another model reads it to judge whether "
    + "a task advances a project, and it has never seen this notebook.\n\n"
    + `Term: ${ evidence.term }\nCurrent definition: ${ definition }\n\n`
    + `Passages from the person's notes that use the term:\n\n${ passageBlocks.join("\n\n") }\n\n`
    + "Decide whether these passages support a more accurate or more specific definition than the current one. A good "
    + "definition says in one or two sentences what the term is in this notebook and which goals, projects, or products "
    + "it connects to.\n"
    + "Rules:\n"
    + "- Use only what the passages show. Do not add facts they do not support.\n"
    + "- Keep the current definition when the passages are thin, off-topic, or disagree with each other.\n"
    + "- Cite by number every passage the new definition relies on.\n"
    + "- Grade the evidence: strong (several passages agree), partial (some support), weak, or conflicting.\n"
    + "- Say briefly what remains uncertain, or leave it empty.\n\n"
    + 'Respond with JSON only, shaped: { "decision": "refine" or "keep", "definition": "...", '
    + '"evidenceQuality": "strong" | "partial" | "weak" | "conflicting", "sourceNumbers": [1, 2], "uncertainty": "..." }';
}
