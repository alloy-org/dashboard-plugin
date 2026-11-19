// Keeps a short history of when each saved provider API key failed and succeeded, and retires a key that keeps
// failing when the account holds a plugin LLM license (Ample Agent Pro) that can answer in its place. Without this, a
// key that is out of credit or revoked enters every prompt race and fails it, so its errors reach the user even though
// the license could have answered every one of those prompts. Plain module: shared by the host plugin and the embed.
import { apiKeyBucketFromLlmProvider, apiKeyFromProvider, SETTING_KEYS } from "constants/settings"
import { pluginSettings, updatePluginSetting } from "plugin-data"
import { logIfEnabled } from "util/log"

// HTTP statuses that say something about the key itself: rejected, unpaid, forbidden, or out of quota. A timeout,
// network error, or provider 5xx is not the key's fault and is not recorded.
const KEY_FAILURE_STATUSES = [401, 402, 403, 429];
const LOG_LABEL = "[api-key-health]";
const MAX_OUTCOMES_KEPT = 5;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
// Failures since the last success that retire a key regardless of when they happened.
const RETIRE_AFTER_FAILURES = 5;
// Fewer failures also retire a key once they are spread over at least this long, which separates a key that stays
// broken from a burst of rate limiting during one busy run.
const RETIRE_AFTER_SPREAD_FAILURES = 3;
const RETIRE_SPREAD_MILLISECONDS = MILLISECONDS_PER_DAY;
// Characters of a key kept with its history, so that saving a new key starts a fresh history.
const KEY_SUFFIX_LENGTH = 6;

