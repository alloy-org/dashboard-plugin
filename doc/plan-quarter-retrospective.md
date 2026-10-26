# Plan: Quarter Retrospective

Written October 26, 2026. This is a working plan for progressive commits, not a specification. Each phase should
leave the suite green, `npm run build` passing, and the production bundle smoke test passing.

## Status (October 26, 2026)

Parts 1 and 2 of the original five-part outline are committed. This plan replaces parts 3–5 with phases 3–10 below,
because the scope grew to include generation styles, LLM-written stories, a payoff ranking for projects, and a
takeaways note.

| Part | Commit | What it holds |
|------|--------|---------------|
| 1 | `aa77ea3` | `retrospective-statistics.js`, `retrospective-data.js`, `retrospective-slides.js`, statistics tests |
| 2 | `7eef62c` | `retrospective-slide.jsx`, `retrospective-story.jsx`, `retrospective-overlay.jsx`, `quarter-retrospective.scss`, story tests |

Nothing imports these modules yet, so the retrospective is unreachable in the app.

Phase 3 (calendar journal) is committed. Phase 4 (entry point) is built and uncommitted. Phases 5–10 are not started.

## Goal

Clicking a past quarter in Quarterly Planning opens the Quarter Retrospective for the active task domain. If a
retrospective was generated for that quarter, it plays. Otherwise the user chooses a style and the plugin builds
one, which takes about three minutes. The retrospective should help the user see how much forward progress the
quarter's work amounted to, measured against where they stood when the quarter began.

Every retrospective belongs to one task domain and one quarter. Its data is stored in an archived note per domain,
quarter, and style.

## Platform constraints that shape the design

These come from the API docs and the existing code. Each one changes a phase below.

- **The calendar can't look back.** `app.getExternalCalendarEvents({ days, taskDomainUUID })` reads a cache that
  starts at the start of today and covers 1–30 days ahead. It has no past range. A retrospective can include calendar
  events only if the plugin recorded them while they were current. Phase 3 therefore starts a calendar journal right
  away. Quarters that ended before the journal existed get no calendar section, and the copy says so plainly.
- **`callLLM` takes text only.** `amplenoteLlmPrompt` (`lib/providers/amplenote-llm.js`) sends a single text user
  message, and no call site sends images. The LLM can't see images. It can still pick among image URLs from their
  alt text, the Rich Footnote text around them, and the task they belong to. Every URL it returns must be checked
  against the set we collected, so an invented URL never renders.
- **JSON comes back as text.** `jsonResponse` runs `extractJsonFromString`, which scans for the first `{`. Every
  response gets validated against a schema, with a deterministic fallback.
- **The note write cap is 200,000 characters per call** (`NOTE_WRITE_CHARACTER_LIMIT`, with a backstop at 95%).
  Section-scoped `replaceNoteContent` with `{ section: { heading } }` keeps each write under the cap, the same way
  `completed-task-project-ledger.js` writes one day at a time.
- **The default LLM timeout is 60 seconds.** Month digests and story generation pass a longer `timeoutSeconds` and
  run months in parallel, which keeps the whole run near three minutes.
- **No audio exists in the plugin today.** Audio needs a user gesture to start. Choosing a style on the options
  screen is a click, so playback can start inside that gesture's call stack or later through a "Play with sound"
  control. That the embed (a `data:` URL page with an opaque origin) can play audio is untested.
- **Victory Value comes from the host** (`task.victoryValue`), raised by the ledger's `appliedVictoryValue`.
  Part 1 already takes the larger of the two.

## The flow

1. **Click a past quarter.** `handleQuarterCardClick` (`lib/dashboard/planning.jsx:585`) returns early today for a
   past quarter without a note. For one with a note, it opens Plan Builder for that past quarter. Both cases change
   so that a past quarter opens the retrospective. The plan note stays reachable from a link in the retrospective's
   header. Past cards with no plan note become clickable too, since completed tasks exist without a plan.
2. **Look for existing retrospectives.** Find the domain-quarter's data notes, one per style.
   - **None found:** show the options screen.
   - **One or more found:** play the most recently generated (decided). A style switcher lists the others alongside
     "Generate new".
