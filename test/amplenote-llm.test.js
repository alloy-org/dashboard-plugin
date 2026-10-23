// isAmplenoteLlmAvailable decides whether the account's plugin LLM license can answer, which is what lets a keyless
// widget skip its upsell. A quota check that throws, reports nothing left, or comes back as the embed bridge's failure
// envelope counts as unavailable; a license that has answered once stays available for the app interface.
import { jest } from "@jest/globals";
import { amplenoteLlmPrompt, isAmplenoteLlmAvailable } from "providers/amplenote-llm";

describe("isAmplenoteLlmAvailable", () => {
  it("reports available when the quota check returns dollars remaining", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue(4.5) };
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
    expect(app.callLLM).toHaveBeenCalledWith({ checkQuota: true });
  });

  it.each([
    ["throws for want of a license", jest.fn().mockRejectedValue(new Error("No plugin LLM license"))],
    ["reports no quota remaining", jest.fn().mockResolvedValue(0)],
    ["resolves the bridge's failure envelope", jest.fn().mockResolvedValue({ embedCallFailed: true, error: "no license" })],
  ])("reports unavailable when the quota check %s", async (_label, callLLM) => {
    await expect(isAmplenoteLlmAvailable({ callLLM })).resolves.toBe(false);
  });

  it("shares one check between concurrent callers and keeps a positive answer", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue(2) };
    const [first, second] = await Promise.all([isAmplenoteLlmAvailable(app), isAmplenoteLlmAvailable(app)]);
    app.callLLM.mockRejectedValue(new Error("transient"));
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
    expect([first, second]).toEqual([true, true]);
    expect(app.callLLM).toHaveBeenCalledTimes(1);
  });

  it("asks again after an unavailable answer", async () => {
    const app = { callLLM: jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(3) };
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(false);
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
  });

  it("reports available once a prompt has been answered, without a quota check", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue({ textOutput: "hello" }) };
    await amplenoteLlmPrompt(app, "prompt");
    await expect(isAmplenoteLlmAvailable(app)).resolves.toBe(true);
    expect(app.callLLM).toHaveBeenCalledTimes(1);
  });
});

describe("amplenoteLlmPrompt", () => {
  it("asks callLLM's lowest reasoning budget for one it does not offer, and forwards one it does", async () => {
    const app = { callLLM: jest.fn().mockResolvedValue({ textOutput: "ok" }) };
    await amplenoteLlmPrompt(app, "prompt", { reasoningEffort: "none" });
    await amplenoteLlmPrompt(app, "prompt", { reasoningEffort: "high" });
    expect(app.callLLM.mock.calls.map(([options]) => options.reasoningEffort)).toEqual(["low", "high"]);
  });

  it("resolves null rather than rejecting when callLLM throws", async () => {
    const app = { callLLM: jest.fn().mockRejectedValue(new Error("LLM API request timed out")) };
    await expect(amplenoteLlmPrompt(app, "prompt", { jsonResponse: true })).resolves.toBeNull();
  });
});
