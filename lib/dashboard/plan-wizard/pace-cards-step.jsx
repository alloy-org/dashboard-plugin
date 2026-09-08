// The wizard page after projects: choose a realistic pace for each named project. The chosen rhythm is stored as
// paceEm, the days it occupies as preferredWeekdays (preferredDows), and a sprint's landing date as deadlineOn.

import { PACE_CARDS_STEP_FORM_ID, draftFromPaceSelection, draftPacesFromProspects, paceRecordsFromDrafts,
  toggledWeekdaysFromSelection } from "dashboard/plan-wizard/pace-cards-step-fields";
import ProjectPace from "dashboard/plan-wizard/project-pace";
import { wizardStepFromKey } from "dashboard/plan-wizard/wizard-steps";
import { useCallback, useEffect, useRef, useState } from "react";

export { PACE_CARDS_STEP_FORM_ID };
const PACE_CARDS_STEP_COPY = wizardStepFromKey("pace-cards");

// ----------------------------------------------------------------------------------------------
// @desc Render the pace page and save changed rhythms before Back or Next changes the page.
// @param {object} params - An object with the following properties:
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onNavigate - Changes wizard page after pending pace edits save successfully.
//   - {Function} onSave - Receives prospect records and resolves true when the write succeeded.
//   - {object} planningContext - Stored prospects for the scope.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The pace cards page.
export default function PaceCardsStep({ isSaving, onNavigate, onSave, planningContext, scopeKey }) {
  const [drafts, setDrafts] = useState(() => draftPacesFromProspects(planningContext.prospects));
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && !capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    setDrafts(draftPacesFromProspects(planningContext.prospects));
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setDrafts(draftPacesFromProspects(planningContext.prospects));
  }, [planningContext.prospects]);

  // ----------------------------------------------------------------------------------------------
  // @desc Record a draft change and stamp the capture time this edit will be saved under.
  // @param {string} prospectUuid - Project being edited.
  // @param {Function} updateDraft - Receives the current draft and returns the next one.
  const changeDraft = useCallback((prospectUuid, updateDraft) => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setDrafts(previous => previous.map(draft => (draft.uuid === prospectUuid ? updateDraft(draft) : draft)));
  }, []);

  // ----------------------------------------------------------------------------------------------
  // @desc Persist the project's landing date when the chosen rhythm is a deadline sprint.
  // @param {string} prospectUuid - Project being edited.
  // @param {string|null} deadlineOn - YYYY-MM-DD date, or null when the field is cleared.
  const handleChangeDeadline = useCallback((prospectUuid, deadlineOn) => {
    changeDraft(prospectUuid, draft => ({ ...draft, deadlineOn }));
  }, [changeDraft]);

  // ----------------------------------------------------------------------------------------------
  // @desc Apply a pace and the days that rhythm starts highlighted, leaving a re-click of the same pace unchanged.
  // @param {string} prospectUuid - Project being edited.
  // @param {string} paceEm - Selected ActionProspect pace enum.
  const handleSelectPace = useCallback((prospectUuid, paceEm) => {
    changeDraft(prospectUuid, draft => draftFromPaceSelection(draft, paceEm));
  }, [changeDraft]);

  // ----------------------------------------------------------------------------------------------
  // @desc Add or remove one weekday from the project's preferred days.
  // @param {string} prospectUuid - Project being edited.
  // @param {string} weekday - Weekday being toggled.
  const handleToggleWeekday = useCallback((prospectUuid, weekday) => {
    changeDraft(prospectUuid, draft => ({ ...draft,
      preferredWeekdays: toggledWeekdaysFromSelection(draft.paceEm, draft.preferredWeekdays, weekday) }));
  }, [changeDraft]);

  // ----------------------------------------------------------------------------------------------
  // @desc Save current pace drafts, keeping them intact on failure so navigation can retry.
  // @returns {Promise<boolean>} Whether navigation may proceed.
  const handleSave = async () => {
    if (!capturedAtRef.current) return true;
    const capturedAt = capturedAtRef.current;
    const prospectRecords = paceRecordsFromDrafts(drafts, capturedAt);
    if (!prospectRecords.length) {
      capturedAtRef.current = null;
      return true;
    }
    const didSave = await onSave(prospectRecords);
    if (!didSave) return false;
    capturedAtRef.current = null;
    return true;
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save pending pace edits before honoring the Back or Next submit button.
  // @param {object} event - Form submission event from the wizard navigation.
  const handleNavigate = async event => {
    event.preventDefault();
    const didSave = await handleSave();
    if (!didSave) return;
    onNavigate();
  };

  return (
    <form className="plan-step-container pace-cards-container" id={ PACE_CARDS_STEP_FORM_ID } onSubmit={ handleNavigate }>
      <h2 className="plan-heading">{ PACE_CARDS_STEP_COPY.title }</h2>
      <p className="plan-summary">{ PACE_CARDS_STEP_COPY.summary }</p>
      { drafts.length ? (
        <div className="pace-cards-list">
          { drafts.map(draft => (
            <ProjectPace { ...{ draft } } isDisabled={ isSaving } key={ draft.uuid }
              onChangeDeadline={ handleChangeDeadline } onSelectPace={ handleSelectPace }
              onToggleWeekday={ handleToggleWeekday } />
          )) }
        </div>
      ) : (
        <p className="plan-empty" role="note">
          Name a project on the previous step first — a pace is a rhythm for particular work, so there is nothing
          to protect yet.
        </p>
      ) }
    </form>
  );
}
