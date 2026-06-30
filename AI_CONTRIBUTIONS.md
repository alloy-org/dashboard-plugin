# AI Contributions Log

This file tracks all code authored or substantially modified by AI models in this
repository, FROM NEWEST TO OLDEST, per the standards defined in `CLAUDE.md`. 

## 2026-06-29 — Honor any provider's dev LLM token (Grok/Anthropic/Gemini), not just OpenAI

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `lib/constants/settings.js` (modified — added `DEV_ENV_TOKEN_VAR_NAMES`, `devTokenFromProvider` (reads each
  token via a literal `process.env.X` access so esbuild's `define` substitution applies in the browser bundle),
  `devTokenPresent`, and `devLlmOverride` (first-available-token resolution, preference order
  openai→anthropic→grok→gemini, dev-only))
- `lib/dream-task-service.js` (modified — `_buildLlmOptions` now uses `devLlmOverride` instead of an OpenAI-only
  `process.env.OPEN_AI_ACCESS_TOKEN` check gated on `dashboardBucket === "openai"`)
- `lib/dashboard/proposed-agenda-service.js` (modified — `_llmOptions` switched to the same `devLlmOverride`;
  dropped now-unused `IS_DEV_ENVIRONMENT` import)
- `lib/dashboard/dream-task.jsx` (modified — `hasLlmConfig` now derives from `devTokenPresent()` rather than an
  OpenAI-only env read, so the widget no longer short-circuits to the no-config state when only a Grok token is
  set; config-snapshot debug reports `hasDevToken` instead of `envApiKeyLength`)
- `lib/dashboard/no-config-upsell.jsx` (modified — replaced `href="javascript:void(0)"` with `href="#0"` on the
  Ample Agent Pro promo buttons, carrying forward the "Shush the javascript: notification" fix after the inline
  DreamTask NoConfigState was replaced by this shared component)
- `dev/dev-server.js` (modified — `define` block now injects all four provider dev tokens via `devTokenDefines()`,
  not just `OPEN_AI_ACCESS_TOKEN`)

**Task:** Suggestions never appeared in dev despite `GROK_AI_ACCESS_TOKEN` being set
**Prompt summary:** "dev environment isn't showing any suggested tasks from dream-task-service / proposed-agenda in spite of having GROK_AI_ACCESS_TOKEN present"
**Scope:** ~70 lines across 6 files
**Notes:** Three independent OpenAI-only assumptions all had to be fixed: (1) the dev server only compiled
`OPEN_AI_ACCESS_TOKEN` into the bundle — every other `process.env.X` resolved to undefined in the browser; (2)
both services' dev-token override only fired for the `openai` bucket; (3) DreamTask's `hasLlmConfig` gate read
only the OpenAI env token, so the widget bailed before calling the service. Tokens are read via literal env
accesses because esbuild's `define` only substitutes literal member expressions, not `process.env[dynamicKey]`.
Verified the Grok token now appears in a dev-mode bundle; `dream-task-service` and `proposed-agenda` tests pass.

## 2026-06-28 — Proposed Agenda provider recovery, persisted Priority/LLM, key-gated provider chooser

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `lib/constants/settings.js` (modified — added `SETTING_KEYS.PROPOSED_AGENDA_PRIORITY` and
  `SETTING_KEYS.PROPOSED_AGENDA_LLM` for persisting the widget's "Today's priority" and AI-provider choices; added
  `configuredProviderEms(settings)` which returns the provider buckets that currently hold a non-empty API key)
- `lib/dashboard/llm-provider.js` (modified — added `selectableProviderOptions({ allowKeyless, configuredProviderEms,
  currentProviderEm })`: returns all providers when an Ample Agent Pro fallback can run any provider, otherwise only
  providers with a configured key plus the current one, falling back to the full list so the chooser is never empty)
- `lib/dashboard/llm-provider-selector.jsx` (modified — accepts `allowKeylessProviders` + `configuredProviderEms`,
  renders only `selectableProviderOptions`, and keeps the initial radio selection within the visible set)
- `lib/dashboard/proposed-agenda.jsx` (modified — (1) Recovery: `runGeneration` now depends on `providerApiKey` and a
  new effect adopts the dashboard-configured provider when the user has made no in-widget choice, so configuring an
  AI provider in Dashboard Settings re-triggers generation instead of staying stuck on "No AI provider configured".
  (2) Persistence: seeds the initial priority/provider from `SETTING_KEYS.PROPOSED_AGENDA_PRIORITY`/`_LLM` and writes
  them back via `app.setSetting` + `updatePluginSetting` on change. (3) Detects Ample Agent Pro via `findNote` and
  passes `allowKeylessProviders`/`configuredProviderEms` to the chooser)
- `lib/dashboard/dream-task.jsx` (modified — detects Ample Agent Pro and passes `allowKeylessProviders` +
  `configuredProviderEms` to its reseed provider chooser, so keyless providers are hidden unless a fallback exists)
- `test/dashboard-llm-provider-mapping.test.js` (modified — added `configuredProviderEms` tests: trims
  whitespace-only keys, lists only keyed providers, tolerant of empty/undefined settings)
- `test/llm-provider.test.js` (modified — added `selectableProviderOptions` tests: key-gated filtering with the
  current provider preserved, allow-all under Agent Pro, and empty-config fallback to the full list)

**Design notes:**
- The "No AI provider configured" stickiness was a stale-state bug: the widget's generation effect never re-ran when
  a key was added (DreamTask recovers via its `hasLlmConfig` effect; Proposed Agenda had no equivalent). Fixed by
  re-running on `providerApiKey` change and syncing the in-widget provider to the dashboard provider prop.
- Keyless providers stay visible only when Ample Agent Pro is installed, because that fallback accepts any provider
  as an argument; otherwise picking a keyless provider would simply fail, so those options are hidden.

## 2026-06-28 — Proposed Agenda monthly record + LLM-call cache

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `lib/dashboard/proposed-agenda-archive.js` (created — persists a per-date, per-priority, per-LLM record of what
  the widget recommended into a monthly archived note "[Month] [Year] Dashboard Proposed Tasks" tagged
  `plugins/dashboard` (same find-before-create + `{ archive: true }` pattern as graveyard/recent-notes). Each
  record carries `dateKey`/`priorityKey`/`providerEm` plus a `proposedTasks` array; every entry records its
  `taskUuid`, lifecycle `scheduledEm` (pending/scheduled/dismissed), and `time`, alongside the fields needed to
  re-render the activity from cache. Serializes via a fenced JSON block like recent-notes-service. Exposes
  `loadCachedProposedAgenda`, `storeProposedAgenda` (replaces any existing record for the coordinate),
  `updateProposedTaskStatuses`, plus `proposedAgendaNoteNameFromDate`/`proposedTaskKey`)
- `lib/dashboard/proposed-agenda-service.js` (modified — `generateProposedAgenda` now resolves the concrete
  provider enum, checks the monthly note for an existing date+priority+LLM record BEFORE doing any task selection
  or LLM call (returning the cached activities + restored scheduled/dismissed keys), and stores/replaces the
  record after a fresh generation. Added `forceRegenerate` (Reseed) to bypass the cache and `_resolveProviderEm`)
- `lib/dashboard/proposed-agenda-llm-generator.js` (modified — threads `forceRegenerate`, restores cached
  scheduled/dismissed key sets and the resolved provider into widget state, and persists status changes back onto
  the record via a new `recordProposedTaskStatus` helper used by schedule/approve/dismiss flows)
- `lib/dashboard/proposed-agenda.jsx` (modified — Reseed now force-regenerates (replacing today's saved set);
  tracks the resolved record provider and builds a `recordCoord` so schedule/dismiss/dismiss-all/approve write the
  `scheduledEm` status back to the right record)
- `test/proposed-agenda-archive.test.js` (created — monthly note naming, store→load round trip, cache misses on a
  different date/priority/LLM, record replacement (no duplication) on re-store, distinct records per
  priority/LLM, status persistence, and an end-to-end `generateProposedAgenda` test proving an identical request
  is served from the note with no second LLM call while Reseed forces regeneration and replaces the record)

**Task:** Keep a per-date/priority/LLM record of proposed tasks in a monthly archived note and use it to avoid
duplicate LLM calls; Reseed replaces the entry. Test the regeneration case.
**Prompt summary:** "create a per-date, per-priority, per-LLM record of what tasks were recommended ... Before
calling to an LLM, check if the LLM+date+priority already exists within our data note ... Reseed ... replace the
entry ... test the case where proposed tasks are regenerated"
**Scope:** ~210 lines new archive module + ~50 lines of service/generator/widget wiring + ~190 lines of tests
**Notes:** The persisted entry extends the requested `[task uuid, scheduledEm, time]` tuple to a named-key object
so a cached agenda (including LLM-proposed supporting activities that have no task UUID) can be re-rendered without
the LLM. Cache lookup/store are `.catch`-wrapped so a note failure degrades to a normal LLM generation. Full
suite: no new regressions (the 6 failing day-sketch/graveyard/call-plugin tests pre-date this work).

## 2026-06-27 — Proposed Agenda real-LLM integration tests + gap enforcement

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `test/proposed-agenda-integration.test.js` (created — drives the real `generateProposedAgenda` service against
  the live OpenAI API, gated behind `OPEN_AI_ACCESS_TOKEN` via `itIfKey` (skips when absent, like
  `llm-integration.test.js`); stubs only the note/task surface so the actual prompt, real LLM call, and the
  service's validation are exercised. Asserts the response is usable: parseable HH:MM start times, in-range
  startMinutes, non-empty titles, taskUuids that are null or real fixture UUIDs, chronological ordering with a
  >=60min gap between activities, and that existing activities expose the owning note UUID from the candidate task)
- `lib/dashboard/proposed-agenda-service.js` (modified — added an optional `aiModelOverride` option threaded through
  `generateProposedAgenda` → `_generateScheduleFromLlm` → `_llmOptions` (a testing seam so the integration test can
  pin the cheap `gpt-4o-mini` model, since model strings are sent verbatim); added `_enforceGap` so the >=1hr
  inter-activity gap is guaranteed in output rather than merely requested in the prompt)

**Task:** Add tests that actually call the LLM and confirm the proposed schedule is usable
**Prompt summary:** "needs tests that actually call LLM to confirm usable response"
**Scope:** ~110 lines of new test logic plus ~25 lines of service changes (model override + gap enforcement)
**Notes:** Verified the assertion body and gap enforcement with a temporary mocked-transport test (since no live key
is present locally) — a deliberately 30-min-apart pair was correctly pushed to a full >=1hr gap; that scratch test
was removed after confirming. Full suite: no new regressions (the 6 failing day-sketch/graveyard/call-plugin tests
pre-date this work).

## 2026-06-27 — Proposed Agenda widget (LLM hour-by-hour schedule)

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `lib/dashboard/proposed-agenda-service.js` (created — retrieves the active task domain following the volume rules
  (>=200 most-recent open tasks, or all tasks in notes updated in the past month, capped at 1,000), shapes compact
  `{ duration, important, noteUuid, taskText, taskUuid }` records, loads the current quarter's plan note, and prompts
  the configured LLM (with Ample Agent Pro fallback) for an hour-by-hour schedule that leaves >=1hr between activities;
  also exports `scheduleProposedActivity` / `approveProposedAgenda` to persist startAt via updateTask/insertTask)
- `lib/dashboard/proposed-agenda.jsx` (created — widget rendering each proposed activity with a "Schedule HH:MM" link
  and a bottom "Approve schedule" button, plus loading/error/reseed states and LLM attribution)
- `lib/dashboard/styles/proposed-agenda.scss` (created — activity-row, schedule-link, and approve-button styles)
- `lib/constants/settings.js` (modified — added the `proposed-agenda` entry to WIDGET_REGISTRY)
- `lib/dashboard/dashboard.jsx` (modified — imported the widget, added ProposedAgendaCell, registered in CELL_COMPONENTS)

**Task:** Add a Proposed Agenda widget that turns recent tasks + the quarterly plan into an approvable schedule
**Prompt summary:** "create proposed-agenda; retrieve recent task-domain tasks, submit with the quarterly plan to an
LLM for an hour-by-hour schedule with >=1hr gaps; per-activity schedule link + a bottom approve button"
**Scope:** ~430 lines of new logic across 3 new files, plus 2 registration edits
**Notes:** Mirrors dream-task-service's domain/LLM-option resolution; the service falls back gracefully when no
default note is available for newly-invented (non-existing) activities. Build passes; no new test regressions.

## 2026-06-27 — Shared Notes collaborators via app.getPeople (avatars)

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `lib/shared-notes-service.js` (modified — replaced the scaffolded `collaboratorNamesFromNoteHandle` retrieval with real `app.getPeople()` support: added `buildPeopleIndexByNote`, `fetchPeopleIndexByNote`, `avatarTextFromName`, and `collaboratorsForNote`; `findCollaboratorUpdatedNotes` now fetches the people index concurrently with filterNotes and attaches `{ name, avatar }` collaborators per note)
- `lib/dashboard/shared-notes.jsx` (modified — added a `CollaboratorAvatar` component and an avatar stack on the meta line; renders `avatar.image` as an `<img>`, otherwise `avatar.text`/initials as a badge)
- `lib/dashboard/styles/shared-notes.scss` (modified — added `.shared-note-avatars` / `.collaborator-avatar` overlapping-circle styling)
- `lib/util/dev-sample-notes.js` (modified — added `SAMPLE_PEOPLE` fixture whose `sharing.notes` reference the shared sample notes, mixing image and text avatars)
- `lib/util/browser-dev-app.js` & `dev/dev-app.js` (modified — added `getPeople()` shims returning `SAMPLE_PEOPLE`)
- `test/shared-notes-service.test.js` (modified — tests for the index builder, fetch helper, initials, fallback, and getPeople-derived collaborators)
- `test/shared-notes-widget.test.js` (modified — test asserting image vs. text avatar rendering)

**Task:** Now that `app.getPeople()` is documented, build a noteUUID => person index from each person's `sharing.notes` and use the person's `avatar` ({ image } or { text }) to render collaborator avatars in the Shared Notes widget.
**Prompt summary:** "there is now documentation: app.getPeople. We need to build and store an index of notesUUID => person, and use the person to show their avatar when present"
**Scope:** ~120 lines of new service/widget logic + ~40 lines SCSS + dev fixtures and tests
**Notes:** Degrades gracefully — hosts without `getPeople` (or that throw) yield an empty index and fall back to the dev-fixture `shareAccess` names. All shared-notes tests pass; build is clean. Pre-existing failures in call-plugin-fallback/graveyard-widget/day-sketch are unrelated.

## 2026-06-26 — DreamTask no-config promo redesign (Ample Agent Pro marketing card)

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `lib/dashboard/dream-task.jsx` (modified — rewrote `NoConfigState` as a marketing card; removed the `CopyLink` import and its usage; `NoConfigState` now takes no props)
- `lib/dashboard/styles/dream-task.scss` (modified — replaced `.dream-task-no-config-text` styling with `.dream-task-promo-*` badge/headline/feature-pill/button styles)

**Task:** Match the supplied design for the DreamTask no-config state — brand + price badges, "Unlock 21 AI features" headline, a 2-column feature-pill grid, "+ 15 more features included", a divider, two CTA buttons, and a "no API key required" footnote. Both CTAs are plain `<a>` links straight to `/plugins/ample_agent_pro` (CopyLink no longer needed).
**Prompt summary:** "Update NoConfigStat to match this design. We no longer need CopyLink, we can just use a standard link to connect straight to /plugins/ample_agent_pro"
**Scope:** ~45 lines of new component markup + ~120 lines of SCSS
**Notes:** Feature pills collapse to a single column below the large-phone breakpoint. `.dream-task-settings-link` retained since `ErrorState` still uses it. All 22 dream-task tests pass; build is clean.

## 2026-06-26 — Shared Notes widget (collaborator-updated notes)

**Model:** claude-opus-4-8[1m]
**Files created/modified:**
- `lib/shared-notes-service.js` (created — filterNotes query + timestamp/collaborator/label helpers)
- `lib/dashboard/shared-notes.jsx` (created — widget component with a "Has tasks" checkbox)
- `lib/dashboard/styles/shared-notes.scss` (created — two-line note row layout)
- `test/shared-notes-service.test.js` (created — service + helper unit tests)
- `test/shared-notes-widget.test.js` (created — widget render + toggle interaction tests)
- `lib/constants/settings.js` (modified — added `shared-notes` to `WIDGET_REGISTRY`, default 2-wide)
- `lib/dashboard/dashboard.jsx` (modified — import, `SharedNotesCell` factory, `CELL_COMPONENTS` entry)
- `lib/dashboard/layout-profiles.js` (modified — added `shared-notes` to the Day-to-Day profile; the Goal-Oriented profile picks it up automatically via `goalOrientedWidgets()`)

**Task:** Show which notes were recently updated by collaborators. Uses `app.filterNotes` with group `"shared"` (and optionally `"hasTasks"` via a checkbox), filtered by the active task domain and ordered by `"updated"`, keeping noteHandles whose `updated` timestamp is greater than `changed` (i.e. another collaborator edited after the current user). Shows up to 5 notes when 1 cell tall, 10 when 2 tall.
**Prompt summary:** "build a new component to show which notes have been recently updated by collaborators (dashboard/shared-notes), 2 wide by 1 tall, with a checkbox to limit to notes with tasks"
**Scope:** ~270 lines of new logic/markup across 3 source files + 2 test files, plus 3 registration touch-points
**Notes:** Component file uses the `.jsx` extension (per project convention for widgets) rather than the `.js` named in the prompt. The documented Amplenote `noteHandle` exposes only a boolean `shared` flag and no recipient list, so `collaboratorNamesFromNoteHandle` defensively reads any richer sharing fields a host may attach (`shareAccess`/`sharedWith`/`collaborators`/`people`/`shareRecipients`) and the widget falls back to a generic "Shared with collaborators" label when none are present. The "Has tasks" checkbox is local component state (not persisted across reloads).

## 2026-05-27 — Migrate component rendering from createElement to JSX

**Model:** claude-4.7-opus
**Files created/modified:**
- `esbuild.js` (modified — added `jsx: 'automatic'`, `jsxImportSource: 'react'`, and `loader: { '.jsx': 'jsx' }` to both the client and plugin build configs; updated client entry to `dashboard-load.jsx`)
- `dev/dev-server.js` (modified — same JSX config and entry update for the watch context)
- `lib-imports-plugin.js` (modified — extensionless imports now try `.jsx` before `.js`)
- `jest.config.js` (modified — added `@swc/jest` transformer with automatic JSX runtime, `module.type: 'es6'`, and `extensionsToTreatAsEsm: ['.jsx']` so .jsx lib files load as ESM during tests)
- `package.json` (modified — added `@swc/jest` and `@swc/core` as devDependencies)
- 25 widget/component files in `lib/dashboard/` renamed from `.js` → `.jsx` and converted from `createElement(...)` / `h(...)` to JSX (`agenda`, `calendar`, `config-popup`, `copy-link`, `dashboard`, `dashboard-layout-popup`, `dashboard-load`, `dashboard-settings-popup`, `dashboard-tooltip-tippy`, `day-sketch`, `debug-console`, `draggable-heading`, `dream-task`, `graveyard`, `layout-picker`, `mood`, `note-editor`, `peak-hours`, `planning`, `quick-actions`, `quotes`, `recent-notes`, `task-domains`, `victory-value`, `widget-wrapper`)
- Helper functions that previously took `h` as a parameter (e.g. `renderTaskCard(h, …)` in graveyard, `renderItem(h, …)` in dashboard-layout-popup, `renderMetricCard(h, …)` in peak-hours, `renderSparkline(h, …)` in mood, `renderHourLine(h, …)` in day-sketch) were refactored into JSX component functions (e.g. `TaskCard`, `LayoutItem`, `MetricCard`, `Sparkline`, `HourLine`)
- Test files updated to import the renamed `.jsx` source files: `test/agenda.test.js`, `test/app.test.js`, `test/calendar-events.test.js`, `test/day-sketch.test.js`, `test/dream-task-actions.test.js`, `test/dream-task-retry.test.js`, `test/graveyard-widget.test.js`

**Task:** Translate the entire dashboard plugin's component rendering from imperative `createElement` calls to JSX syntax while preserving all behavior.
**Prompt summary:** "translate this project to render components with JSX instead"
**Scope:** ~6,000 lines touched across 30+ files (build config, resolver, Jest config, and 25 component files renamed/rewritten)
**Notes:**
- Uses React 17+ **automatic** JSX runtime (esbuild auto-imports `react/jsx-runtime`); no source file needs to `import { createElement }` solely for JSX.
- `lib/util/browser-dev-app.js` keeps its 21 `document.createElement(...)` calls — those are real DOM creation, not React.
- `renderTaskTooltipContent` in `graveyard.jsx` still returns an HTML template string because tippy.js's `content` prop takes raw HTML, not React.
- `embed-html.js` produces a raw HTML string for the plugin embed shell and was not touched.
- Build verified: `npm run build` produces a 705 KB `build/compiled.js` with the expected `return plugin;\n})()` IIFE footer.
- Tests verified: full Jest suite passes apart from the two suites that were already failing on `main` before the migration (`test/call-plugin-fallback.test.js` and `test/graveyard-widget.test.js` — both pre-existing test-mock issues, not JSX-related).

---

## 2026-05-21 — Rank Graveyard candidates by nine-month proximity

**Model:** gpt-5.5
**Files created/modified:**
- `lib/graveyard-service.js` (modified — replaced age-bucket/oldest-first selection with value minus log weekly distance from nine months old)
- `test/graveyard-service.test.js` (modified — added regression coverage that scores all discovered tasks before selecting the top five)

**Task:** Rewrite Graveyard candidate suitability scoring to prefer high-value tasks created close to nine months ago
**Prompt summary:** "rewrite graveyard task heuristic to subtract log weekly distance from nine months ago before selecting top 5"
**Scope:** ~75 lines changed across candidate ranking and focused Jest coverage
**Notes:** Fresh discovery and cached row hydration both attach `graveyardHeuristicScore` before returning candidates.

---

## 2026-05-15 — Replace dead Unsplash background image URLs

**Model:** claude-opus-4-7
**Files created/modified:**
- `lib/util/background-splash-images.js` (modified — replaced 4 photo IDs whose Unsplash URLs now 404)

**Task:** Audit every background image URL in the splash/meadow pools and swap any that no longer resolve
**Prompt summary:** "the graveyard background URL resolves blank — double-check all background images still exist"
**Scope:** 4 single-line URL substitutions across the SPLASH_IMAGE_BASE_URLS and GRAVEYARD_MEADOW_BASE_URLS arrays
**Notes:** Verified all 60 URLs via `curl ... ?w=600&h=600&fit=crop&auto=format`. Four returned HTTP 404 (the Unsplash photographer presumably deleted the originals): `photo-1493244040629-...` (aerial river), `photo-1517821365201-...` (mountain lake), `photo-1416889580510-...` (wildflower meadow), `photo-1455541504462-...` (golden-hour green hills — the one Bill flagged). Replacements were sourced from current Unsplash search results for the same themes and re-verified. Note that no Unsplash photo URL carries a permanence guarantee — photographers can delete at any time — so periodic re-checks remain necessary.

---

## 2026-05-15 — Stop shadowing app.settings/app.context on the embed proxy

**Model:** claude-opus-4-7
**Files created/modified:**
- `lib/plugin-data.js` (created — embed-side singleton store for plugin settings/context with setPluginData, pluginSettings, pluginContext, updatePluginSetting)
- `lib/dashboard/dashboard-load.js` (modified — stripped production Proxy to a pure call-router; no settings/context fields)
- `lib/dashboard/dashboard.js` (modified — populate plugin-data store from init payload; replace app.settings[X]=Y writes with updatePluginSetting; read configParams/pluginContext for render)
- `lib/data-service.js` (modified — embed-side exports switchTaskDomain, refreshTaskDomains, isPluginRecentlyInstalled, createQuarterlyPlan, createOrAppendMonthlyPlan, createOrAppendWeeklyPlan, fetchQuotes now read from pluginSettings(); fetchDashboardData and plugin-side `_helper` callees keep using the real app.settings)
- `lib/dream-task-service.js` (modified — `_buildLlmOptions`, `_dreamTaskResolvedModel`, `_llmAttributionFooterFresh`, `_generateSuggestionsFromLlm`, `_getActiveDomainUuid` read settings from pluginSettings())
- `lib/providers/ai-provider-settings.js` (modified — preferredModels() reads from pluginSettings() with no app arg; apiKeyFromApp still takes app to surface alerts)
- `lib/providers/fetch-ai-provider.js` (modified — drop app arg from preferredModels() call)
- `lib/constants/settings.js` (modified — parseWidgetConfig drops app param, reads from pluginSettings())
- `lib/dashboard/dream-task-internals.js` (modified — _loadSeenUuidsMap drops app param; requestDreamTaskRefreshExcludingRecent drops app param)
- `lib/dashboard/dream-task.js` (modified — call sites for _loadSeenUuidsMap, requestDreamTaskRefreshExcludingRecent, configuredProvidersFromSettings updated)
- `lib/dashboard/dream-task-provider-selection.js` (modified — chooseReseedProvider reads settings from pluginSettings())
- `lib/dashboard/mood.js`, `lib/dashboard/victory-value.js` (modified — parseWidgetConfig call sites)
- `test/call-plugin-fallback.test.js`, `test/dream-task-provider-selection.test.js`, `test/dream-task-actions.test.js`, `test/dream-task-retry.test.js`, `test/dream-task-service.test.js`, `test/llm-integration.test.js` (modified — populate plugin-data store via setPluginData instead of stuffing settings onto mock app)

**Task:** Stop the embed from mutating `app.settings` / `app.context`; move denormalized settings into a clearly-named local store
**Prompt summary:** "all mocking that modifies the app object should happen exclusively in dev harness; make a distinct setting like pluginSettings or pluginData"
**Scope:** New 45-line module, ~40 call sites updated across ~15 source files plus 6 test files
**Notes:** Production embed Proxy is now a pure call-router — every property access returns a function routed to window.callAmplenotePlugin. The embed-side cache of plugin settings/context lives in lib/plugin-data.js (module singleton), populated once from the init payload and updated via updatePluginSetting after embed-side setSetting calls. Dual-purpose data-service.js functions: fetchDashboardData and its internal `_helper` callees still read from the real app.settings on the plugin side; all exported functions called from embed widgets switched to pluginSettings(). Pre-existing graveyard-service / graveyard-widget test failures (mocks missing app.getTask after a recent graveyard refactor) are unrelated and remain.

---

## 2026-05-15 — Parallelize dashboard init fetches and add load-time logging

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/data-service.js` (modified — restructured fetchDashboardData to parallelize domain resolution with mood/plans/settings; domain tasks now chain off domain resolution; added timing logs throughout)
- `lib/dashboard/dashboard.js` (modified — added app.init() and DashboardSettingNote load timing logs to useEffect)
- `lib/dashboard/dashboard-load.js` (created — standalone init entry point; dev uses createBrowserDevApp, production uses minimal proxy)
- `lib/dashboard/client-entry.js` (modified — reduced to thin redirect import for backward compat; real logic moved to dashboard-load.js)
- `esbuild.js` (modified — entry point updated to dashboard-load.js)
- `dev/dev-server.js` (modified — entry point updated to dashboard-load.js)

**Task:** (1) Add logIfEnabled timing coverage to diagnose "Loading dashboard" latency on mobile; (2) fix sequential bottleneck where _resolveTaskDomains blocked all other parallel fetches; (3) move init complexity out of client-entry.js into standalone dashboard-load.js
**Prompt summary:** "add logIfEnabled coverage for loading latency; fix red flags; move app.init() paradigm to dashboard-load.js with IS_DEV_ENVIRONMENT guard"
**Scope:** ~50 lines changed/added across 6 files
**Notes:**
- Key fix: `_resolveTaskDomains` previously ran alone before any parallel fetch; now it runs in parallel with mood/plans/settings while domain tasks chain off it with `.then()` — strictly better in all timing scenarios
- Timing logs in `fetchDashboardData`, `_resolveTaskDomains`, `_findQuarterlyPlans`, `_fetchTasksForDomain`, and the `DashboardApp` init `useEffect` now provide full visibility into which fetch phase is slow
- `dashboard-load.js` production path: minimal proxy to `callAmplenotePlugin` + React mount (no dev code ships in prod due to IS_DEV_ENVIRONMENT tree-shaking)
- Removed `_settledValueOr` helper (no longer needed after switching from Promise.allSettled to Promise.all with .catch())

---

## 2026-05-15 — Track human-edited vs auto-populated lines in DaySketch

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/day-sketch.js` (modified — adds per-hour human-edited tracking and async refresh of auto-populated rows)

**Task:** Record whether each DaySketch row was auto-populated or human-edited; restore only human-edited rows on load, then re-validate auto rows from current tasks/events; never overwrite human-edited rows
**Prompt summary:** "record whether each line was auto-populated or human-edited; on load clear auto rows and let prefill refresh them; human-edited lines are permanent for the day"
**Scope:** ~60 lines changed across 8 functions/hooks in one file
**Notes:**
- `parseNoteContent` now returns `{ entries, humanEditedHours }` (Set); note footer `human-edited: 6,9,14` stores which hours the user directly edited
- `buildNoteBody` appends the human-edited footer when any hours are marked
- On load, only human-edited rows are restored; auto-populated rows start blank so prefill re-validates them against current tasks/events (satisfies the async re-confirm requirement)
- `entriesPrefilledFromTasks` and `entriesPrefilledFromCalendarEvents` both accept `humanEditedHours` and skip those hours
- `handleInputChange` adds the edited hour to `humanEditedHours` immediately; subsequent prefill runs will not touch it

---

## 2026-05-13 — Add DebugConsole widget gated behind DEBUG_CONSOLE setting

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/debug-console.js` (created — new DebugConsoleWidget that subscribes to logIfEnabled messages and renders them in a scrollable list)
- `lib/dashboard/styles/debug-console.scss` (created — styles for the debug console widget)
- `lib/util/log.js` (modified — added ring buffer, `getLogBuffer`, `addLogListener`, `removeLogListener` exports)
- `lib/constants/settings.js` (modified — added `SETTING_KEYS.DEBUG_CONSOLE`; added debug-console entry to `WIDGET_REGISTRY` with `debugOnly: true`; filtered `debugOnly` entries from `DEFAULT_DASHBOARD_COMPONENTS`)
- `lib/dashboard/dashboard-layout-popup.js` (modified — added `excludeWidgetIds` prop; `deriveInitialIds`, `deriveInitialSizing`, and `onReset` all respect excluded widget ids)
- `lib/dashboard/dashboard.js` (modified — imported and registered `DebugConsoleWidget`; computes `layoutPopupExcludeWidgetIds` from `DEBUG_CONSOLE` setting and passes it to `DashboardLayoutPopup`)

**Task:** Add a DebugConsole dashboard widget that captures all `logIfEnabled` messages and displays them in a scrollable div, visible in the layout config popup only when `SETTING_KEYS.DEBUG_CONSOLE` is set to `"true"`, and excluded from all default layouts
**Prompt summary:** "Add a new DebugConsole component that is only available to a user if they have SETTING_KEYS.DEBUG_CONSOLE equal to 'true'; capture all logIfEnabled messages in a scrollable div; not in any default layout but visible in the layout config popup when its setting is 'true'"
**Scope:** ~130 lines of new logic across 2 new files; ~60 lines modified across 4 existing files
**Notes:** `logIfEnabled` now pushes each entry to a 200-entry ring buffer and notifies registered listeners; the DebugConsole component initialises from the buffer snapshot and appends via listener; the layout popup's `excludeWidgetIds` prop makes the widget invisible in both the Components and Sizing tabs when the setting is absent or non-"true"

---

## 2026-05-11 — Fix Recent Notes widget deadlock and add domain tags to sample note handles

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/recent-notes-service.js` (modified — `staleCandidatesFromScan` now falls back to a full rescan when `visitedByDay` covers all notes and `staleCandidates` is empty, breaking the deadlock that caused the widget to show nothing)
- `dev/dev-app.js` (modified — added `id` field to `SAMPLE_DOMAINS` matching each domain's `uuid` so `domain.id` in the service resolves correctly instead of `undefined`)
- `lib/util/browser-dev-app.js` (modified — same `id` field addition to `_SAMPLE_DOMAINS_WITH_NOTES`)
- `lib/util/dev-sample-notes.js` (modified — added `tags` array to every entry in `SAMPLE_NOTE_HANDLES` using the domain-specific tag, e.g. `["work"]`, `["personal"]`, `["side-projects"]`)
- `notes/bfcc5a78-fd6f-47dc-ab33-620169bc4adf.md` (modified — cleared stuck `visitedByDay` state so the widget rescans immediately)

**Task:** Restore Recent Notes widget functionality in dev environment after it stopped showing any notes
**Prompt summary:** "component no longer finds notes in dev environment — revise note construction adding each note to a tag present in the task domain"
**Scope:** ~10 lines of logic added to service; minor additions to 3 dev/fixture files
**Notes:** Root cause was a two-part deadlock: (1) dev domain objects lacked `id`, so `domain.id` was `undefined` and every `filterNotes` call returned all 35 notes at once, flooding `visitedByDay` in a single pass; (2) with `staleCandidates` empty and all notes visited, the existing reset path (`staleCandidates.length > 0 && filteredCandidates.length === 0`) never fired. The new fallback in `staleCandidatesFromScan` catches the `notes.length === 0 && state.staleCandidates.length === 0` case and forces a full rescan, which also populates `staleCandidates` for subsequent runs.

## 2026-05-11 — Fast-path cached DreamTask suggestions without loading all domain tasks

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dream-task-service.js` (modified — added `_loadTaskContextForCachedTasks`; reordered `analyzeDreamTasks` to check cached undismissed count before calling `_loadTaskContext`)

**Task:** Skip `getTaskDomainTasks` (loading 1000+ tasks) when the note already has enough cached suggestions for today
**Prompt summary:** "check for existent+undismissed tasks before querying task domain; evaluate what consumes 14393ms in fetchDreamTaskSuggestions"
**Scope:** ~20 lines added, ~3 lines restructured in `analyzeDreamTasks`
**Notes:** Cached path now calls `app.getTask` only for the 2-5 UUIDs in cached suggestions; full domain load only occurs when generation is needed

## 2026-05-10 — Layout profile extraction, profile selector in popup, and dismiss link

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/layout-profiles.js` (created — standalone module exporting `goalOrientedWidgets`, `LAYOUT_PROFILES`, `layoutMatchesProfile`, `getProfileById`)
- `lib/constants/settings.js` (modified — added `SELECTED_LAYOUT_PROFILE` to `SETTING_KEYS`)
- `lib/dashboard/layout-picker.js` (modified — imports from `layout-profiles`; passes `profile.id` to `onLayoutApply`; adds `headerActions` dismiss button)
- `lib/dashboard/dashboard-layout-popup.js` (modified — imports `LAYOUT_PROFILES`/`getProfileById`; adds `selectedLayoutProfile` prop, `selectedProfileId` state, profile selector `<select>` above tabs; scopes reset to active profile; passes `selectedProfileId` to `onSave`)
- `lib/dashboard/dashboard.js` (modified — adds `handleProfileApply` useCallback; wires `onLayoutApply` to `handleProfileApply`; passes `selectedLayoutProfile` to `DashboardLayoutPopup`; updates `handleLayoutSave` to accept and forward `profileId`)

**Task:** Extract layout profile data into a shared module, allow the layout popup to remember and reset to a chosen profile, and let users dismiss the layout-picker widget from its header
**Prompt summary:** "move profile definitions to layout-profiles.js; add profile selector and profile-scoped reset to dashboard-layout-popup; add dismiss link to layout-picker header; wire profile ID persistence through dashboard.js"
**Scope:** ~130 lines of new/changed logic across 5 files
**Notes:** `handleProfileApply` explicitly distinguishes `null` (clear profile) from `undefined` (no change) so the setting is not accidentally wiped when only a layout reorder is saved.

---

## 2026-05-10 — Layout Picker widget with one-click dashboard profile presets

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/layout-picker.js` (created — Layout Picker widget with three profile buttons)
- `lib/dashboard/styles/layout-picker.scss` (created — styles for profile card layout)
- `lib/constants/settings.js` (modified — added `layout-picker` entry to WIDGET_REGISTRY)
- `lib/dashboard/dashboard.js` (modified — import, cell registration, `onLayoutApply` prop, and `activeTaskDomain?.uuid` → `activeTaskDomain` fix)

**Task:** Add a Layout Picker widget with three clickable profile presets that immediately rearrange all dashboard components
**Prompt summary:** "add Layout Picker widget with Goal Oriented / Day-to-Day / Mindful Achiever profile buttons that rearrange all components"
**Scope:** ~110 lines of new logic across 4 files
**Notes:** Profiles call `handleLayoutPersist` with `isReset=true` so sizes are applied cleanly; "Goal Oriented" derives its widget list from WIDGET_REGISTRY at runtime so it stays current automatically

---

## 2026-05-10 — Graveyard header refresh repopulation

**Model:** GPT-5.4
**Files created/modified:**
- `lib/dashboard/graveyard.js` (modified — adds a title-bar refresh link and wires it to force a fresh graveyard candidate reload)
- `lib/graveyard-service.js` (modified — adds a force-refresh option that bypasses the current day's cache row and replaces it with new candidates)
- `test/graveyard-widget.test.js` (modified — verifies the header refresh link repopulates the rendered graveyard task list)
- `test/graveyard-service.test.js` (modified — verifies force-refresh bypasses the cached today row and persists a fresh replacement set)

**Task:** Add a graveyard header refresh action that repopulates the widget's visible task slots with a fresh candidate set
**Prompt summary:** "Update @lib/dashboard/graveyard.js so that its title bar includes a refresh link that will repopulate the five task slots in the component"
**Scope:** ~70 lines across 2 production files and 2 tests
**Notes:** Refresh now bypasses the current day's cached graveyard row, excludes already-shown candidates from reselection, and rewrites the day row with the newly discovered tasks.

## 2026-05-10 — Graveyard hover tooltip and compact date stamp

**Model:** GPT-5.4
**Files created/modified:**
- `lib/dashboard/graveyard.js` (modified — adds 500ms hover tooltip with markdown-rendered task content, note metadata, locale-aware created date, score badge, and compact 1-column date labels)
- `lib/graveyard-service.js` (modified — persists task-to-note metadata in the graveyard cache so note labels survive cached reloads without extra note lookups)
- `lib/dashboard/styles/graveyard.scss` (modified — styles the hover tooltip, score badge, and narrow-card layout tweaks)
- `test/graveyard-widget.test.js` (created — verifies delayed tooltip rendering and 1-column date stamp behavior)
- `test/graveyard-service.test.js` (created — verifies cached graveyard rows roundtrip task-to-note metadata)

**Task:** Add a delayed graveyard hover tooltip with full task metadata and tighten the visible date stamp when the widget is only one column wide
**Prompt summary:** "update graveyard.js so hovering task text for 500ms shows markdown content, note name, locale created date, and score dot; omit 'Created' in 1-wide stamps"
**Scope:** ~180 lines across 3 modified files and 1 new test
**Notes:** Tooltip content uses the shared Amplenote markdown renderer, score colors map to gray/blue/yellow/red based on the requested thresholds, and the graveyard data note now caches per-task note metadata for later hydration.

## 2026-05-09 — Desktop widget focus mode

**Model:** GPT-5.4
**Files created/modified:**
- `lib/dashboard/draggable-heading.js` (modified — exposes desktop-only icon buttons that request widget focus mode)
- `lib/dashboard/focus-widget.js` (created — owns widget-focus transforms, event handling, and clear/reset behavior behind exported helpers)
- `lib/dashboard/dashboard.js` (modified — delegates widget-focus state to the new utility module instead of embedding the logic inline)
- `lib/dashboard/styles/dashboard.scss` (modified — animates non-selected widgets offscreen and styles the restore backdrop/icon button)
- `test/app.test.js` (modified — integration coverage for enter/exit behavior and desktop-only gating)

**Task:** Add a desktop-only widget focus interaction that centers the clicked widget and animates all other widgets out of view until the background is clicked
**Prompt summary:** "when the user clicks on the icon for a particular component, animate the others out and center it; clicking the background should restore the grid"
**Scope:** ~120 lines of new logic and tests across 1 new file and 4 existing files
**Notes:** Focus mode is gated to widths above the tablet breakpoint, exits on background click, and now lives in a dedicated utility module that also clears automatically on resize, popup transitions, and widget drag mode.

## 2026-05-09 — Tighten layout save API

**Model:** GPT-5.4
**Files created/modified:**
- `lib/dashboard/dashboard.js` (modified — split popup-close behavior from raw layout persistence and removed focus control from `saveLayout`)
- `lib/hooks/use-dashboard-layout.js` (modified — uses the raw persistence callback for init-time layout syncing)
- `lib/dashboard/dashboard-layout-popup.js` (modified — calls layout save with explicit `isReset` and `sizing` params instead of an options bag)

**Task:** Replace the undocumented layout-save options object with explicit parameters and remove imperative focus control from the low-level layout persistence function
**Prompt summary:** "Break up handleLayoutSave so it consumes specific params, and remove setFocus as a param to saveLayout"
**Scope:** ~20 lines changed across 3 files
**Notes:** `handleLayoutPersist` now serves drag/init flows, while the popup-specific `handleLayoutSave` closes focus state explicitly after persistence succeeds.

**Model:** GPT-5.4
**Files created/modified:**
- `lib/util/new-component-popin.js` (created — parses/merges `COMPONENTS_SEEN` and derives recent-widget pop-in behavior)
- `lib/constants/settings.js` (modified — added `COMPONENTS_SEEN` setting key and `introducedAt` metadata for Graveyard)
- `lib/data-service.js` (modified — hydrates parsed `COMPONENTS_SEEN` into init settings)
- `lib/dashboard/dashboard.js` (modified — delays layout derivation until seen-setting load, persists init-time seen ids, and saves seen ids alongside layout changes)
- `test/new-component-popin.test.js` (created — unit tests for seen-setting parsing, merging, and pop-in derivation)
- `test/app.test.js` (modified — integration test covering init-time `COMPONENTS_SEEN` persistence)

**Task:** Track which dashboard widgets have ever been shown and auto-pop a newly introduced unseen widget into the visible layout for one week after launch
**Prompt summary:** "store shown components in COMPONENTS_SEEN, only auto-show recent unseen widgets after the setting loads, and manage the derivation in a standalone util"
**Scope:** ~140 lines of new logic across 2 new files, ~50 lines modified across 4 existing files
**Notes:** `COMPONENTS_SEEN` is stored as a sorted unique array of widget ids; init and layout-save flows both merge currently visible ids into that setting so recent widgets only pop in once per user.

## 2026-05-09 — Task Graveyard widget

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/graveyard-service.js` (created — discovers aged tasks and persists candidates in monthly archived note)
- `lib/dashboard/graveyard.js` (created — React widget component with send-to-graveyard/keep actions)
- `lib/dashboard/styles/graveyard.scss` (created — widget styles)
- `lib/constants/settings.js` (modified — added graveyard to WIDGET_REGISTRY)
- `lib/dashboard/dashboard.js` (modified — imported GraveyardWidget, added GraveyardCell, registered in CELL_COMPONENTS, passed taskDomainUUID to all cells)

**Task:** Add a Graveyard dashboard widget that surfaces tasks in the 90th percentile of age (by createdAt), shows them as dismissal candidates, and persists the daily candidate list in a monthly archived note keyed by date
**Prompt summary:** "add graveyard.js component that discovers old tasks eligible for dismissal, caches candidates in 'Graveyard tasks of Month Year' archived note as a date-keyed table, and renders them with Send to graveyard / Keep actions"
**Scope:** ~280 lines of new logic across 3 new files, ~20 lines modified across 2 existing files
**Notes:** Task discovery uses filterNotes(sort: opened) in reverse order to favor least-recently-opened notes; applies 6-month → 3-month → any-age cascade. "Send to graveyard" calls app.updateTask with dismissedAt. Cached UUID rows are hydrated via getTaskDomainTasks on subsequent same-day loads.

## 2026-05-01 — Hide Schedule for already scheduled native tasks

**Model:** GPT-5.5
**Files created/modified:**
- `lib/dream-task-service.js` (modified — attaches native Amplenote task objects to DreamTask suggestions by UUID)
- `lib/dashboard/dream-task.js` (modified — distinguishes `dreamTask` suggestions from native `task` objects during render)
- `test/dream-task-actions.test.js` (modified — covers native-task enrichment and Schedule link hiding)

**Task:** Hide DreamTask's Schedule action when the underlying native Amplenote task already has `startAt`
**Prompt summary:** "DreamTask render receives a DreamTask-specific task; pass the native Amplenote task through so Schedule can hide when native startAt exists"
**Scope:** ~80 lines changed across 3 files
**Notes:** Existing suggestions now carry `nativeTask` from the active task domain context; rendered cards use that native task's `startAt` while keeping DreamTask metadata separate.

---

## 2026-05-01 — Schedule DreamTask suggestions with startAt

**Model:** GPT-5.5
**Files created/modified:**
- `lib/hooks/use-dashboard-task-updates.js` (created — listens for task-update events and refreshes task-domain state)
- `lib/dashboard/dashboard.js` (modified — delegates task-update event handling to the hook)
- `lib/dashboard/dream-task.js` (modified — routes Schedule through a helper that validates startAt and reports failures)
- `lib/dashboard/dream-task-internals.js` (modified — persists created task UUIDs into cached DreamTask suggestions)
- `lib/dashboard/dream-task-schedule.js` (modified — normalizes picker dates and creates invented tasks with startAt)
- `lib/util/date-utility.js` (modified — consolidates date parsing into `dateFromDateInput`)
- `test/dream-task-actions.test.js` (modified — covers Unix-second formatting and insert/update scheduling payloads)
- `build/compiled.js` (modified — rebuilt plugin bundle)

**Task:** Ensure DreamTask Schedule creates or updates Amplenote tasks with a valid Unix-second `startAt` and refreshes scheduled-task widgets
**Prompt summary:** "When schedule creates a DreamTask, preserve the picker start time and match app.updateTask formatting"
**Scope:** ~140 lines changed across source, tests, and compiled output
**Notes:** Invented tasks now receive `startAt` in the `app.insertTask` payload, are linked back to their created UUID in the DreamTask cache, and broadcast a task-update event so Agenda and DaySketch refresh.

---

## 2026-04-29 — Complete DreamTask suggestions in Amplenote

**Model:** GPT-5.5
**Files created/modified:**
- `lib/util/task-util.js` (created — general task completion helper for existing tasks and completed markdown insertion)
- `lib/dashboard/dream-task-internals.js` (modified — keeps DreamTask-specific metadata persistence separate from completion)
- `lib/dashboard/dream-task.js` (modified — routes Complete link through the shared task completion helper)
- `test/dream-task-actions.test.js` (modified — covers app.updateTask and daily-jot insertNoteContent completion paths)

**Task:** Mark DreamTask suggestions complete through Amplenote task APIs instead of only updating widget cache metadata
**Prompt summary:** "when Complete is clicked, use app.updateTask for existing tasks and insert a completed task into today's daily jot for new tasks"
**Scope:** ~120 lines changed across 4 files
**Notes:** Existing tasks receive a Unix-second `completedAt`; inserted tasks append completed task markdown to a provided note UUID, with a helper for resolving today's `daily-jots` note.

---

## 2026-04-29 — Normalize mobile calendar event dates

**Model:** GPT-5.5
**Files created/modified:**
- `lib/hooks/use-external-calendar-events.js` (modified — normalizes external event start/end values into Date instances)
- `lib/dashboard/agenda.js` (modified — guards event duration rendering against serialized date strings)
- `test/calendar-events.test.js` (modified — added mobile serialized-date regression coverage)

**Task:** Prevent Agenda from crashing when mobile calendar events contain serialized date values
**Prompt summary:** "After restoring the ability of mobile to retrieve calendar events, agenda errors on mobile"
**Scope:** ~55 lines changed across 3 files
**Notes:** Calendar events are normalized at the hook boundary, and Agenda now calculates event duration through its existing timestamp-normalization path.

---

## 2026-04-29 — Add shared large-phone breakpoint helper

**Model:** GPT-5.5
**Files created/modified:**
- `lib/dashboard/client-entry.js` (modified — named large-phone fallback constants and documented the iOS iframe class)
- `lib/dashboard/styles/breakpoints.scss` (modified — added `breakpoint` mixin with the large-phone root-class fallback)
- `lib/dashboard/styles/calendar.scss` (modified — uses the shared breakpoint mixin for mobile calendar spacing)
- `lib/dashboard/styles/dream-task.scss` (modified — uses the shared breakpoint mixin for mobile title/header layout)

**Task:** Centralize large-phone responsive styling so component styles use one breakpoint include
**Prompt summary:** "document the iOS breakpoint fallback constants and support @include breakpoint($breakpoint-large-phone)"
**Scope:** ~50 lines changed across client bootstrap and SCSS
**Notes:** The mixin emits both the normal media query and, for phone-sized breakpoints, the iOS iframe root-class fallback.

---

## 2026-04-29 — Reuse same-day Recent Notes selections

**Model:** GPT-5.5
**Files created/modified:**
- `lib/recent-notes-service.js` (modified — reuses persisted same-day selected notes once enough notes exist to render)
- `test/recent-notes-service.test.js` (modified — added same-day multi-client reuse regression coverage)

**Task:** Ensure later clients reuse the first device's current-day Recent Notes selection before scanning task-domain notes
**Prompt summary:** "confirm clients reuse today's found notes; update recent-notes.js so new devices load existing first"
**Scope:** ~35 lines changed across 2 files
**Notes:** The service already loaded the archived daily note before scanning; this change prevents taller/new clients from scanning again just because their `maxNotes` is higher than the saved selection count.

---

## 2026-04-29 — Stack DreamTask headers on compact cards

**Model:** GPT-5.5
**Files created/modified:**
- `lib/dashboard/styles/breakpoints.scss` (created — shared large-phone, tablet, laptop, desktop variables)
- `lib/dashboard/styles/theme-tokens.scss` (modified — forwards shared breakpoint variables to widget styles)
- `lib/dashboard/styles/dashboard.scss` (modified — uses shared tablet breakpoint for mobile dashboard layout)
- `lib/dashboard/styles/dream-task.scss` (modified — viewport-breakpoint responsive card header layout)

**Task:** Improve DreamTask card header layout at low widths by placing task text above note title
**Prompt summary:** "Update DreamTask styling so low-width breakpoints show task text first, note title second, hide rating, and use shared breakpoint variables"
**Scope:** ~35 lines of SCSS
**Notes:** Applies below the large-phone breakpoint, defined as the iPhone 15 Pro Max CSS viewport width.

---

## 2026-04-29 — Persist Recent Notes state in daily archived notes

**Model:** GPT-5.5
**Files created/modified:**
- `lib/recent-notes-service.js` (created — daily archived-note state, previous-day seeding, visited-note tracking, selected-note caching)
- `lib/dashboard/recent-notes.js` (modified — delegates stale-note discovery to the service and refreshes on reseed)

**Task:** Store Recent Notes recently visited notes and current-date selections in archived dashboard notes
**Prompt summary:** "revise recent-notes.js to use an archived note for recently visited notes and selected notes; seed new days from previous day data"
**Scope:** ~430 lines of new service logic plus a focused widget refactor
**Notes:** Daily notes are tagged `plugins/dashboard`, created archived, and contain a fenced JSON state block.

---

## 2026-04-29 — Sort Agenda tasks and events by time

**Model:** GPT-5.5
**Files created/modified:**
- `lib/dashboard/agenda.js` (modified — merges visible tasks and calendar events before sorting by timestamp)
- `test/agenda.test.js` (modified — added mixed task/event ordering regression coverage)

**Task:** Sort tasks and events within each Agenda day by ascending time of day
**Prompt summary:** "Task Agenda is not correctly interspersing events and tasks by the time of day"
**Scope:** ~45 lines changed across 2 files
**Notes:** All-day events sort to the start of their date; tasks/events without a timestamp remain at the end with stable source order.

---

## 2026-04-19 — Add Schedule link to DreamTask cards and AI-rank stale notes in Recent Notes

**Model:** claude-opus-4.7
**Files created/modified:**
- `lib/dashboard/recent-notes-ai.js` (created — plugin-first, LLM-fallback ranker for stale-note candidates)
- `lib/dashboard/recent-notes.js` (modified — accepts `providerApiKey`; applies AI ranking before seed-based rotation)
- `lib/dashboard/dashboard.js` (modified — passes `providerApiKey` into `RecentNotesCell`)
- `lib/dashboard/dream-task-schedule.js` (created — `buildAvailableTimeSlots`, `fetchSchedulingOccupancy`, `startAtSecondsFromDateAndMinutes`)
- `lib/dashboard/dream-task.js` (modified — shortened "Mark complete" label to "Completed"; added "📅 Schedule" card action; `useDreamTaskActions` now accepts `defaultNoteUUID` and exposes `onScheduleTask`)

**Task:** Mirror DreamTask's Ample-Agent-Pro-first-then-user-LLM pattern in the Recent Notes widget to rank stale-task notes by importance, and add a Schedule action to DreamTask suggestions that prompts for a date and conflict-free 30-minute time slot before writing `startAt`. Existing invented tasks are created via `app.insertTask` before their `startAt` is set.
**Prompt summary:** "recent-notes mirror dream-task by calling Ample Agent Pro before user API keys; dream-task shorten 'Mark complete' to 'Completed' and add a Schedule link that uses app.prompt to pick an unoccupied time"
**Scope:** ~260 lines of new logic across 5 files (2 new, 3 modified)
**Notes:** AI ranking is silent-fail — if Ample Agent Pro returns falsy and no `providerApiKey` is available (or the LLM call throws), Recent Notes keeps its deterministic seed-based order. Scheduling occupancy merges `app.getExternalCalendarEvents({ days: 30 })` with every domain's `getTaskDomainTasks` startAt values; time slots run 6 AM–10 PM in 30-minute increments and exclude any slot overlapping a calendar event or scheduled task. If the user changes the date after the dialog opens, the shown conflict list still reflects today (app.prompt is not reactive) — the prompt message explains this trade-off.

---

## 2026-04-16 — Inline calendar events into DaySketch hour rows and agenda task list

**Model:** claude-4.6-opus
**Files created/modified:**
- `lib/util/browser-dev-app.js` (modified — added `getExternalCalendarEvents` mock returning two events)
- `lib/dashboard/day-sketch.js` (modified — replaced separate "Today's Calendar" panel with hour-row prefill via `hoursFromCalendarEvent`, `entriesPrefilledFromCalendarEvents`, `useDaySketchCalendarPrefill`)
- `lib/dashboard/agenda.js` (modified — added `calendarEventsForDateKey` filter; calendar events now render with same `agenda-task-row` formatting as tasks; non-today events excluded)
- `test/calendar-events.test.js` (modified — updated sample events with start/end Dates; new tests for prefill, date filtering, duration display)

**Task:** Place calendar events inline at scheduled times in DaySketch and Agenda, with same formatting as tasks and date-based filtering
**Prompt summary:** "place calendar events in day sketch at scheduled time; agenda events use same formatting as tasks; filter out non-today events"
**Scope:** ~80 lines of new logic across 4 files
**Notes:** Dev environment now returns "Birthday party" (4pm today) and "Quarterly Review Sync" (11:25am in two days). DaySketch prefills hour rows for today-only events. Agenda filters calendar events by date key and renders them with `priority-normal` indicator and duration. All 14 calendar-events tests pass.

## 2026-04-15 — Wire calendarEvents into DaySketch and Agenda rendering

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/day-sketch.js` (modified — added `formatCalendarEventTime` and `renderCalendarEventsPanel` helpers; panel rendered below notebook)
- `lib/dashboard/agenda.js` (modified — calendar events now display `start` time for non-allDay events using existing `formatTime`)

**Task:** Update both widgets to consume the normalized calendar event shape `{ allDay, calendar, color, end, start, title }` where `start`/`end` are `Date` objects
**Prompt summary:** "Update day-sketch.js to utilize calendarEvents array; ensure agenda.js uses the same event structure"
**Scope:** ~55 lines of new logic across 2 files
**Notes:** `DaySketchWidget` renders a "Today's Calendar" panel (`.day-sketch-calendar-events`) below the notebook; hidden when array is empty or null. `AgendaWidget` now shows `formatTime(event.start)` for non-allDay events; existing `toMillis` handles `Date` instances. All 13 calendar-events tests pass.

## 2026-04-10 — DaySketch Shift+Arrow line selection

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/day-sketch.js` (modified — updated `handleInputKeyDown` in `useDaySketchInputNavigation`)

**Task:** When Shift+Up/Down is pressed in a DaySketch hour input, select all text on the current line instead of navigating to the adjacent row. Shift+Up leaves cursor at the beginning; Shift+Down leaves cursor at the end.
**Prompt summary:** "if the user presses up or down while holding shift, highlight all text on the current line with cursor at beginning (up) or end (down)"
**Scope:** ~10 lines changed in 1 function
**Notes:** Uses `setSelectionRange(0, len, "backward"/"forward")` to control which end the cursor lands on after selecting all text.

## 2026-04-09 — Global Time & Date format settings via DashboardSettingNote

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dashboard-setting-note.js` (created — DashboardSettingNote class for finding/creating/parsing a plugin settings note with locale detection)
- `lib/dashboard/dashboard-settings-popup.js` (modified — added Time & Date Format section with radio buttons for time format and week format)
- `lib/dashboard/dashboard.js` (modified — added timeFormat/weekFormat useState, DashboardSettingNote loading on init, pass props to all widgets)
- `lib/dashboard/day-sketch.js` (modified — formatHourLabel supports 24h format via timeFormat prop)
- `lib/dashboard/calendar.js` (modified — removed local week-start config popup, uses weekFormat prop, Configure opens global Dashboard Settings)
- `lib/dashboard/peak-hours.js` (modified — hour labels respect timeFormat prop for meridian vs 24h display)
- `lib/dashboard/agenda.js` (modified — formatTime respects timeFormat prop for 12h vs 24h display)
- `lib/dashboard/victory-value.js` (modified — week chart respects weekFormat prop for Sunday vs Monday start)
- `lib/util/date-utility.js` (modified — added optional weekStartDay parameter to weekStartFromDateInput, weekEndFromDateInput, weekBoundariesFromDateInput, weekDateSlotsFromDateInput; added weekStartDayFromFormat helper)
- `jest.config.js` (modified — added dashboard-setting-note to module name mapper)

**Task:** Add global time/date format settings persisted to a dedicated plugin settings note, with locale-aware defaults
**Prompt summary:** "add Time & Date format section to dashboard settings popup, create DashboardSettingNote class, propagate settings to all time/week-rendering components"
**Scope:** ~180 lines of new logic across 10 files
**Notes:** Settings are stored in an archived note named "Mission Control Dashboard: plugin settings" (same pattern as dream-task daily notes). Locale detection uses Intl.DateTimeFormat and Intl.Locale APIs. Calendar's local week-start config was removed in favor of the global setting.

---

## 2026-04-09 — DaySketch logic extraction into hooks/helpers + enable up/down arrows

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/day-sketch.js` (modified — extracted persistence/loading flow, agenda prefill, keyboard navigation, row renderer, and save-button builder out of component body)

**Task:** Refactor DaySketch to avoid a large monolithic component body by moving behavior into standalone hooks/local functions
**Prompt summary:** "Revise day-sketch.js so logic isn't a huge block in component body; move as much as possible into hooks/local functions"
**Scope:** ~180 lines reorganized across 1 file (logic moved, behavior preserved)
**Notes:** `DaySketchWidget` now composes `useDaySketchEntries`, `useDaySketchAgendaPrefill`, and `useDaySketchInputNavigation`, with rendering delegated to focused local helpers.

---

## 2026-04-05 — DreamTask card actions and replacement flow

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/dream-task.js` (modified — added action links per card, preserve toggle, complete/remove fade-and-replace behavior, confetti trigger, and split render-vs-generate counts usage)
- `lib/dashboard/dream-task-internals.js` (modified — introduced `_taskGenerateCount`, changed `_maxTasksFromGrid` to visible-card count, added metadata update bridge helper)
- `lib/dream-task-service.js` (modified — added suggestion IDs + metadata parsing/serialization, filtered dismissed tasks from cache/fresh merge, exported note metadata updater)
- `lib/dashboard/styles/dream-task.scss` (modified — card action-row styles and dismissal fade animation)
- `package.json` (modified — added `canvas-confetti`)
- `package-lock.json` (modified — lockfile update for `canvas-confetti`)

**Task:** Add per-card DreamTask links for preserve/complete/remove with note-backed metadata and replacement from pre-generated task pool
**Prompt summary:** "after each explanation add preserve/mark complete/remove links; complete/remove should fade out and show next task; split max visible from generation count"
**Scope:** ~220 lines of new/changed logic across 4 source files + dependency update
**Notes:** Preserve status is persisted via suggestion metadata in the daily note; complete/remove mark metadata and immediately remove the card from UI so the next pre-generated suggestion fills in when available.

---

## 2026-04-05 — DreamTask reseed provider chooser

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/dream-task-provider-selection.js` (created — provider-key detection + reseed chooser prompt)
- `lib/dashboard/dream-task.js` (modified — reseed flow now prompts for provider when multiple keys are configured and passes provider override to analysis)
- `lib/dashboard/dream-task-internals.js` (modified — forwards provider override through refresh/fetch helpers)
- `lib/dream-task-service.js` (modified — supports provider override via `providerEmOverride` in LLM options and attribution resolution)
- `test/dream-task-provider-selection.test.js` (created — unit tests for configured-provider detection and chooser behavior)

**Task:** On DreamTask "Reseed", ask which provider to use when multiple AI API keys are configured
**Prompt summary:** "When clicking Reseed, detect multiple keys and let the user pick which LLM provider to use"
**Scope:** ~120 lines of new/changed logic across 4 source files plus 1 new test file
**Notes:** The chooser appears only when more than one provider key is configured; canceling the dialog aborts reseed; single-key and zero-key setups continue without a prompt.

---

## 2026-04-05 — DreamTask widget LLM attribution footer

**Model:** claude-opus-4-6
**Files created/modified:**
- `lib/dream-task-service.js` (modified — `llmAttributionFooter` on analyze results; fresh vs cached strings)
- `lib/dashboard/dream-task-internals.js` (modified — `applyDreamTaskAnalysisResult` sets footer state)
- `lib/dashboard/dream-task.js` (modified — footer under task list)
- `lib/dashboard/styles/dream-task.scss` (modified — `.dream-task-llm-attribution`)

**Task:** Show which provider/model produced suggestions below the cards
**Prompt summary:** "print which LLM provider generated the suggestions at the bottom of the widget"
**Scope:** ~60 lines across 4 files
**Notes:** Fresh runs use `Generated by {Provider} · {model}`; cached note path uses dashboard AI name because the note does not store the original provider.

---

## 2026-04-04 — Per-provider API key storage, providerApiKey prop, settings auto-populate

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/providers/ai-provider-settings.js` (modified — `apiKeyFromApp` reads per-provider keys via `apiKeyFromProvider`, falls back to legacy `"LLM API Key"`)
- `lib/dashboard/dashboard.js` (modified — `saveSettings` persists API key to per-provider setting key, computes `providerApiKey` from `configParams` and passes to all widget cells)
- `lib/dashboard/dream-task.js` (modified — accepts `providerApiKey` prop instead of `llmApiKey`, no default args mixed with named args, no direct `app.settings` reads for AI config)
- `lib/dashboard/dashboard-settings-popup.js` (modified — auto-populates API key when provider dropdown changes, sends `apiKeyProvider` to save handler, reads per-provider keys from `configParams`)
- `lib/dashboard/quotes.js` (modified — accepts `providerApiKey` prop, passes to `fetchQuotes`)
- `lib/data-service.js` (modified — `fetchQuotes` accepts `{ apiKey, provider }` parameter, `_readDashboardSettings` reads all per-provider API keys)
- `test/dream-task-retry.test.js` (modified — uses `providerApiKey` prop and `SETTING_KEYS.LLM_API_KEY_ANTHROPIC`)
- `test/dream-task-service.test.js` (modified — uses `SETTING_KEYS.LLM_API_KEY_OPENAI`)
- `test/llm-integration.test.js` (modified — uses `SETTING_KEYS.LLM_API_KEY_OPENAI`)
- `test/dev-app.test.js` (modified — uses `SETTING_KEYS.LLM_API_KEY_OPENAI`)

**Task:** Store API keys per-provider, pass `providerApiKey` prop to AI-using widgets, auto-populate key on provider switch
**Prompt summary:** "store API key per provider (LLM_API_KEY_ANTHROPIC etc.), widgets use providerApiKey prop not app.settings, auto-populate on provider change"
**Scope:** ~80 lines of new/changed logic across 6 source files, ~10 lines across 4 test files
**Notes:** The old generic `LLM_API_KEY` setting key was already removed from SETTING_KEYS (per-provider keys like `LLM_API_KEY_ANTHROPIC` and `apiKeyFromProvider` were already present). This change completes the migration: `apiKeyFromApp` reads per-provider keys, `saveSettings` persists to per-provider keys, widgets receive the resolved key as `providerApiKey` instead of reading `app.settings` directly, and the settings popup auto-fills the stored key when the user switches providers.

---

## 2026-03-25 — Bright link colors in dark mode

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/styles/theme-light.scss` (modified — added `--dashboard-color-link` token)
- `lib/dashboard/styles/theme-dark.scss` (modified — added `--dashboard-color-link` with brighter `#60a5fa`)
- `lib/dashboard/styles/theme-tokens.scss` (modified — added `$color-link` variable)
- `lib/dashboard/styles/agenda.scss` (modified — switched `a` and `.agenda-note-link` from `$color-blue` to `$color-link`)
- `lib/dashboard/styles/amplenote-markdown-render.scss` (modified — switched `a` from `$color-accent` to `$color-link`)
- `lib/dashboard/styles/dream-task.scss` (modified — switched `.dream-task-settings-link` to `$color-link`)
- `lib/dashboard/styles/dashboard-settings-popup.scss` (modified — switched `.dashboard-settings-api-key-link` to `$color-link`)
- `lib/dashboard/styles/planning.scss` (modified — switched `.create-month-plan-link` and `.create-week-plan-link` to `$color-link`)

**Task:** Make anchor tags and link-styled elements brighter and more vivid in dark mode
**Prompt summary:** "Update anchor tags to be bright-colored in dark mode"
**Scope:** New `--dashboard-color-link` / `$color-link` design token; 7 SCSS files updated to use it
**Notes:** Light mode uses same blue (`#5b7bbf`) as before; dark mode uses a more saturated `#60a5fa` instead of the pastel `#8fb2ff`

## 2026-03-25 — Fix task UUID visible in DreamTask widget

**Model:** claude-4.6-opus-high-thinking
**Files modified:**
- `lib/dream-task-service.js` (modified — changed UUID note format from markdown italic to HTML comment; rewrote `_parseCachedTasks` to extract and strip UUID markers from body text)

**Task:** Hide task UUIDs from rendered DreamTask output; only show task text and explanation
**Prompt summary:** "task UUID should not be shown to the user — only the text and reasoning"
**Scope:** ~15 lines changed in 2 functions
**Notes:** The old `*[task:uuid]*` format was markdown italic, which could leak visibly into the explanation field if Amplenote normalized the markdown on read-back. New format uses `<!-- task:uuid -->` HTML comments. Parser supports both formats for backward compatibility with existing notes.

---

## 2026-03-24 — DreamTask round-trip integration test (write→read via real LLM)

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `test/dream-task-service.test.js` (modified — rewrote to make real OpenAI calls and verify write→read round-trip)

**Task:** Replace hard-coded `noteContent` with a round-trip integration test that makes a real LLM call via `OPEN_AI_ACCESS_TOKEN`, lets the service write suggestions to the note, then verifies the service can parse them back from cache
**Prompt summary:** "use OPEN_AI_ACCESS_TOKEN for real LLM calls; mock only the app interface, not the AI"
**Scope:** ~130 lines rewritten in 1 test file (2 test cases)
**Notes:** Uses `dotenv` + `isomorphic-fetch` + `OPEN_AI_ACCESS_TOKEN` for real OpenAI API calls; uses `SAMPLE_TASKS` fixture and mocked quarterly plan note; `itIfKey` pattern skips gracefully when no key is available; 90s timeout per test; structural assertions accommodate non-deterministic LLM output while verifying the round-trip is lossless

---

## 2026-03-24 — Shared splash image utility for quotes and dashboard fallback

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/util/background-splash-images.js` (created — centralized curated splash image list and deterministic `backgroundSplashUrl(size, seed, variant)` selector)
- `lib/dashboard/quotes.js` (modified — removed inline `BG_IMAGES`, added mount-stable background seed, and switched quote tile backgrounds to shared helper URLs)
- `lib/dashboard/dashboard.js` (modified — added deterministic date-based fallback large splash background when no user image is configured)

**Task:** Move quote background image list into a shared utility and use deterministic seeding for stable quote backgrounds plus daily-rotating dashboard fallback backgrounds
**Prompt summary:** "move BG_IMAGES into util/background-splash-images.js; keep quotes stable across rerenders with a seed; use large splash for dashboard when user has no uploaded background, changing by date"
**Scope:** ~55 lines of new utility + ~15 lines of integration changes across 3 files
**Notes:** Quote tiles now remain visually stable for the lifetime of a widget mount via a one-time seed. Dashboard fallback background is deterministic per date key (`currentDate` when available) and is automatically superseded as soon as a user-configured background URL exists.

---

## 2026-03-21 — Widget error boundary and resilient data fetching

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dashboard.js` (modified — added `WidgetErrorBoundary` class component and wrapped each widget cell in it)
- `lib/dashboard/styles/dashboard.scss` (modified — added `.widget-error-fallback` styles)
- `lib/data-service.js` (modified — wrapped `_resolveTaskDomains` in try/catch, switched `Promise.all` to `Promise.allSettled` with `_settledValueOr` helper, hardened `_fetchTasksForDomain` and `_resolveTaskDomains` against bad API responses)
- `lib/dashboard/recent-notes.js` (modified — wrapped `getTaskDomains` call in try/catch, added null guards on domain iteration)
- `lib/dashboard/quick-actions.js` (modified — wrapped `getTaskDomains` call in try/catch, added null guards)
- `lib/dashboard/ai-plugins.js` (modified — wrapped `getTaskDomains` call in try/catch, added null guards)

**Task:** Isolate widget rendering and data fetching failures so one crash doesn't take down the entire dashboard
**Prompt summary:** "wrap each component load in try...catch so failure to render one widget does not disrupt others"
**Scope:** ~90 lines of new logic across 6 files
**Notes:** Two layers of resilience: (1) React error boundary around each widget cell catches render crashes and shows a retry-able fallback, (2) `fetchDashboardData` uses `Promise.allSettled` so a failing Amplenote API call (e.g. `getTaskDomainTasks` throwing internally) returns graceful defaults instead of blocking the entire init. The `getTaskDomains()` call is also guarded in all consumer sites (recent-notes, quick-actions, ai-plugins) since it can throw when domain UUIDs map to missing internal entries.

---

## 2026-03-18 — DaySketch multi-hour scheduled task prefills

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/day-sketch.js` (modified — added duration-aware hour mapping so scheduled tasks can prefill multiple DaySketch rows based on `startAt` and `endAt`)
- `test/day-sketch.test.js` (modified — added regression test asserting a task from 10:16am to 1:18pm pre-fills `10am`, `11am`, and `12pm` rows)

**Task:** Show multi-hour scheduled tasks in multiple hourly DaySketch rows for the current date
**Prompt summary:** "update day-sketch and test so a task from 10:16am to 1:18pm appears in 10am, 11am, and 12pm rows"
**Scope:** ~45 lines of logic and test coverage across 2 files
**Notes:** Prefill logic continues to avoid overwriting non-empty rows and still strips markdown/footnote syntax from task text.

---

## 2026-03-18 — Recent Notes weekly UUID exclusion history

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/recent-notes.js` (modified — added persisted weekday UUID history, past-week exclusion filtering, and automatic reset when all stale candidates have been shown)
- `lib/data-service.js` (modified — includes `dashboard_recent-notes_config` in dashboard settings hydration so history is available after init)

**Task:** Persist day-by-day UUIDs of shown Recent Notes candidates and avoid re-suggesting notes shown within the last week
**Prompt summary:** "persist to app settings a Monday/Tuesday... map of shown note UUIDs; skip UUIDs from the past week; clear past-week values when all eligible notes are exhausted"
**Scope:** ~90 lines of logic added across 2 files
**Notes:** History is stored at `dashboard_recent-notes_config` in `{ Monday: [...], ... }` shape and updated after each successful suggestion fetch.

---

## 2026-03-16 — DaySketch: notebook-paper day planner widget

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/day-sketch.js` (created)
- `lib/dashboard/styles/day-sketch.scss` (created)
- `lib/constants/settings.js` (modified — added day-sketch to WIDGET_REGISTRY)
- `lib/dashboard/dashboard.js` (modified — imported DaySketchWidget, created DaySketchCell, added to CELL_COMPONENTS)

**Task:** Create a DaySketch widget that renders a notebook-paper-style day planner with one text input per hour (6am–9pm), persists entries to a "Day Sketch [date]" note with the dashboard plugin tag, pre-loads from existing notes, pre-fills empty hours from agenda tasks, and auto-saves via 10-second debounce or on blur
**Prompt summary:** "create a DaySketch component with notebook paper background, hour-by-hour inputs, note persistence"
**Scope:** ~220 lines of component logic + ~130 lines of SCSS + registry/dashboard wiring
**Notes:** Uses debounced auto-save (10s idle) plus blur-triggered save. Save button in header shows dirty state. Supports up to 4 wide × 2 tall grid cells, defaults to 2 wide × 1 tall.

---

## 2026-03-16 — DreamTask: 50% existing tasks + click-to-create for invented tasks

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dream-task-service.js` (modified — restructured `analyzeDreamTasks` to fetch domain tasks before cache check; added `_findBusiestNoteUUID`, `_enforceExistingTaskMinimum`; updated `_validateTasks` to track existing vs invented tasks by UUID; updated `_buildPrompt` to require at least 50% existing tasks with UUIDs; updated `_parseCachedTasks` and `_formatTasksForNote` to persist UUID metadata)
- `lib/dashboard/dream-task.js` (modified — updated `handleTaskClick` to navigate to existing tasks in their notes or create invented tasks via `app.insertTask` in the busiest note; added `defaultNoteUUID` state; updated `renderTaskList` with visual indicators for invented tasks)
- `lib/dashboard/styles/dream-task.scss` (modified — added `.dream-task-card--invented` and `.dream-task-new-badge` styles)

**Task:** Ensure at least 50% of DreamTask suggestions are existing tasks from `getTaskDomainTasks`; clicking invented tasks creates them in the note with the most tasks
**Prompt summary:** "at least 50% of suggested tasks should be existing tasks; clicking on non-existing task creates it in the busiest note via app.insertTask"
**Scope:** ~120 lines of new/modified logic across 3 files
**Notes:** The LLM prompt now requires existing task UUIDs in responses; `_enforceExistingTaskMinimum` supplements with top-ranked tasks if the LLM under-delivers; task-to-note mapping built from `task.noteUUID` enables direct navigation to existing tasks

---

## 2026-03-15 — Peak Hours widget: fetch full month of completed tasks

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/peak-hours.js` (modified — replaced `completedTasksByDate` prop with `app`/`selectedDate`/`currentDate`; widget now fetches all completed tasks for the full month via `app.getCompletedTasks`)
- `lib/dashboard/dashboard.js` (modified — updated PeakHoursCell to pass `app`, `selectedDate`, `currentDate` instead of `completedTasksByDate`)

**Task:** Make Peak Hours widget retrieve ALL tasks completed during the currently selected month instead of only the ~7-day window provided by the dashboard's weekly fetch
**Prompt summary:** "peak-hours should retrieve ALL tasks completed during the month that is currently selected"
**Scope:** ~30 lines changed across 2 files
**Notes:** Uses `monthBoundaries()` helper to compute month start/end as Unix seconds; caches by month key to avoid duplicate fetches; footer now shows full month name

---

## 2026-03-14 — Peak Hours widget: rewrite as project-native component

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/peak-hours.js` (rewritten — replaced web-sourced prototype with project-native widget using createElement, WidgetWrapper, and completedTasksByDate from dashboard)
- `lib/dashboard/styles/peak-hours.scss` (created — standalone stylesheet using theme tokens; responsive chart heights for grid size variants)
- `lib/constants/settings.js` (modified — added peak-hours entry to WIDGET_REGISTRY)
- `lib/dashboard/dashboard.js` (modified — added PeakHoursWidget import, PeakHoursCell, and CELL_COMPONENTS entry)

**Task:** Rewrite peak-hours.js into a project-convention widget that receives completed tasks from the dashboard and analyzes createdAt/completedAt timestamps in the user's local time zone
**Prompt summary:** "rewrite peak-hours.js to match project conventions with standalone stylesheet; receive all tasks from dashboard; translate createdAt and completedAt to user's local time zone"
**Scope:** ~250 lines of new/rewritten logic across 4 files
**Notes:** Canvas chart reads CSS custom properties at draw time for theme-aware colors (light/dark mode). Timestamps are treated as unix seconds and converted to local Date objects via `new Date(ts * 1000)`, so `getHours()` returns the hour in the user's local time zone. Falls back to `startAt` when `createdAt` is unavailable.

---

## 2026-03-14 — Amplenote Rich Footnote rendering with tippy popups

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/util/amplenote-markdown-render.js` (created)
- `lib/dashboard/styles/amplenote-markdown-render.scss` (created)

**Task:** Render Amplenote Rich Footnotes as interactive links with content-type indicator icons (image, video, URL, text) and tippy popups that display the footnote content
**Prompt summary:** "implement rich footnotes rendering with icons and tippy popups for text, images, video, URL"
**Scope:** ~250 lines of new logic across 2 files
**Notes:** `amplenoteMarkdownRender(markdown)` is a drop-in replacement for `renderMarkdown` that parses `[^N]:` footnote definitions, replaces `[text][^N]` references with enhanced links, and adds data attributes for popup content. `attachFootnotePopups(containerEl)` must be called after DOM insertion to wire up tippy instances. Supports images, video (YouTube/Vimeo/direct), URLs, and description text.

---

## 2026-03-14 — Update mood visualization scale from 1–5 to -2..+2

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/mood.js` (modified — removed `toVizScale()` mapping layer; changed `VISUALIZATION_MOOD_COLORS` and `VISUALIZATION_MOOD_EMOJIS` to use -2..+2 keys; updated WaveGraph y-axis labels from 1–5 to -2..+2 with `+` prefix for positive values; updated all y-position formulas in WaveGraph and RadialRing to use `(val + 2) / 4` instead of `(val - 1) / 4`)

**Task:** Display mood wave and ring visualizations on the native -2 to +2 scale instead of an internal 1–5 mapping
**Prompt summary:** "update the mood wave visualization to be on a scale from -2 to +2 instead of 1 to 5"
**Scope:** ~30 lines changed across 6 locations in 1 file
**Notes:** The plugin already stored mood values as -2..+2; this removes the unnecessary intermediate 1..5 scale that was only used for rendering

---

## 2026-03-14 — Rename settings state to configParams; fix API key not persisting

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dashboard.js` (modified — renamed `settings`/`setSettings` state to `configParams`/`setConfigParams`; `DashboardSettingsPopup` now receives `configParams` as a prop; removed `app.settings` mirroring hack)
- `lib/dashboard/dashboard-settings-popup.js` (modified — reads initial values from `configParams` prop instead of `app.settings`)
- `build/compiled.js` (rebuilt)

**Task:** Disambiguate component state from `app.settings` and fix API key persistence bug
**Prompt summary:** "rename the component's state variable to configParams; ensure app.setSetting is used per API docs"
**Scope:** ~20 lines changed across 2 files
**Notes:** Root cause: `DashboardSettingsPopup` read its initial values from `app.settings`, an in-memory Proxy object. Per the Amplenote API docs, `app.settings` is "not guaranteed to be updated" after `app.setSetting` calls. The popup now reads from a `configParams` React state prop that is always up to date. The `settings`→`configParams` rename eliminates the naming collision between the React state and the Amplenote `app.settings` API property.

---

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/draggable-heading.js` (modified — replaced mixed JSX/createElement subtitle markup with clean `widget-title__label` / `widget-title__subtitle` elements)
- `lib/dashboard/styles/dashboard.scss` (modified — added flex layout to `.widget-title` and styled `.widget-title__subtitle` with muted color, smaller font, no uppercase)
- `lib/dashboard/widget-wrapper.js` (modified — added `@param` JSDoc for `subtitle` prop)

**Task:** Allow a subtitle string to appear to the right of the widget module title with lighter, smaller text
**Prompt summary:** "allow a subtitle as a string with lighter color text that resides to the right of the module title"
**Scope:** ~15 lines changed across 3 files
**Notes:** Subtitle uses `$color-text-muted`, `0.75rem`, normal weight, and no uppercase transform; title uses `align-items: baseline` so short and tall text stay optically aligned

---

## 2026-03-14 — DreamTask: grid-based task count, reseed link, and seen-UUID exclusion

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `lib/dashboard/dream-task.js` (modified — `gridWidthSize` prop; `maxTasks = width × height`; seen-UUIDs tracking; reseed header link)
- `lib/dream-task-service.js` (modified — `excludeUuids` param; filters candidate tasks before LLM; bypasses cache on reseed; returns `shownUuids`)
- `lib/dashboard/styles/dream-task.scss` (modified — `.dream-task-header-actions` flex row for multiple header links)
- `lib/dashboard/dashboard.js` (modified — pass `gridWidthSize` to `DreamTaskCell`)

**Task:** Show tasks equal to grid cell count; add reseed link that excludes recently-shown task UUIDs
**Prompt summary:** "show as many tasks as cells; add reseed link that excludes seen UUIDs; store daily UUID hash in app.setSetting"
**Scope:** ~80 lines changed/added across 4 files
**Notes:** Seen UUIDs stored under `dashboard_dream-task_seen_uuids` as `{ [YYYY-MM-DD]: [uuid, ...] }`. Entries older than 7 days are pruned on each load. The "Reseed" header link feeds the full 7-day exclusion set to `analyzeDreamTasks`, which bypasses the daily cache and filters the task candidate pool before ranking and sending to the LLM. The service returns `shownUuids` (the ranked candidates sent to the LLM) so the widget can record them — the LLM-suggested tasks themselves may not carry UUIDs.

---

## 2026-03-14 — DreamTask: pointer cursor and click-to-navigate on task text

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dashboard/dream-task.js` (modified — task title clickable, navigates to task in note via section anchor)
- `lib/dashboard/styles/dream-task.scss` (modified — pointer cursor and hover styles for clickable task title)

**Task:** Hovering on task text shows pointer cursor; clicking navigates to the task in its note
**Prompt summary:** "Hovering on the task text should show a pointer cursor, and clicking on the task text in dream-task.js should navigate to the task in its note"
**Scope:** ~25 lines across 2 files
**Notes:** Uses Amplenote section anchor format (heading text with spaces→underscores) for deep-link navigation. In dev mode, opens NoteEditor same as Note link.

---

## 2026-03-14 — DreamTask: call analyzeDreamTasks directly instead of app.dreamTaskAnalyze bridge

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/dream-task.js` (modified — removed duplicate note lifecycle functions, import and call `analyzeDreamTasks` directly from `dream-task-service`)
- `lib/dream-task-service.js` (modified — dropped unused `plugin` parameter from `analyzeDreamTasks`)
- `lib/plugin.js` (modified — removed `dreamTaskAnalyze` bridge case and `analyzeDreamTasks` import)
- `lib/util/browser-dev-app.js` (modified — removed `dreamTaskAnalyze` mock method)

**Task:** `dreamTaskAnalyze` was not a real `app` method in the native Amplenote plugin environment — it only worked via the `onEmbedCall` bridge in `plugin.js`. Refactored so `dream-task.js` imports and calls `analyzeDreamTasks` from `dream-task-service.js` directly, eliminating the bridge indirection and ~100 lines of duplicate note lifecycle code (`initializeMonthlyNote`, `checkExistingAnalysis`, `writeTodayAnalysis`, `runDreamTaskAnalysis`).
**Prompt summary:** "dreamTaskAnalyze is not a method of app within the native plugin environment. Revise the implementation so that it is functional in either the native production environment or the dev environment."
**Scope:** ~100 lines removed from `dream-task.js`, minor edits to 3 other files
**Notes:** `llmPrompt` in `fetch-ai-provider.js` does not use its `plugin` parameter, so `analyzeDreamTasks` now passes `null` for it. The widget calls `analyzeDreamTasks(app)` directly in both dev and production environments.

---

## 2026-03-14 — DreamTask service: remove abbreviations from variable and method names

**Model:** claude-sonnet-4-6
**Files created/modified:**
- `lib/dream-task-service.js` (modified — expanded all abbreviated names)

**Task:** Replace abbreviated variable and method names with full descriptive names
**Prompt summary:** "Update lib/dream-task-service.js not to use abbreviations for any variable or method names"
**Scope:** ~25 renames across the file
**Notes:** Changes include: `t`→`task`, `n`→`note`, `s`→`scoredEntry`, `taskJsons`→`taskJsonObjects`, `err`→`error`, `raw`→`rawValue`, `stored`→`parsedSettings`, `match`→`regexMatch`, `firstTaskIdx`→`firstTaskIndex`, `dlSec`→`deadlineSeconds`, `nowSec`→`nowSeconds`, `startSec`→`startSeconds`, `a,b`→`first,second`, `i`→`index`, `uuid`→`uniqueIdentifier`, `json`→`taskJsonObject`, `_buildTaskJson`→`_buildTaskJsonObject`

---

## 2026-03-14 — DreamTask: goals summary, task ranking, and full task JSON for LLM

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dream-task-service.js` (modified — added goals summary generation, weekly plan fetching, task ranking by attributes, full task JSON for LLM evaluation)
- `lib/dashboard/dream-task.js` (modified — parse and display goals summary from cached/fresh results)
- `lib/util/browser-dev-app.js` (modified — added goalsSummary to dreamTaskAnalyze mock)
- `lib/dashboard/styles/dream-task.scss` (modified — added goals summary styling)

**Task:** Enhance DreamTask analysis to summarize quarter/month/week goals before task recommendations, rank tasks by all attributes (important, urgent, score/value, deadline), and send top candidate task JSONs to the LLM
**Prompt summary:** "begin date content with goals summary, consider all task attributes, send top 10%/50 tasks as JSON to LLM"
**Scope:** ~130 lines of new logic across 4 files
**Notes:** Task ranking uses a weighted scoring system (important +20, urgent +15, overdue +25, high score +15/+8). Top min(10%, 50) tasks sent as Amplenote task-type JSON objects. Goals summary capped at 500 chars, written to note before task list.

---

## 2026-03-14 — Remove underscore prefix from component SCSS filenames

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/styles/_agenda.scss` → `agenda.scss`
- `lib/dashboard/styles/_calendar.scss` → `calendar.scss`
- `lib/dashboard/styles/_config-popup.scss` → `config-popup.scss`
- `lib/dashboard/styles/_dashboard-layout-popup.scss` → `dashboard-layout-popup.scss`
- `lib/dashboard/styles/_dashboard-settings-popup.scss` → `dashboard-settings-popup.scss`
- `lib/dashboard/styles/_dashboard-tippy.scss` → `dashboard-tippy.scss`
- `lib/dashboard/styles/_dream-task.scss` → `dream-task.scss`
- `lib/dashboard/styles/_mood.scss` → `mood.scss`
- `lib/dashboard/styles/_planning.scss` → `planning.scss`
- `lib/dashboard/styles/_quick-actions.scss` → `quick-actions.scss`
- `lib/dashboard/styles/_quotes.scss` → `quotes.scss`
- `lib/dashboard/styles/_recent-notes.scss` → `recent-notes.scss`
- `lib/dashboard/styles/_theme.scss` → `theme.scss`
- `lib/dashboard/styles/_theme-dark.scss` → `theme-dark.scss`
- `lib/dashboard/styles/_theme-light.scss` → `theme-light.scss`
- `lib/dashboard/styles/_theme-tokens.scss` → `theme-tokens.scss`

**Task:** Remove the SCSS partial underscore prefix from all component stylesheets
**Prompt summary:** "ensure we have renamed any stylesheets for a component not to be prefixed by the underscore"
**Scope:** 16 file renames
**Notes:** Sass `@use` and `@forward` resolve both `_foo.scss` and `foo.scss`, so no import changes needed

---

## 2026-03-14 — Replace global callPlugin with app object abstraction

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/util/create-app.js` (deleted — production app factory was unnecessary; the real Amplenote app flows through the callAmplenotePlugin bridge)
- `lib/util/browser-dev-app.js` (modified — expanded from partial DreamTask mock to full dev app simulating all Amplenote plugin API methods)
- `lib/dashboard/client-entry.js` (modified — dev creates simulated app via createBrowserDevApp; production uses a Proxy over callAmplenotePlugin)
- `lib/dashboard/dashboard.js` (modified — accepts app prop, passes to all widgets, extracted helper functions accept app parameter)
- `lib/util/goal-notes.js` (modified — all functions accept app as first parameter instead of calling callPlugin)
- `lib/dashboard/agenda.js` (modified — accepts app prop, uses app.navigateToTask/navigateToNote)
- `lib/dashboard/calendar.js` (modified — accepts app prop, uses app.saveSetting)
- `lib/dashboard/mood.js` (modified — accepts app prop, uses app.recordMoodRating/saveMoodNote/saveSetting)
- `lib/dashboard/note-editor.js` (modified — accepts app prop, passes to goal-notes functions)
- `lib/dashboard/planning.js` (modified — accepts app prop, passes to goal-notes functions)
- `lib/dashboard/quotes.js` (modified — accepts app prop, uses app.fetchQuotes)
- `lib/dashboard/quick-actions.js` (modified — accepts app prop, uses app.navigateToUrl/randomNote/quickAction)
- `lib/dashboard/recent-notes.js` (modified — accepts app prop, uses app.getTaskDomains/getNoteTasks/navigateToNote)
- `lib/dashboard/ai-plugins.js` (modified — accepts app prop, uses app.getTaskDomains/getNoteTasks/navigateToNote)
- `lib/dashboard/task-domains.js` (modified — accepts app prop, uses app.refreshTaskDomains/setActiveTaskDomain/navigateToUrl)
- `lib/dashboard/victory-value.js` (modified — accepts app prop, uses app.saveSetting)
- `lib/dashboard/widget-wrapper.js` (modified — accepts app prop, uses app.configure)
- `lib/dashboard/dream-task.js` (modified — passes app to NoteEditor)
- `lib/dashboard/dashboard-settings-popup.js` (modified — accepts app prop, passes to useBackgroundUploadFields)
- `lib/hooks/use-completed-tasks.js` (modified — accepts app parameter, uses app.getCompletedTasks)
- `lib/hooks/use-background-upload-fields.js` (modified — accepts app in options, uses app.uploadBackgroundImage)
- `lib/embed-html.js` (modified — removed callPlugin global injection script tag)
- `dev/index.html` (modified — removed mock-data.js script tag)
- `dev/mock-data.js` (deleted — functionality absorbed into browser-dev-app.js)

**Task:** Replace the global `callPlugin` function pattern with a structured `app` object interface. In production, the real Amplenote `app` (passed to `renderEmbed`) flows through the `callAmplenotePlugin`/`onEmbedCall` bridge — the client uses a lightweight Proxy to call methods by name. In development, `browser-dev-app.js` provides a full simulation via the dev server's REST API. All widgets, hooks, and utility modules now receive `app` as a prop or parameter instead of calling a global function.
**Prompt summary:** "rewrite plugin so widgets receive app object directly instead of using callPlugin"
**Scope:** ~500 lines of modified logic across 24 files (2 deleted, 22 modified)
**Notes:** No `createProductionApp` factory is needed — in production, the Amplenote `app` is passed to every invocation method including `renderEmbed`, and the embed's `callAmplenotePlugin` bridge routes calls to `onEmbedCall(app, ...)`. The `callPlugin` global is no longer injected or referenced in client code. Prop drilling was chosen over React Context to match existing codebase patterns.

---

## 2026-03-14 — Extract drag-reorder logic into useDashboardDrag hook

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/dashboard/draggable-heading.js` (modified — added `useDashboardDrag` hook, `moveWidgetBefore`, `widgetRectsById`, `animateReorderedWidgets`, `widgetOrder`, and FLIP animation utilities)
- `lib/dashboard/dashboard.js` (modified — removed drag utility functions and all drag-related state/effects from `DashboardApp`, replaced with single `useDashboardDrag` hook call)

**Task:** Move all widget drag-reorder functionality out of `dashboard.js` into `draggable-heading.js`, consolidating the `DraggableHeading` component (long-press event emitter) with the drag state management, mouse tracking, FLIP animations, and layout persistence into a single module. The `useDashboardDrag` custom hook encapsulates all drag state (`draggingWidgetId`, `displayedComponents`) and five `useEffect`/`useLayoutEffect` hooks previously scattered through `DashboardApp`.
**Prompt summary:** "move as much of the widget dragging functionality as possible out of dashboard and into draggable-heading.js"
**Scope:** ~130 lines moved/refactored across 2 files; dashboard.js reduced by ~90 lines
**Notes:** Grid-cell layout helpers (`gridCellStyle`, `gridCellClassName`, `gridCellContainerProps`) remain in `dashboard.js` since they serve the widget cell factory, not drag logic specifically.

---

## 2026-03-14 — Animate widget repositioning during drag reorder

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/dashboard.js` (modified — added FLIP-based reorder animation: captures cell rects before reorder and animates non-dragged widgets to new positions)
- `lib/dashboard/styles/dashboard.scss` (modified — added CSS transform variables for flip offset and drag scale; moved drag-shift effect to `--drag-scale`)
- `build/compiled.js` (modified — rebuilt bundle via `npm run build` to include reorder animation changes)
- `AI_CONTRIBUTIONS.md` (modified — added this entry)

**Task:** Smoothly animate widgets into their new positions while dragging a widget through the grid.
**Prompt summary:** "Animate the repositioning of widgets when a widget is dragged from one place to another"
**Scope:** ~55 lines of animation logic and style changes across dashboard source files, plus compiled bundle refresh
**Notes:** Reordering now uses a FLIP transition on affected grid cells so neighbors slide into place instead of snapping; the actively dragged widget is excluded from the FLIP step.

---

## 2026-03-14 — Long-press draggable widget headings with persisted dashboard reordering

**Model:** gpt-5.3-codex
**Files created/modified:**
- `lib/dashboard/draggable-heading.js` (created — new shared heading component with `useEffect` long-press detection and drag-ready event dispatch)
- `lib/dashboard/widget-wrapper.js` (modified — all widgets now render a common `DraggableHeading` heading bar)
- `lib/dashboard/dashboard.js` (modified — listens for drag-ready events, reorders widgets during drag, and persists layout order on mouse release)
- `lib/dashboard/styles/dashboard.scss` (modified — added heading/drag classes plus wobble and drag-shift animations)
- `AI_CONTRIBUTIONS.md` (modified — added this entry)

**Task:** Add a new DraggableHeading component and implement long-press (2s) drag reordering behavior for dashboard widgets, including visual drag affordances and persisted layout order.
**Prompt summary:** "Create DraggableHeading with a useEffect that monitors long mousedown, wobble when ready, slide other widgets, and persist layout order on release"
**Scope:** ~140 lines across 4 dashboard files + documentation update
**Notes:** Long-press detection is centralized in `DraggableHeading` via a `dashboard:widget-drag-ready` custom event; DashboardApp performs live reorder by hovering over other widget cells while the mouse remains down, then calls `saveLayout` with the reordered widget IDs when the mouse is released.

---

## 2026-03-14 — Dev app: filterNotes searches /notes directory frontmatter; notesDir parameterized for tests

**Model:** claude-4.6-sonnet-medium-thinking
**Files created/modified:**
- `dev/dev-app.js` (modified — `createDevApp` accepts optional `notesDir`; all note file I/O uses it; `filterNotes` stub replaced with real frontmatter scan)
- `test/dev-app.test.js` (modified — each test uses isolated `tmpNotesDir`; new `filterNotes` describe block with 5 cases)

**Task:** Make `app.filterNotes` work in dev mode by scanning `/notes` files for frontmatter title matches, and add tests that write fixture files into a temp directory to confirm the lookup works
**Prompt summary:** "add a dev-environment test that places a file in the notes/ directory for the test, then confirms that the note is located when app.filterNotes is subsequently called"
**Scope:** ~40 lines modified in dev-app.js, ~80 lines added in test
**Notes:** `notesDir` defaults to `NOTES_DIR` so production dev-server usage is unchanged; tests are fully isolated using `os.tmpdir()` scratch directories cleaned up in `afterEach`

---

## 2026-03-14 — Planning widget: shared goal-notes library, Month class, weekly plan, dev note editor

**Model:** claude-4.6-opus-high-thinking
**Files created/modified:**
- `lib/constants/quarters.js` (modified — added `Month` class, `getUpcomingWeekMonday`, `formatWeekLabel`, `defaultWeekTemplate`)
- `lib/util/goal-notes.js` (created) — shared library for reading/writing goal notes via callPlugin
- `lib/dashboard/note-editor.js` (created) — dev-mode inline textarea editor with save/back
- `lib/dashboard/planning.js` (modified — refactored to use goal-notes library, added weekly plan section for 2-tall, integrated dev note editor)
- `lib/dashboard/dream-task.js` (modified — uses `navigateToNote` from goal-notes, dev note editor support)
- `lib/dashboard/dashboard.js` (modified — passes `gridHeightSize` to PlanningWidget)
- `lib/dashboard/styles/_planning.scss` (modified — added weekly plan section and note editor styles)
- `lib/data-service.js` (modified — added `createOrAppendWeeklyPlan` function)
- `lib/plugin.js` (modified — added `createOrAppendWeeklyPlan` dispatch)
- `dev/dev-server.js` (modified — added note CRUD API endpoints: note-content, note-create, note-append, note-find)
- `dev/mock-data.js` (modified — added handlers for getNoteContent, replaceContent, getNoteSections, getMonthlyPlanContent, createQuarterlyPlan, createOrAppendMonthlyPlan, createOrAppendWeeklyPlan)

**Task:** Refactor planning infrastructure: formalize Month type, extract shared goal-note library, add weekly planning, and build dev-mode note editor
**Prompt summary:** "expand month into class, shared goal-note library for planning+dream-task, weekly plan section when 2-tall, dev note editor with save/back"
**Scope:** ~350 lines of new logic across 11 files
**Notes:** The `Month` class in quarters.js makes the month object shape explicit. The `goal-notes.js` library wraps callPlugin calls for note operations and handles dev-mode devEdit signaling. Weekly plan appears when gridHeightSize >= 2, targeting the upcoming Monday (visible from Saturday). Dev note editor intercepts navigateToNote in IS_DEV_ENVIRONMENT, showing an inline textarea backed by /notes/ files via new dev-server API endpoints.

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
- `lib/dashboard/dashboard-tooltip-tippy.js` (created — `DashboardTippy` React component and `useCanvasTippy` hook wrapping tippy.js)
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

**Task:** Add a "Dashboard Settings" popup accessible from the toolbar, featuring an AI Settings section with an LLM provider dropdown and an API key input with show/hide toggle. Selections are persisted to `app.settings` via `SETTING_KEYS.LLM_PROVIDER_MODEL` and `SETTING_KEYS.LLM_API_KEY` and pre-populated on subsequent visits.
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
