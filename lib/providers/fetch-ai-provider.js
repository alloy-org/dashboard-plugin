import { apiKeyFromApp, preferredModels, providerEndpointUrl, providerFromModel } from "providers/ai-provider-settings"
import { amplenoteLlmPrompt } from "providers/amplenote-llm"
import { extractJsonFromString, responseFromStreamOrChunk } from "providers/fetch-json"
import { STREAMING_PROVIDERS, streamedResponseText } from "providers/stream-response-text"
import { logIfEnabled } from "util/log"

const TIMEOUT_SECONDS = 30;
const LOG_CONTENT_TRUNCATE_LENGTH = 50;

// --------------------------------------------------------------------------
// @desc Send a prompt to the configured LLM provider and return text or parsed JSON.
// @param {Object} app - Amplenote app (alerts; API key is resolved from settings when apiKey is omitted)
// @param {Object|null} plugin - Kept so existing callers can pass the plugin; this path does not read it.
// @param {string} prompt - User message body
// @param {string|null|undefined} aiModel - Model id override; when omitted, preferredModels order applies
// @param {string|null|undefined} apiKey - API key override; when omitted, apiKeyFromApp is used
// @param {boolean|undefined} jsonResponse - When truthy, use JSON-oriented handling and parse string bodies
// @param {number|null|undefined} timeoutSeconds - Request timeout; omitted or falsy uses makeRequest default
// @param {string|null|undefined} reasoningEffort - OpenAI reasoning budget ("low", "medium", "high"). A caller on a
//   fixed latency budget passes "low" so a reasoning model spends its time answering rather than deliberating past
//   the deadline; ignored by every provider that is not OpenAI
// @param {Function|null|undefined} onPartialText - When given and the provider can stream, the response is streamed
//   and this receives the answer text accumulated so far as it arrives; the return value is still the whole answer.
//   A provider that cannot stream answers in one piece and never calls it
// [Composer] Task: discrete parameters instead of bundled options for llmPrompt
// [GPT-5.6 Terra] Task: report an absent LLM provider before resolving a provider model
export async function llmPrompt(app, plugin, prompt, aiModel, apiKey, jsonResponse, timeoutSeconds, reasoningEffort,
    onPartialText) {
  let modelCandidates = preferredModels();
  if (aiModel) {
    modelCandidates = modelCandidates.filter(m => m !== aiModel);
    modelCandidates.unshift(aiModel)
  }

  const modelToUse = modelCandidates.shift();
  // A disabled or absent provider leaves no candidate model. This is a valid user configuration,
  // not a provider lookup failure, so report the setting the user can act on before calling
  // providerFromModel(undefined).
  if (!modelToUse) {
    throw new Error("No AI provider is configured. Choose a provider in Dashboard Settings.");
  }
  // [Claude claude-opus-4.7] Task: log model resolution so an empty modelCandidates path is visible
  // Prompt: "add adequate debugging to understand why all of these failed"
  logIfEnabled('[llmPrompt] model resolution', { aiModelOverride: aiModel, modelToUse: modelToUse ?? null,
    remainingCandidateCount: modelCandidates.length, apiKeyOverridePresent: !!apiKey });
  const messages = [{ role: "user", content: prompt }];
  const requestOptions = timeoutSeconds ? { timeoutSeconds } : {};
  if (apiKey) requestOptions.apiKey = apiKey;
  if (reasoningEffort) requestOptions.reasoningEffort = reasoningEffort;
  const providerEm = providerFromModel(modelToUse);
  const streamsResponse = typeof onPartialText === "function" && STREAMING_PROVIDERS.includes(providerEm);
  if (streamsResponse) requestOptions.stream = true;
  const requestStartedAt = Date.now();
  const fetchResponse = await makeRequest(app, messages, modelToUse, requestOptions);

  if (streamsResponse) {
    // The caller's timeout covers the whole request, so the read gets whatever the fetch left of it.
    const elapsedSeconds = (Date.now() - requestStartedAt) / 1000;
    const remainingSeconds = Math.max((timeoutSeconds || TIMEOUT_SECONDS) - elapsedSeconds, 1);
    const streamedText = await streamedResponseText(fetchResponse, providerEm, { onPartialText, timeoutSeconds: remainingSeconds });
    return jsonResponse ? extractJsonFromString(streamedText) : streamedText;
  }

  const promptKey = jsonResponse ? "llmPromptJson" : null;
  // The caller's timeout governs the whole request, not only the fetch: without passing requestOptions through,
  // reading the response body falls back to its own 30s default and a caller asking for longer never gets it.
  const response = await responseFromStreamOrChunk(app, fetchResponse, modelToUse, promptKey, null, null,
    timeoutSeconds ? { timeoutSeconds } : {});

  if (response && jsonResponse) {
    return typeof response === 'string' ? extractJsonFromString(response) : response;
  } else {
    return response;
  }
}

