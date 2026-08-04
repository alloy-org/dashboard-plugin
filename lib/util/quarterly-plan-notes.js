// [Cursor Grok 4.5-authored file]
// Created: 2026-08-04 | Model: Cursor Grok 4.5
// Task: Task Domain-specific quarterly plan note naming with legacy rename support
// Prompt summary: "Quarterly Goals module name must include the Task Domain; migrate legacy plans"

import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";

// ----------------------------------------------------------------------------------------------
// @desc Legacy plan note title used before Task Domains were part of the name (e.g. "Q3 2026 Plan").
// @param {string} quarterLabel - Quarter label such as "Q3 2026".
// @returns {string}
export function legacyQuarterlyPlanNoteName(quarterLabel) {
  return `${ quarterLabel } Plan`;
}

// ----------------------------------------------------------------------------------------------
// @desc Domain-scoped quarterly plan note title (e.g. "Q3 2026 Work Plan"), or the legacy title when
//   no domain name is available.
// @param {string|null|undefined} domainName - Active Task Domain display name.
// @param {string} quarterLabel - Quarter label such as "Q3 2026".
// @returns {string}
export function quarterlyPlanNoteName(domainName, quarterLabel) {
  const trimmedDomainName = typeof domainName === "string" ? domainName.trim() : "";
  if (!trimmedDomainName) return legacyQuarterlyPlanNoteName(quarterLabel);
  return `${ quarterLabel } ${ trimmedDomainName } Plan`;
}

// ----------------------------------------------------------------------------------------------
// @desc Find the quarterly plan note for a domain, optionally renaming a legacy untitled-domain plan
//   when this domain is the migration target (first/default domain encountered on Dashboard load).
// @param {object} app - Amplenote app bridge.
// @param {boolean} allowLegacyMigration - When true, a note named "${label} Plan" is renamed to include
//   `domainName` and returned.
// @param {string|null} domainName - Task Domain name to include in the note title.
// @param {string} quarterLabel - Quarter label such as "Q3 2026".
// @returns {Promise<{ name: string, uuid: string }|null>}
export async function resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, quarterLabel) {
  const domainPlanName = quarterlyPlanNoteName(domainName, quarterLabel);
  const domainNotes = await arrayFromFilterNotesResult(app.filterNotes({ query: domainPlanName }));
  const domainMatch = domainNotes.find(note => note.name === domainPlanName);
  if (domainMatch) return domainMatch;

  const legacyName = legacyQuarterlyPlanNoteName(quarterLabel);
  if (domainPlanName === legacyName) {
    const legacyNotes = await arrayFromFilterNotesResult(app.filterNotes({ query: legacyName }));
    return legacyNotes.find(note => note.name === legacyName) || null;
  }

  if (!allowLegacyMigration || !domainName) return null;

  const legacyNotes = await arrayFromFilterNotesResult(app.filterNotes({ query: legacyName }));
  const legacyMatch = legacyNotes.find(note => note.name === legacyName);
  if (!legacyMatch?.uuid) return null;

  try {
    const renamed = await app.setNoteName(legacyMatch, domainPlanName);
    if (renamed === false) {
      logIfEnabled(`[quarterly-plan-notes] setNoteName refused rename of "${ legacyName }" → "${ domainPlanName }"`);
      return legacyMatch;
    }
    logIfEnabled(`[quarterly-plan-notes] Migrated legacy plan "${ legacyName }" → "${ domainPlanName }"`);
    return { ...legacyMatch, name: domainPlanName };
  } catch (error) {
    logIfEnabled(`[quarterly-plan-notes] Failed to rename legacy plan "${ legacyName }"`, error?.message || error);
    return legacyMatch;
  }
}
