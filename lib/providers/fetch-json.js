import { providerFromModel } from "providers/ai-provider-settings"
import { MAX_SPACES_ABORT_RESPONSE } from "constants/settings"
import { jsonFromAiText } from "app-util"
import { logIfEnabled } from "util/log"

const streamTimeoutSeconds = 2;

// --------------------------------------------------------------------------
// Grab the piece of a string that is contiguous JSON with balanced brackets
export function extractJsonFromString(inputString) {
  let jsonText = inputString.trim();
  let jsonStart = jsonText.indexOf("{");
  if (jsonStart === -1) {
    jsonText = "{" + jsonText;
  }

  let responses;
  if (jsonText.split("}{").length > 1) {
    responses = jsonText.split("}{").map(text =>
      `${ text[0] === "{" ? "" : "{" }${ text }${ text[text.length - 1] === "}" ? "" : "}" }`);
    logIfEnabled("Received multiple responses from AI, evaluating each of", responses);
  } else {
    responses = [ jsonText ];
  }

  const jsonResponses = responses.map(jsonText => {
    return jsonFromAiText(jsonText);
  })

  const formedResponses = jsonResponses.filter(n => n);
  if (formedResponses.length) {
    if (formedResponses.length > 1) {
      const result = formedResponses[0];
      Object.entries(result).forEach(([ key, value ]) => {
        for (const altResponse of formedResponses.slice(1)) {
          const altValue = altResponse[key]
          if (altValue) {
            if (Array.isArray(altValue) && Array.isArray(value)) {
              result[key] = [...new Set([ ...value, ...altValue ])].filter(w => w);
            }
          }
        }
      });
      return result;
    } else {
      return formedResponses[0];
    }
  }

  return null;
}

// --------------------------------------------------------------------------
/**
 * Extracts the text content from a provider's JSON response.
 * @param {string} providerEm - Provider identifier (e.g., 'openai', 'anthropic', 'gemini')
 * @param {Object} jsonResponse - The parsed JSON response from the provider
 * @returns {string|null} The extracted text content, or null if not found
 */
function contentFromProviderResponse(providerEm, jsonResponse) {
  let content;

  switch (providerEm) {
    // https://docs.anthropic.com/en/api/messages
    // Response: { content: [{ type: "text", text: "..." }] }
    case "anthropic":
      content = jsonResponse?.content?.at(0)?.text;
      break;

    // https://ai.google.dev/gemini-api/docs/text-generation
    // Response: { candidates: [{ content: { parts: [{ text: "..." }] } }] }
    case "gemini":
      content = jsonResponse?.candidates?.at(0)?.content?.parts?.at(0)?.text;
      break;

    // https://github.com/ollama/ollama/blob/main/docs/api.md
    // Response: { message: { content: "..." } } or { response: "..." }
    case "ollama":
      content = jsonResponse?.message?.content || jsonResponse?.response;
      break;

    // OpenAI-compatible providers:
    // https://platform.openai.com/docs/api-reference/chat/create
    // https://api-docs.deepseek.com/api/create-chat-completion
    // https://docs.x.ai/api/endpoints#chat-completions
    // https://docs.perplexity.ai/api-reference/chat-completions
    // Response: { choices: [{ message: { content: "..." } }] }
    // Function calls: { choices: [{ message: { tool_calls: [{ function: { arguments: "..." } }] } }] }
    case "deepseek":
    case "grok":
    case "openai":
    case "perplexity":
    default:
      content = jsonResponse?.choices?.at(0)?.message?.content ||
        jsonResponse?.choices?.at(0)?.message?.tool_calls?.at(0)?.function?.arguments;
      break;
  }

  if (!content) {
    logIfEnabled(`Could not extract content from ${ providerEm } response:`, JSON.stringify(jsonResponse, null, 2));
  }

  return content || null;
}

