// Choose how a user's ratings are asked for, and return a DecisionsEndpoint holding those routes. Rankers ask the
// endpoint for a DecisionsResponse and do not read keys, settings, or Ample Agent Pro themselves. Selection order:
//   1. Jev, with a Jev key or through an installed Ample Agent Pro note, unless a Jev request failed in the last hour.
//   2. OpenAI's Decisions API, with the user's OpenAI key, or through Ample Agent Pro once Jev has failed. When Jev is
//      healthy this is also the route a failing Jev request falls back to within the same request.
//   3. With no decision model to ask, the generative provider's fast model, which is far costlier per task, so its
//      endpoint reports scorerEm "generative" and rankers draw a smaller pool for it.
import { devJevAccessToken, devOpenAiAccessToken, SETTING_KEYS } from "constants/settings";
import { agentProJevRequester, agentProOpenAiRequester } from "plan-wizard/stack-rank/agent-pro-jev-requester";
import { generativeScoreRequester } from "plan-wizard/stack-rank/generative-task-scores";
import { pluginSettings } from "plugin-data";
import { fastModelOptions, findAmpleAgentProNote } from "providers/ai-provider-settings";
import { DECISIONS_PROVIDER_GENERATIVE, DECISIONS_PROVIDER_JEV, DECISIONS_PROVIDER_OPENAI, DecisionsEndpoint, decisionsRoute,
  jevFailedRecently, jevKeyRoute, openAiKeyRoute } from "providers/decisions-endpoint";

// ----------------------------------------------------------------------------------------------
// @desc The endpoint this user's ratings go through, or null when nothing can rate.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} [options] - An object with the following properties:
//   - {function} [fastScorePromptBuilder] - (questions, state) => prompt for the fast model, for a caller rating
//     something other than task applicability (see generativeScoreRequester)
//   - {boolean} [includeFastScore=true] - False returns null rather than a fast-model endpoint, for a caller with its
//     own generative fallback
//   - {string} [jevAccessToken] - Explicit Jev key, used by tests; the Jev Access Token setting otherwise
//   - {number} [now=Date.now()] - Epoch milliseconds the Jev failure record is read against
//   - {string} [openAiAccessToken] - Explicit OpenAI key, used by tests; the OpenAI API Key setting otherwise
//   - {function} [promptRunner] - Injected into the fast model's requests, for tests
// @returns {Promise<DecisionsEndpoint|null>} The endpoint, whose scorerEm is "jev" for a decision model and
//   "generative" for the fast model.
export async function decisionsEndpointForApp(app, { fastScorePromptBuilder, includeFastScore = true, jevAccessToken,
    now = Date.now(), openAiAccessToken, promptRunner } = {}) {
  const jevKey = jevAccessTokenFromSettings(jevAccessToken);
  const openAiKey = openAiAccessTokenFromSettings(openAiAccessToken);
  const agentProNote = jevKey && openAiKey ? null : await findAmpleAgentProNote(app);
  const decisionRoutes = _decisionRoutes(app, { agentProNote, jevFailed: jevFailedRecently(now), jevKey, openAiKey });
  if (decisionRoutes.length) return new DecisionsEndpoint({ routes: decisionRoutes, scorerEm: "jev" });
  if (!includeFastScore || !fastModelOptions(pluginSettings())) return null;
  const fastScoreRequest = generativeScoreRequester(app, { promptBuilder: fastScorePromptBuilder, promptRunner });
  return new DecisionsEndpoint({ routes: [decisionsRoute(DECISIONS_PROVIDER_GENERATIVE, fastScoreRequest)],
    scorerEm: "generative" });
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the Jev key ratings use. In development, the JEV_ACCESS_TOKEN in .env is used when the setting is empty.
// @param {string} [accessToken] - Explicit key, used by tests; the Jev Access Token setting otherwise.
// @returns {string|null} The key, or null when none is set.
export function jevAccessTokenFromSettings(accessToken) {
  return accessToken || pluginSettings()?.[SETTING_KEYS.JEV_ACCESS_TOKEN] || devJevAccessToken() || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve the OpenAI key a Decisions request uses: an explicit key, then the OpenAI API Key setting, then the
//   development OPEN_AI_ACCESS_TOKEN.
// @param {string} [accessToken] - Explicit key, used by tests.
// @returns {string|null} The key, or null when none is set.
export function openAiAccessTokenFromSettings(accessToken) {
  const configuredKey = pluginSettings()?.[SETTING_KEYS.LLM_API_KEY_OPENAI];
  const storedKey = typeof configuredKey === "string" ? configuredKey.trim() : "";
  return accessToken || storedKey || devOpenAiAccessToken() || null;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The decision-model routes this user can be rated through, in the order they are asked. While Jev is healthy it
//   comes first and OpenAI second, as the fallback within a request; after a Jev failure the order flips. A user
//   with only a Jev key keeps Jev after a failure rather than dropping to the fast model, whose smaller pool and
//   different scorerEm would send every project to be ranked again.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { agentProNote, jevFailed, jevKey, openAiKey }.
// @returns {Array<object>} Routes, possibly empty.
function _decisionRoutes(app, { agentProNote, jevFailed, jevKey, openAiKey }) {
  let jevRoute = null;
  if (jevKey) jevRoute = jevKeyRoute(jevKey);
  else if (agentProNote) jevRoute = decisionsRoute(DECISIONS_PROVIDER_JEV, agentProJevRequester(app));
  let openAiRoute = null;
  if (openAiKey) openAiRoute = openAiKeyRoute(openAiKey);
  else if (agentProNote) openAiRoute = decisionsRoute(DECISIONS_PROVIDER_OPENAI, agentProOpenAiRequester(app));
  const orderedRoutes = jevFailed ? [openAiRoute, jevRoute] : [jevRoute, openAiRoute];
  const availableRoutes = orderedRoutes.filter(Boolean);
  return availableRoutes;
}
