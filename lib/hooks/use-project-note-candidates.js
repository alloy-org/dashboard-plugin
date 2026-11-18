// Supply the project note search menu with its best matches and recently changed notes, searching again shortly after
// the user stops typing, and counting the tasks in each listed note once they are shown.

import { readProjectNoteCandidates, withTaskCounts } from "plan-wizard/project-note-candidates";
import { logIfEnabled } from "util/log";
import { useEffect, useState } from "react";

// How long typing must pause before the search runs, so each keystroke does not cost a read.
const SEARCH_DELAY_MILLISECONDS = 250;
const EMPTY_CANDIDATES = { bestMatches: [], recentlyEdited: [] };

// ----------------------------------------------------------------------------------------------
// @desc Drop listed notes whose task count came back as zero: the host's list of notes with tasks can lag behind a
//   note whose last task was just removed. A note whose tasks could not be read (taskCount null) stays.
// @param {Array<object>} candidates - Candidates with taskCount filled by withTaskCounts.
// @returns {Array<object>} The candidates still known to hold tasks.
function candidatesHoldingTasks(candidates) {
  return candidates.filter(candidate => candidate.taskCount !== 0);
}

// ----------------------------------------------------------------------------------------------
// @desc Search for notes to define a project while the menu is open.
// @param {object} app - Amplenote app interface or embed proxy.
// @param {object} params - An object with the following properties:
//   - {boolean} isOpen - Whether the menu is showing; nothing is read while it is closed.
//   - {object} linkedRowUuidByNoteUuid - { [noteUuid]: rowUuid } for notes already defining a project.
//   - {string} projectName - The project's name, ranking best matches before anything is typed.
//   - {string} searchText - Typed search text, or "".
// @returns {object} { bestMatches, isSearching, recentlyEdited }.
export default function useProjectNoteCandidates(app, { isOpen, linkedRowUuidByNoteUuid, projectName, searchText }) {
  const [candidates, setCandidates] = useState(EMPTY_CANDIDATES);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    let isCurrent = true;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await readProjectNoteCandidates(app, { linkedRowUuidByNoteUuid, projectName, searchText });
        if (!isCurrent) return;
        setCandidates(found);
        setIsSearching(false);
        const [countedMatches, countedRecent] = await Promise.all([withTaskCounts(app, found.bestMatches),
          withTaskCounts(app, found.recentlyEdited)]);
        if (!isCurrent) return;
        setCandidates({ bestMatches: candidatesHoldingTasks(countedMatches), recentlyEdited: candidatesHoldingTasks(countedRecent) });
      } catch (error) {
        logIfEnabled("[use-project-note-candidates] note search failed", error?.message);
        if (isCurrent) setIsSearching(false);
      }
    }, SEARCH_DELAY_MILLISECONDS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [app, isOpen, linkedRowUuidByNoteUuid, projectName, searchText]);

  return { ...candidates, isSearching };
}
