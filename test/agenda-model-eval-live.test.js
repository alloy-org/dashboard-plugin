// A live comparison of the models that could answer the Proposed Agenda's generative prompts, run only when
// AGENDA_MODEL_EVAL=1 is set, since every run spends provider credit. Each contender is sent the prompts the Dashboard
// builds, from the same builders it uses (generativeRankPrompt and benefitRationalePrompt), and is timed to its first
// streamed token and to its last. A ranking is scored against graded candidates (NDCG over the top five), or, for a
// case without grades, by how many of its top five a reference model also put in its top five. Benefit sentences are
// checked against the prompt's own rules and written side by side for a person to judge. Contenders take turns within
// each round, so a slow minute on the network affects every model rather than one.
//
//   AGENDA_MODEL_EVAL=1 NODE_OPTIONS=--experimental-vm-modules npx jest --runTestsByPath test/agenda-model-eval-live.test.js --no-coverage
//
// Options, all read from the environment or .env:
//   AGENDA_EVAL_MODELS - Comma-separated provider:model:thinking contenders; thinking is a reasoning_effort for OpenAI
//     and a thinkingLevel for Gemini, or "default" to send neither.
//   AGENDA_EVAL_RUNS - Rounds per case (default 3).
//   AGENDA_EVAL_CASES_DIR - Folder of extra *.json cases, each { name, kind: "rank", state, grades? } or
//     { name, kind: "benefit", activities } (default notes/agenda-model-eval/cases, which git ignores).
//   AGENDA_EVAL_REFERENCE - The contender whose top five scores a rank case that has no grades.
// The report is written to notes/agenda-model-eval/report-<time>.md.
import dotenv from "dotenv";
import fs from "fs";
import fetch from "isomorphic-fetch";
import path from "path";
import { StringDecoder } from "string_decoder";
import { benefitRationalePrompt } from "dashboard/suggestions/calendar-suggestion-explanation";
import { generativeRankPrompt } from "dashboard/suggestions/suggestion-task-rank";
import { AGENDA_MODEL_EVAL_CASES } from "./fixtures/agenda-model-eval-cases.js";

dotenv.config();

const ENABLED = process.env.AGENDA_MODEL_EVAL === "1";
const DEFAULT_CONTENDERS = "openai:gpt-5.4-mini:none,openai:gpt-5.6:low,gemini:gemini-3.5-flash:minimal,"
  + "gemini:gemini-3.6-flash:minimal,gemini:gemini-3.8-flash:low";
const CONTENDER_SPECS = (process.env.AGENDA_EVAL_MODELS || DEFAULT_CONTENDERS).split(",").map(spec => spec.trim()).filter(Boolean);
const RUN_COUNT = Number(process.env.AGENDA_EVAL_RUNS) || 3;
const EVAL_DIRECTORY = path.resolve("notes/agenda-model-eval");
const CASES_DIRECTORY = path.resolve(process.env.AGENDA_EVAL_CASES_DIR || path.join(EVAL_DIRECTORY, "cases"));
const REFERENCE_SPEC = process.env.AGENDA_EVAL_REFERENCE || "openai:gpt-5.6:high";
const REQUEST_TIMEOUT_MILLISECONDS = 60000;
const TOP_COUNT = 5;
const API_KEYS = { gemini: (process.env.GEMINI_AI_ACCESS_TOKEN || "").trim(), openai: (process.env.OPEN_AI_ACCESS_TOKEN || "").trim() };
// USD per million tokens; thinking tokens bill at the output rate. A model without an entry reports no cost.
// Gemini 3.6 and 3.8 Flash rates are introductory through December 31, 2026; 3.8 becomes $1.50 / $7.50 on January 1, 2027.
const PRICE_PER_MILLION_TOKENS = {
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
};
// Words the benefit prompt tells the model not to use, since the sentence is about the task rather than the ranking.
const BENEFIT_FORBIDDEN_PATTERN = /\b(rating|rated|cadence|emphasi[sz]\w*|suggest\w*)\b/i;

const describeIfEnabled = ENABLED ? describe : describe.skip;

