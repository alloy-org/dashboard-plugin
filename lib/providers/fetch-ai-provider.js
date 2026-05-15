import { AMPLE_AGENT_PRO_UUID, defaultProviderModel, preferredModels, providerFromModel, providerNameFromProviderEm, providerEndpointUrl, apiKeyFromApp } from "providers/ai-provider-settings"
import {
  extractJsonFromString,
  jsonResponseFromStreamChunk,
  responseFromStreamOrChunk,
  shouldStream,
  streamPrefaceString
} from "providers/fetch-json"
import { toolsValueFromPrompt } from "providers/openai-functions"
import { logIfEnabled } from "util/log"

const TIMEOUT_SECONDS = 30;
const LOG_CONTENT_TRUNCATE_LENGTH = 50;

// --------------------------------------------------------------------------
// `promptParams` is an object consisting of `noteContent` key and an optional `instructions` key
export async function callRemoteAI(plugin, app, model, messages, promptKey, allowResponse, modelsQueried = []) {
  // Determine provider from model
  const providerEm = providerFromModel(model);
  model = model?.trim()?.length ? model : defaultProviderModel(providerEm);

  const tools = toolsValueFromPrompt(promptKey)
  const streamCallback = shouldStream(plugin) ? streamAccumulate.bind(null, modelsQueried, promptKey) : null;
  try {
    return await requestWithRetry(app, model, messages, tools, promptKey, streamCallback, allowResponse,
      { timeoutSeconds: plugin.constants.requestTimeoutSeconds });
  } catch (error) {
    if (plugin.isTestEnvironment) {
      throw(error);
    } else {
      const providerName = providerNameFromProviderEm(providerEm);
      app.alert(`Failed to call ${ providerName }: ${ error }`);
    }
    return null;
  }
}

// --------------------------------------------------------------------------
// @desc Send a prompt to the configured LLM provider and return text or parsed JSON.
// @param {Object} app - Amplenote app (alerts; API key is resolved from settings when apiKey is omitted)
// @param {Object|null} plugin - Reserved / unused on this path (call shape matches callRemoteAI)
// @param {string} prompt - User message body
// @param {string|null|undefined} aiModel - Model id override; when omitted, preferredModels order applies
// @param {string|null|undefined} apiKey - API key override; when omitted, apiKeyFromApp is used
// @param {boolean|undefined} jsonResponse - When truthy, use JSON-oriented handling and parse string bodies
// @param {number|null|undefined} timeoutSeconds - Request timeout; omitted or falsy uses makeRequest default
// [Composer] Task: discrete parameters instead of bundled options for llmPrompt
export async function llmPrompt(app, plugin, prompt, aiModel, apiKey, jsonResponse, timeoutSeconds) {
  let modelCandidates = preferredModels();
  if (aiModel) {
    modelCandidates = modelCandidates.filter(m => m !== aiModel);
    modelCandidates.unshift(aiModel)
  }

  const modelToUse = modelCandidates.shift();
  // [Claude claude-opus-4.7] Task: log model resolution so an empty modelCandidates path is visible
  // Prompt: "add adequate debugging to understand why all of these failed"
  logIfEnabled('[llmPrompt] model resolution', { aiModelOverride: aiModel, modelToUse: modelToUse ?? null,
    remainingCandidateCount: modelCandidates.length, apiKeyOverridePresent: !!apiKey });
  const messages = [{ role: "user", content: prompt }];
  const requestOptions = timeoutSeconds ? { timeoutSeconds } : {};
  if (apiKey) requestOptions.apiKey = apiKey;
  const fetchResponse = await makeRequest(app, messages, modelToUse, requestOptions);

  const promptKey = jsonResponse ? "llmPromptJson" : null;
  const response = await responseFromStreamOrChunk(app, fetchResponse, modelToUse, promptKey, null, null);

  if (response && jsonResponse) {
    return typeof response === 'string' ? extractJsonFromString(response) : response;
  } else {
    return response;
  }
}