// --------------------------------------------------------------------------
// @desc Send a prompt through app.callLLM on the account's plugin LLM license; when that produces nothing, send it to
//   the user's own configured provider with llmPrompt.
// @param {Object} app - Amplenote app exposing callLLM, plus settings / API key resolution for the fallback
// @param {string} prompt - Prompt string, sent as the single user message
// @param {Object} params - Named parameters
// @param {boolean|undefined} params.jsonResponse - When truthy, parse the reply as JSON; same for the fallback
// @param {string|null|undefined} params.aiModel - Model override for both legs; callLLM uses its default for a model
//   it cannot serve
// @param {string|null|undefined} params.apiKey - API key override for the fallback (settings key still used when omitted)
// @param {string|undefined} params.source - Call site name callLLM attributes usage to
// @param {number|null|undefined} params.timeoutSeconds - Timeout for each leg's request
// @returns {Promise<*>} The callLLM reply or the fallback provider's reply. Throws when callLLM produced nothing and
//   the user has no provider of their own, or when the fallback provider fails.
export async function llmPromptWithAmplenoteFallback(app, prompt, { jsonResponse, aiModel, apiKey, source, timeoutSeconds } = {}) {
  logIfEnabled("[llmPrompt] starting", { promptLength: prompt?.length ?? 0, jsonResponse: !!jsonResponse, aiModelOverride: aiModel ?? null, apiKeyOverridePresent: !!apiKey });
  const amplenoteResult = await amplenoteLlmPrompt(app, prompt, { aiModel, jsonResponse, source, timeoutSeconds });
  if (amplenoteResult !== null && typeof amplenoteResult !== "undefined") return amplenoteResult;
  // With no provider of the user's own to fall back to, the failure the user can act on is callLLM's, not a missing
  // provider setting: a subscriber should be told to try again, not to configure a provider they do not need.
  if (!aiModel && preferredModels().length === 0) {
    throw new Error("Amplenote's AI didn't return a response. Please try again in a moment.");
  }
  const llmStart = performance.now();
  const llmResult = await llmPrompt(app, null, prompt, aiModel, apiKey, jsonResponse, timeoutSeconds);

  logIfEnabled('[llmPromptWithAmplenoteFallback] llmPrompt fallback complete', { durationMs: Number((performance.now() - llmStart).toFixed(1)), resultType: llmResult === null ? 'null' : typeof llmResult, hasTasksField: !!(llmResult && typeof llmResult === 'object' && 'tasks' in llmResult), });
  return llmResult;
}

// --------------------------------------------------------------------------
// Private functions
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// @desc Clone request bodies for logging, truncating string values on `content` fields without
//   changing the request payload passed to fetch.
// @param {*} value - Request body value, object, array, or scalar.
// @returns {*} Log-safe clone with long `content` strings capped at 50 characters.
function _bodyWithTruncatedContentForLog(value) {
  if (Array.isArray(value)) return value.map(item => _bodyWithTruncatedContentForLog(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => {
    if (key === "content" && typeof entryValue === "string" && entryValue.length > LOG_CONTENT_TRUNCATE_LENGTH) {
      return [key, `${ entryValue.slice(0, LOG_CONTENT_TRUNCATE_LENGTH - 3) }...`];
    }
    return [key, _bodyWithTruncatedContentForLog(entryValue)];
  }));
}

// --------------------------------------------------------------------------
// Returns the appropriate headers for each AI provider
function headersForProvider(providerEm, apiKey) {
  const baseHeaders = { "Content-Type": "application/json" };

  switch (providerEm) {
    case "anthropic":
      return {
        ...baseHeaders,
        "x-api-key": apiKey,
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-version": "2023-06-01"
      };
    case "gemini":
      // Gemini uses API key in URL, but still needs content-type header
      return baseHeaders;
    default:
      // OpenAI, DeepSeek, Grok, Perplexity all use Bearer token
      return {
        ...baseHeaders,
        "Authorization": `Bearer ${ apiKey }`
      };
  }
}

