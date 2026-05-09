// [GPT-5.4-authored file]
// Prompt summary: "fix React act environment warnings in Jest tests"

// [OpenAI gpt-5.4] Task: mark the Jest jsdom environment as React act-capable for component tests
// Prompt: "Attempting to run tests via npm test app, several warnings are given 'Warning: The current testing environment is not configured to support act(...)'"
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
