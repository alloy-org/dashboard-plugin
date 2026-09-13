// Build-time guard for JavaScript that is inlined into an HTML <script> element.
//
// The dashboard client bundle is emitted directly into the embed document rather than through a
// `data:text/javascript;base64,` URL, which avoids base64's 33% size premium on the largest thing the plugin ships.
// The cost of that choice is that the bundle's bytes now pass through the HTML tokenizer, which reads three byte
// sequences inside a <script> element as markup. This module fails the build when the bundle contains an arrangement
// of them that would corrupt the document, so the failure is a build error rather than a dashboard that silently
// renders nothing.
//
// The sequences and the states they drive (HTML Standard, "Script data" tokenizer states):
//
//   <!--     in script data          -> script data escaped
//   -->      in either escaped state -> one level back out
//   <script  in script data escaped  -> script data double escaped
//
// In the double-escaped state a `</script>` no longer closes the element, so a bundle that is still double-escaped
// when the document's closing tag arrives swallows the rest of the page. esbuild already escapes `</script` inside
// string literals, which is why that sequence is not the practical risk; `<!--` is, because it appears unescapable
// inside regex literals (marked's `/<!--(?:-?>|[\s\S]*?(?:-->|$))/`) and in the Rich Footnote `<!--FNREF:n-->`
// markers, and `<script` appears in React DOM's `innerHTML="<script><\/script>"` feature probe.
//
// Today those two sit in a safe order — React DOM is bundled ahead of marked, so no comment is open when the
// tokenizer reaches `<script`. That ordering is a byproduct of esbuild's module ordering, not a property anyone
// chose, and adding a dependency or reordering an import is enough to invert it. Hence this check.

// Characters that may follow a tag name for the tokenizer to treat it as a tag rather than ordinary text.
const TAG_NAME_TERMINATORS = new Set([ "\t", "\n", "\f", "\r", " ", "/", ">" ]);

const SCRIPT_DATA = "script data";
const SCRIPT_DATA_ESCAPED = "script data escaped";
const SCRIPT_DATA_DOUBLE_ESCAPED = "script data double escaped";

// ------------------------------------------------------------------------------------------
// @desc Whether the text at an offset is the tag `tagText` followed by a character that ends a tag name, which is
//   what the tokenizer requires before treating the sequence as a tag rather than as ordinary script text.
// @param {string} scriptText - The full script body being scanned.
// @param {number} offset - Index to test at.
// @param {string} tagText - Literal tag text to match, lowercase, e.g. "<script" or "</script".
// @returns {boolean} True when a tag token starts at this offset
function _matchesTagAt(scriptText, offset, tagText) {
  if (scriptText.slice(offset, offset + tagText.length).toLowerCase() !== tagText) return false;
  const following = scriptText[offset + tagText.length];
  return following === undefined || TAG_NAME_TERMINATORS.has(following);
}

// ------------------------------------------------------------------------------------------
// @desc Quote the bundle around an offset so a build failure points at the offending bytes, which are otherwise
//   unfindable in a minified megabyte.
// @param {string} scriptText - The full script body being scanned.
// @param {number} offset - Index to quote around.
// @returns {string} A single-line excerpt with the surrounding context
function _excerptAt(scriptText, offset) {
  const excerpt = scriptText.slice(Math.max(0, offset - 80), offset + 80).replace(/\s+/g, " ");
  return `byte ${ offset }: ...${ excerpt }...`;
}

// ------------------------------------------------------------------------------------------
// @desc Run the HTML tokenizer's script-data state machine over a script body and report any arrangement that would
//   break an enclosing <script> element.
// @param {string} scriptText - JavaScript intended to be inlined between <script> and </script>.
// @returns {Object} A result object with the following properties:
//   - {boolean} safe - True when the script can be inlined without corrupting the document
//   - {string|null} reason - Human-readable explanation of the first problem found, or null when safe
export function analyzeInlineScriptSafety(scriptText) {
  let state = SCRIPT_DATA;
  let doubleEscapedSince = null;

  for (let offset = 0; offset < scriptText.length; offset++) {
    // A closing tag ends the element from either script data or the single-escaped state. It does not from the
    // double-escaped state, where the tokenizer instead steps back out one level.
    if (_matchesTagAt(scriptText, offset, "</script")) {
      if (state === SCRIPT_DATA_DOUBLE_ESCAPED) {
        state = SCRIPT_DATA_ESCAPED;
        doubleEscapedSince = null;
      } else {
        return { safe: false, reason: `The bundle contains a literal "</script" that would close the enclosing `
          + `script element early, truncating the page.\n  ${ _excerptAt(scriptText, offset) }` };
      }
      offset += "</script".length - 1;
      continue;
    }

    if (scriptText.startsWith("<!--", offset)) {
      if (state === SCRIPT_DATA) state = SCRIPT_DATA_ESCAPED;
      offset += "<!--".length - 1;
      continue;
    }

    if (scriptText.startsWith("-->", offset)) {
      if (state === SCRIPT_DATA_DOUBLE_ESCAPED) { state = SCRIPT_DATA_ESCAPED; doubleEscapedSince = null; }
      else if (state === SCRIPT_DATA_ESCAPED) state = SCRIPT_DATA;
      offset += "-->".length - 1;
      continue;
    }

    if (_matchesTagAt(scriptText, offset, "<script")) {
      if (state === SCRIPT_DATA_ESCAPED) { state = SCRIPT_DATA_DOUBLE_ESCAPED; doubleEscapedSince = offset; }
      offset += "<script".length - 1;
    }
  }

  if (state === SCRIPT_DATA_DOUBLE_ESCAPED) {
    return { safe: false, reason: `The bundle ends inside the HTML tokenizer's script-data-double-escaped state, `
      + `where "</script>" no longer closes the element — the embed's closing tag would be swallowed and the `
      + `dashboard would render nothing. A "<script" was reached while an unclosed "<!--" was open here.\n  `
      + `${ _excerptAt(scriptText, doubleEscapedSince) }` };
  }

  return { safe: true, reason: null };
}

// ------------------------------------------------------------------------------------------
// @desc Fail the build when the client bundle cannot be safely inlined into the embed document.
// @param {string} scriptText - JavaScript intended to be inlined between <script> and </script>.
// @returns {void} Throws with the offending bytes and the available remedies when inlining would corrupt the document
export function assertInlineScriptSafe(scriptText) {
  const { safe, reason } = analyzeInlineScriptSafety(scriptText);
  if (safe) return;

  throw new Error(`Client bundle cannot be inlined into the embed document.\n\n${ reason }\n\n`
    + `Remedies, cheapest first:\n`
    + `  1. Reorder or adjust the offending source so the sequence no longer appears (often a string or regex\n`
    + `     literal that can be written as "<" + "!--" or with an escape).\n`
    + `  2. Fall back to a base64 data: URL script in lib/embed-html.js, which keeps the bundle away from the HTML\n`
    + `     tokenizer entirely at the cost of ~33% more bytes in the plugin note's code block.\n`);
}