describeIfEnabled("Proposed Agenda model evaluation (live)", () => {
  // ----------------------------------------------------------------------------------------------
  // @desc Run every case against every contender and write the report. A contender that fails is reported, not
  //   thrown, so one provider's outage still leaves the others' results.
  it("times and scores each contender on the agenda's prompts", async () => {
    const contenders = CONTENDER_SPECS.map(_parsedContender);
    const cases = [...AGENDA_MODEL_EVAL_CASES, ..._casesFromDirectory(CASES_DIRECTORY)];
    const caseReports = [];
    for (const evalCase of cases) {
      caseReports.push(await _evaluatedCase(evalCase, contenders));
    }
    const reportText = _reportMarkdown(caseReports, contenders);
    fs.mkdirSync(EVAL_DIRECTORY, { recursive: true });
    const reportPath = path.join(EVAL_DIRECTORY, `report-${ new Date().toISOString().replace(/[:.]/g, "-") }.md`);
    fs.writeFileSync(reportPath, reportText);
    console.log(`${ reportText }\nReport written to ${ reportPath }`);
    expect(caseReports.length).toBe(cases.length);
  }, 30 * 60 * 1000);
});

// ----------------------------------------------------------------------------------------------
// @desc Read a provider:model:thinking contender spec.
// @param {string} spec - Such as "gemini:gemini-3.8-flash:low".
// @returns {object} { label, model, provider, thinking }; thinking is null for "default" or when omitted.
function _parsedContender(spec) {
  const [provider, model, thinking = "default"] = spec.split(":");
  if (!API_KEYS[provider]) throw new Error(`No API key for ${ provider }; contender "${ spec }" cannot run`);
  return { label: spec, model, provider, thinking: thinking === "default" ? null : thinking };
}

// ----------------------------------------------------------------------------------------------
// @desc Load the extra cases saved as JSON, such as a ranking state captured from a real notebook.
// @param {string} directory - Folder to read; a missing folder holds no cases.
// @returns {Array<object>} Cases, in file name order.
function _casesFromDirectory(directory) {
  if (!fs.existsSync(directory)) return [];
  const fileNames = fs.readdirSync(directory).filter(fileName => fileName.endsWith(".json")).sort();
  return fileNames.map(fileName => {
    const evalCase = JSON.parse(fs.readFileSync(path.join(directory, fileName), "utf8"));
    return { name: path.basename(fileName, ".json"), ...evalCase };
  });
}

// ----------------------------------------------------------------------------------------------
// @desc Ask every contender the case's prompt RUN_COUNT times, taking turns within each round, and score each answer.
// @param {object} evalCase - A rank or benefit case.
// @param {Array<object>} contenders - Parsed contenders.
// @returns {Promise<object>} { evalCase, prompt, referenceTopIds, runsByLabel }; runsByLabel maps each contender's
//   label to its scored runs.
async function _evaluatedCase(evalCase, contenders) {
  const prompt = evalCase.kind === "rank" ? generativeRankPrompt(evalCase.state) : benefitRationalePrompt(evalCase.activities);
  let referenceTopIds = null;
  if (evalCase.kind === "rank" && !evalCase.grades) {
    const referenceRun = await _streamedCompletion(_parsedContender(REFERENCE_SPEC), prompt);
    const referenceIds = _rankedIds(_parsedJson(referenceRun.text));
    referenceTopIds = referenceIds ? referenceIds.slice(0, TOP_COUNT) : null;
  }
  const runsByLabel = new Map(contenders.map(contender => [contender.label, []]));
  for (let round = 0; round < RUN_COUNT; round++) {
    for (const contender of contenders) {
      const completion = await _streamedCompletion(contender, prompt);
      const quality = _scoredAnswer(evalCase, completion, referenceTopIds);
      runsByLabel.get(contender.label).push({ ...completion, quality });
    }
  }
  return { evalCase, prompt, referenceTopIds, runsByLabel };
}

