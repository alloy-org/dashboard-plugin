# AGENTS.md/CLAUDE.md — AI Authorship Documentation Standards

This project implements a plugin that utilized the Amplenote Plugin API:
- [App methods - Start here. Most of the interactions with the plugin API happen through the app object](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface)
- [Object types and attributes - When interfacing with notes and tasks, it's useful to know their attributes and structure](https://www.amplenote.com/help/developing_amplenote_plugins/appendix_i)
- [Markdown content guide - How to format markdown content, like tables, code blocks, and Rich Footnotes](https://www.amplenote.com/help/developing_amplenote_plugins/appendix_iii)
- [Index of API pages](https://www.amplenote.com/help/developing_amplenote_plugins)

# Purpose

This project tracks AI-generated code for attribution, auditing, and code quality research. 
**Record authorship only in `AI_CONTRIBUTIONS.md` whenever you write or significantly modify code.**
Do not add model names, agent identities, prompt histories, or other LLM attribution to source files,
function comments, file headers, tests, or other documentation. Comments should explain the code's behavior.

This document is primarily concerned with documentation standards. For equally important guidelines on code 
conventions and best practices, **You MUST also follow the standards outlined in `doc/code_conventions.md`**.

## UI work: read `doc/design-system.md` first

The dashboard must look like the Amplenote app it lives in. Before writing or changing any widget, popup, or Plan
Builder UI, read [`doc/design-system.md`](doc/design-system.md) and build only from its shared layers:

- **Controls** from `"dashboard/controls"`: `Button`, `IconButton`, `PlainButton`, `Select`, `TextField`,
  `UnderlineTabs`, `Badge`, `Spinner`, `EmptyState`, `LoadingState`, `ErrorState`, and for settings `ConfigSection`,
  `ConfigField`, `RadioGroup`, `CheckboxField`. Never write a raw `<button>`, `<select>`, `<input>`/`<textarea>`
  (checkboxes and radios included), `<a href="#">` button, spinner, or hand-made empty/loading/error markup. A
  widget's configure popup is a `ConfigPopup` filled with the settings controls.
- **Colors** only from the tokens in `lib/dashboard/styles/theme-tokens.scss`, named after the host's colors
  (`$color-text-medium-contrast`, `$color-background-primary`, …). No hex, `rgb()`, or `var(--color-*)` in component
  stylesheets, and no color literals in scripts. Data colors (priorities, projects, moods, task counts) are named once
  in `lib/dashboard/styles/data-colors.scss`; add new ones there.
- **Icons** only from `react-icons/md`. No emoji or Unicode glyphs as UI.
- **Tooltips** come in two looks: a hint (`DashboardTippy`, one or two plain sentences) or the rich Task Stats look
  for anything with a title, rows, or rendered task text (`DashboardTippy rich` + `richTooltipHtml`, or
  `useStatsChartTooltip`). When unsure, it is rich. See "Tooltips" in the design system.
- **Widget frame** from `WidgetWrapper`; a new widget gets its registry entry in `layout-profiles.js` and its icon in
  `widget-icons.jsx`.
- **Widget stylesheets hold layout only**; never restyle `dashboard-*` control classes. If a control lacks something
  you need, add it to the control in `lib/dashboard/controls/` (and `styles/dashboard-controls.scss`), not to a widget.

`test/design-tokens.test.js` and `test/controls-usage.test.js` fail when these rules are broken. Before reaching for
a raw element, check the control's JSDoc: they forward refs, pass attributes through, and cover submit buttons, inline
links, danger actions, separate tooltips, dense fields, and compact empty states. A raw element that truly cannot be a
control goes in `ALLOWED_RAW_CONTROLS` in `test/controls-usage.test.js` with its reason; a new control capability goes
in the component, `dashboard-controls.scss`, `test/controls.test.js`, and the table in `doc/design-system.md`.

## Persistent project context: Rich Footnotes

Bill often stores essential specifications in Amplenote Rich Footnotes. Resolve their full markdown definitions,
including multiline prose and code blocks, before interpreting a linked note. Follow
[`doc/amplenote-rich-footnotes.md`](doc/amplenote-rich-footnotes.md) for the reading and preservation rules.

---

# 0. Don't make commits

After changing code, leave it to the human to review and craft an appropriate commit message.

# 1. Document ALL Non-Trivial Functions with JSDoc

Add a structured comment directly above every function, class, method, or meaningful
block you write or significantly modify. See also `doc/code_conventions.md` for examples of dividers and 
JSDoc standards per-function. 

The block must follow JSDoc conventions, but most importantly, each line MUST begin with "//" - NO BLOCK COMMENTING.

### JavaScript
```javascript
// ------------------------------------------------------------------------------------------
// @desc Reformat the data from the response into a consistent shape for the frontend to consume for we wish to ensure that 
//   when in doubt we will use up the amount of space that is available to us on a modern breakpoint laptop with lots of width. 
// @param {Object} data - A data object with the following properties:
//   - {string} id - The unique identifier for the record. This identifier is used to reference the record by its relations
//   - {string} name - The name of the record
//   - {number} value - The numerical value associated with the record
// @returns {Object} An object with the following properties:
//   - {string} recordId - The unique identifier for the record (same as id
//   - {string} displayName - The name of the record (same as name)
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

## Avoid Dense Transformation Returns

Return statements should not compound multiple transformations such as `filter().map().sort()` in one expression.
Apply each transformation to a named intermediate variable that describes the current shape of the data, then return
the final variable.

```javascript
// Bad
return tasks.filter(task => task.completedAt).map(task => task.noteUUID).sort();

// Good
const completedTasks = tasks.filter(task => task.completedAt);
const completedNoteUuids = completedTasks.map(task => task.noteUUID);
const sortedNoteUuids = completedNoteUuids.sort();
return sortedNoteUuids;
```

# 3. New File Headers

When you create a new file entirely, add a short purpose comment at the very top before any
imports or code. Keep authorship information exclusively in `AI_CONTRIBUTIONS.md`.

### JavaScript / JSX

Note: dashboard widget/component files live under `lib/dashboard/` and use the
`.jsx` extension. esbuild is configured with the React 17+ **automatic** JSX
runtime, so `.jsx` files do NOT need to `import { createElement } from "react"`
just to render markup. Non-component files (services, hooks, utilities,
constants) stay as `.js`.

Example of a JSX widget component matching the project's conventions. Its title comes from its `WIDGET_REGISTRY`
entry in `lib/dashboard/layout-profiles.js` and its header icon from `WIDGET_ICON_BY_ID` in
`lib/dashboard/widget-icons.jsx` (e.g. `"counter": MdAddCircle`), so the widget only passes its `widgetId`. Controls
come from `"dashboard/controls"`, icons from `react-icons/md`, and the stylesheet holds layout only with colors from
the tokens (see `doc/design-system.md`).

```jsx
// Counts clicks, as an example of a widget built from the shared controls.
import { Button, EmptyState, IconButton } from "dashboard/controls";
import { useState } from "react";
import { MdAdd, MdRestartAlt } from "react-icons/md";
import "styles/counter.scss";
import WidgetWrapper from "widget-wrapper";

// ----------------------------------------------------------------------------------------------
// @desc Counter widget: a reset action in the header, an add button, and an empty state before the first click.
// @returns {JSX.Element} The widget.
export default function CounterWidget() {
  const [count, setCount] = useState(0);
  const headerActions = <IconButton Icon={ MdRestartAlt } label="Reset" onClick={ () => setCount(0) } size="small" />;
  return (
    <WidgetWrapper headerActions={ headerActions } widgetId="counter">
      { count === 0 ? <EmptyState title="No clicks yet">Click Add to start counting.</EmptyState>
        : <p className="counter-total">{ count } clicks</p> }
      <Button className="counter-add-button" Icon={ MdAdd } onClick={ () => setCount(c => c + 1) } variant="outlined">
        Add
      </Button>
    </WidgetWrapper>
  );
}
```

```scss
// styles/counter.scss: layout only; the controls bring their own look
@use 'theme-tokens' as *;

.widget-counter {
  .counter-total {
    color: $color-text-high-contrast;
    font-size: $large-font-size;
  }

  .counter-add-button {
    align-self: flex-start;
    margin-top: $sp-md;
  }
}
```

## 4. Prefer non-abbreviated names; class names need at least two words

Use full words for variables, functions, CSS classes, and SCSS variables. Avoid truncated prefixes
such as `agg`, `eph`, `rep`, or `dk` when a readable word fits (`aggregate`, `habit`, `representative`,
`dayKey`).

JavaScript and CSS class names must be at least two words (e.g. `HabitRow`, `habit-row-label`) so
they stay distinct from single-token domain nouns and are easier to search for.

```javascript
// Bad
const aggByKey = new Map();
const eph = computeEph(agg);

// Good
const aggregateByKey = new Map();
const habitAnalysis = computeHabitAnalysis(aggregate);
```

```css
/* Bad */
.eph-row { }
.eph-row-value--pos { }

/* Good */
.habit-row { }
.habit-row-value--positive { }
```

## Stylesheets: one wrapping class per file

Every stylesheet in `lib/dashboard/styles/` is wrapped in a single selector, and that selector is the
class on the root element of the component the stylesheet styles. Nothing sits at the top level beside
it, so a rule can only reach the component it was written for and a reader can tell from the first line
what the file is allowed to touch.

```scss
// Bad — three top-level selectors, any of which can match somewhere else on the dashboard
.widget-note-peek { ... }
.widget-note-peek .note-peek-title-link { ... }
.note-peek-content { ... }

// Good — one wrapper, matching the class WidgetWrapper puts on the widget root
.widget-note-peek {
  .note-peek-title-link { ... }
  .note-peek-content { ... }
}
```

Notes on the parts that do not fit the pattern by nesting alone:

- SCSS variables and `@use` stay above the wrapper: a variable declared inside it is scoped to it.
- `@keyframes` may be nested for tidiness — Sass lifts it to the top level of the output, and animation
  names are document-global either way.
- A rule that depends on an ancestor class the component does not own keeps the ancestor through the
  parent selector, so the compiled output is unchanged: `.vertical-1-cell & { ... }`.
- `config-popup.scss` scopes its descendants through `:where(&)` because four other stylesheets extend
  the popup by class, and their overrides are balanced against the weight those selectors had before
  they were nested. Reach for this only when a file's classes are extended from outside it.
- Four stylesheets have no component to scope to and say so in their own header comment:
  `global-reset.scss` and `theme-light.scss` style the document, `dashboard-tippy.scss` is the vendored
  replacement for tippy.css, and `amplenote-markdown-render.scss` needs two wrappers because tippy
  moves the footnote popup out of the note it belongs to.

## 5. Running Jest (Javascript) Tests

Tests use Jest with ECMAScript Modules. Always run with the `--experimental-vm-modules` flag:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage
```

To run a specific test file or pattern:

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern='dream-task' --no-coverage
```

## 6. Keep React out of the host plugin

`lib/plugin.js` runs in Amplenote's host environment, which has no `require`, React, or browser DOM.
Every module it imports, including indirect dependencies of plugin actions, must be host-compatible.

- NEVER import from `lib/hooks/`, JSX/TSX components, `react`, or `react-dom` into the host dependency graph.
  This also applies when importing only a plain helper exported from a hook or component file.
- Put shared logic in React-free utilities or service modules. Hooks and components may import those modules;
  shared modules must not import hooks or components. Pass required data and the app interface explicitly.
- Plain `.js` services under `lib/dashboard/` may be shared if their entire dependency graph is host-compatible.
  The React client reaches the host only as the prebuilt `client-bundle` payload used by the embed HTML.
- Do not silence boundary errors by bundling React into the host, adding a `require` shim, stripping generated
  helper text, or disabling the guard. Move the shared logic to the correct layer.
- After changing host imports or shared services, run `npm run build` and the production bundle smoke test:
  `NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand --runTestsByPath test/production-plugin.test.js --no-coverage`.

`host-plugin-boundary.js` checks the full esbuild dependency graph before writing `build/compiled.js`, including
inputs removed by tree shaking. See `doc/code_conventions.md` for an import example.

---

## Quick Reference

| Situation | Required documentation                             |
|-----------|----------------------------------------------------|
| Write a new function or method | Behavioral JSDoc + `AI_CONTRIBUTIONS.md` entry |
| Create a new file | Purpose comment + `AI_CONTRIBUTIONS.md` entry |
| Substantially modify an existing function | Add function documentation as specified in item #1 |
| Build or change UI (widget, popup, Plan Builder) | Follow `doc/design-system.md`: controls from `dashboard/controls`, host-named color tokens, `react-icons/md` icons |

When in doubt, over-document. These records are used for ongoing research into AI's
impact on code quality and long-term maintainability.

---
