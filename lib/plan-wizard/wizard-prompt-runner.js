// Run a wizard prompt against Ample Agent Pro and the user's own configured provider at the same time, and answer
// with whichever returns first. The sequential fallback the rest of the dashboard uses spends the plugin's entire
// latency before a direct provider is even attempted, which is how a sixty-second wizard budget was consumed by a
// callPlugin that never returned while a direct provider was answering the same prompt in twenty-three seconds.
//
// Racing is the right shape here specifically because the wizard is timeout-bound: both sources answer the same
// prompt, either answer is acceptable, and the only thing that distinguishes them is how long they take. A source
// that cannot run contributes nothing rather than losing the race for the other one, and a race with nothing left
// running resolves to null so the pass reports "no result" the way a single failed provider call already does.

import { agentProPrompt, llmPrompt } from "providers/fetch-ai-provider";
import { logIfEnabled } from "util/log";

const RACE_LOG_LABEL = "[wizard-prompt-race]";

// ----------------------------------------------------------------------------------------------
// @desc Submit a prompt to every source that can answer it and resolve with the first usable result. Agent Pro runs
//   on the user's own plugin credentials and needs no key; the direct provider leg only runs when wizardLlmOptions
//   resolved a model and the key that authenticates it, so a user with no configured provider races Agent Pro alone
//   rather than racing it against a request that cannot authenticate.
//
//   Neither leg is allowed to reject: a source that fails resolves to null and simply stops competing, because a
//   rejection from the faster-failing source would settle the race before the slower, working one returned.
// @param {object} app - Host-compatible Amplenote API.
// @param {string} prompt - The rendered prompt both sources receive.
// @param {object} llmOptions - Options from wizardLlmOptions: { aiModel, apiKey, jsonResponse, reasoningEffort,
//   timeoutSeconds }, plus an optional onPartialText. reasoningEffort and onPartialText reach only the direct
//   provider leg; Agent Pro runs the model on its own terms and answers in one piece, so a caller streaming partial
//   text may see it stop and be superseded by Agent Pro's whole answer.
// @returns {Promise<*|null>} The winning source's parsed result, carrying wizardPromptSource to name the leg that
//   answered, or null when no source produced one and none of them said why.
// @throws {Error} When every source that ran failed with a stated reason, naming those reasons. A caller records
//   this as its failureReason, which is what keeps "the provider timed out" from being reported to the user as
//   "the evidence supports no candidate" — two outcomes that are indistinguishable from a null result alone.
export async function raceWizardPrompt(app, prompt, { aiModel, apiKey, jsonResponse, onPartialText, reasoningEffort,
  timeoutSeconds } = {}) {
  const raceStart = performance.now();
  const contenders = [];
  contenders.push(labelledAttempt("agent-pro", agentProPrompt(app, prompt, { aiModel, jsonResponse })));
  if (aiModel && apiKey) {
    const directResult = llmPrompt(app, null, prompt, aiModel, apiKey, jsonResponse, timeoutSeconds, reasoningEffort,
      onPartialText);
    contenders.push(labelledAttempt("direct-provider", directResult));
  }
  logIfEnabled(`${ RACE_LOG_LABEL } started`, { aiModel: aiModel ?? null, contenderCount: contenders.length,
    directProviderEntered: contenders.length > 1, timeoutSeconds: timeoutSeconds ?? null });
  const winner = await firstUsableResult(contenders);
  const statedFailures = winner.failures ?? [];
  logIfEnabled(`${ RACE_LOG_LABEL } settled`, { durationMs: Number((performance.now() - raceStart).toFixed(1)),
    failureReasons: statedFailures.map(failure => `${ failure.source }: ${ failure.reason }`),
    hasResult: winner.result !== null, source: winner.source });
  // A source that simply had nothing to offer — Ample Agent Pro not being installed — states no reason and leaves
  // the null return intact. A source that tried and failed did state one, and the caller must hear it.
  if (winner.result === null && statedFailures.length) {
    const summarizedFailures = statedFailures.map(failure => `${ failure.source } (${ failure.reason })`);
    throw new Error(`No AI provider answered: ${ summarizedFailures.join(", ") }`);
  }
  if (!winner.result || typeof winner.result !== "object" || Array.isArray(winner.result)) {
    return winner.result;
  } else {
    return { ...winner.result, wizardPromptSource: winner.source };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Await every contender until one produces a non-null result, then resolve with it and let the rest run to
//   completion unwatched. Promise.race cannot express this on its own: it settles on the first promise to settle,
//   which for a source that fails fast is a null that would discard a slower source's real answer.
// @param {Array<Promise<object>>} contenders - Labelled attempts, each resolving to { failureReason, result, source }.
// @returns {Promise<object>} The first attempt with a non-null result, or { failures, result: null, source: null }
//   carrying every leg that stated why it could not answer.
async function firstUsableResult(contenders) {
  const pending = new Set(contenders);
  const failures = [];
  while (pending.size) {
    const settled = await Promise.race(pending);
    pending.delete(settled.attempt);
    if (settled.result !== null && typeof settled.result !== "undefined") return settled;
    if (settled.failureReason) failures.push({ reason: settled.failureReason, source: settled.source });
  }
  return { failures, result: null, source: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Wrap one source's promise so it names itself when it settles, carries its own identity for removal from the
//   pending set, and reports a failure as a null result rather than a rejection the race would settle on. The
//   rejection's message is kept as failureReason rather than discarded: a leg that timed out and a leg that was
//   never installed both contribute no result, and only the message distinguishes them for the notice the user sees.
// @param {string} source - Short identifier for the source, used in the log and the returned record.
// @param {Promise<*>} attemptPromise - The source's in-flight request.
// @returns {Promise<object>} Resolves to { attempt, failureReason, result, source }, where attempt is the returned
//   promise itself and failureReason is null unless the source rejected.
function labelledAttempt(source, attemptPromise) {
  const attempt = attemptPromise.then(
    result => ({ attempt, failureReason: null, result: typeof result === "undefined" ? null : result, source }),
    error => {
      const failureReason = error?.message || String(error);
      logIfEnabled(`${ RACE_LOG_LABEL } ${ source } failed`, failureReason);
      return { attempt, failureReason, result: null, source };
    }
  );
  return attempt;
}
