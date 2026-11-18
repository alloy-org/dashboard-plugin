// Copy app.callLLM and app.callDecisionModel replies into plain objects before onEmbedCall sends them to the embed.
// The host returns class instances whose documented properties (textOutput, answers, ...) are getters on the class,
// with the data held in fields such as _textOutput and _json. Crossing the embed bridge copies only an object's own
// fields, so without this the embed would receive { _model, _json, ... } and none of the documented properties.

const LLM_RESPONSE_PROPERTIES = ["callCost", "functionCalls", "output", "reasoningSummaries", "textOutput", "usage", "usageSummary",
  "webSearchCount"];
const DECISION_MODEL_RESPONSE_PROPERTIES = ["answer", "answers", "callCost", "resolvedModel", "usage", "value"];

// ----------------------------------------------------------------------------------------------
// @desc A callLLM reply as a plain object holding its documented properties.
// @param {*} response - What app.callLLM resolved with: a response instance, or the number a checkQuota call returns.
// @returns {*} A plain object with the documented properties, or the response unchanged when it is not an object.
export function plainLlmResponse(response) {
  return _plainResponse(response, LLM_RESPONSE_PROPERTIES);
}

// ----------------------------------------------------------------------------------------------
// @desc A callDecisionModel reply as a plain object holding its documented properties.
// @param {*} response - What app.callDecisionModel resolved with: a response instance, or a checkQuota number.
// @returns {*} A plain object with the documented properties, or the response unchanged when it is not an object.
export function plainDecisionModelResponse(response) {
  return _plainResponse(response, DECISION_MODEL_RESPONSE_PROPERTIES);
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Read each named property, including getters defined on the response's class, into a plain object.
// @param {*} response - The host's reply.
// @param {Array<string>} propertyNames - The documented properties to copy.
// @returns {*} The plain copy, or the response unchanged when it is null or not an object.
function _plainResponse(response, propertyNames) {
  if (!response || typeof response !== "object") return response;
  const plainEntries = propertyNames.map(propertyName => [propertyName, response[propertyName]]);
  const definedEntries = plainEntries.filter(([, propertyValue]) => typeof propertyValue !== "undefined");
  return Object.fromEntries(definedEntries);
}
