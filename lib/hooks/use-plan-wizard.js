// Adapt the plan-wizard service to the React embed: load cached goals and suggestions before any inference runs,
// keep in-flight responses from a superseded scope out of the rendered state, and never let a background refresh
// overwrite text the user is presently typing.

import { planningRecordUuid } from "plan-wizard/plan-models";
import { consolidatePlanActionProspects, readPlanGoals, refreshPlanActionProspects, refreshPlanIntentPossibilities,
  savePlanGoals, savePlanProspects, savePlanQuarterAnswer, savePlanThemeJudgement } from "plan-wizard/plan-wizard-service";
import { publishQuarterlyPlan } from "plan-wizard/quarterly-plan-publisher";
import { useCallback, useEffect, useRef, useState } from "react";
import { logIfEnabled } from "util/log";

const EMPTY_CONTEXT = { dailySufficiency: null, generatedAt: { personal: null, work: null }, goalRecords: [],
  goals: [], intentReading: { readItems: [], themeJudgements: {}, themes: [] }, noteUuid: null, possibilities: { personal: [], work: [] }, prospectRecords: [], prospects: [],
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
//   - {boolean} isConsolidating - True only while a consolidation pass is running.
//   - {boolean} isDiscovering - True only while project discovery is running, so the projects page can keep the
//     user's own rows editable while candidates are being proposed.
//   - {object} intentReading - What the reading page shows: { phase, readItems, themeJudgements, themes }. The
//     phase is reading until the notes have been collected, inferring while the provider runs, and ready once the
//     stored reading is current; readItems arrive at inferring, and themes arrive one at a time while inferring
//     when the provider streams its answer, otherwise all at once at ready.
//   - {boolean} isRefreshing - True only while inference is running, so the UI can keep fields editable.
//   - {boolean} isSaving - True while savePlanGoals is in flight.
//   - {object} planningContext - Current goals, goal records, suggestions, and resolved scope.
//   - {Error|null} saveError - Last save failure; the caller retains user input and offers retry.
//   - {string|null} discoveryFailureReason - Why the last discovery pass proposed nothing, when it proposed
//     nothing; null before any pass and after one that produced candidates.
//   - {Function} consolidateProspects - Combine the stored proposals that describe one undertaking.
//   - {Function} discoverProspects - Explicitly run project discovery for the current scope.
//   - {Function} refreshPossibilities - Explicitly rerun inference for the current scope.
//   - {Function} reload - Re-read stored state for the current scope without invoking inference.
//   - {Function} saveGoals - Persist goal records, returning true when the write succeeded.
//   - {Function} saveProspectDecision - Persist one card's priority without toggling page-wide saving state.
//   - {Function} saveProspects - Persist project records, returning true when the write succeeded.
//   - {Function} saveQuarterAnswer - Persist one quarter-wide answer, returning true when the write succeeded.
//   - {Function} saveThemeJudgement - Pin, dismiss, or clear one theme without entering the page-wide saving state.
//   - {Function} viewQuarterlyPlan - Publish the current plan and resolve the plan note's UUID for reading.
// Saving projects or a quarter-wide answer also republishes the quarter's plan note, so the note a user reads
// keeps pace with the wizard page they just submitted rather than waiting for the wizard to be finished.
export default function usePlanWizard({ app, domainName = null, domainUuid = null, quarter = null, year = null }) {
  const scopeOptions = { domainName, domainUuid, quarter, year };
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryFailureReason, setDiscoveryFailureReason] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [readingProgress, setReadingProgress] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [planningContext, setPlanningContext] = useState(EMPTY_CONTEXT);
  const [saveError, setSaveError] = useState(null);
  const requestTokenRef = useRef(null);
  const inFlightPassesRef = useRef(new Map());
  const scopeKey = planScopeKey(scopeOptions);
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

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
  // @desc Run a generating pass at most once at a time per scope, handing a caller that arrives while one is
  //   already running the in-flight promise rather than starting a second pass.
  // @param {string} operationName - Identifies the pass, so discovery and inference do not exclude each other.
  // @param {Function} operation - Starts the pass and resolves with its result.
  // @returns {Promise<*>} The result of whichever pass is in flight for this operation and scope.
  // The request token discards a superseded pass's result but cannot stop it: a generating pass persists what it
  //   produced before it returns, so a second click during an in-flight pass stored a second full set of proposals
  //   while the UI showed only one. Forty-eight unjudged near-duplicate projects reached one Vision Guide leaf that
  //   way, in eleven passes that all began within the same second. Sharing the promise is what makes the writes
  //   singular rather than only the rendered state.
  const runExclusivePass = useCallback((operationName, operation) => {
    const passKey = `${ operationName }::${ scopeKey }`;
    const running = inFlightPassesRef.current.get(passKey);
    if (running) return running;
    const pending = (async () => operation())().finally(() => {
      if (inFlightPassesRef.current.get(passKey) === pending) inFlightPassesRef.current.delete(passKey);
    });
    inFlightPassesRef.current.set(passKey, pending);
    return pending;
  }, [scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Load goals and suggestions, deleting retired schema 1 guides so the wizard can start fresh.
  // @returns {Promise<object|null>} The planning context that was applied, or null when superseded or failed.
  const reload = useCallback(async () => {
    const token = claimRequest();
    setIsLoading(true);
    try {
      const context = await readPlanGoals(app, { ...scopeOptions, deleteRetiredGuide: true });
      if (!isCurrentRequest(token)) return null;
      setError(null);
      setPlanningContext(context);
      return context;
    } catch (readError) {
      logIfEnabled(`[use-plan-wizard] could not load Vision Guide data for ${ scopeKey }`, readError?.message);
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
  const refreshPossibilities = useCallback(async () => runExclusivePass("intent-inference", async () => {
    const token = claimRequest();
    setIsRefreshing(true);
    setReadingProgress({ phase: "reading", readItems: [], themes: [] });
    // ----------------------------------------------------------------------------------------------
    // @desc Adopt the notes the service has finished reading, and each theme a streamed answer completes, so the
    //   reading page can list them while the provider is still working. A superseded pass's progress is ignored
    //   like its result.
    // @param {object} progress - { phase, readItems, themes } reported by refreshPlanIntentPossibilities.
    const handleProgress = ({ readItems, themes }) => {
      if (isCurrentRequest(token)) setReadingProgress({ phase: "inferring", readItems, themes });
    };
    try {
      const context = await refreshPlanIntentPossibilities(app, { ...scopeOptions, onProgress: handleProgress });
      if (!isCurrentRequest(token)) return null;
      setError(null);
      setPlanningContext(context);
      return context;
    } catch (refreshError) {
      logIfEnabled("[use-plan-wizard] intent refresh failed", refreshError?.message);
      if (isCurrentRequest(token)) setError(refreshError);
      return null;
    } finally {
      if (isCurrentRequest(token)) {
        setIsRefreshing(false);
        setReadingProgress(null);
      }
    }
  }), [app, claimRequest, isCurrentRequest, runExclusivePass, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Run project discovery for the current scope and adopt whatever candidates it proposed. A pass that
  //   proposes nothing is not an error: the reason is retained so the page can say why, and the previous context
  //   is left alone so the user's own projects stay as they were.
  // @returns {Promise<object|null>} The refreshed planning context, or null when superseded or failed.
  const discoverProspects = useCallback(async requestedTrigger =>
    runExclusivePass("project-discovery", async () => {
      // This is wired straight to a button's onClick, which calls it with the click event. Only a caller that
      // passes a name gets to name the trigger; anything else records the button press this handler serves.
      const triggerAction = typeof requestedTrigger === "string" && requestedTrigger.trim()
        ? requestedTrigger : "wizardProjectsRefreshClick";
      const token = claimRequest();
      setIsDiscovering(true);
      setDiscoveryFailureReason(null);
      try {
        const context = await refreshPlanActionProspects(app, { ...scopeOptions, triggerAction });
        if (!isCurrentRequest(token)) return null;
        setError(null);
        setDiscoveryFailureReason(context.failureReason ?? null);
        setPlanningContext(context);
        return context;
      } catch (discoveryError) {
        logIfEnabled("[use-plan-wizard] project discovery failed", discoveryError?.message);
        if (isCurrentRequest(token)) setDiscoveryFailureReason(discoveryError?.message ?? "Project discovery failed");
        return null;
      } finally {
        if (isCurrentRequest(token)) setIsDiscovering(false);
      }
    }), [app, claimRequest, isCurrentRequest, runExclusivePass, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Combine the stored proposals that describe one undertaking into the single project they were reaching
  //   for, and adopt the result.
  // @returns {Promise<object|null>} The refreshed planning context, or null when superseded or failed.
  // A pass that combines nothing is not an error: the reason is retained so the page can say why, and the
  //   projects the user is looking at are left exactly as they were.
  const consolidateProspects = useCallback(async () => runExclusivePass("project-consolidation", async () => {
    const token = claimRequest();
    setIsConsolidating(true);
    setDiscoveryFailureReason(null);
    try {
      const context = await consolidatePlanActionProspects(app, scopeOptions);
      if (!isCurrentRequest(token)) return null;
      setError(null);
      setDiscoveryFailureReason(context.failureReason ?? null);
      setPlanningContext(context);
      return context;
    } catch (consolidationError) {
      logIfEnabled("[use-plan-wizard] project consolidation failed", consolidationError?.message);
      if (isCurrentRequest(token)) setDiscoveryFailureReason(consolidationError?.message ?? "Combining projects failed");
      return null;
    } finally {
      if (isCurrentRequest(token)) setIsConsolidating(false);
    }
  }), [app, claimRequest, isCurrentRequest, runExclusivePass, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Carry the decisions just saved into the quarter's plan note. A failure here is logged rather than
  //   raised: the answer itself is already stored in the Vision Guide, and telling the user their answers were
  //   not saved would be untrue. The plan note catches up on the next successful publication.
  // @param {object} planningContext - Verified context returned by the write that preceded this.
  const publishPlanNote = useCallback(async planningContext => {
    try {
      await publishQuarterlyPlan(app, { ...scopeOptions, planningContext });
    } catch (publishError) {
      logIfEnabled("[use-plan-wizard] could not publish to the quarterly plan note", publishError?.message);
    }
  }, [app, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Bring the quarter's plan note up to date with everything stored for this scope and name the note, so a
  //   caller can show the user the plan their answers produced.
  // @returns {Promise<string|null>} The plan note's UUID, or null when no note could be resolved or created.
  // The stored state is re-read rather than taken from the rendered context, because a caller reaches this
  //   directly after the page's own save resolved and that save's context has not necessarily been applied to
  //   this hook's state yet. Reading first is what makes the published note include the answer just given.
  // Unlike publishPlanNote, a failure here reaches the caller: a user who asked to read the plan needs to be told
  //   when there is none to read, where a save's follow-on publication can quietly catch up later.
  const viewQuarterlyPlan = useCallback(async () => {
    const context = await readPlanGoals(app, scopeOptions);
    const publication = await publishQuarterlyPlan(app, { ...scopeOptions, planningContext: context });
    return publication.noteUuid;
  }, [app, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Run one write, adopting the verified context it returns and retaining its failure for retry. Every save
  //   the wizard performs shares this path so a superseded scope's write can never apply its result.
  // @param {Function} writeContext - Performs the write and resolves to the new planning context.
  // @param {string} label - Names the write in a diagnostic log line.
  // @param {Function|null} onSaved - Runs after the verified context is adopted, for follow-on work such as
  //   republishing the quarterly plan note; it is awaited inside the saving state, so the page stays busy until
  //   the note has caught up with the answer the user just gave.
  // @returns {Promise<boolean>} True when the write succeeded and its result was applied.
  // A failure keeps the previous context so the caller can retain the user's input and retry.
  const runSave = useCallback(async (writeContext, label, onSaved = null) => {
    const token = claimRequest();
    setIsSaving(true);
    setSaveError(null);
    try {
      const context = await writeContext();
      if (!isCurrentRequest(token)) return false;
      setPlanningContext(context);
      if (onSaved) await onSaved(context);
      return true;
    } catch (writeError) {
      logIfEnabled(`[use-plan-wizard] failed to save ${ label }`, writeError);
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
  // @desc Persist one or more card-local priority decisions without entering the page-wide isSaving state.
  // @param {Array<object>} prospects - Decision records shaped for savePlanProspects.
  // @returns {Promise<boolean>} True when the write succeeded in the scope that initiated it.
  // Independent cards may save concurrently; repository serialization preserves their write order.
  const saveProspectDecision = useCallback(async prospects => {
    const requestedScopeKey = scopeKey;
    setSaveError(null);
    try {
      const context = await savePlanProspects(app, { ...scopeOptions, prospects });
      if (scopeKeyRef.current !== requestedScopeKey) return false;
      setPlanningContext(context);
      return true;
    } catch (writeError) {
      logIfEnabled("[use-plan-wizard] failed to save project decision", writeError?.message);
      if (scopeKeyRef.current === requestedScopeKey) setSaveError(writeError);
      return false;
    }
  }, [app, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist the user's pin or dismissal of one theme from the reading page, or clear it, without entering the
  //   page-wide isSaving state: judging a theme is a small aside, and the intent page's fields stay editable.
  // @param {string} label - Theme being judged.
  // @param {string|null} judgement - pinned, dismissed, or null to clear an earlier judgement.
  // @returns {Promise<boolean>} True when the write succeeded in the scope that initiated it.
  const saveThemeJudgement = useCallback(async (label, judgement) => {
    const requestedScopeKey = scopeKey;
    setSaveError(null);
    try {
      const context = await savePlanThemeJudgement(app, { ...scopeOptions, judgement, label });
      if (scopeKeyRef.current !== requestedScopeKey) return false;
      setPlanningContext(previous => ({ ...previous, intentReading: { ...previous.intentReading,
        themeJudgements: context.intentReading.themeJudgements } }));
      return true;
    } catch (writeError) {
      logIfEnabled("[use-plan-wizard] failed to save theme judgement", writeError?.message);
      if (scopeKeyRef.current === requestedScopeKey) setSaveError(writeError);
      return false;
    }
  }, [app, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist the projects a quarter's intents will be pursued through, including a rejection or a change to
  //   a project's preferred weekdays.
  // @param {Array<object>} prospects - Records shaped for savePlanProspects, each carrying its own capturedAt.
  // @param {object} [saveOptions] - Passed through to savePlanProspects; updatePlacement: false skips bucket rewrites.
  // @returns {Promise<boolean>} True when the write succeeded and its result was applied.
  const saveProspects = useCallback((prospects, saveOptions = {}) => {
    return runSave(() => savePlanProspects(app, { ...saveOptions, ...scopeOptions, prospects }), "plan projects",
      publishPlanNote);
  }, [app, publishPlanNote, runSave, scopeKey]);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist one quarter-wide answer: the quarter's name or the day's sufficiency bar.
  // @param {object} answer - { answerKey, capturedAt, text }.
  // @returns {Promise<boolean>} True when the write succeeded and its result was applied.
  const saveQuarterAnswer = useCallback(answer => {
    return runSave(() => savePlanQuarterAnswer(app, { ...scopeOptions, ...answer }), "quarter answer",
      publishPlanNote);
  }, [app, publishPlanNote, runSave, scopeKey]);

  // The stored reading is the last completed pass; while a pass runs, its own progress replaces it so the page never
  // shows the previous pass's themes beside notes the current pass is reading.
  const intentReading = readingProgress
    ? { ...planningContext.intentReading, phase: readingProgress.phase, readItems: readingProgress.readItems,
      themes: readingProgress.themes }
    : { ...planningContext.intentReading, phase: "ready" };

  useEffect(() => {
    let isActive = true;
    setPlanningContext(EMPTY_CONTEXT);
    setReadingProgress(null);
    setSaveError(null);
    setDiscoveryFailureReason(null);
    (async () => {
      const context = await reload();
      if (!isActive || !context || hasCachedPossibilities(context)) return;
      await refreshPossibilities();
    })();
    return () => { isActive = false; };
  }, [scopeKey]);

  return { consolidateProspects, discoverProspects, discoveryFailureReason, error, intentReading, isConsolidating,
    isDiscovering, isLoading, isRefreshing, isSaving, planningContext, refreshPossibilities, reload, saveError, saveGoals,
    saveProspectDecision, saveProspects, saveQuarterAnswer, saveThemeJudgement, viewQuarterlyPlan };
}

// ----------------------------------------------------------------------------------------------
// @desc Mint the identity a brand-new goal record carries, kept here so the step component does not import the
//   model layer only for a UUID.
// @returns {string} Record UUID.
export function newGoalUuid() {
  return planningRecordUuid();
}
