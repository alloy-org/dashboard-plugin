/**
 * [gpt-5.3-codex-authored file]
 * Prompt summary: "Mock app.prompt in dev environment as the simplest possible modal window that transforms an array of inputs into lines within an HTML form"
 */
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
