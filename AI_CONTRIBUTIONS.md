# AI Contributions Log

This file tracks all code authored or substantially modified by AI models in this
repository, per the standards defined in `CLAUDE.md`.

---

## 2026-02-22 — SCSS styles refactor: alphabetize, constants, themed colors

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/styles/dashboard.scss` (modified) — Added layout constants; alphabetized declarations; replaced magic numbers
- `lib/dashboard/styles/_config-popup.scss` (modified) — Constants for dimensions/shadow; themed overlay colors; alphabetized
- `lib/dashboard/styles/_widget-wrapper.scss` (modified) — Alphabetized declarations
- `lib/dashboard/styles/_ai-plugins.scss` (modified) — Badge size constant; $color-text-on-accent; alphabetized
- `lib/dashboard/styles/_victory-value.scss` (modified) — Alphabetized declarations
- `lib/dashboard/styles/_quotes.scss` (modified) — Quote tile min-height constant; $color-text-on-accent; alphabetized
- `lib/dashboard/styles/_mood.scss` (modified) — Constants for button size, dot size/gap/radius, sparkline height, transition; alphabetized
- `lib/dashboard/styles/_planning.scss` (modified) — Border/transition constants; $color-text-on-accent; alphabetized
- `lib/dashboard/styles/_quick-actions.scss` (modified) — Transition constant; alphabetized
- `lib/dashboard/styles/_task-domains.scss` (modified) — Transition constant; $color-text-on-accent-muted; alphabetized
- `lib/dashboard/styles/_calendar.scss` (modified) — Constants for gap, dot size, outline, transition; $color-text-on-accent; alphabetized
- `lib/dashboard/styles/_agenda.scss` (modified) — Constants for indicator, list height, transition; alphabetized
- `lib/dashboard/styles/_tooltip.scss` (modified) — Constants for dimensions, shadow, arrow; themed tooltip colors; alphabetized
- `lib/dashboard/styles/_theme.scss` (modified) — Added overlay, text-on-accent, tooltip color tokens
- `lib/dashboard/styles/_theme-light.scss` (modified) — Added new tokens; alphabetized :root declarations
- `lib/dashboard/styles/_theme-dark.scss` (modified) — Added new tokens; alphabetized :root declarations

**Task:** Refactor all SCSS: alphabetize declarations, replace magic numbers with constants, use themed colors instead of hex
**Prompt summary:** "Visit the /styles/ directory and update every style declaration: alphabetize within rules, declare SCSS constants for magic numbers, remove unnecessary defaults, replace hex colors with themed colors"
**Scope:** ~16 SCSS files modified
**Notes:** New theme tokens: $color-text-on-accent, $color-text-on-accent-muted, $color-overlay-backdrop, $color-overlay-shadow, $color-tooltip-* (bg, text, border, accent, shadow, text-muted)

---

## 2026-02-21 — Standardize navigation through app.navigate actions

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/data-service.js` (modified) — Updated task deep-link URL to `highlightTaskUUID`; added `navigateToUrl()` and `runQuickAction()` wrappers that route through `app.navigate`
- `lib/plugin.js` (modified) — Added `navigateToUrl` and `quickAction` action handlers backed by `app.navigate`
- `lib/dashboard/task-domains.js` (modified) — Replaced direct anchor navigation with plugin-driven `navigateToUrl` action for task-domain settings
- `lib/dashboard/styles/_task-domains.scss` (modified) — Updated settings control styles to support button semantics
- `dev/mock-data.js` (modified) — Replaced navigation logging stubs with an `app.navigate`-style mock that validates Amplenote note URLs

**Task:** Ensure note/section links and task deep-links use `app.navigate`
**Prompt summary:** "replace navigateToTask mock with app.navigate behavior and ensure other note/section links (like quick links) use app.navigate"
**Scope:** ~90 lines changed across 5 files
**Notes:** Task deep-links now use `https://www.amplenote.com/notes/NOTE_UUID?highlightTaskUUID=TASK_UUID`

