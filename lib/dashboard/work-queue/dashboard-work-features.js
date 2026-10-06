// Switches that select which parts of the Dashboard work queue are active. Each part can be turned off on its own:
// turning one off restores the path that existed before it, without changing any stored data.

// When true, a mounted Dashboard orders widget mounts through the work scheduler: visible widgets first, one at a
// time. When false, each widget mounts as soon as it comes near the viewport, as before the scheduler existed.
export const SCHEDULED_WIDGET_MOUNTING_ENABLED = true;

// When true, a mounted Dashboard saves durable work to each scope's "Dashboard Work Queue" note, resumes what an
// earlier session left unfinished once its load settles, and keeps a week of outcomes in "Dashboard Work History".
// Project maintenance then runs through the queue: the Dashboard's background collection pass, and Plan Builder's
// ranking for any selected quarter, submit a reconciliation instead of running their own loops. When false,
// both passes run as they did before the queue, and the Dashboard neither reads nor creates either note.
export const DURABLE_WORK_ENABLED = true;

// When true, each queued reconciliation also picks up to two plugin-owned dictionary terms whose evidence is due, and
// collects passages naming them from the user's notes, refining a definition when the passages are new to it. When
// false, no term evidence is collected or refinement asked for; discovery, ranking, and ideas run unchanged, and jobs
// already saved still run to completion.
export const DICTIONARY_REFINEMENT_ENABLED = true;

// ----------------------------------------------------------------------------------------------
// @desc Whether project maintenance runs through the work queue. Maintenance owns a runtime even when scheduled
//   mounting is disabled or IntersectionObserver is unavailable; the legacy pass is selected only when durable work
//   is disabled, so the two maintenance routes never both run for one scope.
// @returns {boolean} True when project maintenance is queued.
export function queuedMaintenanceSelected() {
  return DURABLE_WORK_ENABLED;
}
