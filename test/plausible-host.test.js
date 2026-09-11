// Coverage for the host-side Plausible transport: payload shape, and the guards that keep a failed or absent
// tracker from breaking the plugin action that reported to it.
import { jest } from "@jest/globals";

const { snapHostAction } = await import("util/plausible-host");

const EVENT_ENDPOINT = "https://www.amplenote.com/plausible-proxy/api/event";

// ----------------------------------------------------------------------------------------------
// @desc Parsed request body from the single fetch the transport is expected to have issued.
// @param {jest.Mock} fetchMock - The stand-in for global fetch.
// @returns {Object} The Plausible events API payload that was posted.
function _postedPayload(fetchMock) {
  const [, requestInit] = fetchMock.mock.calls[0];
  return JSON.parse(requestInit.body);
}

afterEach(() => {
  delete global.fetch;
  jest.useRealTimers();
});

test("posts a Dashboard Action event carrying the action and its props", async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, status: 202 }));
  global.fetch = fetchMock;

  await expect(snapHostAction("suggestScheduledTasks", { count: 3, outcome: "success" })).resolves.toBe(true);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(EVENT_ENDPOINT);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  expect(_postedPayload(fetchMock)).toEqual({ domain: "amplenote.com", name: "Dashboard Action",
    props: { action: "suggestScheduledTasks", count: 3, outcome: "success" },
    url: "https://www.amplenote.com/dashboard-plugin/host" });
});

test("no-ops without attempting a request when the host has no fetch", async () => {
  await expect(snapHostAction("suggestScheduledTasks")).resolves.toBe(false);
});

test("reports failure rather than throwing when the proxy rejects the event", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404 }));

  await expect(snapHostAction("suggestScheduledTasks")).resolves.toBe(false);
});

test("reports failure rather than throwing when the request itself errors", async () => {
  global.fetch = jest.fn(async () => { throw new Error("Failed to fetch"); });

  await expect(snapHostAction("suggestScheduledTasks")).resolves.toBe(false);
});

test("abandons a request the proxy never answers", async () => {
  jest.useFakeTimers();
  let abortSignal = null;
  global.fetch = jest.fn((_endpoint, requestInit) => {
    abortSignal = requestInit.signal;
    return new Promise((_resolve, reject) =>
      requestInit.signal?.addEventListener("abort", () => reject(new Error("Aborted"))));
  });

  const snapPromise = snapHostAction("suggestScheduledTasks");
  await jest.advanceTimersByTimeAsync(3000);

  await expect(snapPromise).resolves.toBe(false);
  expect(abortSignal.aborted).toBe(true);
});
