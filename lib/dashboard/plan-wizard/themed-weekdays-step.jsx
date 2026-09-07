// The wizard's fourth page: give each weekday an emphasis by choosing which projects suit it. The answer is
// stored on the projects themselves, in each prospect's preferredWeekdays, rather than as a separate weekday
// table — the agenda needs to know which work suits today, and that question is answered per project.
//
// The page is therefore only meaningful once projects exist, and says so when none have been saved instead of
// showing a grid with nothing to put in it.

import { WEEKDAYS } from "plan-wizard/plan-models";
import { useEffect, useRef, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Format a stored weekday enum value for display, keeping the datastore's lowercase values out of the UI.
// @param {string} weekday - Stored weekday value.
// @returns {string} Capitalized label.
export function weekdayLabel(weekday) {
  return `${ weekday.charAt(0).toUpperCase() }${ weekday.slice(1) }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Seed editable weekday selections from stored prospects, keyed by project identity.
// @param {Array<object>} prospects - Live ActionProspect records for the quarter.
// @returns {object} Map of prospect UUID to its selected weekday values.
export function weekdaysByProspectFromRecords(prospects = []) {
  const weekdaysByProspect = {};
  for (const prospect of prospects) weekdaysByProspect[prospect.uuid] = prospect.preferredWeekdays ?? [];
  return weekdaysByProspect;
}

// ----------------------------------------------------------------------------------------------
// @desc Render and save weekday emphases. Selections are local state seeded from stored projects and reseeded only
//   when the plan scope changes or a save succeeds, so an in-progress edit survives a background refresh.
// @param {object} params - An object with the following properties:
//   - {boolean} isSaving - True while a save is in flight.
//   - {Function} onSave - Receives prospect records and resolves true when the write succeeded.
//   - {object} planningContext - Stored prospects for the scope.
//   - {Error|null} saveError - Last save failure; its presence turns the action into a retry.
//   - {string} scopeKey - Identifies the domain and quarter; a change reseeds the draft.
// @returns {JSX.Element} The themed weekdays page.
export default function ThemedWeekdaysStep({ isSaving, onSave, planningContext, saveError, scopeKey }) {
  const [weekdaysByProspect, setWeekdaysByProspect] = useState(() => weekdaysByProspectFromRecords(planningContext.prospects));
  const [hasSaved, setHasSaved] = useState(false);
  const capturedAtRef = useRef(null);
  const seededScopeRef = useRef(scopeKey);

  useEffect(() => {
    if (seededScopeRef.current === scopeKey && !capturedAtRef.current) return;
    seededScopeRef.current = scopeKey;
    capturedAtRef.current = null;
    setWeekdaysByProspect(weekdaysByProspectFromRecords(planningContext.prospects));
    setHasSaved(false);
  }, [scopeKey]);

  useEffect(() => {
    if (capturedAtRef.current) return;
    setWeekdaysByProspect(weekdaysByProspectFromRecords(planningContext.prospects));
  }, [planningContext.prospects]);

  // ----------------------------------------------------------------------------------------------
  // @desc Add or remove one weekday from a project's emphasis.
  // @param {string} prospectUuid - Project being edited.
  // @param {string} weekday - Weekday being toggled.
  const handleToggleWeekday = (prospectUuid, weekday) => {
    capturedAtRef.current = capturedAtRef.current ?? new Date().toISOString();
    setHasSaved(false);
    setWeekdaysByProspect(previous => {
      const selected = previous[prospectUuid] ?? [];
      const remainingWeekdays = selected.filter(candidate => candidate !== weekday);
      const isSelected = selected.includes(weekday);
      const orderedWeekdays = WEEKDAYS.filter(candidate => selected.includes(candidate) || candidate === weekday);
      return { ...previous, [prospectUuid]: isSelected ? remainingWeekdays : orderedWeekdays };
    });
  };

  // ----------------------------------------------------------------------------------------------
  // @desc Save each project's weekday emphasis, keeping selections intact on failure so a retry reuses its stamp.
  // Every project is written, since clearing a project's weekdays is as meaningful as setting them.
  const handleSave = async () => {
    const capturedAt = capturedAtRef.current ?? new Date().toISOString();
    capturedAtRef.current = capturedAt;
    const prospectRecords = planningContext.prospects.map(prospect => ({ approvalStatusEm: prospect.approvalStatusEm, capturedAt,
      linkedGoalUuids: prospect.linkedGoalUuids, preferredWeekdays: weekdaysByProspect[prospect.uuid] ?? [],
      substantiation: prospect.substantiation, summary: prospect.summary, userCategoryEm: prospect.userCategoryEm,
      uuid: prospect.uuid }));
    if (!prospectRecords.length) return;
    const didSave = await onSave(prospectRecords);
    if (!didSave) return;
    capturedAtRef.current = null;
    setHasSaved(true);
  };

  const saveLabel = saveError ? "Retry saving" : "Save weekday themes";

  if (!planningContext.prospects.length) {
    return (
      <div className="themed-weekdays-page">
        <h2 className="themed-weekdays-heading">Would themed weekdays make choosing tasks easier?</h2>
        <p className="themed-weekdays-empty" role="note">
          Name a project on the previous step first — a weekday theme is an emphasis on particular work, so there is
          nothing to assign yet.
        </p>
      </div>
    );
  }

  return (
    <div className="themed-weekdays-page">
      <h2 className="themed-weekdays-heading">Would themed weekdays make choosing tasks easier?</h2>
      <p className="themed-weekdays-summary">
        Give a weekday an emphasis by picking the projects that suit it. Leave a project unassigned and it stays
        available every day.
      </p>
      <div className="themed-weekdays-grid">
        { planningContext.prospects.map(prospect => (
          <div className="themed-weekdays-row" key={ prospect.uuid }>
            <span className="themed-weekdays-row-label">{ prospect.summary }</span>
            <div className="themed-weekdays-row-options">
              { WEEKDAYS.map(weekday => {
                const isSelected = (weekdaysByProspect[prospect.uuid] ?? []).includes(weekday);
                const buttonClass = `themed-weekdays-option ${ isSelected ? "themed-weekdays-option--selected" : "" }`.trim();
                return (
                  <button aria-pressed={ isSelected } className={ buttonClass } disabled={ isSaving } key={ weekday }
                    onClick={ () => handleToggleWeekday(prospect.uuid, weekday) } type="button">
                    { weekdayLabel(weekday).slice(0, 3) }
                  </button>
                );
              }) }
            </div>
          </div>
        )) }
      </div>
      { saveError ? (
        <p className="themed-weekdays-error" role="alert">Your weekday themes were not saved. { saveError.message }</p>
      ) : null }
      { hasSaved ? <p className="themed-weekdays-saved">Saved.</p> : null }
      <div className="themed-weekdays-actions">
        <button className="themed-weekdays-save" disabled={ isSaving } onClick={ handleSave } type="button">
          { isSaving ? "Saving…" : saveLabel }
        </button>
        <p className="themed-weekdays-optional">This one is optional — you can move on without assigning any.</p>
      </div>
    </div>
  );
}
