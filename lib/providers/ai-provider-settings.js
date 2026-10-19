import { apiKeyBucketFromLlmProvider, apiKeyFromProvider, configuredProviderEms, IS_TEST_ENVIRONMENT, SETTING_KEYS } from "constants/settings"
import {
  DEFAULT_MODEL_TOKEN_LIMIT,
  MODELS_PER_PROVIDER,
  MODEL_TOKEN_LIMITS,
  PROVIDER_DEFAULT_MODEL,
  FAST_TIER_REASONING_EFFORT,
  INCIDENTAL_TIER_REASONING_EFFORT,
  PROVIDER_FAST_MODEL,
  PROVIDER_INCIDENTAL_MODEL,
  PROVIDER_ENDPOINTS,
} from "constants/llm-providers"
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer"
import { pluginSettings } from "plugin-data"
import { logIfEnabled } from "util/log"

export const AMPLE_AGENT_PRO_NOTE_NAME = "Ample Agent Pro";
export const AMPLE_AGENT_PRO_UUID = "XrxhGWPbbmgSBJ6fSCVns57k";
// The plugin listing Proposed Agenda and Quarterly Planning open when Agent Pro is not installed.
export const AMPLE_AGENT_PRO_URL = "https://www.amplenote.com/plugins/ample_agent_pro";

// The Agent Pro note each app interface has found. Only a found note is kept: once installed for this session, a
// later lookup that misses is a sync gap, not an uninstall, and must not show the upsell to a subscriber.
const ampleAgentProNotesByApp = new WeakMap();
// The lookup in flight for each app interface, shared so the widgets and services that ask at once make one lookup.
const ampleAgentProLookupsByApp = new WeakMap();
// App interfaces through which Agent Pro has answered a callPlugin request, which proves it installed without a note.
const appsWithRespondingAgentPro = new WeakSet();

// [Claude] Task: add defaultProviderModel and preferredModels required by fetch-ai-provider
// Prompt: "Create a DreamTask widget with an agentic loop to suggest goal-aligned tasks"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// --------------------------------------------------------------------------
export function defaultProviderModel(providerEm) {
  return PROVIDER_DEFAULT_MODEL[providerEm] || null;
}

// --------------------------------------------------------------------------
export function preferredModels() {
  const providerEm = pluginSettings()[SETTING_KEYS.LLM_PROVIDER_MODEL];
  if (!providerEm || providerEm === 'none') return [];
  const bucketEm = apiKeyBucketFromLlmProvider(providerEm) || providerEm;
  const models = MODELS_PER_PROVIDER[bucketEm];
  if (!models || models.length === 0) return [];
  const defaultModel = PROVIDER_DEFAULT_MODEL[bucketEm];
  if (defaultModel) {
    return [defaultModel, ...models.filter(m => m !== defaultModel)];
  }
  return [...models];
}

// [Claude] Task: read per-provider API key from embed-side settings with backward-compat fallback
// Prompt: "store the API key in a settings key that corresponds to the provider"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
// [Claude claude-opus-4-7] Refactor: read from pluginSettings() rather than app.settings;
//   still takes `app` because it may need to surface a user-facing alert.
// --------------------------------------------------------------------------
export function apiKeyFromApp(app, providerEm) {
  const settings = pluginSettings();
  const providerSettingKey = apiKeyFromProvider(providerEm);
  if (providerSettingKey && settings[providerSettingKey]) {
    return settings[providerSettingKey].trim();
  }
  const legacyKey = settings["LLM API Key"];
  if (legacyKey) return legacyKey.trim();
  if (IS_TEST_ENVIRONMENT) {
    throw new Error(`Couldnt find a ${ providerEm } key in ${ JSON.stringify(Object.keys(settings)) }`);
  } else {
    app.alert("Please configure your API key in plugin settings.");
  }
  return null;
}

// --------------------------------------------------------------------------
export function modelTokenLimit(model) {
  return MODEL_TOKEN_LIMITS[model] || DEFAULT_MODEL_TOKEN_LIMIT;
}

