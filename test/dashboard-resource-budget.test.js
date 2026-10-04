// Exercise DashboardResourceBudget: independent per-resource limits, idempotent release, and the permit maintenance
// leaves free for foreground work.
import DashboardResourceBudget from "dashboard/work-queue/dashboard-resource-budget";

describe("DashboardResourceBudget", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Each resource has its own limit: a full Jev budget leaves generative and mount permits free.
  it("limits each resource independently", () => {
    const budget = new DashboardResourceBudget({ limits: { generative: 1, jev: 2, mount: 1 } });
    expect(budget.tryAcquire("jev")).not.toBeNull();
    expect(budget.tryAcquire("jev")).not.toBeNull();
    expect(budget.tryAcquire("jev")).toBeNull();
    expect(budget.tryAcquire("generative")).not.toBeNull();
    expect(budget.tryAcquire("mount", { background: false })).not.toBeNull();
    expect(budget.snapshot().resources.jev).toEqual({ available: 0, foreground: 0, limit: 2, maintenance: 2, maintenanceLimit: 2 });
    expect(() => budget.tryAcquire("telepathy")).toThrow("Unknown work resource");
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Releasing a handle twice frees one permit, so a late completion after cancellation cannot overdraw.
  it("releases each permit once however often its handle is released", () => {
    const budget = new DashboardResourceBudget({ limits: { jev: 2 } });
    const first = budget.tryAcquire("jev");
    const second = budget.tryAcquire("jev");
    first.release();
    budget.release(first);
    expect(budget.snapshot().resources.jev.available).toBe(1);
    second.release();
    expect(budget.snapshot().resources.jev.available).toBe(2);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc Under foreground demand, maintenance stops one short of each limit, so foreground work overtakes it; a
  //   resource limited to one permit admits no new maintenance until the demand clears.
  it("keeps a permit free for foreground work while it is waiting", () => {
    const budget = new DashboardResourceBudget({ limits: { generative: 1, jev: 4 } });
    budget.tryAcquire("jev");
    budget.tryAcquire("jev");
    budget.setForegroundDemand(true);
    expect(budget.tryAcquire("jev")).not.toBeNull();
    expect(budget.tryAcquire("jev")).toBeNull();
    expect(budget.tryAcquire("generative")).toBeNull();
    expect(budget.tryAcquire("jev", { background: false })).not.toBeNull();
    const generative = budget.tryAcquire("generative", { background: false });
    expect(generative).not.toBeNull();
    generative.release();
    budget.setForegroundDemand(false);
    expect(budget.tryAcquire("generative")).not.toBeNull();
    expect(budget.snapshot().foregroundDemand).toBe(false);
  });

  // ----------------------------------------------------------------------------------------------
  // @desc A maintenance limit below the full limit holds maintenance to it with no foreground demand at all, so a
  //   foreground request arriving while maintenance's generative request runs is admitted at once rather than queued.
  it("holds maintenance below a resource's maintenance limit and leaves the rest to foreground work", async () => {
    const budget = new DashboardResourceBudget({ limits: { generative: 2, jev: 4 }, maintenanceLimits: { generative: 1 } });
    const maintenance = budget.tryAcquire("generative");
    expect(maintenance).not.toBeNull();
    expect(budget.tryAcquire("generative")).toBeNull();
    const foreground = await budget.acquire("generative", { background: false });
    expect(foreground).not.toBeNull();
    expect(budget.snapshot().resources.generative).toEqual({ available: 0, foreground: 1, limit: 2, maintenance: 1,
      maintenanceLimit: 1 });
    expect(budget.snapshot().resources.jev.maintenanceLimit).toBe(4);
    foreground.release();
    expect(budget.tryAcquire("generative")).toBeNull();
    maintenance.release();
    expect(budget.tryAcquire("generative")).not.toBeNull();
  });

  // ----------------------------------------------------------------------------------------------
  // @desc The policy's defaults leave one generative permit that maintenance can never take.
  it("reserves a generative permit for foreground work by default", () => {
    const budget = new DashboardResourceBudget();
    expect(budget.tryAcquire("generative")).not.toBeNull();
    expect(budget.tryAcquire("generative")).toBeNull();
    expect(budget.tryAcquire("generative", { background: false })).not.toBeNull();
  });
});
