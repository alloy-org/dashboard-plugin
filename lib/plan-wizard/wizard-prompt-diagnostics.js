// Measure what the wizard actually asks a provider to read, so a run that overruns its timeout can be diagnosed
// from the log rather than guessed at. A timeout tells you the request was too slow; it does not tell you whether
// the prompt carried 40 tasks or 360, which evidence signal contributed the bulk of the characters, or how much of
// the elapsed time went to the provider versus to collecting the evidence in the first place. These helpers answer
// those questions, and every number they report is one the prompt can be revised against: shrink the signal that
// dominates characterCount, or cap the task count that dominates the request.
//
// Nothing here logs user content. Counts, sizes, and the first characters of a truncated header are safe to keep
// in a log the user may paste into a bug report; task text and note names are not, and are never emitted.

import { TOKEN_CHARACTERS } from "constants/units";
import { logIfEnabled } from "util/log";

// A prompt is measured in characters and reported in tokens with the project's standing four-characters-per-token
// approximation, which is close enough to tell a 10k-token request from a 90k-token one.
export const DIAGNOSTIC_SECTION_LABEL_LENGTH = 60;

// ----------------------------------------------------------------------------------------------
// @desc Describe a rendered prompt in the terms a revision would act on: how large it is, how many tokens that is
//   likely to be, and which of its sections account for the size. Sections are identified by their opening line
//   alone, which names the signal (for instance "Tasks completed recently:") without carrying the task text under it.
// @param {string} prompt - The fully rendered prompt text.
// @returns {Object} An object with the following properties:
//   - {number} characterCount - Total prompt length in characters
//   - {number} estimatedTokenCount - characterCount divided by the project's characters-per-token constant
//   - {number} lineCount - Number of lines in the prompt
//   - {Array<Object>} sectionSizes - Per-section { characterCount, label, lineCount }, largest first
export function promptSizeDiagnostics(prompt) {
  const promptText = String(prompt ?? "");
  const sections = promptText.split("\n\n");
  const describedSections = sections.map(section => ({ characterCount: section.length,
    label: sectionLabel(section), lineCount: section.split("\n").length }));
  const sortedSections = describedSections.sort((first, second) => second.characterCount - first.characterCount);
  return { characterCount: promptText.length,
    estimatedTokenCount: Math.round(promptText.length / TOKEN_CHARACTERS),
    lineCount: promptText.split("\n").length, sectionSizes: sortedSections };
}

// ----------------------------------------------------------------------------------------------
// @desc Count what the project-discovery evidence bundle submits for the provider to evaluate, separating the tasks
//   that were found from the tasks that survived the per-signal cap. A gap between collected and submitted counts is
//   the first thing to check when the prompt is larger than the caps suggest it should be.
// @param {object} evidence - Bundle from collectProspectEvidence.
// @returns {Object} An object with the following properties:
//   - {number} activeNoteCount - Notes summarized in the prompt
//   - {number} chosenGoalCount - Intents the proposals must tie themselves to
//   - {number} collectedTaskCount - Tasks the evidence pass found, before the per-signal caps
//   - {number} rejectedSummaryCount - Previously declined summaries the prompt must repeat back
//   - {number} submittedTaskCount - Task lines the prompt actually carries
//   - {object} submittedTasksBySignal - { completed, important, recent } counts as submitted
//   - {number} averageTaskTextLength - Mean characters per submitted task line, rounded
export function prospectEvidenceDiagnostics(evidence) {
  const importantReferences = evidence?.importantReferences ?? [];
  const completedReferences = evidence?.completedReferences ?? [];
  const recentReferences = evidence?.recentReferences ?? [];
  const allReferences = importantReferences.concat(completedReferences, recentReferences);
  const textLengths = allReferences.map(reference => String(reference?.text ?? "").length);
  const totalTextLength = textLengths.reduce((runningTotal, length) => runningTotal + length, 0);
  const coverage = evidence?.coverage ?? {};
  const collectedTaskCount = (coverage.importantTaskCount ?? 0) + (coverage.completedTaskCount ?? 0)
    + (coverage.recentTaskCount ?? 0);
  return { activeNoteCount: (evidence?.activeNotes ?? []).length,
    averageTaskTextLength: allReferences.length ? Math.round(totalTextLength / allReferences.length) : 0,
    chosenGoalCount: (evidence?.chosenGoals ?? []).length, collectedTaskCount,
    rejectedSummaryCount: (evidence?.rejectedSummaries ?? []).length, submittedTaskCount: allReferences.length,
    submittedTasksBySignal: { completed: completedReferences.length, important: importantReferences.length,
      recent: recentReferences.length } };
}

