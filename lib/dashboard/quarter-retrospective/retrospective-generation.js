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
import { completionsWithInferredProjects, retrospectiveStatistics } from "dashboard/quarter-retrospective/retrospective-statistics";
import { writeRetrospectiveStory } from "dashboard/quarter-retrospective/retrospective-story-writer";
import { difficultyRatedProjects, hardestTaskProjects, hardestTasksSlide, rateTaskDifficulties, recordedTaskDifficulties,
  slidesWithHardestTasks, taskDifficultyPayload } from "dashboard/quarter-retrospective/retrospective-task-difficulty";
import { wizardLlmOptions } from "plan-wizard/wizard-prompt-diagnostics";
import { raceWizardPrompt } from "plan-wizard/wizard-prompt-runner";
import { pluginSettings } from "plugin-data";
import { fastModelOptions } from "providers/ai-provider-settings";
import { isAmplenoteLlmAvailable } from "providers/amplenote-llm";
import { decisionsEndpointForApp } from "providers/decisions-endpoint-for-app";
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
// @returns {Promise<Array<object>>} { generatedAt, noteUuid, projects, slides, style, takeawaysNoteUuid, totalTaskCount }
//   per style, projects being the quarter's { derivedFrom, name, uuid } as recorded, or none, takeawaysNoteUuid the
//   takeaways note saved from it, or null, and totalTaskCount the completed tasks it was told from, or null when its
//   statistics can't be read.
export async function savedRetrospectives(app, { domainName, quarter, year }) {
  const dataNotes = await findRetrospectiveDataNotes(app, { domainName, quarter, year });
  const playable = [];
  for (const dataNote of dataNotes) {
    const slides = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.story)?.slides;
    if (!Array.isArray(slides) || !slides.length) continue;
    const projects = _rankableProjects(dataNote.payloads.get(RETROSPECTIVE_SECTIONS.projects)?.projects);
    const takeawaysNoteUuid = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.takeaways)?.noteUuid || null;
    const recordedTaskCount = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.statistics)?.totalTaskCount;
    const totalTaskCount = Number.isFinite(recordedTaskCount) ? recordedTaskCount : null;
    playable.push({ generatedAt: dataNote.generatedAt, noteUuid: dataNote.noteUuid, projects, slides, style: dataNote.style, takeawaysNoteUuid,
      totalTaskCount });
  }
  return playable;
}

