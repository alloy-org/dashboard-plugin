/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Shared library for reading/writing goal and planning notes
 * Prompt summary: "shared functions for quarterly/monthly/weekly plan operations used by planning and dream-task widgets"
 */
import { IS_DEV_ENVIRONMENT } from "constants/settings";

// ────────────────────────────────────────────────────────────────
// [Claude] Task: refactored to accept app parameter instead of global callPlugin
// Prompt: "each widget receives the app object; reduce or eliminate callPlugin"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking

/**
 * Fetches the content of a section (month, week, or any heading) from a plan note.
 * @param {Object} app - App interface (production or dev).
 * @param {string} noteUUID - UUID of the plan note.
 * @param {string} sectionName - Heading text to look up.
 * @returns {Promise<{ found: boolean, content: string|null }>}
 */
export async function fetchSectionContent(app, noteUUID, sectionName) {
  return await app.getMonthlyPlanContent(noteUUID, sectionName);
}

/**
 * Creates or appends a monthly plan section in a quarterly note.
 * @param {Object} app - App interface.
 * @param {Object} plan - Quarter plan object ({ label, year, quarter }).
 * @param {string} monthName - Full month name.
 * @returns {Promise<{ noteUUID: string, content: string, created: boolean }|null>}
 */
export async function createMonthlyPlan(app, plan, monthName) {
  return await app.createOrAppendMonthlyPlan(plan, monthName);
}

/**
 * Creates or appends a weekly plan section in a quarterly note.
 * @param {Object} app - App interface.
 * @param {Object} plan - Quarter plan object ({ label, year, quarter }).
 * @param {string} weekLabel - Week heading, e.g. "Week of March 16".
 * @returns {Promise<{ noteUUID: string }|null>}
 */
export async function createWeeklyPlan(app, plan, weekLabel) {
  return await app.createOrAppendWeeklyPlan(plan, weekLabel);
}

/**
 * Opens an existing quarterly plan note or creates a new one from a template.
 * In dev mode, returns a devEdit signal instead of navigating.
 * @param {Object} app - App interface.
 * @param {Object} plan - Quarter plan object ({ label, year, quarter }).
 * @returns {Promise<{ uuid: string, existed: boolean, devEdit?: boolean }|null>}
 */
export async function openOrCreateQuarterlyPlan(app, plan) {
  const result = await app.createQuarterlyPlan(plan);
  if (IS_DEV_ENVIRONMENT && result?.uuid) {
    return { ...result, devEdit: true, noteUUID: result.uuid };
  }
  return result;
}

/**
 * Navigates to a note by UUID. In dev mode, returns a devEdit signal.
 * @param {Object} app - App interface.
 * @param {string} noteUUID
 * @returns {Promise<{ devEdit: boolean, noteUUID: string }|*>}
 */
export async function navigateToNote(app, noteUUID) {
  if (IS_DEV_ENVIRONMENT) {
    return { devEdit: true, noteUUID };
  }
  return await app.navigateToNote(noteUUID);
}

/**
 * Fetches the full markdown content of a note.
 * @param {Object} app - App interface.
 * @param {string} noteUUID
 * @returns {Promise<string>}
 */
export async function fetchNoteContent(app, noteUUID) {
  return await app.getNoteContent(noteUUID);
}

/**
 * Replaces all content below the frontmatter of a note.
 * @param {Object} app - App interface.
 * @param {string} noteUUID
 * @param {string} content - New markdown content.
 * @param {Object} [options]
 * @returns {Promise<boolean>}
 */
export async function saveNoteContent(app, noteUUID, content, options) {
  return await app.replaceNoteContent(noteUUID, content, options);
}