---

## 2026-02-21 — Agenda grouped task navigation and rendering updates

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/app.js` (modified) — Alphabetized `renderActiveComponents` switch cases and passed agenda `tasks` grouped by `YYYY-MM-DD` keys (up to 3 days)
- `lib/dashboard/agenda.js` (modified) — Reworked rendering to date-labeled sections, scrollable task list, clickable task deep-link behavior, note links, and explicit no-tasks-today state
- `lib/dashboard/styles/_agenda.scss` (modified) — Added date section styles, scroll container, clickable row styles, note link styles, and italic lighter empty-today text
- `lib/data-service.js` (modified) — Added `navigateToTask(app, noteUUID, taskUUID)` helper for task-level navigation
- `lib/plugin.js` (modified) — Added `navigateToTask` embed action dispatch
- `dev/mock-data.js` (modified) — Added `navigateToTask` mock action and note metadata on generated mock tasks

**Task:** Improve Agenda widget task grouping, navigation, and list usability
**Prompt summary:** "alphabetize renderActiveComponents cases; pass agenda tasks keyed by date; support task/note click navigation; support >4 tasks; show explicit no-tasks-today messaging"
**Scope:** ~170 lines changed across 6 files
**Notes:** Agenda now receives grouped tasks from domain task data rather than `todayTasks`; task links deep-link into notes via `highlightTaskUUID`

---

## 2026-02-21 — Split light/dark theme token files

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/styles/_theme-light.scss` (created) — Added light-theme CSS custom properties for all dashboard color tokens
- `lib/dashboard/styles/_theme-dark.scss` (created) — Added dark-theme CSS custom properties for all dashboard color tokens under `prefers-color-scheme: dark`
- `lib/dashboard/styles/_theme.scss` (modified) — Refactored color tokens to consume CSS custom properties from split light/dark theme files
- `lib/dashboard/styles/_agenda.scss` (modified) — Switched to unified agenda priority tokens and removed file-local dark override block
- `lib/dashboard/styles/_quick-actions.scss` (modified) — Replaced Sass color adjustment with theme token hover color

**Task:** Separate color definitions into dedicated light and dark theme files
**Prompt summary:** "Create _theme-light.scss and _theme-dark.scss with separate text/agenda/other color definitions from _theme.scss"
**Scope:** ~90 lines changed across 5 style files
**Notes:** Existing component styles continue using the same `$color-*` tokens through `_theme.scss`, while runtime color values now switch by color scheme

---

## 2026-02-21 — Agenda priority classes with theme-aware colors

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/agenda.js` (modified) — Replaced inline priority color styles with semantic priority classes
- `lib/dashboard/styles/_agenda.scss` (modified) — Added class-based priority indicator styling plus dark mode overrides
- `lib/dashboard/styles/_theme.scss` (modified) — Added light/dark agenda priority color tokens

**Task:** Replace hard-coded agenda priority colors with class-driven themed styling
**Prompt summary:** "apply a class based on task properties and map to light/dark themed priority colors"
**Scope:** ~35 lines changed across 3 files
**Notes:** Uses `@media (prefers-color-scheme: dark)` for dark-mode color mapping while preserving existing priority semantics

---

## 2026-02-21 — Config-driven dashboard component rendering

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/constants/settings.js` (modified) — Added `DASHBOARD_COMPONENTS` key and `DEFAULT_DASHBOARD_COMPONENTS` layout definition
- `lib/data-service.js` (modified) — Added initialization/persistence logic for `DASHBOARD_COMPONENTS` when missing and included it in returned dashboard settings
- `lib/dashboard/app.js` (modified) — Added `renderActiveComponents()` method that renders widgets from persisted layout using a `switch` and dynamic grid spans