// --------------------------------------------------------------------------
// Builds the request body with provider-specific formatting
// @param {Array} messages - Array of message objects with role and content
// @param {string} model - Model name
// @param {boolean} stream - Whether to stream the response
// @param {Array|null} tools - Optional tools/functions for the model
// @param {string} promptKey - Key identifying the prompt type for frequency penalty calculation
// @param {string|null} reasoningEffort - OpenAI reasoning budget ("low", "medium", "high"); only the OpenAI branch
//   carries it, because every other provider here rejects an unknown body field outright
// @returns {{ model: string, messages: Array, stream: boolean, max_tokens?: number, system?: string,
//   tools?: Array, frequency_penalty?: number, reasoning_effort?: string }}
function requestBodyForProvider(messages, model, stream, tools, { promptKey = null, reasoningEffort = null } = {}) {
  let body;
  const providerEm = providerFromModel(model);

  switch (providerEm) {
    case "anthropic": { // https://docs.anthropic.com/en/api/messages
      // Anthropic requires system message as top-level parameter, not in messages array
      const systemMessage = messages.find(m => m.role === "system");
      const nonSystemMessages = messages.filter(m => m.role !== "system");
      body = {
        "max_tokens": 4096, // WBH confirmed Q4 2025 Anthropic requires explicit max_tokens. TBD if this is the best value
        model,
        messages: nonSystemMessages,
      };
      if (stream) {
        body.stream = stream;
      }
      if (systemMessage) {
        body.system = systemMessage.content;
      }
      // Anthropic doesn't have a JSON mode; JSON formatting is handled via prompt instructions
      break;
    }
    case "gemini": { // https://ai.google.dev/gemini-api/docs/text-generation
      // Gemini uses a completely different format: contents[] with parts[], and systemInstruction
      const systemMsg = messages.find(m => m.role === "system");
      const nonSystemMsgs = messages.filter(m => m.role !== "system");
      body = {
        contents: nonSystemMsgs.map(m => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        }))
      };
      if (systemMsg) {
        body.systemInstruction = { parts: [{ text: systemMsg.content }] };
      }
      // Gemini uses generationConfig.responseMimeType for JSON output
      body.generationConfig = { responseMimeType: "application/json" };
      break;
    }
    case "grok": // https://docs.x.ai/api/endpoints#chat-completions
    case "perplexity": // https://docs.perplexity.ai/api-reference/chat-completions
      // These providers don't support frequency_penalty or response_format
      body = { model, messages };
      if (stream) body.stream = stream;
      if (tools) body.tools = tools;
      break;
    case "deepseek": { // https://api-docs.deepseek.com/api/create-chat-completion
      body = { model, messages };
      if (stream) body.stream = stream;
      if (tools) body.tools = tools;
      // DeepSeek supports response_format like OpenAI
      body.response_format = { type: "json_object" };
      break;
    }
    case "openai": // https://platform.openai.com/docs/api-reference/chat/create
    default: {
      body = { model, messages };
      if (stream) body.stream = stream;
      if (tools) body.tools = tools;
      body.response_format = { type: "json_object" };
      // Only a genuine OpenAI model takes this: the default branch also catches models whose provider did not
      // match any case above, and sending them an unrecognized field would fail the request outright.
      if (reasoningEffort && providerEm === "openai") body.reasoning_effort = reasoningEffort;
      break;
    }
  }

  return body;
}

// --------------------------------------------------------------------------
// Make a single request attempt to the AI provider
//
// @param {string} apiKey - API key for the provider
// @param {number} attemptNumber - The attempt number (0-indexed)
// @param {Array} messages - Array of message objects
// @param {string} model - Model name
// @param {string} promptKey - Key identifying the prompt type
// @param {boolean} stream - Whether streaming is enabled
// @param {number} timeoutSeconds - Request timeout in seconds
// @param {Array|null} tools - Optional tools/functions for the model
// @returns {Promise<Response>} The fetch response
async function makeRequest(app, messages, model, { apiKey = null, attemptNumber = 1, promptKey = null,
    reasoningEffort = null, stream = null, timeoutSeconds = TIMEOUT_SECONDS, tools = null } = {}) {
  const providerEm = providerFromModel(model);
  if (attemptNumber > 0) logIfEnabled(`Attempt #${ attemptNumber }: Trying ${ model } with ${ promptKey || "no promptKey" }`);

  if (!apiKey) apiKey = apiKeyFromApp(app, providerEm);
  const body = requestBodyForProvider(messages, model, stream, tools, { promptKey, reasoningEffort });
  const endpoint = providerEndpointUrl(model, apiKey);
  logIfEnabled(`Calling ${ providerEm } at ${ endpoint } with body ${ JSON.stringify(_bodyWithTruncatedContentForLog(body)) } at ${ new Date() }`);
  const headers = headersForProvider(providerEm, apiKey);

  // Use Promise.race to implement request timeout: the fetch and a timeout promise race,
  // and if the timeout resolves first, the request is rejected with a timeout error
  const fetchResponse = await Promise.race([
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutSeconds * 1000)
    )
  ]);

  if (!fetchResponse.ok) {
    const err = new Error(`Request failed with status ${ fetchResponse.status }`);
    err.response = fetchResponse;
    throw err;
  }

  return fetchResponse;
}
