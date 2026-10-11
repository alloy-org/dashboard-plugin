// [OpenAI GPT-5.5-authored file]
// Created: 2026-08-02 | Model: GPT-5.5
// Task: Shared JSON serialization helpers.
// Prompt summary: "Move stable JSON fingerprint serialization into a reusable utility."

// ----------------------------------------------------------------------------------------------
// @desc Compact and stable JSON serializer for primitive JSON-like objects/arrays.
// @param {any} value - JSON-serializable value.
// @returns {string} Deterministic JSON string with object keys sorted recursively.
// [OpenAI GPT-5.5] Task: share stable context fingerprint serialization
export function stableJson(value) {
  if (Array.isArray(value)) {
    const serializedItems = value.map(stableJson);
    return `[${ serializedItems.join(",") }]`;
  }
  if (value && typeof value === "object") {
    const sortedKeys = Object.keys(value).sort();
    const serializedEntries = sortedKeys.map(key => `${ JSON.stringify(key) }:${ stableJson(value[key]) }`);
    return `{${ serializedEntries.join(",") }}`;
  }
  return JSON.stringify(value);
}

// A ```json fence whose closing fence starts its own line. JSON never holds a raw newline inside a string, so a line
// beginning with ``` can only be the closing fence, even when a string value itself contains ```.
const LINE_ANCHORED_JSON_FENCE = /```json[^\S\n]*\n([\s\S]*?)\n[^\S\n]*```/i;
// The first ```json fence closed by the next ```, for content whose closing fence does not start a line.
const INLINE_JSON_FENCE = /```json\s*([\s\S]*?)```/i;

// ----------------------------------------------------------------------------------------------
// @desc The text inside a note's ```json fence. The closing fence is matched at the start of a line first, so a
//   stored string containing ``` (task text quoting code, for example) does not end the block early.
// @param {string} content - Note markdown.
// @returns {string|null} The fenced text, or null when the content has no ```json fence.
export function jsonFenceContent(content) {
  if (typeof content !== "string") return null;
  const match = content.match(LINE_ANCHORED_JSON_FENCE) || content.match(INLINE_JSON_FENCE);
  return match ? match[1] : null;
}
