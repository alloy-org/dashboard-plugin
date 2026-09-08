// Read and update independent goal/possibility sections with local write serialization.

import ActionProspect from "plan-wizard/action-prospect";
import GoalSet from "plan-wizard/goal-set";
import IntentPossibility from "plan-wizard/intent-possibility";
import { copyJsonValue, normalizedTimestamp, requireRecord, requiredText } from "plan-wizard/plan-models";
import ProspectTask from "plan-wizard/prospect-task";
import { PROSPECT_TASK_BUCKET_LABELS, guideHeadingRanges, guideSectionRange, insertProspectMonthSubtree,
  intentRootMarkdown, intentSectionDefinition, jsonPayloadMarkdown, parseJsonPayload, prospectFocusMonthLabel,
  prospectMonthHeadingText, prospectMonthSubtreeMarkdown, prospectPlacementBucketLabel, prospectRootMarkdown,
  prospectTaskBucketHeadingText, replaceJsonPayload } from "plan-wizard/vision-guide-markdown";
import { goalSlotKey, samePlanningData } from "plan-wizard/vision-guide-merge";
import { checkedAppResult, findVisionGuide, initializeVisionGuide, readGuideMetadata, replaceGuideSection } from "plan-wizard/vision-guide-notes";

const writesByApp = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc Validate one stored project and identify its category and title when validation fails.
// @param {object} prospect - Raw ActionProspect record from the Vision Guide.
// @param {string} kind - workProspects or personalProspects.
// @returns {ActionProspect} Validated project.
// A bare enum assertion does not tell the user which record in the annual guide needs attention.
function validatedActionProspect(prospect, kind) {
  try {
    return new ActionProspect(prospect, { quarterKey: prospect?.quarterKey });
  } catch (error) {
    const category = kind === "workProspects" ? "Professional" : "Personal";
    const identity = prospect?.summary || prospect?.uuid || "unnamed project";
    throw new Error(`${ category } project "${ identity }" is invalid: ${ error.message }`);
  }
}

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
  const root = definition.root ? guideSectionRange(guide.content, definition.root) : null;
  let insertion = `${ "#".repeat(definition.level) } ${ definition.text }\n\n${ jsonPayloadMarkdown(definition.empty) }`;
  let target = parent;
  if (!parent) {
    const template = definition.root ? intentRootMarkdown(scope.year) : prospectRootMarkdown();
    const parentTemplate = guideSectionRange(template, definition.parent);
    insertion = template.slice(parentTemplate.start, parentTemplate.end);
    target = root;
  }
  if (definition.root && !root) { target = null; insertion = `# ${ definition.root }\n\n${ intentRootMarkdown(scope.year) }`; }
  const firstHeading = guideHeadingRanges(guide.content)[0];
  const body = target ? guide.content.slice(target.bodyStart, target.end) : guide.content.slice(0, firstHeading?.start ?? guide.content.length);
  assertSupportedSectionBody(body);
  const section = { heading: target ? { level: target.level, text: target.text } : null };
  await replaceGuideSection(app, `${ body.trimEnd() }\n\n${ insertion }\n`, guide.noteHandle, section);
}

