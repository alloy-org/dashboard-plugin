// Tests for the quiet server-sent-event reader the wizard streams provider answers through: it must rebuild the
// answer from events that arrive split across chunks, report the answer as it grows, and give up at its deadline.

import { jest } from "@jest/globals";
import { streamedResponseText, textDeltaFromStreamLine } from "providers/stream-response-text";
import { TextDecoder, TextEncoder } from "util";

// The jsdom environment lacks the encoding classes a browser and the embed provide.
globalThis.TextDecoder ??= TextDecoder;
globalThis.TextEncoder ??= TextEncoder;

// ----------------------------------------------------------------------------------------------
// @desc Build a fetch-like response whose body yields the given chunks one read at a time.
// @param {Array<string>} chunks - Raw text of each chunk, as the network would deliver it.
// @param {object} [options] - { stallAfterChunks } to leave the read pending forever after that many chunks.
// @returns {object} An object exposing body.getReader like a fetch Response.
function chunkedResponse(chunks, { stallAfterChunks = null } = {}) {
  const encoder = new TextEncoder();
  let chunkIndex = 0;
  const cancel = jest.fn(async () => {});
  const read = async () => {
    if (stallAfterChunks !== null && chunkIndex >= stallAfterChunks) return new Promise(() => {});
    if (chunkIndex >= chunks.length) return { done: true, value: undefined };
    const value = encoder.encode(chunks[chunkIndex]);
    chunkIndex += 1;
    return { done: false, value };
  };
  return { body: { getReader: () => ({ cancel, read }) }, cancel };
}

// ----------------------------------------------------------------------------------------------
// @desc Confirm each provider family's delta is read from its own event shape, and that other lines add nothing.
test("reads the text delta from Anthropic and OpenAI-compatible events", () => {
  expect(textDeltaFromStreamLine("anthropic", 'data: {"type":"content_block_delta","delta":{"text":"Hi"}}')).toBe("Hi");
  expect(textDeltaFromStreamLine("anthropic", 'data: {"type":"message_start"}')).toBe("");
  expect(textDeltaFromStreamLine("openai", 'data: {"choices":[{"delta":{"content":"Hi"}}]}')).toBe("Hi");
  expect(textDeltaFromStreamLine("openai", "data: [DONE]")).toBe("");
  expect(textDeltaFromStreamLine("openai", "event: ping")).toBe("");
});

// ----------------------------------------------------------------------------------------------
// @desc Confirm an event split across two chunks is kept whole, and that the caller hears the answer as it grows.
test("rebuilds the answer from events split across chunks and reports it as it grows", async () => {
  const response = chunkedResponse(['data: {"choices":[{"delta":{"content":"{\\"the"}}]}\n\ndata: {"choi',
    'ces":[{"delta":{"content":"mes\\":"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"[]}"}}]}']);
  const partialTexts = [];
  const answer = await streamedResponseText(response, "openai", { onPartialText: text => partialTexts.push(text), timeoutSeconds: 5 });

  expect(answer).toBe('{"themes":[]}');
  expect(partialTexts).toEqual(['{"the', '{"themes":', '{"themes":[]}']);
});

// ----------------------------------------------------------------------------------------------
// @desc Confirm a stream that stops sending is cancelled at its deadline rather than holding the wizard open.
test("cancels and rejects a stream that outlives its deadline", async () => {
  const response = chunkedResponse(['data: {"type":"content_block_delta","delta":{"text":"{"}}\n'], { stallAfterChunks: 1 });
  await expect(streamedResponseText(response, "anthropic", { onPartialText: () => {}, timeoutSeconds: 0.05 }))
    .rejects.toThrow("timed out");
  expect(response.cancel).toHaveBeenCalled();
});
