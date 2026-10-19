// Collect what a calendar suggestion pass asks the DecisionsEndpoint, for the pass's generation report. Days are planned
// one at a time, so a request made while a day is being planned is held until that day completes and is then filed
// under it; a request made before the first day is planned or after the last one completes is filed for the whole
// pass. Each request is kept abbreviated: its first question stands for the rest, which ask the same of each task, and
// every list of tasks in its state is replaced by "[Array of N tasks]", leaving the prompt the tasks were rated under.
import { observeDecisionRequests } from "providers/decisions-endpoint";

// The longest a question, rubric, or state is shown before it is cut off, so one request cannot crowd out the report.
const MAX_PIECE_CHARACTERS = 4000;
// State keys whose value lists the tasks being rated: a ranking's taskCandidates, salience's candidates, and the
// duration questions' tasks.
const TASK_LIST_KEYS = new Set(["candidates", "taskCandidates", "tasks"]);

// ----------------------------------------------------------------------------------------------
// @desc The DecisionsEndpoint requests one calendar pass makes, filed by the day they were made for. Observing starts
//   on construction and ends with finish.
export default class PassDecisionRequests {
  passRequests = []; // {Array<object>} Abbreviated requests made outside any day.
  pendingRequests = []; // {Array<object>} Abbreviated requests made since requests were last filed.
  requestsByDayKey = new Map(); // {Map<string, Array<object>>} Abbreviated requests by Date#toDateString.
  stopObserving; // {function} Ends the observing.

  // ----------------------------------------------------------------------------------------------
  // @desc Start holding every request the bundle's DecisionsEndpoints make, abbreviated as it is made.
  constructor() {
    this.stopObserving = observeDecisionRequests(request => this.pendingRequests.push(abbreviatedDecisionRequest(request)));
  }

  // ----------------------------------------------------------------------------------------------
  // @desc File the requests made since the last filing under a day. Called as the day completes, and again once the
  //   pass has handled it, so a refill made while handling the day is filed with it rather than with the next day.
  // @param {string} dayKey - The day's Date#toDateString.
  fileUnderDay(dayKey) {
    if (!this.pendingRequests.length) return;
    const dayRequests = this.requestsByDayKey.get(dayKey) || [];
    this.requestsByDayKey.set(dayKey, [...dayRequests, ...this.pendingRequests]);
    this.pendingRequests = [];
  }

  // ----------------------------------------------------------------------------------------------
  // @desc File the requests made since the last filing for the whole pass: those made before its first day is planned.
  fileUnderPass() {
    this.passRequests.push(...this.pendingRequests);
    this.pendingRequests = [];
  }

  // ----------------------------------------------------------------------------------------------
  // @desc Stop observing, filing anything made after the last day completed for the whole pass.
  finish() {
    this.stopObserving();
    this.fileUnderPass();
  }

  // ----------------------------------------------------------------------------------------------
  // @desc The requests filed under one day.
  // @param {string} dayKey - The day's Date#toDateString.
  // @returns {Array<object>} Abbreviated requests, in the order they were made.
  requestsForDay(dayKey) {
    return this.requestsByDayKey.get(dayKey) || [];
  }
}

// ----------------------------------------------------------------------------------------------
// @desc Abbreviate one request for the report: what kind of rating it asked for, how many questions it asked, its first
//   question and rubric, and its state with each list of tasks replaced by "[Array of N tasks]".
// @param {object} request - { questions, state } as DecisionsEndpoint#rankedResponses was asked.
// @returns {object} { kind, questionCount, rubricText, sampleInstructions, sampleName, stateText }: kind is "Ranking",
//   "Salience", "Duration estimates", or "Rating"; the texts are single-line.
export function abbreviatedDecisionRequest({ questions, state }) {
  const questionEntries = Object.entries(questions || {});
  const [sampleName, sampleQuestion] = questionEntries[0] || [null, null];
  const instructions = sampleQuestion?.instructions;
  const sampleInstructions = _singleLine(typeof instructions === "string" ? instructions : JSON.stringify(instructions ?? null));
  const abbreviatedState = typeof state === "string" ? state : JSON.stringify(_withTaskListsAbbreviated(state ?? null));
  return { kind: _requestKind(state), questionCount: questionEntries.length, rubricText: _rubricText(sampleQuestion?.criteria),
    sampleInstructions, sampleName, stateText: _singleLine(abbreviatedState) };
}