3. **Options screen.** Three style cards: **Data**, **Roast**, **Spotify**. Below them sit a few toggles, each shown
   only when it applies:
   - include calendar events, when the journal covers the quarter;
   - include images from my notes, when any were found;
   - play music, for Spotify only.
4. **Processing screen,** about three minutes. A progress bar driven by `useElapsingProgress` targets 180 seconds,
   with step labels such as "Reading July's 212 completed tasks…". When projects were found, the payoff ranking
   (phase 9) appears here, so the wait becomes useful input instead of idle time.
5. **The story** plays in `RetrospectiveStory`, with style-specific slides.
6. **End card** with three buttons: **Replay retrospective**, **Generate new** (back to the options screen), and
   **Save takeaways in a note**.

## Storage

**Data note** (archived, tagged `plugins/dashboard`): `{domain} Q{q} {year} {Style} Retrospective Data`, for
example `Work Q3 2026 Roast Retrospective Data`. Each `##` section holds one JSON fence and is written with its own
section-scoped call:

| Section | Contents |
|---------|----------|
| `## Request` | Domain name and UUID, quarter, year, style, options, generated-at, version |
| `## Statistics` | Part 1's statistics object, extended per phase 4 |
| `## Projects` | Found projects, or themes inferred from tasks, with how each was derived |
| `## Month 1` / `## Month 2` / `## Month 3` | Each month's LLM digest. A month too large for one section continues as `## Month 1 (continued 2)` |
| `## Calendar` | Event categories per month, from the journal |
| `## Media` | Collected image candidates `{ url, alt, footnoteText, taskUuid }` and the ones the LLM chose |
| `## Story` | The style's slide JSON returned by the LLM, after validation |
| `## Takeaways` | UUID of the takeaways note, once saved |

When a second style is generated for a quarter that already has a data note, read `## Projects`, `## Month N` and
`## Calendar` from the existing note and skip their LLM calls. That cuts "Generate new" to well under a minute.

**Calendar journal** (archived): `{domain} Calendar History {year}`, with one `## YYYY-MM-DD` section per day.

**Payoff rankings** (archived): `{domain} Project Payoff Rankings {year}`, with one `## Q{q}` section per quarter.
This is one note per domain per year, as requested. The name follows `{domain} Mission Builder Vision Guide {year}`
rather than adding a `[plan builder]` suffix, since no note uses that pattern today.

**Takeaways note** (not archived): `{domain} Q{q} {year} Retrospective`. It is the same whatever the style.

All note naming and markdown helpers live in plain `.js` modules under `lib/dashboard/quarter-retrospective/`, so
they stay host-compatible, following CLAUDE.md §6.

## Phases

### Phase 3 — Calendar journal (built, ships first because it can't backfill)

- **`calendar-history-journal.js`** keeps `{domain} Calendar History {year}`, archived, with one `## YYYY-MM-DD`
  section per day. Like the completed task ledger, each section holds readable bullets and a JSON fence. The
  day-ordered insertion the two share now lives in `lib/dashboard/dated-note-sections.js`.
  - Each event keeps `{ allDay, attendeeCount, calendarName, end, start, title }`. Attendee names and descriptions are
    never stored. Declined attendees aren't counted. The user's own declines can't be skipped, since Amplenote leaves
    the user out of an event's attendees.
  - Each day also records `observedOn`, the date it was last seen.
- **`use-calendar-history-journal.js`** records the Dashboard's existing four-day calendar read for the active domain,
  20 seconds after it arrives. Without a domain, nothing is recorded.
- **Changes from the original plan:**
  - **Days are sections, not months.** Each write touches one day, as the ledger does.
  - **The whole window is recorded, not only today.** Each later read replaces a day, so the journal keeps the last
    look before the day ended. A Friday visit still records the weekend, which raises coverage a lot for people who
    don't open the Dashboard every day.
  - **No once-a-day setting.** The session remembers what it last wrote per day, so a refocus with unchanged events
    skips reading the note. A changed calendar is recorded on the next refocus.
  - **An empty read never erases a day that has events,** because the Dashboard's read reports a failed request as no
    events.
  - **No journal for a calendar with no events.** The note is created only once a read holds an event.
