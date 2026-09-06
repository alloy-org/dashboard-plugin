// Read and update independent goal/possibility sections with local write serialization.

import { GoalSet, IntentPossibility, copyJsonValue, normalizedTimestamp } from "plan-wizard/plan-models";
import { GUIDE_ROOT_HEADING, guideHeadingRanges, guideSectionRange, intentRootMarkdown, intentSectionDefinition,
  jsonPayloadMarkdown, parseJsonPayload, replaceJsonPayload } from "plan-wizard/vision-guide-markdown";
import { goalSlotKey, samePlanningData } from "plan-wizard/vision-guide-merge";
import { checkedAppResult, findVisionGuide, initializeVisionGuide, readGuideMetadata, replaceGuideSection } from "plan-wizard/vision-guide-notes";

const writesByApp = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc Fail closed on horizontal rules in a structural replacement until their range semantics are supported.
// @param {string} body - Section subtree to rewrite.
// Do not guess whether a headingless section after a rule belongs to its parent.
function assertSupportedSectionBody(body) {
  if (/^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/m.test(body)) {
    throw new Error("A horizontal rule divides this Vision Guide section; remove it before saving");
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Insert a missing leaf at the nearest available ancestor, retaining its freshly-read subtree.
// @param {object} app - Host app.
// @param {object} guide - Current note snapshot.
// @param {string} kind - goals, personal, or work.
// @param {object} scope - Resolved planning scope.
// @returns {Promise<void>}
// Parent subtree semantics and headingless bootstrap were verified against the live API.
async function ensureIntentSection(app, guide, kind, scope) {
  const definition = intentSectionDefinition(kind, scope);
  const parent = guideSectionRange(guide.content, definition.parent);
  const root = guideSectionRange(guide.content, GUIDE_ROOT_HEADING);
  let insertion = `### ${ definition.text }\n\n${ jsonPayloadMarkdown(definition.empty) }`;
  let target = parent;
  if (!parent) {
    const template = intentRootMarkdown(scope.year);
    const parentTemplate = guideSectionRange(template, definition.parent);
    insertion = template.slice(parentTemplate.start, parentTemplate.end);
    target = root;
  }
  if (!root) { target = null; insertion = `# ${ GUIDE_ROOT_HEADING }\n\n${ intentRootMarkdown(scope.year) }`; }
  const firstHeading = guideHeadingRanges(guide.content)[0];
  const body = target ? guide.content.slice(target.bodyStart, target.end) : guide.content.slice(0, firstHeading?.start ?? guide.content.length);
  assertSupportedSectionBody(body);
  const section = { heading: target ? { level: target.level, text: target.text } : null };
  await replaceGuideSection(app, `${ body.trimEnd() }\n\n${ insertion }\n`, guide.noteHandle, section);
}

// ----------------------------------------------------------------------------------------------
// @desc Get a unique leaf only when it is nested under the expected parent and root.
// @param {string} content - Complete note markdown.
// @param {string} kind - Leaf kind.
// @param {object} scope - Planning scope.
// @returns {object|null} Safe leaf range, or null for a missing leaf.
// Hand-edited or duplicated headings must not redirect a write into another section.
function intentLeafRange(content, kind, scope) {
  const definition = intentSectionDefinition(kind, scope);
  const leaf = guideSectionRange(content, definition.text);
  const parent = guideSectionRange(content, definition.parent);
  const root = guideSectionRange(content, GUIDE_ROOT_HEADING);
  if (root && root.level !== 1) throw new Error("Top-line intent must be a level-one heading");
  if (parent && (!root || parent.level !== 2 || parent.start < root.bodyStart || parent.end > root.end)) {
    throw new Error("Intent parent heading is misplaced");
  }
  if (leaf && (!parent || leaf.level !== 3 || leaf.start < parent.bodyStart || leaf.end > parent.end)) {
    throw new Error("Intent leaf heading is misplaced");
  }
  return leaf;
}

// ----------------------------------------------------------------------------------------------
// @desc Read all first-pass goal/intention leaves without creating or repairing any notes.
// @param {object} app - Host app.
// @param {object} scope - Resolved planning scope.
// @returns {Promise<object|null>} Guide with normalized goals, personal, and work envelopes, or null.
// Recommendation consumers can safely consult a missing datastore.
export async function readVisionGuide(app, scope) {
  const guide = await findVisionGuide(app, scope);
  if (!guide?.metadata) return null;
  const snapshot = { metadata: guide.metadata, noteUuid: guide.noteHandle.uuid };
  for (const kind of ["goals", "personal", "work"]) snapshot[kind] = sectionPayload(guide.content, kind, scope);
  return snapshot;
}

// ----------------------------------------------------------------------------------------------
// @desc Read a leaf or its missing-section default; malformed existing payloads always throw.
// @param {string} content - Complete note markdown.
// @param {string} kind - Leaf kind.
// @param {object} scope - Planning scope.
// @returns {object} Detached validated envelope.
// Empty storage is distinct from storage that could not be parsed.
function sectionPayload(content, kind, scope) {
  const range = intentLeafRange(content, kind, scope);
  if (!range) return copyJsonValue(intentSectionDefinition(kind, scope).empty);
  const { payload } = parseJsonPayload(content.slice(range.bodyStart, range.end));
  return validatedSectionPayload(kind, payload, scope);
}

// ----------------------------------------------------------------------------------------------
// @desc Queue a scoped read/merge/write, including creation and structural repairs, on the host app instance.
// @param {object} app - Host app or the existing embed app proxy; reuse its instance for local serialization.
// @param {string} kind - goals, personal, or work.
// @param {object} scope - Resolved planning scope.
// @param {Function} transform - Pure function receiving the latest validated envelope.
// @returns {Promise<object>} Verified updated guide snapshot.
// Failed jobs release the queue; this is not a cross-device transaction guarantee.
export async function updateVisionGuideSection(app, kind, scope, transform) {
  let queues = writesByApp.get(app);
  if (!queues) { queues = new Map(); writesByApp.set(app, queues); }
  const key = JSON.stringify([scope.domainUuid, scope.year]);
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => writeIntentSection(app, kind, scope, transform));
  queues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(key) === pending) queues.delete(key);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Validate stored and proposed envelopes, retaining unknown JSON fields but rejecting duplicate identities.
// @param {string} kind - Leaf kind.
// @param {object} payload - JSON leaf object.
// @param {object} scope - Resolved planning scope.
// @returns {object} Normalized envelope.
// Apply identical integrity rules to reads and writes.
export function validatedSectionPayload(kind, payload, scope) {
  const result = copyJsonValue(payload);
  if (kind === "goals") {
    if (!Array.isArray(result.goals)) throw new Error("Stored goals must be an array");
    result.goals = result.goals.map(goal => new GoalSet(goal, scope));
    if (new Set(result.goals.map(goalSlotKey)).size !== result.goals.length) throw new Error("Duplicate stored goal slot");
    if (new Set(result.goals.map(goal => goal.uuid)).size !== result.goals.length) throw new Error("Duplicate stored goal UUID");
  } else {
    if (!Array.isArray(result.possibilities) || result.possibilities.length > 3) throw new Error("Invalid stored possibilities");
    result.possibilities = result.possibilities.map(record => new IntentPossibility(record));
    if (result.possibilities.some(item => item.userCategoryEm !== kind)) throw new Error("Stored possibility category does not match");
    if (new Set(result.possibilities.map(item => item.uuid)).size !== result.possibilities.length) {
      throw new Error("Duplicate stored possibility UUID");
    }
    if (result.generatedAt !== null) result.generatedAt = normalizedTimestamp(result.generatedAt);
    if (result.possibilities.length && !result.generatedAt) throw new Error("Stored suggestions require generatedAt");
  }
  return result;
}

// ----------------------------------------------------------------------------------------------
// @desc Merge against freshly-read note content, write one leaf, and verify the resulting payload.
// @param {object} app - Host app.
// @param {string} kind - Leaf kind.
// @param {object} scope - Resolved planning scope.
// @param {Function} transform - Pure envelope update.
// @returns {Promise<object>} Snapshot after persistence.
// Retrying a failed operation re-reads state instead of overwriting from a cached snapshot.
async function writeIntentSection(app, kind, scope, transform) {
  let guide = await findVisionGuide(app, scope);
  if (!guide?.metadata) guide = await initializeVisionGuide(app, guide, scope);
  guide.content = checkedAppResult(await app.getNoteContent(guide.noteHandle));
  const metadata = readGuideMetadata(guide.content);
  if (!samePlanningData(guide.metadata, metadata)) throw new Error("Vision Guide metadata changed; reload before saving");
  let range = intentLeafRange(guide.content, kind, scope);
  if (!range) {
    await ensureIntentSection(app, guide, kind, scope);
    guide.content = checkedAppResult(await app.getNoteContent(guide.noteHandle));
    range = intentLeafRange(guide.content, kind, scope);
    if (!range) throw new Error("Vision Guide section creation could not be verified");
  }
  const previous = sectionPayload(guide.content, kind, scope);
  const updated = validatedSectionPayload(kind, transform(copyJsonValue(previous)), scope);
  if (!samePlanningData(previous, updated)) {
    const body = guide.content.slice(range.bodyStart, range.end);
    assertSupportedSectionBody(body);
    const replacement = replaceJsonPayload(body, updated);
    await replaceGuideSection(app, replacement, guide.noteHandle, { heading: { level: range.level, text: range.text } });
    const savedContent = checkedAppResult(await app.getNoteContent(guide.noteHandle));
    if (!samePlanningData(sectionPayload(savedContent, kind, scope), updated)) {
      throw new Error("Vision Guide save verification failed; reload before retrying");
    }
  }
  return await readVisionGuide(app, scope);
}
