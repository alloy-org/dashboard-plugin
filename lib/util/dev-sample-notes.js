// [Claude claude-opus-4-7-authored file]
// Prompt summary: "extract shared sample note handle fixture data and the iterable-array
// wrapper used by both dev-app.js (Node) and browser-dev-app.js to mirror the production
// app.filterNotes interface (sync iterable + Symbol.asyncIterator)"

// ----------------------------------------------------------------------------------------------
// @desc Build an ISO 8601 timestamp a given number of minutes before now, used to give sample
//   note handles realistic `changed`/`updated` values so the Shared Notes widget can render
//   relative "Xh ago" labels and the collaborator-updated filter (updated > changed) is meaningful.
// @param {number} minutesAgo - Whole minutes before the current moment.
// @returns {string} An ISO 8601 date-time string.
// [Claude claude-opus-4-8] Task: seed shared-note fixtures with collaborator-update timestamps
// Prompt: "create sample notes in dev mode that have the attributes necessary to be found by the
//   filterNotes seeking shared notes"
function isoFromMinutesAgo(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

// Note handles referenced by sample tasks, grouped by domain.
// Each entry provides the name shown in the Recent Notes widget.
// Shared by dev/dev-app.js (Node) and lib/util/browser-dev-app.js (browser) so the
// dev environments stay in sync without two copies of this fixture data.
//
// A subset of notes carries the attributes the Shared Notes widget filters on:
//   - `shared: true`           -> matches the filterNotes "shared" group
//   - `hasTasks`               -> matches/excludes the optional "taskLists" group (checkbox)
//   - `updated` > `changed`    -> a collaborator edited after the current user
// Notes left without these fields stay private so the "shared" filter is observably selective.
//
// The collaborator identities come from the dev getPeople() shim (SAMPLE_PEOPLE below), whose
// `sharing.notes` reference these same note UUIDs.
// [Claude claude-sonnet-4-6] Task: add domain tags to sample note handles so filterNotes can match by domain tag
// Prompt: "component no longer finds notes in dev environment — adding each note to a tag present in the task domain"
// [Claude claude-opus-4-8] Task: add shared/collaborator/timestamp attributes for the Shared Notes widget
// Prompt: "create sample notes in dev mode that have the attributes necessary to be found by the filterNotes seeking shared notes"
export const SAMPLE_NOTE_HANDLES = {
  "domain-work-uuid": [
    { uuid: "note-work-1",  name: "Q1 Goal Review",         tags: ["work"], shared: true, hasTasks: true,
      changed: isoFromMinutesAgo(2880), updated: isoFromMinutesAgo(8) },
    { uuid: "note-work-2",  name: "Stand-up Notes",         tags: ["work"] },
    { uuid: "note-work-3",  name: "Feature Implementation", tags: ["work"] },
    { uuid: "note-work-4",  name: "Design Feedback",        tags: ["work"], shared: true, hasTasks: true,
      changed: isoFromMinutesAgo(7200), updated: isoFromMinutesAgo(120) },
    { uuid: "note-work-5",  name: "Budget Tracker",         tags: ["work"] },
    { uuid: "note-work-6",  name: "Offline Testing",        tags: ["work"] },
    // Shared but has no tasks: shows under "shared" but is hidden when the "Has tasks" box is checked.
    { uuid: "note-work-7",  name: "Sprint Retro",           tags: ["work"], shared: true, hasTasks: false,
      changed: isoFromMinutesAgo(55760), updated: isoFromMinutesAgo(44440) },
    { uuid: "note-work-8",  name: "API Layer Research",     tags: ["work"] },
    { uuid: "note-work-9",  name: "Integration Tests",      tags: ["work"] },
    // Shared but only the current user edited it (updated === changed): excluded by the widget.
    { uuid: "note-work-10", name: "Pull Request Queue",     tags: ["work"], shared: true, hasTasks: true,
      changed: isoFromMinutesAgo(180), updated: isoFromMinutesAgo(180) },
    { uuid: "note-work-11", name: "Settings Module Tests",  tags: ["work"] },
    { uuid: "note-work-12", name: "CSS Cleanup",            tags: ["work"] },
    { uuid: "note-work-13", name: "Dashboard Memory Leak",  tags: ["work"] },
    { uuid: "note-work-14", name: "Client Feedback",        tags: ["work"], shared: true, hasTasks: true,
      changed: isoFromMinutesAgo(14400), updated: isoFromMinutesAgo(14320) },
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
    { uuid: "note-personal-1",  name: "Networking Outreach", tags: ["personal"], shared: true, hasTasks: true,
      changed: isoFromMinutesAgo(1440), updated: isoFromMinutesAgo(25) },
    { uuid: "note-personal-2",  name: "Fitness Log",         tags: ["personal"] },
    { uuid: "note-personal-3",  name: "Social Reminders",    tags: ["personal"] },
    { uuid: "note-personal-4",  name: "Entertainment",       tags: ["personal"] },
    { uuid: "note-personal-5",  name: "Shopping List",       tags: ["personal"] },
    { uuid: "note-personal-6",  name: "Health Appointments", tags: ["personal"] },
    { uuid: "note-personal-7",  name: "Reading List",        tags: ["personal"] },
    { uuid: "note-personal-8",  name: "Hobbies",             tags: ["personal"] },
    { uuid: "note-personal-9",  name: "Trip Planning",       tags: ["personal"], shared: true, hasTasks: false,
      changed: isoFromMinutesAgo(2880), updated: isoFromMinutesAgo(360) },
    { uuid: "note-personal-10", name: "Home Office",         tags: ["personal"] },
  ],
  "domain-side-uuid": [
    { uuid: "note-side-1", name: "Blog Post Ideas",     tags: ["side-projects"] },
    { uuid: "note-side-2", name: "Side Project README", tags: ["side-projects"], shared: true, hasTasks: true,
      changed: isoFromMinutesAgo(4320), updated: isoFromMinutesAgo(45) },
    { uuid: "note-side-3", name: "CI Pipeline Setup",   tags: ["side-projects"] },
  ],
};

// ----------------------------------------------------------------------------------------------
// People known to the current user, mirroring what production app.getPeople() returns (see
// appendix_i#person). Each person's `sharing.notes` references the shared SAMPLE_NOTE_HANDLES
// UUIDs above, so buildPeopleIndexByNote can invert them into a noteUUID -> person index. A mix of
// `avatar.image` (URL) and `avatar.text` (initials badge) exercises both rendering paths in the
// Shared Notes widget.
// [Claude claude-opus-4-8] Task: provide a dev getPeople() fixture indexed onto the shared notes
// Prompt: "build and store an index of notesUUID => person... show their avatar when it is present"
export const SAMPLE_PEOPLE = [
  { uuid: "person-jordan-lee",   name: "Jordan Lee",   avatar: { image: "https://i.pravatar.cc/80?u=jordan-lee" },
    active: isoFromMinutesAgo(30),   sharing: { notes: ["note-work-1"], tags: [] } },
  { uuid: "person-sam-rivera",   name: "Sam Rivera",   avatar: { text: "SR" },
    active: isoFromMinutesAgo(90),   sharing: { notes: ["note-work-1"], tags: [] } },
  { uuid: "person-priya-patel",  name: "Priya Patel",  avatar: { image: "https://i.pravatar.cc/80?u=priya-patel" },
    active: isoFromMinutesAgo(240),  sharing: { notes: ["note-work-4"], tags: ["work"] } },
  { uuid: "person-chen-wei",     name: "Chen Wei",     avatar: { text: "CW" },
    active: isoFromMinutesAgo(1500), sharing: { notes: ["note-work-7"], tags: [] } },
  { uuid: "person-maria-gomez",  name: "Maria Gomez",  avatar: { image: "https://i.pravatar.cc/80?u=maria-gomez" },
    active: isoFromMinutesAgo(1600), sharing: { notes: ["note-work-7"], tags: [] } },
  { uuid: "person-alex-kim",     name: "Alex Kim",     avatar: { text: "AK" },
    active: isoFromMinutesAgo(200),  sharing: { notes: ["note-work-10"], tags: [] } },
  { uuid: "person-taylor-brooks", name: "Taylor Brooks", avatar: { text: "TB" },
    active: isoFromMinutesAgo(4400), sharing: { notes: ["note-work-14"], tags: [] } },
  { uuid: "person-dana-cole",    name: "Dana Cole",    avatar: { image: "https://i.pravatar.cc/80?u=dana-cole" },
    active: isoFromMinutesAgo(60),   sharing: { notes: ["note-personal-1"], tags: ["personal"] } },
  { uuid: "person-robin-fox",    name: "Robin Fox",    avatar: { text: "RF" },
    active: isoFromMinutesAgo(400),  sharing: { notes: ["note-personal-9"], tags: [] } },
  { uuid: "person-jamie-park",   name: "Jamie Park",   avatar: { image: "https://i.pravatar.cc/80?u=jamie-park" },
    active: isoFromMinutesAgo(420),  sharing: { notes: ["note-personal-9"], tags: [] } },
  { uuid: "person-morgan-ellis", name: "Morgan Ellis", avatar: { text: "ME" },
    active: isoFromMinutesAgo(50),   sharing: { notes: ["note-side-2"], tags: ["side-projects"] } },
];

// Predicates for the filterNotes `group` tokens the dev fixtures model. Tokens that aren't
// listed here (e.g. "taskLists") are treated as always-matching so existing widgets that pass
// other groups keep receiving every domain note, exactly as before.
// [Claude claude-opus-4-8] Task: honor the shared/hasTasks filterNotes groups in the dev shims
// Prompt: "create sample notes in dev mode that have the attributes necessary to be found by the filterNotes seeking shared notes"
// Token names mirror Amplenote's FILTER_GROUP values (ample-web lib/ample-util/filter-group.js):
// SHARED = "shared", HAS_TASKS = "taskLists" (production predicate: `note.hasTasks`).
// For "taskLists" the dev shim treats an unspecified `hasTasks` as task-bearing (only an explicit
// `false` excludes a note), so task-oriented widgets that pass "taskLists" — recent-notes and
// graveyard — keep showing the broad fixture set rather than only the few notes we annotate.
const GROUP_PREDICATES = {
  shared: (handle) => Boolean(handle?.shared),
  taskLists: (handle) => handle?.hasTasks !== false,
};

// ----------------------------------------------------------------------------------------------
// @desc Decide whether a sample note handle matches a (possibly comma-separated) filterNotes
//   `group` argument. All recognized tokens must match (AND semantics, as production does for
//   "shared,hasTasks"); unrecognized tokens are ignored so unrelated group queries pass through.
// @param {Object} handle - A sample note handle.
// @param {string|undefined} group - The filterNotes group argument (e.g. "shared,hasTasks").
// @returns {boolean} True when the handle satisfies every recognized group token.
// [Claude claude-opus-4-8] Task: filter dev sample notes by the shared/hasTasks groups
// Prompt: "use app.filterNotes with group of at least 'shared'... toggles whether the 'hasTasks' group is included"
export function noteHandleMatchesGroups(handle, group) {
  if (!group) return true;
  const tokens = String(group).split(",").map(token => token.trim()).filter(Boolean);
  return tokens.every(token => {
    const predicate = GROUP_PREDICATES[token];
    return predicate ? predicate(handle) : true;
  });
}

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
