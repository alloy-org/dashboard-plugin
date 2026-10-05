// Track which Quarterly Planning quarters Plan Builder has begun, so a card whose quarter holds saved answers but
// no plan note yet reads as a plan in progress rather than offering to create one, and the splash steps aside.
import { useEffect, useRef, useState } from "react";
import { resolveBegunQuarterPlan } from "plan-wizard/plan-begun";

// ----------------------------------------------------------------------------------------------
// @desc Key one quarter for the progress map.
// @param {object} plan - A plan carrying quarter and year.
// @returns {string} A key such as "2026-Q4".
export function quarterProgressKey(plan) {
  return `${ plan.year }-Q${ plan.quarter }`;
}

// ----------------------------------------------------------------------------------------------
// @desc Look up the saved answers and plan note of each quarter in targets, once per reload generation. Results
//   from an earlier generation stay readable until the new lookup lands, so closing Plan Builder does not flash
//   the cards back to their loading state. A domain change clears everything.
// @param {object} app - Amplenote app interface.
// @param {object} params - An object with the following properties:
//   - {string|null} domainName - Active task domain's display name, or null for All Notes.
//   - {string|null} domainUuid - Active task domain's UUID, or null for All Notes.
//   - {number} generation - Bumped whenever the quarters should be looked up again, such as Plan Builder closing.
//   - {Array<object>} targets - Quarters to look up, each carrying quarter and year.
// @returns {object} Map of quarterProgressKey to { begun, noteUUID }. A quarter not yet looked up is absent.
export default function useQuarterPlanProgress(app, { domainName = null, domainUuid = null, generation, targets }) {
  const [progressByQuarter, setProgressByQuarter] = useState({});
  const requestedKeys = useRef(new Set());
  const targetKeys = targets.map(quarterProgressKey);
  const uniqueTargetKeys = [...new Set(targetKeys)];
  const targetSignature = uniqueTargetKeys.join(",");

  useEffect(() => {
    requestedKeys.current = new Set();
    setProgressByQuarter({});
  }, [domainName, domainUuid]);

  useEffect(() => {
    if (!targetSignature) return undefined;
    let active = true;
    const pendingRequestKeys = new Set();
    for (const key of uniqueTargetKeys) {
      const requestKey = `${ generation }|${ domainUuid ?? "" }|${ key }`;
      if (requestedKeys.current.has(requestKey)) continue;
      requestedKeys.current.add(requestKey);
      pendingRequestKeys.add(requestKey);
      const target = targets[targetKeys.indexOf(key)];
      resolveBegunQuarterPlan(app, { domainName, domainUuid, quarter: target.quarter, year: target.year }).then(result => {
        pendingRequestKeys.delete(requestKey);
        if (!active) return;
        setProgressByQuarter(previous => ({ ...previous, [key]: { begun: !!result?.begun, noteUUID: result?.noteUUID ?? null } }));
      });
    }
    // A lookup cut off by a newer target list is forgotten, so the next run of this effect asks again.
    return () => {
      active = false;
      for (const requestKey of pendingRequestKeys) requestedKeys.current.delete(requestKey);
    };
  }, [app, domainName, domainUuid, generation, targetSignature]);

  return progressByQuarter;
}
