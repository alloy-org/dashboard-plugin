// The wizard page that names the quarter and sketches when each active project should concentrate. Three name
// ideas are drafted from Focus projects (then other live work, then static fallbacks); the user picks one or
// writes their own. A timeline under that question lets them drag a window per project, stored as focusMonths.

import ProjectFocusWindow from "dashboard/plan-wizard/project-focus-window";
import { answerTextFromRecord, hasUnsavedAnswer, quarterAnswerFromDraft } from "dashboard/plan-wizard/quarter-answer-fields";
import { CUSTOM_QUARTER_NAME, QUARTER_NAME_STEP_FORM_ID, TIMELINE_HEADING, TIMELINE_SUMMARY,
  draftWindowsFromProspects, monthNameFromMonthKey, nameIdeasFromProspects, prospectRecordsFromWindowDrafts,
  quarterBoundsFromScope, selectedNameFromRecord, windowDraftsNeedSave } from "dashboard/plan-wizard/quarter-name-step-fields";
import { wizardStepFromKey } from "dashboard/plan-wizard/wizard-steps";
import { useCallback, useEffect, useRef, useState } from "react";

export { QUARTER_NAME_STEP_FORM_ID };
const QUARTER_NAME_STEP_COPY = wizardStepFromKey("quarter-name");

// ----------------------------------------------------------------------------------------------
// @desc Render the Name the quarter page and persist the chosen name plus any changed focus windows before Back
//   or Next changes the page.
// @param {object} params - An object with the following properties:
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onNavigate - Changes wizard page after pending edits save successfully.
//   - {Function} onSaveName - Receives a quarterName answer and resolves true when the write succeeded.
//   - {Function} onSaveProspects - Receives prospect records and resolves true when the write succeeded.
//   - {object} planningContext - Stored prospects, quarter name, and scope.
//   - {Error|null} saveError - Last save failure; its presence turns the action into a retry.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The Name the quarter page.
export default function QuarterNameStep({ isSaving, onNavigate, onSaveName, onSaveProspects, planningContext,
    saveError, scopeKey }) {
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
  // @desc Save pending name and window edits before honoring the Back or Next submit button.
  // @param {object} event - Form submission event from the wizard navigation.
  const handleNavigate = async event => {
    event.preventDefault();
    const didSave = await handleSave();
    if (!didSave) return;
    onNavigate();
  };

  return (
    <form className="plan-step-container quarter-name-container" id={ QUARTER_NAME_STEP_FORM_ID } onSubmit={ handleNavigate }>
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
      <h3 className="plan-heading">{ TIMELINE_HEADING }</h3>
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
      { saveError ? (
        <p className="plan-error" role="alert">Your quarter name was not saved. { saveError.message }</p>
      ) : null }
    </form>
  );
}
