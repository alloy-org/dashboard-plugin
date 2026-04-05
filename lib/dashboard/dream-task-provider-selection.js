/**
 * [gpt-5.3-codex-authored file]
 * Prompt summary: "On reseed, ask user which configured AI provider to use when multiple keys exist"
 */
import { PROVIDER_DEFAULT_MODEL } from "constants/llm-providers";
import { apiKeyFromProvider, PROVIDER_SETTING_KEY_LABELS } from "constants/settings";
import { providerNameFromProviderEm } from "providers/ai-provider-settings";

const CANDIDATE_PROVIDER_EMS = Object.keys(PROVIDER_SETTING_KEY_LABELS || {});

// ----------------------------------------------------------------------------------------------
// @desc Prompt for a provider only when multiple provider API keys are configured.
// @param {object} app - Amplenote app bridge with settings + prompt.
// @param {string|null} currentProviderEm - Current provider id (for "(current)" label and ordering).
// @returns {Promise<object|null>} Selected provider object or null when canceled / no configured keys.
// [Claude gpt-5.3-codex] Task: decide reseed provider and optionally prompt user when multiple keys exist
// Prompt: "On reseed, if multiple provider API keys exist, ask which provider to use"
export async function chooseReseedProvider(app, currentProviderEm) {
  const configuredProviders = configuredProvidersFromSettings(app?.settings);
  if (configuredProviders.length === 0) return null;
  if (configuredProviders.length === 1) return configuredProviders[0];

  const prioritized = [...configuredProviders].sort((left, right) => {
    if (left.providerEm === currentProviderEm) return -1;
    if (right.providerEm === currentProviderEm) return 1;
    return left.providerName.localeCompare(right.providerName);
  });
  const firstValue = prioritized[0]?.providerEm || null;

  const result = await app.prompt("Reseed suggestions with which AI provider?", {
    inputs: [{
      label: "Provider",
      type: "radio",
      value: firstValue,
      options: prioritized.map(provider => ({
        label: provider.providerEm === currentProviderEm
          ? `${ provider.providerName } (current)`
          : provider.providerName,
        value: provider.providerEm,
      })),
    }],
  });

  if (result == null) return null;
  const selectedProviderEm = promptValueFromResult(result) || firstValue;
  return prioritized.find(provider => provider.providerEm === selectedProviderEm) || null;
}

// ----------------------------------------------------------------------------------------------
// @desc Collect provider entries for each configured (non-empty) provider API key in app settings.
// @param {object} settings - app.settings map.
// @returns {Array<object>} Ordered provider rows with providerEm/providerName/apiKey/model.
// [Claude gpt-5.3-codex] Task: collect configured provider keys for reseed provider selection
// Prompt: "When reseeding, check whether multiple AI API keys are configured"
export function configuredProvidersFromSettings(settings) {
  const configured = [];
  const safeSettings = settings || {};
  for (const providerEm of CANDIDATE_PROVIDER_EMS) {
    const keySetting = apiKeyFromProvider(providerEm);
    if (!keySetting) continue;
    const apiKey = (safeSettings[keySetting] || "").trim();
    if (!apiKey) continue;
    configured.push({
      apiKey,
      model: PROVIDER_DEFAULT_MODEL[providerEm] || null,
      providerEm,
      providerName: providerNameFromProviderEm(providerEm),
    });
  }
  return configured;
}

// ----------------------------------------------------------------------------------------------
// @desc Normalize `app.prompt` return values into a selected provider id.
// @param {string|Array<string>|object|null} promptResult - Prompt response payload.
// @returns {string|null} Selected provider id.
// [Claude gpt-5.3-codex] Task: normalize app.prompt response for provider-choice dialogs
// Prompt: "Use a dialog to let the user choose which provider to reseed with"
function promptValueFromResult(promptResult) {
  if (typeof promptResult === "string") return promptResult;
  if (Array.isArray(promptResult) && promptResult.length > 0) {
    return typeof promptResult[0] === "string" ? promptResult[0] : null;
  }
  if (promptResult && typeof promptResult === "object") {
    const values = Object.values(promptResult);
    if (values.length > 0 && typeof values[0] === "string") return values[0];
  }
  return null;
}
