// Look up the tasks a page's project reasons cite, so each citation can be drawn as the task it names. Only the cited
// identities are read, one getTask each, and a task already looked up is not read again when the reasons change.

import { readableTaskText } from "dashboard/plan-wizard/substantiation-task-references";
import { logIfEnabled } from "util/log";
import { useEffect, useRef, useState } from "react";

// ----------------------------------------------------------------------------------------------
// @desc Read one cited task, reporting a task the API cannot find, or cannot read, as missing.
// @param {object} app - Amplenote app interface or embed proxy.
// @param {string} taskUuid - Cited task identity.
// @returns {Promise<object|null>} { completedAt, text } for a task that exists, or null.
async function citedTaskFromApp(app, taskUuid) {
  if (typeof app?.getTask !== "function") return null;
  try {
    const task = await app.getTask(taskUuid);
    if (!task || task.dismissedAt) return null;
    return { completedAt: task.completedAt ?? null, text: readableTaskText(task.content) };
  } catch (error) {
    logIfEnabled("[use-cited-tasks] could not read cited task", taskUuid, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Resolve cited task identities to what their chips show. An identity absent from the result is still being
//   read; one mapped to null names a task that no longer exists, whose citation the page drops.
// @param {object} app - Amplenote app interface or embed proxy; without getTask every citation reads as missing.
// @param {Array<string>} taskUuids - Lowercased task identities cited on the page.
// @returns {object} { [taskUuid]: { completedAt, text } | null } for every identity read so far.
export default function useCitedTasks(app, taskUuids) {
  const [citedTaskByUuid, setCitedTaskByUuid] = useState({});
  const requestedUuidsRef = useRef(new Set());
  const taskUuidsKey = taskUuids.join(",");

  useEffect(() => {
    const unrequestedUuids = taskUuids.filter(taskUuid => !requestedUuidsRef.current.has(taskUuid));
    if (!unrequestedUuids.length) return undefined;
    unrequestedUuids.forEach(taskUuid => requestedUuidsRef.current.add(taskUuid));
    let isMounted = true;
    Promise.all(unrequestedUuids.map(taskUuid => citedTaskFromApp(app, taskUuid))).then(citedTasks => {
      if (!isMounted) return;
      const resolvedEntries = unrequestedUuids.map((taskUuid, index) => [taskUuid, citedTasks[index]]);
      setCitedTaskByUuid(previous => ({ ...previous, ...Object.fromEntries(resolvedEntries) }));
    });
    return () => {
      isMounted = false;
      unrequestedUuids.forEach(taskUuid => requestedUuidsRef.current.delete(taskUuid));
    };
  }, [app, taskUuidsKey]);

  return citedTaskByUuid;
}
