// A sample AI provider for the style guide's Plan Builder: it answers each Plan Builder prompt with plausible canned
// JSON after a short delay, so every page, loading state, and proposal can be seen without an API key. It reads the
// identities the prompt lists (intents, tasks) so its proposals link up the way a real model's would.

// Long enough to see each loading state, short enough not to wait on
const SAMPLE_RESPONSE_DELAY_MILLISECONDS = 900;
// Projects proposed from the sample tasks, each citing the tasks whose text matches its pattern
const SAMPLE_PROJECTS = [
  { pattern: /report/i, substantiation: "Generating the report would settle both reporting tasks without writing either one.",
    summary: "Automate the weekly report" },
  { pattern: /engineer/i, substantiation: "Both hiring tasks lead to the same hire, so they belong to one project.",
    summary: "Hire a second engineer" },
  { pattern: /invoice/i, substantiation: "The invoice tasks recur monthly; one billing routine would end the chasing.",
    summary: "Set up a monthly billing routine" },
];
const SAMPLE_INTENTS = {
  personal: [
    { confidence: 5, intent: "Write the newsletter every month", substantiation: "Newsletter drafts recur monthly." },
    { confidence: 3, intent: "Take a real week off this quarter", substantiation: "No time off appears since July." },
    { confidence: 3, intent: "Read one book a month", substantiation: "Reading notes appear now and then." },
  ],
  work: [
    { confidence: 7, intent: "Ship the analytics offering", substantiation: "Analytics and reporting tasks dominate." },
    { confidence: 6, intent: "Hire a second engineer", substantiation: "Hiring tasks appear across two months." },
    { confidence: 4, intent: "Put billing on a routine", substantiation: "Invoices are reconciled by hand each month." },
  ],
};
const SAMPLE_THEMES = [ { label: "Reporting", taskCount: 3 }, { label: "Hiring", taskCount: 2 },
  { label: "Billing", taskCount: 2 }, { label: "Newsletter", taskCount: 1 } ];

// ----------------------------------------------------------------------------------------------
// @desc Answer a Plan Builder prompt the way the real provider race would, after a short delay.
// @param {string} prompt - The rendered prompt.
// @returns {Promise<Object|null>} The parsed response, or null for a prompt this sample does not cover (the Plan
//   Builder treats that as "no result", as it would a provider that answered nothing).
export async function samplePlanProvider(prompt) {
  await new Promise(resolve => setTimeout(resolve, SAMPLE_RESPONSE_DELAY_MILLISECONDS));
  if (prompt.includes('"mergedProjects"')) return { mergedProjects: [] };
  if (prompt.includes('"prospects"')) return { prospects: sampleProspectsFromPrompt(prompt) };
  if (prompt.includes('"themes"')) {
    return { occupationHypothesis: "Runs a small analytics product", personal: SAMPLE_INTENTS.personal,
      themes: SAMPLE_THEMES, work: SAMPLE_INTENTS.work };
  }
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Projects for a discovery prompt: one per sample project whose tasks the prompt lists, citing those tasks
//   and the first chosen intent of the category.
// @param {string} prompt - The discovery prompt, listing intents as "- [uuid] (work) text" and tasks as
//   "- [uuid] text".
// @returns {Array<Object>} Prospects in the shape the discovery prompt asks for.
function sampleProspectsFromPrompt(prompt) {
  const goalUuid = (prompt.match(/^- \[([^\]]+)\] \(work\) /m) || [])[1];
  const taskLines = [ ...prompt.matchAll(/^- \[([^\]]+)\] (?!\((?:work|personal)\))(.+)$/gm) ];
  return SAMPLE_PROJECTS.map(project => ({ focusMonths: [], linkedGoalUuids: goalUuid ? [ goalUuid ] : [],
    resolvedTaskUuids: [ ...new Set(taskLines.filter(line => project.pattern.test(line[2])).map(line => line[1])) ],
    substantiations: [ project.substantiation ], summary: project.summary, userCategoryEm: "work" }))
    .filter(prospect => prospect.resolvedTaskUuids.length >= 2);
}
