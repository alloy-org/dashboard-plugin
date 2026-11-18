// Ask the user how to re-roll the calendar's suggestions, in an Amplenote prompt whose embed lists the focuses, the
// quarter projects they can boost, where suggestions come from, and whether weekends and evenings get suggestions. The prompt reads the choice the embed last sent,
// which the plugin remembers under the prompt's token, else the choice the prompt resolves with, and reads nothing when
// the user keeps the current suggestions.
import { agendaRankingProjects } from "dashboard/proposed-agenda/proposed-agenda-service";
import { DEFAULT_REROLL_FOCUS_KEY, DEFAULT_REROLL_SOURCE_KEY, MAXIMUM_BOOSTED_PROJECTS, rerollFocusFromKey,
  rerollSourceFromKey } from "dashboard/suggestions/suggestion-reroll-store";
import { rememberedSuggestionRerollChoice, SUGGESTION_REROLL_VIEW, suggestionRerollValue } from "suggestion-reroll-embed";
import { logIfEnabled } from "util/log";

const KEEP_CURRENT_ACTION = Object.freeze({ label: "Keep current", value: "keepCurrent" });
const REROLL_PRIMARY_ACTION = Object.freeze({ label: "Re-roll suggestions" });
const REROLL_PROMPT_LOG_LABEL = "[suggestion-reroll-prompt]";

// ----------------------------------------------------------------------------------------------
// @desc Show the re-roll prompt and read the user's choice. The choice the embed last sent for this prompt is read
//   first, since the host may resolve the prompt without the embed's latest arguments; failing that, the prompt's
//   result, and failing both, the defaults. Projects set to "not now" are not offered, and a boosted project the
//   choice names that was not offered is ignored, as is a choice of weekends when the calendar shows none.
// @param {object} app - Amplenote app bridge, with prompt.
// @param {object} options - { days, domainName, domainUuid, offersWeekends }: days are the local midnights the re-roll
//   would plan, and offersWeekends whether the calendar's window holds weekend days the re-roll could add.
// @returns {Promise<object|null>} { focus, includeEvenings, includeWeekends, projectNames, projectUuids, source }, focus
//   being a REROLL_FOCUS_OPTIONS entry and source a REROLL_SOURCE_OPTIONS entry, or null when the user kept the current
//   suggestions or the prompt could not be shown.
export async function promptedRerollChoice(app, { days, domainName, domainUuid, offersWeekends = false }) {
  const projects = await _boostableProjects(app, { domainName, domainUuid, targetDate: days[0] });
  const promptToken = `${ Date.now() }-${ Math.random().toString(36).slice(2) }`;
  const initialValue = { dayLabel: _dayRangeLabel(days), focusKey: DEFAULT_REROLL_FOCUS_KEY, includeEvenings: false,
    includeWeekends: false, offersWeekends, projectUuids: [], projects, promptToken, sourceKey: DEFAULT_REROLL_SOURCE_KEY,
    view: SUGGESTION_REROLL_VIEW };
  let result;
  try {
    result = await app.prompt("", { actions: [KEEP_CURRENT_ACTION], inputs: [{ type: "embed", value: initialValue }],
      primaryAction: REROLL_PRIMARY_ACTION });
  } catch (error) {
    logIfEnabled(`${ REROLL_PROMPT_LOG_LABEL } could not show the re-roll prompt`, error?.message);
    return null;
  }
  const resultValues = Array.isArray(result) ? result : [result];
  if (result == null || result?.embedCallFailed || resultValues.includes(KEEP_CURRENT_ACTION.value)) return null;
  const rememberedValue = rememberedSuggestionRerollChoice(promptToken);
  const resultValue = suggestionRerollValue(resultValues);
  const chosenValue = rememberedValue || resultValue || initialValue;
  const nameByUuid = new Map(projects.map(project => [project.uuid, project.name]));
  const offeredUuids = (chosenValue.projectUuids || []).filter(projectUuid => nameByUuid.has(projectUuid));
  const projectUuids = offeredUuids.slice(0, MAXIMUM_BOOSTED_PROJECTS);
  const projectNames = projectUuids.map(projectUuid => nameByUuid.get(projectUuid));
  const focus = rerollFocusFromKey(chosenValue.focusKey);
  const source = rerollSourceFromKey(chosenValue.sourceKey);
  const includeEvenings = Boolean(chosenValue.includeEvenings);
  const includeWeekends = offersWeekends && Boolean(chosenValue.includeWeekends);
  const choiceOrigin = rememberedValue ? "remembered" : (resultValue ? "promptResult" : "defaults");
  logIfEnabled(`${ REROLL_PROMPT_LOG_LABEL } re-roll chosen`, { choiceOrigin, focusKey: focus.key, includeEvenings, includeWeekends,
    projectCount: projectUuids.length, resultFocusKey: resultValue?.focusKey || null, sourceKey: source.key });
  return { focus, includeEvenings, includeWeekends, projectNames, projectUuids, source };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The live quarter projects the user can boost, as the prompt lists them. A read failure offers none, so the
//   user can still re-roll by focus.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { domainName, domainUuid, targetDate }.
// @returns {Promise<Array<object>>} { name, uuid } per project.
async function _boostableProjects(app, { domainName, domainUuid, targetDate }) {
  try {
    const projects = await agendaRankingProjects(app, { domainName, domainUuid, targetDate });
    const boostable = projects.filter(project => project?.uuid && project.priorityEm !== "notNow");
    return boostable.map(project => ({ name: project.summary || "Untitled project", uuid: project.uuid }));
  } catch (error) {
    logIfEnabled(`${ REROLL_PROMPT_LOG_LABEL } could not read the quarter's projects`, error?.message);
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A short label for the days a re-roll covers, such as "Mon" or "Mon–Thu".
// @param {Array<Date>} days - Local midnights, ascending.
// @returns {string} The label, empty without days.
function _dayRangeLabel(days) {
  if (!days?.length) return "";
  const weekdayLabel = day => day.toLocaleDateString([], { weekday: "short" });
  const firstLabel = weekdayLabel(days[0]);
  return days.length === 1 ? firstLabel : `${ firstLabel }–${ weekdayLabel(days[days.length - 1]) }`;
}
