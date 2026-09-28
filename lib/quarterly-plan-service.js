// Reads and writes the active Task Domain's quarterly plan notes: which notes back the current and next quarter
// cards, a month's or week's section within one, and creating the note or section when it is missing.
// resolveQuarterlyPlanEntry decides which splash the Planning widget shows before a plan note exists.
// Runs on both sides of the bridge: findQuarterlyPlans is called plugin-side during the dashboard load, the
// create/read exports from the Planning widget, so they read settings through pluginSettings().
import { FAST_TIER_REASONING_EFFORT, PROVIDER_DEFAULT_MODEL } from "constants/llm-providers"
import { defaultMonthTemplate, defaultQuarterlyTemplate, defaultWeekTemplate, extractMonthSectionContent, getCurrentQuarter,
  getNextQuarter, quarterMonthNames } from "constants/quarters"
import { DASHBOARD_NOTE_TAG, DEFAULT_PLANNING_TAG, devLlmOverride, IS_DEV_ENVIRONMENT, SETTING_KEYS } from "constants/settings"
import { pluginSettings } from "plugin-data"
import { AMPLE_AGENT_PRO_URL, fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings"
import { llmPrompt } from "providers/fetch-ai-provider"
import { fetchDomainOrAllNotesTasks } from "util/all-notes-tasks"
import { logIfEnabled } from "util/log"
import { snapDashboardAction } from "util/plausible";
import { quarterlyPlanNoteName, resolveQuarterlyPlanNote } from "util/quarterly-plan-notes"
import { activeTaskDomainInfo, migrationDomainNameFromDomains } from "util/task-domain-utility"

// The account page where Evernote, Obsidian, Todoist, Notion, and Markdown imports are started.
const ACCOUNT_IMPORT_URL = "https://www.amplenote.com/help/import_notes_and_tasks_overview";
// Early-adopter price already shown by the Agent Pro upsell elsewhere on the dashboard.
const AGENT_PRO_MONTHLY_PRICE = "$8";
// A key check only needs proof the provider answered. Ten seconds is enough for a one-word reply.
const LLM_KEY_STATUS_TIMEOUT_SECONDS = 10;
const LLM_KEY_STATUS_PROMPT = "Reply with ok.";

// Twenty-five tasks is the point at which Plan Builder has enough of the user's own work to group.
export const QUARTERLY_PLAN_TASK_THRESHOLD = 25;
export const QUARTERLY_PLAN_IMPORT_SOURCES = [
  { id: "evernote", label: "Evernote", url: `${ ACCOUNT_IMPORT_URL }#___import_from_evernote` },
  { id: "obsidian", label: "Obsidian", url: `${ ACCOUNT_IMPORT_URL }#___import_from_obsidian` },
  { id: "todoist", label: "Todoist", url: `${ ACCOUNT_IMPORT_URL }#___import_from_todoist` },
  { id: "notion", label: "Notion", url: `${ ACCOUNT_IMPORT_URL }#___import_from_notion` },
  { id: "markdown", label: "Markdown", url: `${ ACCOUNT_IMPORT_URL }#___import_from_markdown` },
];
export const QUARTERLY_PLAN_VIDEO_EMBED_URL = "https://www.youtube.com/embed/zyLI9KCziNU?start=5";
export const QUARTERLY_PLAN_VIDEO_URL = "https://www.youtube.com/watch?v=zyLI9KCziNU&t=5s";

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
// @desc Choose the Planning widget's splash before the target quarter has a plan note. Fewer than 25 tasks
//   asks the user to import. At 25 or more, a missing Agent Pro note and a missing or non-answering LLM key
//   asks them to connect AI. Either source, with enough tasks, invites them to build the plan. A lookup
//   failure falls back to the import splash so planning stays reachable. When the count comes from every
//   note rather than a Task Domain, notes tagged starter-notes are already left out of that scan.
// @param {Object} app - Amplenote app interface
// @param {Object} [params] - An object with the following properties:
//   - {string|null} [domainUuid] - Task Domain whose tasks are counted, or null for every note
// @returns {Promise<Object>} An object with the following properties:
//   - {string} agentProPriceLabel - Monthly price shown on the Agent Pro card, e.g. "$8"
//   - {string} agentProUrl - Plugin listing the Agent Pro button opens
//   - {number} applicableTaskCount - Tasks counted. The All Notes scan skips notes tagged starter-notes
//   - {Array<{id: string, label: string, url: string}>} importSources - Import buttons and their navigate targets
//   - {string} kind - "import", "needs-ai", or "ready"
//   - {number} taskThreshold - Task count at which the import splash gives way to the AI splash
//   - {string} videoEmbedUrl - YouTube embed for the ready splash, started five seconds in
//   - {string} videoUrl - Watch URL the embed comes from
export async function resolveQuarterlyPlanEntry(app, { domainUuid = null } = {}) {
  try {
    const applicableTaskCount = await _applicableTaskCount(app, domainUuid);
    logIfEnabled(`[quarterly-plan] ${ applicableTaskCount } tasks counted`);
    if (applicableTaskCount < QUARTERLY_PLAN_TASK_THRESHOLD) return _entryState("import", applicableTaskCount);

    const modelOptions = _specifiedModelOptions();
    const [agentProNote, keyWorks] = await Promise.all([
      findAmpleAgentProNote(app),
      modelOptions ? _llmKeyReturnsResult(app, modelOptions) : Promise.resolve(false),
    ]);
    const agentProInstalled = !!agentProNote;
    const kind = agentProInstalled || keyWorks ? "ready" : "needs-ai";
    logIfEnabled("[quarterly-plan] entry state", { agentProInstalled, keyChecked: !!modelOptions, keyWorks, kind });
    return _entryState(kind, applicableTaskCount);
  } catch (error) {
    logIfEnabled("[quarterly-plan] entry state failed", error?.message || error);
    return _entryState("import", 0);
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc How many tasks the splash should count. A Task Domain uses getTaskDomainTasks. With no domain, the
//   All Notes scan skips notes tagged starter-notes while it walks the note handles it already loaded.
// @param {string|null} domainUuid - Task Domain, or null to scan task-list notes
// @returns {Promise<number>}
async function _applicableTaskCount(app, domainUuid) {
  const tasks = await fetchDomainOrAllNotesTasks(app, domainUuid, { includeDone: false });
  return Array.isArray(tasks) ? tasks.length : 0;
}

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
// @desc The splash payload, with the navigate targets and video attached so the widget does not hard-code them.
// @param {string} kind - "import", "needs-ai", or "ready"
// @param {number} applicableTaskCount - Tasks counted for the splash
// @returns {Object} The entry state resolveQuarterlyPlanEntry resolves to
function _entryState(kind, applicableTaskCount) {
  return { agentProPriceLabel: AGENT_PRO_MONTHLY_PRICE, agentProUrl: AMPLE_AGENT_PRO_URL, applicableTaskCount,
    importSources: QUARTERLY_PLAN_IMPORT_SOURCES, kind, taskThreshold: QUARTERLY_PLAN_TASK_THRESHOLD,
    videoEmbedUrl: QUARTERLY_PLAN_VIDEO_EMBED_URL, videoUrl: QUARTERLY_PLAN_VIDEO_URL };
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
// @desc Ask the configured provider for a one-word reply. Any non-empty answer means the key works; a throw,
//   an empty body, or a timeout means it does not. Agent Pro is checked separately, so this reports only
//   whether the saved key itself answered.
// @param {Object} modelOptions - aiModel, apiKey, providerEm, and reasoningEffort from _specifiedModelOptions
// @returns {Promise<boolean>}
async function _llmKeyReturnsResult(app, modelOptions) {
  try {
    const result = await llmPrompt(app, null, LLM_KEY_STATUS_PROMPT, modelOptions.aiModel, modelOptions.apiKey, false,
      LLM_KEY_STATUS_TIMEOUT_SECONDS, modelOptions.reasoningEffort);
    const usable = typeof result === "string" ? result.trim().length > 0 : result !== null && typeof result !== "undefined";
    logIfEnabled("[quarterly-plan] LLM key status check", { providerEm: modelOptions.providerEm, usable });
    return usable;
  } catch (error) {
    logIfEnabled("[quarterly-plan] LLM key status check failed", error?.message || error);
    return false;
  }
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

// ----------------------------------------------------------------------------------------------
// @desc The model and key a status check should call, from a saved provider key or a development token.
//   Null when the user has not specified either, which skips the check.
// @returns {Object|null} aiModel, apiKey, providerEm, and reasoningEffort
function _specifiedModelOptions() {
  const fromSettings = fastModelOptions(pluginSettings());
  if (fromSettings) return fromSettings;
  const override = devLlmOverride(PROVIDER_DEFAULT_MODEL);
  if (!override?.apiKey || !override?.model) return null;
  const reasoningEffort = override.provider === "openai" ? FAST_TIER_REASONING_EFFORT : null;
  return { aiModel: override.model, apiKey: override.apiKey, providerEm: override.provider, reasoningEffort };
}
