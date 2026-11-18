// A realistic day for the agenda model evaluation: five projects of the kind a GitClear founder's quarterly plan holds,
// each with existing tasks and generated ideas shaped as suggestionQuestions shows them to the ranker, and the benefit
// sentences the calendar tooltip asks for. Each ranking candidate carries a grade from 0 (should not be suggested today)
// to 3 (clearly one of today's best), so a contender's ranking can be scored without a person reading it. The grades
// follow the ranking prompt's own rules: a project's rationale for today, an Important mark, preferring a task that was
// not just suggested, and preferring an existing task over a comparable new idea.

// ----------------------------------------------------------------------------------------------
// @desc One existing-task candidate in the shape _candidateState builds.
// @param {string} uuid - Task UUID, prefixed to form the candidateId.
// @param {string} text - Task text.
// @param {number} score - Applicability score from 1 to 10.
// @param {object} [options] - { important, minutesSinceRecommended }.
// @returns {object} Candidate state.
function existingTask(uuid, text, score, { important = false, minutesSinceRecommended = null } = {}) {
  const candidate = { candidateId: `task:${ uuid }`, kind: "existing task", minutesSinceRecommended, score, text };
  if (important) candidate.userPriority = '[User deemed "Important"]';
  return candidate;
}

// ----------------------------------------------------------------------------------------------
// @desc One generated-idea candidate in the shape _candidateState builds.
// @param {string} ideaId - Idea identifier, prefixed to form the candidateId.
// @param {string} text - The proposed next action.
// @param {number} score - Relevance score from 1 to 10.
// @param {number} actionability - Actionability rating from 1 to 10.
// @returns {object} Candidate state.
function newIdea(ideaId, text, score, actionability) {
  return { actionability, candidateId: `idea:${ ideaId }`, kind: "new idea", minutesSinceRecommended: null, score, text };
}

const RANKING_STATE = { projects: {
  "Ship the Dashboard load-time fix": {
    rationale: "The quarterly plan commits to a Dashboard whose first open of the day renders in under 15 seconds. The fix is "
      + "written and needs verification before Friday's release, and Thursday is a day you chose to emphasize this project.",
    taskCandidates: [
      existingTask("agenda-verify", "Verify the Proposed Agenda's first-load timing on the dev server with a cold cache", 9,
        { important: true }),
      existingTask("agenda-commit", "Write the commit message for the stored-ranking change", 7),
      existingTask("agenda-rename", "Rename helpers in widget-mount-coordinator for consistency", 4),
      newIdea("agenda-timeline", "Add a Debug Console chart of each widget's render time", 5, 5),
    ] },
  "Diff Digest launch": {
    rationale: "The launch email goes out November 10. Landing page copy is the blocker: design is waiting on it.",
    taskCandidates: [
      existingTask("digest-copy", "Write landing page copy for the weekly code-change email", 9),
      existingTask("digest-send-day", "Pick the Diff Digest send day", 8, { minutesSinceRecommended: 20 }),
      newIdea("digest-subjects", "Draft three subject lines for the launch email and ask Sarah to pick one", 8, 9),
      existingTask("digest-vendors", "Research email deliverability vendors", 3),
    ] },
  "GitClear Q4 enterprise renewals": {
    rationale: "Two enterprise renewals close this month. Acme's procurement team needs its security questionnaire by "
      + "November 3, and the renewal stalls without it.",
    taskCandidates: [
      existingTask("renewal-questionnaire", "Complete Acme's security questionnaire", 9, { important: true }),
      existingTask("renewal-pipeline", "Update the renewal pipeline spreadsheet", 6),
      existingTask("renewal-pricing", "Think about pricing", 5),
    ] },
  "Run a half marathon in March": {
    rationale: "The training plan calls for a 6-mile run today, and Thursday is a day you chose to emphasize this project.",
    taskCandidates: [
      existingTask("run-six-miles", "6-mile run at an easy pace", 8),
      existingTask("run-shoes", "Buy new running shoes", 5, { minutesSinceRecommended: 1440 }),
    ] },
  "Home and errands": {
    rationale: "Loosely relevant today: nothing here has a deadline this week.",
    taskCandidates: [
      existingTask("home-furnace", "Schedule the furnace inspection before winter", 5),
      existingTask("home-dog-food", "Buy dog food", 3),
      existingTask("home-garage", "Organize the garage", 2),
    ] },
} };

// Grade of each candidate: 3 is one of today's clearest suggestions, 0 should not be suggested today.
const RANKING_GRADES = {
  "idea:agenda-timeline": 1,
  "idea:digest-subjects": 2,
  "task:agenda-commit": 2,
  "task:agenda-rename": 1,
  "task:agenda-verify": 3,
  "task:digest-copy": 3,
  "task:digest-send-day": 1,
  "task:digest-vendors": 0,
  "task:home-dog-food": 0,
  "task:home-furnace": 1,
  "task:home-garage": 0,
  "task:renewal-pipeline": 1,
  "task:renewal-pricing": 0,
  "task:renewal-questionnaire": 3,
  "task:run-shoes": 1,
  "task:run-six-miles": 2,
};

// The agenda's placed activities, as agendaWithBenefitRationales passes them to benefitRationalePrompt.
const BENEFIT_ACTIVITIES = [
  { projectSummary: "GitClear Q4 enterprise renewals", title: "Complete Acme's security questionnaire" },
  { projectSummary: "Diff Digest launch", title: "Write landing page copy for the weekly code-change email" },
  { projectSummary: "Ship the Dashboard load-time fix",
    title: "Verify the Proposed Agenda's first-load timing on the dev server with a cold cache" },
  { projectSummary: "Run a half marathon in March", title: "6-mile run at an easy pace" },
  { projectSummary: "Diff Digest launch", title: "Draft three subject lines for the launch email and ask Sarah to pick one" },
  { title: "Schedule the furnace inspection before winter" },
];

export const AGENDA_MODEL_EVAL_CASES = [
  { grades: RANKING_GRADES, kind: "rank", name: "founder-thursday-rank", state: RANKING_STATE },
  { activities: BENEFIT_ACTIVITIES, kind: "benefit", name: "founder-thursday-benefits" },
];
