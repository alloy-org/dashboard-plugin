// Serialize the read-then-write updates each Dashboard note receives within one execution context. Two passes that
// each read a note, wait on a provider, and then write it back would otherwise overwrite each other's changes; run
// through one writer, each update starts only after the previous update to that note has finished, and reads the
// note fresh at that point. The writer also asks Amplenote to bring its notes list up to date before a pass reads,
// since the notes a freshly opened client holds can lag behind edits made on other devices.
import { logIfEnabled } from "util/log";

// How long a successful notes-list refresh is trusted: Amplenote reports the list current to within about a minute.
export const NOTES_LIST_FRESH_MILLISECONDS = 60 * 1000;
// How long a refresh may take before the reader goes ahead with the notes the client already holds.
export const NOTES_LIST_REFRESH_TIMEOUT_MILLISECONDS = 10 * 1000;

// One writer per app interface: callers sharing an app share its write chains without passing a writer around.
const writersByApp = new WeakMap();

// ----------------------------------------------------------------------------------------------
// @desc Runs updates to the same note one at a time, in the order they were requested. Updates to different notes
//   run independently. An update that fails rejects its own caller and does not stop later updates to that note.
export default class DashboardNoteWriter {
  app; // {object|null} Host-compatible Amplenote API whose notes list is refreshed; null skips refreshing.
  chainsByNoteKey = new Map(); // {Map<string, Promise>} Settles when the last update queued for each note finishes.
  clock; // {function} Returns epoch milliseconds; injected for tests.
  notesListRefresh = null; // {Promise<boolean>|null} The refresh in flight, shared by every caller awaiting it.
  notesListRefreshedAt = null; // {number|null} Epoch milliseconds of the last refresh Amplenote reported succeeding.

  // ----------------------------------------------------------------------------------------------
  // @desc Construct a writer.
  // @param {object} [options] - { app = null, clock = Date.now }.
  constructor({ app = null, clock = Date.now } = {}) {
    Object.assign(this, { app, clock });
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The writer every caller holding this app interface shares, created on first use.
  // @param {object} app - Host-compatible Amplenote API.
  // @returns {DashboardNoteWriter} The app's writer.
  static forApp(app) {
    if (!writersByApp.has(app)) writersByApp.set(app, new DashboardNoteWriter({ app }));
    return writersByApp.get(app);
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Ask Amplenote to bring the notes list up to date, so a pass reads current notes before it spends provider
  //   requests on them. A refresh that succeeded within the last minute is reused, and concurrent callers share one
  //   request. Amplenote documents that this refreshes the list's metadata, such as which notes exist and when they
  //   changed, without promising every changed note's content has arrived. A client that cannot refresh, a failure,
  //   or a slow response leaves the reader with the notes it already has.
  // @returns {Promise<boolean>} True when the notes list is known to be current to within about a minute.
  async refreshNotesList() {
    if (this.notesListRefreshedAt !== null && this.clock() - this.notesListRefreshedAt < NOTES_LIST_FRESH_MILLISECONDS) {
      return true;
    }
    if (!this.notesListRefresh) {
      this.notesListRefresh = this._requestNotesListRefresh().finally(() => { this.notesListRefresh = null; });
    }
    return this.notesListRefresh;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Run one update once every earlier update to the same note has settled and the notes list is current. The
  //   update performs its own fresh read and its writes, which suits notes written a section at a time, where no single
  //   whole-note replacement could carry the change. Keep provider calls out of the update: they would hold up every
  //   later write to the note.
  // @param {string} noteKey - Stable identity of the note, such as its name, so an update that creates the note is
  //   serialized with the updates that later find it.
  // @param {function} update - Async function performing the read and write; its result is returned.
  // @returns {Promise<*>} The update's result, or its rejection.
  update(noteKey, update) {
    const previous = this.chainsByNoteKey.get(noteKey) || Promise.resolve();
    const result = previous.then(async () => {
      await this.refreshNotesList();
      return update();
    });
    const settled = result.catch(() => {});
    this.chainsByNoteKey.set(noteKey, settled);
    settled.then(() => {
      if (this.chainsByNoteKey.get(noteKey) === settled) this.chainsByNoteKey.delete(noteKey);
    });
    return result;
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Make one refresh request, recording when it succeeds. The host calls app.context directly; the embed's app
  //   forwards refreshNotesList over the bridge, where a failure arrives as an envelope rather than true.
  // @returns {Promise<boolean>} Whether Amplenote reported the notes list current.
  async _requestNotesListRefresh() {
    const refresh = _notesListRefreshFunction(this.app);
    if (!refresh) return false;
    let timeoutId = null;
    const timeout = new Promise(resolve => { timeoutId = setTimeout(() => resolve(false),
      NOTES_LIST_REFRESH_TIMEOUT_MILLISECONDS); });
    try {
      const refreshed = await Promise.race([refresh(), timeout]);
      if (refreshed === true) {
        this.notesListRefreshedAt = this.clock();
      } else if (refreshed) {
        logIfEnabled("[dashboard-note-writer] notes list could not be refreshed", refreshed);
      }
      return refreshed === true;
    } catch (error) {
      logIfEnabled("[dashboard-note-writer] notes list refresh failed", error?.message);
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Find how this app interface refreshes its notes list: app.context on the host, or the bridge action the
//   embed's app forwards. The embed's app answers every property with a bridge function, including `context`, so
//   the host's method is recognized by being a function on a context object.
// @param {object|null} app - Host-compatible Amplenote API.
// @returns {function|null} A function making the request, or null when the interface offers none.
function _notesListRefreshFunction(app) {
  if (!app) return null;
  if (typeof app.context?.refreshNotesList === "function") return () => app.context.refreshNotesList();
  if (typeof app.refreshNotesList === "function") return () => app.refreshNotesList();
  return null;
}
