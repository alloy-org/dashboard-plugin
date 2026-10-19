# Plan: re-roll calendar suggestions ("Pick your loadout")

Written October 18, 2026. This is a working plan for progressive commits, not a specification. Each phase should
leave the suite green, `npm run build` passing, and the production bundle smoke test passing.

## Status (October 18, 2026)

Phase 1 is implemented and uncommitted. Phases 2 through 6 are not started.

- **Not yet tried in a live client:** the prompt embed. These parts are unverified:
  - that `app.context.updateEmbedArgs` is available to `onEmbedCall` when the embed runs inside `app.prompt`;
  - whether the prompt resolves with the stored arguments as a bare value or as `[value, actionResult]` (both are
    read);
  - whether `actions: [{ label: "Keep current", value: "keepCurrent" }]` sits beside the primary button the way the
    design expects.

  If the embed's choice never reaches the prompt result, a re-roll still runs, but with the default focus and no
  boosted projects. Check that first.
- **Trigger ambiguity:** the host calls `suggestScheduledTasks` both when Suggest is clicked and, possibly, when the
  calendar is shown. If it calls on navigation too, a navigation within three minutes of a pass, over the same days,
  also opens the prompt. A trigger field in the host's params would settle this.

## Goal

Clicking Suggest a second time within three minutes of a calendar pass finishing opens a prompt where the user steers
the next set of suggestions. The user can pick a focus and boost quarter projects. The new set replaces the previous
suggestions, so the user is asked to commit to work they actually want right now.

The prompt is the design's "Pick your loadout" popup. It has these parts:

- an energy slider from Low to High, which picks a level;
- focus cards grouped by level, with up to two chosen as a combo;
- up to three boosted quarter projects;
- an "ideas come from" toggle;
- a live preview of incoming suggestions;
- the buttons Keep current and Re-roll suggestions.

## How a re-roll works (phase 1, built)

- **Detection** (`suggestion-reroll-store.js#rerollablePreviousPass`). Every pass records the following in the
  `CALENDAR_SUGGESTIONS_GENERATED` setting:
  - when it finished (`finishedAtSeconds`);
  - how many suggestions it offered;
  - the identity keys it offered per day.

  A request is a re-roll when all of these hold:
  - the previous pass offered suggestions;
  - it finished within `REROLL_WINDOW_SECONDS` (3 minutes);
  - it covered every day now requested.
- **Prompt** (`suggestion-reroll-prompt.js`, `lib/suggestion-reroll-embed.js`). The prompt is an `app.prompt` with an
  embed input. It shows radio cards for Quarter plan, Layups (easy), and Moonshots (high ROI), plus up to three boosted
  project chips. Each change calls `suggestionRerollChoice`, which stores the choice with `updateEmbedArgs`. Keep
  current, or closing the prompt, runs the ordinary pass.
- **Ranking** (`ranked-task-suggestions.js#rerolledDayRanking`):
  - With projects boosted, only their candidates compete, whatever their cadence (`priorityProjectGroups`). They take
    turns up to `SALIENCE_POOL_LIMIT`.
  - With none boosted, the usual project and weekday groups and meeting groups compete, narrowed by salience.
  - Every Jev question, and the generative fallback prompt, carry the focus instruction.
  - The ranking is never stored in the day ranking store.
- **Exclusions** (`suggestion-reroll-range.js`). The re-roll leaves out:
  - what the previous pass offered;
  - what earlier re-rolls of the day set aside;
  - tasks already on the calendar;
  - what an earlier day of the range took.
- **Not persisted as the agenda.** The day's archived note "Dashboard Suggestion Re-rolls" records every key the
  re-roll discarded or offered, with `forceRegenerate: true`.
  - The next ordinary pass plans that day afresh without those keys (`generateProposedAgendaRange`'s `rerolledDays`),
    then clears `forceRegenerate`.
  - Later passes that day keep excluding the keys.
  - Records are pared once their day has passed.
- **Report.** With the Debug Console in the layout, the pass writes "Calendar <domain> Re-roll: …". It opens with the
  focus and boosted projects, and each day's Source names the re-roll and how many suggestions it left out.

## Phase 2: more focuses and combos

- Add the design's other focus cards, each needing a candidate signal the ranker can see:
  - **Fresh tasks:** task creation recency. Add `ageDays` to the candidate state.
  - **Key emails:** an "email/message" classification of task text.
  - **Writing:** a "drafts, posts, docs" classification.
  - **Outdoors:** an "outside" classification. Pairs with the weather in recommendation context.
  - **Collaborative:** names other people, or the task has a meeting match.
  - **Top Task Score:** the existing applicability score, weighted heavily.
- Allow up to two focuses. Join their instructions as "and also", and record both in the re-roll record and report.
- Reconsider the focus being a radio group. The original spec asked for radios, but the design allows a combo.

## Phase 3: energy level slider

- Map Low…High to levels 1–5 (Recharge, Cruise, Steady, Locked in, Beast mode). The slider pre-selects that level's
  cards and adds an effort-tolerance sentence to the focus instruction.
- Show the current loadout ("Balanced (current)") from the last pass's record.

## Phase 4: where ideas come from

- Add Existing + new, Only new ideas, and Only existing. Filter the candidate groups by `isExisting` before ranking.
  "Only new" may warrant asking the idea generator for fresh ideas when the pool is thin. That is costly, so gate it on
  the day's idea-generation allowance.

## Phase 5: incoming suggestions preview

- The embed asks the plugin for a preview whenever the choice changes. Debounced, the call ranks with stored ratings
  only, so no provider is asked, and returns the top four with duration, project, and existing/new.
- Possibly cache the final Jev ranking for the chosen loadout until the day ends, so Re-roll reuses it.

## Phase 6: polish

- Use the design's dark card styling, level column headings, and empty boost slots, and keep it readable at phone
  width.
- Show "No focus picked: re-roll gives you a fresh balanced set" when nothing is chosen. That needs "no focus" to be a
  valid choice; today Quarter plan is the default.

## Open questions

1. A boosted idea the user accepts from a re-rolled set is not recorded as accepted, since the re-roll is not in the
   agenda cache that the staleness review reads. Should re-rolled suggestions be checked by that review the same day?
2. Should the re-roll report be written even without the Debug Console in the layout? Today it follows the same gate
   as the ordinary report.
