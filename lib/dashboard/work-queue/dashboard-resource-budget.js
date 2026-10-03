// Count the permits each Dashboard resource has in use: component mounts, app reads, generative requests, Jev
// requests, and note writes. Each resource is limited on its own, so work waiting for one never blocks work that
// needs another. While foreground work is waiting, maintenance leaves one permit of every resource free for it.
import { RESOURCE_LIMITS } from "dashboard/work-queue/dashboard-work-policy";

// ----------------------------------------------------------------------------------------------
// @desc Hands out and takes back resource permits. Every permit is released through its own handle, and releasing
//   a handle twice has no further effect, so a cancelled job and its late completion cannot free two permits.
export default class DashboardResourceBudget {
  foregroundDemand = false; // {boolean} True while foreground work is waiting, reserving a permit of each resource.
  limits; // {object} Permits available per resource name.
  usedByResource = new Map(); // {Map<string, object>} { foreground, maintenance } permits in use per resource.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a budget.
  // @param {object} [options] - { limits = RESOURCE_LIMITS }.
  constructor({ limits = RESOURCE_LIMITS } = {}) {
    this.limits = { ...limits };
    for (const resource of Object.keys(this.limits)) this.usedByResource.set(resource, { foreground: 0, maintenance: 0 });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Release a permit through its handle; see the handle's own release.
  // @param {object|null} handle - A handle from tryAcquire.
  release(handle) {
    handle?.release();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record whether foreground work is waiting. While it is, maintenance may hold at most one fewer permit than
  //   each resource's limit, so a resource limited to one permit admits no new maintenance at all.
  // @param {boolean} active - Whether foreground work is demanded, waiting, or running.
  setForegroundDemand(active) {
    this.foregroundDemand = Boolean(active);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Describe each resource's limit and the permits in use.
  // @returns {object} { foregroundDemand, resources } where resources maps each name to
  //   { available, foreground, limit, maintenance }.
  snapshot() {
    const resources = {};
    for (const [resource, used] of this.usedByResource) {
      const limit = this.limits[resource];
      resources[resource] = { available: limit - used.foreground - used.maintenance, foreground: used.foreground, limit,
        maintenance: used.maintenance };
    }
    return { foregroundDemand: this.foregroundDemand, resources };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Take a permit when the resource has one free for the requesting priority.
  // @param {string} resource - A resource named in the budget's limits.
  // @param {object} [options] - { background = true }: false for work the user is waiting on, which may use the permit
  //   maintenance leaves free.
  // @returns {object|null} { release, resource }, or null when no permit is free for this request.
  tryAcquire(resource, { background = true } = {}) {
    const used = this.usedByResource.get(resource);
    if (!used) throw new Error(`Unknown work resource "${ resource }"`);
    const limit = this.limits[resource];
    if (used.foreground + used.maintenance >= limit) return null;
    if (background && this.foregroundDemand && used.maintenance >= limit - 1) return null;
    const holder = background ? "maintenance" : "foreground";
    used[holder] += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      used[holder] -= 1;
    };
    return { release, resource };
  }
}