// --------------------------------------------------------------------------
// @desc Send prompt to Ample Agent Pro via callPlugin; on falsy or thrown error, call llmPrompt with the same LLM fields.
// @param {Object} app - Amplenote app with callPlugin and (for fallback) settings / API key resolution
// @param {string} prompt - Prompt string
// @param {Object} params - Named fallback parameters
// @param {boolean|undefined} params.jsonResponse - When truthy, parse string plugin results as JSON; same for LLM fallback
// @param {string|null|undefined} params.aiModel - Model override for LLM fallback
// @param {string|null|undefined} params.apiKey - API key override for LLM fallback (settings key still used when omitted)
// @param {number|null|undefined} params.timeoutSeconds - Timeout for LLM fallback request
// @returns {Promise<*>} Plugin result or LLM result
// [Composer] Task: discrete parameters instead of bundled options; LLM fallback always runs so keys can resolve from settings
export async function llmPromptWithPluginFallback(app, prompt, { jsonResponse, aiModel, apiKey, timeoutSeconds } = {}) {
  const pluginStart = performance.now();
  logIfEnabled("[llmPromptWithPluginFallback] starting", { promptLength: prompt?.length ?? 0,
    ampleAgentProUuid: AMPLE_AGENT_PRO_UUID, hasCallPlugin: typeof app?.callPlugin === "function",
    jsonResponse: !!jsonResponse, aiModelOverride: aiModel ?? null,
    apiKeyOverridePresent: !!apiKey });
  try {
    const pluginResult = await app.callPlugin({ uuid: AMPLE_AGENT_PRO_UUID }, prompt);
    const pluginDurationMs = Number((performance.now() - pluginStart).toFixed(1));
    if (pluginResult) {
      const responseSampleSize = 300;
      const resultSnippet = typeof pluginResult === "string"
        ? pluginResult.substring(0, responseSampleSize)
        : JSON.stringify(pluginResult).substring(0, responseSampleSize);
      logIfEnabled("[llmPromptWithPluginFallback] callPlugin raw result", { durationMs: pluginDurationMs, resultType: typeof pluginResult, resultLength: typeof pluginResult === "string" ? pluginResult.length : null, resultSnippet, });
      const parsed = jsonResponse && typeof pluginResult === "string"
        ? extractJsonFromString(pluginResult)
        : pluginResult;
      logIfEnabled("[llmPromptWithPluginFallback] callPlugin parsed result", { parsedType: parsed === null ? "null" : typeof parsed, hasTasksField: !!(parsed && typeof parsed === "object" && "tasks" in parsed), tasksLength: Array.isArray(parsed?.tasks) ? parsed.tasks.length : null, hasGoalsSummary: !!(parsed && typeof parsed === "object" && parsed.goalsSummary), });
      return parsed;
    }
    logIfEnabled("[llmPromptWithPluginFallback] callPlugin returned falsy — falling back to direct LLM", { durationMs: pluginDurationMs, pluginResultValue: pluginResult, pluginResultType: typeof pluginResult,
    });
  } catch (error) {
    logIfEnabled("[llmPromptWithPluginFallback] callPlugin threw — falling back to direct LLM", { durationMs: Number((performance.now() - pluginStart).toFixed(1)), errorMessage: error?.message, errorName: error?.name, });
  }
  const llmStart = performance.now();
  const llmResult = await llmPrompt(app, null, prompt, aiModel, apiKey, jsonResponse, timeoutSeconds);

  logIfEnabled('[llmPromptWithPluginFallback] llmPrompt fallback complete', { durationMs: Number((performance.now() - llmStart).toFixed(1)), resultType: llmResult === null ? 'null' : typeof llmResult, hasTasksField: !!(llmResult && typeof llmResult === 'object' && 'tasks' in llmResult), });
  return llmResult;
}

