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
// @param {object} llmOptions - Options from wizardLlmOptions: { aiModel, apiKey, jsonResponse, timeoutSeconds }.
// @returns {Promise<*|null>} The winning source's parsed result, or null when no source produced one.
export async function raceWizardPrompt(app, prompt, { aiModel, apiKey, jsonResponse, timeoutSeconds } = {}) {
  const raceStart = performance.now();
  const contenders = [];
  contenders.push(labelledAttempt("agent-pro", agentProPrompt(app, prompt, { aiModel, jsonResponse })));
  if (aiModel && apiKey) {
    const directResult = llmPrompt(app, null, prompt, aiModel, apiKey, jsonResponse, timeoutSeconds);
    contenders.push(labelledAttempt("direct-provider", directResult));
  }
  logIfEnabled(`${ RACE_LOG_LABEL } started`, { aiModel: aiModel ?? null, contenderCount: contenders.length,
    directProviderEntered: contenders.length > 1, timeoutSeconds: timeoutSeconds ?? null });
  const winner = await firstUsableResult(contenders);
  logIfEnabled(`${ RACE_LOG_LABEL } settled`, { durationMs: Number((performance.now() - raceStart).toFixed(1)),
    hasResult: winner.result !== null, source: winner.source });
  return winner.result;
}

// ----------------------------------------------------------------------------------------------
// @desc Await every contender until one produces a non-null result, then resolve with it and let the rest run to
//   completion unwatched. Promise.race cannot express this on its own: it settles on the first promise to settle,
//   which for a source that fails fast is a null that would discard a slower source's real answer.
// @param {Array<Promise<object>>} contenders - Labelled attempts, each resolving to { result, source }.
// @returns {Promise<object>} The first attempt with a non-null result, or { result: null, source: null }.
async function firstUsableResult(contenders) {
  const pending = new Set(contenders);
  while (pending.size) {
    const settled = await Promise.race(pending);
    pending.delete(settled.attempt);
    if (settled.result !== null && typeof settled.result !== "undefined") return settled;
  }
  return { result: null, source: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Wrap one source's promise so it names itself when it settles, carries its own identity for removal from the
//   pending set, and reports a failure as a null result rather than a rejection the race would settle on.
// @param {string} source - Short identifier for the source, used in the log and the returned record.
// @param {Promise<*>} attemptPromise - The source's in-flight request.
// @returns {Promise<object>} Resolves to { attempt, result, source }, where attempt is the returned promise itself.
function labelledAttempt(source, attemptPromise) {
  const attempt = attemptPromise.then(
    result => ({ attempt, result: typeof result === "undefined" ? null : result, source }),
    error => {
      logIfEnabled(`${ RACE_LOG_LABEL } ${ source } failed`, error?.message || String(error));
      return { attempt, result: null, source };
    }
  );
  return attempt;
}
