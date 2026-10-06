// Store durable queue jobs in fixed, independently replaceable markdown buckets while reading legacy JSON notes.
import { DASHBOARD_NOTE_TAG } from "constants/settings";
import { guideHeadingRanges, parseJsonPayload } from "plan-wizard/vision-guide-markdown";
import { checkedAppResult, MAXIMUM_GUIDE_SECTION_CHARACTERS, replaceGuideSection } from "plan-wizard/vision-guide-notes";

// ----------------------------------------------------------------------------------------------
// @desc Plain serialized DashboardWorkJob records. Legacy fields may be omitted; unreadable JSON entries remain opaque.
// @typedef {Object} WorkQueueRecord
// @property {number} attempt - Attempts started for the current requested revision.
// @property {string|number|null} attemptRevision - Input revision captured by the running attempt.
// @property {string|null} attemptToken - Token identifying the attempt allowed to update this job.
// @property {string} category - Scheduler priority, such as foregroundData or maintenance.
// @property {number|null} claimExpiresAt - Claim lease expiration in epoch milliseconds.
// @property {Object|Array|string|number|boolean|null} cursor - Plain JSON checkpoint used to resume progress.
// @property {string|number|null} desiredRevision - Input revision this job must produce output for.
// @property {number} enqueuedAt - Original enqueue time in epoch milliseconds.
// @property {string|null} entityId - Project, dictionary term, or other entity this job concerns.
// @property {Object|Array|string|number|boolean|null} input - Plain JSON arguments consumed by the named handler.
// @property {string} key - Stable identity, such as rankProjectTasks:<projectUuid>.
// @property {number|null} lastAttemptedAt - Most recent attempt start in epoch milliseconds.
// @property {{at:number, classification:string, message:string}|null} lastFailure - Most recent attempt failure.
// @property {number|null} nextEligibleAt - Earliest retry time in epoch milliseconds.
// @property {string|null} ownerId - Session currently claiming the job.
// @property {number} schemaVersion - Job record schema version, separate from the queue note layout version.
// @property {string|null} scopeKey - Owning domain/quarter, or null for unscoped work.
// @property {string} status - pending, running, retryWaiting, blockedConfiguration, completed, failed, or superseded.
// @property {number|null} succeededAt - Most recent successful completion in epoch milliseconds.
// @property {string|number|null} succeededRevision - Input revision reflected by the last successful output.
// @property {string} type - Handler registry name, such as reconcileProjects or generateProjectIdeas.
// @property {number} updatedAt - Most recent record transition in epoch milliseconds.

// Version two precreates every bucket so regular updates never replace the note's structure or metadata.
export const WORK_QUEUE_SCHEMA_VERSION = 2;
export const WORK_QUEUE_BUCKET_COUNT = 16;
const METADATA_HEADING = "Queue metadata";

// ----------------------------------------------------------------------------------------------
// @desc Find a queue note without creating it, retaining the parsed bucket payloads for scoped updates.
// @param {Object} app - Host-compatible note lookup, creation, read, and replacement operations.
// @param {string} name - Queue note name.
// @returns {Promise<Object>} { content: string, noteHandle: { uuid: string }|null, buckets: Array<{jobs:Array<WorkQueueRecord>}>|null,
//   payload: {schemaVersion:number, scopeKey:string|null, jobs?:Array<WorkQueueRecord>}|null }. Empty/legacy notes have null buckets.
export async function readWorkQueueNote(app, name) {
  const found = checkedAppResult(await app.findNote({ name }));
  if (!found?.uuid) return { buckets: null, content: "", noteHandle: null, payload: null };
  const noteHandle = { uuid: found.uuid };
  const content = checkedAppResult(await app.getNoteContent(noteHandle));
  if (typeof content !== "string") throw new Error(`Could not read "${ name }"`);
  return { ...workQueueNotePayload(content), content, noteHandle };
}

// ----------------------------------------------------------------------------------------------
// @desc Assign a job key to one fixed bucket, independent of its status, revision, scope, or current neighbors.
// @param {string} key - Stable job identity.
// @returns {number} Zero-based bucket index.
export function workQueueBucketIndex(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) % WORK_QUEUE_BUCKET_COUNT;
}

