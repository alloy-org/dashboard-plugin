/**
 * [gpt-5.3-codex-authored file]
 * Prompt summary: "Mock app.prompt in dev environment as the simplest possible modal window that transforms an array of inputs into lines within an HTML form"
 */
import { jest } from "@jest/globals";
import { createBrowserDevApp } from "util/browser-dev-app";

// ----------------------------------------------------------------------------------------------
// @desc Verify that a browser-side note write is successful only when the file-backed development server
//   confirms it, matching the boolean contract used by production persistence.
describe("browser dev app note writes", () => {
  it("returns false when the development server rejects a note replacement", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ json: async () => ({ error: "Note content was not written", ok: false }),
      ok: false }));
    const app = createBrowserDevApp();

    await expect(app.replaceNoteContent("missing-note", "response")).resolves.toBe(false);

    global.fetch = originalFetch;
  });
});

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

// [Claude claude-opus-5 (1M context)] Generated tests for: the dev app's app.alert stand-in and its
//   debugEvaluate action, which back the Debug Console's Debug button in the local dev environment.
describe("browser dev app alert modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the preface as the heading and the message as preformatted text, resolving -1 on dismiss", async () => {
    const app = createBrowserDevApp();
    const promise = app.alert("line one\nline two", { preface: "await app.findNote({})" });

    const overlay = document.querySelector('[data-dev-prompt="overlay"]');
    expect(overlay.textContent).toContain("await app.findNote({})");
    expect(overlay.querySelector("[data-dev-alert-body]").textContent).toBe("line one\nline two");

    overlay.querySelector("[data-dev-alert-dismiss]").click();

    await expect(promise).resolves.toBe(-1);
    expect(document.querySelector('[data-dev-prompt="overlay"]')).toBeNull();
  });

  it("resolves an action's value when its button is chosen", async () => {
    const app = createBrowserDevApp();
    const promise = app.alert("2", { actions: [{ label: "Run another expression", value: "run-again" }] });

    const buttons = [...document.querySelectorAll('[data-dev-prompt="overlay"] button')];
    buttons.find(button => button.textContent === "Run another expression").click();

    await expect(promise).resolves.toBe("run-again");
  });
});

describe("browser dev app debugEvaluate", () => {
  it("evaluates an expression against the dev app itself", async () => {
    const app = createBrowserDevApp();
    const evaluation = await app.debugEvaluate("typeof app.findNote");

    expect(evaluation.error).toBeNull();
    expect(evaluation.output).toBe('"function"');
  });
});
