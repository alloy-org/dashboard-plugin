# AI Contributions Log

This file tracks all code authored or substantially modified by AI models in this
repository, FROM NEWEST TO OLDEST, per the standards defined in `CLAUDE.md`. 

---

## 2026-03-14 — Bundle size analysis document

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `doc/size_analysis.md` (created)

**Task:** Analyze the compiled plugin bundle size and break down each library/module that contributes more than 1 KB, with necessity and removability assessment
**Prompt summary:** "Create doc/size_analysis.md breaking down compiled plugin size, libraries/components, and whether each >1KB module could be removed"
**Scope:** Analysis document — no code changes
**Notes:** Measured from `build/compiled.js` (908 KB) and `dev/bundle.js` (1.33 MB) using esbuild section headers. Production bundle is ~86% base64-encoded client bundle. Largest single opportunity is enabling minification (one commented-out line in esbuild.js).

## 2026-03-14 — File-backed notes for dev environment (createNote, findNote, replaceContent)

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `.gitignore` (modified — added `/notes` to ignored paths)
- `dev/dev-app.js` (modified — added `crypto` import, `NOTES_DIR` constant, frontmatter helpers `_ensureNotesDir`, `_buildFrontmatter`, `_parseFrontmatter`, `_readAllNoteFiles`; rewrote `createNote` to write UUID-named `.md` files with YAML frontmatter; added `findNote` to scan notes directory by name/uuid; added `replaceContent` to replace content below frontmatter; upgraded `insertNoteContent` and `getNoteContent` to read/write from note files)
- `lib/plugin.js` (modified — added `replaceContent` case to `onEmbedCall` switch)

**Task:** Enable dev-mode note persistence via the filesystem so the quarterly goals module can read real content
**Prompt summary:** "when app.createNote is called in dev environment, create a file with a random uuid in the /notes directory; findNote loops over files; replaceContent appends content below frontmatter"
**Scope:** ~120 lines of new logic across 3 files
**Notes:** Notes are stored as `notes/<uuid>.md` with YAML frontmatter (title, uuid, version, created, updated, tags). The `/notes` directory is gitignored. `replaceContent` updates the `updated` timestamp in frontmatter when writing.

---

## 2026-03-14 — DreamTask widget with agentic LLM-powered task suggestions

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dream-task-service.js` (created — agentic loop: gathers tasks, plans, previous analyses, calls LLM, writes monthly note)
- `lib/dashboard/dream-task.js` (created — React widget component with settings gate, loading/error states, 1-tall/2-tall rendering)
- `lib/dashboard/styles/_dream-task.scss` (created — card layout, rating badges, loading/error/no-config states)
- `lib/constants/settings.js` (modified — added `dream-task` to `WIDGET_REGISTRY`)
- `lib/dashboard/dashboard.js` (modified — imported DreamTaskWidget, added memoized DreamTaskCell, added switch case)
- `lib/plugin.js` (modified — imported `analyzeDreamTasks`, added `dreamTaskAnalyze` bridge action)
- `lib/data-service.js` (modified — added `LLM_PROVIDER` and `LLM_API_KEY` to `_readDashboardSettings`)
- `lib/dashboard/styles/dashboard.scss` (modified — imported `dream-task` partial)
- `lib/providers/ai-provider-settings.js` (modified — fixed import path from `constants/provider` to `constants/llm-providers`, added `defaultProviderModel` and `preferredModels` exports, fixed `apiKeyFromApp` to read `LLM_API_KEY` instead of `LLM_PROVIDER`)

**Task:** Create a DreamTask widget that uses an agentic loop to suggest 3-5 tasks
aligned with the user's quarterly and monthly goals, writes results to a monthly
planning note, and renders the top-rated suggestions in the widget.
**Prompt summary:** "Create a new widget, DreamTask, that retrieves all tasks from
getTaskDomainTasks, uses an agentic loop to interpret the user's quarterly/monthly plan,
suggests goal-aligned tasks with ratings, writes to a monthly note, and renders in widget"
**Scope:** ~350 lines of new logic across 3 new files; ~30 lines of modifications across
6 existing files
**Notes:** The agentic service reads prior analyses from the monthly note to avoid
repetition. Today's results are cached in the note and returned without re-calling the
LLM on subsequent loads. Widget shows 1 task when 1-tall, 2 tasks when 2-tall, sorted
by rating. If no LLM provider/key is configured, the widget shows a link to open the
settings dialog. Also fixed pre-existing build errors in ai-provider-settings.js.

---

## 2026-03-09 — Extract handler/response functions to module scope in dashboard.js

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dashboard.js` (modified — extracted 6 handler functions to module scope)

**Task:** Move response/handler functions out of `DashboardApp` component body into
module-scope local functions that receive setters and values as explicit arguments,
keeping `useCallback` wrappers inside the component as thin one-liner delegations.
**Prompt summary:** "move response/handler functions outside main component to be local functions that receive arguments"
**Scope:** ~130 lines of handler logic extracted; 6 `useCallback` bodies replaced with
one-line delegations to `handleInitResult`, `fetchMoodRatingsForDate`, `applyDomainChange`,
`saveLayout`, `saveSettings`, and `appendMoodRating`.
**Notes:** No behavioral change — identical runtime semantics. Component body reduced
from ~160 lines of mixed state+logic to ~100 lines of state+thin wrappers+render.

---

## 2026-03-09 — Fall back to previous week in VictoryValue when current week is sparse

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/util/date-utility.js` (modified — added `isCurrentWeekEarly()` helper)
- `lib/hooks/use-completed-tasks.js` (modified — merge multi-week data instead of replacing; Set-based dedup with domain-change reset)
- `lib/dashboard/dashboard.js` (modified — compute `victoryReferenceDate` with early-week fallback; fetch both weeks' completed tasks; extend mood rating range)

**Task:** When the current week has fewer than 3 full elapsed days (Mon/Tue/Wed), automatically show the previous week's data in the VictoryValue chart instead of a nearly empty current week
**Prompt summary:** "when beginning of new week with less than 3 full days of stats, show previous week"
**Scope:** ~40 lines of new/modified logic across 3 files
**Notes:** Only applies on default view (no explicit date selection); user can still navigate to the current week via the right arrow. useCompletedTasks now accumulates data across multiple week fetches so both Calendar and VictoryValue have their respective weeks' data.

## 2026-03-09 — Replace hand-rolled tooltips with Tippy.js

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dashboard-tippy.js` (created — `DashboardTippy` React component and `useCanvasTippy` hook wrapping tippy.js)
- `lib/dashboard/styles/_dashboard-tippy.scss` (created — base tippy positioning CSS, dashboard theme, tooltip content classes)
- `lib/dashboard/victory-value.js` (modified — replaced `DashboardTooltip` component with `useCanvasTippy` hook; tooltip content now rendered as HTML string)
- `lib/dashboard/mood.js` (modified — replaced custom `renderMoodTooltip` with `useCanvasTippy` in both RadialRing and WaveGraph)
- `lib/dashboard/planning.js` (modified — replaced native `title` attribute on plan indicator with `DashboardTippy` component)
- `lib/dashboard/styles/dashboard.scss` (modified — swapped `@use 'tooltip'` for `@use 'dashboard-tippy'`)
- `lib/dashboard/styles/_mood.scss` (modified — removed `.mood-viz-tooltip*` styles, now in `_dashboard-tippy.scss`)
- `lib/dashboard/tooltip.js` (deleted — hand-rolled tooltip component no longer needed)
- `lib/dashboard/styles/_tooltip.scss` (deleted — hand-rolled tooltip styles no longer needed)

