// [Claude claude-opus-4-8 (1M context)-authored file]
// Prompt summary: "today's priority options (Goal progress / Barnacle cleanup / Low energy / Long-term benefit /
//   Happiness maximizer), each mapped to an LLM instruction, plus the AI-provider chooser options"

// ----------------------------------------------------------------------------------------------
// @desc The selectable "Today's priority" lenses. Each carries the label shown in the widget dropdown and the
//   instruction injected into the schedule prompt so the LLM biases the day toward that intent. A "barnacle"
//   is a task that has lingered on the to-do list for an unusually long time.
// [Claude claude-opus-4-8 (1M context)] Task: enumerate Today's-priority options and their LLM instructions
export const PROPOSED_AGENDA_PRIORITY_OPTIONS = [
  { instruction: "Prioritize tasks that directly advance the user's quarterly plan and stated goals. Sequence the "
    + "highest-leverage goal work into the most productive parts of the day so measurable progress is made.",
    key: "goal-progress", label: "Goal progress" },
  { barnacle: true,
    instruction: "Prioritize 'barnacle' tasks — tasks that have lingered on the to-do list for an unusually long "
    + "time. Strongly prefer tasks drawn from notes that carry hundreds of open tasks, because those large "
    + "backlogs are where barnacles accumulate. The goal of today is to finally clear long-stale obligations.",
    key: "barnacle-cleanup", label: "Barnacle cleanup" },
  { instruction: "Assume the user has low energy today. Favor light, short, low-cognitive-load tasks; avoid "
    + "demanding deep-focus work, and keep activities brief with generous recovery breaks between them.",
    key: "low-energy", label: "Low energy" },
  { instruction: "Prioritize tasks whose payoff compounds over the long term — learning, systems, automation, "
    + "documentation, and relationships — even when they feel less urgent than today's noise.",
    key: "long-term-benefit", label: "Long-term benefit" },
  { instruction: "Prioritize tasks the user is most likely to find energizing and enjoyable. Sequence the day to "
    + "sustain motivation and positive momentum, front-loading a satisfying early win.",
    key: "happiness-maximizer", label: "Happiness maximizer" },
];

export const DEFAULT_PRIORITY_KEY = PROPOSED_AGENDA_PRIORITY_OPTIONS[0].key;

// ----------------------------------------------------------------------------------------------
// @desc The AI providers offered when the user changes the agenda's model, each with a one-line note on what
//   that provider is known to excel at. `providerEm` is the provider bucket understood by the service.
// [Claude claude-opus-4-8 (1M context)] Task: provider options for the change-model prompt
export const PROPOSED_AGENDA_PROVIDER_OPTIONS = [
  { description: "Claude — nuanced reasoning, careful instruction-following, and strong writing.",
    label: "Anthropic", providerEm: "anthropic" },
  { description: "GPT — well-rounded general performance with the broadest tooling ecosystem.",
    label: "OpenAI", providerEm: "openai" },
  { description: "Gemini — very large context windows and strong long-document / multimodal handling.",
    label: "Google", providerEm: "gemini" },
  { description: "DeepSeek — cost-efficient, with strong coding and math reasoning.",
    label: "DeepSeek", providerEm: "deepseek" },
];

// ----------------------------------------------------------------------------------------------
// @desc Resolve a priority option by key, falling back to the default priority when the key is unknown.
// @param {string} priorityKey - One of PROPOSED_AGENDA_PRIORITY_OPTIONS[].key.
// @returns {object} The matching priority option.
// [Claude claude-opus-4-8 (1M context)] Task: look up a priority option (with default fallback)
export function priorityOptionFromKey(priorityKey) {
  return PROPOSED_AGENDA_PRIORITY_OPTIONS.find(option => option.key === priorityKey)
    || PROPOSED_AGENDA_PRIORITY_OPTIONS[0];
}
