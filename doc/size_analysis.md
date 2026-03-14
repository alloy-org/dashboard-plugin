# Bundle Size Analysis — amplenote-dashboard

> Generated: 2026-03-14 | Analyzed artifact: `build/compiled.js`
> Updated: 2026-03-14 — minification enabled; size reduced from 908 KB to 473 KB

---

## Overview

The production artifact is a single file: **`build/compiled.js`** at **473 KB** (after minification; previously 908 KB unminified).

Minification is enabled in both build stages (`minify: true` in both the Step 1 client bundle and Step 2 plugin wrapper in `esbuild.js`).

1. **Client bundle** — React, all dashboard UI components, and every npm runtime dependency are compiled into a browser-facing IIFE and then base64-encoded as a string literal inside the outer bundle.
2. **Plugin wrapper** — `lib/plugin.js` and its lib-only imports are bundled with `packages: "external"`. The client bundle (as base64) and the compiled CSS are injected as virtual modules.

Because the client bundle is base64-encoded inside the plugin wrapper, its raw bytes are inflated by ~33% (3 bytes → 4 chars). The table below accounts for this and reports *decoded* (real) sizes wherever the client bundle's content is discussed.

---

## Top-level size breakdown

| Section | Bytes (in file) | Decoded bytes | Share of file |
|---|---|---|---|
| Base64 client bundle string | ~390,000 | ~293,000 | 82% |
| Plugin lib code (outer wrapper) | ~80,000 | 80,000 | 17% |
| Compiled CSS (inlined) | ~4,453 | ~4,453 | ~1% |
| esbuild IIFE preamble / helpers | ~200 | ~200 | < 0.1% |
| **Total** | **~473 KB** | — | **100%** |

The dominant cost is the client bundle. All analysis below focuses on its decoded contents (~603 KB), measured from the unminified dev bundle (`dev/bundle.js`, 1.33 MB), which uses the same entry point and dependency graph but includes development builds of React/ReactDOM instead of production builds.

---

## Client bundle: library-level breakdown

Sizes derived from esbuild section-header line numbers in `dev/bundle.js` (32,646 lines, 1,396,600 bytes), then scaled to the production client bundle (~603 KB decoded). Dev builds of React/ReactDOM are significantly larger than production builds; production ratios are estimated accordingly.

| Library / Section | Dev bundle bytes | % of dev bundle | Notes |
|---|---|---|---|
| **react-dom** | ~953,000 | 68.1% | Includes `react-dom/cjs/react-dom.development.js` (lines 2376–23510) and index shim |
| **Project source (`lib/`)** | ~171,000 | 12.2% | All dashboard components, hooks, providers, utilities |
| **marked** | ~75,000 | 5.4% | Markdown parser |
| **react** | ~81,000 | 5.8% | Core React runtime (dev build; ~7 KB minified in prod) |
| **scheduler** | ~18,000 | 1.3% | React's internal scheduling dependency |
| **@popperjs/core** | ~57,000 | 4.1% | Tooltip positioning engine (required by tippy.js) |
| **tippy.js** | ~45,000 | 3.2% | Tooltip UI library |
| **esbuild IIFE preamble** | ~1,400 | 0.1% | Module helpers (`__commonJS`, `__toESM`, etc.) |

> **Important note on React/ReactDOM production vs development sizes:** The dev bundle uses `react.development.js` and `react-dom.development.js`, which are 5–8× larger than their production counterparts. In the production client bundle (with `process.env.NODE_ENV: "production"`), React core is approximately **7 KB** and ReactDOM is approximately **130 KB** (minified). The production client bundle is ~603 KB decoded; the majority of the saving over the dev bundle comes from React/ReactDOM switching to production builds.

---

## Per-module analysis (modules > 1 KB)

### `react-dom` — ~130 KB in production (bundled)

**Why it's here:** `react-dom` is the browser rendering engine for React. `lib/dashboard/client-entry.js` calls `ReactDOM.createRoot()` to mount the entire dashboard UI into the plugin's injected `<div>`. It is the direct, essential dependency of every dashboard component.

