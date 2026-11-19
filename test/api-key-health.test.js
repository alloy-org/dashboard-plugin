// Covers when a saved provider key is retired in favor of the plugin LLM license, and the two request paths that
// feed its history: the direct provider fetch and callLLM with a userApiKey.
import { jest } from "@jest/globals";
import { SETTING_KEYS } from "constants/settings";
import { pluginSettings, setPluginData } from "plugin-data";
import { amplenoteLlmPrompt } from "providers/amplenote-llm";
import { keyFailureStatus, recordApiKeyFailure, recordApiKeySuccess, shouldRetireKey } from "providers/api-key-health";
import { llmPrompt } from "providers/fetch-ai-provider";

const OPENAI_KEY = "sk-test-openai-key-123456";
const hasLicense = jest.fn();

// ----------------------------------------------------------------------------------------------
// @desc An app whose setSetting is observable, with an OpenAI key saved and chosen as the LLM Provider.
// @returns {object} The app interface.
function appWithSavedKey() {
  setPluginData({ settings: { [SETTING_KEYS.LLM_API_KEY_OPENAI]: OPENAI_KEY, [SETTING_KEYS.LLM_PROVIDER_MODEL]: "openai" } });
  return { setSetting: jest.fn().mockResolvedValue(undefined) };
}

