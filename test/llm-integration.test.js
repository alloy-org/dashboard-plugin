/**
 * [Claude-authored file]
 * Created: 2026-03-14 | Model: claude-4.6-opus-high-thinking
 * Task: Integration test for llmPrompt — calls real OpenAI API with test tasks and plan content
 * Prompt summary: "add a test that calls the LLM using OPEN_AI_ACCESS_TOKEN with test tasks and plan content"
 */
import { jest } from "@jest/globals";
import dotenv from "dotenv";
import fetch from "isomorphic-fetch";
import { llmPrompt } from "../lib/providers/fetch-ai-provider.js";
import { SETTING_KEYS } from "../lib/constants/settings.js";
import { SAMPLE_TASKS } from "./fixtures/tasks.js";

dotenv.config();
global.fetch = fetch;

const OPEN_AI_KEY = process.env.OPEN_AI_ACCESS_TOKEN;
const itIfKey = OPEN_AI_KEY ? it : it.skip;

// Minimal app stub — llmPrompt only reads settings for provider/model selection
function buildLlmApp() {
  return {
    settings: {
      [SETTING_KEYS.LLM_PROVIDER]: "openai",
      [SETTING_KEYS.LLM_API_KEY]: OPEN_AI_KEY,
    },
    alert: jest.fn(),
  };
}

const TEST_QUARTERLY_CONTENT = `# Q1 2026 Plan

## Focus areas
1. Launch Task Agent Pro product
2. Build daily outreach habit — reach out to one meaningful person each day
3. Complete one GitKraken ticket per day

## March
- Focus:
    1. Reach out to meaningful people daily
    1. GitKraken ticket per day
    1. Launch Task Agent Pro
- Key move: Check off the "Reached out to an influencer" task every day`;

const TEST_MONTHLY_CONTENT = `- Focus:
    1. Reach out to meaningful people daily
    1. GitKraken ticket per day
    1. Launch Task Agent Pro
- Key move: Check off the "Reached out to an influencer" task every day`;

function buildDreamTaskPrompt(tasks, quarterlyContent, monthlyContent) {
  const now = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dateHeading = `${dayNames[now.getDay()]} ${monthNames[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  const taskJsonObjects = tasks
    .filter(t => !t.completedAt && !t.dismissedAt)
    .slice(0, 10)
    .map(t => ({
      content: t.content,
      uuid: t.uuid,
      ...(t.important ? { important: true } : {}),
      ...(t.urgent ? { urgent: true } : {}),
      ...(t.victoryValue != null ? { score: t.victoryValue } : {}),
    }));

  let prompt = `You are a productivity coach analyzing a user's task list and goals to suggest the most impactful tasks for today.

Today is ${dateHeading}.
It is a weekday. Prioritize high-impact, goal-advancing work that moves important projects forward.

## User's Quarterly Plan
${quarterlyContent}

## User's Monthly Focus
${monthlyContent}

## Top Candidate Tasks (${taskJsonObjects.length} shown as JSON)
Each task object follows the Amplenote task type schema. The "score" field reflects how long the task has been accumulating value.

${taskJsonObjects.map(t => JSON.stringify(t)).join('\n')}

Your response must include two parts:

1. **goalsSummary**: A concise summary of the user's known goals for this quarter, month, and week. Maximum 5 sentences and 500 characters total.

2. **tasks**: 3-5 tasks that are especially well-aligned with those goals. For each task provide:
   - A clear, actionable task title
   - A 2-3 sentence explanation of why this task deserves attention today
   - A rating from 1-10 for how relevant and impactful this task is right now

Return ONLY valid JSON in this exact format (no markdown fences):
{"goalsSummary":"Summary of quarter/month/week goals...","tasks":[{"title":"Task title","explanation":"Why this task matters today...","rating":8}]}`;

  return prompt;
}

// [Claude] Generated tests for: llmPrompt integration with real OpenAI API
// Date: 2026-03-14 | Model: claude-4.6-opus-high-thinking
describe("llmPrompt integration (requires OPEN_AI_ACCESS_TOKEN)", () => {
  itIfKey("returns a parsed JSON response with goalsSummary and tasks", async () => {
    const app = buildLlmApp();
    const prompt = buildDreamTaskPrompt(SAMPLE_TASKS, TEST_QUARTERLY_CONTENT, TEST_MONTHLY_CONTENT);

    const result = await llmPrompt(app, null, prompt, {
      aiModel: "gpt-4o-mini",
      apiKey: OPEN_AI_KEY,
      jsonResponse: true,
      timeoutSeconds: 30,
    });

    expect(result).not.toBeNull();
    expect(typeof result).toBe("object");

    expect(result).toHaveProperty("goalsSummary");
    expect(typeof result.goalsSummary).toBe("string");
    expect(result.goalsSummary.length).toBeGreaterThan(0);

    expect(result).toHaveProperty("tasks");
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(result.tasks.length).toBeGreaterThanOrEqual(1);

    const firstTask = result.tasks[0];
    expect(firstTask).toHaveProperty("title");
    expect(firstTask).toHaveProperty("explanation");
    expect(firstTask).toHaveProperty("rating");
    expect(typeof firstTask.title).toBe("string");
    expect(typeof firstTask.rating).toBe("number");
    expect(firstTask.rating).toBeGreaterThanOrEqual(1);
    expect(firstTask.rating).toBeLessThanOrEqual(10);
  }, 60_000);

  itIfKey("returns tasks with valid ratings between 1 and 10", async () => {
    const app = buildLlmApp();
    const prompt = buildDreamTaskPrompt(SAMPLE_TASKS, TEST_QUARTERLY_CONTENT, TEST_MONTHLY_CONTENT);

    const result = await llmPrompt(app, null, prompt, {
      aiModel: "gpt-4o-mini",
      apiKey: OPEN_AI_KEY,
      jsonResponse: true,
      timeoutSeconds: 30,
    });

    for (const task of result.tasks) {
      expect(task.title.length).toBeGreaterThan(0);
      expect(task.explanation.length).toBeGreaterThan(0);
      expect(task.rating).toBeGreaterThanOrEqual(1);
      expect(task.rating).toBeLessThanOrEqual(10);
    }
  }, 60_000);
});
