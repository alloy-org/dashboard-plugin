/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Shared library for reading/writing goal and planning notes
 * Prompt summary: "shared functions for quarterly/monthly/weekly plan operations used by planning and dream-task widgets"
 */
import { IS_DEV_ENVIRONMENT } from "constants/settings";

// ────────────────────────────────────────────────────────────────
/**
 * Fetches the content of a section (month, week, or any heading) from a plan note.
 * Reuses the getMonthlyPlanContent action which matches any heading name.
 * @param {string} noteUUID - UUID of the plan note.
 * @param {string} sectionName - Heading text to look up (e.g. "March", "Week of March 16").
 * @returns {Promise<{ found: boolean, content: string|null }>}
 */
export async function fetchSectionContent(noteUUID, sectionName) {
  return await callPlugin('getMonthlyPlanContent', noteUUID, sectionName);
}

// ────────────────────────────────────────────────────────────────
/**
 * Creates or appends a monthly plan section in a quarterly note.
 * @param {Object} plan - Quarter plan object ({ label, year, quarter }).
 * @param {string} monthName - Full month name.
 * @returns {Promise<{ noteUUID: string, content: string, created: boolean }|null>}
 */
export async function createMonthlyPlan(plan, monthName) {
  return await callPlugin('createOrAppendMonthlyPlan', plan, monthName);
}

// ────────────────────────────────────────────────────────────────
/**
 * Creates or appends a weekly plan section in a quarterly note.
 * @param {Object} plan - Quarter plan object ({ label, year, quarter }).
 * @param {string} weekLabel - Week heading, e.g. "Week of March 16".
 * @returns {Promise<{ noteUUID: string }|null>}
 */
export async function createWeeklyPlan(plan, weekLabel) {
  return await callPlugin('createOrAppendWeeklyPlan', plan, weekLabel);
}

// ────────────────────────────────────────────────────────────────
/**
 * Opens an existing quarterly plan note or creates a new one from a template.
 * In dev mode, returns a devEdit signal instead of navigating.
 * @param {Object} plan - Quarter plan object ({ label, year, quarter }).
 * @returns {Promise<{ uuid: string, existed: boolean, devEdit?: boolean }|null>}
 */
export async function openOrCreateQuarterlyPlan(plan) {
  const result = await callPlugin('createQuarterlyPlan', plan);
  if (IS_DEV_ENVIRONMENT && result?.uuid) {
    return { ...result, devEdit: true, noteUUID: result.uuid };
  }
  return result;
}

// ────────────────────────────────────────────────────────────────
/**
 * Navigates to a note by UUID. In dev mode, returns a devEdit signal so the
 * calling widget can show an inline editor instead.
 * @param {string} noteUUID
 * @returns {Promise<{ devEdit: boolean, noteUUID: string }|*>}
 */
export async function navigateToNote(noteUUID) {
  if (IS_DEV_ENVIRONMENT) {
    return { devEdit: true, noteUUID };
  }
  return await callPlugin('navigateToNote', noteUUID);
}

// ────────────────────────────────────────────────────────────────
/**
 * Fetches the full markdown content of a note.
 * @param {string} noteUUID
 * @returns {Promise<string>}
 */
export async function fetchNoteContent(noteUUID) {
  return await callPlugin('getNoteContent', noteUUID);
}

// ────────────────────────────────────────────────────────────────
/**
 * Replaces all content below the frontmatter of a note.
 * @param {string} noteUUID
 * @param {string} content - New markdown content.
 * @returns {Promise<boolean>}
 */
export async function saveNoteContent(noteUUID, content) {
  return await callPlugin('replaceContent', noteUUID, content);
}
