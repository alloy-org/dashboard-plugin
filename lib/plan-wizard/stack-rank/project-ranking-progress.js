// Hold one project's ranking while it is under way, so the rating requests of a large pool can be spread over several
// turns of the work queue instead of one long call. The pool is drawn and split into cached and uncached tasks once,
// when the ranking begins; each turn rates the next slice of uncached tasks; finishing chooses the accepted tasks and
// the project's new similarity hash from every rating gathered. Rating every slice and then finishing gives the same
// result as one uninterrupted ranking, because the slices follow the same batch boundaries over the same pool and the
// fresh ratings are ordered as one rating call orders them.
import { partitionedByStoredRating, similarityScoresAfterRanking } from "plan-wizard/stack-rank/task-rating-cache";
import { logIfEnabled } from "util/log";

const RANKER_LOG_LABEL = "[stack-rank-project-tasks]";

// ----------------------------------------------------------------------------------------------
// @desc One project's ranking, from its drawn pool to its accepted tasks.
export default class ProjectRankingProgress {
  cachedTasks; // {Array<object>} Pooled tasks whose rating the project's hash already holds, as { rating, taskText, taskUuid }.
  changedCount; // {number} Changed older tasks the pool took in.
  failures = []; // {Array<object>} { reason, taskUuids } per failed batch so far.
  limitToRequiredTasks; // {boolean} True when only the required tasks were pooled.
  project; // {object} The project being ranked.
  rankedTasks = []; // {Array<object>} Freshly rated tasks so far, as rankProspectiveTasks returns them.
  rankerContext; // {object} { rateRecords, scorerEm, selectAcceptedTasks, taskByUuid } from the ranker.
  ratedThrough = 0; // {number} How many of uncachedRecords have been sent for rating.
  ratingKeyByUuid; // {object} Each pooled task's rating key, keyed by task UUID.
  recheckedCount; // {number} Similar tasks from the hash re-checked by checksum.
  relatedTaskRecords; // {Array<object>} The project's associated open tasks, shown to the rater.
  requiredRecords; // {Array<object>} Tasks whose score is stored whatever it is.
  search; // {object} The drawn search: { createdAfter, excludedBeforeCreatedAfter, excludedWithoutCreatedAt, records, searchProgress }.
  storedRatings; // {object|undefined} The project's similarity hash when the ranking began.
  uncachedRecords; // {Array<object>} Pooled tasks the rater still has to rate, in the order they are sent.

