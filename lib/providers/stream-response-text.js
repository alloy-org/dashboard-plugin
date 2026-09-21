// Read a provider's server-sent-event response body as it arrives, reporting the text accumulated so far after each
// chunk, so a caller can act on the first part of an answer before the rest has been generated. Unlike the stream
// readers behind callRemoteAI, this one shows nothing to the user itself, keeps an event that was split across two
// chunks intact, and holds the whole read to a single deadline. Host-compatible: it needs only fetch's Response.

import { logIfEnabled } from "util/log";

// Providers whose streamed events this reader understands. Gemini streams from a different endpoint than the one a
// request is sent to, so a Gemini request is never asked to stream.
export const STREAMING_PROVIDERS = ["anthropic", "deepseek", "grok", "openai", "perplexity"];

// ----------------------------------------------------------------------------------------------
// @desc Extract the generated text carried by one server-sent-event line.
// @param {string} providerEm - Provider the response came from.
// @param {string} line - One line of the event stream, without its newline.
// @returns {string} The text the line adds to the answer, or an empty string for any other line.
export function textDeltaFromStreamLine(providerEm, line) {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("data:")) return "";
  const payload = trimmedLine.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  let event;
  try {
    event = JSON.parse(payload);
  } catch (error) {
    return "";
  }
  if (providerEm === "anthropic") return event?.type === "content_block_delta" ? event.delta?.text ?? "" : "";
  return event?.choices?.[0]?.delta?.content ?? "";
}

// ----------------------------------------------------------------------------------------------
// @desc Read a streamed response to its end, calling onPartialText with everything received so far each time the
//   answer grows.
// @param {Response} response - A successful fetch response to a request sent with stream enabled.
// @param {string} providerEm - Provider the response came from, which decides how its events are read.
// @param {object} params - An object with the following properties:
//   - {Function} onPartialText - Receives the accumulated answer text. A callback that throws is logged and the
//     read continues, since a display problem should not discard the answer.
//   - {number} timeoutSeconds - Budget for the whole read, after which it is cancelled and rejects.
// @returns {Promise<string>} The complete answer text.
export async function streamedResponseText(response, providerEm, { onPartialText, timeoutSeconds }) {
  let receivedText = "";
  const appendLines = lines => {
    const previousLength = receivedText.length;
    for (const line of lines) receivedText += textDeltaFromStreamLine(providerEm, line);
    if (receivedText.length === previousLength) return;
    try {
      onPartialText(receivedText);
    } catch (error) {
      logIfEnabled("[stream-response-text] partial text callback failed", error?.message);
    }
  };

  // A body without a reader still carries the events, just all at once.
  if (!response.body?.getReader) {
    appendLines((await response.text()).split("\n"));
    return receivedText;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bufferedText = "";
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Streamed response timed out after ${ timeoutSeconds }s`)), timeoutSeconds * 1000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      bufferedText += decoder.decode(value, { stream: true });
      const lines = bufferedText.split("\n");
      bufferedText = lines.pop();
      appendLines(lines);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  appendLines([bufferedText + decoder.decode()]);
  return receivedText;
}
