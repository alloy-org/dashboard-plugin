// Decide which dictionary terms a Dashboard visit looks into, and describe each term's progress for the Queue inspector.
// Only plugin-owned (`[builder]`) definitions are candidates, since a definition the user wrote is never rewritten. A
// term is due its evidence collection when it was never collected, when the open tasks naming it changed since its last
// collection (new evidence in the notebook, rechecked at most daily), or when its last collection is older than the
// seven-day cooldown. At most TERMS_PER_VISIT are taken per visit, never-collected first, then those whose tasks
// changed, then those cooling down longest, the most mentioned first within each. Collection is a few note reads with no
// provider call; a refinement follows only when a collection's evidence differs from what the term was last refined
// from, so a definition is sent to a provider again only on new evidence.
import { termEvidenceRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { termPattern } from "plan-wizard/stack-rank/dictionary-term-discovery";
import { EVIDENCE_OUTCOMES } from "plan-wizard/stack-rank/dictionary-term-evidence";
import { storedTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence-store";
import { dictionaryEntriesFromContent, readUserTermsDictionary } from "plan-wizard/stack-rank/user-terms-dictionary";
import { textDigest } from "util/text-digest";

// The most terms one visit collects evidence for.
export const TERMS_PER_VISIT = 2;
// How long a term's evidence counts as current when nothing naming it has changed.
export const TERM_EVIDENCE_COOLDOWN_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;
// The shortest interval between two collections for a term whose tasks changed.
export const MENTION_RECHECK_MILLISECONDS = 24 * 60 * 60 * 1000;
// Why a term is due, in the order due terms are taken.
export const TERM_DUE_REASONS = Object.freeze(["neverCollected", "mentionsChanged", "cooldownElapsed"]);

// ----------------------------------------------------------------------------------------------
// @desc Read the dictionary and its evidence, and build the collection requests a visit submits.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { now, tasks }: tasks are the domain's tasks as read.
// @returns {Promise<Array<object>>} Requests for DurableWorkRunner#submitAll; none when the year has no dictionary.
// @throws When the dictionary or the evidence note cannot be read.
export async function dueTermEvidenceRequests(app, { now, tasks }) {
  const year = now.getFullYear();
  const content = await readUserTermsDictionary(app, year);
  if (content === null) return [];
  const evidenceByTermKey = await storedTermEvidence(app, { year });
  const dueTerms = dueTermEvidence({ dictionaryEntries: dictionaryEntriesFromContent(content), evidenceByTermKey, now, tasks });
  const requests = dueTerms.map(dueTerm => termEvidenceRequest({ term: dueTerm.term, year },
    { mentionDigest: dueTerm.mentionDigest, requestedAt: now.getTime() }));
  return requests;
}

// ----------------------------------------------------------------------------------------------
// @desc Pick the terms due their evidence collection this visit.
// @param {object} options - An object with the following properties:
//   - {Array<object>} dictionaryEntries - From dictionaryEntriesFromContent
//   - {object} evidenceByTermKey - From storedTermEvidence
//   - {Date} now - Current time
//   - {Array<object>} tasks - The domain's tasks as read
// @returns {Array<object>} Up to TERMS_PER_VISIT { mentionCount, mentionDigest, reason, term }, most due first.
export function dueTermEvidence({ dictionaryEntries, evidenceByTermKey, now, tasks }) {
  const openTaskTexts = _openTaskTexts(tasks);
  const candidates = [];
  for (const entry of dictionaryEntries.filter(candidate => candidate.isBuilderOwned)) {
    const record = evidenceByTermKey[entry.term.toLowerCase()];
    const { mentionCount, mentionDigest } = termMentions(openTaskTexts, entry.term);
    const reason = _dueReason(record, { mentionDigest, now });
    if (reason) candidates.push({ collectedAt: _time(record?.collectedAt), mentionCount, mentionDigest, reason, term: entry.term });
  }
  candidates.sort((first, second) => TERM_DUE_REASONS.indexOf(first.reason) - TERM_DUE_REASONS.indexOf(second.reason)
    || second.mentionCount - first.mentionCount || first.collectedAt - second.collectedAt);
  const selected = candidates.slice(0, TERMS_PER_VISIT);
  const dueTerms = selected.map(({ mentionCount, mentionDigest, reason, term }) => ({ mentionCount, mentionDigest, reason, term }));
  return dueTerms;
}

// ----------------------------------------------------------------------------------------------
// @desc Read what the Queue inspector shows for each term: the dictionary and the evidence note, read without writing.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { now }.
// @returns {Promise<Array<object>>} Rows from termProgressRows; empty when the year has no dictionary.
// @throws When the dictionary or the evidence note cannot be read.
export async function readTermProgress(app, { now }) {
  const year = now.getFullYear();
  const content = await readUserTermsDictionary(app, year);
  if (content === null) return [];
  const evidenceByTermKey = await storedTermEvidence(app, { year });
  return termProgressRows({ dictionaryEntries: dictionaryEntriesFromContent(content), evidenceByTermKey, now });
}

// ----------------------------------------------------------------------------------------------
// @desc Count and digest the open tasks naming a term. The digest changes whenever a task naming the term is added,
//   reworded, completed, or removed, which is how new evidence lifts the cooldown.
// @param {Array<string>} openTaskTexts - Open task texts.
// @param {string} term - The term.
// @returns {object} { mentionCount, mentionDigest }: mentionDigest digests the sorted texts.
export function termMentions(openTaskTexts, term) {
  const pattern = termPattern(term);
  const mentioningTexts = openTaskTexts.filter(text => pattern.test(text));
  const sortedTexts = [...mentioningTexts].sort();
  return { mentionCount: mentioningTexts.length, mentionDigest: textDigest(sortedTexts.join("\n")) };
}

// ----------------------------------------------------------------------------------------------
// @desc Describe each term's evidence and refinement for the Queue inspector, including outcomes that found nothing.
// @param {object} options - { dictionaryEntries, evidenceByTermKey, now }.
// @returns {Array<object>} { collectedAt, evidenceOutcome, evidenceQuality, isBuilderOwned, keptReason, nextStep,
//   passageCount, refinedAt, refinementAttemptedAt, refinementOutcome, sourceCount, term, uncertainty }, in note order.
export function termProgressRows({ dictionaryEntries, evidenceByTermKey, now }) {
  const rows = dictionaryEntries.map(entry => {
    const record = evidenceByTermKey[entry.term.toLowerCase()] || null;
    const refinement = record?.refinement || null;
    return { collectedAt: record?.collectedAt || null, evidenceOutcome: record?.outcome || null,
      evidenceQuality: refinement?.evidenceQuality || null, isBuilderOwned: entry.isBuilderOwned, keptReason: refinement?.keptReason || null,
      nextStep: _nextStep(entry, record, now), passageCount: record?.passages?.length || 0, refinedAt: refinement?.refinedAt || null,
      refinementAttemptedAt: refinement?.attemptedAt || null, refinementOutcome: refinement?.outcome || null,
      sourceCount: record?.sources?.length || 0, term: entry.term, uncertainty: refinement?.uncertainty || null };
  });
  return rows;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a term's saved evidence should be sent to refinement: it found passages that are still kept, and the
//   term was never refined from evidence with this source digest.
// @param {object|null|undefined} record - The term's evidence record.
// @returns {boolean} True when a refinement is due.
export function termRefinementDue(record) {
  if (record?.outcome !== EVIDENCE_OUTCOMES.found || !record.passages?.length || !record.sourceDigest) return false;
  return record.refinement?.sourceDigest !== record.sourceDigest;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Why a term is due its collection, if it is.
// @param {object|undefined} record - The term's evidence record.
// @param {object} options - { mentionDigest, now }.
// @returns {string|null} One of TERM_DUE_REASONS, or null when its evidence is current.
function _dueReason(record, { mentionDigest, now }) {
  if (!record) return "neverCollected";
  const age = now.getTime() - _time(record.collectedAt);
  if (age >= MENTION_RECHECK_MILLISECONDS && record.mentionDigest && record.mentionDigest !== mentionDigest) return "mentionsChanged";
  if (age >= TERM_EVIDENCE_COOLDOWN_MILLISECONDS) return "cooldownElapsed";
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc What happens next for a term, as an operator reads it.
// @param {object} entry - The dictionary entry.
// @param {object|null} record - Its evidence record.
// @param {Date} now - Current time.
// @returns {string} A short description.
function _nextStep(entry, record, now) {
  if (!entry.isBuilderOwned) return "User-written; never refined";
  if (!record) return "Evidence not yet collected";
  if (termRefinementDue(record)) return "Refinement due";
  const nextCollectionAt = _time(record.collectedAt) + TERM_EVIDENCE_COOLDOWN_MILLISECONDS;
  const days = Math.max(0, Math.ceil((nextCollectionAt - now.getTime()) / (24 * 60 * 60 * 1000)));
  const recheck = days ? `evidence rechecked in ${ days } d, or sooner when its tasks change` : "evidence recheck due";
  if (record.outcome === EVIDENCE_OUTCOMES.noMatchingNotes) return `No note matched; ${ recheck }`;
  if (record.outcome === EVIDENCE_OUTCOMES.noPassages) return `Notes matched but none used the term; ${ recheck }`;
  return `Current; ${ recheck }`;
}

// ----------------------------------------------------------------------------------------------
// @desc The texts of the open tasks.
// @param {Array<object>} tasks - Tasks as read.
// @returns {Array<string>} Their texts.
function _openTaskTexts(tasks) {
  const openTasks = (tasks || []).filter(task => task?.content && !task.completedAt && !task.dismissedAt);
  const texts = openTasks.map(task => task.content);
  return texts;
}

// ----------------------------------------------------------------------------------------------
// @desc Read an ISO time as epoch milliseconds.
// @param {string|null|undefined} time - ISO time.
// @returns {number} Epoch milliseconds, 0 when missing or unreadable.
function _time(time) {
  const milliseconds = time ? Date.parse(time) : NaN;
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}
