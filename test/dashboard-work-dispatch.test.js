// Exercise the provider and app dispatchers over the resource budget: nested batches across jobs never exceed a
// provider's limit, permits return as each request ends, foreground requests overtake waiting maintenance, an aborted
// wait leaves the line, and a note write takes its write permit only once its turn in the note's chain arrives.
import { createAppDispatch } from "dashboard/work-queue/dashboard-app-dispatch";
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";
import { createProviderDispatch } from "dashboard/work-queue/dashboard-provider-dispatch";
import DashboardResourceBudget from "dashboard/work-queue/dashboard-resource-budget";
import { flushPromises } from "./work-queue-test-notes";

// ----------------------------------------------------------------------------------------------
// @desc A provider operation that stays open until the test releases it, counting how many run at once.
// @param {object} tracker - { active, maximum, started }, updated in place.
// @returns {object} { operation, releaseNext }: operation(label) makes an operation; releaseNext ends the oldest open one.
function trackedOperations(tracker) {
  const releases = [];
  const operation = label => async () => {
    tracker.active += 1;
    tracker.maximum = Math.max(tracker.maximum, tracker.active);
    tracker.started.push(label);
    await new Promise(resolve => releases.push(resolve));
    tracker.active -= 1;
    return label;
  };
  const releaseNext = async () => {
    releases.shift()?.();
    await flushPromises();
  };
  return { operation, releaseNext };
}

describe("Provider dispatch", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Two jobs each issuing a nested batch of generative requests share one permit, one request at a time.
  it("holds nested batches from several jobs to the provider limit", async () => {
    const budget = new DashboardResourceBudget({ limits: { generative: 1, jev: 2 } });
    const dispatch = createProviderDispatch({ budget });
    const tracker = { active: 0, maximum: 0, started: [] };
    const { operation, releaseNext } = trackedOperations(tracker);
    const firstBatch = dispatch.runEach("generative", ["a1", "a2", "a3"], item => operation(item)());
    const secondBatch = dispatch.runEach("generative", ["b1", "b2"], item => operation(item)());
    await flushPromises();
    for (let index = 0; index < 5; index += 1) {
      expect(tracker.active).toBe(1);
      await releaseNext();
    }
    await expect(firstBatch).resolves.toEqual(["a1", "a2", "a3"]);
    await expect(secondBatch).resolves.toEqual(["b1", "b2"]);
    expect(tracker.maximum).toBe(1);
    expect(budget.snapshot().resources.generative).toMatchObject({ available: 1 });
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A foreground request waiting behind a running maintenance request starts before maintenance queued earlier.
  it("serves a foreground request before waiting maintenance", async () => {
    const budget = new DashboardResourceBudget({ limits: { generative: 1, jev: 1 } });
    const dispatch = createProviderDispatch({ budget });
    const tracker = { active: 0, maximum: 0, started: [] };
    const { operation, releaseNext } = trackedOperations(tracker);
    dispatch.generative(operation("maintenance 1"));
    await flushPromises();
    dispatch.generative(operation("maintenance 2"));
    dispatch.generative(operation("foreground"), { background: false });
    await flushPromises();
    await releaseNext();
    await releaseNext();
    expect(tracker.started).toEqual(["maintenance 1", "foreground", "maintenance 2"]);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A request whose signal aborts while waiting rejects and gives up its place, and a request that throws still
  //   returns its permit.
  it("drops aborted waits and releases permits after failures", async () => {
    const budget = new DashboardResourceBudget({ limits: { generative: 1, jev: 1 } });
    const dispatch = createProviderDispatch({ budget });
    const tracker = { active: 0, maximum: 0, started: [] };
    const { operation, releaseNext } = trackedOperations(tracker);
    dispatch.generative(operation("running"));
    const controller = new AbortController();
    const aborted = dispatch.generative(operation("aborted"), { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(budget.waiters).toHaveLength(0);
    await releaseNext();
    await expect(dispatch.jev(async () => { throw new Error("provider down"); })).rejects.toThrow("provider down");
    expect(budget.snapshot().resources.jev).toMatchObject({ available: 1 });
    await expect(dispatch.runEach("mount", [1], async () => 1)).rejects.toThrow("not a provider resource");
  });
});

describe("App dispatch", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Reads hold read permits; a write waiting behind an earlier update to its note holds no write permit, so a
  //   write to another note proceeds.
  it("takes a write permit only once the note's turn arrives", async () => {
    const budget = new DashboardResourceBudget({ limits: { appRead: 1, write: 1 } });
    const app = {};
    const noteWriter = new DashboardNoteWriter();
    const dispatch = createAppDispatch({ app, budget, noteWriter });
    let releaseEarlier = null;
    noteWriter.update("store", () => new Promise(resolve => { releaseEarlier = resolve; }));
    const queuedWrite = dispatch.write("store", async received => received === app);
    await flushPromises();
    expect(budget.snapshot().resources.write).toMatchObject({ available: 1 });
    await expect(dispatch.write("dictionary", async () => "other note")).resolves.toBe("other note");
    await expect(dispatch.read(async received => received === app)).resolves.toBe(true);
    releaseEarlier();
    await expect(queuedWrite).resolves.toBe(true);
    expect(budget.snapshot().resources).toMatchObject({ appRead: { available: 1 }, write: { available: 1 } });
  });
});
