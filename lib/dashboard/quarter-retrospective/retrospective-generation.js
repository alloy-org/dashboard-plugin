// Generate a Quarter Retrospective and record it in its data note, and read back the ones already generated. The Data
// style is built from the quarter's statistics alone; the styles written by the AI build on the same first steps.
import { readCalendarHistory } from "dashboard/quarter-retrospective/calendar-history-journal";
import { findRetrospectiveDataNotes, RETROSPECTIVE_SECTIONS, startRetrospectiveDataNote,
  writeRetrospectiveDataSection } from "dashboard/quarter-retrospective/retrospective-data-note";
import { gatherRetrospectiveQuarter } from "dashboard/quarter-retrospective/retrospective-data";
import { RETROSPECTIVE_STYLES, slidesFromStatistics } from "dashboard/quarter-retrospective/retrospective-slides";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const GENERATION_LOG_LABEL = "[quarter-retrospective]";
// Styles that can be generated today. The others are offered on the options screen as arriving later.
export const AVAILABLE_RETROSPECTIVE_STYLES = Object.freeze([RETROSPECTIVE_STYLES.data]);

// ----------------------------------------------------------------------------------------------
// @desc The first and last day of a quarter.
// @param {object} options - { quarter, year }.
// @returns {object} { endDateKey, startDateKey } as YYYY-MM-DD, end inclusive.
export function quarterDateKeyRange({ quarter, year }) {
  const startDateKey = dateKeyFromDateInput(new Date(year, (quarter - 1) * 3, 1));
  const endDateKey = dateKeyFromDateInput(new Date(year, quarter * 3, 0));
  return { endDateKey, startDateKey };
}

// ----------------------------------------------------------------------------------------------
// @desc How much of a quarter the domain's calendar journal covers, for the options screen's calendar toggle.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, quarter, year }.
// @returns {Promise<object|null>} { coveredDays, totalDays }, or null when the journal could not be read.
export async function quarterCalendarCoverage(app, { domainName, quarter, year }) {
  try {
    const history = await readCalendarHistory(app, { domainName, ...quarterDateKeyRange({ quarter, year }) });
    return history.coverage;
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not read the calendar journal`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's playable retrospectives, newest first: each data note whose story can be read.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, quarter, year }.
// @returns {Promise<Array<object>>} { generatedAt, noteUuid, slides, style } per style.
export async function savedRetrospectives(app, { domainName, quarter, year }) {
  const dataNotes = await findRetrospectiveDataNotes(app, { domainName, quarter, year });
  const playable = [];
  for (const dataNote of dataNotes) {
    const slides = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.story)?.slides;
    if (Array.isArray(slides) && slides.length) playable.push({ generatedAt: dataNote.generatedAt, noteUuid: dataNote.noteUuid, slides, style: dataNote.style });
  }
  return playable;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate one style of retrospective and record it: the request, the statistics, the projects, the calendar
//   when included, the image candidates, and the story. The story is returned even when recording it fails, so a note
//   that can't be written never keeps the user from seeing their quarter.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} request - An object with the following properties:
//   - {string} domainName - Task domain display name
//   - {string|null} domainUuid - Task domain UUID
//   - {object} options - The options screen's choices, such as { includeCalendar }
//   - {number} quarter - 1 through 4
//   - {string} style - One of AVAILABLE_RETROSPECTIVE_STYLES
//   - {number} year - Calendar year
// @param {object} [options] - { onProgress }: receives a short description of each step as it starts.
// @returns {Promise<object>} { generatedAt, noteUuid, slides, style }; noteUuid is null when recording failed.
// @throws When the style can't be generated yet, or the quarter's completed tasks could not be read.
export async function generateRetrospective(app, request, { onProgress = () => {} } = {}) {
  if (!AVAILABLE_RETROSPECTIVE_STYLES.includes(request.style)) throw new Error(`The ${ request.style } style isn't available yet`);
  const gathered = await gatherRetrospectiveQuarter(app, { ...request, includeCalendar: !!request.options?.includeCalendar }, { onProgress });
  const slides = slidesFromStatistics(gathered.statistics);
  const generatedAt = new Date().toISOString();
  onProgress("Saving your retrospective…");
  try {
    const started = await startRetrospectiveDataNote(app, request);
    const sections = [[RETROSPECTIVE_SECTIONS.statistics, gathered.statistics], [RETROSPECTIVE_SECTIONS.projects, { projects: gathered.projects }],
      [RETROSPECTIVE_SECTIONS.calendar, gathered.calendar], [RETROSPECTIVE_SECTIONS.media, { candidates: gathered.media, chosen: [] }],
      [RETROSPECTIVE_SECTIONS.story, { slides }]];
    const presentSections = sections.filter(([, payload]) => payload);
    let content = started.content;
    for (const [heading, payload] of presentSections) {
      content = await writeRetrospectiveDataSection(app, { content, heading, noteHandle: started.noteHandle, payload });
    }
    return { generatedAt, noteUuid: started.noteHandle.uuid, slides, style: request.style };
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not record the retrospective`, error?.message);
    return { generatedAt, noteUuid: null, slides, style: request.style };
  }
}