// ----------------------------------------------------------------------------------------------
// @desc Send one prompt as the Dashboard would, as a single user message asking for JSON, but streamed so the first
//   token can be timed.
// @param {object} contender - Parsed contender.
// @param {string} prompt - Prompt text.
// @returns {Promise<object>} { error, firstTokenMilliseconds, text, totalMilliseconds, usage }; usage holds
//   inputTokens, outputTokens (visible answer), and thinkingTokens, any of which may be null.
async function _streamedCompletion(contender, prompt) {
  const startedAt = performance.now();
  const timing = { firstTokenMilliseconds: null };
  const usage = { inputTokens: null, outputTokens: null, thinkingTokens: null };
  let text = "";
  const onText = chunkText => {
    if (!chunkText) return;
    if (timing.firstTokenMilliseconds === null) timing.firstTokenMilliseconds = performance.now() - startedAt;
    text += chunkText;
  };
  try {
    const request = contender.provider === "gemini" ? _geminiRequest(contender, prompt) : _openAiRequest(contender, prompt);
    const response = await _withTimeout(fetch(request.url, { body: JSON.stringify(request.body), headers: request.headers,
      method: "POST" }));
    if (!response.ok) throw new Error(`HTTP ${ response.status }: ${ (await response.text()).slice(0, 300) }`);
    const readEvents = _readServerSentEvents(response, event => {
      if (contender.provider === "gemini") _readGeminiEvent(event, onText, usage);
      else _readOpenAiEvent(event, onText, usage);
    });
    await _withTimeout(readEvents);
    return { error: null, firstTokenMilliseconds: timing.firstTokenMilliseconds, text, totalMilliseconds: performance.now() - startedAt,
      usage };
  } catch (error) {
    return { error: error.message, firstTokenMilliseconds: timing.firstTokenMilliseconds, text,
      totalMilliseconds: performance.now() - startedAt, usage };
  }
}

// ----------------------------------------------------------------------------------------------
// @desc OpenAI's Chat Completions request, shaped as requestBodyForProvider builds it, plus streaming with usage.
// @param {object} contender - Parsed OpenAI contender.
// @param {string} prompt - Prompt text.
// @returns {object} { body, headers, url }.
function _openAiRequest(contender, prompt) {
  const body = { messages: [{ content: prompt, role: "user" }], model: contender.model, response_format: { type: "json_object" },
    stream: true, stream_options: { include_usage: true } };
  if (contender.thinking) body.reasoning_effort = contender.thinking;
  const headers = { Authorization: `Bearer ${ API_KEYS.openai }`, "Content-Type": "application/json" };
  return { body, headers, url: "https://api.openai.com/v1/chat/completions" };
}

// ----------------------------------------------------------------------------------------------
// @desc Gemini's streaming generateContent request, shaped as requestBodyForProvider builds it, plus the thinking
//   level. The Dashboard's Gemini requests send no thinking level today, so a Gemini model would run at its default.
// @param {object} contender - Parsed Gemini contender.
// @param {string} prompt - Prompt text.
// @returns {object} { body, headers, url }.
function _geminiRequest(contender, prompt) {
  const generationConfig = { responseMimeType: "application/json" };
  if (contender.thinking) generationConfig.thinkingConfig = { thinkingLevel: contender.thinking };
  const body = { contents: [{ parts: [{ text: prompt }], role: "user" }], generationConfig };
  const headers = { "Content-Type": "application/json", "x-goog-api-key": API_KEYS.gemini };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${ contender.model }:streamGenerateContent?alt=sse`;
  return { body, headers, url };
}

// ----------------------------------------------------------------------------------------------
// @desc Read a server-sent event stream, handing each data line's parsed JSON to onEvent.
// @param {object} response - A fetch response whose body streams events.
// @param {function} onEvent - (parsedEvent) => void.
// @returns {Promise<void>} Resolves when the stream ends.
async function _readServerSentEvents(response, onEvent) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const readLines = finalChunk => {
    const lines = pending.split("\n");
    pending = finalChunk ? "" : lines.pop();
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (data && data !== "[DONE]") onEvent(JSON.parse(data));
    }
  };
  for await (const chunk of response.body) {
    pending += typeof chunk === "string" ? chunk : decoder.write(Buffer.from(chunk));
    readLines(false);
  }
  pending += decoder.end();
  readLines(true);
}

// ----------------------------------------------------------------------------------------------
// @desc Read one OpenAI stream event: answer text from the delta, and usage from the final event.
// @param {object} event - Parsed event.
// @param {function} onText - (text) => void.
// @param {object} usage - Usage totals, filled in place.
function _readOpenAiEvent(event, onText, usage) {
  onText(event.choices?.[0]?.delta?.content);
  if (!event.usage) return;
  const thinkingTokens = event.usage.completion_tokens_details?.reasoning_tokens ?? 0;
  usage.inputTokens = event.usage.prompt_tokens;
  usage.thinkingTokens = thinkingTokens;
  usage.outputTokens = event.usage.completion_tokens - thinkingTokens;
}

// ----------------------------------------------------------------------------------------------
// @desc Read one Gemini stream event: answer text from its non-thought parts, and the latest usage totals.
// @param {object} event - Parsed event.
// @param {function} onText - (text) => void.
// @param {object} usage - Usage totals, filled in place.
function _readGeminiEvent(event, onText, usage) {
  const parts = event.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (!part.thought) onText(part.text);
  }
  const metadata = event.usageMetadata;
  if (!metadata) return;
  usage.inputTokens = metadata.promptTokenCount ?? usage.inputTokens;
  usage.outputTokens = metadata.candidatesTokenCount ?? usage.outputTokens;
  usage.thinkingTokens = metadata.thoughtsTokenCount ?? 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Reject a promise that has not settled within REQUEST_TIMEOUT_MILLISECONDS.
// @param {Promise} promise - The work to bound.
// @returns {Promise} The work's result.
function _withTimeout(promise) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ REQUEST_TIMEOUT_MILLISECONDS / 1000 }s`)), REQUEST_TIMEOUT_MILLISECONDS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ----------------------------------------------------------------------------------------------
// @desc Parse a model's JSON answer, tolerating a Markdown code fence around it.
// @param {string} text - The answer text.
// @returns {*|null} Parsed JSON, or null when the text is not JSON.
function _parsedJson(text) {
  const unfenced = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch (error) {
    return null;
  }
}

