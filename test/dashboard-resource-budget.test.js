// Exercise DashboardResourceBudget: independent per-resource limits, idempotent release, and the permit maintenance
// leaves free for foreground work.
import DashboardResourceBudget from "work-queue/dashboard-resource-budget";

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
    expect(budget.snapshot().resources.jev).toEqual({ available: 0, foreground: 0, limit: 2, maintenance: 2 });
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
});