// --------------------------------------------------------------------------
// [Claude claude-opus-4-7] Task: detect mobile platform via userAgent so callPlugin can be skipped
// Prompt: "only call app.callPlugin when the platform is not mobile"
// @description Returns true when the current runtime appears to be a mobile device, including
//   iPadOS reporting a desktop UA. Mirrors the detection used in _apiKeyLinkPlatformHints.
// @returns {boolean}
export function isMobilePlatform() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  return navigator.maxTouchPoints > 1 && /Macintosh/.test(ua);
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
// @returns {{ model: string, messages: Array, stream: boolean, max_tokens?: number, system?: string,
//   tools?: Array, frequency_penalty?: number }}
function requestBodyForProvider(messages, model, stream, tools, { promptKey = null } = {}) {
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
    stream = null, timeoutSeconds = TIMEOUT_SECONDS, tools = null } = {}) {
  const providerEm = providerFromModel(model);
  if (attemptNumber > 0) logIfEnabled(`Attempt #${ attemptNumber }: Trying ${ model } with ${ promptKey || "no promptKey" }`);

  if (!apiKey) apiKey = apiKeyFromApp(app, providerEm);
  const body = requestBodyForProvider(messages, model, stream, tools, { promptKey });
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

// --------------------------------------------------------------------------
async function requestWithRetry(app, model, messages, tools, promptKey, streamCallback, allowResponse, {
    suppressParallel = false, retries = 3, timeoutSeconds = TIMEOUT_SECONDS } = {}) {
  let error, response;
  const providerEm = providerFromModel(model);
  const providerName = providerNameFromProviderEm(providerEm);

  const stream = !!streamCallback;

  if (suppressParallel) {
    // Sequential retries - only retry after previous attempt fails
    for (let i = 0; i < retries; i++) {
      try {
        response = await makeRequest(app, messages, model,
          { attemptNumber: i, promptKey, stream, timeoutSeconds, tools });
        break; // Success, exit loop
      } catch (e) {
        error = e;
        response = e.response;
        logIfEnabled(`Attempt ${ i + 1 } failed with`, e, `at ${ new Date() }. Retrying...`);
      }
    }
  } else {
    // Parallel retries - fire all requests at once, return first success
    const promises = Array.from({ length: retries }, (_, i) =>
      makeRequest(app, messages, model, { attemptNumber: i, promptKey, stream, timeoutSeconds, tools }).catch(e => {
        logIfEnabled(`Parallel attempt ${ i + 1 } failed with`, e, `at ${ new Date() }`);
        throw e;
      })
    );

    try {
      response = await Promise.any(promises);
    } catch (aggregateError) {
      // All promises rejected - use the first error for reporting
      error = aggregateError.errors?.[0] || aggregateError;
      response = error?.response;
    }
  }

  logIfEnabled("Response from promises is", response, "specifically response?.ok", response?.ok)
  if (response?.ok) {
    return await responseFromStreamOrChunk(app, response, model, promptKey, streamCallback, allowResponse, { timeoutSeconds });
  } else if (!response) {
    app.alert(`Failed to call ${ providerName }: ${ error }`);
    return null;
  } else if (response.status === 401) {
    app.alert(`Invalid ${ providerName } API key. Please configure your ${ providerName } key in plugin settings.`);
    return null;
  } else {
    const result = await response.json();
    logIfEnabled(`API error response from ${ providerName }:`, result);
    if (result && result.error) {
      const errorMessage = result.error.message || JSON.stringify(result.error);
      app.alert(`Failed to call ${ providerName }: ${ errorMessage }`);
      return null;
    }
  }
}

// --------------------------------------------------------------------------
/**
 * Parse Anthropic's SSE streaming format
 * @see https://docs.anthropic.com/en/api/messages-streaming
 * @param {string} decodedValue - Raw SSE data from stream
 * @param {Object} app - App object for displaying alerts
 * @param {string} receivedContent - Accumulated content so far
 * @param {string} aiModel - Model name
 * @param {Array} modelsQueriedArray - Array of models queried
 * @param {string} promptKey - Prompt key for stream preface
 * @returns {{stop: boolean, incrementalContents: Array<string>, receivedContent: string}}
 */
function parseAnthropicStream(decodedValue, app, receivedContent, aiModel, modelsQueriedArray, promptKey) {
  let stop = false;
  const incrementalContents = [];
  const lines = decodedValue.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('event:')) {
      const eventType = line.substring(6).trim();
      if (eventType === 'message_stop') {
        logIfEnabled("Received message_stop from Anthropic");
        stop = true;
        break;
      }
    } else if (line.startsWith('data:')) {
      try {
        const data = JSON.parse(line.substring(5).trim());
        // Content deltas come in content_block_delta events
        if (data.type === 'content_block_delta' && data.delta?.text) {
          const content = data.delta.text;
          incrementalContents.push(content);
          receivedContent += content;
          app.alert(receivedContent, {
            actions: [{ icon: "pending", label: "Generating response", }],
            preface: streamPrefaceString(aiModel, modelsQueriedArray, promptKey),
            scrollToEnd: true
          });
        }
      } catch (e) {
        // Ignore parse errors for SSE chunks
      }
    }
  }

  return { stop, incrementalContents, receivedContent };
}

// --------------------------------------------------------------------------
/**
 * Parse Gemini's SSE streaming format
 * @see https://ai.google.dev/gemini-api/docs/text-generation#generate-a-text-stream
 * @param {string} decodedValue - Raw SSE data from stream
 * @param {Object} app - App object for displaying alerts
 * @param {string} receivedContent - Accumulated content so far
 * @param {string} aiModel - Model name
 * @param {Array} modelsQueriedArray - Array of models queried
 * @param {string} promptKey - Prompt key for stream preface
 * @param {string|null} failedParseContent - Content that failed to parse from previous chunk
 * @returns {{stop: boolean, incrementalContents: Array<string>, receivedContent: string, failedParseContent: string|null}}
 */
function parseGeminiStream(decodedValue, app, receivedContent, aiModel, modelsQueriedArray, promptKey, failedParseContent) {
  let stop = false;
  const incrementalContents = [];
  const responses = decodedValue.split(/^data: /m).filter(s => s.trim().length);

  for (const jsonString of responses) {
    if (jsonString.includes("[DONE]")) {
      logIfEnabled("Received [DONE] from Gemini");
      stop = true;
      break;
    }

    let jsonResponse;
    ({ failedParseContent, jsonResponse } = jsonResponseFromStreamChunk(jsonString, failedParseContent));

    if (jsonResponse) {
      // Gemini uses candidates[0].content.parts[0].text
      const content = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;

      if (content) {
        incrementalContents.push(content);
        receivedContent += content;
        app.alert(receivedContent, {
          actions: [{ icon: "pending", label: "Generating response", }],
          preface: streamPrefaceString(aiModel, modelsQueriedArray, promptKey),
          scrollToEnd: true
        });
      } else if (jsonResponse.candidates?.[0]?.finishReason) {
        logIfEnabled("Finishing Gemini stream for reason", jsonResponse.candidates[0].finishReason);
        stop = true;
        break;
      }
    }
  }

  return { stop, incrementalContents, receivedContent, failedParseContent };
}