**Task:** Consolidate three separate tooltip implementations (DashboardTooltip component, mood viz tooltip, native `title` attributes) into a single tippy.js-based system
**Prompt summary:** "replace hand-rolled tooltips with tippy.js, separated into its own component and stylesheet"
**Scope:** ~90 lines of new wrapper code; ~150 lines of old tooltip code removed; tippy.js added as bundled dependency
**Notes:** Tippy.js adds ~42 KB minified / ~14 KB gzipped to the client bundle (plus @popperjs/core). The `useCanvasTippy` hook uses tippy's virtual element API for positioning tooltips on canvas visualizations. The `DashboardTippy` component provides a declarative wrapper for DOM element tooltips.

## 2026-03-09 — Quarter card created-plan styling and monthly-details indicator

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/planning.js` (modified — added `quarter-card--has-plan` class, status row layout, ✅/🚧 icon with tooltip)
- `lib/data-service.js` (modified — `_findQuarterlyPlans` now sets `hasAllMonthlyDetails`; added `_quarterMonthNames` and `_hasAllMonthSections` helpers)
- `lib/dashboard/styles/_planning.scss` (modified — `--has-plan` modifier styles, `.quarter-status-row`, `.quarter-plan-indicator`)
- `lib/dashboard/styles/_theme.scss` (modified — added `$color-plan-created-bg` and `$color-plan-created-border` tokens)
- `lib/dashboard/styles/_theme-light.scss` (modified — added light-mode plan-created color values)
- `lib/dashboard/styles/_theme-dark.scss` (modified — added dark-mode plan-created color values)
- `dev/mock-data.js` (modified — added `hasAllMonthlyDetails: false` to mock quarterly plans)

**Task:** When a quarterly plan has been created, change its card to solid green border + light-green background; show a ✅ or 🚧 icon (with tooltip) indicating whether all 3 months have been detailed
**Prompt summary:** "solid border + green bg when quarterly plan exists; checkmark or WIP icon based on monthly details"
**Scope:** ~50 lines of new/changed logic across 7 files
**Notes:** `hasAllMonthlyDetails` is computed at fetch time via `app.getNoteSections`; icon uses host-app `text_in_tip tooltip` classes with `title` for the tooltip text

---

## 2026-03-08 — VictoryValue tooltip direction-aware positioning

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/victory-value.js` (modified — added `getTooltipDirection`, updated `renderTooltip`)
- `lib/dashboard/tooltip.js` (modified — added `direction` prop, applies `--below` modifier class)
- `lib/dashboard/styles/_tooltip.scss` (modified — added `.dashboard-tooltip--below` variant)

**Task:** Make the hover tooltip on VictoryValue bars pop above or below the chart depending on which side of the full dashboard window has more available pixels, preventing occlusion of the Victory Value graph
**Prompt summary:** "calculate whether there is more space above or below the chart and pop the tooltip on whichever side has more available pixels"
**Scope:** ~25 lines of new/changed logic across 3 files
**Notes:** `getTooltipDirection` uses `canvas.getBoundingClientRect()` + `window.innerHeight` to compare `rect.top` (space above) against `window.innerHeight - rect.bottom` (space below). Direction is re-evaluated on every render while hovering. The `--below` SCSS modifier flips `bottom`/`top` and inverts the arrow border triangle.

---

## 2026-03-08 — Mood widget: Fix over-animating, add tooltips

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/mood.js` (modified — three feature changes)
- `lib/dashboard/styles/_mood.scss` (modified — tooltip styles, overflow fix)

**Task:** Fix animations re-triggering on Configure dialog open/close; add date labels below day-of-week on both viz types; add hover tooltip showing full date, individual ratings with times, and notes
**Prompt summary:** "fix animation re-animate on configure dialog, show dates for each rating, add hover tooltip with full date/ratings/times/notes"
**Scope:** ~120 lines of new/changed logic across 2 files
**Notes:** Animation stability achieved by using JSON.stringify of moodData as effect dependency instead of reference equality. Tooltip uses HTML overlay with absolute positioning relative to canvas wrapper. Notes display depends on mood rating API returning notes on the rating object.

---

---

## 2026-03-08 — Month plan display improvements (markdown, lists, overflow)

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/util/utility.js` (modified — added `renderBlockMarkdown` using `marked.parse` for block-level markdown)
- `lib/dashboard/planning.js` (modified — switched to `dangerouslySetInnerHTML` with `renderBlockMarkdown`, added console.log for raw markdown)
- `lib/dashboard/styles/_planning.scss` (modified — added `overflow: hidden`, tightened line spacing, added `ol`/`ul`/`li`/`p` styles)

**Task:** Improve the monthly plan content display: hide overflow, render numbered items as proper `<ol>` lists, eliminate extra line spacing, and apply full markdown formatting via `marked.parse`. Added debug logging of raw markdown content.
**Prompt summary:** "hide overflow, render numeric items as ol list, no extra space between lines, ensure markdown formatting, console.log the markdown"
**Scope:** ~25 lines of new/modified logic across 3 files
**Notes:** The existing `renderMarkdown` uses `marked.parseInline` which strips block-level constructs; the new `renderBlockMarkdown` uses `marked.parse` to support lists and paragraphs.

---

## 2026-03-08 — Monthly plan content expansion in Quarterly Planning widget

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/constants/quarters.js` (modified — added `FULL_MONTH_NAMES`, `getQuarterMonths`, `extractMonthSectionContent`, `defaultMonthTemplate`)
- `lib/data-service.js` (modified — added `getMonthlyPlanContent` and `createOrAppendMonthlyPlan` exports)
- `lib/plugin.js` (modified — added `getMonthlyPlanContent`, `createOrAppendMonthlyPlan`, `getNoteSections` bridge actions)
- `lib/dashboard/planning.js` (modified — month tabs now expand to show section content or "Create a plan" link)
- `lib/dashboard/styles/_planning.scss` (modified — added month-content-area, loading, header, text, empty, and create-link styles)

**Task:** When a month tab is clicked in the Planning widget, check the quarterly plan note for a matching section heading via `app.getNoteSections`. If found, extract and display the month's content using a regex on the full note markdown. If not found, show a "Create a plan for [Month] [Year]" link that either creates a new quarterly plan note with the full template or appends the month section to the existing note.
**Prompt summary:** "when a month is clicked, check the quarterly plan note for a section that corresponds with the month"
**Scope:** ~120 lines of new logic across 5 files
**Notes:** Uses `app.getNoteSections` to detect month headings, `app.getNoteContent` + regex extraction for content, `app.insertNoteContent` with `atEnd: true` for appending month sections to existing notes

---

## 2026-03-07 — Console logging setting, logIfEnabled utility, and widget load timing

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/util/log.js` (created)
- `lib/constants/settings.js` (modified — added `CONSOLE_LOGGING` to `SETTING_KEYS`)
- `lib/data-service.js` (modified — reads Console Logging setting, replaced `console.log`/`console.error` with `logIfEnabled`)
- `lib/plugin.js` (modified — initializes logging flag per `onEmbedCall`, replaced `console.error`/`console.log` with `logIfEnabled`)
- `lib/dashboard/dashboard.js` (modified — initializes logging from settings on init, replaced all `console.log`/`console.error` with `logIfEnabled`, added per-widget load timing with `performance.now()`)
- `lib/dashboard/mood.js` (modified — replaced `console.error` with `logIfEnabled`)
- `lib/dashboard/recent-notes.js` (modified — replaced `console.log`/`console.warn`/`console.error` with `logIfEnabled`)
- `lib/dashboard/victory-value.js` (modified — replaced `console.log`/`console.debug` with `logIfEnabled`)
- `lib/dashboard/dashboard-settings-popup.js` (modified — replaced `console.log`/`console.error` with `logIfEnabled`)
- `lib/hooks/use-domain-tasks.js` (modified — replaced `console.log`/`console.debug` with `logIfEnabled`)
- `lib/hooks/use-completed-tasks.js` (modified — replaced `console.error` with `logIfEnabled`)
- `lib/hooks/use-background-upload-fields.js` (modified — replaced `console.warn`/`console.log`/`console.error` with `logIfEnabled`)
- `lib/providers/fetch-ai-provider.js` (modified — replaced all `console.log`/`console.debug`/`console.error` with `logIfEnabled`)
- `lib/providers/fetch-json.js` (modified — replaced all `console.log`/`console.debug`/`console.error` with `logIfEnabled`)
- `lib/app-util.js` (modified — replaced all `console.error`/`console.debug` with `logIfEnabled`)

