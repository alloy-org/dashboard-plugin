// Build-time encoding for the payloads the embed document carries: the client bundle and its stylesheet. Each is
// gzipped and base64-encoded, then split into short lines so the plugin note's CodeMirror code block never holds a
// megabyte-long line. The embed's loader script reverses this with the browser's DecompressionStream.
import zlib from "zlib";

// Characters per line of encoded payload. atob() discards ASCII whitespace, so the line breaks cost one byte each
// and need no handling on the decoding side.
export const PAYLOAD_LINE_LENGTH = 1000;

// ------------------------------------------------------------------------------------------
// @desc Gzip a text payload at maximum compression and encode it as base64 wrapped onto fixed-length lines. Base64
//   holds only [A-Za-z0-9+/=], so the result is inert inside an HTML <script> element, a JS template literal, and a
//   CodeMirror editor alike.
// @param {string} payloadText - Text to encode, e.g. the minified client bundle.
// @returns {string} Base64 lines joined by "\n"
export function gzipToBase64Lines(payloadText) {
  const gzippedBytes = zlib.gzipSync(Buffer.from(payloadText, "utf8"), { level: 9 });
  const base64Text = gzippedBytes.toString("base64");
  const lines = [];
  for (let offset = 0; offset < base64Text.length; offset += PAYLOAD_LINE_LENGTH) {
    lines.push(base64Text.slice(offset, offset + PAYLOAD_LINE_LENGTH));
  }
  return lines.join("\n");
}