// ----------------------------------------------------------------------------------------------
// @desc Generate one style of retrospective and record it: the request, the statistics, the projects, each month's
//   digest, the calendar when included, the image candidates and those the story shows, each project task's difficulty
//   rating, and the story. While the story is written, a decisions model rates how difficult each task of a project
//   with enough completions was, and the story gains a slide of each project's hardest tasks. A month digested
//   by an earlier generation of another style is reused when its tasks haven't changed, and only when that generation
//   counted as many completed tasks in the quarter as the domain holds now. Without an AI to ask, a Data
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
//   - {Function} [decisionsEndpointFactory] - async (app) => DecisionsEndpoint or null, which rates task difficulty;
//     decisionsEndpointForApp without the fast model by default. Null leaves the hardest tasks slide out
//   - {Function} [onProgress] - Receives a short description of each step as it starts
//   - {Function} [onProjectsKnown] - Receives the quarter's { derivedFrom, name, uuid } projects as soon as they are
//     known: after gathering when the plan or ledger named some, otherwise after the AI infers them from themes. Not
//     called for a quarter with no projects either way
//   - {Function|null} [requestPrompt] - async (prompt) => parsed JSON reply; replaces the AI for tests. Left out, the
//     account's AI is asked when one is available
// @returns {Promise<object>} { generatedAt, noteUuid, projects, slides, style, totalTaskCount }; noteUuid is null when
//   recording failed.
// @throws When the style can't be generated yet or needs an AI that isn't available, or the quarter's completed tasks
//   could not be read.
export async function generateRetrospective(app, request, { decisionsEndpointFactory = _difficultyEndpoint, onProgress = () => {},
    onProjectsKnown = () => {}, requestPrompt } = {}) {
  if (!AVAILABLE_RETROSPECTIVE_STYLES.includes(request.style)) throw new Error(`The ${ request.style } style isn't available yet`);
  const askPrompt = typeof requestPrompt === "undefined" ? await retrospectivePromptRequester(app) : requestPrompt;
  if (!askPrompt && AI_WRITTEN_RETROSPECTIVE_STYLES.includes(request.style)) {
    throw new Error(`The ${ retrospectiveStyleLabel(request.style) } style is written by AI, and no AI provider `
      + "is available. Choose a provider in Dashboard Settings, or choose Data");
  }
  const gathered = await gatherRetrospectiveQuarter(app, { ...request, includeCalendar: !!request.options?.includeCalendar }, { onProgress });
  if (gathered.projects.length) onProjectsKnown(_rankableProjects(gathered.projects));
  const dataNotes = await _earlierDataNotes(app, request);
  const { reusableDigests, reusableInferredProjects } = _reusableDigestion(dataNotes, request, { completedTaskCount: gathered.completions.length });
  const { inferredProjects, monthDigests } = await digestRetrospectiveMonths({ calendar: gathered.calendar, completions: gathered.completions,
    inferProjects: !gathered.projects.length, media: gathered.media, quarter: request.quarter, reusableDigests, reusableInferredProjects,
    year: request.year },
  { onProgress, requestPrompt: askPrompt });
  if (inferredProjects?.length) onProjectsKnown(_rankableProjects(inferredProjects));
  const statistics = inferredProjects ? retrospectiveStatistics({ ...gathered.statisticsInputs, inferredProjects }) : gathered.statistics;
  const projects = _rankableProjects([...gathered.projects, ...(inferredProjects || [])]);
  logIfEnabled(`${ GENERATION_LOG_LABEL } generating ${ request.style }`, { domainUuid: request.domainUuid, projectCount: projects.length,
    totalTaskCount: statistics.totalTaskCount });
  const baseSlides = slidesFromStatistics(statistics, { monthDigests });
  const creditedCompletions = inferredProjects ? completionsWithInferredProjects(gathered.completions, inferredProjects) : gathered.completions;
  const difficultyRating = _taskDifficulties(app, creditedCompletions, { dataNotes, decisionsEndpointFactory });
  if (AI_WRITTEN_RETROSPECTIVE_STYLES.includes(request.style)) onProgress(`Writing your ${ retrospectiveStyleLabel(request.style) } story…`);
  else if (difficultyRatedProjects(creditedCompletions).length) onProgress("Rating your hardest tasks…");
  const media = request.options?.includeImages === false ? [] : gathered.media;
  const [story, difficultyByTaskUuid] = await Promise.all([writeRetrospectiveStory({ baseSlides, media, monthDigests, statistics,
    style: request.style }, { requestPrompt: askPrompt }), difficultyRating]);
  const hardestSlide = hardestTasksSlide(hardestTaskProjects(creditedCompletions, difficultyByTaskUuid));
  const slides = slidesWithHardestTasks(story.slides, hardestSlide);
  const generatedAt = new Date().toISOString();
  const totalTaskCount = statistics.totalTaskCount;
  onProgress("Saving your retrospective…");
  try {
    const started = await startRetrospectiveDataNote(app, request);
    const monthSections = monthDigests.map(digest => [retrospectiveMonthSection(digest.monthNumber), digest]);
    const sections = [[RETROSPECTIVE_SECTIONS.statistics, statistics],
      [RETROSPECTIVE_SECTIONS.projects, { projects: [...gathered.projects, ...(inferredProjects || [])] }], ...monthSections,
      [RETROSPECTIVE_SECTIONS.calendar, gathered.calendar], [RETROSPECTIVE_SECTIONS.media, { candidates: media, chosen: story.imageUrls }],
      [RETROSPECTIVE_SECTIONS.taskDifficulty, taskDifficultyPayload(creditedCompletions, difficultyByTaskUuid)], [RETROSPECTIVE_SECTIONS.story, { generatedBy: story.generatedBy, slides }]];
    const presentSections = sections.filter(([, payload]) => payload);
    let content = started.content;
    for (const [heading, payload] of presentSections) {
      content = await writeRetrospectiveDataSection(app, { content, heading, noteHandle: started.noteHandle, payload });
    }
    return { generatedAt, noteUuid: started.noteHandle.uuid, projects, slides, style: request.style, totalTaskCount };
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not record the retrospective`, error?.message);
    return { generatedAt, noteUuid: null, projects, slides, style: request.style, totalTaskCount };
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
// @desc The endpoint task difficulty is rated through: a decisions model only, since the fast model costs far more per
//   task. Failing to resolve one leaves the hardest tasks slide out rather than failing the generation.
// @param {object} app - Amplenote API.
// @returns {Promise<DecisionsEndpoint|null>} The endpoint, or null.
async function _difficultyEndpoint(app) {
  try {
    return await decisionsEndpointForApp(app, { includeFastScore: false });
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not choose a decisions endpoint`, error?.message);
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The quarter's earlier data notes, newest first, or none when they can't be read.
// @param {object} app - Amplenote API.
// @param {object} request - { domainName, quarter, year }.
// @returns {Promise<Array<object>>} Data notes, as findRetrospectiveDataNotes returns them.
async function _earlierDataNotes(app, request) {
  try {
    return await findRetrospectiveDataNotes(app, request);
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not read earlier data notes`, error?.message);
    return [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The month digests and inferred projects of the quarter's most recent generation in another style, which a
//   new generation can reuse for months whose tasks haven't changed. The style being generated is skipped, so
//   generating it again asks afresh. A generation whose recorded completed task count differs from the domain's count
//   now is skipped too, since tasks completed or uncompleted since then would be missing from its themes.
// @param {Array<object>} dataNotes - The quarter's earlier data notes, newest first.
// @param {object} request - { style }.
// @param {object} options - { completedTaskCount }: the quarter's completions as just gathered from the task domain.
// @returns {object} { reusableDigests, reusableInferredProjects }: stored month digests, or none, and the projects that
//   generation inferred from themes, or null.
function _reusableDigestion(dataNotes, request, { completedTaskCount }) {
  const otherStyleNotes = dataNotes.filter(dataNote => dataNote.style !== request.style);
  for (const dataNote of otherStyleNotes) {
    const recordedTaskCount = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.statistics)?.totalTaskCount;
    if (recordedTaskCount !== completedTaskCount) {
      logIfEnabled(`${ GENERATION_LOG_LABEL } not reusing the ${ dataNote.style } digests`, { completedTaskCount, recordedTaskCount });
      continue;
    }
    const digests = [1, 2, 3].map(monthNumber => dataNote.payloads.get(retrospectiveMonthSection(monthNumber))).filter(Boolean);
    if (!digests.length) continue;
    const recordedProjects = dataNote.payloads.get(RETROSPECTIVE_SECTIONS.projects)?.projects || [];
    const inferredProjects = recordedProjects.filter(project => project?.derivedFrom === "themes" && Array.isArray(project.taskUuids));
    return { reusableDigests: digests, reusableInferredProjects: inferredProjects.length ? inferredProjects : null };
  }
  return { reusableDigests: [], reusableInferredProjects: null };
}

// ----------------------------------------------------------------------------------------------
// @desc Rate the difficulty of the quarter's project tasks, reusing ratings earlier generations recorded. Never
//   rejects: without an endpoint, or when rating fails, the ratings recorded so far are all there is.
// @param {object} app - Amplenote API.
// @param {Array<object>} completions - Completions credited to projects.
// @param {object} options - { dataNotes, decisionsEndpointFactory }; a null factory rates nothing.
// @returns {Promise<Map<string, number>>} Difficulty by task UUID.
async function _taskDifficulties(app, completions, { dataNotes, decisionsEndpointFactory }) {
  const recordedDifficulties = recordedTaskDifficulties(dataNotes);
  if (!decisionsEndpointFactory || !difficultyRatedProjects(completions).length) return recordedDifficulties;
  try {
    const endpoint = await decisionsEndpointFactory(app);
    if (!endpoint) return recordedDifficulties;
    return await rateTaskDifficulties(completions, { endpoint, recordedDifficulties });
  } catch (error) {
    logIfEnabled(`${ GENERATION_LOG_LABEL } could not rate task difficulty`, error?.message);
    return recordedDifficulties;
  }
}