// --------------------------------------------------------------------------
/**
 * Parse OpenAI-compatible streaming format used by OpenAI, DeepSeek, Grok, and Perplexity
 * @see https://platform.openai.com/docs/api-reference/chat/streaming
 * @see https://api-docs.deepseek.com/api/create-chat-completion
 * @see https://docs.x.ai/api/endpoints#chat-completions
 * @see https://docs.perplexity.ai/api-reference/chat-completions
 * @param {string} decodedValue - Raw SSE data from stream
 * @param {Object} app - App object for displaying alerts
 * @param {string} receivedContent - Accumulated content so far
 * @param {string} aiModel - Model name
 * @param {Array} modelsQueriedArray - Array of models queried
 * @param {string} promptKey - Prompt key for stream preface
 * @param {string|null} failedParseContent - Content that failed to parse from previous chunk
 * @returns {{stop: boolean, incrementalContents: Array<string>, receivedContent: string, failedParseContent: string|null}}
 */
function parseOpenAICompatibleStream(decodedValue, app, receivedContent, aiModel, modelsQueriedArray, promptKey, failedParseContent) {
  let stop = false;
  const incrementalContents = [];
  const responses = decodedValue.split(/^data: /m).filter(s => s.trim().length);

  for (const jsonString of responses) {
    if (jsonString.includes("[DONE]")) {
      logIfEnabled("Received [DONE] from jsonString");
      stop = true;
      break;
    }

    let jsonResponse;
    ({ failedParseContent, jsonResponse } = jsonResponseFromStreamChunk(jsonString, failedParseContent));

    if (jsonResponse) {
      const content = jsonResponse.choices?.[0]?.delta?.content ||
        jsonResponse.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments;

      if (content) {
        incrementalContents.push(content);
        receivedContent += content;
        app.alert(receivedContent, {
          actions: [{ icon: "pending", label: "Generating response", }],
          preface: streamPrefaceString(aiModel, modelsQueriedArray, promptKey),
          scrollToEnd: true
        });
      } else {
        stop = !!jsonResponse?.finish_reason?.length || !!jsonResponse?.choices?.[0]?.finish_reason?.length;
        if (stop) {
          logIfEnabled("Finishing stream for reason", jsonResponse?.finish_reason || jsonResponse?.choices?.[0]?.finish_reason);
          break;
        }
      }
    }
  }

  return { stop, incrementalContents, receivedContent, failedParseContent };
}

// --------------------------------------------------------------------------
/**
 * Decode and accumulate streaming responses from AI providers
 * Handles provider-specific streaming formats via a switch statement
 * @param {Array} modelsQueriedArray - Array of models that have been queried
 * @param {string} promptKey - Key identifying the type of prompt
 * @param {Object} app - App object for displaying alerts to user
 * @param {string} decodedValue - Raw decoded data from the stream chunk
 * @param {string} receivedContent - Content accumulated so far from previous chunks
 * @param {string} aiModel - The AI model being used
 * @param {string|null} failedParseContent - Content from previous chunks that failed to parse
 * @returns {{abort: boolean, failedParseContent: string|null, incrementalContents: Array<string>, receivedContent: string}}
 */
function streamAccumulate(modelsQueriedArray, promptKey, app, decodedValue, receivedContent, aiModel, failedParseContent) {
  const providerEm = providerFromModel(aiModel);
  let result;

  switch (providerEm) {
    case "anthropic":
      result = parseAnthropicStream(decodedValue, app, receivedContent, aiModel, modelsQueriedArray, promptKey);
      break;

    case "gemini":
      result = parseGeminiStream(decodedValue, app, receivedContent, aiModel, modelsQueriedArray, promptKey, failedParseContent);
      break;

    case "deepseek":
    case "grok":
    case "openai":
    case "perplexity":
      result = parseOpenAICompatibleStream(decodedValue, app, receivedContent, aiModel, modelsQueriedArray, promptKey, failedParseContent);
      break;

    default:
      logIfEnabled(`Unknown provider for streaming: ${ providerEm }`);
      result = { stop: true, incrementalContents: [], receivedContent, failedParseContent };
  }

  return {
    abort: result.stop,
    failedParseContent: result.failedParseContent || null,
    incrementalContents: result.incrementalContents,
    receivedContent: result.receivedContent
  };
}
