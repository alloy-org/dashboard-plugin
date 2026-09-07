// The wizard's first page: capture what would make the coming quarter a success, professionally and, optionally,
// personally. Suggestions are offered as starting points that fill the focused field; nothing becomes a chosen
// intent until the user saves. A background inference response replaces the offered suggestions but never the
// text a user has begun typing.

import { CATEGORY_LABELS, PRIMARY_GOAL_RANK, draftFieldsFromGoals, goalRecordsFromDraftFields,
  nextSecondaryRank } from "dashboard/plan-wizard/intent-step-fields";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc One editable goal line. A goal is a single sentence, so this is a one-line text input rather than a
//   textarea: the box should not invite a paragraph, and Enter should not insert a newline into a goal.
// @param {object} params - An object with the following properties:
//   - {object} field - Draft field: { goalRank, goalText, shouldAutoFocus, userCategoryEm, uuid }.
//   - {boolean} isDisabled - True while a save is in flight.
//   - {Function} onChangeText - Receives the field's new text.
//   - {Function} onFocus - Marks this field as the suggestion target.
//   - {string} placeholder - Prompt shown in the empty input.
// @returns {JSX.Element} A labeled field row.
// A newly added secondary field carries shouldAutoFocus so the cursor is in it as soon as it appears; without
// that, the add button keeps focus and the user has to click the empty line before they can type.
function IntentStepField({ field, isDisabled, onChangeText, onFocus, placeholder }) {
  const inputRef = useRef(null);
  const isPrimary = field.goalRank === PRIMARY_GOAL_RANK;
  const fieldClass = `intent-step-field ${ isPrimary ? "intent-step-field--primary" : "intent-step-field--secondary" }`;

  useLayoutEffect(() => {
    if (!field.shouldAutoFocus) return;
    inputRef.current?.focus();
  }, [field.shouldAutoFocus]);

  return (
    <div className={ fieldClass }>
      <input className="intent-step-input" disabled={ isDisabled } onChange={ event => onChangeText(event.target.value) }
        onFocus={ onFocus } placeholder={ placeholder } ref={ inputRef } type="text" value={ field.goalText } />
    </div>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc One category's block: heading, its fields, its suggestions, and the control that adds a secondary goal.
// @param {object} params - An object with the following properties:
//   - {Array<object>} fields - Draft fields for this category, primary first.
//   - {boolean} isDisabled - True while a save is in flight.
//   - {Function} onAddSecondary - Appends another field in this category.
//   - {Function} onApplySuggestion - Receives a possibility to place in the focused field.
//   - {Function} onChangeText - Receives (fieldUuid, text).
//   - {Function} onFocusField - Receives the newly focused field's uuid.
//   - {Array<object>} possibilities - Stored IntentPossibility records for this category.
//   - {string} userCategoryEm - work or personal.
// @returns {JSX.Element} The category block.
// Defaults are labeled as starting points so a generic suggestion never reads as an inferred conclusion.
function IntentStepCategory({ fields, isDisabled, onAddSecondary, onApplySuggestion, onChangeText, onFocusField,
    possibilities, userCategoryEm }) {
  const { heading, placeholder } = CATEGORY_LABELS[userCategoryEm];
  const hasDefaultSuggestions = possibilities.some(possibility => possibility.sourceKind === "default");
  return (
    <section className={ `intent-step-category intent-step-category--${ userCategoryEm }` }>
      <h3 className="intent-step-category-heading">{ heading }</h3>
      { fields.map(field => (
        <IntentStepField field={ field } isDisabled={ isDisabled } key={ field.uuid }
          onChangeText={ text => onChangeText(field.uuid, text) } onFocus={ () => onFocusField(field.uuid) }
          placeholder={ placeholder } />
      )) }
      { possibilities.length ? (
        <div className="intent-step-suggestion-list">
          { possibilities.map(possibility => (
            <button className={ `intent-step-suggestion intent-step-suggestion--${ possibility.sourceKind }` }
              disabled={ isDisabled } key={ possibility.uuid } onClick={ () => onApplySuggestion(possibility) }
              title={ possibility.substantiation } type="button">
              { possibility.intent }
            </button>
          )) }
        </div>
      ) : null }
      { hasDefaultSuggestions ? (
        <p className="intent-step-suggestion-note">Starting points, not conclusions drawn from your notes.</p>
      ) : null }
      <button className="intent-step-add-secondary" disabled={ isDisabled } onClick={ onAddSecondary } type="button">
        Add a secondary or more granular goal
      </button>
    </section>
  );
}

// ----------------------------------------------------------------------------------------------
// @desc Render and save the first wizard page. Draft text is local state seeded from stored goals; it is
//   reseeded only when the plan scope changes or a save succeeds, so suggestions arriving from a background
//   refresh cannot discard what the user is in the middle of writing.
// @param {object} params - An object with the following properties:
//   - {boolean} isDiscovering - True while project discovery runs, so "Find my projects" cannot be double-run.
//   - {boolean} isRefreshing - True while inference runs; fields stay editable throughout.
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onFindProjects - Moves to the projects page and runs discovery there.
//   - {object} planningContext - Stored goals, goalRecords, and possibilities for the scope.
//   - {Function} onSave - Receives goal records and resolves true when the write succeeded.
//   - {Error|null} saveError - Last save failure; its presence turns the action into a retry.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The intent page.
// "Find my projects" saves first: discovery reads the stored intents, so an unsaved answer would be invisible
// to it and the user would be shown projects chosen for the intents they had before this edit.
export default function IntentStep({ isDiscovering = false, isRefreshing, onFindProjects, onSave, planningContext,
    isSaving, saveError, scopeKey }) {
  const [draftFields, setDraftFields] = useState(() => draftFieldsFromGoals(planningContext.goals));
  const [focusedFieldUuid, setFocusedFieldUuid] = useState(null);
  const [hasSaved, setHasSaved] = useState(false);
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && hasSaved === false && capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    setDraftFields(draftFieldsFromGoals(planningContext.goals));
    setFocusedFieldUuid(null);
    setHasSaved(false);
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setDraftFields(draftFieldsFromGoals(planningContext.goals));
  }, [planningContext.goals]);

  // ----------------------------------------------------------------------------------------------
  // @desc Append an empty field in a category, taking the next rank after that category's existing fields.
  // @param {string} userCategoryEm - work or personal.
  const handleAddSecondary = userCategoryEm => {
    setDraftFields(previous => previous.concat(nextSecondaryRank(previous, userCategoryEm)));
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Place a suggestion's text in the focused field of its category, or that category's primary field
  //   when nothing is focused. The suggestion is only a starting point until the user saves.
  // @param {object} possibility - Stored IntentPossibility.
  const handleApplySuggestion = possibility => {
    setDraftFields(previous => {
      const categoryFields = previous.filter(field => field.userCategoryEm === possibility.userCategoryEm);
      const focusedField = categoryFields.find(field => field.uuid === focusedFieldUuid);
      const targetField = focusedField ?? categoryFields[0];
      if (!targetField) return previous;
      return previous.map(field => (field.uuid === targetField.uuid
        ? { ...field, goalText: possibility.intent, possibilityUuid: possibility.uuid } : field));
    });
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Record an edit and stamp the capture time this edit will be saved under.
  // @param {string} fieldUuid - Field being edited.
  // @param {string} goalText - New text.
  // A retry reuses the stamp, since the merge treats an older or tied timestamp as a no-op.
  const handleChangeText = (fieldUuid, goalText) => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setHasSaved(false);
    setDraftFields(previous => previous.map(field => (field.uuid === fieldUuid ? { ...field, goalText } : field)));
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save every field that carries text, plus tombstones for goals the user emptied.
  // On failure the draft is left untouched so the user's input survives and the retry can reuse its timestamp.
  // @returns {Promise<boolean>} True when a write happened and succeeded.
  const handleSave = async () => {
    const capturedAt = capturedAtRef.current ?? new Date().toISOString();
    capturedAtRef.current = capturedAt;
    const goalRecords = goalRecordsFromDraftFields(draftFields, planningContext, capturedAt);
    if (!goalRecords.length) return false;
    const didSave = await onSave(goalRecords);
    if (!didSave) return false;
    capturedAtRef.current = null;
    setHasSaved(true);
    return true;
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save the answers, then hand off to project discovery. A failed save stops the handoff unless intents
  //   were already stored, since discovery reasoning over a stale intent would propose projects for a goal the
  //   user has just changed.
  const handleFindProjects = async () => {
    const hadStoredIntent = planningContext.goals.length > 0;
    const didSave = await handleSave();
    if (!didSave && !hadStoredIntent) return;
    await onFindProjects();
  };

  const workFields = draftFields.filter(field => field.userCategoryEm === "work");
  const personalFields = draftFields.filter(field => field.userCategoryEm === "personal");
  const hasAnswer = draftFields.some(field => field.goalText.trim());
  const saveLabel = saveError ? "Retry saving" : "Save answers";
  const categoryProps = { isDisabled: isSaving, onApplySuggestion: handleApplySuggestion, onChangeText: handleChangeText,
    onFocusField: setFocusedFieldUuid };

  return (
    <div className="intent-step-page">
      <h2 className="intent-step-heading">This quarter will be a success if…</h2>
      { isRefreshing ? <p className="intent-step-status">Looking through your recent work for suggestions…</p> : null }
      <IntentStepCategory { ...categoryProps } fields={ workFields } onAddSecondary={ () => handleAddSecondary("work") }
        possibilities={ planningContext.possibilities.work } userCategoryEm="work" />
      <IntentStepCategory { ...categoryProps } fields={ personalFields }
        onAddSecondary={ () => handleAddSecondary("personal") } possibilities={ planningContext.possibilities.personal }
        userCategoryEm="personal" />
      { saveError ? (
        <p className="intent-step-error" role="alert">Your answers were not saved. { saveError.message }</p>
      ) : null }
      { hasSaved ? <p className="intent-step-saved">Saved.</p> : null }
      <div className="intent-step-actions">
        <button className="intent-step-save" disabled={ isSaving || !hasAnswer } onClick={ handleSave } type="button">
          { isSaving ? "Saving…" : saveLabel }
        </button>
        <button className="intent-step-continue" disabled={ isSaving || isDiscovering || !hasAnswer }
          onClick={ handleFindProjects }
          title="Save these intents and read your recent tasks for the projects that would carry them"
          type="button">
          { isDiscovering ? "Finding projects…" : "Find my projects" }
        </button>
      </div>
    </div>
  );
}