// ----------------------------------------------------------------------------------------------
// @desc Record one failure at a given time.
// @param {object} app - The app interface.
// @param {string} isoTime - When the failure happened.
// @returns {Promise<boolean>} Whether the key was retired.
async function failAt(app, isoTime) {
  jest.setSystemTime(new Date(isoTime));
  return recordApiKeyFailure(app, { apiKey: OPENAI_KEY, hasLicense, providerEm: "openai", status: 429 });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  hasLicense.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("shouldRetireKey", () => {
  it("retires after five failures with no success since", () => {
    const failures = ["2026-11-19T10:00:00Z", "2026-11-19T10:01:00Z", "2026-11-19T10:02:00Z", "2026-11-19T10:03:00Z", "2026-11-19T10:04:00Z"];
    expect(shouldRetireKey({ failures, successes: [] })).toBe(true);
    expect(shouldRetireKey({ failures, successes: ["2026-11-19T10:02:30Z"] })).toBe(false);
  });

  it("retires after three failures spread over a day, but not three in a burst", () => {
    const spreadFailures = ["2026-11-17T10:00:00Z", "2026-11-17T18:00:00Z", "2026-11-18T10:00:00Z"];
    const burstFailures = ["2026-11-18T10:00:00Z", "2026-11-18T10:00:05Z", "2026-11-18T10:00:09Z"];
    expect(shouldRetireKey({ failures: spreadFailures, successes: [] })).toBe(true);
    expect(shouldRetireKey({ failures: burstFailures, successes: [] })).toBe(false);
  });
});

describe("keyFailureStatus", () => {
  it.each([
    [{ status: 401 }, 401],
    [{ response: { status: 429 } }, 429],
    [new Error("Request failed with status 402"), 402],
    ["provider said 403 forbidden", 403],
    [new Error("Request failed with status 500"), null],
    [new Error("Timeout"), null],
  ])("reads %p as %p", (errorOrReason, expectedStatus) => {
    expect(keyFailureStatus(errorOrReason)).toBe(expectedStatus);
  });
});

describe("recordApiKeyFailure", () => {
  it("clears the key and the provider choice once the rule is met and a license can answer", async () => {
    const app = appWithSavedKey();
    const retiredResults = [];
    for (const minute of ["00", "01", "02", "03", "04"]) retiredResults.push(await failAt(app, `2026-11-19T10:${ minute }:00Z`));
    expect(retiredResults).toEqual([false, false, false, false, true]);
    expect(pluginSettings()[SETTING_KEYS.LLM_API_KEY_OPENAI]).toBe("");
    expect(pluginSettings()[SETTING_KEYS.LLM_PROVIDER_MODEL]).toBe("none");
    expect(JSON.parse(pluginSettings()[SETTING_KEYS.API_KEY_HEALTH])).toEqual({});
    expect(app.setSetting).toHaveBeenCalledWith(SETTING_KEYS.LLM_API_KEY_OPENAI, "");
  });

  it("keeps the key when no license could answer in its place", async () => {
    hasLicense.mockResolvedValue(false);
    const app = appWithSavedKey();
    for (const minute of ["00", "01", "02", "03", "04"]) await failAt(app, `2026-11-19T10:${ minute }:00Z`);
    expect(pluginSettings()[SETTING_KEYS.LLM_API_KEY_OPENAI]).toBe(OPENAI_KEY);
  });

  it("is excused by a success between failures", async () => {
    const app = appWithSavedKey();
    for (const minute of ["00", "01", "02"]) await failAt(app, `2026-11-19T10:${ minute }:00Z`);
    jest.setSystemTime(new Date("2026-11-19T10:03:00Z"));
    expect(recordApiKeySuccess(app, { apiKey: OPENAI_KEY, providerEm: "openai" })).toBe(true);
    for (const minute of ["04", "05", "06", "07"]) await failAt(app, `2026-11-19T10:${ minute }:00Z`);
    expect(pluginSettings()[SETTING_KEYS.LLM_API_KEY_OPENAI]).toBe(OPENAI_KEY);
  });

  it("ignores a key other than the saved one, and starts fresh when a new key is saved", async () => {
    const app = appWithSavedKey();
    await recordApiKeyFailure(app, { apiKey: "dev-token", hasLicense, providerEm: "openai", status: 401 });
    expect(pluginSettings()[SETTING_KEYS.API_KEY_HEALTH]).toBeUndefined();
    for (const minute of ["00", "01", "02", "03"]) await failAt(app, `2026-11-19T10:${ minute }:00Z`);
    pluginSettings()[SETTING_KEYS.LLM_API_KEY_OPENAI] = "sk-new-key-abcdef";
    jest.setSystemTime(new Date("2026-11-19T10:05:00Z"));
    await recordApiKeyFailure(app, { apiKey: "sk-new-key-abcdef", hasLicense, providerEm: "openai", status: 401 });
    expect(JSON.parse(pluginSettings()[SETTING_KEYS.API_KEY_HEALTH]).openai.failures).toHaveLength(1);
  });

  it("does not write a success for a key with no failures on record", () => {
    const app = appWithSavedKey();
    expect(recordApiKeySuccess(app, { apiKey: OPENAI_KEY, providerEm: "openai" })).toBe(false);
    expect(app.setSetting).not.toHaveBeenCalled();
  });
});

describe("request paths", () => {
  let originalFetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it("records a direct provider 429 against the saved key", async () => {
    const app = appWithSavedKey();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    await expect(llmPrompt(app, null, "prompt", "gpt-5.6", OPENAI_KEY, true, 5)).rejects.toThrow("status 429");
    expect(JSON.parse(pluginSettings()[SETTING_KEYS.API_KEY_HEALTH]).openai.failures).toHaveLength(1);
  });

  it("records a callLLM failure on the saved key, then retries on the license", async () => {
    const app = appWithSavedKey();
    const keyError = Object.assign(new Error("Request failed with status 401"), { status: 401 });
    app.callLLM = jest.fn(async options => (options.checkQuota ? 5 : { textOutput: "licensed answer" }));
    app.callLLM.mockRejectedValueOnce(keyError);
    await expect(amplenoteLlmPrompt(app, "prompt", { aiModel: "gpt-5.6" })).resolves.toBe("licensed answer");
    expect(JSON.parse(pluginSettings()[SETTING_KEYS.API_KEY_HEALTH]).openai.failures).toHaveLength(1);
  });
});
