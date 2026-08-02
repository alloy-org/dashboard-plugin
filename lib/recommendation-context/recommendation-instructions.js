// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Convert shared recommendation context into LLM prompt instructions.
// Prompt summary: "Give both Goal Coach and Proposed Agenda the same same-weekday, all-day event, and travel
//   research guidance when choosing activities."

const MAX_COMPLETION_PATTERNS_IN_PROMPT = 8;
const MAX_RESEARCH_NOTES_IN_PROMPT = 4;

// ----------------------------------------------------------------------------------------------
// @desc Build a human-readable LLM section from the shared day recommendation context.
// @param {object|null} context - Result from buildDayRecommendationContext.
// @param {object} [options={}] - { allowInventedTravelActivities, scheduleMode }.
// @returns {string} Prompt section, or empty string when no context is available.
export function recommendationInstructionsFromContext(context, { allowInventedTravelActivities = false,
    scheduleMode = false } = {}) {
  if (!context) return "";
  const sections = [];
  const eventSection = allDayEventInstructions(context, { allowInventedTravelActivities, scheduleMode });
  if (eventSection) sections.push(eventSection);
  const routineSection = sameWeekdayCompletionInstructions(context);
  if (routineSection) sections.push(routineSection);
  return sections.length ? `\n\n## Day-specific recommendation context\n${ sections.join("\n\n") }` : "";
}

// ----------------------------------------------------------------------------------------------
// @desc Whether the context indicates travel/vacation/conference handling should override routine instincts.
// @param {object|null} context - Result from buildDayRecommendationContext.
// @returns {boolean}
export function recommendationContextHasTravelOverride(context) {
  return !!context?.eventContext?.isTravelLike;
}

// ----------------------------------------------------------------------------------------------
// @desc Convert all-day event context into high-priority LLM guidance.
// @param {object} context - Shared context.
// @param {object} options - { allowInventedTravelActivities, scheduleMode }.
// @returns {string}
function allDayEventInstructions(context, { allowInventedTravelActivities, scheduleMode }) {
  const events = context.allDayEvents || [];
  if (events.length === 0) return "";
  const eventLines = events.map(event => `- ${ event.title }`).join("\n");
  const researchLines = (context.researchNotes || []).slice(0, MAX_RESEARCH_NOTES_IN_PROMPT).map(note =>
    `- ${ note.name } (${ note.matchedTerms.join(", ") }): ${ note.snippet }`).join("\n");
  if (recommendationContextHasTravelOverride(context)) {
    const inventedLine = allowInventedTravelActivities
      ? "In this travel/vacation mode, you MAY propose useful local activities even when no candidate task UUID exists; use null for taskUuid and explain why it fits the trip."
      : "If you propose a new idea inspired by travel research, use null for the task UUID only when this response format permits invented tasks.";
    return `All-day event override: the target day includes travel/vacation/conference context. This overrides ordinary weekday routines and historical project tendencies.
All-day events:
${ eventLines }
${ inventedLine }
${ scheduleMode ? "Keep the schedule light and realistic around travel logistics; avoid defaulting to normal work blocks unless the event is clearly work/conference time." : "Favor recommendations that respect the user's location, trip purpose, and available energy." }
${ researchLines ? `Relevant research notes:\n${ researchLines }` : "No matching research-note snippets were found; use generally popular local options only if the event title reveals a place or event." }`;
  }
  return `All-day events on the target day:
${ eventLines }
Treat these as day-level constraints. They do not occupy a specific clock range, but they should influence how ambitious or work-focused the recommendations are.`;
}

// ----------------------------------------------------------------------------------------------
// @desc Convert same-weekday completion counts into routine guidance for the LLM.
// @param {object} context - Shared context.
// @returns {string}
function sameWeekdayCompletionInstructions(context) {
  const patterns = (context.completionPatterns || []).slice(0, MAX_COMPLETION_PATTERNS_IN_PROMPT);
  if (patterns.length === 0) return "";
  const lines = patterns.map(pattern => `- ${ pattern.noteName } (${ pattern.noteUuid }): ${ pattern.completedCount } task(s) completed across ${ pattern.dates.join(", ") }`).join("\n");
  return `Same-weekday completion patterns from the past two weeks:
${ lines }
These note names often correspond to projects or responsibilities. Use them as a soft signal that similar work may fit this weekday, unless all-day travel/vacation/conference context above suggests a different kind of day.`;
}