**Task:** Add a "Console Logging" setting label, create a `logIfEnabled` utility function gated by that setting, and replace all console logging throughout the codebase. Each widget cell in `dashboard.js` now logs when it begins loading and when it finishes (with elapsed ms via `performance.now()`).
**Prompt summary:** "add console logging setting, create logIfEnabled function, update widgets to log load start/finish with timing"
**Scope:** ~1 new file (30 lines), ~15 modified files replacing ~70 console calls with `logIfEnabled`
**Notes:** Logging is disabled by default. Setting the "Console Logging" plugin setting to "true", "yes", "1", "on", or "enabled" (case-insensitive) activates it. Client-side logging is initialized from settings returned by `init`; plugin-side logging is initialized at the start of each `onEmbedCall`. Widget timing uses `performance.now()` at render start and `useEffect` for completion.

---

## 2026-03-07 — mood.js cleanup: actual emojis, derived VIZ lookup, no abbreviations

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/mood.js` (modified)

**Task:** Three clean-up items: replace unicode escape sequences in MOODS with literal emoji characters; derive VISUALIZATION_MOOD_EMOJIS from MOODS via toVizScale instead of duplicating values; expand all abbreviated variable and function names throughout the file
**Prompt summary:** "substitute actual emojis; source VIZ_MOOD_EMOJIS from MOODS; remove abbreviations from variable/function names"
**Scope:** ~60 identifier renames and value substitutions across the file, no logic changes
**Notes:** MOODS remains the single source of truth for both emoji characters and the viz-scale emoji map; CSS class names were left unchanged as they are not JS identifiers

---

## 2026-03-07 — Mood viz: theme-aware colors and sparse-data robustness

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/mood.js` (modified — added `readThemeColors()` helper; replaced all hardcoded hex colors in `RadialRing` and `WaveGraph` with `--dashboard-color-*` CSS custom property reads; fixed WaveGraph division-by-zero with 1-point data; added guard for 0-point avg display; 2-point bezier placed at 25%/75% x positions)

**Task:** Use standardized `_theme-dark.scss` / `_theme-light.scss` CSS custom properties for canvas backgrounds and text, and make both visualizations render correctly with 0–2 mood ratings
**Prompt summary:** "utilize standardized theme-dark and theme-light colors; ensure visualizations render with 0-2 mood ratings"
**Scope:** ~80 lines changed across 1 file
**Notes:** Colors are read at draw-time via `getComputedStyle(document.documentElement)` so they respond to theme switches without re-mounting; `colorWithAlpha` appends hex alpha only for `#rrggbb` strings, falling through for `rgb()`/`rgba()` values

---

## 2026-03-07 — Mood widget: radial ring and wave graph visualizations

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/mood.js` (modified — replaced `renderSparkline` with canvas-based `RadialRing` and `WaveGraph` components; added `Configure` popup to toggle between them)
- `lib/dashboard/styles/_mood.scss` (modified — added `.mood-viz-section`, `.mood-viz-canvas-wrap`, `.mood-viz-canvas`, `.mood-viz-configure-link`, `.mood-viz-config-option`)

**Task:** Replace the plain sparkline in the Mood widget with two animated canvas visualizations — a radial ring (segments per day, colored by mood) and a wave graph (smooth bezier curve with emoji dots) — switchable via a Configure popup
**Prompt summary:** "implement separate functions to render moods as radial ring or wave graph, with a Configure link to switch between them"
**Scope:** ~250 lines of new logic across 2 files
**Notes:** Mood values are mapped from the plugin's -2..+2 scale to the 1..5 canvas scale; animations use `requestAnimationFrame` with cubic ease-out; canvas size is 220×220 CSS pixels with devicePixelRatio scaling

---

## 2026-03-07 — Quick Actions: Calendar and Random Note buttons

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/quick-actions.js` (modified) — Replaced "Amplenote Blog" with "Calendar" (navigates to calendar via navigateToUrl) and "Dashboard Plugin" with "Random Note" (picks a random task-domain note updated within the last month)
- `lib/data-service.js` (modified) — Added `randomNoteAction`: calls `app.filterNotes({ group: "task" })`, filters by `updated` within the past 30 days, navigates to a randomly selected note
- `lib/plugin.js` (modified) — Added `randomNote` case to `onEmbedCall` dispatch; imported `randomNoteAction`
- `dev/mock-data.js` (modified) — Added `randomNote` mock case that picks from sample task-domain note handles

**Task:** Replace quick-action buttons: "Amplenote Blog" → Calendar (app.navigate to calendar URL), "Dashboard Plugin" → Random Note (task-domain note picker)
**Prompt summary:** "Update Amplenote Blog to Calendar using app.navigate; update Dashboard Plugin to Random Note picking from task-domain notes updated within last month"
**Scope:** ~30 lines changed/added across 4 files
**Notes:** `randomNoteAction` falls back to the full note pool if none were updated in the last 30 days; mock picks uniformly from all sample domain notes

---

