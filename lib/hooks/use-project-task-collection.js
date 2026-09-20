// Start the background project/task association pass once the dashboard has finished loading every component,
// so the quarterly task store keeps filling in without delaying anything the user is waiting to see.
import { collectProjectTasks } from "dashboard/project-task-collection";
import { widgetMountingSuspended } from "dashboard/widget-mount-suspension";
import { useCallback, useEffect, useRef } from "react";
import { logIfEnabled } from "util/log";
import { resolveQuarterlyPlanNote } from "util/quarterly-plan-notes";

const COLLECTION_LOG_LABEL = "[project-task-collection]";
// The dashboard has just finished loading; let the browser settle before spending bandwidth on background work.
const COLLECTION_START_DELAY_MS = 4000;

// ------------------------------------------------------------------------------------------
// @desc Return a callback that launches one background collection pass, guaranteed to run at most once per
//   mounted dashboard. The pass is abandoned when the dashboard unmounts mid-flight, and any failure is
//   logged rather than surfaced: this is opportunistic background work, and a user who never opens the
//   Proposed Agenda should never see an error from it.
// @param {Object} options - An object with the following properties:
//   - {Object} app - Amplenote app bridge
//   - {string|null} domainName - Display name of the active task domain
//   - {string|null} domainUuid - UUID of the active task domain
//   - {boolean} [enabled=true] - False suppresses the pass entirely (used while Plan Builder is open)
// @returns {function} Callback to invoke when the dashboard's widgets have all settled.
export function useProjectTaskCollection({ app, domainName, domainUuid, enabled = true }) {
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef(null);
  useEffect(() => () => {
    mountedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return useCallback(() => {
    if (startedRef.current || !enabled || !app) return;
    startedRef.current = true;
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      // An overlay (notably Plan Builder) opening during the delay means the user is doing something the
      // background pass would compete with; a later dashboard load starts the pass instead.
      if (widgetMountingSuspended()) {
        logIfEnabled(`${ COLLECTION_LOG_LABEL } skipped: an overlay is open`);
        return;
      }
      const shouldContinue = () => mountedRef.current && !widgetMountingSuspended();
      _runCollectionPass(app, { domainName, domainUuid, shouldContinue })
        .catch(error => logIfEnabled(`${ COLLECTION_LOG_LABEL } pass failed`, error?.message));
    }, COLLECTION_START_DELAY_MS);
  }, [app, domainName, domainUuid, enabled]);
}

// ------------------------------------------------------------------------------------------
// @desc Read the quarter's plan note and hand its markdown to one collection pass. Resolved here rather than
//   inside the collector so the collector stays a plain service that takes the plan content it operates on.
// @param {Object} app - Amplenote app bridge.
// @param {Object} options - { domainName, domainUuid, shouldContinue }.
// @returns {Promise<void>}
async function _runCollectionPass(app, { domainName, domainUuid, shouldContinue }) {
  const now = new Date();
  const quarterLabel = `Q${ Math.floor(now.getMonth() / 3) + 1 } ${ now.getFullYear() }`;
  const planNote = await resolveQuarterlyPlanNote(app, false, domainName, quarterLabel);
  if (!planNote?.uuid) {
    logIfEnabled(`${ COLLECTION_LOG_LABEL } no quarterly plan note for this domain; nothing to collect`);
    return;
  }
  const quarterlyContent = await app.getNoteContent({ uuid: planNote.uuid });
  if (!shouldContinue()) return;
  await collectProjectTasks(app, { domainName, domainUuid, now, quarterlyContent: quarterlyContent || null, shouldContinue });
}
