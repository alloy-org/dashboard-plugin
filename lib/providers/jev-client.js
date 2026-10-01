// Call TypeSafe's Jev decision model. Jev does not generate text: it answers named questions about a piece of
// structured state with probabilities, which makes it a fit for rating how well a task serves a project without
// parsing prose. One request may carry many questions about the same state, so a project's context and the user's
// terms dictionary are sent once per batch of tasks rather than once per task.
//
// TypeSafe's own endpoint refuses every browser origin (its CORS preflight answers 400 "Disallowed CORS origin"
// for amplenote.com, the embed's opaque `null` origin, and localhost alike), so from inside Amplenote only an
// OpenRouter key can reach Jev. OpenRouter serves the same System One request body at its own base URL and
// allows any origin. The token's prefix picks the route, so no second setting is needed.

const JEV_DIRECT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_DIRECT_MODEL = "jev-latest";
const JEV_OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/systemone";
const JEV_OPENROUTER_MODEL = "~typesafe/jev-latest";
const JEV_TIMEOUT_MILLISECONDS = 30000;
const OPENROUTER_TOKEN_PREFIX = "sk-or-";

// ----------------------------------------------------------------------------------------------
// @desc Choose the endpoint and model a token authenticates against. OpenRouter keys carry a fixed prefix; any
//   other token is treated as a TypeSafe key.
// @param {string} accessToken - TypeSafe or OpenRouter API key.
// @returns {object} { endpoint, model, routeEm } where routeEm is "openrouter" or "typesafe".
export function jevRouteFromAccessToken(accessToken) {
  if (String(accessToken || "").startsWith(OPENROUTER_TOKEN_PREFIX)) {
    return { endpoint: JEV_OPENROUTER_ENDPOINT, model: JEV_OPENROUTER_MODEL, routeEm: "openrouter" };
  } else {
    return { endpoint: JEV_DIRECT_ENDPOINT, model: JEV_DIRECT_MODEL, routeEm: "typesafe" };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Submit one System One request and return its answers keyed by question name. A non-2xx response, a
//   timeout, or a body without an `answers` object throws, naming the HTTP status and the start of the body so a
//   caller can record why a batch went unrated.
// @param {object} options - An object with the following properties:
//   - {string} accessToken - TypeSafe or OpenRouter API key
//   - {function} [fetchImplementation=fetch] - Injected for tests
//   - {string} [model] - Overrides the route's default model, e.g. "jev-1.13.0"
//   - {object} questions - Questions keyed by name, each { type, instructions, criteria }
//   - {object|string} state - The text or JSON object every question is asked about
//   - {number} [timeoutMilliseconds=JEV_TIMEOUT_MILLISECONDS] - Abort the request after this long
// @returns {Promise<object>} { answers, model, usage } as Jev returned them.
export async function requestJevAnswers({ accessToken, fetchImplementation = globalThis.fetch, model, questions, state,
    timeoutMilliseconds = JEV_TIMEOUT_MILLISECONDS }) {
  if (!accessToken) throw new Error("A Jev access token is required");
  if (!questions || !Object.keys(questions).length) throw new Error("At least one Jev question is required");
  const route = jevRouteFromAccessToken(accessToken);
  const abortController = typeof AbortController === "function" ? new AbortController() : null;
  const timer = abortController ? setTimeout(() => abortController.abort(), timeoutMilliseconds) : null;
  let response;
  try {
    response = await fetchImplementation(route.endpoint, { body: JSON.stringify({ model: model || route.model,
      questions, state }), headers: { Authorization: `Bearer ${ accessToken }`, "Content-Type": "application/json" },
    method: "POST", signal: abortController?.signal });
  } catch (error) {
    const reason = error?.name === "AbortError" ? `timed out after ${ timeoutMilliseconds }ms` : error?.message;
    throw new Error(`Jev request failed: ${ reason }`);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const bodyText = await response.text();
  if (!response.ok) throw new Error(`Jev answered ${ response.status }: ${ bodyText.slice(0, 200) }`);
  let parsedBody = null;
  try { parsedBody = JSON.parse(bodyText); } catch (_error) { parsedBody = null; }
  if (!parsedBody?.answers || typeof parsedBody.answers !== "object") {
    throw new Error(`Jev response carried no answers: ${ bodyText.slice(0, 200) }`);
  }
  return { answers: parsedBody.answers, model: parsedBody.model ?? null, usage: parsedBody.usage ?? null };
}

// ----------------------------------------------------------------------------------------------
// @desc Build a score question. Jev indexes a rubric from zero, so a 1–10 scale is a ten-entry list whose first
//   entry describes a 1, and the expected score it returns must be shifted up by one to read on that scale.
// @param {string|object} instructions - The question, as text or a JSON object.
// @param {Array<string>} criteria - At least two rubric descriptions, lowest score first. The API rejects null entries.
// @returns {object} A System One score question.
export function scoreQuestion(instructions, criteria) {
  if (!Array.isArray(criteria) || criteria.length < 2) throw new Error("A score question needs at least two criteria");
  if (criteria.some(criterion => typeof criterion !== "string")) throw new Error("Every score criterion must be text");
  return { criteria, instructions, type: "score" };
}
