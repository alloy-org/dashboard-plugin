// Choose the projects that deserve a task today, and the candidates each of them offers: the tasks already stored
// for it and its generated ideas rated actionable enough to compete with them. Three sets qualify: a weekday affinity
// that includes today, a Focus / Keep warm (or month focus) project with no weekday chosen, and a project whose
// deadline falls in the coming week. Each set contributes a sentence to the rationale Jev, or the generative model,
// reads before it ranks that project's candidates.
import QuarterProject from "quarter-project";

const CADENCE_PRIORITIES = ["monthFocus", "quarterFocus", "stayWarm"];
const COMING_WEEK_DAYS = 7;
const PACE_PHRASES = { deadlineSprint: "on a deadline sprint", maintenanceOnly: "as maintenance",
  oneSubstantialBlock: "once per week", smallMoveMostDays: "most days", twoFocusedBlocks: "twice per week" };
const PRIORITY_SENTENCES = {
  monthFocus: "The user picked this as a month focus.",
  quarterFocus: "The user picked this as a 'Focus' emphasis for the current quarter.",
  stayWarm: "The user picked this as a 'Keep warm' emphasis.",
};
const WEEKDAY_ENUMS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ----------------------------------------------------------------------------------------------
// @desc Build the nested projects a ranker receives. A project offering no candidate is left out.
// @param {object} options - An object with the following properties:
//   - {Set<string>|null} [excludeIds] - Task UUIDs or candidate IDs already on screen or dismissed this pass
//   - {Date} now - The day being planned
//   - {Array<object>|null} [openTasks] - Open tasks, used for duration and note identity when present
//   - {Array<object>} projects - Live projects, with priority, pace, weekdays, deadline, and completion evidence
//   - {Array<object>} [storedRecords] - Project task store records, the source of each project's tasks and ideas
// @returns {Array<object>} { emphasizedWeekday, projectUuid, rationale, summary, taskCandidates }: emphasizedWeekday
//   names today ("Tuesday") when the user chose it as one of the project's days, else null; taskCandidates as
//   QuarterProject#taskCandidates returns them.
export function dayProjectGroups({ excludeIds = null, now, openTasks = null, projects, storedRecords = [] }) {
  const weekday = WEEKDAY_ENUMS[now.getDay()];
  const openTaskByUuid = _openTasksByUuid(openTasks);
  const groups = [];
  for (const project of _projectsWithStoredTasks(projects, storedRecords)) {
    const reasons = _qualificationReasons(project, now, weekday);
    if (!reasons.length) continue;
    const taskCandidates = project.taskCandidates({ excludeIds, now, openTaskByUuid });
    if (!taskCandidates.length) continue;
    const emphasizedWeekday = reasons.includes("weekday") ? _weekdayLabel(weekday, false) : null;
    groups.push({ emphasizedWeekday, projectUuid: project.uuid, rationale: _projectRationale(project, reasons, weekday),
      summary: project.summary || "Untitled project", taskCandidates });
  }
  return groups;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a YYYY-MM-DD deadline falls on today or within the following week.
// @param {string|null} deadlineOn - Calendar date.
// @param {Date} now - The day being planned.
// @returns {boolean} True when the deadline is inside the coming week.
export function deadlineWithinComingWeek(deadlineOn, now) {
  if (!deadlineOn || !/^\d{4}-\d{2}-\d{2}$/.test(deadlineOn)) return false;
  const deadline = new Date(`${ deadlineOn }T00:00:00`);
  if (!Number.isFinite(deadline.getTime())) return false;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const latest = new Date(start);
  latest.setDate(latest.getDate() + COMING_WEEK_DAYS);
  return deadline >= start && deadline <= latest;
}

// ----------------------------------------------------------------------------------------------
// @desc Join the store's task lists onto the live projects: guide fields win, and the store supplies the fields it
//   owns. A stored project the guide does not hold is qualified as the store has it.
// @param {Array<QuarterProject|object>} projects - Live projects.
// @param {Array<QuarterProject|object>} storedRecords - Projects from the project task store.
// @returns {Array<QuarterProject>} Projects that can be qualified and ranked.
function _projectsWithStoredTasks(projects, storedRecords) {
  const merged = new Map();
  for (const project of projects || []) {
    if (project?.uuid) merged.set(project.uuid, QuarterProject.from(project));
  }
  for (const record of storedRecords || []) {
    const stored = QuarterProject.from(record);
    const existing = merged.get(stored.uuid);
    if (existing) existing.adoptStoreFields(stored);
    else merged.set(stored.uuid, stored);
  }
  return [...merged.values()];
}

// ----------------------------------------------------------------------------------------------
// @desc Name which of the three inclusion rules a project meets today.
// @param {object} project - Project record.
// @param {Date} now - The day being planned.
// @param {string} weekday - Lowercase weekday enum for `now`.
// @returns {Array<string>} Reason codes: "weekday", "cadence", "deadline".
function _qualificationReasons(project, now, weekday) {
  if (project.priorityEm === "notNow") return [];
  const reasons = [];
  const weekdays = project.preferredWeekdays || [];
  if (weekdays.includes(weekday)) reasons.push("weekday");
  if (!weekdays.length && _hasOpenCadence(project)) reasons.push("cadence");
  if (deadlineWithinComingWeek(project.deadlineOn, now)) reasons.push("deadline");
  return reasons;
}

// ----------------------------------------------------------------------------------------------
// @desc A project with no weekday chosen still qualifies when the user set a priority or a weekly pace.
// @param {object} project - Project record.
// @returns {boolean} True when a cadence is set.
function _hasOpenCadence(project) {
  if (CADENCE_PRIORITIES.includes(project.priorityEm)) return true;
  if (project.priorityEm) return false;
  return Boolean(project.paceEm || project.blocksPerWeek);
}

// ----------------------------------------------------------------------------------------------
// @desc Sentences that tell the ranker why this project should be the one that contributes a task.
// @param {object} project - Project record, including completion evidence when it has been computed.
// @param {Array<string>} reasons - Codes from _qualificationReasons.
// @param {string} weekday - Today's weekday enum.
// @returns {string} The rationale paragraph.
function _projectRationale(project, reasons, weekday) {
  const sentences = [];
  if (reasons.includes("weekday")) sentences.push(_weekdaySentence(project.preferredWeekdays, weekday));
  if (PRIORITY_SENTENCES[project.priorityEm]) sentences.push(PRIORITY_SENTENCES[project.priorityEm]);
  if (reasons.includes("cadence")) sentences.push(_paceSentence(project));
  if (reasons.includes("deadline")) sentences.push(_deadlineSentence(project.deadlineOn));
  if (Number.isFinite(project.completedThisWeek)) sentences.push(_completionSentence(project.completedThisWeek));
  return sentences.join(" ");
}

// ----------------------------------------------------------------------------------------------
// @desc "This project is scheduled for Tuesdays and today is Tuesday."
// @param {Array<string>} weekdays - Preferred weekday enums.
// @param {string} today - Today's weekday enum.
// @returns {string} One sentence.
function _weekdaySentence(weekdays, today) {
  const labels = (weekdays || []).map(weekday => _weekdayLabel(weekday, true));
  const listed = labels.length > 1 ? `${ labels.slice(0, -1).join(", ") } and ${ labels[labels.length - 1] }` : labels[0];
  return `This project is scheduled for ${ listed } and today is ${ _weekdayLabel(today, false) }.`;
}

// ----------------------------------------------------------------------------------------------
// @desc Title-case a weekday enum, optionally pluralized the way a schedule reads ("Tuesdays").
// @param {string} weekday - Lowercase weekday enum.
// @param {boolean} plural - When true, append "s".
// @returns {string} Display label.
function _weekdayLabel(weekday, plural) {
  const titled = `${ weekday.charAt(0).toUpperCase() }${ weekday.slice(1) }`;
  return plural ? `${ titled }s` : titled;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe a weekly pace chosen without pinning it to a weekday.
// @param {object} project - Project record.
// @returns {string} One sentence.
function _paceSentence(project) {
  const phrase = PACE_PHRASES[project.paceEm] || _phraseFromBlocks(project.blocksPerWeek);
  return `User chose to work on this ${ phrase } without a day of week specified.`;
}

// ----------------------------------------------------------------------------------------------
// @desc A pace phrase from a weekly block count when the pace enum itself was not stored.
// @param {number|null} blocksPerWeek - Chosen blocks per week.
// @returns {string} A short rhythm phrase.
function _phraseFromBlocks(blocksPerWeek) {
  if (blocksPerWeek === 1) return "once per week";
  if (blocksPerWeek === 2) return "twice per week";
  if (blocksPerWeek >= 5) return "most days";
  if (blocksPerWeek) return `${ blocksPerWeek } times per week`;
  return "on a cadence they chose";
}

// ----------------------------------------------------------------------------------------------
// @desc Name a deadline that falls inside the coming week.
// @param {string} deadlineOn - YYYY-MM-DD.
// @returns {string} One sentence.
function _deadlineSentence(deadlineOn) {
  const deadline = new Date(`${ deadlineOn }T00:00:00`);
  const label = deadline.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
  return `This project has a deadline on ${ label }, within the coming week.`;
}

// ----------------------------------------------------------------------------------------------
// @desc How many of the project's tasks have been finished so far this week.
// @param {number} completedThisWeek - Distinct completions since Monday.
// @returns {string} One sentence.
function _completionSentence(completedThisWeek) {
  const count = completedThisWeek === 0 ? "zero" : String(completedThisWeek);
  const noun = completedThisWeek === 1 ? "task" : "tasks";
  return `They have finished ${ count } ${ noun } from this project so far this week.`;
}

// ----------------------------------------------------------------------------------------------
// @desc Index open tasks by UUID. Accepts native tasks (`uuid`) and compact agenda records (`taskUuid`).
// @param {Array<object>|null} openTasks - Tasks the caller already loaded.
// @returns {Map<string, object>|null} Null when the caller did not pass a list.
function _openTasksByUuid(openTasks) {
  if (!openTasks) return null;
  const byUuid = new Map();
  for (const task of openTasks) {
    const uuid = task?.uuid || task?.taskUuid;
    if (uuid) byUuid.set(uuid, task);
  }
  return byUuid;
}
