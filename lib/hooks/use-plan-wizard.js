// Adapt the plan-wizard service to the React embed: load cached goals and suggestions before any inference runs,
// keep in-flight responses from a superseded scope out of the rendered state, and never let a background refresh
// overwrite text the user is presently typing.

import { planningRecordUuid } from "plan-wizard/plan-models";
import { readPlanGoals, refreshPlanIntentPossibilities, savePlanGoals, savePlanProspects,
  savePlanQuarterAnswer } from "plan-wizard/plan-wizard-service";
import { useCallback, useEffect, useRef, useState } from "react";
import { logIfEnabled } from "util/log";

const EMPTY_CONTEXT = { dailySufficiency: null, generatedAt: { personal: null, work: null }, goalRecords: [],
  goals: [], noteUuid: null, possibilities: { personal: [], work: [] }, prospectRecords: [], prospects: [],
  quarterName: null, scope: null };

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a scope has usable cached suggestions, so a mount reads without calling the provider.
// @param {object} planningContext - Context returned by readPlanGoals.
// @returns {boolean} True when either category already holds at least one stored possibility.
// The plan requires cached suggestions and picked intents to render before any LLM call.
export function hasCachedPossibilities(planningContext) {
  const personal = planningContext?.possibilities?.personal ?? [];
  const work = planningContext?.possibilities?.work ?? [];
  return personal.length > 0 || work.length > 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the scope key that identifies which domain and quarter a response belongs to.
// @param {object} options - { domainName, domainUuid, quarter, year }.
// @returns {string} Comparable key; a change in any part invalidates an in-flight request.
export function planScopeKey({ domainName = null, domainUuid = null, quarter = null, year = null } = {}) {
  return [domainUuid ?? "all-notes", domainName ?? "All Notes", year ?? "next", quarter ?? "next"].join("::");
}

// ----------------------------------------------------------------------------------------------
// @desc Read a scope's stored goals and suggestions, refresh inference only when asked or when nothing is
//   cached, and expose save with its failure retained for retry.
// @param {Object} params - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {string|null} domainName - Name of the task domain being planned, or null for all notes.
//   - {string|null} domainUuid - UUID of that task domain, or null for all notes.
//   - {number|null} quarter - Quarter being planned.
//   - {number|null} year - Year of the quarter being planned.
// @returns {object} An object with the following properties:
//   - {Error|null} error - Last load or refresh failure, cleared by a successful attempt.
//   - {boolean} isLoading - True while an initial read or a refresh for the current scope is in flight.
//   - {boolean} isRefreshing - True only while inference is running, so the UI can keep fields editable.
//   - {boolean} isSaving - True while savePlanGoals is in flight.
//   - {object} planningContext - Current goals, goal records, suggestions, and resolved scope.
//   - {Error|null} saveError - Last save failure; the caller retains user input and offers retry.
//   - {Function} refreshPossibilities - Explicitly rerun inference for the current scope.
//   - {Function} reload - Re-read stored state for the current scope without invoking inference.
//   - {Function} saveGoals - Persist goal records, returning true when the write succeeded.
//   - {Function} saveProspects - Persist project records, returning true when the write succeeded.
//   - {Function} saveQuarterAnswer - Persist one quarter-wide answer, returning true when the write succeeded.
export default function usePlanWizard({ app, domainName = null, domainUuid = null, quarter = null, year = null }) {
  const scopeOptions = { domainName, domainUuid, quarter, year };
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [planningContext, setPlanningContext] = useState(EMPTY_CONTEXT);
  const [saveError, setSaveError] = useState(null);
  const requestTokenRef = useRef(null);
  const scopeKey = planScopeKey(scopeOptions);

  // ----------------------------------------------------------------------------------------------
  // @desc Claim the newest request slot, so an earlier scope's resolution can be recognized and discarded.
  // @returns {object} Token compared by identity when a request resolves.
  const claimRequest = useCallback(() => {
    const token = { scopeKey };
    requestTokenRef.current = token;
    return token;
  }, [scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Report whether a resolved request is still the one the user is waiting on.
  // @param {object} token - Token claimed before the request started.
  // @returns {boolean} False once a later request or a scope switch superseded this one.
  const isCurrentRequest = useCallback(token => requestTokenRef.current === token, []);

  // ----------------------------------------------------------------------------------------------
  // @desc Re-read stored goals and suggestions for the current scope without triggering inference.
  // @returns {Promise<object|null>} The planning context that was applied, or null when superseded or failed.
  const reload = useCallback(async () => {
    const token = claimRequest();
    setIsLoading(true);
    try {
      const context = await readPlanGoals(app, scopeOptions);
      if (!isCurrentRequest(token)) return null;
      setError(null);
      setPlanningContext(context);
      return context;
    } catch (readError) {
      logIfEnabled("[use-plan-wizard] failed to read stored plan goals", readError?.message);
      if (isCurrentRequest(token)) setError(readError);
      return null;
    } finally {
      if (isCurrentRequest(token)) setIsLoading(false);
    }
  }, [app, claimRequest, isCurrentRequest, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Run evidence collection and inference for the current scope and adopt the refreshed suggestions.
  // @returns {Promise<object|null>} The refreshed planning context, or null when superseded or failed.
  // Suggestions are the only thing this replaces; goals and any text being typed are untouched.
  const refreshPossibilities = useCallback(async () => {
    const token = claimRequest();
    setIsRefreshing(true);
    try {
      const context = await refreshPlanIntentPossibilities(app, scopeOptions);
      if (!isCurrentRequest(token)) return null;
      setError(null);
      setPlanningContext(context);
      return context;
    } catch (refreshError) {
      logIfEnabled("[use-plan-wizard] intent refresh failed", refreshError?.message);
      if (isCurrentRequest(token)) setError(refreshError);
      return null;
    } finally {
      if (isCurrentRequest(token)) setIsRefreshing(false);
    }
  }, [app, claimRequest, isCurrentRequest, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Run one write, adopting the verified context it returns and retaining its failure for retry. Every save
  //   the wizard performs shares this path so a superseded scope's write can never apply its result.
  // @param {Function} writeContext - Performs the write and resolves to the new planning context.
  // @param {string} label - Names the write in a diagnostic log line.
  // @returns {Promise<boolean>} True when the write succeeded and its result was applied.
  // A failure keeps the previous context so the caller can retain the user's input and retry.
  const runSave = useCallback(async (writeContext, label) => {
    const token = claimRequest();
    setIsSaving(true);
    setSaveError(null);
    try {
      const context = await writeContext();
      if (!isCurrentRequest(token)) return false;
      setPlanningContext(context);
      return true;
    } catch (writeError) {
      logIfEnabled(`[use-plan-wizard] failed to save ${ label }`, writeError?.message);
      if (isCurrentRequest(token)) setSaveError(writeError);
      return false;
    } finally {
      if (isCurrentRequest(token)) setIsSaving(false);
    }
  }, [claimRequest, isCurrentRequest]);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist goal records and adopt the verified context the service returns.
  // @param {Array<object>} goals - Records shaped for savePlanGoals; the caller supplies a stable capturedAt.
  // @returns {Promise<boolean>} True when the write succeeded and its result was applied.
  const saveGoals = useCallback(goals => {
    return runSave(() => savePlanGoals(app, { ...scopeOptions, goals }), "plan goals");
  }, [app, runSave, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist the projects a quarter's intents will be pursued through, including a rejection or a change to
  //   a project's preferred weekdays.
  // @param {Array<object>} prospects - Records shaped for savePlanProspects, each carrying its own capturedAt.
  // @returns {Promise<boolean>} True when the write succeeded and its result was applied.
  const saveProspects = useCallback(prospects => {
    return runSave(() => savePlanProspects(app, { ...scopeOptions, prospects }), "plan projects");
  }, [app, runSave, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist one quarter-wide answer: the quarter's name or the day's sufficiency bar.
  // @param {object} answer - { answerKey, capturedAt, text }.
  // @returns {Promise<boolean>} True when the write succeeded and its result was applied.
  const saveQuarterAnswer = useCallback(answer => {
    return runSave(() => savePlanQuarterAnswer(app, { ...scopeOptions, ...answer }), "quarter answer");
  }, [app, runSave, scopeKey]);

  useEffect(() => {
    let isActive = true;
    setPlanningContext(EMPTY_CONTEXT);
    setSaveError(null);
    (async () => {
      const context = await reload();
      if (!isActive || !context || hasCachedPossibilities(context)) return;
      await refreshPossibilities();
    })();
    return () => { isActive = false; };
  }, [scopeKey]);

  return { error, isLoading, isRefreshing, isSaving, planningContext, refreshPossibilities, reload, saveError,
    saveGoals, saveProspects, saveQuarterAnswer };
}

// ----------------------------------------------------------------------------------------------
// @desc Mint the identity a brand-new goal record carries, kept here so the step component does not import the
//   model layer only for a UUID.
// @returns {string} Record UUID.
export function newGoalUuid() {
  return planningRecordUuid();
}