// ----------------------------------------------------------------------------------------------
// @desc The HTTP status a failed request reported, read from the error's status, its response's status, or a
//   "status 429"-style number in its message, but only when that status says the key itself failed.
// @param {*} errorOrReason - An Error, or a failure reason string.
// @returns {number|null} One of KEY_FAILURE_STATUSES, or null when the failure was not the key's.
export function keyFailureStatus(errorOrReason) {
  const directStatus = Number(errorOrReason?.status ?? errorOrReason?.response?.status);
  if (KEY_FAILURE_STATUSES.includes(directStatus)) return directStatus;
  const message = typeof errorOrReason === "string" ? errorOrReason : errorOrReason?.message;
  const statusMatch = /\b(401|402|403|429)\b/.exec(message || "");
  return statusMatch ? Number(statusMatch[1]) : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Record that a request on the user's saved key failed for a reason that implicates the key. When the key's
//   history now meets a retirement rule and the account holds a plugin LLM license, the key is cleared from settings,
//   along with the LLM Provider choice that pointed at it, so later prompts go to the license alone.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {object} options - An object with the following properties:
//   - {string} apiKey - The key the request sent. A key other than the one saved (a dev token) is not tracked
//   - {Function} hasLicense - Async; resolves true when the account's plugin LLM license can answer
//   - {string} providerEm - Provider bucket the key belongs to, such as "openai"
//   - {number} status - The HTTP status, from keyFailureStatus
// @returns {Promise<boolean>} True when the key was retired.
export async function recordApiKeyFailure(app, { apiKey, hasLicense, providerEm, status }) {
  if (!KEY_FAILURE_STATUSES.includes(status)) return false;
  const providerHistory = _savedKeyHistory(app, providerEm, apiKey);
  if (!providerHistory) return false;
  const failures = [...providerHistory.failures, new Date().toISOString()];
  const updatedHistory = { ...providerHistory, failures: failures.slice(-MAX_OUTCOMES_KEPT) };
  _writeHistory(app, providerEm, updatedHistory);
  logIfEnabled(`${ LOG_LABEL } key failure recorded`, { failureCount: updatedHistory.failures.length, providerEm, status });
  if (!shouldRetireKey(updatedHistory)) return false;
  if (!(await hasLicense())) {
    logIfEnabled(`${ LOG_LABEL } key meets retirement rule but no license can replace it`, { providerEm });
    return false;
  }
  if (_savedApiKey(app, providerEm) !== apiKey.trim()) return false;
  _retireKey(app, providerEm);
  return true;
}

// ----------------------------------------------------------------------------------------------
// @desc Record that a request on the user's saved key succeeded. Only written when a failure is on record since the
//   last success, because a success is only needed to excuse earlier failures, and a healthy key would otherwise
//   write a setting on every prompt.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {object} options - { apiKey, providerEm }, as recordApiKeyFailure takes them.
// @returns {boolean} True when the success was written.
export function recordApiKeySuccess(app, { apiKey, providerEm }) {
  const providerHistory = _savedKeyHistory(app, providerEm, apiKey);
  if (!providerHistory || !_failuresSinceLastSuccess(providerHistory).length) return false;
  const successes = [...providerHistory.successes, new Date().toISOString()];
  _writeHistory(app, providerEm, { ...providerHistory, successes: successes.slice(-MAX_OUTCOMES_KEPT) });
  return true;
}

// ----------------------------------------------------------------------------------------------
// @desc Whether a key's history meets a retirement rule: RETIRE_AFTER_FAILURES failures with no success since the
//   first of them, or RETIRE_AFTER_SPREAD_FAILURES such failures whose first and last are at least
//   RETIRE_SPREAD_MILLISECONDS apart.
// @param {object} providerHistory - { failures, successes }: ISO times, oldest first.
// @returns {boolean} True when the key should stop being used.
export function shouldRetireKey(providerHistory) {
  const recentFailures = _failuresSinceLastSuccess(providerHistory);
  if (recentFailures.length >= RETIRE_AFTER_FAILURES) return true;
  if (recentFailures.length < RETIRE_AFTER_SPREAD_FAILURES) return false;
  const failureSpreadMilliseconds = Date.parse(recentFailures[recentFailures.length - 1]) - Date.parse(recentFailures[0]);
  return failureSpreadMilliseconds >= RETIRE_SPREAD_MILLISECONDS;
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The failures recorded after the most recent success.
// @param {object} providerHistory - { failures, successes }: ISO times, oldest first.
// @returns {string[]} Those failures' ISO times, oldest first.
function _failuresSinceLastSuccess(providerHistory) {
  const lastSuccess = providerHistory.successes[providerHistory.successes.length - 1];
  const lastSuccessTime = lastSuccess ? Date.parse(lastSuccess) : -Infinity;
  return providerHistory.failures.filter(failure => Date.parse(failure) > lastSuccessTime);
}

// ----------------------------------------------------------------------------------------------
// @desc Every provider's stored history, parsed from its setting.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @returns {object} Map of providerEm to { failures, keySuffix, successes }; empty when nothing usable is stored.
function _readAllHistories(app) {
  try {
    const parsedHistories = JSON.parse(_readSetting(app, SETTING_KEYS.API_KEY_HEALTH) || "{}");
    return parsedHistories && typeof parsedHistories === "object" && !Array.isArray(parsedHistories) ? parsedHistories : {};
  } catch (error) {
    return {};
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A setting's value, from the embed's snapshot or, on the host where that snapshot is empty, app.settings.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} settingKey - The setting's name.
// @returns {*} The stored value, or undefined.
function _readSetting(app, settingKey) {
  const hostSettings = app?.settings && typeof app.settings === "object" ? app.settings : {};
  return pluginSettings()?.[settingKey] ?? hostSettings[settingKey];
}

// ----------------------------------------------------------------------------------------------
// @desc Clear a provider's saved key and its history, and the LLM Provider choice when it names that provider, so no
//   prompt asks the provider again until the user saves a new key.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} providerEm - Provider bucket whose key is retired.
function _retireKey(app, providerEm) {
  logIfEnabled(`${ LOG_LABEL } retiring saved key in favor of the plugin LLM license`, { providerEm });
  _writeSetting(app, apiKeyFromProvider(providerEm), "");
  const llmProviderChoice = _readSetting(app, SETTING_KEYS.LLM_PROVIDER_MODEL);
  if (apiKeyBucketFromLlmProvider(llmProviderChoice) === providerEm) _writeSetting(app, SETTING_KEYS.LLM_PROVIDER_MODEL, "none");
  const remainingHistories = _readAllHistories(app);
  delete remainingHistories[providerEm];
  _writeSetting(app, SETTING_KEYS.API_KEY_HEALTH, JSON.stringify(remainingHistories));
}

// ----------------------------------------------------------------------------------------------
// @desc The trimmed key saved for a provider.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} providerEm - Provider bucket, such as "openai".
// @returns {string|null} The key, or null when none is saved.
function _savedApiKey(app, providerEm) {
  const settingKey = apiKeyFromProvider(providerEm);
  const savedKey = settingKey ? _readSetting(app, settingKey) : null;
  return typeof savedKey === "string" && savedKey.trim() ? savedKey.trim() : null;
}

// ----------------------------------------------------------------------------------------------
// @desc The stored history for a request's key, when that key is the one saved for its provider. History stored for
//   a different key is discarded, so a newly saved key is not retired for its predecessor's failures.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} providerEm - Provider bucket the key belongs to.
// @param {string} apiKey - The key the request sent.
// @returns {object|null} { failures, keySuffix, successes }, or null when the request's key is not the saved key.
function _savedKeyHistory(app, providerEm, apiKey) {
  const savedKey = _savedApiKey(app, providerEm);
  if (!savedKey || typeof apiKey !== "string" || savedKey !== apiKey.trim()) return null;
  const keySuffix = savedKey.slice(-KEY_SUFFIX_LENGTH);
  const storedHistory = _readAllHistories(app)[providerEm];
  if (!storedHistory || storedHistory.keySuffix !== keySuffix) return { failures: [], keySuffix, successes: [] };
  const failures = Array.isArray(storedHistory.failures) ? storedHistory.failures : [];
  const successes = Array.isArray(storedHistory.successes) ? storedHistory.successes : [];
  return { failures, keySuffix, successes };
}

// ----------------------------------------------------------------------------------------------
// @desc Store one provider's history beside the others.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} providerEm - Provider bucket the history belongs to.
// @param {object} providerHistory - { failures, keySuffix, successes }.
function _writeHistory(app, providerEm, providerHistory) {
  const allHistories = { ..._readAllHistories(app), [providerEm]: providerHistory };
  _writeSetting(app, SETTING_KEYS.API_KEY_HEALTH, JSON.stringify(allHistories));
}

// ----------------------------------------------------------------------------------------------
// @desc Write a setting to the host and to the embed's snapshot together. The snapshot is updated synchronously so
//   that concurrent prompts reading the history before the host write lands still see one another's entries.
// @param {object} app - Host-compatible Amplenote API, or the embed's bridge proxy.
// @param {string} settingKey - The setting's name.
// @param {string} value - The value to store.
function _writeSetting(app, settingKey, value) {
  updatePluginSetting(settingKey, value);
  Promise.resolve(app?.setSetting?.(settingKey, value)).catch(error =>
    logIfEnabled(`${ LOG_LABEL } setSetting failed`, { errorMessage: error?.message, settingKey }));
}