// ----------------------------------------------------------------------------------------------
// @desc Get a unique leaf only when it is nested at the depth its definition claims, under the expected parent
//   and, for the quarter-scoped intent leaves, under the intent root. Prospect leaves declare no root, since
//   their parent is itself a level-one project category rather than a child of the intent tree.
// @param {string} content - Complete note markdown.
// @param {string} kind - Leaf kind.
// @param {object} scope - Planning scope.
// @returns {object|null} Safe leaf range, or null for a missing leaf.
// Hand-edited or duplicated headings must not redirect a write into another section.
function intentLeafRange(content, kind, scope) {
  const definition = intentSectionDefinition(kind, scope);
  const leaf = guideSectionRange(content, definition.text);
  const parent = guideSectionRange(content, definition.parent);
  const root = definition.root ? guideSectionRange(content, definition.root) : null;
  if (definition.root && root && root.level !== 1) throw new Error(`${ definition.root } must be a level-one heading`);
  const parentIsPlaced = parent && parent.level === definition.parentLevel
    && (!definition.root || (root && parent.start >= root.bodyStart && parent.end <= root.end));
  if (parent && !parentIsPlaced) throw new Error("Intent parent heading is misplaced");
  if (leaf && (!parent || leaf.level !== definition.level || leaf.start < parent.bodyStart || leaf.end > parent.end)) {
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
  for (const kind of ["goals", "personal", "personalProspects", "work", "workProspects"]) {
    snapshot[kind] = sectionPayload(guide.content, kind, scope);
  }
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
  return enqueueVisionGuideWrite(app, scope, () => writeIntentSection(app, kind, scope, transform));
}

// ----------------------------------------------------------------------------------------------
// @desc Write this project's ActionProspect into the one placement bucket it belongs in, and write every sibling
//   bucket even when empty, so a UUID that moved cannot remain in a previous heading.
// @param {object} app - Host app or embed proxy.
// @param {object} prospect - Stored ActionProspect being placed.
// @param {object} scope - Resolved planning scope.
// @returns {Promise<object>} Verified guide snapshot.
export async function writeProspectPlacementSections(app, prospect, scope) {
  return enqueueVisionGuideWrite(app, scope, () => persistProspectPlacementSections(app, prospect, scope));
}

// ----------------------------------------------------------------------------------------------
// @desc Queue one Vision Guide mutation per domain/year so independent leaves still write in order.
// @param {object} app - Host app instance.
// @param {object} scope - Resolved planning scope.
// @param {Function} job - Write to run after earlier jobs for this guide.
// @returns {Promise<*>} The job's result.
async function enqueueVisionGuideWrite(app, scope, job) {
  let queues = writesByApp.get(app);
  if (!queues) { queues = new Map(); writesByApp.set(app, queues); }
  const key = JSON.stringify([scope.domainUuid, scope.year]);
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(job);
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
  if (kind === "personalProspects" || kind === "workProspects") {
    const userCategoryEm = kind === "workProspects" ? "work" : "personal";
    if (!Array.isArray(result.prospects)) throw new Error("Stored prospects must be an array");
    if (!Array.isArray(result.prospectTasks)) throw new Error("Stored prospect tasks must be an array");
    result.prospects = result.prospects.map(prospect => validatedActionProspect(prospect, kind));
    if (result.prospects.some(prospect => prospect.userCategoryEm !== userCategoryEm)) throw new Error("Stored prospect category does not match");
    const prospectUuids = new Set(result.prospects.map(prospect => prospect.uuid));
    if (prospectUuids.size !== result.prospects.length) throw new Error("Duplicate stored prospect UUID");
    result.prospectTasks = result.prospectTasks.map(prospectTask => new ProspectTask(prospectTask));
    if (new Set(result.prospectTasks.map(item => item.uuid)).size !== result.prospectTasks.length) {
      throw new Error("Duplicate stored prospect task UUID");
    }
    if (result.prospectTasks.some(item => !prospectUuids.has(item.prospectUuid))) throw new Error("Prospect task references an unknown prospect");
    return result;
  }
  if (kind === "goals") {
    if (!Array.isArray(result.goals)) throw new Error("Stored goals must be an array");
    result.goals = result.goals.map(goal => new GoalSet(goal, scope));
    if (new Set(result.goals.map(goalSlotKey)).size !== result.goals.length) throw new Error("Duplicate stored goal slot");
    if (new Set(result.goals.map(goal => goal.uuid)).size !== result.goals.length) throw new Error("Duplicate stored goal UUID");
    result.dailySufficiency = validatedQuarterAnswer("dailySufficiency", result.dailySufficiency);
    result.quarterName = validatedQuarterAnswer("quarterName", result.quarterName);
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
// @desc Validate one of the quarter-wide answers stored beside the picked goals: the quarter's name and the bar
//   that says a day's work is done. Both are single values for the whole quarter rather than per-project
//   attributes, so they live in this envelope instead of on a prospect record.
// @param {string} field - Field being validated, named in any error.
// @param {object|null|undefined} answer - Stored { capturedAt, text } envelope, or null when unanswered.
// @returns {object|null} Normalized answer, or null.
// A newer capture displaces an older one, matching how every other stored decision resolves a conflict.
function validatedQuarterAnswer(field, answer) {
  if (answer === undefined || answer === null) return null;
  requireRecord(answer);
  const text = requiredText(field, answer.text);
  return { ...answer, capturedAt: normalizedTimestamp(answer.capturedAt), text };
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
  const metadata = readGuideMetadata(guide.content, { noteUuid: guide.noteHandle?.uuid });
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

// ----------------------------------------------------------------------------------------------
// @desc Insert the four task-bucket headings for a project under its category root when missing.
// @param {object} app - Host app.
// @param {string|null} destinationLabel - Bucket that should hold this ActionProspect.
// @param {object} guide - Current note snapshot with content and noteHandle.
// @param {object} payload - JSON stored under the destination bucket.
// @param {object} prospect - Stored ActionProspect.
// @param {object} scope - Resolved planning scope.
// @returns {Promise<void>}
async function ensureProspectMonthSection(app, destinationLabel, guide, payload, prospect, scope) {
  const categoryLabel = prospect.userCategoryEm === "work" ? "Professional" : "Personal";
  const indexText = `${ categoryLabel } ideas & prospects`;
  const parentText = `${ categoryLabel } projects and goals`;
  const parent = guideSectionRange(guide.content, parentText);
  if (!parent) throw new Error(`${ parentText } heading is missing; reload before saving`);
  const monthLabel = prospectFocusMonthLabel(prospect, scope);
  const monthHeading = prospectMonthHeadingText(monthLabel, prospect.summary, prospect.uuid);
  const subtree = prospectMonthSubtreeMarkdown(monthLabel, destinationLabel, payload, prospect.uuid, prospect.summary);
  const parentBody = guide.content.slice(parent.bodyStart, parent.end);
  assertSupportedSectionBody(parentBody);
  const nextBody = insertProspectMonthSubtree(indexText, monthHeading, parentBody, subtree);
  await replaceGuideSection(app, nextBody, guide.noteHandle, { heading: { level: parent.level, text: parent.text } });
}

// ----------------------------------------------------------------------------------------------
// @desc Write one task-bucket leaf so this UUID is present only when the bucket is the current placement.
// @param {object} app - Host app.
// @param {string} bucketLabel - Awaiting approval, Scheduled, Completed, or Rejected.
// @param {string|null} destinationLabel - Bucket that should hold this ActionProspect.
// @param {object} guide - Current note snapshot with content and noteHandle.
// @param {string} kind - workProspects or personalProspects.
// @param {object} prospect - Stored ActionProspect.
// @returns {Promise<object>} Guide snapshot with refreshed note content.
async function persistProspectBucketLeaf(app, bucketLabel, destinationLabel, guide, kind, prospect) {
  const headingText = prospectTaskBucketHeadingText(bucketLabel, prospect.uuid);
  const range = guideSectionRange(guide.content, headingText);
  if (!range) throw new Error(`${ headingText } section is missing; reload before saving`);
  const body = guide.content.slice(range.bodyStart, range.end);
  assertSupportedSectionBody(body);
  const previous = parseJsonPayload(body).payload;
  const prospects = bucketLabel === destinationLabel ? [copyJsonValue(prospect)] : [];
  const payload = validatedSectionPayload(kind, { prospectTasks: [], prospects }, { quarterKey: prospect.quarterKey });
  if (samePlanningData(previous, payload)) return guide;
  await replaceGuideSection(app, replaceJsonPayload(body, payload), guide.noteHandle,
    { heading: { level: range.level, text: range.text } });
  const savedContent = checkedAppResult(await app.getNoteContent(guide.noteHandle));
  const savedRange = guideSectionRange(savedContent, headingText);
  const savedPayload = parseJsonPayload(savedContent.slice(savedRange.bodyStart, savedRange.end)).payload;
  if (!samePlanningData(savedPayload, payload)) throw new Error("Vision Guide save verification failed; reload before retrying");
  return { ...guide, content: savedContent };
}

// ----------------------------------------------------------------------------------------------
// @desc Persist this ActionProspect into its current placement bucket and empty the siblings, creating the
//   month/project tree when a placement bucket is needed and it does not yet exist.
// @param {object} app - Host app.
// @param {object} prospect - Stored ActionProspect.
// @param {object} scope - Resolved planning scope.
// @returns {Promise<object>} Verified guide snapshot.
async function persistProspectPlacementSections(app, prospect, scope) {
  let guide = await findVisionGuide(app, scope);
  if (!guide?.metadata) throw new Error("Vision Guide is missing; save the project before placing it");
  guide.content = checkedAppResult(await app.getNoteContent(guide.noteHandle));
  const destinationLabel = prospectPlacementBucketLabel(prospect);
  const bucketsExist = PROSPECT_TASK_BUCKET_LABELS.some(bucketLabel =>
    guideSectionRange(guide.content, prospectTaskBucketHeadingText(bucketLabel, prospect.uuid)));
  if (!destinationLabel && !bucketsExist) return await readVisionGuide(app, scope);
  const kind = prospect.userCategoryEm === "work" ? "workProspects" : "personalProspects";
  const occupiedPayload = validatedSectionPayload(kind, { prospectTasks: [],
    prospects: destinationLabel ? [copyJsonValue(prospect)] : [] }, { quarterKey: prospect.quarterKey });
  if (!bucketsExist) {
    await ensureProspectMonthSection(app, destinationLabel, guide, occupiedPayload, prospect, scope);
    guide.content = checkedAppResult(await app.getNoteContent(guide.noteHandle));
  }
  for (const bucketLabel of PROSPECT_TASK_BUCKET_LABELS) {
    guide = await persistProspectBucketLeaf(app, bucketLabel, destinationLabel, guide, kind, prospect);
  }
  return await readVisionGuide(app, scope);
}
