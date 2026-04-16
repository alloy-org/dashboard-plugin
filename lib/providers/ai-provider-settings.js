import { apiKeyBucketFromLlmProvider, apiKeyFromProvider, IS_TEST_ENVIRONMENT, SETTING_KEYS } from "constants/settings"
import {
  DEFAULT_MODEL_TOKEN_LIMIT,
  MODELS_PER_PROVIDER,
  MODEL_TOKEN_LIMITS,
  PROVIDER_DEFAULT_MODEL,
  PROVIDER_ENDPOINTS,
} from "constants/llm-providers"

export const AMPLE_AGENT_PRO_UUID = "[uuid tbd]";

// [Claude] Task: add defaultProviderModel and preferredModels required by fetch-ai-provider
// Prompt: "Create a DreamTask widget with an agentic loop to suggest goal-aligned tasks"
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
// --------------------------------------------------------------------------
export function defaultProviderModel(providerEm) {
  return PROVIDER_DEFAULT_MODEL[providerEm] || null;
}

// --------------------------------------------------------------------------
export function preferredModels(app) {
  const providerEm = app.settings[SETTING_KEYS.LLM_PROVIDER_MODEL];
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

// [Claude] Task: read per-provider API key from app.settings with backward-compat fallback
// Prompt: "store the API key in a settings key that corresponds to the provider"
// Date: 2026-04-04 | Model: claude-4.6-opus-high-thinking
// --------------------------------------------------------------------------
export function apiKeyFromApp(app, providerEm) {
  const providerSettingKey = apiKeyFromProvider(providerEm);
  if (providerSettingKey && app.settings[providerSettingKey]) {
    return app.settings[providerSettingKey].trim();
  }
  const legacyKey = app.settings["LLM API Key"];
  if (legacyKey) return legacyKey.trim();
  if (IS_TEST_ENVIRONMENT) {
    throw new Error(`Couldnt find a ${ providerEm } key in ${ JSON.stringify(Object.keys(app.settings)) }`);
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
