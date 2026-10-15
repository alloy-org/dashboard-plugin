// Turn a "Generate ideas" run snapshot into the text and states its progress window shows, so the window opened in an
// Amplenote prompt and the one drawn inside the Dashboard read the same words. Host-compatible: no React or DOM.
import { pluralize } from "app-util";

// ----------------------------------------------------------------------------------------------
// @desc Describe a run snapshot for its progress window.
// @param {object|null} snapshot - From IdeaGenerationRun#snapshot or pendingRunSnapshot; null when the run is unknown.
// @returns {object} An object with the following properties:
//   - {string} etaLabel - Such as "About 4 min left", "Finishing up…", or "Done"
//   - {boolean} finished - True once the summary is written
//   - {boolean} found - False when the snapshot is unknown, as after the plugin restarted
//   - {number|null} quotaPercent - Whole percent of the Agent Pro quota consumed; null hides the meter
//   - {Array<string>} statusParts - Such as ["Run 1 of 2 max per day", "Consumed 38% of Agent Pro quota"]
//   - {Array<object>} steps - { label, number, state } in order
//   - {Array<string>} summaryLines - Plain sentences describing the summary; empty until finished
//   - {string} title - The window's title
export function ideaRunProgressView(snapshot) {
  if (!snapshot) {
    return { etaLabel: "", finished: false, found: false, quotaPercent: null, statusParts: [], steps: [], summaryLines: [],
      title: "Idea generation" };
  }
  const quotaPercent = Number.isFinite(snapshot.quotaUsedFraction) ? Math.round(snapshot.quotaUsedFraction * 100) : null;
  const statusParts = [];
  if (snapshot.allowance) statusParts.push(`Run ${ snapshot.allowance.runNumber } of ${ snapshot.allowance.maximum } max per day`);
  if (quotaPercent !== null) statusParts.push(`Consumed ${ quotaPercent }% of Agent Pro quota`);
  const steps = (snapshot.steps || []).map((step, index) => ({ label: step.label, number: index + 1, state: step.state }));
  const summaryLines = snapshot.summary ? ideaRunSummaryLines(snapshot.summary) : [];
  return { etaLabel: etaLabel(snapshot), finished: !!snapshot.finished, found: true, quotaPercent, statusParts, steps, summaryLines,
    title: snapshot.title };
}

// ----------------------------------------------------------------------------------------------
// @desc Say how long a run has left.
// @param {object} snapshot - { etaSeconds, finished }.
// @returns {string} "Done" once finished, "Finishing up…" past the estimate, "Less than a minute left", or such as
//   "About 4 min left".
export function etaLabel({ etaSeconds, finished }) {
  if (finished) return "Done";
  if (!etaSeconds || etaSeconds <= 0) return "Finishing up…";
  if (etaSeconds < 60) return "Less than a minute left";
  return `About ${ Math.ceil(etaSeconds / 60) } min left`;
}

// ----------------------------------------------------------------------------------------------
// @desc Write a run's summary as sentences: each project's idea outcome and change in recommendable ideas and
//   associated tasks, the dictionary terms refined, and each failure.
// @param {object} summary - From ideaGenerationRunSummary.
// @returns {Array<string>} Sentences, in display order.
export function ideaRunSummaryLines({ failures = [], projects = [], refinedTermCount = 0 }) {
  const lines = projects.map(project => _projectSummaryLine(project));
  if (refinedTermCount) lines.push(`Refined ${ pluralize(refinedTermCount, "dictionary definition") }.`);
  for (const failure of failures) lines.push(`Could not finish ${ failure.subject ? `"${ failure.subject }"` : failure.jobType }: ${ failure.detail }`);
  if (!lines.length) lines.push("Nothing needed to change.");
  return lines;
}

// ----------------------------------------------------------------------------------------------
// @desc A snapshot for a run that has not been planned yet, so its window can open at once.
// @param {object} options - { allowance, runId, startedAt, stepLabels }: stepLabels as [{ key, label }].
// @returns {object} A snapshot as IdeaGenerationRun#snapshot shapes it, with every step waiting.
export function pendingRunSnapshot({ allowance, runId, startedAt, stepLabels }) {
  const steps = stepLabels.map(({ key, label }) => ({ key, label, state: "waiting" }));
  return { allowance, etaSeconds: 300, finished: false, projectCount: 0, quotaUsedFraction: null, runId, startedAt, steps, summary: null,
    title: "Choosing projects for idea generation" };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Describe what a run did for one project.
// @param {object} project - A project row from ideaGenerationRunSummary.
// @returns {string} Such as `"Launch": Generated 5 ideas, kept 3; 4 recommendable ideas (was 1); 2 more related tasks.`
function _projectSummaryLine(project) {
  const parts = [project.ideasDetail || (project.targeted ? "No ideas returned" : "Already had enough well-rated ideas")];
  if (project.recommendableAfter !== null) {
    const change = project.recommendableAfter === project.recommendableBefore ? "" : ` (was ${ project.recommendableBefore })`;
    parts.push(`${ pluralize(project.recommendableAfter, "recommendable idea") }${ change }`);
  }
  const addedTaskCount = project.relatedTasksAfter === null ? 0 : project.relatedTasksAfter - project.relatedTasksBefore;
  if (addedTaskCount > 0) parts.push(`${ pluralize(addedTaskCount, "more related task") }`);
  return `"${ project.name }": ${ parts.join("; ") }.`;
}