- `readCalendarHistory(app, { domainName, startDateKey, endDateKey })` reads a range across years and returns its
  coverage (`{ coveredDays, totalDays }`) for copy such as "Calendar covers 41 of 92 days".
- **Tests:** `test/calendar-history-journal.test.js`.

### Phase 4 — Entry point, data notes, options screen (built)

- **Every past quarter's card** reads "✨ Retrospective" and opens `QuarterRetrospective`
  (`quarter-retrospective.jsx`) in `RetrospectiveOverlay`, whether or not a plan note was recorded. The header holds
  "Open plan note" when the quarter has one, "Play {Style}" for each other saved style, and "Generate new".
- **`retrospective-data-note.js`** reads and writes the data note.
  - Each section is one compact JSON fence, with backticks escaped as `\u0060` so task text can't close the fence.
  - A payload larger than half the write limit continues in `## {Section} (continued N)` sections. Each one is
    appended by its own write, which rewrites only the section before it.
  - Sections are appended in the order a generation produces them. A single-part section, such as Takeaways, can be
    replaced in place. "Generate new" starts the style's note over instead of rewriting multi-part sections.
  - A newly created note is written through the identifier `findNote` resolves, not the local one `createNote`
    returns. The completed task ledger still writes through the local one; see below.
- **`retrospective-generation.js`** generates the Data style from part 1's statistics, writing Request, Statistics,
  and Story. If the note can't be written, the story still plays. Roast and Spotify are refused until phase 7.
- **`retrospective-options.jsx`** shows the three style cards, Roast and Spotify marked "Coming soon", and the calendar
  toggle with "your calendar covers N of M days" when the journal covers any of the quarter. The images and music
  toggles arrive with phases 5 and 8.
- **Tests:** `quarter-retrospective-data-note.test.js`, `quarter-retrospective-entry.test.js`, and the pager test's
  past-card routing. Checked in the dev dashboard: generating Data for Q3 2026, then reopening it.
- **Follow-up:** `openCompletedTaskLedger` writes a new ledger through the identifier `createNote` returned. The plan
  wizard's fixture models that identifier as one the host stops resolving, which would leave a new ledger empty
  until the next run reseeds it. Worth confirming in the live app.

### Phase 5 — Gathering the quarter

Extend `loadRetrospectiveStatistics` into a gatherer that returns everything the LLM steps need:

- **Completed tasks** from `app.getCompletedTasks`, as today. Each one also records:
  - the full task content, including resolved Rich Footnotes (`parsedRichFootnotes`);
  - image URLs found in those footnotes;
  - its note's name and tags (`findNote({ uuid })`, cached per note).
- **Duration default.** Duration falls back to **60 minutes** when a task has neither a span nor a duration. Today
  `scheduledMinutes` returns 0 in that case. Add `defaultedDurationCount` so a slide can say "62 tasks had no length
  set; we counted them as an hour each".
- **Projects** from the ledger (`readCompletedTaskLedger`) and the quarter's Vision Guide prospects. When neither
  yields any project, phase 6 infers themes.
- **Open at quarter end, per project.** Use the project task store (`Project Tasks Q{q} {year} {domain}`) and
  `getTaskDomainTasks`. Count tasks that were created before the quarter ended and were not completed by then.
  - This is only as good as what the store collected, so the slide labels it "tasks we know of".
  - Ledger entries give the done side.
- **Calendar events** for the quarter from the journal.
- Statistics gain:
  - `doneAndOpenByProject`;
  - `monthlyTaskCounts`;
  - `longestStreak` (consecutive days with a completion);
  - `firstAndLastCompletion`;
  - `meetingMinutesByCategory`, when calendar data exists.
- **Tests:** duration default, open-at-quarter-end counting, footnote image extraction from task content.

**Verify early:** check that `getCompletedTasks` returns task content with footnote definitions inline. If it
returns only the reference, the footnotes have to be read from the task's note.

### Phase 6 — Month digests and theme inference (LLM)

Run three month calls in parallel through `amplenoteLlmPrompt` with `jsonResponse` and `timeoutSeconds: 150`.

- **Each call sends:**
  - that month's completed tasks: text, footnote text truncated per task, note name, tags, project, minutes,
    Victory Value;
  - that month's calendar events.
