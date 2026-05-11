// [Claude claude-opus-4-7-authored file]
// Prompt summary: "extract shared sample note handle fixture data and the iterable-array
// wrapper used by both dev-app.js (Node) and browser-dev-app.js to mirror the production
// app.filterNotes interface (sync iterable + Symbol.asyncIterator)"

// Note handles referenced by sample tasks, grouped by domain.
// Each entry provides the name shown in the Recent Notes widget.
// Shared by dev/dev-app.js (Node) and lib/util/browser-dev-app.js (browser) so the
// dev environments stay in sync without two copies of this fixture data.
// [Claude claude-sonnet-4-6] Task: add domain tags to sample note handles so filterNotes can match by domain tag
// Prompt: "component no longer finds notes in dev environment — adding each note to a tag present in the task domain"
export const SAMPLE_NOTE_HANDLES = {
  "domain-work-uuid": [
    { uuid: "note-work-1",  name: "Q1 Goal Review",         tags: ["work"] },
    { uuid: "note-work-2",  name: "Stand-up Notes",         tags: ["work"] },
    { uuid: "note-work-3",  name: "Feature Implementation", tags: ["work"] },
    { uuid: "note-work-4",  name: "Design Feedback",        tags: ["work"] },
    { uuid: "note-work-5",  name: "Budget Tracker",         tags: ["work"] },
    { uuid: "note-work-6",  name: "Offline Testing",        tags: ["work"] },
    { uuid: "note-work-7",  name: "Sprint Retro",           tags: ["work"] },
    { uuid: "note-work-8",  name: "API Layer Research",     tags: ["work"] },
    { uuid: "note-work-9",  name: "Integration Tests",      tags: ["work"] },
    { uuid: "note-work-10", name: "Pull Request Queue",     tags: ["work"] },
    { uuid: "note-work-11", name: "Settings Module Tests",  tags: ["work"] },
    { uuid: "note-work-12", name: "CSS Cleanup",            tags: ["work"] },
    { uuid: "note-work-13", name: "Dashboard Memory Leak",  tags: ["work"] },
    { uuid: "note-work-14", name: "Client Feedback",        tags: ["work"] },
    { uuid: "note-work-15", name: "API Error Handling",     tags: ["work"] },
    { uuid: "note-work-16", name: "Auth Token Refresh",     tags: ["work"] },
    { uuid: "note-work-17", name: "DB Query Performance",   tags: ["work"] },
    // Stale notes for graveyard fixture data (3–7 months old)
    { uuid: "note-old-3mo", name: "Security Backlog (Q4)",       tags: ["work"] },
    { uuid: "note-old-4mo", name: "Platform Migration Notes",    tags: ["work"] },
    { uuid: "note-old-5mo", name: "Tech Debt Tracker",           tags: ["work"] },
    { uuid: "note-old-6mo", name: "Abandoned Feature Concepts",  tags: ["work"] },
    { uuid: "note-old-7mo", name: "Legacy System Docs",          tags: ["work"] },
  ],
  "domain-personal-uuid": [
    { uuid: "note-personal-1",  name: "Networking Outreach", tags: ["personal"] },
    { uuid: "note-personal-2",  name: "Fitness Log",         tags: ["personal"] },
    { uuid: "note-personal-3",  name: "Social Reminders",    tags: ["personal"] },
    { uuid: "note-personal-4",  name: "Entertainment",       tags: ["personal"] },
    { uuid: "note-personal-5",  name: "Shopping List",       tags: ["personal"] },
    { uuid: "note-personal-6",  name: "Health Appointments", tags: ["personal"] },
    { uuid: "note-personal-7",  name: "Reading List",        tags: ["personal"] },
    { uuid: "note-personal-8",  name: "Hobbies",             tags: ["personal"] },
    { uuid: "note-personal-9",  name: "Trip Planning",       tags: ["personal"] },
    { uuid: "note-personal-10", name: "Home Office",         tags: ["personal"] },
  ],
  "domain-side-uuid": [
    { uuid: "note-side-1", name: "Blog Post Ideas",     tags: ["side-projects"] },
    { uuid: "note-side-2", name: "Side Project README", tags: ["side-projects"] },
    { uuid: "note-side-3", name: "CI Pipeline Setup",   tags: ["side-projects"] },
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
