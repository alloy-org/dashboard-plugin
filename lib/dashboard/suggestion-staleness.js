// Decide which pending suggestions no longer stand because the user acted on them outside the agenda: an existing task
// that was completed, dismissed, or deleted, or a new-task idea the user accepted from the calendar, which Amplenote
// turns into a task in the idea's note without telling the plugin. A calendar pass records when it generated
// suggestions, so a pass for the same days within RECENT_GENERATION_WINDOW_SECONDS re-checks only the suggestions
// whose notes changed since then.
import { SETTING_KEYS } from "constants/settings";
import { IDEA_STATUSES, ideaComparisonKey } from "project-idea-records";
import { suggestionCandidateId } from "quarter-project-task-candidates";
import { timestampMsFromValue } from "shared-notes-service";
import { logIfEnabled } from "util/log";

// How long after a calendar pass the next one may confine its checks to the notes changed since.
export const RECENT_GENERATION_WINDOW_SECONDS = 3 * 60 * 60;

const STALENESS_LOG_LABEL = "[suggestion-staleness]";
// Changed notes read before giving up on confining the check; past this, every suggestion is checked.
const MAX_CHANGED_NOTES_SCANNED = 500;
// Shortest comparison key that may match a longer task by prefix, so a short idea cannot match unrelated tasks.
const MIN_PREFIX_MATCH_CHARS = 20;
const PENDING_STATUS = "pending";

// ----------------------------------------------------------------------------------------------
// @desc The notes changed since the previous calendar pass, when that pass covered every requested day and finished
//   within RECENT_GENERATION_WINDOW_SECONDS. Anything else returns null, which tells the caller to check every
//   suggestion: no record, an older one, a day the previous pass did not verify, or a note list that cannot be trusted.
// @param {object} app - Amplenote app bridge, with settings and filterNotes.
// @param {object} options - { dayKeys, nowSeconds }: dayKeys are the Date#toDateString keys this pass will plan.
// @returns {Promise<Set<string>|null>} UUIDs of notes changed since the previous pass, or null.
export async function changedNoteUuidsSinceLastGeneration(app, { dayKeys, nowSeconds }) {
  const previous = _previousGeneration(app);
  if (!previous) return null;
  const elapsedSeconds = nowSeconds - previous.generatedAtSeconds;
  if (elapsedSeconds < 0 || elapsedSeconds > RECENT_GENERATION_WINDOW_SECONDS) return null;
  const previousDayKeys = new Set(previous.dayKeys);
  if (!(dayKeys || []).every(dayKey => previousDayKeys.has(dayKey))) return null;
  const changedNoteUuids = await _changedNoteUuids(app, previous.generatedAtSeconds);
  logIfEnabled(`${ STALENESS_LOG_LABEL } notes changed since previous pass`, { changedCount: changedNoteUuids?.size ?? null, elapsedSeconds });
  return changedNoteUuids;
}

// ----------------------------------------------------------------------------------------------
// @desc Record that a calendar pass generated and verified suggestions for these days, as of when it started.
// @param {object} app - Amplenote app bridge, with setSetting.
// @param {object} options - { dayKeys, generatedAtSeconds }.
// @returns {Promise<void>}
export async function recordSuggestionGeneration(app, { dayKeys, generatedAtSeconds }) {
  if (typeof app.setSetting !== "function") return;
  await app.setSetting(SETTING_KEYS.CALENDAR_SUGGESTIONS_GENERATED, JSON.stringify({ dayKeys, generatedAtSeconds }));
}

// ----------------------------------------------------------------------------------------------
// @desc Find the pending suggestions the user has already acted on. An existing task is stale when getTask finds it
//   missing, completed, or dismissed. An idea is stale when its note now holds a task with the idea's wording, done or
//   not, because accepting it from the calendar created that task; the idea is returned with the task it became so the
//   caller can record it as accepted. Only suggestions from changedNoteUuids are checked when that set is given.
// @param {object} app - Amplenote app bridge, with getTask and getNoteTasks.
// @param {Array<object>} activities - Suggestions carrying scheduledEm, isExisting, taskUuid, ideaId, noteUuid, title.
// @param {object} [options] - { changedNoteUuids }: null checks every pending suggestion.
// @returns {Promise<object>} { acceptedIdeas, staleKeys }: acceptedIdeas are { acceptedTaskUuid, ideaId, projectUuid,
//   status } decisions; staleKeys are suggestionIdentityKey values to drop.
export async function staleSuggestionReview(app, activities, { changedNoteUuids = null } = {}) {
  const pendingActivities = (activities || []).filter(activity => (activity.scheduledEm || PENDING_STATUS) === PENDING_STATUS);
  const inScope = activity => !changedNoteUuids || !activity.noteUuid || changedNoteUuids.has(activity.noteUuid);
  const checkedActivities = pendingActivities.filter(inScope);
  const noteTasksFor = _noteTasksLoader(app);
  const outcomes = await Promise.all(checkedActivities.map(activity => _staleOutcome(app, activity, noteTasksFor)));
  const staleOutcomes = outcomes.filter(Boolean);
  const staleKeys = new Set(staleOutcomes.map(outcome => outcome.key));
  const acceptedIdeas = staleOutcomes.map(outcome => outcome.acceptedIdea).filter(Boolean);
  if (staleKeys.size) logIfEnabled(`${ STALENESS_LOG_LABEL } stale suggestions`, { acceptedIdeaCount: acceptedIdeas.length,
    checkedCount: checkedActivities.length, staleCount: staleKeys.size });
  return { acceptedIdeas, staleKeys };
}

