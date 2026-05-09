// [Claude claude-opus-4-7-authored file]
// Prompt summary: "extract shared sample note handle fixture data and the iterable-array
// wrapper used by both dev-app.js (Node) and browser-dev-app.js to mirror the production
// app.filterNotes interface (sync iterable + Symbol.asyncIterator)"

// Note handles referenced by sample tasks, grouped by domain.
// Each entry provides the name shown in the Recent Notes widget.
// Shared by dev/dev-app.js (Node) and lib/util/browser-dev-app.js (browser) so the
// dev environments stay in sync without two copies of this fixture data.
export const SAMPLE_NOTE_HANDLES = {
  "domain-work-uuid": [
    { uuid: "note-work-1",  name: "Q1 Goal Review" },
    { uuid: "note-work-2",  name: "Stand-up Notes" },
    { uuid: "note-work-3",  name: "Feature Implementation" },
    { uuid: "note-work-4",  name: "Design Feedback" },
    { uuid: "note-work-5",  name: "Budget Tracker" },
    { uuid: "note-work-6",  name: "Offline Testing" },
    { uuid: "note-work-7",  name: "Sprint Retro" },
    { uuid: "note-work-8",  name: "API Layer Research" },
    { uuid: "note-work-9",  name: "Integration Tests" },
    { uuid: "note-work-10", name: "Pull Request Queue" },
    { uuid: "note-work-11", name: "Settings Module Tests" },
    { uuid: "note-work-12", name: "CSS Cleanup" },
    { uuid: "note-work-13", name: "Dashboard Memory Leak" },
    { uuid: "note-work-14", name: "Client Feedback" },
    { uuid: "note-work-15", name: "API Error Handling" },
    { uuid: "note-work-16", name: "Auth Token Refresh" },
    { uuid: "note-work-17", name: "DB Query Performance" },
    // Stale notes for graveyard fixture data (3–7 months old)
    { uuid: "note-old-3mo", name: "Security Backlog (Q4)" },
    { uuid: "note-old-4mo", name: "Platform Migration Notes" },
    { uuid: "note-old-5mo", name: "Tech Debt Tracker" },
    { uuid: "note-old-6mo", name: "Abandoned Feature Concepts" },
    { uuid: "note-old-7mo", name: "Legacy System Docs" },
  ],
  "domain-personal-uuid": [
    { uuid: "note-personal-1",  name: "Networking Outreach" },
    { uuid: "note-personal-2",  name: "Fitness Log" },
    { uuid: "note-personal-3",  name: "Social Reminders" },
    { uuid: "note-personal-4",  name: "Entertainment" },
    { uuid: "note-personal-5",  name: "Shopping List" },
    { uuid: "note-personal-6",  name: "Health Appointments" },
    { uuid: "note-personal-7",  name: "Reading List" },
    { uuid: "note-personal-8",  name: "Hobbies" },
    { uuid: "note-personal-9",  name: "Trip Planning" },
    { uuid: "note-personal-10", name: "Home Office" },
  ],
  "domain-side-uuid": [
    { uuid: "note-side-1", name: "Blog Post Ideas" },
    { uuid: "note-side-2", name: "Side Project README" },
    { uuid: "note-side-3", name: "CI Pipeline Setup" },
  ],
};

// Decorate an array with Symbol.asyncIterator so the dev `filterNotes` return value
// matches the production `filterNoteHandles` interface: callers can iterate the
// result synchronously (array's built-in Symbol.iterator), iterate it with
// `for await...of` (Symbol.asyncIterator), or `await` it as an array.
export function withAsyncIterator(noteHandles) {
  Object.defineProperty(noteHandles, Symbol.asyncIterator, {
    value: function() {
      let index = 0;
      return {
        next: () => index < noteHandles.length
          ? Promise.resolve({ value: noteHandles[index++], done: false })
          : Promise.resolve({ done: true }),
      };
    },
  });
  return noteHandles;
}