// ----------------------------------------------------------------------------------------------
// @desc Nested markdown bullets for a list of abbreviated requests, each headed by its kind, question count, and size
//   without its tasks, over its first question, its rubric, and its state.
// @param {Array<object>} requests - From abbreviatedDecisionRequest.
// @param {string} [indent=""] - Prefix for the outermost bullets.
// @returns {Array<string>} Markdown lines.
export function decisionRequestLines(requests, indent = "") {
  return requests.flatMap(request => {
    const characterCount = request.sampleInstructions.length + request.rubricText.length + request.stateText.length;
    const questionWord = request.questionCount === 1 ? "question" : "questions";
    const heading = `${ indent }- ${ request.kind }, ${ request.questionCount } ${ questionWord }, `
      + `${ characterCount.toLocaleString("en-US") } characters without its tasks:`;
    const sampleLabel = request.questionCount > 1 ? `Each task asked, as ${ request.sampleName }` : `Asked of ${ request.sampleName }`;
    return [heading, `${ indent }  - ${ sampleLabel }: ${ _inlineCode(request.sampleInstructions) }`,
      `${ indent }  - Rubric: ${ _inlineCode(request.rubricText) }`, `${ indent }  - State: ${ _inlineCode(request.stateText) }`];
  });
}

// ----------------------------------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------------------------------

// ----------------------------------------------------------------------------------------------
// @desc Text as inline code, cut to MAX_PIECE_CHARACTERS, with any backtick swapped for a quote so the span stays whole.
// @param {string} text - Single-line text.
// @returns {string} "`text`".
function _inlineCode(text) {
  const shortText = text.length > MAX_PIECE_CHARACTERS ? `${ text.slice(0, MAX_PIECE_CHARACTERS - 1) }…` : text;
  return `\`${ shortText.replace(/`/g, "'") || " " }\``;
}

// ----------------------------------------------------------------------------------------------
// @desc Name the rating a request asked for from the shape of its state.
// @param {object|string|null} state - The request's state.
// @returns {string} "Salience", "Ranking", "Duration estimates", or "Rating".
function _requestKind(state) {
  if (state?.day && state?.groups) return "Salience";
  if (state?.projects) return state.focus ? "Ranking with the re-roll's focus" : "Ranking";
  if (state?.tasks && "userTermsDictionary" in state) return "Duration estimates";
  return "Rating";
}

// ----------------------------------------------------------------------------------------------
// @desc A question's rubric on one line: a score question's levels, lowest first, or a choice question's choices.
// @param {Array<string>|object|undefined} criteria - The question's criteria.
// @returns {string} e.g. "1: do not suggest this task today; 2; 3: …" or "30: 30 minutes; 60: 60 minutes".
function _rubricText(criteria) {
  if (Array.isArray(criteria)) return _singleLine(criteria.join("; "));
  if (criteria && typeof criteria === "object") {
    const choiceTexts = Object.entries(criteria).map(([choice, description]) => `${ choice }: ${ description }`);
    return _singleLine(choiceTexts.join("; "));
  }
  return "";
}

// ----------------------------------------------------------------------------------------------
// @desc Collapse runs of whitespace, newlines included, to single spaces.
// @param {string} text - Any text.
// @returns {string}
function _singleLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------------------------------
// @desc A copy of a request's state with every list of tasks, under a TASK_LIST_KEYS key, replaced by its count.
// @param {*} value - The state or a value within it.
// @param {string|null} [key=null] - The key value was found under.
// @returns {*} The abbreviated copy.
function _withTaskListsAbbreviated(value, key = null) {
  if (key && TASK_LIST_KEYS.has(key) && value && typeof value === "object") {
    const taskCount = Array.isArray(value) ? value.length : Object.keys(value).length;
    return `[Array of ${ taskCount } tasks]`;
  }
  if (Array.isArray(value)) return value.map(item => _withTaskListsAbbreviated(item));
  if (!value || typeof value !== "object") return value;
  const abbreviatedEntries = Object.entries(value).map(([entryKey, entryValue]) => [entryKey,
    _withTaskListsAbbreviated(entryValue, entryKey)]);
  return Object.fromEntries(abbreviatedEntries);
}