// ----------------------------------------------------------------------------------------------
// @desc The identity two suggestions share when they would ask the user to do the same thing: the candidate ID of a
//   task or idea, else the wording of a suggestion that names neither.
// @param {object} record - Activity, ranked task, or reserve.
// @returns {string|null} "task:<uuid>", "idea:<ideaId>", "title:<words>", or null when nothing identifies it.
export function suggestionIdentityKey(record) {
  const candidateId = suggestionCandidateId(record);
  if (candidateId) return candidateId;
  const wording = ideaComparisonKey(record?.title || record?.taskText || "");
  return wording ? `title:${ wording }` : null;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc UUIDs of notes changed at or after a moment, read from the note list sorted most recently changed first. A
//   note handle with no changed time or a scan past MAX_CHANGED_NOTES_SCANNED gives null.
// @param {object} app - Amplenote app bridge.
// @param {number} sinceSeconds - Unix seconds of the previous pass.
// @returns {Promise<Set<string>|null>} Changed note UUIDs, or null when they cannot be listed reliably.
async function _changedNoteUuids(app, sinceSeconds) {
  if (typeof app.filterNotes !== "function") return null;
  const sinceMs = sinceSeconds * 1000;
  const noteUuids = new Set();
  let scannedCount = 0;
  for await (const noteHandle of (await app.filterNotes({}, "changed"))) {
    const changedMs = timestampMsFromValue(noteHandle?.changed);
    if (!changedMs) return null;
    if (changedMs < sinceMs) break;
    if (noteHandle.uuid) noteUuids.add(noteHandle.uuid);
    scannedCount += 1;
    if (scannedCount >= MAX_CHANGED_NOTES_SCANNED) return null;
  }
  return noteUuids;
}

// ----------------------------------------------------------------------------------------------
// @desc The task in a note that an idea became: one whose wording matches the idea's, or begins with it, since a task
//   accepted from the calendar keeps the suggestion's text.
// @param {object} activity - Idea suggestion with a title.
// @param {Array<object>} noteTasks - Tasks from getNoteTasks, done ones included.
// @returns {object|null} The matching task, or null.
function _ideaTaskFromNoteTasks(activity, noteTasks) {
  const ideaKey = ideaComparisonKey(activity.title || "");
  if (!ideaKey) return null;
  return (noteTasks || []).find(task => {
    const taskKey = ideaComparisonKey(task?.content || "");
    if (!taskKey) return false;
    if (taskKey === ideaKey) return true;
    const [shorterKey, longerKey] = taskKey.length < ideaKey.length ? [taskKey, ideaKey] : [ideaKey, taskKey];
    return shorterKey.length >= MIN_PREFIX_MATCH_CHARS && longerKey.startsWith(shorterKey);
  }) || null;
}

// ----------------------------------------------------------------------------------------------
// @desc A loader that reads each note's tasks, done ones included, at most once per review.
// @param {object} app - Amplenote app bridge.
// @returns {function} async (noteUuid) => Array of tasks, empty when the app cannot list note tasks.
function _noteTasksLoader(app) {
  const pendingByNoteUuid = new Map();
  return noteUuid => {
    if (!pendingByNoteUuid.has(noteUuid)) {
      const loaded = typeof app.getNoteTasks === "function"
        ? app.getNoteTasks({ uuid: noteUuid }, { includeDone: true })
        : Promise.resolve([]);
      pendingByNoteUuid.set(noteUuid, loaded);
    }
    return pendingByNoteUuid.get(noteUuid);
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Read the previous calendar pass's record from settings.
// @param {object} app - Amplenote app bridge.
// @returns {object|null} { dayKeys, generatedAtSeconds }, or null when absent or unreadable.
function _previousGeneration(app) {
  const stored = app.settings?.[SETTING_KEYS.CALENDAR_SUGGESTIONS_GENERATED];
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (!Number.isFinite(parsed?.generatedAtSeconds) || !Array.isArray(parsed.dayKeys)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Check one pending suggestion against the user's current tasks.
// @param {object} app - Amplenote app bridge.
// @param {object} activity - Pending suggestion.
// @param {function} noteTasksFor - From _noteTasksLoader.
// @returns {Promise<object|null>} { acceptedIdea, key } for a stale suggestion, else null.
async function _staleOutcome(app, activity, noteTasksFor) {
  const key = suggestionIdentityKey(activity);
  if (!key) return null;
  if (activity.taskUuid && activity.isExisting !== false) {
    if (typeof app.getTask !== "function") return null;
    const task = await app.getTask(activity.taskUuid);
    return !task || task.completedAt || task.dismissedAt ? { acceptedIdea: null, key } : null;
  }
  if (!activity.noteUuid) return null;
  const ideaTask = _ideaTaskFromNoteTasks(activity, await noteTasksFor(activity.noteUuid));
  if (!ideaTask) return null;
  const acceptedIdea = activity.ideaId && activity.projectUuid ? { acceptedTaskUuid: ideaTask.uuid || null,
    ideaId: activity.ideaId, projectUuid: activity.projectUuid, status: IDEA_STATUSES.accepted } : null;
  return { acceptedIdea, key };
}
