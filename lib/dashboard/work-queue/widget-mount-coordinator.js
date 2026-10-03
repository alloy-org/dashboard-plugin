// Decide the order in which Dashboard widgets mount. Each lazily mounted widget registers its placeholder; two shared
// IntersectionObservers, one for the viewport and one for a lookahead band around it, classify each placeholder as
// visible or near the viewport, and the coordinator turns that into one mount job per widget on the work scheduler:
// a visible render outranks a near-viewport render, and a widget that scrolls out of range before its turn has its
// request withdrawn. A mount job holds the scheduler's single mount permit from the moment it asks React to mount the
// widget until the widget reports its commit, unregisters, or a watchdog gives up waiting, so mounts are admitted one
// at a time and a slow provider request elsewhere never holds one up. Browser-only.

// The lookahead band: widgets this close to the viewport mount ahead of scrolling, so they are ready when they arrive.
export const MOUNT_AHEAD_ROOT_MARGIN = "400px 0px";

// How long a mount may go unconfirmed before its permit is released anyway, so a lost commit cannot stall mounting.
const COMMIT_WATCHDOG_MILLISECONDS = 3000;

// ----------------------------------------------------------------------------------------------
// @desc Holds widget mount registrations and keeps each one's scheduler request in step with its visibility.
export default class WidgetMountCoordinator {
  clearTimer; // {function} Cancels a watchdog timer.
  commitWatchdogMilliseconds; // {number} How long a mount may wait for its commit report.
  generation = 0; // {number} Incremented per registration, so a stale callback can recognize itself.
  lookaheadObserver; // {IntersectionObserver} Reports placeholders within the lookahead band.
  registrations = new Map(); // {Map<string, object>} Registration per widget id.
  scheduler; // {DashboardWorkScheduler} Admits the mount jobs.
  setTimer; // {function} Starts a watchdog timer.
  viewportObserver; // {IntersectionObserver} Reports placeholders within the viewport itself.
  widgetIdsByElement = new Map(); // {Map<Element, string>} Placeholder element to widget id, for observer entries.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a coordinator. It needs IntersectionObserver; a runtime without it keeps the unscheduled mount
  //   path, which mounts every widget at once.
  // @param {object} options - An object with the following properties:
  //   - {DashboardWorkScheduler} scheduler - Scheduler whose mount permit orders the mounts
  //   - {function} [clearTimer=clearTimeout] - Cancels a timer
  //   - {number} [commitWatchdogMilliseconds=3000] - How long a mount may wait for its commit report
  //   - {function} [createObserver] - (callback, options) => observer; defaults to constructing an IntersectionObserver
  //   - {function} [setTimer=setTimeout] - Starts a timer
  constructor({ clearTimer = clearTimeout, commitWatchdogMilliseconds = COMMIT_WATCHDOG_MILLISECONDS,
      createObserver = _createIntersectionObserver, scheduler, setTimer = setTimeout }) {
    Object.assign(this, { clearTimer, commitWatchdogMilliseconds, scheduler, setTimer });
    this.lookaheadObserver = createObserver(entries => this._observed(entries, "nearViewport"),
      { rootMargin: MOUNT_AHEAD_ROOT_MARGIN });
    this.viewportObserver = createObserver(entries => this._observed(entries, "visible"), { rootMargin: "0px" });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop observing, withdraw every mount request, and release any mount still waiting for its commit.
  dispose() {
    for (const [widgetId, registration] of [...this.registrations]) this.unregister(widgetId, registration.generation);
    this.lookaheadObserver.disconnect();
    this.viewportObserver.disconnect();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Register a widget's placeholder. A widget registered again replaces its earlier registration, whose
  //   callbacks then do nothing.
  // @param {string} widgetId - Stable widget id.
  // @param {object} options - { element, mount }: the placeholder element, and a callback that mounts the widget.
  // @returns {number} The registration's generation, passed back to reportCommitted and unregister.
  register(widgetId, { element, mount }) {
    const existing = this.registrations.get(widgetId);
    if (existing) this.unregister(widgetId, existing.generation);
    const generation = ++this.generation;
    const registration = { element, generation, mount, nearViewport: false, queuedCategory: null, releaseMount: null,
      status: "waiting", visible: false, watchdog: null };
    this.registrations.set(widgetId, registration);
    this._observe(widgetId, element);
    return generation;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Report that a widget's mount has committed, releasing the mount permit for the next widget.
  // @param {string} widgetId - Widget id.
  // @param {number} generation - The generation register returned; a stale one is ignored.
  reportCommitted(widgetId, generation) {
    const registration = this._current(widgetId, generation);
    if (!registration || registration.status !== "mounting") return;
    registration.status = "mounted";
    this._releaseMount(registration);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Bring a waiting widget's mount request in line with its visibility: a visible widget asks for a visible
  //   render, one in the lookahead band for a near-viewport render, and one out of range withdraws its request. A
  //   request raised in urgency keeps its place; one lowered is withdrawn and asked again at the lower category.
  // @param {string} widgetId - Widget id.
  requestMount(widgetId) {
    const registration = this.registrations.get(widgetId);
    if (!registration || registration.status !== "waiting") return;
    const category = registration.visible ? "visibleRender" : registration.nearViewport ? "nearViewportRender" : null;
    const queuedCategory = registration.queuedCategory;
    if (category === queuedCategory) return;
    const jobKey = _mountJobKey(widgetId);
    if (queuedCategory && category === "visibleRender") {
      this.scheduler.promote(jobKey, category);
      registration.queuedCategory = category;
      return;
    }
    if (queuedCategory) this.scheduler.cancel(jobKey);
    registration.queuedCategory = category;
    if (!category) return;
    const { generation } = registration;
    this.scheduler.enqueue({ category, input: { widgetId }, key: jobKey, resource: "mount",
      run: () => this._mount(widgetId, generation), scopeKey: null, type: "widgetMount" });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Remove a widget's registration: stop observing its placeholder, withdraw its request, and release its
  //   mount permit if it is still waiting for a commit.
  // @param {string} widgetId - Widget id.
  // @param {number} generation - The generation register returned; a stale one is ignored.
  unregister(widgetId, generation) {
    const registration = this._current(widgetId, generation);
    if (!registration) return;
    this.registrations.delete(widgetId);
    this._unobserve(registration.element);
    if (registration.queuedCategory) this.scheduler.cancel(_mountJobKey(widgetId));
    this._releaseMount(registration);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Record a widget's visibility and update its request.
  // @param {string} widgetId - Widget id.
  // @param {object} visibility - Either or both of { nearViewport, visible } as booleans.
  updateVisibility(widgetId, visibility) {
    const registration = this.registrations.get(widgetId);
    if (!registration) return;
    if ("nearViewport" in visibility) registration.nearViewport = Boolean(visibility.nearViewport);
    if ("visible" in visibility) registration.visible = Boolean(visibility.visible);
    this.requestMount(widgetId);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The registration for a widget, if it is still the given generation.
  // @param {string} widgetId - Widget id.
  // @param {number} generation - Registration generation.
  // @returns {object|null} The registration.
  _current(widgetId, generation) {
    const registration = this.registrations.get(widgetId);
    return registration?.generation === generation ? registration : null;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Run a widget's mount job: ask React to mount it, then hold the mount permit until the commit is reported,
  //   the widget unregisters, or the watchdog fires. A registration replaced since the job was queued does nothing.
  // @param {string} widgetId - Widget id.
  // @param {number} generation - The generation the job was queued for.
  // @returns {Promise<object>|object} Resolves once the permit may be released.
  _mount(widgetId, generation) {
    const registration = this._current(widgetId, generation);
    if (!registration || registration.status !== "waiting") return { status: "superseded" };
    registration.status = "mounting";
    registration.queuedCategory = null;
    this._unobserve(registration.element);
    return new Promise(resolve => {
      registration.releaseMount = resolve;
      registration.watchdog = this.setTimer(() => this._releaseMount(registration), this.commitWatchdogMilliseconds);
      registration.mount();
    });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Start observing a placeholder with both observers.
  // @param {string} widgetId - Widget id.
  // @param {Element} element - Placeholder element.
  _observe(widgetId, element) {
    if (!element) return;
    this.widgetIdsByElement.set(element, widgetId);
    this.lookaheadObserver.observe(element);
    this.viewportObserver.observe(element);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Apply one observer batch, which may report many placeholders at once, then update each affected request.
  // @param {Array<IntersectionObserverEntry>} entries - Observer entries.
  // @param {string} field - "visible" for the viewport observer, "nearViewport" for the lookahead observer.
  _observed(entries, field) {
    const changedWidgetIds = new Set();
    for (const entry of entries) {
      const widgetId = this.widgetIdsByElement.get(entry.target);
      const registration = widgetId && this.registrations.get(widgetId);
      if (!registration) continue;
      registration[field] = entry.isIntersecting;
      changedWidgetIds.add(widgetId);
    }
    for (const widgetId of changedWidgetIds) this.requestMount(widgetId);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Resolve a mount job's run, which releases its permit, and clear its watchdog. Safe to call more than once.
  // @param {object} registration - Registration whose mount is finishing.
  _releaseMount(registration) {
    if (registration.watchdog !== null) this.clearTimer(registration.watchdog);
    registration.watchdog = null;
    const releaseMount = registration.releaseMount;
    registration.releaseMount = null;
    releaseMount?.({ status: "completed" });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop observing a placeholder.
  // @param {Element|null} element - Placeholder element.
  _unobserve(element) {
    if (!element || !this.widgetIdsByElement.has(element)) return;
    this.widgetIdsByElement.delete(element);
    this.lookaheadObserver.unobserve(element);
    this.viewportObserver.unobserve(element);
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Construct an IntersectionObserver.
// @param {function} callback - Receives each batch of entries.
// @param {object} options - Observer options, such as rootMargin.
// @returns {IntersectionObserver} The observer.
function _createIntersectionObserver(callback, options) {
  return new IntersectionObserver(callback, options);
}

// ----------------------------------------------------------------------------------------------
// @desc The scheduler key of a widget's mount job.
// @param {string} widgetId - Widget id.
// @returns {string} The job key.
function _mountJobKey(widgetId) {
  return `widgetMount:${ widgetId }`;
}
