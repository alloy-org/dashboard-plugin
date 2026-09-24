// Report whether the dashboard can reach an LLM at all, so a feature that cannot run without one can say so up
// front instead of failing partway through. Three sources qualify and any one of them is enough: an API key the
// user saved in Dashboard Settings, a development environment token, and the Ample Agent Pro plugin, which runs
// prompts on the user's own plugin credentials and so needs no key of its own.
//
// The Agent Pro lookup is made only when no key is configured, since a key already settles the question and the
// lookup costs a round trip to the host. Until it answers, the result reports itself as still checking, so a
// caller that blocks on missing access does not flash that block at a user who turns out to have Agent Pro.

import { configuredProviderEms, devTokenPresent } from "constants/settings";
import { pluginSettings } from "plugin-data";
import { AMPLE_AGENT_PRO_NOTE_NAME } from "providers/ai-provider-settings";
import { useEffect, useState } from "react";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Resolve whether any LLM source is available to the dashboard right now. The settings read happens on
//   every render against the embed's settings snapshot, which saveSettings refreshes through updatePluginSetting
//   the moment a key is saved, so a component that mounts after a visit to Dashboard Settings sees the new key
//   without any further plumbing.
// @param {object} app - Amplenote embed app proxy, used to look up the Ample Agent Pro note.
// @returns {object} An object with the following properties:
//   - {boolean} hasLlmProviderAccess - True once a configured key, a dev token, or Ample Agent Pro was found.
//   - {boolean} isCheckingLlmProviderAccess - True while the Ample Agent Pro lookup is still in flight.
export default function useLlmProviderAccess(app) {
  const [ampleAgentProAvailable, setAmpleAgentProAvailable] = useState(null);
  const keyedProviderEms = configuredProviderEms(pluginSettings());
  const hasProviderKey = keyedProviderEms.length > 0 || devTokenPresent();

  useEffect(() => {
    if (hasProviderKey) return undefined;
    let isActive = true;
    Promise.resolve(app.findNote({ name: AMPLE_AGENT_PRO_NOTE_NAME }))
      .then(agentProNote => { if (isActive) setAmpleAgentProAvailable(!!agentProNote); })
      .catch(lookupError => {
        logIfEnabled("[llm-provider-access] could not look up Ample Agent Pro", lookupError?.message || lookupError);
        if (isActive) setAmpleAgentProAvailable(false);
      });
    return () => { isActive = false; };
  }, [app, hasProviderKey]);

  const hasLlmProviderAccess = hasProviderKey || ampleAgentProAvailable === true;
  const isCheckingLlmProviderAccess = !hasProviderKey && ampleAgentProAvailable === null;
  return { hasLlmProviderAccess, isCheckingLlmProviderAccess };
}
