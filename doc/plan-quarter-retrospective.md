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

Phases 3–7, the follow-ups to phase 7, and phase 8's audio are committed. Phase 8's backgrounds and motion and phase 9
are built and uncommitted. Phase 10 is not started.

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
2. **Look for existing retrospectives** (the domain-quarter's data notes, one per style) and whether an AI is
   available, then always show the options screen, so the soundtrack is chosen before anything plays (decided).
3. **Options screen.** Three selectable style cards, **Data**, **Roast**, and **Spotify**, and three soundtrack vibe
   cards, **Chill**, **Synthwave**, and **Anthem**, with Chill chosen by default.
   - A style with a saved story says "Saved {date}". Roast and Spotify are disabled, noting "Needs an AI provider",
     when no AI is available and their story wasn't saved.
   - The style chosen first is the most recently saved one, else Spotify when it can be chosen, else Data.
   - Below the cards sit a few toggles, each shown only when it applies: include calendar events, when the journal
     covers the quarter; include images from my notes.
   - The main button plays the chosen style's saved story ("Play {Style} retrospective") or generates it. A saved
     style the AI can still write offers "Generate a new {Style} one" beneath. The click is the one music can start
     from. While a story plays, the header lists the other saved styles and an Options link back to this screen.
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

### Phase 5 — Gathering the quarter (built)

`gatherRetrospectiveQuarter` (`retrospective-data.js`) replaces `loadRetrospectiveStatistics`. Only the completed
tasks are required; every other source fails soft. It reports each step through `onProgress`, which the status screen
shows ("Reading the notes behind 229 completed tasks…").

- **Completions** carry `{ footnoteText, images, noteName, noteTags, noteUuid, taskUuid }` besides part 1's fields.
  - Each note is looked up once, six at a time, for its name and tags.
  - A note's content is read only when one of its tasks cites a footnote the task itself doesn't define. Footnotes
    resolve from the task first and the note second (`taskFootnoteEvidence` in `retrospective-task-evidence.js`),
    so this works whether or not `getCompletedTasks` returns definitions inline.
  - Footnote text is cut to 600 characters per task. Images are http(s) pictures only; videos and relative paths are
    left out.
- **Media:** every image once, as `{ alt, footnoteText, taskUuid, url }`, written to `## Media` as
  `{ candidates, chosen: [] }`. Phase 7 fills `chosen`.
- **Projects:** the project task store's records, active and retired (`derivedFrom: "plan"`), then any project the
  ledger credited that the store didn't hold (`derivedFrom: "ledger"`). Written to `## Projects`. Phase 6 adds
  `derivedFrom: "themes"` when there are none.
- **Open at quarter end** (`openAtQuarterEndByProject`): a task the store associated with a project counts as open
  if it was created before the quarter ended and is either open now (`getTaskDomainTasks`) or was completed since
  (`getCompletedTasks` from the quarter's end to now). The slide says "tasks we know of".
- **Duration default:** a completion with no span or duration counts as `DEFAULT_TASK_MINUTES` (60).
  `scheduledMinutes` still returns 0, and each completion records `durationDefaulted`.
- **Calendar:** when the options screen's toggle is on, the journal's days go to `## Calendar` as
  `{ coverage, eventsByDate }`.
- **Statistics gained:** `calendarCoverage`, `defaultedDurationCount`, `doneAndOpenByProject`,
  `firstAndLastCompletion`, `longestStreak`, `meetingMinutesByCategory`, and `monthlyTaskCounts`.
  - Meeting categories are counted locally from attendee counts: Solo blocks, 1:1s, Small meetings (2–5), and Large
    meetings (6+). All-day events don't count. Phase 6 can refine these from titles.
- **New Data slides:** done vs. still open per project, the longest streak (three days or more), and meeting time by
  category with calendar coverage. The time slide notes how many tasks counted as an hour.
- **Tests:** `quarter-retrospective-gathering.test.js` and the statistics tests. Checked in the dev dashboard:
  regenerating Q3 2026 Data showed the progress labels and the streak slide.

### Phase 6 — Month digests and theme inference (built)

`digestRetrospectiveMonths` (`retrospective-month-digests.js`) runs after gathering, for every style. Prompts go
through `raceWizardPrompt` (callLLM raced against the user's own provider) with `timeoutSeconds: 150` and source
`quarter-retrospective`, at most four at a time.

- **Each prompt sends** the month's tasks as one JSON line each: a short id (`t12`), day, text, note name, tags,
  project, minutes (only when set), Victory Value, important, footnote text cut to 240 characters with images
  removed, and attached images as short ids (`i3`) with alt text. The month's calendar categories go with the first
  part only.
- **Each reply** is `{ highlights: [{ summary, taskIds }], themes: [{ name, taskIds }], notableMoments, mood,
  imageIds, calendarNarrative }`.
  - Validation keeps only ids the prompt offered. A highlight or theme citing none is dropped; a task stays in the
    first theme that claims it. A reply with no grounded highlight or theme counts as no reply.
- **Stored in `## Month N`** as `{ calendar, failedPartCount, generatedBy, highlights, imageUrls, monthName,
  monthNumber, mood, notableMoments, omittedTaskCount, partCount, taskCount, themes, version }`, with ids mapped back
  to task UUIDs and image URLs.
- **Batching.** A month's tasks are packed into prompts of at most 40,000 characters, keeping whole weeks together
  and splitting a week only when it alone is too large. Parts merge locally: themes of one name join, and highlights,
  moments, and images keep part order. Over four parts, footnotes are dropped; still over, the most valuable tasks
  (important first, then Victory Value) are kept and the rest counted in `omittedTaskCount`.
- **Without an AI**, or when every part fails, a month gets a fallback digest: its three most valuable tasks as
  highlights and its ledger projects as themes. `generatedBy` says which.
- **Theme inference.** When the quarter has no projects, one more call merges the months' themes into 3–7 projects,
  each task in the first project that claims one of its themes. A failed call falls back to themes merged by name.
  Inferred projects go to `## Projects` as `derivedFrom: "themes"` with their `taskUuids`. Statistics are computed
  again with them: completions the ledger left without a project are credited to them for the project rankings, and
  `intentAlignmentPercent` still comes from the ledger alone.
- **Reuse.** A generation reads the quarter's newest data note in another style and reuses each month digest that
  the AI wrote from the same task count, with the calendar included the same way. When every month is reused, its
  inferred projects are reused too. Generating the same style again asks afresh.
- **Calendar categories** (`retrospective-calendar-categories.js`) replace phase 5's attendee-count categories:
  Personal (title keywords), Focus blocks (no attendees), External meetings (title keywords such as customer,
  candidate, demo), 1:1s, Team meetings (2–5), and Large meetings (6+). Each also counts recurring events (a title on
  three or more days) and keeps its five most frequent titles for the prompt.
- **Slides.** The Data style gains a month-by-month slide: each month's first highlight beside its task count from
  the statistics. Project captions say "Projects inferred from your tasks." when they are.
- **Tests:** `quarter-retrospective-month-digests.test.js`, plus the gathering, statistics, and data note tests.
  Checked in the dev dashboard: three month calls and the theme merge answered in about 15 seconds, and the story
  grew to ten slides with the month-by-month slide and inferred project rankings. The dev quarter's tasks are eight
  repeating habits, so its highlights were generic. A real quarter should be checked for specific highlights.

### Phase 7 — Story generation per style (built)

- **Data asks nothing more.** Its slides are the ones `slidesFromStatistics` builds, whose copy is already neutral
  and precise. The Story section records `generatedBy: "statistics"`.
- **Roast and Spotify make one story call** (`retrospective-story-writer.js`) after the month digests, through the same
  `raceWizardPrompt` requester. The prompt carries the style's rules, the quarter's name and intents, each month's
  highlights, mood, and moments, every slide as one JSON line of its facts and plain words (the heap's blocks left
  out), and the images the month digests chose, as short ids. Both styles are refused before gathering when no AI is
  available.
- **Response schema:** `{ slides: [{ id, kicker, headline, caption }], imageSlides: [{ imageId, afterSlideId, kicker,
  headline, caption }], genre: { name, caption } }`; genre is asked of Spotify only.
- **Validation.** The slides built from statistics keep their order, kind, figure, items, bars, columns, and heap; the
  AI changes only words. A line is put back to the plain one when it is over its limit (kicker 48, headline 80,
  caption 200) or cites a number that isn't in that slide's facts or words, or among the quarter's totals, number,
  year, and monthly counts. A photo slide needs an offered image id and a headline, shows each image once, at most
  three, and goes after the slide it names, or before the summary. The genre slide goes before the summary. A reply
  that rewrites nothing, or a failed call, keeps the plain words and records `generatedBy: "fallback"`; otherwise
  `"ai"`. `## Media` records the images shown as `chosen`.
- **Options.** A toggle, on by default, offers images from the user's notes to the Roast and Spotify stories. It is
  always shown, since whether any were found isn't known until the quarter is gathered.
- **Slide kinds** (`SLIDE_KINDS`), each drawn by `RetrospectiveSlide`; a slide saved without a kind is a figure:
  - `figure` — the part 1 slide;
  - `bars` — done vs. open per project, all bars on one scale (replaces the done-and-open list);
  - `heap` — the progress mountain, after the Victory Value slide;
  - `timeline` — tasks per month as rising columns, each noted with its leading highlight when the AI digested a
    month (replaces phase 6's month-by-month list, and now always shown);
  - `image` — a photo slide; an image that fails to load is removed, leaving the tone behind the words.
- **The heap.** `retrospectiveStatistics` adds `progressHeap`: a `[slot, size]` block per completion, oldest first. The
  five projects with the most completions take colors 1–5 and the rest share 6 as "Other projects" (or a sixth project
  keeps it), using the `--dashboard-color-category-N` tokens; size is 1–3 by where the task's Victory Value falls
  against the quarter's median and 85th percentile. `retrospective-heap-layout.js` drops each block into the column
  that is lowest once a slope toward the middle is counted, which piles a mountain, deterministically. Up to 400 blocks
  fall as elements (transform-only animation); above that a canvas draws them. Reduced motion shows the finished pile.
  The heap slide plays 1.5 times as long, through a per-slide `durationFactor`.
- **Tests:** `quarter-retrospective-story-writer.test.js`, plus the statistics, data note, entry, and month digest
  tests. Checked in the dev dashboard: a Roast generation of Q3 2026 took about 14 seconds with its four digest calls
  and the story call, and played 11 slides with rewritten words whose numbers all came from the facts. The heap piled
  229 blocks into a five-color mountain, and the timeline showed each month's highlight. The dev quarter has no images
  or open counts, so photo slides and bars were checked only in tests.

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
| **Spotify** | "Your Top Project", plus a personality slide ("Your quarter's genre: Deep-Focus Builder"). Comparisons with other people, such as "top 3% of finishers", are ruled out: nothing is known about anyone else. High production per phase 8. |

### Follow-ups to phase 7 (built)

- **Compared with the quarter before.** Gathering also reads the quarter before's completed tasks and ledger, in the
  same domain (`_previousQuarterTotals`, failing soft), and counts its tasks and Victory Value with `quarterTotals`.
  `retrospectiveStatistics` adds `quarterOverQuarter`: the previous totals and each change as a whole percent, or null
  when the quarter before completed nothing. The `previous-quarter` slide follows the Victory Value total:
  - either total up: the larger growth leads as "+N%", with both totals listed as "this vs. that";
  - neither up, neither down more than 10% (`SHOWN_DECLINE_PERCENT_LIMIT`): "Less intense, more room to breathe",
    with no figure;
  - either down more than 10%: no slide.

  The Roast and Spotify prompt tells the AI to celebrate growth and to frame a lighter quarter as breathing room,
  never as falling behind.
- **Story pacing.** Slides play 7.2 seconds, 20% longer than before. The Pause button is an outlined pill; the first
  slide shows "Hold anywhere or press Space to pause" beside it, and a "Paused" badge replaces the hint while paused.
- **Options screen.** It opens every time. Style and soundtrack vibe are choices with defaults; the AI-written styles
  need an AI or a saved story; and one button plays a saved story or generates, as the flow above describes.
  `retrospectiveAiAvailable` (`retrospective-generation.js`) checks for a configured key or the plugin LLM license.
- **Dev fixture.** `dev/dev-retrospective-tasks.js` also fills the quarter before last with a lighter version of the
  same work, so the dev dashboard's Q3 2026 retrospective shows the comparison slide.
- **Checked in the dev dashboard:** the options screen with both groups and their defaults; a Data generation of
  Q3 2026 showing "+19% more Victory Value earned than Q2 2026"; the pause hint, button, and badge.

### Phase 8 — Spotify production values

- **Backgrounds (built).** Every style's slides get two accent shapes and SVG film grain behind their words, placed by
  the slide's position in one of four layouts and drifting slowly; each tone carries its own accent color. Spotify
  stories also blend an abstract photo into each slide's tone (`retrospectiveBackgroundUrl`, seeded by when the story
  was generated), preloading the next slide's photo. The original design follows.
  - **Primary layer:** generated in CSS. Recaps like Spotify Wrapped use saturated duotone gradients, large
    geometric or warped shapes, grain, and a background that varies a little per slide but keeps one treatment
    (see sources). Shapes and SVG grain cost no licensing or network, so they form this layer.
  - **Photo layer:** a curated pool of about 12 abstract photos in a new `RETROSPECTIVE_BACKGROUND_URLS` beside
    `SPLASH_IMAGE_BASE_URLS` in `lib/util/background-splash-images.js`. Unsplash serves them the way the splash images
    are served today.
  - **The user's own images** from Rich Footnotes appear on `image` slides.
- **Audio (built).**
  - **Synthesized loop.** `retrospective-soundtrack.js` builds each vibe with the Web Audio API: a chord progression
    on a detuned pad, a bass line, and a kick, snare and hi-hat made from oscillators and filtered noise. No asset is
    downloaded or licensed. `RetrospectiveSoundtrack` schedules notes 120 ms ahead of the audio clock on a 25 ms timer.
  - **Vibes.** `SOUNDTRACK_VIBE_ARRANGEMENTS` sets each vibe's progression, waveforms, patterns and bars per slide.
    The tempo fits a whole number of bars into `SLIDE_MILLISECONDS`: Chill and Synthwave play 3 bars a slide (100 BPM)
    and Anthem 4 (133 BPM). Chill and Synthwave share an A-minor progression; Anthem is in C major.
  - **Starting.** The Play or Generate click on the options screen makes the audio context
    (`createRetrospectiveAudioContext`), before anything awaits, so the browser counts it as the user's gesture. One
    context serves the overlay until it closes. Without Web Audio the story plays silently and shows no sound button.
  - **Following the story.** The loop pauses (suspending the context) when the user pauses the story, but not during
    a hold. It fades out over 2.5 seconds after the last slide and starts again on Replay.
  - **Mute.** "🔊 Sound on" / "🔇 Sound off" in the story header. The choice is saved in
    `SETTING_KEYS.RETROSPECTIVE_SOUNDTRACK_MUTED`; until one is saved, the soundtrack starts muted when the viewer
    prefers reduced motion.
  - **Deferred:** a licensed track. Pixabay's license allows use without attribution but restricts redistributing
    music files on their own, so read each track's license before hosting one.
- **Motion (built).** Slide transitions use scale and blur entrances. The kicker and figure come in with stagger, as part 2
  already does.

### Phase 9 — Project payoff ranking (built)

Built as designed below, with these specifics: storage is `project-payoff-rankings.js`, reusing the data note's JSON
sections; `generateRetrospective` reports projects through `onProjectsKnown`; the ranking slide is added at play time
by `slidesWithPayoffRanking` before the summary (the end card doesn't exist yet), and the story waits on it through
`renderInteractiveSlide`. Plan Builder's evidence carries `payoffRankings`, read by `recalledPayoffRankings`.

- **Where it appears:** the processing screen, and as a slide before the end card when skipped there. It shows only
  when projects were found or inferred.
- **When it is asked:** never before generation starts. For a quarter with no retrospective yet, the options screen
  stays as it is, and the ranking appears on the processing screen as soon as the quarter's projects are known: right
  after gathering when the project task store holds some, or after theme inference when they are inferred. Ranking
  occupies the user while the month digests and story are written.
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

- Whether the embed can play audio from its opaque `data:` origin (phase 8). It plays in the dev dashboard, which is
  served over http; the embed in Amplenote, and the mobile apps' web views, are untried.
- Whether Amplenote image URLs from footnotes load inside the embed without extra authentication (phase 7).

## Verified on the host

Checked with a plugin query on 2026-10-26, against a domain with 758 completed tasks from Q3 2026:

- `getCompletedTasks` returns each task's Rich Footnote definitions inline in `content`: all 64 tasks that cite a
  footnote also define it. Phase 5 therefore resolves footnotes from the task alone. Its note-content fallback
  stays as a safeguard but shouldn't fire.
- `findNote({ uuid })` returns `tags`, along with `name`, `created`, `updated`, `active`, `published` and `shared`.
- `getCompletedTasks` also returns dismissed tasks. They carry `dismissedAt` and no `completedAt`, and
  `isGenuinelyCompleted` already leaves them out. A completed task has the same fields, with `completedAt` in place of
  `dismissedAt`.

## Sources

- [Amplenote plugin API: app interface](https://www.amplenote.com/help/developing_amplenote_plugins/app_interface)
  — `getExternalCalendarEvents` range, `attachNoteMedia`.
- [Three Design Elements That Made Spotify Wrapped 2024 Great](https://alexjimenezdesign.substack.com/p/three-design-elements-that-made-spotify)
- [The making of Spotify Wrapped 2023](https://the-brandidentity.com/interview/raw-playful-and-laced-with-a-chaotic-energy-we-dive-into-the-making-of-spotify-wrapped-2023)
- [Spotify Wrapped 2021 design analysis](https://itmagination.com/blog/spotify-wrapped-2021-design-analysis)
- [Pixabay FAQ (license)](https://pixabay.com/service/faq/)
