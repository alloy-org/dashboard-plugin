// Discover archived annual guides by stored domain identity.

import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { GUIDE_SCHEMA_VERSION, requireRecord } from "plan-wizard/plan-models";
import { GUIDE_METADATA_HEADING, guideSectionRange, initialVisionGuideMarkdown, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { arrayFromFilterNotesResult } from "util/note-handles";

export const MAXIMUM_GUIDE_SECTION_CHARACTERS = 200000;
export const VISION_GUIDE_TAG = `${ DASHBOARD_NOTE_TAG }/plan-wizard`;

// ----------------------------------------------------------------------------------------------
// @desc Reject bridge errors instead of interpreting them as empty data or successful writes.
// @param {*} result - API result.
// @returns {*} Unwrapped result.
// Mobile bridge calls may resolve an error envelope rather than reject.
export function checkedAppResult(result) {
  if (result?.embedCallFailed) throw new Error(result.error || "Plan wizard app call failed");
  return result;
}

// ----------------------------------------------------------------------------------------------
// @desc Find an existing guide without side effects, scanning archived and visible tagged notes.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} scope - Domain/year identity; display name is only used for empty-note recovery.
// @returns {Promise<object|null>} { content, metadata, noteHandle }, with metadata null for interrupted initialization.
// Domain renames work without relying on mutable note titles or persisted cache pointers.
export async function findVisionGuide(app, scope) {
  const results = await Promise.all([
    app.filterNotes({ tag: VISION_GUIDE_TAG }),
    app.filterNotes({ group: "archived", tag: VISION_GUIDE_TAG }),
  ]);
  const handles = [];
  for (const result of results) {
    const resolved = checkedAppResult(result);
    if (!Array.isArray(resolved) && typeof resolved?.[Symbol.asyncIterator] !== "function") {
      throw new Error("Vision Guide lookup returned invalid note data");
    }
    handles.push(...await arrayFromFilterNotesResult(resolved));
  }
  const uniqueHandles = new Map(handles.map(handle => [handle.uuid, handle]));
  const matches = [];
  for (const handle of uniqueHandles.values()) {
    const noteHandle = checkedAppResult(await app.findNote({ uuid: handle.uuid }));
    if (!noteHandle) continue;
    const content = checkedAppResult(await app.getNoteContent(noteHandle));
    if (typeof content !== "string") throw new Error("Could not read Vision Guide note");
    if (!content.trim()) {
      if (noteHandle.tags?.includes(visionGuideScopeTag(scope))) matches.push({ content, metadata: null, noteHandle });
      continue;
    }
    const metadata = readGuideMetadata(content);
    if (metadata.domainUuid !== scope.domainUuid || metadata.year !== scope.year) continue;
    if (metadata.schemaVersion !== GUIDE_SCHEMA_VERSION) throw new Error(`Unsupported Vision Guide schema: ${ metadata.schemaVersion }`);
    matches.push({ content, metadata, noteHandle });
  }
  if (matches.length > 1) throw new Error("Multiple Vision Guides match this domain and year; resolve the duplicate notes before saving");
  return matches[0] ?? null;
}

// ----------------------------------------------------------------------------------------------
// @desc Initialize a newly-created or verified empty interrupted guide using the initial headingless section.
// @param {object} app - Host app.
// @param {object|null} existing - Empty guide returned by findVisionGuide, or null.
// @param {object} scope - Domain/year identity.
// @returns {Promise<object>} Initialized guide snapshot.
// No content mutation, including bootstrap, uses an unscoped replacement.
export async function initializeVisionGuide(app, existing, scope) {
  let noteHandle = existing?.noteHandle;
  if (!noteHandle) {
    const tags = [DASHBOARD_NOTE_TAG, VISION_GUIDE_TAG, visionGuideScopeTag(scope)];
    const uuid = checkedAppResult(await app.createNote(visionGuideNoteName(scope), tags, { archive: true }));
    if (typeof uuid !== "string" || !uuid) throw new Error("Vision Guide creation failed");
    noteHandle = { uuid };
  }
  const content = checkedAppResult(await app.getNoteContent(noteHandle));
  if (typeof content !== "string" || content.trim()) throw new Error("Vision Guide initialization requires an empty note");
  await replaceGuideSection(app, initialVisionGuideMarkdown(scope), noteHandle, { heading: null });
  const savedContent = checkedAppResult(await app.getNoteContent(noteHandle));
  const metadata = readGuideMetadata(savedContent);
  if (metadata.domainUuid !== scope.domainUuid || metadata.year !== scope.year || metadata.schemaVersion !== GUIDE_SCHEMA_VERSION) {
    throw new Error("Vision Guide initialization could not be verified");
  }
  return { content: savedContent, metadata, noteHandle };
}

// ----------------------------------------------------------------------------------------------
// @desc Read immutable guide identity from its JSON metadata section, refusing malformed notes.
// @returns {object} Metadata including domain identity, schema version, and year.
// A title match alone does not authorize adopting existing content.
export function readGuideMetadata(content) {
  const range = guideSectionRange(content, GUIDE_METADATA_HEADING);
  if (!range || range.level !== 1) throw new Error("Vision Guide metadata is missing or misplaced");
  const { payload } = parseJsonPayload(content.slice(range.bodyStart, range.end));
  requireRecord(payload);
  if (!Number.isInteger(payload.year) || !Number.isInteger(payload.schemaVersion)) throw new Error("Invalid Vision Guide metadata");
  if (payload.domainUuid !== null && (typeof payload.domainUuid !== "string" || !payload.domainUuid.trim())) {
    throw new Error("Invalid guide domain identity");
  }
  return payload;
}

// ----------------------------------------------------------------------------------------------
// @desc Perform the only low-level datastore mutation, requiring a section and a positive API result.
// @param {object} app - Host app.
// @param {string} content - Replacement section body.
// @param {object} noteHandle - Existing note handle.
// @param {object} section - Exact heading descriptor, or heading:null for initial content.
// @returns {Promise<void>}
// Reject replacements larger than the plugin API's 200,000-character section write limit.
export async function replaceGuideSection(app, content, noteHandle, section) {
  if (content.length > MAXIMUM_GUIDE_SECTION_CHARACTERS) {
    const headingText = section?.heading?.text ?? "(entire note)";
    const headingLevel = section?.heading?.level ?? null;
    const noteUuid = noteHandle?.uuid ?? null;
    const details = { headingLevel, headingText, limit: MAXIMUM_GUIDE_SECTION_CHARACTERS, noteUuid,
      sectionCharacters: content.length };
    console.error("[plan-wizard] Vision Guide section write exceeds the plugin size bound", details);
    const overflowError = new Error(`Vision Guide section "${ headingText }" is ${ content.length } characters; the write limit is ${ MAXIMUM_GUIDE_SECTION_CHARACTERS }`);
    overflowError.noteUuid = noteUuid;
    throw overflowError;
  }
  const replaced = checkedAppResult(await app.replaceNoteContent(noteHandle, content, { section }));
  if (replaced !== true) throw new Error("Vision Guide section replacement failed; reload and retry");
}

// ----------------------------------------------------------------------------------------------
// @desc Format the human-readable name; identity remains in metadata when the domain is renamed.
// @param {object} scope - { domainName, year }.
// @returns {string} Annual datastore title.
// Follow the Mission Builder note naming specified in the brainstorm.
export function visionGuideNoteName(scope) {
  return `${ scope.domainName } Mission Builder Vision Guide ${ scope.year }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Tag initial note creation with stable scope before a metadata write can fail.
// @param {object} scope - { domainUuid, year }.
// @returns {string} Valid tag preserving domain identity even for empty notes or duplicate display names.
export function visionGuideScopeTag(scope) {
  const domainCodeUnits = scope.domainUuid === null ? [] : scope.domainUuid.split("");
  const domainIdentity = domainCodeUnits.map(character => character.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  return `${ VISION_GUIDE_TAG }/${ scope.year }-${ scope.domainUuid === null ? "all-notes" : domainIdentity }`;
}
