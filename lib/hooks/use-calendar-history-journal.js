// Feed the Dashboard's calendar reads into the domain's calendar history journal, so a later Quarter Retrospective can
// look back at meetings the host's forward-only calendar API can no longer return. Each read is recorded a little
// after it arrives, so the journal's note writes stay out of the Dashboard's load.
import { recordCalendarHistory } from "dashboard/quarter-retrospective/calendar-history-journal";
import { EXTERNAL_CALENDAR_WINDOW_DAYS } from "hooks/use-external-calendar-events";
import { useEffect } from "react";
import { logIfEnabled } from "util/log";

// How long after a calendar read arrives to record it. A refocus that reads again within this time replaces the
// pending record rather than adding a second one.
export const CALENDAR_HISTORY_RECORD_DELAY_MILLISECONDS = 20 * 1000;

// ----------------------------------------------------------------------------------------------
// @desc Record each calendar read for the active domain into its journal. Nothing is recorded without a domain, since
//   a retrospective belongs to one domain and an unfiltered read mixes every domain's calendars.
// @param {object} app - Amplenote app bridge.
// @param {object} options - An object with the following properties:
//   - {Array<object>|null} calendarEvents - The Dashboard's latest calendar read, or null while it is loading
//   - {string|null} domainName - Display name of the active task domain
//   - {string|null} domainUuid - UUID of the active task domain
export default function useCalendarHistoryJournal(app, { calendarEvents, domainName, domainUuid }) {
  useEffect(() => {
    if (!calendarEvents || !domainUuid || !domainName) return undefined;
    const timer = setTimeout(() => {
      recordCalendarHistory(app, { domainName, events: calendarEvents, windowDays: EXTERNAL_CALENDAR_WINDOW_DAYS })
        .then(writtenDateKeys => {
          if (writtenDateKeys.length) logIfEnabled("[calendar-history-journal] recorded", { domainName, writtenDateKeys });
        })
        .catch(error => logIfEnabled("[calendar-history-journal] could not record", error?.message));
    }, CALENDAR_HISTORY_RECORD_DELAY_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [app, calendarEvents, domainName, domainUuid]);
}
