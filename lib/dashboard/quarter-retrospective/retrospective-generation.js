// Generate a Quarter Retrospective and record it in its data note, and read back the ones already generated. Every
// style gathers the quarter, then asks the AI to digest each month and, when the quarter had no projects, to infer
// them from the months' themes. The Data style plays the slides built from the statistics and those digests; the Roast
// and Spotify styles make one more call that rewrites those slides' words in the style's voice.
import { readCalendarHistory } from "dashboard/quarter-retrospective/calendar-history-journal";
import { findRetrospectiveDataNotes, RETROSPECTIVE_SECTIONS, retrospectiveMonthSection, retrospectiveStyleLabel,
  startRetrospectiveDataNote, writeRetrospectiveDataSection } from "dashboard/quarter-retrospective/retrospective-data-note";
import { gatherRetrospectiveQuarter } from "dashboard/quarter-retrospective/retrospective-data";
import { digestRetrospectiveMonths } from "dashboard/quarter-retrospective/retrospective-month-digests";
import { RETROSPECTIVE_STYLES, slidesFromStatistics } from "dashboard/quarter-retrospective/retrospective-slides";
import { retrospectiveStatistics } from "dashboard/quarter-retrospective/retrospective-statistics";
import { writeRetrospectiveStory } from "dashboard/quarter-retrospective/retrospective-story-writer";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { fastModelOptions } from "providers/ai-provider-settings";
import { isAmplenoteLlmAvailable } from "providers/amplenote-llm";
import { dateKeyFromDateInput } from "util/date-utility";
import { logIfEnabled } from "util/log";

