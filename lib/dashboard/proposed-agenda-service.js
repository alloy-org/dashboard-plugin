import { agendaWithBenefitRationales } from "calendar-suggestion-explanation";
import { DASHBOARD_NOTE_TAG, SETTING_KEYS, apiKeyBucketFromLlmProvider,
  apiKeyFromProvider, devLlmOverride } from "constants/settings";
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { contentWithoutCompletedProjects } from "plan-wizard/quarterly-plan-markdown";
import { pluginSettings } from "plugin-data";
import { ensureDueProjectSuggestions } from "project-agenda-suggestions";
import { IDEA_STATUSES } from "project-idea-records";
import { combinedQuarterlyContent, loadEnabledQuarterlyPlans } from "project-plan-quarter";
import { loadProjectProgress } from "project-progress-service";
import { collectedIdeasMarkdown, readCollectedProjectTasks } from "project-task-store";
import { loadCachedProposedAgenda, PROPOSED_TASK_STATUS, proposedTaskKey,
  recentProposedTaskHistory, storeProposedAgenda, updateProposedTaskStatuses } from "proposed-agenda-archive";
import { agendaDecisionsFromRows, DECISION_HISTORY_MONTHS, recentAgendaDecisionsMarkdown, recordAgendaDecisions } from "proposed-agenda-decision-log";
import { scheduleProjectStep } from "proposed-agenda-note";
import { priorityOptionFromKey } from "proposed-agenda-priority";
import { agendaSuggestionsFromProjects, existingTaskForAcceptedIdea, recordShownTaskSuggestions,
  recordSuggestedIdeaDecisions } from "ranked-task-suggestions";
