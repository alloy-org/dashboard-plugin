// Verify dictionary refinement and its scheduling: a rewrite is accepted only when it cites the passages shown and the
// evidence supports it; the refinement job commits a plugin-owned definition, records how it ended, and never sends the
// same evidence twice; a definition the user adopts while the provider answers is left as the user has it; a failed
// request is retried or waits for a provider; and a visit collects evidence for at most two plugin-owned terms, those
// never collected first, then those whose tasks changed, then those past the cooldown.
import { jest } from "@jest/globals";
import { createCollectTermEvidenceHandler } from "dashboard/work-queue/jobs/collect-term-evidence";
import { termEvidenceRequest } from "dashboard/work-queue/jobs/project-job-requests";
import { createRefineDictionaryTermHandler } from "dashboard/work-queue/jobs/refine-dictionary-term";
import { EVIDENCE_OUTCOMES } from "plan-wizard/stack-rank/dictionary-term-evidence";
import { storedTermEvidence } from "plan-wizard/stack-rank/dictionary-term-evidence-store";
import { acceptedTermRefinement, REFINEMENT_OUTCOMES } from "plan-wizard/stack-rank/dictionary-term-refinement";
import { dueTermEvidence, dueTermEvidenceRequests, termMentions, termProgressRows,
  TERMS_PER_VISIT } from "plan-wizard/stack-rank/dictionary-term-schedule";
import { dictionaryEntriesFromContent } from "plan-wizard/stack-rank/user-terms-dictionary";
import { jobContext, notebookApp, NOW } from "./project-maintenance-test-app";

const YEAR = 2026;
const DICTIONARY_NAME = "User terms dictionary 2026";
const DICTIONARY_CONTENT = "# Terms\n- **Widget**: A card. [builder]\n- **Gadget**: A tool the user named.\n";
const REFINED_DEFINITION = "A resizable card on the Dashboard, shipped in the widget grid.";
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc A notebook holding the dictionary and one planning note that names Widget in two passages.
// @returns {object} App mock from notebookApp.
function dictionaryNotebook() {
  return notebookApp([
    { content: DICTIONARY_CONTENT, name: DICTIONARY_NAME, tags: ["plugins/dashboard"] },
    { content: "The widget grid ships Friday.\n\nEach widget is a resizable card on the Dashboard.", name: "Planning" },
  ]);
}

// ----------------------------------------------------------------------------------------------
// @desc A queued job for a handler and request, as the runner passes it.
// @param {object} handler - The handler.
// @param {object} request - From termEvidenceRequest or termRefinementRequest.
// @returns {object} The job.
function queuedJob(handler, request) {
  return { attempt: 1, category: "maintenance", cursor: null, desiredRevision: request.desiredRevision, entityId: request.entityId,
    input: request.input, key: request.key, scopeKey: "work-domain:Q3 2026", type: handler.type };
}

// ----------------------------------------------------------------------------------------------
// @desc Collect Widget's evidence and return the refinement job its collection asked for.
// @param {object} app - From dictionaryNotebook.
// @param {object} refineHandler - The refinement handler the job is built for.
// @returns {Promise<object>} The refinement job.
async function collectedRefinementJob(app, refineHandler) {
  const collectHandler = createCollectTermEvidenceHandler();
  const collected = await collectHandler.run({ context: jobContext(app),
    job: queuedJob(collectHandler, termEvidenceRequest({ term: "Widget", year: YEAR })), signal: null });
  return queuedJob(refineHandler, collected.followUps[0]);
}

// ----------------------------------------------------------------------------------------------
// @desc A provider answer.
// @param {object} [fields] - Fields replacing the supported rewrite's.
// @returns {object} The parsed response.
function providerAnswer(fields = {}) {
  return { decision: "refine", definition: REFINED_DEFINITION, evidenceQuality: "strong", sourceNumbers: [1, 2], uncertainty: "",
    ...fields };
}

