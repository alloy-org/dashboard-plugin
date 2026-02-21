# AI Contributions Log

This file tracks all code authored or substantially modified by AI models in this
repository, per the standards defined in `CLAUDE.md`.

---

## 2026-02-17 — Initial dashboard plugin architecture and widget components

**Model:** claude-sonnet-4-5-20250929
**Files created/modified:**
- `lib/plugin.js` (created) — Plugin entry point with appOption, renderEmbed, onEmbedCall dispatch
- `lib/data-service.js` (created) — Data fetching/shaping layer: tasks, mood, quarterly plans, quotes
- `lib/constants/quarters.js` (created) — Quarter date math utilities (getCurrentQuarter, getNextQuarter, quarterLabel)
- `lib/constants/settings.js` (created) — Plugin name and setting key constants
- `lib/dashboard/app.js` (created) — Root React component: fetches data via callPlugin, renders 4-column widget grid
- `lib/dashboard/widget-wrapper.js` (created) — Reusable widget chrome: header, icon, title, optional configure button
- `lib/dashboard/planning.js` (created) — Planning widget: quarterly plan cards and month tab navigation
- `lib/dashboard/victory-value.js` (created) — Victory value widget: canvas bar chart with mood overlay line
- `lib/dashboard/mood.js` (created) — Mood widget: emoji selector, 7-day average, sparkline
- `lib/dashboard/calendar.js` (created) — Calendar widget: month grid with task-density colored dots
- `lib/dashboard/agenda.js` (created) — Agenda widget: today's tasks with priority colors and durations
- `lib/dashboard/quotes.js` (created) — Quotes widget: LLM-generated quotes on Unsplash background tiles
- `lib/dashboard/ai-plugins.js` (created) — AI & Plugins widget: action list with badge counts
- `lib/dashboard/quick-actions.js` (created) — Quick actions widget: 2x2 shortcut button grid

**Task:** Build the full Amplenote dashboard plugin with React widget components and data layer
**Prompt summary:** "build an Amplenote dashboard plugin with planning, victory value, mood, calendar, agenda, quotes, AI plugins, and quick action widgets"
**Scope:** ~700 lines of new logic across 14 files
**Notes:** Uses React createElement (no JSX), communicates with Amplenote via callPlugin/onEmbedCall bridge

---

## 2026-02-20 — Build system, embed HTML, client entry, and tests

**Model:** claude-sonnet-4-5-20250929
**Files created/modified:**
- `esbuild.js` (created) — Production build: SCSS compilation, client bundle as base64 IIFE, plugin bundle with virtual modules
- `lib/embed-html.js` (created) — Generates self-contained HTML with inlined CSS and base64-encoded client JS
- `lib/dashboard/client-entry.js` (created) — React entry point: creates root and renders DashboardApp into #dashboard-root
- `test/plugin.test.js` (created) — Jest integration tests for renderEmbed, onEmbedCall actions, and appOption definitions
- `package.json` (modified) — Added build/test scripts, dependencies (esbuild, sass, react, react-dom)

**Task:** Set up the esbuild build pipeline, embed HTML generator, client entry point, and plugin tests
**Prompt summary:** "configure esbuild to compile SCSS, bundle React client as base64, and produce compiled.js; add tests"
**Scope:** ~200 lines across 5 files
**Notes:** esbuild uses virtual module plugins for client-bundle and css-content injection

---

## 2026-02-21 — SCSS design system and widget styles

**Model:** claude-sonnet-4-5-20250929
**Files created/modified:**
- `lib/dashboard/styles/_theme.scss` (created) — Design tokens: colors, spacing, radii, fonts, card mixin
- `lib/dashboard/styles/_widget-wrapper.scss` (created) — Base widget card styles: header bar, icon, title, body, configure button
- `lib/dashboard/styles/_planning.scss` (created) — Planning widget: quarter cards, month tabs
- `lib/dashboard/styles/_victory-value.scss` (created) — Victory value: header total, chart canvas
- `lib/dashboard/styles/_mood.scss` (created) — Mood: emoji buttons, summary, sparkline dots
- `lib/dashboard/styles/_calendar.scss` (created) — Calendar: navigation, 7-column grid, day cells, task-density dots
- `lib/dashboard/styles/_agenda.scss` (created) — Agenda: task list, priority indicator bar, time, duration
- `lib/dashboard/styles/_quotes.scss` (created) — Quotes: 2-column image tile grid, serif text overlay
- `lib/dashboard/styles/_ai-plugins.scss` (created) — AI plugins: list items with icon, label, circular badge
- `lib/dashboard/styles/_quick-actions.scss` (created) — Quick actions: 2x2 button grid with icon and label
- `lib/dashboard/styles/dashboard.scss` (created) — Master stylesheet: imports all partials, global resets, 4-column grid, responsive breakpoints

