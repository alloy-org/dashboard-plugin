// Reads and writes the active Task Domain's quarterly plan notes: which notes back the current and next quarter
// cards, a month's or week's section within one, and creating the note or section when it is missing.
// Runs on both sides of the bridge: findQuarterlyPlans is called plugin-side during the dashboard load, the
// create/read exports from the Planning widget, so they read settings through pluginSettings().
import { defaultMonthTemplate, defaultQuarterlyTemplate, defaultWeekTemplate, extractMonthSectionContent, getCurrentQuarter,
  getNextQuarter, quarterMonthNames } from "constants/quarters"
import { DASHBOARD_NOTE_TAG, DEFAULT_PLANNING_TAG, IS_DEV_ENVIRONMENT, SETTING_KEYS } from "constants/settings"
import { pluginSettings } from "plugin-data"
import { logIfEnabled } from "util/log"
import { snapDashboardAction } from "util/plausible";
import { quarterlyPlanNoteName, resolveQuarterlyPlanNote } from "util/quarterly-plan-notes"
import { activeTaskDomainInfo, migrationDomainNameFromDomains } from "util/task-domain-utility"

// A section just inserted is not always readable at once, so its read is retried this many times, this far apart.
const SECTION_READ_ATTEMPTS = 3;
const SECTION_READ_RETRY_DELAY_MS = 500;

// ----------------------------------------------------------------------------------------------
// @desc Append a month section to the quarter's plan note, creating the note from the quarterly template first when
//   the quarter has none. A month is appended even when its heading already exists; callers check first.
// @param {Object} app - Amplenote app interface
// @param {Object} quarterInfo - { domainName?, label, quarter, year }
// @param {string} monthName - Full month name, e.g. "March"
// @returns {Promise<{ content: string, created: boolean, noteUUID: string }>} The month section's content, and
//   whether the note itself was created
export async function createOrAppendMonthlyPlan(app, quarterInfo, monthName) {
  const planNoteTarget = await _planNoteTarget(app, quarterInfo);
  const noteUUID = planNoteTarget.existingNote?.uuid || await _createPlanNote(app, planNoteTarget, quarterInfo);
  if (planNoteTarget.existingNote) await app.insertNoteContent({ uuid: noteUUID }, defaultMonthTemplate(monthName), { atEnd: true });

  const content = await _readSectionContentWithRetry(app, noteUUID, monthName);
  return { content, created: !planNoteTarget.existingNote, noteUUID };
}

// ----------------------------------------------------------------------------------------------
// @desc Ensure the quarter's plan note has a section for the week, creating the note first when the quarter has none.
//   Unlike the month variant, an existing week heading is left as it is.
// @param {Object} app - Amplenote app interface
// @param {Object} quarterInfo - { domainName?, label, quarter, year }
// @param {string} weekLabel - Heading text, e.g. "Week of March 16"
// @returns {Promise<{ content: string, noteUUID: string }>}
export async function createOrAppendWeeklyPlan(app, quarterInfo, weekLabel) {
  const planNoteTarget = await _planNoteTarget(app, quarterInfo);
  const noteUUID = planNoteTarget.existingNote?.uuid || await _createPlanNote(app, planNoteTarget, quarterInfo);
  const weekContent = planNoteTarget.existingNote ? await getMonthlyPlanContent(app, noteUUID, weekLabel) : { found: false };
  if (!weekContent.found) await app.insertNoteContent({ uuid: noteUUID }, defaultWeekTemplate(weekLabel), { atEnd: true });

  const content = await _readSectionContentWithRetry(app, noteUUID, weekLabel);
  return { content, noteUUID };
}

