// The wizard page that names the quarter and sketches when each active project should concentrate. Three name
// ideas are drafted from Focus projects (then other live work, then static fallbacks); the user picks one or
// writes their own. A timeline under that question lets them drag a window per project, stored as focusMonths.

import ProjectFocusWindow from "dashboard/plan-wizard/project-focus-window";
import { answerTextFromRecord, hasUnsavedAnswer, quarterAnswerFromDraft } from "dashboard/plan-wizard/quarter-answer-fields";
import { CUSTOM_QUARTER_NAME, TIMELINE_HEADING, TIMELINE_SUMMARY,
  draftWindowsFromProspects, monthNameFromMonthKey, nameIdeasFromProspects, prospectRecordsFromWindowDrafts,
  quarterBoundsFromScope, selectedNameFromRecord, windowDraftsNeedSave } from "dashboard/plan-wizard/quarter-name-step-fields";
import { useRegisteredNavigate } from "dashboard/plan-wizard/step-navigation";
import { wizardStepFromKey } from "dashboard/plan-wizard/wizard-steps";
import { useCallback, useEffect, useRef, useState } from "react";

const QUARTER_NAME_STEP_COPY = wizardStepFromKey("quarter-name");

// ----------------------------------------------------------------------------------------------
// @desc Render the Name the quarter page and persist the chosen name plus any changed focus windows before Back
//   or Next changes the page.
// @param {object} params - An object with the following properties:
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onNavigate - Changes wizard page after pending edits save successfully.
//   - {Function} onRegisterNavigate - Publishes this page's Back/Next handler to the wizard's shared navigation.
//   - {Function} onSaveName - Receives a quarterName answer and resolves true when the write succeeded.
//   - {Function} onSaveProspects - Receives prospect records and resolves true when the write succeeded.
//   - {object} planningContext - Stored prospects, quarter name, and scope.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The Name the quarter page.
export default function QuarterNameStep({ isSaving, onNavigate, onRegisterNavigate, onSaveName, onSaveProspects,
    planningContext, scopeKey }) {
  const scope = planningContext.scope;
  const ideas = nameIdeasFromProspects(planningContext.prospects, scope);
  const storedName = answerTextFromRecord(planningContext.quarterName);
  const [selectedName, setSelectedName] = useState(() => selectedNameFromRecord(storedName, ideas));
  const [customText, setCustomText] = useState(() => selectedNameFromRecord(storedName, ideas) === CUSTOM_QUARTER_NAME
    ? storedName : "");
  const [windowDrafts, setWindowDrafts] = useState(() => draftWindowsFromProspects(planningContext.prospects, scope));
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);
  const bounds = quarterBoundsFromScope(scope);
  const draftName = selectedName === CUSTOM_QUARTER_NAME ? customText : selectedName;

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && !capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    const nextIdeas = nameIdeasFromProspects(planningContext.prospects, planningContext.scope);
    const nextStored = answerTextFromRecord(planningContext.quarterName);
    setSelectedName(selectedNameFromRecord(nextStored, nextIdeas));
    setCustomText(selectedNameFromRecord(nextStored, nextIdeas) === CUSTOM_QUARTER_NAME ? nextStored : "");
    setWindowDrafts(draftWindowsFromProspects(planningContext.prospects, planningContext.scope));
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setWindowDrafts(draftWindowsFromProspects(planningContext.prospects, planningContext.scope));
  }, [planningContext.prospects, planningContext.scope]);

  // ----------------------------------------------------------------------------------------------
  // @desc Record a timeline edit and stamp the capture time this edit will be saved under.
  // @param {object} nextDraft - Updated window for one project.
  const handleChangeWindow = useCallback(nextDraft => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setWindowDrafts(previous => previous.map(draft => (draft.uuid === nextDraft.uuid ? nextDraft : draft)));
  }, []);

  // ----------------------------------------------------------------------------------------------
  // @desc Choose a drafted name chip, leaving custom text intact in case the user returns to Write my own.
  // @param {string} idea - Chip text.
  const handleSelectIdea = idea => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setSelectedName(idea);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Switch to the custom field and keep whatever the user has already typed there.
  const handleSelectCustom = () => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setSelectedName(CUSTOM_QUARTER_NAME);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Record typed custom name text.
  // @param {string} text - New custom name.
  const handleChangeCustom = text => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setSelectedName(CUSTOM_QUARTER_NAME);
    setCustomText(text);
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Persist the chosen name and any focus windows that differ from storage, keeping drafts on failure.
  // @returns {Promise<boolean>} Whether navigation may proceed.
  const handleSave = async () => {
    const capturedAt = capturedAtRef.current ?? new Date().toISOString();
    capturedAtRef.current = capturedAt;
    if (hasUnsavedAnswer(planningContext.quarterName, draftName)) {
      const didSaveName = await onSaveName(quarterAnswerFromDraft("quarterName", capturedAt, draftName));
      if (!didSaveName) return false;
    }
    if (windowDraftsNeedSave(windowDrafts, planningContext.prospects)) {
      const didSaveWindows = await onSaveProspects(prospectRecordsFromWindowDrafts(windowDrafts, capturedAt));
      if (!didSaveWindows) return false;
    }
    capturedAtRef.current = null;
    return true;
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save pending name and window edits before honoring the Back or Next button.
  // @returns {Promise<void>} Resolves once a successful save has let navigation run.
  const handleNavigate = async () => {
    const didSave = await handleSave();
    if (!didSave) return;
    onNavigate();
  };

  useRegisteredNavigate(onRegisterNavigate, handleNavigate);

  return (
    <div className="plan-step-container quarter-name-container">
      <h2 className="plan-heading">{ QUARTER_NAME_STEP_COPY.title }</h2>
      <p className="plan-summary">{ QUARTER_NAME_STEP_COPY.summary }</p>
      <div className="quarter-name-ideas">
        { ideas.map(idea => (
          <button aria-pressed={ selectedName === idea }
            className={ `quarter-name-idea${ selectedName === idea ? " quarter-name-idea--selected" : "" }` }
            disabled={ isSaving } key={ idea } onClick={ () => handleSelectIdea(idea) } type="button">
            { idea }
          </button>
        )) }
        <label className={ `quarter-name-custom${ selectedName === CUSTOM_QUARTER_NAME ? " quarter-name-custom--selected" : "" }` }>
          <span aria-hidden="true" className="quarter-name-custom-mark">✎</span>
          <input className="quarter-name-custom-input" disabled={ isSaving }
            onChange={ event => handleChangeCustom(event.target.value) } onFocus={ handleSelectCustom }
            placeholder="Write my own" type="text" value={ customText } />
        </label>
      </div>
      <h3 className="plan-heading quarter-name-timeline-heading">{ TIMELINE_HEADING }</h3>
      <p className="plan-summary">{ TIMELINE_SUMMARY }</p>
      { windowDrafts.length ? (
        <div className="quarter-name-timeline">
          <div aria-hidden="true" className="quarter-name-months">
            { bounds.quarterMonths.map(monthKey => (
              <span className="quarter-name-month" key={ monthKey }>{ monthNameFromMonthKey(monthKey) }</span>
            )) }
          </div>
          { windowDrafts.map(draft => (
            <ProjectFocusWindow { ...{ draft } } isDisabled={ isSaving } key={ draft.uuid }
              onChangeWindow={ handleChangeWindow } quarterEndOn={ bounds.quarterEndOn }
              quarterMonths={ bounds.quarterMonths } quarterStartOn={ bounds.quarterStartOn } />
          )) }
        </div>
      ) : (
        <p className="plan-empty" role="note">
          Name a project on the previous steps first — a timeline is a spread of particular work, so there is
          nothing to place yet.
        </p>
      ) }
    </div>
  );
}