  // ----------------------------------------------------------------------------------------------
  // @desc Begin a ranking over a drawn pool, splitting it into tasks the hash already rates and tasks to send.
  // @param {object} options - An object with the following properties:
  //   - {number} changedCount - Changed older tasks the pool took in
  //   - {boolean} limitToRequiredTasks - True when only the required tasks were pooled
  //   - {Array<object>} pooledRecords - Every task to judge, as { taskText, taskUuid }
  //   - {object} project - The project being ranked
  //   - {object} rankerContext - { rateRecords, scorerEm, selectAcceptedTasks, taskByUuid }
  //   - {number} recheckedCount - Similar tasks from the hash re-checked by checksum
  //   - {Array<object>} relatedTaskRecords - The project's associated open tasks
  //   - {Array<object>} requiredRecords - Tasks whose score is stored whatever it is
  //   - {object} search - The drawn search
  //   - {object} [storedRatings] - The project's similarity hash
  constructor({ changedCount, limitToRequiredTasks, pooledRecords, project, rankerContext, recheckedCount, relatedTaskRecords,
    requiredRecords, search, storedRatings }) {
    const { cachedTasks, ratingKeyByUuid, uncachedRecords } = partitionedByStoredRating(pooledRecords,
      { projectSummary: project.summary, storedRatings });
    Object.assign(this, { cachedTasks, changedCount, limitToRequiredTasks, project, rankerContext, ratingKeyByUuid,
      recheckedCount, relatedTaskRecords, requiredRecords, search, storedRatings, uncachedRecords });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc How many uncached tasks are still to be sent for rating.
  // @returns {number} Tasks not yet sent.
  get remainingCount() {
    return this.uncachedRecords.length - this.ratedThrough;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Choose the accepted tasks and the project's new similarity hash from every rating gathered. A ranking whose
  //   every batch failed, with nothing cached to fall back on, reports the failure and accepts nothing, so its caller
  //   can fall back to the generative provider's attribution. Tasks not yet sent count as unrated.
  // @returns {Promise<object>} { acceptedTasks, failureReason, minimumMatchScore, rankingIncomplete, ratedCount,
  //   searchProgress, taskSimilarityScores }, as the ranker's rankProject describes it.
  async finish() {
    const { cachedTasks, project, rankerContext, requiredRecords, search } = this;
    const rankingIncomplete = this.failures.length > 0 || this.remainingCount > 0;
    if (!cachedTasks.length && !this.rankedTasks.length && this.failures.length) {
      return { acceptedTasks: [], failureReason: this.failures[0].reason, minimumMatchScore: null, rankingIncomplete,
        ratedCount: 0, searchProgress: null, taskSimilarityScores: null };
    }
    const freshTasks = [...this.rankedTasks].sort((first, second) => second.rating - first.rating
      || second.confidence - first.confidence);
    const combinedTasks = [...freshTasks, ...cachedTasks];
    const rankedTasks = combinedTasks.sort((first, second) => second.rating - first.rating);
    const selection = await rankerContext.selectAcceptedTasks({ isComplete: !rankingIncomplete, project, rankedTasks });
    const acceptedTasks = selection.acceptedTasks.map(task => ({ matchScore: task.rating,
      taskText: rankerContext.taskByUuid.get(task.taskUuid)?.content || task.taskText, taskUuid: task.taskUuid }));
    const taskSimilarityScores = similarityScoresAfterRanking({ ratedTasks: rankedTasks, ratingKeyByUuid: this.ratingKeyByUuid,
      requiredTaskUuids: requiredRecords.map(record => record.taskUuid), storedScores: this.storedRatings });
    logIfEnabled(`${ RANKER_LOG_LABEL } ranked project`, { acceptedCount: acceptedTasks.length,
      cachedCount: cachedTasks.length, candidateCount: search.records.length, changedCount: this.changedCount,
      createdAfter: search.createdAfter, excludedBeforeCreatedAfter: search.excludedBeforeCreatedAfter,
      excludedWithoutCreatedAt: search.excludedWithoutCreatedAt, limitToRequiredTasks: this.limitToRequiredTasks,
      minimumMatchScore: selection.minimumMatchScore, project: project.summary, rankingIncomplete,
      recheckedCount: this.recheckedCount, requiredCount: requiredRecords.length, scorerEm: rankerContext.scorerEm,
      searchProgress: search.searchProgress, sentCount: this.uncachedRecords.length });
    return { acceptedTasks, failureReason: null, minimumMatchScore: selection.minimumMatchScore, rankingIncomplete,
      ratedCount: rankedTasks.length, searchProgress: search.searchProgress, taskSimilarityScores };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The similarity hash a project should hold with the ratings gathered so far folded in, so a ranking that
  //   pauses can save what it has learned: every similar task and every required task rated so far, over the scores
  //   the project holds now. A later ranking reads those from the hash rather than rating them again.
  // @param {object} [currentScores] - The project's similarity hash as stored now.
  // @returns {object} Scores keyed `checksum:taskUuid`, sorted by task UUID.
  partialSimilarityScores(currentScores) {
    return similarityScoresAfterRanking({ ratedTasks: this.rankedTasks, ratingKeyByUuid: this.ratingKeyByUuid,
      requiredTaskUuids: this.requiredRecords.map(record => record.taskUuid), storedScores: currentScores });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Rate the next slice of uncached tasks. A failed batch is recorded and its tasks stay unrated, so one
  //   rejected request does not discard the rest. Nothing is requested once every task has been sent.
  // @param {number} [maximumCount=Infinity] - Most tasks to send in this slice.
  // @returns {Promise<number>} How many tasks this slice sent.
  async rateNext(maximumCount = Infinity) {
    if (this.remainingCount <= 0) return 0;
    const sliceEnd = Math.min(this.uncachedRecords.length, this.ratedThrough + maximumCount);
    const sliceRecords = this.uncachedRecords.slice(this.ratedThrough, sliceEnd);
    this.ratedThrough = sliceEnd;
    const { failures, rankedTasks } = await this.rankerContext.rateRecords(this.project, this.relatedTaskRecords, sliceRecords);
    this.failures.push(...failures);
    this.rankedTasks.push(...rankedTasks);
    return sliceRecords.length;
  }
}
