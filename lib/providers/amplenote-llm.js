// Ask Amplenote's own model APIs, app.callLLM and app.callDecisionModel, which run on the account's plugin LLM license
// and need no key the user configured. Both methods are always present; an account without a license, or without
// quota left, is told so by the call throwing. The host plugin calls them directly, and the dashboard embed reaches
// them through the onEmbedCall bridge, which resolves a thrown call to an { embedCallFailed } envelope instead of
// rejecting. Every helper here reads a throw and that envelope alike, so a caller sees the same answer from either
// side of the bridge.
//
// Whether the license can answer at all is asked once per app interface with checkQuota, which costs nothing and
// throws when the account has no license or no quota. Only a positive answer is remembered: a later miss on a license
// that answered is a transient failure, not a lapsed subscription, and must not show the upsell to a subscriber.
//
// When the user has saved a key for the provider that serves the requested model, a prompt passes it as userApiKey,
// so callLLM answers on that key directly, including for an account that has no plugin LLM license. callLLM sends a
// userApiKey straight to the provider, bypassing the license entirely, so a prompt whose key fails is asked again on
// the license when the account holds one.
import { AMPLENOTE_LLM_DEFAULT_MODEL, AMPLENOTE_LLM_MODEL_PREFIXES, AMPLENOTE_LLM_REASONING_EFFORTS } from "constants/llm-providers"
import { apiKeyFromProvider } from "constants/settings"
import { pluginSettings } from "plugin-data"
import { keyFailureStatus, recordApiKeyFailure, recordApiKeySuccess } from "providers/api-key-health"
import { extractJsonFromString } from "providers/fetch-json"
import { JEV_DIRECT_MODEL } from "providers/jev-client"
import { logIfEnabled } from "util/log"

const AMPLENOTE_LLM_DEFAULT_TIMEOUT_SECONDS = 60;
const AMPLENOTE_DECISION_TIMEOUT_MILLISECONDS = 30000;
const DEFAULT_SOURCE = "dashboard";
// The provider whose saved key callLLM can use for a model, by model-name prefix. Models from other prefixes have no
// key setting, so they are answered on the plugin LLM license alone.
const KEYED_PROVIDER_BY_MODEL_PREFIX = { "claude-": "anthropic", "gemini-": "gemini", "gpt-": "openai", "grok-": "grok" };
const LOG_LABEL = "[amplenote-llm]";
const RESULT_SNIPPET_LENGTH = 300;