**Could it be removed?** Removing `react-dom` would require replacing the entire React component tree with vanilla DOM, Preact, or another framework. This is theoretically possible — Preact (`preact`) is a 3 KB drop-in alternative that covers the API surface used here — but it would be a significant refactor. The potential saving is substantial: Preact + `preact/compat` is ~10 KB vs ~130 KB for ReactDOM (production, minified), a saving of ~120 KB in the decoded client bundle.

---

### `react` — ~7 KB in production (bundled)

**Why it's here:** All dashboard components use React's `createElement`, `useState`, `useEffect`, `useRef`, `useCallback`, and `useMemo`. It is the foundational dependency of every `.js` file under `lib/dashboard/`.

**Could it be removed?** Only by abandoning React entirely. If `react-dom` were swapped for Preact, `react` would be replaced by `preact/compat` as well — the two packages are replaced together. On its own at ~7 KB production, React core is not a meaningful optimization target.

---

### `scheduler` — ~4 KB in production (bundled)

**Why it's here:** `scheduler` is a hard dependency of `react-dom`; it is not imported directly by project code. It provides React's cooperative scheduling / work-loop mechanism.

**Could it be removed?** No. It is an internal implementation detail of ReactDOM and ships automatically whenever ReactDOM is bundled. Removing ReactDOM removes scheduler too.

---

### `@popperjs/core` — ~57 KB (dev); ~25 KB minified

**Why it's here:** `@popperjs/core` is a peer dependency of `tippy.js` and provides the positioning math (flip, offset, prevent-overflow modifiers) that tippy uses to place tooltip popups relative to their reference elements. It is imported transitively — project code imports `tippy.js` directly in `lib/dashboard/dashboard-tippy.js`, and tippy's ESM build bundles `@popperjs/core` inline.

**Could it be removed?** Only if `tippy.js` is removed (see below). `@popperjs/core` on its own is not imported anywhere in the project. The library is well-maintained and purpose-built; there is no lighter alternative that provides the same positioning guarantees.

---

### `tippy.js` — ~45 KB (dev); ~20 KB minified

**Why it's here:** Used exclusively in `lib/dashboard/dashboard-tippy.js` to render popover tooltips on dashboard widget controls. It is a single import in a single file.

**Could it be removed?** Yes — this is the most removable external dependency. It is used in one file for tooltip/popover behavior that could be replaced with a small CSS-only or hand-rolled implementation (a positioned `<div>` with `visibility` toggling). Removing `tippy.js` would also eliminate `@popperjs/core`, saving roughly **~45 KB** combined (minified) from the client bundle. The tradeoff is losing the accessibility handling and edge-case positioning logic tippy provides.

---

### `marked` — ~75 KB (dev); ~45 KB minified

**Why it's here:** Used in `lib/util/utility.js` via `renderMarkdown` and `renderBlockMarkdown` helpers, which are called from multiple dashboard widgets (agenda, mood, etc.) to render user-authored note content as HTML. Amplenote notes are stored as Markdown.

**Could it be removed?** Unlikely — rendering Markdown is core to the plugin's purpose. A lighter alternative is possible: [`micromark`](https://github.com/micromark/micromark) (~15 KB) or a stripped custom renderer focused on the subset of Markdown actually used (headers, bold, italic, links, lists) could cut this to ~5–15 KB. Whether `marked`'s full feature set is exercised here is worth investigating; if only basic Markdown is needed, a lighter parser could save ~30–40 KB.

---

### Project source: `lib/dashboard/mood.js` — 34 KB

**Why it's here:** The mood-tracking widget. It is the largest single source file in the project, likely containing significant inline data (rating scales, UI copy, state machine logic for mood entry).

**Could it be removed?** Only if the mood widget is removed from the dashboard. It is product functionality, not infrastructure.

---

### Project source: `lib/data-service.js` — 27 KB

**Why it's here:** The central data-fetching and caching layer. It mediates between the Amplenote plugin API and the dashboard widgets, handling note queries, task fetching, and data normalization.

**Could it be removed?** No — it is the core data layer of the plugin.

---

### Project source: `lib/dashboard/dashboard.js` — 24 KB

**Why it's here:** The top-level React component that orchestrates widget layout, widget rendering, and dashboard state. All other widget components are coordinated here.

**Could it be removed?** No — it is the root of the component tree.

---