// ----------------------------------------------------------------------------------------------
// @desc Open the quarter's plan note, creating it from the default quarterly template when the quarter has none.
//   A legacy "${label} Plan" note is adopted when the active domain is the one legacy plans migrate to.
// @param {Object} app - Amplenote app interface
// @param {Object} quarterInfo - { domainName?, label, quarter, year }, e.g. { label: "Q1 2026", quarter: 1, year: 2026 }
// @returns {Promise<Object>} { existed, uuid }; in the dev environment a created note returns { devEdit, existed,
//   noteUUID } so the dev app can open its editor
export async function createQuarterlyPlan(app, quarterInfo) {
  const planNoteTarget = await _planNoteTarget(app, quarterInfo);
  if (planNoteTarget.existingNote) {
    await app.navigate(`https://www.amplenote.com/notes/${ planNoteTarget.existingNote.uuid }`);
    return { existed: true, uuid: planNoteTarget.existingNote.uuid };
  }

  const uuid = await _createPlanNote(app, planNoteTarget, quarterInfo);
  await app.navigate(`https://www.amplenote.com/notes/${ uuid }`);
  if (IS_DEV_ENVIRONMENT && uuid) return { devEdit: true, existed: false, noteUUID: uuid };
  return { existed: false, uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc A quarterly-plans stub in the shape PlanningWidget expects, for when plan note lookup fails, so the dashboard
//   still loads and the widget offers to create a plan.
// @param {Object} domainInfo - Resolved domain payload carrying domains[] and selectedDomainUuid
// @returns {{ current: Object, next: Object }} Empty plan entries for the current and next quarter
export function emptyQuarterlyPlans(domainInfo) {
  const domainName = _selectedDomainName(domainInfo);
  return { current: { ...getCurrentQuarter(), domainName, hasAllMonthlyDetails: false, noteUUID: null },
    next: { ...getNextQuarter(), domainName, hasAllMonthlyDetails: false, noteUUID: null } };
}

// ----------------------------------------------------------------------------------------------
// @desc Find the selected domain's plan notes for the current and next quarter, and whether each has a section for
//   all three of its months (the Planning widget's completeness hint). Adopts a legacy "${label} Plan" note once
//   when the domain is the one legacy plans migrate to.
// @param {Object} app - Amplenote app interface
// @param {Object} domainInfo - Resolved domain payload carrying domains[] and selectedDomainUuid
// @returns {Promise<{ current: Object, next: Object }>} Each quarter plus domainName, hasAllMonthlyDetails, noteUUID
export async function findQuarterlyPlans(app, domainInfo) {
  const startedAt = Date.now();
  const domains = Array.isArray(domainInfo?.domains) ? domainInfo.domains : [];
  const domainName = _selectedDomainName(domainInfo);
  const migrationDomainName = migrationDomainNameFromDomains(domains);
  const allowLegacyMigration = !!domainName && domainName === migrationDomainName;
  const quarters = [getCurrentQuarter(), getNextQuarter()];
  logIfEnabled(`[findQuarterlyPlans] querying: ${ quarters.map(quarter => `"${ quarterlyPlanNoteName(domainName, quarter.label) }"`).join(", ") } (legacyMigration=${ allowLegacyMigration })`);

  const [current, next] = await Promise.all(quarters.map(async quarter => {
    const planNote = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, quarter.label);
    const noteUUID = planNote?.uuid || null;
    const hasAllMonthlyDetails = noteUUID ? await _hasAllMonthSections(app, quarterMonthNames(quarter.quarter), noteUUID) : false;
    return { ...quarter, domainName, hasAllMonthlyDetails, noteUUID };
  }));
  logIfEnabled(`[findQuarterlyPlans] current: ${ current.noteUUID } (all months ${ current.hasAllMonthlyDetails }), next: ${ next.noteUUID } (all months ${ next.hasAllMonthlyDetails }) in ${ Date.now() - startedAt }ms`);
  return { current, next };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a section of a quarterly plan note by its heading, matched case-insensitively. Serves month headings
//   ("March") and week headings ("Week of March 16") alike.
// @param {Object} app - Amplenote app interface
// @param {string|null} noteUUID - The plan note; a missing note reads as not found
// @param {string} monthName - The section heading to find
// @returns {Promise<{ content: string|null, found: boolean }>}
export async function getMonthlyPlanContent(app, noteUUID, monthName) {
  if (!noteUUID) return { content: null, found: false };

  const sections = await app.getNoteSections({ uuid: noteUUID });
  logIfEnabled(`[getMonthlyPlanContent] noteUUID=${ noteUUID } monthName="${ monthName }" sections:`, sections?.map(section => section.heading?.text));
  if (!_hasSectionHeading(monthName, sections)) return { content: null, found: false };

  const fullContent = await app.getNoteContent({ uuid: noteUUID });
  const content = extractMonthSectionContent(fullContent, monthName);
  logIfEnabled(`[getMonthlyPlanContent] extracted content length: ${ content?.length ?? 0 }`);
  return { content: content || '', found: true };
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Create the quarter's plan note from the default quarterly template, tagged for the dashboard and planning.
// @param {Object} planNoteTarget - From _planNoteTarget
// @param {Object} quarterInfo - { label, quarter }
// @returns {Promise<string>} The new note's UUID
async function _createPlanNote(app, planNoteTarget, quarterInfo) {
  snapDashboardAction("createQuarterlyPlan");
  const noteUUID = await app.createNote(planNoteTarget.noteName, planNoteTarget.tags);
  await app.insertNoteContent({ uuid: noteUUID }, defaultQuarterlyTemplate(quarterInfo.label, quarterInfo.quarter));
  return noteUUID;
}

// ----------------------------------------------------------------------------------------------
// @desc True when every month name has a heading section in the note. A failed read counts as incomplete, since the
//   answer only chooses the card's hint.
// @returns {Promise<boolean>}
async function _hasAllMonthSections(app, monthNames, noteUUID) {
  try {
    const sections = await app.getNoteSections({ uuid: noteUUID });
    return monthNames.every(monthName => _hasSectionHeading(monthName, sections));
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
function _hasSectionHeading(headingText, sections) {
  return (sections || []).some(section => section.heading?.text?.trim().toLowerCase() === headingText.toLowerCase());
}

// ----------------------------------------------------------------------------------------------
// @desc Where a quarter's plan note lives for the active domain: its name, its tags, and the note already there if
//   any (a legacy note counts when the domain is the one legacy plans migrate to).
// @param {Object} quarterInfo - { domainName?, label }; domainName defaults to the active Task Domain's
// @returns {Promise<{ existingNote: Object|null, noteName: string, tags: Array<string> }>}
async function _planNoteTarget(app, quarterInfo) {
  const domainInfo = await activeTaskDomainInfo(app);
  const domainName = quarterInfo.domainName || domainInfo.domainName;
  const allowLegacyMigration = !!domainName && domainName === domainInfo.migrationDomainName;
  const existingNote = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, quarterInfo.label);
  const planningTag = pluginSettings()[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  return { existingNote: existingNote || null, noteName: quarterlyPlanNoteName(domainName, quarterInfo.label),
    tags: [DASHBOARD_NOTE_TAG, planningTag] };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a section just inserted, retrying because the note's content does not always show a fresh insert on
//   the first read. Falls back to the month template's body so the widget has something to show.
// @param {string} sectionHeading - The month or week heading inserted
// @returns {Promise<string>}
async function _readSectionContentWithRetry(app, noteUUID, sectionHeading) {
  for (let attempt = 0; attempt < SECTION_READ_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, SECTION_READ_RETRY_DELAY_MS));
    const fullContent = await app.getNoteContent({ uuid: noteUUID });
    const content = extractMonthSectionContent(fullContent, sectionHeading);
    if (content) return content;
  }
  const templateLines = defaultMonthTemplate(sectionHeading).split('\n');
  const templateBodyLines = templateLines.filter(line => line && !line.startsWith('#'));
  return templateBodyLines.join('\n');
}

// ----------------------------------------------------------------------------------------------
function _selectedDomainName(domainInfo) {
  const domains = Array.isArray(domainInfo?.domains) ? domainInfo.domains : [];
  const selectedDomainUuid = domainInfo?.selectedDomainUuid || null;
  return domains.find(domain => domain.uuid === selectedDomainUuid)?.name || null;
}
