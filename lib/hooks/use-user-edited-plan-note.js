// Look up, once per quarter the wizard opens, whether that quarter already has a plan note the user wrote
// outside Plan Builder. The answer is the note's UUID when it does, so the header can link to it, and null
// otherwise. A failed lookup leaves the link hidden: the wizard can still plan the quarter.

import { userEditedPlanNoteUuid } from "plan-wizard/user-edited-plan-note";
import { useEffect, useState } from "react";
import { logIfEnabled } from "util/log";

// ----------------------------------------------------------------------------------------------
// @desc Resolve the UUID of a quarterly plan note that already holds the user's own writing.
// @param {object} params - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {string|null} domainName - Task domain display name, or null for All Notes.
//   - {string|null} domainUuid - Task domain UUID, or null for All Notes.
//   - {number} quarter - Quarter being planned, 1 through 4.
//   - {number} year - Planning year.
// @returns {string|null} The plan note UUID, or null while the lookup is in flight and when the note does not
//   qualify.
export default function useUserEditedPlanNote({ app, domainName = null, domainUuid = null, quarter, year }) {
  const [noteUuid, setNoteUuid] = useState(null);

  useEffect(() => {
    let isActive = true;
    setNoteUuid(null);
    userEditedPlanNoteUuid(app, { domainName, domainUuid, quarter, year }).then(resolvedUuid => {
      if (isActive) setNoteUuid(resolvedUuid);
    }).catch(lookupError => {
      logIfEnabled("[plan-wizard] could not read the quarterly plan note", lookupError?.message);
    });
    return () => { isActive = false; };
  }, [app, domainName, domainUuid, quarter, year]);

  return noteUuid;
}