const GENERATION_LOG_LABEL = "[quarter-retrospective]";
// Month digests read a whole month of tasks, so they get far longer than the dashboard's usual minute.
export const RETROSPECTIVE_LLM_TIMEOUT_SECONDS = 150;
const RETROSPECTIVE_LLM_SOURCE = "quarter-retrospective";
// Styles that can be generated today. Any others are offered on the options screen as arriving later.
export const AVAILABLE_RETROSPECTIVE_STYLES = Object.freeze([RETROSPECTIVE_STYLES.data, RETROSPECTIVE_STYLES.roast, RETROSPECTIVE_STYLES.spotify]);
// The soundtrack moods the options screen offers. The choice is recorded with the request so the story's synthesized
// loop can play in that mood.
export const RETROSPECTIVE_SOUNDTRACK_VIBES = Object.freeze({ anthem: "anthem", chill: "chill", synthwave: "synthwave" });
export const DEFAULT_RETROSPECTIVE_SOUNDTRACK_VIBE = RETROSPECTIVE_SOUNDTRACK_VIBES.chill;
export const DEFAULT_RETROSPECTIVE_STYLE = RETROSPECTIVE_STYLES.spotify;
// Styles whose words the AI writes, which can't be generated without one.
export const AI_WRITTEN_RETROSPECTIVE_STYLES = Object.freeze([RETROSPECTIVE_STYLES.roast, RETROSPECTIVE_STYLES.spotify]);

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
// @desc Whether an AI can write a retrospective: a key the user configured or the plugin LLM license.
// @param {object} app - Host-compatible Amplenote API.
// @returns {Promise<boolean>} True when the AI-written styles can be generated.
export async function retrospectiveAiAvailable(app) {
  if (fastModelOptions(pluginSettings())) return true;
  try {
    return await isAmplenoteLlmAvailable(app);
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not check the AI's availability`, error?.message);
    return false;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc A function that asks the account's AI a retrospective prompt, or null when no AI can answer.
// @param {object} app - Amplenote API.
// @returns {Promise<Function|null>} async (prompt) => parsed JSON reply or null.
export async function retrospectivePromptRequester(app) {
  if (!(await retrospectiveAiAvailable(app))) return null;
  const settings = pluginSettings();
  const llmOptions = { ...wizardLlmOptions(settings), source: RETROSPECTIVE_LLM_SOURCE, timeoutSeconds: RETROSPECTIVE_LLM_TIMEOUT_SECONDS };
  return prompt => raceWizardPrompt(app, prompt, llmOptions);
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's playable retrospectives, newest first: each data note whose story can be read.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} options - { domainName, quarter, year }.
// @returns {Promise<Array<object>>} { generatedAt, noteUuid, projects, slides, style, takeawaysNoteUuid } per style,
//   projects being the quarter's { derivedFrom, name, uuid } as recorded, or none, and takeawaysNoteUuid the takeaways
//   note saved from it, or null.
export async function savedRetrospectives(app, { domainName, quarter, year }) {
  const dataNotes = await findRetrospectiveDataNotes(app, { domainName, quarter, year });
  const playable = [];
  for (const dataNote of dataNotes) {
    const slides = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.story)?.slides;
    if (!Array.isArray(slides) || !slides.length) continue;
    const projects = _rankableProjects(dataNote.payloads.get(RETROSPECTIVE_SECTIONS.projects)?.projects);
    const takeawaysNoteUuid = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.takeaways)?.noteUuid || null;
    playable.push({ generatedAt: dataNote.generatedAt, noteUuid: dataNote.noteUuid, projects, slides, style: dataNote.style, takeawaysNoteUuid });
  }
  return playable;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate one style of retrospective and record it: the request, the statistics, the projects, each month's
//   digest, the calendar when included, the image candidates and those the story shows, and the story. A month digested
//   by an earlier generation of another style is reused when its tasks haven't changed. Without an AI to ask, a Data
//   retrospective gives each month a plain digest and still plays. When the story call of a Roast or Spotify
//   retrospective fails, its slides keep their plain words, and the Story section records that. The story is returned
//   even when recording it fails, so a note that can't be written never keeps the user from seeing their quarter.
// @param {object} app - Host-compatible Amplenote API.
// @param {object} request - An object with the following properties:
//   - {string} domainName - Task domain display name
//   - {string|null} domainUuid - Task domain UUID
//   - {object} options - The options screen's choices: { includeCalendar, includeImages, soundtrackVibe }; images are
//     shown unless includeImages is false, and soundtrackVibe is a RETROSPECTIVE_SOUNDTRACK_VIBES value
//   - {number} quarter - 1 through 4
//   - {string} style - One of AVAILABLE_RETROSPECTIVE_STYLES
//   - {number} year - Calendar year
// @param {object} [options] - An object with the following properties:
//   - {Function} [onProgress] - Receives a short description of each step as it starts
//   - {Function} [onProjectsKnown] - Receives the quarter's { derivedFrom, name, uuid } projects as soon as they are
//     known: after gathering when the plan or ledger named some, otherwise after the AI infers them from themes. Not
//     called for a quarter with no projects either way
//   - {Function|null} [requestPrompt] - async (prompt) => parsed JSON reply; replaces the AI for tests. Left out, the
//     account's AI is asked when one is available
// @returns {Promise<object>} { generatedAt, noteUuid, projects, slides, style }; noteUuid is null when recording failed.
// @throws When the style can't be generated yet or needs an AI that isn't available, or the quarter's completed tasks
//   could not be read.
export async function generateRetrospective(app, request, { onProgress = () => {}, onProjectsKnown = () => {}, requestPrompt } = {}) {
  if (!AVAILABLE_RETROSPECTIVE_STYLES.includes(request.style)) throw new Error(`The ${ request.style } style isn't available yet`);
  const askPrompt = typeof requestPrompt === "undefined" ? await retrospectivePromptRequester(app) : requestPrompt;
  if (!askPrompt && AI_WRITTEN_RETROSPECTIVE_STYLES.includes(request.style)) {
    throw new Error(`The ${ retrospectiveStyleLabel(request.style) } style is written by AI, and no AI provider `
      + "is available. Choose a provider in Dashboard Settings, or choose Data");
  }
  const gathered = await gatherRetrospectiveQuarter(app, { ...request, includeCalendar: !!request.options?.includeCalendar }, { onProgress });
  if (gathered.projects.length) onProjectsKnown(_rankableProjects(gathered.projects));
  const { reusableDigests, reusableInferredProjects } = await _reusableDigestion(app, request);
  const { inferredProjects, monthDigests } = await digestRetrospectiveMonths({ calendar: gathered.calendar, completions: gathered.completions,
    inferProjects: !gathered.projects.length, media: gathered.media, quarter: request.quarter, reusableDigests, reusableInferredProjects,
    year: request.year },
  { onProgress, requestPrompt: askPrompt });
  if (inferredProjects?.length) onProjectsKnown(_rankableProjects(inferredProjects));
  const statistics = inferredProjects ? retrospectiveStatistics({ ...gathered.statisticsInputs, inferredProjects }) : gathered.statistics;
  const projects = _rankableProjects([...gathered.projects, ...(inferredProjects || [])]);
  const baseSlides = slidesFromStatistics(statistics, { monthDigests });
  if (AI_WRITTEN_RETROSPECTIVE_STYLES.includes(request.style)) onProgress(`Writing your ${ retrospectiveStyleLabel(request.style) } story…`);
  const media = request.options?.includeImages === false ? [] : gathered.media;
  const story = await writeRetrospectiveStory({ baseSlides, media, monthDigests, statistics, style: request.style }, { requestPrompt: askPrompt });
  const slides = story.slides;
  const generatedAt = new Date().toISOString();
  onProgress("Saving your retrospective…");
  try {
    const started = await startRetrospectiveDataNote(app, request);
    const monthSections = monthDigests.map(digest => [retrospectiveMonthSection(digest.monthNumber), digest]);
    const sections = [[RETROSPECTIVE_SECTIONS.statistics, statistics],
      [RETROSPECTIVE_SECTIONS.projects, { projects: [...gathered.projects, ...(inferredProjects || [])] }], ...monthSections,
      [RETROSPECTIVE_SECTIONS.calendar, gathered.calendar], [RETROSPECTIVE_SECTIONS.media, { candidates: media, chosen: story.imageUrls }],
      [RETROSPECTIVE_SECTIONS.story, { generatedBy: story.generatedBy, slides }]];
    const presentSections = sections.filter(([, payload]) => payload);
    let content = started.content;
    for (const [heading, payload] of presentSections) {
      content = await writeRetrospectiveDataSection(app, { content, heading, noteHandle: started.noteHandle, payload });
    }
    return { generatedAt, noteUuid: started.noteHandle.uuid, projects, slides, style: request.style };
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not record the retrospective`, error?.message);
    return { generatedAt, noteUuid: null, projects, slides, style: request.style };
  }
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc The parts of a quarter's projects a payoff ranking records, leaving out any without a name.
// @param {Array<object>|undefined} projects - Gathered, inferred, or recorded projects.
// @returns {Array<object>} { derivedFrom, name, uuid } per named project.
function _rankableProjects(projects) {
  const namedProjects = (Array.isArray(projects) ? projects : []).filter(project => project?.name);
  const rankableProjects = namedProjects.map(project => ({ derivedFrom: project.derivedFrom || null, name: project.name, uuid: project.uuid || null }));
  return rankableProjects;
}

// ----------------------------------------------------------------------------------------------
// @desc The month digests and inferred projects of the quarter's most recent generation in another style, which a
//   new generation can reuse for months whose tasks haven't changed. The style being generated is skipped, so
//   generating it again asks afresh.
// @param {object} app - Amplenote API.
// @param {object} request - { domainName, quarter, style, year }.
// @returns {Promise<object>} { reusableDigests, reusableInferredProjects }: stored month digests, or none, and the
//   projects that generation inferred from themes, or null.
async function _reusableDigestion(app, request) {
  try {
    const dataNotes = await findRetrospectiveDataNotes(app, request);
    const otherStyleNotes = dataNotes.filter(dataNote => dataNote.style !== request.style);
    for (const dataNote of otherStyleNotes) {
      const digests = [1, 2, 3].map(monthNumber => dataNote.payloads.get(retrospectiveMonthSection(monthNumber))).filter(Boolean);
      if (!digests.length) continue;
      const recordedProjects = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.projects)?.projects || [];
      const inferredProjects = recordedProjects.filter(project => project?.derivedFrom === "themes" && Array.isArray(project.taskUuids));
      return { reusableDigests: digests, reusableInferredProjects: inferredProjects.length ? inferredProjects : null };
    }
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not read earlier month digests`, error?.message);
  }
  return { reusableDigests: [], reusableInferredProjects: null };
}
