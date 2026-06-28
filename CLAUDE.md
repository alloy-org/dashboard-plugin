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

# 2. Do NOT break arguments, variables, or return statements into multiple lines unless they exceed 150 characters

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

### JavaScript / JSX

Note: dashboard widget/component files live under `lib/dashboard/` and use the
`.jsx` extension. esbuild is configured with the React 17+ **automatic** JSX
runtime, so `.jsx` files do NOT need to `import { createElement } from "react"`
just to render markup. Non-component files (services, hooks, utilities,
constants) stay as `.js`.

Example of a JSX widget component matching the project's conventions:

```jsx
import { useState } from "react";
import WidgetWrapper from "widget-wrapper";

export default function CounterCard({ title }) {
  const [count, setCount] = useState(0);
  return (
    <WidgetWrapper title={title} icon="🔢" widgetId="counter">
      <button onClick={() => setCount(c => c + 1)}>Clicked {count} times</button>
    </WidgetWrapper>
  );
}
```

## 4. Running Jest (Javascript) Tests

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