// App interfaces whose plugin LLM license has answered, by quota check or by a completed call.
const appsWithAvailableLlm = new WeakSet();
// The quota check in flight for each app interface, shared so widgets and services that ask at once make one check.
const llmAvailabilityChecksByApp = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc Run one prompt through app.callLLM and return its reply, parsed as JSON when asked. When the user saved a key
//   for the provider that serves the model, it is sent as userApiKey, so the call needs no plugin LLM license; when a
//   call on that key fails for any reason but a timeout and the account holds a license, the prompt is asked once more
//   on the license. A saved key that is out of credit or rate limited would otherwise fail every call a subscriber
//   makes, because callLLM sends a userApiKey straight to the provider and never reaches the license.
//
//   By default a null return is the only failure signal: a missing license, exhausted quota, a timeout, and a provider
//   error all resolve null, so a caller can fall back to the user's own provider without handling a rejection.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} prompt - Sent as the single user message.
// @param {object} [options] - An object with the following properties:
//   - {string|null} [aiModel] - Model to ask; a model callLLM cannot serve, or none, asks AMPLENOTE_LLM_DEFAULT_MODEL
//   - {string|null} [instructions] - System instructions for the model
//   - {boolean} [jsonResponse] - Parse the reply's text as JSON before returning it
//   - {boolean} [preferLicense=false] - Ask on the plugin LLM license without the saved key whenever the account holds
//     a license, for a caller already sending the same prompt to the user's provider on that key
//   - {string|null} [reasoningEffort] - Thinking budget; anything below "low" asks for "low"
//   - {boolean} [rejectWithReason=false] - Reject with the failure's reason instead of resolving null, for a caller
//     that reports why nothing answered. An account with neither a license nor a saved key still resolves null, since
//     it had nothing to offer rather than a failure to report
//   - {string} [source="dashboard"] - Call site name the license attributes usage to
//   - {number|null} [timeoutSeconds=60] - How long callLLM waits for the model
// @returns {Promise<*|null>} The reply's text or parsed JSON, or null when nothing usable came back.
// @throws {Error} Only with rejectWithReason, naming why the key and the license each failed.
export async function amplenoteLlmPrompt(app, prompt, { aiModel, instructions, jsonResponse, preferLicense = false, reasoningEffort,
    rejectWithReason = false, source = DEFAULT_SOURCE, timeoutSeconds } = {}) {
  const model = amplenoteLlmModel(aiModel);
  const requestOptions = { input: [{ content: prompt, role: "user" }], model, source,
    timeoutMs: (timeoutSeconds || AMPLENOTE_LLM_DEFAULT_TIMEOUT_SECONDS) * 1000 };
  const requestedEffort = _amplenoteReasoningEffort(reasoningEffort);
  if (requestedEffort) requestOptions.reasoningEffort = requestedEffort;
  if (instructions) requestOptions.instructions = instructions;
  const savedApiKey = _userApiKeyForModel(app, model);
  const askLicenseFirst = !!savedApiKey && preferLicense && await isAmplenoteLlmAvailable(app);
  const firstApiKey = askLicenseFirst ? null : savedApiKey;
  const firstAttempt = await _callLlmOnce(app, requestOptions, firstApiKey);
  if (firstApiKey) _recordKeyAttempt(app, model, firstApiKey, firstAttempt);
  if (firstAttempt.text !== null) return _parsedReply(firstAttempt.text, jsonResponse);

  const failureReasons = [_labelledFailureReason(firstApiKey, firstAttempt.failureReason)];
  const shouldRetryOnLicense = !!firstApiKey && !_isTimeoutReason(firstAttempt.failureReason) && await isAmplenoteLlmAvailable(app);
  if (shouldRetryOnLicense) {
    const licenseAttempt = await _callLlmOnce(app, requestOptions, null);
    if (licenseAttempt.text !== null) return _parsedReply(licenseAttempt.text, jsonResponse);
    failureReasons.push(_labelledFailureReason(null, licenseAttempt.failureReason));
  }
  if (!rejectWithReason) return null;
  // Without a key, a failed call on an account that holds no license is callLLM declining for want of one: there was
  // nothing to ask, which a caller reports differently from a request that was made and failed.
  const hadNothingToAsk = !firstApiKey && !shouldRetryOnLicense && !(await isAmplenoteLlmAvailable(app));
  if (hadNothingToAsk) return null;
  throw new Error(failureReasons.join("; "));
}

