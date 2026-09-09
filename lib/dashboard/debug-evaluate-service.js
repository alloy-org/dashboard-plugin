// Drives the Debug Console's "Debug" button: prompt the operator for an expression, hand it to the plugin
// host for evaluation (util/debug-evaluate, reached through the `debugEvaluate` embed call), then show the
// result and offer to run another. Results also go to the browser console and the Debug Console's own log
// buffer, so a long answer stays readable after the dialog closes.

import { logAlways } from "util/log";

// The label stays one word so the dialog gives the field its full width; the guidance rides in the message.
const PROMPT_EXPRESSION_LABEL = "Expression";
const PROMPT_MESSAGE = "Evaluate an expression in the plugin host, with `app` in scope — e.g. "
  + "await app.findNote({ uuid: \"...\" }). It is awaited automatically, and a multi-line body may use its "
  + "own return statement.";
// The console log line carries the whole result; a very long one is easier to read there than in a dialog.
const MAX_ALERT_OUTPUT_CHARS = 3 * 1024;
const RUN_AGAIN_ACTION = "run-again";

// Remembering the last expression across openings is the point of a REPL-ish tool: the next question is
// usually a small edit of the last one.
let _lastExpressionText = "";

// ----------------------------------------------------------------------------------------------
// @desc Compose the result dialog's body from one evaluation, clipping the value so a large dump does not
//   produce an unscrollable dialog (the full text is in the console log line either way).
// @param {Object} evaluation - Result of evaluateDebugExpression: { error, expression, output, resultType }.
// @returns {string} Display text for app.alert.
function alertBodyFromEvaluation(evaluation) {
  const bodyText = evaluation.error ? `⚠️ ${ evaluation.error }` : `(${ evaluation.resultType })\n${ evaluation.output }`;
  if (bodyText.length <= MAX_ALERT_OUTPUT_CHARS) return bodyText;
  return `${ bodyText.slice(0, MAX_ALERT_OUTPUT_CHARS) }…\n\n[Truncated for display — the full result is in the Debug Console log]`;
}

// ----------------------------------------------------------------------------------------------
// @desc Ask the host to evaluate one expression, reporting a missing or failed bridge in the same result
//   shape the host itself returns so the caller has one thing to display.
// @param {object} app - Amplenote app bridge (the embed proxy in production, the dev app locally).
// @param {string} expressionText - Text the operator entered.
// @returns {Promise<Object>} { error, expression, output, resultType }, per evaluateDebugExpression.
async function evaluationFromHost(app, expressionText) {
  if (typeof app?.debugEvaluate !== "function") {
    return { error: "This host has no debugEvaluate bridge action", expression: expressionText, output: "",
      resultType: "error" };
  }
  const evaluation = await app.debugEvaluate(expressionText);
  if (!evaluation || typeof evaluation !== "object") {
    return { error: `Host returned no result (${ String(evaluation) })`, expression: expressionText, output: "",
      resultType: "error" };
  }
  if (evaluation.embedCallFailed) {
    return { error: `Bridge call failed: ${ evaluation.error || "(no message)" }`, expression: expressionText,
      output: "", resultType: "error" };
  }
  return evaluation;
}

// ----------------------------------------------------------------------------------------------
// @desc Open the expression prompt, evaluate what the operator submits, display the result, and loop while
//   they keep choosing "Run another expression". Cancelling either dialog ends the session. Never throws:
//   a failure inside the bridge is reported through the same result dialog as a thrown expression.
// @param {object} app - Amplenote app bridge, forwarded to the host for evaluation.
// @returns {Promise<void>}
export async function runDebugEvaluationSession(app) {
  for (;;) {
    const promptResult = await app.prompt(PROMPT_MESSAGE, { inputs: [{ label: PROMPT_EXPRESSION_LABEL,
      placeholder: "await app.findNote({ uuid })", type: "text", value: _lastExpressionText }] });
    if (promptResult === null || promptResult === undefined || promptResult === false) return;
    const submittedText = Array.isArray(promptResult) ? promptResult[0] : promptResult;
    const expressionText = String(submittedText ?? "").trim();
    if (!expressionText) return;
    _lastExpressionText = expressionText;

    let evaluation;
    try {
      evaluation = await evaluationFromHost(app, expressionText);
    } catch (error) {
      evaluation = { error: `Bridge call threw: ${ error?.message || String(error) }`, expression: expressionText,
        output: "", resultType: "error" };
    }

    logAlways("[debug-console]", expressionText, evaluation.error ? "threw:" : `=> (${ evaluation.resultType })`,
      evaluation.error || evaluation.output);
    const alertResult = await app.alert(alertBodyFromEvaluation(evaluation), {
      actions: [{ icon: "replay", label: "Run another expression", value: RUN_AGAIN_ACTION }], preface: expressionText });
    if (alertResult !== RUN_AGAIN_ACTION) return;
  }
}
