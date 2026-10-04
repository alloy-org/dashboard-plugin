// Count the permits each Dashboard resource has in use: component mounts, app reads, generative requests, Jev
// requests, and note writes. Each resource is limited on its own, so work waiting for one never blocks work that
// needs another. Maintenance may be held below a resource's limit at all times, which keeps the remaining permits
// for foreground work, and while foreground work is waiting it also leaves one permit of every resource free for it.
// The scheduler takes permits without waiting; a provider or app call inside a running job waits for one through
// acquire, foreground callers first, so every nested request in a batch counts against the same limit.
import { MAINTENANCE_RESOURCE_LIMITS, RESOURCE_LIMITS } from "dashboard/work-queue/dashboard-work-policy";

// ----------------------------------------------------------------------------------------------
// @desc Hands out and takes back resource permits. Every permit is released through its own handle, and releasing
//   a handle twice has no further effect, so a cancelled job and its late completion cannot free two permits.
export default class DashboardResourceBudget {
  foregroundDemand = false; // {boolean} True while foreground work is waiting, reserving a permit of each resource.
  limits; // {object} Permits available per resource name.
  maintenanceLimits; // {object} The most permits maintenance may hold, for resources that cap it below their limit.
  usedByResource = new Map(); // {Map<string, object>} { foreground, maintenance } permits in use per resource.
  waiterSequence = 0; // {number} Orders waiters of the same priority, first come first served.
  waiters = []; // {Array<object>} { background, reject, resolve, resource, sequence, stopListening } awaiting a permit.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a budget.
  // @param {object} [options] - { limits = RESOURCE_LIMITS, maintenanceLimits = MAINTENANCE_RESOURCE_LIMITS }.
  constructor({ limits = RESOURCE_LIMITS, maintenanceLimits = MAINTENANCE_RESOURCE_LIMITS } = {}) {
    this.limits = { ...limits };
    this.maintenanceLimits = { ...maintenanceLimits };
    for (const resource of Object.keys(this.limits)) this.usedByResource.set(resource, { foreground: 0, maintenance: 0 });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Take a permit, waiting until one is free. Waiters are served as permits are released, foreground before
  //   background and otherwise in arrival order, and a foreground waiter keeps background requests, including the
  //   scheduler's, from taking the permit it is waiting for.
  // @param {string} resource - A resource named in the budget's limits.
  // @param {object} [options] - { background = true, signal = null }: an aborted signal stops the wait.
  // @returns {Promise<object>} The permit handle from tryAcquire; rejects with an AbortError when the signal aborts.
  acquire(resource, { background = true, signal = null } = {}) {
    if (signal?.aborted) return Promise.reject(_abortError());
    const handle = this.tryAcquire(resource, { background });
    if (handle) return Promise.resolve(handle);
    return new Promise((resolve, reject) => {
      const waiter = { background, reject, resolve, resource, sequence: ++this.waiterSequence, stopListening: () => {} };
      if (signal) {
        const abort = () => {
          this.waiters = this.waiters.filter(other => other !== waiter);
          reject(_abortError());
        };
        signal.addEventListener?.("abort", abort, { once: true });
        waiter.stopListening = () => signal.removeEventListener?.("abort", abort);
      }
      this.waiters.push(waiter);
    });
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
    this._serveWaiters();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Describe each resource's limit and the permits in use.
  // @returns {object} { foregroundDemand, resources } where resources maps each name to
  //   { available, foreground, limit, maintenance, maintenanceLimit }, maintenanceLimit being the most permits
  //   maintenance may hold.
  snapshot() {
    const resources = {};
    for (const [resource, used] of this.usedByResource) {
      const limit = this.limits[resource];
      resources[resource] = { available: limit - used.foreground - used.maintenance, foreground: used.foreground, limit,
        maintenance: used.maintenance, maintenanceLimit: this._maintenanceLimit(resource) };
    }
    return { foregroundDemand: this.foregroundDemand, resources };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Take a permit when the resource has one free for the requesting priority. Maintenance never holds more than
  //   the resource's maintenance limit, and under foreground demand holds at most one fewer than its full limit.
  // @param {string} resource - A resource named in the budget's limits.
  // @param {object} [options] - { background = true }: false for work the user is waiting on, which may use the permit
  //   maintenance leaves free.
  // @returns {object|null} { release, resource }, or null when no permit is free for this request.
  tryAcquire(resource, { background = true } = {}) {
    const used = this.usedByResource.get(resource);
    if (!used) throw new Error(`Unknown work resource "${ resource }"`);
    const limit = this.limits[resource];
    if (used.foreground + used.maintenance >= limit) return null;
    if (background && used.maintenance >= this._maintenanceLimit(resource)) return null;
    if (background && this.foregroundDemand && used.maintenance >= limit - 1) return null;
    if (background && this.waiters.some(waiter => !waiter.background && waiter.resource === resource)) return null;
    const holder = background ? "maintenance" : "foreground";
    used[holder] += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      used[holder] -= 1;
      this._serveWaiters();
    };
    return { release, resource };
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The most permits of a resource maintenance may hold: its maintenance limit when one is set below the full
  //   limit, otherwise the full limit.
  // @param {string} resource - A resource named in the budget's limits.
  // @returns {number} The maintenance limit.
  _maintenanceLimit(resource) {
    const limit = this.limits[resource];
    const maintenanceLimit = this.maintenanceLimits[resource];
    return Number.isInteger(maintenanceLimit) ? Math.min(maintenanceLimit, limit) : limit;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Hand free permits to waiters, foreground first and then in arrival order. A waiter that still cannot be
  //   served stays in line.
  _serveWaiters() {
    if (!this.waiters.length) return;
    const orderedWaiters = [...this.waiters].sort((first, second) => Number(first.background) - Number(second.background)
      || first.sequence - second.sequence);
    for (const waiter of orderedWaiters) {
      this.waiters = this.waiters.filter(other => other !== waiter);
      const handle = this.tryAcquire(waiter.resource, { background: waiter.background });
      if (!handle) {
        this.waiters.push(waiter);
        continue;
      }
      waiter.stopListening();
      waiter.resolve(handle);
    }
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The error a wait rejects with when its signal aborts, named as fetch names its own.
// @returns {Error} An error named "AbortError".
function _abortError() {
  const error = new Error("The wait for a resource permit was aborted");
  error.name = "AbortError";
  return error;
}