// ----------------------------------------------------------------------------------------------
// @desc Give each bucket a unique heading that Amplenote can identify without positional section indices.
// @param {number} index - Zero-based bucket index.
// @returns {string} Stable section heading.
export function workQueueBucketSectionName(index) {
  return `Queue bucket ${ String(index + 1).padStart(2, "0") }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Build the initial or migrated note with multiline metadata and all sixteen bucket sections, including empty ones.
// @param {Object} options - { description: string, metadata?: Object, records: Array<WorkQueueRecord>, scopeKey: string|null }.
//   metadata preserves extra note fields; records are serialized jobs plus untouched unreadable JSON values.
// @returns {string} Complete queue markdown; used only for creation or legacy migration.
export function workQueueNoteMarkdown({ description, metadata = {}, records, scopeKey }) {
  _recordsByKey(records);
  const header = { ...metadata, bucketCount: WORK_QUEUE_BUCKET_COUNT, schemaVersion: WORK_QUEUE_SCHEMA_VERSION, scopeKey };
  delete header.jobs;
  const sections = [`# Dashboard work queue\n\n${ description }\n\n## ${ METADATA_HEADING }\n\n${ _payloadMarkdown(header) }`];
  for (let index = 0; index < WORK_QUEUE_BUCKET_COUNT; index += 1) {
    sections.push(`## ${ workQueueBucketSectionName(index) }\n\n${ _payloadMarkdown({ jobs: _bucketRecords(index, records) }) }`);
  }
  return sections.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Decode a legacy single payload or validate and combine the fixed buckets; malformed/ambiguous notes fail closed.
// @param {string} content - Full queue markdown.
// @returns {Object} { buckets: Array<{jobs:Array<WorkQueueRecord>}>|null, payload: Object|null }.
//   payload contains schemaVersion, scopeKey, and combined jobs; empty notes have null payload and legacy notes have null buckets.
export function workQueueNotePayload(content) {
  if (!content.trim()) return { buckets: null, payload: null };
  const headings = guideHeadingRanges(content);
  const metadataSection = _sectionRange(headings, METADATA_HEADING);
  const metadataBody = metadataSection ? content.slice(metadataSection.bodyStart, metadataSection.end) : content;
  const metadata = _parsedPayload(metadataBody);
  if (metadata.schemaVersion !== WORK_QUEUE_SCHEMA_VERSION) return { buckets: null, payload: metadata };
  if (!metadataSection || metadata.bucketCount !== WORK_QUEUE_BUCKET_COUNT) throw new Error("Unsupported work queue bucket layout");
  const buckets = [];
  for (let index = 0; index < WORK_QUEUE_BUCKET_COUNT; index += 1) {
    const heading = workQueueBucketSectionName(index);
    const section = _sectionRange(headings, heading);
    if (!section || section.level !== 2) throw new Error(`Work queue is missing its unique "${ heading }" section`);
    const payload = _parsedPayload(content.slice(section.bodyStart, section.end));
    if (!Array.isArray(payload.jobs)) throw new Error(`Work queue "${ heading }" has no jobs array`);
    if (payload.jobs.some(record => _recordBucketIndex(record) !== index)) throw new Error(`Work queue "${ heading }" holds a misplaced record`);
    buckets.push(payload);
  }
  const records = buckets.flatMap(bucket => bucket.jobs);
  _recordsByKey(records);
  return { buckets, payload: { ...metadata, jobs: _sortedRecords(records) } };
}

// ----------------------------------------------------------------------------------------------
// @desc Create/migrate a queue once, otherwise merge deltas into freshly read buckets and replace only those sections.
// @param {Object} app - Host-compatible note lookup, creation, read, and replacement operations.
// @param {Object} options - { beforeRecords: Array<WorkQueueRecord>, description: string, name: string,
//   records: Array<WorkQueueRecord>, scopeKey: string|null, state: Object }. beforeRecords/records are normalized snapshots;
//   state is the original readWorkQueueNote result containing content, noteHandle, buckets, and raw payload.jobs.
// @returns {Promise<void>} Resolves after every changed bucket is written; partial failures remain retryable.
export async function writeWorkQueueChanges(app, { beforeRecords, description, name, records, scopeKey, state }) {
  if (!state.buckets) {
    const markdown = workQueueNoteMarkdown({ description, metadata: state.payload || {}, records, scopeKey });
    const content = state.content.trim() ? _migrationMarkdown(state.content, markdown) : markdown;
    workQueueNotePayload(content);
    await _initializeQueue(app, { content, name, noteHandle: state.noteHandle });
    return;
  }
  const changedBuckets = _changedBucketIndices(records, beforeRecords);
  for (const index of changedBuckets) {
    const latest = await readWorkQueueNote(app, name);
    if (!latest.buckets || latest.noteHandle?.uuid !== state.noteHandle.uuid) throw new Error("Work queue layout changed; reload and retry");
    const before = _bucketRecords(index, beforeRecords);
    const desired = _bucketRecords(index, records);
    const original = _bucketRecords(index, state.payload.jobs);
    const merged = _mergedBucketRecords(before, latest.buckets[index].jobs, desired, original);
    const payload = { ...latest.buckets[index], jobs: merged };
    if (JSON.stringify(payload) === JSON.stringify(latest.buckets[index])) continue;
    const section = { heading: { level: 2, text: workQueueBucketSectionName(index) } };
    await replaceGuideSection(app, _payloadMarkdown(payload), latest.noteHandle, section);
  }
}

// Local helpers

// ----------------------------------------------------------------------------------------------
// @desc Collect records in one bucket, preserving unreadable records alongside the jobs this version understands.
// @param {number} index - Zero-based bucket index.
// @param {Array<WorkQueueRecord>} records - Persisted job fields and preserved opaque JSON values.
// @returns {Array<WorkQueueRecord>} Deterministically ordered records in that bucket.
function _bucketRecords(index, records) {
  const matching = records.filter(record => _recordBucketIndex(record) === index);
  return _sortedRecords(matching);
}

// ----------------------------------------------------------------------------------------------
// @desc Identify buckets whose records changed, including buckets emptied by retention pruning.
// @param {Array<WorkQueueRecord>} after - Model-normalized records after transition/pruning, plus preserved JSON values.
// @param {Array<WorkQueueRecord>} before - Model-normalized records before the transition, plus preserved JSON values.
// @returns {Array<number>} Changed bucket indices.
function _changedBucketIndices(after, before) {
  const indices = [];
  for (let index = 0; index < WORK_QUEUE_BUCKET_COUNT; index += 1) {
    if (JSON.stringify(_bucketRecords(index, before)) !== JSON.stringify(_bucketRecords(index, after))) indices.push(index);
  }
  return indices;
}

// ----------------------------------------------------------------------------------------------
// @desc Compare job keys by code units so clients with different locales serialize neighbors in the same order.
// @param {WorkQueueRecord} first - First persisted job or preserved JSON value.
// @param {WorkQueueRecord} second - Second persisted job or preserved JSON value.
// @returns {number} Deterministic ordering, preserving the order of equally keyed opaque values.
function _compareRecordKeys(first, second) {
  const firstKey = String(first?.key || "");
  const secondKey = String(second?.key || "");
  return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Write the full structure only when creating an empty note or migrating the old one-block layout.
// @param {Object} app - Host-compatible note lookup, creation, read, and replacement operations.
// @param {Object} options - { content: string, name: string, noteHandle: {uuid:string}|null }; null creates an archived note.
// @returns {Promise<void>} Resolves after a checked write.
async function _initializeQueue(app, { content, name, noteHandle }) {
  if (content.length > MAXIMUM_GUIDE_SECTION_CHARACTERS) throw new Error(`"${ name }" would exceed one migration write`);
  let handle = noteHandle;
  if (!handle) {
    const created = checkedAppResult(await app.createNote(name, [DASHBOARD_NOTE_TAG], { archive: true }));
    const uuid = typeof created === "string" ? created : created?.uuid;
    if (!uuid) throw new Error(`Could not create "${ name }"`);
    handle = { uuid };
  }
  await replaceGuideSection(app, content, handle, null);
}

// ----------------------------------------------------------------------------------------------
// @desc Apply only changed job keys to the current bucket, preserving other clients' additions/edits and opaque records.
//   A concurrent change to the same job is retried instead of overwritten; pruning skips a record refreshed remotely.
// @param {Array<WorkQueueRecord>} before - Model-normalized bucket before the transition, including preserved JSON values.
// @param {Array<WorkQueueRecord>} current - Freshly persisted bucket records; omitted fields have not been defaulted.
// @param {Array<WorkQueueRecord>} desired - Model-normalized result of this transition, including preserved JSON values.
// @param {Array<WorkQueueRecord>} originalRecords - Original persisted bucket snapshot, before model defaults were applied.
// @returns {Array<WorkQueueRecord>} Changed normalized jobs plus untouched raw values. Throws on a stale changed-job input.
function _mergedBucketRecords(before, current, desired, originalRecords) {
  const beforeByKey = _recordsByKey(before);
  const originalByKey = _recordsByKey(originalRecords);
  const desiredByKey = _recordsByKey(desired);
  const currentByKey = _recordsByKey(current);
  const changedKeys = new Set();
  const replacements = [];
  for (const key of new Set([...beforeByKey.keys(), ...desiredByKey.keys()])) {
    const original = originalByKey.get(key);
    const replacement = desiredByKey.get(key);
    const latest = currentByKey.get(key);
    if (JSON.stringify(beforeByKey.get(key)) === JSON.stringify(replacement)) continue;
    if (JSON.stringify(latest) !== JSON.stringify(original) && JSON.stringify(latest) !== JSON.stringify(replacement)) {
      if (replacement === undefined) continue;
      throw new Error(`Work queue job "${ key }" changed on another client; retry the transition`);
    }
    changedKeys.add(key);
    if (replacement !== undefined) replacements.push(replacement);
  }
  const unchanged = current.filter(record => !changedKeys.has(record?.key));
  return _sortedRecords([...unchanged, ...replacements]);
}

// ----------------------------------------------------------------------------------------------
// @desc Replace the legacy JSON region while keeping its preamble and placing trailing annotations outside every bucket.
// @param {string} content - Original legacy note.
// @param {string} markdown - Complete new queue structure.
// @returns {string} Migration content preserving original prose and Rich Footnote definitions.
function _migrationMarkdown(content, markdown) {
  const range = parseJsonPayload(content);
  const structure = markdown.slice(markdown.indexOf(`## ${ METADATA_HEADING }`));
  const suffix = content.slice(range.end);
  const annotations = suffix.trim() ? `\n# Queue annotations\n\n${ suffix }` : suffix;
  return `${ content.slice(0, range.start) }${ structure }${ annotations }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Decode a JSON fence without accepting damaged content as an empty queue or bucket.
// @param {string} content - Metadata, legacy note, or one bucket body.
// @returns {Object} Queue metadata {schemaVersion, scopeKey, bucketCount} or a bucket {jobs:Array<WorkQueueRecord>}, with extra fields retained.
function _parsedPayload(content) {
  return parseJsonPayload(content).payload;
}

// ----------------------------------------------------------------------------------------------
// @desc Format one JSON object with each record field on its own line, escaping values through JSON serialization.
// @param {Object} payload - Note metadata {schemaVersion:number, scopeKey:string|null, bucketCount:number}
//   or a bucket {jobs:Array<WorkQueueRecord>}, retaining extra JSON fields.
// @returns {string} Fenced, indented JSON.
function _payloadMarkdown(payload) {
  return `\`\`\`json\n${ JSON.stringify(payload, null, 2) }\n\`\`\`\n`;
}

// ----------------------------------------------------------------------------------------------
// @desc Hash a readable job key, or the complete opaque value when a preserved record has no usable identity.
// @param {WorkQueueRecord} record - Persisted job fields or an opaque JSON value with no usable key.
// @returns {number} Bucket index.
function _recordBucketIndex(record) {
  const key = typeof record?.key === "string" && record.key ? record.key : JSON.stringify(record);
  return workQueueBucketIndex(key);
}

// ----------------------------------------------------------------------------------------------
// @desc Index keyed records, refusing ambiguous identities rather than replacing one of two duplicate jobs.
// @param {Array<WorkQueueRecord>} records - Persisted job fields and preserved opaque JSON values.
// @returns {Map<string, WorkQueueRecord>} Serialized records indexed by their verified nonempty key; keyless JSON values are excluded.
function _recordsByKey(records) {
  const byKey = new Map();
  for (const record of records) {
    if (typeof record?.key !== "string" || !record.key) continue;
    if (byKey.has(record.key)) throw new Error(`Work queue contains duplicate job key "${ record.key }"`);
    byKey.set(record.key, record);
  }
  return byKey;
}

// ----------------------------------------------------------------------------------------------
// @desc Locate a unique bucket or metadata heading using the note's already parsed heading ranges.
// @param {Array<{bodyStart:number, end:number, level:number, start:number, text:string}>} headings - ATX headings outside code fences.
// @param {string} text - Exact section name.
// @returns {{bodyStart:number, end:number, level:number, start:number, text:string}|null} Unique heading range; ambiguous names throw.
function _sectionRange(headings, text) {
  const matches = headings.filter(heading => heading.text === text);
  if (matches.length > 1) throw new Error(`Work queue contains duplicate section "${ text }"`);
  return matches[0] || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Keep records ordered by stable key within buckets so changes never shuffle unrelated neighboring records.
// @param {Array<WorkQueueRecord>} records - Persisted job fields and preserved opaque JSON values.
// @returns {Array<WorkQueueRecord>} Ordered copy preserving each record's original fields.
function _sortedRecords(records) {
  const sorted = [...records];
  sorted.sort(_compareRecordKeys);
  return sorted;
}
