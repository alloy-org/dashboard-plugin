// Define a project the user committed to for a quarter, as the dashboard tracks it: its identity and pace choices
// from Plan Builder or the quarterly plan note, the tasks associated with it, and the completion evidence that
// decides when it is due. The project task store and the progress note persist it through the conversions in
// quarter-project-serialization; the agenda, ranking, and background collection passes update it through its setters.
import { SIMILAR_TASK_MINIMUM_SCORE, taskUuidFromRatingKey } from "plan-wizard/stack-rank/task-rating-cache";
import { taskSuggestionsWithShown } from "project-suggestion-log";
import { progressRecord, storeRecord, storeRecordFromSection, storeSectionMarkdown } from "quarter-project-serialization";
import { dateFromDateInput, dateKeyFromDateInput } from "util/date-utility";

// Fields the project task store owns. A project derived from the guide takes them from the store's copy of it.
const STORE_OWNED_FIELDS = ["isActive", "lastAttemptedAt", "lastRankedAt", "lastSuggestedAt", "relatedTaskRecords",
  "similaritySearchedTaskCount", "similaritySearchPageCount", "suggestedTasks", "taskSimilarityScores", "taskSuggestions"];

// Similar-task UUID sets, built once per hash: matchesTask runs for every task against every project.
const similarTaskUuidsByScores = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc A quarter's project with its task associations and completion evidence. Every field is always present:
//   an unset value is null, and an empty collection is [] or {}.
export default class QuarterProject {
  // ----------------------------------------------------------------------------------------------
  // Identity and Plan Builder choices
  // ----------------------------------------------------------------------------------------------

  summary; // {string} Project display name, and the text a task naming the project is matched against.
  uuid; // {string} Stable identity: the Plan Builder prospect UUID, or one generated for a plan-note project.
  blocksPerWeek; // {number|null} Weekly pace as a block count; null when no pace was chosen, which keeps the project from being due.
  deadlineOn; // {string|null} YYYY-MM-DD deadline; a deadline within the coming week qualifies the project for a day.
  focusMonths; // {Array<string>} YYYY-MM labels the project is meant to occupy; empty means the whole quarter.
  nextAction; // {string|null} Text of the next concrete step, used when no task can be suggested.
  paceEm; // {string|null} Plan Builder pace enum, such as twoFocusedBlocks.
  preferredWeekdays; // {Array<string>} Lowercase weekday enums the project's work suits.
  primaryNoteUuid; // {string|null} Note representing the project; a task in that note belongs to the project.
  priorityEm; // {string|null} monthFocus, quarterFocus, stayWarm, notNow, or null.

  // ----------------------------------------------------------------------------------------------
  // Task associations
  // ----------------------------------------------------------------------------------------------

  candidateTaskRecords; // {Array<object>} Unassociated open tasks, as { taskText, taskUuid }, a collection pass offers its provider; not persisted.
  completedTasks; // {Array<object>} Completions as { completedAt, sourceTaskUuid?, taskUuid }; the progress evidence counts these.
  relatedTaskRecords; // {Array<object>} Open tasks as { matchScore?, taskText, taskUuid }, rendered as the store's existing tasks list.
  relatedTasks; // {Array<string>} Task UUIDs associated by explicit evidence, which matchesTask accepts outright.
  suggestedTasks; // {Array<object>} Generated ideas as { generatedAt, taskText }, offered when no existing task fits a day.
  taskSimilarityScores; // {object} Ranker scores keyed `checksum:taskUuid`; tasks at or above the similar-task minimum match the project.
  taskSuggestions; // {Array<object>} Times a task was shown to the user, as { suggestedAt, taskUuid }, so suggestions stay novel.

  // ----------------------------------------------------------------------------------------------
  // Refresh progress
  // ----------------------------------------------------------------------------------------------

  isActive; // {boolean} False for a project the store keeps under Past projects, which is no longer searched for tasks.
  lastAttemptedAt; // {string|null} ISO time of the last background collection pass, which orders projects for the next one.
  lastRankedAt; // {string|null} ISO time of the last complete ranking; a ranking older than the staleness window is redone.
  lastSuggestedAt; // {string|null} ISO time new ideas were last generated.
  similaritySearchedTaskCount; // {number|null} Tasks the similarity search has reached.
  similaritySearchPageCount; // {number|null} Pages of its rater's pool the similarity search has covered.