// --------------------------------------------------------------------------
export async function responseFromStreamOrChunk(app, response, model, promptKey, streamCallback, allowResponse, { timeoutSeconds = 30 } = {}) {
  const providerEm = providerFromModel(model);

  let result;
  if (streamCallback) {
    result = await responseTextFromStreamResponse(app, response, model, true, streamCallback);
    // Remove the indicator that response is still generating. Leave it to caller to potentially remove this window.
    app.alert(result, { scrollToEnd: true });
  } else {
    try {
      await Promise.race([
        new Promise(async (resolve, _) => {
          const jsonResponse = await response.json();
          result = contentFromProviderResponse(providerEm, jsonResponse);
          resolve(result);
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${ providerEm } Timeout`)), timeoutSeconds * 1000)
        )
      ]);
    } catch(e) {
      logIfEnabled("Failed to parse response from", model, "error", e);
      throw e;
    }
  }

  const resultBeforeTransform = result;
  result = extractJsonFromString(result);

  if (!allowResponse || allowResponse(result)) {
    return result;
  }

  if (resultBeforeTransform) {
    logIfEnabled("Received", resultBeforeTransform, "but could not parse as a valid result");
  }

  return null;
}

// --------------------------------------------------------------------------
// Private
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
async function responseTextFromStreamResponse(app, response, aiModel, responseJsonExpected, streamCallback) {
  if (typeof(global) !== "undefined" && typeof(global.fetch) !== 'undefined') { // isomorphic-fetch from tests
    return await streamIsomorphicFetch(app, response, aiModel, responseJsonExpected, streamCallback);
  } else {
    return await streamWindowFetch(app, response, aiModel, responseJsonExpected, streamCallback);
  }
}

// --------------------------------------------------------------------------
async function streamIsomorphicFetch(app, response, aiModel, responseJsonExpected, callback) {
  const responseBody = response.body; // Assuming this is already a stream object
  let abort = false;
  let receivedContent = "";
  let failedParseContent, incrementalContents;

  // Wrap the stream reading in a promise to await its completion
  await new Promise((resolve, _reject) => {
    const readStream = () => {
      let failLoops = 0;

      // Function to process stream chunks
      const processChunk = () => {
        const chunk = responseBody.read();
        if (chunk) {
          failLoops = 0;
          const decoded = chunk.toString();

          const responseObject = callback(app, decoded, receivedContent, aiModel, responseJsonExpected, failedParseContent);
          ({ abort, failedParseContent, incrementalContents, receivedContent } = responseObject);

          if (abort || !shouldContinueStream(incrementalContents, receivedContent)) {
            resolve();
            return;
          }
          processChunk(); // Process the next chunk
        } else {
          failLoops += 1;
          if (failLoops < 3) {
            setTimeout(processChunk, streamTimeoutSeconds * 1000); // Try reading again after a delay
          } else {
            resolve(); // Resolve the promise if no more data is coming
          }
        }
      };

      processChunk(); // Start processing
    };

    responseBody.on("readable", readStream);
  });

  return receivedContent;
}

// --------------------------------------------------------------------------
async function streamWindowFetch(app, response, aiModel, responseJsonExpected, callback) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let abort, error, failedParseContent, incrementalContents;
  let failLoops = 0;
  let receivedContent = "";

  while (!error) {
    let value = null, done = false;
    try {
      await Promise.race([
        ({ done, value } = await reader.read()),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), streamTimeoutSeconds * 1000)
        )
      ])
    } catch (e) {
      error = e;
      logIfEnabled(`Failed to receive further stream data in time`, e);
      break;
    }

    if (done || failLoops > 3) {
      logIfEnabled("Completed generating response length");
      break;
    } else if (value) {
      const decodedValue = decoder.decode(value, { stream: true })
      // console.log("Decoded streamWindowFetch", decodedValue, "of type", typeof (decodedValue));
      try {
        if (typeof (decodedValue) === "string") {
          failLoops = 0;
          const response = callback(app, decodedValue, receivedContent, aiModel, responseJsonExpected, failedParseContent);
          if (response) {
            ({ abort, failedParseContent, incrementalContents, receivedContent } = response);
            if (abort) break;
            if (!shouldContinueStream(incrementalContents, receivedContent)) break;
          } else {
            logIfEnabled("Failed to parse stream from", value, "as JSON");
            failLoops += 1;
          }
        } else {
          logIfEnabled("Failed to parse stream from", value, "as JSON");
          failLoops += 1;
        }
      } catch (error) {
        logIfEnabled("There was an error parsing the response from stream:", error);
        break;
      }
    } else {
      failLoops += 1;
    }
  }

  return receivedContent;
}

// --------------------------------------------------------------------------
function shouldContinueStream(chunkStrings, accumulatedResponse) {
  let tooMuchSpace;
  if (chunkStrings?.length && (accumulatedResponse?.length || 0) >= MAX_SPACES_ABORT_RESPONSE) {
    const sansNewlines = accumulatedResponse.replace(/\n/g, " ");
    tooMuchSpace = sansNewlines.substring(sansNewlines.length - MAX_SPACES_ABORT_RESPONSE).trim() === "";
    if (tooMuchSpace) logIfEnabled("Response exceeds empty space threshold. Aborting");
  }
  return !tooMuchSpace;
}