**Task:** Move widget rendering to a dedicated function driven by persisted component layout settings
**Prompt summary:** "break out rendering into renderActiveComponents; read which widgets and grid sizes from app.settings; initialize default DASHBOARD_COMPONENTS; use switch for component props"
**Scope:** ~80 lines of logic changed across 3 files
**Notes:** Default component order and sizing matches prior hardcoded dashboard grid; per-widget configuration payload is now available on each component entry under `settings`

---

## 2026-02-21 — JSDoc parameter documentation for WidgetWrapper

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/widget-wrapper.js` (modified — added full JSDoc block for all parameters)

**Task:** Add full JSDoc documentation for each parameter of the `WidgetWrapper` component
**Prompt summary:** "Update WidgetWrapper with full JSDoc for each of its parameters"
**Scope:** ~15 lines of documentation added; no logic changes

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

## 2026-02-22 — DashboardTooltip component and Victory Value hover tooltips

**Model:** claude-opus-4-6
**Files created/modified:**
- `lib/dashboard/tooltip.js` (created) — Self-contained `DashboardTooltip` component accepting `left`, `visible`, and `children` props; renders a dark positioned popup with arrow inside a `position: relative` parent
- `lib/dashboard/styles/_tooltip.scss` (created) — Full tooltip stylesheet: shell positioning, dark background, arrow, and all content slot classes (`dashboard-tooltip-header`, `dashboard-tooltip-section`, `dashboard-tooltip-row` with `-label`/`-value`, `dashboard-tooltip-empty`)
- `lib/dashboard/styles/dashboard.scss` (modified) — Added `@use 'tooltip'` import
- `lib/dashboard/victory-value.js` (modified) — Added `completedTasks` prop, canvas mousemove/mouseleave hover detection, and tooltip rendering showing date header, mood rating, and completed tasks sorted by victoryValue descending
- `lib/dashboard/styles/_victory-value.scss` (modified) — Added `.vv-chart-container` with `position: relative` for tooltip anchoring
- `lib/dashboard/app.js` (modified) — Passed `completedTasks` from `widgetData` to VictoryValueWidget props

**Task:** Add hover tooltips to Victory Value chart bars showing completed tasks and mood for each day
**Prompt summary:** "show a tooltip listing tasks finished sorted by victoryValue, with mood rating, when hovering on a date in VictoryValue; extract tooltip into standalone reusable component"
**Scope:** ~120 lines of new logic across 6 files
**Notes:** Tooltip is fully self-contained — all styling lives in the tooltip's own stylesheet. Canvas hover detection maps mouse position to bar zones using the same geometry as the canvas drawing code. Mood uses the same -2..2 emoji mapping as the Mood widget.

---

## 2026-02-22 — Inline ConfigPopup component for widget settings

**Model:** claude-opus-4-6
**Files created/modified:**
- `lib/dashboard/config-popup.js` (created) — Reusable popup component with `onSubmit`, `onCancel`, and `children` props
- `lib/dashboard/styles/_config-popup.scss` (created) — Overlay, modal card, form field, and action button styles
- `lib/dashboard/styles/dashboard.scss` (modified) — Added `@use 'config-popup'` import
- `lib/dashboard/widget-wrapper.js` (modified) — Added `onConfigure` callback prop to override default plugin-based configure
- `lib/dashboard/victory-value.js` (modified) — Integrated ConfigPopup with time range and mood overlay settings
- `lib/dashboard/calendar.js` (modified) — Integrated ConfigPopup with week-start-day setting
- `lib/plugin.js` (modified) — Added `saveSetting` action to persist config from inline popup

**Task:** Implement inline settings popup for Victory Value and Calendar widgets
**Prompt summary:** "popup component that pops up setting options upon clicking Configure, with onSubmit/onCancel and content props"
**Scope:** ~120 lines of new logic across 7 files
**Notes:** ConfigPopup renders as a fixed overlay modal; widgets manage their own config state and render the popup conditionally when Configure is clicked

---

## 2026-02-22 — Scope dashboard SCSS under component parents

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/styles/_agenda.scss` (modified) — wrapped agenda selectors under `.widget-agenda`
- `lib/dashboard/styles/_calendar.scss` (modified) — wrapped calendar selectors under `.widget-calendar`
- `lib/dashboard/styles/_task-domains.scss` (modified) — wrapped task-domain selectors under `.dashboard`
- `lib/dashboard/styles/_quick-actions.scss` (modified) — wrapped quick-action selectors under `.widget-quick-actions`
- `lib/dashboard/styles/_planning.scss` (modified) — wrapped planning selectors under `.widget-planning`
- `lib/dashboard/styles/_mood.scss` (modified) — wrapped mood selectors under `.widget-mood`
- `lib/dashboard/styles/_quotes.scss` (modified) — wrapped quotes selectors under `.widget-quotes`
- `lib/dashboard/styles/_victory-value.scss` (modified) — wrapped victory-value selectors under `.widget-victory-value`
- `lib/dashboard/styles/_ai-plugins.scss` (modified) — wrapped AI plugin selectors under `.widget-ai-plugins`
- `lib/dashboard/styles/_config-popup.scss` (modified) — wrapped popup selectors under `.dashboard`
- `lib/dashboard/styles/_widget-wrapper.scss` (modified) — wrapped shared widget chrome selectors under `.dashboard`
- `lib/dashboard/styles/dashboard.scss` (modified) — scoped layout/reset selectors to `.dashboard` and updated responsive nesting
- `lib/dashboard/styles/_theme-light.scss` (modified) — scoped light theme variables under `.dashboard`
- `lib/dashboard/styles/_theme-dark.scss` (modified) — scoped dark theme variables under `.dashboard`