## 2026-03-07 — Add visibleTitle override and widgetTitleFromId helper

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/constants/settings.js` (modified — added `visibleTitle` key to mood entry in `WIDGET_REGISTRY`; exported `widgetTitleFromId` function that returns `visibleTitle` falling back to `name`)
- `lib/dashboard/planning.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('planning')`)
- `lib/dashboard/victory-value.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('victory-value')`)
- `lib/dashboard/mood.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('mood')`; now displays "How are you feeling?" via `visibleTitle`)
- `lib/dashboard/calendar.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('calendar')`)
- `lib/dashboard/agenda.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('agenda')`)
- `lib/dashboard/quotes.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('quotes')`)
- `lib/dashboard/recent-notes.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('recent-notes')`)
- `lib/dashboard/quick-actions.js` (modified — replaced `WIDGET_META.name` with `widgetTitleFromId('quick-actions')`)

**Task:** Allow per-widget display title override via `visibleTitle` in `WIDGET_REGISTRY`, with a single `widgetTitleFromId` lookup function as the source of truth for all widget titles
**Prompt summary:** "Update WIDGET_REGISTRY to include visibleTitle that can override name; export widgetTitleFromId"
**Scope:** ~10 lines new logic in settings.js; mechanical import/reference updates across 8 widget files
**Notes:** `visibleTitle` is initially set only on the mood widget ("How are you feeling?"); all other widgets fall back to their `name`

---

## 2026-03-07 — Vertical/horizontal cell-size classes and adaptive widget content

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dashboard.js` (modified — added `gridCellClassName` helper; all Cell components now apply `horizontal-N-cell` / `vertical-N-cell` classes to grid-cell divs; `QuotesCell` and `RecentNotesCell` pass `gridHeightSize` to their widgets)
- `lib/dashboard/styles/dashboard.scss` (modified — added `vertical-1-cell` min-height 300px and `vertical-2-cell` min-height 600px rules on `.grid-cell`)
- `lib/dashboard/styles/_agenda.scss` (modified — replaced fixed `max-height` on `.agenda-list` with `flex: 1` to fill available parent height; added flex column on `.widget-body`)
- `lib/dashboard/styles/_quotes.scss` (modified — added flex column on `.widget-body` and `flex: 1` on `.quotes-grid` so tiles fill taller containers)
- `lib/dashboard/styles/_recent-notes.scss` (modified — added flex column on `.widget-body` with overflow handling; `.note-list` now uses `flex: 1` with `overflow-y: auto`)
- `lib/dashboard/recent-notes.js` (modified — `RecentNotesWidget` accepts `gridHeightSize`; fetches up to 10 candidates when 2 vertical cells instead of default 5)
- `lib/dashboard/quotes.js` (modified — `QuotesWidget` accepts `gridHeightSize`; shows 4 quote tiles with 4 background images when 2 vertical cells instead of default 2)
- `lib/dashboard/dashboard-layout-popup.js` (modified — `deriveInitialIds` and `deriveInitialSizing` use `Array.isArray` guard instead of `||` fallback)
- `test/app.test.js` (modified — added two tests verifying Layout popup opens without error, including when `dashboard_elements` is non-array)

**Task:** Apply CSS classes for user-assigned horizontal and vertical cell counts to each dashboard component, make widgets adapt their content to taller containers, and fix Layout popup crash on non-array currentLayout
**Prompt summary:** "upgrade each component in lib/dashboard to apply a class for cell counts; add min-height styles; make agenda-list, recent-notes, and quotes adapt to vertical-2-cell; fix layout popup crash"
**Scope:** ~80 lines of new logic across 9 files
**Notes:** The `vertical-N-cell` / `horizontal-N-cell` classes enable CSS-only height adaptation for all widgets. Agenda fills available height via flex. Recent Notes doubles its candidate pool. Quotes shows a 2x2 tile grid when tall. Fixed `deriveInitialIds` / `deriveInitialSizing` crash when `settings.dashboard_elements` was truthy but not an array — switched from `||` to `Array.isArray` guard in both helpers and the prop passed to `DashboardLayoutPopup`.

---

## 2026-03-07 — Consistent "plugins/dashboard" tagging for notes created by dashboard

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/constants/settings.js` (modified — added `DASHBOARD_NOTE_TAG`, `DEFAULT_PLANNING_TAG` constants)
- `lib/data-service.js` (modified — `createQuarterlyPlan` now tags with `plugins/dashboard` + configurable planning tag)
- `lib/plugin.js` (modified — `saveMoodNote` now tags with `plugins/dashboard`)
- `test/plugin.test.js` (modified — added tests for mood note tagging)

**Task:** Ensure all dashboard-created notes share a `plugins/dashboard` tag; planning notes additionally receive a configurable planning tag (defaults to `planning/quarterly`, overridden by `app.settings[PLANNING_NOTE_TAG_LABEL]`)
**Prompt summary:** "ensure both planning and mood notes get plugins/dashboard tag; planning note additionally gets planning/quarterly or whatever the setting instructs"
**Scope:** ~10 lines changed across 4 files
**Notes:** `DASHBOARD_NOTE_TAG` and `DEFAULT_PLANNING_TAG` extracted as shared constants so both call sites stay in sync

---

## 2026-03-07 — Interactive mood recording with notes and confirmation

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/mood.js` (modified — added mood selection state, textarea for notes, submit button, recording via `app.recordMoodRating`, history note via `app.createNote`/`app.insertNoteContent`, confirmation UI)
- `lib/dashboard/styles/_mood.scss` (modified — added styles for selected button state, textarea, submit button, and confirmation view)
- `lib/dashboard/dashboard.js` (modified — added `onMoodRecorded` callback, passed through `MoodCell` to `MoodWidget`)
- `lib/plugin.js` (modified — added `recordMoodRating` and `saveMoodNote` `onEmbedCall` actions)
- `test/app.test.js` (modified — added mock implementations for `recordMoodRating`, `findNote`, `createNote`, `insertNoteContent`)

**Task:** Make mood widget interactive: clicking an emoji selects it, reveals a textarea with "More details (optional)" label and a Submit button. On submit, record mood via `app.recordMoodRating`, write an entry to a "Mood rating history" note, transition to confirmation view, and update the sparkline with the new rating.
**Prompt summary:** "when a number is clicked, textarea opens with label, Submit button records mood via app.recordMoodRating, writes to 'Mood rating history' note, shows confirmation, new rating visible in layout"
**Scope:** ~60 lines new JS in mood.js, ~50 lines new SCSS, ~25 lines new JS in plugin.js, ~10 lines in dashboard.js
**Notes:** Uses `app.recordMoodRating` (integer -2 to +2) and `app.createNote`/`app.findNote`/`app.insertNoteContent` for the history note. Notes are optional — the entry is written even without them (just without a **Notes:** line).

---

## 2026-03-07 — Rename dashboard-config-popup to dashboard-layout-popup with tabbed sizing interface

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dashboard-config-popup.js` → `lib/dashboard/dashboard-layout-popup.js` (renamed + rewritten)
- `lib/dashboard/styles/_dashboard-config-popup.scss` → `lib/dashboard/styles/_dashboard-layout-popup.scss` (renamed + rewritten)
- `lib/dashboard/dashboard.js` (modified — updated import, component reference, and `handleLayoutSave` to accept `sizing` data)
- `lib/dashboard/styles/dashboard.scss` (modified — updated `@use` import)
- `jest.config.js` (modified — added popup and missing widget bare-import mappings)

**Task:** Rename `dashboard-config-container` class and all `dashboard-config-*` references to `dashboard-layout-popup`; add a tabbed interface with "Components" (existing drag-and-drop reordering) and "Sizing" (per-widget width and vertical tile count) tabs
**Prompt summary:** "update dashboard-config.container to be dashboard-layout-popup; create a new tab for specifying width and vertical tile count per component"
**Scope:** ~310 lines new JS + ~260 lines new SCSS; ~15 lines changed across 3 other files; 2 old files deleted
**Notes:** Sizing tab reads `maxHorizontalTiles` and `maxVerticalTiles` from `WIDGET_REGISTRY` to constrain dropdowns; sizing state is initialized from `currentLayout` and passed to `handleLayoutSave` via `{ sizing }` option; reset restores registry-default sizes

---

## 2026-03-07 — Rename app.js to dashboard.js and split layout into background wrapper + content area

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/app.js` → `lib/dashboard/dashboard.js` (renamed)
- `lib/dashboard/dashboard.js` (modified — wrapped toolbar + grid in `.dashboard-content` div)
- `lib/dashboard/styles/dashboard.scss` (modified — `.dashboard` is now full-width background; new `.dashboard-content` constrains widgets to 1200px)
- `lib/dashboard/client-entry.js` (modified — updated import path)
- `test/app.test.js` (modified — updated import path)
- `jest.config.js` (modified — updated comment)
- `README.md` (modified — updated file listing)

