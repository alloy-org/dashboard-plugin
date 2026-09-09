// Evaluates an operator-entered expression inside the plugin host, where `app` is the real Amplenote
// interface rather than the embed's postMessage proxy. The Debug Console widget's "Debug" button is the only
// caller: it exists so questions like "which note handle shapes does app.findNote accept?" can be answered
// against the host itself. Every result is returned as an already-serialized string, because arbitrary host
// values (bridge handles, circular structures, functions) do not survive the embed boundary.

import { logIfEnabled } from "util/log";

// Async so awaiting an app call needs no wrapper from the operator.
const ASYNC_FUNCTION_CONSTRUCTOR = Object.getPrototypeOf(async function () {}).constructor;
const MAX_OUTPUT_CHARS = 8 * 1024;

// ----------------------------------------------------------------------------------------------
// @desc Compile the operator's text into an async function of `app`. Tried first as an expression so a bare
//   `app.findNote({ uuid })` returns its value without a `return`, then as a statement body so multi-line
//   scripts with their own `return` work too.
// @param {string} expressionText - Raw text the operator typed.
// @returns {function(object): Promise<*>} Compiled evaluator; throws SyntaxError when neither form parses.
function compiledEvaluator(expressionText) {
  try {
    return ASYNC_FUNCTION_CONSTRUCTOR("app", `return (\n${ expressionText }\n);`);
  } catch {
    return ASYNC_FUNCTION_CONSTRUCTOR("app", expressionText);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Render one evaluated value as display text. Strings pass through quoted so an empty or whitespace
//   result stays visible, objects are JSON with circular references, functions, and undefined members
//   labeled rather than dropped, and anything JSON cannot handle falls back to String().
// @param {*} value - Whatever the expression evaluated to.
// @returns {string}
function describedValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (value instanceof Error) return `${ value.name }: ${ value.message }\n${ value.stack || "" }`.trim();
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return `[Function ${ value.name || "anonymous" }]`;
  if (typeof value === "bigint") return `${ value }n`;
  if (typeof value !== "object") return String(value);
  const seenObjects = new WeakSet();
  const replacer = (key, entry) => {
    if (entry instanceof Error) return `${ entry.name }: ${ entry.message }`;
    if (typeof entry === "function") return `[Function ${ entry.name || "anonymous" }]`;
    if (typeof entry === "bigint") return `${ entry }n`;
    if (entry && typeof entry === "object") {
      if (seenObjects.has(entry)) return "[Circular]";
      seenObjects.add(entry);
    }
    return entry;
  };
  try {
    const serialized = JSON.stringify(value, replacer, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch (error) {
    return `[Unserializable ${ typeConstructorName(value) }: ${ error?.message || String(error) }]`;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Evaluate one operator expression against the host app and describe the outcome in strings the embed
//   can render. Never throws: a compile failure, a rejected promise, and a thrown value all come back as the
//   `error` field so the caller has one shape to display.
// @param {object} app - Amplenote app interface, bound to the expression's `app` argument.
// @param {string} expressionText - Expression or statement body the operator typed.
// @returns {Promise<Object>} An object with the following properties:
//   - {string|null} error - Failure text (compile or runtime), or null when evaluation succeeded
//   - {string} expression - The trimmed text that was evaluated
//   - {string} output - The described result value, truncated to MAX_OUTPUT_CHARS
//   - {string} resultType - "none" when nothing was entered, "error" on failure, else the value's type name
export async function evaluateDebugExpression(app, expressionText) {
  const trimmedExpression = String(expressionText ?? "").trim();
  if (!trimmedExpression) {
    return { error: "Nothing was entered to evaluate", expression: "", output: "", resultType: "none" };
  }

  let evaluator;
  try {
    evaluator = compiledEvaluator(trimmedExpression);
  } catch (error) {
    const message = `Could not compile expression: ${ error?.message || String(error) }`;
    logIfEnabled("[debug-evaluate] compile failed:", trimmedExpression, message);
    return { error: message, expression: trimmedExpression, output: "", resultType: "error" };
  }

  try {
    const value = await evaluator(app);
    const output = truncatedOutput(describedValue(value));
    logIfEnabled("[debug-evaluate]", trimmedExpression, "=>", output);
    return { error: null, expression: trimmedExpression, output, resultType: typeConstructorName(value) };
  } catch (error) {
    const message = error instanceof Error
      ? `${ error.name }: ${ error.message }\n${ error.stack || "" }`.trim()
      : `Threw a non-Error value: ${ describedValue(error) }`;
    logIfEnabled("[debug-evaluate] threw:", trimmedExpression, message);
    return { error: truncatedOutput(message), expression: trimmedExpression, output: "", resultType: "error" };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Clip display text so an unbounded dump (every note in the account, say) cannot overwhelm the alert
//   that shows it or the bridge that carries it.
// @param {string} text - Text to clip.
// @returns {string} The text, or its first MAX_OUTPUT_CHARS characters plus a length marker.
function truncatedOutput(text) {
  const outputText = String(text ?? "");
  if (outputText.length <= MAX_OUTPUT_CHARS) return outputText;
  return `${ outputText.slice(0, MAX_OUTPUT_CHARS) }… [truncated, ${ outputText.length } chars]`;
}

// ----------------------------------------------------------------------------------------------
// @desc Name a value's type for the result header: the constructor name when there is one (Object, Array,
//   Promise, a host class), else the typeof.
// @param {*} value - Value to name.
// @returns {string}
function typeConstructorName(value) {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  return value.constructor?.name || "object";
}
