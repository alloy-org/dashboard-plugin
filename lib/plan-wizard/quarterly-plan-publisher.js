// Carry the decisions the wizard stored in its Vision Guide into the quarterly plan note the user actually
// reads, creating that note from the standard template when the quarter has none yet.
//
// The write replaces the whole note rather than each section in turn. The merged content is built by splicing
// the note that was just read, so every byte outside the handful of owned sections is copied forward unchanged,
// and one write keeps the note internally consistent instead of leaving it half-published when a later section
// write fails. Because a whole-note write is unforgiving, it is bracketed by two checks: nothing may be written
// that drops a heading the user wrote, and the saved note is read back and confirmed to carry what was
// published before the call reports success.

import { DASHBOARD_NOTE_TAG, DEFAULT_PLANNING_TAG, SETTING_KEYS } from "constants/settings";
import { defaultQuarterlyTemplate, quarterLabel } from "constants/quarters";
import { resolvePlanScope } from "plan-wizard/plan-models";
import { mergedQuarterlyPlanContent } from "plan-wizard/quarterly-plan-merge";
import { isBuilderMarkedText, isPlaceholderHeadingText, planHeadingRanges, textWithoutBuilderMarker } from "plan-wizard/quarterly-plan-markdown";
import { quarterlyPlanPublication } from "plan-wizard/quarterly-plan-publication";
import { pluginSettings } from "plugin-data";
import { logIfEnabled } from "util/log";
import { arrayFromFilterNotesResult } from "util/note-handles";
import { quarterlyPlanNoteName, resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";

// ----------------------------------------------------------------------------------------------
// @desc List the headings a merge must not remove: everything the user wrote, excluding the builder's own
//   output and the template's bracketed fill-in-the-blank names, which real projects legitimately replace.
// @param {string} content - Note markdown.
// @returns {Array<string>} Heading texts.
function protectedHeadingTexts(content) {
  const headings = planHeadingRanges(content);
  const userHeadings = headings.filter(heading => !isBuilderMarkedText(heading.text));
  const namedHeadings = userHeadings.filter(heading => !isPlaceholderHeadingText(heading.text));
  return namedHeadings.map(heading => heading.text);
}

// ----------------------------------------------------------------------------------------------
// @desc Name the domain the way the rest of the dashboard names it when resolving a plan note, since a plan
//   scoped to every note uses the undomained title rather than one reading "All Notes".
// @param {object} scope - Resolved planning scope.
// @returns {string|null} Domain display name, or null for All Notes.
function planNoteDomainName(scope) {
  return scope.domainUuid ? scope.domainName : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Find the quarter's plan note, creating it from the standard template when none exists, and return a
//   handle the caller owns rather than one the bridge handed back.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} scope - Resolved planning scope.
// @param {string|null} migrationDomainName - Domain permitted to adopt a legacy undomained plan note.
// @returns {Promise<object|null>} { created, noteHandle } or null when the note could not be resolved.
async function resolvedPlanNote(app, scope, migrationDomainName) {
  const domainName = planNoteDomainName(scope);
  const label = quarterLabel(scope.year, scope.quarter);
  const allowLegacyMigration = Boolean(domainName && migrationDomainName && domainName === migrationDomainName);
  const existing = await resolveQuarterlyPlanNote(app, allowLegacyMigration, domainName, label);
  if (existing?.uuid) return { created: false, noteHandle: { uuid: existing.uuid } };

  const noteName = quarterlyPlanNoteName(domainName, label);
  const planningTag = pluginSettings()[SETTING_KEYS.PLANNING_NOTE_TAG] || DEFAULT_PLANNING_TAG;
  const createdUuid = await app.createNote(noteName, [DASHBOARD_NOTE_TAG, planningTag]);
  if (!createdUuid) return null;
  await app.insertNoteContent({ uuid: createdUuid }, defaultQuarterlyTemplate(label, scope.quarter));
  const createdNotes = await arrayFromFilterNotesResult(app.filterNotes({ query: noteName }));
  const createdMatch = createdNotes.find(note => note.name === noteName);
  return { created: true, noteHandle: { uuid: createdMatch?.uuid ?? createdUuid } };
}

// ----------------------------------------------------------------------------------------------
// @desc Name the projects a publication expected to place in the note but that the saved content does not
//   carry, so a write the host reported as successful but dropped is caught rather than trusted.
// @param {string} savedContent - Note markdown read back after the write.
// @param {object} publication - Publication that was merged.
// @returns {Array<string>} Summaries of projects missing from the saved note.
function unpublishedProjectSummaries(savedContent, publication) {
  const headingTexts = planHeadingRanges(savedContent).map(heading => heading.text);
  const builderHeadings = headingTexts.filter(isBuilderMarkedText);
  const publishedSummaries = new Set(builderHeadings.map(textWithoutBuilderMarker));
  return publication.projects.map(project => project.summary).filter(summary => !publishedSummaries.has(summary));
}

// ----------------------------------------------------------------------------------------------
// @desc Write a quarter's wizard decisions into its plan note, merging them with whatever the user has already
//   written there. Publishing is idempotent: an unchanged plan produces identical markdown and no write.
// @param {object} app - Amplenote host app or embed proxy.
// @param {object} options - An object with the following properties:
//   - {string|null} domainName - Task Domain being planned; with domainUuid it resolves the scope.
//   - {string|null} domainUuid - Task Domain UUID, or null for All Notes.
//   - {string|null} migrationDomainName - Domain allowed to adopt a legacy undomained plan note; optional.
//   - {object} planningContext - Context from readPlanGoals or any wizard save.
//   - {number} quarter - Quarter being planned.
//   - {number} year - Planning year.
// @returns {Promise<object>} An object with the following properties:
//   - {boolean} created - True when the plan note did not exist and was created from the template.
//   - {string|null} noteUuid - The plan note written to, or null when none could be resolved.
//   - {boolean} updated - True when the note's markdown changed.
// A caller treats a thrown error as a failed publication; the Vision Guide remains the record of truth either way.
export async function publishQuarterlyPlan(app, options = {}) {
  const scope = resolvePlanScope(options);
  const publication = quarterlyPlanPublication(options.planningContext ?? {}, scope);
  const resolved = await resolvedPlanNote(app, scope, options.migrationDomainName ?? null);
  if (!resolved) {
    logIfEnabled("[quarterly-plan-publisher] no plan note could be resolved or created; nothing published");
    return { created: false, noteUuid: null, updated: false };
  }

  const content = await app.getNoteContent(resolved.noteHandle);
  if (typeof content !== "string") throw new Error("Quarterly plan note could not be read");
  const merged = mergedQuarterlyPlanContent(content, publication);
  if (merged === content) return { created: resolved.created, noteUuid: resolved.noteHandle.uuid, updated: false };

  const lostHeadings = protectedHeadingTexts(content).filter(text => !protectedHeadingTexts(merged).includes(text));
  if (lostHeadings.length) throw new Error(`Publishing would remove plan note headings: ${ lostHeadings.join(", ") }`);
  await app.replaceNoteContent(resolved.noteHandle, merged);

  const savedContent = await app.getNoteContent(resolved.noteHandle);
  const missingSummaries = unpublishedProjectSummaries(savedContent ?? "", publication);
  if (missingSummaries.length) {
    throw new Error(`Quarterly plan save verification failed for: ${ missingSummaries.join(", ") }`);
  }
  return { created: resolved.created, noteUuid: resolved.noteHandle.uuid, updated: true };
}
