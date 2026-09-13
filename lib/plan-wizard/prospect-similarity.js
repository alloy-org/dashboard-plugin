// Decide when two proposed projects are the same project, from the tasks they cite rather than from their wording.
//
// Discovery derived a project's identity by hashing its summary, so every rewording of one idea minted a permanent
// new record: one Vision Guide leaf accumulated forty-nine unjudged projects that were really six, among them eight
// spellings of "Launch and monetize Diff Digest". Wording is the least stable thing a provider returns; the task
// identities it cites are drawn from a fixed evidence bundle and are the same set whichever way the summary is
// phrased. Measured against those forty-nine records, Jaccard overlap of the cited task sets separated them into
// exactly the six real projects, with the closest unrelated pair at 0.32 and thresholds of 0.4 and 0.5 producing
// an identical grouping — a band wide enough to sit a threshold in.
//
// Nothing here calls a provider or touches the app interface: grouping is deterministic and free, and only the
// naming of a merged project needs a model.

// Overlap at or above which two proposals are treated as the same project. The observed separation band runs from
// 0.32 (closest unrelated pair) to 0.40, so this sits at the bottom of the gap rather than in the middle of the
// evidence: a threshold tuned to the midpoint would ride on this one sample.
export const PROSPECT_DUPLICATE_OVERLAP = 0.4;

// ----------------------------------------------------------------------------------------------
// @desc Collect the task identities one project cites, preferring its structured evidence and falling back to the
//   derived relatedTasks list for a record stored before evidence was retained.
// @param {object} prospect - ActionProspect record or draft.
// @returns {Set<string>} Cited task identities.
export function citedTaskUuids(prospect) {
  const evidenceEntries = Array.isArray(prospect?.evidence) ? prospect.evidence : [];
  const evidenceTaskUuids = evidenceEntries.map(entry => entry?.taskUuid).filter(Boolean);
  if (evidenceTaskUuids.length) return new Set(evidenceTaskUuids);
  const relatedTasks = Array.isArray(prospect?.relatedTasks) ? prospect.relatedTasks : [];
  return new Set(relatedTasks.filter(Boolean));
}

// ----------------------------------------------------------------------------------------------
// @desc Measure how far two projects overlap in the tasks they claim to resolve, as the size of the shared set
//   over the size of the combined set.
// @param {object} first - ActionProspect record or draft.
// @param {object} second - ActionProspect record or draft.
// @returns {number} Overlap from 0 through 1; two projects citing nothing overlap not at all.
// A project citing one task of another's twenty is a different project, which is why this is a ratio over the
//   union rather than a count of shared citations.
export function prospectEvidenceOverlap(first, second) {
  const firstTasks = citedTaskUuids(first);
  const secondTasks = citedTaskUuids(second);
  if (!firstTasks.size || !secondTasks.size) return 0;
  const sharedTasks = [...firstTasks].filter(taskUuid => secondTasks.has(taskUuid));
  const combinedSize = firstTasks.size + secondTasks.size - sharedTasks.length;
  if (!combinedSize) return 0;
  return sharedTasks.length / combinedSize;
}

// ----------------------------------------------------------------------------------------------
// @desc Find the stored project a proposal is a restatement of, so a merge writes into the identity the user may
//   already have judged instead of adding another record beside it.
// @param {Array<object>} storedProspects - Projects already stored for this category.
// @param {object} candidate - Incoming proposal.
// @param {object} [options] - { overlapThreshold } to override the default duplicate bar.
// @returns {object|null} The best-overlapping stored project at or above the threshold, or null.
// The strongest match wins rather than the first, so a proposal sitting between two stored projects joins the one
//   it actually restates. A candidate carrying its own stored identity is matched on that identity first: an edit
//   to a project the user renamed must not be redirected by overlap into a neighbour.
export function matchingStoredProspect(storedProspects, candidate, { overlapThreshold = PROSPECT_DUPLICATE_OVERLAP } = {}) {
  const storedByUuid = storedProspects.find(prospect => prospect.uuid === candidate?.uuid);
  if (storedByUuid) return storedByUuid;
  const sameQuarterProspects = storedProspects.filter(prospect => prospect.quarterKey === candidate?.quarterKey);
  const scoredProspects = sameQuarterProspects.map(prospect => ({ overlap: prospectEvidenceOverlap(prospect, candidate), prospect }));
  const qualifyingProspects = scoredProspects.filter(scored => scored.overlap >= overlapThreshold);
  const rankedProspects = qualifyingProspects.sort((first, second) => second.overlap - first.overlap);
  return rankedProspects.length ? rankedProspects[0].prospect : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Group projects that describe the same undertaking, joining two projects into one group whenever their
//   overlap reaches the threshold and letting those joins chain.
// @param {Array<object>} prospects - Projects to group, normally one category's unjudged proposals.
// @param {object} [options] - { overlapThreshold } to override the default duplicate bar.
// @returns {Array<Array<object>>} Groups in input order, each holding one or more projects.
// Chaining is deliberate: eleven passes over one evidence bundle produce a continuum of restatements rather than
//   tidy islands, and requiring every pair in a group to clear the bar would split that continuum arbitrarily.
export function clusterProspectsByEvidence(prospects, { overlapThreshold = PROSPECT_DUPLICATE_OVERLAP } = {}) {
  const groupIndexByProspect = prospects.map((prospect, index) => index);
  const resolveGroupIndex = index => {
    let rootIndex = index;
    while (groupIndexByProspect[rootIndex] !== rootIndex) rootIndex = groupIndexByProspect[rootIndex];
    return rootIndex;
  };
  for (let first = 0; first < prospects.length; first += 1) {
    for (let second = first + 1; second < prospects.length; second += 1) {
      if (prospectEvidenceOverlap(prospects[first], prospects[second]) < overlapThreshold) continue;
      const firstRoot = resolveGroupIndex(first);
      const secondRoot = resolveGroupIndex(second);
      if (firstRoot !== secondRoot) groupIndexByProspect[secondRoot] = firstRoot;
    }
  }
  const prospectsByGroup = new Map();
  for (let index = 0; index < prospects.length; index += 1) {
    const rootIndex = resolveGroupIndex(index);
    if (!prospectsByGroup.has(rootIndex)) prospectsByGroup.set(rootIndex, []);
    prospectsByGroup.get(rootIndex).push(prospects[index]);
  }
  return [...prospectsByGroup.values()];
}