// --------------------------------------------------------------------------
// Get the API endpoint URL for a given provider and model
// Some providers (like Gemini) include the model name and/or API key in the URL
// See: https://ai.google.dev/gemini-api/docs/text-generation#generate-text
export function providerEndpointUrl(model, apiKey) {
  const providerEm = providerFromModel(model);
  let endpoint = PROVIDER_ENDPOINTS[providerEm];
  endpoint = endpoint.replace('{model-name}', model);
  // Gemini uses API key as URL query parameter
  if (providerEm === "gemini") {
    endpoint = `${ endpoint }?key=${ apiKey }`;
  }
  // Anthropic blocks CORS requests, so we route through a proxy
  return endpoint;
}

// --------------------------------------------------------------------------
// Determine which provider a model belongs to based on the model name
export function providerFromModel(model) {
  for (const [providerEm, models] of Object.entries(MODELS_PER_PROVIDER)) {
    if (models.includes(model)) {
      return providerEm;
    }
  }
  throw new Error(`Model ${ model } not found in any provider`);
}

// --------------------------------------------------------------------------
export function providerNameFromProviderEm(providerEm) {
  const providerNames = {
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    gemini: "Gemini",
    grok: "Grok",
    openai: "OpenAI",
    perplexity: "Perplexity",
  };
  return providerNames[providerEm] || providerEm.charAt(0).toUpperCase() + providerEm.slice(1);
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the fast model and matching API key for a caller that must answer inside a short timeout, such as the
//   plan wizard's one-minute budget. Naming a model alone is not enough: makeRequest resolves the key from whichever
//   provider the model belongs to, so a model the user has no key for produces a request with a null key rather than
//   a fallback. This returns the model and its key together, and only ever names a provider the user has a key for.
//
//   Gemini is preferred when configured because its flash tier is the fastest of the registered options; otherwise
//   the dashboard's own configured provider is used, and any other keyed provider only as a last resort. A provider
//   with no fast tier falls back to its default model, which is still better than a request that cannot authenticate.
// @param {Object} settings - Settings map, normally pluginSettings().
// @returns {Object|null} An object with the following properties, or null when no provider has a usable key:
//   - {string} aiModel - The model id to request
//   - {string} apiKey - The key belonging to that model's provider
//   - {string} providerEm - The provider bucket the model and key came from
//   - {string|null} reasoningEffort - The capped reasoning budget for a provider whose fast tier is a reasoning
//     model, or null for a provider whose fast tier is already a small model
export function fastModelOptions(settings) {
  const keyedProviderEms = configuredProviderEms(settings);
  if (!keyedProviderEms.length) return null;
  const dashboardBucket = apiKeyBucketFromLlmProvider(settings?.[SETTING_KEYS.LLM_PROVIDER_MODEL]);
  const preferenceOrder = ["gemini", dashboardBucket, ...keyedProviderEms];
  const chosenProviderEm = preferenceOrder.find(providerEm => providerEm && keyedProviderEms.includes(providerEm));
  if (!chosenProviderEm) return null;
  const aiModel = PROVIDER_FAST_MODEL[chosenProviderEm] || PROVIDER_DEFAULT_MODEL[chosenProviderEm] || null;
  const apiKey = (settings?.[apiKeyFromProvider(chosenProviderEm)] || "").trim();
  if (!aiModel || !apiKey) return null;
  const reasoningEffort = chosenProviderEm === "openai" ? FAST_TIER_REASONING_EFFORT : null;
  return { aiModel, apiKey, providerEm: chosenProviderEm, reasoningEffort };
}

// ----------------------------------------------------------------------------------------------
// @desc Choose the model and matching API key for incidental text, such as the benefit sentence on an agenda
//   suggestion, where a quick answer matters more than a considered one. The provider is chosen exactly as
//   fastModelOptions chooses it; a provider with a smaller incidental model is asked for that model with its
//   reasoning switched off, and any other provider answers with its fast tier.
// @param {Object} settings - Settings map, normally pluginSettings().
// @returns {Object|null} { aiModel, apiKey, providerEm, reasoningEffort }, as fastModelOptions returns, or null when
//   no provider has a usable key.
export function incidentalModelOptions(settings) {
  const fastOptions = fastModelOptions(settings);
  if (!fastOptions) return null;
  const incidentalModel = PROVIDER_INCIDENTAL_MODEL[fastOptions.providerEm];
  if (!incidentalModel) return fastOptions;
  const reasoningEffort = fastOptions.providerEm === "openai" ? INCIDENTAL_TIER_REASONING_EFFORT : null;
  return { ...fastOptions, aiModel: incidentalModel, reasoningEffort };
}

// ----------------------------------------------------------------------------------------------
// @desc Look up the Ample Agent Pro note, which is what tells the dashboard the plugin is installed and can
//   run a prompt without a local API key. A client opened moments ago may not have synced its notes list yet, so a
//   miss refreshes the list and looks again before concluding the note is absent. A found note is remembered for the
//   rest of the session, and concurrent callers share one lookup. A missing note, a lookup that throws, or an app
//   that cannot search notes all count as not installed, so every caller gets the same answer.
// @param {Object} app - Amplenote app interface
// @returns {Promise<Object|null>} The note handle, or null when Agent Pro is not installed
export async function findAmpleAgentProNote(app) {
  if (typeof app?.findNote !== "function") return null;
  if (ampleAgentProNotesByApp.has(app)) return ampleAgentProNotesByApp.get(app);
  if (!ampleAgentProLookupsByApp.has(app)) {
    const lookup = _lookUpAmpleAgentProNote(app).finally(() => ampleAgentProLookupsByApp.delete(app));
    ampleAgentProLookupsByApp.set(app, lookup);
  }
  return ampleAgentProLookupsByApp.get(app);
}

// ----------------------------------------------------------------------------------------------
// @desc Decide whether Ample Agent Pro is installed: either it has already answered a callPlugin request through
//   this app interface, or its note can be found. Use this to decide whether to offer Agent Pro to the user, where
//   only a confirmed absence may show the upsell.
// @param {Object} app - Amplenote app interface
// @returns {Promise<boolean>} True when Agent Pro is installed
export async function isAmpleAgentProInstalled(app) {
  if (app && appsWithRespondingAgentPro.has(app)) return true;
  const agentProNote = await findAmpleAgentProNote(app);
  return !!agentProNote;
}

// ----------------------------------------------------------------------------------------------
// @desc Record that Ample Agent Pro answered a callPlugin request through this app interface, so later checks
//   report it installed even when its note lookup misses.
// @param {Object} app - Amplenote app interface that reached Agent Pro
export function recordAmpleAgentProResponded(app) {
  if (app && typeof app === "object") appsWithRespondingAgentPro.add(app);
}

// ----------------------------------------------------------------------------------------------
// @desc Find the Agent Pro note, refreshing the notes list and searching once more when the first search misses.
//   A found note is remembered for the app interface.
// @param {Object} app - Amplenote app interface exposing findNote
// @returns {Promise<Object|null>} The note handle, or null when neither search finds it
async function _lookUpAmpleAgentProNote(app) {
  let agentProNote = await _findAmpleAgentProNoteOnce(app);
  if (!agentProNote) {
    const refreshed = await DashboardNoteWriter.forApp(app).refreshNotesList();
    logIfEnabled("[agent-pro] Ample Agent Pro note not found; searching again after notes list refresh", { refreshed });
    agentProNote = await _findAmpleAgentProNoteOnce(app);
  }
  if (agentProNote) ampleAgentProNotesByApp.set(app, agentProNote);
  return agentProNote;
}

// ----------------------------------------------------------------------------------------------
// @desc Search for the Agent Pro note once. A result without a uuid, such as the embed bridge's failure envelope,
//   is not a note.
// @param {Object} app - Amplenote app interface exposing findNote
// @returns {Promise<Object|null>} The note handle, or null when it was not found or the search failed
async function _findAmpleAgentProNoteOnce(app) {
  try {
    const agentProNote = await app.findNote({ name: AMPLE_AGENT_PRO_NOTE_NAME });
    return agentProNote?.uuid ? agentProNote : null;
  } catch (error) {
    logIfEnabled("[agent-pro] could not look up Ample Agent Pro", error?.message || error);
    return null;
  }
}
