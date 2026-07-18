/**
 * [Claude claude-opus-4-8 (1M context)-authored file]
 * Prompt summary: "integration-test the Energy Per Habit service: first load fetches a full year + creates the
 *   cache note; a second load fetches only the current month (cached past months are not re-fetched) yet returns
 *   the same habits; a re-completed non-RRULE task still surfaces"
 */
import { loadEnergyPerHabit } from "energy-per-habit-service";
import { HABIT_CACHE_NOTE_NAME } from "energy-per-habit-cache";
import { monthKeyFromDate } from "energy-per-habit-analysis";

const DAY = 86400;

// In-memory app double recording getCompletedTasks/getMoodRatings call windows + backing note storage.
function makeApp(tasks, moods) {
  const store = {};
  const calls = { tasks: [], moods: [] };
  return {
    calls, store,
    async findNote({ name }) {
      const uuid = Object.keys(store).find(id => store[id].name === name);
      return uuid ? { uuid, name } : null;
    },
    async getNoteContent({ uuid }) { return store[uuid]?.content ?? ""; },
    async createNote(name) {
      const uuid = `uuid-${Object.keys(store).length + 1}`;
      store[uuid] = { name, content: "" };
      return uuid;
    },
    async replaceNoteContent(handle, content, options = {}) {
      const uuid = handle.uuid;
      if (options?.section?.heading?.text) {
        const heading = options.section.heading.text;
        const re = new RegExp(`(^##\\s+${heading}\\s*$\\n)([\\s\\S]*?)(?=^##\\s+|$(?![\\s\\S]))`, "m");
        store[uuid].content = store[uuid].content.replace(re, (_m, head) => `${head}${content.trim()}\n`);
      } else {
        store[uuid].content = content;
      }
      return true;
    },
    async getCompletedTasks(fromSec, toSec) {
      calls.tasks.push({ fromSec, toSec });
      return tasks.filter(t => t.completedAt >= fromSec && t.completedAt < toSec);
    },
    async getMoodRatings(fromSec) {
      calls.moods.push({ fromSec });
      return moods.filter(m => m.timestamp >= fromSec);
    },
  };
}

// A task re-completed (no RRULE) on each of `daysBackList`, plus a matching-day mood for each.
function buildFixture(today, daysBackList, rating) {
  const midnight = new Date(today); midnight.setHours(0, 0, 0, 0);
  const midnightSec = Math.floor(midnight.getTime() / 1000);
  const tasks = daysBackList.map(d => ({ content: "🏋️ Exercise", completedAt: midnightSec - d * DAY + 10 * 3600 }));
  const moods = daysBackList.map(d => ({ rating, timestamp: midnightSec - d * DAY + 9 * 3600 }));
  // A few low-mood off days (no completion) so the delta has an off-side sample.
  for (const d of [5, 15, 25, 35]) moods.push({ rating: -2, timestamp: midnightSec - d * DAY + 9 * 3600 });
  return { tasks, moods };
}

describe("loadEnergyPerHabit", () => {
  const today = new Date(2026, 6, 18, 12, 0, 0); // Jul 18 2026, midday

  test("first load fetches ~a year and creates the cache note; a re-completed non-RRULE task surfaces", async () => {
    // Completed across ~9 months so it spans multiple month sections (days chosen to avoid the off-day set).
    const daysDone = [1, 2, 3, 10, 20, 40, 41, 70, 71, 100, 130, 160, 200, 240];
    const { tasks, moods } = buildFixture(today, daysDone, 2);
    const app = makeApp(tasks, moods);

    const result = await loadEnergyPerHabit(app, { today });
    expect(result.habits).toHaveLength(1);
    expect(result.habits[0].label).toBe("🏋️ Exercise");
    expect(result.habits[0].delta).toBeGreaterThan(0);
    expect(result.cached).toBe(false);

    // First fetch reached back roughly a year (>= 300 days), and the note now exists with month sections.
    const firstFrom = app.calls.tasks[0].fromSec;
    const nowSec = Math.floor(today.getTime() / 1000);
    expect((nowSec - firstFrom) / DAY).toBeGreaterThan(300);
    const note = Object.values(app.store).find(n => n.name === HABIT_CACHE_NOTE_NAME);
    expect(note.content).toContain("## July 2026");
  });

  test("second load only fetches the current month, cached past months are not re-fetched", async () => {
    // Each of July/June/May has >= 2 completions (so no once-a-month row is pruned) and none land on an off-day.
    const daysDone = [1, 2, 3, 10, 40, 41, 42, 70, 71, 72]; // Jul: 1,2,3,10 · Jun: 40,41,42 · May: 70,71,72
    const { tasks, moods } = buildFixture(today, daysDone, 2);
    const app = makeApp(tasks, moods);

    await loadEnergyPerHabit(app, { today });          // populate cache
    const secondResult = await loadEnergyPerHabit(app, { today });

    // Same habit recovered from cache + fresh current month.
    expect(secondResult.habits).toHaveLength(1);
    expect(secondResult.habits[0].completions).toBe(daysDone.length);

    // The second fetch window starts at the current month, not a year back.
    const secondFrom = app.calls.tasks[1].fromSec;
    const julyStart = Math.floor(new Date(2026, 6, 1).getTime() / 1000);
    expect(secondFrom).toBe(julyStart);
  });

  test("current month key matches today's month", () => {
    expect(monthKeyFromDate(today)).toBe("2026-07");
  });
});