// ----------------------------------------------------------------------------------------------
// @desc The best-first candidate IDs in a ranking answer, read as rankDayTasks reads them.
// @param {*} parsed - Parsed answer.
// @returns {Array<string>|null} Candidate IDs, or null when the answer holds no list.
function _rankedIds(parsed) {
  const candidateIds = Array.isArray(parsed) ? parsed : parsed?.rankedCandidateIds || parsed?.rankedTaskUuids;
  return Array.isArray(candidateIds) ? candidateIds : null;
}

// ----------------------------------------------------------------------------------------------
// @desc Score one answer for its case kind. A failed request or unreadable answer scores as invalid.
// @param {object} evalCase - The case asked.
// @param {object} completion - From _streamedCompletion.
// @param {Array<string>|null} referenceTopIds - The reference model's top five, for a rank case without grades.
// @returns {object} { valid, score, notes, ... } with fields for the case kind; score is from 0 to 1.
function _scoredAnswer(evalCase, completion, referenceTopIds) {
  if (completion.error) return { notes: completion.error, score: 0, valid: false };
  const parsed = _parsedJson(completion.text);
  if (evalCase.kind === "rank") return _scoredRanking(evalCase, _rankedIds(parsed), referenceTopIds);
  return _scoredBenefits(evalCase, parsed);
}

// ----------------------------------------------------------------------------------------------
// @desc Score a ranking: NDCG over the top five against the case's grades, or the share of the reference model's top
//   five it also placed in its top five. IDs the state never listed are dropped, as rankedTasksFromCandidateIds drops
//   them, and counted.
// @param {object} evalCase - Rank case with state and optional grades.
// @param {Array<string>|null} rankedIds - The answer's IDs, best first.
// @param {Array<string>|null} referenceTopIds - The reference model's top five.
// @returns {object} { notes, score, topIds, unknownCount, valid }.
function _scoredRanking(evalCase, rankedIds, referenceTopIds) {
  if (!rankedIds) return { notes: "no rankedCandidateIds list", score: 0, valid: false };
  const projects = Object.values(evalCase.state.projects);
  const listedIds = new Set(projects.flatMap(project => project.taskCandidates.map(candidate => candidate.candidateId)));
  const knownIds = [...new Set(rankedIds)].filter(candidateId => listedIds.has(candidateId));
  const unknownCount = rankedIds.length - knownIds.length;
  const topIds = knownIds.slice(0, TOP_COUNT);
  let score = 0;
  if (evalCase.grades) {
    score = _normalizedDiscountedGain(topIds, evalCase.grades);
  } else if (referenceTopIds?.length) {
    const sharedIds = topIds.filter(candidateId => referenceTopIds.includes(candidateId));
    score = sharedIds.length / referenceTopIds.length;
  }
  const notes = unknownCount ? `${ unknownCount } unknown or repeated ID(s)` : "";
  return { notes, score, topIds, unknownCount, valid: true };
}