describe("dictionary term refinement", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Only a supported rewrite that cites a passage it was shown and says something new is accepted.
  it("accepts a cited, supported rewrite and keeps the definition otherwise", () => {
    const passages = [{ noteUuid: "planning", text: "The widget grid ships Friday." }];
    const context = { definition: "A card.", passages };
    const accepted = acceptedTermRefinement(providerAnswer({ sourceNumbers: [1] }), context);
    expect(accepted).toMatchObject({ citedNoteUuids: ["planning"], definition: REFINED_DEFINITION, outcome: REFINEMENT_OUTCOMES.refined });
    expect(acceptedTermRefinement(providerAnswer({ evidenceQuality: "weak", sourceNumbers: [1] }), context))
      .toMatchObject({ definition: null, keptReason: "The evidence was graded weak", outcome: REFINEMENT_OUTCOMES.kept });
    expect(acceptedTermRefinement(providerAnswer({ sourceNumbers: [4] }), context).keptReason).toBe("The rewrite cited no passage it was shown");
    expect(acceptedTermRefinement(providerAnswer({ definition: "a  CARD.", sourceNumbers: [1] }), { ...context,
      definition: "a card." }).outcome).toBe(REFINEMENT_OUTCOMES.kept);
    expect(acceptedTermRefinement(providerAnswer({ decision: "keep" }), context).keptReason).toBe("The provider kept the definition");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A refinement rewrites the plugin-owned bullet, records how it ended, and gives up the passages, so neither
  //   the same job nor a later collection of the same notes sends the evidence again.
  it("refines a plugin-owned definition once per evidence", async () => {
    const app = dictionaryNotebook();
    const promptRunner = jest.fn().mockResolvedValue(providerAnswer());
    const handler = createRefineDictionaryTermHandler({ promptRunner });
    const job = await collectedRefinementJob(app, handler);
    const result = await handler.run({ context: jobContext(app), job, signal: null });
    expect(result).toEqual({ evidenceQuality: "strong", outcome: REFINEMENT_OUTCOMES.refined, revision: job.desiredRevision, term: "Widget" });
    expect(promptRunner.mock.calls[0][1]).toContain("[2] From the note \"Planning\":\nEach widget is a resizable card on the Dashboard.");
    expect(app.noteContent(DICTIONARY_NAME)).toContain(`- **Widget**: ${ REFINED_DEFINITION } [builder]\n- **Gadget**: A tool the user named.`);
    const stored = (await storedTermEvidence(app, { year: YEAR })).widget;
    expect(stored).toMatchObject({ passages: [], passagesConsumed: true, refinement: { evidenceQuality: "strong",
      outcome: REFINEMENT_OUTCOMES.refined, refinedAt: NOW.toISOString(), sourceDigest: job.desiredRevision } });
    expect(await handler.appliedRevision({ context: jobContext(app), job })).toBe(job.desiredRevision);
    expect(await handler.run({ context: jobContext(app), job, signal: null })).toEqual({ status: "superseded" });

    const collectHandler = createCollectTermEvidenceHandler();
    const recollected = await collectHandler.run({ context: jobContext(app),
      job: queuedJob(collectHandler, termEvidenceRequest({ term: "Widget", year: YEAR })), signal: null });
    expect(recollected.followUps).toEqual([]);
    expect((await storedTermEvidence(app, { year: YEAR })).widget.refinement.outcome).toBe(REFINEMENT_OUTCOMES.refined);
    expect(promptRunner).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A user removing `[builder]` while the provider answers keeps their definition, and weak evidence keeps it too.
  it("leaves a definition the user adopts mid-request, and keeps one the evidence does not support", async () => {
    const app = dictionaryNotebook();
    const adoptingRunner = jest.fn(async () => {
      await app.replaceNoteContent({ uuid: "seed-1" }, DICTIONARY_CONTENT.replace(" [builder]", ""));
      return providerAnswer();
    });
    const handler = createRefineDictionaryTermHandler({ promptRunner: adoptingRunner });
    const job = await collectedRefinementJob(app, handler);
    expect(await handler.run({ context: jobContext(app), job, signal: null })).toMatchObject({ outcome: "userOwned" });
    expect(app.noteContent(DICTIONARY_NAME)).toBe(DICTIONARY_CONTENT.replace(" [builder]", ""));

    const weakApp = dictionaryNotebook();
    const weakHandler = createRefineDictionaryTermHandler({ promptRunner: async () => providerAnswer({ evidenceQuality: "conflicting" }) });
    const weakJob = await collectedRefinementJob(weakApp, weakHandler);
    expect(await weakHandler.run({ context: jobContext(weakApp), job: weakJob, signal: null })).toMatchObject({ outcome: "kept" });
    expect(weakApp.noteContent(DICTIONARY_NAME)).toBe(DICTIONARY_CONTENT);
    const kept = (await storedTermEvidence(weakApp, { year: YEAR })).widget.refinement;
    expect(kept).toMatchObject({ evidenceQuality: "conflicting", keptReason: "The evidence was graded conflicting", refinedAt: null });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A failed request fails the attempt for a retry, or waits for configuration when no provider exists.
  it("fails a request the provider could not answer", async () => {
    const app = dictionaryNotebook();
    const promptRunner = async () => { throw new Error("timed out"); };
    const handler = createRefineDictionaryTermHandler({ promptRunner, providerAvailable: async () => true });
    const job = await collectedRefinementJob(app, handler);
    await expect(handler.run({ context: jobContext(app), job, signal: null })).rejects.toThrow("Refining \"Widget\" failed: timed out");
    const unconfigured = createRefineDictionaryTermHandler({ promptRunner, providerAvailable: async () => false });
    await expect(unconfigured.run({ context: jobContext(app), job, signal: null })).rejects.toMatchObject({ workFailure: "configuration" });
    expect((await storedTermEvidence(app, { year: YEAR })).widget.refinement).toBeUndefined();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A visit takes plugin-owned terms never collected first, then those whose tasks changed, then those past the
  //   cooldown, the most mentioned first within each; a user-written term or current evidence is never taken.
  it("schedules at most two plugin-owned terms, most due first", async () => {
    const dictionaryEntries = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"].map(term => ({ definition: "Defined.",
      isBuilderOwned: term !== "Delta", term }));
    const tasks = [{ content: "Ship Beta", uuid: "t1" }, { content: "Gamma review", uuid: "t2" }, { content: "Gamma again", uuid: "t3" },
      { completedAt: 1, content: "Alpha done", uuid: "t4" }];
    const daysAgo = days => new Date(NOW.getTime() - days * DAY_MILLISECONDS).toISOString();
    const evidenceByTermKey = { beta: { collectedAt: daysAgo(2), mentionDigest: "stale000" },
      epsilon: { collectedAt: daysAgo(1), mentionDigest: termMentions([], "Epsilon").mentionDigest },
      gamma: { collectedAt: daysAgo(8), mentionDigest: termMentions(["Gamma review", "Gamma again"], "Gamma").mentionDigest } };
    const due = dueTermEvidence({ dictionaryEntries, evidenceByTermKey, now: NOW, tasks });
    expect(due.map(dueTerm => [dueTerm.term, dueTerm.reason])).toEqual([["Alpha", "neverCollected"], ["Beta", "mentionsChanged"]]);
    expect(due).toHaveLength(TERMS_PER_VISIT);
    const later = dueTermEvidence({ dictionaryEntries, evidenceByTermKey: { ...evidenceByTermKey, alpha: { collectedAt: daysAgo(0) },
      beta: { collectedAt: daysAgo(0) } }, now: NOW, tasks });
    expect(later.map(dueTerm => [dueTerm.term, dueTerm.reason, dueTerm.mentionCount])).toEqual([["Gamma", "cooldownElapsed", 2]]);

    const app = dictionaryNotebook();
    const requests = await dueTermEvidenceRequests(app, { now: NOW, tasks: [{ content: "Resize the widget", uuid: "t5" }] });
    expect(requests).toEqual([termEvidenceRequest({ term: "Widget", year: YEAR }, { mentionDigest: termMentions(["Resize the widget"],
      "Widget").mentionDigest, requestedAt: NOW.getTime() })]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The inspector's rows say what each term's evidence found, including nothing, and what happens next.
  it("describes each term's progress, including empty outcomes", () => {
    const dictionaryEntries = dictionaryEntriesFromContent(DICTIONARY_CONTENT);
    const rows = termProgressRows({ dictionaryEntries, evidenceByTermKey: { widget: { collectedAt: NOW.toISOString(),
      outcome: EVIDENCE_OUTCOMES.noMatchingNotes, passages: [], sources: [] } }, now: NOW });
    expect(rows.map(row => [row.term, row.evidenceOutcome, row.nextStep])).toEqual([
      ["Widget", "noMatchingNotes", "No note matched; evidence rechecked in 7 d, or sooner when its tasks change"],
      ["Gadget", null, "User-written; never refined"],
    ]);
  });
});
