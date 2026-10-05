/**
 * Tests for the build-time gzip + base64 encoding of the embed document's payloads.
 */
import { gunzipSync } from "node:zlib";
import { gzipToBase64Lines, PAYLOAD_LINE_LENGTH } from "../payload-compression.js";

// ------------------------------------------------------------------------------------------
// @desc Decode an encoded payload the way the embed's loader does: atob, which discards the line breaks, then gunzip.
// @param {string} encodedText - Output of gzipToBase64Lines.
// @returns {string} The original payload text
function decodePayload(encodedText) {
  const gzippedBytes = Buffer.from(atob(encodedText), "latin1");
  return gunzipSync(gzippedBytes).toString("utf8");
}

test("round-trips multi-byte text, template syntax, and markup exactly", () => {
  const payloadText = "const a = `${ b }`; </script><!-- … emoji 🔢 -->\n".repeat(5_000);

  expect(decodePayload(gzipToBase64Lines(payloadText))).toBe(payloadText);
});

test("wraps the encoding onto lines no longer than PAYLOAD_LINE_LENGTH using only base64 characters", () => {
  const payloadText = Array.from({ length: 20_000 }, (_, index) => `${ index * 7919 }`).join(",");

  const lines = gzipToBase64Lines(payloadText).split("\n");

  expect(lines.length).toBeGreaterThan(1);
  expect(lines.every(line => line.length <= PAYLOAD_LINE_LENGTH && /^[A-Za-z0-9+/=]+$/.test(line))).toBe(true);
});
