// Define agenda priorities and their generation instructions.
export const CUSTOM_PRIORITY_PREFIX = "custom:";
export const MAX_CUSTOM_PRIORITY_LENGTH = 240;

// ----------------------------------------------------------------------------------------------
// @desc The selectable "Today's priority" lenses. Each carries the label shown in the widget dropdown and the
//   instruction injected into the schedule prompt so the LLM biases the day toward that intent. A "barnacle"
//   is a task that has lingered on the to-do list for an unusually long time.
export const PROPOSED_AGENDA_PRIORITY_OPTIONS = [
  { instruction: "Prioritize tasks that directly advance the user's quarterly plan and stated goals. Sequence the "
    + "highest-leverage goal work into the most productive parts of the day so measurable progress is made.",
    description: "Front-loads the one task that moves a quarterly goal.", key: "goal-progress", label: "Goal progress" },
  { description: "One long block. Everything shallow waits behind it.",
    instruction: "Protect a sustained block for demanding, high-value focus work. Group shallow tasks after it.",
    key: "deep-work", label: "Deep work" },
  { barnacle: true, description: "Overdue and under-ten-minute tasks first.",
    instruction: "Prioritize 'barnacle' tasks — tasks that have lingered on the to-do list for an unusually long "
    + "time. Strongly prefer tasks drawn from notes that carry hundreds of open tasks, because those large "
    + "backlogs are where barnacles accumulate. The goal of today is to finally clear long-stale obligations.",
    displayLabel: "Clear the decks", key: "barnacle-cleanup", label: "Barnacle cleanup" },
  { description: "Replies, intros, and the people you owe.",
    instruction: "Prioritize overdue replies, thoughtful introductions, and commitments to other people.",
    key: "relationships", label: "Relationships" },
  { description: "A lighter day. Nothing needing a running start.",
    instruction: "Assume the user has low energy today. Favor light, short, low-cognitive-load tasks; avoid "
    + "demanding deep-focus work, and keep activities brief with generous recovery breaks between them.",
    key: "low-energy", label: "Low energy" },
  { description: "Invest in work whose value compounds over time.",
    instruction: "Prioritize tasks whose payoff compounds over the long term — learning, systems, automation, "
    + "documentation, and relationships — even when they feel less urgent than today's noise.",
    key: "long-term-benefit", label: "Long-term benefit" },
  { description: "Make room for energizing work and satisfying wins.",
    instruction: "Prioritize tasks the user is most likely to find energizing and enjoyable. Sequence the day to "
    + "sustain motivation and positive momentum, front-loading a satisfying early win.",
    key: "happiness-maximizer", label: "Happiness maximizer" },
];

export const DEFAULT_PRIORITY_KEY = PROPOSED_AGENDA_PRIORITY_OPTIONS[0].key;

// ----------------------------------------------------------------------------------------------
// @desc Resolve built-in or bounded custom priorities, falling back to the default for unknown keys.
// @param {string} priorityKey - A built-in key or a custom: prefix followed by the day description.
// @returns {object} The matching priority option.
export function priorityOptionFromKey(priorityKey) {
  if (typeof priorityKey === "string" && priorityKey.startsWith(CUSTOM_PRIORITY_PREFIX)) {
    const description = priorityKey.slice(CUSTOM_PRIORITY_PREFIX.length).trim().slice(0, MAX_CUSTOM_PRIORITY_LENGTH);
    if (description) return { description, instruction: `Plan the day around this user priority: ${ description }`,
      key: `${ CUSTOM_PRIORITY_PREFIX }${ description }`, label: "Custom priority" };
  }
  return PROPOSED_AGENDA_PRIORITY_OPTIONS.find(option => option.key === priorityKey)
    || PROPOSED_AGENDA_PRIORITY_OPTIONS[0];
}