- **Each call returns:**
  `{ highlights: [{ taskUuids, summary }], themes: [{ name, taskUuids }], notableMoments, mood, imageCandidates: [url] }`.
- **When no projects were found,** a fourth call merges the three months' themes into 3–7 inferred projects, each
  with its task UUIDs, and those flow into `## Projects` marked `derivedFrom: "themes"`.
- **Batching.** If a month is too large for one prompt, split it by week and merge the results locally. The prompt
  builder caps characters so long quarters stay bounded.
- **Calendar events are categorized locally first** (recurring 1:1s, team meetings, external, focus blocks, personal)
  from title keywords and attendee counts. The LLM only names and narrates categories, which keeps the payload small.
- **Tests:** prompt sizing and splitting, response validation, theme merge mapping each task to one theme.

### Phase 7 — Story generation per style

- **One story call per generation** turns statistics, month digests, and projects into slides, using a recipe for
  the chosen style (below).
- **Response schema:** `{ slides: [{ id, kind, kicker, headline, caption, figure, items, imageUrl, tone }] }`.
- **Validation.** Merge the response with the deterministic slides. Every figure must come from the statistics
  object; the LLM writes words, never numbers. Any `imageUrl` outside the collected set is dropped.
- **Slide renderers.** `RetrospectiveSlide` gains renderers by `kind`:
  - `figure` — today's slide;
  - `bars` — done vs. open per project;
  - `heap` — the progress mountain;
  - `image` — a background photo from the user's notes, with a darkening scrim;
  - `timeline` — tasks per month.
- **The heap.** Every completed task falls as a small block onto a growing pile, colored by project with
  `completed-task-project-colors.js` and sized by Victory Value. It ends on the total. Draw it with absolutely
  positioned divs, or a canvas above about 400 tasks. Under reduced motion it shows the finished pile.

**Recipes.** The facts are shared; each style tells them its own way. Every style covers:

- the project with the most time (60-minute default);
- the project with the most Victory Value;
- tasks completed per project;
- done vs. open at quarter end per project;
- a few contextual facts, such as busiest day, longest streak, first and last completion, and the share of work that
  served stated intents.

| Style | Voice and visuals |
|-------|-------------------|
| **Data** | Neutral, precise copy. Part 1's slide order, plus the bars, timeline, and heap slides. Calm gradients. |
| **Roast** | The same facts, written as affectionate ribbing ("212 tasks and you still rescheduled 'Update résumé' 9 times"). Offered in every domain. Rules: never mock health, family, grief, money trouble, or other personal hardship, and keep the end card sincere. |
| **Spotify** | "Your Top Project", "You were in the top 3% of finishers on…", plus a personality slide ("Your quarter's genre: Deep-Focus Builder"). High production per phase 8. |

### Phase 8 — Spotify production values

- **Backgrounds.**
  - **Primary layer:** generated in CSS. Recaps like Spotify Wrapped use saturated duotone gradients, large
    geometric or warped shapes, grain, and a background that varies a little per slide but keeps one treatment
    (see sources). Shapes and SVG grain cost no licensing or network, so they form this layer.
  - **Photo layer:** a curated pool of about 12 abstract photos in a new `RETROSPECTIVE_BACKGROUND_URLS` beside
    `SPLASH_IMAGE_BASE_URLS` in `lib/util/background-splash-images.js`. Unsplash serves them the way the splash images
    are served today.
  - **The user's own images** from Rich Footnotes appear on `image` slides.
- **Audio.**
  - **Decided:** a short, synthesized loop built with the Web Audio API — a pad and a simple beat whose tempo matches
    slide timing. It needs no licensing and no asset hosting.
  - **Deferred:** a licensed track. Pixabay's license allows use without attribution but restricts redistributing
    music files on their own, so read each track's license before hosting one.
  - **Controls.** Playback starts from the style-choice click (a user gesture), with a mute button in the story
    header. When `matchMedia('(prefers-reduced-motion)')` is set or the user mutes, the choice is remembered in a
    setting.
- **Motion.** Slide transitions use scale and blur entrances. The kicker and figure come in with stagger, as part 2
  already does.

### Phase 9 — Project payoff ranking

