// Report whether the dashboard can reach an LLM at all, so a feature that cannot run without one can say so up
// front instead of failing partway through. Three sources qualify and any one of them is enough: an API key the
// user saved in Dashboard Settings, a development environment token, and app.callLLM, which runs prompts on the
// account's plugin LLM license and so needs no key of its own.
//
// The license's quota check is made only when no key is configured, since a key already settles the question and the
// check costs a round trip to the host. Until it answers, the result reports itself as still checking, so a caller
// that blocks on missing access does not flash that block at a user who turns out to have a license.

import { configuredProviderEms, devTokenPresent } from "constants/settings";
import { pluginSettings } from "plugin-data";
import { isAmplenoteLlmAvailable } from "providers/amplenote-llm";
import { useEffect, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Resolve whether any LLM source is available to the dashboard right now. The settings read happens on
//   every render against the embed's settings snapshot, which saveSettings refreshes through updatePluginSetting
//   the moment a key is saved, so a component that mounts after a visit to Dashboard Settings sees the new key
//   without any further plumbing.
// @param {object} app - Amplenote embed app proxy, used to check the plugin LLM license's quota.
// @returns {object} An object with the following properties:
//   - {boolean} hasLlmProviderAccess - True once a configured key, a dev token, or a plugin LLM license was found.
//   - {boolean} isCheckingLlmProviderAccess - True while the license's quota check is still in flight.
export default function useLlmProviderAccess(app) {
  const [amplenoteLlmAvailable, setAmplenoteLlmAvailable] = useState(null);
  const keyedProviderEms = configuredProviderEms(pluginSettings());
  const hasProviderKey = keyedProviderEms.length > 0 || devTokenPresent();

  useEffect(() => {
    if (hasProviderKey) return undefined;
    let isActive = true;
    isAmplenoteLlmAvailable(app).then(isAvailable => { if (isActive) setAmplenoteLlmAvailable(isAvailable); });
    return () => { isActive = false; };
  }, [app, hasProviderKey]);

  const hasLlmProviderAccess = hasProviderKey || amplenoteLlmAvailable === true;
  const isCheckingLlmProviderAccess = !hasProviderKey && amplenoteLlmAvailable === null;
  return { hasLlmProviderAccess, isCheckingLlmProviderAccess };
}
