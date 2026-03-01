import { IS_TEST_ENVIRONMENT, SETTING_KEYS } from "constants/settings"
import {
  DEFAULT_MODEL_TOKEN_LIMIT,
  MODELS_PER_PROVIDER,
  MODEL_TOKEN_LIMITS,
  PROVIDER_ENDPOINTS,
} from "constants/provider"

// --------------------------------------------------------------------------
export function apiKeyFromApp(app, providerEm) {
  const providerKeyLabel = SETTING_KEYS.LLM_PROVIDER;
  if (app.settings[providerKeyLabel]) {
    return app.settings[providerKeyLabel].trim();
  } else {
    if (IS_TEST_ENVIRONMENT) {
      throw new Error(`Couldnt find a ${ providerEm } key in ${ app.settings }`);
    } else {
      app.alert("Please configure your OpenAI key in plugin settings.");
    }
    return null;
  }
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
