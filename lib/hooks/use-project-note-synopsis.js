// Read the note that defines a project for its card's "How it gets done" panel, and keep that reading while the user
// moves between wizard pages. A note found missing is reported as trashed, since findNote answers null for a note
// marked deleted, and is checked again whenever the dashboard regains focus so a note restored in Amplenote returns.

import { readProjectNoteSynopsis } from "plan-wizard/project-note-synopsis";
import { logIfEnabled } from "util/log";
import { useCallback, useEffect, useState } from "react";

// Readings by note UUID for the life of the page, so returning to the projects page does not read each note again.
const SYNOPSIS_BY_NOTE_UUID = new Map();

// ----------------------------------------------------------------------------------------------
// @desc Read a project's note on first use, again when asked, and again on window focus while it is trashed.
// @param {object} app - Amplenote app interface or embed proxy.
// @param {string|null} noteUuid - The note defining the project, or null for a project named by hand.
// @returns {object} An object with the following properties:
//   - {boolean} isReading - True while a read is in flight.
//   - {Function} reread - Reads the note again, replacing the kept reading.
//   - {string} statusEm - "idle" without a note, "reading" before the first reading arrives, "ready" with one,
//     "trashed" when the note is gone, or "failed" when it could not be read.
//   - {object|null} synopsis - Reading from readProjectNoteSynopsis, or null.
export default function useProjectNoteSynopsis(app, noteUuid) {
  const [synopsis, setSynopsis] = useState(() => (noteUuid ? SYNOPSIS_BY_NOTE_UUID.get(noteUuid) ?? null : null));
  const [isReading, setIsReading] = useState(false);
  const [readFailureEm, setReadFailureEm] = useState(null);

  // ----------------------------------------------------------------------------------------------
  // @desc Read the note and record what was found, reporting a missing note as trashed.
  // @returns {Promise<void>} Resolves once state reflects the read.
  const reread = useCallback(async () => {
    if (!noteUuid) return;
    setIsReading(true);
    try {
      const reading = await readProjectNoteSynopsis(app, noteUuid);
      if (reading) SYNOPSIS_BY_NOTE_UUID.set(noteUuid, reading);
      else SYNOPSIS_BY_NOTE_UUID.delete(noteUuid);
      setSynopsis(reading);
      setReadFailureEm(reading ? null : "trashed");
    } catch (error) {
      logIfEnabled("[use-project-note-synopsis] could not read project note", noteUuid, error?.message);
      setReadFailureEm("failed");
    } finally {
      setIsReading(false);
    }
  }, [app, noteUuid]);

  useEffect(() => {
    const keptReading = noteUuid ? SYNOPSIS_BY_NOTE_UUID.get(noteUuid) ?? null : null;
    setSynopsis(keptReading);
    setReadFailureEm(null);
    if (noteUuid && !keptReading) reread();
  }, [noteUuid, reread]);

  useEffect(() => {
    if (readFailureEm !== "trashed" || typeof window === "undefined") return undefined;
    window.addEventListener("focus", reread);
    return () => window.removeEventListener("focus", reread);
  }, [readFailureEm, reread]);

  const statusEm = !noteUuid ? "idle" : readFailureEm ?? (synopsis ? "ready" : "reading");
  return { isReading, reread, statusEm, synopsis };
}
