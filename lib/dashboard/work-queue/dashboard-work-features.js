// Switches that select which parts of the Dashboard work queue are active. Each part can be turned off on its own:
// turning one off restores the path that existed before it, without changing any stored data.

// When true, a mounted Dashboard orders widget mounts through the work scheduler: visible widgets first, one at a
// time. When false, each widget mounts as soon as it comes near the viewport, as before the scheduler existed.
export const SCHEDULED_WIDGET_MOUNTING_ENABLED = true;

// When true, a mounted Dashboard saves durable work to each scope's "Dashboard Work Queue" note, resumes what an
// earlier session left unfinished once its load settles, and keeps a week of outcomes in "Dashboard Work History".
// It stays false until project maintenance supplies the first durable handlers; until then the existing maintenance
// path runs alone and the Dashboard neither reads nor creates either note.
export const DURABLE_WORK_ENABLED = false;
