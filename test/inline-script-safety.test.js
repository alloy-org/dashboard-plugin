/**
 * Tests for the build-time guard that keeps the client bundle safe to inline into the embed document.
 *
 * Every case is cross-checked against a real HTML parse, because the guard's only job is to predict what the HTML
 * tokenizer will do. A hand-written state machine that agreed with itself but not with the parser would be worse
 * than no guard at all, so each fixture asserts the guard's verdict and the parser's behavior together.
 */
import { analyzeInlineScriptSafety, assertInlineScriptSafe } from "../inline-script-safety.js";

// ------------------------------------------------------------------------------------------
// @desc Inline a script into a document, parse it with the environment's real HTML parser, and report whether the
//   element survived intact — the script body captured whole, and the element that follows it still parsed.
// @param {string} scriptText - JavaScript to place between <script> and </script>.
// @returns {boolean} True when the document parsed as intended
function parsesIntact(scriptText) {
  const html = `<!DOCTYPE html><html><body><script type="text/javascript">${ scriptText }</`
    + `script><div id="sentinel"></div></body></html>`;
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  const scriptElement = parsedDocument.querySelector("script");
  const capturedWholeBody = !!scriptElement && scriptElement.textContent.length === scriptText.length;
  return capturedWholeBody && !!parsedDocument.querySelector("#sentinel");
}

describe("analyzeInlineScriptSafety", () => {
  // A comment opener followed by a script opener is the arrangement that matters: it leaves the tokenizer in the
  // double-escaped state, where the document's own closing tag stops closing the element.
  it("rejects a comment opener followed by a script opener, which a real parse also breaks", () => {
    const scriptText = 'var a = "<!--"; var b = "<script>"; var c = 1;';

    expect(analyzeInlineScriptSafety(scriptText).safe).toBe(false);
    expect(parsesIntact(scriptText)).toBe(false);
  });

  it("allows a script opener on its own, which a real parse also survives", () => {
    const scriptText = 'var b = "<script>"; var c = 1;';

    expect(analyzeInlineScriptSafety(scriptText).safe).toBe(true);
    expect(parsesIntact(scriptText)).toBe(true);
  });

  it("allows a comment opener on its own, which a real parse also survives", () => {
    const scriptText = 'var a = "<!--"; var c = 1;';

    expect(analyzeInlineScriptSafety(scriptText).safe).toBe(true);
    expect(parsesIntact(scriptText)).toBe(true);
  });

  // The order is the whole point: the same two sequences in the opposite order are harmless, which is precisely why
  // the current bundle survives and why a dependency reorder could silently stop it from surviving.
  it("allows a script opener that precedes the comment opener", () => {
    const scriptText = 'var b = "<script>"; var a = "<!--"; var c = 1;';

    expect(analyzeInlineScriptSafety(scriptText).safe).toBe(true);
    expect(parsesIntact(scriptText)).toBe(true);
  });

  it("allows a comment that is closed again before the script opener", () => {
    const scriptText = 'var a = "<!--"; var z = "-->"; var b = "<script>"; var c = 1;';

    expect(analyzeInlineScriptSafety(scriptText).safe).toBe(true);
    expect(parsesIntact(scriptText)).toBe(true);
  });

  it("rejects a literal closing tag that would truncate the document", () => {
    const scriptText = 'var a = "</script>"; var c = 1;';

    expect(analyzeInlineScriptSafety(scriptText).safe).toBe(false);
    expect(parsesIntact(scriptText)).toBe(false);
  });

  it("treats a script opener not followed by a tag terminator as ordinary text", () => {
    const scriptText = 'var a = "<!--"; var b = "<scriptish"; var c = 1;';

    expect(analyzeInlineScriptSafety(scriptText).safe).toBe(true);
    expect(parsesIntact(scriptText)).toBe(true);
  });

  it("names the offending bytes so the failure is findable in a minified bundle", () => {
    const scriptText = `var padding = "${ "x".repeat(500) }"; var a = "<!--"; var b = "<script>";`;

    const { reason } = analyzeInlineScriptSafety(scriptText);

    expect(reason).toMatch(/byte \d+/);
    expect(reason).toContain("<script");
  });
});

describe("assertInlineScriptSafe", () => {
  it("passes a benign bundle through silently", () => {
    expect(() => assertInlineScriptSafe("console.log(1);")).not.toThrow();
  });

  it("throws with the base64 fallback named as a remedy", () => {
    expect(() => assertInlineScriptSafe('var a = "<!--"; var b = "<script>";'))
      .toThrow(/base64 data: URL/);
  });
});