### Project source: `lib/dashboard/victory-value.js` — 21 KB

**Why it's here:** A dashboard widget, likely for tracking "victories" or goal completions. At 21 KB it is the second-largest widget file; the size may reflect inline data structures or complex rendering logic.

**Could it be removed?** Only if the widget is removed from the product.

---

### Project source: `lib/providers/fetch-ai-provider.js` — 20 KB

**Why it's here:** Handles API calls to AI providers (OpenAI, etc.) for AI-generated insights on the dashboard. Contains request formatting, streaming response parsing, and error handling.

**Could it be removed?** If AI features were removed, yes. Otherwise no.

---

### Project source: `lib/providers/fetch-json.js` — 15 KB

**Why it's here:** Generic HTTP JSON fetching utilities used across multiple providers and the data service.

**Could it be removed?** No — it is shared infrastructure used broadly.

---

### Project source: `lib/dashboard/dashboard-layout-popup.js` — 15 KB

**Why it's here:** The layout-customization popup that lets users rearrange dashboard widgets. Contains form rendering, drag-and-drop state, and layout serialization.

**Could it be removed?** Only if layout customization is removed as a feature.

---

### Project source: `lib/plugin.js` — 16 KB

**Why it's here:** The Amplenote plugin entry point — defines the plugin lifecycle hooks (`onLoad`, `renderEmbed`, `handleConfigure`, etc.). This file lives in the outer (plugin wrapper) bundle, not the client bundle.

**Could it be removed?** No — it is the plugin itself.

---

### Project source: `lib/hooks/use-domain-tasks.js` — 12 KB

**Why it's here:** A React hook that fetches and aggregates tasks grouped by domain/project from the Amplenote API. Used by task-management widgets.

**Could it be removed?** Only if domain/task widgets are removed.

---

### Project source: `lib/app-util.js` — 12 KB

**Why it's here:** Application-level utility functions (date formatting, tag parsing, API response normalization) shared across many components.

**Could it be removed?** No — it is shared infrastructure.

---

### Project source: `lib/dashboard/quotes-data.js` — 10 KB

**Why it's here:** A static array of inspirational quotes displayed in the quotes widget. The 10 KB is almost entirely the data itself (text strings).

**Could it be removed?** The data could be loaded lazily or fetched at runtime rather than bundled, saving ~10 KB. Alternatively, the list could be trimmed significantly. This is a low-effort size reduction opportunity.

---

### Compiled CSS — ~4.5 KB (compressed)

**Why it's here:** The compiled output of `lib/dashboard/styles/dashboard.scss` and its 18 partials. It is inlined into `compiled.js` as a string and injected into the DOM at runtime. The SCSS is compressed during the build (`style: 'compressed'`).

**Could it be reduced?** CSS is already compressed and is a small fraction of total size. No action needed.

---

## Size reduction opportunities (summary)

| Opportunity | Estimated saving | Effort | Status |
|---|---|---|---|
| ~~Enable minification (`minify: true` in `esbuild.js`)~~ | ~~35–48% of total file~~ | ~~Very low~~ | **Done — 908 KB → 473 KB** |
| Replace `react-dom` + `react` with Preact | ~120 KB (decoded client) | High — API-compatible but requires testing | Open |
| Remove `tippy.js` + `@popperjs/core` | ~45 KB (decoded client) | Medium — replace with CSS tooltip | Open |
| Replace `marked` with a lighter parser | ~30–40 KB (decoded client) | Medium — depends on Markdown feature usage | Open |
| Lazy-load or trim `quotes-data.js` | ~10 KB | Low | Open |

The single highest-leverage change is enabling minification — it requires uncommenting one line in `esbuild.js` and would reduce `compiled.js` from ~908 KB to an estimated **~550–580 KB**.

---

## Artifact inventory

| File | Size |
|---|---|
| `build/compiled.js` | **473 KB** (minified; was 908 KB) |
| `dev/bundle.js` | 1.33 MB (unminified, with source maps ref) |
| `dev/bundle.js.map` | 2.21 MB (source maps, dev only) |
| `dev/styles.css` | 63 KB (uncompressed dev CSS) |
| `lib/` source total | ~392 KB (JS + SCSS, unbuilt) |
