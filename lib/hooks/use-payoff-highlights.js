// Look up, once per quarter Plan Builder opens, which projects paid off most in the most recently ranked quarters
// before it, as the user ranked them in the Quarter Retrospective. The intent page shows them as a reminder while
// the user decides what the coming quarter is for. No ranking, or a failed lookup, shows nothing.

import { recalledPayoffRankings } from "plan-wizard/prospect-evidence";
import { useEffect, useState } from "react";

// How many of a quarter's top projects the reminder lists.
export const PAYOFF_HIGHLIGHT_PROJECTS = 3;

// ----------------------------------------------------------------------------------------------
// @desc The top-ranked projects of the most recent ranked quarters before the quarter being planned.
// @param {object} params - An object with the following properties:
//   - {object} app - Amplenote embed app proxy.
//   - {string|null} domainName - Task domain display name, or null for All Notes.
//   - {number} quarter - Quarter being planned, 1 through 4.
//   - {number} year - Planning year.
// @returns {Array<object>} { label, rankings } per ranked quarter, newest first, rankings being the top
//   PAYOFF_HIGHLIGHT_PROJECTS { projectName, rank }; empty while the lookup runs and when nothing was ranked.
export default function usePayoffHighlights({ app, domainName = null, quarter, year }) {
  const [highlights, setHighlights] = useState([]);

  useEffect(() => {
    let isActive = true;
    setHighlights([]);
    recalledPayoffRankings(app, { domainName: domainName ?? "All Notes", quarter, year }).then(rankedQuarters => {
      const topRankedQuarters = rankedQuarters.map(rankedQuarter => ({ label: rankedQuarter.label,
        rankings: rankedQuarter.rankings.slice(0, PAYOFF_HIGHLIGHT_PROJECTS) }));
      if (isActive) setHighlights(topRankedQuarters);
    });
    return () => { isActive = false; };
  }, [app, domainName, quarter, year]);

  return highlights;
}
