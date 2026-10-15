// Turn a "Generate ideas" run snapshot into the text and states its progress window shows, so the window opened in an
// Amplenote prompt and the one drawn inside the Dashboard read the same words. Host-compatible: no React or DOM.
import { pluralize } from "app-util";
import { IDEA_ACTIONABILITY_MINIMUM, IDEA_RELEVANCE_MINIMUM } from "dashboard/project-tasks/project-task-idea-ratings";

// ----------------------------------------------------------------------------------------------
// @desc Describe a run snapshot for its progress window.
// @param {object|null} snapshot - From IdeaGenerationRun#snapshot or pendingRunSnapshot; null when the run is unknown.
// @returns {object} An object with the following properties:
//   - {string} etaLabel - Such as "About 4 min left", "Finishing up…", or "Done"
//   - {boolean} finished - True once the summary is written
//   - {boolean} found - False when the snapshot is unknown, as after the plugin restarted
//   - {Array<string>} progressLines - What the run has found and done so far, from ideaRunProgressLines
//   - {number|null} quotaPercent - Whole percent of the Agent Pro quota consumed; null hides the meter
//   - {Array<string>} statusParts - Such as ["Run 1 of 2 max per day", "Consumed 38% of Agent Pro quota"]
//   - {Array<object>} steps - { label, number, state } in order
//   - {Array<string>} summaryLines - Plain sentences describing the summary; empty until finished
//   - {string} title - The window's title
export function ideaRunProgressView(snapshot) {
  if (!snapshot) {
    return { etaLabel: "", finished: false, found: false, progressLines: [], quotaPercent: null, statusParts: [], steps: [],
      summaryLines: [], title: "Idea generation" };
  }
  const quotaPercent = Number.isFinite(snapshot.quotaUsedFraction) ? Math.round(snapshot.quotaUsedFraction * 100) : null;
  const statusParts = [];
  if (snapshot.allowance) statusParts.push(`Run ${ snapshot.allowance.runNumber } of ${ snapshot.allowance.maximum } max per day`);
  if (quotaPercent !== null) statusParts.push(`Consumed ${ quotaPercent }% of Agent Pro quota`);
  const steps = (snapshot.steps || []).map((step, index) => ({ label: step.label, number: index + 1, state: step.state }));
  const summaryLines = snapshot.summary ? ideaRunSummaryLines(snapshot.summary) : [];
  const progressLines = snapshot.progress ? ideaRunProgressLines(snapshot.progress, snapshot.steps || []) : [];
  return { etaLabel: etaLabel(snapshot), finished: !!snapshot.finished, found: true, progressLines, quotaPercent, statusParts, steps,
    summaryLines, title: snapshot.title };
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
// @desc Say what a run has found and done so far, one sentence per subject in the order the steps reach them: the new
//   terms being defined, the terms being defined better, the projects ideas are generated for, how many new ideas met
//   the recommendation bar once rated, and how many suggestions are eligible to recommend. A subject the run has not
//   reached yet is left out, except that discovery says it is looking while the first step runs.
// @param {object} progress - From IdeaGenerationRun#snapshot: { foundTerms, ideaProjects, refiningTerms, storeCounts }.
// @param {Array<object>} steps - { key, state } from the same snapshot.
// @returns {Array<string>} Sentences.
export function ideaRunProgressLines({ foundTerms, ideaProjects, refiningTerms, storeCounts }, steps) {
  const stateByKey = Object.fromEntries(steps.map(step => [step.key, step.state]));
  const reached = stepKey => stateByKey[stepKey] && stateByKey[stepKey] !== "waiting";
  const lines = [];
  if (foundTerms === null && stateByKey.refine === "active") lines.push("Looking through your projects for new terms to define…");
  if (foundTerms?.count) lines.push(`Defining ${ pluralize(foundTerms.count, "new term") }, such as ${ _quotedList(foundTerms) }.`);
  if (foundTerms && !foundTerms.count) lines.push("Found no new terms to define.");
  if (refiningTerms?.count) {
    const refinedText = refiningTerms.refinedCount ? `; ${ refiningTerms.refinedCount } refined so far` : "";
    lines.push(`Better defining ${ pluralize(refiningTerms.count, "term") }, such as ${ _quotedList(refiningTerms) }${ refinedText }.`);
  }
  if (ideaProjects?.count) lines.push(`Generating ideas for ${ pluralize(ideaProjects.count, "project") }: ${ _quotedList(ideaProjects) }.`);
  const counts = storeCounts || {};
  if (reached("ideas") && counts.newIdeaCount) lines.push(_ratedIdeasLine(counts));
  if (reached("rate") || stateByKey.summarize === "done") {
    const eligibleCount = counts.eligibleTaskCount + counts.eligibleIdeaCount;
    lines.push(`${ pluralize(eligibleCount, "suggestion") } eligible to recommend: ${ counts.eligibleTaskCount } of your tasks and `
      + `${ pluralize(counts.eligibleIdeaCount, "generated idea") }.`);
  }
  return lines;
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

// ----------------------------------------------------------------------------------------------
// @desc Say how many of the run's new ideas have been rated and how many of those met the recommendation bar.
// @param {object} counts - From ideaRunStoreCounts.
// @returns {string} Such as "7 of 10 rated new ideas met the bar (actionability 7+, relevance 6+); 3 still awaiting a rating."
function _ratedIdeasLine({ newEligibleIdeaCount, newIdeaCount, newRatedIdeaCount }) {
  const bar = `actionability ${ IDEA_ACTIONABILITY_MINIMUM }+, relevance ${ IDEA_RELEVANCE_MINIMUM }+`;
  const awaitingCount = newIdeaCount - newRatedIdeaCount;
  const awaitingText = awaitingCount ? `; ${ awaitingCount } still awaiting a rating` : "";
  if (!newRatedIdeaCount) return `Received ${ pluralize(newIdeaCount, "new idea") }, awaiting ratings (${ bar }).`;
  return `${ newEligibleIdeaCount } of ${ pluralize(newRatedIdeaCount, "rated new idea") } met the bar (${ bar })${ awaitingText }.`;
}

// ----------------------------------------------------------------------------------------------
// @desc Quote a few example names, naming how many more there are.
// @param {object} listed - { count, examples }.
// @returns {string} Such as '"Roadmap", "Jots" and 2 more' or '"Roadmap" and "Jots"'.
function _quotedList({ count, examples }) {
  const quoted = examples.map(name => `"${ name }"`);
  const moreCount = count - examples.length;
  if (moreCount > 0) return `${ quoted.join(", ") } and ${ moreCount } more`;
  if (quoted.length < 2) return quoted.join("");
  return `${ quoted.slice(0, -1).join(", ") } and ${ quoted[quoted.length - 1] }`;
}
