// Discover archived annual guides by stored domain identity.

import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { GUIDE_SCHEMA_VERSION, requireRecord } from "plan-wizard/plan-models";
import { GUIDE_METADATA_HEADING, GUIDE_PREAMBLE_TEXT, guideHeadingRanges, guideSectionRange, initialVisionGuideMarkdown, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
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
// A note carrying the shared tag but belonging to another scope is skipped when its metadata cannot be read, so one
//   unreadable guide cannot block every other scope from loading; an unreadable note in this scope still reports.
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
    const inScope = noteMatchesScope(noteHandle, scope);
    if (isBlankNoteContent(content)) {
      if (inScope) matches.push({ content: "", metadata: null, noteHandle });
      continue;
    }
    if (isPartialBootstrapContent(content)) {
      if (inScope) matches.push({ content, metadata: null, noteHandle });
      continue;
    }
    let metadata;
    try {
      metadata = readGuideMetadata(content, { noteName: noteHandle.name ?? null, noteTags: noteHandle.tags ?? null,
        noteUuid: noteHandle.uuid });
    } catch (metadataError) {
      if (!inScope) continue;
      throw metadataError;
    }
    if (metadata.domainUuid !== scope.domainUuid || metadata.year !== scope.year) continue;
    if (metadata.schemaVersion !== GUIDE_SCHEMA_VERSION) throw new Error(`Unsupported Vision Guide schema: ${ metadata.schemaVersion }`);
    matches.push({ content, metadata, noteHandle });
  }
  if (matches.length > 1) throw new Error("Multiple Vision Guides match this domain and year; resolve the duplicate notes before saving");
  return matches[0] ?? null;
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether an as-yet-unwritten note belongs to this scope, using its scope tag or its display name.
// @param {object} noteHandle - Note handle carrying tags and a name.
// @param {object} scope - Resolved planning scope.
// @returns {boolean} True when the note is this scope's guide.
// A note has no metadata to identify it until bootstrap succeeds, so identity rests on the tag written at creation.
//   An earlier encoding produced a tag long enough for the host to truncate, so a stored tag that is a prefix of the
//   expected one is accepted, as is the exact creation name, letting notes stranded by that bug be adopted instead of
//   orphaned beside a duplicate.
function noteMatchesScope(noteHandle, scope) {
  const scopeTag = visionGuideScopeTag(scope);
  const tags = noteHandle.tags ?? [];
  if (tags.includes(scopeTag)) return true;
  const scopeTagPrefix = `${ VISION_GUIDE_TAG }/${ scope.year }-`;
  if (tags.some(tag => tag.length < scopeTag.length && tag.startsWith(scopeTagPrefix) && scopeTag.startsWith(tag))) return true;
  return noteHandle.name === visionGuideNoteName(scope);
}