// ----------------------------------------------------------------------------------------------
// @desc NDCG of a top list against graded candidates, with gain 2^grade - 1, so placing a grade-3 candidate first
//   counts far more than placing a grade-1 candidate there. The ideal is always a full top five, so an answer that
//   lists fewer candidates than the day has slots loses the gain it left out.
// @param {Array<string>} topIds - The answer's top candidate IDs.
// @param {object} grades - Grade from 0 to 3 by candidate ID.
// @returns {number} From 0 to 1.
function _normalizedDiscountedGain(topIds, grades) {
  const discountedGain = gradeList => gradeList.reduce((total, grade, index) => total + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const answerGrades = topIds.map(candidateId => grades[candidateId] ?? 0);
  const sortedGrades = Object.values(grades).sort((first, second) => second - first);
  const idealGrades = sortedGrades.slice(0, TOP_COUNT);
  const idealGain = discountedGain(idealGrades);
  return idealGain ? discountedGain(answerGrades) / idealGain : 0;
}

// ----------------------------------------------------------------------------------------------
// @desc Check benefit sentences against the prompt's rules: one per task, two sentences at most, and no mention of
//   ratings, cadence, emphasis, or suggestions. The score is the share of tasks whose sentence follows every rule.
// @param {object} evalCase - Benefit case with activities.
// @param {*} parsed - Parsed answer.
// @returns {object} { benefits, notes, score, valid }.
function _scoredBenefits(evalCase, parsed) {
  const benefits = Array.isArray(parsed) ? parsed : parsed?.benefits;
  if (!Array.isArray(benefits)) return { notes: "no benefits list", score: 0, valid: false };
  const problems = [];
  if (benefits.length !== evalCase.activities.length) problems.push(`${ benefits.length } of ${ evalCase.activities.length } benefits`);
  const passingCount = evalCase.activities.filter((activity, index) => {
    const benefit = String(benefits[index] || "").trim();
    const sentenceCount = (benefit.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).length;
    if (!benefit) return false;
    if (sentenceCount > 2) problems.push(`#${ index + 1 } has ${ sentenceCount } sentences`);
    if (BENEFIT_FORBIDDEN_PATTERN.test(benefit)) problems.push(`#${ index + 1 } mentions "${ benefit.match(BENEFIT_FORBIDDEN_PATTERN)[0] }"`);
    return sentenceCount <= 2 && !BENEFIT_FORBIDDEN_PATTERN.test(benefit);
  }).length;
  return { benefits, notes: problems.join("; "), score: passingCount / evalCase.activities.length, valid: true };
}

// ----------------------------------------------------------------------------------------------
// @desc The median of a list of numbers, ignoring nulls.
// @param {Array<number|null>} values - Values.
// @returns {number|null} Median, or null for an empty list.
function _median(values) {
  const numbers = values.filter(Number.isFinite).sort((first, second) => first - second);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

// ----------------------------------------------------------------------------------------------
// @desc A contender's estimated cost for one run in USD, with thinking tokens billed at the output rate.
// @param {object} contender - Parsed contender.
// @param {object} usage - From _streamedCompletion.
// @returns {number|null} Cost, or null without a price or usage.
function _runCost(contender, usage) {
  const price = PRICE_PER_MILLION_TOKENS[contender.model];
  if (!price || usage.inputTokens === null) return null;
  const billedOutputTokens = (usage.outputTokens || 0) + (usage.thinkingTokens || 0);
  return (usage.inputTokens * price.input + billedOutputTokens * price.output) / 1e6;
}

// ----------------------------------------------------------------------------------------------
// @desc Summarize one contender's runs on one case.
// @param {object} contender - Parsed contender.
// @param {Array<object>} runs - Scored runs.
// @returns {object} Medians of timing, quality, tokens, and cost, plus the success count and the first run's notes.
function _contenderSummary(contender, runs) {
  const validRuns = runs.filter(run => run.quality.valid);
  const costs = runs.map(run => _runCost(contender, run.usage));
  const notes = runs.map(run => run.quality.notes).filter(Boolean);
  return { firstTokenMilliseconds: _median(runs.map(run => run.firstTokenMilliseconds)),
    maximumMilliseconds: Math.max(...runs.map(run => run.totalMilliseconds)), notes: [...new Set(notes)].join(" / "),
    outputTokens: _median(runs.map(run => run.usage.outputTokens)), score: _median(runs.map(run => run.quality.score)),
    thinkingTokens: _median(runs.map(run => run.usage.thinkingTokens)), totalMilliseconds: _median(runs.map(run => run.totalMilliseconds)),
    validCount: validRuns.length, cost: _median(costs) };
}

// ----------------------------------------------------------------------------------------------
// @desc Format milliseconds as seconds, or a dash.
// @param {number|null} milliseconds - Duration.
// @returns {string} Such as "1.42s".
function _seconds(milliseconds) {
  return Number.isFinite(milliseconds) ? `${ (milliseconds / 1000).toFixed(2) }s` : "—";
}

// ----------------------------------------------------------------------------------------------
// @desc The Markdown report: one table per case, then each contender's first readable answer for side-by-side reading.
// @param {Array<object>} caseReports - From _evaluatedCase.
// @param {Array<object>} contenders - Parsed contenders.
// @returns {string} Markdown.
function _reportMarkdown(caseReports, contenders) {
  const lines = [`# Agenda model evaluation, ${ new Date().toLocaleString() }`, "", `${ RUN_COUNT } run(s) per contender per case. `
    + "Times and tokens are medians; score is 0–1 (NDCG@5 against grades, top-5 overlap with the reference, or the share "
    + "of benefit sentences that follow the prompt's rules).", ""];
  for (const { evalCase, prompt, referenceTopIds, runsByLabel } of caseReports) {
    lines.push(`## ${ evalCase.name } (${ evalCase.kind }, ~${ Math.round(prompt.length / 4) } prompt tokens)`, "");
    if (referenceTopIds) lines.push(`Reference (${ REFERENCE_SPEC }) top ${ TOP_COUNT }: ${ referenceTopIds.join(", ") }`, "");
    lines.push("| Contender | OK | First token | Total | Slowest | Score | Answer tokens | Thinking tokens | Cost/run | Notes |",
      "|---|---|---|---|---|---|---|---|---|---|");
    for (const contender of contenders) {
      const summary = _contenderSummary(contender, runsByLabel.get(contender.label));
      const cost = summary.cost === null ? "—" : `$${ summary.cost.toFixed(5) }`;
      const score = summary.score === null ? "—" : summary.score.toFixed(2);
      lines.push(`| ${ contender.label } | ${ summary.validCount }/${ RUN_COUNT } | ${ _seconds(summary.firstTokenMilliseconds) } | `
        + `${ _seconds(summary.totalMilliseconds) } | ${ _seconds(summary.maximumMilliseconds) } | ${ score } | `
        + `${ summary.outputTokens ?? "—" } | ${ summary.thinkingTokens ?? "—" } | ${ cost } | ${ summary.notes } |`);
    }
    lines.push("", ..._answerSamples(evalCase, contenders, runsByLabel), "");
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------------------------------------
// @desc Each contender's first readable answer: its top five for a ranking, or its sentences for benefits.
// @param {object} evalCase - The case.
// @param {Array<object>} contenders - Parsed contenders.
// @param {Map<string,Array<object>>} runsByLabel - Scored runs by contender label.
// @returns {Array<string>} Markdown lines.
function _answerSamples(evalCase, contenders, runsByLabel) {
  const lines = ["### First readable answer from each contender", ""];
  for (const contender of contenders) {
    const sampleRun = runsByLabel.get(contender.label).find(run => run.quality.valid);
    lines.push(`**${ contender.label }**`, "");
    if (!sampleRun) {
      lines.push("No readable answer.", "");
    } else if (evalCase.kind === "rank") {
      const gradedIds = sampleRun.quality.topIds.map(candidateId => {
        const grade = evalCase.grades?.[candidateId];
        return grade === undefined ? candidateId : `${ candidateId } (${ grade })`;
      });
      lines.push(gradedIds.map((gradedId, index) => `${ index + 1 }. ${ gradedId }`).join("\n"), "");
    } else {
      const sentenceLines = evalCase.activities.map((activity, index) => {
        const benefit = sampleRun.quality.benefits[index] ?? "(none)";
        return `- *${ activity.title }* — ${ benefit }`;
      });
      lines.push(...sentenceLines, "");
    }
  }
  return lines;
}