  // ----------------------------------------------------------------------------------------------
  // Day evidence, set by setProgressEvidence for the date being planned and never persisted
  // ----------------------------------------------------------------------------------------------

  completedPastWeek = null; // {number|null} Distinct completions in the rolling seven days.
  completedThisWeek = null; // {number|null} Distinct completions since Monday.
  due = null; // {boolean|null} Whether the project has fallen behind its chosen pace.
  reason = null; // {string|null} Sentence explaining the pace and completions to the agenda model.
  weekStart = null; // {string|null} YYYY-MM-DD Monday the pace window began.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a project from its identity, the choices that may be unset, and the collections it accumulates.
  //   Day evidence is not accepted here; setProgressEvidence computes it.
  // @param {object} fields - The required summary and uuid, then optional fields defaulting to null, then
  //   collections and flags with defaults, as the field declarations above describe them.
  constructor({ summary, uuid,
      blocksPerWeek = null, deadlineOn = null, lastAttemptedAt = null, lastRankedAt = null, lastSuggestedAt = null,
      nextAction = null, paceEm = null, primaryNoteUuid = null, priorityEm = null, similaritySearchedTaskCount = null,
      similaritySearchPageCount = null,
      candidateTaskRecords = [], completedTasks = [], focusMonths = [], isActive = true, preferredWeekdays = [],
      relatedTaskRecords = [], relatedTasks = [], suggestedTasks = [], taskSimilarityScores = {}, taskSuggestions = [] }) {
    if (!summary || !uuid) throw new Error("A QuarterProject needs a summary and a uuid");
    Object.assign(this, { blocksPerWeek, candidateTaskRecords, completedTasks, deadlineOn, focusMonths, isActive,
      lastAttemptedAt, lastRankedAt, lastSuggestedAt, nextAction, paceEm, preferredWeekdays, primaryNoteUuid, priorityEm,
      relatedTaskRecords, relatedTasks, similaritySearchedTaskCount, similaritySearchPageCount, suggestedTasks, summary,
      taskSimilarityScores, taskSuggestions, uuid });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Accept either a project or a persisted record, such as one from the progress note's payload or one passed
  //   in by a caller holding plain data. A null in the record means the field is unset, so it takes its default.
  // @param {QuarterProject|object} record - Project, or a plain record of its fields.
  // @returns {QuarterProject} The same instance when one was passed, otherwise a new one.
  static from(record) {
    if (record instanceof QuarterProject) return record;
    const setEntries = Object.entries(record).filter(([, value]) => value !== null);
    return new QuarterProject(Object.fromEntries(setEntries));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Read a project back from its section of the project task store.
  // @param {string} sectionBody - Markdown between the project's heading and the next sibling heading.
  // @param {object} [options] - { isActive = true }: whether the section sits beneath "Active projects".
  // @returns {QuarterProject|null} The stored project, or null when the section has no readable payload or identity.
  static fromStoreSection(sectionBody, { isActive = true } = {}) {
    const record = storeRecordFromSection(sectionBody);
    if (!record?.summary || !record.uuid) return null;
    return QuarterProject.from({ ...record, isActive });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Associate more task UUIDs with the project by explicit evidence, keeping the ones it already has.
  // @param {Array<string>} taskUuids - Task UUIDs to add.
  addRelatedTaskUuids(taskUuids) {
    this.relatedTasks = [...new Set([...this.relatedTasks, ...taskUuids])];
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Take the fields the project task store owns from the store's copy of this project. The project's own
  //   completions are kept when it has any, since the progress note observes them across the whole quarter.
  // @param {QuarterProject} stored - This project as the task store holds it.
  adoptStoreFields(stored) {
    for (const field of STORE_OWNED_FIELDS) this[field] = stored[field];
    if (!this.completedTasks.length) this.completedTasks = stored.completedTasks;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record a ranking that covered the project's whole pool: its time, and how far its search reached when the
  //   ranker reports that. A ranking with missed batches is not recorded, so the missed tasks are sent again.
  // @param {string} rankedAt - ISO time of the ranking.
  // @param {object|null} [searchProgress] - { similaritySearchedTaskCount, similaritySearchPageCount }, or null.
  markRanked(rankedAt, searchProgress = null) {
    this.lastRankedAt = rankedAt;
    if (!searchProgress) return;
    this.similaritySearchedTaskCount = searchProgress.similaritySearchedTaskCount;
    this.similaritySearchPageCount = searchProgress.similaritySearchPageCount;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Match a task through stored UUIDs, the primary project note, explicit project links, the full project name,
  //   or the similarity hash. A task the hash rates similar counts toward progress, but a ranking pass leaves those
  //   out (includeSimilarTasks false): the ranker re-checks them against their current text, and a task that was
  //   edited into something unrelated must be free to drop out.
  // @param {object} task - Native task or compact agenda candidate.
  // @param {object} [options] - { includeSimilarTasks = true }.
  // @returns {boolean} Whether the association has concrete source evidence.
  matchesTask(task, { includeSimilarTasks = true } = {}) {
    const content = task.content || task.taskText || "";
    const taskUuid = task.uuid || task.taskUuid;
    if (this.relatedTasks.includes(taskUuid)) return true;
    if (includeSimilarTasks && this.similarTaskUuids().has(taskUuid)) return true;
    if (this.primaryNoteUuid && (task.noteUUID || task.noteUuid) === this.primaryNoteUuid) return true;
    if (content.includes(`project:${ this.uuid }`)) return true;
    if (this.primaryNoteUuid && content.includes(`/notes/${ this.primaryNoteUuid }`)) return true;
    const escaped = this.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\W)${ escaped }(?:$|\\W)`, "i").test(content);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Count actual completions before the selected day's end, using a rolling week and Monday-based pace window.
  //   Only a project with a chosen weekly pace can be due: one without a pace has no commitment to fall behind on,
  //   so it is left for the model to fit in after paced projects rather than forced onto the day.
  // @param {Date} targetDate - Local date being planned.
  // @param {object} [options] - { focusDate }: the day whose month is checked against focusMonths, defaulting to
  //   targetDate. A plan for a quarter that has not begun passes that quarter's first day.
  // @returns {object} { blocksPerWeek, completedPastWeek, completedThisWeek, due, reason, weekStart }. Completed
  //   tasks are a proxy for blocks, never a measure of time spent.
  progressEvidence(targetDate, { focusDate = targetDate } = {}) {
    const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() + 1);
    const weekStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - (targetDate.getDay() + 6) % 7);
    const rollingStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - 6);
    const distinctCompletions = new Map(this.completedTasks.map(task => [task.sourceTaskUuid || task.taskUuid, task]));
    const completionDates = [...distinctCompletions.values()].map(task => dateFromDateInput(task.completedAt));
    const priorCompletions = completionDates.filter(date => date < endDate);
    const completedThisWeek = priorCompletions.filter(date => date >= weekStart).length;
    const completedPastWeek = priorCompletions.filter(date => date >= rollingStart).length;
    const blocksPerWeek = this.blocksPerWeek;
    const monthKey = dateKeyFromDateInput(focusDate).slice(0, 7);
    const inFocus = !this.focusMonths.length || this.focusMonths.includes(monthKey);
    const due = inFocus && blocksPerWeek && (completedPastWeek === 0 || completedThisWeek < blocksPerWeek);
    const reason = blocksPerWeek
      ? `You chose ${ blocksPerWeek } blocks per week and have completed ${ completedThisWeek } related task(s) so far this week.`
      : `${ this.summary } has no chosen weekly pace, so it ranks below projects that have one.`;
    return { blocksPerWeek, completedPastWeek, completedThisWeek, due: !!due, reason,
      weekStart: dateKeyFromDateInput(weekStart) };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Merge actual task observations without deleting older completion evidence that has aged out of API queries.
  //   A task that was reopened or dismissed stops counting as a completion.
  // @param {Array<object>} tasks - Native tasks, including completions and reopened or dismissed tasks.
  recordObservedTasks(tasks) {
    const relatedTasks = new Set(this.relatedTasks);
    const completedByUuid = new Map(this.completedTasks.map(task => [task.taskUuid, task]));
    for (const task of tasks) {
      if (!task.uuid || !this.matchesTask(task)) continue;
      relatedTasks.add(task.uuid);
      if (task.completedAt && !task.dismissedAt) {
        const completedDate = dateFromDateInput(task.completedAt, { throwOnInvalid: false });
        const sourceTaskUuid = task.content?.match(/\/notes\/tasks\/([\w-]+)/)?.[1] || null;
        if (completedDate) completedByUuid.set(task.uuid, { completedAt: completedDate.toISOString(), sourceTaskUuid, taskUuid: task.uuid });
      } else completedByUuid.delete(task.uuid);
    }
    this.completedTasks = [...completedByUuid.values()];
    this.relatedTasks = [...relatedTasks];
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Append the tasks just shown to the user to the project's suggestion log.
  // @param {Array<string>} taskUuids - Tasks shown.
  // @param {string} shownAt - ISO time they were shown.
  recordShownTasks(taskUuids, shownAt) {
    this.taskSuggestions = taskSuggestionsWithShown(this.taskSuggestions, taskUuids, shownAt);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record when a collection pass last worked on the project, which orders projects for the next pass.
  // @param {string} attemptedAt - ISO time of the pass.
  setAttemptedAt(attemptedAt) {
    this.lastAttemptedAt = attemptedAt;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Set the unassociated tasks a collection pass offers its provider to attribute to this project.
  // @param {Array<object>} taskRecords - { taskText, taskUuid } records; empty when a ranker already attributed tasks.
  setCandidateTasks(taskRecords) {
    this.candidateTaskRecords = taskRecords;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Replace the project's completions.
  // @param {Array<object>} completedTasks - Completions as { completedAt, sourceTaskUuid?, taskUuid }.
  setCompletedTasks(completedTasks) {
    this.completedTasks = completedTasks;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Set the project's day evidence for a target date, as progressEvidence computes it.
  // @param {Date} targetDate - Local date being planned.
  // @param {object} [options] - { focusDate }, as progressEvidence takes it.
  setProgressEvidence(targetDate, options) {
    const { completedPastWeek, completedThisWeek, due, reason, weekStart } = this.progressEvidence(targetDate, options);
    Object.assign(this, { completedPastWeek, completedThisWeek, due, reason, weekStart });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Replace the open tasks rendered as the project's existing tasks.
  // @param {Array<object>} taskRecords - Open tasks as { matchScore?, taskText, taskUuid }.
  setRelatedTaskRecords(taskRecords) {
    this.relatedTaskRecords = taskRecords;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Replace the project's similarity hash.
  // @param {object} taskSimilarityScores - Ranker scores keyed `checksum:taskUuid`.
  setSimilarityScores(taskSimilarityScores) {
    this.taskSimilarityScores = taskSimilarityScores;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Replace the project's generated ideas, stamping when new ones were generated.
  // @param {Array<object>} suggestedTasks - Ideas as { generatedAt, taskText }.
  // @param {object} [options] - { generatedAt }: ISO time, given only when the ideas include newly generated ones.
  setSuggestedTasks(suggestedTasks, { generatedAt = null } = {}) {
    this.suggestedTasks = suggestedTasks;
    if (generatedAt) this.lastSuggestedAt = generatedAt;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The task UUIDs the similarity hash rates at or above the similar-task minimum.
  // @returns {Set<string>} Similar task UUIDs; empty when the project has no hash.
  similarTaskUuids() {
    const scores = this.taskSimilarityScores;
    if (similarTaskUuidsByScores.has(scores)) return similarTaskUuidsByScores.get(scores);
    const similarEntries = Object.entries(scores).filter(([, rating]) => rating >= SIMILAR_TASK_MINIMUM_SCORE);
    const similarUuids = new Set(similarEntries.map(([ratingKey]) => taskUuidFromRatingKey(ratingKey)));
    similarTaskUuidsByScores.set(scores, similarUuids);
    return similarUuids;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The plain record the progress note persists for this project.
  // @returns {object} See progressRecord in quarter-project-serialization.
  toProgressRecord() {
    return progressRecord(this);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The plain record the project task store persists in this project's JSON payload.
  // @returns {object} See storeRecord in quarter-project-serialization.
  toStoreRecord() {
    return storeRecord(this);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Render this project's section of the project task store, which fromStoreSection reads back.
  // @returns {string} Section body to place beneath the project's heading.
  toStoreSection() {
    return storeSectionMarkdown(this);
  }
}