**Task:** Rename main app file to `dashboard.js` to match the stylesheet name; restructure layout so background covers 100% of the viewport while the widget area maxes out at 1200px
**Prompt summary:** "Update main app to be renamed dashboard.js so it matches name of stylesheet. Update background wrapper to consume 100% of window, while the area that contains the widgets maxes out at 1200px"
**Scope:** ~15 lines of new/changed SCSS, ~5 lines changed in JSX, import path updates across 4 files
**Notes:** `.dashboard` div is now the full-viewport background wrapper (carries background-image inline styles); `.dashboard-content` is a new inner div with `max-width: 1200px` and `margin: 0 auto`

---

## 2026-03-05 — Built-in inspirational quote pool for Inspiration widget

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/quotes-data.js` (created — 100 curated quotes + `getRandomQuotes` helper)
- `lib/dashboard/quotes.js` (modified — use local pool by default; LLM only when plan content present)
- `lib/data-service.js` (modified — no-API-key fallback now draws from local pool)

**Task:** Add 100 built-in inspirational quotes covering "getting things done", "taking a first step", and "treating today as a new opportunity"; widget randomly selects 2 each render without any network call unless plan content is available for LLM personalisation.
**Prompt summary:** "add a set of 100 inspirational quotes randomly picked for the Inspiration component"
**Scope:** ~120 lines of new logic + small modifications across 2 existing files
**Notes:** LLM path is still used when `planContent` is provided (personalized quotes tied to goals); on LLM failure the widget gracefully falls back to the local pool.

---

## 2026-03-05 — Seeded randomness and reseed action for Recent Notes widget

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/recent-notes.js` (modified — added PRNG helpers, buildSeed, seed-based skipping in findStaleTaskNotes, reseedCount state, reseed button in header)
- `lib/dashboard/styles/_widget-wrapper.scss` (modified — added `widget-header-action` selector alongside `widget-configure`)

**Task:** Add a "↻ Reseed" button to the Recent Notes widget header that changes the seed on click (also changes daily), causing the note selection to vary deterministically via a seeded PRNG that randomly skips up to 5 qualifying notes per pass
**Prompt summary:** "component should have a link in the top bar to reseed; seed changes daily or on reseed click; skip up to 5 notes; fall back to skipped notes if not enough found"
**Scope:** ~50 lines of new logic across 2 files
**Notes:** Uses FNV-1a hash + mulberry32 PRNG; skipped notes are kept as a fallback pool so the widget never shows fewer than MIN_NOTES entries

---

## 2026-03-05 — Fix mood overlay showing data for future dates

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/victory-value.js` (modified — `drawMoodOverlay`, `getHoveredDayMood`)

**Task:** Prevent mood rating data from being rendered on the chart or shown in tooltips for dates that have not yet occurred
**Prompt summary:** "showing mood rating data for dates that have not yet occurred"
**Scope:** ~15 lines changed across 2 functions
**Notes:** Both the canvas overlay and the hover tooltip now compare each day's date against end-of-today before rendering mood; the line segment also uses a `lineStarted` flag so it begins from the first non-future point rather than assuming index 0

---

## 2026-03-04 — Replace AI Plugins widget with Recent Notes widget

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/recent-notes.js` (replaced — new RecentNotesWidget component)
- `lib/plugin.js` (modified — added `getTaskDomains` and `getNoteTasks` onEmbedCall cases)
- `lib/dashboard/app.js` (modified — renamed AIPluginsCell → RecentNotesCell, updated import)
- `lib/constants/settings.js` (modified — updated WIDGET_REGISTRY entry name/description/icon)

**Task:** Replace the AI & Plugins widget with a "Recent Notes" widget that lists 3–5 notes containing open tasks where no task has a startAt timestamp newer than one week ago
**Prompt summary:** "replace AI & Plugins widget with Recent Notes showing notes whose tasks have gone stale"
**Scope:** ~100 lines new logic in recent-notes.js; ~15 lines modified across 3 other files
**Notes:** Widget self-fetches on mount via callPlugin; iterates task domains to gather all note handles, checks open tasks per note, filters by latestTaskTimestamp < one week ago; clicking a note navigates to it via navigateToNote

---

## 2026-03-01 — Memoized widget cells to prevent unnecessary re-renders