- **Where it appears:** the processing screen, and as a slide before the end card when skipped there. It shows only
  when projects were found or inferred.
- **The prompt:** "Now that time has passed, rank projects by: Did my work on this really pay off?"
- **The list.** A list of draggable project chips built on HTML5 drag and drop, as `dashboard-layout-popup.jsx`
  does, with "Move up"/"Move down" buttons for keyboard and touch.
- **Tooltip:** "We'll use this to help build future plans: Plan Builder will remind you which projects paid off and
  weigh them when suggesting new ones."
- **Store:** `## Q{q}` in `{domain} Project Payoff Rankings {year}`. Each entry is
  `{ rank, projectName, projectUuid, derivedFrom, rankedAt }`. Re-ranking overwrites the quarter.
- **Plan Builder intent page** (`intent-step.jsx`): a compact "What paid off" strip listing the top 3 projects from
  the two most recent ranked quarters. That read can span two yearly notes in Q1.
- **Project suggestion prompt** (`prospectPromptFromEvidence`, `lib/plan-wizard/prospect-discovery.js:114`): add an
  evidence section inside the fence, "Past projects ranked by payoff", listing quarter, rank, and name. The ranking
  instructions favor continuing or extending projects that paid off and are wary of repeating ones ranked last.

### Phase 10 — End card and takeaways note

- **Replay** restarts the story.
- **Generate new** returns to the options screen.
- **Save takeaways in a note:**
  - One LLM call over the statistics, month digests, and projects asks for 500–1000 words of markdown: a summary,
    then a projects table (tasks, minutes, Victory Value, done/open), monthly highlights, calendar shape, and
    "What paid off" when a ranking exists.
  - The body is the same for every style. Numbers in tables are filled from statistics, not taken from the LLM's
    prose.
  - Create the note with `app.createNote` + `insertNoteContent`, record its UUID in `## Takeaways`, and navigate to
    it. A second save opens the existing note instead of duplicating it.

## Other places the payoff ranking can help

These are candidates, not commitments:

- **Day ranking and suggestions** (`ranked-task-suggestions.js`): give tasks from projects ranked in the top third a
  small salience boost, and those in the bottom third a small penalty.
- **Re-roll prompt** (`suggestion-reroll-embed.js`): pre-select the quarter projects that continue a high-payoff
  project as the boosted chips.
- **Goal Coach** (`goal-coach-service.js`): include the payoff list in the recommendation context, so suggested goal
  tasks lean toward what has paid off before.
- **Idea generation** (`lib/dashboard/idea-generation/`): when generating ideas for a project that continues a
  high-payoff one, mention the earlier quarter's outcome in the prompt.
- **Victory Value**: the ranking is a user-stated signal of a project's long-term value. It could raise
  `appliedVictoryValue` for future tasks in high-ranked continuing projects. This one deserves its own design, since
  it changes scores users already see.

## Decisions (October 26, 2026)

- **Plan note access:** an "Open plan note" link in the retrospective header. The card click always opens the
  retrospective.
- **Default style:** play the most recently generated retrospective. A switcher lists the other styles.
- **Roast:** offered in every domain, including personal, with the guardrails in phase 7.
- **Spotify audio:** a synthesized Web Audio loop. A licensed track is deferred.

## Still to verify

- Whether `getCompletedTasks` returns task content with Rich Footnote definitions inline (phase 5).
- Whether the embed can play audio from its opaque `data:` origin (phase 8).
- Whether Amplenote image URLs from footnotes load inside the embed without extra authentication (phase 7).

## Sources

- [Amplenote plugin API: app interface](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface)
  — `getExternalCalendarEvents` range, `attachNoteMedia`.
- [Three Design Elements That Made Spotify Wrapped 2024 Great](https://alexjimenezdesign.substack.com/p/three-design-elements-that-made-spotify)
- [The making of Spotify Wrapped 2023](https://the-brandidentity.com/interview/raw-playful-and-laced-with-a-chaotic-energy-we-dive-into-the-making-of-spotify-wrapped-2023)
- [Spotify Wrapped 2021 design analysis](https://itmagination.com/blog/spotify-wrapped-2021-design-analysis)
- [Pixabay FAQ (license)](https://pixabay.com/service/faq/)