// ----------------------------------------------------------------------------------------------
// @desc A DecisionsEndpoint request function that asks app.callDecisionModel. Its answers are returned keyed by
//   question name in the shape requestJevAnswers returns, so the endpoint reads every route alike. A failed call or a
//   reply without answers throws, so the endpoint records the batch as failed and asks its next route.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {object} [options] - An object with the following properties:
//   - {string} [source="task-rating"] - Call site name the license attributes usage to
// @returns {function} async ({ questions, state }) => { answers, model, usage }.
export function amplenoteDecisionRequester(app, { source = "task-rating" } = {}) {
  return async ({ questions, state }) => {
    const decisionQuestions = _decisionModelQuestions(questions);
    const response = await app.callDecisionModel({ model: JEV_DIRECT_MODEL, questions: decisionQuestions, source, state,
      timeoutMs: AMPLENOTE_DECISION_TIMEOUT_MILLISECONDS });
    const failureReason = _bridgeFailureReason(response);
    if (failureReason) throw new Error(`Decision model request failed: ${ failureReason }`);
    if (!response?.answers || typeof response.answers !== "object") {
      logIfEnabled(`${ LOG_LABEL } callDecisionModel carried no answers`, { response: _responseShapeForLog(response), source });
      throw new Error("Decision model response carried no answers");
    }
    appsWithAvailableLlm.add(app);
    const answers = _jevAnswersFromDecisionModelAnswers(response.answers);
    return { answers, model: response.resolvedModel ?? JEV_DIRECT_MODEL, usage: response.usage ?? null };
  };
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether the account's plugin LLM license can answer, by asking callLLM for the quota remaining. A
//   license that has answered before is reported available without asking again, and concurrent callers share one
//   check. No license, no quota left, and a check that fails all count as unavailable.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @returns {Promise<boolean>} True when callLLM and callDecisionModel can be asked.
export async function isAmplenoteLlmAvailable(app) {
  if (!app) return false;
  if (appsWithAvailableLlm.has(app)) return true;
  if (!llmAvailabilityChecksByApp.has(app)) {
    const availabilityCheck = _checkAmplenoteLlmQuota(app).finally(() => llmAvailabilityChecksByApp.delete(app));
    llmAvailabilityChecksByApp.set(app, availabilityCheck);
  }
  return llmAvailabilityChecksByApp.get(app);
}

// ----------------------------------------------------------------------------------------------
// @desc The model callLLM is asked for. A model whose name callLLM routes to a provider is kept, so a user who chose a
//   provider in Dashboard Settings is still answered by it; anything else, including no model, gets the default.
// @param {string|null|undefined} aiModel - The model a caller would like.
// @returns {string} A model name callLLM accepts.
export function amplenoteLlmModel(aiModel) {
  const requestedModel = typeof aiModel === "string" ? aiModel.trim() : "";
  const isSupported = AMPLENOTE_LLM_MODEL_PREFIXES.some(prefix => requestedModel.startsWith(prefix));
  return isSupported ? requestedModel : AMPLENOTE_LLM_DEFAULT_MODEL;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Make one callLLM request, with the user's key or on the license, and read its reply's text. A reply on the
//   license marks the app interface's license available; a reply on the user's key proves nothing about the license,
//   so it is not remembered as one.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {object} requestOptions - The callLLM options, without userApiKey.
// @param {string|null} userApiKey - The saved key to send, or null to ask on the plugin LLM license.
// @returns {Promise<object>} { failureReason, failureStatus, text }: the reply's non-empty text with a null
//   failureReason, or a null text with the reason the call produced none. failureStatus is the HTTP status that
//   reason reports when it implicates the key (keyFailureStatus), and null otherwise.
async function _callLlmOnce(app, requestOptions, userApiKey) {
  const attemptOptions = userApiKey ? { ...requestOptions, userApiKey } : requestOptions;
  const logContext = { model: requestOptions.model, source: requestOptions.source, userApiKeySent: !!userApiKey };
  const requestStart = performance.now();
  try {
    const response = await app.callLLM(attemptOptions);
    const durationMs = Number((performance.now() - requestStart).toFixed(1));
    const bridgeFailureReason = _bridgeFailureReason(response);
    if (bridgeFailureReason || typeof response?.textOutput !== "string" || !response.textOutput.trim()) {
      logIfEnabled(`${ LOG_LABEL } callLLM produced no text`, { ...logContext, durationMs, failureReason: bridgeFailureReason, response: _responseShapeForLog(response) });
      return { failureReason: bridgeFailureReason || "empty reply", failureStatus: keyFailureStatus(bridgeFailureReason), text: null };
    }
    if (!userApiKey) appsWithAvailableLlm.add(app);
    logIfEnabled(`${ LOG_LABEL } callLLM answered`, { ...logContext, callCost: response.callCost ?? null, durationMs, resultSnippet: response.textOutput.substring(0, RESULT_SNIPPET_LENGTH) });
    return { failureReason: null, failureStatus: null, text: response.textOutput };
  } catch (error) {
    logIfEnabled(`${ LOG_LABEL } callLLM threw`, { ...logContext, durationMs: Number((performance.now() - requestStart).toFixed(1)), errorMessage: error?.message, status: error?.status ?? null });
    return { failureReason: error?.message || String(error), failureStatus: keyFailureStatus(error), text: null };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The reply as its caller asked for it: the text itself, or the JSON parsed from it.
// @param {string} text - The reply's text.
// @param {boolean} jsonResponse - Parse the text as JSON.
// @returns {*} The text, or its parsed JSON (null when none could be parsed).
function _parsedReply(text, jsonResponse) {
  return jsonResponse ? extractJsonFromString(text) : text;
}

// ----------------------------------------------------------------------------------------------
// @desc Add an attempt on the user's saved key to that key's history, which retires a key that keeps failing once the
//   plugin LLM license can answer in its place. The failure is recorded unawaited, so the license check it may make
//   does not delay the retry on the license.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} model - The model the attempt asked for, which names the key's provider.
// @param {string} userApiKey - The saved key the attempt sent.
// @param {object} attempt - { failureStatus, text }, as _callLlmOnce returns it.
function _recordKeyAttempt(app, model, userApiKey, attempt) {
  const modelPrefix = Object.keys(KEYED_PROVIDER_BY_MODEL_PREFIX).find(prefix => model.startsWith(prefix));
  const providerEm = KEYED_PROVIDER_BY_MODEL_PREFIX[modelPrefix];
  if (!providerEm) return;
  if (attempt.text !== null) {
    recordApiKeySuccess(app, { apiKey: userApiKey, providerEm });
  } else if (attempt.failureStatus) {
    const hasLicense = () => isAmplenoteLlmAvailable(app);
    recordApiKeyFailure(app, { apiKey: userApiKey, hasLicense, providerEm, status: attempt.failureStatus }).catch(error =>
      logIfEnabled(`${ LOG_LABEL } recording key failure failed`, { errorMessage: error?.message, providerEm }));
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Name which credential a failed attempt used, so a reported reason says whether the user's key or the license
//   failed. The two fail for different reasons and call for different fixes from the user.
// @param {string|null} userApiKey - The key the attempt sent, or null for the license.
// @param {string} failureReason - Why the attempt produced no text.
// @returns {string} The reason, prefixed with the credential it came from.
function _labelledFailureReason(userApiKey, failureReason) {
  return `${ userApiKey ? "your saved API key" : "plugin LLM license" }: ${ failureReason }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a failure was a timeout, which a retry on the license would only repeat at the cost of the caller's
//   whole time budget a second time.
// @param {string|null} failureReason - Why an attempt produced no text.
// @returns {boolean} True when the reason reports a timeout.
function _isTimeoutReason(failureReason) {
  return /timed out|timeout/i.test(failureReason || "");
}

// ----------------------------------------------------------------------------------------------
// @desc Ask callLLM for the quota remaining once, remembering a positive answer for the app interface.
// @param {object} app - Amplenote app interface exposing callLLM.
// @returns {Promise<boolean>} True when the check returned a positive dollar amount.
async function _checkAmplenoteLlmQuota(app) {
  try {
    const remainingQuota = await app.callLLM({ checkQuota: true });
    const failureReason = _bridgeFailureReason(remainingQuota);
    const isAvailable = !failureReason && Number.isFinite(remainingQuota) && remainingQuota > 0;
    logIfEnabled(`${ LOG_LABEL } quota check`, { failureReason, isAvailable, remainingQuota: failureReason ? null : remainingQuota });
    if (isAvailable) appsWithAvailableLlm.add(app);
    return isAvailable;
  } catch (error) {
    logIfEnabled(`${ LOG_LABEL } quota check threw`, error?.message || error);
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The key the user saved for the provider that serves a model. The embed reads the settings snapshot it was
//   started with; the host plugin, where that snapshot is empty, reads app.settings.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} model - A model name callLLM accepts.
// @returns {string|null} The trimmed key, or null when the model's provider has no key setting or none is saved.
function _userApiKeyForModel(app, model) {
  const modelPrefix = Object.keys(KEYED_PROVIDER_BY_MODEL_PREFIX).find(prefix => model.startsWith(prefix));
  const settingKey = modelPrefix ? apiKeyFromProvider(KEYED_PROVIDER_BY_MODEL_PREFIX[modelPrefix]) : null;
  if (!settingKey) return null;
  const embedSettings = pluginSettings();
  const hostSettings = app?.settings && typeof app.settings === "object" ? app.settings : {};
  const savedKey = embedSettings?.[settingKey] ?? hostSettings[settingKey];
  return typeof savedKey === "string" && savedKey.trim() ? savedKey.trim() : null;
}

// ----------------------------------------------------------------------------------------------
// @desc The reason a bridge call failed, read from the envelope onEmbedCall resolves in place of a rejection.
// @param {*} response - What the call resolved with.
// @returns {string|null} The failure's message, "no response" when the call resolved nothing, or null on success.
function _bridgeFailureReason(response) {
  if (response === null || typeof response === "undefined") return "no response";
  if (response?.embedCallFailed) return response.error || "embed call failed";
  return null;
}

// ----------------------------------------------------------------------------------------------
// @desc Describe a response that could not be read, so the debug console shows what the host actually returned.
// @param {*} response - What callLLM or callDecisionModel resolved with.
// @returns {object} { keys, snippet, type }: the object's keys, if any, and the start of its JSON or string form.
function _responseShapeForLog(response) {
  const keys = response && typeof response === "object" ? Object.keys(response) : null;
  let serialized;
  try {
    serialized = typeof response === "string" ? response : JSON.stringify(response);
  } catch (error) {
    serialized = `unserializable: ${ error?.message }`;
  }
  const snippet = typeof serialized === "string" ? serialized.substring(0, RESULT_SNIPPET_LENGTH) : String(serialized);
  return { keys, snippet, type: Array.isArray(response) ? "array" : typeof response };
}

// ----------------------------------------------------------------------------------------------
// @desc Map the endpoint's questions onto the types callDecisionModel accepts. Jev's "predicate" is callDecisionModel's
//   "noul"; score and choice questions pass through unchanged.
// @param {object} questions - Questions keyed by name, each { criteria, instructions, type }.
// @returns {object} The same questions keyed by name, with predicate questions asked as "noul".
function _decisionModelQuestions(questions) {
  const questionEntries = Object.entries(questions || {});
  const mappedEntries = questionEntries.map(([questionName, question]) => {
    return [questionName, question?.type === "predicate" ? { ...question, type: "noul" } : question];
  });
  return Object.fromEntries(mappedEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc Read callDecisionModel's answers in the shape Jev returns them. A "noul" answer becomes a predicate carrying
//   its probability; score and choice answers already match and pass through.
// @param {object} answers - Answers keyed by question name, as callDecisionModel returns them.
// @returns {object} Answers keyed by question name, as DecisionsResponse reads them.
function _jevAnswersFromDecisionModelAnswers(answers) {
  const answerEntries = Object.entries(answers);
  const mappedEntries = answerEntries.map(([questionName, answer]) => {
    if (answer?.type !== "noul") return [questionName, answer];
    return [questionName, { probability: answer.noul, type: "predicate" }];
  });
  return Object.fromEntries(mappedEntries);
}

// ----------------------------------------------------------------------------------------------
// @desc The reasoning budget callLLM is asked for. A budget it does not offer, such as "none" or "minimal", asks for
//   "low", the least it has; no budget leaves callLLM's own default.
// @param {string|null|undefined} reasoningEffort - The caller's budget.
// @returns {string|null} "low", "medium", "high", or null.
function _amplenoteReasoningEffort(reasoningEffort) {
  if (!reasoningEffort) return null;
  return AMPLENOTE_LLM_REASONING_EFFORTS.includes(reasoningEffort) ? reasoningEffort : "low";
}