// ----------------------------------------------------------------------------------------------
// @desc Count what the intent-inference evidence bundle submits. Intent evidence carries whole note bodies rather
//   than task lines, so note context is measured in characters as well as in notes: one long note can outweigh
//   every task in the bundle and is invisible in a count of tasks alone.
// @param {object} evidence - Bundle from collectIntentEvidence.
// @returns {Object} An object with the following properties:
//   - {number} calendarEventCount - Upcoming events included
//   - {number} noteContextCharacterCount - Total characters of note body text submitted
//   - {number} noteContextCount - Notes whose bodies are submitted
//   - {number} personalTaskCount - Personally tagged task lines submitted
//   - {number} submittedTaskCount - All task lines submitted across both categories
//   - {number} workTaskCount - Professional task lines submitted, including supplemental ones
export function intentEvidenceDiagnostics(evidence) {
  const workReferences = (evidence?.work?.references ?? []).concat(evidence?.work?.supplementalReferences ?? []);
  const personalReferences = evidence?.personal?.references ?? [];
  const noteContext = evidence?.work?.noteContext ?? [];
  const noteLengths = noteContext.map(note => String(note?.text ?? "").length);
  const noteContextCharacterCount = noteLengths.reduce((runningTotal, length) => runningTotal + length, 0);
  return { calendarEventCount: (evidence?.calendarSummaries ?? []).length, noteContextCharacterCount,
    noteContextCount: noteContext.length, personalTaskCount: personalReferences.length,
    submittedTaskCount: workReferences.length + personalReferences.length, workTaskCount: workReferences.length };
}

// ----------------------------------------------------------------------------------------------
// @desc Log the full submission profile for one wizard pass immediately before the provider is called, so the
//   record of what was asked exists even when the request never returns. A timeout leaves no response to inspect;
//   this line is what remains.
// @param {string} passLabel - Log prefix identifying the pass, for instance "[prospect-discovery]".
// @param {object} params - An object with the following properties:
//   - {string} model - The model the pass requested, or null when the configured default applies
//   - {string} prompt - The rendered prompt text
//   - {object} submission - Counts from prospectEvidenceDiagnostics or intentEvidenceDiagnostics
//   - {number} timeoutSeconds - The budget this request has to finish within
// @returns {Object} The size diagnostics that were logged, so a caller can report them alongside the outcome.
export function logPromptSubmission(passLabel, { model, prompt, submission, timeoutSeconds }) {
  const sizeDiagnostics = promptSizeDiagnostics(prompt);
  logIfEnabled(`${ passLabel } submitting prompt`, { ...submission, characterCount: sizeDiagnostics.characterCount,
    estimatedTokenCount: sizeDiagnostics.estimatedTokenCount, lineCount: sizeDiagnostics.lineCount,
    model: model ?? null, timeoutSeconds });
  logIfEnabled(`${ passLabel } prompt sections by size`, sizeDiagnostics.sectionSizes);
  return sizeDiagnostics;
}

// ----------------------------------------------------------------------------------------------
// @desc Log how a provider call ended and how long it took, against the budget it was given. The percentage of
//   budget consumed is the number that says whether a prompt revision needs to halve the work or shave it.
// @param {string} passLabel - Log prefix identifying the pass.
// @param {object} params - An object with the following properties:
//   - {number} durationMs - Wall-clock milliseconds the provider call occupied
//   - {string|null} failureReason - The failure message, or null when the call returned
//   - {object} sizeDiagnostics - The value returned by logPromptSubmission
//   - {number} timeoutSeconds - The budget this request had
// @returns {void}
export function logPromptOutcome(passLabel, { durationMs, failureReason, sizeDiagnostics, timeoutSeconds }) {
  const budgetMs = timeoutSeconds * 1000;
  const roundedDurationMs = Number(durationMs.toFixed(1));
  logIfEnabled(`${ passLabel } provider call finished`, { budgetPercentUsed: Math.round(durationMs / budgetMs * 100),
    charactersPerSecond: durationMs > 0 ? Math.round(sizeDiagnostics.characterCount / (durationMs / 1000)) : null,
    durationMs: roundedDurationMs, estimatedTokenCount: sizeDiagnostics.estimatedTokenCount,
    failureReason: failureReason ?? null, timedOut: !!failureReason && /timeout/i.test(failureReason),
    timeoutSeconds });
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a prompt section to the opening line that names it, so the log identifies which signal is large
//   without reproducing the user's task text underneath it.
// @param {string} section - One double-newline-delimited prompt section.
// @returns {string} The section's first line, truncated to a label length.
function sectionLabel(section) {
  const firstLine = String(section ?? "").split("\n")[0];
  if (firstLine.length <= DIAGNOSTIC_SECTION_LABEL_LENGTH) return firstLine;
  return `${ firstLine.slice(0, DIAGNOSTIC_SECTION_LABEL_LENGTH) }…`;
}