**Task:** Implement the complete SCSS design system for the dashboard
**Prompt summary:** "create SCSS styles matching the dashboard mockup with design tokens and per-widget partials"
**Scope:** ~350 lines across 11 SCSS files
**Notes:** Uses SCSS @use modules, responsive breakpoints at 800px and 480px

---

## 2026-02-21 — Local dev server for rapid iteration

**Model:** claude-opus-4-6
**Files created/modified:**
- `dev/dev-server.js` (created) — esbuild context with watch + serve, SCSS compilation on each rebuild, serves on port 3000
- `dev/index.html` (created) — HTML shell with dashboard-root div, loads styles.css, mock-data.js, bundle.js
- `dev/mock-data.js` (created) — Global callPlugin mock handling init, fetchQuotes, configure, navigateToNote, quickAction with realistic sample data
- `package.json` (modified) — Added "dev" script

**Task:** Run the dashboard React app in a browser without the Amplenote plugin context
**Prompt summary:** "dev server with esbuild watch, SCSS recompilation, and mock callPlugin data on localhost:3000"
**Scope:** ~170 lines across 3 new files + 1 modified
**Notes:** Uses esbuild.context() with watch + serve; mock data shape mirrors data-service.js output

---

## 2026-02-21 — Task Domain selector with caching and domain-filtered tasks

**Model:** claude-opus-4-6
**Files created/modified:**
- `lib/constants/settings.js` (modified) — Added `TASK_DOMAIN_SETTING` and `TASK_DOMAIN_STALE_MS` constants
- `lib/data-service.js` (modified) — Added task domain resolution with 24h caching, `switchTaskDomain()`, `refreshTaskDomains()`, domain-filtered task fetching; replaced all-domain fetch with single-domain fetch
- `lib/plugin.js` (modified) — Added `setActiveTaskDomain` and `refreshTaskDomains` actions to onEmbedCall dispatch
- `lib/dashboard/task-domains.js` (created) — React component listing available domains as pills, with selection state, settings link to task_calendar, and refresh button
- `lib/dashboard/app.js` (modified) — Added `handleDomainChange` callback, integrated `TaskDomains` component, passes domain-dependent data to child widgets
- `lib/dashboard/styles/_task-domains.scss` (created) — Pill-style domain selector bar with active state, settings icon, and refresh link
- `lib/dashboard/styles/dashboard.scss` (modified) — Added `@use 'task-domains'` import
- `dev/mock-data.js` (modified) — Added mock task domains array and handlers for `setActiveTaskDomain`/`refreshTaskDomains`

**Task:** Allow user to choose which Task Domain their dashboard focuses on
**Prompt summary:** "add a Task Domain selector that caches domains in settings, refreshes when stale (>24h), defaults to Work, and filters all task-dependent widgets to the selected domain"
**Scope:** ~200 lines of new logic across 8 files
**Notes:** Domains cached via `app.setSetting` as JSON with `{domains, selectedDomainUuid, lastRetrieved}`. Auto-defaults to "Work" domain. Each domain pill has a gear icon linking to amplenote.com/task_calendar for domain configuration.

---

## 2026-02-21 — AI authorship documentation (this entry)

**Model:** claude-opus-4-6
**Files created/modified:**
- `AI_CONTRIBUTIONS.md` (created) — This log file
- All files listed above (modified) — Added `[Claude-authored file]` headers and inline `[Claude]` annotations per CLAUDE.md standards
- `README.md` (modified) — Added development, build, test, and project structure documentation

**Task:** Document AI authorship across all project files per CLAUDE.md standards
**Prompt summary:** "add file headers, inline annotations, and AI_CONTRIBUTIONS.md covering all Claude-authored code"
**Scope:** Annotation headers and comments added to 28 files
**Notes:** Covers sections 1, 2, 4, and 5 of CLAUDE.md; commit messages (section 3) and PR descriptions (section 6) applied at commit/PR time