**Task:** Scope dashboard stylesheets to parent component wrappers to avoid global style bleed
**Prompt summary:** "Update all of the files in the dashboard/styles directory so that they are wrapped by a parent class for the component that is including the stylesheet"
**Scope:** ~14 SCSS files updated with parent wrappers and scoped theme variables
**Notes:** Widget partials now key off `WidgetWrapper` classes (`.widget-<id>`), while shared and dashboard-level styles are scoped to `.dashboard`

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

## 2026-02-22 — Split DashboardApp state + useDomainTasks hook

**Model:** claude-opus-4-6
**Files created/modified:**
- `lib/hooks/use-domain-tasks.js` (created) — Custom hook managing taskDomains, activeTaskDomain, tasksFetchedAt, openTasks, completedTasks state; contains formatDateKey, groupOpenTasksByDate, groupCompletedTasksByDate internal helpers; exposes initializeDomainTasks, handleDomainChange, buildAgendaTasksByDate
- `lib/dashboard/app.js` (modified) — Replaced monolithic `data` state with individual state variables (moodRatings, quarterlyPlans, settings, dailyVictoryValues, weeklyVictoryValue, currentDate); integrated useDomainTasks hook; removed formatDateKey and buildAgendaTasksByDate; updated renderActiveComponents to accept widgetData object; loading check uses `!settings` instead of `!data`
- `lib/dashboard/calendar.js` (modified) — Replaced flat `tasks` prop with `openTasks` + `completedTasks` grouped objects; updated task-counting loop to iterate date-keyed groups by month prefix

**Task:** Extract task domain state and grouping logic into a custom hook; split monolithic data state into individual variables
**Prompt summary:** "Replace monolithic data state in DashboardApp with individual state variables; extract task parsing/grouping into useDomainTasks hook; split tasks into openTasks and completedTasks grouped by date"
**Scope:** ~110 lines of new logic in hook, ~40 lines changed in app.js, ~10 lines changed in calendar.js
**Notes:** Tasks are now grouped at the React layer: openTasks keyed by startAt/deadline date, completedTasks keyed by completedAt date. data-service.js continues returning flat arrays unchanged.

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
