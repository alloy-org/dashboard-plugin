/**
 * [gpt-5.3-codex-authored file]
 * Prompt summary: "Mock app.prompt in dev environment as the simplest possible modal window that transforms an array of inputs into lines within an HTML form"
 */
import { jest } from "@jest/globals";
import { createBrowserDevApp } from "../lib/util/browser-dev-app.js";

// [Claude gpt-5.3-codex] Generated tests for: browser dev app prompt modal behavior
describe("browser dev app prompt modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one form line per input and returns an array for multi-input prompts", async () => {
    const app = createBrowserDevApp();
    const promise = app.prompt("Configure Widget", {
      inputs: [
        { label: "Name", type: "string", value: "Default Name" },
        { label: "Enabled", type: "checkbox", value: true },
        {
          label: "Provider",
          type: "radio",
          value: "openai",
          options: [
            { label: "OpenAI", value: "openai" },
            { label: "Anthropic", value: "anthropic" },
          ],
        },
      ],
    });

    const form = document.querySelector('[data-dev-prompt="overlay"] form');
    expect(form).toBeTruthy();

    const lines = form.querySelectorAll("label");
    expect(lines.length).toBeGreaterThanOrEqual(3);

    const textInput = form.querySelector('input[type="text"]');
    textInput.value = "Updated";
    const checkbox = form.querySelector('input[type="checkbox"]');
    checkbox.checked = false;
    const anthropic = form.querySelector('input[type="radio"][value="anthropic"]');
    anthropic.click();
    const submit = form.querySelector('button[type="submit"]');
    submit.click();

    const result = await promise;
    expect(result).toEqual(["Updated", false, "anthropic"]);
  });

  it("returns a scalar value for single-input prompts", async () => {
    const app = createBrowserDevApp();
    const promise = app.prompt("Choose one", {
      inputs: [{
        label: "Provider",
        type: "radio",
        value: "openai",
        options: [
          { label: "OpenAI", value: "openai" },
          { label: "Anthropic", value: "anthropic" },
        ],
      }],
    });

    const anthropic = document.querySelector('input[type="radio"][value="anthropic"]');
    anthropic.click();
    const submit = document.querySelector('button[type="submit"]');
    submit.click();

    const result = await promise;
    expect(result).toBe("anthropic");
  });

  it("returns null when canceled", async () => {
    const app = createBrowserDevApp();
    const promise = app.prompt("Cancel me", {
      inputs: [{ label: "Text", type: "string", value: "x" }],
    });

    const cancel = document.querySelector('[data-dev-prompt-cancel="true"]');
    cancel.click();

    await expect(promise).resolves.toBeNull();
  });
});

// [OpenAI gpt-5.4] Generated tests for: browser dev app task score normalization
describe("browser dev app tasks", () => {
  it("ensures returned task objects always include score values", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (url) => {
      if (String(url).startsWith("/api/tasks")) {
        return {
          async json() {
            return [
              { uuid: "task-1", victoryValue: 7 },
              { score: 2, uuid: "task-2", victoryValue: 9 },
              { uuid: "task-3" },
            ];
          },
        };
      }
      return {
        async json() {
          return {};
        },
      };
    });

    try {
      const app = createBrowserDevApp();
      const domainTasks = await app.getTaskDomainTasks("domain-work-uuid");
      const completedTasks = await app.getCompletedTasks(1, 2);

      expect(domainTasks.map(task => task.score)).toEqual([7, 2, 0]);
      expect(completedTasks.map(task => task.score)).toEqual([7, 2, 0]);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