// ----------------------------------------------------------------------------------------------
// @desc Initialize a newly-created or verified empty interrupted guide using the initial headingless section.
// @param {object} app - Host app.
// @param {object|null} existing - Empty guide returned by findVisionGuide, or null.
// @param {object} scope - Domain/year identity.
// @returns {Promise<object>} Initialized guide snapshot.
// No content mutation, including bootstrap, uses an unscoped replacement.
// A note that is unexpectedly non-empty names itself and reports what it held, so the refusal can be traced to the
//   note rather than only to the step that failed.
export async function initializeVisionGuide(app, existing, scope) {
  let noteHandle = existing?.noteHandle;
  if (!noteHandle) {
    const tags = [DASHBOARD_NOTE_TAG, VISION_GUIDE_TAG, visionGuideScopeTag(scope)];
    const uuid = checkedAppResult(await app.createNote(visionGuideNoteName(scope), tags, { archive: true }));
    if (typeof uuid !== "string" || !uuid) throw new Error("Vision Guide creation failed");
    noteHandle = await resolvedNoteHandle(app, uuid);
  }
  const content = checkedAppResult(await app.getNoteContent(noteHandle));
  if (typeof content !== "string") throw new Error("Could not read Vision Guide note during initialization");
  if (!isBlankNoteContent(content) && !isPartialBootstrapContent(content)) {
    const observedContent = content.slice(0, 300);
    const details = { createdHere: !existing?.noteHandle, noteUuid: noteHandle?.uuid ?? null, observedContent,
      scopeTag: visionGuideScopeTag(scope) };
    console.error("[plan-wizard] Vision Guide bootstrap found a note holding unrecognized content", details);
    throw new Error(`Vision Guide initialization requires an empty note; note ${ noteHandle?.uuid ?? "(unknown)" } holds ${ JSON.stringify(observedContent) }`);
  }
  await replaceGuideSection(app, initialVisionGuideMarkdown(scope), noteHandle, null);
  const savedContent = checkedAppResult(await app.getNoteContent(noteHandle));
  if (typeof savedContent !== "string" || isBlankNoteContent(savedContent)) {
    const details = { noteUuid: noteHandle?.uuid ?? null, savedContentType: typeof savedContent };
    console.error("[plan-wizard] Vision Guide bootstrap wrote its skeleton but read back an empty note", details);
    throw new Error(`Vision Guide initialization wrote no content to note ${ noteHandle?.uuid ?? "(unknown)" }`);
  }
  const metadata = readGuideMetadata(savedContent, { noteUuid: noteHandle?.uuid });
  if (metadata.domainUuid !== scope.domainUuid || metadata.year !== scope.year || metadata.schemaVersion !== GUIDE_SCHEMA_VERSION) {
    throw new Error("Vision Guide initialization could not be verified");
  }
  return { content: savedContent, metadata, noteHandle };
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve a note handle the host owns from a uuid returned by note creation.
// @param {object} app - Host app.
// @param {string} uuid - Identifier returned by createNote.
// @returns {Promise<object>} The looked-up note handle, or a bare identifier when lookup returns nothing.
// createNote may return a local-prefixed uuid that changes once the note reaches the server, so writing through the
//   returned identifier can address a note the host no longer resolves; the write then reports success while leaving
//   the note empty. Looking the note up again exchanges that identifier for the handle the host currently holds.
async function resolvedNoteHandle(app, uuid) {
  const noteHandle = checkedAppResult(await app.findNote({ uuid }));
  return noteHandle ?? { uuid };
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether a note holds no authored content, counting a lone backslash on a line as nothing.
// @param {string} content - Complete note markdown.
// @returns {boolean} True when the note carries nothing a reader would see.
// A note that displays as empty does not always read back as an empty string: getNoteContent was observed returning
//   a single backslash for a note with no visible content. That is truthy after trimming and carries no headings, so
//   a literal emptiness test sends a blank note down the parsing path and reports its missing metadata as corruption.
//   Only a backslash alone on its line is discounted; an escaped backslash sits beside other characters and is
//   treated as authored content, so this never overwrites a note a reader would see something in.
function isBlankNoteContent(content) {
  if (typeof content !== "string") return false;
  return content.split("\n").every(line => line.trim() === "" || line.trim() === "\\");
}

// ----------------------------------------------------------------------------------------------
// @desc Report whether a non-empty note holds nothing but the bootstrap preamble this module writes.
// @param {string} content - Complete note markdown.
// @returns {boolean} True when the note is a partial bootstrap that is safe to overwrite.
// An earlier release wrote the skeleton to section { heading: null }, which bounded the write to the text above the
//   first heading and dropped every heading after it. The remaining line is this module's own output and carries no
//   user data, so bootstrap may finish the note rather than refusing it forever.
function isPartialBootstrapContent(content) {
  if (guideHeadingRanges(content).length) return false;
  return content.trim() === GUIDE_PREAMBLE_TEXT;
}

// ----------------------------------------------------------------------------------------------
// @desc Read immutable guide identity from its JSON metadata section, refusing malformed notes.
// @param {string} content - Complete note markdown.
// @param {object} diagnosticContext - Optional { noteUuid } naming the note the content came from.
// @returns {object} Metadata including domain identity, schema version, and year.
// A title match alone does not authorize adopting existing content.
// A note whose metadata heading is absent reports its own headings, so a malformed note can be found and inspected.
export function readGuideMetadata(content, diagnosticContext = {}) {
  const range = guideSectionRange(content, GUIDE_METADATA_HEADING);
  if (!range || range.level !== 1) {
    const observedHeadings = guideHeadingRanges(content).map(heading => `${ "#".repeat(heading.level) } ${ heading.text }`);
    const details = { headingLevel: range?.level ?? null, noteUuid: diagnosticContext.noteUuid ?? null, observedHeadings,
      contentLength: content.length, contentJson: JSON.stringify(content.slice(0, 2000)),
      noteName: diagnosticContext.noteName ?? null, noteTags: diagnosticContext.noteTags ?? null };
    console.error("[plan-wizard] Vision Guide metadata heading is missing or misplaced", details);
    throw new Error(`Vision Guide metadata is missing or misplaced in note ${ diagnosticContext.noteUuid ?? "(unknown)" }; headings found: ${ JSON.stringify(observedHeadings) }`);
  }
  const { payload } = parseJsonPayload(content.slice(range.bodyStart, range.end));
  requireRecord(payload);
  if (!Number.isInteger(payload.year) || !Number.isInteger(payload.schemaVersion)) throw new Error("Invalid Vision Guide metadata");
  if (payload.domainUuid !== null && (typeof payload.domainUuid !== "string" || !payload.domainUuid.trim())) {
    throw new Error("Invalid guide domain identity");
  }
  return payload;
}

// ----------------------------------------------------------------------------------------------
// @desc Perform the only low-level datastore mutation, requiring a positive API result.
// @param {object} app - Host app.
// @param {string} content - Replacement section body, or the whole note when no section is named.
// @param {object} noteHandle - Existing note handle.
// @param {object|null} section - Exact heading descriptor, or null to replace the entire note.
// @returns {Promise<void>}
// Reject replacements larger than the plugin API's 200,000-character section write limit.
// A null section omits the option entirely, which the API documents as replacing the whole note; a section whose
//   heading is null would instead bound the write to the preamble before the first heading and silently drop the
//   headings that follow it.
// The handle is rebuilt as a bare { uuid } literal rather than forwarded as received. In production every app call
//   crosses the embed's postMessage bridge, which structured-clones its arguments, and a handle that came back from
//   findNote or filterNotes is one of the bridge's own lazily-populated objects: it does not survive that round trip
//   as something the host can resolve to a note. The host then reports a successful write it never performed, so the
//   note reads back empty with no error to catch. Every note-writing service in this codebase normalizes the same
//   way, at the point its resolver returns a handle; see doc/code_conventions.md.
export async function replaceGuideSection(app, content, noteHandle, section) {
  const writeHandle = { uuid: noteHandle?.uuid };
  if (typeof writeHandle.uuid !== "string" || !writeHandle.uuid) {
    throw new Error("Vision Guide write was given a note handle carrying no uuid");
  }
  if (content.length > MAXIMUM_GUIDE_SECTION_CHARACTERS) {
    const headingText = section?.heading?.text ?? "(entire note)";
    const headingLevel = section?.heading?.level ?? null;
    const noteUuid = writeHandle.uuid;
    const details = { headingLevel, headingText, limit: MAXIMUM_GUIDE_SECTION_CHARACTERS, noteUuid,
      sectionCharacters: content.length };
    console.error("[plan-wizard] Vision Guide section write exceeds the plugin size bound", details);
    const overflowError = new Error(`Vision Guide section "${ headingText }" is ${ content.length } characters; the write limit is ${ MAXIMUM_GUIDE_SECTION_CHARACTERS }`);
    overflowError.noteUuid = noteUuid;
    throw overflowError;
  }
  const writeOptions = section ? { section } : {};
  const replaced = checkedAppResult(await app.replaceNoteContent(writeHandle, content, writeOptions));
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
// Domain UUIDs are already lowercase hex and hyphens, so they are carried verbatim and only unexpected characters
//   are escaped. An earlier encoding spent four hex digits on every character, producing a 179-character tag that
//   the host truncated, after which the stored tag could never match the one recomputed here and every interrupted
//   bootstrap was stranded in a note the wizard refused to adopt.
export function visionGuideScopeTag(scope) {
  if (scope.domainUuid === null) return `${ VISION_GUIDE_TAG }/${ scope.year }-all-notes`;
  const domainIdentity = scope.domainUuid.toLowerCase().replace(/[^a-z0-9-]/g, character => `-${ character.charCodeAt(0).toString(16) }-`);
  return `${ VISION_GUIDE_TAG }/${ scope.year }-${ domainIdentity }`;
}
