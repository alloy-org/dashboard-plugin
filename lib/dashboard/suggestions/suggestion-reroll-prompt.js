// Ask the user how to re-roll the calendar's suggestions, in an Amplenote prompt whose embed lists the focuses and the
// quarter projects they can boost. The prompt resolves with the choice the embed last stored, or with nothing when the
// user keeps the current suggestions.
import { agendaRankingProjects } from "dashboard/proposed-agenda/proposed-agenda-service";
import { DEFAULT_REROLL_FOCUS_KEY, MAXIMUM_BOOSTED_PROJECTS, rerollFocusFromKey } from "dashboard/suggestions/suggestion-reroll-store";
import { SUGGESTION_REROLL_VIEW, suggestionRerollValue } from "suggestion-reroll-embed";
import { logIfEnabled } from "util/log";

const KEEP_CURRENT_ACTION = Object.freeze({ label: "Keep current", value: "keepCurrent" });
const REROLL_PRIMARY_ACTION = Object.freeze({ label: "Re-roll suggestions" });
const REROLL_PROMPT_LOG_LABEL = "[suggestion-reroll-prompt]";

// ----------------------------------------------------------------------------------------------
// @desc Show the re-roll prompt and read the user's choice. Projects set to "not now" are not offered, and a boosted
//   project the prompt names that was not offered is ignored.
// @param {object} app - Amplenote app bridge, with prompt.
// @param {object} options - { days, domainName, domainUuid }: days are the local midnights the re-roll would plan.
// @returns {Promise<object|null>} { focus, projectNames, projectUuids }, focus being a REROLL_FOCUS_OPTIONS entry, or
//   null when the user kept the current suggestions or the prompt could not be shown.
export async function promptedRerollChoice(app, { days, domainName, domainUuid }) {
  const projects = await _boostableProjects(app, { domainName, domainUuid, targetDate: days[0] });
  const initialValue = { dayLabel: _dayRangeLabel(days), focusKey: DEFAULT_REROLL_FOCUS_KEY, projectUuids: [], projects,
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
  const chosenValue = suggestionRerollValue(resultValues) || initialValue;
  const nameByUuid = new Map(projects.map(project => [project.uuid, project.name]));
  const offeredUuids = (chosenValue.projectUuids || []).filter(projectUuid => nameByUuid.has(projectUuid));
  const projectUuids = offeredUuids.slice(0, MAXIMUM_BOOSTED_PROJECTS);
  const projectNames = projectUuids.map(projectUuid => nameByUuid.get(projectUuid));
  const focus = rerollFocusFromKey(chosenValue.focusKey);
  logIfEnabled(`${ REROLL_PROMPT_LOG_LABEL } re-roll chosen`, { focusKey: focus.key, projectCount: projectUuids.length });
  return { focus, projectNames, projectUuids };
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
