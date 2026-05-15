# AGENTS.md/CLAUDE.md — AI Authorship Documentation Standards

This project implements a plugin that utilized the Amplenote Plugin API:
- [App methods - Start here. Most of the interactions with the plugin API happen through the app object](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface)
- [Object types and attributes - When interfacing with notes and tasks, it's useful to know their attributes and structure](https://www.amplenote.com/help/developing_amplenote_plugins/appendix_i)
- [Markdown content guide - How to format markdown content, like tables, code blocks, and Rich Footnotes](https://www.amplenote.com/help/developing_amplenote_plugins/appendix_iii)
- [Index of API pages](https://www.amplenote.com/help/developing_amplenote_plugins)

# Purpose

This project tracks AI-generated code for attribution, auditing, and code quality research. 
**You MUST document your authorship in every applicable way whenever you write or significantly modify code.**

This document is primarily concerned with documentation standards. For equally important guidelines on code 
conventions and best practices, **You MUST also follow the standards outlined in `doc/code_conventions.md`**.

---

# 1. Document ALL Non-Trivial Functions with JSDoc

Add a structured comment directly above every function, class, method, or meaningful
block you write or significantly modify. See also `doc/code_conventions.md` for examples of dividers and 
JSDoc standards per-function. 

The block must follow JSDoc conventions, but most importantly, each line MUST begin with "//" - NO BLOCK COMMENTING.

### JavaScript
```javascript
// ------------------------------------------------------------------------------------------
// @desc Reformat the data from the response into a consistent shape for the frontend to consume
// @param {Object} data - A data object with the following properties:
//   - {string} id - The unique identifier for the record
//   - {string} name - The name of the record
//   - {number} value - The numerical value associated with the record
// @returns {Object} An object with the following properties:
//   - {string} recordId - The unique identifier for the record (same as id
//   - {string} displayName - The name of the record (same as name)
// [Claude claude-sonnet-4-6] Task: normalize API response shape across endpoints
function normalizeResponse(data) {
    ...
}
```

# 2. Do NOT break arguments, variables, or return statements into multiple lines unless they exceed 200 characters

```javascript
// BAD
return {
  recordId,
  displayName,
  someOtherField,
  justTooMuch,
  headerActions,
  title,
  description,
  isActive,
  somePeopleJustWantALongVariable,
}

// Good
return { description, displayName, headerActions, isActive, justTooMuch, recordId, someOtherField, 
  somePeopleJustWantALongVariable };
```

# 3. New File Headers

When you create a new file entirely, add a header block at the very top before any
imports or code.

### JavaScript
```javascript
// [current-model-name-4.2-authored file]
// Prompt summary: "create a reusable debounced search input component"
```

---

# 4. Test File Annotations

When you write tests, add a comment at the top of the outermost test block.

### JavaScript (Jest)
```javascript
// [AiProviderName llm-provider-model-5.2] Generated tests for: debounced search input component
describe('SearchInput', () => {
    ...
});
```

---

# 5. AI_CONTRIBUTIONS.md Log

Maintain an `AI_CONTRIBUTIONS.md` file in the repo root. After completing any
non-trivial task, append an entry using this format:

```markdown
## 2025-02-21 — Webhook signature validation

**Model:** name-of-llm-provider-model-version-4.2
**Files created/modified:**
- `src/webhooks/validator.py` (created)
- `tests/test_validator.py` (created)
- `src/config/settings.py` (modified — added webhook secret config key)

**Task:** Validate incoming webhook payloads using HMAC signature verification
**Prompt summary:** "add webhook validation with signature verification"
**Scope:** ~90 lines of new logic across 3 files
**Notes:** Uses HMAC-SHA256; secret must be set in environment before deploying
```

Add an entry for any task involving more than a few lines of logic. Err on the side
of over-documenting — these records are used for code quality and attribution research.

---

## 6. Running Jest (Javascript) Tests

Tests use Jest with ECMAScript Modules. Always run with the `--experimental-vm-modules` flag:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage
```

To run a specific test file or pattern:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern='dream-task' --no-coverage
```

---

## Quick Reference

| Situation | Required documentation                             |
|-----------|----------------------------------------------------|
| Write a new function or method | Inline `[Agent Identity]` comment above it         |
| Create a new file | File header block + `AI_CONTRIBUTIONS.md` entry    |
| Substantially modify an existing function | Add function documentation as specified in item #1 |

When in doubt, over-document. These records are used for ongoing research into AI's
impact on code quality and long-term maintainability.

---