import { findAmpleAgentProNote } from "providers/ai-provider-settings";
import { llmPromptWithPluginFallback } from "providers/fetch-ai-provider";
import { buildDayRecommendationContext } from "recommendation-context/day-recommendation-context";
import { recommendationContextHasTravelOverride, recommendationInstructionsFromContext } from "recommendation-context/recommendation-instructions";
import { staleSuggestionReview, suggestionIdentityKey } from "suggestion-staleness";
import { activitiesClearOfObligations, firstOpenSuggestionStart, refillRejectedSuggestion } from "suggestion-task-slots";
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks";
import { dateKeyFromDateInput, localMidnightFromDateInput, millisFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";
import { activeTaskDomainInfo } from "util/task-domain-utility";

// Task-retrieval volume rules (see _selectRelevantTasks):
const MIN_RECENT_TASKS = 200;
const MAX_TASKS = 1_000;
const RECENT_WINDOW_DAYS = 30;
const MAX_TASK_TEXT_CHARS = 200;

const EPOCH_SECONDS_THRESHOLD = 1e10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDS_PER_MINUTE = 60;

// Amplenote's suggestScheduledTasks contract wants a start AND an end for every suggestion, and the widget's
// "Add to schedule" button reads the same duration, so an activity the LLM returns without a usable
// durationMinutes is given this length rather than being left as a zero-length block.
// [Claude claude-opus-5[1m]] Task: guarantee every suggestion carries a duration
const DEFAULT_ACTIVITY_DURATION_MINUTES = 30;

const LLM_TIMEOUT_SECONDS = 60;
const MIN_GAP_MINUTES = 60;
const ERROR_SNIPPET_MAX_CHARS = 200;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;

// After this local hour the working day is effectively over, so the proposed agenda targets the next day.
const NEXT_DAY_CUTOFF_HOUR = 16;

// The working day ends at 6pm. When the agenda is for today, we only propose the remaining part of the day
// (now → 18:00); anything past 18:00 is proposed only when today's priority calls for after-hours activities.
const WORK_DAY_END_HOUR = 18;
const MINUTES_PER_HOUR = 60;

// Preferred (soft) buffer the LLM is asked to leave between the user's obligations and its suggestions.
const OBLIGATION_BUFFER_MINUTES = 30;
const TRAVEL_RECOMMENDATIONS_NOTE_NAME = "Dashboard travel recommendations";

// Day-of-week indices (Date.getDay): the agenda skips these to the following Monday.
const SUNDAY = 0;
const SATURDAY = 6;

// Recency de-duplication rules, applied against the previous week of proposal history (see recentProposedTaskHistory):
//   1. A task suggested on the immediately preceding day is not suggested again (no two days in a row).
//   2. A task already suggested on 2 distinct days inside the trailing (MAX_PROPOSALS_WINDOW_DAYS - 1) days is
//      not suggested again, since a further suggestion would be its 3rd within a MAX_PROPOSALS_WINDOW_DAYS span
//      ("more than twice in any 5 day period").
const MAX_PROPOSALS_WINDOW_DAYS = 5;
const MAX_PROPOSALS_IN_WINDOW = 2;

// ----------------------------------------------------------------------------------------------
// @desc Top-level entry: gather the relevant task domain, load the quarterly plan, and ask the configured
//   LLM to propose an hour-by-hour schedule that leaves at least one hour between activities.
// @param {object} app - Amplenote app bridge.
// @param {object} [options={}]
// @param {string|null} [options.aiModelOverride] - Explicit model id to send to the LLM, bypassing the
//   provider-default model resolution. Primarily a testing seam so integration tests can pin a cheap model.
// @param {Array<object>|null} [options.calendarEvents] - Calendar events already loaded by Dashboard.
// @param {boolean} [options.deferBenefitRationales] - When true, a freshly generated agenda returns as soon as its tasks
//   are placed, before the provider writes each task's benefit sentence. The result then carries benefitRationales, a
//   promise of the same payload with benefits set, which stores the agenda once it resolves and never rejects. Lets a
//   calendar pass show a day's tasks while their rationale is still being written.
// @param {Set<string>|null} [options.changedNoteUuids] - Notes changed since the previous calendar pass. When given, a
//   cached agenda re-checks only the pending suggestions from these notes; null re-checks every pending suggestion.
// @param {string|null} [options.domainName] - Active Task Domain display name.
// @param {string|null} [options.domainUuid] - Active Task Domain UUID.
// @param {Set<string>|null} [options.excludedSuggestionKeys] - suggestionIdentityKey values already offered on an
//   earlier day of the same range. A fresh schedule skips them, and a cached agenda replaces its pending copies.
// @param {boolean} [options.forceRegenerate] - When true, bypass the cached record for this date+priority+LLM
//   and call the LLM afresh (then replace the stored record). Used by "Reseed".
// @param {Date|null} [options.now] - Reference "now" used to derive the current time-of-day the agenda starts.
// @param {Array<object>} [options.obligations] - Already-scheduled target-day tasks/events.
// @param {string|null} [options.priorityKey] - "Today's priority" lens key; biases task selection and prompt.
// @param {string|null} [options.providerEmOverride] - LLM provider enum to use instead of dashboard selection.
// @param {function|null} [options.rankingPreparer] - async ({ domainName, domainUuid, targetDate }) => void, called
//   before a fresh schedule ranks the day, so the Dashboard's work queue can prepare the shared day ranking the
//   ranking then reads from its store. It never throws; without one the schedule ranks the day itself.
// @param {Date|null} [options.targetDate] - Explicit day to schedule for, bypassing auto-resolution (4pm cutoff
//   + weekend→Monday skip). Primarily a testing seam so tests can pin the scheduled day without mocking the
//   global clock. When omitted, the day is resolved from the current local time.
// @returns {Promise<{activities: Array<object>, dateLabel: string, dayWord: string, isFutureDay: boolean,
//   fromCache: boolean, providerEm: string, dismissedKeys?: Array<string>, scheduledKeys?: Array<string>,
//   llmAttributionFooter: string|null, benefitRationales?: Promise<object>}|{activities: [], error: string,
//   errorCode: string, errorDetail?: string}>}
export async function generateProposedAgenda(app, { aiModelOverride = null, calendarEvents = null,
    changedNoteUuids = null, deferBenefitRationales = false, domainName = null, domainUuid = null,
    excludedSuggestionKeys = null, forceRegenerate = false,
    now = null, obligations = [], priorityKey = null, providerEmOverride = null, rankingPreparer = null,
    targetDate: targetDateOverride = null } = {}) {
  const nowDate = now || new Date();
  const targetDate = targetDateOverride ? localMidnightFromDateInput(targetDateOverride) : resolveProposedAgendaDate(nowDate);
  const dateLabel = targetDate.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  // The target day may be today, tomorrow, or further out (e.g. Friday-evening/weekend runs resolve to Monday),
  // so describe it relative to today rather than assuming "tomorrow".
  const dayWord = _relativeDayWord(targetDate, nowDate);
  const isFutureDay = !_isSameLocalDay(targetDate, nowDate);
  // Only clamp to the current time-of-day when the agenda is for today; a future day is planned as a fresh start.
  const nowMinutes = isFutureDay ? null : nowDate.getHours() * MINUTES_PER_HOUR + nowDate.getMinutes();
  const priorityOption = priorityOptionFromKey(priorityKey);
  const providerEm = _resolveProviderEm(providerEmOverride);
  const activeDomainInfo = await activeTaskDomainInfo(app);
  const resolvedDomainName = domainName || activeDomainInfo.domainName || "All Notes";
  const resolvedDomainUuid = domainUuid || activeDomainInfo.domainUuid || null;
  const recommendationContext = await buildDayRecommendationContext(app, { calendarEvents,
    domainUuid: resolvedDomainUuid, targetDate });
  logIfEnabled("[proposed-agenda] generateProposedAgenda entry", { dateLabel, dayWord, isFutureDay, nowMinutes,
    priority: priorityOption.key, obligationCount: obligations.length, providerEm, forceRegenerate,
    recommendationFingerprint: recommendationContext.fingerprint });

  if (!forceRegenerate) {
    const cached = await loadCachedProposedAgenda(app, { date: targetDate, domainName: resolvedDomainName,
      domainUuid: resolvedDomainUuid, priorityKey: priorityOption.key, providerEm,
      recommendationContextKey: recommendationContext.cacheKey })
      .catch(error => { logIfEnabled("[proposed-agenda] cache lookup failed", error?.message); return null; });
    if (cached) {
      return _reconcileCachedAgenda(app, {
        aiModelOverride, cached, changedNoteUuids, dateLabel, dayWord,
        domainName: resolvedDomainName, domainUuid: resolvedDomainUuid, excludedSuggestionKeys, isFutureDay,
        migrationDomainName: activeDomainInfo.migrationDomainName, nowMinutes, obligations, priorityOption,
        providerEm, providerEmOverride, rankingPreparer, recommendationContext, targetDate
      });
    }
  }

  const { explainedSchedule, ...result } = await _generateFreshSchedule(app, { aiModelOverride, dateLabel, dayWord,
    deferBenefitRationales, domainName: resolvedDomainName, domainUuid: resolvedDomainUuid, excludedSuggestionKeys,
    isFutureDay, migrationDomainName: activeDomainInfo.migrationDomainName, nowMinutes, obligations, priorityOption,
    providerEmOverride, rankingPreparer, recommendationContext, targetDate });
  if (result.fromRanking) await recordShownTaskSuggestions(app, { domainName: resolvedDomainName,
    domainUuid: resolvedDomainUuid, suggestions: result.activities, targetDate });
  const resultScope = { domainName: resolvedDomainName, domainUuid: resolvedDomainUuid, fromCache: false, providerEm };
  const storeOptions = { date: targetDate, domainName: resolvedDomainName, domainUuid: resolvedDomainUuid,
    priorityKey: priorityOption.key, providerEm, recommendationContextKey: recommendationContext.cacheKey };
  if (!explainedSchedule) {
    await _storeFreshAgenda(app, result, storeOptions);
    return { ...result, ...resultScope };
  }
  const benefitRationales = _explainedAndStoredAgenda(app, { explainedSchedule, result, resultScope, storeOptions });
  return { ...result, ...resultScope, benefitRationales };
}

// ----------------------------------------------------------------------------------------------
// @desc Persist a freshly generated agenda when it placed anything, logging rather than throwing on a failed write.
// @param {object} app - Amplenote app bridge.
// @param {object} result - _generateFreshSchedule payload: { activities, error, llmAttributionFooter, reserveTasks }.
// @param {object} storeOptions - { date, domainName, domainUuid, priorityKey, providerEm, recommendationContextKey }.
// @returns {Promise<void>}
async function _storeFreshAgenda(app, result, storeOptions) {
  if (result.error || !Array.isArray(result.activities) || result.activities.length === 0) return;
  await storeProposedAgenda(app, { ...storeOptions, activities: result.activities,
    llmAttributionFooter: result.llmAttributionFooter, reserveTasks: result.reserveTasks }).catch(
    error => logIfEnabled("[proposed-agenda] failed to store record", error?.message));
}

// ----------------------------------------------------------------------------------------------
// @desc Wait for a deferred agenda's benefit sentences, then store the agenda with them. The agenda is stored only
//   here, so a cached record always carries its rationale. A failure leaves the agenda without benefits, stored and
//   returned as it was placed.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { explainedSchedule, result, resultScope, storeOptions }:
//   - {Function} explainedSchedule - async () => result with benefits set, from _generateFreshSchedule.
//   - {object} result - The agenda as placed, without benefits.
//   - {object} resultScope - { domainName, domainUuid, fromCache, providerEm } spread onto the payload.
//   - {object} storeOptions - Arguments for _storeFreshAgenda.
// @returns {Promise<object>} The explained agenda payload; never rejects.
async function _explainedAndStoredAgenda(app, { explainedSchedule, result, resultScope, storeOptions }) {
  const startedAt = Date.now();
  let explained = result;
  try {
    explained = await explainedSchedule();
  } catch (error) {
    logIfEnabled("[proposed-agenda] deferred benefit rationales failed", error?.message);
  }
  const explainedActivities = (explained.activities || []).filter(activity => activity.benefit);
  logIfEnabled("[proposed-agenda] deferred benefit rationales ready", { dateLabel: result.dateLabel,
    durationMs: Date.now() - startedAt, explainedCount: explainedActivities.length });
  await _storeFreshAgenda(app, explained, storeOptions);
  return { ...explained, ...resultScope };
}

// ----------------------------------------------------------------------------------------------
// @desc The projects the agenda ranks a day's candidates from: every enabled quarter's live projects with their
//   progress, read exactly as a fresh schedule reads them, so a queued preparation asks the ranker the question the
//   agenda will ask and the agenda finds that ranking stored.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { allowLegacyMigration = false, domainName, domainUuid, targetDate }: allowLegacyMigration
//   lets a legacy plan note be migrated while it is read, which only the agenda's own generation does.
// @returns {Promise<Array<object>>} The enabled quarters' projects.
export async function agendaRankingProjects(app, { allowLegacyMigration = false, domainName, domainUuid, targetDate }) {
  const planQuarters = await loadEnabledQuarterlyPlans(app, { allowLegacyMigration, domainName, domainUuid, targetDate });
  const { projectProgress } = await _enabledPlansProjectContext(app, { domainName, domainUuid, planQuarters, targetDate });
  return projectProgress.projects;
}

// ----------------------------------------------------------------------------------------------
// @desc Read the task ideas a background dashboard pass already collected for this quarter's projects. This
//   is a read of stored text with no provider call, so a cold store costs one note lookup rather than the
//   generation latency the collection pass exists to move off this path. Ideas are kept only for projects that
//   are still live, so a project marked Complete since the last collection pass stops contributing at once.
// @param {object} app - Amplenote app bridge.
// @param {object} options - { domainName, domainUuid, liveProjectUuids, planQuarter } where planQuarter
//   ({ quarter, year }) is one of the quarters loadEnabledQuarterlyPlans chose for the day being planned, and
//   liveProjectUuids names the projects loadProjectProgress still treats as active.
// @returns {Promise<string>} Ideas markdown for the prompt, empty when nothing has been collected yet.
async function _collectedProjectIdeas(app, { domainName, domainUuid, liveProjectUuids, planQuarter }) {
  try {
    const scope = resolvePlanScope({ domainName, domainUuid, quarter: planQuarter.quarter, year: planQuarter.year });
    const storedRecords = await readCollectedProjectTasks(app, scope);
    const liveRecords = storedRecords.filter(record => liveProjectUuids.has(record.uuid));
    return collectedIdeasMarkdown(liveRecords);
  } catch (error) {
    logIfEnabled("[proposed-agenda] collected project ideas unavailable", error?.message);
    return "";
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Build the plan markdown and project progress for every enabled quarter, merged into the single shape the
//   schedule prompt expects. A quarter contributes its projects even without a plan note, since Plan Builder may
//   still hold them in its vision guide; no enabled quarter at all yields an empty project context.
// @param {object} app - Amplenote app bridge.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Active Task Domain name
//   - {string|null} domainUuid - Active Task Domain UUID
//   - {Array<object>} planQuarters - Output of loadEnabledQuarterlyPlans
//   - {Date} targetDate - Local day being planned
// @returns {Promise<object>} An object with the following properties:
//   - {object} projectProgress - { candidates, collectedIdeas, markdown, projects } across all enabled quarters
//   - {string|null} quarterlyContent - Combined plan markdown, or null when no enabled quarter has a plan
async function _enabledPlansProjectContext(app, { domainName, domainUuid, planQuarters, targetDate }) {
  const planContexts = [];
  for (const planQuarter of planQuarters) {
    // Projects the user marked Complete stay in the note as a record but must not be offered as today's work.
    const content = planQuarter.planContent ? contentWithoutCompletedProjects(planQuarter.planContent) : null;
    const progress = await loadProjectProgress(app, { domainName, domainUuid, planQuarter, quarterlyContent: content, targetDate });
    const liveProjectUuids = new Set(progress.projects.map(project => project.uuid));
    const collectedIdeas = await _collectedProjectIdeas(app, { domainName, domainUuid, liveProjectUuids, planQuarter });
    planContexts.push({ collectedIdeas, content, label: planQuarter.label, progress });
  }
  const collectedIdeas = planContexts.map(context => context.collectedIdeas).filter(Boolean).join("\n");
  const markdown = planContexts.map(context => context.progress.markdown).filter(Boolean).join("\n");
  const candidates = planContexts.flatMap(context => context.progress.candidates);
  const projects = planContexts.flatMap(context => context.progress.projects);
  const projectProgress = { candidates, collectedIdeas, markdown, projects };
  return { projectProgress, quarterlyContent: combinedQuarterlyContent(planContexts) };
}

// ----------------------------------------------------------------------------------------------
// @desc Gather the enabled quarters' complete plans, Plan Builder projects, and persisted completion evidence,
//   then ask the LLM for a fresh hour-by-hour schedule WITHOUT persisting it (callers decide whether/how to
//   store). The enabled quarters are those whose Quarterly Planning checkbox is on: normally the target day's own
//   quarter, plus the upcoming one near the quarter's end or when the user checked it. Shared by the cache-miss path and by cached-
//   agenda reconciliation when completed suggestions must be replaced.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { aiModelOverride, dateLabel, dayWord, deferBenefitRationales, domainName, domainUuid,
//   excludedSuggestionKeys, isFutureDay, migrationDomainName, nowMinutes, obligations, priorityOption,
//   providerEmOverride, rankingPreparer, recommendationContext, targetDate }. rankingPreparer, when given, runs before
//   the day is ranked. excludedSuggestionKeys, when given, names suggestions another day already holds, which this day
//   leaves out. deferBenefitRationales skips waiting for the benefit sentences (see the return value).
// @returns {Promise<object>} Schedule payload ({ activities, dateLabel, ... }) or a structured error. fromRanking is
//   true when the activities came from the shared day ranking, which records nothing as shown: the caller records the
//   activities it presents. With deferBenefitRationales, the payload has no benefits yet and carries explainedSchedule,
//   an async () => payload that asks the provider for them.
// [Claude claude-opus-4-8 (1M context)] Task: factor the fresh-generation core so reconciliation can reuse it
async function _generateFreshSchedule(app, { aiModelOverride, dateLabel, dayWord, deferBenefitRationales = false,
    domainName, domainUuid, excludedSuggestionKeys = null, isFutureDay, migrationDomainName, nowMinutes, obligations, priorityOption,
    providerEmOverride, rankingPreparer = null, recommendationContext, targetDate }) {
  let tasks = await _selectRelevantTasks(app, priorityOption, targetDate, domainUuid);
  const allowLegacyMigration = domainName && migrationDomainName && domainName === migrationDomainName;
  const planQuarters = await loadEnabledQuarterlyPlans(app, { allowLegacyMigration, domainName, domainUuid, targetDate });
  const { projectProgress, quarterlyContent } = await _enabledPlansProjectContext(app, { domainName, domainUuid,
    planQuarters, targetDate });
  const candidatesByUuid = new Map([...tasks, ...projectProgress.candidates].map(task => [task.taskUuid, task]));
  tasks = [...candidatesByUuid.values()];
  logIfEnabled("[proposed-agenda] context loaded", { taskCount: tasks.length, quarterlyChars: quarterlyContent?.length ?? 0 });
  if (tasks.length === 0 && !projectProgress.projects.length && !recommendationContextHasTravelOverride(recommendationContext)) {
    return { activities: [], error: "No tasks found available to schedule in Task Domain.", errorCode: "no_tasks" };
  }
  if (rankingPreparer) await rankingPreparer({ domainName, domainUuid, targetDate });
  const rankedAgenda = await agendaSuggestionsFromProjects(app, { domainName, domainUuid, excludedSuggestionKeys,
    nowMinutes, obligations, openTasks: tasks, projects: projectProgress.projects, targetDate });
  let unexplainedSchedule;
  if (rankedAgenda) {
    unexplainedSchedule = { activities: rankedAgenda.activities, dateLabel, dayWord, fromRanking: true, isFutureDay,
      llmAttributionFooter: null, reserveTasks: rankedAgenda.reserveTasks };
  } else {
    const scheduled = await _generateScheduleFromLlm(app, { aiModelOverride, dateLabel, dayWord, domainName, domainUuid,
      isFutureDay, nowMinutes, obligations, priorityOption, projectProgress, providerEmOverride, quarterlyContent,
      recommendationContext, targetDate, tasks });
    unexplainedSchedule = _scheduleWithoutExcludedSuggestions(excludedSuggestionKeys, scheduled);
  }
  const explainedSchedule = () => agendaWithBenefitRationales(app, unexplainedSchedule);
  if (!deferBenefitRationales || unexplainedSchedule.error) return explainedSchedule();
  return { ...unexplainedSchedule, explainedSchedule };
}

// ----------------------------------------------------------------------------------------------
// @desc Serve a cached agenda, but first confirm each still-pending suggestion still stands. A suggestion whose task
//   was completed, dismissed, or deleted is dropped, as is an idea the user accepted from the calendar (recorded as
//   accepted so later rankings stop offering it) and one an earlier day of the range already holds. The schedule is
//   re-queried to fill each vacated slot. Hours the agenda has otherwise lost suggestions from, because the user
//   accepted one from the calendar or a new obligation pushed one out of the day, are filled again from the day's
//   reserves, and from a fresh schedule once no pending suggestion is left. Any change is written back to the note so
//   dropped entries never resurface. Already scheduled/dismissed cached entries are left untouched.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { aiModelOverride, cached, changedNoteUuids, dateLabel, dayWord, domainName, domainUuid,
//   excludedSuggestionKeys, isFutureDay, migrationDomainName, nowMinutes, obligations, priorityOption, providerEm,
//   providerEmOverride, rankingPreparer, recommendationContext, targetDate }. `cached` is loadCachedProposedAgenda()'s
//   payload; changedNoteUuids, when given, confines the re-check to suggestions from those notes.
// @returns {Promise<object>} Agenda payload with fromCache:true and the reconciled activities/keys.
async function _reconcileCachedAgenda(app, { aiModelOverride, cached, changedNoteUuids = null, dateLabel, dayWord,
    domainName, domainUuid, excludedSuggestionKeys = null, isFutureDay, migrationDomainName, nowMinutes, obligations,
    priorityOption, providerEm, providerEmOverride, rankingPreparer = null, recommendationContext, targetDate }) {
  const { activities: approvedActivities } = await _reconcileExternalApprovals(app,
    { activities: cached.activities, domainName, domainUuid, obligations, priorityOption, providerEm,
    scheduledKeys: cached.scheduledKeys, targetDate });
  const { activities: cachedActivities, changed: obligationsMovedActivities } = _pendingActivitiesClearOfObligations(
    approvedActivities, { nowMinutes, obligations });
  const replacedKeys = await _replacedCachedSuggestionKeys(app, cachedActivities, { changedNoteUuids, domainName,
    domainUuid, excludedSuggestionKeys, targetDate });
  const freshScheduleOptions = { aiModelOverride, dateLabel, dayWord, domainName, domainUuid, isFutureDay,
    migrationDomainName, nowMinutes, obligations, priorityOption, providerEmOverride, rankingPreparer,
    recommendationContext, targetDate };
  const reconciled = replacedKeys.size === 0
    ? { activities: cachedActivities, changed: obligationsMovedActivities, fresh: null }
    : await _cachedAgendaWithReplacements(app, { cachedActivities, excludedSuggestionKeys, freshScheduleOptions,
      replacedKeys });
  const filled = await _agendaWithOpenHoursFilled(app, { activities: reconciled.activities, excludedSuggestionKeys,
    fresh: reconciled.fresh, freshScheduleOptions, replacedKeys,
    reserveTasks: reconciled.fresh?.reserveTasks || cached.reserveTasks || [] });
  const llmAttributionFooter = cached.llmAttributionFooter || filled.llmAttributionFooter || null;
  if (reconciled.changed || filled.placedCount > 0) {
    await storeProposedAgenda(app, { activities: filled.activities, date: targetDate, domainName, domainUuid,
      llmAttributionFooter, priorityKey: priorityOption.key, providerEm,
      recommendationContextKey: recommendationContext.cacheKey, reserveTasks: filled.reserveTasks }).catch(
      error => logIfEnabled("[proposed-agenda] failed to store reconciled agenda", error?.message));
  }
  const dismissedActivities = filled.activities.filter(activity => activity.scheduledEm === PROPOSED_TASK_STATUS.DISMISSED);
  const scheduledActivities = filled.activities.filter(activity => activity.scheduledEm === PROPOSED_TASK_STATUS.SCHEDULED);
  return { activities: filled.activities, dateLabel, dayWord, dismissedKeys: dismissedActivities.map(proposedTaskKey),
    domainName, domainUuid, fromCache: true, isFutureDay, llmAttributionFooter, providerEm,
    reserveTasks: filled.reserveTasks, scheduledKeys: scheduledActivities.map(proposedTaskKey) };
}

// ----------------------------------------------------------------------------------------------
// @desc Drop the cached suggestions named for replacement and slot a freshly generated schedule's picks into the times
//   they held, moving any pick off an event added since the agenda was generated.
// @param {object} app - Amplenote app bridge.
// @param {object} params - An object with the following properties:
//   - {Array<object>} cachedActivities - The cached activities after approvals and obligation moves
//   - {Set<string>|null} excludedSuggestionKeys - Suggestions an earlier day of the range already holds
//   - {object} freshScheduleOptions - _generateFreshSchedule options, less excludedSuggestionKeys
//   - {Set<string>} replacedKeys - suggestionIdentityKey values of the pending suggestions to replace
// @returns {Promise<object>} An object with the following properties:
//   - {Array<object>} activities - Kept and replacement activities in start order
//   - {boolean} changed - Always true, since at least one suggestion was dropped
//   - {object} fresh - The freshly generated schedule, whose unused picks and reserves may fill other open hours
async function _cachedAgendaWithReplacements(app, { cachedActivities, excludedSuggestionKeys, freshScheduleOptions,
    replacedKeys }) {
  const { domainName, domainUuid, nowMinutes, obligations, targetDate } = freshScheduleOptions;
  const isReplaced = activity => _isPendingActivity(activity) && replacedKeys.has(suggestionIdentityKey(activity));
  const keptActivities = cachedActivities.filter(activity => !isReplaced(activity));
  const staleSlots = cachedActivities.filter(isReplaced);
  logIfEnabled("[proposed-agenda] reconcile: dropping completed, accepted, or claimed suggestions, re-querying replacements",
    { staleCount: staleSlots.length, keptCount: keptActivities.length });
  const freshExcludedKeys = new Set([...(excludedSuggestionKeys || []), ...replacedKeys]);
  const fresh = await _generateFreshSchedule(app, { ...freshScheduleOptions, excludedSuggestionKeys: freshExcludedKeys });
  const replacements = _replacementsForStaleSlots(fresh, keptActivities, replacedKeys, staleSlots);
  // A replacement inherits its stale slot's time, which may have been taken by an event added since generation.
  const { activities: placedReplacements } = activitiesClearOfObligations(replacements, { fixedRows: keptActivities,
    nowMinutes, obligations });
  if (fresh.fromRanking) await recordShownTaskSuggestions(app, { domainName, domainUuid, suggestions: placedReplacements, targetDate });
  const mergedActivities = [...keptActivities, ...placedReplacements].sort((a, b) => a.startMinutes - b.startMinutes);
  return { activities: mergedActivities, changed: true, fresh };
}

// ----------------------------------------------------------------------------------------------
// @desc Offer a suggestion in each working hour a cached agenda has left open. A cached day only shrinks: accepting a
//   suggestion from the calendar marks it scheduled, and a new obligation can push one out of the day, so without this
//   a day can run out of suggestions while it still has free hours. The day's reserves fill those hours first, along
//   with any unused picks of a schedule generated during this reconcile. When that leaves the day with no pending
//   suggestion and an hour still open, a fresh schedule is generated to fill it. Candidates the day already holds in
//   any status, that are scheduled on it, or that another day of the range claimed are skipped, and each placed
//   candidate is checked against its live task first so a completed task is never offered.
// @param {object} app - Amplenote app bridge.
// @param {object} params - An object with the following properties:
//   - {Array<object>} activities - The reconciled activities, in any status
//   - {Set<string>|null} excludedSuggestionKeys - Suggestions an earlier day of the range already holds
//   - {object|null} fresh - A schedule already generated during this reconcile, or null
//   - {object} freshScheduleOptions - _generateFreshSchedule options, less excludedSuggestionKeys
//   - {Set<string>} replacedKeys - Suggestions dropped as stale during this reconcile
//   - {Array<object>} reserveTasks - The day's ranked reserves
// @returns {Promise<object>} An object with the following properties:
//   - {Array<object>} activities - The activities with the placed suggestions added, in start order
//   - {string|null} llmAttributionFooter - Footer of a schedule generated here, else null
//   - {number} placedCount - How many suggestions were added
//   - {Array<object>} reserveTasks - The reserves left to refill later hours from
async function _agendaWithOpenHoursFilled(app, { activities, excludedSuggestionKeys, fresh, freshScheduleOptions,
    replacedKeys, reserveTasks }) {
  const { domainName, domainUuid, nowMinutes, obligations, targetDate } = freshScheduleOptions;
  const unavailableKeys = _unavailableSuggestionKeys(activities, { excludedSuggestionKeys, obligations, replacedKeys });
  const unusedFreshPicks = (fresh?.activities || []).map(_rankedTaskFromActivity);
  const reservePlacement = await _placeIntoOpenHours(app, { activities, candidates: [...reserveTasks, ...unusedFreshPicks],
    nowMinutes, obligations, targetDate, unavailableKeys });
  let filledActivities = reservePlacement.activities;
  let placedActivities = reservePlacement.placed;
  let remainingReserves = reserveTasks;
  let llmAttributionFooter = fresh?.llmAttributionFooter || null;
  const hasPendingActivity = filledActivities.some(_isPendingActivity);
  const openStart = firstOpenSuggestionStart({ activities: filledActivities, nowMinutes, obligations });
  const regenerates = !fresh && !hasPendingActivity && openStart != null;
  if (regenerates) {
    logIfEnabled("[proposed-agenda] cached agenda has no pending suggestions left, generating more for its open hours",
      { activityCount: filledActivities.length, firstOpenStart: openStart });
    const placedKeys = placedActivities.map(suggestionIdentityKey);
    const regeneratedExcludedKeys = new Set([...unavailableKeys, ...placedKeys]);
    const regenerated = await _generateFreshSchedule(app, { ...freshScheduleOptions,
      excludedSuggestionKeys: regeneratedExcludedKeys });
    if (!regenerated.error) {
      const regeneratedPicks = (regenerated.activities || []).map(_rankedTaskFromActivity);
      remainingReserves = regenerated.reserveTasks || [];
      const regeneratedPlacement = await _placeIntoOpenHours(app, { activities: filledActivities,
        candidates: [...regeneratedPicks, ...remainingReserves], nowMinutes, obligations, targetDate,
        unavailableKeys: regeneratedExcludedKeys });
      filledActivities = regeneratedPlacement.activities;
      placedActivities = [...placedActivities, ...regeneratedPlacement.placed];
      llmAttributionFooter = regenerated.llmAttributionFooter || null;
    }
  }
  const placedKeySet = new Set(placedActivities.map(suggestionIdentityKey));
  const unplacedReserves = remainingReserves.filter(task => !placedKeySet.has(suggestionIdentityKey(task)));
  if (placedActivities.length) {
    await recordShownTaskSuggestions(app, { domainName, domainUuid, suggestions: placedActivities, targetDate });
    logIfEnabled("[proposed-agenda] filled open hours on cached agenda", { dayKey: dateKeyFromDateInput(targetDate),
      placedCount: placedActivities.length, regenerated: regenerates, remainingReserveCount: unplacedReserves.length });
  }
  return { activities: filledActivities, llmAttributionFooter, placedCount: placedActivities.length,
    reserveTasks: unplacedReserves };
}

// ----------------------------------------------------------------------------------------------
// @desc Place candidates one at a time into the day's open hours, highest ranked first, until no candidate fits or the
//   candidates run out. A placed candidate whose task was completed, dismissed, or deleted is discarded and the next
//   one tried in its place.
// @param {object} app - Amplenote app bridge.
// @param {object} params - An object with the following properties:
//   - {Array<object>} activities - The day's activities in any status, which keep their hours
//   - {Array<object>} candidates - Ranked tasks in the shape refillRejectedSuggestion places
//   - {number|null} nowMinutes - Earliest minute today, or null for a later day
//   - {Array<object>} obligations - The day's scheduled tasks and events
//   - {Date} targetDate - Local midnight of the day
//   - {Set<string>} unavailableKeys - suggestionIdentityKey values that must not be placed
// @returns {Promise<{activities: Array<object>, placed: Array<object>}>} The activities with placements added, in start
//   order, and the placements alone.
async function _placeIntoOpenHours(app, { activities, candidates, nowMinutes, obligations, targetDate, unavailableKeys }) {
  const seenKeys = new Set(unavailableKeys);
  const eligibleCandidates = [];
  for (const candidate of candidates) {
    const key = suggestionIdentityKey(candidate);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    eligibleCandidates.push(candidate);
  }
  const targetMidnightSeconds = Math.floor(targetDate.getTime() / 1000);
  let dayActivities = activities;
  let pool = eligibleCandidates;
  const placed = [];
  while (pool.length) {
    const refill = refillRejectedSuggestion({ activities: dayActivities, nowMinutes, obligations, reserveTasks: pool,
      targetMidnightSeconds });
    if (!refill.placed) break;
    pool = refill.reserveTasks;
    const { staleKeys } = await staleSuggestionReview(app, [refill.placed]);
    if (staleKeys.size) continue;
    dayActivities = refill.activities;
    placed.push(refill.placed);
  }
  return { activities: dayActivities, placed };
}

// ----------------------------------------------------------------------------------------------
// @desc The suggestions a day must not be offered again: those it already holds in any status, those dropped as stale
//   during this reconcile, those an earlier day of the range claimed, and tasks already scheduled on it.
// @param {Array<object>} activities - The day's activities in any status.
// @param {object} options - { excludedSuggestionKeys, obligations, replacedKeys }.
// @returns {Set<string>} suggestionIdentityKey values.
function _unavailableSuggestionKeys(activities, { excludedSuggestionKeys, obligations, replacedKeys }) {
  const scheduledTasks = (obligations || []).filter(obligation => obligation.taskUuid);
  const scheduledTaskKeys = scheduledTasks.map(obligation => suggestionIdentityKey({ taskUuid: obligation.taskUuid }));
  const activityKeys = (activities || []).map(suggestionIdentityKey);
  const unavailableKeys = [...activityKeys, ...scheduledTaskKeys, ...(excludedSuggestionKeys || []), ...(replacedKeys || [])];
  return new Set(unavailableKeys.filter(Boolean));
}

// ----------------------------------------------------------------------------------------------
// @desc A generated activity in the ranked-task shape refillRejectedSuggestion places, which names a task's wording
//   taskText and its reason rationale.
// @param {object} activity - Activity from a generated schedule.
// @returns {object} Ranked task.
function _rankedTaskFromActivity(activity) {
  return { ...activity, rationale: activity.rationale || activity.reason || "", taskText: activity.taskText || activity.title };
}

// ----------------------------------------------------------------------------------------------
// @desc Whether an activity still awaits the user's decision; an activity without a status is pending.
// @param {object} activity - Agenda activity.
// @returns {boolean}
function _isPendingActivity(activity) {
  return (activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING) === PROPOSED_TASK_STATUS.PENDING;
}

// ----------------------------------------------------------------------------------------------
// @desc Keep a cached agenda's pending suggestions off the times the day now has something scheduled. The cache is
//   keyed on the day, priority, and provider, not on its timed events or scheduled tasks, so one added after the agenda
//   was generated would otherwise sit underneath a suggestion. Each overlapping pending suggestion moves to the next
//   free hour, or is dropped when none remains; accepted and dismissed entries keep their time and are avoided.
// @param {Array<object>} activities - Cached activities carrying scheduledEm.
// @param {object} options - { nowMinutes, obligations }: nowMinutes is the earliest start for today, null for a later day.
// @returns {{activities: Array<object>, changed: boolean}} Activities in start order, and whether any pending one moved
//   or was dropped.
function _pendingActivitiesClearOfObligations(activities, { nowMinutes, obligations }) {
  const isPending = activity => (activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING) === PROPOSED_TASK_STATUS.PENDING;
  const pendingActivities = (activities || []).filter(isPending);
  const decidedActivities = (activities || []).filter(activity => !isPending(activity));
  const placement = activitiesClearOfObligations(pendingActivities, { fixedRows: decidedActivities, nowMinutes,
    obligations });
  const changed = placement.movedCount > 0 || placement.droppedCount > 0;
  if (!changed) return { activities: activities || [], changed };
  logIfEnabled("[proposed-agenda] moved cached suggestions off newly scheduled times",
    { droppedCount: placement.droppedCount, movedCount: placement.movedCount });
  const placedActivities = [...decidedActivities, ...placement.activities];
  const sortedActivities = placedActivities.sort((first, second) => first.startMinutes - second.startMinutes);
  return { activities: sortedActivities, changed };
}

// ----------------------------------------------------------------------------------------------
// @desc Detect suggestions the user accepted outside the widget and record them as approvals. The calendar's
//   suggestScheduledTasks surface offers the same proposals but reports no accept/reject callback, so the signal
//   is indirect: a still-pending suggestion whose task now appears among the day's committed obligations was
//   scheduled after the agenda was generated (candidates already on the day are excluded at generation time).
//   Each such suggestion is flipped to "scheduled" in the month record and appended to the decision log, exactly
//   once — updateProposedTaskStatuses reports which entries really moved.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { activities, domainName, domainUuid, obligations, priorityOption, providerEm,
//   scheduledKeys, targetDate }.
//   - {Array<object>} activities - Re-hydrated cached activities (carry scheduledEm/taskUuid).
//   - {Array<object>} obligations - The target day's committed tasks/events.
//   - {Array<string>} scheduledKeys - Keys already known to be scheduled.
// @returns {Promise<{activities: Array<object>, scheduledKeys: Array<string>}>} The activities with newly
//   approved entries marked scheduled, plus the widened scheduled-key list.
async function _reconcileExternalApprovals(app, { activities, domainName, domainUuid, obligations, priorityOption,
    providerEm, scheduledKeys, targetDate }) {
  const obligationTaskUuids = new Set((obligations || []).map(obligation => obligation.taskUuid).filter(Boolean));
  const isPending = activity => (activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING) === PROPOSED_TASK_STATUS.PENDING;
  const approvedActivities = (activities || []).filter(activity => activity.taskUuid && isPending(activity)
    && obligationTaskUuids.has(activity.taskUuid));
  if (approvedActivities.length === 0) return { activities, scheduledKeys };
  const approvedKeys = approvedActivities.map(proposedTaskKey);
  const changedKeys = await updateProposedTaskStatuses(app, { activityKeys: approvedKeys, date: targetDate,
    domainName, domainUuid, priorityKey: priorityOption.key, providerEm,
    scheduledEm: PROPOSED_TASK_STATUS.SCHEDULED });
  const changedKeySet = new Set(changedKeys);
  const decidedActivities = approvedActivities.filter(activity => changedKeySet.has(proposedTaskKey(activity)));
  const decisions = agendaDecisionsFromRows(decidedActivities, { priorityKey: priorityOption.key,
    scheduledEm: PROPOSED_TASK_STATUS.SCHEDULED });
  await recordAgendaDecisions(app, { decisions, domainName });
  logIfEnabled("[proposed-agenda] recorded approvals made outside the widget", { count: decidedActivities.length });
  const approvedKeySet = new Set(approvedKeys);
  const approvedActivityList = (activities || []).map(activity => approvedKeySet.has(proposedTaskKey(activity))
    ? { ...activity, scheduledEm: PROPOSED_TASK_STATUS.SCHEDULED } : activity);
  return { activities: approvedActivityList, scheduledKeys: [...new Set([...(scheduledKeys || []), ...approvedKeys])] };
}

// ----------------------------------------------------------------------------------------------
// @desc Name the pending cached suggestions to replace: those the user already acted on, per staleSuggestionReview,
//   and those an earlier day of the range already holds. An idea the user accepted from the calendar is recorded as
//   accepted on its project, so later rankings stop offering it.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} activities - Re-hydrated cached activities (carry scheduledEm/isExisting/taskUuid/ideaId).
// @param {object} options - { changedNoteUuids, domainName, domainUuid, excludedSuggestionKeys, targetDate }.
// @returns {Promise<Set<string>>} suggestionIdentityKey values whose pending suggestions must be dropped and replaced.
async function _replacedCachedSuggestionKeys(app, activities, { changedNoteUuids, domainName, domainUuid,
    excludedSuggestionKeys, targetDate }) {
  const { acceptedIdeas, staleKeys } = await staleSuggestionReview(app, activities, { changedNoteUuids });
  if (acceptedIdeas.length) await recordSuggestedIdeaDecisions(app, { decisions: acceptedIdeas, domainName, domainUuid,
    targetDate });
  const isPending = activity => (activity.scheduledEm || PROPOSED_TASK_STATUS.PENDING) === PROPOSED_TASK_STATUS.PENDING;
  const pendingKeys = (activities || []).filter(isPending).map(suggestionIdentityKey);
  const claimedKeys = pendingKeys.filter(key => key && excludedSuggestionKeys?.has(key));
  return new Set([...staleKeys, ...claimedKeys]);
}

// ----------------------------------------------------------------------------------------------
// @desc Build replacement suggestions for the vacated (stale) slots from a freshly-generated schedule. Each
//   replacement adopts its stale slot's time and duration (keeping the day's shape and >=1hr gaps intact) while
//   taking the task identity from a fresh suggestion not already present or itself stale. Fewer replacements than
//   stale slots is fine — the surplus slots simply drop out. Returns [] when no fresh schedule is available. A
//   replacement keeps its pick's project, so presenting it can be recorded on that project.
// @param {object} fresh - Payload from _generateFreshSchedule (activities or a structured error).
// @param {Array<object>} keptActivities - Surviving cached activities (their suggestions must not be reused).
// @param {Set<string>} replacedKeys - suggestionIdentityKey values being replaced (never reuse one).
// @param {Array<object>} staleSlots - The cached activities being replaced, in time order, donating their slots.
// @returns {Array<object>} Pending replacement activities.
// [Claude claude-opus-4-8 (1M context)] Task: slot fresh suggestions into the times freed by completed tasks
function _replacementsForStaleSlots(fresh, keptActivities, replacedKeys, staleSlots) {
  if (fresh.error || !Array.isArray(fresh.activities) || fresh.activities.length === 0) return [];
  const usedKeys = new Set(keptActivities.map(suggestionIdentityKey));
  const replacements = [];
  for (const slot of staleSlots) {
    const pick = fresh.activities.find(activity => activity.taskUuid && !usedKeys.has(suggestionIdentityKey(activity))
      && !replacedKeys.has(suggestionIdentityKey(activity)));
    if (!pick) break;
    usedKeys.add(suggestionIdentityKey(pick));
    replacements.push({ benefit: pick.benefit || "", durationMinutes: slot.durationMinutes || 0,
      emphasizedWeekday: pick.emphasizedWeekday, isExisting: true,
      noteUuid: pick.noteUuid || null, projectSummary: pick.projectSummary || null, projectUuid: pick.projectUuid || null,
      reason: pick.reason || "", scheduledEm: PROPOSED_TASK_STATUS.PENDING, source: "proposed",
      startMinutes: slot.startMinutes, startTime: slot.startTime, targetMidnightSeconds: slot.targetMidnightSeconds ?? null,
      taskUuid: pick.taskUuid, title: pick.title });
  }
  return replacements;
}

// ----------------------------------------------------------------------------------------------
// @desc Leave out of a schedule the suggestions another day of the range already holds, from both its timed activities
//   and its untimed reserves. A schedule with nothing excluded, or an error, is returned as it was.
// @param {Set<string>|null} excludedSuggestionKeys - suggestionIdentityKey values to leave out.
// @param {object} schedule - Payload from the LLM schedule generator.
// @returns {object} The schedule without the excluded suggestions.
function _scheduleWithoutExcludedSuggestions(excludedSuggestionKeys, schedule) {
  if (!excludedSuggestionKeys?.size || !Array.isArray(schedule?.activities)) return schedule;
  const isUnclaimed = record => !excludedSuggestionKeys.has(suggestionIdentityKey(record));
  const activities = schedule.activities.filter(isUnclaimed);
  const reserveTasks = Array.isArray(schedule.reserveTasks) ? schedule.reserveTasks.filter(isUnclaimed) : schedule.reserveTasks;
  return { ...schedule, activities, reserveTasks };
}

// ----------------------------------------------------------------------------------------------
// @desc Human phrase for the target day relative to today: "today", "tomorrow", or otherwise the weekday name
//   (e.g. "on Monday") since the resolved day can be several days out after weekend/after-hours skips.
// @param {Date} targetDate - Local midnight of the day the agenda is for.
// @param {Date} [now=new Date()] - Reference "now".
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: describe the scheduled day correctly when it is past "tomorrow"
function _relativeDayWord(targetDate, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const dayDelta = Math.round((targetDate.getTime() - today.getTime()) / MS_PER_DAY);
  if (dayDelta <= 0) return "today";
  if (dayDelta === 1) return "tomorrow";
  return `on ${ targetDate.toLocaleDateString([], { weekday: "long" }) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve which calendar day the agenda is for: today normally, but the next day once the local time is
//   at or past NEXT_DAY_CUTOFF_HOUR (4pm), since there's no longer a meaningful working day left to schedule.
//   Any resulting Saturday/Sunday is then rolled forward to the following Monday so weekend runs schedule the
//   next working day.
// @param {Date} [now=new Date()] - Reference "now"; injectable so tests can pin the resolution without mocking
//   the global clock.
// @returns {Date} Local Date at midnight of the target working day.
// [Claude claude-opus-4-8 (1M context)] Task: target tomorrow's agenda after the 4pm cutoff, skipping weekends
// Prompt: "after 4pm schedule the following day; on the weekend schedule for Monday"
export function resolveProposedAgendaDate(now = new Date()) {
  const dayOffset = now.getHours() >= NEXT_DAY_CUTOFF_HOUR ? 1 : 0;
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, 0, 0, 0);
  return _skipWeekendToMonday(candidate);
}

// ----------------------------------------------------------------------------------------------
// @desc Roll a Saturday or Sunday forward to the following Monday; any weekday is returned unchanged.
// @param {Date} day - Local midnight of a candidate day.
// @returns {Date} Local midnight of the next working day (Mon–Fri).
// [Claude claude-opus-4-8 (1M context)] Task: skip weekends to Monday for the proposed agenda
function _skipWeekendToMonday(day) {
  const weekday = day.getDay();
  const advanceDays = weekday === SATURDAY ? 2 : (weekday === SUNDAY ? 1 : 0);
  if (advanceDays === 0) return day;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + advanceDays, 0, 0, 0);
}

// ----------------------------------------------------------------------------------------------
// @desc Whether two dates fall on the same local calendar day.
// @param {Date} a
// @param {Date} b
// @returns {boolean}
function _isSameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ----------------------------------------------------------------------------------------------
// @desc Apply the recency de-duplication rules to a prior-proposal log, returning the task UUIDs that must be
//   kept out of today's candidate pool: (1) any task proposed on the immediately preceding day (would be two
//   days in a row), and (2) any task already proposed on MAX_PROPOSALS_IN_WINDOW distinct days within the
//   trailing (MAX_PROPOSALS_WINDOW_DAYS - 1) days (a further proposal would exceed twice in a 5-day span).
// @param {Map<string, Set<string>>} history - taskUuid -> set of prior YYYY-MM-DD day-keys it was proposed on.
// @param {Date} targetDate - Local midnight of the day being generated for.
// @returns {Set<string>} Task UUIDs to exclude from the candidate pool.
// [Claude claude-opus-4-8 (1M context)] Task: turn the prior-week proposal log into a candidate-exclusion set
function _recentlyOverproposedTaskUuids(history, targetDate) {
  const yesterdayKey = _dateKeyOffsetDays(targetDate, -1);
  const priorWindowKeys = [];
  for (let daysBack = 1; daysBack < MAX_PROPOSALS_WINDOW_DAYS; daysBack += 1) {
    priorWindowKeys.push(_dateKeyOffsetDays(targetDate, -daysBack));
  }
  const excluded = new Set();
  for (const [taskUuid, dayKeys] of history) {
    if (dayKeys.has(yesterdayKey)) { excluded.add(taskUuid); continue; }
    if (priorWindowKeys.filter(dayKey => dayKeys.has(dayKey)).length >= MAX_PROPOSALS_IN_WINDOW) {
      excluded.add(taskUuid);
    }
  }
  return excluded;
}

// ----------------------------------------------------------------------------------------------
// @desc The YYYY-MM-DD local day-key for a day a whole number of days offset from the given date.
// @param {Date} date - Reference date.
// @param {number} deltaDays - Days to add (negative for earlier days).
// @returns {string} Local day-key.
// [Claude claude-opus-4-8 (1M context)] Task: derive prior day-keys for the recency window
function _dateKeyOffsetDays(date, deltaDays) {
  return dateKeyFromDateInput(new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays, 0, 0, 0));
}

// ----------------------------------------------------------------------------------------------
// @desc Retrieve the relevant slice of the active task domain following the volume rules: prefer all tasks
//   in notes updated within the past month, but always include at least the 200 most-recent open tasks,
//   capped at 1,000 total. The All Notes fallback leaves out notes tagged starter-notes before that slice.
//   For the "barnacle cleanup" priority the ordering flips to surface the stalest tasks
//   in the busiest notes first. Tasks already scheduled (startAt) on the target day are always included and
//   flagged so the LLM can plan around them as fixed commitments. Returns compact records ({ ageDays, duration,
//   important, noteOpenCount, noteUuid, scheduledOnTarget, taskText, taskUuid }).
// @param {object} app - Amplenote app bridge.
// @param {object} priorityOption - Resolved priority option ({ barnacle?, key, ... }).
// @param {Date} targetDate - Local midnight of the day the agenda is being built for.
// @param {string|null} domainUuid - Already-resolved active task domain UUID.
// @returns {Promise<Array<object>>} Compact task records.
// [Claude claude-opus-4-8 (1M context)] Task: gather task-domain tasks per the volume rules, priority-aware
// Prompt: "retrieve at least 200 most recent tasks ... barnacle priority prefers notes with hundreds of open tasks"
// [Claude claude-opus-4-8 (1M context)] Task: always include the target day's already-scheduled commitments
// Prompt: "look up/derive the task and events for the target day before we query the LLM"
// [OpenAI GPT-5.5] Task: accept caller-resolved domain UUID so recommendation context and tasks share scope
async function _selectRelevantTasks(app, priorityOption, targetDate, domainUuid = null) {
  const allTasks = await fetchDomainOrAllNotesTasks(app, domainUuid);
  const openTasks = (Array.isArray(allTasks) ? allTasks : []).filter(task => task && !task.completedAt && !task.dismissedAt);
  const noteOpenCounts = _noteOpenCounts(openTasks);
  const sortedByRecency = openTasks.slice().sort((a, b) => _taskRecencySeconds(b) - _taskRecencySeconds(a));

  const cutoffSeconds = Math.floor((Date.now() - RECENT_WINDOW_DAYS * MS_PER_DAY) / 1000);
  const recentTasks = sortedByRecency.filter(task => _taskRecencySeconds(task) >= cutoffSeconds);
  // Take whichever set is larger (recent-window vs. minimum-200), then cap at MAX_TASKS.
  const targetCount = Math.min(MAX_TASKS, Math.max(recentTasks.length, MIN_RECENT_TASKS));
  const ordered = priorityOption?.barnacle ? _barnacleOrder(openTasks, noteOpenCounts) : sortedByRecency;
  // Always include tasks already scheduled on the target day, even if outside the recency/priority cut, so the
  // LLM sees the day's existing commitments ("events") and schedules around them.
  const scheduledOnTarget = sortedByRecency.filter(task => _isScheduledOnDay(task, targetDate));
  const selected = _dedupeTasks([...ordered.slice(0, targetCount), ...scheduledOnTarget]);
  logIfEnabled("[proposed-agenda] _selectRelevantTasks", { barnacle: !!priorityOption?.barnacle, domainUuid,
    openTaskCount: openTasks.length, recentWindowCount: recentTasks.length,
    scheduledOnTargetCount: scheduledOnTarget.length, selectedCount: selected.length });
  return selected.map(task => _compactTaskRecord(task, noteOpenCounts, targetDate)).filter(Boolean);
}

// ----------------------------------------------------------------------------------------------
// @desc De-duplicate tasks by uuid, preserving first-seen order.
// @param {Array<object>} tasks - Native Amplenote task objects (may contain duplicates).
// @returns {Array<object>}
// [Claude claude-opus-4-8 (1M context)] Task: avoid double-listing tasks that are both recent and scheduled
function _dedupeTasks(tasks) {
  const seen = new Set();
  return tasks.filter(task => {
    if (!task?.uuid || seen.has(task.uuid)) return false;
    seen.add(task.uuid);
    return true;
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a task is scheduled (has a startAt) that lands on the given local calendar day.
// @param {object} task - Native Amplenote task object.
// @param {Date} day - Local midnight of the day in question.
// @returns {boolean}
// [Claude claude-opus-4-8 (1M context)] Task: identify the target day's existing scheduled commitments
function _isScheduledOnDay(task, day) {
  const startMillis = millisFromDateInput(task?.startAt);
  return !!startMillis && _isSameLocalDay(new Date(startMillis), day);
}

// ----------------------------------------------------------------------------------------------
// @desc Count open tasks per owning note, so "barnacle" selection can favor tasks in high-backlog notes.
// @param {Array<object>} openTasks - Open native task objects.
// @returns {Map<string, number>} noteUUID ? open-task count.
function _noteOpenCounts(openTasks) {
  const counts = new Map();
  for (const task of openTasks) {
    const noteUuid = task.noteUUID || null;
    if (!noteUuid) continue;
    counts.set(noteUuid, (counts.get(noteUuid) || 0) + 1);
  }
  return counts;
}

// ----------------------------------------------------------------------------------------------
// @desc Order tasks for the "barnacle cleanup" focus: stalest first (oldest creation), with ties broken by
//   the owning note's open-task count so backlogs in the hundreds rise to the top.
// @param {Array<object>} openTasks - Open native task objects.
// @param {Map<string, number>} noteOpenCounts - noteUUID ? open-task count.
// @returns {Array<object>} Tasks ordered most-barnacle-like first.
// [Claude claude-opus-4-8 (1M context)] Task: rank tasks by staleness + note backlog for barnacle cleanup
function _barnacleOrder(openTasks, noteOpenCounts) {
  const score = task => (noteOpenCounts.get(task.noteUUID || "") || 0) * 1e6 - _taskRecencySeconds(task) / 1e4;
  return openTasks.slice().sort((a, b) => score(b) - score(a));
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce a native Amplenote task to the compact record submitted to the LLM. Drops tasks with no text.
//   Flags tasks already scheduled on the target day so the LLM treats them as fixed commitments.
// @param {object} task - Native Amplenote task object.
// @param {Map<string, number>} noteOpenCounts - noteUUID ? open-task count (for barnacle signal).
// @param {Date} targetDate - Local midnight of the day the agenda is for.
// @returns {object|null} Compact record, or null when the task has no text/uuid.
// [Claude claude-opus-4-8 (1M context)] Task: shape compact task records with age + note-backlog signals
// [Claude claude-opus-4-8 (1M context)] Task: flag tasks already scheduled on the target day
function _compactTaskRecord(task, noteOpenCounts, targetDate) {
  const taskText = String(task.content || "").replace(/\s+/g, " ").trim().substring(0, MAX_TASK_TEXT_CHARS);
  if (!taskText || !task.uuid) return null;
  const noteUuid = task.noteUUID || null;
  return { ageDays: _taskAgeDays(task), duration: task.duration ?? null, important: !!task.important,
    noteOpenCount: noteUuid ? (noteOpenCounts.get(noteUuid) || 0) : 0, noteUuid,
    scheduledOnTarget: _isScheduledOnDay(task, targetDate), taskText, taskUuid: task.uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Whole-day age of a task from its creation time (how long it has lingered), or null when unknown.
// @param {object} task - Native Amplenote task object.
// @returns {number|null}
function _taskAgeDays(task) {
  const createdSeconds = _normalizeSeconds(task?.createdAt);
  if (!createdSeconds) return null;
  return Math.max(0, Math.floor((Date.now() / 1000 - createdSeconds) / (MS_PER_DAY / 1000)));
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize a possibly-ms timestamp to Unix seconds (0 when falsy).
// @param {number|null} raw
// @returns {number}
function _normalizeSeconds(raw) {
  if (!raw) return 0;
  return raw < EPOCH_SECONDS_THRESHOLD ? raw : Math.floor(raw / 1000);
}

// ----------------------------------------------------------------------------------------------
// @desc Best-available recency timestamp (Unix seconds) for ordering: updatedAt, else startAt, else 0.
// @param {object} task - Native Amplenote task object.
// @returns {number} Unix seconds.
function _taskRecencySeconds(task) {
  const raw = task?.updatedAt ?? task?.startAt ?? task?.createdAt ?? 0;
  if (!raw) return 0;
  return raw < EPOCH_SECONDS_THRESHOLD ? raw : Math.floor(raw / 1000);
}

// ----------------------------------------------------------------------------------------------
// @desc Build the prompt, call the LLM (with Ample Agent Pro fallback), and validate the proposed schedule.
//   Tasks already committed to the target day (present in the obligations, or flagged scheduledOnTarget) are
//   dropped from the candidate pool first so the LLM cannot re-propose an already-scheduled task; they remain
//   listed in the immovable obligations section so the schedule is still planned around them.
// @param {object} app - Amplenote app bridge.
// @param {object} params - { aiModelOverride, dateLabel, dayWord, domainName, domainUuid, isFutureDay, nowMinutes,
//   obligations, priorityOption, providerEmOverride, quarterlyContent, recommendationContext, targetDate, tasks }.
// @returns {Promise<object>} Schedule payload or structured error.
// [Claude claude-opus-4-8 (1M context)] Task: request and validate an hour-by-hour schedule from the LLM
// [Claude claude-opus-4-8 (1M context)] Task: drop already-scheduled tasks from the candidate pool before prompting
// [OpenAI GPT-5.5] Task: include shared recommendation context and travel-mode invented activities
async function _generateScheduleFromLlm(app, { aiModelOverride, dateLabel, dayWord, domainName, domainUuid,
    isFutureDay, nowMinutes = null, obligations = [], priorityOption, projectProgress, providerEmOverride, quarterlyContent,
    recommendationContext, targetDate, tasks }) {
  const configuredProviderEm = providerEmOverride || pluginSettings()[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const hasConfiguredProvider = !!configuredProviderEm && configuredProviderEm !== "none";
  if (!hasConfiguredProvider) {
    const ampleAgentNote = await findAmpleAgentProNote(app);
    if (!ampleAgentNote) {
      return { activities: [], error: "No AI provider configured. Please select a provider in plugin settings.",
        errorCode: "no_provider_configured" };
    }
  }

  // Exclude tasks already committed to the target day so the LLM cannot re-propose them (the observed bug where a
  // proposal duplicates a "Scheduled" row). A task is already-scheduled when it appears in the day's obligation
  // records (matched by uuid) or when the domain query flagged it scheduledOnTarget. The excluded tasks stay
  // visible to the LLM in the immovable "Already-scheduled obligations" section, so it still plans around them.
  // [Claude claude-opus-4-8 (1M context)] Task: keep already-scheduled tasks out of the candidate pool
  // Prompt: "ensure that the LLM does *not* suggest tasks that are already scheduled"
  const scheduledTaskUuids = new Set([...obligations.map(o => o.taskUuid).filter(Boolean),
    ...tasks.filter(task => task.scheduledOnTarget).map(task => task.taskUuid)]);

  // Also drop tasks the previous week's proposal log shows were suggested too recently, so the same task is not
  // re-proposed two days running or more than twice in any 5-day window. History read failures degrade to "no
  // recent history" (empty map) so this never blocks generation.
  // [Claude claude-opus-4-8 (1M context)] Task: exclude recently-proposed tasks from the candidate pool
  // Prompt: "not suggest the same task two days in a row; not more than twice in any 5 day period"
  const recentHistory = await recentProposedTaskHistory(app, { date: targetDate, domainName, domainUuid }).catch(error => {
    logIfEnabled("[proposed-agenda] recent-history lookup failed", error?.message); return new Map(); });
  const recentlyProposedUuids = _recentlyOverproposedTaskUuids(recentHistory, targetDate);
  const excludedUuids = new Set([...scheduledTaskUuids, ...recentlyProposedUuids]);
  let proposableTasks = tasks.filter(task => !excludedUuids.has(task.taskUuid));
  // Safety valve: never let the recency rules starve the day of every candidate. When they would empty the pool,
  // relax back to the already-scheduled exclusion only so a schedule can still be built (logged for visibility).
  if (proposableTasks.length === 0 && recentlyProposedUuids.size > 0) {
    proposableTasks = tasks.filter(task => !scheduledTaskUuids.has(task.taskUuid));
    logIfEnabled("[proposed-agenda] recency exclusions emptied the candidate pool; relaxed to scheduled-only");
  }
  logIfEnabled("[proposed-agenda] excluded already-scheduled + recently-proposed tasks from candidates",
    { candidateCount: tasks.length, proposableCount: proposableTasks.length,
      alreadyScheduledCount: scheduledTaskUuids.size, recentlyProposedCount: recentlyProposedUuids.size });

  // The trailing two months of approve/reject decisions, so the LLM can calibrate to what the user actually
  // accepts. Returns "" until the user has decided on a suggestion.
  // [Claude claude-opus-5[1m]] Task: replay the user's past approvals/rejections into the schedule prompt
  const decisionHistoryMarkdown = await recentAgendaDecisionsMarkdown(app, { date: targetDate, domainName });
  const allowInventedTravelActivities = recommendationContextHasTravelOverride(recommendationContext);
  const prompt = _buildSchedulePrompt({ dateLabel, decisionHistoryMarkdown, isFutureDay, nowMinutes, obligations,
    priorityOption, quarterlyContent, recommendationContext, targetDate, tasks: proposableTasks,
    allowInventedTravelActivities });
  const projectInstructions = projectProgress.markdown ? `\n## Quarterly project progress and Plan Builder choices\n${ projectProgress.markdown }\nInclude a task for EVERY due project, prioritizing projects with no completion in the past week. Use the chosen weekly pace and completion count to decide which projects are due; do not cite them in the reason. Projects marked "optional" have no weekly pace chosen: suggest one only after every due project has a task and the day still has room, and never describe the missing pace as a reason to work on it. Respect focus months and preferred weekdays. Task counts are a proxy for blocks, not elapsed work time.\n` : "";
  const ideaInstructions = projectProgress.collectedIdeas ? `\n## Task ideas already collected for these projects\nWhen a due project has no suitable existing task, propose one of its collected ideas verbatim rather than inventing a new one.\n${ projectProgress.collectedIdeas }\n` : "";
  const llmStart = performance.now();
  let result;
  try {
    logIfEnabled("[proposed-agenda] sending prompt to LLM, length:", prompt.length);
    const { aiModel, apiKey, jsonResponse, timeoutSeconds } = _llmOptions(providerEmOverride, aiModelOverride);
    result = await llmPromptWithPluginFallback(app, prompt + projectInstructions + ideaInstructions, { aiModel, apiKey, jsonResponse, timeoutSeconds });
    logIfEnabled("[proposed-agenda] LLM returned", { durationMs: Number((performance.now() - llmStart).toFixed(1)),
      activityCount: Array.isArray(result?.activities) ? result.activities.length : null });
  } catch (error) {
    logIfEnabled("[proposed-agenda] LLM call threw", { message: error?.message, status: error?.response?.status });
    const status = error.response?.status;
    if (status === HTTP_STATUS_UNAUTHORIZED || status === HTTP_STATUS_FORBIDDEN) {
      return { activities: [], error: "The API key appears to be invalid or unauthorized.",
        errorCode: "invalid_api_key" };
    }
    return { activities: [], error: `LLM request failed (${ error.message || "unknown error" }).`,
      errorCode: "llm_error", errorDetail: error.message || null };
  }

  if (!result || !Array.isArray(result.activities)) {
    const snippet = result ? JSON.stringify(result).substring(0, ERROR_SNIPPET_MAX_CHARS) : "empty response";
    return { activities: [], error: "Unable to process the AI provider's response into a schedule.",
      errorCode: "parse_error", errorDetail: snippet };
  }

  const validUuids = new Set(proposableTasks.map(task => task.taskUuid));
  const noteUuidFromTaskUuid = new Map(proposableTasks.map(task => [task.taskUuid, task.noteUuid]));
  const inventedNoteUuid = _noteUuidForInventedActivity(recommendationContext);
  const activities = _validateActivities(result.activities, validUuids, noteUuidFromTaskUuid, targetDate,
    { allowInventedTravelActivities, inventedNoteUuid, nowMinutes, obligations });
  const projectSuggestions = ensureDueProjectSuggestions(activities, { nowMinutes, obligations,
    projects: projectProgress.projects, targetDate, tasks });
  return { ...projectSuggestions, dateLabel, dayWord, isFutureDay,
    llmAttributionFooter: _llmAttributionFooter(providerEmOverride) };
}

// ----------------------------------------------------------------------------------------------
// @desc The prompt section replaying which past suggestions the user approved and which they rejected, so the
//   LLM can bias toward what gets accepted. Renders nothing when no decision has been recorded yet.
// @param {string} decisionHistoryMarkdown - Month-headed decision tables from the decision log ("" when empty).
// @returns {string} Prompt section, or "".
// [Claude claude-opus-5[1m]] Task: fold the approve/reject history into the schedule prompt
// Prompt: "include the tables of what was approved/rejected at what Datetime ... over the last 2 months"
function _decisionHistorySection(decisionHistoryMarkdown) {
  if (!decisionHistoryMarkdown) return "";
  return `\n## How the user responded to your past suggestions (last ${ DECISION_HISTORY_MONTHS } months)\n`
    + `${ decisionHistoryMarkdown }\n`
    + "Each row records when the user decided, whether they approved (scheduled) or rejected (dismissed) the "
    + "suggestion, the task suggested, and the agenda theme it was generated under. Favor the kinds of tasks and "
    + "time slots the user has been approving; do not re-propose a task they have repeatedly rejected, and treat "
    + "a rejected theme's suggestions as needing a stronger justification today.\n";
}

// ----------------------------------------------------------------------------------------------
// @desc Compose the LLM prompt asking for an hour-by-hour schedule with at least one hour between activities,
//   biased by today's priority and worked around any already-scheduled (immovable) obligations. Tells the LLM
//   the target weekday (and whether it is a future day, when the working day is already over or the next working
//   day is past the weekend) and asks it to account for weekends/holidays. The `tasks` passed here are only the
//   proposable candidates — already-scheduled tasks are excluded upstream — so the prompt states the candidates
//   are not yet scheduled and directs the LLM to the obligations section for anything already committed.
// @param {object} params - { allowInventedTravelActivities, dateLabel, decisionHistoryMarkdown, isFutureDay,
//   nowMinutes, obligations, priorityOption, quarterlyContent, recommendationContext, targetDate, tasks }.
//   - {string} decisionHistoryMarkdown - Month-headed tables of the suggestions the user has approved/rejected
//     over the trailing two months ("" when nothing has been decided yet).
// @returns {string}
// [Claude claude-opus-4-8 (1M context)] Task: write the priority-aware, obligation-aware schedule prompt
// [Claude claude-opus-4-8 (1M context)] Task: tell the LLM the weekday / future-day and to plan around scheduled tasks
// Prompt: "ask the LLM to consider the day of the week and any holidays when proposing its agenda"
// [Claude claude-opus-4-8 (1M context)] Task: send the occupied-times array + only-schedule-the-remaining-day rules
// Prompt: "submit an array of already-occupied times; do not propose tasks in the past; work day ends at 6pm"
// [OpenAI GPT-5.5] Task: add shared recommendation instructions and travel-mode invented activity rules
function _buildSchedulePrompt({ allowInventedTravelActivities = false, dateLabel, decisionHistoryMarkdown = "",
    isFutureDay, nowMinutes = null, obligations = [], priorityOption, quarterlyContent, recommendationContext,
    targetDate, tasks }) {
  const weekday = targetDate.toLocaleDateString([], { weekday: "long" });
  const futureDayNote = isFutureDay
    ? " This agenda is for an upcoming day rather than today, so plan it as a fresh start to that day."
    : "";
  const workDayEnd = _timeStringFromMinutes(WORK_DAY_END_HOUR * MINUTES_PER_HOUR);
  let prompt = `You are a productivity coach. Build a realistic hour-by-hour schedule for ${ dateLabel }, which is a ${ weekday }.${ futureDayNote }

## Today's priority
${ priorityOption?.instruction || "Build a balanced, high-leverage day." }

## Scheduling rules
- Take the day of the week into account: ${ weekday } may be a weekend or carry different working hours and energy than a weekday — plan accordingly.
- Consider whether ${ dateLabel } is a public holiday or a day people commonly take off; if so, lighten the schedule or skip work-focused blocks as appropriate.
- Propose specific clock times in 24-hour "HH:MM" format, ordered chronologically across a normal working day.
- Leave AT LEAST ${ MIN_GAP_MINUTES } minutes of unscheduled buffer between the end of one activity and the start of the next.
- Work AROUND the already-scheduled obligations below: never overlap them and never re-propose them.
- The Candidate tasks below are NOT yet scheduled for ${ dateLabel }; anything already committed to the day appears only in the obligations section and must not be proposed again.
- ${ allowInventedTravelActivities ? "Travel/vacation/conference all-day context is active: prefer useful trip-appropriate activities, and you may return null taskUuid for invented local recommendations." : "ONLY propose activities for tasks that appear in the Candidate tasks JSON below." }
- ${ allowInventedTravelActivities ? "For existing tasks, use the exact taskUuid from one candidate task. For invented travel activities, set taskUuid to null." : "Every returned activity MUST use the exact \"taskUuid\" from one candidate task; never invent tasks or UUIDs." }
- ${ allowInventedTravelActivities ? "Do not propose generic breaks, planning, or review blocks; invented null-UUID items should be concrete local/travel activities." : "Do not propose breaks, planning, review, calendar blocks, or other supporting activities unless they are candidate tasks." }
- Favor the user's "important" tasks and tasks that advance the quarterly plan, weighted by today's priority.
- Respect each task's "duration" (seconds) when present; otherwise estimate a sensible duration.
`;
  // When the agenda is for today, the day has already partly elapsed: only schedule the remaining part of the
  // working day (now → 18:00), never the past. After-hours blocks are proposed only when the priority calls for
  // activities that naturally happen outside work hours.
  if (nowMinutes != null) {
    prompt += `- The current local time is ${ _timeStringFromMinutes(nowMinutes) }. Do NOT propose any activity that starts before this time — only schedule the remaining part of the day.\n`;
    prompt += `- The working day ends at ${ workDayEnd } (6pm). Keep proposed activities between the current time and ${ workDayEnd }. Only propose activities after ${ workDayEnd } if today's priority explicitly calls for activities that naturally happen outside of work hours.\n`;
  }

  // The occupied-times array (tasks AND events already committed to the day) plus the do-not-intrude rule with a
  // preferred buffer. This mirrors the immovable-obligations list below but in the compact clock-range form the
  // request specifies, so the LLM has an at-a-glance view of every slot it must avoid.
  const occupiedTimes = _occupiedTimeSlots(obligations);
  prompt += `\n## Already occupied times\n`;
  prompt += `Already occupied times: [ ${ occupiedTimes.join(", ") || "none" } ]. Ensure that your suggestions do NOT include any task that would fall in these already-scheduled time slots for the day. Attempt to leave at least a ${ OBLIGATION_BUFFER_MINUTES } minute buffer between the user's events and your suggestions.\n`;

  prompt += `\n## Already-scheduled obligations (immovable; do not re-propose)\n`;
  prompt += obligations.length > 0
    ? obligations.map(o => `- ${ _timeStringFromMinutes(o.startMinutes) } ${ o.title }`
        + `${ o.durationMinutes ? ` (${ o.durationMinutes }m)` : "" }`).join("\n")
    : "None.";
  prompt += "\n";

  if (quarterlyContent) {
    prompt += `\n## User's Quarterly Plan\n${ quarterlyContent }\n`;
  } else {
    prompt += `\n## User's Quarterly Plan\nNo quarterly plan found.\n`;
  }

  prompt += _decisionHistorySection(decisionHistoryMarkdown);

  prompt += recommendationInstructionsFromContext(recommendationContext, { allowInventedTravelActivities,
    scheduleMode: true });

  prompt += `\n## Candidate tasks (JSON; ${ tasks.length } total)\n`;
  prompt += tasks.length > 0
    ? tasks.map(task => JSON.stringify(task)).join("\n")
    : "No candidate tasks.";

  prompt += `

Return ONLY valid JSON (no markdown fences) in exactly this shape:
{"activities":[{"startTime":"09:00","durationMinutes":60,"title":"Activity title","taskUuid":"existing-task-uuid","reason":"One or two sentences on why the user is better off after completing this task"}]}
- "startTime": 24-hour "HH:MM". REQUIRED for every activity.
- "durationMinutes": positive integer minutes. REQUIRED for every activity — every suggestion must have both a start time and a length, so never omit it or return 0.
- "reason": REQUIRED — one sentence, or two at most, answering "Why am I better off after completing this task?" Write a direct statement of the benefit of finishing the task.
- "taskUuid": ${ allowInventedTravelActivities ? "the exact \"taskUuid\" from a candidate task, or null only for an invented travel/vacation/conference activity." : "the exact \"taskUuid\" from a candidate task. Activities without a candidate taskUuid will be discarded." }
- Keep titles concise. Provide between 4 and 10 activities.`;
  return prompt;
}

// ----------------------------------------------------------------------------------------------
// @desc Validate/normalize the LLM activity list: keep only well-formed entries that reference supplied candidate
//   tasks, sort by start time, attach the owning note UUID, then enforce the >=1hr gap so the contract holds even
//   when the LLM proposes overlapping or too-close slots.
// @param {Array<object>} activities - Raw activities from the LLM.
// @param {Set<string>} validUuids - Task UUIDs that may be referenced.
// @param {Map<string,string>} noteUuidFromTaskUuid - Task UUID -> note UUID lookup.
// @param {Date} targetDate - Local midnight of the day each activity should be scheduled on.
// @param {object} [options] - { allowInventedTravelActivities, inventedNoteUuid, nowMinutes, obligations }: the
//   current time-of-day to clamp today's schedule to, and committed obligations the schedule must never overlap.
// @returns {Array<object>} Normalized, gap-corrected activities with startMinutes for rendering/scheduling.
// [Claude claude-opus-4-8 (1M context)] Task: validate, order, and gap-enforce proposed schedule activities
// [OpenAI GPT-5.5] Task: discard and log LLM activities that do not reference candidate tasks
// [Claude claude-opus-4-8 (1M context)] Task: stamp each activity with the target day's midnight for cross-day scheduling
// [Claude claude-opus-4-8 (1M context)] Task: drop past activities and guarantee non-overlap with obligations
// [OpenAI GPT-5.5] Task: allow null-UUID invented activities only when travel context authorizes them
function _validateActivities(activities, validUuids, noteUuidFromTaskUuid, targetDate, {
    allowInventedTravelActivities = false, inventedNoteUuid = null, nowMinutes = null, obligations = [] } = {}) {
  const targetMidnightSeconds = Math.floor(targetDate.getTime() / 1000);
  const normalized = activities
    .map(activity => {
      const startMinutes = _minutesFromTimeString(activity?.startTime);
      const title = String(activity?.title || "").trim();
      const taskUuid = _validatedActivityTaskUuid(activity, validUuids, { allowInventedTravelActivities });
      if (startMinutes == null || !title || taskUuid === undefined) return null;
      const durationMinutes = Math.max(0, parseInt(activity?.durationMinutes, 10) || 0)
        || DEFAULT_ACTIVITY_DURATION_MINUTES;
      const isExisting = !!taskUuid;
      return { durationMinutes, isExisting, noteUuid: isExisting ? (noteUuidFromTaskUuid.get(taskUuid) || null) : inventedNoteUuid,
        reason: _activityReason(activity, startMinutes), source: "proposed", startMinutes,
        startTime: _timeStringFromMinutes(startMinutes), targetMidnightSeconds, taskUuid: taskUuid || null, title };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinutes - b.startMinutes);
  return _enforceGap(normalized, { earliestStart: nowMinutes || 0, occupiedBlocks: _occupiedBlocks(obligations) });
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize the LLM explanation, supplying a slot-based sentence when it is blank.
// @param {object} activity - Raw LLM activity.
// @param {number} startMinutes - The activity's validated start, minutes since midnight.
// @returns {string} A single sentence.
function _activityReason(activity, startMinutes) {
  const reason = String(activity?.reason || "").replace(/\s+/g, " ").trim();
  if (reason) return reason;
  return `This slot is free at ${ _amPmClockFromMinutes(startMinutes) } and the task fits today's priority.`;
}

// ----------------------------------------------------------------------------------------------
// @desc Return a candidate task UUID when the activity references one, otherwise log the discarded suggestion.
// @param {object} activity - Raw LLM activity.
// @param {Set<string>} validUuids - Task UUIDs present in the submitted candidate task array.
// @param {object} [options={}] - { allowInventedTravelActivities }.
// @returns {string|null|undefined} Valid UUID, null for allowed invented activity, undefined to discard.
// [OpenAI GPT-5.5] Task: log hallucinated proposed-agenda suggestions before discarding them
// [OpenAI GPT-5.5] Task: keep invented travel-mode suggestions with null taskUuid
function _validatedActivityTaskUuid(activity, validUuids, { allowInventedTravelActivities = false } = {}) {
  const taskUuid = typeof activity?.taskUuid === "string" ? activity.taskUuid.trim() : "";
  if (taskUuid && validUuids.has(taskUuid)) return taskUuid;
  if (!taskUuid && allowInventedTravelActivities) return null;
  logIfEnabled("[proposed-agenda] discarding LLM activity without extant taskUuid", { taskUuid: taskUuid || null,
    title: String(activity?.title || "").trim() || null });
  return undefined;
}

// ----------------------------------------------------------------------------------------------
// @desc Push any activity that starts sooner than MIN_GAP_MINUTES after the previous one's end to a later
//   start, so the rendered/scheduled agenda always leaves at least one hour between activities. Also clamps the
//   earliest start to `earliestStart` (so today's schedule never lands in the past) and pushes any activity that
//   would overlap a committed obligation past that obligation's end, hard-guaranteeing the schedule never
//   intrudes into an existing task/event. Activities pushed past the end of the day are dropped.
// @param {Array<object>} sortedActivities - Activities already sorted ascending by startMinutes.
// @param {object} [options] - { earliestStart, occupiedBlocks }.
// @returns {Array<object>} Gap-corrected activities (startTime/startMinutes updated in place on copies).
// [Claude claude-opus-4-8 (1M context)] Task: guarantee the >=1hr inter-activity gap from the spec
// [Claude claude-opus-4-8 (1M context)] Task: clamp to the current time and never overlap obligations
function _enforceGap(sortedActivities, { earliestStart = 0, occupiedBlocks = [] } = {}) {
  const result = [];
  let earliestNextStart = earliestStart;
  for (const activity of sortedActivities) {
    let startMinutes = Math.max(activity.startMinutes, earliestNextStart);
    startMinutes = _pushPastObligations(startMinutes, activity.durationMinutes, occupiedBlocks);
    if (startMinutes >= 24 * 60) continue;
    const corrected = { ...activity, startMinutes, startTime: _timeStringFromMinutes(startMinutes) };
    result.push(corrected);
    earliestNextStart = startMinutes + corrected.durationMinutes + MIN_GAP_MINUTES;
  }
  return result;
}

// ----------------------------------------------------------------------------------------------
// @desc Advance a proposed start time until the [start, start+duration) span clears every occupied obligation
//   block, so no portion of a proposed activity intrudes into an already-scheduled task/event. Each time the
//   span overlaps a block, the start is bumped to that block's end and the scan restarts (a later block may now
//   be in range). A zero-length activity is treated as occupying its start instant.
// @param {number} startMinutes - Candidate start (already clamped for prior activities / current time).
// @param {number} durationMinutes - The activity's duration.
// @param {Array<{endMinutes: number, startMinutes: number}>} occupiedBlocks - Obligation blocks.
// @returns {number} A start time whose span overlaps no obligation block.
// [Claude claude-opus-4-8 (1M context)] Task: shift proposals out of committed obligation slots
function _pushPastObligations(startMinutes, durationMinutes, occupiedBlocks) {
  if (!occupiedBlocks.length) return startMinutes;
  const span = Math.max(durationMinutes, 1);
  let start = startMinutes;
  let moved = true;
  while (moved) {
    moved = false;
    for (const block of occupiedBlocks) {
      if (start < block.endMinutes && block.startMinutes < start + span) {
        start = block.endMinutes;
        moved = true;
      }
    }
  }
  return start;
}

// ----------------------------------------------------------------------------------------------
// @desc Parse an "HH:MM" 24-hour string into minutes since midnight.
// @param {string} timeString - e.g. "09:30".
// @returns {number|null} Minutes since midnight, or null when unparseable.
function _minutesFromTimeString(timeString) {
  if (typeof timeString !== "string") return null;
  const match = timeString.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// ----------------------------------------------------------------------------------------------
// @desc Format minutes-since-midnight as a zero-padded "HH:MM" string.
// @param {number} totalMinutes - Minutes since midnight.
// @returns {string}
function _timeStringFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${ String(hours).padStart(2, "0") }:${ String(minutes).padStart(2, "0") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Format minutes-since-midnight as a 12-hour "h:mmam"/"h:mmpm" clock string (e.g. 495 -> "8:15am"),
//   matching the human occupied-times array the prompt sends.
// @param {number} totalMinutes - Minutes since midnight.
// @returns {string}
function _amPmClockFromMinutes(totalMinutes) {
  const hours24 = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${ hours12 }:${ String(minutes).padStart(2, "0") }${ suffix }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Turn the day's obligations (tasks AND events already committed) into the compact clock-range strings
//   that make up the "Already occupied times" array — e.g. "8:15am-9:15am" when a duration is known, or a bare
//   "4:00pm" start when it is not. Obligations without a parseable start are skipped.
// @param {Array<object>} obligations - Obligation records ({ durationMinutes, startMinutes, ... }).
// @returns {Array<string>} Occupied-time labels in ascending start order.
function _occupiedTimeSlots(obligations) {
  return (obligations || []).filter(o => o && typeof o.startMinutes === "number")
    .slice().sort((a, b) => a.startMinutes - b.startMinutes)
    .map(o => o.durationMinutes
      ? `${ _amPmClockFromMinutes(o.startMinutes) }-${ _amPmClockFromMinutes(o.startMinutes + o.durationMinutes) }`
      : _amPmClockFromMinutes(o.startMinutes));
}

// ----------------------------------------------------------------------------------------------
// @desc Reduce the day's obligations to occupied [startMinutes, endMinutes) blocks the schedule must not
//   overlap. A task/event with a known duration occupies its whole span; one without a duration occupies just
//   its start instant. Used to hard-guarantee proposed activities never intrude into a committed slot.
// @param {Array<object>} obligations - Obligation records.
// @returns {Array<{endMinutes: number, startMinutes: number}>} Blocks in ascending start order.
function _occupiedBlocks(obligations) {
  return (obligations || []).filter(o => o && typeof o.startMinutes === "number")
    .map(o => ({ endMinutes: o.startMinutes + (o.durationMinutes || 0), startMinutes: o.startMinutes }))
    .sort((a, b) => a.startMinutes - b.startMinutes);
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the best note for invented travel activities: first matching research note, otherwise null so
//   scheduling can lazily create the shared travel-recommendations note.
// @param {object|null} recommendationContext - Shared recommendation context.
// @returns {string|null}
// [OpenAI GPT-5.5] Task: attach invented travel ideas to the most relevant research note when possible
function _noteUuidForInventedActivity(recommendationContext) {
  const researchNote = (recommendationContext?.researchNotes || []).find(note => note?.uuid);
  return researchNote?.uuid || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Convert a proposed activity's start time into a Unix-seconds startAt on its target day. Falls back to
//   today's local midnight when no target day is supplied (e.g. legacy callers).
// @param {number} startMinutes - Minutes since local midnight.
// @param {number|null} [targetMidnightSeconds=null] - Unix-seconds local midnight of the activity's day.
// @returns {number} Unix seconds.
// [Claude claude-opus-4-8 (1M context)] Task: derive an approved activity's startAt on its (possibly future) day
export function startAtSecondsFromMinutesToday(startMinutes, targetMidnightSeconds = null) {
  if (targetMidnightSeconds != null) return targetMidnightSeconds + startMinutes * SECONDS_PER_MINUTE;
  const localMidnight = localMidnightFromDateInput(new Date());
  return Math.floor(localMidnight.getTime() / 1000) + startMinutes * SECONDS_PER_MINUTE;
}

// ----------------------------------------------------------------------------------------------
// @desc Schedule an existing task, accept a generated idea, reuse a dated project-step checkbox, or insert a new travel
//   task in its note.
// @param {object} app - Amplenote app bridge.
// @param {object} activity - Validated activity record from generateProposedAgenda.
// @param {string|null} defaultNoteUuid - Fallback note UUID for newly-created activities.
// @returns {Promise<{reason?: string, startAt?: number, taskUuid?: string}>}
// [Claude claude-opus-4-8 (1M context)] Task: persist an approved activity to a scheduled task
// Prompt: "link to approve scheduling the task at a particular time"
export async function scheduleProposedActivity(app, activity, defaultNoteUuid) {
  const startAt = startAtSecondsFromMinutesToday(activity.startMinutes, activity.targetMidnightSeconds ?? null);
  if (activity.isExisting && activity.taskUuid) {
    const updated = await app.updateTask(activity.taskUuid, { startAt });
    return updated ? { startAt, taskUuid: activity.taskUuid } : { reason: "update_failed", taskUuid: activity.taskUuid };
  }
  if (activity.ideaId && activity.projectUuid) return _scheduledIdeaActivity(app, activity, startAt);
  if (activity.projectUuid) return scheduleProjectStep(activity, app, startAt);
  const targetNoteUuid = activity.noteUuid || defaultNoteUuid || await _travelRecommendationsNoteUuid(app);
  if (!targetNoteUuid) return { reason: "missing_note" };
  const taskUuid = await app.insertTask({ uuid: targetNoteUuid }, { content: activity.title, startAt });
  return taskUuid ? { noteUuid: targetNoteUuid, startAt, taskUuid } : { reason: "insert_failed" };
}

// ----------------------------------------------------------------------------------------------
// @desc Schedule a generated idea the user accepted. An idea already accepted, from another surface or an earlier
//   attempt, reschedules the task it became instead of creating a second one; otherwise it becomes a dated project
//   step. Either way the idea records the task it was accepted as.
// @param {object} app - Amplenote app bridge.
// @param {object} activity - Idea activity carrying ideaId, projectUuid, and title.
// @param {number} startAt - Approved calendar time in Unix seconds.
// @returns {Promise<object>} Scheduled task identity or an explicit failure reason, as scheduleProposedActivity returns.
async function _scheduledIdeaActivity(app, activity, startAt) {
  const { domainName, domainUuid } = await activeTaskDomainInfo(app);
  const targetDate = activity.targetMidnightSeconds ? new Date(activity.targetMidnightSeconds * 1000) : new Date();
  const ideaIdentity = { ideaId: activity.ideaId, projectUuid: activity.projectUuid };
  const accepted = await existingTaskForAcceptedIdea(app, { ...ideaIdentity, domainName, domainUuid, targetDate });
  let result;
  if (accepted) {
    const updated = await app.updateTask(accepted.taskUuid, { startAt });
    result = updated ? { noteUuid: accepted.noteUuid, startAt, taskUuid: accepted.taskUuid } : { reason: "update_failed" };
  } else result = await scheduleProjectStep(activity, app, startAt);
  if (result.taskUuid) {
    await recordSuggestedIdeaDecisions(app, { decisions: [{ ...ideaIdentity, acceptedTaskUuid: result.taskUuid,
      status: IDEA_STATUSES.accepted }], domainName, domainUuid, targetDate });
  }
  return result;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve or create the fallback note used when scheduling an invented travel/vacation recommendation.
// @param {object} app - Amplenote app bridge.
// @returns {Promise<string|null>} Note UUID, or null when the note cannot be resolved.
// [OpenAI GPT-5.5] Task: lazily create a destination note for invented travel recommendations
async function _travelRecommendationsNoteUuid(app) {
  if (typeof app.findNote !== "function" || typeof app.createNote !== "function") return null;
  const existing = await app.findNote({ name: TRAVEL_RECOMMENDATIONS_NOTE_NAME, tags: [DASHBOARD_NOTE_TAG] })
    .catch(() => null);
  if (existing?.uuid) return existing.uuid;
  const created = await app.createNote(TRAVEL_RECOMMENDATIONS_NOTE_NAME, [DASHBOARD_NOTE_TAG], { archive: false })
    .catch(() => null);
  return typeof created === "object" ? (created?.uuid || null) : created || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Approve the full schedule by sequentially scheduling every activity that is not already scheduled.
// @param {object} app - Amplenote app bridge.
// @param {Array<object>} activities - Validated activity records.
// @param {string|null} defaultNoteUuid - Fallback note UUID for newly-created activities.
// @returns {Promise<{failed: number, scheduled: number}>}
// [Claude claude-opus-4-8 (1M context)] Task: approve the whole agenda at once
// Prompt: "add a button to approve the schedule"
export async function approveProposedAgenda(app, activities, defaultNoteUuid) {
  let failed = 0;
  let scheduled = 0;
  for (const activity of activities) {
    const result = await scheduleProposedActivity(app, activity, defaultNoteUuid);
    if (result.taskUuid) scheduled += 1; else failed += 1;
  }
  logIfEnabled("[proposed-agenda] approveProposedAgenda complete", { failed, scheduled });
  return { failed, scheduled };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the concrete provider enum that a generation will use, for use as the cache-record's "LLM"
//   dimension: an explicit override wins, else the dashboard-configured provider, else "default" (the
//   Ample-Agent-Pro fallback path, which has no per-provider key).
// @param {string|null} providerEmOverride - Optional provider enum override.
// @returns {string}
function _resolveProviderEm(providerEmOverride = null) {
  return providerEmOverride || pluginSettings()[SETTING_KEYS.LLM_PROVIDER_MODEL] || "default";
}

// ----------------------------------------------------------------------------------------------
// @desc Build the llmPrompt options object, honoring a provider override and the dev OpenAI token override.
// @param {string|null} providerEmOverride - Optional provider enum override.
// @param {string|null} aiModelOverride - Optional explicit model id; when set it replaces the resolved model
//   while keeping the resolved API key. Primarily a testing seam to pin a cheap model.
// @returns {object} Options for llmPromptWithPluginFallback.
// [Claude claude-opus-4-8 (1M context)] Task: resolve LLM model/key options (mirrors dream-task-service)
// [Claude claude-opus-4-8 (1M context)] Task: honor any provider's dev token (first available), not just OpenAI
// Prompt: "dev environment isn't showing suggestions in spite of having GROK_AI_ACCESS_TOKEN present"
function _llmOptions(providerEmOverride = null, aiModelOverride = null) {
  const settings = pluginSettings();
  const llmOptions = { jsonResponse: true, timeoutSeconds: LLM_TIMEOUT_SECONDS };
  const applyModelOverride = () => { if (aiModelOverride) llmOptions.aiModel = aiModelOverride; };
  if (providerEmOverride) {
    const overrideModel = PROVIDER_DEFAULT_MODEL[providerEmOverride] || null;
    const overrideApiSetting = apiKeyFromProvider(providerEmOverride);
    const overrideApiKey = overrideApiSetting ? (settings?.[overrideApiSetting] || "").trim() : "";
    if (overrideModel && overrideApiKey) {
      llmOptions.aiModel = overrideModel;
      llmOptions.apiKey = overrideApiKey;
      applyModelOverride();
      return llmOptions;
    }
  }
  const providerEm = settings[SETTING_KEYS.LLM_PROVIDER_MODEL];
  const dashboardBucket = apiKeyBucketFromLlmProvider(providerEm);
  const devOverride = devLlmOverride(PROVIDER_DEFAULT_MODEL);
  if (devOverride) {
    llmOptions.aiModel = devOverride.model;
    llmOptions.apiKey = devOverride.apiKey;
    logIfEnabled(`[proposed-agenda] Dev mode: using ${devOverride.provider} dev token (model ${devOverride.model})`);
  } else if (providerEm && PROVIDER_DEFAULT_MODEL[providerEm]) {
    llmOptions.aiModel = PROVIDER_DEFAULT_MODEL[providerEm];
    const apiSetting = apiKeyFromProvider(dashboardBucket);
    const apiKey = apiSetting ? (settings[apiSetting] || "").trim() : "";
    if (apiKey) llmOptions.apiKey = apiKey;
  }
  applyModelOverride();
  return llmOptions;
}

// ----------------------------------------------------------------------------------------------
// @desc Short provider/model attribution string shown beneath the agenda.
// @param {string|null} providerEmOverride - Optional provider enum override.
// @returns {string|null}
// [Claude claude-opus-4-8 (1M context)] Task: surface which LLM produced the schedule
function _llmAttributionFooter(providerEmOverride = null) {
  const model = _llmOptions(providerEmOverride).aiModel;
  return model ? `Schedule proposed by ${ model }` : null;
}
