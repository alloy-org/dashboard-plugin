/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Shared library for reading/writing goal and planning notes
 * Prompt summary: "shared functions for quarterly/monthly/weekly plan operations used by planning and dream-task widgets"
 */
import { IS_DEV_ENVIRONMENT } from "constants/settings";
import {
  getMonthlyPlanContent,
  createOrAppendMonthlyPlan,
  createOrAppendWeeklyPlan,
  createQuarterlyPlan,
} from "data-service";

// ────────────────────────────────────────────────────────────────
// [Claude] Task: use standalone data-service functions + real Amplenote API calls
// Prompt: "non-API methods on app should be standalone functions using only real API methods"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking

export async function fetchSectionContent(app, noteUUID, sectionName) {
  return await getMonthlyPlanContent(app, noteUUID, sectionName);
}

export async function createMonthlyPlan(app, plan, monthName) {
  return await createOrAppendMonthlyPlan(app, plan, monthName);
}

export async function createWeeklyPlan(app, plan, weekLabel) {
  return await createOrAppendWeeklyPlan(app, plan, weekLabel);
}

export async function openOrCreateQuarterlyPlan(app, plan) {
  const result = await createQuarterlyPlan(app, plan);
  if (IS_DEV_ENVIRONMENT && result?.uuid) {
    return { ...result, devEdit: true, noteUUID: result.uuid };
  }
  return result;
}

// [Claude] Task: navigate via app.navigate (real API) instead of non-API app.navigateToNote
// Prompt: "non-API methods on app should be standalone functions"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
export async function navigateToNote(app, noteUUID) {
  if (IS_DEV_ENVIRONMENT) {
    return { devEdit: true, noteUUID };
  }
  return await app.navigate(`https://www.amplenote.com/notes/${noteUUID}`);
}

export async function fetchNoteContent(app, noteUUID) {
  return await app.getNoteContent(noteUUID);
}

export async function saveNoteContent(app, noteUUID, content, options) {
  return await app.replaceNoteContent(noteUUID, content, options);
}
