// Switches that select which parts of the Dashboard work queue are active. Each part can be turned off on its own:
// turning one off restores the path that existed before it, without changing any stored data.

// When true, a mounted Dashboard orders widget mounts through the work scheduler: visible widgets first, one at a
// time. When false, each widget mounts as soon as it comes near the viewport, as before the scheduler existed.
export const SCHEDULED_WIDGET_MOUNTING_ENABLED = true;

// When true, a mounted Dashboard saves durable work to each scope's "Dashboard Work Queue" note, resumes what an
// earlier session left unfinished once its load settles, and keeps a week of outcomes in "Dashboard Work History".
// Project maintenance then runs through the queue: the Dashboard's background collection pass, and Plan Builder's
// ranking pass for the Dashboard's own quarter, submit a reconciliation instead of running their own loops. When false,
// both passes run as they did before the queue, and the Dashboard neither reads nor creates either note.
export const DURABLE_WORK_ENABLED = true;

// ----------------------------------------------------------------------------------------------
// @desc Whether project maintenance runs through the work queue in this browser. The queue's runtime exists only with
//   scheduled mounting and IntersectionObserver, so without either the legacy passes stay selected; the two routes
//   never both run for one scope.
// @returns {boolean} True when project maintenance is queued.
export function queuedMaintenanceSelected() {
  return DURABLE_WORK_ENABLED && SCHEDULED_WIDGET_MOUNTING_ENABLED && typeof IntersectionObserver !== "undefined";
}
