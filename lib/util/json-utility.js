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
