// Send a running job's Amplenote reads and note writes through the Dashboard's resource budget. Each call states its
// own priority, rather than reading one shared mutable setting, so concurrent foreground and maintenance calls keep
// theirs. A write first waits its turn in the note writer's chain for that note and only then takes a write permit,
// so no permit is held while waiting behind another update; the reads inside a write belong to it and take no
// separate read permit.
import DashboardNoteWriter from "dashboard/work-queue/dashboard-note-writer";

// ----------------------------------------------------------------------------------------------
// @desc Create an app dispatcher.
// @param {object} options - { app, budget, noteWriter }: the app interface, a DashboardResourceBudget, and the note
//   writer, by default the one shared by every caller of this app.
// @returns {object} An object with the following properties:
//   - {function} read - (operation, options) => the result of operation(app), holding one app read permit
//   - {function} write - (noteKey, update, options) => the result of update(app), run in the note's write chain while
//     holding one write permit
//   Options are { background = true, signal = null }: background false marks a call the user is waiting on, and an
//   aborted signal gives up a call still waiting for its permit.
export function createAppDispatch({ app, budget, noteWriter = DashboardNoteWriter.forApp(app) }) {
  const withPermit = async (resource, operation, { background = true, signal = null } = {}) => {
    const permit = await budget.acquire(resource, { background, signal });
    try {
      return await operation(app);
    } finally {
      permit.release();
    }
  };
  return { read: (operation, options) => withPermit("appRead", operation, options),
    write: (noteKey, update, options) => noteWriter.update(noteKey, () => withPermit("write", update, options)) };
}