**Model:** claude-4.6-opus-high-thinking
**Files modified:**
- `lib/dashboard/app.js` (modified — replaced renderActiveComponents with 8 module-level memo'd cell components; added useMemo for agendaTasks and activeComponents)

**Task:** Replace the monolithic renderActiveComponents function with individually memoized cell components so only widgets whose data actually changed re-render
**Prompt summary:** "re-render only components whose data changed; explicitly split props by component"
**Scope:** ~120 lines added (8 memo components + gridCellStyle), ~90 lines removed (renderActiveComponents)
**Notes:** Each *Cell component receives only the props it needs. PlanningCell/MoodCell/AIPluginsCell/QuickActionsCell now skip re-renders when tasks or completed data changes. AgendaCell skips re-renders when completedTasksByDate or moodRatings change. All widget cells skip re-renders when focusState changes (opening popups).

---

## 2026-03-01 — Reduce redundant re-renders during initialization

**Model:** claude-4.6-opus-high-thinking
**Files modified:**
- `lib/dashboard/app.js` (modified — skip redundant mood refetch on initial mount)
- `lib/hooks/use-completed-tasks.js` (modified — convert loading/error from useState to useRef)

**Task:** Eliminate 2 unnecessary React re-renders during the init→fetch cascade
**Prompt summary:** "app re-renders 4 times on load; reduce cascading state updates"
**Scope:** ~15 lines changed across 2 files
**Notes:** Init already provides mood ratings, so the cascading useEffect no longer re-fetches them on first mount. The useCompletedTasks hook's loading/error states were triggering intermediate renders despite not being consumed by the render tree — converted to refs and exposed via getters for API compatibility.

---

## 2026-03-01 — Dashboard background image upload

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/constants/settings.js` (modified — added BACKGROUND_IMAGE_URL, BACKGROUND_IMAGE_MODE setting keys and BACKGROUND_MODE_OPTIONS array)
- `lib/dashboard/dashboard-settings-popup.js` (modified — added background image drag-and-drop upload, display mode selector, and remove image link with confirmation)
- `lib/dashboard/app.js` (modified — pass background settings to popup, apply background image inline styles to dashboard div, persist background mode on save)
- `lib/plugin.js` (modified — added uploadBackgroundImage, removeBackgroundImage, and saveBackgroundMode onEmbedCall actions)
- `lib/dashboard/styles/_dashboard-settings-popup.scss` (modified — added dropzone, preview, and remove-image styles)
- `dev/mock-data.js` (modified — added uploadBackgroundImage, removeBackgroundImage, and saveBackgroundMode mock actions)
- `dev/dev-server.js` (modified — added /api/attach-media endpoint that saves uploaded images to dev directory)
- `dev/dev-app.js` (modified — added context.pluginUUID mock and attachNoteMedia method that writes image files locally)

**Task:** Add background image upload to Dashboard Settings with display mode selector and remove option
**Prompt summary:** "add background image upload option to DashboardSettings using app.attachNoteMedia with pluginUUID, display mode selector, remove link, and dev harness mocks"
**Scope:** ~170 lines of new logic across 8 files
**Notes:** Uses app.context.pluginUUID to get the plugin note UUID, then app.attachNoteMedia to upload the image. Background mode supports cover, contain, repeat, repeat-x, repeat-y, and no-repeat. Dev harness writes uploaded images to the dev/ directory as background-image.{ext}.

---

## 2026-03-01 — Victory Value week navigation arrows

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/victory-value.js` (modified — added `shiftWeekDate` and `isCurrentWeekOrLater` helpers; imported `weekStartFromDateInput`; added `onReferenceDateChange` prop; restructured `vv-chart-container` to flex with `‹`/`›` arrow buttons flanking a new `vv-chart-wrap` div)
- `lib/dashboard/styles/_victory-value.scss` (modified — updated `.vv-chart-container` to `display: flex`; added `.vv-chart-wrap` and `.vv-nav-arrow` styles)
- `lib/dashboard/app.js` (modified — pass `onReferenceDateChange: options.onDateSelect` to `VictoryValueWidget`)

**Task:** Add left arrow to navigate to the previous week and a right arrow (disabled when already on the current week) to advance the selected date by one week in the Victory Value chart
**Prompt summary:** "add left arrow to choose the selected date minus one week; right arrow disabled unless currently selected date is earlier than the current week"
**Scope:** ~30 lines of new logic across 3 files
**Notes:** Arrows reuse the existing `onDateSelect` / `selectedDate` flow in `app.js`; right arrow disabled when `weekStart(referenceDate) >= weekStart(today)`

---

## 2026-03-01 — Victory Value date range header and month/day bar labels

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/victory-value.js` (modified — added `formatWeekDateRange` helper; pass `headerActions` with date range span to `WidgetWrapper`; updated `drawBars` to render month/day label beneath each day-of-week abbreviation on the canvas; added `dateFromDateInput` import)
- `lib/dashboard/styles/_victory-value.scss` (modified — added `.vv-date-range` style)

**Task:** Show the week date range in a lighter shade after the "Victory Value" title, and render a short-month + day-of-month label beneath each day-of-week abbreviation on the chart canvas
**Prompt summary:** "print the date range shown in a lighter shade after the Victory Value title; underneath each day-of-week label, print [short month] [day of month]"
**Scope:** ~15 lines of new logic across 2 files
**Notes:** Date range (e.g. "Feb 23 – Mar 1") is passed via `headerActions` to `WidgetWrapper` and styled with `$color-text-secondary`; month/day labels (e.g. "Feb 24") are drawn at `ht - 3` in the canvas, with the day name shifted up to `ht - 15` to make room

---

## 2026-03-01 — Refetch mood ratings when calendar date changes

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/app.js` (modified — added `fetchMoodRatings` callback and wired it into the `selectedDate`/`currentDate` effect)
- `dev/mock-data.js` (modified — added `getMoodRatings` case to mock `callPlugin`)

**Task:** Ensure VictoryValue and Mood widgets receive fresh mood ratings whenever the user clicks a new week in the calendar
**Prompt summary:** "Ensure that when calendar click changes date, that new mood ratings are retrieved for the week that is now being shown in the VictoryValue component and the Mood component"
**Scope:** ~20 lines of new logic across 2 files
**Notes:** `fetchMoodRatings` computes the selected week's Mon/Sun Unix-second boundaries and calls `callPlugin('getMoodRatings', from, to)`, then updates `moodRatings` state so both VictoryValue (indexed 0–6) and Mood (`slice(-7)`) always display the correct week's data. The dev mock returns 7 deterministic ratings seeded from the week-start timestamp.

---

## 2026-03-01 — Consolidate dev task data: dev-app.js as single source of truth

**Model:** claude-sonnet-4-6
**Files modified:**
- `dev/dev-server.js` (modified — added `handleTasksApi` and `/api/tasks` route)
- `dev/mock-data.js` (modified — removed all hardcoded/generated task helpers; replaced with `/api/tasks` fetches)

**Task:** Eliminate duplicated task data between `dev-app.js` and `mock-data.js` by exposing a `/api/tasks` REST endpoint from the dev server and having the browser-side mock fetch from it
**Prompt summary:** "consolidate mock-data.js and dev-app.js so dev-app is the single source of task truth"
**Scope:** ~80 lines removed from `mock-data.js`, ~30 lines added; ~30 lines added to `dev-server.js`
**Notes:** `/api/tasks` accepts optional `?from=X&to=Y` unix-second query params for per-day completed-task filtering; derived values (weeklyVictoryValue, dailyVictoryValues, etc.) are now computed from the live task set rather than random generators

---

## 2026-03-01 — Fix missing getCompletedTasks handler in mock-data.js

**Model:** claude-sonnet-4-6
**Files modified:**
- `dev/mock-data.js` (modified — added `case "getCompletedTasks"` handler and `_getCompletedTasksInRange` helper)

**Task:** VictoryValue widget showed no completed tasks because `callPlugin('getCompletedTasks')` fell through to the default no-op case in the browser-side mock
**Prompt summary:** "no completed tasks shown in Victory Value component"
**Scope:** ~30 lines added to `mock-data.js`
**Notes:** `_getCompletedTasksInRange` mirrors the same completed task set as `dev-app.js` and filters by the unix-second `from`/`to` window that `use-completed-tasks` passes per day

---

## 2026-03-01 — Update dev sample tasks with completed history and new open tasks

**Model:** claude-opus-4-6
**Files modified:**
- `dev/dev-app.js` (modified — rewrote `_buildSampleTasks`)

**Task:** Mark existing 10 sample tasks as completed at varying dates over the past 2 weeks; add 20 new open tasks (~half unscheduled, ~half with start times in the next 5 days)
**Prompt summary:** "existing tasks completed over past 2 weeks, plus 20 new tasks with/without start times"
**Scope:** ~140 lines rewritten in `_buildSampleTasks`
**Notes:** All existing tests continue to pass unchanged

---

## 2026-03-01 — Live reload for dev server

**Model:** claude-opus-4-6
**Files created/modified:**
- `dev/dev-server.js` (modified — added SSE live-reload infrastructure, SCSS file watcher, extracted compileSCSS helper)
- `dev/index.html` (modified — added inline EventSource client script for live reload)

**Task:** Add hot reloading to the dev server so the browser auto-refreshes on code changes
**Prompt summary:** "set up the dev version of the project to use hot reloading"
**Scope:** ~60 lines of new logic across 2 files
**Notes:** Uses Server-Sent Events (SSE) on `/esbuild-live-reload`. JS changes trigger a full page reload; SCSS-only changes hot-swap the stylesheet without a full reload. SCSS files are watched separately via `fs.watch` since they aren't part of the esbuild dependency graph.

---

## 2026-03-01 — Dev-mode persistent settings harness and sample task data

**Model:** claude-opus-4-6
**Files created/modified:**
- `dev/dev-app.js` (created) — Node.js module: createDevApp factory backed by JSON file for settings persistence, sample tasks for getTaskDomainTasks
- `dev/dev-server.js` (modified) — Added HTTP proxy with `/api/settings` GET/POST endpoints for browser-side persistence
- `dev/mock-data.js` (modified) — Wired init/saveSetting/saveLayout to persist via `/api/settings` API
- `.gitignore` (modified) — Added `/dev/settings.json`
- `test/dev-app.test.js` (created) — 10 tests covering settings persistence across instantiations, sample task shape, and domain retrieval

**Task:** Make `npm run dev` persist plugin settings to a local JSON file, emulating the Amplenote `app.settings` / `app.setSetting` interface
**Prompt summary:** "set up dev environment to persist state via JSON file, return sample tasks for getTaskDomainTasks, test setSetting persistence"
**Scope:** ~300 lines of new logic across 5 files
**Notes:** Settings stored in `dev/settings.json` (gitignored). Dev server proxies esbuild on port 3001 and serves on port 3000 with custom API routes.

---

## 2026-03-01 — Dashboard Settings popup with LLM provider and API key

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/dashboard-settings-popup.js` (created)
- `lib/dashboard/styles/_dashboard-settings-popup.scss` (created)
- `lib/dashboard/config-popup.js` (modified — added optional `submitLabel` prop)
- `lib/dashboard/app.js` (modified — added `showSettingsConfig` state, `handleSettingsSave` callback, Settings toolbar button, `DashboardSettingsPopup` render)
- `lib/dashboard/styles/dashboard.scss` (modified — added `@use 'dashboard-settings-popup'`)

**Task:** Add a "Dashboard Settings" popup accessible from the toolbar, featuring an AI Settings section with an LLM provider dropdown and an API key input with show/hide toggle. Selections are persisted to `app.settings` via `SETTING_KEYS.LLM_PROVIDER` and `SETTING_KEYS.LLM_API_KEY` and pre-populated on subsequent visits.
**Prompt summary:** "create a dashboard settings popup linked next to the Layout button, with LLM provider dropdown and API key input persisted to app.settings"
**Scope:** ~120 lines of new logic across 5 files
**Notes:** `DashboardSettingsPopup` uses the shared `ConfigPopup` component as its modal frame (DRY with the widget config popups). The five provider options are: OpenAI ChatGPT (Default), Anthropic Claude, Anthropic Sonnet, Google Gemini, Grok. `anthropic-sonnet` reuses the Anthropic API key URL since it is a model variant rather than a separate provider.

---

## 2026-03-01 — Fix mood overlay defaulting to hidden in VictoryValue widget

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/victory-value.js` (modified — added `parseShowMoodSetting` helper; defaulted `showMood` to `true` when no saved config exists; applied same helper in `handleConfigCancel`)

**Task:** Ensure the daily mood line and dots are visible in the VictoryValue chart by default
**Prompt summary:** "ensure that the daily mood line + dot is visible in VictoryValue component"
**Scope:** ~8 lines changed across 1 file
**Notes:** The root cause was `useState(currentConfig[1] === 'true' || ...)` evaluating to `false` when no config is saved (since `undefined === 'true'` is `false`). A new `parseShowMoodSetting(value)` helper treats a missing/null value as `true` (on by default), while still respecting an explicitly saved `'false'`.

---

## 2026-03-01 — Add descriptions to WIDGET_REGISTRY for DashboardConfig drag list

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/constants/settings.js` (modified — added `description` field to each WIDGET_REGISTRY entry)
- `lib/dashboard/dashboard-config-popup.js` (modified — `renderItem` wraps name + description in an info column)
- `lib/dashboard/styles/_dashboard-config-popup.scss` (modified — added `.dashboard-config-item-info` and `.dashboard-config-item-description` styles)

**Task:** Show a one-line description for each widget in the DashboardConfig popup drag list
**Prompt summary:** "Update WIDGET_REGISTRY to include a one line description for each component that is shown in the DashboardConfig list when dragging the components"
**Scope:** ~20 lines changed across 3 files
**Notes:** Description text is truncated with ellipsis when the popup is narrow; the info wrapper takes `flex: 1` so the actions column stays right-aligned

---

## 2026-03-01 — Consolidate DEFAULT_DASHBOARD_COMPONENTS into WIDGET_REGISTRY

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/constants/settings.js` (modified — added `defaultGridWidthSize` to each `WIDGET_REGISTRY` entry; replaced hardcoded `DEFAULT_DASHBOARD_COMPONENTS` with a derived version mapped from the registry)
- `lib/dashboard/dashboard-config-popup.js` (modified — added `hasReset` state to `useLayoutState`; `onReset` now sets the flag; Save button passes `{ isReset }` to `onSave`)
- `lib/dashboard/app.js` (modified — `handleLayoutSave` accepts `{ isReset }` option; when `isReset` is true, per-widget sizes are taken from `WIDGET_REGISTRY.defaultGridWidthSize` instead of the existing saved layout)

**Task:** Remove the duplicate size data in `DEFAULT_DASHBOARD_COMPONENTS` by adding `defaultGridWidthSize` to `WIDGET_REGISTRY` and deriving the default layout from it; ensure "Reset to defaults" also restores default widget sizes
**Prompt summary:** "consolidate DEFAULT_DASHBOARD_COMPONENTS and WIDGET_REGISTRY by incorporating the default horizontal tile size for each widget into WIDGET_REGISTRY, and using that default widget size when the user resets their dashboard"
**Scope:** ~20 lines changed across 3 files
**Notes:** `DEFAULT_DASHBOARD_COMPONENTS` is kept as a derived export for backwards-compatible use in `data-service.js` and `renderActiveComponents`

---

## 2026-02-28 — Rename date utility API to *From* style

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/util/date-utility.js` (modified) — Renamed helper exports from `fromDate*` to `<returnValue>FromDateInput` naming and updated examples/docs
- `lib/hooks/use-completed-tasks.js` (modified) — Updated import/use of week boundaries helper
- `lib/dashboard/victory-value.js` (modified) — Updated import/use of date key, tooltip label, and week slot helpers
- `lib/data-service.js` (modified) — Updated import/use of week start/end helpers
- `test/app.test.js` (modified) — Updated test helper imports to renamed date utility functions
- `AI_CONTRIBUTIONS.md` (modified) — Added authorship log for this rename

**Task:** Align date utility naming with convention “what is returned from what input” instead of starting names with `from`
**Prompt summary:** "The function convention is not to begin methods with 'from', but rather describe what is returned from what arguments are provided"
**Scope:** ~35 lines of API rename and callsite updates across 5 code files + tests
**Notes:** Function behavior is unchanged; this is a naming convention alignment only

---

## 2026-02-28 — Consolidate shared date helpers

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/util/date-utility.js` (created) — Centralized date parsing, key formatting, week start/end, week boundaries, week date slots, and tooltip date label helpers
- `lib/hooks/use-completed-tasks.js` (modified) — Replaced local week boundary logic with shared `date-utility` helper imports
- `lib/dashboard/victory-value.js` (modified) — Replaced local date key/slot/tooltip format logic with shared `date-utility` helper imports
- `lib/data-service.js` (modified) — Replaced local week start/end helpers with shared `date-utility` imports
- `test/app.test.js` (modified) — Reused shared week-start/date-key helpers in calendar propagation test helper
- `AI_CONTRIBUTIONS.md` (modified) — Added authorship log for this consolidation

**Task:** Consolidate repeated date-interpreting logic into a shared utility module and standardize function names on `from*`
**Prompt summary:** "Consolidate all date functions into lib/util/date-utility.js, ensuring each uses from instead of to in function names"
**Scope:** ~110 lines of shared utility and callsite refactors across 5 code files + tests
**Notes:** New helper names avoid `to*` prefixes and consistently use Monday-based week semantics used by existing dashboard flows

---

## 2026-02-28 — Calendar-driven VictoryValue week selection

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/app.js` (modified) — Propagates calendar `selectedDate` into VictoryValue reference date and week-based completed-task refreshes
- `lib/hooks/use-completed-tasks.js` (modified) — Fetches completed tasks for Monday-Sunday week of a reference date and skips redundant same-week/domain fetches
- `lib/dashboard/victory-value.js` (modified) — Builds chart day slots from selected reference week and maps completed tasks to those dates
- `test/app.test.js` (modified) — Updates week-fetch expectation and adds integration test asserting calendar click triggers week refetch

**Task:** Ensure calendar date clicks control which week VictoryValue renders and fetches completed tasks for
**Prompt summary:** "When the user clicks a date on the calendar, propagate that date to VictoryValue and refetch completed tasks for that week when week start changes"
**Scope:** ~120 lines of logic and tests across 4 files
**Notes:** Uses Monday as week start consistently in both data fetch and VictoryValue chart date slots

---

## 2026-02-28 — Recompute Victory Value chart from completed tasks

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/victory-value.js` (modified) — Added derived daily chart values from `completedTasksByDate` and switched chart/tooltip/total to use them
- `AI_CONTRIBUTIONS.md` (modified) — Added authorship log for this fix

**Task:** Fix Victory Value chart staying blank despite completed tasks being fetched
**Prompt summary:** "VictoryValue widget is receiving completedTasksByDate but never renders graph"
**Scope:** ~25 lines of new logic and prop flow updates in 1 widget file
**Notes:** The chart previously rendered from `dailyValues` only; it now derives rendered bars from `completedTasksByDate` keyed by each day in `dailyValues`, so the canvas updates when completed-task fetches complete.

---

## 2026-02-28 — DashboardApp component unit tests

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `test/app.test.js` (created)
- `test/stubs/client-bundle.js` (created — Jest stub for esbuild virtual module)
- `test/stubs/css-content.js` (created — Jest stub for esbuild virtual module)
- `jest.config.js` (modified — added `hooks/*`, bare widget name, and virtual module mappings)

**Task:** Write integration tests for the DashboardApp React component — real hooks, real widgets, app object mocked with sample tasks
**Prompt summary:** "mock the app object so hooks receive real sample task data, with dates relative to current date"
**Scope:** 18 test cases across 5 describe blocks; ~290 lines of new test logic; ~20 lines of config/stub changes
**Notes:** No module mocks at all — both hooks and all widgets run for real; a `SAMPLE_TASKS` const of 17 tasks (matching real Amplenote console output) drives `app.getTaskDomainTasks` and `app.getCompletedTasks` with all timestamps relative to `Date.now()`; `callPlugin` routes through the real `mockPlugin().onEmbedCall(mockApp, ...)` so the full plugin data path is exercised; two task domains enable a real domain-switch click test; canvas 2d context stubbed for jsdom; `client-bundle` / `css-content` esbuild virtual modules stubbed via jest.config moduleNameMapper

---

## 2026-02-28 — Inline one-line Victory Value helpers

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/victory-value.js` (modified) — Inlined one-line helper logic into call sites and removed tiny helper wrappers
- `AI_CONTRIBUTIONS.md` (modified) — Added authorship log for this refactor pass

**Task:** Inline as many one-line local functions as practical without changing behavior
**Prompt summary:** "Inline as many one-line local functions as possible"
**Scope:** ~30 lines changed in 1 widget file
**Notes:** Preserved larger extracted helpers and retained existing debug task logging behavior

---

## 2026-02-28 — Fix task start date epoch misinterpretation

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/hooks/use-domain-tasks.js` (modified — fixed `formatDateKey` to convert Unix seconds to milliseconds)

**Task:** Fix agenda widget grouping all tasks under January 1970 dates
**Prompt summary:** "tasks' start dates are not being properly interpreted — all showing 1970-01-20/21"
**Scope:** 3-line fix in `formatDateKey`
**Notes:** Task `startAt`/`deadline` values are Unix timestamps in seconds; `new Date(n)` treats numbers as milliseconds. Fix applies the conventional `< 1e10` heuristic to detect seconds vs milliseconds before constructing the Date.

---

## 2026-02-28 — Add useCompletedTasks hook for per-day completed task fetching

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/hooks/use-completed-tasks.js` (created)

**Task:** Fetch completed tasks for each of the past 7 days in parallel and group them by ISO date key for the VictoryValue component
**Prompt summary:** "add use-completed-tasks hook that fetches completed tasks in parallel for each of the past 7 days and groups them by date for VictoryValue"
**Scope:** ~120 lines across 1 new file
**Notes:** Calls `app.getCompletedTasks(from, to)` once per day (7 parallel calls via `Promise.all`). Day boundaries are computed as Unix timestamps in seconds. The resulting `{ 'YYYY-MM-DD': [task, ...] }` shape matches the `completedTasks` prop expected by `VictoryValueWidget`.

---

## 2026-02-28 — Fix getMoodRatings timestamp unit and extend range to two weeks

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/data-service.js` (modified — fixed timestamp unit passed to `getMoodRatings` and widened range to 14 days)

**Task:** Fix mood ratings returning empty results and extend query window to two weeks
**Prompt summary:** "Is our current mood rating lookup going to retrieve all ratings from the past two weeks? Currently it does not show any ratings"
**Scope:** ~5 lines changed in `fetchDashboardData` and `_safeMoodRatings`
**Notes:** `Date.getTime()` returns milliseconds; `getMoodRatings` expects Unix timestamps in seconds. The old code passed ms values ~1000× too large, causing the API to see future dates and return nothing. Also changed the window from "current week only" to "last 14 days → now" using `Math.floor(Date.now() / 1000)`.

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
- `lib/dashboard/recent-notes.js` (created) — AI & Plugins widget: action list with badge counts
- `lib/dashboard/quick-actions.js` (created) — Quick actions widget: 2x2 shortcut button grid

**Task:** Build the full Amplenote dashboard plugin with React widget components and data layer
**Prompt summary:** "build an Amplenote dashboard plugin with planning, victory value, mood, calendar, agenda, quotes, AI plugins, and quick action widgets"
**Scope:** ~700 lines of new logic across 14 files
**Notes:** Uses React createElement (no JSX), communicates with Amplenote via callPlugin/onEmbedCall bridge

---

STOP. Do not add summaries here. Add them to top of list.
